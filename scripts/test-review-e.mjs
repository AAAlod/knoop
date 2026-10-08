import assert from 'node:assert/strict';
import {setTimeout as delay} from 'node:timers/promises';
import {reviewHarness} from './review-test-harness.mjs';
const h=await reviewHarness({baselineRef:'c448e01',out:'artifacts/review-e'}),{d,t,b,check}=h,page=await h.ui();
const fixture=(count=4)=>({format:'knoop-bank',version:'1.1',import:{mode:'new',bankId:'review-e',bankTitle:'合成 AI 测试'},nodes:[{id:'n',parentId:null,title:'AI 测试范围',order:0}],questions:Array.from({length:count},(_,i)=>({id:`q${i}`,nodeId:'n',type:'single_choice',order:i,stem:`合成原题 ${i}`,options:[{id:'A',text:'甲'},{id:'B',text:'乙'}],answer:'A',explanation:'合成解析'}))});
let requests=[],configured=true,failFor=new Set(),pending=null;
const candidates=key=>({format:'knoop-bank',version:'1.1',import:{mode:'new',bankId:'knoop-ai-preview',bankTitle:'AI 临时回炉'},nodes:[{id:'review',parentId:null,title:'AI 回炉',order:0}],questions:[0,1].map(i=>({id:`candidate-${key}-${i}`,nodeId:'review',type:'single_choice',order:i,stem:`合成变式 ${key} ${i}`,options:[{id:'A',text:`变式 ${key} 甲`},{id:'B',text:`变式 ${key} 乙`}],answer:'A',explanation:'mock 生成，无真实 API 调用'}))});
h.setNative(async(command,args)=>{
  if(command==='atomic_write')return h.adapter.atomic(args.steps);if(command==='list_restore_safety_copies')return [];
  if(command==='get_ai_config_status')return {configured,model:'mock-model',baseUrl:'https://example.invalid'};
  if(command==='clear_ai_config'){configured=false;return;}
  if(command==='set_ai_config'){configured=true;return;}
  if(command==='cancel_ai_review'){if(pending){pending.reject(Error('AI 请求已取消'));pending=null;}return;}
  if(command==='generate_ai_review'){const id=args.input.review.items[0].question.id;requests.push(id);if(pending)return pending.promise;if(failFor.has(id))throw Error('AI 服务返回 HTTP 503');return JSON.stringify(candidates(`${id}-${requests.length}`));}
  throw Error('Unexpected native API');
});
const route=r=>page.evaluate(r=>window.__review.navigate(r),r);
async function dialogAction(action,accept){const event=page.waitForEvent('dialog'),click=page.locator(`[data-action="${action}"]`).click();const dialog=await event;await (accept?dialog.accept():dialog.dismiss());await click;await delay(60);}
async function seed(count=4){await h.reset();configured=true;requests=[];failFor.clear();pending=null;await d.importBank(fixture(count));const rows=await d.getQuestions(),sid=await d.createSession('sequential',{nodeIds:[rows[0].node_id]},rows.map(r=>r.id));for(const row of rows)await d.addAttempt(row.id,sid,['B'],'auto',false);await h.load();return rows;}
try{
  await check('A01 validated single candidate survives page restart without becoming a formal attempt',async()=>{
    const rows=await seed(),before=await d.stats();await route({view:'ai-review',questionId:rows[0].id});await page.locator('[data-action="ai-generate"]').click();await page.locator('[data-action="ai-save-group"]').waitFor();const title=await page.locator('.ai-preview').innerText();await h.load();await route({view:'ai-review',questionId:rows[0].id});assert.equal(await page.locator('[data-action="ai-save-group"]').count(),1);assert.equal(await page.locator('.ai-preview').innerText(),title);assert.deepEqual(await d.stats(),before);assert.equal((await t.listTempGroups()).length,0);
  });
  await check('A02 completed temporary group supports full review and wrong-only independent retry',async()=>{
    await seed();const bank=fixture(),gid=await t.createTempGroup(bank,'source','合成临时题组','mock-model',new Date().toISOString()),group=await t.getTempGroup(gid),results=bank.questions.map((q,i)=>({questionId:q.id,answer:[i%2?'A':'B'],correct:!!(i%2),grading:'auto'}));await t.saveTempProgress(group,4,t.emptyTempState(),results,true);const stats=await d.stats();await route({view:'temp-session',id:gid});assert.equal(await page.locator(`[data-action="temp-review:${gid}"]`).count(),1);await page.locator(`[data-action="temp-review:${gid}"]`).click();assert.equal(await page.locator('.temp-review-result').count(),4);await page.locator(`[data-action="temp-retry-wrong:${gid}"]`).click();await page.locator('.options').waitFor();const groups=await t.listTempGroups(),fresh=groups.find(g=>g.id!==gid);assert.equal(t.tempBank(fresh).questions.length,2);assert.deepEqual(t.tempBank(fresh).questions.map(q=>q.id),['q0','q2']);assert.equal(t.tempResults(await t.getTempGroup(gid)).length,4);assert.deepEqual(await d.stats(),stats);assert.equal(JSON.parse(fresh.question_meta_json).length,2);
  });
  await check('A03 select only 3 of 20 source questions before any paid call',async()=>{
    await seed(20);await route({view:'batch-review'});assert.equal(await page.locator('[data-batch-source]').count(),20);assert.equal(requests.length,0);await page.locator('[data-batch-source]').nth(1).check();await page.locator('[data-batch-source]').nth(5).check();await page.locator('[data-batch-source]').nth(19).check();assert.match(await page.locator('#batch-selection-summary').innerText(),/3 道原题.*6 道候选.*2 批/);await dialogAction('batch-create',false);assert.equal(requests.length,0);assert.equal(await b.latestBatchJob(),null);
    const selected=await page.locator('[data-batch-source]:checked').evaluateAll(inputs=>inputs.map(input=>JSON.parse(input.dataset.batchSource)[1]));await dialogAction('batch-create',true);await page.waitForFunction(()=>document.querySelector('header h1')?.textContent==='批量 AI 回炉'&&!!document.querySelector('[data-action="batch-save-ready"]'));assert.equal(b.jobReview(await b.latestBatchJob()).items.length,3);assert.deepEqual([...requests].sort(),selected.sort());
  });
  await check('A04 cancellation and retries disclose billing and preserve successful source results',async()=>{
    await seed();await route({view:'batch-review'});assert.match(await page.locator('#app').innerText(),/不能保证.*不计费/);if(await page.locator('[data-action="batch-select-first"]').count())await page.locator('[data-action="batch-select-first"]').click();const order=await page.locator('[data-batch-source]:checked').evaluateAll(inputs=>inputs.map(input=>JSON.parse(input.dataset.batchSource)[1]));failFor.add(order[1]);await dialogAction('batch-create',true);await page.locator('[data-action="batch-retry:0"]').waitFor();const successCount=requests.filter(id=>id===order[0]).length,job=await b.latestBatchJob();assert.equal(Object.keys(b.jobBatches(job)[0].banks).length,1);
    const before=requests.length;await dialogAction('batch-retry:0',false);assert.equal(requests.length,before);failFor.clear();await dialogAction('batch-retry:0',true);await page.locator('[data-action="batch-save-ready"]').waitFor();assert.equal(requests.filter(id=>id===order[0]).length,successCount);
  });
  await check('A05 clear API config remains clear after restart and synthetic failure does not change learning data',async()=>{
    const rows=await seed();await route({view:'ai-review',questionId:rows[0].id});failFor.add('q0');const before=await d.stats();await page.locator('[data-action="ai-generate"]').click();await page.getByText(/AI 服务返回 HTTP 503/).waitFor();assert.deepEqual(await d.stats(),before);assert.equal((await t.listTempGroups()).length,0);await page.locator('.ai-settings summary').click();await page.locator('[data-action="ai-clear-config"]').click();await page.getByText('保存 API Key',{exact:true}).waitFor();await h.load();await route({view:'ai-review',questionId:rows[0].id});assert.equal(await page.locator('[data-action="ai-clear-config"]').count(),0);assert.equal(await page.locator('#ai-api-key').inputValue(),'');
  });
  if(!h.baseline){
    await check('A01 draft save failure can retry without a second paid generation',async()=>{
      const rows=await seed();await route({view:'ai-review',questionId:rows[0].id});h.setFault(1);await page.locator('[data-action="ai-generate"]').click();await page.getByText(/保存失败/).waitFor();assert.equal(await page.locator('[data-action="ai-retry-persist"]').count(),1);h.setFault(0);await page.locator('[data-action="ai-retry-persist"]').click();await page.locator('[data-action="ai-save-group"]').waitFor();assert.equal(requests.length,1);assert.equal((await h.a.listAiDrafts()).length,1);
    });
    await check('A01 draft-to-group transaction rolls back either write and preserves deleted source snapshots',async()=>{
      const rows=await seed();let draft=await h.a.saveAiDraft(rows[0].id,fixture().questions[0],candidates('transaction'),'mock-model',new Date().toISOString());
      for(const n of [1,2]){h.setFault(n);await assert.rejects(()=>h.a.saveAiDraftToGroup(draft.id));h.setFault(0);assert.equal((await h.a.listAiDrafts()).length,1);assert.equal((await t.listTempGroups()).length,0);}
      await d.deleteBank('review-e');const gid=await h.a.saveAiDraftToGroup(draft.id);assert(gid);assert.equal((await h.a.listAiDrafts()).length,0);assert.equal(await h.a.saveAiDraftToGroup(draft.id),null);assert.equal((await d.getQuestions()).length,0);assert.equal((await t.listTempGroups()).length,1);
    });
    await check('A04 double generation sends once; cancellation leaves formal records unchanged',async()=>{
      const rows=await seed(),before=await d.stats();pending={};pending.promise=new Promise((resolve,reject)=>{pending.resolve=resolve;pending.reject=reject;});await route({view:'ai-review',questionId:rows[0].id});await page.evaluate(()=>{const button=document.querySelector('[data-action="ai-generate"]');button.click();button.click();});await page.locator('[data-action="ai-cancel"]').waitFor();await delay(80);assert.equal(requests.length,1);await page.locator('[data-action="ai-cancel"]').click();await page.getByText(/已停止本地请求/).waitFor();assert.deepEqual(await d.stats(),before);assert.equal((await h.a.listAiDrafts()).length,0);
    });
  }
  await check('E has no uncaught browser errors',async()=>assert.deepEqual(h.errors,[]));
}finally{await h.close();}
