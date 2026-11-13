// The web notebook is a local self-assessment. It never changes CLI evidence records.
export const STORAGE_KEY = "go-backend-study:v1";
export const TEXTBOOK_REVISION = 4;
// These IDs were retained for navigation, but their learning contracts changed.
export const REVISED_UNIT_IDS = Object.freeze([11,12,13,14,15,
  31,32,33,34,35,36,37,38,39,40,41,42,43,44,45,56,57,58,59,60,96,97,98,99,100]
  .map(number => `U${String(number).padStart(2, "0")}`));
export const UNIT_IDS = Object.freeze(
  Array.from({ length: 100 }, (_, i) => `U${String(i + 1).padStart(2, "0")}`),
);
export const CHECK_KEYS = Object.freeze([
  "theory",
  "design",
  "implementation",
  "verification",
  "defense",
]);
export const MAX_NOTES_LENGTH = 20_000;
export const MAX_BACKUP_LENGTH = 4 * 1024 * 1024;
const MAX_SESSIONS = 10_000;
const unitIds = new Set(UNIT_IDS);
const statuses = new Set(["not-started", "in-progress", "completed"]);
const focusStatuses = new Set(["idle", "running", "paused", "finished"]);

function fail(message) {
  throw new Error(message);
}
function object(value, keys, label, complete = true) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value))
  )
    fail(`${label}格式不正确`);
  if (
    Object.keys(value).some((key) => !keys.includes(key)) ||
    (complete && keys.some((key) => !Object.hasOwn(value, key)))
  )
    fail(`${label}包含未知字段或缺少字段`);
}
function integer(value, min, max, label) {
  if (!Number.isSafeInteger(value) || value < min || value > max)
    fail(`${label}超出允许范围`);
  return value;
}
function timestamp(value, label) {
  return integer(value, 0, 8_640_000_000_000_000, label);
}
function unitId(value) {
  if (!unitIds.has(value)) fail("单元编号必须是 U01–U100");
  return value;
}
function text(value, limit, label) {
  if (typeof value !== "string" || value.length > limit)
    fail(`${label}必须是最多${limit}字的文本`);
  return value;
}
function checked(checks) {
  return CHECK_KEYS.every((key) => checks[key] === true);
}
function ready(unit) {
  return checked(unit.checks) && unit.notes.trim().length >= 20;
}
function hasWork(unit) {
  return (
    unit.notes.trim() ||
    CHECK_KEYS.some((key) => unit.checks[key]) ||
    unit.readingProgress > 0 ||
    unit.lastSection
  );
}
function emptyUnit() {
  return {
    notes: "",
    checks: Object.fromEntries(CHECK_KEYS.map((key) => [key, false])),
    status: "not-started",
    bookmarks: false,
    lastSection: "",
    readingProgress: 0,
  };
}
function emptyFocus(unit = "U01", durationSeconds = 1500) {
  return {
    id: null,
    unitId: unit,
    durationSeconds,
    elapsedMs: 0,
    status: "idle",
    runningSince: null,
    deadline: null,
    startedAt: null,
  };
}

export function createState() {
  return {
    schemaVersion: 2,
    textbookRevision: TEXTBOOK_REVISION,
    currentUnit: "U01",
    settings: { theme: "light", fontSize: 18, weeklyHours: 20 },
    units: Object.fromEntries(UNIT_IDS.map((id) => [id, emptyUnit()])),
    sessions: [],
    focus: emptyFocus(),
    revisionHistory: [],
  };
}

function validateUnitRecord(unit, id) {
  object(unit, ["notes", "checks", "status", "bookmarks", "lastSection", "readingProgress"], `${id}记录`);
  text(unit.notes, MAX_NOTES_LENGTH, "笔记");
  object(unit.checks, CHECK_KEYS, `${id}清单`);
  if (CHECK_KEYS.some(key => typeof unit.checks[key] !== "boolean"))
    fail(`${id}清单必须是勾选值`);
  if (!statuses.has(unit.status) || typeof unit.bookmarks !== "boolean")
    fail(`${id}状态格式不正确`);
  text(unit.lastSection, 200, "阅读位置");
  if (!Number.isFinite(unit.readingProgress) || unit.readingProgress < 0 || unit.readingProgress > 1)
    fail(`${id}阅读位置超出范围`);
  if (unit.status === "completed" && !ready(unit))
    fail(`${id}尚未完成五项清单或缺少至少20字的复盘记录`);
  return {...unit, checks: Object.fromEntries(CHECK_KEYS.map(key => [key, unit.checks[key]]))};
}

