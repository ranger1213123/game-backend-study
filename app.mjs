import { icon } from "./icons.mjs";
import { renderMarkdown } from "./markdown.mjs";
import { createCourseSource } from "./data.mjs";
import {
  STORAGE_KEY,
  UNIT_IDS,
  TEXTBOOK_REVISION,
  needsRevalidation,
  pendingRevalidation,
  createState,
  loadState,
  saveState,
  parseBackup,
  exportBackup,
  updateUnit,
  completeUnit,
  uncompleteUnit,
  setCurrentUnit,
  updateSettings,
  getStats,
  startFocus,
  pauseFocus,
  resetFocus,
  syncFocus,
  focusSnapshot,
} from "./state.mjs";

const $ = (s, root = document) => root.querySelector(s);
const $$ = (s, root = document) => [...root.querySelectorAll(s)];
const courseSource = createCourseSource({
  baseURL: document.baseURI,
  mode: document.querySelector('meta[name="study-data-mode"]')?.content || "api",
});
const escape = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (char) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        char
      ],
  );
const unitURL = (id) => `#/unit/${id}`;
const docURL = (file) => `#/doc/${encodeURIComponent(file)}`;
const sections = [
  {
    id: "theory",
    check: "theory",
    label: "概念与模型",
    short: "概念模型",
    time: "2h",
  },
  {
    id: "readingAndDesign",
    check: "design",
    label: "例题与推演",
    short: "例题推演",
    time: "2h",
  },
  {
    id: "implementation",
    check: "implementation",
    label: "动手实验与练习",
    short: "动手练习",
    time: "4h",
  },
  {
    id: "verification",
    check: "verification",
    label: "验证与复盘",
    short: "验证复盘",
    time: "2h",
  },
  {
    id: "delivery",
    check: "defense",
    label: "本节回顾",
    short: "本节回顾",
    time: "",
  },
];
const moduleMeta = [
  ["code", "FOUNDATIONS", "让代码有清楚的边界"],
  ["terminal", "HTTP & TESTING", "把失败也设计进接口"],
  ["layers", "SYSTEMS RUNTIME", "从进程与字节流追踪运行时"],
  ["code", "PROTOCOL", "让跨端通信有据可依"],
  ["database", "DATA ENGINEERING", "让约束守住持久事实"],
  ["layers", "CONSISTENCY", "让重复请求只生效一次"],
  ["shield", "DURABLE STATE", "划清原子边界与版本顺序"],
  ["flag", "ASYNC EFFECTS", "解释租约、取消与未知结果"],
  ["clock", "RELIABILITY", "让系统故障可以恢复"],
  ["shield", "PRODUCTION", "用证据说明性能与安全"],
  ["spark", "AI ENGINEERING", "把模型变成可验证的能力"],
  ["flag", "EXECUTION PROTOCOL", "冻结任务契约与验收证据"],
  ["code", "PYTHON RUNTIME", "从对象与协议理解语法"],
  ["layers", "SYNC & PARALLEL", "用同步关系解释线程与进程"],
  ["clock", "ASYNC & I/O", "看清事件循环、取消与背压"],
  ["terminal", "MEMORY & PERFORMANCE", "用测量定位运行时问题"],
  ["database", "MIDDLEWARE", "跨过缓存与消息的故障边界"],
  ["layers", "DISTRIBUTED TASKS", "让后台任务可追溯、可恢复"],
  ["spark", "AGENT RUNTIME", "用真实工具和持久状态构建Agent"],
  ["shield", "ENTERPRISE AGENT", "让权限、审批与恢复贯穿全链路"],
];

let course,
  units,
  unitIndex,
  storage,
  state,
  storageError = "",
  externalChange = false,
  recoveryMode = false,
  recoveryRaw = null;
let pageVersion = 0,
  readingObserver,
  scrollSaveAt = 0,
  pendingImport = null;
let focusMode = false,
  mapFilter = "all",
  searchQuery = "";
try {
  storage = window.localStorage;
  const loaded = loadState(storage);
  state = loaded.state;
  storageError = loaded.error || "";
  recoveryMode = !!loaded.error;
  if (recoveryMode) recoveryRaw = storage.getItem(STORAGE_KEY);
} catch {
  state = createState();
  storageError = "浏览器未允许保存学习记录。请允许本地存储，或及时导出备份。";
}
state = syncFocus(state, Date.now());

