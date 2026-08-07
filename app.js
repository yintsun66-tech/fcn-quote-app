import {
  MAIL_INSTITUTION_ORDER as SHARED_MAIL_INSTITUTION_ORDER,
  branchSubjectLabel,
  buildInstitutionEmail as buildSharedInstitutionEmail,
  buildStaticRequesterSubject,
} from "./backend/shared/email-formats.js?v=static-requester-v1";
import {
  HOTLIST_CONSENT_KEY,
  hotlistDescriptor,
  hotlistWidgetUrl,
} from "./market-resources.mjs?v=market-hotlist-v4";
import {
  ZIMBRA_URL_STORAGE_KEY,
  buildMailtoUrl,
  buildZimbraComposeUrl,
} from "./mail-compose.mjs?v=zimbra-compose-v1";
import { loadHtml2Canvas } from "./html2canvas-loader.mjs?v=lazy-render-v1";

(() => {
  "use strict";

  const MAX_ROWS = 20;
  const DRAFT_STORAGE_KEY = "fcn-quote-app.trade-draft.v1";
  const STATIC_IDENTITY_STORAGE_KEY = "fcn-quote-app.static-requester.v1";
  const ROW_CHANGE_DEBOUNCE_MS = 250;
  const MAIL_TO = "i14053@firstbank.com.tw";
  const DEFAULT_MAIL_SUBJECT = "BMJB[詢價]FCBKTPE: FCN(T+7)";
  const tableBody = document.querySelector("#quoteTable tbody");
  const status = document.querySelector("#status");
  const bbgLookup = new Map();
  const quotePreviewPanel = document.querySelector("#quotePreviewPanel");
  const quoteSheet = document.querySelector("#quoteSheet");
  const issuerDialog = document.querySelector("#issuerDialog");
  const issuerSelect = document.querySelector("#issuerSelect");
  const issuerWarning = document.querySelector("#issuerWarning");
  const emailIssuerDialog = document.querySelector("#emailIssuerDialog");
  const emailIssuerSelect = document.querySelector("#emailIssuerSelect");
  const emailQueueDialog = document.querySelector("#emailQueueDialog");
  const emailQueueProgress = document.querySelector("#emailQueueProgress");
  const emailQueueDetail = document.querySelector("#emailQueueDetail");
  const emailClipboardStatus = document.querySelector("#emailClipboardStatus");
  const zimbraUrlInput = document.querySelector("#zimbraUrl");
  const tradeNavigator = document.querySelector("#tradeNavigator");
  const tradeShortcuts = document.querySelector("#tradeShortcuts");
  const activeTradeLabel = document.querySelector("#activeTradeLabel");
  const staticIdentityNotice = document.querySelector("#staticIdentityNotice");
  const staticIdentitySummary = document.querySelector("#staticIdentitySummary");
  const staticIdentityDialog = document.querySelector("#staticIdentityDialog");
  const staticIdentityForm = document.querySelector("#staticIdentityForm");
  const staticBranchName = document.querySelector("#staticBranchName");
  const staticEmployeeNumber = document.querySelector("#staticEmployeeNumber");
  const staticIdentityError = document.querySelector("#staticIdentityError");
  const isStaticSite = location.hostname !== "app.yintsun66.com"
    && new URLSearchParams(location.search).get("backend") !== "1";
  let selectedIssuer = "BNP";
  let issuerDialogMode = "download";
  let emailQueue = [];
  let emailQueueIndex = -1;

  /**
   * The mail queue survives a reload.
   *
   * This is the one piece of state whose loss has consequences outside the browser: the operator
   * sends up to eight separate emails by hand, and a reload at email five used to reset the counter
   * with no way to tell which issuers had already received one. Sending again is not free — the
   * issuer receives a duplicate RFQ.
   *
   * The built payloads are stored, not the institution keys, so a resumed run sends exactly what
   * the earlier emails contained even if the table has since been edited. Rebuilding from the
   * current table would silently make email six disagree with emails one to five.
   */
  const MAIL_QUEUE_STORAGE_KEY = "fcn-quote-app.mail-queue.v1";

  function saveMailQueue() {
    try {
      if (!emailQueue.length || emailQueueIndex < 0) {
        window.localStorage.removeItem(MAIL_QUEUE_STORAGE_KEY);
        return;
      }
      window.localStorage.setItem(MAIL_QUEUE_STORAGE_KEY, JSON.stringify({
        version: 1, queue: emailQueue, index: emailQueueIndex, savedAt: Date.now()
      }));
    } catch {
      // Storage full or blocked. The flow still works; only its resumability is lost, and saying so
      // is better than letting the operator believe the progress is safe.
      setStatus("瀏覽器無法保存寄送進度；若中途重新整理將無法接續。");
    }
  }

  /**
   * Offers to resume an interrupted send on load, as a banner rather than a modal.
   *
   * A dialog that opens by itself before the operator has looked at the page gets dismissed on
   * reflex, and dismissing this one silently discards the thing it was protecting. A banner waits.
   */
  function offerMailQueueResume() {
    const saved = readSavedMailQueue();
    if (!saved) return;

    const bar = document.createElement("div");
    bar.className = "resume-bar";
    bar.setAttribute("role", "status");

    const text = document.createElement("span");
    const done = saved.index;
    text.textContent = `上次的詢價郵件流程停在第 ${saved.index + 1} / ${saved.queue.length} 封`
      + (done ? `，前 ${done} 封已寄出。` : "。");

    const resume = document.createElement("button");
    resume.type = "button";
    resume.className = "resume-bar-action";
    resume.textContent = "接續寄送";
    resume.addEventListener("click", async () => {
      emailQueue = saved.queue;
      emailQueueIndex = saved.index;
      bar.remove();
      zimbraUrlInput.value = storedZimbraUrl();
      try { await prepareQueuedEmail(); } catch (error) { setStatus(error.message); }
    });

    const discard = document.createElement("button");
    discard.type = "button";
    discard.className = "resume-bar-dismiss";
    discard.textContent = "放棄這次流程";
    discard.addEventListener("click", () => {
      emailQueue = [];
      emailQueueIndex = -1;
      saveMailQueue();
      bar.remove();
      setStatus("已放棄上次未完成的詢價郵件流程。", true);
    });

    bar.append(text, resume, discard);
    status.insertAdjacentElement("afterend", bar);
  }

  function readSavedMailQueue() {
    try {
      const raw = window.localStorage.getItem(MAIL_QUEUE_STORAGE_KEY);
      if (!raw) return null;
      const saved = JSON.parse(raw);
      if (saved?.version !== 1 || !Array.isArray(saved.queue) || !saved.queue.length) return null;
      if (!Number.isInteger(saved.index) || saved.index < 0 || saved.index >= saved.queue.length) return null;
      return saved;
    } catch { return null; }
  }
  let emailClipboardFormat = "none";
  let rowChangeTimer = 0;
  let bbgLookupPromise = null;
  let activeTradeIndex = 0;
  let tradeScrollFrame = 0;
  let staticIdentity = null;

  const issuerProfiles = {
    BNP: { name: "BNP PARIBAS", shortName: "BNP", theme: "bnp" },
    BARCLAYS: { name: "BARCLAYS", shortName: "BARCLAYS", theme: "barclays" },
    MS: { name: "MORGAN STANLEY", shortName: "MS", theme: "ms", disclaimer: "OBU 不得承做" },
    JPM: { name: "J.P. MORGAN", shortName: "JPM", theme: "jpm" },
    NOMURA: { name: "NOMURA", shortName: "NOMURA", theme: "nomura" },
    UBS: { name: "UBS", shortName: "UBS", theme: "ubs" },
    DBS: { name: "DBS", shortName: "DBS", theme: "dbs" },
    SG: { name: "SOCIETE GENERALE", shortName: "SG", theme: "sg" },
    CITI: { name: "CITIGROUP", shortName: "CITI", theme: "citi" },
    GS: { name: "GOLDMAN SACHS", shortName: "GS", theme: "gs" },
    CA: { name: "CREDIT AGRICOLE CIB", shortName: "CA", theme: "ca" },
  };

  const fields = [
    ["product", "Product"], ["currency", "Currency"], ["guaranteedPeriods", "Guaranteed Periods (m)"],
    ["bbgCode1", "BBG Code 1"], ["bbgCode2", "BBG Code 2"], ["bbgCode3", "BBG Code 3"],
    ["bbgCode4", "BBG Code 4"], ["bbgCode5", "BBG Code 5"], ["strike", "Strike (%)"],
    ["koType", "KO Type"], ["koBarrier", "KO Barrier (%)"], ["coupon", "Coupon p.a. (%)"],
    ["upfront", "Upfront / NotePrice (%)"], ["tenor", "Tenor (m)"], ["barrierType", "Barrier Type"],
    ["kiBarrier", "KI Barrier (%)"], ["observationFrequency", "Observation Frequency (m)"],
    ["otc", "OTC"], ["effectiveDateOffset", "Effective Date Offset (Calendar Days)"], ["tradeDate", "Trade Date"],
  ];
  const fieldGroups = {
    product: "basic", currency: "basic", tradeDate: "basic", tenor: "basic",
    bbgCode1: "underlying", bbgCode2: "underlying", bbgCode3: "underlying", bbgCode4: "underlying", bbgCode5: "underlying",
    strike: "payoff", koType: "payoff", koBarrier: "payoff", coupon: "payoff", upfront: "payoff",
    guaranteedPeriods: "risk", barrierType: "risk", kiBarrier: "risk", observationFrequency: "risk", otc: "risk", effectiveDateOffset: "risk",
  };

  const sourceColumn = (label, name) => ({ label, value: row => rowValue(row, name) });
  const blankColumn = label => ({ label, value: () => "" });
  const productColumn = (label, fcnCode, dacCode) => ({ label, value: row => productForIssuer(row, fcnCode, dacCode) });
  const mailInstitutionOrder = ["BMJB", "NOMURA", "UBS", "DBS", "SG", "CITI", "GS", "CA"];

  // 依附件 Excel 的工作表 A 欄至指定終欄建立欄位；每一筆網頁交易即對應 Excel 的一列。
  const emailInstitutions = {
    BMJB: {
      label: "BNP MS JPM 巴克萊", subject: DEFAULT_MAIL_SUBJECT,
      columns: fields.map(([name, label]) => sourceColumn(label, name)),
    },
    NOMURA: {
      label: "Nomura", subject: "野村[詢價]FCBKTPE: FCN(T+7)",
      columns: [
        productColumn("Product", "FCN", "DRA"), sourceColumn("Currency", "currency"), sourceColumn("Non-call Periods", "guaranteedPeriods"),
        { label: "Guaranteed Coupon Periods", value: row => productForIssuer(row, "", rowValue(row, "guaranteedPeriods")) },
        sourceColumn("BBG Code 1", "bbgCode1"), sourceColumn("BBG Code 2", "bbgCode2"), sourceColumn("BBG Code 3", "bbgCode3"), sourceColumn("BBG Code 4", "bbgCode4"), sourceColumn("BBG Code 5", "bbgCode5"),
        sourceColumn("Strike (%)", "strike"), sourceColumn("KO Type", "koType"), sourceColumn("KO Barrier (%)", "koBarrier"), sourceColumn("Coupon p.a. (%)", "coupon"), sourceColumn("Upfront / NotePrice (%)", "upfront"), sourceColumn("Tenor (m)", "tenor"), sourceColumn("Barrier Type", "barrierType"), sourceColumn("KI Barrier (%)", "kiBarrier"), sourceColumn("Observation Frequency (m)", "observationFrequency"), sourceColumn("OTC", "otc"), blankColumn("Funding Spread (bps)"), { label: "Effective Date Offset", value: () => "7" }, sourceColumn("Trade Date", "tradeDate"),
      ],
    },
    UBS: {
      label: "UBS", subject: "UBS[詢價]FCBKTPE: FCN(T+7)",
      columns: [
        productColumn("Product", "FCN", "WRA"), sourceColumn("Guaranteed Periods (m)", "guaranteedPeriods"), sourceColumn("Currency", "currency"), sourceColumn("BBG Code 1", "bbgCode1"), sourceColumn("BBG Code 2", "bbgCode2"), sourceColumn("BBG Code 3", "bbgCode3"), sourceColumn("BBG Code 4", "bbgCode4"), sourceColumn("BBG Code 5", "bbgCode5"), sourceColumn("Strike (%)", "strike"), sourceColumn("KO Type", "koType"), sourceColumn("KO Barrier (%)", "koBarrier"), sourceColumn("Coupon p.a. (%)", "coupon"), sourceColumn("Upfront / NotePrice (%)", "upfront"), sourceColumn("Tenor (m)", "tenor"), sourceColumn("Barrier Type", "barrierType"), sourceColumn("KI Barrier (%)", "kiBarrier"), sourceColumn("Observation Frequency (m)", "observationFrequency"), sourceColumn("OTC", "otc"), blankColumn("Funding Spread (bps)"), blankColumn("Effective Date Offset"),
      ],
    },
    DBS: {
      label: "DBS", subject: "DBS[詢價]FCBKTPE: FCN(T+7)",
      columns: [
        productColumn("Product", "FCN", "DRA"), sourceColumn("Currency", "currency"), sourceColumn("Guaranteed Periods (m)", "guaranteedPeriods"), sourceColumn("BBG Code 1", "bbgCode1"), sourceColumn("BBG Code 2", "bbgCode2"), sourceColumn("BBG Code 3", "bbgCode3"), sourceColumn("BBG Code 4", "bbgCode4"), sourceColumn("Strike (%)", "strike"), sourceColumn("KO Type", "koType"), sourceColumn("KO Barrier (%)", "koBarrier"), sourceColumn("Coupon p.a. (%)", "coupon"), sourceColumn("Upfront / NotePrice (%)", "upfront"), sourceColumn("Tenor (m)", "tenor"), sourceColumn("Barrier Type", "barrierType"), sourceColumn("KI Barrier (%)", "kiBarrier"), sourceColumn("Observation Frequency (m)", "observationFrequency"), sourceColumn("OTC", "otc"), blankColumn("Funding Spread (bps)"), { label: "Issue Date Lag", value: row => numberOffset(rowValue(row, "effectiveDateOffset"), -2, "BD") },
      ],
    },
    SG: {
      label: "SG", subject: "SG[詢價]FCBKTPE: FCN(T+7)",
      columns: [
        sourceColumn("Trade Date", "tradeDate"), productColumn("Product", "FCN", "DRA"), sourceColumn("Currency", "currency"), sourceColumn("Guaranteed Periods (m)", "guaranteedPeriods"), sourceColumn("BBG Code 1", "bbgCode1"), sourceColumn("BBG Code 2", "bbgCode2"), sourceColumn("BBG Code 3", "bbgCode3"), sourceColumn("BBG Code 4", "bbgCode4"), sourceColumn("BBG Code 5", "bbgCode5"), sourceColumn("Strike (%)", "strike"), sourceColumn("KO Type", "koType"), sourceColumn("KO Barrier (%)", "koBarrier"), sourceColumn("Coupon p.a. (%)", "coupon"), sourceColumn("Upfront / NotePrice (%)", "upfront"), sourceColumn("Tenor (m)", "tenor"), sourceColumn("Barrier Type", "barrierType"), sourceColumn("KI Barrier (%)", "kiBarrier"), sourceColumn("Observation Frequency (m)", "observationFrequency"), { label: "OTC", value: () => "Note" }, blankColumn("Funding Spread (bps)"), { label: "Effective Date Offset(Calendar Days)", value: () => "7" },
      ],
    },
    CITI: {
      label: "CITI", subject: "CITI[詢價]FCBKTPE: FCN(T+7)",
      columns: [
        productColumn("Product", "FCA", "DRA"), sourceColumn("Strike Date", "tradeDate"), sourceColumn("Currency", "currency"), sourceColumn("Tenor (m)", "tenor"), { label: "Issue T+", value: row => numberOffset(rowValue(row, "effectiveDateOffset"), -2) },
        sourceColumn("BBG Code 1", "bbgCode1"), sourceColumn("BBG Code 2", "bbgCode2"), sourceColumn("BBG Code 3", "bbgCode3"), sourceColumn("BBG Code 4", "bbgCode4"), sourceColumn("BBG Code 5", "bbgCode5"), sourceColumn("Strike (%)", "strike"),
        { label: "Barrier Type", value: row => citiBarrierType(rowValue(row, "barrierType")) }, sourceColumn("KI Barrier (%)", "kiBarrier"), sourceColumn("Observation Frequency (m)", "observationFrequency"), { label: "Non Callable Periods", value: row => numberOffset(rowValue(row, "guaranteedPeriods"), -1) }, sourceColumn("KO Barrier (%)", "koBarrier"), { label: "Memory Autocall", value: row => citiMemoryAutocall(rowValue(row, "koType")) }, { label: "Daily KO", value: row => citiDailyKo(rowValue(row, "koType")) }, sourceColumn("Coupon p.a. (%)", "coupon"), { label: "Upfront (%)", value: row => numberOffset(rowValue(row, "upfront"), 0, "", true) }, blankColumn("Notional Amount"), { label: "Format", value: row => rowValue(row, "product") ? "Citi US Issuer" : "" }, blankColumn("Swap Index"), blankColumn("Funding Spread (bps)"),
      ],
    },
    GS: {
      label: "GS", subject: "GS[詢價]FCBKTPE: FCN(T+7)",
      columns: [
        productColumn("Product", "FCN", "DRA"), sourceColumn("Currency", "currency"), sourceColumn("Non-call Periods (m)", "guaranteedPeriods"), sourceColumn("BBG Code 1", "bbgCode1"), sourceColumn("BBG Code 2", "bbgCode2"), sourceColumn("BBG Code 3", "bbgCode3"), sourceColumn("BBG Code 4", "bbgCode4"), sourceColumn("BBG Code 5", "bbgCode5"), sourceColumn("Strike (%)", "strike"), sourceColumn("KO Type", "koType"), sourceColumn("KO Barrier (%)", "koBarrier"), sourceColumn("Coupon p.a. (%)", "coupon"), sourceColumn("Cost (%)", "upfront"), sourceColumn("Tenor (m)", "tenor"), sourceColumn("Barrier Type", "barrierType"), sourceColumn("KI Barrier (%)", "kiBarrier"), sourceColumn("Observation Frequency (m)", "observationFrequency"), sourceColumn("Strike Date", "tradeDate"), sourceColumn("Issue Date (T + ?)", "effectiveDateOffset"),
      ],
    },
    CA: {
      label: "CA", subject: "CA[詢價]FCBKTPE: FCN(T+7)",
      columns: [
        productColumn("Product", "FCN", "DRA"), sourceColumn("Currency", "currency"), sourceColumn("BBG Code 1", "bbgCode1"), sourceColumn("BBG Code 2", "bbgCode2"), sourceColumn("BBG Code 3", "bbgCode3"), sourceColumn("BBG Code 4", "bbgCode4"), sourceColumn("Strike (%)", "strike"), sourceColumn("KO Type", "koType"), sourceColumn("Guaranteed Periods (m)", "guaranteedPeriods"), sourceColumn("KO Barrier (%)", "koBarrier"), sourceColumn("Coupon p.a. (%)", "coupon"), sourceColumn("Upfront / NotePrice (%)", "upfront"), sourceColumn("Tenor (m)", "tenor"), sourceColumn("Barrier Type", "barrierType"), sourceColumn("KI Barrier (%)", "kiBarrier"), sourceColumn("Observation Frequency (m)", "observationFrequency"), sourceColumn("OTC", "otc"), blankColumn("Funding Spread (bps)"), blankColumn("Remarks"),
      ],
    },
  };

  const input = (name, attrs = "") => `<input name="${name}" ${attrs}>`;
  const options = (values, selected) => values.map(v => `<option ${v === selected ? "selected" : ""}>${v}</option>`).join("");
  const select = (name, values, selected) => `<select name="${name}">${options(values, selected)}</select>`;

  function formatDate(date = new Date()) {
    const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    return `${String(date.getDate()).padStart(2, "0")}-${months[date.getMonth()]}-${String(date.getFullYear()).slice(-2)}`;
  }

  function setStatus(message = "", success = false) {
    status.textContent = message;
    status.classList.toggle("success", success);
  }

  /**
   * Single-level undo for the two controls that destroy work.
   *
   * An undo rather than a confirmation dialog on purpose. 刪除最後一筆 is a frequent, deliberate
   * action; putting a confirm in front of it slows down every correct use to guard against the rare
   * wrong one, and trains people to dismiss confirmations without reading them. Letting the action
   * happen and offering to take it back costs the careful user nothing.
   *
   * One level, not a stack: it covers the mis-click, which is the actual failure, and a deeper
   * history would imply a guarantee the page cannot keep across a reload.
   */
  const UNDO_WINDOW_MS = 12000;
  let undoTimer = null;

  function undoBar() {
    let bar = document.querySelector("#undoBar");
    if (bar) return bar;
    bar = document.createElement("div");
    bar.id = "undoBar";
    bar.className = "undo-bar";
    bar.setAttribute("role", "status");
    bar.hidden = true;
    status.insertAdjacentElement("afterend", bar);
    return bar;
  }

  function dismissUndo() {
    clearTimeout(undoTimer);
    const bar = document.querySelector("#undoBar");
    if (bar) { bar.hidden = true; bar.replaceChildren(); }
  }

  function offerUndo(message, restore) {
    const bar = undoBar();
    clearTimeout(undoTimer);
    const text = document.createElement("span");
    text.textContent = message;
    const button = document.createElement("button");
    button.type = "button";
    button.className = "undo-bar-action";
    button.textContent = "復原";
    button.addEventListener("click", () => {
      dismissUndo();
      restore();
    });
    bar.replaceChildren(text, button);
    bar.hidden = false;
    undoTimer = setTimeout(dismissUndo, UNDO_WINDOW_MS);
  }

  /** Every field of every row, in order — enough to put the table back exactly as it was. */
  function snapshotRows() {
    return [...tableBody.rows].map(row => Object.fromEntries(
      fields.map(([name]) => [name, rowField(row, name).value])
    ));
  }

  function restoreRows(rows) {
    tableBody.replaceChildren();
    rows.forEach(values => {
      createRow();
      const row = tableBody.lastElementChild;
      Object.entries(values).forEach(([name, value]) => {
        const field = rowField(row, name);
        if (field) field.value = value;
      });
      decorateRow(row);
    });
    if (!tableBody.rows.length) createRow();
    renumberRows();
    saveDraft();
  }

  function normalizedStaticIdentity(branchName, employeeNumber) {
    const branchLabel = branchSubjectLabel(branchName);
    const normalizedEmployeeNumber = String(employeeNumber ?? "").normalize("NFKC").trim();
    if (!branchLabel) throw new Error("請輸入有效的分行名稱。");
    if (!/^\d{5}$/.test(normalizedEmployeeNumber)) throw new Error("行編必須是五碼數字。");
    return { version: 1, branchLabel, employeeNumber: normalizedEmployeeNumber };
  }

  function loadStaticIdentity() {
    if (!isStaticSite) return null;
    try {
      const stored = JSON.parse(window.localStorage.getItem(STATIC_IDENTITY_STORAGE_KEY) ?? "null");
      if (stored?.version !== 1) return null;
      return normalizedStaticIdentity(stored.branchLabel, stored.employeeNumber);
    } catch {
      return null;
    }
  }

  function syncStaticIdentityUi() {
    if (!isStaticSite) return;
    staticIdentityNotice.hidden = false;
    staticIdentitySummary.textContent = staticIdentity
      ? `${staticIdentity.branchLabel}｜行編 ${staticIdentity.employeeNumber}`
      : "尚未設定";
    if (!quotePreviewPanel.hidden) renderQuoteSheet();
  }

  function showStaticIdentityDialog() {
    if (!isStaticSite || staticIdentityDialog.open) return;
    staticBranchName.value = staticIdentity?.branchLabel ?? "";
    staticEmployeeNumber.value = staticIdentity?.employeeNumber ?? "";
    staticIdentityError.hidden = true;
    staticIdentityDialog.showModal();
    staticBranchName.focus();
  }

  function requireStaticIdentity() {
    if (!isStaticSite || staticIdentity) return true;
    showStaticIdentityDialog();
    setStatus("請先輸入分行名稱與五碼行編，才能開始靜態版詢價或產圖。");
    return false;
  }

  function setupStaticIdentity() {
    if (!isStaticSite) return;
    staticIdentity = loadStaticIdentity();
    syncStaticIdentityUi();
    document.querySelector("#editStaticIdentity").addEventListener("click", showStaticIdentityDialog);
    staticIdentityDialog.addEventListener("cancel", event => {
      if (!staticIdentity) event.preventDefault();
    });
    staticIdentityForm.addEventListener("submit", event => {
      event.preventDefault();
      try {
        const identity = normalizedStaticIdentity(staticBranchName.value, staticEmployeeNumber.value);
        staticIdentity = identity;
        try {
          window.localStorage.setItem(STATIC_IDENTITY_STORAGE_KEY, JSON.stringify(identity));
        } catch {
          setStatus("詢價身分已套用，但瀏覽器無法保存；下次開啟時需重新輸入。", true);
        }
        staticIdentityDialog.close();
        syncStaticIdentityUi();
        if (!status.textContent.includes("無法保存")) setStatus("已儲存靜態版詢價身分。", true);
      } catch (error) {
        staticIdentityError.textContent = error.message;
        staticIdentityError.hidden = false;
      }
    });
    if (!staticIdentity) queueMicrotask(showStaticIdentityDialog);
  }

  function createRow(copyFirstRow = false) {
    const firstRow = copyFirstRow ? tableBody.rows[0] : null;
    const row = document.createElement("tr");
    row.innerHTML = `
      <td class="row-number"></td>
      <td>${select("product", ["FCN", "DAC"], "FCN")}</td>
      <td>${select("currency", ["USD", "JPY", "EUR", "HKD", "CNH", "CAD", "GBP", "AUD", "ZAR"], "USD")}</td>
      <td>${input("tradeDate", `value="${formatDate()}" placeholder="DD-MMM-YY" required`)}</td>
      <td>${input("tenor", 'type="number" min="1" max="24" value="12" required')}</td>
      <td>${input("bbgCode1", 'autocomplete="off" placeholder="例如 AAPL" required')}</td>
      <td>${input("bbgCode2", 'autocomplete="off" placeholder="選填"')}</td>
      <td>${input("bbgCode3", 'autocomplete="off" placeholder="選填"')}</td>
      <td>${input("bbgCode4", 'autocomplete="off" placeholder="選填"')}</td>
      <td>${input("bbgCode5", 'autocomplete="off" placeholder="選填"')}</td>
      <td>${input("strike", 'type="number" min="50" max="100" step="0.01" placeholder="求值留白"')}</td>
      <td>${select("koType", ["Daily", "Daily Memory", "Period End", "Period End Memory"], "Daily Memory")}</td>
      <td>${input("koBarrier", 'type="number" step="0.01" placeholder="求值留白"')}</td>
      <td>${input("coupon", 'type="number" step="0.01" placeholder="求值留白"')}</td>
      <td>${input("upfront", 'type="number" step="0.01" value="98" placeholder="求值留白"')}</td>
      <td>${input("guaranteedPeriods", 'type="number" min="1" value="1" required')}</td>
      <td>${select("barrierType", ["EKI", "AKI", "NONE"], "NONE")}</td>
      <td>${input("kiBarrier", 'type="number" step="0.01" placeholder="求值留白"')}</td>
      <td>${input("observationFrequency", 'value="1" readonly')}</td>
      <td>${input("otc", 'value="Note" readonly')}</td>
      <td>${input("effectiveDateOffset", 'value="7" readonly')}</td>`;
    decorateRow(row);
    tableBody.append(row);
    if (firstRow) {
      fields.forEach(([name]) => {
        rowField(row, name).value = rowField(firstRow, name).value;
      });
    }
    renumberRows();
  }

  function renumberRows() {
    [...tableBody.rows].forEach((row, index) => {
      row.id = `trade-row-${index + 1}`;
      row.querySelector(".row-number").textContent = index + 1;
    });
    document.querySelector("#quoteCount").textContent = tableBody.rows.length;
    renderTradeShortcuts();
  }

  function renderTradeShortcuts() {
    if (!tradeShortcuts) return;
    const fragment = document.createDocumentFragment();
    [...tableBody.rows].forEach((row, index) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "trade-shortcut";
      button.dataset.tradeIndex = String(index);
      button.setAttribute("aria-controls", row.id);
      button.setAttribute("aria-label", `切換至第 ${index + 1} 筆交易`);
      button.textContent = `#${index + 1}`;
      fragment.append(button);
    });
    tradeShortcuts.replaceChildren(fragment);
    setActiveTrade(activeTradeIndex, false);
  }

  function setActiveTrade(index, revealShortcut = true) {
    const rows = [...tableBody.rows];
    if (!rows.length) return;
    activeTradeIndex = Math.min(Math.max(Number(index) || 0, 0), rows.length - 1);
    rows.forEach((row, rowIndex) => row.classList.toggle("active-trade", rowIndex === activeTradeIndex));

    const buttons = tradeShortcuts ? [...tradeShortcuts.querySelectorAll(".trade-shortcut")] : [];
    buttons.forEach((button, buttonIndex) => {
      const isActive = buttonIndex === activeTradeIndex;
      button.classList.toggle("is-active", isActive);
      if (isActive) button.setAttribute("aria-current", "true");
      else button.removeAttribute("aria-current");
    });
    if (activeTradeLabel) activeTradeLabel.textContent = `目前：第 ${activeTradeIndex + 1} 筆`;

    const activeButton = buttons[activeTradeIndex];
    if (revealShortcut && activeButton && tradeShortcuts) {
      const containerRect = tradeShortcuts.getBoundingClientRect();
      const buttonRect = activeButton.getBoundingClientRect();
      if (buttonRect.left < containerRect.left || buttonRect.right > containerRect.right) {
        tradeShortcuts.scrollBy({
          left: buttonRect.left + buttonRect.width / 2 - containerRect.left - containerRect.width / 2,
          behavior: "smooth",
        });
      }
    }
  }

  function syncActiveTradeFromViewport() {
    tradeScrollFrame = 0;
    if (!window.matchMedia("(max-width: 760px)").matches || !tradeNavigator) return;
    const rows = [...tableBody.rows];
    if (!rows.length) return;
    const anchor = tradeNavigator.getBoundingClientRect().bottom + 16;
    let visibleIndex = 0;
    rows.forEach((row, index) => {
      if (row.getBoundingClientRect().top <= anchor) visibleIndex = index;
    });
    setActiveTrade(visibleIndex);
  }

  function scheduleTradeViewportSync() {
    if (tradeScrollFrame) return;
    tradeScrollFrame = window.requestAnimationFrame(syncActiveTradeFromViewport);
  }

  function rowValue(row, name) { return row.querySelector(`[name="${name}"]`).value.trim(); }
  function rowField(row, name) { return row.querySelector(`[name="${name}"]`); }

  function saveDraft() {
    const rows = [...tableBody.rows].map(row => Object.fromEntries(
      fields
        .filter(([name]) => name !== "tradeDate")
        .map(([name]) => [name, rowField(row, name).value])
    ));
    try {
      window.localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify({ version: 1, rows }));
    } catch {
      setStatus("瀏覽器無法使用本機暫存；輸入資料不會在下次開啟時保留。");
    }
  }

  function applyRowChanges() {
    rowChangeTimer = 0;
    saveDraft();
    if (!quotePreviewPanel.hidden) renderQuoteSheet();
  }

  function scheduleRowChanges() {
    cancelRowChanges();
    rowChangeTimer = setTimeout(applyRowChanges, ROW_CHANGE_DEBOUNCE_MS);
  }

  function flushRowChanges() {
    cancelRowChanges();
    applyRowChanges();
  }

  function cancelRowChanges() {
    if (rowChangeTimer) clearTimeout(rowChangeTimer);
    rowChangeTimer = 0;
  }

  function restoreDraft() {
    try {
      const savedDraft = window.localStorage.getItem(DRAFT_STORAGE_KEY);
      if (!savedDraft) return false;
      const { version, rows } = JSON.parse(savedDraft);
      if (version !== 1 || !Array.isArray(rows) || !rows.length) return false;
      rows.slice(0, MAX_ROWS).forEach(values => {
        if (!values || typeof values !== "object") return;
        createRow();
        fields.forEach(([name]) => {
          if (name !== "tradeDate" && typeof values[name] === "string") {
            rowField(tableBody.lastElementChild, name).value = values[name];
          }
        });
      });
      return tableBody.rows.length > 0;
    } catch {
      setStatus("本機暫存資料無法還原；目前以新表單開啟。");
      return false;
    }
  }

  function clearSavedDraft() {
    // A pending debounced save would otherwise write the draft back moments after it was cleared.
    cancelRowChanges();
    try {
      window.localStorage.removeItem(DRAFT_STORAGE_KEY);
    } catch {
      setStatus("瀏覽器無法清除本機暫存資料。");
      return;
    }
    tableBody.replaceChildren();
    createRow();
    setStatus("已清除本機暫存與目前輸入資料。", true);
  }

  function decorateRow(row) {
    fields.forEach(([name, label]) => {
      const field = rowField(row, name);
      const cell = field.closest("td");
      const fieldLabel = document.createElement("label");
      const labelText = document.createElement("span");
      cell.classList.add("quote-field", `group-${fieldGroups[name] || "basic"}`);
      cell.dataset.field = name;
      fieldLabel.className = "field-label";
      labelText.className = "field-label-text";
      labelText.textContent = label;
      field.setAttribute("aria-label", label);
      fieldLabel.append(labelText, field);
      cell.replaceChildren(fieldLabel);
    });
  }

  function productForIssuer(row, fcnCode, dacCode) {
    const product = rowValue(row, "product");
    if (product === "FCN") return fcnCode;
    if (product === "DAC") return dacCode;
    return "";
  }

  function numberOffset(value, offset = 0, suffix = "", fromOneHundred = false) {
    if (value === "") return "";
    const number = Number(value);
    if (!Number.isFinite(number)) return "";
    const result = fromOneHundred ? 100 - number : number + offset;
    return `${Number.isInteger(result) ? result : result.toFixed(2).replace(/0+$/, "").replace(/\.$/, "")}${suffix}`;
  }

  function citiBarrierType(value) {
    return ({ NONE: "NONE", EKI: "European", AKI: "Daily Close" })[value] || "";
  }

  function citiMemoryAutocall(value) {
    if (!value) return "";
    return /Memory$/i.test(value) ? "TRUE" : "FALSE";
  }

  function citiDailyKo(value) {
    if (!value) return "";
    return /^Daily/i.test(value) ? "TRUE" : "FALSE";
  }

  function markInvalid(row, name, message) {
    const field = rowField(row, name);
    field.classList.add("invalid");
    field.focus({ preventScroll: false });
    throw new Error(`第 ${row.rowIndex} 筆：${message}`);
  }

  function validateRow(row) {
    row.querySelectorAll(".invalid").forEach(el => el.classList.remove("invalid"));
    const get = name => rowValue(row, name);
    const number = name => Number(get(name));
    const required = ["product", "currency", "guaranteedPeriods", "koType", "tenor", "barrierType", "tradeDate"];
    for (const name of required) if (!get(name)) markInvalid(row, name, "此欄位為必填。");
    if (!["bbgCode1", "bbgCode2", "bbgCode3", "bbgCode4", "bbgCode5"].some(get)) {
      markInvalid(row, "bbgCode1", "BBG Code 1 至 BBG Code 5 至少需填寫一個。");
    }

    if (!/^\d{2}-(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)-\d{2}$/.test(get("tradeDate"))) {
      markInvalid(row, "tradeDate", "Trade Date 格式須為 DD-MMM-YY，例如 15-Jul-26。");
    }
    if (!Number.isInteger(number("tenor")) || number("tenor") < 1 || number("tenor") > 24) {
      markInvalid(row, "tenor", "Tenor 必須為 1 至 24 的整數。");
    }
    if (!Number.isInteger(number("guaranteedPeriods")) || number("guaranteedPeriods") < 1 || number("guaranteedPeriods") > number("tenor")) {
      markInvalid(row, "guaranteedPeriods", "Guaranteed Periods 必須為 1 至 Tenor 的整數。");
    }
    if (get("strike") && (number("strike") < 50 || number("strike") > 100)) {
      markInvalid(row, "strike", "Strike 必須介於 50% 至 100%。");
    }
    if (get("barrierType") === "NONE" && get("kiBarrier")) {
      markInvalid(row, "kiBarrier", "Barrier Type 為 NONE 時，KI Barrier 必須留白。");
    }
    const quoteFields = get("barrierType") === "NONE"
      ? ["strike", "koBarrier", "coupon", "upfront"]
      : ["strike", "koBarrier", "coupon", "upfront", "kiBarrier"];
    if (quoteFields.filter(name => !get(name)).length !== 1) {
      markInvalid(row, quoteFields[0], "價格相關欄位必須且只能留一欄空白求值。");
    }
  }

  // 產圖僅驗證資料完整性與數值範圍；價格求值的留白規則只在寄送詢價時檢查。
  function validateRowForQuoteImage(row) {
    row.querySelectorAll(".invalid").forEach(el => el.classList.remove("invalid"));
    const get = name => rowValue(row, name);
    const number = name => Number(get(name));
    const required = ["product", "currency", "guaranteedPeriods", "koType", "tenor", "barrierType", "tradeDate"];
    for (const name of required) if (!get(name)) markInvalid(row, name, "此欄位為必填。");
    if (!["bbgCode1", "bbgCode2", "bbgCode3", "bbgCode4", "bbgCode5"].some(get)) {
      markInvalid(row, "bbgCode1", "BBG Code 1 至 BBG Code 5 至少需填寫一個。");
    }
    if (!/^\d{2}-(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)-\d{2}$/.test(get("tradeDate"))) {
      markInvalid(row, "tradeDate", "Trade Date 格式須為 DD-MMM-YY，例如 15-Jul-26。");
    }
    if (!Number.isInteger(number("tenor")) || number("tenor") < 1 || number("tenor") > 24) {
      markInvalid(row, "tenor", "Tenor 必須為 1 至 24 的整數。");
    }
    if (!Number.isInteger(number("guaranteedPeriods")) || number("guaranteedPeriods") < 1 || number("guaranteedPeriods") > number("tenor")) {
      markInvalid(row, "guaranteedPeriods", "Guaranteed Periods 必須為 1 至 Tenor 的整數。");
    }
    if (get("strike") && (number("strike") < 50 || number("strike") > 100)) {
      markInvalid(row, "strike", "Strike 必須介於 50% 至 100%。");
    }
  }

  function normaliseBbgCode(field) {
    const raw = field.value.trim().toUpperCase().replace(/\s+/g, " ");
    if (!raw) return;
    const ticker = raw.split(" ")[0];
    const corrected = bbgLookup.get(ticker);
    if (corrected) {
      field.value = corrected;
      setStatus(`${ticker} 已補正為 ${corrected}。`, true);
    } else {
      field.value = raw;
      setStatus("找不到此 ticker 的交易所資料；將保留您的輸入。", false);
    }
    // Announce the resolved underlying so the Cloudflare-mode client can look up its earnings date.
    // Deliberately an event rather than a call: this file is the shared entry form and also runs on
    // the static site, where there is no API to ask. Nothing here waits on or reads a reply, so the
    // quoting flow is identical whether or not anything is listening.
    document.dispatchEvent(new CustomEvent("fcn:underlying-resolved", {
      detail: { bbgCode: field.value }
    }));
  }

  function displayValue(value, fallback = "—") {
    return value === "" || value == null ? fallback : value;
  }

  function displayPercent(value) {
    if (value === "" || value == null) return "—";
    return `${value}%`;
  }

  function displayTicker(value) {
    return value ? value.replace(/\s+[A-Z]{2,3}$/i, "") : "";
  }

  function quoteDataFromRow(row) {
    const get = name => rowValue(row, name);
    const barrierType = get("barrierType");
    const kiBarrier = get("kiBarrier");
    const underlyings = ["bbgCode1", "bbgCode2", "bbgCode3", "bbgCode4", "bbgCode5"]
      .map(name => displayTicker(get(name)))
      .filter(Boolean);
    const guaranteedPeriods = get("guaranteedPeriods");

    return {
      product: get("product"),
      currency: get("currency"),
      tenor: get("tenor"),
      strike: get("strike"),
      koType: get("koType"),
      koBarrier: get("koBarrier"),
      coupon: get("coupon"),
      barrierType,
      kiBarrier,
      guaranteedPeriods,
      tradeDate: get("tradeDate"),
      underlyings,
      isDac: get("product") === "DAC",
    };
  }

  function quoteCardHtml(data, index, profile) {
    const underlyingHtml = data.underlyings.length
      ? data.underlyings.map(ticker => `<li>${escapeHtml(ticker)}</li>`).join("")
      : "<li>—</li>";
    const kiValue = data.barrierType === "NONE" || !data.kiBarrier ? "—" : displayPercent(data.kiBarrier);
    const kiType = data.barrierType === "NONE" ? "—" : data.barrierType;
    const dacNote = data.isDac && data.guaranteedPeriods
      ? `<p class="quote-dac-note">* DAC 第 ${Number(data.guaranteedPeriods) + 1} 個月起為浮動收益</p>`
      : "";
    const makerLabel = isStaticSite && staticIdentity
      ? `<span class="quote-card-maker">製圖行編：${escapeHtml(staticIdentity.employeeNumber)}</span>`
      : "";

    return `<article class="quote-card">
      <header class="quote-card-header">
        <div><span class="quote-card-number">#${index + 1}</span><strong>${escapeHtml(data.product)} 報價</strong><small>(${escapeHtml(data.currency)} 本金)</small></div>
        <span class="quote-card-issuer">${escapeHtml(profile.shortName)}</span>
      </header>
      <div class="quote-card-summary">
        <div><span>期間</span><strong>${displayValue(data.tenor)} 個月</strong></div>
        <div><span>年化收益率</span><strong class="quote-highlight">${displayPercent(data.coupon)}</strong></div>
      </div>
      <div class="quote-card-details">
        <div class="quote-detail underlyings"><span>連結標的</span><ul>${underlyingHtml}</ul></div>
        <div class="quote-detail"><span>執行價</span><strong>${displayPercent(data.strike)}</strong></div>
        <div class="quote-detail"><span>觸及生效價 KI</span><strong>${kiValue}</strong><em>${escapeHtml(kiType)}</em></div>
        <div class="quote-detail"><span>保證配息期間</span><strong>${displayValue(data.guaranteedPeriods)} 個月</strong>${dacNote}</div>
        <div class="quote-detail"><span>提前出場價 KO</span><strong>${displayPercent(data.koBarrier)}</strong><em>${escapeHtml(displayValue(data.koType))}</em></div>
      </div>
      <footer class="quote-card-footer"><span>發行機構：${escapeHtml(profile.name)}${profile.disclaimer ? `（${profile.disclaimer}）` : ""}</span><span>報價日期：${escapeHtml(displayValue(data.tradeDate, ""))}</span>${makerLabel}</footer>
    </article>`;
  }

  function renderQuoteSheet() {
    const profile = issuerProfiles[selectedIssuer];
    const quotes = [...tableBody.rows].map(quoteDataFromRow);
    quotePreviewPanel.hidden = false;
    quoteSheet.className = `quote-sheet theme-${profile.theme}`;
    quoteSheet.innerHTML = `<header class="quote-sheet-header">
      <div><p>STRUCTURED PRODUCT INDICATIVE QUOTATION</p><h2>${escapeHtml(profile.name)}</h2></div>
      <div class="quote-sheet-header-note"><strong>${quotes.length}</strong><span>筆詢價條件</span></div>
    </header>
    <div class="quote-card-grid">${quotes.map((quote, index) => quoteCardHtml(quote, index, profile)).join("")}</div>
    <footer class="quote-sheet-disclaimer">本報價僅供參考，最終條件以發行機構正式報價及相關文件為準。</footer>`;
  }

  function ensureQuoteRowsValid() {
    const rows = [...tableBody.rows];
    if (!rows.length) throw new Error("至少需有一筆詢價交易才可產圖。");
    rows.forEach(validateRowForQuoteImage);
  }

  function showIssuerDialog(mode) {
    issuerDialogMode = mode;
    issuerSelect.value = selectedIssuer;
    issuerWarning.hidden = issuerSelect.value !== "MS";
    document.querySelector("#confirmIssuer").textContent = mode === "preview" ? "更新預覽" : "產出 PNG";
    issuerDialog.showModal();
  }

  // Every await below can stall indefinitely — requestAnimationFrame never fires in a background
  // tab and html2canvas can hang on mobile WebKit. Without a timeout the unsettled promise never
  // reaches the caller's catch and the button stays on 「產圖中…」 forever.
  function withRenderTimeout(promise, milliseconds, message) {
    let timeoutId;
    return Promise.race([
      promise,
      new Promise((_, reject) => { timeoutId = setTimeout(() => reject(new Error(message)), milliseconds); }),
    ]).finally(() => clearTimeout(timeoutId));
  }

  async function downloadQuoteImage() {
    const generateButton = document.querySelector("#generateQuoteImage");
    renderQuoteSheet();
    generateButton.disabled = true;
    generateButton.classList.add("is-loading");
    generateButton.setAttribute("aria-busy", "true");
    const originalText = generateButton.textContent;
    generateButton.textContent = "產圖中…";
    try {
      const html2canvas = await loadHtml2Canvas();
      await withRenderTimeout(
        new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))),
        5_000,
        "產圖逾時（版面），請切回此分頁後再試一次。"
      );
      const canvas = await withRenderTimeout(html2canvas(quoteSheet, {
        backgroundColor: "#ffffff",
        scale: Math.max(2, Math.min(3, window.devicePixelRatio || 2)),
        useCORS: true,
        logging: false,
        scrollX: 0,
        scrollY: -window.scrollY,
        windowWidth: quoteSheet.scrollWidth,
        windowHeight: quoteSheet.scrollHeight,
      }), 20_000, "產圖逾時（繪製），請減少筆數或重新整理後再試。");
      const link = document.createElement("a");
      const datePart = new Date().toISOString().slice(0, 10).replaceAll("-", "");
      link.download = `FCN-DAC-${issuerProfiles[selectedIssuer].shortName}-Quote-${datePart}.png`;
      link.href = canvas.toDataURL("image/png");
      document.body.append(link);
      link.click();
      link.remove();
      setStatus("已產出並下載高解析度報價圖。", true);
    } finally {
      generateButton.disabled = false;
      generateButton.classList.remove("is-loading");
      generateButton.removeAttribute("aria-busy");
      generateButton.textContent = originalText;
    }
  }

  // The exchange table is a 74 KB CSV that only the BBG Code fields need, so it is fetched the
  // first time one of those fields is used instead of on every page load. Fetching it lazily also
  // removes the old race where a fast typist could blur a field before the startup load finished.
  function ensureBbgLookup() {
    if (!bbgLookupPromise) bbgLookupPromise = loadBbgLookup();
    return bbgLookupPromise;
  }

  async function normaliseBbgCodeWhenReady(field) {
    const entered = field.value;
    await ensureBbgLookup();
    // The user may have kept typing while the table was loading; never overwrite a newer value.
    if (field.value !== entered) return;
    normaliseBbgCode(field);
    flushRowChanges();
  }

  async function loadBbgLookup() {
    try {
      const response = await fetch("./交易所查詢0715.csv");
      if (!response.ok) throw new Error("CSV 載入失敗");
      const lines = (await response.text()).replace(/^\uFEFF/, "").trim().split(/\r?\n/);
      lines.slice(1).forEach(line => {
        const [bbgCode, ticker] = line.split(",").map(value => value.trim());
        if (bbgCode && ticker && !bbgLookup.has(ticker.toUpperCase())) bbgLookup.set(ticker.toUpperCase(), bbgCode);
      });
      setStatus(`已載入 ${bbgLookup.size.toLocaleString()} 筆 BBG Code 對照資料。`, true);
    } catch {
      setStatus("無法載入交易所查詢0715.csv；仍可手動輸入完整 BBG Code。", false);
    }
  }

  function buildEmailBody(columns, dataRows) {
    const header = columns.map(column => column.label).join("\t");
    const values = dataRows.map(values => values.join("\t"));
    return [header, ...values].join("\r\n");
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, character => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    }[character]));
  }

  function buildEmailHtml(columns, dataRows) {
    const headerCells = columns.map(column =>
      `<th style="border:1px solid #ffffff;background:#184e77;color:#ffffff;padding:8px 6px;font:700 11px Arial,Calibri,sans-serif;text-align:center;vertical-align:middle;white-space:nowrap;">${escapeHtml(column.label)}</th>`
    ).join("");
    const tableRows = dataRows.map((values, rowIndex) => {
      const cells = values.map((value, columnIndex) => {
        // 郵件用戶端可能裁掉每列最後一個完全空白的儲存格；以不可見空白保留欄位結構。
        const cellValue = columnIndex === values.length - 1 && value === "" ? "&nbsp;" : escapeHtml(value);
        return `<td style="border:1px solid #b7c9d3;padding:8px 6px;font:11px Arial,Calibri,sans-serif;text-align:center;vertical-align:middle;white-space:nowrap;">${cellValue}</td>`;
      }).join("");
      return `<tr style="background:${rowIndex % 2 ? "#f6fafc" : "#ffffff"};">${cells}</tr>`;
    }).join("");

    return `<!doctype html>
<html><body style="margin:0;font-family:Arial,Calibri,sans-serif;color:#000000;">
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;border:1px solid #b7c9d3;font-family:Arial,Calibri,sans-serif;">
    <thead><tr>${headerCells}</tr></thead>
    <tbody>${tableRows}</tbody>
  </table>
</body></html>`;
  }

  function buildInstitutionEmail(key, rows) {
    const records = rows.map(row => Object.fromEntries(
      fields.map(([name]) => [name, rowValue(row, name)])
    ));
    const email = buildSharedInstitutionEmail(key, records);
    if (!isStaticSite) return email;
    if (!staticIdentity) throw new Error("請先輸入分行名稱與五碼行編。");
    return {
      ...email,
      subject: buildStaticRequesterSubject(email.subject, staticIdentity.branchLabel, staticIdentity.employeeNumber),
    };
  }

  async function copyEmailTable(html, plainText) {
    if (navigator.clipboard?.write && window.ClipboardItem) {
      const item = new ClipboardItem({
        "text/html": new Blob([html], { type: "text/html" }),
        "text/plain": new Blob([plainText], { type: "text/plain" }),
      });
      await navigator.clipboard.write([item]);
      return "html";
    }
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(plainText);
      return "text";
    }
    return "none";
  }

  function validatedMailRows() {
    const rows = [...tableBody.rows];
    if (rows.length < 1 || rows.length > MAX_ROWS) throw new Error("詢價交易筆數必須介於 1 至 20 筆。");
    rows.forEach(validateRow);
    return rows;
  }

  function currentEmailPayload() {
    return emailQueue[emailQueueIndex] ?? null;
  }

  function updateClipboardStatus(format) {
    emailClipboardStatus.textContent = format === "html"
      ? "HTML 詢價表格已複製。開啟郵件後，請在本文按「貼上」。"
      : format === "text"
        ? "此瀏覽器只允許複製文字格式；開啟郵件後，請在本文按「貼上」。"
        : "瀏覽器未允許剪貼簿存取；使用預設郵件程式時會改把文字內容帶入本文。";
    emailClipboardStatus.dataset.state = format;
  }

  async function copyCurrentEmailTable() {
    const payload = currentEmailPayload();
    if (!payload) return;
    emailClipboardFormat = await copyEmailTable(payload.html, payload.plainText).catch(() => "none");
    updateClipboardStatus(emailClipboardFormat);
  }

  function storedZimbraUrl() {
    try { return localStorage.getItem(ZIMBRA_URL_STORAGE_KEY) ?? ""; }
    catch { return ""; }
  }

  function saveZimbraUrl(url) {
    try { localStorage.setItem(ZIMBRA_URL_STORAGE_KEY, url); }
    catch { /* Private browsing may disable storage; opening Zimbra should still work. */ }
  }

  async function prepareQueuedEmail() {
    const payload = currentEmailPayload();
    if (!payload) return;
    emailQueueProgress.textContent = `第 ${emailQueueIndex + 1} / ${emailQueue.length} 封：${payload.label}`;
    emailQueueDetail.textContent = `收件人：${MAIL_TO}｜主旨：${payload.subject}`;
    const nextButton = document.querySelector("#nextEmailQueue");
    nextButton.textContent = emailQueueIndex === emailQueue.length - 1 ? "這封已完成，結束流程" : "這封已完成，準備下一封";
    if (!emailQueueDialog.open) emailQueueDialog.showModal();
    await copyCurrentEmailTable();
  }

  function openPreparedEmail(mode) {
    const payload = currentEmailPayload();
    if (!payload) return;
    try {
      if (mode === "zimbra") {
        const zimbraUrl = zimbraUrlInput.value.trim();
        const composeUrl = buildZimbraComposeUrl(zimbraUrl, {
          to: MAIL_TO,
          subject: payload.subject,
        });
        saveZimbraUrl(zimbraUrl);
        const opened = window.open(composeUrl, "_blank");
        if (opened) opened.opener = null;
        if (!opened) throw new Error("Edge 已阻擋新分頁，請允許此網站開啟彈出式視窗後再試一次。");
        setStatus(`已開啟 ${payload.label} 的 Zimbra 郵件頁；請貼上已複製的詢價表格並寄出。`, true);
        return;
      }
      const mailBody = emailClipboardFormat === "html" ? "" : payload.plainText;
      window.location.href = buildMailtoUrl({
        to: MAIL_TO,
        subject: payload.subject,
        body: mailBody,
      });
      setStatus(`已交由裝置的預設郵件程式開啟 ${payload.label} 郵件；請貼上表格並寄出。`, true);
    } catch (error) {
      setStatus(error.message);
      emailClipboardStatus.textContent = error.message;
      emailClipboardStatus.dataset.state = "error";
    }
  }

  function showMailIssuerDialog() {
    setStatus();
    if (!requireStaticIdentity()) return;
    try {
      validatedMailRows();
      emailIssuerDialog.showModal();
    } catch (error) { setStatus(error.message); }
  }

  document.querySelector("#addRow").addEventListener("click", () => {
    if (tableBody.rows.length >= MAX_ROWS) return setStatus("最多只能新增 20 筆詢價交易。");
    createRow(true);
    setActiveTrade(tableBody.rows.length - 1);
    saveDraft(); setStatus("已複製第 1 筆交易作為新交易預設值。", true);
    tableBody.lastElementChild.scrollIntoView({ behavior: "smooth", block: "start" });
  });
  document.querySelector("#removeRow").addEventListener("click", () => {
    if (tableBody.rows.length <= 1) return setStatus("至少需保留 1 筆詢價交易。");
    const before = snapshotRows();
    tableBody.lastElementChild.remove(); renumberRows(); saveDraft(); setStatus();
    offerUndo(`已刪除第 ${before.length} 筆交易。`, () => {
      restoreRows(before);
      setStatus(`已復原第 ${before.length} 筆交易。`, true);
    });
  });
  document.querySelector("#clearSavedDraft").addEventListener("click", () => {
    const before = snapshotRows();
    clearSavedDraft();
    offerUndo(`已清除 ${before.length} 筆交易與本機暫存。`, () => {
      restoreRows(before);
      setStatus("已復原清除前的交易資料。", true);
    });
  });
  document.querySelector("#confirmAllQuotes").addEventListener("click", showMailIssuerDialog);
  document.querySelector("#sendQuotes").addEventListener("click", showMailIssuerDialog);
  document.querySelector("#cancelEmailIssuer").addEventListener("click", () => emailIssuerDialog.close());
  document.querySelector("#emailIssuerForm").addEventListener("submit", async event => {
    event.preventDefault();
    try {
      const rows = validatedMailRows();
      const selection = emailIssuerSelect.value;
      emailIssuerDialog.close();
      emailQueue = selection === "ALL"
        ? SHARED_MAIL_INSTITUTION_ORDER.map(key => buildInstitutionEmail(key, rows))
        : [buildInstitutionEmail(selection, rows)];
      emailQueueIndex = 0;
      saveMailQueue();
      zimbraUrlInput.value = storedZimbraUrl();
      await prepareQueuedEmail();
    } catch (error) { setStatus(error.message); }
  });
  document.querySelector("#openDefaultEmail").addEventListener("click", () => openPreparedEmail("default"));
  document.querySelector("#openZimbraEmail").addEventListener("click", () => openPreparedEmail("zimbra"));
  document.querySelector("#copyEmailAgain").addEventListener("click", async () => {
    try {
      await copyCurrentEmailTable();
      setStatus("已重新複製目前郵件的詢價表格。", true);
    } catch (error) { setStatus(error.message); }
  });
  document.querySelector("#cancelEmailQueue").addEventListener("click", () => {
    emailQueue = [];
    emailQueueIndex = -1;
    saveMailQueue();
    emailQueueDialog.close();
    setStatus("已結束全部詢價郵件流程。", true);
  });
  document.querySelector("#nextEmailQueue").addEventListener("click", async () => {
    if (emailQueueIndex >= emailQueue.length - 1) {
      emailQueue = [];
      emailQueueIndex = -1;
      saveMailQueue();
      emailQueueDialog.close();
      setStatus("八封詢價郵件已依序準備完成。", true);
      return;
    }
    emailQueueIndex += 1;
    saveMailQueue();
    try { await prepareQueuedEmail(); } catch (error) { setStatus(error.message); }
  });
  document.querySelector("#generateQuoteImage").addEventListener("click", () => {
    try {
      if (!requireStaticIdentity()) return;
      ensureQuoteRowsValid();
      showIssuerDialog("download");
    } catch (error) { setStatus(error.message); }
  });
  document.querySelector("#changePreviewIssuer").addEventListener("click", () => showIssuerDialog("preview"));
  issuerSelect.addEventListener("change", () => { issuerWarning.hidden = issuerSelect.value !== "MS"; });
  document.querySelector("#cancelIssuer").addEventListener("click", () => issuerDialog.close());
  document.querySelector("#issuerForm").addEventListener("submit", async event => {
    event.preventDefault();
    const mode = issuerDialogMode;
    selectedIssuer = issuerSelect.value;
    issuerDialog.close();
    if (mode === "preview") {
      renderQuoteSheet();
      setStatus("已更新報價單預覽的發行機構。", true);
      return;
    }
    try { await downloadQuoteImage(); } catch (error) { setStatus(error.message); }
  });
  tableBody.addEventListener("focusin", event => {
    const row = event.target.closest("tr");
    if (row) setActiveTrade([...tableBody.rows].indexOf(row));
    if (/^bbgCode[1-5]$/.test(event.target.name)) void ensureBbgLookup();
  });
  tableBody.addEventListener("blur", event => {
    if (/^bbgCode[1-5]$/.test(event.target.name)) void normaliseBbgCodeWhenReady(event.target);
    flushRowChanges();
  }, true);
  // Persisting the draft reads every field of every row, and the preview rebuilds the whole sheet.
  // Doing that on each keystroke makes typing visibly laggy once the table has many rows and the
  // preview panel is open, so coalesce the work; leaving a field still flushes it immediately.
  ["input", "change"].forEach(eventName => tableBody.addEventListener(eventName, scheduleRowChanges));
  tradeShortcuts?.addEventListener("click", event => {
    const button = event.target.closest(".trade-shortcut");
    if (!button) return;
    const targetIndex = Number(button.dataset.tradeIndex);
    const targetRow = tableBody.rows[targetIndex];
    if (!targetRow) return;
    setActiveTrade(targetIndex);
    targetRow.scrollIntoView({ behavior: "smooth", block: "start" });
  });
  window.addEventListener("scroll", scheduleTradeViewportSync, { passive: true });
  window.addEventListener("resize", scheduleTradeViewportSync, { passive: true });

  setupHotlist();

  const dialog = document.querySelector("#helpDialog");
  document.querySelector("#showHelp").addEventListener("click", () => dialog.showModal());
  document.querySelector("#closeHelp").addEventListener("click", () => dialog.close());

  // Market hot lists are opt-in: no third-party frame is created until the user consents, so a
  // plain visit to the quote page never discloses an IP to TradingView.
  function setupHotlist() {
    const panel = document.querySelector("#hotlistPanel");
    if (!panel) return;
    const consent = panel.querySelector("#hotlistConsent");
    const marketSelect = panel.querySelector("#hotlistMarket");
    const loadButton = panel.querySelector("#hotlistLoad");
    const unloadButton = panel.querySelector("#hotlistUnload");
    const status = panel.querySelector("#hotlistStatus");
    const host = panel.querySelector("#hotlistWidget");
    const screensNav = panel.querySelector("#hotlistScreens");
    const exchanges = panel.querySelector("#hotlistExchanges");

    let stored = null;
    try {
      stored = localStorage.getItem(HOTLIST_CONSENT_KEY);
    } catch {
      // private mode or blocked storage: treat as no stored consent
    }
    consent.checked = stored === "1";

    // Rebuilds the ranking links and exchange caption for the selected market. These are plain
    // links to TradingView's own pages, so they need no consent and work for both markets.
    function syncMarket() {
      const descriptor = hotlistDescriptor(marketSelect.value);
      if (!descriptor) return;
      exchanges.textContent = descriptor.exchanges;
      screensNav.replaceChildren(...descriptor.screens.map(screen => {
        const link = document.createElement("a");
        link.href = screen.url;
        link.target = "_blank";
        link.rel = "noopener noreferrer nofollow";
        link.textContent = screen.label;
        return link;
      }));
      loadButton.hidden = !descriptor.embeddable || !unloadButton.hidden;
    }

    function unload() {
      host.replaceChildren();
      unloadButton.hidden = true;
      loadButton.hidden = false;
      status.textContent = "";
    }

    function load() {
      if (!consent.checked) {
        status.textContent = "請先勾選同意，才會載入外部熱門榜。";
        return;
      }
      const descriptor = hotlistDescriptor(marketSelect.value);
      if (!descriptor) {
        status.textContent = "不支援的市場。";
        return;
      }
      // TradingView's free widgets cover US exchanges only; their Japan-looking values silently
      // return US rows. Say so plainly rather than show US stocks under a Japan label.
      if (!descriptor.embeddable) {
        unload();
        status.textContent = `${descriptor.label}沒有可內嵌的即時熱門榜（TradingView 免費 widget 僅提供美股），請改用上方排行連結開啟 TradingView 網站。`;
        return;
      }
      let url;
      try {
        url = hotlistWidgetUrl(marketSelect.value);
      } catch (error) {
        status.textContent = error.message;
        return;
      }
      const frame = document.createElement("iframe");
      frame.title = `${descriptor.label} 熱門榜`;
      frame.loading = "lazy";
      frame.referrerPolicy = "no-referrer";
      // Matches the already-deployed Phase 2 chart widget, which is confirmed working in production.
      frame.setAttribute("sandbox", "allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox");
      frame.src = url;
      host.replaceChildren(frame);
      loadButton.hidden = true;
      unloadButton.hidden = false;
      status.textContent = `${descriptor.label}｜資料由 TradingView 提供，可能為延遲或收盤資料。`;
    }

    consent.addEventListener("change", () => {
      try {
        if (consent.checked) localStorage.setItem(HOTLIST_CONSENT_KEY, "1");
        else localStorage.removeItem(HOTLIST_CONSENT_KEY);
      } catch {
        // storage failures must not block the panel
      }
      if (!consent.checked) unload();
    });
    marketSelect.addEventListener("change", () => {
      syncMarket();
      if (!unloadButton.hidden) load();
    });
    loadButton.addEventListener("click", load);
    unloadButton.addEventListener("click", () => { unload(); syncMarket(); });
    syncMarket();
  }

  if (!restoreDraft()) createRow();
  setupStaticIdentity();
  scheduleTradeViewportSync();
  offerMailQueueResume();
})();
