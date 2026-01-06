(() => {
  "use strict";

  const STORAGE_KEY = "tradeRecords_v1";

  /** ---------------------------
   *  DOM helpers
   *  --------------------------*/
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));

  /** ---------------------------
   *  UX helpers
   *  --------------------------*/
  function scrollToTopAndFocus(target, opts = {}) {
    const el = (typeof target === "string") ? $(target) : target;
    const behavior = opts.behavior || "smooth";
    // Scroll to very top of the page (tabs are sticky, so this feels natural)
    try { window.scrollTo({ top: 0, behavior }); } catch (_) { window.scrollTo(0, 0); }

    // Focus after scroll kicks in (iOS/Safari can ignore immediate focus changes)
    setTimeout(() => {
      if (!el) return;
      try { el.focus({ preventScroll: true }); } catch (_) { try { el.focus(); } catch (_) {} }
      // Some browsers support opening the picker for date/time inputs
      try { if (typeof el.showPicker === "function") el.showPicker(); } catch (_) {}
    }, opts.delayMs ?? 60);
  
  // Scroll to top without focusing any input (avoids opening date/time pickers on mobile)
  function scrollToTopOnly(opts = {}) {
    const behavior = opts.behavior || "smooth";
    try { window.scrollTo({ top: 0, left: 0, behavior }); } catch (_) { window.scrollTo(0, 0); }
    // Some browsers keep scroll position on <html> / <body> separately; enforce as a fallback
    try { document.documentElement.scrollTop = 0; } catch (_) {}
    try { document.body.scrollTop = 0; } catch (_) {}
  }
}



  /** ---------------------------
   *  Master settings (global judge parameters)
   *  --------------------------*/
  const MASTER_SETTINGS_KEY = "tradeRecordMasterSettings_v1";

  const MASTER_DEFAULTS = Object.freeze({
    minSimilarity: 0.55,     // MIN_SIM
    maxNeighbors: 60,        // MAX_NEIGHBORS
    similarityAlpha: 3,      // alpha (similarity^alpha)
    minCases: 30,            // MIN_CASES（最低限の統計要件。少なすぎる判定は“幻”）
    minEss: 10,              // MIN_ESS（有効サンプルサイズ。偏った近傍を過信しない）
    minComparableFeatures: 6,// 最低比較特徴数（これ未満は類似度を自動減衰）
    evMinR: 0.0,              // EV_MIN_R (R倍)
    evGapR: 0.05,             // EV_GAP_R (R倍)
    setupPriorEnabled: true,   // セットアップPrior混合
    setupPriorN0: 30,          // Prior混合の基準N0（w=N0/(N0+N_setup))
    rrGateEnabled: true,     // RR gate strict（RRが下限未満なら原則ノーポジ）
    rrMin: 1.0,              // RR_MIN
    rrAllowMissing: false,  // TP/SL未入力（RR不明）をゲート対象外にする（既定OFF）
    dataTradeTypes: ["real", "virtual", "practice"],
    dataCompletionStatuses: ["完全完成", "未入力あり完成"]});


  const MASTER_TRADE_TYPES = Object.freeze(["real", "virtual", "practice"]);
  const MASTER_COMPLETION_STATUSES = Object.freeze(["未完成", "完全完成", "未入力あり完成"]);

  function normalizeMasterTradeTypes(v) {
    const arr = Array.isArray(v) ? v.map((x) => String(x)).filter(Boolean) : [];
    const out = arr.filter((x) => MASTER_TRADE_TYPES.includes(x));
    return out.length ? out : [...MASTER_TRADE_TYPES];
  }

  function normalizeMasterCompletionStatuses(v) {
    const arr = Array.isArray(v) ? v.map((x) => String(x)).filter(Boolean) : [];
    const out = arr.filter((x) => MASTER_COMPLETION_STATUSES.includes(x));
    return out.length ? out : ["完全完成"]; // safe default
  }

  function normalizeCompletionStatusForJudge(v) {
    const s = String(v || "").trim();
    if (MASTER_COMPLETION_STATUSES.includes(s)) return s;
    // 旧データや未登録は「未入力あり完成」扱い（デフォルトでは除外される）
    return "未入力あり完成";
  }

  let _masterCache = null;

  function loadMasterSettings() {
    try {
      const raw = localStorage.getItem(MASTER_SETTINGS_KEY);
      if (!raw) return { ...MASTER_DEFAULTS };
      const obj = JSON.parse(raw) || {};

      // --- Migration / sanitize ---
      // Old versions used EV in yen (evMin/evGap). Current version uses R-multiple (evMinR/evGapR).
      // We intentionally DO NOT map yen -> R (not convertible); keep defaults unless user has set evMinR/evGapR.
      if ("evMin" in obj) delete obj.evMin;
      if ("evGap" in obj) delete obj.evGap;

      // RR missing bypass is dangerous for your stated operation. Force OFF.
      obj.rrAllowMissing = false;

      // Coerce numbers if present
      if (typeof obj.evMinR !== "number" || !Number.isFinite(obj.evMinR)) delete obj.evMinR;
      if (typeof obj.evGapR !== "number" || !Number.isFinite(obj.evGapR)) delete obj.evGapR;
      if (typeof obj.setupPriorN0 !== "number" || !Number.isFinite(obj.setupPriorN0)) delete obj.setupPriorN0;

      return {
        ...MASTER_DEFAULTS,
        ...obj
      };
    } catch {
      return { ...MASTER_DEFAULTS };
    }
  }

  function saveMasterSettings(next) {
    const merged = { ...MASTER_DEFAULTS, ...(next || {}) };
    merged.dataTradeTypes = normalizeMasterTradeTypes(merged.dataTradeTypes);
    merged.dataCompletionStatuses = normalizeMasterCompletionStatuses(merged.dataCompletionStatuses);
    localStorage.setItem(MASTER_SETTINGS_KEY, JSON.stringify(merged));
    _masterCache = merged;
    return merged;
  }

  function getMasterSettings() {
    if (_masterCache) return _masterCache;
    _masterCache = loadMasterSettings();
    _masterCache.dataTradeTypes = normalizeMasterTradeTypes(_masterCache.dataTradeTypes);
    _masterCache.dataCompletionStatuses = normalizeMasterCompletionStatuses(_masterCache.dataCompletionStatuses);
    return _masterCache;
  }

  function setMasterMsg(text) {
    const el = $("#master-msg");
    if (!el) return;
    el.textContent = text || "";
    el.hidden = !text;
  }

  function initMasterTab() {
    const elMinSim = $("#master-minSim");
    const elMaxN = $("#master-maxNeighbors");
    const elAlpha = $("#master-alpha");
    const elMinCases = $("#master-minCases");
    const elMinEss = $("#master-minEss");
    const elMinComparable = $("#master-minComparable");
    const elEvMin = $("#master-evMinR");
    const elEvGap = $("#master-evGapR");
    const elRrMin = $("#master-rrMin");
    const elRrGate = $("#master-rrGate");
    const elRrAllowMissing = $("#master-rrAllowMissing");
    const elSetupPriorEnabled = $("#master-setupPriorEnabled");
    const elSetupPriorN0 = $("#master-setupPriorN0");

    const elUseReal = $("#master-use-real");
    const elUseVirtual = $("#master-use-virtual");
    const elUsePractice = $("#master-use-practice");

    const elStIncomplete = $("#master-use-status-incomplete");
    const elStComplete = $("#master-use-status-complete");
    const elStPartial = $("#master-use-status-partial");

    if (!elMinSim) return; // Master tab not present

    const s = getMasterSettings();
    elMinSim.value = String(s.minSimilarity ?? MASTER_DEFAULTS.minSimilarity);
    elMaxN.value = String(s.maxNeighbors ?? MASTER_DEFAULTS.maxNeighbors);
    elAlpha.value = String(s.similarityAlpha ?? MASTER_DEFAULTS.similarityAlpha);
    elMinCases.value = String(s.minCases ?? MASTER_DEFAULTS.minCases);
    elMinEss.value = String(s.minEss ?? MASTER_DEFAULTS.minEss);
    if (elMinComparable) elMinComparable.value = String(s.minComparableFeatures ?? MASTER_DEFAULTS.minComparableFeatures);
    elEvMin.value = String(s.evMinR ?? MASTER_DEFAULTS.evMinR);
    elEvGap.value = String(s.evGapR ?? MASTER_DEFAULTS.evGapR);
    elRrMin.value = String(s.rrMin ?? MASTER_DEFAULTS.rrMin);
    elRrGate.checked = !!s.rrGateEnabled;
    elRrAllowMissing.checked = false;
    elRrAllowMissing.disabled = true;

    if (elSetupPriorEnabled) elSetupPriorEnabled.checked = !!(s.setupPriorEnabled ?? MASTER_DEFAULTS.setupPriorEnabled);
    if (elSetupPriorN0) elSetupPriorN0.value = String(s.setupPriorN0 ?? MASTER_DEFAULTS.setupPriorN0);

    // 判定に使用するデータ（Masterフィルタ）
    const types = normalizeMasterTradeTypes(s.dataTradeTypes);
    if (elUseReal) elUseReal.checked = types.includes("real");
    if (elUseVirtual) elUseVirtual.checked = types.includes("virtual");
    if (elUsePractice) elUsePractice.checked = types.includes("practice");

    const statuses = normalizeMasterCompletionStatuses(s.dataCompletionStatuses);
    if (elStIncomplete) elStIncomplete.checked = statuses.includes("未完成");
    if (elStComplete) elStComplete.checked = statuses.includes("完全完成");
    if (elStPartial) elStPartial.checked = statuses.includes("未入力あり完成");

    setMasterMsg("現在値を読み込みました。");

    $("#btn-master-save")?.addEventListener("click", () => {
      const dataTradeTypes = [];
      if (elUseReal?.checked) dataTradeTypes.push("real");
      if (elUseVirtual?.checked) dataTradeTypes.push("virtual");
      if (elUsePractice?.checked) dataTradeTypes.push("practice");

      const dataCompletionStatuses = [];
      if (elStIncomplete?.checked) dataCompletionStatuses.push("未完成");
      if (elStComplete?.checked) dataCompletionStatuses.push("完全完成");
      if (elStPartial?.checked) dataCompletionStatuses.push("未入力あり完成");

      if (!dataTradeTypes.length) {
        alert("判定に使用する取引種別が未選択です。少なくとも1つチェックしてください。");
        return;
      }
      if (!dataCompletionStatuses.length) {
        alert("判定に使用する完成度が未選択です。少なくとも1つチェックしてください。");
        return;
      }

      const next = {
        minSimilarity: safeNum(elMinSim.value),
        maxNeighbors: Math.max(10, Math.min(500, Math.trunc(Number(elMaxN.value) || MASTER_DEFAULTS.maxNeighbors))),
        similarityAlpha: Math.max(1, Math.min(10, Number(elAlpha.value) || MASTER_DEFAULTS.similarityAlpha)),
        minCases: Math.max(1, Math.trunc(Number(elMinCases.value) || MASTER_DEFAULTS.minCases)),
        minEss: Math.max(0.1, Number(elMinEss.value) || MASTER_DEFAULTS.minEss),
        minComparableFeatures: Math.max(1, Math.trunc(Number(elMinComparable?.value) || MASTER_DEFAULTS.minComparableFeatures)),
        evMinR: Number(elEvMin.value) || 0,
        evGapR: Math.max(0, Number(elEvGap.value) || 0),
        setupPriorEnabled: !!elSetupPriorEnabled?.checked,
        setupPriorN0: Math.max(1, Math.trunc(Number(elSetupPriorN0?.value) || MASTER_DEFAULTS.setupPriorN0)),
        rrMin: Math.max(0, Number(elRrMin.value) || MASTER_DEFAULTS.rrMin),
        rrGateEnabled: !!elRrGate.checked,
        rrAllowMissing: !!elRrAllowMissing.checked,
        dataTradeTypes,
        dataCompletionStatuses
      };

      // sanitize minSimilarity
      if (!Number.isFinite(next.minSimilarity)) next.minSimilarity = MASTER_DEFAULTS.minSimilarity;
      next.minSimilarity = Math.max(0, Math.min(1, next.minSimilarity));

      saveMasterSettings(next);
      setMasterMsg("保存しました。");
      // If stats tab is visible, refresh it (some charts depend on judge outputs)
      safeRenderStats();
    });

    $("#btn-master-reset")?.addEventListener("click", () => {
      saveMasterSettings({ ...MASTER_DEFAULTS });
      const d = getMasterSettings();
      elMinSim.value = String(d.minSimilarity);
      elMaxN.value = String(d.maxNeighbors);
      elAlpha.value = String(d.similarityAlpha);
      elMinCases.value = String(d.minCases);
      elMinEss.value = String(d.minEss);
      if (elMinComparable) elMinComparable.value = String(d.minComparableFeatures ?? MASTER_DEFAULTS.minComparableFeatures);
      elEvMin.value = String(d.evMinR);
      elEvGap.value = String(d.evGapR);
      if (elSetupPriorEnabled) elSetupPriorEnabled.checked = !!d.setupPriorEnabled;
      if (elSetupPriorN0) elSetupPriorN0.value = String(d.setupPriorN0);
      elRrMin.value = String(d.rrMin);
      elRrGate.checked = !!d.rrGateEnabled;
      elRrAllowMissing.checked = !!d.rrAllowMissing;
      elRrAllowMissing.disabled = false;

      const t = normalizeMasterTradeTypes(d.dataTradeTypes);
      if (elUseReal) elUseReal.checked = t.includes("real");
      if (elUseVirtual) elUseVirtual.checked = t.includes("virtual");
      if (elUsePractice) elUsePractice.checked = t.includes("practice");

      const st = normalizeMasterCompletionStatuses(d.dataCompletionStatuses);
      if (elStIncomplete) elStIncomplete.checked = st.includes("未完成");
      if (elStComplete) elStComplete.checked = st.includes("完全完成");
      if (elStPartial) elStPartial.checked = st.includes("未入力あり完成");
      setMasterMsg("初期化しました。");
      safeRenderStats();
    });
  }
  const elEntryError = $("#entry-error");
  const elExitError = $("#exit-error");
  const elJudgeOutput = $("#judge-output");
  const elExitSelect = $("#exit-select");
  const elExitOnlyOpen = $("#exit-only-open");
  const elExitDetailsMain = $("#exit-details-main");
  const elExitDetailsSide = $("#exit-details-side");
  const elExitProfitWide = $("#exit-profit-wide");
  const elStatsSummary = $("#stats-summary");
  const elStatsTable = $("#stats-table");
  const elToast = $("#toast");

  /** ---------------------------
   *  State
   *  --------------------------*/
  let records = [];
  let editingEntryId = null; // when editing entry in-place
  let selectedExitId = null; // current exit target (selected in list)
  // Exitタブの「編集中」は、hasResult(決済済み)とは別に管理する。
  // 既存の結果を編集するために選択したときだけ true（保存後は解除）。
  let editingExitId = null;

  // Charts
  let chartCumulative = null;
  let chartDirection = null;
  let chartTimeframe = null;

  // Toast
  let toastTimer = null;

  /** ---------------------------
   *  Utilities
   *  --------------------------*/
  function nowISO() {
    return new Date().toISOString();
  }

  function uuid() {
    try {
      if (crypto && crypto.randomUUID) return crypto.randomUUID();
    } catch (_) {}
    // Fallback
    return "id-" + Math.random().toString(16).slice(2) + "-" + Date.now().toString(16);
  }

  function safeNum(v) {
    if (v === "" || v === null || v === undefined) return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }

  function toJpDir(dir) {
    if (dir === "long") return "ロング";
    if (dir === "short") return "ショート";
    if (dir === "flat") return "ノーポジ";
    return "—";
  }


  function computeRR(direction, entryPrice, tpPrice, lsPrice) {
    // Long: (TP-Entry)/(Entry-LS)
    // Short: (Entry-TP)/(LS-Entry)
    const e = Number(entryPrice);
    const tp = Number(tpPrice);
    const ls = Number(lsPrice);
    if (![e, tp, ls].every((x) => Number.isFinite(x))) return null;

    const dir = String(direction);
    if (dir !== "long" && dir !== "short") return null;

    if (dir === "short") {
      const risk = (ls - e);
      const reward = (e - tp);
      if (risk <= 0 || reward <= 0) return null;
      return reward / risk;
    }
    const risk = (e - ls);
    const reward = (tp - e);
    if (risk <= 0 || reward <= 0) return null;
    return reward / risk;
  }

  function formatRR(v) {
    if (typeof v !== "number" || !Number.isFinite(v)) return "—";
    return (Math.round(v * 100) / 100).toFixed(2);
  }

  // "その他" values (TP/LS have coded values; exit-reason uses Japanese)
  const OTHER_TP_VALUE = "TP_Others";
  const OTHER_LS_VALUE = "LS_Others";

  function isTpOther(v) {
    const s = String(v || "");
    return s === OTHER_TP_VALUE || s === "その他";
  }
  function isLsOther(v) {
    const s = String(v || "");
    return s === OTHER_LS_VALUE || s === "その他";
  }

  function toggleOtherWrap(selectEl, wrapEl, otherInputEl, otherValues = ["その他"]) {
    if (!selectEl || !wrapEl || !otherInputEl) return;
    const values = Array.isArray(otherValues) ? otherValues : [otherValues];
    const isOther = values.includes(selectEl.value);
    wrapEl.hidden = !isOther;
    if (!isOther) otherInputEl.value = "";
  }

  function updateEntryRRPreview() {
    const rrEl = $("#entry-rr");
    if (!rrEl) return;
    const dir = $("#entry-direction")?.value || "";
    const e = safeNum($("#entry-price")?.value);
    const tp = safeNum($("#entry-LimitPrice")?.value);
    const ls = safeNum($("#entry-LossPrice")?.value);
    const rr = computeRR(dir, e, tp, ls);
    rrEl.value = (rr === null) ? "" : (Math.round(rr * 100) / 100).toFixed(2);
  }

  function symbolMultiplier(symbol) {
    // user confirmed: mini=100, large=1000. micro=10.
    if (symbol === "nk225mc") return 10;
    if (symbol === "nk225m") return 100;
    if (symbol === "nk225") return 1000;
    return 1;
  }

  function clearMsg() {
    if (elEntryError) elEntryError.textContent = "";
    if (elExitError) elExitError.textContent = "";
  }

  function showError(target, msg) {
    if (!target) return;
    target.textContent = msg;
  }

  function showToast(msg, type = "success", durationMs = 1400) {
    // Fallback: if toast element is missing, at least show alert
    if (!elToast) {
      window.alert(String(msg || ""));
      return;
    }

    const text = String(msg || "");
    elToast.textContent = text;

    // reset
    elToast.classList.remove("show", "success", "error");
    elToast.classList.add(type);
    elToast.hidden = false;

    // restart animation
    requestAnimationFrame(() => {
      elToast.classList.add("show");
    });

    if (toastTimer) window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => {
      elToast.classList.remove("show");
      window.setTimeout(() => {
        elToast.hidden = true;
      }, 220);
    }, durationMs);
  }

  function clamp(n, min, max) {
    return Math.max(min, Math.min(max, n));
  }

  /** ---------------------------
   *  Image helpers (dataURL)
   *  --------------------------*/
  function estimateDataUrlBytes(dataUrl) {
    if (!dataUrl) return 0;
    const s = String(dataUrl);
    const comma = s.indexOf(",");
    const b64 = comma >= 0 ? s.slice(comma + 1) : s;
    return Math.floor((b64.length * 3) / 4);
  }

  function isoDateLocal(date) {
  // yyyy-mm-dd（date input用）
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function parseISODateOnly(value) {
  // datetime-local / ISO文字列 / "YYYY-MM-DD ..." から YYYY-MM-DD を抜き出す
  if (!value) return "";
  const s = String(value);
  const m = s.match(/\d{4}-\d{2}-\d{2}/);
  return m ? m[0] : "";
}


function weekdayJpFromDateString(dateStr) {
  // dateStr: "YYYY-MM-DD"
  if (!dateStr) return "";
  const m = String(dateStr).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return "";
  const y = Number(m[1]);
  const mo = Number(m[2]) - 1;
  const d = Number(m[3]);
  const dt = new Date(y, mo, d);
  if (!Number.isFinite(dt.getTime())) return "";
  const jp = ["日曜日", "月曜日", "火曜日", "水曜日", "木曜日", "金曜日", "土曜日"];
  return jp[dt.getDay()] || "";
}

function weekdayFromDatetimeLocal(value) {
  // datetime-local: "YYYY-MM-DDTHH:MM" など
  const dateStr = parseISODateOnly(value);
  return weekdayJpFromDateString(dateStr);
}

function syncEntryWeekdayFromDatetime() {
  const el = $("#entry-weekday");
  if (!el) return;
  const dt = $("#entry-datetime")?.value || "";
  el.value = weekdayFromDatetimeLocal(dt) || "";
}

function syncExitWeekdayFromDatetime() {
  const el = $("#exit-weekday");
  if (!el) return;
  const dt = $("#exit-datetime")?.value || "";
  el.value = weekdayFromDatetimeLocal(dt) || "";
}

function detectDeviceLabel() {
  // PC/モバイルのざっくり判定（確実な判別はできないので、複数シグナルで推定）
  try {
    if (navigator.userAgentData && typeof navigator.userAgentData.mobile === "boolean") {
      if (navigator.userAgentData.mobile) return "モバイル";
    }
  } catch (_) {}

  const ua = (navigator.userAgent || "").toLowerCase();
  const uaMobile = /iphone|ipod|ipad|android|mobile|windows phone/.test(ua);
  const coarse = !!(window.matchMedia && window.matchMedia("(pointer: coarse)").matches);
  const small = !!(window.matchMedia && window.matchMedia("(max-width: 768px)").matches);

  if (uaMobile || (coarse && small)) return "モバイル";
  return "PC";
}

function setEntryDeviceAuto(opts = {}) {
  const { force = false } = opts || {};
  const el = $("#entry-device");
  if (!el) return;
  // 編集中のレコードは基本的に上書きしない（force=trueの場合のみ）
  if (!force && editingEntryId) return;
  if (!force && String(el.value || "").trim()) return;
  el.value = detectDeviceLabel();
}


function setDefaultStatsRangeLast7Days() {
  // デフォルト：今日-7日〜今日（Statsの開始日/終了日）
  const end = new Date();
  const start = new Date();
  start.setDate(end.getDate() - 7);

  const elStart = document.getElementById("filter-start");
  const elEnd = document.getElementById("filter-end");

  // 既にユーザーが入力している場合は上書きしない
  if (elStart && !elStart.value) elStart.value = isoDateLocal(start);
  if (elEnd && !elEnd.value) elEnd.value = isoDateLocal(end);
}

  /** ---------------------------
   *  Storage
   *  --------------------------*/
  function loadRecords() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return parsed.map(migrateRecord);
    } catch (e) {
      console.warn("Failed to load records:", e);
      return [];
    }
  }


  // Weekday mapping: Entry UI shows Japanese, Stats filter uses English values.
  const WEEKDAY_KEY_BY_JP = {
    "日曜日": "Sunday",
    "月曜日": "Monday",
    "火曜日": "Tuesday",
    "水曜日": "Wednesday",
    "木曜日": "Thursday",
    "金曜日": "Friday",
    "土曜日": "Saturday"
  };
  const WEEKDAY_JP_BY_KEY = Object.fromEntries(Object.entries(WEEKDAY_KEY_BY_JP).map(([jp, en]) => [en, jp]));

  function normalizeWeekdayKey(v) {
    const s = String(v || "").trim();
    if (!s) return "";
    if (WEEKDAY_KEY_BY_JP[s]) return WEEKDAY_KEY_BY_JP[s]; // JP -> EN
    if (WEEKDAY_JP_BY_KEY[s]) return s; // already EN key
    return s;
  }

  function weekdayJpFromKey(v) {
    const key = normalizeWeekdayKey(v);
    return WEEKDAY_JP_BY_KEY[key] || "";
  }

  // Timeframe normalization: stored value should be the <option value> (e.g., "1h"), not the display text (e.g., "1時間").
  const TIMEFRAME_ALIAS = {
    "1分": "1m", "1分足": "1m", "1m": "1m",
    "5分": "5m", "5分足": "5m", "5m": "5m",
    "15分": "15m", "15分足": "15m", "15m": "15m",
    "30分": "30m", "30分足": "30m", "30m": "30m",
    "1時間": "1h", "1時間足": "1h", "1h": "1h",
    "4時間": "4h", "4時間足": "4h", "4h": "4h",
    "日足": "1d", "日": "1d", "1日": "1d", "1d": "1d"
  };

  function normalizeTimeframe(tf) {
    const s = String(tf || "").trim();
    if (!s) return "";
    if (TIMEFRAME_ALIAS[s]) return TIMEFRAME_ALIAS[s];
    if (/^\d+[mhd]$/.test(s)) return s;
    return s;
  }

  function selectOptionText(selectId, value) {
    const v = String(value ?? "");
    if (!v) return "";
    const el = document.getElementById(selectId);
    if (!el || !el.options) return "";
    const opt = Array.from(el.options).find((o) => o.value === v);
    return opt ? opt.textContent : "";
  }

  function displayTimeframe(tf) {
    const key = normalizeTimeframe(tf);
    return (
      selectOptionText("entry-timeframe", key) ||
      selectOptionText("filter-timeframe", key) ||
      String(tf || "") ||
      "—"
    );
  }

  function normalizeTpLsType(v, kind) {
    const s = String(v || "").trim();
    if (!s) return "";
    const k = String(kind || "").toUpperCase();
    if (s.startsWith(k + "_")) return s;
    if (s === "その他") return (k === "TP" ? OTHER_TP_VALUE : OTHER_LS_VALUE);

    const map = {
      "HBOP": `${k}_HBOP`,
      "R2": `${k}_R2`,
      "R1": `${k}_R1`,
      "pivot": `${k}_Pivot`,
      "S1": `${k}_S1`,
      "S2": `${k}_S2`,
      "LBOP": `${k}_LBOP`,
      "直近高値": `${k}_RecentHigh`,
      "直近安値": `${k}_RecentLow`,
      "0.5ATR": `${k}_0p5ATR`,
      "0.25ATR": `${k}_0p25ATR`,
      "設定なし": `${k}_None`
    };
    return map[s] || s;
  }

  function displayTpType(tpType, otherText) {
    const key = normalizeTpLsType(tpType, "TP");
    if (isTpOther(key)) return String(otherText || "その他");
    return selectOptionText("entry-tpType", key) || String(tpType || "") || "—";
  }

  function displayLsType(lsType, otherText) {
    const key = normalizeTpLsType(lsType, "LS");
    if (isLsOther(key)) return String(otherText || "その他");
    return selectOptionText("entry-lsType", key) || String(lsType || "") || "—";
  }

  function displaySymbol(symbol) {
    return (
      selectOptionText("entry-symbol", symbol) ||
      selectOptionText("filter-symbol", symbol) ||
      String(symbol || "") ||
      "—"
    );
  }

  function displayEntrySession(session) {
    return selectOptionText("entry-session", session) || String(session || "") || "—";
  }

  function saveRecords() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(records));
    } catch (e) {
      console.warn("Failed to save to localStorage (possibly quota exceeded)", e);
      showToast(
        "保存に失敗しました（容量オーバーの可能性）。画像を削除するか、画像サイズを小さくしてから再度保存してください。",
        "error",
        2600
      );
      throw e;
    }
  }

  function migrateRecord(r) {
    // Ensure required keys exist (backward compatible)
    const out = { ...r };

    out.id = String(out.id || uuid());
    out.createdAt = out.createdAt || nowISO();
    out.updatedAt = out.updatedAt || out.createdAt;

    // Entry
    out.datetimeEntry = out.datetimeEntry ?? null;
    out.symbol = out.symbol || "nk225mc";
    out.timeframe = normalizeTimeframe(out.timeframe || "1h");
    out.tradeType = out.tradeType || "real";
    out.directionPlanned = out.directionPlanned || "long";
    
    // Entry extras
    out.entryWeekday = out.entryWeekday || weekdayFromDatetimeLocal(out.datetimeEntry) || "";
    // if stored as English key, convert to Japanese for display
    if (WEEKDAY_JP_BY_KEY[out.entryWeekday]) out.entryWeekday = WEEKDAY_JP_BY_KEY[out.entryWeekday];
    out.entryWeekdayKey = normalizeWeekdayKey(out.entryWeekdayKey || out.entryWeekday || "");
    out.entrySession = out.entrySession || "";
    out.tradeMethod = out.tradeMethod || "";
    out.entryDevice = out.entryDevice || "";
out.entryPrice = out.entryPrice ?? null;
    out.size = out.size ?? null;
    out.feePerUnit = out.feePerUnit ?? null;
    out.plannedLimitPrice = out.plannedLimitPrice ?? null;
    out.cutLossPrice = out.cutLossPrice ?? null;
    out.tpType = normalizeTpLsType(out.tpType || "", "TP");
    out.tpTypeOther = out.tpTypeOther || "";
    out.lsType = normalizeTpLsType(out.lsType || "", "LS");
    out.lsTypeOther = out.lsTypeOther || "";
    out.rr = out.rr ?? null;

    // Indicators
    out.waveCount = out.waveCount ?? "";
    out.dowShape  = out.dowShape  ?? "";
    out.trend_5_20_40 = out.trend_5_20_40 ?? "";
    out.price_vs_ema200 = out.price_vs_ema200 ?? "";
    out.ema_band_color = out.ema_band_color ?? "";
    out.zone = out.zone ?? "";
    out.cmf_sign = out.cmf_sign ?? "";
    out.cmf_sma_dir = out.cmf_sma_dir ?? "";
    out.macd_state = out.macd_state ?? "";
    out.roc_sign = out.roc_sign ?? "";
    out.roc_sma_dir = out.roc_sma_dir ?? "";
    out.rsi_zone = out.rsi_zone ?? "";
    out.decisiveIndicator = out.decisiveIndicator ?? "";
    out.decisiveSignal = out.decisiveSignal ?? "";
    out.decisiveSignalText = out.decisiveSignalText ?? "";

    // Judge thresholds
    out.minWinRate = out.minWinRate ?? 30;

    // Memo
    out.marketMemo = out.marketMemo || "";
    out.notionUrl = out.notionUrl || "";
    // Images (optional). CSVには出力しないが、JSON/localStorage には保持する。
    // 旧データ互換：imageData があれば entryImageData に引き継ぐ。
    out.entryImageData = out.entryImageData ?? out.imageData ?? null;
    out.exitImageData = out.exitImageData ?? null;
    // legacy (unused)
    out.imageData = out.imageData ?? null;

    // Judge result
    out.recommendation = out.recommendation ?? null;
    out.expectedMove = out.expectedMove ?? null;
    out.expectedMoveUnit = out.expectedMoveUnit || "pt";
    if (out.expectedMoveUnit === "円") out.expectedMoveUnit = "pt"; // legacy bug fix
    out.ess = out.ess ?? null;
    out.essChosen = out.essChosen ?? null;
    out.confidence = out.confidence ?? null;
    out.winRate = out.winRate ?? null;
    out.avgProfit = out.avgProfit ?? null;
    out.avgLoss = out.avgLoss ?? null;
    out.pseudoCaseCount = out.pseudoCaseCount ?? null;

    // Exit/result
    out.hasResult = Boolean(out.hasResult);
    out.datetimeExit = out.datetimeExit ?? null;
    out.exitPrice = out.exitPrice ?? null;
    out.directionTaken = out.directionTaken || out.directionPlanned || "long";
    out.highDuringTrade = out.highDuringTrade ?? null;
    out.lowDuringTrade = out.lowDuringTrade ?? null;
    out.exitReason = out.exitReason || "";
    out.exitReasonOther = out.exitReasonOther || "";
    out.profit = out.profit ?? null;
    out.profitPerUnit = out.profitPerUnit ?? null;
    out.riskPerUnit = out.riskPerUnit ?? null;
    out.rMultiple = out.rMultiple ?? null;
    out.resultMemo = out.resultMemo || "";

    out.postExitMarket = out.postExitMarket || "";
    out.completionStatus = out.completionStatus || "";
    out.taeValue = out.taeValue ?? null;

    // Compute missing per-unit / R-multiple metrics for learning (backward compatible)
    if (out.hasResult) {
      const m = computeResultMetrics(out);
      if (out.profitPerUnit == null && m.profitPerUnit != null) out.profitPerUnit = m.profitPerUnit;
      if (out.riskPerUnit == null && m.riskPerUnit != null) out.riskPerUnit = m.riskPerUnit;
      if (out.rMultiple == null && m.rMultiple != null) out.rMultiple = m.rMultiple;
      if (out.profit == null && out.profitPerUnit != null && typeof out.size === "number" && Number.isFinite(out.size)) {
        out.profit = out.profitPerUnit * out.size;
      }
    }

    return out;
  }

  /** ---------------------------
   *  Tabs
   *  --------------------------*/
  
