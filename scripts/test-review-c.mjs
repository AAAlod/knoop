import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {build} from 'esbuild';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {createServer} from 'node:http';
import {setTimeout as delay} from 'node:timers/promises';
const baseline=process.argv.includes('--baseline');
const sqlite=new DatabaseSync(':memory:');
let faultAt=0,writeCount=0,beforeAtomic=null;
const bind=p=>Object.fromEntries(p.map((v,i)=>[`$${i+1}`,v]));
const adapter={
  async execute(sql,p=[]){if(++writeCount===faultAt)throw Error('Injected write failure');const result=sqlite.prepare(sql).run(...(p.length?[bind(p)]:[]));return {rowsAffected:Number(result.changes),lastInsertId:Number(result.lastInsertRowid)};},
  async select(sql,p=[]){return sqlite.prepare(sql).all(...(p.length?[bind(p)]:[])).map(row=>({...row}));},
  async atomic(steps){if(beforeAtomic){const hook=beforeAtomic;beforeAtomic=null;await hook();}sqlite.exec('BEGIN');try{for(const step of steps){if(step.expectedRows!==undefined)assert.deepEqual(await adapter.select(step.sql,step.params),step.expectedRows,'Data changed');else{const r=await adapter.execute(step.sql,step.params);if(step.affectedRows!==undefined)assert.equal(r.rowsAffected,step.affectedRows);}}sqlite.exec('COMMIT');}catch(e){sqlite.exec('ROLLBACK');throw e;}}
};
globalThis.__knoopC=adapter;
const plugin=browser=>({name:'isolated-sqlite',setup(b){
  b.onResolve({filter:/^@tauri-apps\/plugin-sql$/},()=>({path:'sql',namespace:'test'}));
  b.onResolve({filter:/^@tauri-apps\/api\/core$/},()=>({path:'core',namespace:'test'}));
  b.onLoad({filter:/.*/,namespace:'test'},args=>({loader:'js',contents:args.path==='sql'?`export default {load:async()=>${browser?'({execute:(s,p)=>window.__sql("execute",s,p),select:(s,p)=>window.__sql("select",s,p)})':'globalThis.__knoopC'}};`:`export async function invoke(command,args){if(command==="atomic_write")return ${browser?'window.__atomic(args.steps)':'globalThis.__knoopC.atomic(args.steps)'};if(command==="save_restore_safety_copy")return ${browser?'window.__safety(args.data)':'globalThis.__safety(args.data)'};${browser?'if(command==="list_restore_safety_copies"||command==="read_restore_safety_copy")return window.__copies(command,args);':''}throw Error("Native API forbidden");}`}));
  if(browser)b.onLoad({filter:/[\\/]src[\\/]main\.ts$/},async()=>({loader:'ts',contents:(baseline?execFileSync('git',['-c',`safe.directory=${process.cwd().replaceAll('\\','/')}`,'show','df658ad:src/main.ts'],{encoding:'utf8'}):await readFile('src/main.ts','utf8'))+'\nwindow.__ui={navigate};'}));
}});
let hasBackup=true;try{await readFile('src/backup.ts');}catch{hasBackup=false;}
const bundle=await build({stdin:{contents:`export * as d from "./src/db";export * as f from "./src/backup-format";export * as v from "./src/backup-validation";export * as ai from "./src/ai-review";export * as t from "./src/temp-review";export * as b from "./src/batch-review";${hasBackup?'export * as backup from "./src/backup";':''}`,loader:'ts',resolveDir:process.cwd()},bundle:true,platform:'node',format:'cjs',write:false,plugins:[plugin(false)],logLevel:'silent'});
const module={exports:{}};new Function('module','exports',bundle.outputFiles[0].text)(module,module.exports);const {d,f,v,ai,backup,t,b}=module.exports;
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
await check('F09 semantic errors identify duplicate/question/node/answer fields',async()=>{
  const cases=[[/questions\/1\/id/,bank=>bank.questions[1].id=bank.questions[0].id],[/questions\/0\/nodeId/,bank=>bank.questions[0].nodeId='missing'],[/nodes\/0\/parentId/,bank=>bank.nodes[0].parentId='review'],[/questions\/0\/answer/,bank=>bank.questions[0].answer='Z']];
  for(const [location,mutate] of cases){const bank=structuredClone(fixture);mutate(bank);assert.throws(()=>d.validateBank(bank),location);assert.throws(()=>ai.parseAiReviewBank(JSON.stringify(bank),{question:{id:'original',stem:'原题'}},new Set()),location);}
});
const copies=new Map();globalThis.__safety=async data=>{const name=`before-restore-${copies.size+1}.json`;copies.set(name,data);return name;};
class MemoryStorage {
  values=new Map();failure=0;count=0;
  getItem(key){return this.values.get(key)??null;}
  setItem(key,value){if(++this.count===this.failure)throw Error('Injected localStorage failure');this.values.set(key,value);}
  removeItem(key){this.values.delete(key);}
}
async function reset(){faultAt=0;beforeAtomic=null;for(const {name} of sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table'").all())sqlite.exec(`DELETE FROM ${name}`);writeCount=0;}
function snapshot(){return Object.fromEntries(sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map(({name})=>[name,sqlite.prepare(`SELECT * FROM ${name} ORDER BY rowid`).all()]));}
async function seed(){
  await reset();await d.importBank(structuredClone(fixture));const rows=await d.getQuestions(),sid=await d.createSession('sequential',{nodeIds:[rows[0].node_id]},rows.map(r=>r.id));
  await d.addAttempt(rows[0].id,sid,['B'],'auto',false);await d.updateQuestionContent(rows[0].id,{...JSON.parse(rows[0].content_json),answer:'B'});await d.addAttempt(rows[0].id,sid,['B'],'auto',true);await d.addAttempt(rows[1].id,sid,['B'],'auto',false);
  const review=await d.buildCurrentWrongReview(),jid=await b.createBatchJob(review,'synthetic-model');
  const job=await b.getBatchJob(jid),batches=b.jobBatches(job);const candidate=structuredClone(fixture);candidate.questions.forEach((q,i)=>{q.id=`candidate-${i}`;q.stem=`变式 ${i}`;});batches[0].status='ready';batches[0].banks[batches[0].sourceKeys[0]]=candidate;await b.saveBatchJob(job,batches);
  const gid=await b.saveReadyBatchCandidates(jid),group=await t.getTempGroup(gid);await t.saveTempProgress(group,1,t.emptyTempState(),[{questionId:'candidate-0',answer:['B'],correct:false,grading:'auto'}]);
  await d.saveReview(rows[1].id,['answer'],'合成审核');await d.toggleKilled(rows[0].id);await d.toggleFavorite(rows[0].id);await d.saveNote(rows[0].id,'合成笔记');await d.saveSession(sid,1,{selection:['A'],excludedOptions:['B'],quickMode:false,blankValue:'草稿'});
  await adapter.execute("UPDATE sqlite_sequence SET seq=100 WHERE name='attempts'");await adapter.execute("UPDATE sqlite_sequence SET seq=70 WHERE name='question_answer_revisions'");
  const storage=new MemoryStorage();storage.setItem('api-config','synthetic-key-must-not-export');storage.setItem(f.preferenceKeys[0],JSON.stringify([rows[0].node_id]));storage.setItem(f.preferenceKeys[1],'["single_choice","blank"]');storage.setItem(f.preferenceKeys[2],JSON.stringify([{id:'preset-1',name:'合成预设',ranges:[{nodeId:rows[0].node_id,includeDescendants:true}],types:['single_choice'],mode:'sequential',createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()}]));storage.setItem(f.preferenceKeys[3],'preset-1');return {storage,rows,sid};
}
if(hasBackup){
  await check('F08 complete snapshot roundtrip, preferences, revisions and ID high watermarks',async()=>{
    const {storage}=await seed(),file=await backup.buildBackup(storage),stats=await d.stats();assert(!JSON.stringify(file).includes('synthetic-key-must-not-export'));assert(Object.values(file.counts).every(n=>n>0));
    await reset();const targetStorage=new MemoryStorage();targetStorage.setItem('api-config','target-key-is-preserved');const prepared=await backup.prepareRestore(JSON.parse(JSON.stringify(file)),targetStorage);assert.equal(copies.size,1);assert.equal(snapshot().banks.length,0);await backup.restorePrepared(prepared,targetStorage);
    const restored=await backup.buildBackup(targetStorage);assert.deepEqual(restored.tables,file.tables);assert.deepEqual(restored.preferences,file.preferences);assert.deepEqual(restored.sequences,file.sequences);assert.deepEqual(await d.stats(),stats);assert.equal(targetStorage.getItem('api-config'),'target-key-is-preserved');
    const q=restored.tables.questions[0];await d.addAttempt(q.id,String(restored.tables.sessions[0].id),['B'],'auto',true);assert.equal((await adapter.select('SELECT MAX(id) n FROM attempts'))[0].n,101);
  });
  await check('F08 missing references, duplicate keys, invalid progress and lowered sequences are rejected',async()=>{
    const {storage}=await seed(),file=await backup.buildBackup(storage);
    const mutations=[x=>x.tables.questions[0].node_id='missing',x=>{x.tables.banks.push({...x.tables.banks[0]});x.counts.banks++;},x=>x.tables.sessions[0].current_index=99,x=>x.sequences.attempts=0,x=>x.tables.ai_review_groups[0].results_json=JSON.stringify([{questionId:'missing',answer:[],correct:true,grading:'auto'}]),x=>x.preferences[f.preferenceKeys[1]]='["bad"]'];
    for(const mutate of mutations){const bad=structuredClone(file);mutate(bad);await sign(bad);await assert.rejects(()=>v.validateBackup(bad));}
  });
  await check('F08 every database restore write failure restores previous SQLite and preferences',async()=>{
    let {storage}=await seed();const target=await backup.buildBackup(storage);await reset();storage=new MemoryStorage();let prepared=await backup.prepareRestore(target,storage);writeCount=0;await backup.restorePrepared(prepared,storage);const count=writeCount-1;
    for(let n=1;n<=count;n++){
      await reset();await d.importBank({...structuredClone(fixture),import:{mode:'new',bankId:'existing',bankTitle:'原有库'}});storage=new MemoryStorage();storage.setItem(f.preferenceKeys[1],'["blank"]');const previous=snapshot(),preferences=[...storage.values];prepared=await backup.prepareRestore(target,storage);writeCount=0;faultAt=n;await assert.rejects(()=>backup.restorePrepared(prepared,storage));faultAt=0;assert.deepEqual(snapshot(),previous,`partial restore at write ${n}`);assert.deepEqual([...storage.values],preferences,`preference change at write ${n}`);
    }return {writeFaults:count};
  });
  await check('F08 localStorage failure and safety-copy failure never replace current data',async()=>{
    const {storage}=await seed(),target=await backup.buildBackup(storage);await reset();const previous=snapshot(),local=new MemoryStorage();local.setItem(f.preferenceKeys[1],'["blank"]');let prepared=await backup.prepareRestore(target,local);local.count=0;local.failure=2;await assert.rejects(()=>backup.restorePrepared(prepared,local));local.failure=0;assert.deepEqual(snapshot(),previous);assert.equal(local.getItem(f.preferenceKeys[1]),'["blank"]');
    const saved=globalThis.__safety;globalThis.__safety=async()=>{throw Error('Disk full');};await assert.rejects(()=>backup.prepareRestore(target,local));globalThis.__safety=saved;assert.deepEqual(snapshot(),previous);
  });
  await check('F08 interruption journals recover old preferences before commit and target after commit',async()=>{
    await reset();const old=Object.fromEntries(f.preferenceKeys.map(k=>[k,null])),target={...old,[f.preferenceKeys[1]]:'["blank"]'},storage=new MemoryStorage();
    for(const committed of [0,1]){storage.setItem(f.preferenceKeys[1],'["single_choice"]');await adapter.execute('INSERT INTO backup_preference_journal VALUES(1,$1,$2,$3)',[JSON.stringify(old),JSON.stringify(target),committed]);assert.equal(await backup.recoverPreferenceRestore(storage),!!committed);assert.equal(storage.getItem(f.preferenceKeys[1]),committed?'["blank"]':null);assert.equal((await adapter.select('SELECT * FROM backup_preference_journal')).length,0);}
  });
  await check('F08 committed restore survives final journal cleanup failure and retry',async()=>{
    const {storage}=await seed(),target=await backup.buildBackup(storage);await reset();const local=new MemoryStorage(),prepared=await backup.prepareRestore(target,local);
    writeCount=0;faultAt=Object.values(target.counts).reduce((a,n)=>a+n,0)+18;await assert.rejects(()=>backup.restorePrepared(prepared,local),/Injected/);faultAt=0;
    assert.equal((await adapter.select('SELECT committed FROM backup_preference_journal'))[0].committed,1);assert.equal(snapshot().questions.length,target.counts.questions);
    assert.equal(await backup.recoverPreferenceRestore(local),true);const result=await backup.buildBackup(local);assert.deepEqual(result.tables,target.tables);assert.deepEqual(result.preferences,target.preferences);
  });
  await check('F08 changed local data after safety copy rejects stale restore',async()=>{
    const {storage,rows}=await seed(),target=await backup.buildBackup(storage),prepared=await backup.prepareRestore(target,storage);await d.saveNote(rows[0].id,'更新后的本地笔记');const previous=snapshot();await assert.rejects(()=>backup.restorePrepared(prepared,storage),/changed/);assert.deepEqual(snapshot(),previous);
  });
}
if(d.prepareBankImport)await check('U03 preview counts match execution; stale preview cannot overwrite a local edit',async()=>{
  await reset();await d.importBank(structuredClone(fixture));const rows=await d.getQuestions(),merge=structuredClone(fixture);merge.import.mode='merge';merge.questions=[{...merge.questions[0],answer:'B',stem:'覆盖内容'},{...merge.questions[1],id:'new-question'}];writeCount=0;const before=snapshot(),preview=await d.prepareBankImport(merge);assert.equal(writeCount,0);assert.deepEqual(snapshot(),before);assert.deepEqual([preview.summary.added,preview.summary.changed,preview.summary.unchanged,preview.summary.omitted,preview.summary.answerChanges],[1,1,0,1,1]);await d.applyBankImport(preview);assert.equal((await d.getQuestions()).length,3);
  const stale=await d.prepareBankImport(merge);await d.updateQuestionContent(rows[0].id,{...JSON.parse((await d.getQuestions([rows[0].id]))[0].content_json),stem:'新的本地编辑'});const edited=snapshot();await assert.rejects(()=>d.applyBankImport(stale),/changed/);assert.deepEqual(snapshot(),edited);
});
if(process.argv.includes('--ui')){
  const require=createRequire(import.meta.url),{chromium}=require(process.env.PLAYWRIGHT_MODULE_PATH||'playwright');
  const frontend=await build({entryPoints:['src/main.ts'],bundle:true,platform:'browser',write:false,loader:{'.css':'empty'},plugins:[plugin(true)],logLevel:'silent'});
  const server=createServer((req,res)=>{res.setHeader('Content-Type','text/html; charset=utf-8');res.end(`<div id="app"></div><script>${frontend.outputFiles[0].text.replaceAll('</script>','<\\/script>')}</script>`);});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const browser=await chromium.launch({headless:true,...(process.env.CHROME_PATH?{executablePath:process.env.CHROME_PATH}:{})});const context=await browser.newContext();await context.addInitScript(()=>history.replaceState({view:'home'},''));
  await context.exposeBinding('__sql',(_,op,s,p)=>adapter[op](s,p));await context.exposeBinding('__atomic',(_,steps)=>adapter.atomic(steps));await context.exposeBinding('__safety',(_,data)=>globalThis.__safety(data));
  await context.exposeBinding('__copies',(_,command,args)=>command==='list_restore_safety_copies'?[...copies].map(([name,data])=>({name,bytes:Buffer.byteLength(data)})).reverse():copies.get(args.name));
  const page=await context.newPage();page.setDefaultTimeout(8000);const errors=[];page.on('pageerror',e=>errors.push(e.message));
  try{
    await check('U03 selecting/cancelling a merge never writes before explicit confirmation',async()=>{
      await reset();await d.importBank(structuredClone(fixture));await page.goto(`http://127.0.0.1:${server.address().port}/`);await page.locator('.home-main').waitFor();await page.evaluate(()=>window.__ui.navigate({view:'import'}));
      const before=snapshot(),merge=structuredClone(fixture);merge.import.mode='merge';merge.questions[0].stem='覆盖本地编辑';merge.questions[1].id='q-new';
      await page.locator('#file').setInputFiles({name:'merge.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(merge))});await delay(150);assert.deepEqual(snapshot(),before,'file selection silently overwrote local content');
      await page.locator('[data-action^="confirm-import:"]').waitFor();assert.match(await page.locator('#import-previews').innerText(),/新增 1.*覆盖 1/);await page.locator('[data-action^="cancel-import:"]').click();assert.deepEqual(snapshot(),before);
      await page.locator('#file').setInputFiles({name:'merge.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(merge))});await page.locator('[data-action^="confirm-import:"]').click();await page.getByText(/已成功导入/).waitFor();assert.equal((await d.getQuestions()).length,3);assert.equal(JSON.parse((await d.getQuestions())[0].content_json).stem,'覆盖本地编辑');
    });
    if(!baseline){
      const home=async()=>{await page.evaluate(()=>localStorage.clear());await page.goto(`http://127.0.0.1:${server.address().port}/`);await page.locator('.home-main').waitFor();};
      const chooseBackup=async target=>{await page.evaluate(()=>window.__ui.navigate({view:'backup'}));await page.locator('#backup-file').setInputFiles({name:'backup.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(target))});await page.locator('[data-action="backup-prepare"]').waitFor();};
      await check('U03 bundle child errors coexist with independently confirmed successes',async()=>{
        await reset();await home();await page.evaluate(()=>window.__ui.navigate({view:'import'}));const invalid=structuredClone(fixture);invalid.import.bankId='invalid';invalid.questions[0].options='bad';
        await page.locator('#file').setInputFiles({name:'partial-bundle.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify({format:'knoop-bundle',version:'1.0',exportedAt:new Date().toISOString(),banks:[fixture,invalid,null]}))});
        await page.locator('[data-action^="confirm-import:"]').waitFor();assert.equal(await page.locator('[data-action^="confirm-import:"]').count(),1);assert.equal((await d.getBanks()).length,0);assert.match(await page.locator('#import-previews').innerText(),/第 2 个题库[\s\S]*options/);
        await page.locator('[data-action^="confirm-import:"]').click();await page.getByText(/已成功导入/).waitFor();assert.equal((await d.getBanks()).length,1);assert.equal(await page.locator('#import-previews .message.error').count(),2);
      });
      await check('F08 backup UI export, two-stage confirmation, cancellation and safety archive reload',async()=>{
        const {storage}=await seed(),target=await backup.buildBackup(storage);await reset();await home();const before=snapshot();await chooseBackup(target);assert.deepEqual(snapshot(),before);
        await page.locator('[data-action="backup-cancel"]').click();assert.deepEqual(snapshot(),before);await chooseBackup(target);const priorCopies=copies.size;
        await page.locator('[data-action="backup-prepare"]').click();await page.locator('[data-action="backup-confirm"]').waitFor();assert.equal(copies.size,priorCopies+1);assert.deepEqual(snapshot(),before);
        page.once('dialog',dialog=>dialog.dismiss());await page.locator('[data-action="backup-confirm"]').click();assert.deepEqual(snapshot(),before);
        page.once('dialog',dialog=>dialog.accept());await page.locator('[data-action="backup-confirm"]').click();await page.locator('.home-main').waitFor();assert.equal(snapshot().attempts.length,target.counts.attempts);
        const preferences=await page.evaluate(keys=>Object.fromEntries(keys.map(k=>[k,localStorage.getItem(k)])),f.preferenceKeys);assert.deepEqual(preferences,target.preferences);
        await page.evaluate(()=>window.__ui.navigate({view:'backup'}));const downloadPromise=page.waitForEvent('download');await page.locator('[data-action="backup-export"]').click();const download=await downloadPromise;const exported=await v.validateBackup(JSON.parse(await readFile(await download.path(),'utf8')));assert.deepEqual(exported.tables,target.tables);
        await page.locator('details summary').click();await page.locator('[data-action^="backup-load:"]').first().click();await page.locator('[data-action="backup-prepare"]').waitFor();assert.match(await page.locator('#app').innerText(),/题库 0 · 内容 0/);assert.equal(snapshot().attempts.length,target.counts.attempts);
      });
      await check('F08 invalid selected backup and restore transaction failure preserve current data',async()=>{
        const {storage}=await seed(),target=await backup.buildBackup(storage);await reset();await home();await page.evaluate(()=>window.__ui.navigate({view:'backup'}));const before=snapshot(),bad=structuredClone(target);bad.tables.banks[0].title='tampered';
        await page.locator('#backup-file').setInputFiles({name:'bad.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(bad))});await page.getByText(/SHA-256/).waitFor();assert.equal(await page.locator('[data-action="backup-prepare"]').count(),0);assert.deepEqual(snapshot(),before);
        await chooseBackup(target);await page.locator('[data-action="backup-prepare"]').click();await page.locator('[data-action="backup-confirm"]').waitFor();writeCount=0;faultAt=5;page.once('dialog',dialog=>dialog.accept());await page.locator('[data-action="backup-confirm"]').click();await page.locator('#backup-message').filter({hasText:'Injected'}).waitFor();faultAt=0;assert.deepEqual(snapshot(),before);assert.equal(await page.locator('[data-action="backup-confirm"]').count(),0);
      });
      await check('F08 committed cleanup failure blocks navigation until preferences recover',async()=>{
        const {storage}=await seed(),target=await backup.buildBackup(storage);await reset();await home();await chooseBackup(target);await page.locator('[data-action="backup-prepare"]').click();await page.locator('[data-action="backup-confirm"]').waitFor();
        writeCount=0;faultAt=Object.values(target.counts).reduce((a,n)=>a+n,0)+18;page.once('dialog',dialog=>dialog.accept());await page.locator('[data-action="backup-confirm"]').click();await page.locator('[data-action="backup-sync"]').waitFor();faultAt=0;assert.equal(await page.locator('[data-action="home"]').count(),0);assert.equal(snapshot().questions.length,target.counts.questions);
        await page.evaluate(()=>{history.pushState({view:'import'},'');dispatchEvent(new PopStateEvent('popstate',{state:{view:'import'}}));});await page.locator('[data-action="backup-sync"]').waitFor();assert.equal(await page.locator('#file').count(),0);
        await page.locator('[data-action="backup-sync"]').click();await page.locator('.home-main').waitFor();assert.equal(snapshot().backup_preference_journal.length,0);assert.deepEqual(await page.evaluate(keys=>Object.fromEntries(keys.map(k=>[k,localStorage.getItem(k)])),f.preferenceKeys),target.preferences);
      });
      await check('F08 startup recovers interrupted preference journal before showing learning views',async()=>{
        await reset();await home();const preferences=Object.fromEntries(f.preferenceKeys.map(k=>[k,k===f.preferenceKeys[1]?'["blank"]':null]));await adapter.execute('INSERT INTO backup_preference_journal VALUES(1,$1,$2,1)',[JSON.stringify(Object.fromEntries(f.preferenceKeys.map(k=>[k,null]))),JSON.stringify(preferences)]);
        await page.reload();await page.locator('.home-main').waitFor();assert.equal(snapshot().backup_preference_journal.length,0);assert.equal(await page.evaluate(()=>localStorage.getItem('knoop.enabledBrushTypes.v1')),'["blank"]');
      });
      await check('C browser has no uncaught runtime errors',async()=>assert.deepEqual(errors,[]));
    }
  }finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
}
await mkdir('artifacts/review-c',{recursive:true});await writeFile(`artifacts/review-c/${baseline?'baseline':'regression'}${process.argv.includes('--ui')?'-ui':''}.json`,JSON.stringify(results,null,2));
sqlite.close();delete globalThis.__knoopC;if(results.some(r=>r.status==='FAIL')&&!baseline)process.exitCode=1;