function toast(message) {
  const node = document.createElement("div");
  node.className = "toast";
  node.textContent = message;
  $("#notifications").append(node);
  setTimeout(() => node.remove(), 4400);
}
function persist() {
  if (externalChange || recoveryMode) {
    updateWarning();
    return false;
  }
  state = syncFocus(state, Date.now());
  if (!storage) return false;
  const result = saveState(storage, state);
  storageError = result.ok
    ? ""
    : String(result.error || "记录未能保存，请立即导出备份。");
  updateWarning();
  return result.ok;
}
function updateWarning() {
  const revisionNode = $("[data-revision-notice]");
  if (revisionNode) {
    const pending = pendingRevalidation(state);
    revisionNode.hidden = pending.length === 0;
    revisionNode.textContent = `教材中的运行时、持久状态与执行协议已重写。${pending.length} 个有旧记录的单元需按新正文重新自检；笔记、收藏、专注时间和旧版自检历史均已保留。`;
  }
  const node = $("[data-storage-warning]");
  if (!node) return;
  const message = externalChange
    ? "另一个学习窗口更新了记录。请先导出本窗口备份，再刷新以继续，避免记录相互覆盖。"
    : recoveryMode
      ? "原学习记录暂时无法读取，已保护原数据。本次修改仅在窗口中暂存，请先导出备份，再恢复有效记录。"
      : storageError;
  node.hidden = !message;
  node.innerHTML = `${icon("info")}<span>${escape(message)}</span><button data-action="backup">导出备份</button>${externalChange ? '<button data-action="reload">刷新</button>' : ""}`;
}
function applySettings() {
  document.documentElement.dataset.theme = state.settings.theme;
  document.documentElement.style.setProperty(
    "--reader-size",
    `${state.settings.fontSize}px`,
  );
  document.body.classList.toggle("focus-mode", focusMode);
}
function route() {
  const hash = location.hash.slice(1) || "/home";
  const [path] = hash.split("?");
  const [, kind = "home", raw = ""] = path.split("/");
  let id;
  try {
    id = decodeURIComponent(raw);
  } catch {
    id = "";
  }
  return { kind, id };
}
function navigate(hash) {
  if (location.hash === hash) render();
  else location.hash = hash;
}
function currentUnit() {
  return unitIndex?.get(state.currentUnit) || units?.[0];
}
function moduleOf(id) {
  return course.modules.find((mod) => mod.units.some((unit) => unit.id === id));
}
function progressOf(mod) {
  return mod.units.filter((unit) => state.units[unit.id].status === "completed")
    .length;
}
function formatTime(seconds) {
  const n = Math.max(0, Math.floor(seconds));
  return `${String(Math.floor(n / 60)).padStart(2, "0")}:${String(n % 60).padStart(2, "0")}`;
}
function duration(seconds) {
  return seconds < 3600
    ? `${Math.floor(seconds / 60)} 分钟`
    : `${(seconds / 3600).toFixed(1)} 小时`;
}
function button(label, action, name, extra = "") {
  return `<button class="button ${extra}" data-action="${action}">${name ? icon(name) : ""}${label}</button>`;
}
function navItem(label, href, name, active, count = "") {
  return `<a class="nav-item ${active ? "active" : ""}" href="${href}" ${active ? 'aria-current="page"' : ""}>${icon(name)}<span>${label}</span>${count !== "" ? `<small>${count}</small>` : ""}</a>`;
}
function sidebar(view) {
  const activeModule =
    view.kind === "unit"
      ? moduleOf(view.id)?.id
      : view.kind === "module"
        ? view.id
        : "";
  const stats = getStats(state);
  return `<aside class="sidebar" id="sidebar" aria-label="学习导航">
    <a class="brand" href="#/home"><span class="brand-mark">${icon("code")}</span><span>后端研习室<small>GO × AI ENGINEERING</small></span></a>
    <div class="space-label">你的个人学习空间 <span class="local-pill">LOCAL</span></div>
    <nav class="primary-nav">
      ${navItem("学习工作台", "#/home", "grid", view.kind === "home")}
      ${navItem("课程地图", "#/map", "map", ["map", "module", "unit"].includes(view.kind))}
      ${navItem("我的笔记", "#/notes", "note", view.kind === "notes", units.filter((u) => state.units[u.id].notes.trim()).length || "")}
      ${navItem("学习收藏", "#/bookmarks", "bookmark", view.kind === "bookmarks", stats.bookmarkedUnits.length || "")}
      ${navItem("学习指南", docURL("learning/00-study-contract.md"), "book", view.kind === "doc")}
    </nav>
    <div class="sidebar-heading"><span>学习路径</span><span>${course.modules.length} 模块</span></div>
    <nav class="module-nav" aria-label="课程模块">${course.modules.map((mod, i) => `<div class="module-nav-group"><a href="#/module/${mod.id}" class="module-nav-link ${activeModule === mod.id ? "selected" : ""}"><span class="module-number ${progressOf(mod) === 5 ? "done" : ""}">${progressOf(mod) === 5 ? icon("check") : String(i + 1).padStart(2, "0")}</span><span>${escape(mod.title)}</span><span class="module-count">${progressOf(mod)}/5</span></a>${activeModule === mod.id ? `<div class="unit-nav">${mod.units.map((u) => `<a href="${unitURL(u.id)}" class="${view.id === u.id ? "selected" : ""}" ${view.id === u.id ? 'aria-current="page"' : ""}><span class="unit-dot ${state.units[u.id].status === "completed" ? "done" : ""}"></span><span>${escape(u.title)}</span></a>`).join("")}</div>` : ""}</div>`).join("")}</nav>
    <div class="sidebar-bottom"><span class="quiet-leaf">${icon("leaf")}</span><div>把每一步，积累成能力<small><span class="online-dot"></span>${courseSource.mode === "static" ? "在线阅读 · 记录存本机" : "本地运行 · 无需登录"}</small></div></div>
  </aside>`;
}
function header(view) {
  const labels = {
    home: "学习工作台",
    map: "课程地图",
    module: "课程模块",
    unit: "沉浸阅读",
    notes: "我的笔记",
    bookmarks: "学习收藏",
    doc: "学习资料",
  };
  return `<header class="topbar"><div class="breadcrumb"><button class="icon-button mobile-menu" data-action="menu" aria-label="打开学习导航">${icon("menu")}</button><span class="breadcrumb-space">学习空间</span><span class="slash">/</span><strong>${labels[view.kind] || "学习工作台"}</strong></div><div class="topbar-actions"><button class="search-trigger" data-action="search">${icon("search")}<span>搜索课程、知识点…</span><kbd>Ctrl K</kbd></button><button class="icon-button" data-action="theme" aria-label="切换${state.settings.theme === "light" ? "深色" : "浅色"}主题">${icon(state.settings.theme === "light" ? "moon" : "sun")}</button><button class="icon-button" data-action="backup" aria-label="学习数据与备份">${icon("download")}</button><span class="avatar" title="本地个人空间">我</span></div></header>`;
}
function phaseLabel(unit) {
  const i = Number(unit.id.slice(1));
  return i <= 10
    ? "第一阶段 · 建立工程基础"
    : i <= 20
      ? "第二阶段 · 理解游戏运行时"
      : i <= 30
        ? "第三阶段 · 守住数据正确性"
        : i <= 40
          ? "第四阶段 · 构建业务切片"
          : i <= 50
            ? "第五阶段 · 走向生产工程"
            : i <= 60
              ? "第六阶段 · AI 与综合作品"
              : i <= 70
                ? "第七阶段 · Python 运行时与同步"
                : "第八阶段 · 异步 I/O 与性能诊断";
}
function heroArt() {
  return `<div class="hero-art" aria-hidden="true"><div class="orbit orbit-one"></div><div class="orbit orbit-two"></div><div class="orbit orbit-three"></div><div class="art-core">${icon("terminal")}<span>BUILD.<br>VERIFY.<br>REPEAT.</span></div><span class="art-node node-go">Go<span>01</span></span><span class="art-node node-db">${icon("database")}<span>DATA</span></span><span class="art-node node-ai">${icon("spark")}<span>AI</span></span><span class="art-dot dot-one"></span><span class="art-dot dot-two"></span><span class="art-cross">+</span></div>`;
}
function moduleCard(mod, i) {
  const [name, english, desc] = moduleMeta[i];
  const completed = progressOf(mod);
  return `<a class="module-card" href="#/module/${mod.id}"><div class="module-card-top"><span class="module-card-icon tone-${i % 4}">${icon(name)}</span><span class="card-ordinal">${String(i + 1).padStart(2, "0")}</span></div><div class="eyebrow">${english}</div><h3>${escape(mod.title)}</h3><p>${desc}</p><div class="module-card-meta"><span>5 个单元 <span class="meta-dot">·</span> 50 小时</span><span>${completed === 5 ? "已自检" : completed > 0 ? `${completed}/5 已自检` : "探索模块"} ${icon("arrow")}</span></div><div class="micro-progress"><span style="width:${completed * 20}%"></span></div></a>`;
}
function weekActivity() {
  const now = new Date();
  const day = (now.getDay() + 6) % 7;
  const monday = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate() - day,
  );
  const days = Array.from({ length: 7 }, (_, i) => {
    const start = new Date(monday);
    start.setDate(start.getDate() + i);
    const end = new Date(start);
    end.setDate(end.getDate() + 1);
    const seconds = state.sessions
      .filter((s) => {
        const d = new Date(s.startedAt);
        return d >= start && d < end;
      })
      .reduce((sum, s) => sum + (s.elapsedSeconds || 0), 0);
    return { name: "一二三四五六日"[i], seconds, today: i === day };
  });
  return `<div class="week-days">${days.map((d) => `<div class="week-day ${d.today ? "today" : ""}" title="周${d.name} · ${duration(d.seconds)}"><small>${d.name}</small><span class="day-track"><i style="height:${d.seconds ? Math.max(8, Math.min(100, (d.seconds / 3600) * 100)) : 0}%"></i>${d.today ? "<b></b>" : ""}</span></div>`).join("")}</div><div class="week-foot"><span>本周专注</span><strong>${duration(days.reduce((sum, d) => sum + d.seconds, 0))}</strong></div>`;
}
function home() {
  const unit = currentUnit(),
    stats = getStats(state),
    next =
      units.find((u) => state.units[u.id].status !== "completed") ||
      units.at(-1);
  const percent = Math.round(stats.progress * 100);
  return `<div class="page home-page"><section class="page-heading"><div><div class="eyebrow">YOUR ENGINEERING JOURNEY</div><h1>从一个例子，读懂系统<span class="title-dot">。</span></h1><p>先理解定义，再推演代码，用实验与习题检验理解。</p></div><div class="heading-tag">${icon("leaf")} 扎实生长，持续构建</div></section>
    <p class="textbook-entry"><a class="button secondary" href="${courseSource.bookURL}">${icon("book")} 连续阅读整本教材</a> <a class="text-link" href="${courseSource.downloadURL}" download="backend-systems-textbook.html">保存离线教材 ${icon("download")}</a> · <a href="${docURL("learning/textbook/README.md")}">序言与阅读方法</a> · <a href="${docURL("learning/textbook/editorial-review.md")}">三位学者的审订记录</a></p>
    <div class="home-columns"><div class="home-primary"><section class="continue-card"><div class="hero-content"><div class="hero-eyebrow"><span class="live-dot"></span>${state.units[unit.id].status === "not-started" ? "从这里开始" : "继续你的学习"}<span class="hero-label">${unit.id} / ${units.length}</span></div><div class="hero-phase">${phaseLabel(unit)}</div><h2>${escape(unit.title)}</h2><p>${escape(unit.artifact)}。<br>在持续迭代的大项目中，建立可验证的理解。</p><a class="button hero-button" href="${unitURL(unit.id)}">${state.units[unit.id].status === "not-started" ? "开始学习" : "继续学习"} ${icon("arrow")}</a><div class="hero-footnote">${icon("clock")} 10 小时课程预算 <span>·</span> 5 段教学正文</div></div>${heroArt()}</section>
    <section class="stats-strip" aria-label="学习概况"><div><span>已完成自检</span><strong>${stats.completedUnits}<small> / ${units.length} 单元</small></strong><div class="stats-track"><i style="width:${percent}%"></i></div></div><div><span>累计专注</span><strong>${Math.floor(stats.focusSeconds / 60)}<small> 分钟</small></strong><p>记录真实投入的时间</p></div><div><span>你的学习节奏</span><strong>${Math.ceil(course.totalHours / state.settings.weeklyHours)}<small> 周计划</small></strong><button class="text-button" data-action="plan">每周 ${state.settings.weeklyHours} 小时 ${icon("chevron")}</button></div></section>
    <div class="section-heading"><div><h2>按章节阅读，把概念逐步连起来</h2><p>${course.modules.length} 个模块 · ${course.totalHours} 小时 · 工程作品与底层实验</p></div><a class="text-link" href="#/map">课程全览 ${icon("arrow")}</a></div><div class="module-grid">${course.modules.slice(0, 6).map(moduleCard).join("")}</div>
    <div class="section-heading"><div><h2>Python 底层：把执行机制弄明白</h2><p>对象、求值、同步、事件循环与内存 · 每节含例题与解答</p></div><a class="text-link" href="${docURL("learning/python-foundations.md")}">先看学习路线 ${icon("arrow")}</a></div><div class="module-grid">${course.modules.slice(12, 16).map((mod, i) => moduleCard(mod, i + 12)).join("")}</div>
    <div class="section-heading"><div><h2>中间件与企业Agent：完成真实集成</h2><p>Redis、消息队列、Celery、MCP与持久工作流</p></div><a class="text-link" href="${docURL("learning/projects/README.md")}">六个大型系统项目 ${icon("arrow")}</a></div><div class="module-grid">${course.modules.slice(16).map((mod,i)=>moduleCard(mod,i+16)).join("")}</div><a class="next-stage-banner" href="#/map"><span class="round-icon">${icon("spark")}</span><span><strong>继续走向生产工程与 AI</strong><small>探索持久状态、失败恢复、执行协议与独立验收</small></span>${icon("arrow")}</a></div>
    <aside class="home-secondary"><section class="panel rhythm-panel"><div class="panel-heading"><h2>保持自己的节奏</h2><span class="subtle-icon">${icon("calendar")}</span></div><p class="muted">小步前进，也是在靠近目标。</p>${weekActivity()}<div class="quiet-divider"></div><span class="eyebrow">下一个小目标</span><a class="next-goal" href="${unitURL(next.id)}"><span class="goal-number">${next.id}</span><strong>${escape(next.title)}</strong>${icon("arrow")}</a></section>
    <section class="panel focus-preview"><span class="focus-symbol">${icon("focus")}</span><span class="eyebrow">ONE THING AT A TIME</span><h2>留 25 分钟，<br>只做一件事。</h2><p>开启专注计时，把一次阅读变成一段真正投入的学习。</p><button class="button secondary" data-action="home-focus">进入专注学习 ${icon("upRight")}</button></section>
    <section class="guide-card"><div class="guide-icon">${icon("book")}</div><h3>先学会如何学习</h3><p>如何读源码、留下实验记录，以及与 AI 一起思考。</p><a class="text-link" href="${docURL("learning/00-study-contract.md")}">阅读学习约定 ${icon("arrow")}</a></section><div class="local-note">${icon("shield")}<p>课程离线可读，记录保存在当前浏览器。<button class="text-button" data-action="backup">记得定期备份 ${icon("upRight")}</button></p></div></aside></div></div>`;
}
function mapPage() {
  const visible = course.modules.filter(
    (mod) =>
      mapFilter === "all" ||
      (mapFilter === "python" ? Number(mod.id.slice(1)) >= 13 && Number(mod.id.slice(1)) <= 16 :
      mod.units.some((u) =>
        mapFilter === "active"
          ? state.units[u.id].status === "in-progress"
          : state.units[u.id].bookmarks,
      )),
  );
  return `<div class="page"><section class="page-heading"><div><div class="eyebrow">THE LEARNING PATH</div><h1>每一个模块，都通向真实能力。</h1><p>从工程基础到综合作品。你可以自由阅读，用实验与答辩完成自检。</p></div></section><div class="path-summary"><div><strong>${course.totalHours}<small>小时</small></strong><span>主线课程预算</span></div><div><strong>${units.length}<small>单元</small></strong><span>理论、实践与验证</span></div><div><strong>${course.gates.length}<small>关卡</small></strong><span>每 100 小时一次答辩</span></div><div class="path-summary-note">${icon("flag")}<span>不要只读完。<br><strong>要能解释、能修改、能验证。</strong></span></div></div><div class="section-heading"><h2>你的工程成长路径</h2><div class="filters" role="group" aria-label="筛选课程">${[
    ["all", "全部模块"],
    ["python", "Python 底层"],
    ["active", "进行中"],
    ["saved", "已收藏"],
  ]
    .map(
      ([id, label]) =>
        `<button class="${mapFilter === id ? "active" : ""}" data-filter="${id}">${label}</button>`,
    )
    .join("")}</div></div><div class="map-modules">${
    visible.length
      ? visible
          .map((mod) => {
            const i = course.modules.indexOf(mod);
            return `<section class="map-module"><div class="map-module-heading"><div class="map-number">${String(i + 1).padStart(2, "0")}</div><div><div class="eyebrow">${moduleMeta[i][1]}</div><h2><a href="#/module/${mod.id}">${escape(mod.title)}</a></h2></div><span class="module-hours">50 小时 <span>·</span> ${progressOf(mod)}/5 已自检</span></div><div class="map-unit-list">${mod.units.map(unitRow).join("")}</div>${(i + 1) % 2 === 0 ? `<div class="gate-marker">${icon("flag")} G${(i + 1) / 2} 阶段答辩 <span>默认排期累计 ${(i + 1) * 50} 小时课程预算 · 检验独立操作与解释能力</span><a href="${docURL("learning/assessment.md")}">查看验收 ${icon("arrow")}</a></div>` : ""}</section>`;
          })
          .join("")
      : empty(
          "还没有符合条件的模块",
          "先打开一个单元，或收藏你想回看的内容。",
          "浏览全部模块",
          "#/map",
        )
  }</div></div>`;
}
function unitRow(unit) {
  const record = state.units[unit.id];
  const done = record.status === "completed";
  return `<a class="unit-row" href="${unitURL(unit.id)}"><span class="unit-state ${done ? "done" : record.status === "in-progress" ? "active" : ""}">${done ? icon("check") : icon("play")}</span><span class="unit-id">${unit.id}</span><div><strong>${escape(unit.title)}</strong><small>${escape(unit.artifact)}</small></div>${record.bookmarks ? icon("bookmark", "saved") : ""}<span class="unit-row-time">10h</span>${icon("chevron")}</a>`;
}
function modulePage(id) {
  const mod = course.modules.find((m) => m.id === id);
  if (!mod) return missing();
  const i = course.modules.indexOf(mod);
  const next =
    mod.units.find((u) => state.units[u.id].status !== "completed") ||
    mod.units[0];
  return `<div class="page module-page"><a class="back-link" href="#/map">${icon("arrow")} 课程地图</a><section class="module-intro"><div class="eyebrow">MODULE ${String(i + 1).padStart(2, "0")} / ${moduleMeta[i][1]}</div><h1>${escape(mod.title)}</h1><p>${moduleMeta[i][2]}，用 5 个单元把理解落实到代码与证据。</p><div class="module-intro-bottom"><span>${icon("clock")} 50 小时课程预算</span><span>${icon("book")} 5 个单元</span><span>${progressOf(mod)}/5 已自检</span><a class="button primary" href="${unitURL(next.id)}">${progressOf(mod) ? "继续本模块" : "开始本模块"} ${icon("arrow")}</a></div></section><div class="module-details"><section><h2 class="section-title">本模块的学习单元</h2><div class="panel module-unit-panel">${mod.units.map(unitRow).join("")}</div><section class="panel module-overview"><h2>开始前，建立一张地图</h2><div class="prose">${renderMarkdown(mod.overviewMarkdown, mod.file)}</div></section></section><aside class="panel module-sidebar"><span class="round-icon">${icon("flag")}</span><h2>用交付物证明理解</h2><p>每个单元都要留下实现、失败实验和独立解释。阅读进度与真实能力，是两份需要同时积累的记录。</p><h3>推荐前置</h3><p>${mod.requires.length ? mod.requires.map((req) => `<a href="#/module/${req}">${escape(course.modules.find((m) => m.id === req)?.title || req)}</a>`).join("、") : "有一门编程语言的项目经验即可开始。"}</p><a class="text-link" href="${docURL("learning/templates/unit-evidence.md")}">查看实验记录模板 ${icon("arrow")}</a></aside></div></div>`;
}
function timerPanel() {
  const timer = focusSnapshot(state, Date.now());
  return `<section class="panel timer-panel"><div class="panel-heading"><h2>${icon("focus")} 专注一小步</h2><select aria-label="专注时长" id="focus-duration" ${timer.status === "running" || timer.status === "paused" ? "disabled" : ""}><option value="1500" ${timer.durationSeconds === 1500 ? "selected" : ""}>25 分钟</option><option value="3000" ${timer.durationSeconds === 3000 ? "selected" : ""}>50 分钟</option></select></div><div class="timer-ring" data-timer-ring style="--timer-progress:${timer.progress * 100}%"><div><strong data-timer-value>${formatTime(timer.remainingSeconds)}</strong><span data-timer-label>${timer.status === "running" ? "专注当下" : timer.status === "paused" ? "已暂停" : timer.status === "finished" ? "完成一段专注" : "准备好，开始吧"}</span></div></div><div class="timer-buttons"><button class="button primary" data-action="timer-toggle"><span data-timer-icon>${icon(timer.status === "running" ? "pause" : "play")}</span><span data-timer-button>${timer.status === "running" ? "暂停" : timer.status === "paused" ? "继续专注" : "开始专注"}</span></button><button class="icon-button outlined" data-action="timer-reset" aria-label="重置专注计时">${icon("reset")}</button></div><p class="timer-note" data-timer-unit>${timer.status === "running" || timer.status === "paused" ? `正在记录 ${timer.unitId} · 计时不代替单元自检` : "只记录实际投入，不自动完成单元"}</p></section>`;
}
function checkPanel(unit) {
  const record = state.units[unit.id],
    ready =
      Object.values(record.checks).every(Boolean) &&
      record.notes.trim().length >= 20;
  const revised = needsRevalidation(state, unit.id);
  return `<section class="panel checklist-panel"><div class="panel-heading"><h2>本单元学习自检</h2><span class="mini-badge" data-check-count>${Object.values(record.checks).filter(Boolean).length}/5</span></div><p class="muted small">${revised ? "本单元学习目标已重写，旧版自检保存在备份历史中。请重新实验，更新复盘，再逐项确认新版能力。" : "完成实践后，再勾选你能独立做到的事。"}</p><div class="study-checks">${sections.map((s) => `<label class="study-check"><input type="checkbox" data-check="${s.check}" ${record.checks[s.check] ? "checked" : ""}><span>${escape(s.label)}</span>${s.time ? `<small>${s.time}</small>` : ""}</label>`).join("")}</div><button class="button ${record.status === "completed" ? "secondary" : "primary"} full-width" data-action="complete" ${!ready && record.status !== "completed" ? "disabled" : ""}>${icon(record.status === "completed" ? "check" : "flag")}<span data-complete-label>${record.status === "completed" ? "已完成自检 · 点击撤销" : revised ? "重新登记新版自检" : "登记本单元自检"}</span></button><p class="small muted completion-hint">${record.status === "completed" ? "已保存在当前浏览器。正式验收请按课程提交实验文件。" : "勾选五项，并在下方留下至少 20 字的实验记录。"}</p></section>`;
}
function notesPanel(unit) {
  return `<section class="panel notes-panel"><div class="panel-heading"><h2>${icon("note")} 随手记与实验复盘</h2><span class="save-status" data-save-status>${externalChange || recoveryMode || storageError ? "仅本窗口暂存" : "本地保存"}</span></div><label class="sr-only" for="unit-notes">${unit.id} 学习笔记</label><textarea id="unit-notes" maxlength="20000" placeholder="今天验证了什么？\n记录命令、结果、失败现象与自己的解释。\n\n别只写“学会了”。">${escape(state.units[unit.id].notes)}</textarea><div class="notes-footer"><span data-note-count>${state.units[unit.id].notes.length} / 20000</span><button class="text-button" data-action="download-note">导出笔记 ${icon("download")}</button></div></section><section class="ai-help"><span>${icon("spark")}</span><div><h3>先思考，再向 AI 提问</h3><p>带上当前单元、实验假设与卡点，获得更有用的帮助。</p><button class="text-button" data-action="ai-prompt">复制本节求教提示词 ${icon("copy")}</button></div></section>`;
}
function unitPage(id) {
  const unit = unitIndex.get(id);
  if (!unit) return missing();
  const mod = moduleOf(id),
    record = state.units[id],
    index = units.indexOf(unit);
  return `<div class="reader-page">
    <div class="reader-toolbar"><a class="back-link" href="#/module/${mod.id}">${icon("arrow")} ${escape(mod.title)}</a>
      <div class="reader-actions"><button class="icon-button ${record.bookmarks ? "is-saved" : ""}" data-action="bookmark" aria-label="${record.bookmarks ? "取消收藏" : "收藏本单元"}" aria-pressed="${record.bookmarks}">${icon("bookmark")}</button>
        <div class="font-controls"><button data-action="font-smaller" aria-label="减小阅读字号">A−</button><button data-action="font-larger" aria-label="增大阅读字号">A+</button></div>
        <button class="button secondary small-button tools-toggle" data-action="tools">${icon("note")} 学习工具</button>
        <button class="button secondary small-button" data-action="focus">${icon("focus")} 专注阅读</button>
      </div>
    </div>
    <div class="reader-layout"><article class="reader-article">
      <header class="lesson-heading"><div class="eyebrow">${mod.id} <span>/</span> ${unit.id} <span>·</span> ${phaseLabel(unit).split(" · ")[0]}</div><h1>${escape(unit.title)}</h1><p>${escape(unit.artifact)}</p>
        <div class="lesson-meta"><span>${icon("clock")} 10 小时课程预算</span><span>${icon("book")} 5 个学习环节</span><span class="lesson-status" data-lesson-status>${record.status === "completed" ? "已完成自检" : "实践后留下你的证据"}</span></div>
      </header>
      <nav class="section-tabs" aria-label="本单元阅读目录">${sections.map((s, i) => `<a href="#section-${s.id}" data-scroll-section="${s.id}" class="${(record.lastSection || "theory") === s.id ? "active" : ""}"><span>${String(i + 1).padStart(2, "0")}</span>${s.short}${s.time ? `<small>${s.time}</small>` : ""}</a>`).join("")}</nav>
      <details class="lesson-intro"><summary>${icon("info")} 本模块导读 ${icon("chevron")}</summary><div class="prose">${renderMarkdown(unit.overviewMarkdown || mod.overviewMarkdown, mod.file)}</div></details>
      ${unit.introMarkdown ? `<div class="lesson-prerequisite prose">${renderMarkdown(unit.introMarkdown, mod.file)}</div>` : ""}
      ${unit.sections.map((section, i) => `<section class="lesson-section" id="section-${section.id}" data-section="${section.id}"><div class="lesson-section-heading"><span>${String(i + 1).padStart(2, "0")}</span><h2>${escape(sections[i]?.label || section.title)}</h2>${sections[i]?.time ? `<small>${sections[i].time}</small>` : ""}</div><div class="prose">${renderMarkdown(section.markdown, mod.file)}</div></section>`).join("")}
      <div class="lesson-end"><span class="round-icon">${icon("leaf")}</span><h2>读到这里，把理解交给实践。</h2><p>完成实验，在学习自检中留下你的独立判断。</p><div class="lesson-pagination">${index > 0 ? `<a href="${unitURL(units[index - 1].id)}"><small>← 上一单元</small><strong>${escape(units[index - 1].title)}</strong></a>` : "<span></span>"}${index < units.length - 1 ? `<a href="${unitURL(units[index + 1].id)}"><small>下一单元 →</small><strong>${escape(units[index + 1].title)}</strong></a>` : `<a href="${docURL("learning/assessment.md")}"><small>最后一步 →</small><strong>开始综合答辩</strong></a>`}</div></div>
    </article><aside class="study-tools" aria-label="学习工具"><button class="tools-close" data-action="tools">${icon("close")} 关闭学习工具</button>${timerPanel()}${checkPanel(unit)}${notesPanel(unit)}</aside></div>
    <button class="tools-scrim" data-action="tools" aria-label="关闭学习工具"></button>
  </div>
  <div class="focusbar"><a class="focusbar-brand" href="#/home">${icon("code")}</a><span>${unit.id} <strong>${escape(unit.title)}</strong></span><div class="focusbar-actions"><button class="text-button" data-action="timer-toggle">${icon("clock")}<span data-timer-value>${formatTime(focusSnapshot(state, Date.now()).remainingSeconds)}</span></button><button class="icon-button" data-action="theme" aria-label="切换阅读主题">${icon(state.settings.theme === "light" ? "moon" : "sun")}</button><button class="button secondary small-button" data-action="focus">退出专注 <kbd>Esc</kbd></button></div></div>`;
}
function empty(title, desc, label, href) {
  return `<div class="empty-state"><span class="empty-icon">${icon("leaf")}</span><h2>${title}</h2><p>${desc}</p><a class="button primary" href="${href}">${label} ${icon("arrow")}</a></div>`;
}
function collectionPage(kind) {
  const notes = kind === "notes";
  const list = units.filter((u) =>
    notes ? state.units[u.id].notes.trim() : state.units[u.id].bookmarks,
  );
  return `<div class="page"><section class="page-heading"><div><div class="eyebrow">${notes ? "THINKING, MADE VISIBLE" : "WORTH COMING BACK TO"}</div><h1>${notes ? "把思考留下来。" : "值得再读一次。"}</h1><p>${notes ? "那些实验、卡点和豁然开朗，都在这里慢慢积累。" : "把重要的单元放在手边，建立自己的复习路线。"}</p></div><span class="collection-count">${list.length} ${notes ? "份笔记" : "个收藏"}</span></section>${list.length ? `<div class="collection-grid">${list.map((u) => `<a class="collection-card panel" href="${unitURL(u.id)}"><div class="eyebrow">${u.moduleId} / ${u.id} <span>${icon(notes ? "note" : "bookmark")}</span></div><h2>${escape(u.title)}</h2><p>${escape(notes ? state.units[u.id].notes.slice(0, 180) : u.artifact)}</p><span class="text-link">${notes ? "继续记录" : "返回阅读"} ${icon("arrow")}</span></a>`).join("")}</div>` : empty(notes ? "第一份笔记，从一个问题开始。" : "把想回看的内容，留在这里。", notes ? "打开任意单元，在右侧写下你的实验与理解，笔记会自动汇集在这里。" : "阅读时点击右上角的收藏图标，随时回来继续。", "开始一个单元", unitURL(state.currentUnit))}</div>`;
}
function missing() {
  return `<div class="page">${empty("这页学习内容还没找到", "可以回到课程地图，选择接下来想探索的单元。", "返回课程地图", "#/map")}</div>`;
}
async function documentPage(path, version) {
  const doc = await courseSource.loadDocument(path);
  if (version !== pageVersion) return;
  $("#main").innerHTML =
    `<div class="page document-page"><div class="document-layout"><article class="panel document-article"><div class="eyebrow">LEARNING LIBRARY</div><div class="prose">${renderMarkdown(doc.markdown, doc.path)}</div></article><aside class="document-toc panel"><h2>学习资料</h2>${course.resources.map((resource) => `<a class="${resource.file === path ? "active" : ""}" href="${docURL(resource.file)}">${escape(resource.title)}${icon("chevron")}</a>`).join("")}</aside></div></div>`;
  document.title = `${doc.title} · 后端研习室`;
  focusHeading();
  const anchor = new URLSearchParams(location.hash.split("?")[1] || "").get(
    "anchor",
  );
  if (anchor)
    document.getElementById(anchor)?.scrollIntoView({ block: "start" });
}
function focusHeading() {
  const heading = $("#main h1");
  if (heading) {
    heading.tabIndex = -1;
    heading.focus({ preventScroll: true });
  }
}
function setupReading() {
  readingObserver?.disconnect();
  if (route().kind !== "unit") return;
  const id = route().id;
  const saved = state.units[id]?.lastSection;
  if (saved && saved !== "theory")
    requestAnimationFrame(() =>
      document
        .getElementById(`section-${saved}`)
        ?.scrollIntoView({ block: "start" }),
    );
  readingObserver = new IntersectionObserver(
    (entries) => {
      const entry = entries
        .filter((e) => e.isIntersecting)
        .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
      if (!entry || route().id !== id) return;
      const section = entry.target.dataset.section;
      $$("[data-scroll-section]").forEach((el) =>
        el.classList.toggle("active", el.dataset.scrollSection === section),
      );
      if (state.units[id].lastSection !== section) {
        state = updateUnit(state, id, { lastSection: section });
        persist();
      }
    },
    { rootMargin: "-140px 0px -52% 0px", threshold: 0 },
  );
  $$("[data-section]").forEach((node) => readingObserver.observe(node));
}
async function render() {
  const version = ++pageVersion,
    view = route();
  readingObserver?.disconnect();
  if (view.kind !== "unit") focusMode = false;
  if (view.kind === "unit" && unitIndex.has(view.id)) {
    state = setCurrentUnit(state, view.id);
    if (state.units[view.id].status === "not-started")
      state = updateUnit(state, view.id, { status: "in-progress" });
    persist();
  }
  applySettings();
  const content =
    view.kind === "home"
      ? home()
      : view.kind === "map"
        ? mapPage()
        : view.kind === "module"
          ? modulePage(view.id)
          : view.kind === "unit"
            ? unitPage(view.id)
            : ["notes", "bookmarks"].includes(view.kind)
              ? collectionPage(view.kind)
              : view.kind === "doc"
                ? '<div class="page loading-state">正在打开学习资料…</div>'
                : missing();
  $("#app").innerHTML =
    `${sidebar(view)}<div class="app-surface">${header(view)}<div class="storage-warning" data-storage-warning hidden></div><div class="storage-warning" data-revision-notice hidden role="status"></div><main id="main">${content}</main><footer class="page-footer"><span>后端研习室 <span>·</span> 用实践构建能力</span><a href="${docURL("learning/validation.md")}">课程与验证范围 ${icon("upRight")}</a></footer></div><button class="sidebar-scrim" data-action="menu" aria-label="关闭学习导航"></button>`;
  updateWarning();
  window.scrollTo({ top: 0, behavior: "instant" });
  document.title = `${view.kind === "unit" ? unitIndex.get(view.id)?.title || "课程" : view.kind === "map" ? "课程地图" : "学习工作台"} · 后端研习室`;
  if (view.kind === "doc") {
    try {
      await documentPage(view.id, version);
    } catch (error) {
      if (version === pageVersion)
        $("#main").innerHTML =
          `<div class="page">${empty("资料暂时未打开", escape(error.message), "返回课程地图", "#/map")}</div>`;
    }
  } else {
    focusHeading();
    setupReading();
  }
  updateTimer();
}

