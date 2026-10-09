import "./style.css";
import "katex/dist/katex.min.css";
import renderMathInElement from "katex/contrib/auto-render";
import { invoke } from "@tauri-apps/api/core";
import { parseAiReviewBank } from "./ai-review";
import { candidateFingerprint, checkedCandidateIds, createBatchJob, deleteBatchJob, GENERATED_PER_SOURCE, getBatchJob, jobBatches, jobReview, latestBatchJob, MAX_SOURCES_PER_RUN, saveBatchJob, saveReadyBatchCandidates, sourceKey, SOURCES_PER_BATCH } from "./batch-review";
import { gradeQuestion } from "./grading";
import {indexDirectory,searchDirectory,searchText,type DirectoryEntry} from "./directory-search";
import {getAiDraft,latestAiDraft,listAiDrafts,saveAiDraft,deleteAiDraft,saveAiDraftToGroup} from "./ai-drafts";
import {retryTempWrong} from "./temp-review";
import { createTempGroup, deleteTempGroup, emptyTempState, getTempGroup, listTempGroups, restartTempGroup, saveTempProgress, tempBank, tempResults, tempState, type TempState } from "./temp-review";
import { enqueueDraft, flushDrafts } from "./state-writes";
import { buildBackup, prepareRestore, restorePrepared, recoverPreferenceRestore, type PreparedRestore } from "./backup";
import { validateBackup } from "./backup-validation";
import type { BackupFile } from "./backup-format";
import { prepareBankImport, applyBankImport, type ImportPreview } from "./db";
import {unfinishedSessions} from "./db";
import type { BankFile } from "./types";
import { recordSessionAnswer, saveSessionDraft, buildBankExport, buildBundleExport, buildCurrentWrongReview, buildRepairReview, cancelReview, completeReview, createSession, db, deleteBank, favoriteQuestions, getBanks, getNodes, getNote, getQuestions, getReview, isFavorite, isKilled, isReviewed, killedQuestions, latestSession, librarySummary, noteQuestions, questionsForScope, reviewQuestions, saveNote, saveReview, saveSession, sessionById, stats, toggleFavorite, toggleKilled, updateQuestionContent, validateBank, validateBundle, wrongQuestions } from "./db";
import type { BankRow, NodeRow, QuestionInput, QuestionRow, ReviewIssue, SessionRow } from "./types";
import { parseQuestion } from "./types";

const app = document.querySelector<HTMLDivElement>("#app")!;

const mathDelimiters = [
  { left: "$$", right: "$$", display: true },
  { left: "\\[", right: "\\]", display: true },
  { left: "\\(", right: "\\)", display: false },
  { left: "$", right: "$", display: false },
] as const;

function renderMath(root: HTMLElement = app): void {
  try {
    renderMathInElement(root, {
      delimiters: mathDelimiters.map(({ left, right, display }) => ({ left, right, display })),
      throwOnError: false,
      strict: "ignore",
      trust: false,
      ignoredTags: ["script", "noscript", "style", "textarea", "pre", "code", "option", "input"],
    });
  } catch (error) {
    console.warn("KaTeX render failed", error);
  }
}
let activeSession: SessionRow | null = null;
let activeRows: QuestionRow[] = [];
let selection = new Set<string>();
let excludedOptions = new Set<string>();
let blankValue = "";
let quickMode = false;
let pageState: { submitted?: boolean; correct?: boolean; pendingManual?: boolean; revealed?: boolean; recallShown?: boolean } = {};
let suppressOptionClickId = "";
let suppressOptionClickUntil = 0;

let selectedScopeNodes = new Set<string>();
let selectedExportBanks = new Set<string>();
function formatUpdatedAt(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "更新时间未知";
  const sameYear = date.getFullYear() === new Date().getFullYear();
  return new Intl.DateTimeFormat(undefined, {
    ...(sameYear ? {} : { year: "numeric" as const }),
    month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false
  }).format(date);
}
const scopeCollapseStorageKey = "knoop.scopeCollapsed.v1";
function loadScopeCollapseState(): { nodes: Set<string>; initialized: boolean } {
  const raw = localStorage.getItem(scopeCollapseStorageKey);
  if (raw === null) return { nodes: new Set<string>(), initialized: false };
  try {
    const parsed = JSON.parse(raw);
    return { nodes: new Set(Array.isArray(parsed) ? parsed.filter(x => typeof x === "string") : []), initialized: true };
  } catch {
    return { nodes: new Set<string>(), initialized: false };
  }
}
const initialScopeCollapse = loadScopeCollapseState();
let collapsedScopeNodes = initialScopeCollapse.nodes;
let scopeCollapseInitialized = initialScopeCollapse.initialized;
let scopeNodesCache: NodeRow[] = [];
let scopeContentNodeIds = new Set<string>();
function saveScopeCollapseState(): void { localStorage.setItem(scopeCollapseStorageKey, JSON.stringify([...collapsedScopeNodes])); }

type DirectoryKind = "brush" | "memorization";
type ListKind = "wrong" | "favorites" | "killed" | "notes" | "reviews";
type ReturnTarget =
  | { view: "home" }
  | { view: "backup" }
  | { view: "import" }
  | { view: "scope" }
  | { view: "choose"; nodeIds?: string[]; nodeId?: string }
  | { view: "directory"; nodeIds?: string[]; sessionId?: string; kind?: DirectoryKind; query?: string }
  | { view: "session"; id: string }
  | { view: "sessions" }
  | { view: "list"; kind: ListKind }
  | { view: "presets" }
  | { view: "stats" }
  | { view: "temp-groups" }
  | { view: "temp-session"; id: string }
  | { view: "temp-review"; id: string }
  | { view: "ai-drafts" }
  | { view: "batch-review"; id?: string };
type Route = ReturnTarget
  | { view: "edit"; questionId: string; returnTo?: ReturnTarget }
  | { view: "note"; questionId: string }
  | { view: "review"; questionId: string }
  | { view: "ai-review"; questionId: string; draftId?:string };

const esc = (s: unknown) => String(s ?? "").replace(/[&<>'"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':"&quot;"}[c]!));
const button = (text: string, action: string, cls = "") => `<button type="button" class="${cls}" data-action="${esc(action)}">${esc(text)}</button>`;
const chevronIcon = (collapsed = false) => `<svg class="chevron-icon${collapsed?" is-collapsed":""}" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="m5 9 7 7 7-7"/></svg>`;
const graded = (q: QuestionRow | QuestionInput) => q.type === "single_choice" || q.type === "multiple_choice" || q.type === "blank";
const brushTypes = ["single_choice","multiple_choice","blank","recall"] as const;
type BrushType = typeof brushTypes[number];
const brushLabels: Record<BrushType,string> = { single_choice:"单选", multiple_choice:"多选", blank:"填空", recall:"背诵卡" };
const brushStorageKey = "knoop.enabledBrushTypes.v1";
function loadBrushTypes(): Set<BrushType> {
  try {
    const parsed = JSON.parse(localStorage.getItem(brushStorageKey) ?? "null");
    if (Array.isArray(parsed)) return new Set(parsed.filter((x): x is BrushType => brushTypes.includes(x as BrushType)));
  } catch {}
  return new Set(brushTypes);
}
let enabledBrushTypes = loadBrushTypes();
function saveBrushTypes(){ localStorage.setItem(brushStorageKey, JSON.stringify([...enabledBrushTypes])); }
function isEnabledBrush(q: QuestionRow | QuestionInput): boolean { return brushTypes.includes(q.type as BrushType) && enabledBrushTypes.has(q.type as BrushType); }

type PresetMode = "sequential" | "random";
interface ScopePresetRange { nodeId: string; includeDescendants: boolean }
interface ScopePreset {
  id: string;
  name: string;
  ranges: ScopePresetRange[];
  types: BrushType[];
  mode: PresetMode;
  count?: number;
  createdAt: string;
  updatedAt: string;
}
const presetStorageKey = "knoop.scopePresets.v2";
const recentPresetStorageKey = "knoop.recentScopePreset.v2";
function loadScopePresets(): ScopePreset[] {
  try {
    const raw = JSON.parse(localStorage.getItem(presetStorageKey) ?? "[]") as unknown;
    if (!Array.isArray(raw)) return [];
    return raw.filter((item): item is ScopePreset => {
      if (!item || typeof item !== "object") return false;
      const p = item as Partial<ScopePreset>;
      return typeof p.id === "string" && typeof p.name === "string" && p.name.trim().length > 0 && Array.isArray(p.ranges) && Array.isArray(p.types) && (p.mode === "sequential" || p.mode === "random");
    }).map(p => ({...p, ranges:p.ranges.filter((x): x is ScopePresetRange => !!x && typeof x.nodeId === "string" && typeof x.includeDescendants === "boolean"), types:[...new Set(p.types.filter((x): x is BrushType => brushTypes.includes(x as BrushType)))], count:p.mode==="random"&&Number.isFinite(p.count)?Math.max(1,Math.trunc(p.count!)):undefined})).filter(p=>p.ranges.length&&p.types.length);
  } catch { return []; }
}
let scopePresets = loadScopePresets();
function persistScopePresets(): void { localStorage.setItem(presetStorageKey, JSON.stringify(scopePresets)); }
function recentPresetId(): string { return localStorage.getItem(recentPresetStorageKey) ?? ""; }
function setRecentPreset(id: string): void { localStorage.setItem(recentPresetStorageKey, id); }
function presetTypeLabel(types: BrushType[]): string { return types.map(t=>brushLabels[t]).join(" / ") || "无题型"; }
function presetSummary(p: ScopePreset): string { return `${p.mode === "random" ? `随机 ${p.count ?? "全部"}` : "顺序"} · ${presetTypeLabel(p.types)}`; }
function contentCoverage(nodeId:string,nodes:NodeRow[],contentNodes:Set<string>):string[]{ const children=new Map<string,NodeRow[]>(); for(const n of nodes)if(n.parent_id)(children.get(n.parent_id)??children.set(n.parent_id,[]).get(n.parent_id)!).push(n); const out:string[]=[]; const visit=(id:string)=>{if(contentNodes.has(id))out.push(id);for(const c of children.get(id)??[])visit(c.id);}; visit(nodeId); return [...new Set(out)]; }
function compressPresetRanges(selectedIds:string[],nodes:NodeRow[],contentNodes:Set<string>):ScopePresetRange[]{
  const selected=new Set(selectedIds), children=new Map<string,NodeRow[]>(), roots:NodeRow[]=[]; for(const n of nodes){if(n.parent_id)(children.get(n.parent_id)??children.set(n.parent_id,[]).get(n.parent_id)!).push(n);else roots.push(n);}
  const coverage=(id:string)=>contentCoverage(id,nodes,contentNodes); const out:ScopePresetRange[]=[];
  const walk=(n:NodeRow)=>{const ids=coverage(n.id);if(ids.length&&ids.every(id=>selected.has(id))){out.push({nodeId:n.id,includeDescendants:true});return;}if(contentNodes.has(n.id)&&selected.has(n.id))out.push({nodeId:n.id,includeDescendants:false});for(const c of children.get(n.id)??[])walk(c);};
  for(const r of roots)walk(r); return out;
}
function expandPresetRanges(ranges:ScopePresetRange[],nodes:NodeRow[],contentNodes:Set<string>):string[]{ const valid=new Set(nodes.map(n=>n.id)),out:string[]=[];for(const r of ranges){if(!valid.has(r.nodeId))continue;if(r.includeDescendants)out.push(...contentCoverage(r.nodeId,nodes,contentNodes));else if(contentNodes.has(r.nodeId))out.push(r.nodeId);}return [...new Set(out)]; }

type ExpandableListKind = "wrong" | "favorites" | "notes" | "reviews";
const expandedListItems = new Map<ExpandableListKind, Set<string>>();
function expandedSet(kind: ExpandableListKind): Set<string> { let set=expandedListItems.get(kind); if(!set){set=new Set<string>();expandedListItems.set(kind,set);} return set; }
function shell(title: string, body: string, back = true, right = "", titleAction = "") {
  const rightSlot = back ? (right || `<span class="header-spacer" aria-hidden="true"></span>`) : right;
  const titleBody = titleAction ? `<button class="header-title" data-action="${esc(titleAction)}" aria-label="${esc(title)}，打开题目目录"><span>${esc(title)}</span><span class="header-title-hint" aria-hidden="true">目录 ⌄</span></button>` : esc(title);
  app.innerHTML = `<header class="${back ? "has-back" : "no-back"}">${back ? `<button class="icon" data-action="back" aria-label="返回上一页">‹</button>` : ""}<h1>${titleBody}</h1>${rightSlot}</header><main>${body}</main>`;
  renderMath();
}
function message(text: string, kind: "ok"|"error" = "ok") { const el = document.querySelector("#message"); if (el) { el.className = `message ${kind}`; el.textContent = text; } }
let toastTimer: number | undefined;
function notify(text: string, kind: "ok"|"error" = "error"): void {
  let toast=document.querySelector<HTMLElement>("#app-toast");
  if(!toast){toast=document.createElement("div");toast.id="app-toast";document.body.appendChild(toast);}
  toast.className=`app-toast ${kind}`; toast.textContent=text;
  toast.setAttribute("role",kind==="error"?"alert":"status");
  toast.hidden=false;
  window.clearTimeout(toastTimer);
  toastTimer=window.setTimeout(()=>{toast!.hidden=true;},4000);
}
function emptyState(title: string, description: string, action?: {text:string;id:string}): string {
  return `<div class="empty compact"><h2>${esc(title)}</h2>${description?`<p>${esc(description)}</p>`:""}${action?button(action.text,action.id,"primary"):""}</div>`;
}

function isReturnTarget(value: unknown): value is ReturnTarget {
  if (!value || typeof value !== "object") return false;
  const route = value as Record<string, unknown>;
  switch (route.view) {
    case "home":
    case "import":
    case "backup":
    case "scope":
    case "presets":
    case "stats":
    case "sessions":
    case "temp-groups":
    case "ai-drafts":
      return true;
    case "choose":
      return (route.nodeIds === undefined || (Array.isArray(route.nodeIds) && route.nodeIds.every(x => typeof x === "string")))
        && (route.nodeId === undefined || typeof route.nodeId === "string");
    case "directory":
      return (route.nodeIds === undefined || (Array.isArray(route.nodeIds) && route.nodeIds.every(x => typeof x === "string")))
        && (route.sessionId === undefined || typeof route.sessionId === "string")
        && (route.kind === undefined || route.kind === "brush" || route.kind === "memorization")
        && (route.query === undefined || typeof route.query === "string");
    case "batch-review":
      return route.id === undefined || (typeof route.id === "string" && route.id.length > 0);
    case "session":
    case "temp-session":
    case "temp-review":
      return typeof route.id === "string" && route.id.length > 0;
    case "list":
      return ["wrong", "favorites", "killed", "notes", "reviews"].includes(String(route.kind));
    default:
      return false;
  }
}
function isRoute(value: unknown): value is Route {
  if (isReturnTarget(value)) return true;
  if (!value || typeof value !== "object") return false;
  const route = value as Record<string, unknown>;
  if (route.view === "edit") {
    return typeof route.questionId === "string" && route.questionId.length > 0
      && (route.returnTo === undefined || isReturnTarget(route.returnTo));
  }
  if (route.view === "note" || route.view === "review" || route.view === "ai-review") {
    return typeof route.questionId === "string" && route.questionId.length > 0;
  }
  return false;
}

let renderedRoute:Route|null=null;
async function renderRoute(route: Route): Promise<void> {
  renderedRoute=route;
  switch (route.view) {
    case "home": return home();
    case "import": return importView();
    case "backup": return backupView();
    case "scope": return scopeView();
    case "choose": return chooseScope(route.nodeIds ?? (route.nodeId ? [route.nodeId] : []));
    case "directory": return directoryView(route);
    case "session": return openSession(route.id);
    case "sessions": return sessionsView();
    case "edit": return editQuestionView(route.questionId);
    case "note": return noteView(route.questionId);
    case "review": return reviewView(route.questionId);
    case "ai-review": return aiReviewView(route.questionId);
    case "list": return listView(route.kind);
    case "presets": return presetsView();
    case "stats": return statsView();
    case "temp-groups": return tempGroupsView();
    case "temp-session": return tempSessionView(route.id);
    case "temp-review": return tempReviewView(route.id);
    case "ai-drafts": return aiDraftsView();
    case "batch-review": return batchReviewView(route.id);
  }
}

async function navigate(route: Route, replace = false): Promise<void> {
  await studyDone;
  await flushDrafts();
  if(pendingAiPersistence)throw new Error("格式通过候选尚未保存，请重试保存或明确丢弃后离开");
  if (replace) history.replaceState(route, "");
  else history.pushState(route, "");
  await renderRoute(route);
}
function asReturnTarget(route: Route | null | undefined): ReturnTarget {
  if (!route || route.view === "edit" || route.view === "note" || route.view === "review" || route.view === "ai-review") return { view: "home" };
  return route;
}
let forcedBackTarget: ReturnTarget | null = null;
async function goBack(): Promise<void> {
  await studyDone;
  await flushDrafts();
  const route = isRoute(history.state) ? history.state : null;
  if (route?.view === "edit" && route.returnTo) forcedBackTarget = route.returnTo;
  if (route?.view === "ai-review" && aiPendingRequestId) {
    void invoke("cancel_ai_review", {requestId: aiPendingRequestId}).catch(() => {});
    aiPendingRequestId = null;
  }
  history.back();
}

function sessionSummary(session: SessionRow): string {
  const modes: Record<string,string> = {sequential:"顺序",random:"随机",wrong:"错题",favorites:"收藏",recall:"背诵卡",memorization:"背诵"};
  let total = 0, quick = false;
  try { const ids: unknown = JSON.parse(session.question_ids_json); if(Array.isArray(ids))total=ids.length; } catch {}
  try { quick = !!JSON.parse(session.state_json || "{}").quickMode; } catch {}
  const current = total ? Math.min(Math.max(0,session.current_index)+1,total) : 0;
  return `${modes[session.mode] ?? "学习"}${quick ? " · 快刷" : ""} · ${current} / ${total}`;
}

