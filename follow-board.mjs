const API_ORIGIN = location.hostname === "app.yintsun66.com" ? "" : "https://app.yintsun66.com";
const API_PREFIX = `${API_ORIGIN}/api/v1`;
const PIN_STORAGE_KEY = "fcn-follow-board-pin";
const THEMES = {
  BNP: ["#008a4b", "#0875a8", "#e7f8ef"],
  BARCLAYS: ["#0077a8", "#008b73", "#e7f6fb"],
  MS: ["#006f80", "#00855d", "#e5f7f6"],
  JPM: ["#174d85", "#00806c", "#e8f3fb"],
  NOMURA: ["#b51f36", "#7d1730", "#fbecee"],
  UBS: ["#d71920", "#8b1d33", "#fcebed"],
  DBS: ["#d31245", "#9e1638", "#fbe9ef"],
  SG: ["#0875b9", "#008a73", "#e8f5fb"],
  CITI: ["#056dae", "#d23449", "#e9f4fb"],
  GS: ["#1f6fb2", "#16866c", "#e9f4fb"],
  CA: ["#1b5aa6", "#168064", "#e9f1fb"]
};

const elements = Object.fromEntries([
  "pinGate", "pinForm", "viewPin", "pinError", "boardContent", "boardDate", "boardStatus",
  "productGrid", "refreshBoard", "lockBoard", "interestPanel", "interestForm",
  "selectedProductCode", "interestCurrency", "interestStatus", "dailyInterestRows",
  "dailyTotal", "captureHost", "adminPanel", "adminDate", "refreshAdmin", "adminStatus",
  "adminInterestRows"
].map(id => [id, document.getElementById(id)]));

const state = {
  pin: sessionStorage.getItem(PIN_STORAGE_KEY) || "",
  manifest: null,
  selectedProduct: null,
  user: null
};

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, character => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[character]);
}

function apiError(payload, fallback) {
  return payload?.error?.message || fallback;
}

async function publicRequest(path, options = {}) {
  const headers = new Headers(options.headers);
  headers.set("x-follow-board-pin", state.pin);
  if (options.body) headers.set("content-type", "application/json");
  const response = await fetch(`${API_PREFIX}${path}`, { ...options, headers });
  let payload = null;
  try { payload = await response.json(); } catch { /* use fallback */ }
  if (!response.ok) throw new Error(apiError(payload, `跟單專區載入失敗（${response.status}）。`));
  return payload;
}

function themeStyle(issuer) {
  const [primary, accent, soft] = THEMES[issuer] || THEMES.BNP;
  return `--theme-primary:${primary};--theme-accent:${accent};--theme-soft:${soft}`;
}

function percent(value) {
  return Number.isFinite(Number(value)) ? `${Number(Number(value).toFixed(4))}%` : "—";
}

function months(value) {
  return Number.isFinite(Number(value)) ? `${Number(value)} 個月` : "—";
}

function ticker(value) {
  return String(value || "").trim().split(/\s+/)[0] || "—";
}

function formatDateTime(value) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString("zh-TW", { hour12: false });
}

function formatAmount(value, currency) {
  return `${Number(value).toLocaleString("zh-TW")} ${currency}`;
}

function productTile(product) {
  const card = product.card;
  const underlyings = Array.isArray(card.underlyings) ? card.underlyings : [];
  const archiveButton = state.user && ["ADMIN", "PS"].includes(state.user.role)
    ? `<button type="button" class="secondary" data-archive-code="${escapeHtml(product.productCode)}">下架</button>`
    : "";
  return `<article class="product-tile" style="${themeStyle(product.issuer)}">
    <header><span class="product-code">${escapeHtml(product.productCode)}</span><span>${escapeHtml(product.issuer)}</span></header>
    <div class="product-tile-body">
      <h3>${escapeHtml(card.product)}｜${escapeHtml(card.currency)}</h3>
      <ul class="product-underlyings">${underlyings.map(item => `<li>${escapeHtml(ticker(item))}</li>`).join("")}</ul>
      <div class="product-metrics">
        <div><span>期間</span><strong>${months(card.tenorMonths)}</strong></div>
        <div><span>預估年化配息率</span><strong>${percent(product.estimatedYieldPct)}</strong></div>
        <div><span>交易日期</span><strong>${escapeHtml(product.tradeDate)}</strong></div>
        <div><span>發行機構</span><strong>${escapeHtml(card.issuerDisplayName || product.issuer)}</strong></div>
      </div>
      <p class="yield-note">預估年化配息率，非保證收益</p>
      <div class="tile-actions">
        <button type="button" data-download-code="${escapeHtml(product.productCode)}">下載商品圖</button>
        <button type="button" class="secondary" data-follow-code="${escapeHtml(product.productCode)}">我要跟單</button>
        ${archiveButton}
      </div>
    </div>
  </article>`;
}