function initTabs() {
  const buttons = $$(".tab-button");
  const sections = $$(".tab-content");

  function showTab(tab) {
    buttons.forEach((b) => b.classList.toggle("active", b.dataset.tab === tab));
    sections.forEach((sec) => {
      const isActive = sec.id === `${tab}-tab`;
      sec.classList.toggle("active", isActive);
      sec.hidden = !isActive;
    });

    if (tab === "entry") {
      // 新規入力時は端末種別を自動入力
      setEntryDeviceAuto({ force: false });
    }

    if (tab === "stats") {
      // Statsタブを開いたタイミングで描画（hidden状態での描画を避ける）
      safeRenderStats();
    }
  }

  buttons.forEach((btn) => {
    btn.addEventListener("click", () => showTab(btn.dataset.tab));
  });

  // 初期表示（HTML側のactiveを尊重）
  const initial = buttons.find((b) => b.classList.contains("active"))?.dataset.tab || "entry";
  showTab(initial);
}


  function gotoTab(tabName) {
    const btn = $(`.tab-button[data-tab="${tabName}"]`);
    if (btn) btn.click();
  }

  /** ---------------------------
   *  Entry form
   *  --------------------------*/
  const REQUIRED_SELECT_IDS = [
    "ind-waveCount",
    "ind-dowShape",
    "ind-trend_5_20_40",
    "ind-price_vs_ema200",
    "ind-atr_zone",
    "ind-ema_band_color",
    "ind-cmf_sign",
    "ind-cmf_sma",
    "ind-MACD",
    "ind-roc_sign",
    "ind-roc_sma",
    "ind-RSI"
  ];


  // 決め手インジ（選択肢は「インジケーター」欄の項目名に合わせる）
  const DECISIVE_INDICATORS = [
    { value: "waveCount", label: "波動ライン" },
    { value: "dowShape", label: "ダウ形状" },
    { value: "trend_5_20_40", label: "大循環分析" },
    { value: "price_vs_ema200", label: "EMA200" },
    { value: "zone", label: "ATR指標" },
    { value: "ema_band_color", label: "EMA Band" },
    { value: "cmf_sign", label: "CMF実数" },
    { value: "cmf_sma_dir", label: "CMF SMA hist" },
    { value: "macd_state", label: "MACD" },
    { value: "roc_sign", label: "ROC実数" },
    { value: "roc_sma_dir", label: "ROC SMA hist" },
    { value: "rsi_zone", label: "RSI" }
  ];

  const DECISIVE_LABEL = Object.fromEntries(DECISIVE_INDICATORS.map((x) => [x.value, x.label]));

  function indicatorLabel(key) {
    if (!key) return "";
    return DECISIVE_LABEL[key] || String(key);
  }


  // 決め手インジのキー → 実際の入力欄（id / recordプロパティ）の対応
  const DECISIVE_FIELD_MAP = {
    waveCount:        { prop: "waveCount",        elId: "ind-waveCount" },
    dowShape:         { prop: "dowShape",         elId: "ind-dowShape" },
    trend_5_20_40:    { prop: "trend_5_20_40",    elId: "ind-trend_5_20_40" },
    price_vs_ema200:  { prop: "price_vs_ema200",  elId: "ind-price_vs_ema200" },
    zone:             { prop: "zone",             elId: "ind-atr_zone" },
    ema_band_color:   { prop: "ema_band_color",   elId: "ind-ema_band_color" },
    cmf_sign:         { prop: "cmf_sign",         elId: "ind-cmf_sign" },
    cmf_sma_dir:      { prop: "cmf_sma_dir",      elId: "ind-cmf_sma" },
    macd_state:       { prop: "macd_state",       elId: "ind-MACD" },
    roc_sign:         { prop: "roc_sign",         elId: "ind-roc_sign" },
    roc_sma_dir:      { prop: "roc_sma_dir",      elId: "ind-roc_sma" },
    rsi_zone:         { prop: "rsi_zone",         elId: "ind-RSI" }
  };

  function readIndicatorValueAndTextByKey(decisiveKey) {
    const m = DECISIVE_FIELD_MAP[decisiveKey];
    if (!m) return { value: "", text: "" };
    const el = document.getElementById(m.elId);
    if (!el) return { value: "", text: "" };

    const value = (el.value ?? "").trim();
    if (!value) return { value: "", text: "" };

    // selectなら表示文言、inputなら値そのもの
    if (el.tagName === "SELECT") {
      const opt = el.options?.[el.selectedIndex];
      const text = (opt?.textContent ?? value).trim();
      return { value, text };
    }
    return { value, text: value };
  }

  function setEntryDecisiveSignalDisplay() {
    const key = $("#entry-decisiveIndicator")?.value || "";
    const { text } = readIndicatorValueAndTextByKey(key);
    const el = $("#entry-decisiveSignal");
    if (el) el.value = text || "";
  }


  function populateDecisiveIndicatorSelects() {
    const elEntry = document.getElementById("entry-decisiveIndicator");
    const elFilter = document.getElementById("filter-decisiveIndicator");
    const elIndicatorFilter = document.getElementById("filter-indicatorKey");

    const fill = (el, firstText) => {
      if (!el) return;
      const current = el.value || "";
      el.innerHTML = "";
      const opt0 = document.createElement("option");
      opt0.value = "";
      opt0.textContent = firstText;
      el.appendChild(opt0);

      for (const it of DECISIVE_INDICATORS) {
        const opt = document.createElement("option");
        opt.value = it.value;
        opt.textContent = it.label;
        el.appendChild(opt);
      }
      // restore if possible
      el.value = current;
    };

    fill(elEntry, "（未選択）");
    fill(elFilter, "（全て）");
    fill(elIndicatorFilter, "（未選択）");
  }

  
  function validateRequiredSelects() {
  const missing = [];
  for (const id of REQUIRED_SELECT_IDS) {
    const el = document.getElementById(id);
    if (!el) continue;
    if (el.value === "") missing.push(id);
  }
  if (missing.length) {
    alert("未選択の項目があります。「選択してください」をすべて埋めてから保存してください。");
    const first = document.getElementById(missing[0]);
    if (first) first.focus();
    return false;
  }
  return true;
}
function getEntryForm() {
    return {
      datetimeEntry: $("#entry-datetime").value || null,
      
      entryWeekday: weekdayFromDatetimeLocal($("#entry-datetime").value || null) || "",
      entryWeekdayKey: normalizeWeekdayKey(weekdayFromDatetimeLocal($("#entry-datetime").value || null) || ""),
      entrySession: $("#entry-session")?.value || "",
      tradeMethod: $("#entry-tradeMethod")?.value || "",
symbol: $("#entry-symbol").value,
      timeframe: $("#entry-timeframe").value,
      tradeType: $("#entry-tradeType").value,
      directionPlanned: $("#entry-direction").value,

      entryPrice: safeNum($("#entry-price").value),
      size: safeNum($("#entry-size").value),
      feePerUnit: safeNum($("#entry-fee").value),
      plannedLimitPrice: safeNum($("#entry-LimitPrice").value),
      cutLossPrice: safeNum($("#entry-LossPrice").value),

      tpType: $("#entry-tpType")?.value || "",
      tpTypeOther: $("#entry-tpTypeOther")?.value || "",
      lsType: $("#entry-lsType")?.value || "",
      lsTypeOther: $("#entry-lsTypeOther")?.value || "",

      rr: computeRR(
        $("#entry-direction").value,
        safeNum($("#entry-price").value),
        safeNum($("#entry-LimitPrice").value),
        safeNum($("#entry-LossPrice").value)
      ),
      waveCount: $("#ind-waveCount").value,
      dowShape: $("#ind-dowShape").value,
      trend_5_20_40: $("#ind-trend_5_20_40").value,
      price_vs_ema200: $("#ind-price_vs_ema200").value,
      ema_band_color: $("#ind-ema_band_color").value,
      zone: $("#ind-atr_zone").value,
      cmf_sign: $("#ind-cmf_sign").value,
      cmf_sma_dir: $("#ind-cmf_sma").value,
      macd_state: $("#ind-MACD").value,
      roc_sign: $("#ind-roc_sign").value,
      roc_sma_dir: $("#ind-roc_sma").value,
      rsi_zone: $("#ind-RSI").value,

      decisiveIndicator: $("#entry-decisiveIndicator")?.value || "",

      decisiveSignal: readIndicatorValueAndTextByKey($("#entry-decisiveIndicator")?.value || "").value,
      decisiveSignalText: readIndicatorValueAndTextByKey($("#entry-decisiveIndicator")?.value || "").text,

      minWinRate: safeNum($("#entry-minWinRate").value),

      marketMemo: $("#entry-marketMemo").value || "",
      entryDevice: $("#entry-device")?.value || "",
      // NOTE: UI上は Notion URL / 画像（任意）を廃止したため、
      // 既存データを壊さないように「編集中レコードの値」を優先して保持する。
      notionUrl: (() => {
        if (!editingEntryId) return "";
        const cur = records.find((x) => x.id === editingEntryId);
        return (cur && cur.notionUrl) ? cur.notionUrl : "";
      })(),
      entryImageData: (() => {
        if (!editingEntryId) return null;
        const cur = records.find((x) => x.id === editingEntryId);
        return (cur && cur.entryImageData !== undefined) ? cur.entryImageData : null;
      })()
    };
  }

  function validateEntryRequired(entry) {
    if (!entry.datetimeEntry) return "エントリー日時は必須です。";
    if (!entry.entrySession) return "エントリー時立ち合いは必須です。";
    if (!entry.tradeType) return "取引区分は必須です。";
    if (!entry.directionPlanned) return "エントリー方向は必須です。";
    if (entry.entryPrice === null) return "エントリー価格は必須です。";
    if (entry.size === null) return "枚数は必須です。";
    if (entry.feePerUnit === null) return "1枚あたりの手数料は必須です。";
    if (!entry.tpType) return "TP種別は必須です。";
    if (isTpOther(entry.tpType) && !String(entry.tpTypeOther || "").trim()) return "TP種別（その他）を入力してください。";
    if (!entry.lsType) return "SL種別は必須です。";
    if (isLsOther(entry.lsType) && !String(entry.lsTypeOther || "").trim()) return "SL種別（その他）を入力してください。";
    if (entry.plannedLimitPrice === null) return "TP（利確価格）は必須です。";
    if (entry.cutLossPrice === null) return "SL（損切価格）は必須です。";
    // RRはTP/SLから自動計算されるため、計算不能は入力の整合性エラー
    if (entry.rr == null || !Number.isFinite(entry.rr) || entry.rr <= 0) return "RRが計算できません（Entry/TP/SL価格の整合性を確認）";
    return null;
  }

  function resetJudgeOutput() {
    if (!elJudgeOutput) return;
    elJudgeOutput.innerHTML = `<p class="muted">ここに判定結果が表示されます。</p>`;
  }

  function clearEntryForm() {
    editingEntryId = null;
    $("#entry-form").reset();

    // restore defaults
    $("#entry-symbol").value = "nk225mc";
    $("#entry-timeframe").value = "1h";
    $("#entry-tradeType").value = "";
    $("#entry-direction").value = "";
        $("#entry-session") && ($("#entry-session").value = "");
    $("#entry-tradeMethod") && ($("#entry-tradeMethod").value = "");
    $("#entry-weekday") && ($("#entry-weekday").value = "");
    // 端末種別（自動）
    setEntryDeviceAuto({ force: true });
$("#entry-minWinRate").value = "30";

    // clear optional textareas
    $("#entry-marketMemo").value = "";
    $("#entry-decisiveSignal").value = "";

    // TP/LS種別 & RR
    if ($("#entry-tpType")) $("#entry-tpType").value = "";
    if ($("#entry-tpTypeOther")) $("#entry-tpTypeOther").value = "";
    if ($("#entry-lsType")) $("#entry-lsType").value = "";
    if ($("#entry-lsTypeOther")) $("#entry-lsTypeOther").value = "";
    $("#entry-tpType-other-wrap") && ($("#entry-tpType-other-wrap").hidden = true);
    $("#entry-lsType-other-wrap") && ($("#entry-lsType-other-wrap").hidden = true);
    updateEntryRRPreview();

    // clear judge UI
    resetJudgeOutput();
    clearMsg();

    updateEntryEditUI();
    // UX: after clear, scroll top and focus entry datetime
    scrollToTopOnly();
  }

  function updateEntryEditUI() {
    const isEditing = !!editingEntryId;
    const badge = $("#entry-edit-badge");
    const saveBtn = $("#btn-save-entry");

    if (badge) badge.hidden = !isEditing;
    if (saveBtn) saveBtn.textContent = isEditing ? "更新して保存" : "判定してエントリーを保存";
  }

