import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {reviewHarness} from './review-test-harness.mjs';

const out=process.env.EINK_UI_OUT||'artifacts/eink-t1/browser';
const h=await reviewHarness({baselineRef:'3fa6178',out}),page=await h.ui(),d=h.d;
const fixture={format:'knoop-bank',version:'1.1',import:{mode:'new',bankId:'eink-ui',bankTitle:'墨水屏合成检查'},nodes:[{id:'root',parentId:null,title:'合成章节',order:0}],questions:[
  {id:'single',nodeId:'root',type:'single_choice',order:0,stem:'黑白选项：$$\\sum_{i=1}^{20}i=210$$',options:[{id:'A',text:'正确选项'},{id:'B',text:'错误选项'},{id:'C',text:'可以排除的选项'}],answer:'A',explanation:'公式 $x^2$ 与正确答案。'},
  {id:'multi',nodeId:'root',type:'multiple_choice',order:1,stem:'选择 A 与 C',options:[{id:'A',text:'正确一'},{id:'B',text:'错误'},{id:'C',text:'正确二'}],answer:['A','C'],explanation:'保留选对、错选和漏选文字。'},
  {id:'blank',nodeId:'root',type:'blank',order:2,stem:'输入答案',answer:'甲',explanation:'合成填空'},
]};
const route=value=>page.evaluate(value=>window.__review.navigate(value),value);
const act=value=>page.locator(`[data-action="${value}"]`);
const style=async(locator,property)=>locator.evaluate((el,property)=>getComputedStyle(el)[property],property);
const screenshot=async name=>page.screenshot({path:`${out}/${name}.png`,fullPage:true});
async function seed(){await h.reset();await page.evaluate(()=>localStorage.clear());await d.importBank(fixture);await page.setViewportSize({width:467,height:600});await h.load();return d.getQuestions();}
async function session(row){const id=await d.createSession('sequential',{},[row.id]);await route({view:'session',id});await page.locator('.quiz').waitFor();return id;}
async function monochrome(){
  const colored=await page.locator('body, body *').evaluateAll(elements=>elements.filter(el=>el.getBoundingClientRect().width&&el.getBoundingClientRect().height).flatMap(el=>{const s=getComputedStyle(el);return ['color','backgroundColor','borderTopColor','outlineColor'].filter(key=>{const rgb=s[key].match(/^rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([.\d]+))?\)$/);return rgb&&Number(rgb[4]??1)>0&&(rgb[1]!==rgb[2]||rgb[2]!==rgb[3]);}).map(key=>`${el.tagName}.${el.className} ${key}=${s[key]}`);}));
  assert.deepEqual(colored,[],'Visible UI must not depend on colored text or surfaces');
}
try{
  await mkdir(out,{recursive:true});await h.load();
  await h.check('home is white with readable metadata, one black main action and no decorative shadows',async()=>{
    await seed();assert.equal(await style(page.locator('html'),'backgroundColor'),'rgb(255, 255, 255)');
    assert.equal(await style(act('scope'),'backgroundColor'),'rgb(0, 0, 0)');
    assert.equal(await style(act('scope'),'color'),'rgb(255, 255, 255)');
    assert.equal(await style(act('scope'),'boxShadow'),'none');await monochrome();await screenshot('home');
  });
  await h.check('scope checkbox and active type toggles are recognizable without accent-color support',async()=>{
    await seed();await route({view:'scope'});const check=page.locator('input[type="checkbox"]').first();
    assert.equal(await style(check,'appearance'),'none');await check.check();
    assert.notEqual(await style(check,'backgroundImage'),'none');await monochrome();
    await act('scope-next').click();await page.locator('.setup-types').waitFor();
    const toggle=act('filter-type:single_choice');assert.equal(await toggle.getAttribute('aria-pressed'),'true');
    assert.equal(await style(toggle,'backgroundColor'),'rgb(0, 0, 0)');await toggle.click();
    await page.waitForFunction(()=>document.querySelector('[data-action="filter-type:single_choice"]')?.getAttribute('aria-pressed')==='false');
    assert.equal(await toggle.getAttribute('aria-pressed'),'false');assert.notEqual(await style(toggle,'backgroundColor'),'rgb(0, 0, 0)');
    await monochrome();await screenshot('setup');
  });
  await h.check('real KaTeX CSS and fonts load; selected and excluded choices stay opaque and grading is unchanged',async()=>{
    const rows=await seed(),row=rows.find(row=>row.type==='single_choice');await session(row);
    await page.evaluate(async()=>{await document.fonts.ready;await document.fonts.load('16px KaTeX_Main');});
    assert.equal(await page.locator('.katex').first().evaluate(el=>getComputedStyle(el).fontFamily.includes('KaTeX_Main')),true);
    assert.equal(await page.evaluate(()=>[...document.fonts].some(font=>font.family==='KaTeX_Main'&&font.status==='loaded')),true);
    assert.equal(await style(act('submit'),'opacity'),'1');assert.equal(await act('submit').isDisabled(),true);
    assert.equal(await style(page.locator('.bottom-actions'),'backgroundColor'),'rgb(255, 255, 255)');
    await act('option:C').dispatchEvent('pointerdown');await page.waitForTimeout(520);await act('option:C').dispatchEvent('pointerup');
    assert.match(await act('option:C').getAttribute('class'),/excluded/);assert.equal(await style(act('option:C'),'opacity'),'1');
    assert.match(await style(act('option:C').locator('.option-copy > span'),'textDecorationLine'),/line-through/);
    await act('option:B').click();assert.equal(await act('option:B').getAttribute('aria-pressed'),'true');
    assert.equal(await style(act('option:B').locator('b'),'backgroundColor'),'rgb(0, 0, 0)');await monochrome();await screenshot('selection');
    await act('submit').click();await act('next').waitFor();assert.match(await act('option:A').innerText(),/正确答案/);assert.match(await act('option:B').innerText(),/错选/);
    assert.equal(await style(act('option:C'),'opacity'),'1');assert.equal((await d.stats()).wrong,1);await monochrome();await screenshot('single-result');
  });
  await h.check('multiple-choice correct, wrong and missed results remain explicit in black and white',async()=>{
    const rows=await seed();await session(rows.find(row=>row.type==='multiple_choice'));
    await act('option:A').click();await act('option:B').click();await act('submit').click();await act('next').waitFor();
    for(const [id,label]of [['A','选对'],['B','错选'],['C','漏选']])assert((await act(`option:${id}`).innerText()).includes(label));
    await monochrome();await screenshot('multi-result');
  });
  await h.check('focus is explicit without focus-visible and blank input plus disabled submission remain readable',async()=>{
    const rows=await seed();await session(rows.find(row=>row.type==='blank'));
    const input=page.locator('#blank');await input.focus();assert.equal(await style(input,'outlineColor'),'rgb(0, 0, 0)');
    assert(Number.parseFloat(await style(input,'outlineWidth'))>=2);await input.fill('甲');await act('submit').click();await act('next').waitFor();
    assert.equal(await style(input,'opacity'),'1');assert.equal((await d.stats()).correct,1);await monochrome();await screenshot('blank-result');
  });
  await h.check('no uncaught errors and no real native or AI requests',async()=>assert.deepEqual(h.errors,[]));
}finally{await h.close();}
