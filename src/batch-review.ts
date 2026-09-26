import { db } from "./db";
import type { BankFile, ErrorReviewFile } from "./types";

export const SOURCES_PER_BATCH = 2;
export const MAX_SOURCES_PER_RUN = 12;
export const GENERATED_PER_SOURCE = 2;
export type BatchStatus = "pending" | "failed" | "ready";
export interface ReviewBatch {
  sourceKeys: string[];
  status: BatchStatus;
  banks: Record<string, BankFile>;
  generatedAtBySource?: Record<string,string>;
  error: string;
  savedGroupId?: string;
}
export interface BatchJob {
  id: string;
  model: string;
  review_json: string;
  batches_json: string;
  created_at: string;
  updated_at: string;
}
export const sourceKey = (bankId: string, questionId: string): string => JSON.stringify([bankId,questionId]);
export function jobReview(job: BatchJob): ErrorReviewFile { return JSON.parse(job.review_json) as ErrorReviewFile; }
export function jobBatches(job: BatchJob): ReviewBatch[] { return JSON.parse(job.batches_json) as ReviewBatch[]; }
export function makeBatches(review: ErrorReviewFile): ReviewBatch[] {
  const keys = review.items.map(item => sourceKey(item.bank.id,item.question.id));
  const batches: ReviewBatch[] = [];
  for (let i=0;i<keys.length;i+=SOURCES_PER_BATCH) batches.push({sourceKeys:keys.slice(i,i+SOURCES_PER_BATCH),status:"pending",banks:{},error:""});
  return batches;
}
export async function createBatchJob(review: ErrorReviewFile, model: string): Promise<string> {
  const id=crypto.randomUUID(), stamp=new Date().toISOString();
  await (await db()).execute(
    "INSERT INTO ai_review_batch_jobs(id,model,review_json,batches_json,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$5)",
    [id,model,JSON.stringify(review),JSON.stringify(makeBatches(review)),stamp]
  );
  return id;
}
export async function getBatchJob(id: string): Promise<BatchJob | null> {
  const rows=await (await db()).select<BatchJob[]>("SELECT * FROM ai_review_batch_jobs WHERE id=$1",[id]);
  return rows[0]??null;
}
export async function latestBatchJob(): Promise<BatchJob | null> {
  const rows=await (await db()).select<BatchJob[]>("SELECT * FROM ai_review_batch_jobs ORDER BY updated_at DESC LIMIT 1");
  return rows[0]??null;
}
export async function saveBatchJob(job: BatchJob, batches: ReviewBatch[]): Promise<void> {
  await (await db()).execute("UPDATE ai_review_batch_jobs SET batches_json=$2,updated_at=$3 WHERE id=$1",[job.id,JSON.stringify(batches),new Date().toISOString()]);
}
export async function deleteBatchJob(id: string): Promise<void> {
  await (await db()).execute("DELETE FROM ai_review_batch_jobs WHERE id=$1",[id]);
}
export function candidateFingerprint(question: BankFile["questions"][number]): string {
  return JSON.stringify({
    type:question.type,
    stem:question.stem?.trim().replace(/\s+/g," "),
    options:question.options?.map(o=>o.text.trim().replace(/\s+/g," ")),
    answer:question.answer
  });
}
export function checkedCandidateIds(batches: ReviewBatch[], exceptKey?: string): {ids:Set<string>; fingerprints:Set<string>} {
  const ids=new Set<string>(), fingerprints=new Set<string>();
  for (const batch of batches) for (const [key,bank] of Object.entries(batch.banks)) {
    if (key===exceptKey) continue;
    for (const q of bank.questions) {
      ids.add(q.id);
      fingerprints.add(candidateFingerprint(q));
    }
  }
  return {ids,fingerprints};
}
export function collectReadyCandidates(job: BatchJob, batches: ReviewBatch[]): {bank:BankFile; metadata:Array<{questionId:string;derivedFrom:string;generatedAt:string;model:string}>; batchIndexes:number[]} {
  const review=jobReview(job), itemByKey=new Map(review.items.map(item=>[sourceKey(item.bank.id,item.question.id),item]));
  const questions: BankFile["questions"]=[], metadata: Array<{questionId:string;derivedFrom:string;generatedAt:string;model:string}>=[], batchIndexes:number[]=[];
  const seenIds=new Set<string>(), seenContent=new Set<string>();
  batches.forEach((batch,index)=>{
    if(batch.status!=="ready"||batch.savedGroupId||metadata.length/GENERATED_PER_SOURCE+batch.sourceKeys.length>MAX_SOURCES_PER_RUN)return;
    if(batch.sourceKeys.some(key=>!batch.banks[key])) throw new Error("批次缺少校验结果");
    for(const key of batch.sourceKeys) {
      const item=itemByKey.get(key); if(!item)throw new Error("批次来源不存在");
      for(const q of batch.banks[key].questions) {
        const fingerprint=candidateFingerprint(q);
        if(seenIds.has(q.id)||seenContent.has(fingerprint))throw new Error("候选题跨批次重复，请重试失败批次");
        seenIds.add(q.id); seenContent.add(fingerprint);
        questions.push({...q,order:questions.length});
        metadata.push({questionId:q.id,derivedFrom:key,generatedAt:batch.generatedAtBySource?.[key]??job.created_at,model:job.model});
      }
    }
    batchIndexes.push(index);
  });
  const bank:BankFile={format:"knoop-bank",version:"1.1",import:{mode:"new",bankId:"knoop-ai-preview",bankTitle:"AI 临时回炉"},nodes:[{id:"review",parentId:null,title:"AI 回炉",order:0}],questions};
  return {bank,metadata,batchIndexes};
}