function renderProducts() {
  const products = state.manifest?.products || [];
  elements.productGrid.innerHTML = products.length
    ? products.map(productTile).join("")
    : "<p class=\"empty-row\">目前沒有上架中的跟單商品。</p>";
}

function renderDailyInterests() {
  const rows = state.manifest?.dailyInterests || [];
  elements.dailyInterestRows.innerHTML = rows.length
    ? rows.map(row => `<tr>
      <td>${escapeHtml(row.productCode)}</td>
      <td>${escapeHtml(row.branchName)}<br><small>${escapeHtml(row.branchCode)}</small></td>
      <td>${escapeHtml(row.employeeNumber)}</td>
      <td>${escapeHtml(formatAmount(row.amountValue, row.currency))}</td>
      <td>${escapeHtml(formatDateTime(row.updatedAt))}</td>
    </tr>`).join("")
    : "<tr><td colspan=\"5\" class=\"empty-row\">今日尚無跟單登記。</td></tr>";
  const totals = new Map();
  for (const row of rows) totals.set(row.currency, (totals.get(row.currency) || 0) + Number(row.amountValue));
  elements.dailyTotal.textContent = [...totals].map(([currency, total]) => formatAmount(total, currency)).join("｜");
}

async function loadManifest() {
  elements.boardStatus.textContent = "正在載入跟單商品…";
  const manifest = await publicRequest("/public/follow-board/manifest");
  state.manifest = manifest;
  elements.boardDate.textContent = `彙整日期：${manifest.date}`;
  elements.adminDate.value = manifest.date;
  renderProducts();
  renderDailyInterests();
  elements.boardStatus.textContent = `已更新 ${manifest.products.length} 檔商品。`;
}

async function unlock(pin) {
  state.pin = pin;
  await loadManifest();
  sessionStorage.setItem(PIN_STORAGE_KEY, pin);
  elements.pinGate.hidden = true;
  elements.boardContent.hidden = false;
  await detectAdminSession();
}

function lock() {
  sessionStorage.removeItem(PIN_STORAGE_KEY);
  state.pin = "";
  state.manifest = null;
  state.selectedProduct = null;
  elements.boardContent.hidden = true;
  elements.pinGate.hidden = false;
  elements.interestPanel.hidden = true;
  elements.viewPin.value = "";
  elements.viewPin.focus();
}

