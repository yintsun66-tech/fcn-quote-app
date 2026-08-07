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
// The window reaches back a day, so an already-published result and an upcoming one both appear.
// They are different situations to act on, and an unlabelled date leaves the operator to work out
// which is which against a market calendar that is not the one on their wall.
const DAY_LABEL = { "-1": "昨日已發布", "0": "今日", "1": "明日", "2": "後日" };

let timer = null;
let panel = null;
let inFlight = 0;
let activeController = null;
let activeKey = "";
let lastSuccessfulKey = "";
let lastSuccessfulPayload = null;

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
        const when = DAY_LABEL[String(hit.dayOffset)] || "";
        const hour = HOUR_LABEL[hit.hour] || "";
        const detail = [when, hour].filter(Boolean).join("・");
        return `<li><b>${escapeHtml(hit.bbgCode)}</b>`
          + `<span>${escapeHtml(hit.date)}${detail ? `　${escapeHtml(detail)}` : ""}</span></li>`;
      })
      .join("");
    parts.push(
      `<p class="earnings-advisory-lead">⚠ 財報日前後可能影響報價與無法進場</p>`,
      `<ul class="earnings-advisory-list">${list}</ul>`,
      `<p class="earnings-advisory-note">以下標的的財報日落在昨日至後日之間（依該市場當地日期）。</p>`
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

async function fetchWithTimeout(url, signal) {
  const controller = new AbortController();
  const forwardAbort = () => controller.abort(signal?.reason);
  if (signal?.aborted) forwardAbort();
  else signal?.addEventListener("abort", forwardAbort, { once: true });
  const timeoutId = setTimeout(() => controller.abort(new DOMException("Request timed out", "TimeoutError")), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(url, {
      headers: { accept: "application/json" },
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeoutId);
    signal?.removeEventListener("abort", forwardAbort);
  }
}

async function fetchAdvisory(codes, signal) {
  const query = `${PATH}?symbols=${encodeURIComponent(codes.join(","))}`;
  let lastNetworkError = null;
  for (const origin of API_ORIGINS) {
    try {
      const response = await fetchWithTimeout(`${origin}${query}`, signal);
      if (!response.ok) throw new Error(`HTTP_${response.status}`);
      return await response.json();
    } catch (error) {
      // Only a transport failure is worth trying the next origin for; a real HTTP error means we
      // reached the API and it answered.
      if (signal?.aborted) throw error;
      if (!(error instanceof TypeError) && !["AbortError", "TimeoutError"].includes(error?.name)) throw error;
      lastNetworkError = error;
    }
  }
  throw lastNetworkError || new Error("UNREACHABLE");
}

async function refresh() {
  const codes = currentUnderlyings().sort();
  if (!codes.length) {
    activeController?.abort();
    activeController = null;
    activeKey = "";
    inFlight += 1;
    const target = host();
    if (target) { target.innerHTML = ""; target.hidden = true; }
    return;
  }
  const key = codes.join(",");
  if (key === activeKey && activeController) return;
  if (activeController) {
    activeController.abort();
    activeController = null;
    activeKey = "";
    inFlight += 1;
  }
  if (key === lastSuccessfulKey && lastSuccessfulPayload) {
    render(lastSuccessfulPayload);
    return;
  }

  const controller = new AbortController();
  activeController = controller;
  activeKey = key;
  const ticket = ++inFlight;
  try {
    const payload = await fetchAdvisory(codes, controller.signal);
    if (ticket !== inFlight) return;   // a newer edit already superseded this answer
    lastSuccessfulKey = key;
    lastSuccessfulPayload = payload;
    render(payload);
  } catch (error) {
    if (ticket !== inFlight) return;
    if (controller.signal.aborted) return;
    // Surfaced, not swallowed: an empty advisory would read as "no earnings due".
    render({ available: false, hits: [], unsupported: [], unchecked: [] });
  } finally {
    if (activeController === controller) {
      activeController = null;
      activeKey = "";
    }
  }
}

document.addEventListener("fcn:underlying-resolved", () => {
  clearTimeout(timer);
  timer = setTimeout(refresh, DEBOUNCE_MS);
});