async function home() {
  practiceSetup = null;
  activeSession = null; activeRows = []; selection.clear(); excludedOptions.clear(); blankValue = ""; quickMode = false; pageState = {};
  selectedScopeNodes.clear(); scopeNodesCache = []; scopeContentNodeIds.clear();
  const resume = await latestSession(); const summary = await librarySummary([...enabledBrushTypes]); const pendingReviews = (await reviewQuestions()).length; const tempGroupCount = (await listTempGroups()).length; const previousBatchJob = await latestBatchJob();
  const pendingDraftCount=(await listAiDrafts()).length;
  const wrongCount=(await wrongQuestions()).length,favoriteCount=(await favoriteQuestions()).length;
  const recent = scopePresets.find(p=>p.id===recentPresetId());
  const recentCard = recent ? `<section class="home-recent-preset"><div><small>最近使用</small><b>${esc(recent.name)}</b><span>${esc(presetSummary(recent))}</span></div><button type="button" data-action="start-preset:${esc(recent.id)}">开始</button></section>` : "";
  const heading=`<div class="home-heading"><h1>Knoop</h1></div>`;
  if(!summary.banks&&!resume&&!tempGroupCount&&!pendingDraftCount&&!previousBatchJob){app.innerHTML=`<main class="home-main">${heading}<div class="home-study">${button("导入题库","import","primary")}</div></main>`;return;}
  app.innerHTML = `<main class="home-main">${heading}<div class="home-summary"><span>题库 ${summary.banks}</span><span>总 ${summary.totalContent}</span><span>可刷 ${summary.questions}</span><span>背诵 ${summary.memorization}</span></div>
    <section class="home-study"><div class="stack">
      ${resume ? `<div class="home-resume">${button("继续", `resume:${resume.id}`, "primary")}<p class="home-session-summary">${esc(sessionSummary(resume))}</p></div>` : ""}
      ${summary.banks ? button("新练习", "scope", resume ? "secondary" : "primary") : button("导入题库", "import", resume ? "secondary" : "primary")}
    </div></section>
    ${recentCard}
    <div class="home-shortcuts grid">${button(`错题 ${wrongCount}`,"wrong","secondary")}${button(`收藏 ${favoriteCount}`,"favorites","secondary")}</div>
    <nav class="home-nav" aria-label="其他功能">
      ${resume?button("未完成","sessions","secondary"):""}${button("练习方案","presets","secondary")}
      ${button("题库","import","secondary")}${button("统计","stats","secondary")}${button("备份与恢复","backup","secondary")}
      ${button("笔记","notes","secondary")}${button(pendingReviews?`待返修 ${pendingReviews}`:"待返修","reviews","secondary")}
    </nav>
    <section class="home-ai"><h2 class="section-title">AI 回炉</h2><div class="home-nav">
      ${button("批量回炉","batch-new","secondary")}${button(tempGroupCount?`AI 题组 ${tempGroupCount}`:"AI 题组","temp-groups","secondary")}
      ${pendingDraftCount?button(`草稿 ${pendingDraftCount}`,"ai-drafts","secondary"):""}
      ${previousBatchJob?button("继续任务",`batch-open:${previousBatchJob.id}`,"secondary"):""}
    </div></section></main>`;
  renderMath();
}

async function sessionsView():Promise<void>{
  const sessions=await unfinishedSessions(),nodes=await getNodes(),titles=new Map(nodes.map(n=>[n.id,n.title]));
  const present=new Set((await (await db()).select<{id:string}[]>("SELECT id FROM questions")).map(row=>row.id));
  const cards=sessions.map((session,index)=>{
    const scope=JSON.parse(session.scope_json),ids=JSON.parse(session.question_ids_json) as string[],available=ids.filter(id=>present.has(id)).length;
    const names=Array.isArray(scope.nodeIds)?scope.nodeIds.map((id:string)=>titles.get(id)??"失效范围").join("、"):session.mode==="wrong"?"当前错题":session.mode==="favorites"?"收藏":"已保存范围";
    return `<section class="card"><h2>${esc(sessionSummary(session))}</h2><p>${esc(names)} · 更新 ${esc(formatUpdatedAt(session.updated_at))}</p>${available===ids.length?button("继续",`resume:${session.id}`,index===0?"primary":"secondary"):`<p>范围内容已失效，请重新选择范围。现存 ${available} / ${ids.length} 项。</p>`}</section>`;
  }).join("");
  shell("未完成",cards||emptyState("暂无未完成练习","",{text:"新练习",id:"scope"}));
}

async function importView() {
  const banks = await getBanks(); const killed = await killedQuestions();
  const bankIds = new Set(banks.map(b => b.id));
  selectedExportBanks = new Set([...selectedExportBanks].filter(id => bankIds.has(id)));
  const exportToolbar = banks.length > 1
    ? `<div class="bank-export-toolbar"><span id="export-selected-count">已选 ${selectedExportBanks.size}</span><button id="export-selected-btn" data-action="export-selected-banks" ${selectedExportBanks.size >= 2 ? "" : "disabled"}>导出所选</button></div>`
    : "";
  const rows = banks.map(b => `<div class="bank-row">
      <label class="bank-select">${banks.length > 1 ? `<input type="checkbox" data-export-bank="${esc(b.id)}" ${selectedExportBanks.has(b.id)?"checked":""}>` : ""}<span><b>${esc(b.title)}</b><small>更新 ${esc(formatUpdatedAt(b.updated_at))}</small></span></label>
      <div class="bank-actions"><button data-action="export-bank:${esc(b.id)}">导出</button><button class="delete-link" data-action="delete-bank:${esc(b.id)}">删除</button></div>
    </div>`).join("");
  shell("题库管理", `<input id="file" class="visually-hidden-file" type="file" accept="application/json,.json" multiple>
    <div id="message" class="message"></div>
    <div id="import-previews">${importPreviewsHtml()}</div>
    ${banks.length ? `<section><h2 class="section-title">已导入题库</h2>${exportToolbar}<div class="bank-list">${rows}</div></section>` : `${emptyState("还没有题库","",{text:"导入题库",id:"pick-import"})}`}
    ${killed.length ? `<section><h2 class="section-title">题目管理</h2>${button(`已斩杀 ${killed.length} 题`,"killed")}</section>`:""}
    <section><h2 class="section-title">学习状态</h2>${button("完整备份 / 恢复","backup")}</section>`,
    true,
    `<button class="header-action" data-action="pick-import">导入</button>`);
  const updateExportToolbar = () => {
    const count = document.querySelector<HTMLElement>("#export-selected-count");
    const btn = document.querySelector<HTMLButtonElement>("#export-selected-btn");
    if (count) count.textContent = `已选 ${selectedExportBanks.size}`;
    if (btn) btn.disabled = selectedExportBanks.size < 2;
  };
  for (const input of document.querySelectorAll<HTMLInputElement>("[data-export-bank]")) input.onchange = () => {
    const id = input.dataset.exportBank!;
    input.checked ? selectedExportBanks.add(id) : selectedExportBanks.delete(id);
    updateExportToolbar();
  };
  if(importFeedback)message(importFeedback,"ok");
  document.querySelector<HTMLInputElement>("#file")!.onchange = e => {
    const files=[...((e.target as HTMLInputElement).files??[])];if(!files.length)return;
    void withStudyAction(()=>queueImportFiles(files)).catch(reportSaveError);
  };
}

let nextImportId=0;
let importQueue:Array<{id:number;label:string;raw:unknown;preview?:ImportPreview;error?:string}>=[];
let importFeedback="";
function importPreviewsHtml():string{
  return importQueue.map((entry,index)=>{
    const s=entry.preview?.summary;
    return `<section class="card"><h2>${esc(entry.label)}</h2>${s?`<p>${esc(s.title)} · ${esc(s.bankId)} · ${s.mode==="new"?"新建题库":"合并题库"}</p><p>新增 ${s.added} · 内容覆盖 ${s.changed} · 相同 ${s.unchanged} · 保留文件外内容 ${s.omitted}</p><p>${Object.entries(s.types).map(([type,count])=>`${esc(questionTypeLabel({type} as QuestionInput))} ${count}`).join(" · ")}</p>${s.changed?`<p>将覆盖 ${s.changed} 项已有内容，可能包含你的本地编辑；答案变更 ${s.answerChanges} 项，历史判分保留。</p>`:""}`:""}${entry.error?`<p class="message error">${esc(entry.error)}</p>`:""}<div class="grid">${button("取消",`cancel-import:${entry.id}`)}${s?button("确认导入",`confirm-import:${entry.id}`,index===0?"primary":"secondary"):""}</div></section>`;
  }).join("");
}
async function refreshImportPreviews():Promise<void>{
  for(const entry of importQueue){if(entry.raw===null&&entry.error)continue;try{entry.preview=await prepareBankImport(entry.raw as BankFile);entry.error=undefined;}catch(error){entry.preview=undefined;entry.error=error instanceof Error?error.message:String(error);}}
}
async function queueImportFiles(files:File[]):Promise<void>{
  importQueue=[];importFeedback="";
  for(const file of files){
    try{
      const raw:unknown=JSON.parse(await file.text());
      if(raw&&typeof raw==="object"&&(raw as {format?:unknown}).format==="knoop-bundle"){
        const bundle=validateBundle(raw);
        bundle.banks.forEach((bank,index)=>importQueue.push({id:++nextImportId,label:`${file.name} / 第 ${index+1} 个题库`,raw:bank}));
      }else importQueue.push({id:++nextImportId,label:file.name,raw});
    }catch(error){importQueue.push({id:++nextImportId,label:file.name,raw:null,error:error instanceof Error?error.message:String(error)});}
  }
  await refreshImportPreviews();
  await importView();
}
async function confirmImport(id:number):Promise<void>{
  const entry=importQueue.find(item=>item.id===id);if(!entry?.preview)return;
  try{
    const result=await applyBankImport(entry.preview),s=entry.preview.summary;
    importFeedback+=`${importFeedback?"\n":""}已成功导入 ${entry.label}：新增 ${s.added}，内容覆盖 ${s.changed}，保留文件外内容 ${s.omitted}${result.repaired?`；完成返修 ${result.repaired} 题`:""}`;
    importQueue=importQueue.filter(item=>item.id!==id);
  }catch(error){notify(`未导入：${error instanceof Error?error.message:String(error)}；请核对刷新后的预览，再确认。`);}
  await refreshImportPreviews();await importView();
}

let restoreFile:BackupFile|null=null;
let restorePlan:PreparedRestore|null=null;
let backupMessage="";
let restoreSyncPending=false;
function reloadLearningState():void{
  const collapse=loadScopeCollapseState();collapsedScopeNodes=collapse.nodes;scopeCollapseInitialized=collapse.initialized;
  enabledBrushTypes=loadBrushTypes();scopePresets=loadScopePresets();selectedScopeNodes.clear();selectedExportBanks.clear();scopeNodesCache=[];scopeContentNodeIds.clear();
  activeSession=null;activeRows=[];selection.clear();excludedOptions.clear();blankValue="";pageState={};aiPreview=null;importQueue=[];importFeedback="";
}
function backupSummary(file:BackupFile):string{
  const c=file.counts;return `<p>题库 ${c.banks} · 内容 ${c.questions} · 作答 ${c.attempts} · 会话 ${c.sessions}</p><p>笔记 ${c.notes} · 收藏 ${c.favorites} · 斩杀 ${c.killed_questions} · 待返修 ${c.question_reviews}</p><p>答案修订 ${c.question_answer_revisions} · AI 题组 ${c.ai_review_groups} · 批次任务 ${c.ai_review_batch_jobs} · 待审核草稿 ${c.ai_review_drafts}</p><p>来源版本 ${esc(file.appVersion)} · ${esc(formatUpdatedAt(file.exportedAt))}</p>`;
}
function requireBackupIdle():void{if(batchRunningJobId||batchStarting||batchCreating||aiStarting||aiPendingRequestId||aiSavingGroup||batchSavingReady||pendingAiPersistence)throw new Error("请先结束正在运行的 AI 任务并保存候选草稿，再备份或恢复");}
async function backupView():Promise<void>{
  if(restoreSyncPending){shell("完成恢复设置",`<p>恢复操作的设置同步尚未完成，请重试完成同步后继续学习。</p><p class="message error">${esc(backupMessage)}</p>${button("重试设置同步","backup-sync","primary")}`,false);return;}
  let archives="";
  try{
    const copies=await invoke<Array<{name:string;bytes:number}>>("list_restore_safety_copies");
    if(copies.length)archives=`<details class="card"><summary>恢复前安全副本（${copies.length}）</summary><p>最近 10 份，可重新载入并预览恢复。</p>${copies.slice(0,10).map(copy=>{const stamp=copy.name.match(/(\d+)\.json$/)?.[1];const date=stamp?new Date(Number(BigInt(stamp)/1000000n)).toISOString():"";return button(`${date?formatUpdatedAt(date):"安全副本"} · ${Math.ceil(copy.bytes/1024)} KB`,`backup-load:${copy.name}`);}).join("")}</details>`;
  }catch(error){archives=`<p class="message error">安全副本列表暂不可用：${esc(error instanceof Error?error.message:String(error))}</p>`;}
  const preview=restoreFile?`<section class="card"><h2>待恢复备份</h2>${backupSummary(restoreFile)}<p>恢复将完整替换本机题库与学习记录。API 配置保留，备份不包含 API Key。</p>${restorePlan?`<p>已生成恢复前安全副本，可在本页重新载入。</p>${button("确认替换并恢复","backup-confirm","destructive-action")}${button("另存恢复前备份","backup-save-before")}`:button("备份当前数据并准备恢复","backup-prepare","primary")}${button("取消恢复","backup-cancel")}</section>`:"";
  shell("完整备份 / 恢复",`<p>完整保存题库、历史作答、笔记、收藏、进度、回炉结果及学习偏好；不包含 API Key。</p>${button("导出完整备份","backup-export",restoreFile?"secondary":"primary")}${button("选择完整备份","backup-pick")}<input id="backup-file" class="visually-hidden-file" type="file" accept="application/json,.json"><div id="backup-message" class="message error">${esc(backupMessage)}</div>${preview}${archives}`);
  document.querySelector<HTMLInputElement>("#backup-file")!.onchange=e=>{
    const file=(e.target as HTMLInputElement).files?.[0];if(!file)return;
    void withStudyAction(async()=>{try{restoreFile=await validateBackup(JSON.parse(await file.text()));restorePlan=null;backupMessage="";}catch(error){restoreFile=null;restorePlan=null;backupMessage=error instanceof Error?error.message:String(error);}await backupView();}).catch(reportSaveError);
  };
}
async function confirmRestore():Promise<void>{
  if(!restorePlan||!confirm("确认用这份备份完整替换本机所有学习状态？\n\n题库、作答、笔记、收藏和进度将被替换。当前状态已有恢复前安全副本。"))return;
  requireBackupIdle();
  try{await restorePrepared(restorePlan);restoreFile=null;restorePlan=null;backupMessage="";reloadLearningState();history.replaceState({view:"home"} satisfies Route,"");await renderRoute({view:"home"});notify("完整学习状态已恢复","ok");}
  catch(error){
    restorePlan=null;backupMessage=error instanceof Error?error.message:String(error);
    restoreSyncPending=(await (await db()).select<unknown[]>("SELECT id FROM backup_preference_journal WHERE id=1")).length>0;
    await backupView();
  }
}
async function backupAction(task:()=>Promise<void>):Promise<void>{
  await withStudyAction(async()=>{
    try{await task();}catch(error){backupMessage=error instanceof Error?error.message:String(error);await backupView();}
  });
}
async function finishPreferenceRestore():Promise<void>{
  await recoverPreferenceRestore();restoreSyncPending=false;restorePlan=null;restoreFile=null;backupMessage="";reloadLearningState();
  history.replaceState({view:"home"} satisfies Route,"");await renderRoute({view:"home"});notify("恢复设置同步已完成","ok");
}

function buildScopeTree(nodes: NodeRow[]) {
  const children = new Map<string|null, NodeRow[]>();
  const byId = new Map(nodes.map(n => [n.id, n]));
  for (const n of nodes) { const k = n.parent_id; children.set(k, [...(children.get(k) ?? []), n]); }
  for (const list of children.values()) list.sort((a,b) => a.sort_order-b.sort_order || a.title.localeCompare(b.title));
  const subtreeIds = (id: string): string[] => { const out = [id]; for (const child of children.get(id) ?? []) out.push(...subtreeIds(child.id)); return out; };
  return { children, byId, subtreeIds };
}

