import assert from "node:assert/strict";
import { build } from "esbuild";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";

const rows = new Map();
const writes = [];
const database = {
  async execute(sql, params) {
    writes.push(sql);
    if (sql.startsWith("INSERT INTO ai_review_groups")) {
      rows.set(params[0], {id:params[0],source_question_id:params[1],source_question_title:params[2],model:params[3],generated_at:params[4],created_at:params[5],updated_at:params[5],bank_json:params[6],question_meta_json:params[7],current_index:0,state_json:params[8],results_json:"[]",completed_at:null});
    } else if (sql.startsWith("UPDATE ai_review_groups")) {
      const row=rows.get(params[0]); Object.assign(row,{current_index:params[1],state_json:params[2],results_json:params[3],updated_at:params[4],completed_at:params[5] ? params[4] : null});
    } else if (sql.startsWith("DELETE FROM ai_review_groups")) rows.delete(params[0]);
    else throw Error("Unexpected write: "+sql);
  },
  async select(sql, params) {
    if (sql.includes("WHERE id=$1")) return rows.has(params[0]) ? [rows.get(params[0])] : [];
    return [...rows.values()];
  }
};
globalThis.__knoopTestDb = database;
const mock = {
  name: "mock-db",
  setup(build) {
    build.onResolve({filter:/\.\/db$/}, args => args.importer.endsWith("temp-review.ts") ? {path:"mock-db",namespace:"mock"} : null);
    build.onLoad({filter:/.*/,namespace:"mock"}, () => ({contents:"export const db = async () => globalThis.__knoopTestDb;",loader:"js"}));
  }
};
const dir = await mkdtemp(join(tmpdir(),"knoop-temp-test-"));
try {
  const [tempBundle,gradeBundle] = await Promise.all([
    build({entryPoints:["src/temp-review.ts"],bundle:true,platform:"node",format:"cjs",write:false,plugins:[mock],logLevel:"silent"}),
    build({entryPoints:["src/grading.ts"],bundle:true,platform:"node",format:"cjs",write:false,logLevel:"silent"})
  ]);
  const tempFile=join(dir,"temp.cjs"),gradeFile=join(dir,"grade.cjs");
  await writeFile(tempFile,tempBundle.outputFiles[0].contents);
  await writeFile(gradeFile,gradeBundle.outputFiles[0].contents);
  const t=createRequire(import.meta.url)(tempFile),{gradeQuestion}=createRequire(import.meta.url)(gradeFile);
  const bank={format:"knoop-bank",version:"1.1",import:{mode:"new",bankId:"preview",bankTitle:"临时"},nodes:[],questions:[{id:"q1",type:"single_choice",answer:"A"},{id:"q2",type:"blank",answer:"答案"}]};
  const id=await t.createTempGroup(bank,"original","原题","model-x","2026-09-26T00:00:00Z");
  let group=await t.getTempGroup(id);
  assert.equal(t.tempBank(group).questions.length,2);
  assert.deepEqual(JSON.parse(group.question_meta_json).map(x=>x.derivedFrom),["original","original"]);
  assert.equal(gradeQuestion(bank.questions[0],["A"]),true);
  assert.equal(gradeQuestion({type:"multiple_choice",answer:["A","C"]},["C","A"]),true);
  assert.equal(gradeQuestion({type:"multiple_choice",answer:["A","C"]},["A","A"]),false);
  assert.equal(gradeQuestion(bank.questions[1],"不同答案"),null);
  await t.saveTempProgress(group,1,{selection:[],blank:"草稿",submitted:false,pendingManual:false},[{questionId:"q1",answer:["A"],correct:true,grading:"auto"}]);
  group=await t.getTempGroup(id);
  assert.equal(group.current_index,1);
  assert.equal(t.tempState(group).blank,"草稿");
  assert.equal(t.tempResults(group).length,1);
  await t.restartTempGroup(group);
  group=await t.getTempGroup(id);
  assert.equal(group.current_index,0);
  assert.equal(t.tempResults(group).length,0);
  await t.deleteTempGroup(id);
  assert.equal(await t.getTempGroup(id),null);
  assert(writes.every(sql=>/ai_review_groups/.test(sql)));
  console.log("Temporary groups, progress, grading and storage isolation passed.");
} finally {
  delete globalThis.__knoopTestDb;
  await rm(dir,{recursive:true,force:true});
}
