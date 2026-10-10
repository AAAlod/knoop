import assert from 'node:assert/strict';
import {reviewHarness} from './review-test-harness.mjs';
const h=await reviewHarness({out:'artifacts/eink-t10/browser',suffix:'window.__review={navigate};'});
const page=await h.ui(),act=name=>page.locator(`[data-action="${name}"]`);
const route=target=>page.evaluate(target=>window.__review.navigate(target),target);
let calls=[],implementation;
h.setNative(async(command,args)=>{calls.push(command);return implementation(command,args);});
async function start(fn){await h.reset();calls=[];implementation=fn;await h.load();}
const supported=async command=>{if(command==='get_eink_status')return {supported:true,message:'本设备可请求全屏刷新'};if(command==='refresh_eink_screen')return {requested:true};throw Error(command);};
try {
 await h.check('screen capability is read only, unsupported home operations make no vendor calls',async()=>{
  await start(supported);assert.deepEqual(calls,[]);await route({view:'screen'});assert.deepEqual(calls,['get_eink_status']);assert.equal(await act('eink-refresh').isEnabled(),true);assert.equal((await h.d.stats()).total,0);await page.screenshot({path:'artifacts/eink-t10/browser/supported.png'});
 });
 await h.check('refresh request blocks duplicates while pending and during cooldown, without database writes',async()=>{
  let release,started;const pending=new Promise(r=>release=r),began=new Promise(r=>started=r);
  await start(async command=>{if(command==='get_eink_status')return supported(command);started();await pending;return {requested:true};});await route({view:'screen'});
  const before=h.sqlite.prepare('SELECT count(*) AS n FROM sessions').get();await act('eink-refresh').click();await began;assert.equal(await act('eink-refresh').isDisabled(),true);await act('eink-refresh').dispatchEvent('click');assert.equal(calls.filter(c=>c==='refresh_eink_screen').length,1);release();await page.getByText('已发送刷新请求，请观察实际屏幕。').waitFor();assert.equal(await act('eink-refresh').isDisabled(),true);await act('eink-refresh').dispatchEvent('click');assert.equal(calls.filter(c=>c==='refresh_eink_screen').length,1);await page.waitForFunction(()=>!document.querySelector('[data-action="eink-refresh"]').disabled);assert.deepEqual(h.sqlite.prepare('SELECT count(*) AS n FROM sessions').get(),before);assert.equal((await h.d.stats()).total,0);
 });
 await h.check('failed request stays readable and can explicitly retry, with no automatic hardware retry',async()=>{
  let failures=1;await start(async command=>{if(command==='get_eink_status')return supported(command);if(failures-- >0)throw Error('Vendor denied');return {requested:true};});await route({view:'screen'});await act('eink-refresh').click();await page.getByText('刷新请求失败，可稍后重试或使用设备的系统刷新功能。').waitFor();await page.waitForFunction(()=>!document.querySelector('[data-action="eink-refresh"]').disabled);assert.equal(calls.filter(c=>c==='refresh_eink_screen').length,1);await act('eink-refresh').click();await page.getByText('已发送刷新请求，请观察实际屏幕。').waitFor();assert.equal(calls.filter(c=>c==='refresh_eink_screen').length,2);
 });
 await h.check('unsupported firmware cannot request refresh even through a synthetic click',async()=>{
  await start(async()=>({supported:false,message:'当前设备或固件没有已验证的全屏刷新接口'}));await route({view:'screen'});assert.equal(await act('eink-refresh').isDisabled(),true);await act('eink-refresh').dispatchEvent('click');assert.deepEqual(calls,['get_eink_status']);
 });
 await h.check('missing plugin degrades to system refresh and does not stop ordinary app navigation',async()=>{
  await start(async()=>{throw Error('Plugin unavailable');});await route({view:'screen'});await page.getByText('当前设备没有可用的全屏刷新接口，继续使用系统默认刷新。').waitFor();assert.equal(await act('eink-refresh').isDisabled(),true);await route({view:'home'});await page.locator('.home-main').waitFor();
 });
 await h.check('late capability response and request completion cannot modify a newly opened screen',async()=>{
  let release,started;let pending=new Promise(r=>release=r),began=new Promise(r=>started=r);
  await start(async()=>{started();await pending;return {supported:true,message:'OLD'};});const oldRoute=route({view:'screen'});await began;await route({view:'home'});implementation=supported;await route({view:'screen'});release();await oldRoute;assert.equal(await page.locator('#eink-status').textContent(),'本设备可请求全屏刷新');
  pending=new Promise(r=>release=r);began=new Promise(r=>started=r);implementation=async command=>{if(command==='get_eink_status')return supported(command);started();await pending;return {requested:true};};await act('eink-refresh').click();await began;await route({view:'home'});await route({view:'screen'});release();await page.waitForTimeout(2100);assert.equal(await page.locator('#eink-status').textContent(),'本设备可请求全屏刷新');assert.equal(await act('eink-refresh').isEnabled(),true);
 });
 await h.check('narrow enlarged screen keeps request control reachable and exposes no raw mode/property commands',async()=>{
  await start(supported);await page.setViewportSize({width:320,height:320});await route({view:'screen'});await page.addStyleTag({content:'html{font-size:24px}'});await act('eink-refresh').scrollIntoViewIfNeeded();const box=await act('eink-refresh').boundingBox();assert(box.x>=0&&box.x+box.width<=320&&box.height>=48);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);assert.deepEqual(calls,['get_eink_status']);await page.screenshot({path:'artifacts/eink-t10/browser/narrow.png'});
 });
 await h.check('native screen has no uncaught errors or real AI requests',async()=>{assert.deepEqual(h.errors,[]);assert(calls.every(c=>['get_eink_status','refresh_eink_screen'].includes(c)));});
} finally { await h.close(); }