/** Historical self-assessments remain available in backups, never as current credit. */
export function needsRevalidation(state, id) {
  return state.units[id]?.status !== "completed" &&
    state.revisionHistory.some(entry => Object.hasOwn(entry.units, id));
}

export function pendingRevalidation(state) {
  return REVISED_UNIT_IDS.filter(id => needsRevalidation(state, id));
}

/** Validate untrusted data before constructing a clean, independent state object. */
export function validateState(value) {
  const previous = value?.schemaVersion === 1;
  object(
    value,
    previous
      ? ["schemaVersion", "currentUnit", "settings", "units", "sessions", "focus", ...(Object.hasOwn(value, "textbookRevision") ? ["textbookRevision"] : [])]
      : ["schemaVersion", "textbookRevision", "currentUnit", "settings", "units", "sessions", "focus", "revisionHistory"],
    "学习记录",
  );
  if (![1, 2].includes(value.schemaVersion)) fail("不支持这个学习记录版本");
  // Published schema 1 notebooks had no revision field. Only that known legacy
  // format (or its explicit revision 3 equivalent) can enter this migration.
  if (previous ? value.textbookRevision !== undefined && value.textbookRevision !== 3
    : value.textbookRevision !== TEXTBOOK_REVISION)
    fail("不支持这个教材修订版本，请保留原始备份");
  unitId(value.currentUnit);
  object(value.settings, ["theme", "fontSize", "weeklyHours"], "偏好设置");
  if (!["light", "dark"].includes(value.settings.theme)) fail("主题格式不正确");
  integer(value.settings.fontSize, 16, 22, "字号");
  integer(value.settings.weeklyHours, 5, 40, "每周时间");
  // Accept only complete known 60/80-unit notebooks or the complete current
  // notebook. Partial records remain errors; an upgrade never invents old work.
  object(value.units, UNIT_IDS, "单元记录", false);
  const legacySize = [60, 80].find(size => Object.keys(value.units).length === size &&
    UNIT_IDS.slice(0, size).every(id => Object.hasOwn(value.units, id)));
  const originalIds = UNIT_IDS.slice(0, legacySize ?? UNIT_IDS.length);
  const legacy = legacySize !== undefined;
  if (!legacy) object(value.units, UNIT_IDS, "单元记录");
  if (legacy && (!originalIds.includes(value.currentUnit) ||
    !originalIds.includes(value.focus?.unitId) ||
    (Array.isArray(value.sessions) && value.sessions.some((s) => !originalIds.includes(s?.unitId)))))
    fail("旧学习记录引用了尚不存在的单元");
  const units = {};
  for (const id of UNIT_IDS) {
    const unit = legacy && !Object.hasOwn(value.units, id) ? emptyUnit() : value.units[id];
    units[id] = validateUnitRecord(unit, id);
  }
  if (!Array.isArray(value.sessions) || value.sessions.length > MAX_SESSIONS)
    fail("专注记录过多或格式不正确");
  const ids = new Set();
  const sessions = value.sessions.map((session) => {
    object(
      session,
      ["id", "unitId", "startedAt", "endedAt", "elapsedSeconds"],
      "专注记录",
    );
    if (
      typeof session.id !== "string" ||
      !/^[a-zA-Z0-9_-]{1,100}$/.test(session.id) ||
      ids.has(session.id)
    )
      fail("专注记录编号非法或重复");
    ids.add(session.id);
    unitId(session.unitId);
    timestamp(session.startedAt, "专注开始时间");
    if (
      session.endedAt !== null &&
      timestamp(session.endedAt, "专注结束时间") < session.startedAt
    )
      fail("专注结束不能早于开始");
    integer(session.elapsedSeconds, 0, 7200, "专注秒数");
    if (
      session.endedAt !== null &&
      session.elapsedSeconds * 1000 > session.endedAt - session.startedAt
    )
      fail("专注秒数不能超过实际时间区间");
    return {
      id: session.id,
      unitId: session.unitId,
      startedAt: session.startedAt,
      endedAt: session.endedAt,
      elapsedSeconds: session.elapsedSeconds,
    };
  });
  const focus = value.focus;
  object(
    focus,
    [
      "id",
      "unitId",
      "durationSeconds",
      "elapsedMs",
      "status",
      "runningSince",
      "deadline",
      "startedAt",
    ],
    "计时器",
  );
  unitId(focus.unitId);
  integer(focus.durationSeconds, 1, 7200, "专注时长");
  integer(focus.elapsedMs, 0, focus.durationSeconds * 1000, "已计时时长");
  if (!focusStatuses.has(focus.status)) fail("计时器状态不正确");
  for (const key of ["runningSince", "deadline", "startedAt"])
    if (focus[key] !== null) timestamp(focus[key], "计时器时间");
  if (focus.status === "idle") {
    if (
      focus.id !== null ||
      focus.startedAt !== null ||
      focus.runningSince !== null ||
      focus.deadline !== null ||
      focus.elapsedMs !== 0
    )
      fail("尚未开始的计时器记录不正确");
  } else {
    const session = sessions.find((item) => item.id === focus.id);
    if (
      !session ||
      session.unitId !== focus.unitId ||
      session.startedAt !== focus.startedAt ||
      session.elapsedSeconds !== Math.floor(focus.elapsedMs / 1000)
    )
      fail("计时器与专注记录不一致");
    if (focus.status === "running") {
      if (
        focus.runningSince === null ||
        focus.startedAt === null ||
        focus.deadline === null ||
        focus.runningSince < focus.startedAt ||
        focus.deadline - focus.runningSince !==
          focus.durationSeconds * 1000 - focus.elapsedMs ||
        session.endedAt !== null ||
        focus.elapsedMs === focus.durationSeconds * 1000
      )
        fail("运行中的计时器记录不正确");
      if (focus.elapsedMs > focus.runningSince - focus.startedAt)
        fail("计时器累计时长超过实际时间区间");
    } else {
      if (
        focus.runningSince !== null ||
        focus.deadline !== null ||
        session.endedAt === null
      )
        fail("暂停或结束的计时器记录不正确");
      if (focus.elapsedMs > session.endedAt - focus.startedAt)
        fail("计时器累计时长超过实际时间区间");
      if (
        focus.status === "finished" &&
        focus.elapsedMs !== focus.durationSeconds * 1000
      )
        fail("结束计时器的时长不正确");
    }
  }
  if (
    sessions.some(
      (session) => session.endedAt === null && session.id !== focus.id,
    )
  )
    fail("存在游离的未结束专注记录");
  const revisionHistory = [];
  if (previous) {
    const priorUnits = {};
    for (const id of REVISED_UNIT_IDS) {
      const old = units[id];
      if (!hasWork(old) && !old.bookmarks && old.status === "not-started") continue;
      priorUnits[id] = validateUnitRecord(old, id);
      units[id] = {...emptyUnit(), notes: old.notes, bookmarks: old.bookmarks,
        status: hasWork(old) || old.status !== "not-started" ? "in-progress" : "not-started"};
    }
    revisionHistory.push({fromRevision: 3, toRevision: TEXTBOOK_REVISION, units: priorUnits});
  } else {
    if (!Array.isArray(value.revisionHistory) || value.revisionHistory.length > 1)
      fail("教材修订历史格式不正确");
    for (const entry of value.revisionHistory) {
      object(entry, ["fromRevision", "toRevision", "units"], "教材修订历史");
      if (entry.fromRevision !== 3 || entry.toRevision !== TEXTBOOK_REVISION)
        fail("不支持这个教材修订历史版本");
      object(entry.units, REVISED_UNIT_IDS, "旧版单元记录", false);
      revisionHistory.push({fromRevision: 3, toRevision: TEXTBOOK_REVISION,
        units: Object.fromEntries(Object.entries(entry.units).map(([id, record]) => [id, validateUnitRecord(record, id)]))});
    }
  }
  return {
    schemaVersion: 2,
    textbookRevision: TEXTBOOK_REVISION,
    currentUnit: value.currentUnit,
    settings: { ...value.settings },
    units,
    sessions,
    focus: { ...focus },
    revisionHistory,
  };
}