async function scopeView(focusAction = "") {
  const banks = await getBanks(); const nodes = await getNodes(); const allQuestions = await getQuestions();
  scopeNodesCache = nodes; scopeContentNodeIds = new Set(allQuestions.map(q => q.node_id));
  const { children } = buildScopeTree(nodes);
  const collapsibleIds = new Set(nodes.filter(n => (children.get(n.id)?.length ?? 0) > 0).map(n => n.id));
  let collapseStatePruned=false; for (const id of [...collapsedScopeNodes]) if (!collapsibleIds.has(id)) { collapsedScopeNodes.delete(id); collapseStatePruned=true; }
  if(collapseStatePruned) saveScopeCollapseState();
  if (!scopeCollapseInitialized) {
    for (const n of nodes) if (n.parent_id && collapsibleIds.has(n.id)) collapsedScopeNodes.add(n.id);
    scopeCollapseInitialized = true; saveScopeCollapseState();
  }
  const coverageIds = (id: string): string[] => {
    const out: string[] = [];
    if (scopeContentNodeIds.has(id)) out.push(id);
    for (const child of children.get(id) ?? []) out.push(...coverageIds(child.id));
    return out.length ? [...new Set(out)] : [id];
  };
  const stateFor = (ids: string[]) => {
    const unique=[...new Set(ids)]; const count = unique.filter(id => selectedScopeNodes.has(id)).length;
    return { checked: count === unique.length && unique.length > 0, partial: count > 0 && count < unique.length };
  };
  const renderNode = (n: NodeRow, depth=0): string => {
    const kids = children.get(n.id) ?? []; const state = stateFor(coverageIds(n.id)); const collapsed = collapsedScopeNodes.has(n.id);
    const descendants = !collapsed ? kids.map(c => renderNode(c, depth+1)).join("") : "";
    return `<div class="scope-node" style="--depth:${depth}">
      ${kids.length ? `<button class="tree-toggle" data-action="fold:${esc(n.id)}" aria-label="${collapsed ? "展开" : "折叠"}" aria-expanded="${!collapsed}">${chevronIcon(collapsed)}</button>` : `<span class="tree-toggle placeholder"></span>`}
      <label class="scope-check"><input type="checkbox" data-scope-check="${esc(n.id)}" data-action="scope-node:${esc(n.id)}" ${state.checked ? "checked" : ""}><span>${esc(n.title)}</span></label>
    </div>${descendants}`;
  };
  const renderBank = (b: BankRow) => {
    const bankNodes = nodes.filter(n => n.bank_id === b.id);
    const roots = (children.get(null) ?? []).filter(n => n.bank_id === b.id);
    const bankCoverage = [...new Set(roots.flatMap(r => coverageIds(r.id)))];
    const state = stateFor(bankCoverage.length ? bankCoverage : bankNodes.map(n => n.id));
    const bankCollapsible = bankNodes.filter(n => collapsibleIds.has(n.id)).map(n => n.id);
    const allCollapsed = bankCollapsible.length > 0 && bankCollapsible.every(id => collapsedScopeNodes.has(id));
    return `<section class="scope-bank"><div class="bank-heading"><label class="scope-check bank-check"><input type="checkbox" data-bank-check="${esc(b.id)}" data-action="scope-bank:${esc(b.id)}" ${state.checked ? "checked" : ""}><span class="bank-heading-text"><b>${esc(b.title)}</b><small>更新 ${esc(formatUpdatedAt(b.updated_at))}</small></span></label>${bankCollapsible.length?`<button class="bank-fold" data-action="scope-bank-fold:${esc(b.id)}" aria-label="${allCollapsed?"展开此题库":"折叠此题库"}" title="${allCollapsed?"展开此题库":"折叠此题库"}" aria-expanded="${!allCollapsed}">${chevronIcon(allCollapsed)}</button>`:""}</div>${roots.map(n => renderNode(n)).join("")}</section>`;
  };
  const selectedCount = selectedScopeNodes.size;
  const selectedRows = await questionsForScope([...selectedScopeNodes]);
  const brushCount = selectedRows.filter(isEnabledBrush).length;
  const memorizationCount = selectedRows.filter(q => q.type === "memorization").length;
  const allExpanded = collapsibleIds.size > 0 && [...collapsibleIds].every(id => !collapsedScopeNodes.has(id));
  const foldAll = collapsibleIds.size ? `<button class="header-symbol" data-action="${allExpanded?"scope-collapse-all":"scope-expand-all"}" aria-label="${allExpanded?"全部折叠":"全部展开"}" title="${allExpanded?"全部折叠":"全部展开"}">${chevronIcon(allExpanded)}</button>` : "";
  shell("选择范围", banks.length ? `${banks.map(renderBank).join("")}<div class="scope-bottom"><div>刷题 ${brushCount} · 背诵 ${memorizationCount}</div><button class="primary" data-action="scope-next" ${selectedCount ? "" : "disabled"}>下一步</button></div>` : `${emptyState("还没有题库","",{text:"去导入",id:"import"})}`, true, foldAll);
  for (const input of document.querySelectorAll<HTMLInputElement>("[data-scope-check]")) { const id = input.dataset.scopeCheck!; const state = stateFor(coverageIds(id)); input.indeterminate = state.partial; }
  for (const input of document.querySelectorAll<HTMLInputElement>("[data-bank-check]")) {
    const bankId=input.dataset.bankCheck!; const roots=(children.get(null)??[]).filter(n=>n.bank_id===bankId);
    const ids=[...new Set(roots.flatMap(r=>coverageIds(r.id)))]; input.indeterminate = stateFor(ids).partial;
  }
  if(focusAction==="scope-expand-all"||focusAction==="scope-collapse-all")document.querySelector<HTMLButtonElement>(".header-symbol")?.focus({preventScroll:true});
  else if(focusAction)document.querySelectorAll<HTMLElement>("[data-action]").forEach(element=>{if(element.dataset.action===focusAction)element.focus({preventScroll:true});});
}
function scopeCoverageIds(nodeId: string): string[] {
  const { children } = buildScopeTree(scopeNodesCache); const out:string[]=[];
  const visit=(id:string)=>{if(scopeContentNodeIds.has(id))out.push(id);for(const child of children.get(id)??[])visit(child.id);}; visit(nodeId);
  return out.length?[...new Set(out)]:[nodeId];
}
function toggleScopeNode(nodeId: string) { const ids = scopeCoverageIds(nodeId); const allSelected = ids.every(id => selectedScopeNodes.has(id)); for (const id of ids) allSelected ? selectedScopeNodes.delete(id) : selectedScopeNodes.add(id); }
function toggleScopeBank(bankId: string) {
  let ids=scopeNodesCache.filter(n=>n.bank_id===bankId && scopeContentNodeIds.has(n.id)).map(n=>n.id);
  if(!ids.length) ids=scopeNodesCache.filter(n=>n.bank_id===bankId).map(n=>n.id);
  const allSelected = ids.length > 0 && ids.every(id => selectedScopeNodes.has(id)); for (const id of ids) allSelected ? selectedScopeNodes.delete(id) : selectedScopeNodes.add(id);
}

function shuffled<T>(input: T[]): T[] {
  const out=[...input];
  for(let i=out.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[out[i],out[j]]=[out[j],out[i]];}
  return out;
}
function questionLead(q: QuestionInput): string {
  return String(q.stem ?? q.front ?? q.prompt ?? "").split(/\r?\n/)[0].trim() || "（无标题）";
}
function questionTypeLabel(q: QuestionInput): string {
  return q.type==="single_choice"?"单选":q.type==="multiple_choice"?"多选":q.type==="blank"?"填空":q.type==="recall"?"背诵卡":"背诵";
}
function reviewQuestionPreview(q: QuestionInput): string {
  const explain = `<div class="review-preview-section"><b>解析</b><div class="multiline">${q.explanation ? esc(q.explanation) : "无解析"}</div></div>`;
  if (q.type === "single_choice" || q.type === "multiple_choice") {
    const answerIds = new Set(Array.isArray(q.answer) ? q.answer : [String(q.answer ?? "")]);
    const options = (q.options ?? []).map(o => `<div class="review-preview-option ${answerIds.has(o.id)?"correct":""}"><b>${esc(o.id)}</b><span class="option-copy"><span class="multiline">${esc(o.text)}</span>${answerIds.has(o.id)?'<small class="option-result">✓ 正确答案</small>':""}</span></div>`).join("");
    return `<div class="review-question-preview"><div class="review-preview-head"><span class="type">${questionTypeLabel(q)}</span></div><div class="review-preview-section"><b>题干</b><div class="multiline">${esc(q.stem)}</div></div><div class="review-preview-options">${options}</div>${explain}</div>`;
  }
  if (q.type === "blank") return `<div class="review-question-preview"><div class="review-preview-head"><span class="type">${questionTypeLabel(q)}</span></div><div class="review-preview-section"><b>题干</b><div class="multiline">${esc(q.stem)}</div></div><div class="review-preview-section"><b>标准答案</b><div class="multiline">${esc(String(q.answer ?? ""))}</div></div>${explain}</div>`;
  if (q.type === "recall") return `<div class="review-question-preview"><div class="review-preview-head"><span class="type">${questionTypeLabel(q)}</span></div><div class="review-preview-section"><b>正面</b><div class="multiline">${esc(q.front)}</div></div><div class="review-preview-section"><b>背面</b><div class="multiline">${esc(q.back)}</div></div>${explain}</div>`;
  const keyPoints = q.keyPoints?.length ? `<div class="review-preview-section"><b>要点</b><ul>${q.keyPoints.map(x=>`<li class="multiline">${esc(x)}</li>`).join("")}</ul></div>` : "";
  return `<div class="review-question-preview"><div class="review-preview-head"><span class="type">${questionTypeLabel(q)}</span></div><div class="review-preview-section"><b>提示</b><div class="multiline">${esc(q.prompt)}</div></div><div class="review-preview-section"><b>内容</b><div class="multiline">${esc(q.content)}</div></div>${keyPoints}${explain}</div>`;
}

function presetId(): string { return `preset-${crypto.randomUUID()}`; }
function validPresetTypes(types: BrushType[]): BrushType[] { return types.filter(t=>brushTypes.includes(t)); }
async function saveScopePreset(nodeIds: string[]): Promise<void> {
  const name=(document.querySelector<HTMLInputElement>("#preset-name")?.value??"").trim();
  if(!name){notify("请输入练习方案名称");return;}
  const mode=(document.querySelector<HTMLSelectElement>("#practice-order")?.value??"sequential") as PresetMode;
  if(mode!=="sequential"&&mode!=="random"){notify("组题方式无效");return;}
  const types=validPresetTypes([...enabledBrushTypes]);
  if(!types.length){notify("请至少启用一种刷题题型");return;}
  const count=mode==="random"?setupCount("#random-count"):undefined;
  if(mode==="random"&&count===undefined)return;
  const nodes=await getNodes(), questions=await getQuestions(), contentNodes=new Set(questions.map(q=>q.node_id));
  const ranges=compressPresetRanges([...new Set(nodeIds)],nodes,contentNodes); if(!ranges.length){notify("当前范围没有可保存的有效题目节点");return;}
  const stamp=new Date().toISOString();
  scopePresets=[...scopePresets,{id:presetId(),name,ranges,types,mode,count,createdAt:stamp,updatedAt:stamp}];
  persistScopePresets();
  const nameInput=document.querySelector<HTMLInputElement>("#preset-name");
  if(nameInput)nameInput.value="";
  const details=document.querySelector<HTMLDetailsElement>("details.preset-save");
  if(details)details.open=false;
  capturePracticeSetup();
  notify(`已保存练习方案：${name}`,"ok");
}
async function startPresetById(id:string): Promise<void> {
  const preset=scopePresets.find(p=>p.id===id); if(!preset){notify("练习方案不存在或已删除");return;}
  const nodes=await getNodes(), allQuestions=await getQuestions(), contentNodes=new Set(allQuestions.map(q=>q.node_id));
  const validNodeIds=expandPresetRanges(preset.ranges,nodes,contentNodes);
  if(!validNodeIds.length){notify("这个练习方案引用的范围已全部失效，请重新保存范围");return;}
  let rows=(await questionsForScope(validNodeIds)).filter(q=>preset.types.includes(q.type as BrushType));
  if(preset.mode==="random") rows=shuffled(rows).slice(0,Math.min(preset.count??rows.length,rows.length));
  if(!rows.length){notify("当前题库中没有符合这个练习方案的可用题目");return;}
  setRecentPreset(preset.id);
  const sessionId=await createSession(preset.mode,{source:"preset",presetId:preset.id,ranges:preset.ranges,nodeIds:validNodeIds,types:preset.types,order:preset.mode,count:preset.mode==="random"?preset.count:undefined},rows.map(q=>q.id));
  await navigate({view:"session",id:sessionId});
}
async function presetsView(): Promise<void> {
  const allNodes=await getNodes(); const valid=new Set(allNodes.map(n=>n.id));
  const cards=scopePresets.map(p=>{const validCount=p.ranges.filter(r=>valid.has(r.nodeId)).length;const invalid=p.ranges.length-validCount;return `<div class="card preset-card"><div class="preset-card-head"><div><b>${esc(p.name)}</b><span>${esc(presetSummary(p))}</span></div><div class="compact-card-actions"><button data-action="start-preset:${esc(p.id)}">开始</button><button class="delete-link" data-action="delete-preset:${esc(p.id)}">删除</button></div></div><div class="preset-meta">范围节点 ${validCount}${invalid?` · <em>失效 ${invalid}</em>`:""}</div></div>`}).join("");
  shell("练习方案",scopePresets.length?`<div class="preset-list">${cards}</div>`:`${emptyState("暂无练习方案","",{text:"去学习",id:"scope"})}`);
}

type PracticeSetup = {key:string;order:string;count:string;memoOrder:string;memoCount:string;name:string;saveOpen:boolean};
let practiceSetup:PracticeSetup|null=null;
function capturePracticeSetup():void {
  if(!practiceSetup)return;
  const value=(selector:string,fallback:string)=>document.querySelector<HTMLInputElement|HTMLSelectElement>(selector)?.value??fallback;
  practiceSetup={...practiceSetup,order:value("#practice-order",practiceSetup.order),count:value("#random-count",practiceSetup.count),memoOrder:value("#memorization-order",practiceSetup.memoOrder),memoCount:value("#memorization-random-count",practiceSetup.memoCount),name:value("#preset-name",practiceSetup.name),saveOpen:document.querySelector<HTMLDetailsElement>(".preset-save")?.open??false};
}
function setupCount(selector:string):number|undefined {
  const input=document.querySelector<HTMLInputElement>(selector);
  if(!input||!input.checkValidity()){input?.reportValidity();return;}
  const count=Number(input.value);
  if(!Number.isSafeInteger(count)||count<1){notify("请输入范围内的整数数量");input.focus();return;}
  return count;
}
async function chooseScope(nodeIds: string[],focusAction="") {
  if (!nodeIds.length) { notify("请至少选择一个范围"); return navigate({view:"scope"}, true); }
  const rows = await questionsForScope(nodeIds);
  const answerable = rows.filter(isEnabledBrush); const memorization = rows.filter(q=>q.type==="memorization");
  const key=JSON.stringify([...nodeIds].sort());
  if(practiceSetup?.key!==key)practiceSetup={key,order:"sequential",count:String(Math.min(10,answerable.length)),memoOrder:"sequential",memoCount:String(Math.min(10,memorization.length)),name:"",saveOpen:false};
  const setup=practiceSetup!;
  if(answerable.length)setup.count=String(Math.min(Math.max(1,Number(setup.count)||10),answerable.length));
  const filters=brushTypes.map(type=>`<button class="type-filter ${enabledBrushTypes.has(type)?"active":""}" data-action="filter-type:${type}" aria-pressed="${enabledBrushTypes.has(type)}">${brushLabels[type]}</button>`).join("");
  const orderOptions=(order:string)=>`<option value="sequential" ${order==="sequential"?"selected":""}>顺序</option><option value="random" ${order==="random"?"selected":""}>随机</option>`;
  const brushCard = `<section class="card practice-setup"><h2 data-brush-count="${answerable.length}">刷题 ${answerable.length}</h2>${answerable.length?`
    <div class="setup-controls"><label>方式<select id="practice-order">${orderOptions(setup.order)}</select></label>
    <label id="practice-count-label" ${setup.order==="random"?"":"hidden"}>题数<input id="random-count" type="number" min="1" max="${answerable.length}" value="${esc(setup.count)}"></label></div>
    ${button("开始练习",`start-scope:${setup.order}`,"primary")}
    ${button("目录","open-directory:brush","secondary")}
    <details class="preset-save" ${setup.saveOpen?"open":""}><summary>保存方案</summary><div class="preset-save-body">
      <label>名称<input id="preset-name" type="text" maxlength="40" placeholder="练习方案名称" value="${esc(setup.name)}"></label>
      <button data-action="save-scope-preset">保存</button>
    </div></details>
  `:button("调整题型","adjust-types")}</section>`;
  const memoCard = memorization.length ? `<section class="card practice-setup"><h2 data-memo-count="${memorization.length}">背诵 ${memorization.length}</h2>
    <div class="setup-controls"><label>方式<select id="memorization-order">${orderOptions(setup.memoOrder)}</select></label>
    <label id="memorization-count-label" ${setup.memoOrder==="random"?"":"hidden"}>材料数<input id="memorization-random-count" type="number" min="1" max="${memorization.length}" value="${esc(setup.memoCount)}"></label></div>
    ${button("开始背诵",setup.memoOrder==="random"?"start-scope:memorization-random":"start-scope:memorization",answerable.length?"secondary":"primary")}
    ${button("目录","open-directory:memorization","secondary")}
  </section>` : "";
  shell("选择模式",`<section class="setup-types type-filter-row"><h2 class="section-title">题型</h2><div class="type-filter-options">${filters}</div></section>${brushCard}${memoCard}`);
  for(const kind of ["practice","memorization"]){
    const order=document.querySelector<HTMLSelectElement>(`#${kind}-order`);
    order?.addEventListener("change",()=>{const random=order.value==="random";document.querySelector<HTMLElement>(`#${kind}-count-label`)!.hidden=!random;const start=document.querySelector<HTMLButtonElement>(kind==="practice"?'[data-action="start-scope:sequential"],[data-action="start-scope:random"]':'[data-action="start-scope:memorization"],[data-action="start-scope:memorization-random"]')!;start.dataset.action=kind==="practice"?`start-scope:${order.value}`:random?"start-scope:memorization-random":"start-scope:memorization";capturePracticeSetup();});
  }
  if(focusAction)app.querySelector<HTMLButtonElement>(`[data-action="${CSS.escape(focusAction)}"]`)?.focus({preventScroll:true});
}

async function startScope(mode:string,nodeIds:string[],count?:number) {
  let rows = await questionsForScope(nodeIds);
  let sessionMode=mode, order="sequential";
  if (mode === "memorization" || mode === "memorization-random") {
    rows = rows.filter(q=>q.type==="memorization");
    sessionMode="memorization";
    if(mode==="memorization-random"){rows=shuffled(rows).slice(0,count??rows.length);order="random";}
  } else {
    rows = rows.filter(isEnabledBrush);
    if(mode==="random"){rows=shuffled(rows).slice(0,count??rows.length);order="random";}
  }
  if(!rows.length){ notify("此范围没有可用内容"); return; }
  const id=await createSession(sessionMode,{nodeIds,order,types:mode.startsWith("memorization")?["memorization"]:[...enabledBrushTypes],count:order==="random"?count:undefined},rows.map(q=>q.id)); await navigate({ view: "session", id });
}
async function startRows(mode:string,rows:QuestionRow[]){ if(!rows.length)return; const id=await createSession(mode,{source:mode},rows.map(q=>q.id)); await navigate({ view: "session", id }); }

