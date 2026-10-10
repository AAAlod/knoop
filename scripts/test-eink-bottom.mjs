import assert from 'node:assert/strict';
import {mkdir,readFile} from 'node:fs/promises';
import {reviewHarness} from './review-test-harness.mjs';

const out='artifacts/eink-t3/browser';
const h=await reviewHarness({baselineRef:'3fa6178',out}),page=await h.ui(),{d,t}=h;
const fixture={format:'knoop-bank',version:'1.1',import:{mode:'new',bankId:'eink-bottom',bankTitle:'合成底栏检查'},nodes:[{id:'root',parentId:null,title:'合成章节',order:0}],questions:[
  {id:'single',nodeId:'root',type:'single_choice',order:0,stem:'合成选择题',options:[{id:'A',text:'甲'},{id:'B',text:'乙'},{id:'C',text:'丙'},{id:'D',text:'丁'}],answer:'A',explanation:'长解析。'.repeat(100)},
  {id:'blank',nodeId:'root',type:'blank',order:1,stem:'合成填空',answer:'甲'},
]};
const route=value=>page.evaluate(value=>window.__review.navigate(value),value);
const act=value=>page.locator(`[data-action="${value}"]`);
const box=async locator=>{const rect=await locator.boundingBox();assert(rect);return rect;};
const settle=()=>page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
async function seed(width=467,height=600){await h.reset();await page.setViewportSize({width,height});await h.load();await d.importBank(fixture);await route({view:'home'});return d.getQuestions();}
async function session(row){const id=await d.createSession('sequential',{},[row.id]);await route({view:'session',id});return id;}
async function reserve(){await settle();const result=await page.locator('main').evaluate(main=>{const bar=main.querySelector('.bottom-actions,.scope-bottom,.form-bottom-actions');return {padding:parseFloat(getComputedStyle(main).paddingBottom),height:bar.getBoundingClientRect().height,offset:parseFloat(main.style.getPropertyValue('--viewport-bottom'))};});assert(result.padding>=result.height+result.offset+15.5,JSON.stringify(result));return result;}
async function aboveBar(locator){await settle();const field=await box(locator),bar=await box(page.locator('.bottom-actions,.scope-bottom,.form-bottom-actions'));assert(field.y+field.height<=bar.y-7,`content bottom ${field.y+field.height}, bar top ${bar.y}`);assert(field.y>=-1,'content above viewport');}
const shot=name=>page.screenshot({path:`${out}/${name}.png`});
try{
  await mkdir(out,{recursive:true});await h.load();
  await h.check('critical layouts have no :has dependency and Android requests keyboard resize',async()=>{
    assert(!/:has\(/.test((await readFile('src/style.css','utf8')).replace(/\/\*[\s\S]*?\*\//g,'')));
    assert.match(await readFile('src-tauri/gen/android/app/src/main/AndroidManifest.xml','utf8'),/windowSoftInputMode="adjustResize"/);
  });
  await h.check('PA6-width more controls stay in one row and toggle without altering answers or progress',async()=>{
    const rows=await seed(),row=rows[0],id=await session(row);await act('option:B').click();const before=await d.stats(),height=(await box(page.locator('.question-actions'))).height;
    const toggle=act('toggle-question-more');assert.equal(await toggle.getAttribute('aria-expanded'),'false');assert.equal(await page.locator('.question-extra-action:visible').count(),0);
    await toggle.press('Enter');await settle();assert.equal(await toggle.getAttribute('aria-expanded'),'true');assert.equal(await toggle.innerText(),'收起');
    const rects=await page.locator('.question-actions>button:visible').evaluateAll(els=>els.map(el=>{const r=el.getBoundingClientRect();return {y:r.y,w:r.width,h:r.height};}));assert.equal(rects.length,6);assert(rects.every(r=>Math.abs(r.y-rects[0].y)<1&&r.w>=48&&r.h>=48));assert((await box(page.locator('.question-actions'))).height<=height+1);await aboveBar(page.locator('.question-actions'));await reserve();await shot('more-one-row');
    await toggle.press('Space');await settle();assert.equal(await page.locator('.question-extra-action:visible').count(),0);assert.equal(await toggle.getAttribute('aria-expanded'),'false');assert.equal(await act('option:B').getAttribute('aria-pressed'),'true');assert.equal((await d.sessionById(id)).current_index,0);assert.deepEqual(await d.stats(),before);
  });
  await h.check('narrow and enlarged menus wrap only as needed and reveal every action above the bar',async()=>{
    const rows=await seed(320,600);await session(rows[0]);await page.addStyleTag({content:'.question-actions button{font-size:24px}'});await act('toggle-question-more').click();await settle();await aboveBar(page.locator('.question-actions'));assert((await box(page.locator('.question-actions'))).height>90);assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await shot('more-narrow-large');
  });
  await h.check('long editor final field remains reachable; measured padding follows a growing form bar',async()=>{
    const rows=await seed();await route({view:'edit',questionId:rows[0].id});await reserve();await page.evaluate(()=>window.scrollTo(0,document.documentElement.scrollHeight));await aboveBar(page.locator('textarea[name="explanation"]'));
    await page.addStyleTag({content:'.form-bottom-actions button{font-size:38px}'});await reserve();await page.evaluate(()=>window.scrollTo(0,document.documentElement.scrollHeight));await aboveBar(page.locator('textarea[name="explanation"]'));await shot('editor-large-bar');
  });
  await h.check('new note and review have full-width single actions; existing review two-row bar reserves its actual height',async()=>{
    const rows=await seed(320,600),row=rows[0];for(const view of ['note','review']){await route({view,questionId:row.id});await reserve();const bar=page.locator('.form-bottom-actions'),button=bar.locator('button');assert.match(await bar.getAttribute('class'),/single-action/);assert(Math.abs((await box(button)).width-(await box(bar)).width+24)<1);}
    await d.saveReview(row.id,['stem'],'合成审核');await route({view:'review',questionId:row.id});const measured=await reserve();assert(measured.height>120,'three actions wrap to two rows at 320px');await page.evaluate(()=>window.scrollTo(0,document.documentElement.scrollHeight));await aboveBar(page.locator('#review-note'));await shot('review-two-row-bar');
  });
  await h.check('keyboard-sized layout resize keeps draft and caret while input and save stay visible',async()=>{
    const rows=await seed(),row=rows[0];await route({view:'note',questionId:row.id});const input=page.locator('#note-content');const draft='合成草稿\n'.repeat(30)+'末行';await input.fill(draft);await input.evaluate(el=>{el.focus();el.setSelectionRange(el.value.length,el.value.length);});
    await page.setViewportSize({width:467,height:320});await settle();await reserve();await aboveBar(input);assert.equal(await input.inputValue(),draft);assert.equal(await input.evaluate(el=>el.selectionStart),draft.length);await input.press('End');await input.press('x');assert.equal(await input.inputValue(),draft+'x');await shot('note-keyboard-sized');
    await page.setViewportSize({width:467,height:600});await settle();await reserve();assert.equal(await input.inputValue(),draft+'x');assert.equal(await d.getNote(row.id),null);await page.evaluate(()=>window.scrollTo(0,document.documentElement.scrollHeight));await aboveBar(input);await shot('note-keyboard-closed');
  });
  await h.check('visual viewport overlay fallback lifts the bar and clears offset when keyboard closes',async()=>{
    const rows=await seed();await page.evaluate(()=>{window.__nativeViewport=window.visualViewport;const viewport=new EventTarget();Object.assign(viewport,{height:innerHeight-180,offsetTop:0});Object.defineProperty(window,'visualViewport',{configurable:true,value:viewport});window.__keyboardViewport=viewport;});
    try{await route({view:'note',questionId:rows[0].id});await reserve();assert(Math.abs((await box(page.locator('.form-bottom-actions'))).y+(await box(page.locator('.form-bottom-actions'))).height-420)<1);await page.evaluate(()=>{window.__keyboardViewport.height=innerHeight;window.__keyboardViewport.dispatchEvent(new Event('resize'));});await settle();const measured=await reserve();assert.equal(measured.offset,0);assert(Math.abs((await box(page.locator('.form-bottom-actions'))).y+(await box(page.locator('.form-bottom-actions'))).height-600)<1);
    }finally{await route({view:'home'});await page.evaluate(()=>Object.defineProperty(window,'visualViewport',{configurable:true,value:window.__nativeViewport}));}
  });
  await h.check('scope and temporary practice also reserve the measured fixed bar',async()=>{
    const rows=await seed();await route({view:'scope'});await reserve();const bank={...fixture,import:{...fixture.import,bankId:'ai-eink-bottom'},questions:fixture.questions.filter(q=>q.type==='blank')};const id=await t.createTempGroup(bank,rows[0].id,'合成来源','mock-ui',new Date().toISOString());await route({view:'temp-session',id});await reserve();const before=await d.stats();assert(await act('temp-submit').isDisabled());await page.locator('#temp-blank').fill('乙');await act('temp-submit').click();await act('temp-manual:true').waitFor();await reserve();assert.equal(await page.locator('.study-actions button').count(),2);assert.equal(await page.locator('.reading-page').count(),2);assert.deepEqual(await d.stats(),before);await shot('temp-manual-bar');
  });
  await h.check('no uncaught errors, including after route changes and resize',async()=>{await route({view:'home'});await page.setViewportSize({width:360,height:600});await settle();assert.deepEqual(h.errors,[]);});
}finally{await h.close();}
