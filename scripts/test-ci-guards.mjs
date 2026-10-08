import assert from 'node:assert/strict';
import {readFile,writeFile,unlink,mkdir} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
const probe='src/__ci_type_failure_probe.ts',test='scripts/test-ai-review.mjs',original=await readFile(test,'utf8');
try{await readFile(probe);throw Error('Refusing to overwrite existing probe');}catch(error){if(error.code!=='ENOENT')throw error;}
const run=()=>spawnSync(process.execPath,['scripts/check-ci.mjs'],{encoding:'utf8',maxBuffer:4*1024*1024,windowsHide:true});const evidence=[];
try{
  await writeFile(probe,'export const ciTypeProbe: string = 123;\n');const typed=run();assert.notEqual(typed.status,0);assert.match(typed.stdout+typed.stderr,/TS2322/);evidence.push({probe:'TS2322',exitCode:typed.status});
}finally{await unlink(probe);}
try{
  await writeFile(test,original+'\nassert.fail("synthetic CI assertion probe");\n');const failed=run();assert.notEqual(failed.status,0);assert.match(failed.stdout+failed.stderr,/synthetic CI assertion probe/);evidence.push({probe:'assertion',exitCode:failed.status});
}finally{await writeFile(test,original);}
await mkdir('artifacts/review-f',{recursive:true});await writeFile('artifacts/review-f/ci-failure-probes.json',JSON.stringify(evidence,null,2));console.log(JSON.stringify(evidence));