function questionSearchText(q: QuestionInput): string {
  return searchText(q);
}
function directoryMatches(q: QuestionInput, query: string): boolean {
  const terms=query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean); if(!terms.length)return true;
  const haystack=questionSearchText(q); return terms.every(term=>haystack.includes(term));
}
function directoryEntries(rows: QuestionRow[], query: string): Array<{row:QuestionRow;index:number}> {
  return rows.map((row,index)=>({row,index})).filter(({row})=>directoryMatches(parseQuestion(row),query));
}
function directoryMatchLocation(q:QuestionInput,query:string):string {
  const terms=query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  if(!terms.length || terms.some(term=>questionLead(q).toLocaleLowerCase().includes(term)))return "";
  const fields:[string,string][]=[
    ...((q.options??[]).map(option=>["选项",option.text] as [string,string])),
    ["答案",Array.isArray(q.answer)?q.answer.join(" "):String(q.answer??"")],
    ["解析",q.explanation??""],["背面",q.back??""],["内容",q.content??""],
    ["标签",(q.tags??[]).join(" ")],["要点",(q.keyPoints??[]).join(" ")]
  ];
  return fields.find(([,value])=>terms.some(term=>value.toLocaleLowerCase().includes(term)))?.[0]??"";
}
function directoryListHtml(entries:Array<{row:QuestionRow;index:number;question?:QuestionInput}>,sessionId?:string,currentIndex=-1,query=""):string {
  if(!entries.length)return `${emptyState("没有匹配内容","")}`;
  return entries.map(({row:r,index:i,question})=>{const q=question??parseQuestion(r), location=directoryMatchLocation(q,query);return `<button class="directory-item ${i===currentIndex?"current":""}" aria-label="${sessionId?"跳至第":"从第"}${i+1}${sessionId?"题":"题开始"}：${esc(questionLead(q))}" data-action="${sessionId?`jump-session:${i}`:`start-directory:${i}`}"><b>${i+1}</b><span class="type">${questionTypeLabel(q)}</span><span class="directory-copy"><span class="directory-text">${esc(questionLead(q))}</span>${location?`<small class="directory-match">命中${esc(location)}</small>`:""}</span></button>`}).join("");
}
function directorySearchActionsHtml(route: Extract<Route,{view:"directory"}>, count:number):string {
  if(route.sessionId || !route.query?.trim() || !count)return "";
  const noun=route.kind==="memorization"?"背诵":"刷题";
  return `<div class="directory-search-actions"><button class="primary" data-action="start-directory-search:sequential">顺序${noun==="背诵"?"背诵":"练习"}（${count}）</button><button data-action="start-directory-search:random">随机${noun==="背诵"?"背诵":"练习"}</button></div>`;
}
async function directoryView(route: Extract<Route,{view:"directory"}>) {
  let rows: QuestionRow[]=[]; let title=route.sessionId?"跳至此题":"从此题开始"; let currentIndex=-1;
  if(route.sessionId){
    const session=await sessionById(route.sessionId); if(!session){notify("学习进度不存在");return goBack();}
    const ids=JSON.parse(session.question_ids_json) as string[]; const found=await getQuestions(ids); const byId=new Map(found.map(r=>[r.id,r]));
    rows=ids.map(id=>byId.get(id)).filter(Boolean) as QuestionRow[]; currentIndex=session.current_index;
  } else {
    const all=await questionsForScope(route.nodeIds??[]); rows=route.kind==="memorization"?all.filter(q=>q.type==="memorization"):all.filter(isEnabledBrush);
  }
  if(!rows.length){return shell(title,`${emptyState("没有可定位的内容","请重新选择学习范围。",{text:"去学习",id:"scope"})}`);}
  const query=route.query??"",index=indexDirectory(rows);let entries=searchDirectory(index,query),limit=100,timer=0,currentQuery=query;
  shell(title,`<div class="directory-search"><input id="directory-search" type="search" placeholder="搜索题目" value="${esc(query)}"><span id="directory-search-count"></span></div><div id="directory-search-actions"></div><div class="directory-jump"><input id="directory-index" type="number" min="1" max="${rows.length}" value="${Math.max(1,currentIndex+1)}" inputmode="numeric"><button data-action="directory-go">跳转</button></div><div id="directory-list" class="directory-list"></div><button id="directory-more" type="button">显示更多</button>`);
  const list=document.querySelector<HTMLElement>("#directory-list")!,count=document.querySelector<HTMLElement>("#directory-search-count")!,actions=document.querySelector<HTMLElement>("#directory-search-actions")!,more=document.querySelector<HTMLButtonElement>("#directory-more")!;
  const draw=()=>{list.innerHTML=directoryListHtml(entries.slice(0,limit),route.sessionId,currentIndex,currentQuery);list.inert=false;list.removeAttribute("aria-busy");renderMath(list);count.textContent=`${currentQuery.trim()?`找到 ${entries.length} / ${rows.length}`:`共 ${rows.length} 项`}${entries.length>limit?` · 已显示 ${limit}`:""}`;more.hidden=entries.length<=limit;actions.innerHTML=directorySearchActionsHtml({...route,query:currentQuery},entries.length);};
  draw();more.onclick=()=>{limit+=100;draw();};
  const search=document.querySelector<HTMLInputElement>("#directory-search");
  search?.addEventListener("input",()=>{
    history.replaceState({...route,query:search.value},"");clearTimeout(timer);list.inert=true;list.setAttribute("aria-busy","true");actions.innerHTML="";more.hidden=true;count.textContent="正在搜索…";
    timer=window.setTimeout(()=>{if(!search.isConnected)return;currentQuery=search.value;entries=searchDirectory(index,currentQuery);limit=100;draw();},180);
  });
}

async function openSession(id:string){
  activeSession=await sessionById(id);
  if(!activeSession){ history.replaceState({view:"home"} satisfies Route, ""); return home(); }
  const ids=JSON.parse(activeSession.question_ids_json) as string[]; const rows=await getQuestions(ids); const byId=new Map(rows.map(r=>[r.id,r])); activeRows=ids.map(i=>byId.get(i)).filter(Boolean) as QuestionRow[];
  const saved = JSON.parse(activeSession.state_json||"{}") as {selection?:string[];excludedOptions?:string[];blankValue?:string;quickMode?:boolean;submitted?:boolean;correct?:boolean;pendingManual?:boolean;revealed?:boolean;recallShown?:boolean};
  quickMode=!!saved.quickMode; pageState={submitted:saved.submitted,correct:saved.correct,pendingManual:saved.pendingManual,revealed:saved.revealed,recallShown:saved.recallShown}; selection=new Set(saved.selection??[]); excludedOptions=new Set(saved.excludedOptions??[]); blankValue=saved.blankValue??""; await quizView();
}

function memorizationBody(q: QuestionInput, shown: boolean) {
  const keyPoints = q.keyPoints?.length ? `<div class="key-points"><h3>要点</h3><ul>${q.keyPoints.map(x=>`<li>${esc(x)}</li>`).join("")}</ul></div>` : "";
  return `<div class="type">背诵</div><h2 class="stem">${esc(q.prompt)}</h2>${shown?`<div class="answer-panel"><div class="multiline">${esc(q.content)}</div>${keyPoints}${explanation(q)}</div>`:button("显示内容","show-content","primary")}`;
}

async function quizView(){
  if(!activeSession||!activeRows.length){ history.replaceState({view:"home"} satisfies Route, ""); return home(); }
  const index=activeSession.current_index; if(index>=activeRows.length){ await saveSession(activeSession.id,index,{},true); return finishView(); }
  const row=activeRows[index],q=parseQuestion(row), fav=await isFavorite(row.id), killed=await isKilled(row.id), reviewed=await isReviewed(row.id), note=await getNote(row.id); const progress=`${index+1} / ${activeRows.length}`;
  const shown = quickMode || !!pageState.revealed || !!pageState.recallShown;
  let content="";
  if(q.type==="recall") content=`<div class="type">背诵卡</div><h2 class="stem">${esc(q.front)}</h2>${shown?`<div class="answer-panel"><h3>答案</h3><div class="multiline">${esc(q.back)}</div>${explanation(q)}</div>`:button("显示答案","show-content","primary")}`;
  else if(q.type==="memorization") content=memorizationBody(q,shown);
  else {
    content=`<div class="type">${q.type==="single_choice"?"单选题":q.type==="multiple_choice"?"多选题":"填空题"}</div><h2 class="stem">${esc(q.stem)}</h2>`;
    if(q.options) content+=`${!pageState.submitted && !pageState.pendingManual ? '<p class="option-help">长按选项可标记排除，再次长按可撤销。</p>' : ''}<div class="options">${q.options.map(o=>`<button class="option ${selection.has(o.id)?"selected":""} ${excludedOptions.has(o.id)?"excluded":""} ${pageState.submitted?(Array.isArray(q.answer)?q.answer:[q.answer]).includes(o.id)?"right":selection.has(o.id)?"wrong":"":""}" data-action="option:${esc(o.id)}" data-option-id="${esc(o.id)}" aria-pressed="${selection.has(o.id)}" ${pageState.submitted?"disabled":""}><b>${esc(o.id)}</b><span class="option-copy"><span>${esc(o.text)}</span>${optionResult(q,o.id,selection.has(o.id),!!pageState.submitted)}</span></button>`).join("")}</div>`;
    if(q.type==="blank") content+=`<input id="blank" class="blank" placeholder="输入答案" value="${esc(blankValue)}" ${pageState.submitted||pageState.pendingManual?"disabled":""}>`;
    if(pageState.submitted||pageState.pendingManual) content+=resultPanel(q);
  }
  const canSubmit=q.type==="blank"?!!blankValue.trim():selection.size>0;
  let bottom="";
  if(q.type==="recall"||q.type==="memorization") bottom=shown?button(index+1===activeRows.length?"完成":"下一项","next","primary"):"";
  else if(pageState.pendingManual) bottom=`${button("答错","manual:false","grading-wrong")}${button("答对","manual:true","primary")}`;
  else if(pageState.submitted) bottom=button(index+1===activeRows.length?"完成":"下一题","next","primary");
  else if(quickMode && q.type==="single_choice") bottom="";
  else bottom=`<button class="primary" data-action="submit" ${canSubmit?"":"disabled"}>提交</button>`;
  const quickAvailable=["sequential","random","recall","memorization"].includes(activeSession.mode);
  const quickButton=quickAvailable?`<button class="header-action ${quickMode?"active":""}" data-action="toggle-quick" aria-pressed="${quickMode}">快刷${quickMode?"✓":""}</button>`:"";
  shell(progress,`<article class="quiz">${content}</article><div class="question-actions"><button data-action="favorite:${esc(row.id)}">${fav?"★ 已收藏":"☆ 收藏"}</button><button class="${note?"note-active":""}" data-action="note:${esc(row.id)}">${note?"● 笔记":"笔记"}</button><details class="question-more"><summary>更多</summary><div class="question-more-actions"><button data-action="edit:${esc(row.id)}">编辑</button><button class="${killed?"restore-action":"destructive-action"}" data-action="kill:${esc(row.id)}" ${reviewed?"disabled":""}>${reviewed?"已斩杀":killed?"恢复":"斩杀"}</button><button class="${reviewed?"review-active":""}" data-action="review:${esc(row.id)}">${reviewed?"● 待返修":"标记问题"}</button></div></details></div>${bottom?`<div class="bottom-actions">${bottom}</div>`:""}`,true,quickButton,"session-directory");
  const blank=document.querySelector<HTMLInputElement>("#blank"); if(blank) blank.oninput=()=>{if(studyBusy)return;blankValue=blank.value; const submit=document.querySelector<HTMLButtonElement>('[data-action="submit"]'); if(submit)submit.disabled=!blankValue.trim(); void persistDraft().catch(reportSaveError);};
  bindOptionLongPress();
}
function explanation(q:QuestionInput){return `<div class="explain"><h3>解析</h3><div class="multiline">${q.explanation?esc(q.explanation):"无解析"}</div></div>`;}
function optionResult(q:QuestionInput,id:string,picked:boolean,submitted:boolean):string {
  if(!submitted)return "";
  const correct=(Array.isArray(q.answer)?q.answer:[q.answer]).includes(id);
  const label=correct?picked?"✓ 选对":q.type==="multiple_choice"?"✓ 漏选":"✓ 正确答案":picked?"✕ 错选":"";
  return label?`<small class="option-result">${label}</small>`:"";
}
function answerText(q:QuestionInput){ if(q.options){const ids=Array.isArray(q.answer)?q.answer:[q.answer]; return q.options.filter(o=>ids.includes(o.id)).map(o=>`${o.id}. ${o.text}`).join("；");} return String(q.answer??q.back??q.content??""); }
function resultPanel(q:QuestionInput){const answer=q.options?"":`<div class="multiline"><b>正确答案：</b>${esc(answerText(q))}</div>`;return `<section class="answer-panel"><h3>${pageState.pendingManual?"请自行判断":pageState.correct?"回答正确":"回答错误"}</h3>${answer}${explanation(q)}</section>`;}
function reportSaveError(error: unknown){notify(error instanceof Error?error.message:String(error));}
let studyBusy=false;
let studyDone:Promise<void>=Promise.resolve();
async function withStudyAction(task:()=>Promise<void>):Promise<void>{
  if(studyBusy)return;
  studyBusy=true;
  let release!:()=>void;
  studyDone=new Promise<void>(resolve=>release=resolve);
  const controls=[...app.querySelectorAll<HTMLButtonElement|HTMLInputElement>("button:not(:disabled),input:not(:disabled)")];
  const focused=document.activeElement as HTMLElement|null;
  controls.forEach(control=>control.disabled=true);
  try{await flushDrafts();await task();}
  finally{studyBusy=false;controls.forEach(control=>control.disabled=false);if(focused?.isConnected&&!focused.matches(":disabled"))focused.focus({preventScroll:true});release();}
}
async function persistDraft(){
  if(!activeSession)return;
  const session=activeSession,index=session.current_index,state={...pageState,selection:[...selection],excludedOptions:[...excludedOptions],blankValue,quickMode};
  await enqueueDraft(`session:${session.id}`,async()=>{await saveSessionDraft(session.id,index,state);session.state_json=JSON.stringify(state);});
}
async function submit(){return withStudyAction(async()=>{ if(!activeSession||pageState.submitted||pageState.pendingManual)return; const row=activeRows[activeSession.current_index];if(!row)return;const q=parseQuestion(row);const answer=q.type==="blank"?blankValue:[...selection];
  if(q.type==="blank"?!blankValue.trim():!selection.size)return;
  const grade=gradeQuestion(q,answer);
  if(grade===null){const old=pageState;pageState={pendingManual:true};try{await persistDraft();}catch(error){pageState=old;throw error;}return quizView();}
  await recordAnswer(row.id,answer,"auto",grade);
});}
async function record(questionId:string,answer:unknown,grading:string,correct:boolean){return withStudyAction(()=>recordAnswer(questionId,answer,grading,correct));}
async function recordAnswer(questionId:string,answer:unknown,grading:string,correct:boolean){
  if(!activeSession||pageState.submitted)return;
  const state={submitted:true,correct,selection:[...selection],excludedOptions:[...excludedOptions],blankValue,quickMode};
  await recordSessionAnswer(activeSession,questionId,answer,grading,correct,state);
  pageState={submitted:true,correct};activeSession.state_json=JSON.stringify(state);
  if(quickMode&&correct){try{return await advance();}catch(error){await quizView();throw error;}}
  await quizView();
}
async function next(){return withStudyAction(advance);}
async function advance(){if(!activeSession)return;const nextIndex=activeSession.current_index+1;await saveSession(activeSession.id,nextIndex,{quickMode},nextIndex>=activeRows.length);activeSession.current_index=nextIndex;activeSession.state_json=JSON.stringify({quickMode});selection.clear();excludedOptions.clear();blankValue="";pageState={};if(nextIndex>=activeRows.length)finishView();else await quizView();}
function finishView(){shell("本轮完成",`<div class="empty finish-page"><div class="finish">✓</div><h2>完成 ${activeRows.length} 项</h2>${activeSession?button("再来一组",`repeat-session:${activeSession.id}`,"primary"):""}${button("错题","wrong")}${button("首页","home")}</div>`,false);}
async function repeatRound(id:string):Promise<void>{
  let created:string|undefined;
  await withStudyAction(async()=>{
    const session=await sessionById(id);if(!session?.completed_at)throw new Error("本轮尚未完成");
    const scope=JSON.parse(session.scope_json),oldIds=JSON.parse(session.question_ids_json) as string[],oldRows=await getQuestions(oldIds);
    const nodes=await getNodes(),nodeIds=Array.isArray(scope.ranges)?expandPresetRanges(scope.ranges,nodes,new Set((await getQuestions()).map(r=>r.node_id))):scope.nodeIds??[...new Set(oldRows.map(r=>r.node_id))];
    let rows=session.mode==="wrong"?await wrongQuestions():session.mode==="favorites"?await favoriteQuestions():await questionsForScope(nodeIds);
    const types=scope.types??(session.mode==="memorization"?["memorization"]:[...new Set(oldRows.map(r=>r.type))]);rows=rows.filter(row=>types.includes(row.type));
    if(scope.searchQuery)rows=rows.filter(row=>directoryMatches(parseQuestion(row),scope.searchQuery));
    const random=scope.order==="random"||session.mode==="random",count=scope.count??oldIds.length;
    if(random)rows=shuffled(rows).slice(0,count);
    if(!rows.length)throw new Error("原范围已失效或没有可用内容，请重新选择范围");
    created=await createSession(session.mode,{...scope,nodeIds,types,order:random?"random":"sequential",count:random?count:undefined},rows.map(row=>row.id));
  });
  if(created)await navigate({view:"session",id:created});
}
function updateOptionStyles(selected:ReadonlySet<string>,excluded:ReadonlySet<string>=new Set(),prefix="option:"):void{
  for(const el of app.querySelectorAll<HTMLButtonElement>(`.option[data-action^="${prefix}"]`)){const id=el.dataset.action!.slice(prefix.length);el.classList.toggle("selected",selected.has(id));el.classList.toggle("excluded",excluded.has(id));el.setAttribute("aria-pressed",String(selected.has(id)));}
  const submit=app.querySelector<HTMLButtonElement>(`[data-action="${prefix==="option:"?"submit":"temp-submit"}"]`);if(submit)submit.disabled=!selected.size;
}

function bindOptionLongPress(){
  if(pageState.submitted||pageState.pendingManual)return;
  for(const el of document.querySelectorAll<HTMLButtonElement>("[data-option-id]")){
    let timer=0;
    const id=el.dataset.optionId!;
    const cancel=()=>{if(timer){clearTimeout(timer);timer=0;}};
    el.addEventListener("pointerdown",()=>{ cancel(); timer=window.setTimeout(()=>{ timer=0;if(studyBusy||!el.isConnected||pageState.submitted||pageState.pendingManual)return; if(excludedOptions.has(id)) excludedOptions.delete(id); else {excludedOptions.add(id);selection.delete(id);} suppressOptionClickId=id;suppressOptionClickUntil=Date.now()+800;updateOptionStyles(selection,excludedOptions);void persistDraft().catch(reportSaveError); },480); });
    el.addEventListener("pointerup",cancel); el.addEventListener("pointercancel",cancel); el.addEventListener("pointerleave",cancel);
    el.addEventListener("contextmenu",e=>e.preventDefault());
  }
}

async function editQuestionView(questionId:string) {
  const row=(await getQuestions([questionId]))[0]; if(!row){notify("内容不存在");return goBack();}
  const q=parseQuestion(row), reviewed=await isReviewed(questionId);
  const textField=(label:string,name:string,value:string,rows=3)=>`<label class="editor-field"><span>${label}</span><textarea name="${name}" rows="${rows}">${esc(value)}</textarea></label>`;
  let fields="";
  if(q.type==="recall") { fields+=textField("正面","front",q.front??"",3); fields+=textField("背面","back",q.back??"",5); }
  else if(q.type==="memorization") { fields+=textField("提示","prompt",q.prompt??"",3); fields+=textField("内容","content",q.content??"",8); fields+=textField("要点（每行一条）","keyPoints",(q.keyPoints??[]).join("\n"),5); }
  else {
    fields+=textField("题干","stem",q.stem??"",4);
    if(q.type==="single_choice"||q.type==="multiple_choice"){
      fields+=`<section class="editor-options"><div class="editor-label">选项 / 正确答案</div>${(q.options??[]).map((o,i)=>{ const checked=Array.isArray(q.answer)?q.answer.includes(o.id):q.answer===o.id; const kind=q.type==="single_choice"?"radio":"checkbox"; return `<div class="editor-option"><label class="answer-pick"><input type="${kind}" name="correct" value="${esc(o.id)}" ${checked?"checked":""}><span>${esc(o.id)}</span></label><textarea name="option-${i}" rows="2">${esc(o.text)}</textarea></div>`; }).join("")}</section>`;
    } else if(q.type==="blank") fields+=textField("标准答案","answer",String(q.answer??""),2);
  }
  fields+=textField("解析","explanation",q.explanation??"",6);
  const actions = reviewed
    ? button("保存",`save-edit:${questionId}`,"primary")
    : `${button("保存",`save-edit:${questionId}`)}${button("保存并送审",`save-edit-review:${questionId}`,"primary")}`;
  shell("编辑",`<form id="question-editor" class="editor card" data-question-id="${esc(questionId)}">${fields}<div id="message" class="message"></div><div class="edit-actions form-bottom-actions">${actions}</div></form>`);
  document.querySelector<HTMLFormElement>("#question-editor")!.addEventListener("submit", e => e.preventDefault());
}

