import assert from "node:assert/strict";
import {build} from "esbuild";
import {mkdtemp,writeFile,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {createRequire} from "node:module";

const rows=new Map(), writes=[];
globalThis.__knoopBatchDb={
  async execute(sql,p) {
    writes.push(sql);
    if(sql.startsWith("INSERT INTO ai_review_batch_jobs")) rows.set(p[0],{id:p[0],model:p[1],review_json:p[2],batches_json:p[3],created_at:p[4],updated_at:p[4]});
    else if(sql.startsWith("UPDATE ai_review_batch_jobs")) Object.assign(rows.get(p[0]),{batches_json:p[1],updated_at:p[2]});
    else if(sql.startsWith("DELETE FROM ai_review_batch_jobs")) rows.delete(p[0]);
    else throw Error("Unexpected write "+sql);
  },
  async select(sql,p) {return sql.includes("WHERE id=$1") ? rows.has(p[0])?[rows.get(p[0])]:[] : [...rows.values()];}
};
const mock={name:"mock-db",setup(b){b.onResolve({filter:/\.\/db$/},a=>a.importer.endsWith("batch-review.ts")?{path:"db",namespace:"mock"}:null);b.onLoad({filter:/.*/,namespace:"mock"},()=>({contents:"export const db = async () => globalThis.__knoopBatchDb;",loader:"js"}));}};
const dir=await mkdtemp(join(tmpdir(),"knoop-batch-test-"));
try {
  const result=await build({entryPoints:["src/batch-review.ts"],bundle:true,platform:"node",format:"cjs",write:false,plugins:[mock],logLevel:"silent"});
  const file=join(dir,"batch.cjs");await writeFile(file,result.outputFiles[0].contents);
  const b=createRequire(import.meta.url)(file);
  const item=(n)=>({bank:{id:"bank"},question:{id:"original-"+n,type:"single_choice",stem:"题"+n,options:[{id:"A",text:"对"},{id:"B",text:"错"}],answer:"A"}});
  const review={format:"knoop-error-review",version:"1.1",items:[1,2,3,4,5].map(item)};
  const id=await b.createBatchJob(review,"model-x");
  let job=await b.getBatchJob(id), batches=b.jobBatches(job);
  assert.deepEqual(batches.map(x=>x.sourceKeys.length),[2,2,1]);
  assert.equal(b.MAX_SOURCES_PER_RUN,12);
  const bank=(key,n)=>({format:"knoop-bank",version:"1.1",questions:[
    {id:key+"-a",type:"single_choice",stem:"变式"+n+"A",options:[{id:"A",text:"甲"},{id:"B",text:"乙"}],answer:"A"},
    {id:key+"-b",type:"single_choice",stem:"变式"+n+"B",options:[{id:"A",text:"丙"},{id:"B",text:"丁"}],answer:"B"}
  ]});
  batches[0].banks[batches[0].sourceKeys[0]]=bank("one",1);
  batches[0].generatedAtBySource={[batches[0].sourceKeys[0]]:"2026-09-26T01:00:00Z"};
  batches[0].status="failed";
  batches[0].error="second request failed";
  await b.saveBatchJob(job,batches);
  job=await b.getBatchJob(id); batches=b.jobBatches(job);
  assert.equal(Object.keys(batches[0].banks).length,1,"successful source survives failed batch");
  assert.equal(b.collectReadyCandidates(job,batches).bank.questions.length,0,"partial batch cannot be saved");
  batches[0].banks[batches[0].sourceKeys[1]]=bank("two",2);
  batches[0].generatedAtBySource[batches[0].sourceKeys[1]]="2026-09-26T02:00:00Z";
  batches[0].status="ready";
  const resultReady=b.collectReadyCandidates(job,batches);
  assert.equal(resultReady.bank.questions.length,4);
  assert.deepEqual(resultReady.metadata.map(x=>x.derivedFrom),[batches[0].sourceKeys[0],batches[0].sourceKeys[0],batches[0].sourceKeys[1],batches[0].sourceKeys[1]]);
  assert.equal(resultReady.metadata[0].generatedAt,"2026-09-26T01:00:00Z");
  assert.equal(b.checkedCandidateIds(batches).ids.size,4);
  assert.equal(b.checkedCandidateIds(batches).fingerprints.size,4);
  batches[0].savedGroupId="saved";
  assert.equal(b.collectReadyCandidates(job,batches).bank.questions.length,0);
  await b.deleteBatchJob(id);
  assert.equal(await b.getBatchJob(id),null);
  assert(writes.every(x=>x.includes("ai_review_batch_jobs")));
  console.log("Batch splitting, retry persistence, complete-only save, provenance and isolation passed.");
} finally {delete globalThis.__knoopBatchDb;await rm(dir,{recursive:true,force:true});}
