import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {build} from 'esbuild';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
const baseline=process.argv.includes('--baseline');
const sqlite=new DatabaseSync(':memory:');
let faultAt=0,writeCount=0,beforeAtomic=null;
const bind=p=>Object.fromEntries(p.map((v,i)=>[`$${i+1}`,v]));
const adapter={
  async execute(sql,p=[]){if(faultAt&&++writeCount===faultAt)throw Error('Injected write failure');const result=sqlite.prepare(sql).run(...(p.length?[bind(p)]:[]));return {rowsAffected:Number(result.changes),lastInsertId:Number(result.lastInsertRowid)};},
  async select(sql,p=[]){return sqlite.prepare(sql).all(...(p.length?[bind(p)]:[])).map(row=>({...row}));},
  async atomic(steps){if(beforeAtomic){const hook=beforeAtomic;beforeAtomic=null;await hook();}sqlite.exec('BEGIN');try{for(const step of steps){if(step.expectedRows!==undefined)assert.deepEqual(await adapter.select(step.sql,step.params),step.expectedRows,'Data changed');else{const r=await adapter.execute(step.sql,step.params);if(step.affectedRows!==undefined)assert.equal(r.rowsAffected,step.affectedRows);}}sqlite.exec('COMMIT');}catch(e){sqlite.exec('ROLLBACK');throw e;}}
};
globalThis.__knoopC=adapter;
const plugin=browser=>({name:'isolated-sqlite',setup(b){
  b.onResolve({filter:/^@tauri-apps\/plugin-sql$/},()=>({path:'sql',namespace:'test'}));
  b.onResolve({filter:/^@tauri-apps\/api\/core$/},()=>({path:'core',namespace:'test'}));
  b.onLoad({filter:/.*/,namespace:'test'},args=>({loader:'js',contents:args.path==='sql'?`export default {load:async()=>${browser?'({execute:(s,p)=>window.__sql("execute",s,p),select:(s,p)=>window.__sql("select",s,p)})':'globalThis.__knoopC'}};`:`export async function invoke(command,args){if(command==="atomic_write")return ${browser?'window.__atomic(args.steps)':'globalThis.__knoopC.atomic(args.steps)'};if(command==="save_restore_safety_copy")return ${browser?'window.__safety(args.data)':'globalThis.__safety(args.data)'};throw Error("Native API forbidden");}`}));
  if(browser)b.onLoad({filter:/[\\/]src[\\/]main\.ts$/},async()=>({loader:'ts',contents:(baseline?execFileSync('git',['-c',`safe.directory=${process.cwd().replaceAll('\\','/')}`,'show','df658ad:src/main.ts'],{encoding:'utf8'}):await readFile('src/main.ts','utf8'))+'\nwindow.__ui={navigate};'}));
}});
let hasBackup=true;try{await readFile('src/backup.ts');}catch{hasBackup=false;}
const bundle=await build({stdin:{contents:`export * as d from "./src/db";export * as f from "./src/backup-format";export * as v from "./src/backup-validation";export * as ai from "./src/ai-review";${hasBackup?'export * as backup from "./src/backup";':''}`,loader:'ts',resolveDir:process.cwd()},bundle:true,platform:'node',format:'cjs',write:false,plugins:[plugin(false)],logLevel:'silent'});
const module={exports:{}};new Function('module','exports',bundle.outputFiles[0].text)(module,module.exports);const {d,f,v,ai,backup}=module.exports;
await d.db();
const fixture={format:'knoop-bank',version:'1.1',import:{mode:'new',bankId:'knoop-ai-preview',bankTitle:'AI 临时回炉'},nodes:[{id:'review',parentId:null,title:'AI 回炉',order:0}],questions:[0,1].map(i=>({id:`q${i}`,nodeId:'review',type:'single_choice',order:i,stem:`合成题${i}`,options:[{id:'A',text:'甲'},{id:'B',text:'乙'}],answer:'A',explanation:'合成解析'}))};
const results=[];
async function check(id,task){try{const detail=await task();results.push({id,status:'PASS',...detail});console.log('PASS '+id);}catch(e){results.push({id,status:'FAIL',reason:e.message});console.log('FAIL '+id+': '+e.message.split('\n')[0]);}}
async function sign(file){const {integrity,...payload}=file;file.integrity={algorithm:'SHA-256',digest:await f.backupDigest(payload)};return file;}
const empty=()=>({format:'knoop-backup',version:'1.0',appVersion:'0.1.10',exportedAt:'2026-10-09T00:00:00.000Z',tables:Object.fromEntries(Object.keys(f.backupTables).map(key=>[key,[]])),counts:Object.fromEntries(Object.keys(f.backupTables).map(key=>[key,0])),sequences:{attempts:0,question_answer_revisions:0},preferences:Object.fromEntries(f.preferenceKeys.map(key=>[key,null]))});
await check('F08 backup schema/version/integrity and unknown secret fields',async()=>{
  const file=await sign(empty());await v.validateBackup(file);let bad=structuredClone(file);bad.preferences['knoop.enabledBrushTypes.v1']='["blank"]';await assert.rejects(()=>v.validateBackup(bad),/SHA-256/);
  bad=await sign({...empty(),apiKey:'synthetic-secret'});await assert.rejects(()=>v.validateBackup(bad),/结构/);
  bad=await sign({...empty(),version:'2.0'});await assert.rejects(()=>v.validateBackup(bad),/结构/);
  bad=await sign({...empty(),counts:{...empty().counts,banks:1}});await assert.rejects(()=>v.validateBackup(bad),/数量/);
});
await check('F09 normal and AI structure rules agree, field errors are actionable',async()=>{
  const cases=[['extra field',bank=>bank.questions[0].unknown=1],['options wrong type',bank=>bank.questions[0].options='A'],['empty option',bank=>bank.questions[0].options[0].text=''],['duplicate ID',bank=>bank.questions[1].id=bank.questions[0].id],['orphan node',bank=>bank.questions[0].nodeId='absent'],['node cycle',bank=>bank.nodes[0].parentId='review'],['invalid answer',bank=>bank.questions[0].answer='Z']];
  for(const [name,mutate] of cases){const bank=structuredClone(fixture);mutate(bank);assert.throws(()=>d.validateBank(bank),undefined,`normal accepted ${name}`);assert.throws(()=>ai.parseAiReviewBank(JSON.stringify(bank),{question:{id:'original',stem:'原题'}},new Set()),undefined,`AI accepted ${name}`);}
  for(const version of ['1.0','1.1'])assert.equal(d.validateBank({...fixture,version}).version,version);
});
// Further real-SQLite and browser cases are added with the export/restore implementation.
await mkdir('artifacts/review-c',{recursive:true});await writeFile(`artifacts/review-c/${baseline?'baseline':'regression'}.json`,JSON.stringify(results,null,2));
sqlite.close();delete globalThis.__knoopC;if(results.some(r=>r.status==='FAIL')&&!baseline)process.exitCode=1;