function changedReviewIssues(before: QuestionInput, after: QuestionInput): ReviewIssue[] {
  const changed=(a:unknown,b:unknown)=>JSON.stringify(a??null)!==JSON.stringify(b??null);
  const out:ReviewIssue[]=[];
  if(before.type==="recall") { if(changed([before.front,before.back],[after.front,after.back])) out.push("stem"); }
  else if(before.type==="memorization") { if(changed([before.prompt,before.content,before.keyPoints],[after.prompt,after.content,after.keyPoints])) out.push("stem"); }
  else if(changed(before.stem,after.stem)) out.push("stem");
  if((before.type==="single_choice"||before.type==="multiple_choice") && changed(before.options,after.options)) out.push("options");
  if((before.type==="single_choice"||before.type==="multiple_choice"||before.type==="blank") && changed(before.answer,after.answer)) out.push("answer");
  if(changed(before.explanation,after.explanation)) out.push("explanation");
  return out;
}

async function saveQuestionEdit(questionId:string, sendToReview=false) {
  const row=(await getQuestions([questionId]))[0]; if(!row) throw new Error("内容不存在");
  const before=parseQuestion(row); const q=JSON.parse(JSON.stringify(before)) as QuestionInput; const form=document.querySelector<HTMLFormElement>("#question-editor"); if(!form) throw new Error("编辑表单不存在");
  const data=new FormData(form); const required=(name:string,label:string)=>{const value=String(data.get(name)??"").trim();if(!value)throw new Error(`${label}不能为空`);return value;};
  if(q.type==="recall") { q.front=required("front","正面"); q.back=required("back","背面"); }
  else if(q.type==="memorization") { q.prompt=required("prompt","提示"); q.content=required("content","内容"); q.keyPoints=[...new Set(String(data.get("keyPoints")??"").split(/\r?\n/).map(x=>x.trim()).filter(Boolean))]; }
  else {
    q.stem=required("stem","题干");
    if(q.type==="single_choice"||q.type==="multiple_choice"){
      if(!q.options?.length) throw new Error("题目没有选项"); q.options=q.options.map((o,i)=>({...o,text:required(`option-${i}`,`选项 ${o.id}`)})); const answers=data.getAll("correct").map(String);
      if(q.type==="single_choice"){if(answers.length!==1)throw new Error("单选题必须选择一个正确答案");q.answer=answers[0];} else {if(!answers.length)throw new Error("多选题至少选择一个正确答案");q.answer=answers;}
    } else q.answer=required("answer","标准答案");
  }
  q.explanation=String(data.get("explanation")??"").trim(); await updateQuestionContent(questionId,q);
  if(sendToReview){
    const issues=changedReviewIssues(before,q); const effective=issues.length?issues:["other" as ReviewIssue];
    const labels=new Map(reviewIssueLabels); const changedText=issues.length?issues.map(x=>labels.get(x)??x).join("、"):"当前题目";
    const note=issues.length
      ? `用户已手工修改${changedText}。请检查修改后的内容是否准确、表述是否清晰、选项是否具有区分度，并确认答案与解析保持一致。`
      : "用户请求检查当前题目内容，请确认题干、选项、答案与解析是否准确且相互一致。";
    await saveReview(questionId,effective,note,true);
    const wasCurrent=!!activeSession && activeRows[activeSession.current_index]?.id===questionId;
    if(wasCurrent&&activeSession){ notify("已保存并加入待返修","ok"); history.replaceState({view:"session",id:activeSession.id} satisfies Route,""); return next(); }
    notify("已保存并加入待返修","ok"); return goBack();
  }
  if(await isReviewed(questionId) && confirm("题目已修改。\n\n是否标记为返修完成？历史判分会保留；当前错题仅看返修后的新作答，并按审核前状态决定是否恢复到题池。")){ await completeReview(questionId); notify("已保存并完成返修","ok"); }
  else notify("已保存","ok");
  return goBack();
}

async function noteView(questionId:string) {
  const row=(await getQuestions([questionId]))[0]; if(!row){notify("内容不存在");return goBack();}
  const q=parseQuestion(row), note=await getNote(questionId);
  shell("笔记",`<section class="card note-editor"><div class="note-question"><span class="type">${questionTypeLabel(q)}</span><div class="multiline">${esc(questionLead(q))}</div></div>
    <label class="editor-field"><span>个人笔记</span><textarea id="note-content" rows="12" placeholder="记录易错点、辨析、记忆线索……">${esc(note?.content??"")}</textarea></label>
    <div id="message" class="message"></div>
    <div class="note-actions form-bottom-actions">${note?button("删除笔记",`delete-note:${questionId}`,"delete-link"):""}${button("保存",`save-note:${questionId}`,"primary")}</div>
  </section>`);
}
async function saveQuestionNote(questionId:string){
  const value=document.querySelector<HTMLTextAreaElement>("#note-content")?.value??"";
  await saveNote(questionId,value); notify(value.trim()?"已保存":"已清空","ok"); return goBack();
}

const reviewIssueLabels: Array<[ReviewIssue,string]> = [["stem","题干 / 内容"],["options","选项"],["answer","答案"],["explanation","解析"],["other","其他"]];
const reviewPresets: Array<{label:string;issues:ReviewIssue[];text:string}> = [
  {label:"选项可盲猜",issues:["options"],text:"选项之间存在明显的形式或语义线索，可在未掌握知识点的情况下直接盲猜或排除，需要提高干扰项的合理性和区分度。"},
  {label:"错误项胡言乱语",issues:["options"],text:"错误选项明显缺乏合理性，甚至属于与题意无关或胡言乱语的内容，可直接排除，需要重做干扰项。"},
  {label:"多项均可成立",issues:["options","answer"],text:"多个选项在当前题干条件下均可能成立，题目区分度不足，需要补足条件或调整答案与选项。"},
  {label:"选项重复 / 重叠",issues:["options"],text:"选项之间存在重复、同义或边界重叠，无法形成清晰互斥的判断，需要重新设计选项。"},
  {label:"题干不清 / 条件不足",issues:["stem"],text:"题干表述不够清晰或必要条件不足，可能导致不同理解，需要补充条件并收紧设问。"},
  {label:"答案疑似错误",issues:["answer"],text:"标准答案疑似错误或与题干条件不一致，需要重新核对知识依据。"},
  {label:"解析有问题",issues:["explanation"],text:"解析存在错误、与答案矛盾或解释不足，需要核对并重写解析。"},
  {label:"价值低 / 高度重复",issues:["other"],text:"本题考查价值较低，或与已有题目高度重复，建议重构考查角度或删除。"},
  {label:"用户修改需检查",issues:["other"],text:"用户已手工修改题目内容，请检查修改后的内容是否准确、表述是否清晰、选项是否具有区分度，并确认答案与解析保持一致。"}
];

async function reviewView(questionId:string){
  const row=(await getQuestions([questionId]))[0]; if(!row){notify("内容不存在");return goBack();}
  const q=parseQuestion(row), review=await getReview(questionId); const selected=new Set<ReviewIssue>(review?JSON.parse(review.issues_json):[]);
  const presetButtons=reviewPresets.map((preset,i)=>`<button type="button" class="review-preset" data-action="review-preset:${i}">${esc(preset.label)}</button>`).join("");
  const reviewActions=review
    ? `${button("取消审核",`cancel-review:${questionId}`,"delete-link")}${button("返修完成",`complete-review:${questionId}`,"destructive-action")}${button("保存审核",`save-review:${questionId}`,"primary")}`
    : button("加入返修",`save-review:${questionId}`,"primary");
  shell(review?"编辑审核":"审核",`<section class="card review-editor">${reviewQuestionPreview(q)}
    <div><div class="editor-label">常见问题</div><div class="review-presets">${presetButtons}</div></div>
    <div class="editor-label">问题位置</div><div class="review-issues">${reviewIssueLabels.map(([value,label])=>`<label><input type="checkbox" name="review-issue" value="${value}" ${selected.has(value)?"checked":""}><span>${label}</span></label>`).join("")}</div>
    <label class="editor-field"><span>审核意见</span><textarea id="review-note" rows="7" placeholder="说明需要返修或检查的原因……">${esc(review?.note??"")}</textarea></label>
    <div id="message" class="message"></div>
    <div class="review-actions form-bottom-actions">${reviewActions}</div>
  </section>`);
}
function applyReviewPreset(index:number){
  const preset=reviewPresets[index]; if(!preset)return;
  for(const issue of preset.issues){const input=document.querySelector<HTMLInputElement>(`input[name="review-issue"][value="${issue}"]`);if(input)input.checked=true;}
  const textarea=document.querySelector<HTMLTextAreaElement>("#review-note"); if(!textarea)return;
  const current=textarea.value.trim(); if(!current.includes(preset.text)) textarea.value=current?`${current}\n${preset.text}`:preset.text;
  textarea.focus(); textarea.setSelectionRange(textarea.value.length,textarea.value.length);
}
async function saveQuestionReview(questionId:string){
  const issues=[...document.querySelectorAll<HTMLInputElement>('input[name="review-issue"]:checked')].map(x=>x.value as ReviewIssue);
  const note=document.querySelector<HTMLTextAreaElement>("#review-note")?.value??"";
  const wasCurrent=!!activeSession && activeRows[activeSession.current_index]?.id===questionId;
  await saveReview(questionId,issues,note);
  if(wasCurrent&&activeSession){ notify("已加入待返修并斩杀","ok"); history.replaceState({view:"session",id:activeSession.id} satisfies Route,""); return next(); }
  notify("已加入待返修并斩杀","ok"); return goBack();
}

function storedUserAnswerText(q:QuestionInput, raw:string|null|undefined): string {
  if(raw==null)return "";
  let value: unknown; try{value=JSON.parse(raw);}catch{value=raw;}
  if(q.options){const ids=Array.isArray(value)?value:[value];return q.options.filter(o=>ids.includes(o.id)).map(o=>`${o.id}. ${o.text}`).join("；")||String(Array.isArray(value)?value.join("、"):value??"");}
  return String(Array.isArray(value)?value.join("、"):value??"");
}
function multipleChoiceDifference(q:QuestionInput,raw:string|null|undefined):string {
  let parsed:unknown;
  try{parsed=JSON.parse(raw??"null");}catch{parsed=raw;}
  const selected=new Set<string>(Array.isArray(parsed)?parsed.filter((id):id is string=>typeof id==="string"):typeof parsed==="string"?[parsed]:[]);
  const expected=new Set<string>(Array.isArray(q.answer)?q.answer:[]);
  const labels=new Map((q.options??[]).map(option=>[option.id,option.text]));
  const format=(ids:string[])=>ids.length?ids.map(id=>esc(labels.has(id)?`${id}. ${labels.get(id)}`:id)).join("；"):"无";
  const wrong=[...selected].filter(id=>!expected.has(id));
  const missed=[...expected].filter(id=>!selected.has(id));
  return `<div class="wrong-diff-row"><b>错选</b><span class="multiline">${format(wrong)}</span></div><div class="wrong-diff-row"><b>漏选</b><span class="multiline">${format(missed)}</span></div>`;
}
function expandableQuestionDetail(q:QuestionInput): string {
  const explain=q.explanation?`<section class="review-preview-section"><b>解析</b><div class="multiline">${esc(q.explanation)}</div></section>`:"";
  if(q.type==="single_choice"||q.type==="multiple_choice"){
    const answerIds=new Set(Array.isArray(q.answer)?q.answer:[String(q.answer??"")]);
    const options=(q.options??[]).map(o=>`<div class="review-preview-option ${answerIds.has(o.id)?"correct":""}"><b>${esc(o.id)}</b><span class="multiline">${esc(o.text)}</span></div>`).join("");
    return `<div class="review-question-preview detail-only"><div class="review-preview-options">${options}</div>${explain}</div>`;
  }
  if(q.type==="blank")return `<div class="review-question-preview detail-only"><section class="review-preview-section"><b>标准答案</b><div class="multiline">${esc(String(q.answer??""))}</div></section>${explain}</div>`;
  if(q.type==="recall")return `<div class="review-question-preview detail-only"><section class="review-preview-section"><b>背面</b><div class="multiline">${esc(q.back)}</div></section>${explain}</div>`;
  const keyPoints=q.keyPoints?.length?`<section class="review-preview-section"><b>要点</b><ul>${q.keyPoints.map(x=>`<li class="multiline">${esc(x)}</li>`).join("")}</ul></section>`:"";
  return `<div class="review-question-preview detail-only"><section class="review-preview-section"><b>内容</b><div class="multiline">${esc(q.content)}</div></section>${keyPoints}${explain}</div>`;
}

function listCardAction(kind:ExpandableListKind,id:string): string { return `toggle-list-card:${kind}:${encodeURIComponent(id)}`; }
function listHeaderToggle(kind:ExpandableListKind,ids:string[]): string {
  const set=expandedSet(kind), all=ids.length>0&&ids.every(id=>set.has(id));
  return `<button class="header-symbol" data-action="list-toggle-all:${kind}" aria-label="${all?"全部收起":"全部展开"}" title="${all?"全部收起":"全部展开"}">${chevronIcon(all)}</button>`;
}
function expandableCard(kind:ExpandableListKind,row:QuestionRow,summaryExtra:string,actions:string,expandedExtra:string): string {
  const q=parseQuestion(row), expanded=expandedSet(kind).has(row.id), action=listCardAction(kind,row.id);
  return `<div class="card compact-list-card expandable-list-card ${expanded?"expanded":""}"><div class="compact-card-head"><span class="type">${questionTypeLabel(q)}</span><div class="compact-card-actions">${actions}</div></div><button class="expandable-card-summary" data-action="${action}" aria-expanded="${expanded}" aria-label="${expanded?"收起":"展开"}：${esc(questionLead(q))}"><span class="compact-card-title multiline">${esc(questionLead(q))}</span><span class="expandable-card-symbol" aria-hidden="true">${chevronIcon(!expanded)}</span>${summaryExtra}</button>${expanded?`<div class="expandable-card-detail">${expandableQuestionDetail(q)}${expandedExtra}</div>`:""}</div>`;
}
async function listView(kind:ListKind) {
  if(kind==="killed"){const rows=await killedQuestions();return shell("已斩杀",rows.length?`<div class="question-list">${rows.map(r=>{const q=parseQuestion(r);return `<div class="card"><span class="type">${questionTypeLabel(q)}</span><p class="multiline">${esc(questionLead(q))}</p><button class="restore-action" data-action="restore-killed:${esc(r.id)}">恢复</button></div>`}).join("")}</div>`:emptyState("暂无已斩杀题目","",{text:"返回题库管理",id:"import"}));}
  if(kind==="notes"){
    const rows=await noteQuestions();
    const body=rows.map(r=>expandableCard("notes",r,`<span class="note-preview compact-preview multiline">${esc(r.note_content)}</span>`,`<button data-action="note:${esc(r.id)}">编辑</button>`,`<section class="expanded-meta"><b>笔记</b><div class="multiline">${esc(r.note_content)}</div></section>`)).join("");
    return shell("笔记",rows.length?`<div class="question-list compact-list">${body}</div>`:emptyState("暂无笔记","",{text:"去学习",id:"scope"}),true,rows.length?listHeaderToggle("notes",rows.map(r=>r.id)):"");
  }
  if(kind==="reviews"){
    const rows=await reviewQuestions(); const labels=new Map(reviewIssueLabels);
    const body=rows.map(r=>{const issues=(JSON.parse(r.review_issues_json) as ReviewIssue[]).map(x=>labels.get(x)??x).join(" / ");const q=parseQuestion(r);const attempt=r.latest_answered_at?`<section class="expanded-meta"><b>最近作答</b><div class="multiline">${esc(storedUserAnswerText(q,r.latest_user_answer))}</div><small>${r.latest_is_correct===1?"答对":"答错"} · ${esc(r.latest_answered_at)}</small></section>`:"";return expandableCard("reviews",r,`${issues?`<span class="review-tags">${esc(issues)}</span>`:""}${r.review_note?`<span class="note-preview compact-preview multiline">${esc(r.review_note)}</span>`:""}`,`${button("审核",`review:${r.id}`)}${button("编辑",`edit:${r.id}`)}`,`<section class="expanded-meta"><b>审核信息</b>${issues?`<div>${esc(issues)}</div>`:""}${r.review_note?`<div class="multiline">${esc(r.review_note)}</div>`:""}</section>${attempt}`)}).join("");
    return shell("待返修",rows.length?`${button("导出返修 JSON","export-repair-review","primary")}<div class="question-list compact-list">${body}</div>`:emptyState("暂无待返修题目","",{text:"去学习",id:"scope"}),true,rows.length?listHeaderToggle("reviews",rows.map(r=>r.id)):"");
  }
  if(kind==="wrong"){
    const rows=await wrongQuestions();
    const previousBatch=await latestBatchJob();
    const actions=`${button("导出","export-error-review")}${button("批量回炉","batch-new")}${rows.some(graded)?button("练习","practice:wrong","primary"):""}${previousBatch?button("继续批量任务",`batch-open:${previousBatch.id}`):""}`;
    const body=rows.map(r=>{const q=parseQuestion(r);const difference=q.type==="multiple_choice"?multipleChoiceDifference(q,r.latest_user_answer):`<b>本次错误答案</b><div class="multiline">${esc(storedUserAnswerText(q,r.latest_user_answer))}</div>`;const extra=`<section class="expanded-meta wrong-meta">${difference}<small>${esc(r.latest_answered_at)}</small></section>`;return expandableCard("wrong",r,"",button("AI 回炉",`ai-review:${encodeURIComponent(r.id)}`),extra)}).join("");
    const semantics = "最近一次答错的题目才显示，之后答对会自动移出；已斩杀、待返修题目不显示。答案修改或返修完成后，仅看此后的新作答。";
    const rules=`<details class="stats-rules"><summary>统计规则</summary><p class="list-help">${semantics}</p></details>`;
    return shell(`当前错题 ${rows.length}`,`${rows.length?`${actions}<div class="question-list compact-list">${body}</div>`:emptyState("暂无当前错题","",{text:"新练习",id:"scope"})}${rules}`,true,rows.length?listHeaderToggle("wrong",rows.map(r=>r.id)):"");
  }
  const rows=await favoriteQuestions();
  const actions=rows.some(graded)?button(`练习 ${rows.filter(graded).length} 题`,`practice:favorites`,"primary"):"";
  const body=rows.map(r=>expandableCard("favorites",r,"","","")).join("");
  return shell("收藏",rows.length?`${actions}<div class="question-list compact-list">${body}</div>`:emptyState("暂无收藏","",{text:"新练习",id:"scope"}),true,rows.length?listHeaderToggle("favorites",rows.map(r=>r.id)):"");
}
async function statsView(){const s=await stats();shell("统计",`<div class="stats"><div><b>${s.total}</b><span>总作答次数</span></div><div><b>${s.correct}</b><span>正确作答次数</span></div><div><b>${s.wrong}</b><span>错误作答次数</span></div><div><b>${s.rate}%</b><span>历史作答正确率</span></div><div><b>${s.currentWrong}</b><span>当前错题数</span></div></div><details class="stats-rules"><summary>统计规则</summary><p class="list-help">作答次数累计保留现存记录，排除待返修题目；当前错题只看最近一次作答，答对后自动移出，并排除已斩杀、待返修题目。答案修改或返修完成后，历史判分保留，当前错题仅看此后的新作答。</p></details>`);}

