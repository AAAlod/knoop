import Database from "@tauri-apps/plugin-sql";
import type { BankBundleFile, BankFile, BankRow, ErrorReviewFile, NodeRow, QuestionInput, QuestionRow, RepairReviewFile, ReviewIssue, ReviewRow, SessionRow } from "./types";
import { parseQuestion } from "./types";

let connection: Database | null = null;
const now = () => new Date().toISOString();
const bankKeyPrefix = (bankId: string) => `${bankId.length}:${bankId}::`;
const key = (bankId: string, externalId: string) => `${bankKeyPrefix(bankId)}${externalId}`;

export async function db(): Promise<Database> {
  if (connection) return connection;
  connection = await Database.load("sqlite:knoop.db");
  const schema = [
    "PRAGMA foreign_keys = ON",
    `CREATE TABLE IF NOT EXISTS banks (id TEXT PRIMARY KEY, title TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS nodes (id TEXT PRIMARY KEY, external_id TEXT NOT NULL, bank_id TEXT NOT NULL, parent_id TEXT, title TEXT NOT NULL, sort_order INTEGER NOT NULL, UNIQUE(bank_id, external_id))`,
    `CREATE TABLE IF NOT EXISTS questions (id TEXT PRIMARY KEY, external_id TEXT NOT NULL, bank_id TEXT NOT NULL, node_id TEXT NOT NULL, type TEXT NOT NULL, sort_order INTEGER NOT NULL, content_json TEXT NOT NULL, tags_json TEXT NOT NULL DEFAULT '[]', source_json TEXT, UNIQUE(bank_id, external_id))`,
    `CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, mode TEXT NOT NULL, scope_json TEXT NOT NULL, question_ids_json TEXT NOT NULL, current_index INTEGER NOT NULL DEFAULT 0, state_json TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL, updated_at TEXT NOT NULL, completed_at TEXT)`,
    `CREATE TABLE IF NOT EXISTS attempts (id INTEGER PRIMARY KEY AUTOINCREMENT, question_id TEXT NOT NULL, session_id TEXT NOT NULL, user_answer TEXT NOT NULL, grading_mode TEXT NOT NULL, is_correct INTEGER NOT NULL, answered_at TEXT NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS favorites (question_id TEXT PRIMARY KEY, created_at TEXT NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS killed_questions (question_id TEXT PRIMARY KEY, created_at TEXT NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS notes (question_id TEXT PRIMARY KEY, content TEXT NOT NULL, updated_at TEXT NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS question_reviews (question_id TEXT PRIMARY KEY, issues_json TEXT NOT NULL DEFAULT '[]', note TEXT NOT NULL DEFAULT '', question_snapshot_json TEXT NOT NULL, was_killed_before INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS ai_review_batch_jobs (id TEXT PRIMARY KEY, model TEXT NOT NULL, review_json TEXT NOT NULL, batches_json TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS ai_review_groups (id TEXT PRIMARY KEY, source_question_id TEXT NOT NULL, source_question_title TEXT NOT NULL, model TEXT NOT NULL, generated_at TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, bank_json TEXT NOT NULL, question_meta_json TEXT NOT NULL, current_index INTEGER NOT NULL DEFAULT 0, state_json TEXT NOT NULL DEFAULT '{}', results_json TEXT NOT NULL DEFAULT '[]', completed_at TEXT)`,
    "CREATE INDEX IF NOT EXISTS idx_questions_node ON questions(node_id)",
    "CREATE INDEX IF NOT EXISTS idx_attempts_question ON attempts(question_id, id DESC)"
  ];
  for (const sql of schema) await connection.execute(sql);
  return connection;
}