function updateExitEditUI() {
  const badge = $("#exit-edit-badge");
  const saveBtn = $("#btn-exit-save");

  const isEditing = !!(selectedExitId && editingExitId === selectedExitId);

  if (badge) badge.hidden = !isEditing;
  if (saveBtn) saveBtn.textContent = isEditing ? "結果を更新" : "結果を保存";
}


  function renderJudge(result, symbol, timeframe) {
    if (!elJudgeOutput) return;

    if (!result || result.pseudoCaseCount === 0) {
      elJudgeOutput.innerHTML = `
        <div class="judge-grid">
          <div><strong>判定銘柄</strong><div>${escapeHtml(symbol || "—")}</div></div>
          <div><strong>時間足</strong><div>${escapeHtml(timeframe || "—")}</div></div>
          <div><strong>擬似ケース</strong><div>0件</div></div>
        </div>
        <p class="muted">同じ銘柄×同じ時間足の決済済みデータが不足しています。</p>
      `;
      return;
    }

    const bar = (pct) => {
      const p = clamp(Number(pct || 0), 0, 100);
      return `
        <div class="bar">
          <div class="bar-fill" style="width:${p}%"></div>
        </div>
      `;
    };

    const winRate = (result.winRate ?? null);
    const minWin = (result.minWinRate ?? null);

    const isBelow = (winRate !== null && minWin !== null && winRate < minWin);

    const expected = (isBelow || result.expectedMove == null)
      ? "—"
      : (() => {
          const pt = `${result.recommendation === "short" ? "-" : "+"}${Math.round(result.expectedMove)}${result.expectedMoveUnit || "pt"}`;
          const mult = symbolMultiplier(symbol || "");
          if (typeof mult === "number" && Number.isFinite(mult) && mult !== 1) {
            const yenPerUnit = Math.round(result.expectedMove * mult);
            return `${pt}（約${yenPerUnit}円/枚）`;
          }
          return pt;
        })();

    const recoClass = isBelow ? "reco-none" : (result.recommendation === "long" ? "reco-long" : (result.recommendation === "short" ? "reco-short" : "reco-none"));

    elJudgeOutput.innerHTML = `
      <div class="judge-grid">
        <div><strong>判定銘柄</strong><div>${escapeHtml(symbol || "—")}</div></div>
        <div><strong>時間足</strong><div>${escapeHtml(timeframe || "—")}</div></div>
        <div><strong>擬似ケース</strong><div>${result.pseudoCaseCount}件</div></div>
        <div><strong>ESS</strong><div>${result.ess == null ? "—" : result.ess.toFixed(1)}</div></div>
        <div><strong>推奨方向</strong><div class="reco ${recoClass}">${toJpDir(result.recommendation)}</div></div>
        <div><strong>勝率</strong><div>${winRate == null ? "—" : `${Math.round(winRate)}%`}</div></div>
        <div><strong>期待値(EV_R)</strong><div>${result.ev == null ? "—" : `${Number(result.ev).toFixed(3)}R`}</div></div>
        <div><strong>Setup件数</strong><div>${result.setupN == null ? "—" : `${result.setupN}件`}</div></div>

        <div class="full judge-split">
          <div>
            <strong>信頼度</strong>
            <div class="row">
              <div>${result.confidence == null ? "—" : `${Math.round(result.confidence)}%`}</div>
              ${bar(result.confidence)}
            </div>
          </div>
          <div>
            <strong>推定値幅</strong>
            <div>${expected}</div>
          </div>
        </div>
        <div><strong>平均利益</strong><div>${result.avgProfit == null ? "—" : `${Number(result.avgProfit).toFixed(2)}R`}</div></div>
        <div><strong>平均損失</strong><div>${result.avgLoss == null ? "—" : `${Number(result.avgLoss).toFixed(2)}R`}</div></div>
      ${result.reason ? `<p class="warn small">※ ${escapeHtml(result.reason)}</p>` : ``}
      ${isBelow ? `<p class="muted small">※ 勝率しきい値（${minWin}%）未満のため「ノーポジ推奨」扱いです。</p>` : ``}
      ${result.debug ? (() => {
          const d = result.debug || {};
          const stages = d.stages || {};
          const rr = d.rr || {};
          const params = d.params || {};
          const fmt = (v) => (v == null ? "—" : String(v));
          return `
            <details class="debug">
              <summary>判定ログ（フィルタ / サンプル）</summary>
              <div class="muted small" style="margin-top:6px; line-height:1.5;">
                <div>総レコード: ${fmt(d.totalRecords)}</div>
                <div>種別/完成度通過: ${fmt(stages.afterTypeStatus)}</div>
                <div>銘柄×足×決済済通過: ${fmt(stages.afterSymbolTimeframeResult)}</div>
                <div>類似度しきい値通過: ${fmt(stages.afterSimilarityThreshold)}</div>
                <div>しきい値(MIN_SIM): ${fmt(params.TH)} / MIN_CASES: ${fmt(params.MIN_CASES)} / MIN_ESS: ${fmt(params.MIN_ESS)} / MIN_COMP: ${fmt(params.minComparableFeatures)}</div>
                ${d.similarity?.topScores ? `<div>上位スコア: ${d.similarity.topScores.join(", ")}</div>` : ``}
                ${rr.rrMissing ? `<div class="warn small" style="margin-top:6px;">※ TP/SL未入力（RR不明）: RRゲートは適用外ですが、判定の信頼性は低下します。</div>` : ``}
                ${rr.failed ? `<div class="warn small" style="margin-top:6px;">※ RR下限によりノーポジ。</div>` : ``}
              </div>
            </details>
          `;
        })() : ``}

    `;
  }

  /** ---------------------------
   *  Judge logic
   *  --------------------------*/
  function isSameFeature(r, current, ms) {
    // Similarity is used as a weighting signal.
    // Rule:
    // - Missing values are treated as "unknown" and excluded from comparison (not punished as mismatch).
    // - If the number of comparable features is too small, similarity is automatically decayed to avoid overconfidence.
    const keys = [
      "waveCount",
      "dowShape",
      "trend_5_20_40",
      "price_vs_ema200",
      "ema_band_color",
      "zone",
      "cmf_sign",
      "cmf_sma_dir",
      "macd_state",
      "roc_sign",
      "roc_sma_dir",
      "uo_state",
      "uo_sma_dir",
      "volume_spike",
      "vol_body_gap",
      "rsi_overheat",
      "market_context"
    ];

    const isBlank = (v) => (v == null || v === "");
    const toKey = (v) => (v == null ? "" : String(v));

    let denom = 0;
    let match = 0;
    let comparableCount = 0;

    // Categorical features: compare only when both sides are present
    for (const k of keys) {
      const a = toKey(current[k]);
      const b = toKey(r[k]);
      if (isBlank(a) || isBlank(b)) continue;
      comparableCount += 1;
      denom += 1;
      if (a === b) match += 1;
    }

    // Derived numeric similarity (plan realism)
    // RR / TP距離 / SL距離は、同じインジ状態でも結果を割りやすいので「近いもの」を優先する
    function planMetrics(x) {
      // IMPORTANT: do NOT fall back to "directionTaken" (leakage risk).
      const dir = x.directionPlanned || x.dirPlanned || x.dir || x.direction || "";
      const e = Number(x.entryPrice);
      const tp = Number(x.plannedLimitPrice);
      const sl = Number(x.cutLossPrice);

      const rr = computeRR(dir, e, tp, sl);

      let tpDist = null;
      let slDist = null;

      if ((dir === "long" || dir === "short") && Number.isFinite(e) && Number.isFinite(tp)) {
        const d = (dir === "long") ? (tp - e) : (e - tp);
        tpDist = (d > 0) ? d : null;
      }
      if ((dir === "long" || dir === "short") && Number.isFinite(e) && Number.isFinite(sl)) {
        const d = (dir === "long") ? (e - sl) : (sl - e);
        slDist = (d > 0) ? d : null;
      }
      return { rr: Number.isFinite(rr) ? rr : null, tpDist, slDist };
    }

    // Relative similarity for positive numeric values.
    // If either side is missing/invalid => null (excluded from comparison).
    function relSim(a, b) {
      if (!(typeof a === "number" && Number.isFinite(a)) || !(typeof b === "number" && Number.isFinite(b))) return null;
      if (a <= 0 || b <= 0) return null;
      const mn = Math.min(a, b);
      const mx = Math.max(a, b);
      return mx === 0 ? null : clamp(mn / mx, 0, 1);
    }

    const curP = planMetrics(current);
    const recP = planMetrics(r);

    const wRR = 1.0;
    const wTPD = 0.9;
    const wSLD = 0.9;

    const rrS = relSim(curP.rr, recP.rr);
    if (rrS != null) {
      denom += wRR;
      match += wRR * rrS;
      comparableCount += 1;
    }

    const tpS = relSim(curP.tpDist, recP.tpDist);
    if (tpS != null) {
      denom += wTPD;
      match += wTPD * tpS;
      comparableCount += 1;
    }

    const slS = relSim(curP.slDist, recP.slDist);
    if (slS != null) {
      denom += wSLD;
      match += wSLD * slS;
      comparableCount += 1;
    }

    if (!denom) return 0;

    let sim = match / denom;

    // decay if comparable features are too few
    const minComp = Math.max(1, Math.trunc(Number(ms?.minComparableFeatures) || MASTER_DEFAULTS.minComparableFeatures || 6));
    if (comparableCount < minComp) {
      sim *= (comparableCount / minComp);
    }

    return clamp(sim, 0, 1);
  }


  
  // ---------------------------
  // Learning metric / Setup prior helpers
  // ---------------------------

  function getSetupIdFromRecord(r) {
    const k = String(r?.decisiveIndicator || "").trim();
    const v = String(r?.decisiveSignal || "").trim();
    if (!k || !v) return "";
    return `${k}::${v}`;
  }

  function mixStat(a, b, w) {
    if (a == null && b == null) return null;
    if (a == null) return b;
    if (b == null) return a;
    if (!Number.isFinite(w)) return a;
    return (w * a) + ((1 - w) * b);
  }

  function learnMetricR(r) {
    const x = r?.rMultiple;
    return (typeof x === "number" && Number.isFinite(x)) ? x : null;
  }

  function computeProfitPerUnit(symbol, direction, entryPrice, exitPrice, feePerUnit) {
    if (![entryPrice, exitPrice, feePerUnit].every((n) => typeof n === "number" && Number.isFinite(n))) return null;
    const mult = symbolMultiplier(symbol);
    let diff = 0;
    if (direction === "long") diff = (exitPrice - entryPrice);
    else if (direction === "short") diff = (entryPrice - exitPrice);
    else diff = 0;
    const ppu = (diff * mult) - feePerUnit;
    return Number.isFinite(ppu) ? ppu : null;
  }

  function computeRiskPerUnit(symbol, direction, entryPrice, stopPrice) {
    if (![entryPrice, stopPrice].every((n) => typeof n === "number" && Number.isFinite(n))) return null;
    const mult = symbolMultiplier(symbol);
    let dist = 0;
    if (direction === "long") dist = (entryPrice - stopPrice);
    else if (direction === "short") dist = (stopPrice - entryPrice);
    else dist = 0;
    const risk = dist * mult;
    if (!Number.isFinite(risk) || risk <= 0) return null;
    return risk;
  }

  function computeResultMetrics(r) {
    // returns { profitPerUnit, rMultiple } if possible (profit in record is total yen)
    if (!r || !r.hasResult) return { profitPerUnit: null, rMultiple: null, riskPerUnit: null };
    const dir = (r.directionTaken || r.directionPlanned || "long");
    const entryPrice = r.entryPrice;
    const exitPrice = r.exitPrice;
    const feePerUnit = r.feePerUnit;
    const stopPrice = r.lsPrice ?? r.cutLossPrice ?? null; // tolerate legacy naming
    const profitPerUnit = computeProfitPerUnit(r.symbol, dir, entryPrice, exitPrice, feePerUnit);
    const riskPerUnit = computeRiskPerUnit(r.symbol, dir, entryPrice, stopPrice);
    const rMultiple = (profitPerUnit != null && riskPerUnit != null) ? (profitPerUnit / riskPerUnit) : null;
    return { profitPerUnit, rMultiple: (Number.isFinite(rMultiple) ? rMultiple : null), riskPerUnit };
  }

  function buildSetupStats(candidates, setupId) {
    const out = {};
    if (!setupId) return out;
    const dirs = ["long", "short"];
    for (const d of dirs) {
      const rows = candidates.filter((r) => (
        r.directionTaken === d &&
        getSetupIdFromRecord(r) === setupId &&
        learnMetricR(r) != null
      ));
      const n = rows.length;
      if (!n) continue;
      const metrics = rows.map((r) => learnMetricR(r)).filter((x) => x != null);
      const ev = metrics.reduce((s, x) => s + x, 0) / metrics.length;
      const wins = metrics.filter((x) => x > 0).length;
      const losses = metrics.filter((x) => x < 0).length;
      const winRate = metrics.length ? (wins / metrics.length) * 100 : null;
      const avgProfit = wins ? (metrics.filter((x) => x > 0).reduce((s, x) => s + x, 0) / wins) : null;
      const avgLoss = losses ? (metrics.filter((x) => x < 0).reduce((s, x) => s + x, 0) / losses) : null;

      out[d] = { n: metrics.length, ev, winRate, avgProfit, avgLoss };
    }
    return out;
  }