async function saveJsonFile(filename:string,data:unknown,title:string){
  const text=JSON.stringify(data,null,2); const file=new File([text],filename,{type:"application/json"});
  const nav=navigator as Navigator & { canShare?: (data: ShareData)=>boolean };
  try {
    if(navigator.share && (!nav.canShare || nav.canShare({files:[file]}))){ await navigator.share({files:[file],title}); return; }
  } catch(err) { if(err instanceof DOMException && err.name==="AbortError") return; }
  try {
    const url=URL.createObjectURL(file); const a=document.createElement("a"); a.href=url;a.download=filename;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1500); notify(`已生成 ${filename}`,"ok");
  } catch {
    try { await navigator.clipboard.writeText(text); notify("无法直接保存文件，JSON 已复制到剪贴板","ok"); }
    catch { notify("导出失败，请重试"); }
  }
}
async function tempGroupsView(): Promise<void> {
  const groups = await listTempGroups();
  const cards = groups.map((group,index) => {
    const total = tempBank(group).questions.length;
    const progress = group.completed_at ? "已完成" : `${Math.min(group.current_index + 1,total)} / ${total}`;
    return `<section class="card"><h2>${esc(group.source_question_title)}</h2><p>${esc(group.source_question_id === "batch" ? "批量题组" : `原题 ${group.source_question_id}`)} · ${esc(group.model)} · ${esc(formatUpdatedAt(group.updated_at))}</p><p>AI 练习 ${progress}</p><div class="grid">${button(group.completed_at ? "重练" : group.current_index ? "继续" : "练习", `temp-open:${group.id}`, index===0?"primary":"secondary")}${group.completed_at ? button("查看结果", `temp-review:${group.id}`) : button("从头开始", `temp-restart:${group.id}`)}${button("删除题组", `temp-delete:${group.id}`, "destructive-action")}</div></section>`;
  }).join("");
  shell("AI 题组", groups.length ? `<div class="stack">${cards}</div>` : emptyState("暂无 AI 题组", "", {text:"查看当前错题",id:"wrong"}));
}

async function tempSessionView(id: string): Promise<void> {
  const group = await getTempGroup(id);
  if (!group) { shell("AI 题组", emptyState("题组已删除或不存在", "返回AI 题组列表。", {text:"AI 题组",id:"temp-groups"})); return; }
  const questions = tempBank(group).questions, index = group.current_index, results = tempResults(group);
  if (group.completed_at || index >= questions.length) {
    const correct = results.filter(x => x.correct).length;
    shell("AI 练习完成", `<div class="empty finish-page"><div class="finish">✓</div><h2>完成了 ${questions.length} 题</h2><p>答对 ${correct} 题。临时作答仅保存在本题组。</p>${button("查看结果",`temp-review:${id}`,"primary")}${button("重练",`temp-restart:${id}`)}${button("AI 题组","temp-groups")}</div>`);
    return;
  }
  const q = questions[index], state = tempState(group);
  activeTempDraft={id,index,state,type:q.type};
  let content = `<div class="type">${q.type === "single_choice" ? "单选题" : q.type === "multiple_choice" ? "多选题" : "填空题"}</div><h2 class="stem">${esc(q.stem)}</h2>`;
  if (q.options) content += `<div class="options">${q.options.map(o => `<button class="option ${state.selection.includes(o.id) ? "selected" : ""} ${state.submitted ? (Array.isArray(q.answer) ? q.answer : [q.answer]).includes(o.id) ? "right" : state.selection.includes(o.id) ? "wrong" : "" : ""}" data-action="temp-option:${esc(o.id)}" aria-pressed="${state.selection.includes(o.id)}" ${state.submitted || state.pendingManual ? "disabled" : ""}><b>${esc(o.id)}</b><span class="option-copy"><span>${esc(o.text)}</span>${optionResult(q,o.id,state.selection.includes(o.id),state.submitted)}</span></button>`).join("")}</div>`;
  if (q.type === "blank") content += `<input id="temp-blank" class="blank" placeholder="输入答案" value="${esc(state.blank)}" ${state.submitted || state.pendingManual ? "disabled" : ""}>`;
  if (state.submitted || state.pendingManual) content += `<section class="answer-panel"><h3>${state.pendingManual ? "请自行判断" : state.correct ? "回答正确" : "回答错误"}</h3><div class="multiline"><b>正确答案：</b>${esc(answerText(q))}</div>${explanation(q)}</section>`;
  const controls = state.pendingManual
    ? `${button("答错","temp-manual:false","grading-wrong")}${button("答对","temp-manual:true","primary")}`
    : state.submitted
      ? button(index + 1 === questions.length ? "完成" : "下一题","temp-next","primary")
      : `<button class="primary" data-action="temp-submit" ${q.type === "blank" ? state.blank.trim() ? "" : "disabled" : state.selection.length ? "" : "disabled"}>提交</button>`;
  shell(`AI 练习 ${index + 1} / ${questions.length}`, `<article class="quiz">${content}</article><p>${esc(group.source_question_id === "batch" ? group.source_question_title : `源自原题 ${group.source_question_id}`)} · ${esc(group.model)}</p>${button("返回题组列表","temp-groups")}<div class="bottom-actions">${controls}</div>`, true);
  const blank = document.querySelector<HTMLInputElement>("#temp-blank");
  if (blank) blank.oninput = () => {
    if(studyBusy)return;
    const value = blank.value;
    state.blank=value;
    const submit = document.querySelector<HTMLButtonElement>('[data-action="temp-submit"]');
    if (submit) submit.disabled = !value.trim();
    void persistTempDraft(id,index,state).catch(reportSaveError);
  };
}
let activeTempDraft:{id:string;index:number;state:TempState;type:string}|null=null;
function persistTempDraft(id:string,index:number,state:TempState):Promise<void>{
  const captured=structuredClone(state);
  return enqueueDraft(`temp:${id}`,async()=>{const current=await getTempGroup(id);if(current&&current.current_index===index&&!current.completed_at){const saved=tempState(current);if(!saved.submitted&&!saved.pendingManual)await saveTempProgress(current,index,captured,tempResults(current));}});
}
function selectTempOption(option:string):void{
  const draft=activeTempDraft,route=history.state as Route;if(!draft||route.view!=="temp-session"||route.id!==draft.id||draft.state.submitted||draft.state.pendingManual)return;
  const el=app.querySelector<HTMLButtonElement>(`[data-action="temp-option:${CSS.escape(option)}"]`);if(!el)return;
  const single=draft.type==="single_choice";
  draft.state.selection=single?[option]:draft.state.selection.includes(option)?draft.state.selection.filter(id=>id!==option):[...draft.state.selection,option];
  updateOptionStyles(new Set(draft.state.selection),new Set(),"temp-option:");void persistTempDraft(draft.id,draft.index,draft.state).catch(reportSaveError);
}

async function saveAiTempGroup(): Promise<void> {
  const questionId = aiRouteQuestionId(), preview = aiPreview;
  if (!questionId || !preview || preview.questionId !== questionId || aiSavingGroup) return;
  aiSavingGroup = true;
  try {
  const id=await saveAiDraftToGroup(preview.draftId);if(!id)return notify("草稿已保存或丢弃，请刷新待审核列表");
  aiPreview = null;
  await navigate({view:"temp-session",id});
  } finally { aiSavingGroup = false; }
}

async function tempAnswer(correct: boolean, grading: "auto" | "manual"): Promise<void> {
  return withStudyAction(()=>recordTempAnswer(correct,grading));
}
async function tempReviewView(id:string):Promise<void>{
  const group=await getTempGroup(id);if(!group?.completed_at)return shell("AI 练习结果",emptyState("尚无完成结果","请先完成这组练习。",{text:"查看题组",id:"temp-groups"}));
  const answers=new Map(tempResults(group).map(result=>[result.questionId,result]));
  const cards=tempBank(group).questions.map((q,index)=>{const result=answers.get(q.id);return `<section class="card temp-review-result"><h2>第 ${index+1} 题 · ${result?result.correct?"正确":"错误":"未作答"}</h2><p>本次作答：${esc(result?Array.isArray(result.answer)?result.answer.join("、"):result.answer:"无")}</p><p>标准答案：${esc(answerText(q))}</p>${reviewQuestionPreview(q)}</section>`;}).join("");
  const wrong=[...answers.values()].filter(result=>!result.correct).length;
  shell("AI 练习结果",`<p>${esc(group.source_question_title)} · 本组错题 ${wrong} 道，保留原练习记录和来源。</p>${wrong?button(`只重练本组 ${wrong} 道错题`,`temp-retry-wrong:${id}`,"primary"):""}${cards}`);
}
async function aiDraftsView():Promise<void>{
  const drafts=await listAiDrafts();shell("待审核草稿",drafts.length?drafts.map((draft,index)=>`<section class="card"><h2>${esc(draft.source_question_title)}</h2><p>${esc(draft.model)} · ${esc(formatUpdatedAt(draft.generated_at))}</p>${button("查看候选题",`ai-draft:${draft.id}`,index===0?"primary":"secondary")}${button("丢弃草稿",`ai-discard:${draft.id}`,"destructive-action")}</section>`).join(""):emptyState("暂无待审核草稿",""));
}
async function tempAction(action:string):Promise<void>{
  const route=history.state as Route;if(route.view!=="temp-session")return;
  const group=await getTempGroup(route.id);if(!group||group.completed_at)return tempSessionView(route.id);
  const state=tempState(group),q=tempBank(group).questions[group.current_index];if(!q)return;
  if(action==="temp-next"){
    if(!state.submitted)return;
    const index=group.current_index+1;
    await saveTempProgress(group,index,emptyTempState(),tempResults(group),index>=tempBank(group).questions.length);
  }else if(action.startsWith("temp-manual:")){
    return recordTempAnswer(action.endsWith("true"),"manual");
  }else{
    if(state.submitted||state.pendingManual)return;
    if(action.startsWith("temp-option:")){
      const option=action.slice(12);if(!q.options?.some(o=>o.id===option))return;
      if(q.type==="single_choice")state.selection=[option];
      else if(q.type==="multiple_choice")state.selection=state.selection.includes(option)?state.selection.filter(x=>x!==option):[...state.selection,option];
    }else{
      if(q.type==="blank")state.blank=document.querySelector<HTMLInputElement>("#temp-blank")?.value??state.blank;
      if(q.type==="blank"?!state.blank.trim():!state.selection.length)return;
      const grade=gradeQuestion(q,q.type==="blank"?state.blank:state.selection);
      if(grade===null)state.pendingManual=true;
      else{
        const results=tempResults(group);
        if(results.some(result=>result.questionId===q.id))throw new Error("本题已保存结果，请重新打开题组");
        results.push({questionId:q.id,answer:q.type==="blank"?state.blank:[...state.selection],correct:grade,grading:"auto"});
        state.submitted=true;state.correct=grade;
        await saveTempProgress(group,group.current_index,state,results);
        return tempSessionView(route.id);
      }
    }
    await saveTempProgress(group,group.current_index,state,tempResults(group));
  }
  await tempSessionView(route.id);
}
async function recordTempAnswer(correct: boolean, grading: "auto" | "manual"): Promise<void> {
  const route = history.state as Route;
  if (route.view !== "temp-session") return;
  const group = await getTempGroup(route.id);
  if (!group || group.completed_at) return tempSessionView(route.id);
  const q = tempBank(group).questions[group.current_index], state = tempState(group);
  if (!q || state.submitted) return;
  if (grading === "manual" && !state.pendingManual) return;
  const answer = q.type === "blank" ? state.blank : state.selection;
  const results = tempResults(group);
  if(results.some(result=>result.questionId===q.id))throw new Error("本题已保存结果，请重新打开题组");
  results.push({questionId:q.id,answer,correct,grading});
  state.pendingManual = false; state.submitted = true; state.correct = correct;
  await saveTempProgress(group,group.current_index,state,results);
  await tempSessionView(route.id);
}

let batchRunningJobId: string | null = null;
let batchCurrentRequestId: string | null = null;
let batchCancelRequested = false;
let batchSavingReady = false;
let batchStarting=false,batchCreating=false;
let batchSelectedSources=new Set<string>();
const billingNotice="每道原题调用一次 AI API，可能收费。取消只停止本地请求，不能保证服务商不计费；失败重试会再次发送请求。格式通过的原题结果会保留。";

