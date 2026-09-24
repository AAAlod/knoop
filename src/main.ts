import "./style.css";
import "katex/dist/katex.min.css";
import renderMathInElement from "katex/contrib/auto-render";
import { addAttempt, buildBankExport, buildBundleExport, buildCurrentWrongReview, buildRepairReview, cancelReview, completeReview, createSession, db, deleteBank, favoriteQuestions, getBanks, getNodes, getNote, getQuestions, getReview, importBank, isFavorite, isKilled, isReviewed, killedQuestions, latestSession, librarySummary, noteQuestions, questionsForScope, reviewQuestions, saveNote, saveReview, saveSession, sessionById, stats, toggleFavorite, toggleKilled, updateQuestionContent, validateBank, validateBundle, wrongQuestions } from "./db";
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
  | { view: "import" }
  | { view: "scope" }
  | { view: "choose"; nodeIds?: string[]; nodeId?: string }
  | { view: "directory"; nodeIds?: string[]; sessionId?: string; kind?: DirectoryKind; query?: string }
  | { view: "session"; id: string }
  | { view: "list"; kind: ListKind }
  | { view: "presets" }
  | { view: "stats" };
type Route = ReturnTarget
  | { view: "edit"; questionId: string; returnTo?: ReturnTarget }
  | { view: "note"; questionId: string }
  | { view: "review"; questionId: string };

const esc = (s: unknown) => String(s ?? "").replace(/[&<>'"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':"&quot;"}[c]!));
const button = (text: string, action: string, cls = "") => `<button class="${cls}" data-action="${esc(action)}">${esc(text)}</button>`;
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