function judge(current) {
    const minWinRate = Number.isFinite(current.minWinRate) ? current.minWinRate : 30;
    const ms = getMasterSettings();

    const debug = {
      totalRecords: Array.isArray(records) ? records.length : 0,
      stages: {},
      dropped: {},
      rr: {},
      params: {}
    };

    // RR gate (strict): 低RRを混ぜると“勝率”の評価が歪む。原則ここで弾く。
    const rrNow = Number.isFinite(current.rr) ? current.rr : null;
    const rrMin = Number.isFinite(ms.rrMin) ? ms.rrMin : MASTER_DEFAULTS.rrMin;
    const rrGate = !!ms.rrGateEnabled;
    const rrAllowMissing = !!ms.rrAllowMissing;

    debug.rr = { rrNow, rrMin, rrGate, rrAllowMissing };

    if (rrGate) {
      if (rrNow == null) {
        debug.rr.rrMissing = true;
        if (!rrAllowMissing) {
          return {
            recommendation: "flat",
            expectedMove: null,
            expectedMoveUnit: "pt",
            confidence: 0,
            winRate: null,
            avgProfit: null,
            avgLoss: null,
            pseudoCaseCount: 0,
            minWinRate,
            reason: "TP/SLが未入力のためRR不明。RRゲートが有効なので判定はノーポジ。",
            debug
          };
        }
      } else if (rrNow < rrMin) {
        debug.rr.failed = true;
        return {
          recommendation: "flat",
          expectedMove: null,
          expectedMoveUnit: "pt",
          confidence: 0,
          winRate: null,
          avgProfit: null,
          avgLoss: null,
          pseudoCaseCount: 0,
          minWinRate,
          reason: `RR=${rrNow.toFixed(2)} が下限 ${rrMin} 未満。低RRは長期的に地獄なのでノーポジ。`,
          debug
        };
      }
    }

    // 1) candidate pool: same symbol + timeframe, must have results

    const allowTypes = normalizeMasterTradeTypes(ms.dataTradeTypes);
    const allowStatuses = normalizeMasterCompletionStatuses(ms.dataCompletionStatuses);

    // Stage A: trade type / completion status
    const stageA = records.filter((r) => {
      const tt = String(r.tradeType || "real");
      const cs = normalizeCompletionStatusForJudge(r.completionStatus);
      return allowTypes.includes(tt) && allowStatuses.includes(cs);
    });
    debug.stages.afterTypeStatus = stageA.length;
    debug.dropped.typeStatus = (debug.totalRecords || 0) - stageA.length;

    // Stage B: symbol/timeframe + realized result (+ learning metric: R multiple)
    const candidates = stageA.filter((r) => (
      r.hasResult &&
      r.symbol === current.symbol &&
      r.timeframe === current.timeframe &&
      learnMetricR(r) != null
    ));
    debug.stages.afterSymbolTimeframeResult = candidates.length;
    debug.dropped.symbolTimeframeResult = stageA.length - candidates.length;

    // 2) pseudo cases by similarity score
    const withScore = candidates
      .map((r) => ({ r, score: isSameFeature(r, current, ms) }))
      .sort((a, b) => b.score - a.score);

    // threshold: keep reasonably similar (Masterで調整)
    const TH = clamp(Number.isFinite(ms.minSimilarity) ? ms.minSimilarity : MASTER_DEFAULTS.minSimilarity, 0, 1);
    const MAX_NEIGHBORS = Number.isFinite(ms.maxNeighbors) ? ms.maxNeighbors : MASTER_DEFAULTS.maxNeighbors;
    const MIN_CASES = Number.isFinite(ms.minCases) ? ms.minCases : MASTER_DEFAULTS.minCases;
    const MIN_ESS = Number.isFinite(ms.minEss) ? ms.minEss : MASTER_DEFAULTS.minEss;
    const alpha = Number.isFinite(ms.similarityAlpha) ? ms.similarityAlpha : MASTER_DEFAULTS.similarityAlpha;
    const EV_MIN_R = Number.isFinite(ms.evMinR) ? ms.evMinR : MASTER_DEFAULTS.evMinR;
    const EV_GAP_R = Number.isFinite(ms.evGapR) ? ms.evGapR : MASTER_DEFAULTS.evGapR;

    debug.params = { TH, MAX_NEIGHBORS, MIN_CASES, MIN_ESS, alpha, EV_MIN_R, EV_GAP_R, minComparableFeatures: (Number.isFinite(ms.minComparableFeatures) ? ms.minComparableFeatures : MASTER_DEFAULTS.minComparableFeatures) };

    const pseudoWS = withScore
      .filter((x) => x.score >= TH)
      .slice(0, MAX_NEIGHBORS);

    const pseudo = pseudoWS.map((x) => x.r);

    debug.stages.afterSimilarityThreshold = pseudo.length;
    debug.dropped.similarityThreshold = candidates.length - pseudo.length;
    debug.similarity = {
      threshold: TH,
      topScores: withScore.slice(0, 5).map((x) => Number.isFinite(x.score) ? Number(x.score.toFixed(3)) : 0)
    };

    if (pseudo.length === 0) {
      return {
        recommendation: "flat",
        expectedMove: null,
        expectedMoveUnit: "pt",
        confidence: 0,
        winRate: null,
        avgProfit: null,
        avgLoss: null,
        pseudoCaseCount: 0,
        minWinRate,
        reason: "類似データが見つからない（しきい値が高すぎる or 入力が粗い）",
        debug
      };
    }

    // Effective sample size (ESS): similarity分布が偏っているほど小さくなる
    const w = pseudoWS.map((x) => Math.pow(x.score, alpha));
    const sumW = w.reduce((s, v) => s + v, 0);
    const sumW2 = w.reduce((s, v) => s + v * v, 0);
    const ess = sumW2 ? (sumW * sumW) / sumW2 : 0;

    if (pseudo.length < MIN_CASES) {
      return {
        recommendation: "flat",
        expectedMove: null,
        expectedMoveUnit: "pt",
        confidence: 0,
        winRate: null,
        avgProfit: null,
        avgLoss: null,
        pseudoCaseCount: pseudo.length,
        minWinRate,
        reason: `類似データが${pseudo.length}件（最低${MIN_CASES}件必要）。少数の奇跡で張るな。`,
        debug
      };
    }

    if (ess < MIN_ESS) {
      return {
        recommendation: "flat",
        expectedMove: null,
        expectedMoveUnit: "pt",
        confidence: 0,
        winRate: null,
        avgProfit: null,
        avgLoss: null,
        pseudoCaseCount: pseudo.length,
        minWinRate,
        reason: `類似データのESS=${ess.toFixed(2)}（最低${MIN_ESS}必要）。“近いデータ”が薄い。`,
        debug
      };
    }
// group by directionTaken (STRICT). Planned direction is not used for evaluation.
    // Use similarity weights consistently (score^alpha) for all aggregates.
    const dirs = ["long", "short", "flat"];
    const statsByDir = {};

    const weightedRows = pseudoWS.map((x, i) => ({
      r: x.r,
      score: x.score,
      w: Math.pow(x.score, alpha),
      metric: learnMetricR(x.r)
    }));

    for (const d of dirs) {
      const rows = weightedRows.filter((x) => (x.r.directionTaken) === d);
      const n = rows.length;
      const wSum = rows.reduce((s, x) => s + x.w, 0);
      const w2Sum = rows.reduce((s, x) => s + x.w * x.w, 0);
      const essDir = w2Sum ? (wSum * wSum) / w2Sum : 0;

      // Weighted win prob
      const wWins = rows.reduce((s, x) => s + ((x.metric > 0) ? x.w : 0), 0);
      const wLosses = rows.reduce((s, x) => s + ((x.metric < 0) ? x.w : 0), 0);

      const winRate = (wSum > 0) ? (wWins / wSum) * 100 : null;

      // Weighted avg profit of wins / losses (loss avg is negative)
      const avgProfit = (wWins > 0)
        ? rows.reduce((s, x) => s + ((x.metric > 0) ? x.w * x.metric : 0), 0) / wWins
        : null;

      const avgLoss = (wLosses > 0)
        ? rows.reduce((s, x) => s + ((x.metric < 0) ? x.w * x.metric : 0), 0) / wLosses
        : null;

      // Expected value per trade (weighted mean PnL, yen)
      const ev = (wSum > 0)
        ? rows.reduce((s, x) => s + x.w * x.metric, 0) / wSum
        : null;

      // expectedMove: price based (points). Also weighted.
      let expectedMove = null;
      if (d === "long") {
        const num = rows.reduce((s, x) => {
          const hi = x.r.highDuringTrade;
          const en = x.r.entryPrice;
          return (typeof hi === "number" && typeof en === "number" && Number.isFinite(hi) && Number.isFinite(en))
            ? s + x.w * Math.max(0, hi - en)
            : s;
        }, 0);
        const den = rows.reduce((s, x) => {
          const hi = x.r.highDuringTrade;
          const en = x.r.entryPrice;
          return (typeof hi === "number" && typeof en === "number" && Number.isFinite(hi) && Number.isFinite(en))
            ? s + x.w
            : s;
        }, 0);
        expectedMove = den > 0 ? (num / den) : null;
      } else if (d === "short") {
        const num = rows.reduce((s, x) => {
          const lo = x.r.lowDuringTrade;
          const en = x.r.entryPrice;
          return (typeof lo === "number" && typeof en === "number" && Number.isFinite(lo) && Number.isFinite(en))
            ? s + x.w * Math.max(0, en - lo)
            : s;
        }, 0);
        const den = rows.reduce((s, x) => {
          const lo = x.r.lowDuringTrade;
          const en = x.r.entryPrice;
          return (typeof lo === "number" && typeof en === "number" && Number.isFinite(lo) && Number.isFinite(en))
            ? s + x.w
            : s;
        }, 0);
        expectedMove = den > 0 ? (num / den) : null;
      }

      statsByDir[d] = { n, wSum, essDir, winRate, avgProfit, avgLoss, expectedMove, ev };
    }


    // Setup prior mixing (decisive indicator as setup id). We do NOT filter candidates to "same setup only"
    // to avoid data starvation; instead we shrink toward setup stats as they grow.
    const setupId = getSetupIdFromRecord(current);
    const setupPriorEnabled = !!(ms.setupPriorEnabled ?? MASTER_DEFAULTS.setupPriorEnabled);
    const N0 = Number.isFinite(ms.setupPriorN0) ? ms.setupPriorN0 : MASTER_DEFAULTS.setupPriorN0;
    let setupStatsByDir = {};
    if (setupPriorEnabled && setupId) {
      setupStatsByDir = buildSetupStats(candidates, setupId);

      for (const d of ["long", "short"]) {
        const knn = statsByDir[d];
        const sp = setupStatsByDir[d];
        if (!knn) continue;

        if (sp && sp.n > 0) {
          const w = N0 / (N0 + sp.n);
          knn.setupId = setupId;
          knn.setupN = sp.n;
          knn.setupW = w;

          // Keep originals for debug
          knn.ev_knn = knn.ev;
          knn.ev_setup = sp.ev;
          knn.winRate_knn = knn.winRate;
          knn.winRate_setup = sp.winRate;

          knn.avgProfit_knn = knn.avgProfit;
          knn.avgProfit_setup = sp.avgProfit;
          knn.avgLoss_knn = knn.avgLoss;
          knn.avgLoss_setup = sp.avgLoss;

          // Mixed stats (shrinkage)
          knn.ev = mixStat(knn.ev, sp.ev, w);
          knn.winRate = mixStat(knn.winRate, sp.winRate, w);
          knn.avgProfit = mixStat(knn.avgProfit, sp.avgProfit, w);
          knn.avgLoss = mixStat(knn.avgLoss, sp.avgLoss, w);
        } else {
          knn.setupId = setupId;
          knn.setupN = 0;
          knn.setupW = 1;
        }
      }

      debug.setupPrior = { enabled: true, setupId, N0, byDir: setupStatsByDir };
    } else {
      debug.setupPrior = { enabled: false, setupId: setupId || "", N0 };
    }

    // choose candidate direction based on expected value (R/trade);
    // tie-break: higher winRate, then higher ESS, then more raw cases.
    const choices = ["long", "short"].filter((d) => (statsByDir[d].wSum ?? 0) > 0);
    let candidate = "flat";
    if (choices.length) {
      candidate = choices.sort((a, b) => {
        const A = statsByDir[a], B = statsByDir[b];
        if ((B.ev ?? -Infinity) !== (A.ev ?? -Infinity)) return (B.ev ?? -Infinity) - (A.ev ?? -Infinity);
        if ((B.winRate ?? -Infinity) !== (A.winRate ?? -Infinity)) return (B.winRate ?? -Infinity) - (A.winRate ?? -Infinity);
        if ((B.essDir ?? -Infinity) !== (A.essDir ?? -Infinity)) return (B.essDir ?? -Infinity) - (A.essDir ?? -Infinity);
        return (B.n ?? 0) - (A.n ?? 0);
      })[0];
    }

    const chosen = statsByDir[candidate] || { n: 0 };
    let recommendation = candidate;
    let reason = null;
    let winRate = chosen.winRate;

    if (recommendation === "flat") {
      winRate = null;
    } else {
      // Expected value gate
      if ((chosen.ev ?? -Infinity) < EV_MIN_R) {
        reason = `期待値(EV_R)=${(chosen.ev ?? 0).toFixed(3)}R が下限 ${EV_MIN_R}R 未満。張る理由がない。`;
        recommendation = "flat";
        winRate = null;
      } else {
        const other = (recommendation === "long") ? (statsByDir.short || { n: 0 }) : (statsByDir.long || { n: 0 });
        if ((other.n ?? 0) > 0 && Math.abs((chosen.ev ?? 0) - (other.ev ?? 0)) < EV_GAP_R) {
          reason = `ロング/ショートの期待値差が小さい（差=${Math.abs((chosen.ev ?? 0) - (other.ev ?? 0)).toFixed(3)}R < ${EV_GAP_R}R）。迷うなら張らない。`;
          recommendation = "flat";
          winRate = null;
        }
      }

      // WinRate gate (entryタブで設定)
      if (recommendation !== "flat" && winRate != null && winRate < minWinRate) {
        reason = `勝率${winRate.toFixed(1)}% がしきい値 ${minWinRate}% 未満。今は見送れ。`;
        recommendation = "flat";
        winRate = null;
      }
    }

    const pseudoCaseCount = pseudo.length;

    // confidence: use a conservative lower-bound of win probability (Wilson score interval).
    // Treat ESS in the chosen direction as the effective n.
    const p = (winRate == null ? 0 : winRate) / 100; // 0..1
    const nEff = Math.max(1e-9, Number.isFinite(chosen.essDir) ? chosen.essDir : 0);
    const z = 1.645; // ~90% one-sided conservative bound
    const z2 = z * z;
    const denomW = 1 + (z2 / nEff);
    const center = p + (z2 / (2 * nEff));
    const rad = z * Math.sqrt(Math.max(0, (p * (1 - p) / nEff) + (z2 / (4 * nEff * nEff))));
    const wilsonLower = denomW ? clamp((center - rad) / denomW, 0, 1) : 0;
    const confidence = wilsonLower * 100;

    return {
      recommendation,
      expectedMove: (recommendation === "flat") ? null : (chosen.expectedMove ?? null),
      expectedMoveUnit: "pt",
      confidence: (recommendation === "flat") ? 0 : confidence,
      winRate: winRate ?? null,
      avgProfit: (recommendation === "flat") ? null : (chosen.avgProfit ?? null),
      avgLoss: (recommendation === "flat") ? null : (chosen.avgLoss ?? null),
      ev: (recommendation === "flat") ? null : (chosen.ev ?? null),
      setupId: (recommendation === "flat") ? null : (chosen.setupId ?? null),
      setupN: (recommendation === "flat") ? null : (chosen.setupN ?? null),
      setupW: (recommendation === "flat") ? null : (chosen.setupW ?? null),
      ev_knn: (recommendation === "flat") ? null : (chosen.ev_knn ?? null),
      ev_setup: (recommendation === "flat") ? null : (chosen.ev_setup ?? null),
      reason,
      pseudoCaseCount,
      ess,
      essChosen: (chosen.essDir ?? null),
      minWinRate,
      debug
    };
  }

  /** ---------------------------
   *  Entry handlers
   *  --------------------------*/
  