function batchRouteId(): string | null {
  const route = history.state as Route;
  return route?.view === "batch-review" ? route.id ?? null : null;
}
async function batchReviewView(id?: string): Promise<void> {
  const route = history.state as Route;
  if (route.view !== "batch-review" || route.id !== id) return;
  const status = await invoke<AiConfigStatus>("get_ai_config_status");
  if ((history.state as Route).view !== "batch-review") return;
  const config = status.configured
    ? `<p>DeepSeek V4.1 Flash · Key 已保存在本机</p>${button("清除已保存配置","batch-clear-config")}`
    : `<p>DeepSeek V4.1 Flash · 未配置 Key</p>`;
  const settings = `<details class="card ai-settings" ${status.configured ? "" : "open"}><summary>AI API 配置</summary>${config}<label>API Key<input id="batch-api-key" type="password" placeholder="${status.configured ? "填写新 Key 可替换" : "填写 DeepSeek API Key"}" autocomplete="off"></label>${button(status.configured ? "更换 API Key" : "保存 API Key","batch-save-config",status.configured?"secondary":"primary")}</details>`;
  if (!id) {
    const review = await buildCurrentWrongReview();
    const sourceCount=review.items.length, batches=Math.ceil(sourceCount / SOURCES_PER_BATCH);
    const body = sourceCount
      ? `<section class="card"><h2>选择本次回炉原题</h2><p>当前错题 ${sourceCount} 道。每批最多 ${SOURCES_PER_BATCH} 道原题，每次最多请求 ${MAX_SOURCES_PER_RUN} 道，只有格式通过的批次可保存。</p><label>选择前 N 道<input id="batch-source-count" type="number" min="1" max="${sourceCount}" value="${Math.min(12,sourceCount)}"></label>${button("选择前 N 道","batch-select-first")}${button("清空选择","batch-select-none")}<div class="batch-source-list">${review.items.map(item=>{const key=sourceKey(item.bank.id,item.question.id);return `<label><input type="checkbox" data-batch-source="${esc(key)}" ${batchSelectedSources.has(key)?"checked":""}>${esc(item.bank.title)} · ${esc(questionLead(item.question))}</label>`;}).join("")}</div><p id="batch-selection-summary"></p><p>${billingNotice} 已生成的原题再次选入新任务，仍会重新请求。</p>${button("确认创建并开始生成","batch-create",status.configured?"primary":"secondary")}</section>`
      : emptyState("暂无当前错题","",{text:"返回当前错题",id:"wrong"});
    shell("批量 AI 回炉",settings+body);
    const inputs=[...app.querySelectorAll<HTMLInputElement>("[data-batch-source]")];
    const update=()=>{batchSelectedSources=new Set(inputs.filter(input=>input.checked).map(input=>input.dataset.batchSource!));const selected=batchSelectedSources.size,summary=app.querySelector("#batch-selection-summary");if(summary)summary.textContent=`已选 ${selected} 道原题 · 预计 ${selected*GENERATED_PER_SOURCE} 道候选 · ${Math.ceil(selected/SOURCES_PER_BATCH)} 批`;const create=app.querySelector<HTMLButtonElement>('[data-action="batch-create"]');if(create)create.disabled=!selected;};
    inputs.forEach(input=>input.onchange=update);
    const first=app.querySelector<HTMLButtonElement>('[data-action="batch-select-first"]');if(first)first.onclick=()=>{const n=Math.max(1,Math.min(sourceCount,Math.trunc(Number(app.querySelector<HTMLInputElement>("#batch-source-count")?.value)||1)));inputs.forEach((input,index)=>input.checked=index<n);update();};
    const none=app.querySelector<HTMLButtonElement>('[data-action="batch-select-none"]');if(none)none.onclick=()=>{inputs.forEach(input=>input.checked=false);update();};update();
    return;
  }
  const job = await getBatchJob(id);
  if (!job) { shell("批量 AI 回炉",emptyState("任务已删除","请重新从当前错题发起。",{text:"返回当前错题",id:"wrong"})); return; }
  const batches=jobBatches(job);
  let repaired=false;
  for(const batch of batches)if(batch.savedGroupId && !(await getTempGroup(batch.savedGroupId))){delete batch.savedGroupId;repaired=true;}
  if(repaired)await saveBatchJob(job,batches);
  const ready=batches.filter(b=>b.status==="ready"), saved=ready.filter(b=>!!b.savedGroupId), failed=batches.filter(b=>b.status==="failed"), pending=batches.filter(b=>b.status==="pending");
  const running=batchRunningJobId===id, modelMatch=status.configured && status.model===job.model;
  const list=batches.map((batch,index)=>{
    const label=batch.savedGroupId?"已保存":batch.status==="ready"?"格式通过 · 待核对":batch.status==="failed"?"失败":"待生成";
    const controls=batch.status==="failed" && !running ? button("重试此批",`batch-retry:${index}`) : "";
    const preview=Object.entries(batch.banks).map(([key,bank])=>`<section><h4>原题 ${esc(JSON.parse(key)[1])}</h4>${bank.questions.map((q,i)=>`<div class="card"><h4>变式 ${i+1}</h4>${reviewQuestionPreview(q)}</div>`).join("")}</section>`).join("");
    return `<section class="card"><h3>第 ${index+1} 批 · ${batch.sourceKeys.length} 道原题 · ${label}</h3><p>格式通过 ${Object.keys(batch.banks).length} / ${batch.sourceKeys.length} 道原题</p>${batch.error?`<p class="message error">${esc(batch.error)}</p>`:""}${preview?`<details><summary>查看候选题</summary>${preview}</details>`:""}${controls}</section>`;
  }).join("");
  const unsaved=ready.filter(b=>!b.savedGroupId).length;
  const controls=`${!running && modelMatch && (pending.length||failed.length) ? button("继续生成","batch-run",unsaved?"secondary":status.configured?"primary":"secondary") : ""}${running ? `<p role="status">正在生成；格式通过的批次会保留。</p>${button("取消本次生成","batch-cancel")}` : ""}${unsaved && !running ? `<p>题目与答案仍需人工核对；AI 题组不会加入正式题库。</p>${button(`保存并练习（${unsaved} 批）`,"batch-save-ready",status.configured?"primary":"secondary")}` : ""}${saved.length ? button("AI 题组","temp-groups") : ""}${!running ? button("删除批量任务","batch-delete","destructive-action") : ""}`;
  const warning=!status.configured ? `<p class="message error">请先填写 DeepSeek API Key。</p>` : !modelMatch ? `<p class="message error">此旧任务使用 ${esc(job.model)}；格式通过批次仍可保存。未生成的错题请创建新的 DeepSeek 批量任务。</p>${button("新建批量任务","batch-new")}` : "";
  shell("批量 AI 回炉",`<section class="card"><h2>任务进度</h2><p>${batches.length} 批 · 格式通过 ${ready.length} · 已保存 ${saved.length} · 失败 ${failed.length} · 待生成 ${pending.length}</p><p>本轮上限 ${MAX_SOURCES_PER_RUN} 道原题</p><p>${billingNotice}</p>${warning}${controls}</section>${settings}<div class="stack">${list}</div>`);
}
async function saveBatchConfig(): Promise<void> {
  const route=history.state as Route; if(route.view!=="batch-review")return;
  const apiKey=document.querySelector<HTMLInputElement>("#batch-api-key")?.value??"";
  if(!apiKey.trim())return notify("请填写 DeepSeek API Key");
  await invoke("set_ai_config",{apiKey});
  await batchReviewView(route.id);
}
async function createBatchReviewJob(): Promise<void> {
  if(batchCreating)return;batchCreating=true;try{await createBatchReviewJobOnce();}finally{batchCreating=false;}
}
async function createBatchReviewJobOnce(): Promise<void> {
  const review=await buildCurrentWrongReview();
  review.items=review.items.filter(item=>batchSelectedSources.has(sourceKey(item.bank.id,item.question.id)));
  if(review.items.length!==batchSelectedSources.size)return notify("所选错题状态已变化，请重新核对选择");
  if(!review.items.length)return notify("当前没有错题");
  const status=await invoke<AiConfigStatus>("get_ai_config_status");
  if(!status.configured||!status.model)return notify("请先配置 AI API");
  const total=review.items.length;
  if(!confirm(`将为 ${total} 道当前错题生成约 ${total*GENERATED_PER_SOURCE} 道候选题，共 ${Math.ceil(total/SOURCES_PER_BATCH)} 批。每道原题调用一次 AI API，可能产生费用；本次最多请求 ${MAX_SOURCES_PER_RUN} 道原题。确认创建任务？`))return;
  const id=await createBatchJob(review,status.model);
  await navigate({view:"batch-review",id},true);
  await runBatchReview(id);
}
async function runBatchReview(id:string, onlyIndex?:number): Promise<void> {
  if(batchStarting||batchRunningJobId)return;batchStarting=true;try{await runBatchReviewOnce(id,onlyIndex);}finally{batchStarting=false;}
}
async function runBatchReviewOnce(id:string, onlyIndex?:number): Promise<void> {
  if(batchRunningJobId)return;
  const job=await getBatchJob(id); if(!job)return;
  const status=await invoke<AiConfigStatus>("get_ai_config_status");
  if(!status.configured||status.model!==job.model)return notify(`请配置任务使用的模型 ${job.model}`);
  const review=jobReview(job), itemByKey=new Map(review.items.map(item=>[sourceKey(item.bank.id,item.question.id),item]));
  const originalContent=new Set(review.items.map(item=>candidateFingerprint(item.question)));
  const batches=jobBatches(job); let requested=0;
  batchRunningJobId=id; batchCancelRequested=false;
  await batchReviewView(id);
  try {
    for(let index=0;index<batches.length;index++) {
      if(batchCancelRequested)break;
      if(onlyIndex!==undefined && index!==onlyIndex)continue;
      const batch=batches[index];
      if(batch.status==="ready")continue;
      const missing=batch.sourceKeys.filter(key=>!batch.banks[key]);
      if(requested+missing.length>MAX_SOURCES_PER_RUN)break;
      batch.error="";
      try {
        for(const key of missing) {
          if(batchCancelRequested)break;
          const item=itemByKey.get(key); if(!item)throw new Error("原题来源不存在");
          const latest=await buildCurrentWrongReview();
          if(!latest.items.some(x=>sourceKey(x.bank.id,x.question.id)===key))throw new Error("原题已不是当前错题，请重新发起任务");
          const requestId=crypto.randomUUID();
          batchCurrentRequestId=requestId; requested++;
          const input={review:{...review,items:[item]},sourceContext:[],generationOptions:{count:2}};
          const response=await invoke<string>("generate_ai_review",{requestId,input});
          batchCurrentRequestId=null;
          if(batchCancelRequested)break;
          const seen=checkedCandidateIds(batches,key);
          const bank=parseAiReviewBank(response,item,seen.ids);
          for(const question of bank.questions) {
            const fingerprint=candidateFingerprint(question);
            if(seen.fingerprints.has(fingerprint)||originalContent.has(fingerprint))throw new Error("候选题与其他批次或原题重复");
          }
          const existing=await (await db()).select<{external_id:string}[]>("SELECT external_id FROM questions WHERE external_id IN ($1,$2)",bank.questions.map(q=>q.id));
          if(existing.length)throw new Error(`题目 ID 已存在：${existing.map(x=>x.external_id).join("、")}`);
          batch.banks[key]=bank;
          batch.generatedAtBySource={...(batch.generatedAtBySource??{}),[key]:new Date().toISOString()};
          await saveBatchJob(job,batches);
          await batchReviewView(id);
        }
        if(batchCancelRequested)break;
        batch.status="ready";
        await saveBatchJob(job,batches);
      } catch(error) {
        if(batchCancelRequested)break;
        batch.status="failed";
        batch.error=error instanceof Error?error.message:String(error);
        await saveBatchJob(job,batches);
      }
      await batchReviewView(id);
    }
  } finally {
    batchCurrentRequestId=null; batchRunningJobId=null; batchCancelRequested=false;
    await batchReviewView(id);
  }
}
async function cancelBatchReview(): Promise<void> {
  batchCancelRequested=true;
  if(batchCurrentRequestId)await invoke("cancel_ai_review",{requestId:batchCurrentRequestId}).catch(()=>{});
}
async function saveReadyBatches(): Promise<void> {
  const id=batchRouteId(); if(!id||batchSavingReady||batchRunningJobId)return;
  batchSavingReady=true;
  try {
  const groupId=await saveReadyBatchCandidates(id);
  if(!groupId)return notify("暂无可保存的完整批次");
  await navigate({view:"temp-session",id:groupId});
  } finally { batchSavingReady=false; }
}

interface AiConfigStatus { configured: boolean; baseUrl: string | null; model: string | null }
let aiPendingRequestId: string | null = null;
let aiReviewError = "";
let aiPreview: { questionId: string; bank: BankFile; model: string; generatedAt: string; draftId:string } | null = null;
let aiSavingGroup = false;
let aiStarting=false;
let pendingAiPersistence:{id:string;questionId:string;source:QuestionInput;bank:BankFile;model:string;generatedAt:string}|null=null;
async function persistGeneratedDraft():Promise<void>{
  const pending=pendingAiPersistence;if(!pending)return;
  const saved=await saveAiDraft(pending.questionId,pending.source,pending.bank,pending.model,pending.generatedAt,pending.id);
  aiPreview={questionId:pending.questionId,bank:pending.bank,model:pending.model,generatedAt:pending.generatedAt,draftId:saved.id};pendingAiPersistence=null;aiReviewError="";
  const route=history.state as Route;if(route.view==="ai-review"&&route.questionId===pending.questionId)history.replaceState({...route,draftId:saved.id},"");
}

function aiRouteQuestionId(): string | null {
  const route = history.state as Route;
  return route?.view === "ai-review" ? route.questionId : null;
}

async function aiReviewView(questionId: string): Promise<void> {
  const row = (await getQuestions([questionId]))[0];
  const route=history.state as Route,draft=route.view==="ai-review"&&route.draftId?await getAiDraft(route.draftId):await latestAiDraft(questionId);
  if (aiRouteQuestionId() !== questionId) return;
  if (!row&&!draft) {
    shell("AI 回炉", emptyState("原题已不存在", "请返回当前错题重新选择。"));
    return;
  }
  const status = await invoke<AiConfigStatus>("get_ai_config_status");
  if (aiRouteQuestionId() !== questionId) return;
  const original = row?parseQuestion(row):JSON.parse(draft!.source_question_json) as QuestionInput;
  if(pendingAiPersistence?.questionId===questionId)aiPreview={...pendingAiPersistence,draftId:""};else if(draft)aiPreview={questionId,bank:JSON.parse(draft.bank_json),model:draft.model,generatedAt:draft.generated_at,draftId:draft.id};else if(!aiPendingRequestId)aiPreview=null;
  const preview = aiPreview?.questionId === questionId ? aiPreview : null;
  const pending = !!aiPendingRequestId;
  const config = status.configured
    ? `<p class="ai-config-status">DeepSeek V4.1 Flash · Key 已保存在本机</p>${button("清除已保存配置", "ai-clear-config")}`
    : `<p class="ai-config-status">DeepSeek V4.1 Flash · 未配置 Key</p>`;
  const settings = `<details class="card ai-settings" ${status.configured ? "" : "open"}><summary>AI API 配置</summary>${config}<label>API Key<input id="ai-api-key" type="password" placeholder="${status.configured ? "填写新 Key 可替换" : "填写 DeepSeek API Key"}" autocomplete="off"></label>${button(status.configured ? "更换 API Key" : "保存 API Key", "ai-save-config", status.configured||preview?"secondary":"primary")}</details>`;
  const result = preview
    ? `<section class="ai-preview"><h2>草稿 · 格式通过 · 待核对${preview.draftId?"":" · 未保存"}</h2><p>生成于 ${esc(preview.generatedAt)} · ${esc(preview.model)} · 源自原题 ${esc(original.id)}</p>${preview.bank.questions.map((q, index) => `<section class="card"><h3>第 ${index + 1} 题</h3>${reviewQuestionPreview(q)}</section>`).join("")}<p>题目与答案仍需人工核对；AI 题组不会加入正式题库。</p>${preview.draftId?`${button("保存并练习", "ai-save-group", "primary")}${button("丢弃此草稿",`ai-discard:${preview.draftId}`,"destructive-action")}${button("草稿列表","ai-drafts")}`:""}</section>`
    : "";
  const controls = pendingAiPersistence?`${button("重试保存格式通过草稿","ai-retry-persist","primary")}${button("丢弃未保存结果","ai-discard-unsaved","destructive-action")}`:pending
    ? `<p role="status">正在生成，请稍候…</p>${button("取消生成", "ai-cancel")}`
    : button(preview ? "重新生成" : "生成 2 题", "ai-generate", preview||!status.configured?"secondary":"primary");
  shell("AI 回炉", `<section class="card"><span class="type">${questionTypeLabel(original)}</span><h2 class="stem">${esc(questionLead(original))}</h2>${row?"":"<p>原题已删除，草稿和来源快照仍保留。</p>"}</section>${settings}<section class="card"><p>${billingNotice} 重新生成会再次收费，旧草稿仍保留。</p>${controls}<div id="message" class="message ${aiReviewError ? "error" : ""}" role="alert">${esc(aiReviewError)}</div></section>${result}`);
}

async function saveAiConfig(): Promise<void> {
  const questionId = aiRouteQuestionId();
  if (!questionId) return;
  const apiKey = document.querySelector<HTMLInputElement>("#ai-api-key")?.value ?? "";
  if (!apiKey.trim()) {
    message("请填写 DeepSeek API Key", "error");
    return;
  }
  try {
    await invoke("set_ai_config", {apiKey});
    aiReviewError = "";
    aiPreview = null;
    await aiReviewView(questionId);
  } catch (error) {
    message(String(error), "error");
  }
}

async function clearAiConfig(): Promise<void> {
  const questionId = aiRouteQuestionId();
  if (!questionId) return;
  await invoke("clear_ai_config");
  aiPreview = null;
  aiReviewError = "";
  await aiReviewView(questionId);
}

async function generateAiReview(): Promise<void> {
  if(aiStarting||aiPendingRequestId)return;aiStarting=true;try{await generateAiReviewOnce();}finally{aiStarting=false;}
}
async function generateAiReviewOnce(): Promise<void> {
  const questionId = aiRouteQuestionId();
  if (!questionId || aiPendingRequestId || pendingAiPersistence) return;
  if(aiPreview?.questionId===questionId&&!confirm("重新生成将再次调用 AI API，可能收费。旧草稿会保留。确认重新生成？"))return;
  const row = (await getQuestions([questionId]))[0];
  if (!row) { aiReviewError = "原题已不存在"; return aiReviewView(questionId); }
  const review = await buildCurrentWrongReview();
  const original = review.items.find(item => item.bank.id === row.bank_id && item.question.id === row.external_id);
  if (!original) {
    aiReviewError = "这道题已不是当前错题，请返回列表刷新";
    return aiReviewView(questionId);
  }
  const status = await invoke<AiConfigStatus>("get_ai_config_status");
  if (!status.configured) {
    aiReviewError = "请先配置 AI API";
    return aiReviewView(questionId);
  }
  const requestId = crypto.randomUUID();
  aiPendingRequestId = requestId;
  aiReviewError = "";
  aiPreview = null;
  await aiReviewView(questionId);
  try {
    const input = {review: {...review, items: [original]}, sourceContext: [], generationOptions: {count: 2}};
    const response = await invoke<string>("generate_ai_review", {requestId, input});
    if (aiPendingRequestId !== requestId) return;
    const bank = parseAiReviewBank(response, original, new Set());
    const existing = await (await db()).select<{external_id: string}[]>(
      "SELECT external_id FROM questions WHERE external_id IN ($1,$2)",
      bank.questions.map(q => q.id)
    );
    if (existing.length) throw new Error(`题目 ID 已存在：${existing.map(q => q.external_id).join("、")}`);
    pendingAiPersistence={id:crypto.randomUUID(),questionId,source:original.question,bank,model:status.model??"",generatedAt:new Date().toISOString()};
    await persistGeneratedDraft();
  } catch (error) {
    if (aiPendingRequestId === requestId) aiReviewError = pendingAiPersistence?"候选格式通过，但本机草稿保存失败。请保持此页面并重试保存，重试保存不会请求 AI；关闭应用前未保存的结果可能丢失。":error instanceof Error ? error.message : String(error);
  } finally {
    if (aiPendingRequestId === requestId) {
      aiPendingRequestId = null;
      if (aiRouteQuestionId() === questionId) await aiReviewView(questionId);
    }
  }
}

async function cancelAiReview(): Promise<void> {
  const requestId = aiPendingRequestId;
  const questionId = aiRouteQuestionId();
  if (!requestId || !questionId) return;
  aiPendingRequestId = null;
  aiReviewError = "已停止本地请求，不能保证服务商不计费；此前格式通过草稿仍保留。";
  await invoke("cancel_ai_review", {requestId});
  await aiReviewView(questionId);
}