function isReturnTarget(value: unknown): value is ReturnTarget {
  if (!value || typeof value !== "object") return false;
  const route = value as Record<string, unknown>;
  switch (route.view) {
    case "home":
    case "import":
    case "scope":
    case "presets":
    case "stats":
      return true;
    case "choose":
      return (route.nodeIds === undefined || (Array.isArray(route.nodeIds) && route.nodeIds.every(x => typeof x === "string")))
        && (route.nodeId === undefined || typeof route.nodeId === "string");
    case "directory":
      return (route.nodeIds === undefined || (Array.isArray(route.nodeIds) && route.nodeIds.every(x => typeof x === "string")))
        && (route.sessionId === undefined || typeof route.sessionId === "string")
        && (route.kind === undefined || route.kind === "brush" || route.kind === "memorization")
        && (route.query === undefined || typeof route.query === "string");
    case "session":
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
  if (route.view === "note" || route.view === "review") {
    return typeof route.questionId === "string" && route.questionId.length > 0;
  }
  return false;
}

async function renderRoute(route: Route): Promise<void> {
  switch (route.view) {
    case "home": return home();
    case "import": return importView();
    case "scope": return scopeView();
    case "choose": return chooseScope(route.nodeIds ?? (route.nodeId ? [route.nodeId] : []));
    case "directory": return directoryView(route);
    case "session": return openSession(route.id);
    case "edit": return editQuestionView(route.questionId);
    case "note": return noteView(route.questionId);
    case "review": return reviewView(route.questionId);
    case "list": return listView(route.kind);
    case "presets": return presetsView();
    case "stats": return statsView();
  }
}

async function navigate(route: Route, replace = false): Promise<void> {
  if (replace) history.replaceState(route, "");
  else history.pushState(route, "");
  await renderRoute(route);
}
function asReturnTarget(route: Route | null | undefined): ReturnTarget {
  if (!route || route.view === "edit" || route.view === "note" || route.view === "review") return { view: "home" };
  return route;
}
let forcedBackTarget: ReturnTarget | null = null;
async function goBack(): Promise<void> {
  const route = isRoute(history.state) ? history.state : null;
  if (route?.view === "edit" && route.returnTo) forcedBackTarget = route.returnTo;
  history.back();
}

async function home() {
  activeSession = null; activeRows = []; selection.clear(); excludedOptions.clear(); blankValue = ""; quickMode = false; pageState = {};
  selectedScopeNodes.clear(); scopeNodesCache = []; scopeContentNodeIds.clear();
  const resume = await latestSession(); const summary = await librarySummary(); const pendingReviews = (await reviewQuestions()).length;
  const recent = scopePresets.find(p=>p.id===recentPresetId());
  const recentCard = recent ? `<section class="home-recent-preset"><div><small>最近组题</small><b>${esc(recent.name)}</b><span>${esc(presetSummary(recent))}</span></div><button class="primary" data-action="start-preset:${esc(recent.id)}">开始</button></section>` : "";
  const filters = brushTypes.map(type => `<button class="type-filter ${enabledBrushTypes.has(type)?"active":""}" data-action="filter-type:${type}" aria-pressed="${enabledBrushTypes.has(type)}">${brushLabels[type]}</button>`).join("");
  app.innerHTML = `<main class="home-main"><div class="home-heading"><h1>Knoop</h1><p>从自己的题库开始练习</p></div><div class="home-summary">${summary.banks} 个题库<span>${summary.questions} 项内容</span></div>
    <div class="type-filter-row"><span>刷题题型</span><div class="type-filter-options">${filters}</div></div>
    ${recentCard}
    <section class="home-group"><h2 class="section-title">开始学习</h2><div class="stack">
      ${resume ? button("继续上次学习", `resume:${resume.id}`, "primary") : ""}
      ${summary.banks ? button("选择范围", "scope", "primary") : button("导入题库，开始学习", "import", "primary")}
      ${button("常用组题", "presets")}
    </div></section>
    <section class="home-group"><h2 class="section-title">学习记录</h2><div class="stack">
      <div class="grid">${button("错题", "wrong")}${button("收藏", "favorites")}</div>
      <div class="grid">${button(pendingReviews?`待返修 ${pendingReviews}`:"待返修", "reviews")}${button("笔记", "notes")}</div>
    </div></section>
    <section class="home-group"><h2 class="section-title">题库与统计</h2><div class="stack">
      <div class="grid">${button("题库 / 导入", "import")}${button("基础统计", "stats")}</div>
    </div></section></main>`;
  renderMath();
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
    ${banks.length ? `<section><h2 class="section-title">已导入题库</h2>${exportToolbar}<div class="bank-list">${rows}</div></section>` : `<div class="empty compact"><h2>还没有题库</h2><p>导入 Knoop JSON 题库后，就可以选择范围开始学习。</p>${button("导入题库","pick-import","primary")}</div>`}
    ${killed.length ? `<section><h2 class="section-title">题目管理</h2>${button(`已斩杀 ${killed.length} 题`,"killed")}</section>`:""}`,
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
  document.querySelector<HTMLInputElement>("#file")!.onchange = async e => {
    const files = [...((e.target as HTMLInputElement).files ?? [])]; if (!files.length) return;
    message(`正在导入 ${files.length} 个文件……`);
    let success = 0, repaired = 0, questions = 0; const failures: string[] = [];
    for (const file of files) {
      let raw: unknown;
      try { raw = JSON.parse(await file.text()); }
      catch (err) { failures.push(`${file.name}：${err instanceof Error ? err.message : String(err)}`); continue; }
      try {
        if (raw && typeof raw === "object" && (raw as {format?:unknown}).format === "knoop-bundle") {
          const bundle = validateBundle(raw);
          for (let index = 0; index < bundle.banks.length; index++) {
            try {
              const bank = validateBank(bundle.banks[index]); const result = await importBank(bank);
              success++; repaired += result.repaired; questions += bank.questions.length;
            } catch (err) {
              const rawBank = bundle.banks[index] as { import?: { bankTitle?: unknown } };
              const label = typeof rawBank?.import?.bankTitle === "string" ? rawBank.import.bankTitle : `第 ${index + 1} 个题库`;
              failures.push(`${file.name} / ${label}：${err instanceof Error ? err.message : String(err)}`);
            }
          }
        } else {
          const bank = validateBank(raw); const result = await importBank(bank); success++; repaired += result.repaired; questions += bank.questions.length;
        }
      } catch (err) { failures.push(`${file.name}：${err instanceof Error ? err.message : String(err)}`); }
    }
    await importView();
    const summary = `成功 ${success} 个题库，共 ${questions} 项${repaired ? `；完成返修 ${repaired} 题` : ""}${failures.length ? `；失败 ${failures.length}` : ""}`;
    message(failures.length ? `${summary}\n${failures.join("\n")}` : summary, failures.length ? "error" : "ok");
  };
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
      ${kids.length ? `<button class="tree-toggle" data-action="fold:${esc(n.id)}" aria-label="${collapsed ? "展开" : "折叠"}">${collapsed ? "›" : "⌄"}</button>` : `<span class="tree-toggle placeholder"></span>`}
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
    return `<section class="scope-bank"><div class="bank-heading"><label class="scope-check bank-check"><input type="checkbox" data-bank-check="${esc(b.id)}" data-action="scope-bank:${esc(b.id)}" ${state.checked ? "checked" : ""}><span class="bank-heading-text"><b>${esc(b.title)}</b><small>更新 ${esc(formatUpdatedAt(b.updated_at))}</small></span></label>${bankCollapsible.length?`<button class="bank-fold" data-action="scope-bank-fold:${esc(b.id)}" aria-label="${allCollapsed?"展开此题库":"折叠此题库"}" title="${allCollapsed?"展开此题库":"折叠此题库"}">${allCollapsed?"›":"⌄"}</button>`:""}</div>${roots.map(n => renderNode(n)).join("")}</section>`;
  };
  const selectedCount = selectedScopeNodes.size;
  const selectedRows = allQuestions.filter(q => selectedScopeNodes.has(q.node_id));
  const brushCount = selectedRows.filter(isEnabledBrush).length;
  const memorizationCount = selectedRows.filter(q => q.type === "memorization").length;
  const toolbar = banks.length ? `<div class="scope-toolbar"><button class="scope-fold-symbol" data-action="scope-expand-all" aria-label="全部展开" title="全部展开">⌄</button><button class="scope-fold-symbol" data-action="scope-collapse-all" aria-label="全部折叠" title="全部折叠">›</button></div>` : "";
  shell("选择范围", banks.length ? `${toolbar}${banks.map(renderBank).join("")}<div class="scope-bottom"><div><b>${selectedCount}</b> 个范围 · 可刷 ${brushCount} 题 · 可背 ${memorizationCount} 项</div><button class="primary" data-action="scope-next" ${selectedCount ? "" : "disabled"}>下一步</button></div>` : `<div class="empty">还没有题库。${button("去导入", "import", "primary")}</div>`);
  for (const input of document.querySelectorAll<HTMLInputElement>("[data-scope-check]")) { const id = input.dataset.scopeCheck!; const state = stateFor(coverageIds(id)); input.indeterminate = state.partial; }
  for (const input of document.querySelectorAll<HTMLInputElement>("[data-bank-check]")) {
    const bankId=input.dataset.bankCheck!; const roots=(children.get(null)??[]).filter(n=>n.bank_id===bankId);
    const ids=[...new Set(roots.flatMap(r=>coverageIds(r.id)))]; input.indeterminate = stateFor(ids).partial;
  }
  if(focusAction)document.querySelectorAll<HTMLElement>("[data-action]").forEach(element=>{if(element.dataset.action===focusAction)element.focus({preventScroll:true});});
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
  return q.type==="single_choice"?"单":q.type==="multiple_choice"?"多":q.type==="blank"?"填":q.type==="recall"?"卡":"背";
}
function reviewQuestionPreview(q: QuestionInput): string {
  const explain = `<div class="review-preview-section"><b>解析</b><div class="multiline">${q.explanation ? esc(q.explanation) : "无解析"}</div></div>`;
  if (q.type === "single_choice" || q.type === "multiple_choice") {
    const answerIds = new Set(Array.isArray(q.answer) ? q.answer : [String(q.answer ?? "")]);
    const options = (q.options ?? []).map(o => `<div class="review-preview-option ${answerIds.has(o.id)?"correct":""}"><b>${esc(o.id)}</b><span class="multiline">${esc(o.text)}</span>${answerIds.has(o.id)?`<em>正确</em>`:""}</div>`).join("");
    return `<div class="review-question-preview"><div class="review-preview-head"><span class="type">${questionTypeLabel(q)}</span><span>${q.type==="single_choice"?"单选题":"多选题"}</span></div><div class="review-preview-section"><b>题干</b><div class="multiline">${esc(q.stem)}</div></div><div class="review-preview-options">${options}</div><div class="review-preview-section"><b>正确答案</b><div class="multiline">${esc(answerText(q))}</div></div>${explain}</div>`;
  }
  if (q.type === "blank") return `<div class="review-question-preview"><div class="review-preview-head"><span class="type">填</span><span>填空题</span></div><div class="review-preview-section"><b>题干</b><div class="multiline">${esc(q.stem)}</div></div><div class="review-preview-section"><b>标准答案</b><div class="multiline">${esc(String(q.answer ?? ""))}</div></div>${explain}</div>`;
  if (q.type === "recall") return `<div class="review-question-preview"><div class="review-preview-head"><span class="type">卡</span><span>背诵卡</span></div><div class="review-preview-section"><b>正面</b><div class="multiline">${esc(q.front)}</div></div><div class="review-preview-section"><b>背面</b><div class="multiline">${esc(q.back)}</div></div>${explain}</div>`;
  const keyPoints = q.keyPoints?.length ? `<div class="review-preview-section"><b>要点</b><ul>${q.keyPoints.map(x=>`<li class="multiline">${esc(x)}</li>`).join("")}</ul></div>` : "";
  return `<div class="review-question-preview"><div class="review-preview-head"><span class="type">背</span><span>背诵材料</span></div><div class="review-preview-section"><b>提示</b><div class="multiline">${esc(q.prompt)}</div></div><div class="review-preview-section"><b>内容</b><div class="multiline">${esc(q.content)}</div></div>${keyPoints}${explain}</div>`;
}

function presetId(): string { return `preset-${crypto.randomUUID()}`; }
function validPresetTypes(types: BrushType[]): BrushType[] { return types.filter(t=>brushTypes.includes(t)); }
async function saveScopePreset(nodeIds: string[]): Promise<void> {
  const name=(document.querySelector<HTMLInputElement>("#preset-name")?.value??"").trim();
  if(!name){alert("请输入常用组题名称");return;}
  const mode=(document.querySelector<HTMLSelectElement>("#preset-mode")?.value??"random") as PresetMode;
  if(mode!=="sequential"&&mode!=="random"){alert("组题方式无效");return;}
  const types=validPresetTypes([...enabledBrushTypes]);
  if(!types.length){alert("请至少启用一种刷题题型");return;}
  const rawCount=Number(document.querySelector<HTMLInputElement>("#preset-count")?.value||0);
  const count=mode==="random"?Math.max(1,Math.trunc(rawCount||1)):undefined;
  const nodes=await getNodes(), questions=await getQuestions(), contentNodes=new Set(questions.map(q=>q.node_id));
  const ranges=compressPresetRanges([...new Set(nodeIds)],nodes,contentNodes); if(!ranges.length){alert("当前范围没有可保存的有效题目节点");return;}
  const stamp=new Date().toISOString();
  scopePresets=[...scopePresets,{id:presetId(),name,ranges,types,mode,count,createdAt:stamp,updatedAt:stamp}];
  persistScopePresets();
  const nameInput=document.querySelector<HTMLInputElement>("#preset-name");
  const modeSelect=document.querySelector<HTMLSelectElement>("#preset-mode");
  const countInput=document.querySelector<HTMLInputElement>("#preset-count");
  if(nameInput)nameInput.value="";
  if(modeSelect)modeSelect.value="random";
  if(countInput)countInput.value=countInput.dataset.defaultValue??countInput.value;
  const details=document.querySelector<HTMLDetailsElement>("details.preset-save");
  if(details)details.open=false;
  alert(`已保存常用组题：${name}`);
}
async function startPresetById(id:string): Promise<void> {
  const preset=scopePresets.find(p=>p.id===id); if(!preset){alert("常用组题不存在或已删除");return;}
  const nodes=await getNodes(), allQuestions=await getQuestions(), contentNodes=new Set(allQuestions.map(q=>q.node_id));
  const validNodeIds=expandPresetRanges(preset.ranges,nodes,contentNodes);
  if(!validNodeIds.length){alert("这个常用组题引用的范围已全部失效，请重新保存范围");return;}
  let rows=(await questionsForScope(validNodeIds)).filter(q=>preset.types.includes(q.type as BrushType));
  if(preset.mode==="random") rows=shuffled(rows).slice(0,Math.min(preset.count??rows.length,rows.length));
  if(!rows.length){alert("当前题库中没有符合这个常用组题的可用题目");return;}
  setRecentPreset(preset.id);
  const sessionId=await createSession(preset.mode,{source:"preset",presetId:preset.id,ranges:preset.ranges,nodeIds:validNodeIds,types:preset.types,order:preset.mode,count:preset.mode==="random"?preset.count:undefined},rows.map(q=>q.id));
  await navigate({view:"session",id:sessionId});
}
async function presetsView(): Promise<void> {
  const allNodes=await getNodes(); const valid=new Set(allNodes.map(n=>n.id));
  const cards=scopePresets.map(p=>{const validCount=p.ranges.filter(r=>valid.has(r.nodeId)).length;const invalid=p.ranges.length-validCount;return `<div class="card preset-card"><div class="preset-card-head"><div><b>${esc(p.name)}</b><span>${esc(presetSummary(p))}</span></div><div class="compact-card-actions"><button data-action="start-preset:${esc(p.id)}">开始</button><button class="delete-link" data-action="delete-preset:${esc(p.id)}">删除</button></div></div><div class="preset-meta">范围节点 ${validCount}${invalid?` · <em>失效 ${invalid}</em>`:""}</div></div>`}).join("");
  shell("常用组题",scopePresets.length?`<div class="preset-list">${cards}</div>`:`<div class="empty">暂无常用组题，可在选择范围后的模式页保存</div>`);
}

async function chooseScope(nodeIds: string[]) {
  if (!nodeIds.length) { alert("请至少选择一个范围"); return navigate({view:"scope"}, true); }
  const rows = await questionsForScope(nodeIds);
  const answerable = rows.filter(isEnabledBrush); const memorization = rows.filter(q=>q.type==="memorization");
  const activeNames = brushTypes.filter(t=>enabledBrushTypes.has(t)).map(t=>brushLabels[t]).join(" / ") || "无";
  const brushCard = answerable.length ? `<section class="card"><h2>刷题 ${answerable.length} 项</h2><p>题型：${activeNames}</p>
    ${button("顺序刷题","start-scope:sequential","primary")}
    <label>随机题数<input id="random-count" type="number" min="1" max="${answerable.length}" value="${Math.min(10,answerable.length)}"></label>
    ${button("随机刷题","start-scope:random")}
    ${button("题目目录","open-directory:brush")}
    <details class="preset-save"><summary>保存为常用组题</summary><div class="preset-save-body">
      <label>名称<input id="preset-name" type="text" maxlength="40" placeholder="例如：公卫三科 · 200 单选"></label>
      <label>方式<select id="preset-mode"><option value="random" selected>随机</option><option value="sequential">顺序</option></select></label>
      <label>随机题数<input id="preset-count" type="number" min="1" value="${Math.min(200,answerable.length)}" data-default-value="${Math.min(200,answerable.length)}"></label>
      <button data-action="save-scope-preset">保存</button>
    </div></details>
  </section>` : "";
  const memoCard = memorization.length ? `<section class="card"><h2>背诵 ${memorization.length} 项</h2>
    ${button("顺序背诵","start-scope:memorization","primary")}
    <label>随机材料数<input id="memorization-random-count" type="number" min="1" max="${memorization.length}" value="${Math.min(10,memorization.length)}"></label>
    ${button("随机背诵","start-scope:memorization-random")}
    ${button("背诵目录","open-directory:memorization")}
  </section>` : "";
  shell("选择模式", `<p class="scope-selection-summary">当前范围：可刷 ${answerable.length} 题 · 可背 ${memorization.length} 项</p>` + (brushCard+memoCard || `<div class="empty">当前范围没有符合筛选条件的内容</div>`));
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
  if(!rows.length){ alert("此范围没有可用内容"); return; }
  const id=await createSession(sessionMode,{nodeIds,order},rows.map(q=>q.id)); await navigate({ view: "session", id });
}
async function startRows(mode:string,rows:QuestionRow[]){ if(!rows.length)return; const id=await createSession(mode,{source:mode},rows.map(q=>q.id)); await navigate({ view: "session", id }); }

function questionSearchText(q: QuestionInput): string {
  const answer = Array.isArray(q.answer) ? q.answer.join(" ") : String(q.answer ?? "");
  return [q.stem,q.front,q.back,q.prompt,q.content,q.explanation,answer,...(q.options??[]).map(o=>`${o.id} ${o.text}`),...(q.tags??[]),...(q.keyPoints??[])].filter(Boolean).join("\n").toLocaleLowerCase();
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
function directoryListHtml(entries:Array<{row:QuestionRow;index:number}>,sessionId?:string,currentIndex=-1,query=""):string {
  if(!entries.length)return `<div class="empty compact">没有匹配内容</div>`;
  return entries.map(({row:r,index:i})=>{const q=parseQuestion(r), location=directoryMatchLocation(q,query);return `<button class="directory-item ${i===currentIndex?"current":""}" data-action="${sessionId?`jump-session:${i}`:`start-directory:${i}`}"><b>${i+1}</b><span class="type">${questionTypeLabel(q)}</span><span class="directory-copy"><span class="directory-text">${esc(questionLead(q))}</span>${location?`<small class="directory-match">命中${esc(location)}</small>`:""}</span></button>`}).join("");
}
function directorySearchActionsHtml(route: Extract<Route,{view:"directory"}>, count:number):string {
  if(route.sessionId || !route.query?.trim() || !count)return "";
  const noun=route.kind==="memorization"?"背诵":"刷题";
  return `<div class="directory-search-actions"><button class="primary" data-action="start-directory-search:sequential">顺序${noun}搜索结果（${count}）</button><button data-action="start-directory-search:random">随机${noun}搜索结果</button></div>`;
}
async function directoryView(route: Extract<Route,{view:"directory"}>) {
  let rows: QuestionRow[]=[]; let title="题目目录"; let currentIndex=-1;
  if(route.sessionId){
    const session=await sessionById(route.sessionId); if(!session){alert("学习进度不存在");return goBack();}
    const ids=JSON.parse(session.question_ids_json) as string[]; const found=await getQuestions(ids); const byId=new Map(found.map(r=>[r.id,r]));
    rows=ids.map(id=>byId.get(id)).filter(Boolean) as QuestionRow[]; currentIndex=session.current_index;
    title=session.mode==="memorization"?"背诵目录":"题目目录";
  } else {
    const all=await questionsForScope(route.nodeIds??[]); rows=route.kind==="memorization"?all.filter(q=>q.type==="memorization"):all.filter(isEnabledBrush);
    title=route.kind==="memorization"?"背诵目录":"题目目录";
  }
  if(!rows.length){return shell(title,`<div class="empty">没有可定位的内容</div>`);}
  const query=route.query??""; const entries=directoryEntries(rows,query);
  shell(title,`<div class="directory-search"><input id="directory-search" type="search" placeholder="搜索题干、选项、答案、解析、标签" value="${esc(query)}"><span id="directory-search-count">${query.trim()?`找到 ${entries.length} / ${rows.length}`:`共 ${rows.length} 项`}</span></div><div id="directory-search-actions">${directorySearchActionsHtml(route,entries.length)}</div><div class="directory-jump"><input id="directory-index" type="number" min="1" max="${rows.length}" value="${Math.max(1,currentIndex+1)}" inputmode="numeric"><button data-action="directory-go">前往题号</button></div><div id="directory-list" class="directory-list">${directoryListHtml(entries,route.sessionId,currentIndex,query)}</div>`);
  const search=document.querySelector<HTMLInputElement>("#directory-search");
  search?.addEventListener("input",()=>{
    const nextRoute={...route,query:search.value}; history.replaceState(nextRoute,"");
    const nextEntries=directoryEntries(rows,search.value); const count=document.querySelector<HTMLElement>("#directory-search-count"); if(count)count.textContent=search.value.trim()?`找到 ${nextEntries.length} / ${rows.length}`:`共 ${rows.length} 项`;
    const list=document.querySelector<HTMLElement>("#directory-list"); if(list){list.innerHTML=directoryListHtml(nextEntries,route.sessionId,currentIndex,search.value);renderMath(list);}
    const actions=document.querySelector<HTMLElement>("#directory-search-actions"); if(actions)actions.innerHTML=directorySearchActionsHtml(nextRoute,nextEntries.length);
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
    if(q.options) content+=`<div class="options">${q.options.map(o=>`<button class="option ${selection.has(o.id)?"selected":""} ${excludedOptions.has(o.id)?"excluded":""} ${pageState.submitted?(Array.isArray(q.answer)?q.answer:[q.answer]).includes(o.id)?"right":selection.has(o.id)?"wrong":"":""}" data-action="option:${esc(o.id)}" data-option-id="${esc(o.id)}" ${pageState.submitted?"disabled":""}><b>${esc(o.id)}</b><span>${esc(o.text)}</span></button>`).join("")}</div>`;
    if(q.type==="blank") content+=`<input id="blank" class="blank" placeholder="输入答案" value="${esc(blankValue)}" ${pageState.submitted||pageState.pendingManual?"disabled":""}>`;
    if(pageState.submitted||pageState.pendingManual) content+=resultPanel(q);
  }
  const canSubmit=q.type==="blank"?!!blankValue.trim():selection.size>0;
  let bottom="";
  if(q.type==="recall"||q.type==="memorization") bottom=shown?button(index+1===activeRows.length?"完成":"下一项","next","primary"):"";
  else if(pageState.pendingManual) bottom=`${button("判为错误","manual:false","danger")}${button("判为正确","manual:true","primary")}`;
  else if(pageState.submitted) bottom=button(index+1===activeRows.length?"完成":"下一题","next","primary");
  else if(quickMode && q.type==="single_choice") bottom="";
  else bottom=`<button class="primary" data-action="submit" ${canSubmit?"":"disabled"}>提交答案</button>`;
  const quickAvailable=["sequential","random","recall","memorization"].includes(activeSession.mode);
  const quickButton=quickAvailable?`<button class="header-action ${quickMode?"active":""}" data-action="toggle-quick" aria-pressed="${quickMode}">快刷${quickMode?"✓":""}</button>`:"";
  shell(progress,`<article class="quiz">${content}</article><div class="question-actions"><button data-action="favorite:${esc(row.id)}">${fav?"★ 已收藏":"☆ 收藏"}</button><button class="${note?"note-active":""}" data-action="note:${esc(row.id)}">${note?"● 笔记":"笔记"}</button><details class="question-more"><summary>更多操作</summary><div class="question-more-panel"><button class="${killed?"kill-active":""}" data-action="kill:${esc(row.id)}" ${reviewed?"disabled":""}>${reviewed?"已斩杀":killed?"恢复":"斩杀"}</button><button class="${reviewed?"review-active":""}" data-action="review:${esc(row.id)}">${reviewed?"● 待返修":"审核"}</button><button data-action="edit:${esc(row.id)}">编辑</button></div></details></div>${bottom?`<div class="bottom-actions">${bottom}</div>`:""}`,true,quickButton,"session-directory");
  const blank=document.querySelector<HTMLInputElement>("#blank"); if(blank) blank.oninput=()=>{blankValue=blank.value; const submit=document.querySelector<HTMLButtonElement>('[data-action="submit"]'); if(submit)submit.disabled=!blankValue.trim(); void persistDraft();};
  bindOptionLongPress();
}
function explanation(q:QuestionInput){return `<div class="explain"><h3>解析</h3><div class="multiline">${q.explanation?esc(q.explanation):"无解析"}</div></div>`;}
function answerText(q:QuestionInput){ if(q.options){const ids=Array.isArray(q.answer)?q.answer:[q.answer]; return q.options.filter(o=>ids.includes(o.id)).map(o=>`${o.id}. ${o.text}`).join("；");} return String(q.answer??q.back??q.content??""); }
function resultPanel(q:QuestionInput){return `<section class="answer-panel"><h3>${pageState.pendingManual?"请自行判断":pageState.correct?"回答正确":"回答错误"}</h3><div class="multiline"><b>正确答案：</b>${esc(answerText(q))}</div>${explanation(q)}</section>`;}
async function persistDraft(){if(!activeSession)return; await saveSession(activeSession.id,activeSession.current_index,{...pageState,selection:[...selection],excludedOptions:[...excludedOptions],blankValue,quickMode});}
async function submit(){ if(!activeSession)return; const row=activeRows[activeSession.current_index],q=parseQuestion(row); let correct=false; const answer=q.type==="blank"?blankValue:[...selection];
  if(q.type==="single_choice")correct=selection.has(q.answer as string);
  if(q.type==="multiple_choice"){const expected=[...(q.answer as string[])].sort();const got=[...selection].sort();correct=JSON.stringify(expected)===JSON.stringify(got);}
  if(q.type==="blank"&&blankValue!==q.answer){pageState={pendingManual:true};await persistDraft();return quizView();}
  if(q.type==="blank")correct=true; await record(row.id,answer,"auto",correct);
}
async function record(questionId:string,answer:unknown,grading:string,correct:boolean){
  if(!activeSession)return;
  await addAttempt(questionId,activeSession.id,answer,grading,correct);
  if(quickMode&&correct) return next();
  pageState={submitted:true,correct};await persistDraft();await quizView();
}
async function next(){if(!activeSession)return;const nextIndex=activeSession.current_index+1;selection.clear();excludedOptions.clear();blankValue="";pageState={};await saveSession(activeSession.id,nextIndex,{quickMode},nextIndex>=activeRows.length);activeSession.current_index=nextIndex;if(nextIndex>=activeRows.length)finishView();else await quizView();}
function finishView(){shell("本轮完成",`<div class="empty finish-page"><div class="finish">✓</div><h2>完成了 ${activeRows.length} 项</h2><p>本轮学习已保存。</p>${button("查看当前错题","wrong")}${button("返回首页","home","primary")}</div>`,false);}

function bindOptionLongPress(){
  if(pageState.submitted||pageState.pendingManual)return;
  for(const el of document.querySelectorAll<HTMLButtonElement>("[data-option-id]")){
    let timer=0;
    const id=el.dataset.optionId!;
    const cancel=()=>{if(timer){clearTimeout(timer);timer=0;}};
    el.addEventListener("pointerdown",()=>{ cancel(); timer=window.setTimeout(()=>{ timer=0; if(excludedOptions.has(id)) excludedOptions.delete(id); else {excludedOptions.add(id);selection.delete(id);} suppressOptionClickId=id;suppressOptionClickUntil=Date.now()+800;void persistDraft().then(()=>quizView()); },480); });
    el.addEventListener("pointerup",cancel); el.addEventListener("pointercancel",cancel); el.addEventListener("pointerleave",cancel);
    el.addEventListener("contextmenu",e=>e.preventDefault());
  }
}

async function editQuestionView(questionId:string) {
  const row=(await getQuestions([questionId]))[0]; if(!row){alert("内容不存在");return goBack();}
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
  shell("编辑",`<form id="question-editor" class="editor card" data-question-id="${esc(questionId)}">${fields}<div id="message" class="message"></div><div class="edit-actions">${actions}</div></form>`);
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
    if(wasCurrent&&activeSession){ history.replaceState({view:"session",id:activeSession.id} satisfies Route,""); return next(); }
    message("已保存并加入待返修"); setTimeout(()=>goBack(),220); return;
  }
  if(await isReviewed(questionId) && confirm("题目已修改。\n\n是否标记为返修完成？完成后会清除旧作答记录，并按审核前状态决定是否恢复到题池。")){ await completeReview(questionId); message("已保存并完成返修"); }
  else message("已保存");
  setTimeout(()=>{ void goBack(); },220);
}

async function noteView(questionId:string) {
  const row=(await getQuestions([questionId]))[0]; if(!row){alert("内容不存在");return goBack();}
  const q=parseQuestion(row), note=await getNote(questionId);
  shell("笔记",`<section class="card note-editor"><div class="note-question"><span class="type">${questionTypeLabel(q)}</span><div class="multiline">${esc(questionLead(q))}</div></div>
    <label class="editor-field"><span>个人笔记</span><textarea id="note-content" rows="12" placeholder="记录易错点、辨析、记忆线索……">${esc(note?.content??"")}</textarea></label>
    <div id="message" class="message"></div>
    <div class="note-actions">${note?button("删除笔记",`delete-note:${questionId}`,"delete-link"):""}${button("保存",`save-note:${questionId}`,"primary")}</div>
  </section>`);
}
async function saveQuestionNote(questionId:string){
  const value=document.querySelector<HTMLTextAreaElement>("#note-content")?.value??"";
  await saveNote(questionId,value); message(value.trim()?"已保存":"已清空"); setTimeout(()=>goBack(),180);
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
  const row=(await getQuestions([questionId]))[0]; if(!row){alert("内容不存在");return goBack();}
  const q=parseQuestion(row), review=await getReview(questionId); const selected=new Set<ReviewIssue>(review?JSON.parse(review.issues_json):[]);
  const presetButtons=reviewPresets.map((preset,i)=>`<button type="button" class="review-preset" data-action="review-preset:${i}">${esc(preset.label)}</button>`).join("");
  const reviewActions=review
    ? `${button("取消审核",`cancel-review:${questionId}`,"delete-link")}${button("返修完成",`complete-review:${questionId}`)}${button("保存审核",`save-review:${questionId}`,"primary")}`
    : button("加入返修",`save-review:${questionId}`,"primary");
  shell(review?"编辑审核":"审核",`<section class="card review-editor">${reviewQuestionPreview(q)}
    <div><div class="editor-label">常见问题</div><div class="review-presets">${presetButtons}</div></div>
    <div class="editor-label">问题位置</div><div class="review-issues">${reviewIssueLabels.map(([value,label])=>`<label><input type="checkbox" name="review-issue" value="${value}" ${selected.has(value)?"checked":""}><span>${label}</span></label>`).join("")}</div>
    <label class="editor-field"><span>审核意见</span><textarea id="review-note" rows="7" placeholder="说明需要返修或检查的原因……">${esc(review?.note??"")}</textarea></label>
    <div id="message" class="message"></div>
    <div class="review-actions">${reviewActions}</div>
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
  if(wasCurrent&&activeSession){ history.replaceState({view:"session",id:activeSession.id} satisfies Route,""); return next(); }
  message("已加入待返修并斩杀"); setTimeout(()=>goBack(),220);
}

function storedUserAnswerText(q:QuestionInput, raw:string|null|undefined): string {
  if(raw==null)return "";
  let value: unknown; try{value=JSON.parse(raw);}catch{value=raw;}
  if(q.options){const ids=Array.isArray(value)?value:[value];return q.options.filter(o=>ids.includes(o.id)).map(o=>`${o.id}. ${o.text}`).join("；")||String(Array.isArray(value)?value.join("、"):value??"");}
  return String(Array.isArray(value)?value.join("、"):value??"");
}
function expandableQuestionDetail(q:QuestionInput): string {
  const explain=q.explanation?`<section class="review-preview-section"><b>解析</b><div class="multiline">${esc(q.explanation)}</div></section>`:"";
  if(q.type==="single_choice"||q.type==="multiple_choice"){
    const answerIds=new Set(Array.isArray(q.answer)?q.answer:[String(q.answer??"")]);
    const options=(q.options??[]).map(o=>`<div class="review-preview-option ${answerIds.has(o.id)?"correct":""}"><b>${esc(o.id)}</b><span class="multiline">${esc(o.text)}</span>${answerIds.has(o.id)?`<em>正确</em>`:""}</div>`).join("");
    return `<div class="review-question-preview detail-only"><div class="review-preview-options">${options}</div><section class="review-preview-section"><b>正确答案</b><div class="multiline">${esc(answerText(q))}</div></section>${explain}</div>`;
  }
  if(q.type==="blank")return `<div class="review-question-preview detail-only"><section class="review-preview-section"><b>标准答案</b><div class="multiline">${esc(String(q.answer??""))}</div></section>${explain}</div>`;
  if(q.type==="recall")return `<div class="review-question-preview detail-only"><section class="review-preview-section"><b>背面</b><div class="multiline">${esc(q.back)}</div></section>${explain}</div>`;
  const keyPoints=q.keyPoints?.length?`<section class="review-preview-section"><b>要点</b><ul>${q.keyPoints.map(x=>`<li class="multiline">${esc(x)}</li>`).join("")}</ul></section>`:"";
  return `<div class="review-question-preview detail-only"><section class="review-preview-section"><b>内容</b><div class="multiline">${esc(q.content)}</div></section>${keyPoints}${explain}</div>`;
}

function listCardAction(kind:ExpandableListKind,id:string): string { return `toggle-list-card:${kind}:${encodeURIComponent(id)}`; }
function listHeaderToggle(kind:ExpandableListKind,ids:string[]): string {
  const set=expandedSet(kind), all=ids.length>0&&ids.every(id=>set.has(id));
  return `<button class="header-symbol" data-action="list-toggle-all:${kind}" aria-label="${all?"全部收起":"全部展开"}" title="${all?"全部收起":"全部展开"}">${all?"⌃":"⌄"}</button>`;
}
function expandableCard(kind:ExpandableListKind,row:QuestionRow,summaryExtra:string,actions:string,expandedExtra:string): string {
  const q=parseQuestion(row), expanded=expandedSet(kind).has(row.id), action=listCardAction(kind,row.id);
  return `<div class="card compact-list-card expandable-list-card ${expanded?"expanded":""}"><div class="compact-card-head"><span class="type">${questionTypeLabel(q)}</span><div class="compact-card-actions">${actions}</div></div><button class="expandable-card-summary" data-action="${action}" aria-expanded="${expanded}"><span class="compact-card-title multiline">${esc(questionLead(q))}</span><span class="expandable-card-symbol" aria-hidden="true">${expanded?"收起 ⌃":"展开 ⌄"}</span>${summaryExtra}</button>${expanded?`<div class="expandable-card-detail">${expandableQuestionDetail(q)}${expandedExtra}</div>`:""}</div>`;
}
async function listView(kind:ListKind) {
  if(kind==="killed"){const rows=await killedQuestions();return shell("已斩杀",rows.length?`<div class="question-list">${rows.map(r=>{const q=parseQuestion(r);return `<div class="card"><span class="type">${questionTypeLabel(q)}</span><p class="multiline">${esc(questionLead(q))}</p><button data-action="restore-killed:${esc(r.id)}">恢复</button></div>`}).join("")}</div>`:`<div class="empty">暂无已斩杀题目</div>`);}
  if(kind==="notes"){
    const rows=await noteQuestions();
    const body=rows.map(r=>expandableCard("notes",r,`<span class="note-preview compact-preview multiline">${esc(r.note_content)}</span>`,`<button data-action="note:${esc(r.id)}">编辑</button>`,`<section class="expanded-meta"><b>笔记</b><div class="multiline">${esc(r.note_content)}</div></section>`)).join("");
    return shell("笔记",rows.length?`<div class="question-list compact-list">${body}</div>`:`<div class="empty">暂无笔记</div>`,true,rows.length?listHeaderToggle("notes",rows.map(r=>r.id)):"");
  }
  if(kind==="reviews"){
    const rows=await reviewQuestions(); const labels=new Map(reviewIssueLabels);
    const body=rows.map(r=>{const issues=(JSON.parse(r.review_issues_json) as ReviewIssue[]).map(x=>labels.get(x)??x).join(" / ");const q=parseQuestion(r);const attempt=r.latest_answered_at?`<section class="expanded-meta"><b>最近作答</b><div class="multiline">${esc(storedUserAnswerText(q,r.latest_user_answer))}</div><small>${r.latest_is_correct===1?"答对":"答错"} · ${esc(r.latest_answered_at)}</small></section>`:"";return expandableCard("reviews",r,`${issues?`<span class="review-tags">${esc(issues)}</span>`:""}${r.review_note?`<span class="note-preview compact-preview multiline">${esc(r.review_note)}</span>`:""}`,`${button("审核",`review:${r.id}`)}${button("编辑",`edit:${r.id}`)}`,`<section class="expanded-meta"><b>审核信息</b>${issues?`<div>${esc(issues)}</div>`:""}${r.review_note?`<div class="multiline">${esc(r.review_note)}</div>`:""}</section>${attempt}`)}).join("");
    return shell("待返修",rows.length?`${button("导出返修 JSON","export-repair-review","primary")}<div class="question-list compact-list">${body}</div>`:`<div class="empty">暂无待返修题目</div>`,true,rows.length?listHeaderToggle("reviews",rows.map(r=>r.id)):"");
  }
  if(kind==="wrong"){
    const rows=await wrongQuestions();
    const actions=`${button("导出错题 JSON","export-error-review")}${rows.some(graded)?button(`练习 ${rows.filter(graded).length} 题`,`practice:wrong`):""}`;
    const body=rows.map(r=>{const q=parseQuestion(r);const extra=`<section class="expanded-meta wrong-meta"><b>本次错误答案</b><div class="multiline">${esc(storedUserAnswerText(q,r.latest_user_answer))}</div><small>${esc(r.latest_answered_at)}</small></section>`;return expandableCard("wrong",r,"","",extra)}).join("");
    return shell("当前错题",rows.length?`${actions}<div class="question-list compact-list">${body}</div>`:`<div class="empty">暂无错题</div>`,true,rows.length?listHeaderToggle("wrong",rows.map(r=>r.id)):"");
  }
  const rows=await favoriteQuestions();
  const actions=rows.some(graded)?button(`练习 ${rows.filter(graded).length} 题`,`practice:favorites`,"primary"):"";
  const body=rows.map(r=>expandableCard("favorites",r,"","","")).join("");
  return shell("收藏",rows.length?`${actions}<div class="question-list compact-list">${body}</div>`:`<div class="empty">暂无收藏</div>`,true,rows.length?listHeaderToggle("favorites",rows.map(r=>r.id)):"");
}
async function statsView(){const s=await stats();shell("基础统计",`<div class="stats"><div><b>${s.total}</b><span>总作答</span></div><div><b>${s.correct}</b><span>正确</span></div><div><b>${s.wrong}</b><span>错误</span></div><div><b>${s.rate}%</b><span>正确率</span></div><div><b>${s.currentWrong}</b><span>当前错题</span></div></div>`);}

async function saveJsonFile(filename:string,data:unknown,title:string){
  const text=JSON.stringify(data,null,2); const file=new File([text],filename,{type:"application/json"});
  const nav=navigator as Navigator & { canShare?: (data: ShareData)=>boolean };
  try {
    if(navigator.share && (!nav.canShare || nav.canShare({files:[file]}))){ await navigator.share({files:[file],title}); return; }
  } catch(err) { if(err instanceof DOMException && err.name==="AbortError") return; }
  try {
    const url=URL.createObjectURL(file); const a=document.createElement("a"); a.href=url;a.download=filename;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1500); alert(`已生成 ${filename}`);
  } catch {
    try { await navigator.clipboard.writeText(text); alert("无法直接保存文件，JSON 已复制到剪贴板"); }
    catch { alert("导出失败，请重试"); }
  }
}
async function exportWrongReview(){
  const review=await buildCurrentWrongReview(); if(!review.items.length){alert("暂无当前错题");return;}
  const date=new Date().toISOString().slice(0,10); await saveJsonFile(`knoop-error-review-${date}.json`,review,"Knoop 错题回炉");
}
async function exportRepairReview(){
  const review=await buildRepairReview(); if(!review.items.length){alert("暂无待返修题目");return;}
  const date=new Date().toISOString().slice(0,10); await saveJsonFile(`knoop-repair-review-${date}.json`,review,"Knoop 题目返修");
}
async function exportBankFile(bankId:string){
  const bank=await buildBankExport(bankId); const safe=bank.import.bankId.replace(/[\\/:*?"<>|]+/g,"_");
  await saveJsonFile(`knoop-bank-${safe}.json`,bank,`导出题库：${bank.import.bankTitle}`);
}

async function exportSelectedBanks(){
  const ids=[...selectedExportBanks]; if(ids.length<2)return alert("请至少选择两个题库");
  const bundle=await buildBundleExport(ids); const date=new Date().toISOString().slice(0,10);
  await saveJsonFile(`knoop-bundle-${date}.json`,bundle,`导出 ${bundle.banks.length} 个题库`);
}

app.addEventListener("click",async e=>{const target=(e.target as HTMLElement).closest<HTMLElement>("[data-action]");if(!target)return;const action=target.dataset.action!;
  try {
    if(action==="back")return goBack();
    if(action==="home")return navigate({view:"home"});
    if(action==="import")return navigate({view:"import"});
    if(action==="scope"){selectedScopeNodes.clear();return navigate({view:"scope"});}
    if(action==="presets")return navigate({view:"presets"});
    if(action==="wrong"||action==="favorites"||action==="killed"||action==="notes"||action==="reviews")return navigate({view:"list",kind:action});
    if(action==="stats")return navigate({view:"stats"});
    if(action.startsWith("filter-type:")){const type=action.slice("filter-type:".length) as BrushType;if(!brushTypes.includes(type))return;enabledBrushTypes.has(type)?enabledBrushTypes.delete(type):enabledBrushTypes.add(type);saveBrushTypes();return home();}
    if(action==="export-error-review")return exportWrongReview();
    if(action==="export-repair-review")return exportRepairReview();
    if(action==="pick-import"){document.querySelector<HTMLInputElement>("#file")?.click();return;}
    if(action==="export-selected-banks")return exportSelectedBanks();
    if(action.startsWith("export-bank:"))return exportBankFile(action.slice("export-bank:".length));
    if(action.startsWith("resume:"))return navigate({view:"session",id:action.slice(7)});
    if(action.startsWith("start-preset:"))return startPresetById(action.slice("start-preset:".length));
    if(action.startsWith("delete-preset:")){const id=action.slice("delete-preset:".length);const preset=scopePresets.find(p=>p.id===id);if(!preset)return;if(!confirm(`删除常用组题“${preset.name}”？`))return;scopePresets=scopePresets.filter(p=>p.id!==id);persistScopePresets();if(recentPresetId()===id)localStorage.removeItem(recentPresetStorageKey);return presetsView();}
    if(action.startsWith("list-toggle-all:")){const kind=action.slice("list-toggle-all:".length) as ExpandableListKind;if(!["wrong","favorites","notes","reviews"].includes(kind))return;const rows=kind==="notes"?await noteQuestions():kind==="reviews"?await reviewQuestions():kind==="wrong"?await wrongQuestions():await favoriteQuestions();const set=expandedSet(kind);const all=rows.length>0&&rows.every(r=>set.has(r.id));all?set.clear():rows.forEach(r=>set.add(r.id));return listView(kind);}
    if(action.startsWith("toggle-list-card:")){const rest=action.slice("toggle-list-card:".length);const split=rest.indexOf(":");if(split<0)return;const kind=rest.slice(0,split) as ExpandableListKind;const id=decodeURIComponent(rest.slice(split+1));if(!["wrong","favorites","notes","reviews"].includes(kind))return;const set=expandedSet(kind);set.has(id)?set.delete(id):set.add(id);await listView(kind);document.querySelectorAll<HTMLButtonElement>(".expandable-card-summary").forEach(button=>{if(button.dataset.action===action)button.focus({preventScroll:true});});return;}
    if(action.startsWith("fold:")){const id=action.slice(5);collapsedScopeNodes.has(id)?collapsedScopeNodes.delete(id):collapsedScopeNodes.add(id);saveScopeCollapseState();return scopeView(action);}
    if(action==="scope-expand-all"){collapsedScopeNodes.clear();saveScopeCollapseState();return scopeView(action);}
    if(action==="scope-collapse-all"){const {children}=buildScopeTree(scopeNodesCache);for(const n of scopeNodesCache)if((children.get(n.id)?.length??0)>0)collapsedScopeNodes.add(n.id);saveScopeCollapseState();return scopeView(action);}
    if(action.startsWith("scope-bank-fold:")){const bankId=action.slice("scope-bank-fold:".length);const {children}=buildScopeTree(scopeNodesCache);const ids=scopeNodesCache.filter(n=>n.bank_id===bankId&&(children.get(n.id)?.length??0)>0).map(n=>n.id);const allCollapsed=ids.length>0&&ids.every(id=>collapsedScopeNodes.has(id));for(const id of ids)allCollapsed?collapsedScopeNodes.delete(id):collapsedScopeNodes.add(id);saveScopeCollapseState();return scopeView(action);}
    if(action.startsWith("scope-node:")){toggleScopeNode(action.slice("scope-node:".length));return scopeView(action);}
    if(action.startsWith("scope-bank:")){toggleScopeBank(action.slice("scope-bank:".length));return scopeView(action);}
    if(action==="scope-next")return navigate({view:"choose",nodeIds:[...selectedScopeNodes]});
    if(action==="save-scope-preset"){const route=history.state as Route;const ids=route.view==="choose"?(route.nodeIds??(route.nodeId?[route.nodeId]:[])):[];return saveScopePreset(ids);}
    if(action.startsWith("start-scope:")){const mode=action.slice("start-scope:".length);const route=history.state as Route;const ids=route.view==="choose"?(route.nodeIds??(route.nodeId?[route.nodeId]:[])):[];const count=mode==="random"?Number(document.querySelector<HTMLInputElement>("#random-count")?.value||10):mode==="memorization-random"?Number(document.querySelector<HTMLInputElement>("#memorization-random-count")?.value||10):undefined;return startScope(mode,ids,count);}
    if(action.startsWith("open-directory:")){const kind=action.slice("open-directory:".length) as DirectoryKind;const route=history.state as Route;const ids=route.view==="choose"?(route.nodeIds??(route.nodeId?[route.nodeId]:[])):[];return navigate({view:"directory",nodeIds:ids,kind,query:""});}
    if(action==="session-directory"){if(!activeSession)return;return navigate({view:"directory",sessionId:activeSession.id,kind:activeSession.mode==="memorization"?"memorization":"brush",query:""});}
    if(action==="directory-go"){const route=history.state as Route;if(route.view!=="directory")return;const raw=Number(document.querySelector<HTMLInputElement>("#directory-index")?.value||0);const index=Math.trunc(raw)-1;if(index<0)return alert("请输入有效题号");if(route.sessionId){const session=await sessionById(route.sessionId);if(!session)return alert("学习进度不存在");const ids=JSON.parse(session.question_ids_json) as string[];if(index>=ids.length)return alert(`题号应在 1-${ids.length} 之间`);const saved=JSON.parse(session.state_json||"{}") as {quickMode?:boolean};quickMode=!!saved.quickMode;activeSession=session;const found=await getQuestions(ids);const byId=new Map(found.map(r=>[r.id,r]));activeRows=ids.map(id=>byId.get(id)).filter(Boolean) as QuestionRow[];selection.clear();excludedOptions.clear();blankValue="";pageState={};await saveSession(session.id,index,{quickMode});return navigate({view:"session",id:session.id});}const all=await questionsForScope(route.nodeIds??[]);const rows=route.kind==="memorization"?all.filter(q=>q.type==="memorization"):all.filter(isEnabledBrush);if(index>=rows.length)return alert(`题号应在 1-${rows.length} 之间`);const mode=route.kind==="memorization"?"memorization":"sequential";const id=await createSession(mode,{nodeIds:route.nodeIds??[],order:"direct"},rows.map(r=>r.id),index);return navigate({view:"session",id});}
    if(action.startsWith("start-directory-search:")){const order=action.slice("start-directory-search:".length);const route=history.state as Route;if(route.view!=="directory"||route.sessionId)return;const query=route.query?.trim()??"";if(!query)return;const all=await questionsForScope(route.nodeIds??[]);let rows=(route.kind==="memorization"?all.filter(q=>q.type==="memorization"):all.filter(isEnabledBrush)).filter(r=>directoryMatches(parseQuestion(r),query));if(order==="random")rows=shuffled(rows);if(!rows.length)return alert("没有匹配内容");const mode=route.kind==="memorization"?"memorization":order==="random"?"random":"sequential";const id=await createSession(mode,{nodeIds:route.nodeIds??[],order,source:"directory-search",searchQuery:query},rows.map(r=>r.id));return navigate({view:"session",id});}
    if(action.startsWith("start-directory:")){const index=Number(action.slice("start-directory:".length));const route=history.state as Route;if(route.view!=="directory"||route.sessionId)return;const all=await questionsForScope(route.nodeIds??[]);const rows=route.kind==="memorization"?all.filter(q=>q.type==="memorization"):all.filter(isEnabledBrush);if(!rows.length||!Number.isInteger(index)||index<0||index>=rows.length)return;const mode=route.kind==="memorization"?"memorization":"sequential";const id=await createSession(mode,{nodeIds:route.nodeIds??[],order:"direct"},rows.map(r=>r.id),index);return navigate({view:"session",id});}
    if(action.startsWith("jump-session:")){const route=history.state as Route;const sessionId=route.view==="directory"&&route.sessionId?route.sessionId:activeSession?.id;if(!sessionId)return;const session=await sessionById(sessionId);if(!session)return;const ids=JSON.parse(session.question_ids_json) as string[];const index=Number(action.slice("jump-session:".length));if(!Number.isInteger(index)||index<0||index>=ids.length)return;const saved=JSON.parse(session.state_json||"{}") as {quickMode?:boolean};quickMode=!!saved.quickMode;const found=await getQuestions(ids);const byId=new Map(found.map(r=>[r.id,r]));activeRows=ids.map(id=>byId.get(id)).filter(Boolean) as QuestionRow[];selection.clear();excludedOptions.clear();blankValue="";pageState={};await saveSession(session.id,index,{quickMode});session.current_index=index;activeSession=session;return navigate({view:"session",id:session.id});}
    if(action.startsWith("delete-bank:")){const bankId=action.slice("delete-bank:".length);const bank=(await getBanks()).find(b=>b.id===bankId);if(!confirm(`删除题库“${bank?.title??bankId}”？\n\n该题库的题目、作答记录、收藏、审核、笔记和相关未完成进度都会一并删除。此操作不可撤销。`))return;const btn=target as HTMLButtonElement;const oldText=btn.textContent;btn.disabled=true;btn.textContent="删除中…";try{await deleteBank(bankId);return importView();}catch(err){btn.disabled=false;btn.textContent=oldText;throw err;}}
    if(action==="toggle-quick"){quickMode=!quickMode;await persistDraft();return quizView();}
    if(action.startsWith("option:")&&!pageState.submitted){
      const id=action.slice(7); if(id===suppressOptionClickId&&Date.now()<suppressOptionClickUntil)return; const q=parseQuestion(activeRows[activeSession!.current_index]); excludedOptions.delete(id);
      if(q.type==="single_choice"){
        selection=new Set([id]); if(quickMode){const correct=id===q.answer;return record(activeRows[activeSession!.current_index].id,[id],"auto",correct);}
      } else if(q.type==="multiple_choice") {
        const wasSelected=selection.has(id); wasSelected?selection.delete(id):selection.add(id);
        if(quickMode&&!wasSelected){ const expected=q.answer as string[]; if(!expected.includes(id))return record(activeRows[activeSession!.current_index].id,[...selection],"auto",false); const got=[...selection].sort(); const want=[...expected].sort(); if(JSON.stringify(got)===JSON.stringify(want))return record(activeRows[activeSession!.current_index].id,got,"auto",true); }
      }
      await persistDraft();return quizView();
    }
    if(action==="submit")return submit();
    if(action.startsWith("manual:")){const ok=action.endsWith("true");return record(activeRows[activeSession!.current_index].id,blankValue,"manual",ok);}
    if(action==="show-content"){pageState.revealed=true;await persistDraft();return quizView();}
    if(action==="next")return next();
    if(action.startsWith("favorite:")){await toggleFavorite(action.slice(9));return quizView();}
    if(action.startsWith("kill:")){
      const id=action.slice(5); if(await isReviewed(id))return;
      const already=await isKilled(id);
      if(!already&&!confirm("斩杀这道题？\n\n以后新建刷题会话会自动排除，可在“题库 / 导入 → 已斩杀”中恢复。"))return;
      const killed=await toggleKilled(id); if(killed)return next(); return quizView();
    }
    if(action.startsWith("restore-killed:")){await toggleKilled(action.slice("restore-killed:".length));return listView("killed");}
    if(action.startsWith("review:"))return navigate({view:"review",questionId:action.slice(7)});
    if(action.startsWith("review-preset:")){applyReviewPreset(Number(action.slice("review-preset:".length)));return;}
    if(action.startsWith("save-review:"))return saveQuestionReview(action.slice("save-review:".length));
    if(action.startsWith("complete-review:")){const id=action.slice("complete-review:".length);if(!confirm("确认这道题已经检查或返修完成？\n\n完成后会清除旧作答记录，并按审核前状态决定是否恢复到题池。"))return;await completeReview(id);message("已完成返修");setTimeout(()=>goBack(),180);return;}
    if(action.startsWith("cancel-review:")){const id=action.slice("cancel-review:".length);if(!confirm("取消这道题的审核标记？"))return;await cancelReview(id);return goBack();}
    if(action.startsWith("note:"))return navigate({view:"note",questionId:action.slice(5)});
    if(action.startsWith("save-note:"))return saveQuestionNote(action.slice("save-note:".length));
    if(action.startsWith("delete-note:")){const id=action.slice("delete-note:".length);if(!confirm("删除这条笔记？"))return;await saveNote(id,"");return goBack();}
    if(action.startsWith("edit:")){const current=isRoute(history.state)?history.state:null;return navigate({view:"edit",questionId:action.slice(5),returnTo:asReturnTarget(current)});}
    if(action.startsWith("save-edit-review:"))return saveQuestionEdit(action.slice("save-edit-review:".length),true);
    if(action.startsWith("save-edit:"))return saveQuestionEdit(action.slice("save-edit:".length));
    if(action.startsWith("practice:")){const rows=action.endsWith("wrong")?await wrongQuestions():await favoriteQuestions();return startRows(action.endsWith("wrong")?"wrong":"favorites",rows.filter(graded));}
  } catch(err){alert(err instanceof Error?err.message:String(err));}
});

window.addEventListener("popstate", e => {
  if(forcedBackTarget){const target=forcedBackTarget;forcedBackTarget=null;history.replaceState(target,"");void renderRoute(target);return;}
  const route = isRoute(e.state) ? e.state : ({view:"home"} satisfies Route); void renderRoute(route);
});

db().then(async()=>{ const route = isRoute(history.state) ? history.state : ({view:"home"} satisfies Route); await navigate(route, true); }).catch(err=>{shell("启动失败",`<div class="message error">${esc(err instanceof Error?err.message:String(err))}</div>`,false);});