function onJudge(shouldSave) {
  clearMsg();
  // 端末種別（自動）を先に埋める
  setEntryDeviceAuto({ force: false });
  const entry = getEntryForm();
  // normalize "その他"
  if (!isTpOther(entry.tpType)) entry.tpTypeOther = "";
  if (!isLsOther(entry.lsType)) entry.lsTypeOther = "";
  const err = validateEntryRequired(entry);
  const wasEditing = !!editingEntryId;

  // 「判定する」だけなら、従来どおり上部エラーでOK
  if (!shouldSave) {
    if (err) {
      showError(elEntryError, err);
      return;
    }
    const j = judge(entry);
    renderJudge(j, displaySymbol(entry.symbol), displayTimeframe(entry.timeframe));
    return;
  }

  // 保存時はポップアップでブロック
  if (err) {
    alert(err);
    // UX: after blocking alert, scroll top and focus entry datetime
    scrollToTopOnly();
    return;
  }
  if (!validateRequiredSelects()) return;

  const j = judge(entry);
  renderJudge(j, displaySymbol(entry.symbol), displayTimeframe(entry.timeframe));

  const id = editingEntryId || uuid();
  const createdAt = editingEntryId ? (records.find((r) => r.id === id)?.createdAt || nowISO()) : nowISO();

  // baseは「entry側のみ」を入れる（exit側は触らない）
  const base = {
    id,
    createdAt,
    updatedAt: nowISO(),

    // Entry
    datetimeEntry: entry.datetimeEntry,
    symbol: entry.symbol,
    timeframe: entry.timeframe,
    tradeType: entry.tradeType,
    directionPlanned: entry.directionPlanned,
    // keep in sync so exit tab reflects entry changes
    directionTaken: entry.directionPlanned,

    // Entry extras
    entryWeekday: entry.entryWeekday,
    entrySession: entry.entrySession,
    tradeMethod: entry.tradeMethod,
    entryDevice: entry.entryDevice,
    entryPrice: entry.entryPrice,
    size: entry.size,
    feePerUnit: entry.feePerUnit,
    plannedLimitPrice: entry.plannedLimitPrice,
    cutLossPrice: entry.cutLossPrice,

    // TP/LS settings (for Stats filtering)
    tpType: entry.tpType,
    tpTypeOther: entry.tpTypeOther,
    lsType: entry.lsType,
    lsTypeOther: entry.lsTypeOther,
    rr: entry.rr,

    // indicators
    waveCount: entry.waveCount,
    dowShape: entry.dowShape,
    trend_5_20_40: entry.trend_5_20_40,
    price_vs_ema200: entry.price_vs_ema200,
    ema_band_color: entry.ema_band_color,
    zone: entry.zone,
    cmf_sign: entry.cmf_sign,
    cmf_sma_dir: entry.cmf_sma_dir,
    macd_state: entry.macd_state,
    roc_sign: entry.roc_sign,
    roc_sma_dir: entry.roc_sma_dir,
    rsi_zone: entry.rsi_zone,

    decisiveIndicator: entry.decisiveIndicator,
    decisiveSignal: entry.decisiveSignal,
    decisiveSignalText: entry.decisiveSignalText,

    // Judge settings & memo
    minWinRate: entry.minWinRate ?? 30,
    marketMemo: entry.marketMemo,
    notionUrl: entry.notionUrl,


    // Entry image (optional). CSVには出力しないが、JSON/localStorage には保持する。
    entryImageData: entry.entryImageData,
    // judge results (snapshot)
    recommendation: j.recommendation,
    expectedMove: j.expectedMove,
    expectedMoveUnit: j.expectedMoveUnit,
    confidence: j.confidence,
    winRate: j.winRate,
    avgProfit: j.avgProfit,
    avgLoss: j.avgLoss,
    pseudoCaseCount: j.pseudoCaseCount
  };

  const idx = records.findIndex((r) => r.id === id);
  if (idx >= 0) {
    const old = records[idx];
    const merged = migrateRecord({ ...old, ...base });

    // entry更新で損益は再計算（決済済みの場合）
    if (merged.hasResult) {
      const profit = computeProfit(
        merged.symbol,
        merged.directionTaken || merged.directionPlanned,
        merged.entryPrice,
        merged.exitPrice,
        merged.feePerUnit,
        merged.size
      );
      merged.profit = profit;
    }

    records[idx] = merged;
  } else {
    records.unshift(migrateRecord(base));
  }

  saveRecords();
  updateExitSelect();
  safeRenderStats();

  editingEntryId = null;
  updateEntryEditUI();
  $("#entry-form").reset();
  showToast(wasEditing ? "更新しました。" : "保存しました。", "success");
  updateExitEditUI();
  if (elEntryError) elEntryError.textContent = "";
  // UX: after save/update, scroll top and focus entry datetime
  scrollToTopOnly();
}


  /** ---------------------------
   *  Exit form
   *  --------------------------*/
  // Exitタブのトレード選択リストを再構築。
  // targetId が指定された場合は、そのIDを優先して選択状態にする（Statsからの遷移など）。
  function updateExitSelect(targetId = null) {
    if (!elExitSelect) return;

    // keep / set selection if possible
    // NOTE: Statsから別レコードへ切替える場合、elExitSelect.value が古いままだと
    //       そちらが優先されてしまい、切替が効かない。
    //       そのため targetId / selectedExitId を優先する。
    const currentVal = targetId || selectedExitId || elExitSelect.value || "";

    // Sort by datetimeEntry desc
    const sorted = [...records].sort((a, b) => String(b.datetimeEntry || "").localeCompare(String(a.datetimeEntry || "")));

    // Filter: only open trades (未決済) when checkbox is checked
    let onlyOpen = !!(elExitOnlyOpen && elExitOnlyOpen.checked);

    // Statsから「結果編集」で決済済みレコードを開きたいケースでは、
    // 「未決済のみ表示」がONだとリストに出ないため、targetId 指定時は自動的に解除する。
    if (onlyOpen && targetId) {
      const t = records.find((x) => x.id === targetId);
      if (t && t.hasResult) {
        try { elExitOnlyOpen.checked = false; } catch (_) {}
        onlyOpen = false;
      }
    }

    const list = onlyOpen ? sorted.filter(r => !r.hasResult) : sorted;

    elExitSelect.innerHTML = "";

    for (const r of list) {
      const opt = document.createElement("option");
      opt.value = r.id;
      const status = r.hasResult ? "済" : "未";
      const dt = r.datetimeEntry ? r.datetimeEntry.replace("T", " ") : "—";
      opt.textContent = `[${status}] ${dt} / ${displaySymbol(r.symbol)} / ${displayTimeframe(r.timeframe)} / ${toJpDir(r.directionPlanned)} / id:${r.id.slice(0, 8)}`;
      elExitSelect.appendChild(opt);
    }

    if (currentVal && list.some(r => r.id === currentVal)) {
      elExitSelect.value = currentVal;
      selectedExitId = currentVal;
      renderExitDetails(currentVal);
      updateExitEditUI();
    } else {
      selectedExitId = null;
      editingExitId = null;
      // listbox は自動で先頭が選択されることがあるため、明示的に未選択へ
      try { elExitSelect.selectedIndex = -1; } catch (_) {}
      if (elExitDetailsMain) elExitDetailsMain.innerHTML = `<p class="muted">リストからトレードを選択してください。</p>`;
      if (elExitDetailsSide) elExitDetailsSide.innerHTML = ``;
      if (elExitProfitWide) {
        elExitProfitWide.hidden = true;
        const disp = $("#exitProfitDisp");
        if (disp) {
          disp.textContent = "—";
          disp.classList.remove("pos", "neg");
        }
      }
      const durDisp = $("#exitDurationDisp");
      if (durDisp) durDisp.textContent = "—";
      updateExitEditUI();
    }
  }

  function renderExitDetails(id) {
    const r = records.find((x) => x.id === id);
    if (!r) {
      if (elExitDetailsMain) elExitDetailsMain.innerHTML = `<p class="muted">レコードが見つかりません。</p>`;
      if (elExitDetailsSide) elExitDetailsSide.innerHTML = ``;
      if (elExitProfitWide) {
        elExitProfitWide.hidden = true;
        const disp = $("#exitProfitDisp");
        if (disp) {
          disp.textContent = "—";
          disp.classList.remove("pos", "neg");
        }
      }
      const durDisp = $("#exitDurationDisp");
      if (durDisp) durDisp.textContent = "—";
      updateExitEditUI();
      return;
    }

    // Profit banner is shown when a record is selected
    if (elExitProfitWide) {
      elExitProfitWide.hidden = false;

      const disp = $("#exitProfitDisp");
      if (disp) {
        disp.textContent = formatYen(r.profit);
        disp.classList.remove("pos", "neg");
        if (typeof r.profit === "number" && Number.isFinite(r.profit)) {
          if (r.profit > 0) disp.classList.add("pos");
          if (r.profit < 0) disp.classList.add("neg");
        }
      }

      const durDisp = $("#exitDurationDisp");
      if (durDisp) durDisp.textContent = formatTradeDuration(r.datetimeEntry, r.datetimeExit || "");
    }

    const dir = (r.directionTaken || r.directionPlanned || "long");
    const showTae = (r.postExitMarket === "trend_continue");
    let taeVal = null;
    if (showTae && typeof r.exitPrice === "number" && Number.isFinite(r.exitPrice)) {
      if (dir === "long") {
        if (typeof r.lowDuringTrade === "number" && Number.isFinite(r.lowDuringTrade)) taeVal = (r.exitPrice - r.lowDuringTrade);
      } else if (dir === "short") {
        if (typeof r.highDuringTrade === "number" && Number.isFinite(r.highDuringTrade)) taeVal = (r.highDuringTrade - r.exitPrice);
      }
    }
    const taeDisp = (taeVal === null) ? "" : taeVal;

    // Build exit form fields (direction/size/fee read-only)
    if (elExitDetailsMain) elExitDetailsMain.innerHTML = `

  <label>決済日時 <span class="req">必須</span>
    <input id="exit-datetime" type="datetime-local" required value="${r.datetimeExit ?? ""}">
  </label>

  <label>決済曜日 <span class="muted">（自動）</span>
    <input id="exit-weekday" type="text" placeholder="（日時から自動入力）" readonly value="${weekdayFromDatetimeLocal(r.datetimeExit ?? "")}">
  </label>

  <label>決済価格 <span class="req">必須</span>
    <input id="exit-price" type="number" inputmode="decimal" step="0.1" required value="${r.exitPrice ?? ""}">
  </label>

  <label>方向（自動）
    <input id="exit-direction" type="text" value="${toJpDir(r.directionTaken || r.directionPlanned)}" readonly>
  </label>

  <label>Entry価格（自動）
    <input id="entry-price-disp" type="number" value="${r.entryPrice ?? ""}" readonly>
  </label>

  <label>枚数（自動）
    <input id="entry-size-disp" type="number" value="${r.size ?? ""}" readonly>
  </label>

  <label>1枚あたり手数料（円）（自動）
    <input id="entry-fee-disp" type="number" value="${r.feePerUnit ?? ""}" readonly>
  </label>

`;

    if (elExitDetailsSide) elExitDetailsSide.innerHTML = `

  <label>決済理由
      <select id="exit-reason">
        <option value="">（未選択）</option>
        <option value="自動決済" ${r.exitReason === "自動決済" ? "selected" : ""}>自動決済</option>
        <option value="同値撤退" ${r.exitReason === "同値撤退" ? "selected" : ""}>同値撤退</option>
        <option value="EMA Band 薄化" ${r.exitReason === "EMA Band 薄化" ? "selected" : ""}>EMA Band 薄化</option>
        <option value="EMA Band L_prep" ${r.exitReason === "EMA Band L_prep" ? "selected" : ""}>EMA Band L_prep</option>
        <option value="EMA Band S_prep" ${r.exitReason === "EMA Band S_prep" ? "selected" : ""}>EMA Band S_prep</option>
        <option value="EMA Band GC" ${r.exitReason === "EMA Band GC" ? "selected" : ""}>EMA Band GC</option>
        <option value="EMA Band DC" ${r.exitReason === "EMA Band DC" ? "selected" : ""}>EMA Band DC</option>
        <option value="CMF Value GC" ${r.exitReason === "CMF Value GC" ? "selected" : ""}>CMF Value GC</option>
        <option value="CMF Value DC" ${r.exitReason === "CMF Value DC" ? "selected" : ""}>CMF Value DC</option>
        <option value="CMF SMA GC" ${r.exitReason === "CMF SMA GC" ? "selected" : ""}>CMF SMA GC</option>
        <option value="CMF SMA DC" ${r.exitReason === "CMF SMA DC" ? "selected" : ""}>CMF SMA DC</option>
        <option value="CMF SMA Tilt Down" ${r.exitReason === "CMF SMA Tilt Down" ? "selected" : ""}>CMF SMA Tilt Down</option>
        <option value="CMF SMA Tilt Up" ${r.exitReason === "CMF SMA Tilt Up" ? "selected" : ""}>CMF SMA Tilt Up</option>
        <option value="RSI Value GC" ${r.exitReason === "RSI Value GC" ? "selected" : ""}>RSI Value GC</option>
        <option value="RSI Value DC" ${r.exitReason === "RSI Value DC" ? "selected" : ""}>RSI Value DC</option>
        <option value="その他" ${r.exitReason === "その他" ? "selected" : ""}>その他</option>
      </select>
    </label>

  <label id="exit-reason-other-wrap" class="subfield" ${r.exitReason === "その他" ? "" : "hidden"}>決済理由（その他）
      <input id="exit-reason-other" type="text" value="${escapeHtml(r.exitReasonOther || "")}" placeholder="自由入力（フィルタは対象外）">
    </label>

  <label>決済後の直近高値
    <input id="exit-high" type="number" inputmode="decimal" step="0.1" value="${r.highDuringTrade ?? ""}">
  </label>

  <label>決済後の直近安値
    <input id="exit-low" type="number" inputmode="decimal" step="0.1" value="${r.lowDuringTrade ?? ""}">
  </label>

  <label>決済後の相場
    <select id="post-exit-market">
      <option value="">（未選択）</option>
      <option value="trend_continue" ${r.postExitMarket === "trend_continue" ? "selected" : ""}>トレンド継続</option>
      <option value="reversal_trend" ${r.postExitMarket === "reversal_trend" ? "selected" : ""}>反転してトレンド出現</option>
      <option value="range" ${r.postExitMarket === "range" ? "selected" : ""}>レンジ・もみ合い</option>
    </select>
  </label>

  <label>完成度
    <select id="exit-completion">
      <option value="">（未選択）</option>
      <option value="未完成" ${r.completionStatus === "未完成" ? "selected" : ""}>未完成</option>
      <option value="完全完成" ${r.completionStatus === "完全完成" ? "selected" : ""}>完全完成</option>
      <option value="未入力あり完成" ${r.completionStatus === "未入力あり完成" ? "selected" : ""}>未入力あり完成</option>
    </select>
  </label>

  <label id="tae-wrap" ${showTae ? "" : "hidden"}>耐え値
    <input id="tae-value" type="number" inputmode="decimal" step="0.1" value="${taeDisp}" readonly>
  </label>
  <p id="tae-note" class="muted small" ${showTae ? "" : "hidden"}>
    ※ ロング=決済価格-直近安値 / ショート=直近高値-決済価格
  </p>

  <label>メモ
      <textarea id="resultMemo" rows="4" placeholder="振り返り">${escapeHtml(r.resultMemo || "")}</textarea>
    </label>
`;

    updateExitEditUI();

    // 画像（任意）はUIから削除済み（過去データは保持）。
    // live update profit / 耐え値 when numbers change
    const bind = (idSel, extraFn) => {
      const el = $(idSel);
      if (!el) return;
      el.addEventListener("input", () => {
        if (typeof extraFn === "function") extraFn();
        updateExitProfitPreview(r);
      });
    };
    bind("#exit-price");
    bind("#exit-high");
    bind("#exit-low");
    bind("#resultMemo");
    bind("#exit-datetime", syncExitWeekdayFromDatetime);
    $("#post-exit-market")?.addEventListener("change", () => updateExitProfitPreview(r));
    $("#exit-completion")?.addEventListener("change", () => updateExitProfitPreview(r));

    // 決済理由（Exit）: "その他" のときだけ自由入力を表示
    $("#exit-reason")?.addEventListener("change", () => {
      toggleOtherWrap($("#exit-reason"), $("#exit-reason-other-wrap"), $("#exit-reason-other"));
      updateExitProfitPreview(r);
    });

    updateExitProfitPreview(r);
  }

  function computeProfit(symbol, direction, entryPrice, exitPrice, feePerUnit, size) {
    if (![entryPrice, exitPrice, feePerUnit, size].every((n) => typeof n === "number" && Number.isFinite(n))) return null;
    const mult = symbolMultiplier(symbol);
    // 正式：((±(決済-エントリー)×銘柄倍率) - 手数料) × 枚数
    // feePerUnit は「1枚あたりの手数料（円）」想定
    let diff = 0;
    if (direction === "long") diff = (exitPrice - entryPrice);
    else if (direction === "short") diff = (entryPrice - exitPrice);
    else diff = 0;

    const profitPerUnit = (diff * mult) - feePerUnit;
    const finalProfit = profitPerUnit * size;
    return Number.isFinite(finalProfit) ? finalProfit : null;
  }

  function computeProfitDetails(symbol, direction, entryPrice, exitPrice, feePerUnit, size, stopPrice) {
    const profitPerUnit = computeProfitPerUnit(symbol, direction, entryPrice, exitPrice, feePerUnit);
    const profit = (profitPerUnit != null && typeof size === "number" && Number.isFinite(size))
      ? (profitPerUnit * size)
      : null;

    const riskPerUnit = computeRiskPerUnit(symbol, direction, entryPrice, stopPrice);
    const rMultiple = (profitPerUnit != null && riskPerUnit != null) ? (profitPerUnit / riskPerUnit) : null;

    return {
      profit: (Number.isFinite(profit) ? profit : null),
      profitPerUnit: (Number.isFinite(profitPerUnit) ? profitPerUnit : null),
      riskPerUnit: (Number.isFinite(riskPerUnit) ? riskPerUnit : null),
      rMultiple: (Number.isFinite(rMultiple) ? rMultiple : null)
    };
  }


  function updateExitProfitPreview(record) {
    const exitPrice = safeNum($("#exit-price")?.value);
    const high = safeNum($("#exit-high")?.value);
    const low = safeNum($("#exit-low")?.value);
    const postExitMarket = $("#post-exit-market")?.value || "";
    const completionStatus = $("#exit-completion")?.value || "";
    const memo = $("#resultMemo")?.value ?? "";
    const exitReason = $("#exit-reason")?.value || "";
    const exitReasonOther = $("#exit-reason-other")?.value || "";

    const profit = computeProfit(
      record.symbol,
      record.directionTaken || record.directionPlanned,
      record.entryPrice,
      exitPrice,
      record.feePerUnit,
      record.size
    );

    const disp = $("#exitProfitDisp");
    if (disp) {
      disp.textContent = formatYen(profit);
      // colorize for readability
      disp.classList.remove("pos", "neg");
      if (typeof profit === "number" && Number.isFinite(profit)) {
        if (profit > 0) disp.classList.add("pos");
        if (profit < 0) disp.classList.add("neg");
      }
    }

    const durDisp = $("#exitDurationDisp");
    if (durDisp) {
      const dtExit = $("#exit-datetime")?.value || record.datetimeExit || "";
      durDisp.textContent = formatTradeDuration(record.datetimeEntry, dtExit);
    }

    // 耐え値（条件: 決済後の相場=トレンド継続）
    const showTae = (postExitMarket === "trend_continue");
    let taeValue = null;
    if (showTae && exitPrice !== null) {
      const dir = (record.directionTaken || record.directionPlanned || "long");
      if (dir === "long") {
        if (low !== null) taeValue = (exitPrice - low);
      } else if (dir === "short") {
        if (high !== null) taeValue = (high - exitPrice);
      }
    }
    const taeWrap = $("#tae-wrap");
    const taeNote = $("#tae-note");
    const taeInput = $("#tae-value");
    if (taeWrap) taeWrap.hidden = !showTae;
    if (taeNote) taeNote.hidden = !showTae;
    if (taeInput) taeInput.value = (taeValue === null ? "" : taeValue);

    // keep current edits in memory (not saved yet)
    record._tmp = {
      exitPrice,
      highDuringTrade: high,
      lowDuringTrade: low,
      postExitMarket,
      completionStatus,
      taeValue,
      exitReason,
      exitReasonOther,
      resultMemo: memo,
      profit,
      // 画像UIは削除済み。既存データは保持する。
      exitImageData: record.exitImageData ?? null
    };
  }

  function clearExitFormOnly() {
    if (!selectedExitId) return;
    const r = records.find((x) => x.id === selectedExitId);
    if (!r) return;

    // just clear the current inputs shown (does NOT modify storage)
    const setVal = (idSel, v) => {
      const el = $(idSel);
      if (el) el.value = v;
    };
    setVal("#exit-datetime", "");
    setVal("#exit-weekday", "");
    setVal("#exit-price", "");
    setVal("#exit-high", "");
    setVal("#exit-low", "");
    setVal("#post-exit-market", "");
    setVal("#exit-completion", "");
    setVal("#tae-value", "");
    const tw = $("#tae-wrap"); if (tw) tw.hidden = true;
    const tn = $("#tae-note"); if (tn) tn.hidden = true;

    setVal("#exit-reason", "");
    setVal("#exit-reason-other", "");
    const w = $("#exit-reason-other-wrap"); if (w) w.hidden = true;
    setVal("#resultMemo", "");
    const disp = $("#exitProfitDisp");
    if (disp) {
      disp.textContent = "—";
      disp.classList.remove("pos", "neg");
    }
    const durDisp = $("#exitDurationDisp");
    if (durDisp) durDisp.textContent = "—";

    r._tmp = {
      exitPrice: null,
      highDuringTrade: null,
      lowDuringTrade: null,
      postExitMarket: "",
      completionStatus: "",
      taeValue: null,
      exitReason: "",
      exitReasonOther: "",
      resultMemo: "",
      profit: null,
      // 画像UIは削除済み。クリア操作でも既存データは保持。
      exitImageData: r.exitImageData ?? null
    };
    showError(elExitError, "入力欄をクリアしました");
  }

  function clearExitSelectionAndForm() {
    // Clear inputs first (keeps behavior consistent for selected trades)
    if (selectedExitId) {
      clearExitFormOnly();
    } else {
      // nothing selected: still reset the UI
      $("#exit-form")?.reset();

      const disp = $("#exitProfitDisp");
      if (disp) {
        disp.textContent = "—";
        disp.classList.remove("pos", "neg");
      }
      const durDisp = $("#exitDurationDisp");
      if (durDisp) durDisp.textContent = "—";
    }

    // Reset trade selection to default (no selection)
    selectedExitId = null;
    editingExitId = null;
    try { elExitSelect.selectedIndex = -1; } catch (_) {}
    try { elExitSelect.value = ""; } catch (_) {}

    updateExitSelect();
    showError(elExitError, "入力欄とトレード選択をクリアしました");
    // UX: after clear, scroll top and focus exit datetime
    scrollToTopOnly();
  }


  function saveExit() {
    clearMsg();
    if (!selectedExitId) {
      showError(elExitError, "編集するトレードを選択してください。");
      // UX: guide back to top + exit datetime
      scrollToTopOnly();
      return;
    }
    const r = records.find((x) => x.id === selectedExitId);
    if (!r) {
      showError(elExitError, "レコードが見つかりません。");
      scrollToTopOnly();
      return;
    }

    const wasEditing = (editingExitId === selectedExitId);

    const dtExit = $("#exit-datetime")?.value || null;
    const exitPrice = safeNum($("#exit-price")?.value);

    // 必須チェック
    if (!dtExit) {
      window.alert("決済日時は必須です。");
      scrollToTopOnly();
      return;
    }
    if (exitPrice === null) {
      window.alert("決済価格は必須です。");
      scrollToTopOnly();
      return;
    }
    const high = safeNum($("#exit-high")?.value);
    const low = safeNum($("#exit-low")?.value);
    const postExitMarket = $("#post-exit-market")?.value || "";
    const completionStatus = $("#exit-completion")?.value || "";
    const memo = $("#resultMemo")?.value ?? "";
    const exitReason = $("#exit-reason")?.value || "";
    const exitReasonOtherRaw = $("#exit-reason-other")?.value || "";
    const exitReasonOther = (exitReason === "その他") ? exitReasonOtherRaw.trim() : "";


    const stopPrice = (r.cutLossPrice ?? r.lsPrice ?? null);
    const details = computeProfitDetails(
      r.symbol,
      r.directionTaken || r.directionPlanned,
      r.entryPrice,
      exitPrice,
      r.feePerUnit,
      r.size,
      stopPrice
    );

    const profit = details.profit;
    const profitPerUnit = details.profitPerUnit;
    const riskPerUnit = details.riskPerUnit;
    const rMultiple = details.rMultiple;

    // 耐え値（条件: 決済後の相場=トレンド継続）
    let taeValue = null;
    if (postExitMarket === "trend_continue") {
      const dir = (r.directionTaken || r.directionPlanned || "long");
      if (dir === "long") {
        if (low !== null) taeValue = (exitPrice - low);
      } else if (dir === "short") {
        if (high !== null) taeValue = (high - exitPrice);
      }
    }

    const updated = migrateRecord({
      ...r,
      updatedAt: nowISO(),
      datetimeExit: dtExit,
      exitPrice,
      highDuringTrade: high,
      lowDuringTrade: low,
      postExitMarket,
      completionStatus,
      taeValue,
      exitReason,
      exitReasonOther,
      resultMemo: memo,
      profit,
      profitPerUnit,
      riskPerUnit,
      rMultiple,
      // 画像入力UIは削除済み（過去データ保持のため、既存値をそのまま残す）
      exitImageData: r.exitImageData ?? null,
      hasResult: Boolean(dtExit && exitPrice !== null)
    });

    // 画面入力の一時値は保存しない（次回選択時に必ず保存済み値から描画）
    if (updated && typeof updated === "object") delete updated._tmp;

    const idx = records.findIndex((x) => x.id === r.id);
    records[idx] = updated;

    saveRecords();
    // 保存後は「編集中」を解除し、リロード時と同じく未選択状態に戻す
    editingExitId = null;
    selectedExitId = null;
    if (elExitSelect) elExitSelect.selectedIndex = -1;

    updateExitSelect();
    safeRenderStats();
    if (elExitError) elExitError.textContent = "";
    showToast(wasEditing ? "更新しました。" : "保存しました。", "success");
    updateExitEditUI();
    // UX: after save/update, scroll top and focus exit datetime
    scrollToTopOnly();
  }

  /** ---------------------------
   *  Stats
   *  --------------------------*/
  function getFilters() {
    return {
      symbol: $("#filter-symbol")?.value || "",
      timeframe: $("#filter-timeframe")?.value || "",
      tradeType: $("#filter-tradeType")?.value || "",
      direction: $("#filter-direction")?.value || "",
            weekday: $("#filter-weekday")?.value || "",
      session: $("#filter-session")?.value || "",
      tradeMethod: $("#filter-tradeMethod")?.value || "",
indicatorKey: $("#filter-indicatorKey")?.value || "",
      indicatorState: $("#filter-indicatorState")?.value || "",
      tpType: $("#filter-tpType")?.value || "",
      lsType: $("#filter-lsType")?.value || "",
      exitReason: $("#filter-exitReason")?.value || "",
      decisiveIndicator: $("#filter-decisiveIndicator")?.value || "",
      decisiveSignal: $("#filter-decisiveSignal")?.value || "",
      completionStatus: $("#filter-completion")?.value || "",
      winloss: $("#filter-winloss")?.value || "",
      start: $("#filter-start")?.value || "",
      end: $("#filter-end")?.value || ""
    };
  }