function showDialog(html, className = "") {
  closeDialog();
  const dialog = document.createElement("dialog");
  dialog.className = `app-dialog ${className}`;
  dialog.innerHTML = html;
  $("#modal-root").append(dialog);
  dialog.addEventListener("click", (e) => {
    if (e.target === dialog) closeDialog();
  });
  dialog.addEventListener("close", () => dialog.remove());
  dialog.showModal();
  return dialog;
}
function closeDialog() {
  const dialog = $("dialog");
  if (dialog) {
    dialog.close();
    dialog.remove();
  }
  pendingImport = null;
}
function dialogHeading(eyebrow, title) {
  return `<div class="dialog-heading"><div><div class="eyebrow">${eyebrow}</div><h2>${title}</h2></div><button class="icon-button" data-action="close-dialog" aria-label="关闭对话框">${icon("close")}</button></div>`;
}
function openSearch() {
  const dialog = showDialog(
    `<div class="search-box">${icon("search")}<label class="sr-only" for="search-input">搜索课程</label><input id="search-input" type="search" placeholder="搜索知识点、课程或单元编号…" autocomplete="off"><kbd>Esc</kbd></div><div id="search-results" class="search-results"></div><div class="search-footer"><span>搜索全部 ${units.length} 个单元的正文</span><span>离线可用 ${icon("check")}</span></div>`,
    "search-dialog",
  );
  searchQuery = "";
  renderSearch();
  $("#search-input", dialog).focus();
}
function renderSearch() {
  const query = searchQuery.toLowerCase().trim(),
    terms = query.split(/\s+/).filter(Boolean);
  let found = units.map((u) => ({
    unit: u,
    score: query
      ? terms.reduce(
          (sum, t) =>
            sum +
            (u.id.toLowerCase().includes(t) ? 100 : 0) +
            (u.title.toLowerCase().includes(t) ? 30 : 0) +
            (u.searchText.toLowerCase().includes(t) ? 1 : 0),
          0,
        )
      : 0,
  }));
  if (query)
    found = found
      .filter(({ unit }) =>
        terms.every((t) =>
          `${unit.id} ${unit.title} ${unit.searchText}`
            .toLowerCase()
            .includes(t),
        ),
      )
      .sort((a, b) => b.score - a.score);
  else
    found = found
      .filter(
        ({ unit }) =>
          unit.id === state.currentUnit || state.units[unit.id].bookmarks,
      )
      .slice(0, 6);
  $("#search-results").innerHTML =
    `<div class="search-label">${query ? `找到 ${found.length} 个相关单元` : "继续学习与收藏"}</div>${
      found.length
        ? found
            .slice(0, 24)
            .map(({ unit }) => {
              const text = unit.searchText
                .replace(/[#*`>]/g, "")
                .replace(/\s+/g, " ");
              const at = terms.length
                ? Math.max(0, text.toLowerCase().indexOf(terms[0]) - 25)
                : 0;
              return `<a href="${unitURL(unit.id)}" class="search-result" data-close-search><span class="search-unit">${unit.id}</span><div><strong>${escape(unit.title)}</strong><small>${escape(unit.moduleTitle)} · ${escape(text.slice(at, at + 90))}${text.length > at + 90 ? "…" : ""}</small></div>${icon("arrow")}</a>`;
            })
            .join("")
        : `<div class="search-empty">${icon("search")}<p>试试“事务”“context”或“U04”，<br>也可以换一个更短的关键词。</p></div>`
    }`;
}
function openBackup() {
  const stats = getStats(state);
  showDialog(
    `${dialogHeading("YOUR LOCAL LEARNING DATA", "让你的积累，有一份备份。")}<p class="dialog-description">笔记、自检、收藏和专注记录保存在当前浏览器。清除浏览器数据或更换访问地址时，请先导出。</p><div class="backup-summary"><span><strong>${stats.completedUnits}</strong>单元自检</span><span><strong>${units.filter((u) => state.units[u.id].notes.trim()).length}</strong>份笔记</span><span><strong>${Math.floor(stats.focusSeconds / 60)}</strong>专注分钟</span></div><button class="button primary full-width" data-action="export">${icon("download")} 导出完整学习备份</button><div class="import-area"><h3>从备份继续学习</h3><p>导入前可查看摘要；恢复会替换此浏览器现有记录。</p><label class="button secondary file-button">${icon("upload")} 选择备份文件<input type="file" id="import-file" accept="application/json,.json"></label><div id="import-preview" aria-live="polite"></div></div><p class="small muted">这里的单元完成记录是学习自检，独立于命令行的证据验收。</p>`,
    "backup-dialog",
  );
  if (recoveryRaw) {
    const warning = document.createElement("div");
    warning.className = "import-preview";
    warning.innerHTML =
      '<strong>原记录已受到保护</strong><p>先导出原始记录，可在后续排查时保留数据。</p><button class="button secondary" data-action="export-raw">导出原始记录</button>';
    $("dialog").append(warning);
  }
}
function download(text, name, type = "text/plain;charset=utf-8") {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function exportData(suffix = "") {
  state = syncFocus(state, Date.now());
  download(
    exportBackup(state),
    `后端研习室-学习备份${suffix}-${new Date().toISOString().slice(0, 10)}.json`,
    "application/json",
  );
}
function openPlan() {
  showDialog(
    `${dialogHeading("FIND YOUR OWN PACE", "为学习，留一段固定时间。")}<p class="dialog-description">${course.totalHours} 小时是课程预算。实际进度以你的实践和验收为准，计划可以随时调整。</p><label class="plan-label" for="weekly-hours">每周投入 <strong id="weekly-display">${state.settings.weeklyHours} 小时</strong></label><input id="weekly-hours" type="range" min="5" max="40" step="1" value="${state.settings.weeklyHours}"><div class="range-labels"><span>5 小时 / 周</span><span>40 小时 / 周</span></div><div class="plan-estimate">约 <strong id="plan-weeks">${Math.ceil(course.totalHours / state.settings.weeklyHours)}</strong> 周，走完主线</div><button class="button primary full-width" data-action="save-plan">保存我的学习节奏 ${icon("check")}</button>`,
  );
}
async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    toast("已复制，可以粘贴使用。");
  } catch {
    const dialog = showDialog(
      `${dialogHeading("COPY TEXT", "选择文字后复制")}<p class="muted">浏览器未允许直接复制，可以选中下方内容。</p><textarea class="copy-fallback" readonly></textarea>`,
    );
    const area = $("textarea", dialog);
    area.value = text;
    area.focus();
    area.select();
  }
}
function aiPrompt(unit) {
  const record = state.units[unit.id];
  const moduleNumber = Number(unit.moduleId.slice(1));
  const context = moduleNumber >= 17
    ? "你是我的中间件与企业Agent系统工程教练。围绕当前大项目解释真实组件、协议、资源与故障边界。必须区分第三方SDK能力、应用实现、测试替身和真实集成；工具执行与权限不能只依赖提示词。"
    : moduleNumber >= 13
    ? "你是我的 Python 底层学习教练。我有编程经验，正在学习 Python 的对象、同步异步、运行时、内存与性能。以 Python 3.12+ 标准库为基线；区分语言保证、CPython 实现、GIL 构建和平台实测，优先解释机制与可证伪实验。"
    : "你是我的 Go 后端学习教练。我有编程经验，Go 后端刚入门。";
  return `${context}\n当前课程：${unit.moduleTitle} / ${unit.id} ${unit.title}\n本单元交付物：${unit.artifact}\n\n请按以下方式辅导：\n1. 先问我一个诊断问题，确认我理解了什么。\n2. 围绕不变量、边界和失败恢复提问；给线索，先不要直接给完整实现。\n3. 区分项目现有能力、假设和我需要实现的练习；引用优先用官方文档，并说明版本。\n4. 帮我设计一个能推翻错误假设的小实验，写清预期结果与证据。\n5. 最后用一个变体题检查我是否能独立解释。不要替我虚构执行结果。\n\n我的笔记与卡点：\n${record.notes || "（请在这里补充问题、代码和真实输出）"}\n\n我会另行提供相关代码。不要假定你已读取本地仓库，也不要请求密钥、个人信息或生产数据。`;
}
function refreshUnitControls() {
  const view = route();
  if (view.kind !== "unit" || !unitIndex.has(view.id)) return;
  const unit = unitIndex.get(view.id),
    record = state.units[view.id];
  const ready =
      Object.values(record.checks).every(Boolean) &&
      record.notes.trim().length >= 20,
    done = record.status === "completed";
  const count = $("[data-check-count]");
  if (count)
    count.textContent = `${Object.values(record.checks).filter(Boolean).length}/5`;
  const button = $('[data-action="complete"]');
  if (button) {
    button.disabled = !done && !ready;
    button.classList.toggle("primary", !done);
    button.classList.toggle("secondary", done);
    button.innerHTML = `${icon(done ? "check" : "flag")}<span data-complete-label>${done ? "已完成自检 · 点击撤销" : needsRevalidation(state, view.id) ? "重新登记新版自检" : "登记本单元自检"}</span>`;
  }
  const hint = $(".completion-hint");
  if (hint)
    hint.textContent = done
      ? "自检已登记；正式验收请按课程提交实验文件。"
      : "勾选五项，并在下方留下至少 20 字的实验记录。";
  const status = $("[data-lesson-status]");
  if (status)
    status.textContent =
      record.status === "completed" ? "已完成自检" : "实践后留下你的证据";
}
function updateTimer() {
  if (!course) return;
  const timer = focusSnapshot(state, Date.now());
  $$("[data-timer-value]").forEach(
    (node) => (node.textContent = formatTime(timer.remainingSeconds)),
  );
  $$("[data-timer-ring]").forEach((node) =>
    node.style.setProperty("--timer-progress", `${timer.progress * 100}%`),
  );
  const label = $("[data-timer-label]");
  if (label)
    label.textContent =
      timer.status === "running"
        ? "专注当下"
        : timer.status === "paused"
          ? "已暂停"
          : timer.status === "finished"
            ? "完成一段专注"
            : "准备好，开始吧";
  const btn = $("[data-timer-button]");
  if (btn)
    btn.textContent =
      timer.status === "running"
        ? "暂停"
        : timer.status === "paused"
          ? "继续专注"
          : "开始专注";
  const btnIcon = $("[data-timer-icon]");
  if (btnIcon)
    btnIcon.innerHTML = icon(timer.status === "running" ? "pause" : "play");
  const select = $("#focus-duration");
  if (select)
    select.disabled = timer.status === "running" || timer.status === "paused";
  const timerUnit = $("[data-timer-unit]");
  if (timerUnit)
    timerUnit.textContent = ["running", "paused"].includes(timer.status)
      ? `正在记录 ${timer.unitId} · 计时不代替单元自检`
      : "只记录实际投入，不自动完成单元";
}

document.addEventListener("click", async (event) => {
  if (event.target.closest(".skip-link")) {
    event.preventDefault();
    const main = $("#main");
    if (main) {
      main.tabIndex = -1;
      main.focus();
      main.scrollIntoView({ block: "start" });
    }
    return;
  }
  const docLink = event.target.closest("a[data-doc-path]");
  if (docLink) {
    event.preventDefault();
    navigate(
      docURL(docLink.dataset.docPath) +
        (docLink.dataset.docAnchor
          ? `?anchor=${encodeURIComponent(docLink.dataset.docAnchor)}`
          : ""),
    );
    return;
  }
  const sectionLink = event.target.closest("[data-scroll-section]");
  if (sectionLink) {
    event.preventDefault();
    const id = sectionLink.dataset.scrollSection;
    $("#section-" + id)?.scrollIntoView({ behavior: "smooth", block: "start" });
    if (route().kind === "unit") {
      state = updateUnit(state, route().id, { lastSection: id });
      persist();
    }
    return;
  }
  const innerAnchor = event.target.closest('.prose a[href^="#"]');
  if (innerAnchor && !innerAnchor.getAttribute("href").startsWith("#/")) {
    event.preventDefault();
    let id;
    try {
      id = decodeURIComponent(innerAnchor.getAttribute("href").slice(1));
    } catch {
      return;
    }
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth" });
    return;
  }
  const copy = event.target.closest("[data-copy-code]");
  if (copy) {
    await copyText(
      copy.closest(".code-block")?.querySelector("code")?.textContent || "",
    );
    return;
  }
  const filter = event.target.closest("[data-filter]");
  if (filter) {
    mapFilter = filter.dataset.filter;
    render();
    return;
  }
  if (event.target.closest("[data-close-search]")) closeDialog();
  const actionNode = event.target.closest("[data-action]");
  if (!actionNode) return;
  const action = actionNode.dataset.action;
  try {
    if (action === "answer-question") {
      const question = actionNode.closest(".study-question");
      const feedback = $(".question-feedback", question);
      $$(".question-choice", question).forEach(button => button.setAttribute("aria-pressed", String(button === actionNode)));
      feedback.hidden = false;
      feedback.dataset.result = actionNode.dataset.correct === "true" ? "correct" : "retry";
      feedback.textContent = `${actionNode.dataset.correct === "true" ? "推演正确。" : "再沿着执行过程检查一下。"}${actionNode.dataset.explanation}`;
    } else if (action === "search") openSearch();
    else if (action === "theme") {
      state = updateSettings(state, {
        theme: state.settings.theme === "light" ? "dark" : "light",
      });
      persist();
      applySettings();
      $$('[data-action="theme"]').forEach((n) => {
        n.innerHTML = icon(state.settings.theme === "light" ? "moon" : "sun");
        n.setAttribute(
          "aria-label",
          `切换${state.settings.theme === "light" ? "深色" : "浅色"}主题`,
        );
      });
    } else if (action === "backup") openBackup();
    else if (action === "close-dialog") closeDialog();
    else if (action === "export") {
      exportData();
      toast("完整学习备份已导出。");
    } else if (action === "restore" && pendingImport) {
      const imported = pendingImport;
      if (recoveryRaw)
        download(recoveryRaw, "后端研习室-原始记录.json", "application/json");
      exportData("-恢复前");
      state = syncFocus(imported, Date.now());
      externalChange = false;
      recoveryMode = false;
      const ok = persist();
      closeDialog();
      render();
      toast(
        ok
          ? "备份已恢复；恢复前的记录也已导出。"
          : "备份已在本窗口载入，但未能保存。请保留导出文件并检查上方提示。",
      );
    } else if (action === "plan") openPlan();
    else if (action === "save-plan") {
      state = updateSettings(state, {
        weeklyHours: Number($("#weekly-hours").value),
      });
      const ok = persist();
      closeDialog();
      render();
      toast(ok ? "学习节奏已保存。" : "学习节奏仅在本窗口暂存，请先导出备份。");
    } else if (action === "menu") {
      document.body.classList.toggle("menu-open");
    } else if (action === "tools") {
      document.body.classList.toggle("tools-open");
    } else if (action === "reload") location.reload();
    else if (action === "focus") {
      focusMode = !focusMode;
      applySettings();
    } else if (action === "home-focus") {
      navigate(unitURL(state.currentUnit));
      focusMode = true;
      applySettings();
      setTimeout(() => {
        focusMode = true;
        applySettings();
      }, 0);
    } else if (action === "font-smaller" || action === "font-larger") {
      state = updateSettings(state, {
        fontSize: Math.max(
          16,
          Math.min(
            22,
            state.settings.fontSize + (action === "font-larger" ? 1 : -1),
          ),
        ),
      });
      persist();
      applySettings();
      toast(`阅读字号：${state.settings.fontSize}px`);
    } else if (action === "bookmark" && route().kind === "unit") {
      const id = route().id;
      state = updateUnit(state, id, { bookmarks: !state.units[id].bookmarks });
      const ok = persist();
      actionNode.classList.toggle("is-saved", state.units[id].bookmarks);
      actionNode.setAttribute(
        "aria-pressed",
        String(state.units[id].bookmarks),
      );
      actionNode.setAttribute(
        "aria-label",
        state.units[id].bookmarks ? "取消收藏" : "收藏本单元",
      );
      toast(
        ok
          ? state.units[id].bookmarks
            ? "已加入学习收藏。"
            : "已取消收藏。"
          : "收藏变更仅在本窗口暂存，请先导出备份。",
      );
    } else if (action === "complete" && route().kind === "unit") {
      const id = route().id,
        wasDone = state.units[id].status === "completed";
      state = wasDone ? uncompleteUnit(state, id) : completeUnit(state, id);
      const ok = persist();
      refreshUnitControls();
      toast(
        ok
          ? wasDone
            ? "已撤销本单元自检记录。"
            : "本单元自检已登记。继续用实验积累能力！"
          : "自检状态仅在本窗口暂存，请先导出备份。",
      );
    } else if (action === "export-raw" && recoveryRaw) {
      download(recoveryRaw, "后端研习室-原始记录.json", "application/json");
    } else if (action === "download-note") {
      const unit = unitIndex.get(route().id);
      download(
        `# ${unit.id} ${unit.title}\n\n${state.units[unit.id].notes}\n`,
        `${unit.id}-学习笔记.md`,
        "text/markdown;charset=utf-8",
      );
    } else if (action === "ai-prompt") {
      await copyText(aiPrompt(unitIndex.get(route().id)));
    } else if (action === "timer-toggle") {
      const now = Date.now(),
        timer = focusSnapshot(state, now);
      if (timer.status === "running") state = pauseFocus(state, now);
      else
        state = startFocus(
          state,
          timer.status === "paused" ? timer.unitId : state.currentUnit,
          now,
          Number($("#focus-duration")?.value || 1500),
        );
      persist();
      updateTimer();
    } else if (action === "timer-reset") {
      state = resetFocus(state, Date.now());
      persist();
      updateTimer();
    }
  } catch (error) {
    toast(error.message || "这一步暂时未完成，请重试。");
  }
});
document.addEventListener("input", (event) => {
  if (event.target.id === "search-input") {
    searchQuery = event.target.value;
    renderSearch();
  }
  if (event.target.id === "unit-notes" && route().kind === "unit") {
    state = updateUnit(state, route().id, { notes: event.target.value });
    const ok = persist();
    const count = $("[data-note-count]");
    if (count) count.textContent = `${event.target.value.length} / 20000`;
    const status = $("[data-save-status]");
    if (status) status.textContent = ok ? "已保存" : "未能保存";
    refreshUnitControls();
  }
  if (event.target.id === "weekly-hours") {
    const n = Number(event.target.value);
    $("#weekly-display").textContent = `${n} 小时`;
    $("#plan-weeks").textContent = Math.ceil(course.totalHours / n);
  }
});
document.addEventListener("change", async (event) => {
  if (event.target.matches("[data-check]") && route().kind === "unit") {
    const id = route().id;
    state = updateUnit(state, id, {
      checks: {
        ...state.units[id].checks,
        [event.target.dataset.check]: event.target.checked,
      },
    });
    persist();
    refreshUnitControls();
  }
  if (event.target.id === "focus-duration") {
    state = resetFocus(state, Date.now());
    state = {
      ...state,
      focus: { ...state.focus, durationSeconds: Number(event.target.value) },
    };
    persist();
    updateTimer();
  }
  if (event.target.id === "import-file") {
    const file = event.target.files[0];
    if (!file) return;
    try {
      if (file.size > 16 * 1024 * 1024)
        throw Error("备份文件过大，请选择研习室导出的 JSON。");
      const imported = parseBackup(await file.text());
      pendingImport = imported;
      const stats = getStats(imported);
      $("#import-preview").innerHTML =
        `<div class="import-preview"><strong>备份有效，可以恢复</strong><p>${stats.completedUnits} 个已自检单元 · ${Object.values(imported.units).filter((u) => u.notes.trim()).length} 份笔记 · ${Math.floor(stats.focusSeconds / 60)} 分钟专注</p>${pendingRevalidation(imported).length ? `<p>${pendingRevalidation(imported).length} 个单元内容已重写，恢复后需重新自检。旧版记录已保留在备份历史中。</p>` : ""}<button class="button primary full-width" data-action="restore">备份当前记录并恢复此文件</button></div>`;
    } catch (error) {
      pendingImport = null;
      $("#import-preview").textContent = `无法导入：${error.message}`;
    }
  }
});
document.addEventListener("keydown", (event) => {
  const editing = event.target.matches(
    "input,textarea,select,[contenteditable]",
  );
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
    event.preventDefault();
    openSearch();
  }
  if (event.key === "Escape") {
    if ($("dialog")) closeDialog();
    else if (document.body.classList.contains("tools-open"))
      document.body.classList.remove("tools-open");
    else if (focusMode) {
      focusMode = false;
      applySettings();
    } else document.body.classList.remove("menu-open");
  }
  if (
    !editing &&
    !event.ctrlKey &&
    !event.metaKey &&
    event.key.toLowerCase() === "f" &&
    route().kind === "unit" &&
    !$("dialog")
  ) {
    event.preventDefault();
    focusMode = !focusMode;
    applySettings();
  }
});
window.addEventListener("hashchange", () => {
  document.body.classList.remove("menu-open", "tools-open");
  closeDialog();
  if (course) render();
});
window.addEventListener("pagehide", () => persist());
window.addEventListener("visibilitychange", () => {
  if (course) {
    state = syncFocus(state, Date.now());
    persist();
    updateTimer();
  }
});
window.addEventListener("storage", (event) => {
  if (event.key === STORAGE_KEY || event.key === null) {
    externalChange = true;
    updateWarning();
  }
});
window.addEventListener(
  "scroll",
  () => {
    if (route().kind !== "unit" || Date.now() - scrollSaveAt < 2500) return;
    scrollSaveAt = Date.now();
    const article = $(".reader-article");
    if (!article) return;
    const progress = Math.max(
      0,
      Math.min(
        1,
        window.scrollY / Math.max(1, article.offsetHeight - window.innerHeight),
      ),
    );
    state = updateUnit(state, route().id, { readingProgress: progress });
    persist();
  },
  { passive: true },
);
setInterval(() => {
  if (!course) return;
  const now = Date.now(),
    before = state.focus.status;
  state = syncFocus(state, now);
  if (before === "running" && state.focus.status === "finished") {
    persist();
    toast("一段专注完成。起身休息一下，再写下刚才的收获。");
  }
  if (state.focus.status === "running" && Math.floor(now / 1000) % 15 === 0)
    persist();
  updateTimer();
}, 1000);

