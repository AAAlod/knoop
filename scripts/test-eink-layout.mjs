import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {reviewHarness} from './review-test-harness.mjs';

const out=process.env.EINK_LAYOUT_OUT||'artifacts/eink-t2/browser';
const h=await reviewHarness({baselineRef:'3fa6178',out}),page=await h.ui(),d=h.d;
const fixture={format:'knoop-bank',version:'1.1',import:{mode:'new',bankId:'eink-layout',bankTitle:'用于验证换行的很长很长的墨水屏合成题库名称'},nodes:[{id:'root',parentId:null,title:'合成根章节',order:0},{id:'child',parentId:'root',title:'用于验证复选框与文字间距的长章节名称',order:0}],questions:[
  {id:'single',nodeId:'child',type:'single_choice',order:0,stem:'间距检查',options:[{id:'A',text:'长选项正文需要换行，字母与文字始终保留间距。'.repeat(4)},{id:'B',text:'第二个选项'}],answer:'A',explanation:'合成解析'},
  {id:'multi',nodeId:'child',type:'multiple_choice',order:1,stem:'多选检查',options:[{id:'A',text:'甲'},{id:'B',text:'乙'}],answer:['A','B']},
]};
const route=value=>page.evaluate(value=>window.__review.navigate(value),value);
const act=value=>page.locator(`[data-action="${value}"]`);
const box=async locator=>{const rect=await locator.boundingBox();assert(rect);return rect;};
async function gap(left,right,min){const a=await box(left),b=await box(right);assert(b.x-(a.x+a.width)>=min-.5,`horizontal gap ${b.x-a.x-a.width} < ${min}`);}
async function touch(locator){for(const el of await locator.all()){const b=await box(el);assert(b.width>=47.5&&b.height>=47.5,`touch target ${b.width} x ${b.height}`);}}
async function audit(name){
  // Check actual rendered Flex containers, not CSS.supports('gap'), which also detects Grid.
  const unsupported=await page.locator('body *').evaluateAll(elements=>elements.filter(el=>el.getBoundingClientRect().width).flatMap(el=>{const s=getComputedStyle(el);return s.display.includes('flex')&&[s.rowGap,s.columnGap].some(v=>v!=='normal'&&parseFloat(v)!==0)?[`${el.className}: ${s.gap}`]:[];}));
  assert.deepEqual(unsupported,[],'Flex layout must not rely on gap');
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'page overflows horizontally');
  await page.screenshot({path:`${out}/${name}.png`,fullPage:true});
}
async function wrapped(locator,min){
  const rects=await locator.evaluateAll(elements=>elements.map(el=>{const r=el.getBoundingClientRect();return {name:el.textContent.slice(0,18),x:r.x,y:r.y,right:r.right,bottom:r.bottom};}));
  for(let i=0;i<rects.length;i++)for(let j=i+1;j<rects.length;j++){
    const a=rects[i],b=rects[j];
    if(Math.min(a.bottom,b.bottom)>Math.max(a.y,b.y))assert(b.x-a.right>=min-.5,`${a.name} / ${b.name}: horizontal gap ${b.x-a.right} < ${min}`);
    else if(b.y>=a.bottom)assert(b.y-a.bottom>=min-.5,`${a.name} / ${b.name}: row gap ${b.y-a.bottom} < ${min}`);
  }
}
try{
  await mkdir(out,{recursive:true});await h.load();
  for(const width of [320,360,467,680])await h.check(`spacing and touch targets at ${width}px`,async()=>{
    await h.reset();await page.evaluate(()=>localStorage.clear());await d.importBank(fixture);await h.load();await page.setViewportSize({width,height:650});
    const rows=await d.getQuestions(),row=rows.find(q=>q.type==='single_choice');
    await route({view:'scope'});await gap(page.locator('.scope-check input').first(),page.locator('.scope-check>span').first(),10);await touch(page.locator('.scope-check,.tree-toggle:not(.placeholder),.bank-fold'));await audit(`scope-${width}`);
    await page.locator('[data-bank-check]').check();await act('scope-next').click();await page.locator('.setup-types').waitFor();await wrapped(page.locator('.type-filter'),7);await touch(page.locator('.type-filter'));await audit(`setup-${width}`);
    await page.locator('.preset-save summary').click();await page.locator('#preset-name').fill('很长很长的合成练习范围预设名称');await act('save-scope-preset').click();await page.waitForFunction(()=>!!localStorage.getItem('knoop.scopePresets.v2'));
    await route({view:'presets'});await page.locator('.preset-card').waitFor();await wrapped(page.locator('.compact-card-actions>button'),6);await touch(page.locator('.compact-card-actions>button'));await audit(`presets-${width}`);
    const sid=await d.createSession('sequential',{},[row.id]);await route({view:'session',id:sid});
    await gap(page.locator('.header-title>span').first(),page.locator('.header-title-hint'),6);await touch(page.locator('.header-title,.option,.question-actions>button:visible'));
    await gap(page.locator('.option b').first(),page.locator('.option-copy').first(),12);await wrapped(page.locator('.question-actions>button:visible'),6);await audit(`question-${width}`);
    await page.locator('.question-more-toggle').click();await wrapped(page.locator('.question-extra-action:visible'),6);await touch(page.locator('.question-extra-action:visible'));await audit(`more-${width}`);
    await act(`edit:${row.id}`).click();await page.locator('#question-editor').waitFor();await gap(page.locator('.answer-pick input').first(),page.locator('.answer-pick span').first(),5);await touch(page.locator('.answer-pick'));await audit(`editor-${width}`);
    await route({view:'session',id:sid});await page.locator('.question-more-toggle').click();await act(`review:${row.id}`).click();await page.locator('.review-issues').waitFor();await gap(page.locator('.review-issues input').first(),page.locator('.review-issues label>span').first(),6);await wrapped(page.locator('.review-issues>label'),8);await wrapped(page.locator('.review-presets>button'),6);await touch(page.locator('.review-issues>label,.review-presets>button'));await audit(`review-${width}`);
    await d.importBank({...fixture,import:{...fixture.import,bankId:'eink-layout-second'}});
    await route({view:'import'});await page.locator('.bank-row').first().waitFor();for(const bank of await page.locator('.bank-row').all())await wrapped(bank.locator('.bank-actions>button'),6);await gap(page.locator('.bank-select>input').first(),page.locator('.bank-select>span').first(),10);await touch(page.locator('.bank-select,.bank-actions>button,.bank-export-toolbar>button'));await audit(`banks-${width}`);
  });
  await h.check('PA6 home exposes both AI entries without scrolling and keeps resume context',async()=>{
    await h.reset();await page.evaluate(()=>localStorage.clear());await d.importBank(fixture);
    const row=(await d.getQuestions())[0],sid=await d.createSession('sequential',{},[row.id]);
    await page.setViewportSize({width:467,height:600});await route({view:'home'});
    await page.locator('.home-resume').waitFor();
    const resume=page.locator(`[data-action="resume:${sid}"]`),summary=page.locator('.home-session-summary');
    assert.match(await summary.innerText(),/1 \/ 1/);
    assert.equal(await resume.locator('.home-session-summary').count(),1);
    for(const id of ['batch-new','temp-groups']){
      const b=await box(page.locator(`[data-action="${id}"]`));assert(b.y>=0&&b.y+b.height<=600,`${id} requires scrolling`);
    }
    assert(await page.evaluate(()=>document.documentElement.scrollHeight<=innerHeight+1),'home retains unnecessary scroll space');
    await touch(page.locator('.home-main button'));await audit('home-compact-467');
  });
  await h.check('PA6 setup shows brush and memorization actions together in sequential and random modes',async()=>{
    await h.reset();await page.evaluate(()=>localStorage.clear());await d.importBank({...fixture,questions:[...fixture.questions,{id:'memo',nodeId:'child',type:'memorization',order:2,prompt:'合成背诵',content:'合成材料'}]});
    await page.setViewportSize({width:467,height:600});await route({view:'scope'});await page.locator('[data-bank-check]').check();await act('scope-next').click();await page.locator('#practice-order').waitFor();
    for(const order of ['sequential','random']){
      await page.locator('#practice-order').selectOption(order);await page.locator('#memorization-order').selectOption(order);
      for(const el of await page.locator('.setup-actions button').all()){
        const b=await box(el);assert(b.y>=56&&b.y+b.height<=600,`${order} action requires scrolling`);
      }
      assert.equal(await page.locator('#random-count').isVisible(),order==='random');assert.equal(await page.locator('#memorization-random-count').isVisible(),order==='random');
      await touch(page.locator('.setup-actions button,.setup-controls select,.setup-controls input:visible'));await audit(`setup-compact-${order}`);
    }
    await page.locator('.preset-save summary').click();await page.locator('#preset-name').fill('紧凑布局仍可保存');
    for(const width of [320,360]){await page.setViewportSize({width,height:600});await audit(`setup-compact-expanded-${width}`);await touch(page.locator('.setup-actions button,.type-filter'));}
  });
  await h.check('enlarged controls wrap with spacing on the PA6-sized viewport',async()=>{
    await page.setViewportSize({width:467,height:600});await page.addStyleTag({content:'button,input,select,summary,label{font-size:24px!important}'});
    const row=(await d.getQuestions())[0],sid=await d.createSession('sequential',{},[row.id]);await route({view:'session',id:sid});await page.locator('.question-more-toggle').click();await wrapped(page.locator('.question-extra-action:visible'),6);await audit('more-large-text');
    await act(`review:${row.id}`).click();await page.locator('.review-issues').waitFor();await wrapped(page.locator('.review-issues>label'),8);await touch(page.locator('.review-issues>label,.review-presets>button'));await audit('review-large-text');
  });
  await h.check('no uncaught UI errors',async()=>assert.deepEqual(h.errors,[]));
}finally{await h.close();}