function applyFilters(list, f) {
    return list.filter((r) => {
      if (f.symbol && r.symbol !== f.symbol) return false;
      if (f.timeframe && r.timeframe !== f.timeframe) return false;
      if (f.tradeType && r.tradeType !== f.tradeType) return false;
      if (f.direction && (r.directionTaken) !== f.direction) return false;
            if (f.weekday && normalizeWeekdayKey(r.entryWeekdayKey || r.entryWeekday || "") !== f.weekday) return false;
      if (f.session && (r.entrySession || "") !== f.session) return false;
      if (f.tradeMethod && (r.tradeMethod || "") !== f.tradeMethod) return false;
if (f.indicatorKey && f.indicatorState) {
        const m = DECISIVE_FIELD_MAP[f.indicatorKey];
        const prop = (m && m.prop) ? m.prop : f.indicatorKey;
        if ((r[prop] || "") !== f.indicatorState) return false;
      }
      if (f.tpType && (r.tpType || "") !== f.tpType) return false;
      if (f.lsType && (r.lsType || "") !== f.lsType) return false;
      if (f.exitReason && (r.exitReason || "") !== f.exitReason) return false;
      if (f.decisiveIndicator && (r.decisiveIndicator || "") !== f.decisiveIndicator) return false;
      if (f.completionStatus && (r.completionStatus || "") !== f.completionStatus) return false;

      if (f.decisiveSignal) {
        const s = String(f.decisiveSignal);
        if (s.includes("::")) {
          const [k, v] = s.split("::");
          if ((r.decisiveIndicator || "") !== k) return false;
          if ((r.decisiveSignal || "") !== v) return false;
        } else {
          if ((r.decisiveSignal || "") !== s) return false;
        }
      }
if (f.winloss === "win") {
        if (!r.hasResult) return false;
        if (typeof r.profit !== "number" || !Number.isFinite(r.profit) || r.profit <= 0) return false;
      }
      if (f.winloss === "loss") {
        if (!r.hasResult) return false;
        if (typeof r.profit !== "number" || !Number.isFinite(r.profit) || r.profit >= 0) return false;
      }


      const entryDate = parseISODateOnly(r.datetimeEntry);
      if (f.start && entryDate && entryDate < f.start) return false;
      if (f.end && entryDate && entryDate > f.end) return false;

      return true;
    });
  }

  
