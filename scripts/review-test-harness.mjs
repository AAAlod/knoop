import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {build} from 'esbuild';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {createServer} from 'node:http';
export async function reviewHarness({baselineRef,suffix='window.__review={navigate};',out}){
  const baseline=process.argv.includes('--baseline'),sqlite=new DatabaseSync(':memory:');let pause=null,fault=0,writes=0;
  const bind=p=>Object.fromEntries(p.map((v,i)=>[`$${i+1}`,v]));
  const adapter={
    async execute(sql,p=[]){if(pause)await pause(sql,p);if(++writes===fault)throw Error('Injected failure');const r=sqlite.prepare(sql).run(...(p.length?[bind(p)]:[]));return {rowsAffected:Number(r.changes),lastInsertId:Number(r.lastInsertRowid)};},
    async select(sql,p=[]){return sqlite.prepare(sql).all(...(p.length?[bind(p)]:[])).map(row=>({...row}));},
    async atomic(steps){sqlite.exec('BEGIN');try{for(const s of steps){if(s.expectedRows!==undefined)assert.deepEqual(await adapter.select(s.sql,s.params),s.expectedRows,'Data changed');else{const r=await adapter.execute(s.sql,s.params);if(s.affectedRows!==undefined)assert.equal(r.rowsAffected,s.affectedRows);}}sqlite.exec('COMMIT');}catch(e){sqlite.exec('ROLLBACK');throw e;}}
  };
  let native=async(command,args)=>{if(command==='atomic_write')return adapter.atomic(args.steps);if(command==='list_restore_safety_copies')return [];throw Error('Native API forbidden: '+command);};
  globalThis.__reviewAdapter=adapter;globalThis.__reviewNative=(c,a)=>native(c,a);
  const source=path=>baseline?Promise.resolve(execFileSync('git',['-c',`safe.directory=${process.cwd().replaceAll('\\','/')}`,'show',`${baselineRef}:${path}`],{encoding:'utf8'})):readFile(path,'utf8');
  const plugin=browser=>({name:'review-isolation',setup(b){
    b.onResolve({filter:/^@tauri-apps\/plugin-sql$/},()=>({path:'sql',namespace:'mock'}));b.onResolve({filter:/^@tauri-apps\/api\/core$/},()=>({path:'core',namespace:'mock'}));
    b.onLoad({filter:/.*/,namespace:'mock'},a=>({loader:'js',contents:a.path==='sql'?`export default {load:async()=>${browser?'({execute:(s,p)=>window.__sql("execute",s,p),select:(s,p)=>window.__sql("select",s,p)})':'globalThis.__reviewAdapter'}};`:`export const invoke=(c,a)=>${browser?'window.__native(c,a)':'globalThis.__reviewNative(c,a)'};`}));
    b.onLoad({filter:/[\\/]src[\\/](main|db|temp-review|batch-review)\.ts$/},async a=>{const path='src/'+a.path.split(/[\\/]/).at(-1);return {loader:'ts',contents:await source(path)+(path==='src/main.ts'?'\n'+suffix:'')};});
  }});
  const built=await build({stdin:{contents:'export * as d from "./src/db";export * as t from "./src/temp-review";export * as b from "./src/batch-review";export * as a from "./src/ai-drafts";',resolveDir:process.cwd(),loader:'ts'},bundle:true,platform:'node',format:'cjs',write:false,plugins:[plugin(false)],logLevel:'silent'});
  const mod={exports:{}};new Function('module','exports',built.outputFiles[0].text)(mod,mod.exports);await mod.exports.d.db();
  const results=[];await mkdir(out,{recursive:true});
  const check=async(id,fn)=>{try{const evidence=await fn();results.push({id,status:'PASS',...evidence});console.log('PASS '+id);}catch(e){results.push({id,status:'FAIL',reason:e.message});console.log('FAIL '+id+': '+e.message.split('\n')[0]);}};
  let browser,server,page;
  const errors=[];
  async function ui(){
    const require=createRequire(import.meta.url),{chromium}=require(process.env.PLAYWRIGHT_MODULE_PATH||'playwright');
    const built=await build({entryPoints:['src/main.ts'],bundle:true,platform:'browser',write:false,loader:{'.css':'empty'},plugins:[plugin(true)],logLevel:'silent'}),css=await source('src/style.css');
    server=createServer((req,res)=>{res.setHeader('Content-Type','text/html; charset=utf-8');res.end(`<style>${css}</style><div id="app"></div><script>${built.outputFiles[0].text.replaceAll('</script>','<\\/script>')}</script>`);});await new Promise(r=>server.listen(0,'127.0.0.1',r));
    browser=await chromium.launch({headless:true,...(process.env.CHROME_PATH?{executablePath:process.env.CHROME_PATH}:{})});const context=await browser.newContext({viewport:{width:360,height:740}});await context.addInitScript(()=>history.replaceState({view:'home'},''));
    await context.exposeBinding('__sql',(_,op,s,p)=>adapter[op](s,p));await context.exposeBinding('__native',(_,c,a)=>native(c,a));page=await context.newPage();page.setDefaultTimeout(12000);page.on('pageerror',e=>errors.push(e.message));return page;
  }
  const load=async()=>{await page.goto(`http://127.0.0.1:${server.address().port}/`);await page.locator('.home-main').waitFor();};
  const reset=async()=>{pause=null;fault=0;writes=0;for(const {name}of sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table'").all())sqlite.exec(`DELETE FROM ${name}`);};
  const close=async()=>{if(browser)await browser.close();if(server)await new Promise(r=>server.close(r));await writeFile(`${out}/${baseline?'baseline':'regression'}.json`,JSON.stringify(results,null,2));sqlite.close();delete globalThis.__reviewAdapter;delete globalThis.__reviewNative;if(results.some(r=>r.status==='FAIL')&&!baseline)process.exitCode=1;};
  return {...mod.exports,adapter,sqlite,baseline,check,ui,load,reset,close,errors,setPause:value=>pause=value,setFault:n=>{writes=0;fault=n;},setNative:fn=>native=fn};
}
