// Fixed allowlist: never enumerate arbitrary database tables or localStorage keys.
export const backupTables = {
  banks: {id:"text",title:"text",created_at:"text",updated_at:"text"},
  nodes: {id:"text",external_id:"text",bank_id:"text",parent_id:"nullableText",title:"text",sort_order:"integer"},
  questions: {id:"text",external_id:"text",bank_id:"text",node_id:"text",type:"text",sort_order:"integer",content_json:"text",tags_json:"text",source_json:"nullableText"},
  sessions: {id:"text",mode:"text",scope_json:"text",question_ids_json:"text",current_index:"unsigned",state_json:"text",created_at:"text",updated_at:"text",completed_at:"nullableText"},
  attempts: {id:"positive",question_id:"text",session_id:"text",user_answer:"text",grading_mode:"text",is_correct:"flag",answered_at:"text"},
  favorites: {question_id:"text",created_at:"text"},
  killed_questions: {question_id:"text",created_at:"text"},
  notes: {question_id:"text",content:"text",updated_at:"text"},
  question_reviews: {question_id:"text",issues_json:"text",note:"text",question_snapshot_json:"text",was_killed_before:"flag",created_at:"text",updated_at:"text"},
  question_answer_revisions: {id:"positive",question_id:"text",last_attempt_id:"unsigned",previous_content_json:"text",updated_content_json:"text",changed_at:"text"},
  ai_review_groups: {id:"text",source_question_id:"text",source_question_title:"text",model:"text",generated_at:"text",created_at:"text",updated_at:"text",bank_json:"text",question_meta_json:"text",current_index:"unsigned",state_json:"text",results_json:"text",completed_at:"nullableText"},
  ai_review_batch_jobs: {id:"text",model:"text",review_json:"text",batches_json:"text",created_at:"text",updated_at:"text"},
  ai_review_drafts: {id:"text",source_question_id:"text",source_question_title:"text",source_question_json:"text",bank_json:"text",model:"text",generated_at:"text",created_at:"text"}
} as const;
export type BackupTable = keyof typeof backupTables;
export const preferenceKeys = ["knoop.scopeCollapsed.v1","knoop.enabledBrushTypes.v1","knoop.scopePresets.v2","knoop.recentScopePreset.v2"] as const;
export type Preferences = Record<typeof preferenceKeys[number],string|null>;
export type BackupRow = Record<string,string|number|null>;
export interface BackupFile {
  format:"knoop-backup";
  version:"1.1";
  appVersion:string;
  exportedAt:string;
  tables:Record<BackupTable,BackupRow[]>;
  counts:Record<BackupTable,number>;
  sequences:{attempts:number;question_answer_revisions:number};
  preferences:Preferences;
  integrity:{algorithm:"SHA-256";digest:string};
}
export function canonical(value:unknown):string {
  if(Array.isArray(value))return `[${value.map(canonical).join(",")}]`;
  if(value!==null&&typeof value==="object")return `{${Object.keys(value).sort().map(key=>`${JSON.stringify(key)}:${canonical((value as Record<string,unknown>)[key])}`).join(",")}}`;
  return JSON.stringify(value);
}
export async function backupDigest(file:Omit<BackupFile,"integrity">):Promise<string>{
  const digest=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(canonical(file)));
  return [...new Uint8Array(digest)].map(byte=>byte.toString(16).padStart(2,"0")).join("");
}