async function exportWrongReview(){
  const review=await buildCurrentWrongReview(); if(!review.items.length){notify("暂无当前错题");return;}
  const date=new Date().toISOString().slice(0,10); await saveJsonFile(`knoop-error-review-${date}.json`,review,"Knoop 错题回炉");
}
async function exportRepairReview(){
  const review=await buildRepairReview(); if(!review.items.length){notify("暂无待返修题目");return;}
  const date=new Date().toISOString().slice(0,10); await saveJsonFile(`knoop-repair-review-${date}.json`,review,"Knoop 题目返修");
}
async function exportBankFile(bankId:string){
  const bank=await buildBankExport(bankId); const safe=bank.import.bankId.replace(/[\\/:*?"<>|]+/g,"_");
  await saveJsonFile(`knoop-bank-${safe}.json`,bank,`导出题库：${bank.import.bankTitle}`);
}

async function exportSelectedBanks(){
  const ids=[...selectedExportBanks]; if(ids.length<2)return notify("请至少选择两个题库");
  const bundle=await buildBundleExport(ids); const date=new Date().toISOString().slice(0,10);
  await saveJsonFile(`knoop-bundle-${date}.json`,bundle,`导出 ${bundle.banks.length} 个题库`);
}

app.addEventListener("click",async e=>{const target=(e.target as HTMLElement).closest<HTMLElement>("[data-action]");if(!target||studyBusy)return;const action=target.dataset.action!;
  try {
    if(restoreSyncPending&&action!=="backup-sync")return;
    if(!action.startsWith("option:")&&!action.startsWith("temp-")&&!action.startsWith("manual:")&&!["submit","next","toggle-quick","show-content"].includes(action))await flushDrafts();
    if(action==="back")return await goBack();
    if(action==="home")return await navigate({view:"home"});
    if(action==="import")return navigate({view:"import"});
    if(action==="backup")return navigate({view:"backup"});
    if(action==="sessions")return navigate({view:"sessions"});
    if(action==="ai-drafts")return navigate({view:"ai-drafts"});
    if(action==="ai-retry-persist")return await withStudyAction(async()=>{await persistGeneratedDraft();const id=aiRouteQuestionId();if(id)await aiReviewView(id);});
    if(action==="ai-discard-unsaved"){if(!confirm("丢弃未保存的格式通过结果？已发生的 API 费用不会退还。"))return;pendingAiPersistence=null;aiPreview=null;aiReviewError="";const id=aiRouteQuestionId();if(id)return aiReviewView(id);return;}
    if(action.startsWith("ai-draft:")){const draft=await getAiDraft(action.slice(9));if(draft)return navigate({view:"ai-review",questionId:draft.source_question_id,draftId:draft.id});return;}
    if(action.startsWith("ai-discard:")){if(!confirm("丢弃此待审核草稿？已发生的 API 费用不会退还。"))return;await deleteAiDraft(action.slice(11));aiPreview=null;return navigate({view:"ai-drafts"},true);}
    if(action.startsWith("temp-review:"))return navigate({view:"temp-review",id:action.slice(12)});
    if(action.startsWith("temp-retry-wrong:")){let id:string|null=null;await withStudyAction(async()=>{id=await retryTempWrong(action.slice(17));});if(id)return navigate({view:"temp-session",id});return notify("本组没有错题");}
    if(action.startsWith("repeat-session:"))return await repeatRound(action.slice("repeat-session:".length));
    if(action.startsWith("confirm-import:"))return await withStudyAction(()=>confirmImport(Number(action.slice("confirm-import:".length))));
    if(action.startsWith("cancel-import:")){importQueue=importQueue.filter(entry=>entry.id!==Number(action.slice("cancel-import:".length)));return importView();}
    if(action==="backup-export")return await backupAction(async()=>{requireBackupIdle();const backup=await buildBackup();await saveJsonFile(`knoop-backup-${new Date().toISOString().slice(0,10)}.json`,backup,"Knoop 完整学习备份");});
    if(action==="backup-pick"){document.querySelector<HTMLInputElement>("#backup-file")?.click();return;}
    if(action==="backup-prepare")return await backupAction(async()=>{if(!restoreFile)return;requireBackupIdle();restorePlan=await prepareRestore(restoreFile);backupMessage="";await backupView();});
    if(action==="backup-confirm")return await backupAction(confirmRestore);
    if(action==="backup-save-before")return await backupAction(async()=>{if(restorePlan)await saveJsonFile(`knoop-before-restore-${new Date().toISOString().slice(0,10)}.json`,restorePlan.before,"恢复前完整备份");});
    if(action==="backup-cancel"){restoreFile=null;restorePlan=null;backupMessage="";return backupView();}
    if(action.startsWith("backup-load:"))return await backupAction(async()=>{const data=await invoke<string>("read_restore_safety_copy",{name:action.slice("backup-load:".length)});restoreFile=await validateBackup(JSON.parse(data));restorePlan=null;backupMessage="";await backupView();});
    if(action==="backup-sync")return await backupAction(finishPreferenceRestore);
    if(action==="scope"){selectedScopeNodes.clear();return navigate({view:"scope"});}
    if(action==="presets")return navigate({view:"presets"});
    if(action==="wrong"||action==="favorites"||action==="killed"||action==="notes"||action==="reviews")return navigate({view:"list",kind:action});
    if(action==="stats")return navigate({view:"stats"});
    if(action==="temp-groups")return navigate({view:"temp-groups"});
    if(action.startsWith("temp-open:")){const id=action.slice(10);const group=await getTempGroup(id);if(!group)return tempGroupsView();if(group.completed_at)await restartTempGroup(group);return navigate({view:"temp-session",id});}
    if(action.startsWith("temp-restart:")){const id=action.slice(13);const group=await getTempGroup(id);if(!group)return tempGroupsView();await restartTempGroup(group);return navigate({view:"temp-session",id});}
    if(action.startsWith("temp-delete:")){const id=action.slice(12);if(!confirm("删除这个临时回炉题组及其练习进度？"))return;await deleteTempGroup(id);notify("已删除 AI 题组","ok");return navigate({view:"temp-groups"},true);}
    if(action==="adjust-types"){app.querySelector<HTMLButtonElement>('.setup-types [data-action^="filter-type:"]')?.focus();return;}
    if(action.startsWith("filter-type:")){const type=action.slice("filter-type:".length) as BrushType;if(!brushTypes.includes(type))return;capturePracticeSetup();enabledBrushTypes.has(type)?enabledBrushTypes.delete(type):enabledBrushTypes.add(type);saveBrushTypes();const route=history.state as Route;if(route.view==="choose")return chooseScope(route.nodeIds??(route.nodeId?[route.nodeId]:[]),action);return;}
    if(action==="export-error-review")return exportWrongReview();
    if(action==="batch-new"){batchSelectedSources.clear();return navigate({view:"batch-review"});}
    if(action.startsWith("batch-open:"))return navigate({view:"batch-review",id:action.slice(11)});
    if(action==="batch-save-config")return saveBatchConfig();
    if(action==="batch-clear-config"){await invoke("clear_ai_config");const route=history.state as Route;if(route.view==="batch-review")return batchReviewView(route.id);return;}
    if(action==="batch-create")return createBatchReviewJob();
    if(action==="batch-run"){const id=batchRouteId();if(id&&confirm("继续将再次请求未成功的原题，可能收费。格式通过的原题结果保留，不重新请求。确认继续？"))return runBatchReview(id);return;}
    if(action.startsWith("batch-retry:")){const id=batchRouteId();if(id&&confirm("重试将再次发送尚未成功的原题请求，可能再次收费；格式通过原题不会重新请求。确认重试？"))return runBatchReview(id,Number(action.slice(12)));return;}
    if(action==="batch-cancel")return cancelBatchReview();
    if(action==="batch-save-ready")return saveReadyBatches();
    if(action==="batch-delete"){const id=batchRouteId();if(!id)return;if(!confirm("删除这项批量回炉任务及未保存的候选题？已保存的AI 题组会保留。"))return;await deleteBatchJob(id);return navigate({view:"list",kind:"wrong"},true);}
    if(action.startsWith("ai-review:")){aiReviewError="";return navigate({view:"ai-review",questionId:decodeURIComponent(action.slice(10))});}
    if(action==="ai-save-config")return saveAiConfig();
    if(action==="ai-save-group")return saveAiTempGroup();
    if(action==="ai-clear-config")return clearAiConfig();
    if(action==="ai-generate")return generateAiReview();
    if(action==="ai-cancel")return cancelAiReview();
    if(action==="export-repair-review")return exportRepairReview();
    if(action==="pick-import"){document.querySelector<HTMLInputElement>("#file")?.click();return;}
    if(action==="export-selected-banks")return exportSelectedBanks();
    if(action.startsWith("export-bank:"))return exportBankFile(action.slice("export-bank:".length));
    if(action.startsWith("resume:"))return navigate({view:"session",id:action.slice(7)});
    if(action.startsWith("start-preset:"))return startPresetById(action.slice("start-preset:".length));
    if(action.startsWith("delete-preset:")){const id=action.slice("delete-preset:".length);const preset=scopePresets.find(p=>p.id===id);if(!preset)return;if(!confirm(`删除练习方案“${preset.name}”？`))return;scopePresets=scopePresets.filter(p=>p.id!==id);persistScopePresets();if(recentPresetId()===id)localStorage.removeItem(recentPresetStorageKey);notify("已删除练习方案","ok");return presetsView();}
    if(action.startsWith("list-toggle-all:")){const kind=action.slice("list-toggle-all:".length) as ExpandableListKind;if(!["wrong","favorites","notes","reviews"].includes(kind))return;const rows=kind==="notes"?await noteQuestions():kind==="reviews"?await reviewQuestions():kind==="wrong"?await wrongQuestions():await favoriteQuestions();const set=expandedSet(kind);const all=rows.length>0&&rows.every(r=>set.has(r.id));all?set.clear():rows.forEach(r=>set.add(r.id));return listView(kind);}
    if(action.startsWith("toggle-list-card:")){const rest=action.slice("toggle-list-card:".length);const split=rest.indexOf(":");if(split<0)return;const kind=rest.slice(0,split) as ExpandableListKind;const id=decodeURIComponent(rest.slice(split+1));if(!["wrong","favorites","notes","reviews"].includes(kind))return;const set=expandedSet(kind);set.has(id)?set.delete(id):set.add(id);await listView(kind);document.querySelectorAll<HTMLButtonElement>(".expandable-card-summary").forEach(button=>{if(button.dataset.action===action)button.focus({preventScroll:true});});return;}
    if(action.startsWith("fold:")){const id=action.slice(5);collapsedScopeNodes.has(id)?collapsedScopeNodes.delete(id):collapsedScopeNodes.add(id);saveScopeCollapseState();return scopeView(action);}
    if(action==="scope-expand-all"){collapsedScopeNodes.clear();saveScopeCollapseState();return scopeView(action);}
    if(action==="scope-collapse-all"){const {children}=buildScopeTree(scopeNodesCache);for(const n of scopeNodesCache)if((children.get(n.id)?.length??0)>0)collapsedScopeNodes.add(n.id);saveScopeCollapseState();return scopeView(action);}
    if(action.startsWith("scope-bank-fold:")){const bankId=action.slice("scope-bank-fold:".length);const {children}=buildScopeTree(scopeNodesCache);const ids=scopeNodesCache.filter(n=>n.bank_id===bankId&&(children.get(n.id)?.length??0)>0).map(n=>n.id);const allCollapsed=ids.length>0&&ids.every(id=>collapsedScopeNodes.has(id));for(const id of ids)allCollapsed?collapsedScopeNodes.delete(id):collapsedScopeNodes.add(id);saveScopeCollapseState();return scopeView(action);}
    if(action.startsWith("scope-node:")){toggleScopeNode(action.slice("scope-node:".length));return scopeView(action);}
    if(action.startsWith("scope-bank:")){toggleScopeBank(action.slice("scope-bank:".length));return scopeView(action);}
    if(action==="scope-next"){practiceSetup=null;return navigate({view:"choose",nodeIds:[...selectedScopeNodes]});}
    if(action==="save-scope-preset"){const route=history.state as Route;const ids=route.view==="choose"?(route.nodeIds??(route.nodeId?[route.nodeId]:[])):[];return saveScopePreset(ids);}
    if(action.startsWith("start-scope:")){const mode=action.slice("start-scope:".length);const route=history.state as Route;const ids=route.view==="choose"?(route.nodeIds??(route.nodeId?[route.nodeId]:[])):[];const random=mode==="random"||mode==="memorization-random";const count=random?setupCount(mode==="random"?"#random-count":"#memorization-random-count"):undefined;if(random&&count===undefined)return;return startScope(mode,ids,count);}
    if(action.startsWith("open-directory:")){capturePracticeSetup();const kind=action.slice("open-directory:".length) as DirectoryKind;const route=history.state as Route;const ids=route.view==="choose"?(route.nodeIds??(route.nodeId?[route.nodeId]:[])):[];return navigate({view:"directory",nodeIds:ids,kind,query:""});}
    if(action==="session-directory"){if(!activeSession)return;return navigate({view:"directory",sessionId:activeSession.id,kind:activeSession.mode==="memorization"?"memorization":"brush",query:""});}
    if(action==="directory-go"){const route=history.state as Route;if(route.view!=="directory")return;const raw=Number(document.querySelector<HTMLInputElement>("#directory-index")?.value||0);const index=Math.trunc(raw)-1;if(index<0)return notify("请输入有效题号");if(route.sessionId){const session=await sessionById(route.sessionId);if(!session)return notify("学习进度不存在");const ids=JSON.parse(session.question_ids_json) as string[];if(index>=ids.length)return notify(`题号应在 1-${ids.length} 之间`);const saved=JSON.parse(session.state_json||"{}") as {quickMode?:boolean};quickMode=!!saved.quickMode;activeSession=session;const found=await getQuestions(ids);const byId=new Map(found.map(r=>[r.id,r]));activeRows=ids.map(id=>byId.get(id)).filter(Boolean) as QuestionRow[];selection.clear();excludedOptions.clear();blankValue="";pageState={};await saveSession(session.id,index,{quickMode});return navigate({view:"session",id:session.id});}const all=await questionsForScope(route.nodeIds??[]);const rows=route.kind==="memorization"?all.filter(q=>q.type==="memorization"):all.filter(isEnabledBrush);if(index>=rows.length)return notify(`题号应在 1-${rows.length} 之间`);const mode=route.kind==="memorization"?"memorization":"sequential";const id=await createSession(mode,{nodeIds:route.nodeIds??[],order:"direct"},rows.map(r=>r.id),index);return navigate({view:"session",id});}
    if(action.startsWith("start-directory-search:")){const order=action.slice("start-directory-search:".length);const route=history.state as Route;if(route.view!=="directory"||route.sessionId)return;const query=route.query?.trim()??"";if(!query)return;const all=await questionsForScope(route.nodeIds??[]);let rows=(route.kind==="memorization"?all.filter(q=>q.type==="memorization"):all.filter(isEnabledBrush)).filter(r=>directoryMatches(parseQuestion(r),query));if(order==="random")rows=shuffled(rows);if(!rows.length)return notify("没有匹配内容");const mode=route.kind==="memorization"?"memorization":order==="random"?"random":"sequential";const id=await createSession(mode,{nodeIds:route.nodeIds??[],order,source:"directory-search",searchQuery:query},rows.map(r=>r.id));return navigate({view:"session",id});}
    if(action.startsWith("start-directory:")){const index=Number(action.slice("start-directory:".length));const route=history.state as Route;if(route.view!=="directory"||route.sessionId)return;const all=await questionsForScope(route.nodeIds??[]);const rows=route.kind==="memorization"?all.filter(q=>q.type==="memorization"):all.filter(isEnabledBrush);if(!rows.length||!Number.isInteger(index)||index<0||index>=rows.length)return;const mode=route.kind==="memorization"?"memorization":"sequential";const id=await createSession(mode,{nodeIds:route.nodeIds??[],order:"direct"},rows.map(r=>r.id),index);return navigate({view:"session",id});}
    if(action.startsWith("jump-session:")){const route=history.state as Route;const sessionId=route.view==="directory"&&route.sessionId?route.sessionId:activeSession?.id;if(!sessionId)return;const session=await sessionById(sessionId);if(!session)return;const ids=JSON.parse(session.question_ids_json) as string[];const index=Number(action.slice("jump-session:".length));if(!Number.isInteger(index)||index<0||index>=ids.length)return;const saved=JSON.parse(session.state_json||"{}") as {quickMode?:boolean};quickMode=!!saved.quickMode;const found=await getQuestions(ids);const byId=new Map(found.map(r=>[r.id,r]));activeRows=ids.map(id=>byId.get(id)).filter(Boolean) as QuestionRow[];selection.clear();excludedOptions.clear();blankValue="";pageState={};await saveSession(session.id,index,{quickMode});session.current_index=index;activeSession=session;return navigate({view:"session",id:session.id});}
    if(action.startsWith("delete-bank:")){const bankId=action.slice("delete-bank:".length);const bank=(await getBanks()).find(b=>b.id===bankId);if(!confirm(`删除题库“${bank?.title??bankId}”？\n\n该题库的题目、作答记录、收藏、审核、笔记和相关未完成进度都会一并删除。此操作不可撤销。`))return;const btn=target as HTMLButtonElement;const oldText=btn.textContent;btn.disabled=true;btn.textContent="删除中…";try{await deleteBank(bankId);notify("已删除题库","ok");return importView();}catch(err){btn.disabled=false;btn.textContent=oldText;throw err;}}
    if(action.startsWith("temp-option:")){selectTempOption(action.slice(12));return;}
    if(action==="temp-submit"||action.startsWith("temp-manual:")||action==="temp-next")return await withStudyAction(()=>tempAction(action));
    if(action==="toggle-quick"){quickMode=!quickMode;await persistDraft();return quizView();}
    if(action.startsWith("option:")&&!pageState.submitted){
      const id=action.slice(7); if(id===suppressOptionClickId&&Date.now()<suppressOptionClickUntil)return; const q=parseQuestion(activeRows[activeSession!.current_index]); excludedOptions.delete(id);
      if(q.type==="single_choice"){
        selection=new Set([id]); if(quickMode){const correct=id===q.answer;return await record(activeRows[activeSession!.current_index].id,[id],"auto",correct);}
      } else if(q.type==="multiple_choice") {
        selection.has(id)?selection.delete(id):selection.add(id);
      }
      updateOptionStyles(selection,excludedOptions);void persistDraft().catch(reportSaveError);return;
    }
    if(action==="submit")return await submit();
    if(action.startsWith("manual:")){const ok=action.endsWith("true");return await record(activeRows[activeSession!.current_index].id,blankValue,"manual",ok);}
    if(action==="show-content"){pageState.revealed=true;await persistDraft();return quizView();}
    if(action==="next")return await next();
    if(action.startsWith("favorite:")){await toggleFavorite(action.slice(9));return quizView();}
    if(action.startsWith("kill:")){
      const id=action.slice(5); if(await isReviewed(id))return;
      const already=await isKilled(id);
      if(!already&&!confirm("斩杀这道题？\n\n以后新建刷题会话会自动排除，可在“题库 → 已斩杀”中恢复。"))return;
      const killed=await toggleKilled(id); if(killed)return next(); return quizView();
    }
    if(action.startsWith("restore-killed:")){await toggleKilled(action.slice("restore-killed:".length));notify("已恢复题目","ok");return listView("killed");}
    if(action.startsWith("review:"))return navigate({view:"review",questionId:action.slice(7)});
    if(action.startsWith("review-preset:")){applyReviewPreset(Number(action.slice("review-preset:".length)));return;}
    if(action.startsWith("save-review:"))return saveQuestionReview(action.slice("save-review:".length));
    if(action.startsWith("complete-review:")){const id=action.slice("complete-review:".length);if(!confirm("确认这道题已经检查或返修完成？\n\n历史判分会保留；当前错题仅看返修后的新作答，并按审核前状态决定是否恢复到题池。"))return;await completeReview(id);notify("已完成返修","ok");return await goBack();}
    if(action.startsWith("cancel-review:")){const id=action.slice("cancel-review:".length);if(!confirm("取消这道题的审核标记？"))return;await cancelReview(id);notify("已取消审核","ok");return goBack();}
    if(action.startsWith("note:"))return navigate({view:"note",questionId:action.slice(5)});
    if(action.startsWith("save-note:"))return saveQuestionNote(action.slice("save-note:".length));
    if(action.startsWith("delete-note:")){const id=action.slice("delete-note:".length);if(!confirm("删除这条笔记？"))return;await saveNote(id,"");notify("已删除笔记","ok");return goBack();}
    if(action.startsWith("edit:")){const current=isRoute(history.state)?history.state:null;return navigate({view:"edit",questionId:action.slice(5),returnTo:asReturnTarget(current)});}
    if(action.startsWith("save-edit-review:"))return await saveQuestionEdit(action.slice("save-edit-review:".length),true);
    if(action.startsWith("save-edit:"))return await saveQuestionEdit(action.slice("save-edit:".length));
    if(action.startsWith("practice:")){const rows=action.endsWith("wrong")?await wrongQuestions():await favoriteQuestions();return startRows(action.endsWith("wrong")?"wrong":"favorites",rows.filter(graded));}
  } catch(err){notify(err instanceof Error?err.message:String(err));}
});

window.addEventListener("popstate", async e => {
  try { await studyDone;await flushDrafts(); } catch(error){if(renderedRoute)history.replaceState(renderedRoute,"");reportSaveError(error);return;}
  if(pendingAiPersistence){if(renderedRoute)history.replaceState(renderedRoute,"");notify("候选尚未保存，请重试保存或明确丢弃后离开");return;}
  if(restoreSyncPending){history.replaceState({view:"backup"} satisfies Route,"");await backupView();return;}
  if(forcedBackTarget){const target=forcedBackTarget;forcedBackTarget=null;history.replaceState(target,"");void renderRoute(target);return;}
  const route = isRoute(e.state) ? e.state : ({view:"home"} satisfies Route);
  if(route.view!=="ai-review"&&aiPendingRequestId){void invoke("cancel_ai_review",{requestId:aiPendingRequestId}).catch(()=>{});aiPendingRequestId=null;}
  if((route.view!=="batch-review" || route.id!==batchRunningJobId)&&batchRunningJobId)void cancelBatchReview();
  void renderRoute(route);
});

db().then(async()=>{
  try{await recoverPreferenceRestore();}catch(error){restoreSyncPending=true;backupMessage=error instanceof Error?error.message:String(error);history.replaceState({view:"backup"} satisfies Route,"");await backupView();return;}
  reloadLearningState();const route = isRoute(history.state) ? history.state : ({view:"home"} satisfies Route);await navigate(route,true);
}).catch(err=>{shell("启动失败",`<div class="message error">${esc(err instanceof Error?err.message:String(err))}</div>`,false);});