function cardMarkup(product) {
  const card = product.card;
  const underlyings = Array.isArray(card.underlyings) ? card.underlyings : [];
  const kiValue = card.barrierType === "NONE" ? "—" : percent(card.kiBarrierPct);
  const kiType = card.barrierType === "NONE" ? "—" : card.barrierType || "—";
  return `<div class="download-card" style="${themeStyle(product.issuer)}"><article>
    <header class="download-hero">
      <span class="download-index">#${escapeHtml(card.sequence || 1)}</span>
      <div class="download-hero-row">
        <div><h1>${escapeHtml(card.product)} 報價</h1><p>（${escapeHtml(card.currency)} 本金）</p></div>
        <strong>${escapeHtml(product.issuer)}</strong>
      </div>
    </header>
    <section class="download-pair download-summary">
      <div><small>期間</small><b>${months(card.tenorMonths)}</b></div>
      <div><small>預估年化配息率</small><b class="highlight">${percent(card.couponPaPct)}</b></div>
    </section>
    <section class="download-underlyings">
      <small>連結標的</small>
      <div class="download-underlying-list">${underlyings.map(item => `<span>${escapeHtml(ticker(item))}</span>`).join("")}</div>
    </section>
    <section class="download-pair download-terms">
      <div><small>執行價</small><b>${percent(card.strikePct)}</b></div>
      <div><small>觸及生效價 KI</small><b>${kiValue}</b><em>${escapeHtml(kiType)}</em></div>
    </section>
    <section class="download-pair download-terms">
      <div><small>保證配息期間</small><b>${months(card.guaranteedPeriodsMonths)}</b></div>
      <div><small>提前出場價 KO</small><b>${percent(card.koBarrierPct)}</b><em>${escapeHtml(card.koType || "—")}</em></div>
    </section>
    <footer class="download-footer">
      <div class="download-meta"><span>發行機構：${escapeHtml(card.issuerDisplayName || product.issuer)}</span><span>交易日期：${escapeHtml(card.tradeDate || product.tradeDate)}</span></div>
      <div class="download-code">商品代碼：${escapeHtml(product.productCode)}</div>
    </footer>
  </article></div>`;
}

function withTimeout(promise, milliseconds, message) {
  let timeoutId;
  return Promise.race([
    promise,
    new Promise((_, reject) => { timeoutId = setTimeout(() => reject(new Error(message)), milliseconds); })
  ]).finally(() => clearTimeout(timeoutId));
}