export function parseBackup(json) {
  if (typeof json !== "string" || json.length > MAX_BACKUP_LENGTH)
    fail("备份过大，最多允许4MB文本");
  let value;
  try {
    value = JSON.parse(json);
  } catch {
    fail("备份不是有效的 JSON 文件");
  }
  return validateState(value);
}
export function exportBackup(state) {
  const json = JSON.stringify(validateState(state), null, 2);
  if (json.length > MAX_BACKUP_LENGTH)
    fail("学习记录过大，请先归档笔记或专注记录");
  return json + "\n";
}
export function loadState(storage, key = STORAGE_KEY) {
  try {
    const raw = storage.getItem(key);
    return {
      state: raw === null ? createState() : parseBackup(raw),
      error: null,
    };
  } catch (error) {
    return {
      state: createState(),
      error: `无法读取本机学习记录：${error.message}`,
    };
  }
}
export function saveState(storage, state, key = STORAGE_KEY) {
  try {
    storage.setItem(key, exportBackup(state));
    return { ok: true, error: null };
  } catch (error) {
    return {
      ok: false,
      error: `未能保存学习记录，请导出备份：${error.message}`,
    };
  }
}

export function updateUnit(state, id, patch) {
  const next = validateState(state);
  unitId(id);
  object(
    patch,
    [
      "notes",
      "checks",
      "status",
      "bookmarks",
      "lastSection",
      "readingProgress",
    ],
    "单元变更",
    false,
  );
  const unit = next.units[id];
  if (Object.hasOwn(patch, "checks")) {
    object(patch.checks, CHECK_KEYS, "清单变更", false);
    for (const key of CHECK_KEYS)
      if (Object.hasOwn(patch.checks, key)) {
        if (typeof patch.checks[key] !== "boolean") fail("清单必须是勾选值");
        unit.checks[key] = patch.checks[key];
      }
  }
  if (Object.hasOwn(patch, "notes"))
    text(patch.notes, MAX_NOTES_LENGTH, "笔记");
  if (Object.hasOwn(patch, "bookmarks") && typeof patch.bookmarks !== "boolean")
    fail("收藏状态必须是勾选值");
  if (Object.hasOwn(patch, "lastSection"))
    text(patch.lastSection, 200, "阅读位置");
  if (
    Object.hasOwn(patch, "readingProgress") &&
    (!Number.isFinite(patch.readingProgress) ||
      patch.readingProgress < 0 ||
      patch.readingProgress > 1)
  )
    fail("阅读位置超出范围");
  for (const key of ["notes", "bookmarks", "lastSection", "readingProgress"])
    if (Object.hasOwn(patch, key)) unit[key] = patch[key];
  if (Object.hasOwn(patch, "status"))
    unit.status = patch.status === false ? "in-progress" : patch.status;
  else if (unit.status === "not-started" && hasWork(unit))
    unit.status = "in-progress";
  if (unit.status === "completed" && !ready(unit)) {
    if (patch.status === "completed")
      fail("请先完成五项清单，并写下至少20字的复盘记录");
    unit.status = "in-progress";
  }
  return validateState(next);
}
export function completeUnit(state, id) {
  return updateUnit(state, id, { status: "completed" });
}
export function uncompleteUnit(state, id) {
  return updateUnit(state, id, { status: false });
}
export function setCurrentUnit(state, id) {
  const next = validateState(state);
  next.currentUnit = unitId(id);
  return next;
}
export function updateSettings(state, patch) {
  object(patch, ["theme", "fontSize", "weeklyHours"], "偏好变更", false);
  const next = validateState(state);
  next.settings = { ...next.settings, ...patch };
  return validateState(next);
}

