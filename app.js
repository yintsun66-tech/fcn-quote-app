import {
  MAIL_INSTITUTION_ORDER as SHARED_MAIL_INSTITUTION_ORDER,
  buildInstitutionEmail as buildSharedInstitutionEmail,
} from "./backend/shared/email-formats.js";

(() => {
  "use strict";

  const MAX_ROWS = 20;
  const DRAFT_STORAGE_KEY = "fcn-quote-app.trade-draft.v1";
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
  let selectedIssuer = "BNP";
  let issuerDialogMode = "download";
  let emailQueue = [];
  let emailQueueIndex = -1;

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
        sourceColumn("Strike (%)", "strike"), sourceColumn("KO Type", "koType"), sourceColumn("KO Barrier (%)", "koBarrier"), sourceColumn("Coupon p.a. (%)", "coupon"), sourceColumn("Upfront / NotePrice (%)", "upfront"), sourceColumn("Tenor (m)", "tenor"), sourceColumn("Barrier Type", "barrierType"), sourceColumn("KI Barrier (%)", "kiBarrier"), sourceColumn("Observation Frequency (m)", "observationFrequency"), sourceColumn("OTC", "otc"), blankColumn("Funding Spread (bps)"), sourceColumn("Effective Date Offset", "effectiveDateOffset"), sourceColumn("Trade Date", "tradeDate"),
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
        sourceColumn("Trade Date", "tradeDate"), productColumn("Product", "FCN", "DRA"), sourceColumn("Currency", "currency"), sourceColumn("Guaranteed Periods (m)", "guaranteedPeriods"), sourceColumn("BBG Code 1", "bbgCode1"), sourceColumn("BBG Code 2", "bbgCode2"), sourceColumn("BBG Code 3", "bbgCode3"), sourceColumn("BBG Code 4", "bbgCode4"), sourceColumn("BBG Code 5", "bbgCode5"), sourceColumn("Strike (%)", "strike"), sourceColumn("KO Type", "koType"), sourceColumn("KO Barrier (%)", "koBarrier"), sourceColumn("Coupon p.a. (%)", "coupon"), sourceColumn("Upfront / NotePrice (%)", "upfront"), sourceColumn("Tenor (m)", "tenor"), sourceColumn("Barrier Type", "barrierType"), sourceColumn("KI Barrier (%)", "kiBarrier"), sourceColumn("Observation Frequency (m)", "observationFrequency"),
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

  function createRow(copyFirstRow = false) {
    const firstRow = copyFirstRow ? tableBody.rows[0] : null;
    const row = document.createElement("tr");
    row.innerHTML = `
      <td class="row-number"></td>
      <td>${select("product", ["FCN", "DAC"], "FCN")}</td>
      <td>${select("currency", ["USD", "JPY", "EUR", "HKD", "CNH", "CAD", "GBP", "AUD"], "USD")}</td>
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
    [...tableBody.rows].forEach((row, index) => row.querySelector(".row-number").textContent = index + 1);
    document.querySelector("#quoteCount").textContent = tableBody.rows.length;
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
      <footer class="quote-card-footer"><span>發行機構：${escapeHtml(profile.name)}${profile.disclaimer ? `（${profile.disclaimer}）` : ""}</span><span>報價日期：${escapeHtml(displayValue(data.tradeDate, ""))}</span></footer>
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

  async function downloadQuoteImage() {
    const generateButton = document.querySelector("#generateQuoteImage");
    if (typeof window.html2canvas !== "function") {
      throw new Error("報價圖元件載入失敗，請確認網路連線後重新整理頁面。");
    }
    renderQuoteSheet();
    generateButton.disabled = true;
    generateButton.classList.add("is-loading");
    generateButton.setAttribute("aria-busy", "true");
    const originalText = generateButton.textContent;
    generateButton.textContent = "產圖中…";
    try {
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const canvas = await window.html2canvas(quoteSheet, {
        backgroundColor: "#ffffff",
        scale: Math.max(2, Math.min(3, window.devicePixelRatio || 2)),
        useCORS: true,
        logging: false,
        scrollX: 0,
        scrollY: -window.scrollY,
        windowWidth: quoteSheet.scrollWidth,
        windowHeight: quoteSheet.scrollHeight,
      });
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
    return buildSharedInstitutionEmail(key, records);
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

  async function openInstitutionEmail(payload) {
    const clipboardFormat = await copyEmailTable(payload.html, payload.plainText).catch(() => "none");
    const mailBody = clipboardFormat === "html" ? "" : payload.plainText;
    const uri = `mailto:${MAIL_TO}?subject=${encodeURIComponent(payload.subject)}&body=${encodeURIComponent(mailBody)}`;
    window.location.href = uri;
    setStatus(
      clipboardFormat === "html"
        ? `已開啟 ${payload.label} 郵件草稿並複製對應 HTML 表格；請在郵件本文貼上後寄送。`
        : `已開啟 ${payload.label} 郵件草稿；此裝置無法複製 HTML 表格，已改帶入文字格式內容。`,
      true
    );
  }

  async function openQueuedEmail() {
    const payload = emailQueue[emailQueueIndex];
    if (!payload) return;
    emailQueueProgress.textContent = `第 ${emailQueueIndex + 1} / ${emailQueue.length} 封：${payload.label}`;
    emailQueueDetail.textContent = `主旨：${payload.subject}。請貼上已複製的表格並寄出，完成後回到此頁開啟下一封。`;
    const nextButton = document.querySelector("#nextEmailQueue");
    nextButton.textContent = emailQueueIndex === emailQueue.length - 1 ? "我已寄出，完成流程" : "我已寄出，開啟下一封";
    if (!emailQueueDialog.open) emailQueueDialog.showModal();
    await openInstitutionEmail(payload);
  }

  function showMailIssuerDialog() {
    setStatus();
    try {
      validatedMailRows();
      emailIssuerDialog.showModal();
    } catch (error) { setStatus(error.message); }
  }

  document.querySelector("#addRow").addEventListener("click", () => {
    if (tableBody.rows.length >= MAX_ROWS) return setStatus("最多只能新增 20 筆詢價交易。");
    createRow(true); saveDraft(); setStatus("已複製第 1 筆交易作為新交易預設值。", true);
    tableBody.lastElementChild.scrollIntoView({ behavior: "smooth", block: "center" });
  });
  document.querySelector("#removeRow").addEventListener("click", () => {
    if (tableBody.rows.length <= 1) return setStatus("至少需保留 1 筆詢價交易。");
    tableBody.lastElementChild.remove(); renumberRows(); saveDraft(); setStatus();
  });
  document.querySelector("#clearSavedDraft").addEventListener("click", clearSavedDraft);
  document.querySelector("#confirmAllQuotes").addEventListener("click", showMailIssuerDialog);
  document.querySelector("#sendQuotes").addEventListener("click", showMailIssuerDialog);
  document.querySelector("#cancelEmailIssuer").addEventListener("click", () => emailIssuerDialog.close());
  document.querySelector("#emailIssuerForm").addEventListener("submit", async event => {
    event.preventDefault();
    try {
      const rows = validatedMailRows();
      const selection = emailIssuerSelect.value;
      emailIssuerDialog.close();
      if (selection === "ALL") {
        emailQueue = SHARED_MAIL_INSTITUTION_ORDER.map(key => buildInstitutionEmail(key, rows));
        emailQueueIndex = 0;
        await openQueuedEmail();
      } else {
        await openInstitutionEmail(buildInstitutionEmail(selection, rows));
      }
    } catch (error) { setStatus(error.message); }
  });
  document.querySelector("#cancelEmailQueue").addEventListener("click", () => {
    emailQueue = [];
    emailQueueIndex = -1;
    emailQueueDialog.close();
    setStatus("已結束全部詢價郵件流程。", true);
  });
  document.querySelector("#nextEmailQueue").addEventListener("click", async () => {
    if (emailQueueIndex >= emailQueue.length - 1) {
      emailQueue = [];
      emailQueueIndex = -1;
      emailQueueDialog.close();
      setStatus("八封詢價郵件已依序準備完成。", true);
      return;
    }
    emailQueueIndex += 1;
    try { await openQueuedEmail(); } catch (error) { setStatus(error.message); }
  });
  document.querySelector("#generateQuoteImage").addEventListener("click", () => {
    try {
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
  tableBody.addEventListener("blur", event => {
    if (/^bbgCode[1-5]$/.test(event.target.name)) normaliseBbgCode(event.target);
    saveDraft();
  }, true);
  ["input", "change"].forEach(eventName => tableBody.addEventListener(eventName, () => {
    saveDraft();
    if (!quotePreviewPanel.hidden) renderQuoteSheet();
  }));

  const dialog = document.querySelector("#helpDialog");
  document.querySelector("#showHelp").addEventListener("click", () => dialog.showModal());
  document.querySelector("#closeHelp").addEventListener("click", () => dialog.close());

  if (!restoreDraft()) createRow();
  loadBbgLookup();
})();