try {
  const loadedCourse = await courseSource.loadCourse();
  const loadedUnits = loadedCourse.modules.flatMap((mod) => mod.units);
  if (loadedCourse.textbookRevision !== TEXTBOOK_REVISION || loadedUnits.length !== UNIT_IDS.length || loadedUnits.some((unit, i) => unit.id !== UNIT_IDS[i]))
    throw Error("课程文件已更新，当前服务仍保存旧目录。请重新启动研习室，或使用更新后的学习地址。原记录可先导出备份，再在新地址导入。");
  course = loadedCourse;
  units = loadedUnits;
  unitIndex = new Map(units.map((u) => [u.id, u]));
  persist();
  await render();
} catch (error) {
  // Keep the original storage untouched when an old process serves a stale
  // course after an on-disk upgrade. Export remains available without a course.
  if (!course) recoveryMode = true;
  $("#app").innerHTML =
    `<div class="boot error-state"><span class="boot-mark">${icon("book")}</span><h1>学习空间暂时未能打开</h1><p>${escape(error.message)}</p><p>${courseSource.mode === "static" ? "请确认网络可用后刷新页面。学习记录仍保存在当前浏览器。" : "请确认本地服务仍在运行，再刷新页面。"}</p><button class="button primary" data-action="reload">重新打开</button><button class="button secondary" data-action="export">导出本机学习备份</button>${recoveryRaw ? '<button class="button secondary" data-action="export-raw">导出原始记录</button>' : ''}</div>`;
}