function nowTime(now) {
  return timestamp(now, "当前时间");
}
function liveElapsed(focus, now) {
  if (focus.status !== "running") return focus.elapsedMs;
  return Math.min(
    focus.durationSeconds * 1000,
    focus.elapsedMs +
      Math.max(0, Math.min(now, focus.deadline) - focus.runningSince),
  );
}
export function focusSnapshot(state, now = Date.now()) {
  nowTime(now);
  const focus = state.focus,
    elapsedMs = liveElapsed(focus, now);
  return {
    status:
      focus.status === "running" && elapsedMs === focus.durationSeconds * 1000
        ? "finished"
        : focus.status,
    unitId: focus.unitId,
    durationSeconds: focus.durationSeconds,
    elapsedSeconds: Math.floor(elapsedMs / 1000),
    remainingSeconds: Math.ceil(
      (focus.durationSeconds * 1000 - elapsedMs) / 1000,
    ),
    progress: elapsedMs / (focus.durationSeconds * 1000),
  };
}

/** Reconcile against the stored deadline; refreshing never adds time past the deadline. */
export function syncFocus(state, now = Date.now()) {
  nowTime(now);
  const next = validateState(state),
    focus = next.focus;
  if (focus.status !== "running") return next;
  focus.elapsedMs = liveElapsed(focus, now);
  const session = next.sessions.find((item) => item.id === focus.id);
  session.elapsedSeconds = Math.floor(focus.elapsedMs / 1000);
  if (focus.elapsedMs === focus.durationSeconds * 1000) {
    session.endedAt = focus.deadline;
    focus.status = "finished";
    focus.runningSince = null;
    focus.deadline = null;
  } else focus.runningSince = Math.max(now, focus.runningSince);
  return next;
}
export function startFocus(
  state,
  id = state.currentUnit,
  now = Date.now(),
  durationSeconds = 1500,
) {
  unitId(id);
  nowTime(now);
  integer(durationSeconds, 1, 7200, "专注时长");
  let next = syncFocus(state, now),
    focus = next.focus;
  if (focus.status === "running" && focus.unitId === id) return next;
  if (focus.status === "paused" && focus.unitId === id) {
    const session = next.sessions.find((item) => item.id === focus.id);
    focus.runningSince = Math.max(now, session.endedAt);
    focus.deadline =
      focus.runningSince + focus.durationSeconds * 1000 - focus.elapsedMs;
    focus.status = "running";
    session.endedAt = null;
    return validateState(next);
  }
  if (focus.status === "running" || focus.status === "paused")
    next = resetFocus(next, now);
  if (next.sessions.length >= MAX_SESSIONS)
    fail("专注记录已达上限，请先导出并归档记录");
  const previous = next.sessions.at(-1);
  if (previous) now = Math.max(now, previous.endedAt ?? previous.startedAt);
  const sessionId = `focus-${now}-${next.sessions.length + 1}`;
  next.focus = {
    id: sessionId,
    unitId: id,
    durationSeconds,
    elapsedMs: 0,
    status: "running",
    runningSince: now,
    deadline: now + durationSeconds * 1000,
    startedAt: now,
  };
  next.sessions.push({
    id: sessionId,
    unitId: id,
    startedAt: now,
    endedAt: null,
    elapsedSeconds: 0,
  });
  return validateState(next);
}
export function pauseFocus(state, now = Date.now()) {
  const next = syncFocus(state, now),
    focus = next.focus;
  if (focus.status === "running") {
    const session = next.sessions.find((item) => item.id === focus.id);
    session.endedAt = Math.max(now, focus.runningSince);
    focus.status = "paused";
    focus.runningSince = null;
    focus.deadline = null;
  }
  return validateState(next);
}
export function resetFocus(state, now = Date.now()) {
  const next = pauseFocus(state, now);
  next.focus = emptyFocus(next.currentUnit, next.focus.durationSeconds);
  return validateState(next);
}
export function getStats(state, now = Date.now()) {
  const completedUnits = UNIT_IDS.filter(
    (id) => state.units[id].status === "completed",
  ).length;
  const snapshot = focusSnapshot(state, now);
  const active = state.sessions.find((item) => item.id === state.focus.id);
  const delta = active
    ? Math.max(0, snapshot.elapsedSeconds - active.elapsedSeconds)
    : 0;
  return {
    completedUnits,
    totalUnits: UNIT_IDS.length,
    completedHours: completedUnits * 10,
    totalHours: UNIT_IDS.length * 10,
    progress: completedUnits / UNIT_IDS.length,
    focusSeconds:
      state.sessions.reduce((sum, item) => sum + item.elapsedSeconds, 0) +
      delta,
    sessionCount: state.sessions.filter(
      (item) =>
        item.elapsedSeconds > 0 ||
        (item.id === active?.id && snapshot.elapsedSeconds > 0),
    ).length,
    bookmarkedUnits: UNIT_IDS.filter((id) => state.units[id].bookmarks),
    nextUnit:
      UNIT_IDS.find((id) => state.units[id].status !== "completed") ?? null,
  };
}
