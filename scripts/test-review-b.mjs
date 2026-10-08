import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { build } from 'esbuild';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { setTimeout as delay } from 'node:timers/promises';

const baseline = process.argv.includes('--baseline');
const ui = process.argv.includes('--ui');
const source = path => baseline ? Promise.resolve(execFileSync('git', ['-c', `safe.directory=${process.cwd().replaceAll('\\','/')}`, 'show', `cf4305a:${path}`], {encoding:'utf8'})) : readFile(path,'utf8');
const sqlite = new DatabaseSync(':memory:');
let faultAt = 0, writeCount = 0, pause = null;
const bind = params => Object.fromEntries(params.map((p,i)=>[`$${i+1}`,p]));
const adapter = {
  async execute(sql, params=[]) {
    if(pause)await pause(sql,params);
    if(faultAt && ++writeCount === faultAt)throw Error('Injected write failure');
    const r=sqlite.prepare(sql).run(...(params.length?[bind(params)]:[]));
    return {rowsAffected:Number(r.changes),lastInsertId:Number(r.lastInsertRowid)};
  },
  async select(sql,params=[]) {return sqlite.prepare(sql).all(...(params.length?[bind(params)]:[])).map(r=>({...r}));},
  async atomic(steps) {
    sqlite.exec('BEGIN');
    try {
      for(const step of steps) {
        if(step.expectedRows !== undefined) assert.deepEqual(await adapter.select(step.sql,step.params),step.expectedRows,'Atomic precondition changed');
        else {
          const result=await adapter.execute(step.sql,step.params);
          if(step.affectedRows !== undefined)assert.equal(result.rowsAffected,step.affectedRows,'Atomic update conflict');
        }
      }
      sqlite.exec('COMMIT');
    } catch(error){sqlite.exec('ROLLBACK');throw error;}
  }
};
globalThis.__knoopB=adapter;
const plugin = browser => ({name:'isolated-sqlite',setup(b) {
  b.onResolve({filter:/^@tauri-apps\/plugin-sql$/},()=>({path:'sql',namespace:'mock'}));
  b.onResolve({filter:/^@tauri-apps\/api\/core$/},()=>({path:'core',namespace:'mock'}));
  b.onLoad({filter:/.*/,namespace:'mock'},args=>({loader:'js',contents:args.path==='sql'
    ? `export default {load:async()=>${browser?'({execute:(s,p)=>window.__sql("execute",s,p),select:(s,p)=>window.__sql("select",s,p)})':'globalThis.__knoopB'}};`
    : `export async function invoke(command,args){if(command!=="atomic_write")throw Error("Native API forbidden");return ${browser?'window.__atomic(args.steps)':'globalThis.__knoopB.atomic(args.steps)'};}`}));
  b.onLoad({filter:/[\\/]src[\\/](main|db|temp-review|batch-review)\.ts$/},async args=>{
    const path=`src/${args.path.split(/[\\/]/).at(-1)}`;
    return {loader:'ts',contents:await source(path)+(path==='src/main.ts'? '\nwindow.__ui={navigate,submit,next,persistDraft,tempAnswer,saveReadyBatches,getState:()=>({index:activeSession?.current_index,blankValue,...pageState})};':'')};
  });
}});
const bundle = await build({stdin:{contents:'export * as d from "./src/db"; export * as t from "./src/temp-review"; export * as b from "./src/batch-review";',loader:'ts',resolveDir:process.cwd()},bundle:true,platform:'node',format:'cjs',write:false,plugins:[plugin(false)],logLevel:'silent'});
const module={exports:{}};new Function('module','exports',bundle.outputFiles[0].text)(module,module.exports);
const {d,t,b}=module.exports;
const fixture={format:'knoop-bank',version:'1.1',import:{mode:'new',bankId:'b-test',bankTitle:'合成测试'},nodes:[{id:'n',parentId:null,title:'范围',order:0}],questions:['q1','q2','q3'].map((id,i)=>({id,nodeId:'n',type:'single_choice',order:i,stem:`题目 ${i}`,options:[{id:'A',text:'甲'},{id:'B',text:'乙'}],answer:'A'}))};
await d.db();
async function reset(){faultAt=0;pause=null;for(const {name} of sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all())sqlite.exec(`DELETE FROM ${name}`);writeCount=0;}
async function seed(){await reset();await d.importBank(structuredClone(fixture));const rows=await d.getQuestions();const sid=await d.createSession('sequential',{},rows.map(q=>q.id));await d.addAttempt(rows[0].id,sid,['B'],'auto',false);await d.saveNote(rows[0].id,'合成笔记');await d.toggleFavorite(rows[0].id);await d.saveReview(rows[0].id,['answer'],'合成审核');return {rows,sid};}
function snapshot(){return Object.fromEntries(sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table' AND (name NOT LIKE 'sqlite_%' OR name='sqlite_sequence') ORDER BY name").all().map(({name})=>[name,sqlite.prepare(`SELECT * FROM ${name} ORDER BY rowid`).all()]));}
const results=[];
async function check(id,fn){try{const evidence=await fn();results.push({id,status:'PASS',...evidence});console.log('PASS '+id+(evidence?` ${JSON.stringify(evidence)}`:''));}catch(e){results.push({id,status:'FAIL',reason:e.message});console.log('FAIL '+id+': '+e.message.split('\n').slice(0,4).join('\n'));}}
const operations=[
    ['new import',async()=>{await reset();return ()=>d.importBank(structuredClone(fixture));}],
    ['merge repair',async()=>{await seed();const merge=structuredClone(fixture);merge.import.mode='merge';merge.questions[0].answer='B';return ()=>d.importBank(merge);}],
    ['delete bank',async()=>{await seed();return ()=>d.deleteBank('b-test');}],
    ['complete repair',async()=>{const {rows}=await seed();return ()=>d.completeReview(rows[0].id);}],
    ['mark review',async()=>{const {rows}=await seed();return ()=>d.saveReview(rows[1].id,['answer'],'审核');}],
    ['cancel review',async()=>{const {rows}=await seed();return ()=>d.cancelReview(rows[0].id);}],
    ['edit answer',async()=>{const {rows}=await seed();return ()=>d.updateQuestionContent(rows[1].id,{...JSON.parse(rows[1].content_json),answer:'B'});}]
];
for(const [name,setup] of operations)await check(`F02 ${name}: every write failure rolls back complete SQLite snapshot`,async()=>{
    let operation=await setup();writeCount=0;faultAt=9999;await operation();const count=writeCount;faultAt=0;
    for(let n=1;n<=count;n++){operation=await setup();const before=snapshot();writeCount=0;faultAt=n;await assert.rejects(operation);faultAt=0;assert.deepEqual(snapshot(),before,`partial data at write ${n}`);}
    return {writeFaults:count};
});
await check('F02 normal merge preserves omitted questions and review pre-kill restoration',async()=>{
  const {rows}=await seed();let merge=structuredClone(fixture);merge.import.mode='merge';merge.questions=[{...merge.questions[0],answer:'B'}];await d.importBank(merge);assert.equal((await d.getQuestions()).length,3);assert.equal(await d.isReviewed(rows[0].id),false);assert.equal(await d.isKilled(rows[0].id),false);
  await d.toggleKilled(rows[1].id);await d.saveReview(rows[1].id,['answer'],'检查');await d.completeReview(rows[1].id);assert.equal(await d.isKilled(rows[1].id),true);
  if(!baseline){assert.equal((await adapter.select('SELECT * FROM attempts')).length,1);assert.equal((await d.wrongQuestions()).length,0);}
});
await check('F06 explanation-only edit and reordered multiple answers keep current wrong; repeated revisions retain history',async()=>{
  await reset();const bank=structuredClone(fixture);bank.questions[0]={...bank.questions[0],type:'multiple_choice',answer:['A','B']};await d.importBank(bank);const row=(await d.getQuestions())[0],sid=await d.createSession('sequential',{},[row.id]);await d.addAttempt(row.id,sid,['A'],'auto',false);
  await d.updateQuestionContent(row.id,{...JSON.parse(row.content_json),answer:['B','A'],explanation:'仅解析修改'});assert.equal((await d.wrongQuestions()).length,1);
  const changed={...JSON.parse(row.content_json),answer:['A']};await d.updateQuestionContent(row.id,changed);assert.equal((await d.wrongQuestions()).length,0);await d.addAttempt(row.id,sid,['B'],'auto',false);assert.equal((await d.wrongQuestions()).length,1);
  await d.updateQuestionContent(row.id,{...changed,answer:['A','B']});assert.equal((await d.wrongQuestions()).length,0);assert.equal((await adapter.select('SELECT * FROM attempts')).length,2);
});
await check('F06 changed answer retires old current wrong but preserves historical grading and revision snapshot',async()=>{
  for(const path of ['edit','merge']){await reset();await d.importBank(structuredClone(fixture));const row=(await d.getQuestions())[0];const sid=await d.createSession('sequential',{},[row.id]);await d.addAttempt(row.id,sid,['B'],'auto',false);const before=await d.stats();const updated={...JSON.parse(row.content_json),answer:'B'};
    if(path==='edit')await d.updateQuestionContent(row.id,updated);else {const merge=structuredClone(fixture);merge.import.mode='merge';merge.questions=[updated];await d.importBank(merge);}
    assert.equal((await d.wrongQuestions()).length,0);assert.equal((await d.buildCurrentWrongReview()).items.length,0);assert.equal((await d.stats()).currentWrong,0);assert.equal((await d.stats()).wrong,before.wrong);assert.equal((await adapter.select('SELECT * FROM attempts')).length,1);
    const revisions=await adapter.select('SELECT * FROM question_answer_revisions');assert.equal(JSON.parse(revisions[0].previous_content_json).answer,'A');
    await d.addAttempt(row.id,sid,['B'],'auto',true);assert.equal((await d.stats()).total,2);assert.equal((await d.stats()).correct,1);
  }
});
if(!baseline)await check('F07 concurrent save conflict can retry without a duplicate group',async()=>{
  const id=await readyJob();const saved=await Promise.allSettled([b.saveReadyBatchCandidates(id),b.saveReadyBatchCandidates(id)]);assert(saved.some(result=>result.status==='fulfilled'));const gid=await b.saveReadyBatchCandidates(id);assert.equal((await t.listTempGroups()).length,1);assert.equal(b.jobBatches(await b.getBatchJob(id))[0].savedGroupId,gid);
});
async function readyJob(){await reset();const review={format:'knoop-error-review',version:'1.1',exportedAt:new Date().toISOString(),scope:{type:'current_wrong_questions'},items:[{bank:{id:'bank',title:'测试'},node:{id:'n',title:'节点',path:[]},question:fixture.questions[0],error:{}}]};const id=await b.createBatchJob(review,'test-model');const job=await b.getBatchJob(id),batches=b.jobBatches(job);batches[0].status='ready';batches[0].banks[batches[0].sourceKeys[0]]={...structuredClone(fixture),questions:fixture.questions.slice(0,2).map((q,i)=>({...q,id:`candidate${i}`,nodeId:'review',stem:`变式${i}`}))};await b.saveBatchJob(job,batches);return id;}
await check('F07 second write failure then retry saves exactly one group and links ready job',async()=>{
  const id=await readyJob();
  if(b.saveReadyBatchCandidates){writeCount=0;faultAt=2;await assert.rejects(()=>b.saveReadyBatchCandidates(id));faultAt=0;assert.equal((await t.listTempGroups()).length,0);const gid=await b.saveReadyBatchCandidates(id);assert.equal(await b.saveReadyBatchCandidates(id),gid);assert.equal((await t.listTempGroups()).length,1);assert.equal(b.jobBatches(await b.getBatchJob(id))[0].savedGroupId,gid);}
  else {const job=await b.getBatchJob(id),batches=b.jobBatches(job);const save=async()=>{const {bank,metadata,batchIndexes}=b.collectReadyCandidates(job,batches);const gid=await t.createTempGroupWithMetadata(bank,'batch','测试',job.model,new Date().toISOString(),metadata);batchIndexes.forEach(i=>batches[i].savedGroupId=gid);await b.saveBatchJob(job,batches);};writeCount=0;faultAt=2;await assert.rejects(save);faultAt=0;assert.equal((await t.listTempGroups()).length,0,'orphan group after job write failure');}
});

if(ui){
  const require=createRequire(import.meta.url),{chromium}=require(process.env.PLAYWRIGHT_MODULE_PATH||'playwright');
  const frontend=await build({entryPoints:['src/main.ts'],bundle:true,platform:'browser',write:false,loader:{'.css':'empty'},plugins:[plugin(true)],logLevel:'silent'});
  const browser=await chromium.launch({headless:true,...(process.env.CHROME_PATH?{executablePath:process.env.CHROME_PATH}:{})});
  const server=createServer((req,res)=>{res.setHeader('Content-Type','text/html; charset=utf-8');res.end(`<div id="app"></div><script>${frontend.outputFiles[0].text.replaceAll('</script>','<\\/script>')}</script>`);});await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const context=await browser.newContext();await context.addInitScript(()=>history.replaceState({view:'home'},''));
  await context.exposeBinding('__sql',(_,op,s,p)=>adapter[op](s,p));await context.exposeBinding('__atomic',(_,steps)=>adapter.atomic(steps));const page=await context.newPage();page.setDefaultTimeout(8000);const errors=[];page.on('pageerror',e=>errors.push(e.message));
  async function fresh(bank=fixture){await reset();await d.importBank(structuredClone(bank));await page.goto(`http://127.0.0.1:${server.address().port}/`);await page.locator('.home-main').waitFor();}
  async function route(r){await page.evaluate(r=>window.__ui.navigate(r),r);}
  async function formal(type='single_choice',quick=false){const bank=structuredClone(fixture);if(type==='blank')bank.questions[0]={id:'q1',nodeId:'n',type:'blank',order:0,stem:'填空',answer:'最新'};await fresh(bank);const rows=await d.getQuestions();const sid=await d.createSession('sequential',{},rows.map(q=>q.id));await d.saveSession(sid,0,{quickMode:quick,selection:['A'],blankValue:'草稿'});await route({view:'session',id:sid});return sid;}
  try{
    await check('F03 formal repeated submit/next/quick click record once and advance once',async()=>{
      let sid=await formal();pause=async s=>{if(s.startsWith('INSERT INTO attempts'))await delay(70);};await page.evaluate(()=>Promise.all([window.__ui.submit(),window.__ui.submit()]));pause=null;assert.equal((await adapter.select('SELECT * FROM attempts')).length,1);await page.evaluate(()=>Promise.all([window.__ui.next(),window.__ui.next()]));assert.equal((await d.sessionById(sid)).current_index,1);
      sid=await formal('single_choice',true);pause=async s=>{if(s.startsWith('INSERT INTO attempts'))await delay(70);};await page.evaluate(()=>{const el=document.querySelector('[data-action="option:A"]');el.click();el.click();});await delay(300);pause=null;assert.equal((await adapter.select('SELECT * FROM attempts')).length,1);assert.equal((await d.sessionById(sid)).current_index,1);
    });
    await check('F03 submission/save failure rolls back attempt and UI recovers for retry',async()=>{
      const sid=await formal();writeCount=0;faultAt=2;await page.evaluate(()=>window.__ui.submit().catch(()=>{}));faultAt=0;assert.equal((await adapter.select('SELECT * FROM attempts')).length,0);assert.equal((await page.evaluate(()=>window.__ui.getState())).submitted||false,false);await page.evaluate(()=>window.__ui.submit());assert.equal((await adapter.select('SELECT * FROM attempts')).length,1);assert.equal(JSON.parse((await d.sessionById(sid)).state_json).submitted,true);
    });
    await check('F04 temp concurrent answers/next and restart recovery are consistent',async()=>{
      await fresh();const gid=await t.createTempGroup(structuredClone(fixture),'q1','源题','test-model',new Date().toISOString());let group=await t.getTempGroup(gid);await t.saveTempProgress(group,0,{...t.emptyTempState(),selection:['A']},[]);await route({view:'temp-session',id:gid});pause=async s=>{if(s.startsWith('UPDATE ai_review_groups'))await delay(50);};await page.evaluate(()=>Promise.all([window.__ui.tempAnswer(true,'auto'),window.__ui.tempAnswer(false,'auto')]));pause=null;group=await t.getTempGroup(gid);assert.equal(t.tempResults(group).length,1);assert.equal(t.tempResults(group)[0].correct,true,'second concurrent grading overwrote first accepted result');await page.evaluate(()=>{document.querySelector('[data-action="temp-next"]').click();document.querySelector('[data-action="temp-next"]').click();});await delay(300);assert.equal((await t.getTempGroup(gid)).current_index,1);await route({view:'home'});await route({view:'temp-session',id:gid});assert.match(await page.locator('h1').innerText(),/2 \/ 3/);
    });
    await check('F05 formal delayed old draft cannot overwrite new input or advanced question',async()=>{
      const sid=await formal();let first=true;pause=async(s,p)=>{if(s.startsWith('UPDATE sessions')&&first){first=false;await delay(100);}};await page.evaluate(()=>Promise.all([window.__ui.persistDraft(),window.__ui.next()]));pause=null;const session=await d.sessionById(sid);assert.equal(session.current_index,1);assert.equal(JSON.parse(session.state_json).submitted||false,false);await route({view:'home'});await route({view:'session',id:sid});assert.equal((await page.evaluate(()=>window.__ui.getState())).index,1);
    });
    await check('F05 pending long press cannot write an old draft after submission',async()=>{
      const sid=await formal();pause=async(s,p)=>{if(s.startsWith('INSERT INTO attempts'))await delay(600);if(s.startsWith('UPDATE sessions')&&typeof p[2]==='string'&&p[2].startsWith('{')&&!JSON.parse(p[2]).submitted)await delay(1000);};
      await page.evaluate(async()=>{document.querySelector('[data-action="option:B"]').dispatchEvent(new PointerEvent('pointerdown',{bubbles:true}));await window.__ui.submit();});await delay(1000);pause=null;assert.equal(JSON.parse((await d.sessionById(sid)).state_json).submitted,true);
    });
    await check('F05 temp rapid blank typing then submit/back keeps newest answer',async()=>{
      await fresh();const bank=structuredClone(fixture);bank.questions[0]={id:'fill',nodeId:'n',type:'blank',order:0,stem:'填空',answer:'最新'};const gid=await t.createTempGroup(bank,'源题','测试','test-model',new Date().toISOString());await route({view:'temp-session',id:gid});let first=true;pause=async s=>{if(s.startsWith('UPDATE ai_review_groups')&&first){first=false;await delay(300);}};await page.locator('#temp-blank').fill('旧');for(let i=0;first&&i<100;i++)await delay(2);assert.equal(first,false);await page.locator('#temp-blank').fill('最新');await page.locator('[data-action="temp-submit"]').click();await delay(550);pause=null;const group=await t.getTempGroup(gid);assert.equal(t.tempResults(group)[0]?.answer,'最新');assert.equal(t.tempState(group).submitted,true);await route({view:'home'});await route({view:'temp-session',id:gid});assert.equal(await page.locator('#temp-blank').inputValue(),'最新');
    });
    if(!baseline){
      await check('F03 quick advance failure keeps saved result and offers next retry',async()=>{
        const sid=await formal('single_choice',true);writeCount=0;faultAt=3;await page.locator('[data-action="option:A"]').click();await page.locator('[data-action="next"]').waitFor();faultAt=0;assert.equal((await adapter.select('SELECT * FROM attempts')).length,1);assert.equal((await d.sessionById(sid)).current_index,0);await page.locator('[data-action="next"]').click();await delay(100);assert.equal((await d.sessionById(sid)).current_index,1);assert.equal((await adapter.select('SELECT * FROM attempts')).length,1);
      });
      await check('F05 formal rapid blank typing/submission and immediate return recover newest input',async()=>{
        let sid=await formal('blank');let first=true;pause=async s=>{if(s.startsWith('UPDATE sessions')&&first){first=false;await delay(100);}};await page.locator('#blank').fill('旧');await page.locator('#blank').fill('最新');await page.locator('[data-action="submit"]').click();await page.locator('[data-action="next"]').waitFor();pause=null;assert.equal(JSON.parse((await adapter.select('SELECT * FROM attempts'))[0].user_answer),'最新');await route({view:'home'});await route({view:'session',id:sid});assert.equal(await page.locator('#blank').inputValue(),'最新');
        sid=await formal('blank');pause=async s=>{if(s.startsWith('UPDATE sessions'))await delay(60);};await page.locator('#blank').fill('返回草稿');await page.locator('[data-action="back"]').click();await page.locator('.home-main').waitFor();pause=null;await route({view:'session',id:sid});assert.equal(await page.locator('#blank').inputValue(),'返回草稿');
      });
      await check('F05 transient draft failure is recoverable before leaving; no unhandled browser errors',async()=>{
        const sid=await formal('blank');writeCount=0;faultAt=1;await page.locator('#blank').fill('可恢复草稿');await delay(100);faultAt=0;await route({view:'home'});await route({view:'session',id:sid});assert.equal(await page.locator('#blank').inputValue(),'可恢复草稿');assert.deepEqual(errors,[]);
      });
    }
  }finally{pause=null;await browser.close();await new Promise(r=>server.close(r));}
}
await mkdir('artifacts/review-b',{recursive:true});await writeFile(`artifacts/review-b/${baseline?'baseline':'regression'}${ui?'-ui':''}.json`,JSON.stringify(results,null,2));sqlite.close();delete globalThis.__knoopB;
if(results.some(r=>r.status==='FAIL')&&!baseline)process.exitCode=1;
