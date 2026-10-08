import {db,atomicWrite,validateBank} from "./db";
import {prepareTempGroup} from "./temp-review";
import type {BankFile,QuestionInput} from "./types";
export interface AiDraft {id:string;source_question_id:string;source_question_title:string;source_question_json:string;bank_json:string;model:string;generated_at:string;created_at:string}
export async function listAiDrafts():Promise<AiDraft[]>{return (await db()).select<AiDraft[]>("SELECT * FROM ai_review_drafts ORDER BY created_at DESC,id");}
export async function getAiDraft(id:string):Promise<AiDraft|null>{return (await (await db()).select<AiDraft[]>("SELECT * FROM ai_review_drafts WHERE id=$1",[id]))[0]??null;}
export async function latestAiDraft(questionId:string):Promise<AiDraft|null>{return (await (await db()).select<AiDraft[]>("SELECT * FROM ai_review_drafts WHERE source_question_id=$1 ORDER BY created_at DESC,id LIMIT 1",[questionId]))[0]??null;}
export async function saveAiDraft(questionId:string,source:QuestionInput,bank:BankFile,model:string,generatedAt:string,id:string=crypto.randomUUID()):Promise<AiDraft>{
  validateBank(bank);if(bank.questions.length!==2)throw new Error("待审核草稿必须有 2 道候选题");
  const existing=await getAiDraft(id);if(existing){if(existing.bank_json!==JSON.stringify(bank)||existing.source_question_id!==questionId||existing.model!==model)throw new Error("草稿身份冲突");return existing;}
  const draft:AiDraft={id,source_question_id:questionId,source_question_title:String(source.stem??source.front??source.prompt??"原题").split("\n")[0],source_question_json:JSON.stringify(source),bank_json:JSON.stringify(bank),model,generated_at:generatedAt,created_at:new Date().toISOString()};
  await (await db()).execute("INSERT INTO ai_review_drafts(id,source_question_id,source_question_title,source_question_json,bank_json,model,generated_at,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8)",Object.values(draft));return draft;
}
export async function deleteAiDraft(id:string):Promise<void>{await (await db()).execute("DELETE FROM ai_review_drafts WHERE id=$1",[id]);}
export async function saveAiDraftToGroup(id:string):Promise<string|null>{
  const draft=await getAiDraft(id);if(!draft)return null;
  const bank=validateBank(JSON.parse(draft.bank_json)),ids=bank.questions.map(q=>q.id),query=`SELECT external_id FROM questions WHERE external_id IN (${ids.map((_,i)=>`$${i+1}`).join(",")})`;
  const prepared=prepareTempGroup(bank,draft.source_question_id,draft.source_question_title,draft.model,draft.generated_at,bank.questions.map(q=>({questionId:q.id,derivedFrom:draft.source_question_id,model:draft.model,generatedAt:draft.generated_at})));
  await atomicWrite([{sql:"SELECT * FROM ai_review_drafts WHERE id=$1",params:[id],expectedRows:[draft]},{sql:query,params:ids,expectedRows:[]},prepared.step,{sql:"DELETE FROM ai_review_drafts WHERE id=$1",params:[id],affectedRows:1}]);return prepared.id;
}
