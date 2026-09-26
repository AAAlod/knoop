import { db } from "./db";
import type { BankFile } from "./types";

export interface TempAnswer {
  questionId: string;
  answer: string | string[];
  correct: boolean;
  grading: "auto" | "manual";
}
export interface TempState {
  selection: string[];
  blank: string;
  submitted: boolean;
  pendingManual: boolean;
  correct?: boolean;
}
export interface TempGroup {
  id: string;
  source_question_id: string;
  source_question_title: string;
  model: string;
  generated_at: string;
  created_at: string;
  updated_at: string;
  bank_json: string;
  question_meta_json: string;
  current_index: number;
  state_json: string;
  results_json: string;
  completed_at: string | null;
}
export const emptyTempState = (): TempState => ({selection: [], blank: "", submitted: false, pendingManual: false});
export function tempBank(group: TempGroup): BankFile { return JSON.parse(group.bank_json) as BankFile; }
export function tempState(group: TempGroup): TempState { return {...emptyTempState(), ...JSON.parse(group.state_json)} as TempState; }
export function tempResults(group: TempGroup): TempAnswer[] { return JSON.parse(group.results_json) as TempAnswer[]; }
export async function createTempGroup(bank: BankFile, sourceId: string, sourceTitle: string, model: string, generatedAt: string): Promise<string> {
  return createTempGroupWithMetadata(bank,sourceId,sourceTitle,model,generatedAt,bank.questions.map(q => ({questionId:q.id,derivedFrom:sourceId,generatedAt,model})));
}
export async function createTempGroupWithMetadata(bank: BankFile, sourceId: string, sourceTitle: string, model: string, generatedAt: string, metadata: Array<{questionId:string;derivedFrom:string;generatedAt:string;model:string}>): Promise<string> {
  if (!bank.questions.length || metadata.length !== bank.questions.length || metadata.some((item,index)=>item.questionId!==bank.questions[index].id)) throw new Error("临时题组来源信息不完整");
  const id = crypto.randomUUID(), stamp = new Date().toISOString();
  await (await db()).execute(
    "INSERT INTO ai_review_groups(id,source_question_id,source_question_title,model,generated_at,created_at,updated_at,bank_json,question_meta_json,current_index,state_json,results_json) VALUES($1,$2,$3,$4,$5,$6,$6,$7,$8,0,$9,'[]')",
    [id,sourceId,sourceTitle,model,generatedAt,stamp,JSON.stringify(bank),JSON.stringify(metadata),JSON.stringify(emptyTempState())]
  );
  return id;
}
export async function listTempGroups(): Promise<TempGroup[]> {
  return (await db()).select<TempGroup[]>("SELECT * FROM ai_review_groups ORDER BY updated_at DESC");
}
export async function getTempGroup(id: string): Promise<TempGroup | null> {
  const rows = await (await db()).select<TempGroup[]>("SELECT * FROM ai_review_groups WHERE id=$1", [id]);
  return rows[0] ?? null;
}
export async function saveTempProgress(group: TempGroup, index: number, state: TempState, results: TempAnswer[], complete = false): Promise<void> {
  const stamp = new Date().toISOString();
  await (await db()).execute(
    "UPDATE ai_review_groups SET current_index=$2,state_json=$3,results_json=$4,updated_at=$5,completed_at=CASE WHEN $6=1 THEN $5 ELSE NULL END WHERE id=$1",
    [group.id,index,JSON.stringify(state),JSON.stringify(results),stamp,complete ? 1 : 0]
  );
}
export async function restartTempGroup(group: TempGroup): Promise<void> { await saveTempProgress(group,0,emptyTempState(),[]); }
export async function deleteTempGroup(id: string): Promise<void> { await (await db()).execute("DELETE FROM ai_review_groups WHERE id=$1", [id]); }
