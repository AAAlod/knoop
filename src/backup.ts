import { cloneJson } from "./compat";
import { invoke } from "@tauri-apps/api/core";
import { db, atomicWrite, type AtomicStep } from "./db";
import { backupTables, preferenceKeys, backupDigest, canonical, type BackupFile, type BackupRow, type BackupTable, type Preferences } from "./backup-format";
import { validateBackup, validatePreferences } from "./backup-validation";
import {version as appVersion} from "../package.json";

export type PreferenceStorage=Pick<Storage,"getItem"|"setItem"|"removeItem">;
const names=Object.keys(backupTables) as BackupTable[];
const query=(name:BackupTable)=>`SELECT ${Object.keys(backupTables[name]).join(",")} FROM ${name} ORDER BY ${"id" in backupTables[name]?"id":"question_id"}`;
const sequenceQuery="SELECT name,seq FROM sqlite_sequence WHERE name IN ('attempts','question_answer_revisions') ORDER BY name";
function readPreferences(storage:PreferenceStorage):Preferences{return Object.fromEntries(preferenceKeys.map(key=>[key,storage.getItem(key)])) as Preferences;}
function writePreferences(storage:PreferenceStorage,preferences:Preferences):void{
  // Remove allowlisted keys first so restoring the old set also works after a quota failure.
  for(const key of preferenceKeys)storage.removeItem(key);
  for(const key of preferenceKeys)if(preferences[key]!==null)storage.setItem(key,preferences[key]!);
}
function checks(file:BackupFile):AtomicStep[]{return names.map(name=>({sql:query(name),expectedRows:file.tables[name]}));}
export async function recoverPreferenceRestore(storage:PreferenceStorage=localStorage):Promise<boolean|null>{
  const conn=await db(),rows=await conn.select<{previous_json:string;target_json:string;committed:number}[]>("SELECT previous_json,target_json,committed FROM backup_preference_journal WHERE id=1");
  const journal=rows[0];if(!journal)return null;
  const preferences=JSON.parse(journal.committed?journal.target_json:journal.previous_json) as Preferences;validatePreferences(preferences);
  writePreferences(storage,preferences);
  await conn.execute("DELETE FROM backup_preference_journal WHERE id=1");
  return !!journal.committed;
}
export async function buildBackup(storage:PreferenceStorage=localStorage):Promise<BackupFile>{
  await recoverPreferenceRestore(storage);
  const conn=await db(),preferences=readPreferences(storage);
  const tables={} as BackupFile["tables"],counts={} as BackupFile["counts"];
  for(const name of names){tables[name]=await conn.select<BackupRow[]>(query(name));counts[name]=tables[name].length;}
  const rows=await conn.select<{name:string;seq:number}[]>(sequenceQuery);
  const sequences={attempts:rows.find(row=>row.name==="attempts")?.seq??0,question_answer_revisions:rows.find(row=>row.name==="question_answer_revisions")?.seq??0};
  await atomicWrite([...names.map(name=>({sql:query(name),expectedRows:tables[name]})),{sql:sequenceQuery,expectedRows:rows}]);
  if(canonical(readPreferences(storage))!==canonical(preferences))throw new Error("设置已变化，请重新导出备份");
  const payload={format:"knoop-backup" as const,version:"1.1" as const,appVersion,exportedAt:new Date().toISOString(),tables,counts,sequences,preferences};
  return validateBackup({...payload,integrity:{algorithm:"SHA-256",digest:await backupDigest(payload)}});
}
export interface PreparedRestore {target:BackupFile;before:BackupFile;safetyFile:string}
const preparedRestores=new WeakSet<PreparedRestore>();
let restoring=false;
export async function prepareRestore(raw:unknown,storage:PreferenceStorage=localStorage):Promise<PreparedRestore>{
  const target=cloneJson(await validateBackup(raw)),before=await buildBackup(storage);
  const safetyFile=await invoke<string>("save_restore_safety_copy",{data:JSON.stringify(before)});
  const prepared={target,before,safetyFile};preparedRestores.add(prepared);return prepared;
}
export async function restorePrepared(prepared:PreparedRestore,storage:PreferenceStorage=localStorage):Promise<void>{
  if(!preparedRestores.has(prepared))throw new Error("请先生成当前状态的安全副本");
  if(restoring)throw new Error("正在恢复，请稍候");restoring=true;
  try{
    const target=await validateBackup(prepared.target),before=await validateBackup(prepared.before);
    if(canonical(readPreferences(storage))!==canonical(before.preferences))throw new Error("本机设置已变化，请重新预览并备份");
    const conn=await db(),sequenceRows=await conn.select<{name:string;seq:number}[]>(sequenceQuery);
    if(sequenceRows.some(row=>row.seq!==before.sequences[row.name as keyof typeof before.sequences])||Object.entries(before.sequences).some(([name,value])=>value!==0&&!sequenceRows.some(row=>row.name===name&&row.seq===value)))throw new Error("作答记录已变化，请重新备份");
    await atomicWrite([...checks(before),{sql:sequenceQuery,expectedRows:sequenceRows},{sql:"INSERT INTO backup_preference_journal(id,previous_json,target_json,committed) VALUES(1,$1,$2,0)",params:[JSON.stringify(before.preferences),JSON.stringify(target.preferences)]}]);
    try{
      writePreferences(storage,target.preferences);
      const steps:AtomicStep[]=[...checks(before),{sql:sequenceQuery,expectedRows:sequenceRows}];
      for(const name of [...names].reverse())steps.push({sql:`DELETE FROM ${name}`});
      for(const name of names){const fields=Object.keys(backupTables[name]);for(const row of target.tables[name])steps.push({sql:`INSERT INTO ${name}(${fields.join(",")}) VALUES(${fields.map((_,i)=>`$${i+1}`).join(",")})`,params:fields.map(field=>row[field])});}
      steps.push({sql:"DELETE FROM sqlite_sequence WHERE name IN ('attempts','question_answer_revisions')"});
      for(const [name,value] of Object.entries(target.sequences))steps.push({sql:"INSERT INTO sqlite_sequence(name,seq) VALUES($1,$2)",params:[name,value]});
      steps.push({sql:"UPDATE backup_preference_journal SET committed=1 WHERE id=1",affectedRows:1});
      await atomicWrite(steps);
    }catch(error){
      const committed=await recoverPreferenceRestore(storage);
      if(!committed)throw error;
      return;
    }
    await recoverPreferenceRestore(storage);
  }finally{restoring=false;preparedRestores.delete(prepared);}
}
