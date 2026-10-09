import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { build } from 'esbuild';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';

// All SQL runs against a fresh in-memory SQLite database. No device data or API calls.
const baseline = process.argv.includes('--baseline');
const ui = process.argv.includes('--ui');
const source = path => baseline
  ? Promise.resolve(execFileSync('git', ['-c', `safe.directory=${process.cwd().replaceAll('\\', '/')}`, 'show', `e6a568b:${path}`], { encoding: 'utf8' }))
  : readFile(path, 'utf8');
const sqlite = new DatabaseSync(':memory:');
const writes = [];
const adapter = {
  async execute(sql, params = []) {
    writes.push(sql);
    const result = sqlite.prepare(sql).run(...(params.length ? [bindings(params)] : []));
    return { rowsAffected: Number(result.changes), lastInsertId: Number(result.lastInsertRowid) };
  },
  async select(sql, params = []) {
    return sqlite.prepare(sql).all(...(params.length ? [bindings(params)] : [])).map(row => ({ ...row }));
  },
  async atomic(steps) {
    sqlite.exec('BEGIN');
    try {
      for(const step of steps){
        if(step.expectedRows!==undefined)assert.deepEqual(await adapter.select(step.sql,step.params),step.expectedRows);
        else {const result=await adapter.execute(step.sql,step.params);if(step.affectedRows!==undefined)assert.equal(result.rowsAffected,step.affectedRows);}
      }
      sqlite.exec('COMMIT');
    }catch(error){sqlite.exec('ROLLBACK');throw error;}
  }
};
function bindings(params) { return Object.fromEntries(params.map((p, i) => [`$${i + 1}`, p])); }
globalThis.__knoopTestDb = adapter;
const sqlPlugin = (browser = false) => ({
  name: 'in-memory-sqlite',
  setup(builder) {
    if (baseline) builder.onLoad({ filter: /[\\/]src[\\/]db\.ts$/ }, async () => ({ contents: await source('src/db.ts'), loader: 'ts' }));
    builder.onResolve({ filter: /^@tauri-apps\/plugin-sql$/ }, () => ({ path: 'sql', namespace: 'test' }));
    builder.onResolve({ filter: /^@tauri-apps\/api\/core$/ }, () => ({ path: 'core', namespace: 'test-core' }));
    builder.onLoad({ filter: /.*/, namespace: 'test-core' }, () => ({contents:`export async function invoke(command,args){if(command!=="atomic_write")throw Error("Native API forbidden in review A tests");return ${browser?'window.__atomic(args.steps)':'globalThis.__knoopTestDb.atomic(args.steps)'};}`,loader:'js'}));
    builder.onLoad({ filter: /.*/, namespace: 'test' }, () => ({
      contents: browser
        ? 'export default {load:async()=>({execute:(sql,p)=>window.__sql("execute",sql,p),select:(sql,p)=>window.__sql("select",sql,p)})};'
        : 'export default {load:async()=>globalThis.__knoopTestDb};', loader: 'js'
    }));
  }
});
const bundle = await build({ entryPoints: ['src/db.ts'], bundle: true, platform: 'node', format: 'cjs', write: false, plugins: [sqlPlugin()], logLevel: 'silent' });
const module = { exports: {} };
new Function('module', 'exports', bundle.outputFiles[0].text)(module, module.exports);
const d = module.exports;
const options = [{ id: 'A', text: '甲' }, { id: 'B', text: '乙' }];
const fixture = {
  format: 'knoop-bank', version: '1.1',
  import: { mode: 'new', bankId: 'review-a', bankTitle: '合成题库' },
  nodes: [{ id: 'root', parentId: null, title: '合成范围', order: 0 }],
  questions: [
    { id: 'single', nodeId: 'root', type: 'single_choice', order: 0, stem: '单选题', options, answer: 'A' },
    { id: 'multi', nodeId: 'root', type: 'multiple_choice', order: 1, stem: '多选题', options, answer: ['A', 'B'] },
    { id: 'blank', nodeId: 'root', type: 'blank', order: 2, stem: '填空题', answer: '答案' },
    ...[1, 2].map(i => ({ id: `memo${i}`, nodeId: 'root', type: 'memorization', order: i + 2, prompt: `背诵 ${i}`, content: '合成内容' }))
  ]
};
await d.db();
async function seed(bank = fixture, kill = true) {
  for (const { name } of sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all()) sqlite.exec(`DELETE FROM ${name}`);
  writes.length = 0;
  if (bank) await d.importBank(d.validateBank(structuredClone(bank)));
  if (bank && kill) await d.toggleKilled((await d.getQuestions()).find(q => q.external_id === 'blank').id);
}
const results = [];
async function check(id, fn) {
  try { await fn(); results.push({ id, status: 'PASS' }); console.log(`PASS ${id}`); }
  catch (error) { results.push({ id, status: 'FAIL', reason: error.message }); console.log(`FAIL ${id}: ${error.message}`); }
}
await seed();
await check('U01 SQLite: 5 total / 2 available brush / 2 memo', async () => {
  assert.deepEqual(await d.librarySummary(), { banks: 1, totalContent: 5, questions: 2, memorization: 2 });
});
await check('U01 SQLite: scope excludes killed and review-killed; IDs preserved', async () => {
  const rows = await d.getQuestions(), nodeId = (await d.getNodes())[0].id;
  assert.equal((await d.questionsForScope([nodeId])).length, 4);
  await d.saveReview(rows.find(q => q.external_id === 'multi').id, ['answer'], '合成审核');
  const available = await d.questionsForScope([nodeId]);
  assert.equal(available.filter(q => q.type !== 'memorization').length, 1);
  assert.equal((await d.getQuestions()).length, 5);
  await d.cancelReview(rows.find(q => q.external_id === 'multi').id);
  if (!baseline) {
    assert.equal((await d.librarySummary([])).questions, 0);
    assert.equal((await d.librarySummary(['single_choice', 'single_choice', 'memorization'])).questions, 1);
  }
});
await check('U02 SQLite: wrong then correct exits current wrong, keeps error attempts', async () => {
  const row = (await d.getQuestions()).find(q => q.external_id === 'single');
  const session = await d.createSession('sequential', {}, [row.id]);
  await d.addAttempt(row.id, session, ['B'], 'auto', false);
  assert.equal((await d.wrongQuestions()).length, 1);
  assert.equal((await d.stats()).currentWrong, 1);
  await d.addAttempt(row.id, session, ['A'], 'auto', true);
  assert.equal((await d.wrongQuestions()).length, 0);
  assert.deepEqual(await d.stats(), { total: 2, correct: 1, wrong: 1, rate: 50, currentWrong: 0 });
});
await check('U01 SQLite: memorization-only bank has content', async () => {
  await seed({ ...fixture, questions: fixture.questions.filter(q => q.type === 'memorization') }, false);
  assert.deepEqual(await d.librarySummary(), { banks: 1, totalContent: 2, questions: 0, memorization: 2 });
});

