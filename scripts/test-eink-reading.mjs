import assert from 'node:assert/strict';
import {reviewHarness} from './review-test-harness.mjs';

const out='artifacts/eink-t5/browser';
const h=await reviewHarness({out}),page=await h.ui(),{d,t}=h;
const route=value=>page.evaluate(value=>window.__review.navigate(value),value);
const act=value=>page.locator(`[data-action="${value}"]`);
const settle=()=>page.evaluate(async()=>{await document.fonts.ready;await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));});
const scroll=async y=>{await page.evaluate(y=>scrollTo(0,y),y);await settle();};
const y=()=>page.evaluate(()=>scrollY);
const near=(actual,expected,message)=>assert(Math.abs(actual-expected)<=3,`${message}: ${actual} vs ${expected}`);
const fixture={format:'knoop-bank',version:'1.1',import:{mode:'new',bankId:'reading-check',bankTitle:'合成阅读检查'},nodes:[{id:'n',parentId:null,title:'长题章节',order:0}],questions:[
  ...[0,1].map(i=>({id:`q${i}`,nodeId:'n',type:'single_choice',order:i,stem:`合成题 ${i+1}\n`+'长题文段与阅读位置。\n'.repeat(55)+'$$'+Array.from({length:50},(_,j)=>`x_{${j}}`).join('+')+'$$',options:[{id:'A',text:'选项甲\n'.repeat(8)},{id:'B',text:'选项乙\n'.repeat(8)}],answer:'A',explanation:'长解析。\n'.repeat(40)})),
  {id:'memo',nodeId:'n',type:'memorization',order:2,prompt:'背诵提示。\n'.repeat(35),content:'背诵正文。\n'.repeat(75),explanation:'背诵解析。\n'.repeat(20)},
]};
async function seed(){await h.reset();await page.setViewportSize({width:467,height:600});await h.load();await d.importBank(fixture);return d.getQuestions();}
async function session(rows,mode='sequential'){const id=await d.createSession(mode,{},rows.map(row=>row.id));await route({view:'session',id});await settle();return id;}
async function back(selector='.quiz'){await act('back').click();await page.locator(selector).waitFor();await settle();}
async function editorFromQuestion(row){await act('toggle-question-more').click();await settle();const before=await y();await act(`edit:${row.id}`).click();await page.locator('#question-editor').waitFor();await settle();return before;}
const shot=name=>page.screenshot({path:`${out}/${name}.png`});
try{
  await h.check('window/document is the single page scroller; header remains fixed and wide formula has its own horizontal scroller',async()=>{
    const rows=await seed();await session(rows.slice(0,2));await scroll(900);
    const measured=await page.evaluate(()=>({scrollY,root:document.scrollingElement.tagName,rootTop:document.scrollingElement.scrollTop,headerTop:document.querySelector('header').getBoundingClientRect().top,ancestors:[document.body,document.querySelector('#app')].map(el=>({overflowY:getComputedStyle(el).overflowY,scrollTop:el.scrollTop})),wide:document.documentElement.scrollWidth>innerWidth+1,formula:getComputedStyle(document.querySelector('.katex-display')).overflowX}));
    assert.equal(measured.root,'HTML');near(measured.rootTop,measured.scrollY,'document position');near(measured.headerTop,0,'fixed header');assert(measured.ancestors.every(el=>el.overflowY==='visible'&&el.scrollTop===0));assert.equal(measured.wide,false);assert.equal(measured.formula,'auto');await shot('long-question-fixed-header');return {measured};
  });
  await h.check('header actual height reserves content at narrow/PA6/wide sizes and after enlarged text or keyboard-sized resize',async()=>{
    const rows=await seed();await session(rows.slice(0,2));
    for(const [width,height] of [[320,600],[467,600],[680,600],[467,320]]){
      await page.setViewportSize({width,height});await scroll(0);
      const r=await page.evaluate(()=>({head:document.querySelector('header').getBoundingClientRect().bottom,first:document.querySelector('main').firstElementChild.getBoundingClientRect().top,wide:document.documentElement.scrollWidth>innerWidth+1}));assert(r.first-r.head>=8&&r.first-r.head<=16,'content must clear the header with compact spacing');assert.equal(r.wide,false);
    }
    await page.addStyleTag({content:'header{min-height:104px}header h1{font-size:26px}'});await settle();await scroll(700);near(await page.locator('header').evaluate(el=>el.getBoundingClientRect().top),0,'large header');
    await route({view:'edit',questionId:rows[0].id});await settle();assert.equal(await y(),0);assert(await page.locator('textarea').first().evaluate(el=>el.getBoundingClientRect().top>=document.querySelector('header').getBoundingClientRect().bottom));await shot('large-header-editor-entry');
  });
  await h.check('editing starts at the first field; cancel restores the reading position and selected answer without grading',async()=>{
    const rows=await seed(),id=await session(rows.slice(0,2));await act('option:B').click();const beforeStats=await d.stats(),before=await editorFromQuestion(rows[0]);
    assert(before>600);assert.equal(await y(),0);assert.equal(await page.locator('textarea').first().evaluate(el=>el===document.activeElement),false);await shot('editor-entry-top');await back();near(await y(),before,'cancel to question');assert.equal(await act('option:B').getAttribute('aria-pressed'),'true');assert.equal((await d.sessionById(id)).current_index,0);assert.deepEqual(await d.stats(),beforeStats);
  });
  await h.check('saving an edit restores the same visible option after added paragraphs change heights above it',async()=>{
    const rows=await seed();await session(rows.slice(0,2));await act('option:B').click();await act('toggle-question-more').click();await settle();const before=await act('option:B').evaluate(el=>el.getBoundingClientRect().top);
    await act(`edit:${rows[0].id}`).click();await page.locator('#question-editor').waitFor();await settle();await page.locator('textarea[name="stem"]').fill('新增段落。\n'.repeat(20)+fixture.questions[0].stem);await act(`save-edit:${rows[0].id}`).click();await page.locator('.quiz').waitFor();await settle();near(await act('option:B').evaluate(el=>el.getBoundingClientRect().top),before,'option anchor after saved edit');assert.equal(await act('option:B').getAttribute('aria-pressed'),'true');assert.equal((await d.stats()).total,0);await shot('saved-edit-reading-anchor');
  });
  await h.check('note/review and directory round trips restore the question; an explicit same-item directory jump resets to top',async()=>{
    const rows=await seed(),id=await session(rows.slice(0,2));
    for(const action of [`note:${rows[0].id}`,`review:${rows[0].id}`]){
      await act('toggle-question-more').click();await settle();const before=await y();await act(action).click();await page.locator('textarea').waitFor();await settle();assert.equal(await y(),0);await back();near(await y(),before,'form return');
    }
    await scroll(700);const before=await y();await act('session-directory').click();await page.locator('#directory-search').waitFor();await settle();assert.equal(await y(),0);await back();near(await y(),before,'directory return');
    await act('session-directory').click();await page.locator('#directory-index').fill('1');await act('directory-go').click();await page.locator('.quiz').waitFor();await settle();assert.equal(await y(),0);assert.equal((await d.sessionById(id)).current_index,0);assert.equal((await d.stats()).total,0);
  });
  await h.check('grading retains the same-question position; next and finish reset without changing grading semantics',async()=>{
    const rows=await seed(),id=await session(rows.slice(0,2));await act('option:B').click();await scroll(700);const before=await y();await act('submit').click();await act('next').waitFor();await settle();near(await y(),before,'same-question grading');assert.equal((await d.stats()).total,1);await scroll(1900);await act('next').click();await act('submit').waitFor();await settle();assert.equal(await y(),0);assert.equal((await d.sessionById(id)).current_index,1);assert.equal(await page.locator('.option.selected').count(),0);
    await act('option:A').click();await act('submit').click();await act('next').waitFor();await scroll(1900);await act('next').click();await page.locator('.finish-page').waitFor();await settle();assert.equal(await y(),0);assert.equal((await d.stats()).total,2);
  });
  await h.check('memorization reveal retains the prompt position and next material starts at the beginning',async()=>{
    const rows=await seed(),row=rows.find(row=>row.type==='memorization');await session([row,row],'memorization');await act('show-content').scrollIntoViewIfNeeded();await settle();const before=await y();await act('show-content').click();await page.locator('.answer-panel').waitFor();await settle();near(await y(),before,'reveal content');await scroll(2000);await act('next').click();await act('show-content').waitFor();await settle();assert.equal(await y(),0);assert.equal((await d.stats()).total,0);
  });
  await h.check('temporary practice uses the same position rules; resume retains reading and next resets, isolated from formal stats',async()=>{
    await seed();const bank={...fixture,questions:fixture.questions.slice(0,2)},id=await t.createTempGroup(bank,'synthetic','合成原题','mock-model',new Date().toISOString());await route({view:'temp-session',id});await settle();await act('temp-option:B').click();await scroll(700);const before=await y();await act('temp-submit').click();await act('temp-next').waitFor();await settle();near(await y(),before,'temporary grading');
    await route({view:'temp-groups'});await act(`temp-open:${id}`).click();await act('temp-next').waitFor();await settle();near(await y(),before,'temporary resume');await act('temp-next').click();await act('temp-submit').waitFor();await settle();assert.equal(await y(),0);assert.equal((await t.getTempGroup(id)).current_index,1);assert.equal(await page.locator('.option.selected').count(),0);assert.equal((await d.stats()).total,0);await shot('temporary-next-top');
  });
  await h.check('positions belong to individual sessions; same-question rerenders preserve location and home removes header spacing',async()=>{
    const rows=await seed(),first=await session(rows.slice(0,2));await scroll(700);await act(`favorite:${rows[0].id}`).dispatchEvent('click');await page.waitForFunction(()=>document.querySelector('.question-actions button')?.textContent?.includes('已收藏'));await settle();near(await y(),700,'favorite rerender');const second=await session(rows.slice(0,2));assert.notEqual(first,second);assert.equal(await y(),0);await route({view:'session',id:first});await settle();near(await y(),700,'first session return');await route({view:'home'});await settle();assert.equal(await y(),0);assert.equal(await page.locator('header').count(),0);assert.equal(await page.locator('#app').evaluate(el=>el.classList.contains('has-fixed-header')),false);
  });
  await h.check('late font readiness cannot override a new user gesture or a different route',async()=>{
    const rows=await seed(),id=await session(rows.slice(0,2));await scroll(700);await route({view:'home'});await settle();
    await page.evaluate(()=>Object.defineProperty(document.fonts,'ready',{configurable:true,value:new Promise(resolve=>window.__fontsReady=resolve)}));await route({view:'session',id});
    await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));await page.evaluate(()=>{window.dispatchEvent(new WheelEvent('wheel'));scrollTo(0,300);window.__fontsReady();});
    await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));near(await y(),300,'user reading after late font');await route({view:'home'});await page.evaluate(()=>delete document.fonts.ready);await settle();assert.equal(await y(),0);
  });
  await h.check('reading layout has no uncaught errors',async()=>assert.deepEqual(h.errors,[]));
}finally{await h.close();}
