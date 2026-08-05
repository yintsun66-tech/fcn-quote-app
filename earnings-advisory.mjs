// Earnings-date advisory for the trade-entry form.
//
// Loaded unconditionally by index.html so that both builds behave the same: the Cloudflare app and
// the static GitHub Pages snapshot show the identical warning. It deliberately does not live in
// backend-client.js, which only activates in Cloudflare mode — that would have left the static
// build silently without the advisory, and silence here reads as an all-clear.
//
// It listens for the event app.js emits once a BBG code resolves, and never calls into app.js. The
// quoting flow is unchanged whether this module loads, fails to load, or the API is unreachable.

// Same origin-fallback shape follow-board.mjs already uses on the static site: try the app origin
// first, then the API origin, so one being blocked on a bank network does not kill the feature.
const API_ORIGINS = location.hostname === "app.yintsun66.com"
  ? ["", "https://api.yintsun66.com"]
  : location.hostname === "api.yintsun66.com"
    ? ["", "https://app.yintsun66.com"]
    : ["https://app.yintsun66.com", "https://api.yintsun66.com"];

const PATH = "/api/v1/public/market/earnings";
const DEBOUNCE_MS = 400;
const REQUEST_TIMEOUT_MS = 8000;
const HOUR_LABEL = { bmo: "盤前", amc: "盤後", dmh: "盤中" };

let timer = null;
let panel = null;
let inFlight = 0;

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, ch => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]
  ));
}

function host() {
  if (panel && panel.isConnected) return panel;
  const workspace = document.querySelector(".entry-workspace");
  if (!workspace) return null;
  panel = document.createElement("div");
  panel.className = "earnings-advisory";
  panel.setAttribute("role", "status");
  panel.setAttribute("aria-live", "polite");
  panel.hidden = true;
  const header = workspace.querySelector(".entry-workspace-header");
  if (header && header.nextSibling) workspace.insertBefore(panel, header.nextSibling);
  else workspace.appendChild(panel);
  return panel;
}

function currentUnderlyings() {
  const codes = new Set();
  document.querySelectorAll("#quoteTable tbody tr").forEach(row => {
    ["bbgCode1", "bbgCode2", "bbgCode3", "bbgCode4", "bbgCode5"].forEach(name => {
      const value = row.querySelector(`[name="${name}"]`)?.value?.trim();
      if (value) codes.add(value.toUpperCase());
    });
  });
  return [...codes];
}

function render(payload) {
  const target = host();
  if (!target) return;
  const hits = Array.isArray(payload?.hits) ? payload.hits : [];
  const unsupported = Array.isArray(payload?.unsupported) ? payload.unsupported : [];
  const unchecked = Array.isArray(payload?.unchecked) ? payload.unchecked : [];
  const parts = [];

  if (hits.length) {
    const list = hits
      .slice()
      .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
      .map(hit => {
        const label = HOUR_LABEL[hit.hour] || "";
        return `<li><b>${escapeHtml(hit.bbgCode)}</b>`
          + `<span>${escapeHtml(hit.date)}${label ? `　${label}` : ""}</span></li>`;
      })
      .join("");
    parts.push(
      `<p class="earnings-advisory-lead">⚠ 財報日前後可能影響報價與無法進場</p>`,
      `<ul class="earnings-advisory-list">${list}</ul>`,
      `<p class="earnings-advisory-note">以下標的在今日起三日內（含當日，依該市場當地日期）發布財報。</p>`
    );
  }

  if (payload && payload.available === false) {
    parts.push(
      `<p class="earnings-advisory-unavailable">財報日資料暫時無法取得，請自行確認。`
      + `未顯示警示不代表沒有財報。</p>`
    );
  } else {
    // Two different answers, deliberately not merged: an unsupported exchange will never work
    // through this provider, while an unchecked one only needs a plan covering that market.
    if (unchecked.length) {
      parts.push(
        `<p class="earnings-advisory-unavailable">未能查詢：${escapeHtml(unchecked.join("、"))}。`
        + `目前的資料方案不含該市場，請自行確認財報日。</p>`
      );
    }
    if (unsupported.length) {
      parts.push(
        `<p class="earnings-advisory-note">此資料來源不支援的交易所：`
        + `${escapeHtml(unsupported.join("、"))}。</p>`
      );
    }
  }

  target.innerHTML = parts.join("");
  target.hidden = parts.length === 0;
}

async function fetchAdvisory(codes) {
  const query = `${PATH}?symbols=${encodeURIComponent(codes.join(","))}`;
  let lastNetworkError = null;
  for (const origin of API_ORIGINS) {
    try {
      const response = await fetch(`${origin}${query}`, {
        headers: { accept: "application/json" },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (!response.ok) throw new Error(`HTTP_${response.status}`);
      return await response.json();
    } catch (error) {
      // Only a transport failure is worth trying the next origin for; a real HTTP error means we
      // reached the API and it answered.
      if (!(error instanceof TypeError)) throw error;
      lastNetworkError = error;
    }
  }
  throw lastNetworkError || new Error("UNREACHABLE");
}

async function refresh() {
  const codes = currentUnderlyings();
  if (!codes.length) {
    const target = host();
    if (target) { target.innerHTML = ""; target.hidden = true; }
    return;
  }
  const ticket = ++inFlight;
  try {
    const payload = await fetchAdvisory(codes);
    if (ticket !== inFlight) return;   // a newer edit already superseded this answer
    render(payload);
  } catch {
    if (ticket !== inFlight) return;
    // Surfaced, not swallowed: an empty advisory would read as "no earnings due".
    render({ available: false, hits: [], unsupported: [], unchecked: [] });
  }
}

document.addEventListener("fcn:underlying-resolved", () => {
  clearTimeout(timer);
  timer = setTimeout(refresh, DEBOUNCE_MS);
});