function clearDateInputsOnly() {
  const elStart = document.getElementById("filter-start");
  const elEnd = document.getElementById("filter-end");
  if (elStart) elStart.value = "";
  if (elEnd) elEnd.value = "";
}


function clearDateRangeFilter() {
  const elStart = document.getElementById("filter-start");
  const elEnd = document.getElementById("filter-end");
  if (elStart) elStart.value = "";
  if (elEnd) elEnd.value = "";
  safeRenderStats();
}


function populateIndicatorStateFilterOptions(indicatorKey) {
  const el = $("#filter-indicatorState");
  if (!el) return;

  const current = el.value || "";

  el.innerHTML = "";
  const opt0 = document.createElement("option");
  opt0.value = "";
  opt0.textContent = "（全て）";
  el.appendChild(opt0);

  if (!indicatorKey) {
    el.disabled = true;
    el.value = "";
    return;
  }

  const m = DECISIVE_FIELD_MAP[indicatorKey];
  const src = m ? document.getElementById(m.elId) : null;

  if (!src || String(src.tagName).toUpperCase() !== "SELECT") {
    el.disabled = true;
    el.value = "";
    return;
  }

  for (const o of Array.from(src.options || [])) {
    const v = String(o.value || "").trim();
    if (!v) continue;
    const t = String(o.textContent || v).trim();

    const opt = document.createElement("option");
    opt.value = v;
    opt.textContent = t;
    el.appendChild(opt);
  }

  el.disabled = false;

  const stillOk = Array.from(el.options).some((o) => o.value === current);
  el.value = stillOk ? current : "";
}


  function populateDecisiveSignalFilterOptions(list, decisiveKey) {
    const el = $("#filter-decisiveSignal");
    if (!el) return;

    const current = el.value || "";
    const map = new Map();

    for (const r of list) {
      const k = (r.decisiveIndicator || "").trim();
      const v = (r.decisiveSignal || "").trim();
      if (!k || !v) continue;

      const text = (r.decisiveSignalText || v).trim();

      if (decisiveKey) {
        if (k !== decisiveKey) continue;
        if (!map.has(v)) map.set(v, text);
      } else {
        const key = `${k}::${v}`;
        const label = `${indicatorLabel(k)}：${text}`;
        if (!map.has(key)) map.set(key, label);
      }
    }

    const entries = Array.from(map.entries()).sort((a, b) => String(a[1]).localeCompare(String(b[1]), "ja"));

    // rebuild options
    el.innerHTML = "";
    const opt0 = document.createElement("option");
    opt0.value = "";
    opt0.textContent = "（全て）";
    el.appendChild(opt0);

    for (const [value, text] of entries) {
      const o = document.createElement("option");
      o.value = value;
      o.textContent = text;
      el.appendChild(o);
    }

    // keep selection if possible, otherwise reset
    const stillOk = Array.from(el.options).some((o) => o.value === current);
    el.value = stillOk ? current : "";
  }


  function renderStatsSummary(list) {
    const closed = list.filter((r) => r.hasResult && typeof r.profit === "number" && Number.isFinite(r.profit));
    const wins = closed.filter((r) => r.profit > 0);
    const losses = closed.filter((r) => r.profit < 0);

    const total = list.length;
    const closedN = closed.length;
    const winRate = closedN ? (wins.length / closedN) * 100 : null;

    const avgProfit = wins.length ? wins.reduce((s, r) => s + r.profit, 0) / wins.length : null;
    const avgLoss = losses.length ? losses.reduce((s, r) => s + r.profit, 0) / losses.length : null;

    const sum = closedN ? closed.reduce((s, r) => s + r.profit, 0) : 0;

    if (!elStatsSummary) return;

    elStatsSummary.innerHTML = `
      <div class="stats-grid">
        <div class="stat">
          <div class="stat-label">件数</div>
          <div class="stat-value">${total}</div>
        </div>
        <div class="stat">
          <div class="stat-label">決済済み</div>
          <div class="stat-value">${closedN}</div>
        </div>
        <div class="stat">
          <div class="stat-label">勝率</div>
          <div class="stat-value">${winRate == null ? "—" : `${Math.round(winRate)}%`}</div>
        </div>
        <div class="stat">
          <div class="stat-label">累積損益</div>
          <div class="stat-value">${formatYen(sum)}</div>
        </div>
        <div class="stat">
          <div class="stat-label">平均利益（勝ちのみ）</div>
          <div class="stat-value">${avgProfit == null ? "—" : formatYen(avgProfit)}</div>
        </div>
        <div class="stat">
          <div class="stat-label">平均損失（負けのみ）</div>
          <div class="stat-value">${avgLoss == null ? "—" : formatYen(avgLoss)}</div>
        </div>
      </div>
    `;
  }

  function completionMark(status) {
    const s = String(status || "").trim();
    if (s === "未完成") return "✖";
    if (s === "完全完成") return "◉";
    if (s === "未入力あり完成") return "〇";
    return "—";
  }

  function renderStatsTable(list) {
    if (!elStatsTable) return;

    elStatsTable.innerHTML = "";

    const sorted = [...list].sort((a, b) => String(b.datetimeEntry || "").localeCompare(String(a.datetimeEntry || "")));

    for (const r of sorted) {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${escapeHtml((r.datetimeEntry || "").replace("T", " ")) || "—"}</td>
        <td>${escapeHtml(displayTimeframe(r.timeframe))}</td>
        <td>${escapeHtml(toJpDir(r.directionPlanned))}</td>
        <td>${escapeHtml(indicatorLabel(r.decisiveIndicator)) || "—"}</td>
        <td>${escapeHtml((r.decisiveSignalText || r.decisiveSignal) || "") || "—"}</td>
        <td>${escapeHtml(displayTpType(r.tpType, r.tpTypeOther))}</td>
        <td>${escapeHtml(displayLsType(r.lsType, r.lsTypeOther))}</td>
        <td>${escapeHtml(r.exitReason === "その他" ? (r.exitReasonOther || "その他") : (r.exitReason || "—"))}</td>
        <td class="${r.profit > 0 ? "pos" : (r.profit < 0 ? "neg" : "")}">${r.hasResult ? formatYen(r.profit) : "—"}</td>
        <td>${r.hasResult ? "決済済み" : "未決済"}</td>
        <td>${escapeHtml(r.entryDevice || "") || "—"}</td>
        <td>${completionMark(r.completionStatus)}</td>
        <td>
          <div class="row-actions">
            <button type="button" class="btn-mini" data-act="edit-entry" data-id="${r.id}">エントリー編集</button>
            <button type="button" class="btn-mini" data-act="edit-exit" data-id="${r.id}">結果編集</button>
            <button type="button" class="btn-mini danger" data-act="delete" data-id="${r.id}">削除</button>
          </div>
        </td>
      `;
      elStatsTable.appendChild(tr);
    }

    // bind actions (event delegation)
    elStatsTable.querySelectorAll("button[data-act]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const id = btn.dataset.id;
        const act = btn.dataset.act;
        if (act === "edit-entry") {
          loadRecordToEntry(id);
          gotoTab("entry");
          window.scrollTo({ top: 0, behavior: "smooth" });
          setTimeout(() => { $("#entry-datetime")?.focus(); }, 0);
        } else if (act === "edit-exit") {
          selectedExitId = id;
          const r = records.find((x) => x.id === id);
          editingExitId = (r && r.hasResult) ? id : null;
          // StatsからExit編集へ遷移する場合は、選択中のレコードを強制的に反映する
          // （Exit側の現在選択や「未決済のみ表示」による除外の影響を受けないようにする）
          updateExitSelect(id);
          gotoTab("exit");
          // Same UX as 「エントリー編集」: exitタブへ移動したら先頭へスクロール
          setTimeout(() => {
            $("#exit-tab")?.scrollIntoView({ block: "start", behavior: "smooth" });
            window.scrollTo({ top: 0, behavior: "smooth" });
            $("#exit-select")?.focus();
          }, 0);
        } else if (act === "delete") {
          deleteRecord(id);
        }
      });
    });
  }

  function loadRecordToEntry(id) {
    const r = records.find((x) => x.id === id);
    if (!r) return;

    editingEntryId = r.id;
    updateEntryEditUI();

    $("#entry-datetime").value = r.datetimeEntry || "";
    $("#entry-symbol").value = r.symbol || "nk225mc";
    $("#entry-timeframe").value = normalizeTimeframe(r.timeframe || "1h");
    $("#entry-tradeType").value = r.tradeType || "";
    $("#entry-direction").value = (r.directionPlanned === "long" || r.directionPlanned === "short") ? r.directionPlanned : "";

    
    // Entry extras
    if ($("#entry-session")) $("#entry-session").value = r.entrySession || "";
    if ($("#entry-tradeMethod")) $("#entry-tradeMethod").value = r.tradeMethod || "";
    if ($("#entry-weekday")) $("#entry-weekday").value = r.entryWeekday || weekdayFromDatetimeLocal(r.datetimeEntry) || "";
    if ($("#entry-device")) $("#entry-device").value = r.entryDevice || detectDeviceLabel();
$("#entry-price").value = r.entryPrice ?? "";
    $("#entry-size").value = r.size ?? "";
    $("#entry-fee").value = r.feePerUnit ?? "";

    $("#entry-LimitPrice").value = r.plannedLimitPrice ?? "";
    $("#entry-LossPrice").value = r.cutLossPrice ?? "";
    if ($("#entry-tpType")) $("#entry-tpType").value = r.tpType || "";
    if ($("#entry-tpTypeOther")) $("#entry-tpTypeOther").value = r.tpTypeOther || "";
    if ($("#entry-lsType")) $("#entry-lsType").value = r.lsType || "";
    if ($("#entry-lsTypeOther")) $("#entry-lsTypeOther").value = r.lsTypeOther || "";
    toggleOtherWrap($("#entry-tpType"), $("#entry-tpType-other-wrap"), $("#entry-tpTypeOther"), [OTHER_TP_VALUE, "その他"]);
    toggleOtherWrap($("#entry-lsType"), $("#entry-lsType-other-wrap"), $("#entry-lsTypeOther"), [OTHER_LS_VALUE, "その他"]);
    updateEntryRRPreview();

    $("#ind-waveCount").value = r.waveCount || "";
    $("#ind-dowShape").value = r.dowShape || "";
    $("#ind-trend_5_20_40").value = r.trend_5_20_40 || "";
    $("#ind-price_vs_ema200").value = r.price_vs_ema200 || "";
    $("#ind-ema_band_color").value = r.ema_band_color || "";
    $("#ind-atr_zone").value = r.zone || "";
    $("#ind-cmf_sign").value = r.cmf_sign || "";
    $("#ind-cmf_sma").value = r.cmf_sma_dir || "";
    $("#ind-MACD").value = r.macd_state || "";
    $("#ind-roc_sign").value = r.roc_sign || "";
    $("#ind-roc_sma").value = r.roc_sma_dir || "";
    $("#ind-RSI").value = r.rsi_zone || "";

    $("#entry-decisiveIndicator").value = r.decisiveIndicator || "";
    setEntryDecisiveSignalDisplay();

    $("#entry-marketMemo").value = r.marketMemo || "";
    $("#entry-minWinRate").value = String(r.minWinRate ?? 30);
    // 判定結果は「判定する」or「判定して保存」を押した時だけ表示
    resetJudgeOutput();
  }

  function deleteRecord(id) {
    const r = records.find((x) => x.id === id);
    if (!r) return;

    const ok = window.confirm("このトレード記録を削除しますか？（元に戻せません）");
    if (!ok) return;

    records = records.filter((x) => x.id !== id);
    saveRecords();

    // If currently editing that record, clear forms
    if (editingEntryId === id) clearEntryForm();
    if (selectedExitId === id) {
      selectedExitId = null;
      updateExitSelect();
    }

    safeRenderStats();
  }

  /** ---------------------------
   *  Charts
   *  --------------------------*/
  function destroyCharts() {
    for (const c of [chartCumulative, chartDirection, chartTimeframe]) {
      if (c) c.destroy();
    }
    chartCumulative = chartDirection = chartTimeframe = null;
  }

  function renderCharts(list) {
    const closed = list.filter((r) => r.hasResult && typeof r.profit === "number" && Number.isFinite(r.profit))
      .sort((a, b) => String(a.datetimeExit || a.datetimeEntry || "").localeCompare(String(b.datetimeExit || b.datetimeEntry || "")));

    // Chart 1: cumulative profit
    const labels1 = [];
    const data1 = [];
    let cum = 0;
    for (const r of closed) {
      const label = (r.datetimeExit || r.datetimeEntry || "").replace("T", " ").slice(0, 16) || "—";
      labels1.push(label);
      cum += r.profit || 0;
      data1.push(cum);
    }

    // Chart 2: direction avg profit
    const dirs = ["long", "short"];
    const labels2 = dirs.map(toJpDir);
    const avg2 = [];

    for (const d of dirs) {
      const group = closed.filter((r) => (r.directionTaken || r.directionPlanned) === d);
      const n = group.length;
      avg2.push(n ? group.reduce((s, r) => s + (r.profit || 0), 0) / n : 0);
    }

    // Chart 3: timeframe win rate
    const tfMap = new Map();
    for (const r of closed) {
      const tf = r.timeframe || "—";
      const obj = tfMap.get(tf) || { n: 0, w: 0 };
      obj.n += 1;
      if (r.profit > 0) obj.w += 1;
      tfMap.set(tf, obj);
    }
    const labels3 = Array.from(tfMap.keys());
    const data3 = labels3.map((k) => {
      const v = tfMap.get(k);
      return v.n ? (v.w / v.n) * 100 : 0;
    });

    destroyCharts();

    // If Chart.js missing, skip silently
    if (!window.Chart) return;

    const ctx1 = $("#chartCumulative");
    if (ctx1) {
      chartCumulative = new Chart(ctx1, {
        type: "line",
        data: {
          labels: labels1,
          datasets: [{ label: "累積損益", data: data1 }]
        },
        options: { responsive: true, maintainAspectRatio: false }
      });
    }

    const ctx2 = $("#chartDirection");
    if (ctx2) {
      chartDirection = new Chart(ctx2, {
        type: "bar",
        data: {
          labels: labels2,
          datasets: [
            { label: "平均損益(円)", data: avg2 }
          ]
        },
        options: { responsive: true, maintainAspectRatio: false }
      });
    }

    const ctx3 = $("#chartTimeframe");
    if (ctx3) {
      chartTimeframe = new Chart(ctx3, {
        type: "bar",
        data: {
          labels: labels3,
          datasets: [{ label: "勝率(%)", data: data3 }]
        },
        options: { responsive: true, maintainAspectRatio: false }
      });
    }
  }
function safeRenderStats() {
  try {
    const st = $("#stats-tab");
    // Statsが非表示の間に描画するとチャートが0幅になりやすいので、表示時のみ描画
    if (st && st.hidden) return;
    renderStats();
} catch (e) {
    console.error("renderStats failed:", e);
    if (elStatsSummary) elStatsSummary.innerHTML = `<p class="muted">Statsの表示でエラーが発生しました。コンソールをご確認ください。</p>`;
    if (elStatsTable) elStatsTable.innerHTML = "";
  }
}



  function renderStats() {
    const f = getFilters();

    // 決め手サインの候補は「他の条件で絞った結果」から作る（サイン自体で絞る前）
    const fNoSig = { ...f, decisiveSignal: "" };
    const candidates = applyFilters(records, fNoSig);
    populateDecisiveSignalFilterOptions(candidates, f.decisiveIndicator);

    const filtered = applyFilters(candidates, f);

    renderStatsSummary(filtered);
    renderStatsTable(filtered);
    renderCharts(filtered);
  }

  // Statsタブで表示中の「フィルタ適用後データ」を取得（CSV出力用）
  function getStatsFilteredRecords() {
    const f = getFilters();
    const fNoSig = { ...f, decisiveSignal: "" };
    const candidates = applyFilters(records, fNoSig);
    const filtered = applyFilters(candidates, f);
    return filtered;
  }



  /** ---------------------------
   *  Export / Import
   *  --------------------------*/
  function downloadText(filename, text, mime) {
    const blob = new Blob([text], { type: mime || "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  function exportJSON() {
    const payload = { version: 1, records };
    downloadText(`trades_${new Date().toISOString().slice(0,10)}.json`, JSON.stringify(payload, null, 2), "application/json");
  }

  function importJSONFile(file) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result || ""));
        if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.records)) {
          alert("JSON形式が不正です。（version:1 かつ records配列が必要）");
          return;
        }
        const incoming = parsed.records.map(migrateRecord);

        const map = new Map(records.map((r) => [r.id, r]));
        let added = 0;
        let updated = 0;

        for (const inc of incoming) {
          const cur = map.get(inc.id);
          if (!cur) {
            map.set(inc.id, inc);
            added++;
          } else {
            const curTs = Date.parse(cur.updatedAt || cur.createdAt || "");
            const incTs = Date.parse(inc.updatedAt || inc.createdAt || "");
            if (Number.isFinite(incTs) && Number.isFinite(curTs) && incTs > curTs) {
              map.set(inc.id, inc);
              updated++;
            }
          }
        }

        records = Array.from(map.values()).sort((a, b) => String(b.datetimeEntry || "").localeCompare(String(a.datetimeEntry || "")));
        saveRecords();
        updateExitSelect();
        safeRenderStats();

        alert(`インポート完了：追加 ${added} 件 / 更新 ${updated} 件`);
      } catch (e) {
        console.warn(e);
        alert("JSONの読み込みに失敗しました。");
      }
    };
    reader.readAsText(file);
  }

  function exportCSV(list = records) {
    // Flatten rows (exclude imageData)
    const cols = [
      "id","createdAt","updatedAt",
      "datetimeEntry","entryWeekday","entrySession","symbol","timeframe","tradeType","directionPlanned",
      "entryPrice","size","feePerUnit","plannedLimitPrice","cutLossPrice","tpType","tpTypeOther","lsType","lsTypeOther","rr",
      "waveCount","dowShape","trend_5_20_40","price_vs_ema200","ema_band_color","zone",
      "cmf_sign","cmf_sma_dir","macd_state","roc_sign","roc_sma_dir","rsi_zone",
      "decisiveIndicator","decisiveSignal","decisiveSignalText",
      "minWinRate",
      "tradeMethod",
      "recommendation","expectedMove","expectedMoveUnit","confidence","winRate","avgProfit","avgLoss","pseudoCaseCount",
      "hasResult","datetimeExit","exitPrice","highDuringTrade","lowDuringTrade","exitReason","exitReasonOther","profit",
      "marketMemo","notionUrl","resultMemo"
    ];

    const esc = (v) => {
      if (v === null || v === undefined) return "";
      const s = String(v);
      // escape quotes and wrap if needed
      const needs = /[",\n\r]/.test(s);
      const out = s.replace(/"/g, '""');
      return needs ? `"${out}"` : out;
    };

    const lines = [];
    lines.push(cols.join(","));
    for (const r0 of list) {
      const r = migrateRecord(r0);
      const row = cols.map((c) => esc(r[c]));
      lines.push(row.join(","));
    }

    downloadText(`trades_${new Date().toISOString().slice(0,10)}.csv`, lines.join("\n"), "text/csv");
  }

  /** ---------------------------
   *  Helpers for UI strings
   *  --------------------------*/
  function formatYen(v) {
    if (typeof v !== "number" || !Number.isFinite(v)) return "—";
    return Math.round(v).toLocaleString("ja-JP") + "円";
  }

  
  function formatTradeDuration(entryISO, exitISO) {
    if (!entryISO || !exitISO) return "—";
    const a = new Date(entryISO);
    const b = new Date(exitISO);
    const ta = a.getTime();
    const tb = b.getTime();
    if (!Number.isFinite(ta) || !Number.isFinite(tb)) return "—";
    const diff = tb - ta;
    if (!Number.isFinite(diff) || diff < 0) return "—";

    const totalMin = Math.floor(diff / 60000);
    const days = Math.floor(totalMin / (60 * 24));
    const hours = Math.floor((totalMin % (60 * 24)) / 60);
    const mins = totalMin % 60;
    return `${days}日${hours}時間${mins}分`;
  }

function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  /** ---------------------------
   *  Bindings
   *  --------------------------*/
  function bind() {
    $("#btn-judge")?.addEventListener("click", () => onJudge(false));
    $("#btn-save-entry")?.addEventListener("click", () => onJudge(true));
    $("#btn-clear-entry")?.addEventListener("click", () => clearEntryForm());

    
    $("#entry-datetime")?.addEventListener("change", syncEntryWeekdayFromDatetime);
    $("#entry-datetime")?.addEventListener("input", syncEntryWeekdayFromDatetime);
elExitSelect?.addEventListener("change", () => {
      selectedExitId = elExitSelect.value || null;
      if (!selectedExitId) {
        editingExitId = null;
        if (elExitDetailsMain) elExitDetailsMain.innerHTML = `<p class="muted">リストからトレードを選択してください。</p>`;
        if (elExitDetailsSide) elExitDetailsSide.innerHTML = ``;
        updateExitEditUI();
        return;
      }

      const r = records.find((x) => x.id === selectedExitId);
      editingExitId = (r && r.hasResult) ? selectedExitId : null;
      renderExitDetails(selectedExitId);
    });

    // Exit: filter toggle (未決済のみ表示)
    $("#exit-only-open")?.addEventListener("change", () => updateExitSelect());
    $("#btn-exit-clear")?.addEventListener("click", () => clearExitSelectionAndForm());
    $("#btn-exit-save")?.addEventListener("click", () => saveExit());



    // TP/LS種別（Entry）: "その他" のときだけ自由入力を表示
    $("#entry-tpType")?.addEventListener("change", () => {
      toggleOtherWrap($("#entry-tpType"), $("#entry-tpType-other-wrap"), $("#entry-tpTypeOther"), [OTHER_TP_VALUE, "その他"]);
    });
    $("#entry-lsType")?.addEventListener("change", () => {
      toggleOtherWrap($("#entry-lsType"), $("#entry-lsType-other-wrap"), $("#entry-lsTypeOther"), [OTHER_LS_VALUE, "その他"]);
    });

    // RR（Entry）: 価格が変わったら自動更新
    $("#entry-price")?.addEventListener("input", updateEntryRRPreview);
    $("#entry-LimitPrice")?.addEventListener("input", updateEntryRRPreview);
    $("#entry-LossPrice")?.addEventListener("input", updateEntryRRPreview);
    $("#entry-direction")?.addEventListener("change", updateEntryRRPreview);

    // 決め手サイン（Entry）: 決め手インジ or 元のインジ入力が変わったら自動反映
    $("#entry-decisiveIndicator")?.addEventListener("change", () => setEntryDecisiveSignalDisplay());
    for (const m of Object.values(DECISIVE_FIELD_MAP)) {
      document.getElementById(m.elId)?.addEventListener("change", () => setEntryDecisiveSignalDisplay());
    }

    // 決め手サイン（Stats）: 決め手インジを変えたらサイン候補を組み替える
    $("#filter-decisiveIndicator")?.addEventListener("change", () => {
      const elSig = $("#filter-decisiveSignal");
      if (elSig) elSig.value = "";
      const f = getFilters();
      const fNoSig = { ...f, decisiveSignal: "" };
      const candidates = applyFilters(records, fNoSig);
      populateDecisiveSignalFilterOptions(candidates, f.decisiveIndicator);
    });


    // インジ状態フィルタ（Stats）: インジを変えたら状態候補を組み替える
    $("#filter-indicatorKey")?.addEventListener("change", (e) => {
      const key = e?.target?.value || "";
      const elState = $("#filter-indicatorState");
      if (elState) elState.value = "";
      populateIndicatorStateFilterOptions(key);
    });

    $("#btn-apply-filter")?.addEventListener("click", () => renderStats());
    $("#btn-clear-date")?.addEventListener("click", () => clearDateInputsOnly());
    $("#btn-clear-filter")?.addEventListener("click", () => {
      $("#filter-symbol").value = "";
      $("#filter-timeframe").value = "";
      $("#filter-tradeType").value = "";
      $("#filter-direction").value = "";
            $("#filter-weekday").value = "";
      $("#filter-session").value = "";
      $("#filter-tradeMethod").value = "";
$("#filter-indicatorKey").value = "";
      $("#filter-indicatorState").value = "";
      populateIndicatorStateFilterOptions("");
      $("#filter-tpType").value = "";
      $("#filter-lsType").value = "";
      $("#filter-exitReason").value = "";
      $("#filter-decisiveIndicator").value = "";
      $("#filter-decisiveSignal").value = "";
      $("#filter-completion").value = "";
      $("#filter-winloss").value = "";
      $("#filter-start").value = "";
      $("#filter-end").value = "";
      safeRenderStats();
    });

    $("#btnExportJson")?.addEventListener("click", exportJSON);
    $("#btnImportJson")?.addEventListener("click", () => $("#import-file")?.click());
    $("#import-file")?.addEventListener("change", (e) => {
      const file = e.target.files && e.target.files[0];
      if (file) importJSONFile(file);
      e.target.value = "";
    });

    $("#btnExportCsv")?.addEventListener("click", () => exportCSV(getStatsFilteredRecords()));
}

  /** ---------------------------
   *  Init
   *  --------------------------*/
  
function init() {
  initTabs();
  populateDecisiveIndicatorSelects();
  populateIndicatorStateFilterOptions($("#filter-indicatorKey")?.value || "");
  setEntryDecisiveSignalDisplay();

  records = loadRecords();
  saveRecords(); // normalize/migrate on load

  bind();
  initMasterTab();
  updateExitSelect();

  // Stats デフォルト日付（1週間）
  setDefaultStatsRangeLast7Days();
  safeRenderStats();

  clearEntryForm();
  updateEntryEditUI();
}


  document.addEventListener("DOMContentLoaded", init);
})();
