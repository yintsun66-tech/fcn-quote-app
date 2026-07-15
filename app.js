(() => {
  "use strict";

  const MAX_ROWS = 20;
  const MAIL_TO = "i14053@firstbank.com.tw";
  const MAIL_SUBJECT = "BMJB[詢價]FCBKTPE: FCN(T+7)";
  const tableBody = document.querySelector("#quoteTable tbody");
  const status = document.querySelector("#status");
  const bbgLookup = new Map();

  const fields = [
    ["product", "Product"], ["currency", "Currency"], ["guaranteedPeriods", "Guaranteed Periods (m)"],
    ["bbgCode1", "BBG Code 1"], ["bbgCode2", "BBG Code 2"], ["bbgCode3", "BBG Code 3"],
    ["bbgCode4", "BBG Code 4"], ["bbgCode5", "BBG Code 5"], ["strike", "Strike (%)"],
    ["koType", "KO Type"], ["koBarrier", "KO Barrier (%)"], ["coupon", "Coupon p.a. (%)"],
    ["upfront", "Upfront / NotePrice (%)"], ["tenor", "Tenor (m)"], ["barrierType", "Barrier Type"],
    ["kiBarrier", "KI Barrier (%)"], ["observationFrequency", "Observation Frequency (m)"],
    ["otc", "OTC"], ["effectiveDateOffset", "Effective Date Offset (Calendar Days)"], ["tradeDate", "Trade Date"],
  ];

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

  function createRow() {
    const row = document.createElement("tr");
    row.innerHTML = `
      <td class="row-number"></td>
      <td>${select("product", ["FCN", "DAC"], "FCN")}</td>
      <td>${select("currency", ["USD", "JPY", "EUR", "HKD", "CNH", "CAD", "GBP", "AUD"], "USD")}</td>
      <td>${input("guaranteedPeriods", 'type="number" min="1" value="1" required')}</td>
      <td>${input("bbgCode1", 'autocomplete="off" placeholder="例如 AAPL" required')}</td>
      <td>${input("bbgCode2", 'autocomplete="off" placeholder="選填"')}</td>
      <td>${input("bbgCode3", 'autocomplete="off" placeholder="選填"')}</td>
      <td>${input("bbgCode4", 'autocomplete="off" placeholder="選填"')}</td>
      <td>${input("bbgCode5", 'autocomplete="off" placeholder="選填"')}</td>
      <td>${input("strike", 'type="number" min="50" max="100" step="0.01" placeholder="求值留白"')}</td>
      <td>${select("koType", ["Daily", "Daily Memory", "Period End", "Period End Memory"], "Daily")}</td>
      <td>${input("koBarrier", 'type="number" step="0.01" placeholder="求值留白"')}</td>
      <td>${input("coupon", 'type="number" step="0.01" placeholder="求值留白"')}</td>
      <td>${input("upfront", 'type="number" step="0.01" placeholder="求值留白"')}</td>
      <td>${input("tenor", 'type="number" min="1" max="24" value="12" required')}</td>
      <td>${select("barrierType", ["EKI", "AKI", "NONE"], "EKI")}</td>
      <td>${input("kiBarrier", 'type="number" step="0.01" placeholder="求值留白"')}</td>
      <td>${input("observationFrequency", 'value="1" readonly')}</td>
      <td>${input("otc", 'value="Note" readonly')}</td>
      <td>${input("effectiveDateOffset", 'value="7" readonly')}</td>
      <td>${input("tradeDate", `value="${formatDate()}" placeholder="DD-MMM-YY" required`)}</td>`;
    tableBody.append(row);
    renumberRows();
  }

  function renumberRows() {
    [...tableBody.rows].forEach((row, index) => row.querySelector(".row-number").textContent = index + 1);
    document.querySelector("#quoteCount").textContent = tableBody.rows.length;
  }

  function rowValue(row, name) { return row.querySelector(`[name="${name}"]`).value.trim(); }
  function rowField(row, name) { return row.querySelector(`[name="${name}"]`); }

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

  function buildEmailBody(rows) {
    const header = fields.map(([, label]) => label).join("\t");
    const values = rows.map(row => fields.map(([name]) => rowValue(row, name) || "Quote").join("\t"));
    return ["Dear Team,", "", "Please quote the following transaction(s):", "", header, ...values, "", "Best regards,"].join("\r\n");
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, character => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    }[character]));
  }

  function buildEmailHtml(rows) {
    const headerCells = fields.map(([, label]) =>
      `<th style="border:1px solid #ffffff;background:#184e77;color:#ffffff;padding:8px 6px;font:700 11px Arial,Calibri,sans-serif;text-align:center;vertical-align:middle;white-space:nowrap;">${escapeHtml(label)}</th>`
    ).join("");
    const dataRows = rows.map((row, rowIndex) => {
      const cells = fields.map(([name]) => {
        const value = rowValue(row, name) || "Quote";
        return `<td style="border:1px solid #b7c9d3;padding:8px 6px;font:11px Arial,Calibri,sans-serif;text-align:center;vertical-align:middle;white-space:nowrap;">${escapeHtml(value)}</td>`;
      }).join("");
      return `<tr style="background:${rowIndex % 2 ? "#f6fafc" : "#ffffff"};">${cells}</tr>`;
    }).join("");

    return `<!doctype html>
<html><body style="margin:0;font-family:Arial,Calibri,sans-serif;color:#000000;">
  <p style="margin:0 0 14px;font-size:12px;">Dear Team,</p>
  <p style="margin:0 0 14px;font-size:12px;">Please quote the following transaction(s):</p>
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;border:1px solid #b7c9d3;font-family:Arial,Calibri,sans-serif;">
    <thead><tr>${headerCells}</tr></thead>
    <tbody>${dataRows}</tbody>
  </table>
  <p style="margin:18px 0 0;font-size:12px;">Best regards,</p>
</body></html>`;
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

  async function confirmAndSend() {
    setStatus();
    const rows = [...tableBody.rows];
    try {
      if (rows.length < 1 || rows.length > MAX_ROWS) throw new Error("詢價交易筆數必須介於 1 至 20 筆。");
      rows.forEach(validateRow);
      const plainText = buildEmailBody(rows);
      const clipboardFormat = await copyEmailTable(buildEmailHtml(rows), plainText).catch(() => "none");
      const instruction = clipboardFormat === "html"
        ? "已複製 HTML 格式的詢價表格。請在此郵件本文中貼上後再寄送。"
        : plainText;
      const uri = `mailto:${MAIL_TO}?subject=${encodeURIComponent(MAIL_SUBJECT)}&body=${encodeURIComponent(instruction)}`;
      window.location.href = uri;
      setStatus(
        clipboardFormat === "html"
          ? "已開啟郵件草稿並複製 HTML 表格；請在郵件本文貼上後寄送。"
          : "已開啟郵件草稿；此裝置無法複製 HTML 表格，已改帶入文字格式內容。",
        true
      );
    } catch (error) { setStatus(error.message); }
  }

  document.querySelector("#addRow").addEventListener("click", () => {
    if (tableBody.rows.length >= MAX_ROWS) return setStatus("最多只能新增 20 筆詢價交易。");
    createRow(); setStatus();
    tableBody.lastElementChild.scrollIntoView({ behavior: "smooth", block: "center" });
  });
  document.querySelector("#removeRow").addEventListener("click", () => {
    if (tableBody.rows.length <= 1) return setStatus("至少需保留 1 筆詢價交易。");
    tableBody.lastElementChild.remove(); renumberRows(); setStatus();
  });
  document.querySelector("#confirmAllQuotes").addEventListener("click", confirmAndSend);
  document.querySelector("#sendQuotes").addEventListener("click", confirmAndSend);
  tableBody.addEventListener("blur", event => {
    if (/^bbgCode[1-5]$/.test(event.target.name)) normaliseBbgCode(event.target);
  }, true);

  const dialog = document.querySelector("#helpDialog");
  document.querySelector("#showHelp").addEventListener("click", () => dialog.showModal());
  document.querySelector("#closeHelp").addEventListener("click", () => dialog.close());

  createRow();
  loadBbgLookup();
})();
