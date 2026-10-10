import assert from 'node:assert/strict';
import {reviewHarness} from './review-test-harness.mjs';

const out='artifacts/eink-t4/browser';
const h=await reviewHarness({out,suffix:'window.__review={navigate,enqueueDraft};'}),page=await h.ui(),{d}=h;
const route=value=>page.evaluate(value=>window.__review.navigate(value),value);
const input=()=>page.locator('#directory-search');
const status=()=>page.locator('#directory-search-count');
const items=()=>page.locator('.directory-item');
const tick=()=>page.clock.runFor(200);
const sessions=()=>h.sqlite.prepare('SELECT COUNT(*) AS n FROM sessions').get().n;
const fixture=count=>({format:'knoop-bank',version:'1.1',import:{mode:'new',bankId:'search-check',bankTitle:'合成搜索检查'},nodes:[{id:'n',parentId:null,title:'合成章节',order:0}],questions:Array.from({length:count},(_,i)=>({id:`q${i}`,nodeId:'n',type:'single_choice',order:i,stem:`合成题 ${i+1} ${i%2?'乙组':'甲组'} 唯一${i+1}号`,options:[{id:'A',text:'甲'},{id:'B',text:'乙'}],answer:'A',explanation:i===0?'解析专用词':'合成解析'}))});
async function seed(count=24,query=''){
  await h.reset();await h.load();await d.importBank(fixture(count));
  const rows=await d.getQuestions();await route({view:'directory',nodeIds:[rows[0].node_id],kind:'brush',query});return rows;
}
async function search(value){await input().fill(value);await tick();}
const shot=name=>page.screenshot({path:`${out}/${name}.png`});
try{
  await page.clock.install({time:new Date('2026-10-10T00:00:00Z')});
  await page.clock.pauseAt(new Date('2026-10-10T00:00:00Z'));
  // Remove inert's behavior in modern Chromium to exercise the old-WebView fallback.
  await page.addInitScript(()=>Object.defineProperty(HTMLElement.prototype,'inert',{configurable:true,get:()=>false,set:()=>{}}));
  await page.setViewportSize({width:467,height:600});
  await h.check('pending search disables old results, launch, jump and more without inert; synthetic clicks cannot bypass the guard',async()=>{
    await seed(240,'甲组');await items().first().focus();
    await page.evaluate(()=>{
      const search=document.querySelector('#directory-search');search.value='乙组';search.dispatchEvent(new Event('input',{bubbles:true}));
    });
    assert.equal(await status().innerText(),'正在搜索…');assert.equal(await items().count(),100);
    assert.equal(await page.locator('.directory-item:not(:disabled),.directory-search-actions button:not(:disabled),.directory-jump button:not(:disabled),#directory-more:not(:disabled)').count(),0);
    await page.keyboard.press('Enter');await page.keyboard.press('Space');
    await page.evaluate(()=>document.querySelectorAll('.directory-item,.directory-search-actions button,.directory-jump button').forEach(button=>{
      button.disabled=false;button.dispatchEvent(new MouseEvent('click',{bubbles:true}));button.disabled=true;
    }));
    assert.equal(sessions(),0);assert.equal(await input().count(),1);await shot('waiting-disabled');await tick();
    assert.match(await items().first().innerText(),/乙组/);assert.equal(await items().first().isEnabled(),true);
  });
  await h.check('rapid edits, clear and no-match publish only the latest query and preserve the search node, focus and caret',async()=>{
    await seed();await input().focus();await page.evaluate(()=>window.__searchNode=document.querySelector('#directory-search'));
    await input().fill('甲组');await page.clock.runFor(90);await input().fill('不存在');await page.clock.runFor(90);await input().fill('乙组');await tick();
    assert.equal(await items().count(),12);assert.match(await status().innerText(),/找到 12 \/ 24/);
    assert.deepEqual(await page.evaluate(()=>({same:window.__searchNode===document.querySelector('#directory-search'),focus:document.activeElement===window.__searchNode,caret:window.__searchNode.selectionStart})),{same:true,focus:true,caret:2});
    await search('不存在');assert.equal(await items().count(),0);assert.equal(await page.locator('.directory-search-actions button').count(),0);
    await search('');assert.equal(await items().count(),24);assert.equal(await status().innerText(),'共 24 项');assert.equal(await page.locator('#directory-index').isEnabled(),true);
  });
  await h.check('Chinese composition stays busy across debounce time; commit searches the committed phrase with the keyboard focus intact',async()=>{
    await seed();await input().focus();await input().dispatchEvent('compositionstart',{data:''});
    await page.evaluate(()=>{
      const search=document.querySelector('#directory-search');search.value='甲';search.dispatchEvent(new InputEvent('input',{bubbles:true,isComposing:true,data:'甲'}));
    });
    await page.clock.runFor(1000);assert.equal(await status().innerText(),'输入中…');assert.equal(await items().first().isDisabled(),true);assert.equal(await items().count(),24);
    await page.keyboard.press('Enter');assert.equal(sessions(),0);
    await page.evaluate(()=>{
      const search=document.querySelector('#directory-search');search.value='甲组';search.dispatchEvent(new CompositionEvent('compositionend',{bubbles:true,data:'甲组'}));search.dispatchEvent(new InputEvent('input',{bubbles:true,data:'甲组'}));
    });
    await tick();assert.equal(await items().count(),12);assert.equal(await input().inputValue(),'甲组');assert.equal(await input().evaluate(el=>document.activeElement===el),true);await shot('composition-committed');
  });
  await h.check('an action already awaiting a draft save is cancelled even when a new query settles back to its original text',async()=>{
    await seed(24,'甲组');const before=sessions();
    await page.evaluate(()=>{
      window.__pendingSave=window.__review.enqueueDraft('search-race',()=>new Promise(resolve=>window.__finishSave=resolve));
    });
    await page.waitForFunction(()=>typeof window.__finishSave==='function');
    await page.locator('[data-action="directory-go"]').dispatchEvent('click');
    await input().fill('乙组');await tick();await input().fill('甲组');await tick();
    await page.evaluate(async()=>{window.__finishSave();await window.__pendingSave;});
    // Drain the event handler's microtasks after releasing the same save it awaited.
    await page.evaluate(async()=>{for(let i=0;i<8;i++)await Promise.resolve();});
    assert.equal(sessions(),before);assert.equal(await input().count(),1);
  });
  await h.check('leaving a pending search cancels its timer; returning restores the query without overwriting another page',async()=>{
    const rows=await seed();await input().fill('解析专用词');await route({view:'home'});await page.clock.runFor(1000);assert.equal(await page.locator('.home-main').count(),1);
    await route({view:'directory',nodeIds:[rows[0].node_id],kind:'brush',query:'解析专用词'});assert.equal(await items().count(),1);assert.equal(await input().inputValue(),'解析专用词');assert.match(await items().first().innerText(),/命中解析/);
  });
  await h.check('100/1000/10000-item banks render at most 100 initially; more and filtered jumps retain original question numbering',async()=>{
    const cases=[];
    for(const count of [100,1000,10000]){
      await seed(count);assert.equal(await items().count(),100);
      await input().fill('合成题');
      await tick();assert.equal(await items().count(),100);cases.push({count,rendered:await items().count()});
    }
    await page.locator('#directory-more').click();assert.equal(await items().count(),200);
    await search('唯一10000号');assert.equal(await items().count(),1);assert.equal(await items().locator('b').innerText(),'10000');await shot('large-bank-last-match');
    await items().click();await page.locator('.options').waitFor();assert.equal((await d.latestSession()).current_index,9999);return {cases};
  });
  await h.check('settled sequential/random search starts use exactly the matched questions; memorization keeps its mode',async()=>{
    for(const order of ['sequential','random']){
      const rows=await seed(24,'甲组');await page.locator(`[data-action="start-directory-search:${order}"]`).click();await page.locator('.options').waitFor();
      const saved=await d.latestSession(),ids=JSON.parse(saved.question_ids_json);assert.equal(ids.length,12);assert(ids.every(id=>rows.find(row=>row.id===id)?.content_json.includes('甲组')));assert.equal(saved.mode,order);assert.equal(JSON.parse(saved.scope_json).searchQuery,'甲组');
    }
    await h.reset();await h.load();const bank=fixture(2);bank.questions=bank.questions.map((q,i)=>({id:q.id,nodeId:'n',order:i,type:'memorization',prompt:`背诵 ${i}`,content:i?'乙组材料':'甲组材料'}));await d.importBank(bank);
    const rows=await d.getQuestions();await route({view:'directory',nodeIds:[rows[0].node_id],kind:'memorization',query:'甲组'});await page.locator('[data-action="start-directory-search:sequential"]').click();await page.locator('.quiz').waitFor();const saved=await d.latestSession();assert.equal(saved.mode,'memorization');assert.equal(JSON.parse(saved.question_ids_json).length,1);
  });
  await h.check('session directory blocks a pending jump and resumes the original session at the settled original index without grading',async()=>{
    const rows=await seed(),id=await d.createSession('sequential',{},rows.map(row=>row.id));await d.saveSession(id,0,{selection:['B']});
    const before=await d.stats();await route({view:'directory',sessionId:id,kind:'brush'});await input().fill('唯一24号');await page.locator('[data-action="jump-session:0"]').dispatchEvent('click');assert.equal((await d.sessionById(id)).current_index,0);await tick();
    assert.equal(await items().locator('b').innerText(),'24');await items().click();await page.locator('.options').waitFor();assert.equal((await d.sessionById(id)).current_index,23);assert.deepEqual(await d.stats(),before);assert.equal(sessions(),1);
  });
  await h.check('search checks have no uncaught browser errors',async()=>assert.deepEqual(h.errors,[]));
}finally{await h.close();}
