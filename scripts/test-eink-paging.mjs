import assert from 'node:assert/strict';
import {setTimeout as delay} from 'node:timers/promises';
import {reviewHarness} from './review-test-harness.mjs';

const out='artifacts/eink-t6/browser';
const h=await reviewHarness({out,suffix:'window.__review={navigate,flushDrafts};'}),page=await h.ui(),{d,t}=h;
const route=value=>page.evaluate(value=>window.__review.navigate(value),value);
const act=value=>page.locator(`[data-action="${value}"]`);
const up=()=>page.locator('[data-reading-direction="-1"]');
const down=()=>page.locator('[data-reading-direction="1"]');
const settle=()=>page.evaluate(async()=>{await document.fonts.ready;await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));});
const flush=()=>page.evaluate(()=>window.__review.flushDrafts());
const shot=name=>page.screenshot({path:`${out}/${name}.png`});
const text=(prefix,count)=>Array.from({length:count},(_,i)=>`${prefix}${String(i).padStart(3,'0')} 文段阅读与重叠检查。`).join('\n');
const fixture={format:'knoop-bank',version:'1.1',import:{mode:'new',bankId:'paging-check',bankTitle:'合成翻屏检查'},nodes:[{id:'n',parentId:null,title:'长题章节',order:0}],questions:[
  {id:'long',nodeId:'n',type:'single_choice',order:0,stem:text('M',90),options:[{id:'A',text:'甲'},{id:'B',text:'乙'}],answer:'A',explanation:text('E',35)},
  {id:'short',nodeId:'n',type:'single_choice',order:1,stem:'短题',options:[{id:'A',text:'甲'},{id:'B',text:'乙'}],answer:'A'},
  {id:'blank',nodeId:'n',type:'blank',order:2,stem:text('B',40),answer:'甲'},
  {id:'memo',nodeId:'n',type:'memorization',order:3,prompt:text('P',25),content:text('C',75),keyPoints:['第一要点','最后要点'],explanation:text('X',12)},
  {id:'recall',nodeId:'n',type:'recall',order:4,front:text('F',20),back:text('R',45)},
]};
async function seed(bank=fixture){await h.reset();await page.setViewportSize({width:467,height:600});await h.load();await d.importBank(bank);return d.getQuestions();}
async function session(rows,mode='sequential'){const id=await d.createSession(mode,{},rows.map(row=>row.id));await route({view:'session',id});await settle();return id;}
async function frame(){return page.evaluate(()=>{
  const vv=visualViewport,top=Math.max(vv?.offsetTop??0,document.querySelector('header').getBoundingClientRect().bottom)+8;
  const bottom=Math.min(innerHeight,(vv?.offsetTop??0)+(vv?.height??innerHeight),document.querySelector('.reading-bottom').getBoundingClientRect().top)-8;
  const seen=[],all=[],walker=document.createTreeWalker(document.querySelector('.quiz'),NodeFilter.SHOW_TEXT);
  while(walker.nextNode())for(const match of walker.currentNode.textContent.matchAll(/\b[A-Z]\d{3}\b/g)){
    const range=document.createRange();range.setStart(walker.currentNode,match.index);range.setEnd(walker.currentNode,match.index+match[0].length);const r=range.getBoundingClientRect();all.push(match[0]);if(r.top>=top-.5&&r.bottom<=bottom+.5)seen.push(match[0]);
  }
  return {y:scrollY,top:scrollY+top,bottom:scrollY+bottom,height:bottom-top,all,seen};
});}
async function walk(direction=1){
  await settle();
  const control=direction>0?down:up,seen=new Set(),screens=[];
  for(let i=0;i<160;i++){
    const before=await frame();screens.push(before);before.seen.forEach(marker=>seen.add(marker));
    if(await control().isDisabled())return {seen,screens,all:before.all};
    await control().click();await settle();const after=await frame();
    assert(direction*(after.y-before.y)>0,'paging makes progress');
    if(direction>0)assert(after.top<before.bottom-1,'consecutive screens overlap');else assert(after.bottom>before.top+1,'reverse screens overlap');
  }
  throw Error('Paging did not reach a boundary');
}
try{
  await h.check('short content has disabled page boundaries; navigation and study actions share one row with 48px targets',async()=>{
    const rows=await seed();await session([rows.find(row=>row.external_id==='short')]);assert.equal(await up().isDisabled(),true);assert.equal(await down().isDisabled(),true);assert.equal(await up().innerText(),'页首');assert.equal(await down().innerText(),'页末');assert.equal(await act('submit').count(),1);
    const boxes=await page.locator('.reading-bottom button').evaluateAll(els=>els.map(el=>{const r=el.getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height};}));assert.equal(boxes.length,3);assert(boxes.every(r=>r.w>=48&&r.h>=48&&Math.abs(r.y-boxes[0].y)<1));assert((await page.locator('.reading-bottom').boundingBox()).height<=80);const before=await d.stats();await down().dispatchEvent('click');await up().dispatchEvent('click');assert.deepEqual(await d.stats(),before);await shot('short-content-boundaries');
  });
  await h.check('every line of long stem and explanation appears fully on overlapping screens in both directions; reading changes no saved state or DOM',async()=>{
    const rows=await seed(),id=await session([rows[0]]);await d.saveSession(id,0,{submitted:true,selection:['B'],excludedOptions:['A'],correct:false});await route({view:'session',id});await settle();const before=await d.sessionById(id),stats=await d.stats();await page.evaluate(()=>window.__question=document.querySelector('.quiz'));
    const forward=await walk();assert(forward.all.length>=125);assert(forward.all.every(marker=>forward.seen.has(marker)),`missed: ${forward.all.filter(marker=>!forward.seen.has(marker))}`);assert.equal(await down().innerText(),'页末');await shot('long-content-end');const reverse=await walk(-1);assert(reverse.all.every(marker=>reverse.seen.has(marker)));assert.equal(await page.evaluate(()=>scrollY),0);assert.deepEqual(await d.sessionById(id),before);assert.deepEqual(await d.stats(),stats);assert.equal(await page.evaluate(()=>window.__question===document.querySelector('.quiz')),true);return {forwardScreens:forward.screens.length,reverseScreens:reverse.screens.length,fullyVisibleMarkers:forward.seen.size};
  });
  await h.check('memorization and recall keep reading controls before reveal; expanded materials remain reachable and next is a separate action',async()=>{
    const rows=await seed();for(const type of ['memorization','recall']){
      const row=rows.find(row=>row.type===type),id=await session([row,rows[1]],type==='memorization'?'memorization':'recall');assert.equal(await page.locator('.reading-caption').innerText(),'阅读本题');await down().click();await settle();assert.equal((await d.sessionById(id)).current_index,0);assert.equal(await act('next').count(),0);await act('show-content').click();await settle();await up().click();await settle();await page.evaluate(()=>scrollTo(0,0));await settle();const result=await walk();assert(result.all.every(marker=>result.seen.has(marker)));assert.equal((await d.stats()).total,0);await act('next').click();await settle();assert.equal(await page.evaluate(()=>scrollY),0);assert.equal((await d.sessionById(id)).current_index,1);
    }
  });
  await h.check('oversized formula can be read across screens without vertical clipping; horizontal scroll survives page moves',async()=>{
    const bank=structuredClone(fixture);bank.questions[0].stem=text('M',15)+'\n$$'+Array.from({length:60},(_,i)=>`x_{${i}}`).join('+')+'$$\n$$\\begin{aligned}'+Array.from({length:24},(_,i)=>`y_{${i}}&=x+${i}`).join('\\\\')+'\\end{aligned}$$\n'+text('Z',15);
    const rows=await seed(bank);await session([rows[0]]);const formula=page.locator('.katex-display').first();
    await formula.evaluate(el=>{el.scrollLeft=150;});const offset=await formula.evaluate(el=>el.scrollLeft);assert(offset>0);const tall=await page.locator('.katex-display').last().evaluate(el=>({top:el.getBoundingClientRect().top+scrollY,bottom:el.getBoundingClientRect().bottom+scrollY,client:el.clientHeight,scroll:el.scrollHeight}));assert(tall.bottom-tall.top>400);assert(tall.client>=tall.scroll-1);
    const result=await walk();assert(result.all.every(marker=>result.seen.has(marker)));assert(result.screens[0].top<tall.top&&result.screens.at(-1).bottom>tall.bottom);await walk(-1);assert.equal(await formula.evaluate(el=>el.scrollLeft),offset);await shot('wide-formula-horizontal-preserved');
  });
  await h.check('paging recalculates for narrow/landscape viewports and enlarged text, covering every line without horizontal page overflow',async()=>{
    for(const [width,height,font] of [[320,600,24],[467,320,21],[740,360,26]]){
      const bank=structuredClone(fixture);bank.questions[0].stem=text('M',30);const rows=await seed(bank);await session([rows[0]]);await page.setViewportSize({width,height});await page.addStyleTag({content:`.stem,.multiline{font-size:${font}px!important;line-height:1.6!important}button{font-size:${Math.min(font,24)}px}`});await settle();await page.evaluate(()=>scrollTo(0,0));await settle();
      const result=await walk();assert(result.all.every(marker=>result.seen.has(marker)));assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);await shot(`paging-${width}x${height}`);
    }
  });
  await h.check('blank draft and input focus survive paging with a keyboard-sized viewport, even while its save is pending',async()=>{
    const rows=await seed(),row=rows.find(row=>row.type==='blank'),id=await session([row]);await page.locator('#blank').fill('甲');await flush();await page.setViewportSize({width:467,height:320});await settle();
    let release,started;const blocked=new Promise(resolve=>release=resolve),began=new Promise(resolve=>started=resolve);h.setPause(async sql=>{if(sql.startsWith('UPDATE sessions')){started();await blocked;}});
    try{
      await page.locator('#blank').fill('尚未保存的草稿');await began;const before=await d.sessionById(id);assert.equal(await up().isEnabled(),true);
      await Promise.race([up().click(),delay(2000).then(()=>{throw Error('Paging waited for the pending answer save');})]);await settle();assert.equal(await page.locator('#blank').inputValue(),'尚未保存的草稿');assert.equal(await page.locator('#blank').evaluate(el=>document.activeElement===el),true);assert.deepEqual(await d.sessionById(id),before);assert.equal((await d.stats()).total,0);await shot('keyboard-reading-draft');
    }finally{release();h.setPause(null);await flush();}
    await page.setViewportSize({width:467,height:600});await settle();assert.equal(await page.locator('#blank').inputValue(),'尚未保存的草稿');assert.equal(JSON.parse((await d.sessionById(id)).state_json).blankValue,'尚未保存的草稿');
  });
  await h.check('manual grading keeps two distinct study buttons alongside page controls with measured bar space',async()=>{
    const rows=await seed(),row=rows.find(row=>row.type==='blank'),id=await session([row]);await d.saveSession(id,0,{pendingManual:true,blankValue:'合成非标准答案'});await route({view:'session',id});await page.setViewportSize({width:320,height:400});await page.addStyleTag({content:'.study-actions button{font-size:30px}'});await settle();assert.equal(await page.locator('.study-actions>button').count(),2);assert.equal(await act('manual:false').count(),1);assert.equal(await act('manual:true').count(),1);
    const r=await page.locator('main').evaluate(el=>({padding:parseFloat(getComputedStyle(el).paddingBottom),bar:document.querySelector('.reading-bottom').getBoundingClientRect().height}));assert(r.padding>=r.bar+15);await page.evaluate(()=>scrollTo(0,0));await settle();const result=await walk();assert(result.all.every(marker=>result.seen.has(marker)));assert.equal((await d.stats()).total,0);await shot('manual-grade-paging');
  });
  await h.check('temporary practice paging preserves its own answers and results, with no formal grading; next advances only on its own button',async()=>{
    await seed();const bank={...fixture,questions:fixture.questions.slice(0,2)},id=await t.createTempGroup(bank,'synthetic','合成原题','mock-model',new Date().toISOString());await route({view:'temp-session',id});await settle();await act('temp-option:B').click();await flush();await page.evaluate(()=>scrollTo(0,0));await settle();const before=await t.getTempGroup(id),stats=await d.stats();const result=await walk();assert(result.all.every(marker=>result.seen.has(marker)));assert.deepEqual(await t.getTempGroup(id),before);assert.deepEqual(await d.stats(),stats);assert.equal(await act('temp-option:B').getAttribute('aria-pressed'),'true');await act('temp-submit').click();await act('temp-next').waitFor();await settle();const graded=await t.getTempGroup(id);await walk(-1);assert.deepEqual(await t.getTempGroup(id),graded);await act('temp-next').click();await settle();assert.equal((await t.getTempGroup(id)).current_index,1);assert.equal(await page.evaluate(()=>scrollY),0);assert.deepEqual(await d.stats(),stats);
  });
  await h.check('manual scrolling updates boundary labels; form round trip restores reading, and detached controls cannot move a new page',async()=>{
    const rows=await seed();await session([rows[0]]);await down().click();await down().click();await settle();const before=await page.evaluate(()=>scrollY);await page.evaluate(()=>window.__oldPager=document.querySelector('[data-reading-direction="1"]'));await route({view:'edit',questionId:rows[0].id,returnTo:{view:'home'}});await settle();assert.equal(await page.locator('.reading-bottom').count(),0);await page.evaluate(()=>scrollTo(0,100));const editorY=await page.evaluate(()=>scrollY);await page.evaluate(()=>window.__oldPager.dispatchEvent(new MouseEvent('click',{bubbles:true})));assert.equal(await page.evaluate(()=>scrollY),editorY);await page.goBack();await page.locator('.quiz').waitFor();await settle();assert(Math.abs(await page.evaluate(()=>scrollY)-before)<=3);await page.evaluate(()=>scrollTo(0,document.documentElement.scrollHeight));await settle();assert.equal(await down().innerText(),'页末');assert.equal(await down().isDisabled(),true);await page.evaluate(()=>scrollTo(0,0));await settle();assert.equal(await up().innerText(),'页首');assert.equal(await up().isDisabled(),true);
  });
  await h.check('screen reading has no uncaught errors or native AI calls',async()=>assert.deepEqual(h.errors,[]));
}finally{await h.close();}