async function downloadProductImage(product, button) {
  if (typeof window.html2canvas !== "function") throw new Error("圖片元件載入失敗，請重新整理後再試。");
  button.disabled = true;
  const original = button.textContent;
  button.textContent = "產圖中…";
  elements.captureHost.innerHTML = cardMarkup(product);
  const target = elements.captureHost.firstElementChild;
  try {
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const canvas = await withTimeout(window.html2canvas(target, {
      backgroundColor: "#ffffff",
      scale: 1.5,
      useCORS: false,
      logging: false,
      scrollX: 0,
      scrollY: 0,
      windowWidth: 720,
      windowHeight: target.scrollHeight
    }), 20_000, "產圖逾時，請重新整理後再試。");
    const blob = await withTimeout(new Promise(resolve => canvas.toBlob(resolve, "image/png")), 8_000, "圖片轉檔逾時。");
    if (!blob) throw new Error("圖片轉檔失敗。");
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${product.productCode}-${product.issuer}-${String(product.tradeDate).replaceAll("-", "")}.png`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1_000);
  } finally {
    elements.captureHost.replaceChildren();
    button.disabled = false;
    button.textContent = original;
  }
}

function selectProduct(product) {
  state.selectedProduct = product;
  elements.selectedProductCode.textContent = product.productCode;
  elements.interestCurrency.textContent = product.card.currency || "";
  elements.interestStatus.textContent = "";
  elements.interestPanel.hidden = false;
  elements.interestPanel.scrollIntoView({ behavior: "smooth", block: "start" });
}

function csrfToken() {
  const part = document.cookie.split(";").map(value => value.trim()).find(value => value.startsWith("__Host-fcn_csrf="));
  return part ? decodeURIComponent(part.slice(part.indexOf("=") + 1)) : "";
}

async function detectAdminSession() {
  if (location.hostname !== "app.yintsun66.com") return;
  try {
    const response = await fetch("/api/v1/auth/session", { credentials: "same-origin" });
    if (!response.ok) return;
    const payload = await response.json();
    state.user = payload.user;
    if (["ADMIN", "PS"].includes(state.user?.role)) {
      elements.adminPanel.hidden = false;
      renderProducts();
      await loadAdminInterests();
    }
  } catch {
    // Public follow-board use is independent from application login.
  }
}

async function loadAdminInterests() {
  if (!state.user || !["ADMIN", "PS"].includes(state.user.role)) return;
  elements.adminStatus.textContent = "正在載入完整明細…";
  try {
    const response = await fetch(`/api/v1/admin/follow-board/interests?date=${encodeURIComponent(elements.adminDate.value)}`, {
      credentials: "same-origin"
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(apiError(payload, "完整明細載入失敗。"));
    elements.adminInterestRows.innerHTML = payload.interests.length
      ? payload.interests.map(row => `<tr>
        <td>${escapeHtml(row.productCode)}</td><td>${escapeHtml(row.branchCode)}</td>
        <td>${escapeHtml(row.branchName)}</td><td>${escapeHtml(row.employeeNumber)}</td>
        <td>${escapeHtml(formatAmount(row.amountValue, row.currency))}</td>
        <td>${escapeHtml(row.sourceSite)}</td><td>${escapeHtml(formatDateTime(row.updatedAt))}</td>
      </tr>`).join("")
      : "<tr><td colspan=\"7\" class=\"empty-row\">指定日期沒有跟單資料。</td></tr>";
    elements.adminStatus.textContent = `共 ${payload.interests.length} 筆。`;
  } catch (error) {
    elements.adminStatus.textContent = error.message;
  }
}

async function archiveProduct(productCode) {
  if (!confirm(`確定下架商品 ${productCode}？下架後公開頁面將不再顯示。`)) return;
  const response = await fetch(`/api/v1/admin/follow-board/products/${encodeURIComponent(productCode)}/archive`, {
    method: "POST",
    credentials: "same-origin",
    headers: { "x-csrf-token": csrfToken() }
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(apiError(payload, "商品下架失敗。"));
  await loadManifest();
}

elements.pinForm.addEventListener("submit", async event => {
  event.preventDefault();
  const pin = elements.viewPin.value.trim();
  elements.pinError.textContent = "";
  if (!/^\d{4}$/.test(pin)) {
    elements.pinError.textContent = "請輸入四位數字。";
    return;
  }
  const button = elements.pinForm.querySelector("button");
  button.disabled = true;
  try {
    await unlock(pin);
  } catch (error) {
    state.pin = "";
    elements.pinError.textContent = error.message;
  } finally {
    button.disabled = false;
  }
});

elements.refreshBoard.addEventListener("click", () => loadManifest().catch(error => {
  elements.boardStatus.textContent = error.message;
}));
elements.lockBoard.addEventListener("click", lock);
elements.productGrid.addEventListener("click", event => {
  const downloadButton = event.target.closest("[data-download-code]");
  const followButton = event.target.closest("[data-follow-code]");
  const archiveButton = event.target.closest("[data-archive-code]");
  const code = downloadButton?.dataset.downloadCode || followButton?.dataset.followCode || archiveButton?.dataset.archiveCode;
  const product = state.manifest?.products.find(item => item.productCode === code);
  if (downloadButton && product) downloadProductImage(product, downloadButton).catch(error => {
    elements.boardStatus.textContent = error.message;
  });
  if (followButton && product) selectProduct(product);
  if (archiveButton && code) archiveProduct(code).catch(error => {
    elements.boardStatus.textContent = error.message;
  });
});

elements.interestForm.addEventListener("submit", async event => {
  event.preventDefault();
  if (!state.selectedProduct) return;
  const button = elements.interestForm.querySelector("button");
  button.disabled = true;
  elements.interestStatus.textContent = "正在送出…";
  try {
    const values = Object.fromEntries(new FormData(elements.interestForm));
    const result = await publicRequest("/public/follow-board/interests", {
      method: "POST",
      headers: { "idempotency-key": `follow-${crypto.randomUUID()}` },
      body: JSON.stringify({
        productCode: state.selectedProduct.productCode,
        branchCode: values.branchCode,
        branchName: values.branchName,
        employeeNumber: values.employeeNumber,
        amountValue: Number(values.amountValue)
      })
    });
    elements.interestStatus.textContent = `已登記 ${result.branchName}／${result.employeeNumber}：${formatAmount(result.amountValue, result.currency)}。`;
    await loadManifest();
    await loadAdminInterests();
  } catch (error) {
    elements.interestStatus.textContent = error.message;
  } finally {
    button.disabled = false;
  }
});

elements.refreshAdmin.addEventListener("click", loadAdminInterests);

if (/^\d{4}$/.test(state.pin)) {
  unlock(state.pin).catch(() => {
    sessionStorage.removeItem(PIN_STORAGE_KEY);
    state.pin = "";
  });
}