if (ui) {
  // Optional browser dependency; use a supplied Playwright install without changing app deps.
  const require = createRequire(import.meta.url);
  const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
  const browserPlugin = {
    name: 'ui-test-entry', setup(builder) {
      builder.onLoad({ filter: /[\\/]src[\\/]main\.ts$/ }, async args => ({
        contents: (await source('src/main.ts')) + '\nwindow.__knoopUi={navigate};', loader: 'ts'
      }));
      builder.onResolve({ filter: /^@tauri-apps\/api\/core$/ }, () => ({ path: 'invoke', namespace: 'no-api' }));
      builder.onLoad({ filter: /.*/, namespace: 'no-api' }, () => ({ contents: 'export const invoke=async()=>{throw Error("Native API forbidden in review A tests")};', loader: 'js' }));
    }
  };
  const frontend = await build({
    stdin: { contents: 'import "./src/main"; import * as d from "./src/db"; window.__knoopDb=d;', resolveDir: process.cwd(), loader: 'ts' },
    bundle: true, platform: 'browser', write: false, loader: { '.css': 'empty' }, plugins: [sqlPlugin(true), browserPlugin], logLevel: 'silent'
  });
  const css = await source('src/style.css');
  const browser = await chromium.launch({ headless: true, ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) });
  const server = createServer((req, res) => {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end(`<style>${css}</style><div id="app"></div><script>${frontend.outputFiles[0].text.replaceAll('</script>', '<\\/script>')}</script>`);
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const context = await browser.newContext({ viewport: { width: 320, height: 720 }, hasTouch: true });
  context.setDefaultTimeout(8000);
  await context.addInitScript(() => history.replaceState({ view: 'home' }, ''));
  await context.exposeBinding('__sql', async (_source, op, sql, params) => adapter[op](sql, params));
  await context.exposeBinding('__atomic', async (_source, steps) => adapter.atomic(steps));
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  let navigations = 0;
  // History push/back is expected; count only actual document requests/reloads.
  page.on('request', request => { if (request.isNavigationRequest() && request.frame() === page.mainFrame()) navigations++; });
  const url = `http://127.0.0.1:${server.address().port}/`;
  const action = id => page.locator(`[data-action="${id}"]`);
  async function textHas(selector, text) {
    await page.waitForFunction(({ selector, text }) => document.querySelector(selector)?.textContent.includes(text), { selector, text });
  }
  async function selected(id, expected = true) {
    await page.waitForFunction(({ id, expected }) => document.querySelector(`[data-action="option:${id}"]`)?.classList.contains('selected') === expected, { id, expected });
  }
  async function route(value) { await page.evaluate(route => window.__knoopUi.navigate(route), value); }
  async function fresh(bank = fixture, kill = true) {
    await seed(bank, kill);
    await page.goto(url);
    await page.waitForFunction(() => document.querySelector('.home-main'));
    await route({ view: 'home' });
  }
  async function assertNoOverflow() {
    const overflowing = await page.evaluate(() => [...document.querySelectorAll('.home-main, .home-main *')].filter(el => {
      const r = el.getBoundingClientRect(); return r.width && (r.left < -1 || r.right > innerWidth + 1 || el.scrollWidth > el.clientWidth + 1);
    }).map(el => el.className));
    assert.deepEqual(overflowing, []);
  }
  try {
    await check('F01 browser: single/multi/blank save and save-review once, no navigation, return to origin', async () => {
      for (const type of ['single_choice', 'multiple_choice', 'blank']) for (const review of [false, true]) {
        await fresh();
        const row = (await d.getQuestions()).find(q => q.type === type);
        await route({ view: 'list', kind: 'favorites' });
        await route({ view: 'edit', questionId: row.id, returnTo: { view: 'list', kind: 'favorites' } });
        await page.locator('[name="stem"]').fill('修改后的题干');
        const before = navigations;
        const count = writes.filter(sql => sql.startsWith('UPDATE questions SET content_json')).length;
        await action(`${review ? 'save-edit-review' : 'save-edit'}:${row.id}`).click();
        await page.waitForFunction(() => !document.querySelector('#question-editor'));
        assert.equal(navigations, before, 'native form navigation occurred');
        assert.equal(writes.filter(sql => sql.startsWith('UPDATE questions SET content_json')).length - count, 1);
        assert.equal(JSON.parse((await d.getQuestions([row.id]))[0].content_json).stem, '修改后的题干');
        assert.equal(!!(await d.getReview(row.id)), review);
        assert.equal(await page.locator('h1').textContent(), '收藏');
      }
    });
    await check('F01 browser: Enter newline, native submit blocked, invalid content never saved', async () => {
      for (const type of ['single_choice', 'multiple_choice', 'blank']) {
      await fresh();
      const row = (await d.getQuestions()).find(q => q.type === type);
      await route({ view: 'edit', questionId: row.id, returnTo: { view: 'home' } });
      const before = navigations;
      await page.locator('[name="stem"]').press('End');
      await page.locator('[name="stem"]').press('Enter');
      assert((await page.locator('[name="stem"]').inputValue()).includes('\n'));
      const prevented = await page.evaluate(() => {
        const event = new Event('submit', { bubbles: true, cancelable: true });
        document.querySelector('#question-editor').dispatchEvent(event); return event.defaultPrevented;
      });
      assert.equal(prevented, true);
      await page.evaluate(() => document.querySelector('#question-editor').requestSubmit());
      await page.locator('[name="stem"]').fill('');
      const count = writes.filter(sql => sql.startsWith('UPDATE questions SET content_json')).length;
      await action(`save-edit:${row.id}`).click();
      await page.locator('#app-toast').filter({ hasText: '题干不能为空' }).waitFor();
      assert.equal(navigations, before);
      assert.equal(writes.filter(sql => sql.startsWith('UPDATE questions SET content_json')).length, count);
      }
    });
    await check('U01 browser: home / scope / mode / actual session agree (2 brush + 2 memo)', async () => {
      await fresh();
      assert.match(await page.locator('.home-summary').innerText(), /总 5/);
      assert.match(await page.locator('.home-summary').innerText(), /背诵 2/);
      await action('scope').click();
      await action('scope-bank:review-a').click();
      await textHas('.scope-bottom', '可刷 2');
      assert.match(await page.locator('.scope-bottom').innerText(), /可刷 2 题 · 可背 2 项/);
      await action('scope-next').click();
      await page.locator('.scope-selection-summary').waitFor();
      assert.match(await page.locator('.scope-selection-summary').innerText(), /可刷 2 题 · 可背 2 项/);
      await action('start-scope:sequential').click();
      await page.locator('.quiz').waitFor();
      assert.equal(JSON.parse((await d.latestSession()).question_ids_json).length, 2);
      // Disabling multi affects both scope and mode, not total content.
      await route({ view: 'home' }); await action('filter-type:multiple_choice').click();
      await textHas('.home-summary', '可刷 1');
      assert.match(await page.locator('.home-summary').innerText(), /可刷 1/);
      await action('scope').click(); await action('scope-bank:review-a').click();
      await textHas('.scope-bottom', '可刷 1');
      assert.match(await page.locator('.scope-bottom').innerText(), /可刷 1/);
      await action('scope-next').click();
      await page.locator('.scope-selection-summary').waitFor();
      assert.match(await page.locator('.scope-selection-summary').innerText(), /可刷 1/);
      await route({ view: 'home' }); await action('filter-type:multiple_choice').click();
      await textHas('.home-summary', '可刷 2');
    });
    await check('U02 browser: wrong semantics in list, empty state and stats', async () => {
      await fresh(); const row = (await d.getQuestions())[0];
      const id = await d.createSession('sequential', {}, [row.id]);
      await d.addAttempt(row.id, id, ['B'], 'auto', false);
      await route({ view: 'list', kind: 'wrong' });
      await page.locator('.stats-rules summary').click(); assert.match(await page.locator('main').innerText(), /最近一次答错.*答对.*移出/s);
      await d.addAttempt(row.id, id, ['A'], 'auto', true);
      await route({ view: 'list', kind: 'wrong' });
      assert.match(await page.locator('.empty').innerText(), /暂无当前错题/); await page.locator('.stats-rules summary').click(); assert.match(await page.locator('main').innerText(), /最近一次答错.*答对.*移出/s);
      await route({ view: 'stats' });
      assert.match(await page.locator('.stats').innerText(), /1\s+错误作答次数/);
      assert.match(await page.locator('.stats').innerText(), /0\s+当前错题数/);
    });
    await check('U07 browser: clicks, long-press toggle, cancel/leave/scroll safe', async () => {
      for (const type of ['single_choice', 'multiple_choice']) {
        await fresh(); const row = (await d.getQuestions()).find(q => q.type === type);
        const id = await d.createSession('sequential', {}, [row.id]);
        await route({ view: 'session', id });
        assert.match(await page.locator('.option-help').innerText(), /长按选项可标记排除/);
        await action('option:A').click(); await selected('A'); assert.equal(await action('option:A').evaluate(el => el.classList.contains('selected')), true);
        await action('option:B').click();
        await selected('B'); await selected('A', type === 'multiple_choice');
        assert.equal(await action('option:A').evaluate(el => el.classList.contains('selected')), type === 'multiple_choice');
        const press = async () => { await action('option:A').dispatchEvent('pointerdown', { pointerId: 1, pointerType: 'touch' }); await page.waitForTimeout(550); };
        await press(); assert.equal(await action('option:A').evaluate(el => el.classList.contains('excluded')), true);
        await press(); assert.equal(await action('option:A').evaluate(el => el.classList.contains('excluded')), false);
        for (const event of ['pointercancel', 'pointerleave']) {
          await action('option:B').dispatchEvent('pointerdown', { pointerId: 1, pointerType: 'touch' });
          await action('option:B').dispatchEvent(event, { pointerId: 1, pointerType: 'touch' });
          await page.waitForTimeout(550);
          assert.equal(await action('option:B').evaluate(el => el.classList.contains('excluded')), false);
        }
        // Touch browsers cancel pointers when scrolling; exercise that cancellation path.
        await action('option:B').dispatchEvent('pointerdown', { pointerId: 1, pointerType: 'touch' });
        await page.evaluate(() => window.dispatchEvent(new Event('scroll')));
        await action('option:B').dispatchEvent('pointercancel', { pointerId: 1, pointerType: 'touch' });
        await page.waitForTimeout(550);
        assert.equal(await action('option:B').evaluate(el => el.classList.contains('excluded')), false);
      }
    });
    await check('U08 browser: empty / memo-only / library / resumed home at 320px', async () => {
      const out = resolve('artifacts/review-a'); await mkdir(out, { recursive: true });
      for (const state of ['empty', 'memo', 'library', 'resume']) {
        await fresh(state === 'empty' ? null : state === 'memo' ? { ...fixture, questions: fixture.questions.filter(q => q.type === 'memorization') } : fixture, state !== 'empty' && state !== 'memo');
        if (state === 'resume') {
          const rows = await d.questionsForScope([(await d.getNodes())[0].id]);
          const id = await d.createSession('random', {}, rows.filter(q => q.type !== 'memorization').map(q => q.id));
          await d.saveSession(id, 1, {}); await route({ view: 'home' });
          assert.match(await page.locator('.home-session-summary').innerText(), /随机.*2 \/ 2/s);
          assert.equal(await action(`resume:${id}`).evaluate(el => el.classList.contains('primary')), true);
          assert.equal(await action('scope').evaluate(el => el.classList.contains('primary')), false);
        } else assert.equal(await action(state === 'empty' ? 'import' : 'scope').first().evaluate(el => el.classList.contains('primary')), true);
        if (state === 'memo') {
          assert.match(await page.locator('.home-summary').innerText(), /总 2/);
          await action('scope').click(); await action('scope-bank:review-a').click(); await action('scope-next').click();
          await page.locator('.scope-selection-summary').waitFor();
          assert.match(await page.locator('.scope-selection-summary').innerText(), /可刷 0 题 · 可背 2 项/);
          await action('start-scope:memorization').click(); await page.locator('.quiz').waitFor();
          assert.equal(JSON.parse((await d.latestSession()).question_ids_json).length, 2);
          await route({ view: 'home' });
        }
        await assertNoOverflow();
        await page.screenshot({ path: resolve(out, `${baseline ? 'baseline-' : ''}home-${state}-320.png`), fullPage: true });
      }
      assert.deepEqual(errors, []);
    });
  } finally { await browser.close(); await new Promise(r => server.close(r)); }
}
await mkdir('artifacts/review-a', { recursive: true });
await writeFile(`artifacts/review-a/${baseline ? 'baseline' : 'regression'}${ui ? '-ui' : ''}.json`, JSON.stringify(results, null, 2));
delete globalThis.__knoopTestDb;
sqlite.close();
const failures = results.filter(r => r.status === 'FAIL');
if (failures.length && !baseline) process.exitCode = 1;
if (baseline) console.log(`Baseline reproduced ${failures.length} failing checks; full results saved under artifacts/review-a.`);
