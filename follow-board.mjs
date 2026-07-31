const OFFICIAL_FOLLOW_BOARD_URL = "https://app.yintsun66.com/follow-board.html";
const API_ORIGINS = location.hostname === "app.yintsun66.com"
  ? ["", "https://api.yintsun66.com"]
  : location.hostname === "api.yintsun66.com"
    ? ["", "https://app.yintsun66.com"]
    : ["https://app.yintsun66.com", "https://api.yintsun66.com"];
const IS_STATIC_SITE = location.hostname === "yintsun66-tech.github.io";
const PIN_STORAGE_KEY = "fcn-follow-board-pin";
const previewProductCode = new URLSearchParams(location.search).get("product")?.normalize("NFKC").trim().toUpperCase() || "";
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
  "adminInterestRows", "officialFollowBoardLink", "boardTitle", "dailyPanel"
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
  let lastNetworkError = null;
  for (const origin of API_ORIGINS) {
    try {
      const response = await fetch(`${origin}/api/v1${path}`, { ...options, headers });
      let payload = null;
      try { payload = await response.json(); } catch { /* use fallback */ }
      if (!response.ok) throw new Error(apiError(payload, `跟單專區載入失敗（${response.status}）。`));
      return payload;
    } catch (error) {
      if (!(error instanceof TypeError)) throw error;
      lastNetworkError = error;
    }
  }
  const error = new Error(
    IS_STATIC_SITE
      ? "瀏覽器阻擋靜態網站連線，請改用下方的正式跟單頁。"
      : "目前無法連線跟單服務，請確認網路後重新整理。"
  );
  error.cause = lastNetworkError;
  throw error;
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

function formatExpiryDate(value) {
  if (!value) return "由管理者下架";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  date.setMilliseconds(date.getMilliseconds() - 1);
  return new Intl.DateTimeFormat("zh-TW", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(date);
}

function salesFeePct(product) {
  const card = product?.card || {};
  if (card.salesFeePct !== null && card.salesFeePct !== undefined && card.salesFeePct !== "") {
    const saved = Number(card.salesFeePct);
    if (Number.isFinite(saved)) return saved;
  }
  if (card.comparablePricePct !== null
    && card.comparablePricePct !== undefined
    && card.comparablePricePct !== "") {
    const comparablePrice = Number(card.comparablePricePct);
    if (Number.isFinite(comparablePrice)) return Number((100 - comparablePrice).toFixed(4));
  }
  return Number.NaN;
}

function formatAmount(value, currency) {
  return `${Number(value).toLocaleString("zh-TW")} ${currency}`;
}

function productTile(product) {
  const archiveButton = state.user && ["ADMIN", "PS"].includes(state.user.role)
    ? `<button type="button" class="secondary" data-archive-code="${escapeHtml(product.productCode)}">下架</button>`
    : "";
  const imageButton = previewProductCode
    ? `<button type="button" data-download-code="${escapeHtml(product.productCode)}">下載 PNG</button>`
    : `<button type="button" data-preview-code="${escapeHtml(product.productCode)}">下載商品圖</button>`;
  return `<article class="product-tile" style="${themeStyle(product.issuer)}">
    <div class="product-card-frame">${cardMarkup(product)}</div>
    <div class="product-tile-controls">
      <p class="expiry-note">可跟單至：${escapeHtml(formatExpiryDate(product.expiresAt))}（台北時間）</p>
      <p class="sales-fee-note">手收：${percent(salesFeePct(product))}</p>
      <div class="tile-actions">
        ${imageButton}
        <button type="button" class="secondary" data-follow-code="${escapeHtml(product.productCode)}">我要跟單</button>
        ${archiveButton}
      </div>
    </div>
  </article>`;
}

function renderProducts() {
  const available = state.manifest?.products || [];
  const products = previewProductCode
    ? available.filter(product => product.productCode === previewProductCode)
    : available;
  elements.productGrid.innerHTML = products.length
    ? products.map(productTile).join("")
    : `<p class="empty-row">${previewProductCode ? "此商品不存在或已到期下架。" : "目前沒有上架中的跟單商品。"}</p>`;
  requestAnimationFrame(resizeProductPreviews);
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
  if (previewProductCode) {
    document.body.classList.add("product-preview-mode");
    document.title = `${previewProductCode} 商品圖`;
    elements.boardTitle.textContent = `${previewProductCode} 商品圖`;
    elements.boardDate.textContent = "圖片預覽";
    elements.dailyPanel.hidden = true;
  } else {
    elements.boardDate.textContent = `彙整日期：${manifest.date}`;
  }
  elements.adminDate.value = manifest.date;
  renderProducts();
  renderDailyInterests();
  elements.boardStatus.textContent = previewProductCode
    ? `顯示商品 ${previewProductCode}。`
    : `已更新 ${manifest.products.length} 檔商品。`;
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

function resizeProductPreviews() {
  for (const frame of document.querySelectorAll(".product-card-frame")) {
    const card = frame.firstElementChild;
    if (!(card instanceof HTMLElement)) continue;
    card.style.transform = "none";
    const scale = Math.min(1, frame.clientWidth / 720);
    card.style.transform = `scale(${scale})`;
    frame.style.height = `${Math.ceil(card.offsetHeight * scale)}px`;
  }
}

function openProductPreview(productCode) {
  const url = new URL(location.href);
  url.search = "";
  url.searchParams.set("product", productCode);
  url.hash = "";
  const preview = window.open(url.toString(), "_blank");
  if (!preview) throw new Error("瀏覽器阻擋新分頁，請允許此網站開啟彈出式視窗。");
  preview.opener = null;
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
  const previewButton = event.target.closest("[data-preview-code]");
  const downloadButton = event.target.closest("[data-download-code]");
  const followButton = event.target.closest("[data-follow-code]");
  const archiveButton = event.target.closest("[data-archive-code]");
  const code = previewButton?.dataset.previewCode
    || downloadButton?.dataset.downloadCode
    || followButton?.dataset.followCode
    || archiveButton?.dataset.archiveCode;
  const product = state.manifest?.products.find(item => item.productCode === code);
  if (previewButton && product) {
    try {
      openProductPreview(product.productCode);
    } catch (error) {
      elements.boardStatus.textContent = error.message;
    }
  }
  if (downloadButton && product) downloadProductImage(product, downloadButton).catch(error => {
    elements.boardStatus.textContent = error.message;
  });
  if (followButton && product) {
    alert("請透過 LINE 或電話聯繫高資產業務處同事或信託處辦理跟單。");
    selectProduct(product);
  }
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
window.addEventListener("resize", resizeProductPreviews);

if (IS_STATIC_SITE) {
  elements.officialFollowBoardLink.href = OFFICIAL_FOLLOW_BOARD_URL;
  elements.officialFollowBoardLink.hidden = false;
}

if (/^\d{4}$/.test(state.pin)) {
  unlock(state.pin).catch(() => {
    sessionStorage.removeItem(PIN_STORAGE_KEY);
    state.pin = "";
  });
}
