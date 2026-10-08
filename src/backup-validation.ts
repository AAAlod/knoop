import validateSchema from "./generated/knoop-backup-v1-validator.js";
import { validateBank } from "./db";
import { backupDigest, canonical, backupTables, preferenceKeys, type BackupFile, type BackupRow, type Preferences } from "./backup-format";
import type { BankFile, QuestionInput } from "./types";

function requireValue(ok:unknown,path:string,message:string):asserts ok {if(!ok)throw new Error(`备份 ${path}：${message}`);}
function parse(raw:unknown,path:string):any {try{return JSON.parse(String(raw));}catch{throw new Error(`备份 ${path}：JSON 无效`);}}
function strings(value:unknown,path:string):asserts value is string[]{requireValue(Array.isArray(value)&&value.every(x=>typeof x==="string")&&new Set(value).size===value.length,path,"必须是不重复的字符串数组");}
function object(value:unknown,path:string):asserts value is Record<string,any>{requireValue(value&&typeof value==="object"&&!Array.isArray(value),path,"必须是对象");}
function question(value:QuestionInput,path:string):void{
  try{validateBank({format:"knoop-bank",version:"1.1",import:{mode:"new",bankId:"backup-check",bankTitle:"备份校验"},nodes:[{id:value?.nodeId,parentId:null,title:"节点",order:0}],questions:[value]});}
  catch(error){throw new Error(`备份 ${path}：${error instanceof Error?error.message:String(error)}`);}
}
function state(value:any,path:string):void{
  object(value,path);
  for(const field of ["selection","excludedOptions"])if(value[field]!==undefined)strings(value[field],`${path}.${field}`);
  for(const field of ["blank","blankValue"])if(value[field]!==undefined)requireValue(typeof value[field]==="string",`${path}.${field}`,"必须是字符串");
  for(const field of ["submitted","pendingManual","correct","quickMode","revealed","recallShown"])if(value[field]!==undefined)requireValue(typeof value[field]==="boolean",`${path}.${field}`,"必须是布尔值");
  requireValue(!(value.submitted&&value.pendingManual),path,"不能同时已提交和待判分");
}
export function validatePreferences(preferences:Preferences):void{
  for(const key of preferenceKeys){
    const raw=preferences[key];if(raw===null)continue;
    if(key==="knoop.recentScopePreset.v2")continue;
    const value=parse(raw,key);
    if(key==="knoop.scopePresets.v2"){
      requireValue(Array.isArray(value),key,"必须是数组");const ids=new Set();
      for(const [i,preset] of value.entries()){
        const path=`${key}[${i}]`;object(preset,path);
        requireValue(typeof preset.id==="string"&&preset.id.length&&!ids.has(preset.id),path,"预设 ID 无效或重复");ids.add(preset.id);
        requireValue(typeof preset.name==="string"&&preset.name.trim()&&["sequential","random"].includes(preset.mode),path,"名称或模式无效");
        strings(preset.types,`${path}.types`);requireValue(preset.types.length&&preset.types.every((t:string)=>["single_choice","multiple_choice","blank","recall"].includes(t)),path,"题型无效");
        requireValue(Array.isArray(preset.ranges)&&preset.ranges.length&&preset.ranges.every((r:any)=>r&&typeof r.nodeId==="string"&&typeof r.includeDescendants==="boolean"),path,"范围无效");
        if(preset.count!==undefined)requireValue(Number.isSafeInteger(preset.count)&&preset.count>0,path,"数量无效");
      }
    }else{
      strings(value,key);
      if(key==="knoop.enabledBrushTypes.v1")requireValue(value.every(t=>["single_choice","multiple_choice","blank","recall"].includes(t)),key,"题型无效");
    }
  }
}
export async function validateBackup(raw:unknown):Promise<BackupFile>{
  if(!validateSchema(raw)){
    const error=validateSchema.errors?.[0];throw new Error(`备份结构无效：${error?.instancePath||"根节点"} ${error?.message||"格式或版本不支持"}`);
  }
  const file=raw as BackupFile;
  const {integrity,...payload}=file;
  requireValue(await backupDigest(payload)===integrity.digest,"integrity","SHA-256 不匹配，文件可能不完整或已修改");
  requireValue(Number.isFinite(Date.parse(file.exportedAt)),"exportedAt","时间无效");
  const maps:Record<string,Map<string|number,BackupRow>>={};
  for(const name of Object.keys(backupTables) as (keyof typeof backupTables)[]){
    const rows=file.tables[name];requireValue(rows.length===file.counts[name],`counts.${name}`,"数量不匹配");
    const primary="id" in backupTables[name]?"id":"question_id",map=new Map<string|number,BackupRow>();
    for(const row of rows){const id=row[primary];requireValue(id!==null&&id!==""&&!map.has(id),`tables.${name}`,"主键为空或重复");map.set(id,row);}
    maps[name]=map;
  }
  const ref=(table:string,id:unknown,path:string)=>requireValue(maps[table].has(id as string),path,`引用不存在的 ${table} ID`);
  const externalNodes=new Set(),externalQuestions=new Set();
  for(const node of file.tables.nodes){
    ref("banks",node.bank_id,`nodes.${node.id}.bank_id`);
    requireValue(node.id===`${String(node.bank_id).length}:${node.bank_id}::${node.external_id}`,`nodes.${node.id}`,"节点身份不一致");
    if(node.parent_id!==null){ref("nodes",node.parent_id,`nodes.${node.id}.parent_id`);requireValue(maps.nodes.get(node.parent_id)!.bank_id===node.bank_id,`nodes.${node.id}`,"跨题库父节点");}
    const identity=canonical([node.bank_id,node.external_id]);requireValue(!externalNodes.has(identity),"nodes","外部 ID 重复");externalNodes.add(identity);
  }
  const contents=new Map<string,QuestionInput>();
  for(const row of file.tables.questions){
    ref("banks",row.bank_id,`questions.${row.id}.bank_id`);ref("nodes",row.node_id,`questions.${row.id}.node_id`);
    const node=maps.nodes.get(row.node_id!)!,q=parse(row.content_json,`questions.${row.id}.content_json`);question(q,`questions.${row.id}`);
    requireValue(node.bank_id===row.bank_id&&row.id===`${String(row.bank_id).length}:${row.bank_id}::${q.id}`&&row.external_id===q.id&&node.external_id===q.nodeId&&row.type===q.type&&row.sort_order===q.order,`questions.${row.id}`,"题目身份、节点、题型或顺序不一致");
    requireValue(canonical(parse(row.tags_json,`questions.${row.id}.tags_json`))===canonical(q.tags??[]),`questions.${row.id}.tags_json`,"标签与内容不一致");
    requireValue(q.source===undefined?row.source_json===null:canonical(parse(row.source_json,`questions.${row.id}.source_json`))===canonical(q.source),`questions.${row.id}.source_json`,"来源与内容不一致");
    const identity=canonical([row.bank_id,row.external_id]);requireValue(!externalQuestions.has(identity),"questions","外部 ID 重复");externalQuestions.add(identity);contents.set(String(row.id),q);
  }
  for(const bank of file.tables.banks){
    validateBank({format:"knoop-bank",version:"1.1",import:{mode:"new",bankId:bank.id,bankTitle:bank.title},nodes:file.tables.nodes.filter(n=>n.bank_id===bank.id).map(n=>({id:n.external_id,parentId:n.parent_id===null?null:maps.nodes.get(n.parent_id!)!.external_id,title:n.title,order:n.sort_order})),questions:file.tables.questions.filter(q=>q.bank_id===bank.id).map(q=>contents.get(String(q.id)))});
  }
  for(const name of ["attempts","favorites","killed_questions","notes","question_reviews","question_answer_revisions"]){
    for(const row of file.tables[name as keyof typeof backupTables])ref("questions",row.question_id,`${name}.${row.id??row.question_id}.question_id`);
  }
  for(const attempt of file.tables.attempts){parse(attempt.user_answer,`attempts.${attempt.id}.user_answer`);requireValue(["auto","manual"].includes(String(attempt.grading_mode)),`attempts.${attempt.id}`,"判分模式无效");}
  for(const review of file.tables.question_reviews){
    const issues=parse(review.issues_json,`reviews.${review.question_id}.issues_json`);strings(issues,"review.issues");requireValue(issues.every(i=>["stem","options","answer","explanation","other"].includes(i)),"review.issues","位置无效");
    const q=parse(review.question_snapshot_json,"review.snapshot");question(q,"review.snapshot");requireValue(q.id===contents.get(String(review.question_id))!.id,"review.snapshot","题目身份不一致");
    requireValue(maps.killed_questions.has(review.question_id!),"review","待返修题目必须处于斩杀状态");
  }
  for(const revision of file.tables.question_answer_revisions){for(const field of ["previous_content_json","updated_content_json"]){const q=parse(revision[field],`revision.${field}`);question(q,`revision.${field}`);requireValue(q.id===contents.get(String(revision.question_id))!.id,`revision.${field}`,"题目身份不一致");}}
  const latestAttempt=file.tables.question_answer_revisions.reduce((max,row)=>Math.max(max,Number(row.last_attempt_id)),file.tables.attempts.reduce((max,row)=>Math.max(max,Number(row.id)),0));
  const latestRevision=file.tables.question_answer_revisions.reduce((max,row)=>Math.max(max,Number(row.id)),0);
  requireValue(file.sequences.attempts>=latestAttempt&&file.sequences.question_answer_revisions>=latestRevision,"sequences","自增序列低于现有记录或修订截止值");
  for(const session of file.tables.sessions){
    const ids=parse(session.question_ids_json,`sessions.${session.id}.question_ids_json`);strings(ids,"session.questionIds");ids.forEach(id=>ref("questions",id,"session.questionIds"));
    requireValue(Number(session.current_index)<=ids.length,"session.current_index","超出范围");object(parse(session.scope_json,"session.scope"),"session.scope");state(parse(session.state_json,"session.state"),"session.state");
  }
  for(const group of file.tables.ai_review_groups){
    const bank=validateBank(parse(group.bank_json,`groups.${group.id}.bank_json`));
    const metadata=parse(group.question_meta_json,"group.metadata"),results=parse(group.results_json,"group.results");
    requireValue(Array.isArray(metadata)&&metadata.length===bank.questions.length&&metadata.every((item:any,i:number)=>item?.questionId===bank.questions[i].id&&typeof item.derivedFrom==="string"&&typeof item.generatedAt==="string"&&typeof item.model==="string"),"group.metadata","来源信息不完整");
    const resultIds=new Set();requireValue(Array.isArray(results),"group.results","必须是数组");
    for(const result of results){requireValue(result&&bank.questions.some(q=>q.id===result.questionId)&&!resultIds.has(result.questionId)&&typeof result.correct==="boolean"&&["auto","manual"].includes(result.grading)&&(typeof result.answer==="string"||Array.isArray(result.answer)&&result.answer.every((x:unknown)=>typeof x==="string")),"group.results","重复或非法作答");resultIds.add(result.questionId);}
    requireValue(Number(group.current_index)<=bank.questions.length,"group.current_index","超出范围");state(parse(group.state_json,"group.state"),"group.state");
  }
  for(const job of file.tables.ai_review_batch_jobs){
    const review=parse(job.review_json,"batch.review"),batches=parse(job.batches_json,"batch.batches");
    requireValue(review?.format==="knoop-error-review"&&Array.isArray(review.items)&&Array.isArray(batches),"batch","来源或批次无效");
    const keys=new Set(review.items.map((item:any)=>{question(item.question,"batch.source");requireValue(typeof item.bank?.id==="string","batch.source","题库 ID 无效");return canonical([item.bank.id,item.question.id]);}));
    for(const batch of batches){
      strings(batch.sourceKeys,"batch.sourceKeys");requireValue(batch.sourceKeys.every((key:string)=>{try{return keys.has(canonical(JSON.parse(key)));}catch{return false;}})&&["pending","failed","ready"].includes(batch.status),"batch","来源或状态无效");object(batch.banks,"batch.banks");
      for(const [key,rawBank] of Object.entries(batch.banks)){requireValue(batch.sourceKeys.includes(key),"batch.banks","来源不匹配");validateBank(rawBank);}
      if(batch.status==="ready")requireValue(batch.sourceKeys.every((key:string)=>batch.banks[key]),"batch","完整批次缺少候选题");
      if(batch.savedGroupId!==undefined)requireValue(typeof batch.savedGroupId==="string","batch.savedGroupId","必须是字符串");
    }
  }
  validatePreferences(file.preferences);
  return file;
}