function assertText(value: unknown, name: string): asserts value is string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${name} 必须是非空字符串`);
}
const controlCharPattern = /[\u0000-\u001F\u007F]/;
function assertIdentifier(value: unknown, name: string): asserts value is string {
  assertText(value, name);
  if (value !== value.trim()) throw new Error(`${name} 首尾不能包含空白字符`);
  if (controlCharPattern.test(value)) throw new Error(`${name} 不能包含控制字符`);
}
function assertOptionIdentifier(value: unknown, name: string): asserts value is string {
  assertText(value, name);
  if (value !== value.trim() || controlCharPattern.test(value)) throw new Error(`${name} 不能包含首尾空白或控制字符`);
}
function assertOptionalText(value: unknown, name: string): void {
  if (value !== undefined && typeof value !== "string") throw new Error(`${name} 必须是字符串`);
}
function assertTags(value: unknown, name: string): void {
  if (value === undefined) return;
  if (!Array.isArray(value) || value.some(x => typeof x !== "string" || !x.trim()) || new Set(value).size !== value.length) throw new Error(`${name} 必须是不重复的非空字符串数组`);
}

export function validateBank(raw: unknown): BankFile {
  if (!raw || typeof raw !== "object") throw new Error("题库顶层必须是对象");
  const file = raw as BankFile;
  if (file.format !== "knoop-bank" || !["1.0", "1.1"].includes(file.version)) throw new Error("不支持的题库格式或版本");
  if (!file.import || !["new", "merge"].includes(file.import.mode)) throw new Error("import.mode 必须为 new 或 merge");
  assertIdentifier(file.import.bankId, "bankId"); assertText(file.import.bankTitle, "bankTitle");
  if (!Array.isArray(file.nodes) || !Array.isArray(file.questions)) throw new Error("nodes 和 questions 必须是数组");
  const nodeIds = new Set<string>();
  for (const node of file.nodes) {
    assertIdentifier(node.id, "Node.id"); assertText(node.title, `Node ${node.id} title`);
    if (node.parentId !== null) assertIdentifier(node.parentId, `Node ${node.id} parentId`);
    if (nodeIds.has(node.id)) throw new Error(`Node ID 重复：${node.id}`);
    if (!Number.isInteger(node.order)) throw new Error(`Node ${node.id} order 必须是整数`);
    nodeIds.add(node.id);
  }
  const visiting = new Set<string>(); const visited = new Set<string>();
  const parents = new Map(file.nodes.map(n => [n.id, n.parentId]));
  const visit = (id: string) => {
    if (visiting.has(id)) throw new Error(`Node 存在循环：${id}`);
    if (visited.has(id)) return;
    visiting.add(id); const parent = parents.get(id);
    if (parent && parents.has(parent)) visit(parent);
    visiting.delete(id); visited.add(id);
  };
  file.nodes.forEach(n => visit(n.id));
  const questionIds = new Set<string>();
  for (const q of file.questions) {
    assertIdentifier(q.id, "Question.id"); assertIdentifier(q.nodeId, `Question ${q.id} nodeId`);
    if (questionIds.has(q.id)) throw new Error(`Question ID 重复：${q.id}`);
    if (!nodeIds.has(q.nodeId) && file.import.mode === "new") throw new Error(`Question ${q.id} 引用了不存在的 Node`);
    if (!["single_choice", "multiple_choice", "blank", "recall", "memorization"].includes(q.type)) throw new Error(`Question ${q.id} 题型不支持`);
    if (q.type === "memorization" && file.version !== "1.1") throw new Error(`Question ${q.id} 使用 memorization 时题库版本必须为 1.1`);
    if (!Number.isInteger(q.order)) throw new Error(`Question ${q.id} order 必须是整数`);
    assertOptionalText(q.explanation, `${q.id}.explanation`); assertTags(q.tags, `${q.id}.tags`);
    if (q.type === "recall") {
      assertText(q.front, `${q.id}.front`); assertText(q.back, `${q.id}.back`);
    } else if (q.type === "memorization") {
      assertText(q.prompt, `${q.id}.prompt`); assertText(q.content, `${q.id}.content`);
      if (q.keyPoints !== undefined && (!Array.isArray(q.keyPoints) || q.keyPoints.some(x => typeof x !== "string" || !x.trim()) || new Set(q.keyPoints).size !== q.keyPoints.length)) throw new Error(`${q.id}.keyPoints 必须是不重复的非空字符串数组`);
    } else {
      assertText(q.stem, `${q.id}.stem`);
    }
    if (q.type === "single_choice" || q.type === "multiple_choice") {
      if (!Array.isArray(q.options) || q.options.length < 2) throw new Error(`${q.id} 至少需要两个选项`);
      const optionIds = new Set<string>();
      q.options.forEach(o => { assertOptionIdentifier(o.id, `${q.id} option.id`); assertText(o.text, `${q.id} option.text`); if (optionIds.has(o.id)) throw new Error(`${q.id} 选项 ID 重复`); optionIds.add(o.id); });
      const answers = Array.isArray(q.answer) ? q.answer : [q.answer];
      if ((q.type === "single_choice" && typeof q.answer !== "string") || (q.type === "multiple_choice" && (!Array.isArray(q.answer) || !q.answer.length || new Set(q.answer).size !== q.answer.length)) || answers.some(a => typeof a !== "string" || !optionIds.has(a))) throw new Error(`${q.id} 答案不是有效选项或包含重复项`);
    }
    if (q.type === "blank" && typeof q.answer !== "string") throw new Error(`${q.id} 填空答案必须是字符串`);
    questionIds.add(q.id);
  }
  return file;
}

export function validateBundle(raw: unknown): BankBundleFile {
  if (!raw || typeof raw !== "object") throw new Error("题库包顶层必须是对象");
  const file = raw as BankBundleFile;
  if (file.format !== "knoop-bundle" || file.version !== "1.0") throw new Error("不支持的题库包格式或版本");
  assertText(file.exportedAt, "题库包 exportedAt");
  if (!Array.isArray(file.banks) || !file.banks.length) throw new Error("题库包 banks 必须是非空数组");
  const ids = new Set<string>();
  for (const rawBank of file.banks as unknown[]) {
    if (!rawBank || typeof rawBank !== "object") continue;
    const bankId = (rawBank as { import?: { bankId?: unknown } }).import?.bankId;
    if (typeof bankId !== "string" || !bankId.trim()) continue;
    if (ids.has(bankId)) throw new Error(`题库包内 bankId 重复：${bankId}`);
    ids.add(bankId);
  }
  return file;
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    return `{${Object.keys(obj).sort().map(k => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

async function finishReviewOnConnection(conn: Database, review: ReviewRow): Promise<void> {
  await conn.execute("DELETE FROM question_reviews WHERE question_id=$1", [review.question_id]);
  if (!review.was_killed_before) await conn.execute("DELETE FROM killed_questions WHERE question_id=$1", [review.question_id]);
  await conn.execute("DELETE FROM attempts WHERE question_id=$1", [review.question_id]);
}

export async function importBank(file: BankFile): Promise<{ repaired: number }> {
  const conn = await db();
  const existing = await conn.select<BankRow[]>("SELECT id, title FROM banks WHERE id = $1", [file.import.bankId]);
  if (file.import.mode === "new" && existing.length) throw new Error(`题库 ${file.import.bankId} 已存在`);
  if (file.import.mode === "merge" && !existing.length) throw new Error(`要合并的题库 ${file.import.bankId} 不存在`);
  const localNodes = await conn.select<NodeRow[]>("SELECT * FROM nodes WHERE bank_id = $1", [file.import.bankId]);
  const validExternalNodes = new Set([...localNodes.map(n => n.external_id), ...file.nodes.map(n => n.id)]);
  for (const n of file.nodes) if (n.parentId && !validExternalNodes.has(n.parentId)) throw new Error(`Node ${n.id} 的父节点不存在：${n.parentId}`);
  for (const q of file.questions) if (!validExternalNodes.has(q.nodeId)) throw new Error(`Question ${q.id} 的 Node 不存在：${q.nodeId}`);
  const externalByKey = new Map(localNodes.map(n => [n.id, n.external_id]));
  const mergedParents = new Map(localNodes.map(n => [n.external_id, n.parent_id ? (externalByKey.get(n.parent_id) ?? null) : null]));
  file.nodes.forEach(n => mergedParents.set(n.id, n.parentId));
  for (const start of mergedParents.keys()) {
    const path = new Set<string>(); let current: string | null | undefined = start;
    while (current) { if (path.has(current)) throw new Error(`Node 合并后形成循环：${start}`); path.add(current); current = mergedParents.get(current); }
  }
  const reviewedRows = file.import.mode === "merge"
    ? await conn.select<ReviewRow[]>("SELECT r.* FROM question_reviews r JOIN questions q ON q.id=r.question_id WHERE q.bank_id=$1", [file.import.bankId])
    : [];
  const reviewByQuestionId = new Map(reviewedRows.map(r => [r.question_id, r]));
  const stamp = now();
  await conn.execute("INSERT INTO banks(id,title,created_at,updated_at) VALUES($1,$2,$3,$3) ON CONFLICT(id) DO UPDATE SET title=$2,updated_at=$3", [file.import.bankId, file.import.bankTitle, stamp]);
  for (const n of file.nodes) await conn.execute(
    "INSERT INTO nodes(id,external_id,bank_id,parent_id,title,sort_order) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(id) DO UPDATE SET parent_id=$4,title=$5,sort_order=$6",
    [key(file.import.bankId, n.id), n.id, file.import.bankId, n.parentId ? key(file.import.bankId, n.parentId) : null, n.title, n.order]
  );
  let repaired = 0;
  for (const q of file.questions) {
    const questionId = key(file.import.bankId, q.id);
    const contentJson = JSON.stringify(q);
    await conn.execute(
      "INSERT INTO questions(id,external_id,bank_id,node_id,type,sort_order,content_json,tags_json,source_json) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT(id) DO UPDATE SET node_id=$4,type=$5,sort_order=$6,content_json=$7,tags_json=$8,source_json=$9",
      [questionId, q.id, file.import.bankId, key(file.import.bankId, q.nodeId), q.type, q.order, contentJson, JSON.stringify(q.tags ?? []), q.source === undefined ? null : JSON.stringify(q.source)]
    );
    const review = reviewByQuestionId.get(questionId);
    if (review && canonicalJson(JSON.parse(review.question_snapshot_json)) !== canonicalJson(q)) {
      await finishReviewOnConnection(conn, review);
      repaired++;
    }
  }
  return { repaired };
}

export async function getBanks() { return (await db()).select<BankRow[]>("SELECT id,title,created_at,updated_at FROM banks ORDER BY created_at"); }
export async function librarySummary() {
  const conn = await db();
  const bank = (await conn.select<{n:number}[]>("SELECT COUNT(*) n FROM banks"))[0]?.n ?? 0;
  const questions = (await conn.select<{n:number}[]>("SELECT COUNT(*) n FROM questions WHERE type IN ('single_choice','multiple_choice','blank','recall') AND id NOT IN (SELECT question_id FROM killed_questions)"))[0]?.n ?? 0;
  return { banks: bank, questions };
}
export async function getNodes(bankId?: string) { return (await db()).select<NodeRow[]>(`SELECT * FROM nodes${bankId ? " WHERE bank_id = $1" : ""} ORDER BY sort_order,title`, bankId ? [bankId] : []); }
const sqlChunkSize = 400;
function chunks<T>(items: T[], size = sqlChunkSize): T[][] { const out:T[][]=[]; for(let i=0;i<items.length;i+=size) out.push(items.slice(i,i+size)); return out; }
export async function getQuestions(ids?: string[]) {
  const conn = await db();
  if (!ids) return conn.select<QuestionRow[]>("SELECT * FROM questions ORDER BY bank_id,sort_order");
  const unique=[...new Set(ids)]; if (!unique.length) return [];
  const rows:QuestionRow[]=[];
  for(const part of chunks(unique)) rows.push(...await conn.select<QuestionRow[]>(`SELECT * FROM questions WHERE id IN (${part.map((_, i) => `$${i + 1}`).join(",")})`, part));
  return rows;
}
export async function questionsForScope(nodeIds: string[]) {
  if (!nodeIds.length) return [];
  const conn = await db();
  const uniqueNodeIds=[...new Set(nodeIds)]; const rows:QuestionRow[]=[];
  for(const part of chunks(uniqueNodeIds)) rows.push(...await conn.select<QuestionRow[]>(`SELECT * FROM questions WHERE node_id IN (${part.map((_, i) => `$${i + 1}`).join(",")}) AND id NOT IN (SELECT question_id FROM killed_questions)`, part));
  const nodes = await getNodes(); const banks = await getBanks();
  const children = new Map<string | null, NodeRow[]>();
  for (const n of nodes) { const k = n.parent_id; children.set(k, [...(children.get(k) ?? []), n]); }
  for (const list of children.values()) list.sort((a,b) => a.sort_order-b.sort_order || a.title.localeCompare(b.title));
  const nodeOrder = new Map<string, number>(); let index = 0;
  const visit = (n: NodeRow) => { nodeOrder.set(n.id, index++); for (const c of children.get(n.id) ?? []) visit(c); };
  const bankOrder = new Map(banks.map((b, i) => [b.id, i]));
  for (const bank of banks) for (const root of (children.get(null) ?? []).filter(n => n.bank_id === bank.id)) visit(root);
  return rows.sort((a,b) => (bankOrder.get(a.bank_id) ?? 9999) - (bankOrder.get(b.bank_id) ?? 9999) || (nodeOrder.get(a.node_id) ?? 999999) - (nodeOrder.get(b.node_id) ?? 999999) || a.sort_order - b.sort_order || a.id.localeCompare(b.id));
}

export async function updateQuestionContent(questionId: string, content: QuestionInput): Promise<void> {
  const conn = await db();
  const rows = await conn.select<QuestionRow[]>("SELECT * FROM questions WHERE id=$1", [questionId]);
  const row = rows[0];
  if (!row) throw new Error("题目不存在");
  const existing = JSON.parse(row.content_json) as QuestionInput;
  if (content.id !== existing.id || content.nodeId !== existing.nodeId || content.type !== existing.type) throw new Error("编辑不能修改题目 ID、所属节点或题型");
  await conn.execute("UPDATE questions SET content_json=$2,tags_json=$3,source_json=$4 WHERE id=$1", [questionId, JSON.stringify(content), JSON.stringify(content.tags ?? []), content.source === undefined ? null : JSON.stringify(content.source)]);
  await conn.execute("UPDATE banks SET updated_at=$2 WHERE id=$1", [row.bank_id, now()]);
}

export async function deleteBank(bankId: string): Promise<void> {
  const conn = await db();
  const steps: Array<[string, unknown[]]> = [
    ["DELETE FROM question_reviews WHERE question_id IN (SELECT id FROM questions WHERE bank_id=$1)", [bankId]],
    ["DELETE FROM killed_questions WHERE question_id IN (SELECT id FROM questions WHERE bank_id=$1)", [bankId]],
    ["DELETE FROM notes WHERE question_id IN (SELECT id FROM questions WHERE bank_id=$1)", [bankId]],
    ["DELETE FROM favorites WHERE question_id IN (SELECT id FROM questions WHERE bank_id=$1)", [bankId]],
    ["DELETE FROM attempts WHERE question_id IN (SELECT id FROM questions WHERE bank_id=$1)", [bankId]],
    ["DELETE FROM sessions WHERE instr(question_ids_json,$1)>0", [`\"${bankKeyPrefix(bankId)}`]],
    ["DELETE FROM questions WHERE bank_id=$1", [bankId]],
    ["DELETE FROM nodes WHERE bank_id=$1", [bankId]],
    ["DELETE FROM banks WHERE id=$1", [bankId]]
  ];
  try {
    for (const [sql, params] of steps) await conn.execute(sql, params);
  } catch (error) {
    const text = error instanceof Error ? error.message : String(error);
    if (/database is locked|database is busy|SQLITE_BUSY/i.test(text)) {
      throw new Error("数据库正被占用。请完全退出应用（必要时在系统设置中强行停止）后重新打开再删除；不要清除应用数据。");
    }
    throw error;
  }
}

export async function createSession(mode: string, scope: unknown, questionIds: string[], startIndex = 0) {
  const id = crypto.randomUUID(), stamp = now();
  const safeIndex = Math.max(0, Math.min(Math.trunc(startIndex), Math.max(0, questionIds.length - 1)));
  await (await db()).execute("INSERT INTO sessions(id,mode,scope_json,question_ids_json,current_index,state_json,created_at,updated_at) VALUES($1,$2,$3,$4,$5,'{}',$6,$6)", [id, mode, JSON.stringify(scope), JSON.stringify(questionIds), safeIndex, stamp]);
  return id;
}
export async function latestSession() { const rows = await (await db()).select<SessionRow[]>("SELECT * FROM sessions WHERE completed_at IS NULL ORDER BY updated_at DESC LIMIT 1"); return rows[0] ?? null; }
export async function sessionById(id: string) { const rows = await (await db()).select<SessionRow[]>("SELECT * FROM sessions WHERE id=$1", [id]); return rows[0] ?? null; }
export async function saveSession(id: string, index: number, state: unknown, complete = false) { const stamp = now(); await (await db()).execute("UPDATE sessions SET current_index=$2,state_json=$3,updated_at=$4,completed_at=CASE WHEN $5=1 THEN $4 ELSE completed_at END WHERE id=$1", [id,index,JSON.stringify(state),stamp,complete ? 1 : 0]); }
export async function addAttempt(questionId: string, sessionId: string, answer: unknown, gradingMode: string, correct: boolean) { await (await db()).execute("INSERT INTO attempts(question_id,session_id,user_answer,grading_mode,is_correct,answered_at) VALUES($1,$2,$3,$4,$5,$6)", [questionId,sessionId,JSON.stringify(answer),gradingMode,correct ? 1 : 0,now()]); }
export async function isFavorite(questionId: string) { const rows = await (await db()).select<{n:number}[]>("SELECT COUNT(*) n FROM favorites WHERE question_id=$1", [questionId]); return rows[0].n > 0; }
export async function toggleFavorite(questionId: string) { const conn = await db(); if (await isFavorite(questionId)) await conn.execute("DELETE FROM favorites WHERE question_id=$1", [questionId]); else await conn.execute("INSERT INTO favorites(question_id,created_at) VALUES($1,$2)", [questionId,now()]); return isFavorite(questionId); }

export async function isKilled(questionId: string) { const rows = await (await db()).select<{n:number}[]>("SELECT COUNT(*) n FROM killed_questions WHERE question_id=$1", [questionId]); return rows[0].n > 0; }
export async function toggleKilled(questionId: string) {
  const conn = await db();
  if (await isKilled(questionId)) await conn.execute("DELETE FROM killed_questions WHERE question_id=$1", [questionId]);
  else await conn.execute("INSERT INTO killed_questions(question_id,created_at) VALUES($1,$2)", [questionId,now()]);
  return isKilled(questionId);
}
export async function killedQuestions() { return (await db()).select<QuestionRow[]>("SELECT q.* FROM questions q JOIN killed_questions k ON k.question_id=q.id WHERE q.id NOT IN (SELECT question_id FROM question_reviews) ORDER BY k.created_at DESC"); }

export async function getNote(questionId: string) {
  const rows = await (await db()).select<{content:string;updated_at:string}[]>("SELECT content,updated_at FROM notes WHERE question_id=$1", [questionId]);
  return rows[0] ?? null;
}
export async function saveNote(questionId: string, content: string) {
  const conn = await db(); const value = content.trim();
  if (!value) { await conn.execute("DELETE FROM notes WHERE question_id=$1", [questionId]); return; }
  await conn.execute("INSERT INTO notes(question_id,content,updated_at) VALUES($1,$2,$3) ON CONFLICT(question_id) DO UPDATE SET content=$2,updated_at=$3", [questionId,value,now()]);
}
export async function noteQuestions() {
  return (await db()).select<(QuestionRow & {note_content:string;note_updated_at:string})[]>(`
    SELECT q.*, n.content AS note_content, n.updated_at AS note_updated_at
    FROM questions q JOIN notes n ON n.question_id=q.id
    ORDER BY n.updated_at DESC
  `);
}

export async function wrongQuestions() {
  return (await db()).select<(QuestionRow & {latest_user_answer:string;latest_grading_mode:string;latest_answered_at:string})[]>(`
    SELECT q.*, a.user_answer AS latest_user_answer, a.grading_mode AS latest_grading_mode, a.answered_at AS latest_answered_at
    FROM questions q JOIN attempts a ON a.question_id=q.id
    WHERE q.id NOT IN (SELECT question_id FROM killed_questions)
      AND q.id NOT IN (SELECT question_id FROM question_reviews)
      AND a.id=(SELECT a2.id FROM attempts a2 WHERE a2.question_id=q.id ORDER BY a2.id DESC LIMIT 1)
      AND a.is_correct=0
    ORDER BY a.answered_at DESC
  `);
}
export async function favoriteQuestions() { return (await db()).select<QuestionRow[]>("SELECT q.* FROM questions q JOIN favorites f ON f.question_id=q.id WHERE q.id NOT IN (SELECT question_id FROM killed_questions) AND q.id NOT IN (SELECT question_id FROM question_reviews) ORDER BY f.created_at DESC"); }
export async function stats() {
  const conn = await db();
  const a = (await conn.select<{total:number;correct:number}[]>("SELECT COUNT(*) total, COALESCE(SUM(a.is_correct),0) correct FROM attempts a WHERE a.question_id NOT IN (SELECT question_id FROM question_reviews)"))[0];
  const w = (await conn.select<{n:number}[]>("SELECT COUNT(*) n FROM questions q JOIN attempts a ON a.question_id=q.id WHERE q.id NOT IN (SELECT question_id FROM killed_questions) AND q.id NOT IN (SELECT question_id FROM question_reviews) AND a.id=(SELECT a2.id FROM attempts a2 WHERE a2.question_id=q.id ORDER BY a2.id DESC LIMIT 1) AND a.is_correct=0"))[0].n;
  return {total:a.total,correct:a.correct,wrong:a.total-a.correct,rate:a.total ? Math.round(a.correct/a.total*100) : 0,currentWrong:w};
}

const reviewIssues = new Set<ReviewIssue>(["stem", "options", "answer", "explanation", "other"]);

export async function getReview(questionId: string): Promise<ReviewRow | null> {
  const rows = await (await db()).select<ReviewRow[]>("SELECT * FROM question_reviews WHERE question_id=$1", [questionId]);
  return rows[0] ?? null;
}
export async function isReviewed(questionId: string): Promise<boolean> { return (await getReview(questionId)) !== null; }
export async function saveReview(questionId: string, issues: ReviewIssue[], note: string, refreshSnapshot = false): Promise<void> {
  const conn = await db();
  const cleanIssues = [...new Set(issues.filter(x => reviewIssues.has(x)))];
  const cleanNote = note.trim();
  if (!cleanIssues.length && !cleanNote) throw new Error("请选择问题位置或填写审核意见");
  const q = (await conn.select<QuestionRow[]>("SELECT * FROM questions WHERE id=$1", [questionId]))[0];
  if (!q) throw new Error("题目不存在");
  const existing = (await conn.select<ReviewRow[]>("SELECT * FROM question_reviews WHERE question_id=$1", [questionId]))[0];
  const stamp = now();
  if (existing) {
    await conn.execute(refreshSnapshot
      ? "UPDATE question_reviews SET issues_json=$2,note=$3,question_snapshot_json=$4,updated_at=$5 WHERE question_id=$1"
      : "UPDATE question_reviews SET issues_json=$2,note=$3,updated_at=$4 WHERE question_id=$1",
      refreshSnapshot
        ? [questionId, JSON.stringify(cleanIssues), cleanNote, q.content_json, stamp]
        : [questionId, JSON.stringify(cleanIssues), cleanNote, stamp]);
  } else {
    const killed = await isKilled(questionId);
    await conn.execute("INSERT INTO question_reviews(question_id,issues_json,note,question_snapshot_json,was_killed_before,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$6)", [questionId, JSON.stringify(cleanIssues), cleanNote, q.content_json, killed ? 1 : 0, stamp]);
    if (!killed) await conn.execute("INSERT OR IGNORE INTO killed_questions(question_id,created_at) VALUES($1,$2)", [questionId, stamp]);
  }
}
export async function cancelReview(questionId: string): Promise<void> {
  const conn = await db();
  const review = (await conn.select<ReviewRow[]>("SELECT * FROM question_reviews WHERE question_id=$1", [questionId]))[0];
  if (!review) return;
  await conn.execute("DELETE FROM question_reviews WHERE question_id=$1", [questionId]);
  if (!review.was_killed_before) await conn.execute("DELETE FROM killed_questions WHERE question_id=$1", [questionId]);
}
export async function completeReview(questionId: string): Promise<void> {
  const conn = await db();
  const review = (await conn.select<ReviewRow[]>("SELECT * FROM question_reviews WHERE question_id=$1", [questionId]))[0];
  if (!review) return;
  await finishReviewOnConnection(conn, review);
}
export async function reviewQuestions() {
  return (await db()).select<(QuestionRow & {review_issues_json:string;review_note:string;review_created_at:string;review_updated_at:string;latest_user_answer:string|null;latest_grading_mode:string|null;latest_answered_at:string|null;latest_is_correct:number|null})[]>(`
    SELECT q.*, r.issues_json AS review_issues_json, r.note AS review_note, r.created_at AS review_created_at, r.updated_at AS review_updated_at,
           a.user_answer AS latest_user_answer, a.grading_mode AS latest_grading_mode, a.answered_at AS latest_answered_at, a.is_correct AS latest_is_correct
    FROM questions q
    JOIN question_reviews r ON r.question_id=q.id
    LEFT JOIN attempts a ON a.id=(SELECT a2.id FROM attempts a2 WHERE a2.question_id=q.id ORDER BY a2.id DESC LIMIT 1)
    ORDER BY r.updated_at DESC
  `);
}

export async function buildRepairReview(): Promise<RepairReviewFile> {
  const conn = await db();
  type Row = QuestionRow & { bank_title:string; node_title:string; issues_json:string; review_note:string; review_created_at:string; review_updated_at:string; latest_user_answer:string|null; latest_grading_mode:string|null; latest_answered_at:string|null; latest_is_correct:number|null };
  const rows = await conn.select<Row[]>(`
    SELECT q.*, b.title AS bank_title, n.title AS node_title,
           r.issues_json, r.note AS review_note, r.created_at AS review_created_at, r.updated_at AS review_updated_at,
           a.user_answer AS latest_user_answer, a.grading_mode AS latest_grading_mode, a.answered_at AS latest_answered_at, a.is_correct AS latest_is_correct
    FROM question_reviews r
    JOIN questions q ON q.id=r.question_id
    JOIN banks b ON b.id=q.bank_id
    JOIN nodes n ON n.id=q.node_id
    LEFT JOIN attempts a ON a.id=(SELECT a2.id FROM attempts a2 WHERE a2.question_id=q.id ORDER BY a2.id DESC LIMIT 1)
    ORDER BY r.updated_at DESC
  `);
  const allNodes = await getNodes(); const nodeById = new Map(allNodes.map(n => [n.id,n]));
  const pathFor=(nodeId:string)=>{const titles:string[]=[];const seen=new Set<string>();let current=nodeById.get(nodeId);while(current&&!seen.has(current.id)){seen.add(current.id);titles.unshift(current.title);current=current.parent_id?nodeById.get(current.parent_id):undefined;}return titles;};
  return {
    format: "knoop-repair-review",
    version: "1.1",
    exportedAt: now(),
    aiGuidance: {
      purpose: "检查或返修用户标记的问题题目。",
      firstStep: "若用户未说明处理方式，先确认是检查用户修改还是直接返修；若审核意见注明用户已修改，则默认先检查，不擅自重写。若用户已明确要求，则直接执行。",
      output: "直接返修原题时保持原 bankId 和 question.id，并输出 knoop-bank merge；变式题使用新 question.id。"
    },
    items: rows.map(row => {
      const q = parseQuestion(row);
      const item: RepairReviewFile["items"][number] = {
        bank: { id: row.bank_id, title: row.bank_title },
        node: { id: nodeById.get(row.node_id)?.external_id ?? row.node_id, title: row.node_title, path: pathFor(row.node_id) },
        question: q,
        review: { issues: JSON.parse(row.issues_json) as ReviewIssue[], note: row.review_note, markedAt: row.review_created_at, updatedAt: row.review_updated_at }
      };
      if (row.latest_answered_at && row.latest_user_answer !== null && row.latest_grading_mode !== null && row.latest_is_correct !== null) {
        item.latestAttempt = { answeredAt: row.latest_answered_at, userAnswer: normalizeAnswer(q,row.latest_user_answer), gradingMode: row.latest_grading_mode, isCorrect: !!row.latest_is_correct };
      }
      return item;
    })
  };
}

export async function buildBankExport(bankId: string): Promise<BankFile> {
  const conn = await db();
  const bank = (await conn.select<BankRow[]>("SELECT id,title,created_at,updated_at FROM banks WHERE id=$1", [bankId]))[0];
  if (!bank) throw new Error("题库不存在");
  const nodes = await getNodes(bankId);
  const questions = await conn.select<QuestionRow[]>("SELECT * FROM questions WHERE bank_id=$1 ORDER BY sort_order,id", [bankId]);
  const nodeById = new Map(nodes.map(n => [n.id, n]));
  const version: BankFile["version"] = questions.some(q => q.type === "memorization") ? "1.1" : "1.0";
  return {
    format: "knoop-bank",
    version,
    import: { mode: "new", bankId: bank.id, bankTitle: bank.title },
    nodes: nodes.map(n => ({
      id: n.external_id,
      parentId: n.parent_id ? (nodeById.get(n.parent_id)?.external_id ?? null) : null,
      title: n.title,
      order: n.sort_order
    })),
    questions: questions.map(parseQuestion)
  };
}

export async function buildBundleExport(bankIds: string[]): Promise<BankBundleFile> {
  const unique = [...new Set(bankIds.filter(Boolean))];
  if (unique.length < 2) throw new Error("至少选择两个题库才能导出题库包");
  const banks: BankFile[] = [];
  for (const bankId of unique) banks.push(await buildBankExport(bankId));
  return { format: "knoop-bundle", version: "1.0", exportedAt: now(), banks };
}

function parseStoredAnswer(raw: string): unknown {
  try { return JSON.parse(raw); } catch { return raw; }
}
function normalizeAnswer(q: QuestionInput, raw: string): string | string[] {
  const parsed = parseStoredAnswer(raw);
  if (q.type === "multiple_choice") return Array.isArray(parsed) ? parsed.map(String) : [String(parsed ?? "")].filter(Boolean);
  if (q.type === "single_choice") return Array.isArray(parsed) ? String(parsed[0] ?? "") : String(parsed ?? "");
  return typeof parsed === "string" ? parsed : String(parsed ?? "");
}

export async function buildCurrentWrongReview(): Promise<ErrorReviewFile> {
  const conn = await db();
  type WrongRow = QuestionRow & { bank_title: string; node_title: string; latest_user_answer: string; latest_grading_mode: string; latest_answered_at: string; attempt_count: number; wrong_count: number };
  const rows = await conn.select<WrongRow[]>(`
    SELECT q.*, b.title AS bank_title, n.title AS node_title,
           a.user_answer AS latest_user_answer, a.grading_mode AS latest_grading_mode, a.answered_at AS latest_answered_at,
           (SELECT COUNT(*) FROM attempts ax WHERE ax.question_id=q.id) AS attempt_count,
           (SELECT COUNT(*) FROM attempts ax WHERE ax.question_id=q.id AND ax.is_correct=0) AS wrong_count
    FROM questions q
    JOIN banks b ON b.id=q.bank_id
    JOIN nodes n ON n.id=q.node_id
    JOIN attempts a ON a.question_id=q.id
    WHERE q.type IN ('single_choice','multiple_choice','blank')
      AND q.id NOT IN (SELECT question_id FROM killed_questions)
      AND q.id NOT IN (SELECT question_id FROM question_reviews)
      AND a.id=(SELECT a2.id FROM attempts a2 WHERE a2.question_id=q.id ORDER BY a2.id DESC LIMIT 1)
      AND a.is_correct=0
    ORDER BY a.answered_at DESC
  `);
  const allNodes = await getNodes();
  const nodeById = new Map(allNodes.map(n => [n.id, n]));
  const pathFor = (nodeId: string) => {
    const titles: string[] = []; const seen = new Set<string>(); let current = nodeById.get(nodeId);
    while (current && !seen.has(current.id)) { seen.add(current.id); titles.unshift(current.title); current = current.parent_id ? nodeById.get(current.parent_id) : undefined; }
    return titles;
  };
  const items: ErrorReviewFile["items"] = rows.map(row => {
    const q = parseQuestion(row);
    const userAnswer = normalizeAnswer(q, row.latest_user_answer);
    const correctAnswer = q.type === "multiple_choice" ? (q.answer as string[]) : String(q.answer ?? "");
    const error: ErrorReviewFile["items"][number]["error"] = {
      latestWrongAttempt: { answeredAt: row.latest_answered_at, userAnswer, gradingMode: row.latest_grading_mode },
      correctAnswer,
      history: { attemptCount: Number(row.attempt_count), wrongCount: Number(row.wrong_count) }
    };
    if (q.type === "single_choice" || q.type === "multiple_choice") {
      const got = new Set(Array.isArray(userAnswer) ? userAnswer : [userAnswer]);
      const want = new Set(Array.isArray(correctAnswer) ? correctAnswer : [correctAnswer]);
      error.choiceDiff = {
        wrongSelected: [...got].filter(x => x && !want.has(x)),
        missedCorrect: [...want].filter(x => !got.has(x))
      };
    }
    return {
      bank: { id: row.bank_id, title: row.bank_title },
      node: { id: nodeById.get(row.node_id)?.external_id ?? row.node_id, title: row.node_title, path: pathFor(row.node_id) },
      question: q,
      error
    };
  });
  return {
    format: "knoop-error-review",
    version: "1.1",
    exportedAt: now(),
    aiGuidance: {
      purpose: "用于错因分析、原题质量检查、变式训练和定向训练。",
      firstStep: "若用户未说明处理目标，先确认希望进行错因分析、修订原题、生成变式题还是定向训练；若用户已明确要求，则直接执行。",
      output: "需要生成或修订题目时输出 knoop-bank；修订原题保持原 question.id，变式题使用新 question.id。"
    },
    scope: { type: "current_wrong_questions" },
    items
  };
}
