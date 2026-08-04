import {
  ANALYSIS_SCENARIOS,
  buildFcnAnalysis,
  parseIndicativeSpot,
  spotStorageKey
} from "./market-analysis.mjs?v=dac-analysis-v1";
// The specifier must stay byte-identical to the one app.js uses: a different query string is a
// different module URL, so the browser would download and instantiate this module a second time,
// and a version bump would only bust one of the two copies.
import {
  MARKET_RESOURCE_CONSENT_KEY,
  marketResourceDescriptor,
  tradingViewWidgetUrl
} from "./market-resources.mjs?v=market-hotlist-v3";

(() => {
  "use strict";
  if (location.hostname !== "app.yintsun66.com" && new URLSearchParams(location.search).get("backend") !== "1") return;

  const api = "/api/v1";
  const statusElement = document.querySelector("#status");
  const state = {
    user: null,
    rfqId: null,
    timer: null,
    badgeTimer: null,
    snapshotVersion: null,
    pollDelayMs: 4000,
    pollContext: null,
    latestStatus: null,
    inMailGrace: false,
    softDeadlineReached: false,
    expectedIssuerCount: 0,
    pendingIssuers: [],
    fastCloseReady: false,
    latestResultsRfq: null,
    latestResultTrades: [],
    artifactByQuote: {},
    customFifthSelections: {},
    hasRankings: false,
    rfqListScope: "active",
    rfqListCursor: null,
    rfqListItems: [],
    analysisInput: null,
    marketContextRequests: new Map()
  };

  const shell = document.createElement("section");
  shell.className = "backend-shell";
  shell.innerHTML = `
    <div class="backend-userbar" hidden>
      <span id="backendUser" class="backend-mobile-collapsible"></span>
      <button id="backendNewRfq" type="button" class="secondary backend-mobile-collapsible">新增詢價</button>
      <button id="backendMyRfqs" type="button" class="secondary">我的詢價 <span id="backendRfqBadge" class="backend-rfq-badge" hidden>0</span></button>
      <button id="backendAdminAccounts" type="button" class="secondary backend-mobile-collapsible" hidden>所有帳號列表</button>
      <button id="backendAdminRegistrations" type="button" class="secondary backend-mobile-collapsible" hidden>使用者申請審核</button>
      <button id="backendAdminOutbound" type="button" class="secondary backend-mobile-collapsible" hidden>管理者寄件紀錄</button>
      <button id="backendAdminTimelines" type="button" class="secondary backend-mobile-collapsible" hidden>RFQ 處理時間軸</button>
      <button id="backendLogout" type="button" class="secondary backend-mobile-collapsible">登出</button>
      <button id="backendMobileActionsToggle" type="button" class="secondary backend-mobile-menu-toggle" aria-expanded="false" aria-label="展開其他操作">
        <span id="backendMobileActionsLabel">更多</span><span class="backend-mobile-toggle-icon" aria-hidden="true">⌃</span>
      </button>
    </div>
    <main id="backendAnalysisView" class="backend-analysis-view" hidden>
      <section class="backend-analysis-shell">
        <header class="backend-analysis-header">
          <div><p class="eyebrow">FCN / DAC MARKET &amp; RISK</p><h1>市場與風險分析</h1></div>
          <a id="backendAnalysisBack" class="secondary backend-analysis-back" href="./">返回詢價結果</a>
        </header>
        <p class="backend-analysis-lead">以正式排名中的單一發行機構報價為基礎，搭配前一交易日收盤價或您手動輸入的參考現價做試算。</p>
        <p id="backendAnalysisError" class="backend-error" role="alert"></p>
        <div id="backendAnalysisContent" aria-live="polite"><p class="backend-analysis-loading">正在載入分析資料…</p></div>
      </section>
    </main>
    <dialog id="backendAuth" class="backend-dialog">
      <form id="backendLogin" class="backend-panel">
        <p class="eyebrow">SECURE QUOTE WORKSPACE</p><h2>登入詢價系統</h2>
        <label>登入帳號（新申請者為五碼行編）<input name="username" autocomplete="username" required minlength="5"></label>
        <label>密碼<input name="password" type="password" autocomplete="current-password" required></label>
        <p id="backendAuthError" class="backend-error" role="alert"></p>
        <button class="primary" type="submit">登入</button>
        <button id="showRegistration" class="link-button" type="button">申請新帳號</button>
      </form>
      <form id="backendRegistration" class="backend-panel" hidden>
        <p class="eyebrow">APPROVAL REQUIRED</p><h2>申請使用權限</h2>
        <label>分行名稱<input name="branchName" autocomplete="organization" required maxlength="100"></label>
        <label>五碼行編（即登入帳號）<input name="employeeNumber" autocomplete="username" inputmode="numeric" pattern="[0-9]{5}" minlength="5" maxlength="5" required></label>
        <label>密碼（至少 12 個字元）<input name="password" type="password" autocomplete="new-password" required minlength="12"></label>
        <p id="backendRegistrationError" class="backend-error" role="alert"></p>
        <button class="primary" type="submit">送出審核</button>
        <button id="showLogin" class="link-button" type="button">返回登入</button>
      </form>
    </dialog>
    <dialog id="backendProgress" class="backend-dialog backend-results-dialog">
      <section class="backend-panel">
        <div class="backend-results-heading"><div><p class="eyebrow">AUTOMATED RFQ</p><h2>詢價進度與比價結果</h2></div><div style="display:flex;gap:8px;flex-wrap:wrap"><button id="backendFinalizeNow" type="button" class="secondary" hidden>提早結束並比價</button><button id="backendRecalculate" type="button" class="secondary" hidden>納入晚到報價重新排名</button><button id="backendBackToRfqs" type="button" class="secondary">我的詢價</button><button id="closeBackendProgress" type="button" class="secondary">返回輸入</button></div></div>
        <p id="backendCountdown" class="backend-countdown"></p>
        <div id="backendIssuerStates" class="backend-issuer-grid"></div>
        <div id="backendRankings" class="backend-rankings"></div>
        <div id="backendArtifacts" class="backend-artifacts"></div>
      </section>
    </dialog>
    <dialog id="backendRfqHistory" class="backend-dialog backend-rfq-history-dialog">
      <section class="backend-panel">
        <div class="backend-results-heading">
          <div><p class="eyebrow">MY QUOTE WORKSPACE</p><h2>我的詢價</h2></div>
          <button id="closeBackendRfqHistory" type="button" class="secondary">關閉</button>
        </div>
        <p class="backend-archive-note">詢價由後端持續處理，離開等待畫面不會中止。可從這裡回到任何進行中或已完成的結果。</p>
        <div class="backend-rfq-tabs" role="tablist" aria-label="詢價清單篩選">
          <button type="button" class="secondary" data-rfq-scope="active" aria-selected="true">進行中</button>
          <button type="button" class="secondary" data-rfq-scope="completed" aria-selected="false">已完成</button>
          <button type="button" class="secondary" data-rfq-scope="all" aria-selected="false">全部</button>
        </div>
        <p id="backendRfqHistoryError" class="backend-error" role="alert"></p>
        <div id="backendRfqHistoryList" class="backend-rfq-history-list" aria-live="polite"></div>
        <button id="backendRfqLoadMore" type="button" class="secondary backend-rfq-load-more" hidden>載入更多</button>
      </section>
    </dialog>
    <dialog id="backendOutboundArchive" class="backend-dialog backend-archive-dialog">
      <section class="backend-panel">
        <div class="backend-results-heading"><div><p class="eyebrow">ADMINISTRATOR</p><h2>管理者寄件紀錄</h2></div><button id="closeBackendOutboundArchive" type="button" class="secondary">關閉</button></div>
        <p class="backend-archive-note">僅管理者可查看。內容保存在私人 R2，預覽會在隔離框架中開啟。</p>
        <p id="backendOutboundArchiveError" class="backend-error" role="alert"></p>
        <div id="backendOutboundArchiveList" class="backend-archive-list"></div>
        <section class="backend-archive-preview" aria-live="polite">
          <h3 id="backendOutboundArchiveSubject">請從上方選擇一封寄件紀錄</h3>
          <p id="backendOutboundArchiveMeta"></p>
          <iframe id="backendOutboundArchiveFrame" title="寄件 HTML 預覽" sandbox="" referrerpolicy="no-referrer"></iframe>
        </section>
      </section>
    </dialog>
    <dialog id="backendRegistrationReview" class="backend-dialog backend-registration-dialog">
      <section class="backend-panel">
        <div class="backend-results-heading"><div><p class="eyebrow">ADMINISTRATOR</p><h2>使用者申請審核</h2></div><button id="closeBackendRegistrationReview" type="button" class="secondary">關閉</button></div>
        <p class="backend-archive-note">僅管理者或 PS 可檢視待審核的申請資料。核准或拒絕都會留下稽核紀錄。</p>
        <p id="backendRegistrationReviewError" class="backend-error" role="alert"></p>
        <p id="backendRegistrationReviewStatus" class="backend-admin-status" role="status"></p>
        <p id="backendRegistrationDuplicateNote" class="backend-dup-note" role="status" hidden></p>
        <div id="backendRegistrationReviewList" class="backend-registration-list"></div>
      </section>
    </dialog>
    <dialog id="backendAccounts" class="backend-dialog backend-accounts-dialog">
      <section class="backend-panel">
        <div class="backend-results-heading"><div><p class="eyebrow">ADMINISTRATOR</p><h2>所有帳號列表</h2></div><button id="closeBackendAccounts" type="button" class="secondary">關閉</button></div>
        <p class="backend-archive-note">顯示全部帳號與上次上線時間（約 1 分鐘誤差）。管理者可升級／降級 PS 帳號並剔除一般帳號；PS 只能剔除一般帳號。只有 ADMIN 能永久刪除已剔除且從未建立詢價的帳號；管理者、PS 或已有詢價紀錄的帳號不得永久刪除。</p>
        <p id="backendAccountsError" class="backend-error" role="alert"></p>
        <p id="backendAccountsStatus" class="backend-admin-status" role="status"></p>
        <div id="backendAccountLookup" class="backend-account-lookup" hidden>
          <label for="backendAccountLookupInput">以行編查詢帳號</label>
          <input id="backendAccountLookupInput" inputmode="numeric" pattern="[0-9]{5}" maxlength="5" placeholder="五碼行編">
          <button id="backendAccountLookupBtn" type="button" class="secondary">查詢</button>
          <span id="backendAccountLookupResult" class="backend-account-lookup-result" role="status"></span>
        </div>
        <div id="backendAccountsList" class="backend-accounts-list"></div>
      </section>
    </dialog>
    <dialog id="backendRfqTimelines" class="backend-dialog backend-timeline-dialog">
      <section class="backend-panel">
        <div class="backend-results-heading"><div><p class="eyebrow">ADMINISTRATOR</p><h2>RFQ 處理時間軸</h2></div><button id="closeBackendRfqTimelines" type="button" class="secondary">關閉</button></div>
        <p class="backend-archive-note">僅顯示安全的處理狀態與耗時統計，不顯示郵件全文、RFQ token 或私人 R2 路徑。</p>
        <p id="backendRfqTimelinesError" class="backend-error" role="alert"></p>
        <div id="backendRfqHealth" class="backend-rfq-health"></div>
        <div id="backendMarketHealth" class="backend-rfq-health"></div>
        <div id="backendRfqTimelinesList" class="backend-timeline-list"></div>
      </section>
    </dialog>
    <dialog id="backendIssuerPicker" class="backend-dialog">
      <form id="backendIssuerPickerForm" class="backend-panel">
        <div class="backend-results-heading"><div><p class="eyebrow">SELECT ISSUERS</p><h2>選擇詢價與比價的發行機構</h2></div></div>
        <p class="backend-archive-note">只有勾選的機構會列入本次詢價與比價。BNP／MS／JPM／BARCLAYS 共用一封詢價信，勾選其中任一家就會寄出該封，但只有勾選者列入比價。</p>
        <label class="issuer-pick-all" style="display:block;margin:6px 0"><input type="checkbox" id="issuerPickAll" checked> <b>全部發行機構</b></label>
        <div class="issuer-pick-grid" style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:6px 16px;margin:10px 0">
          ${[["BNP", "BNP"], ["MS", "MS（OBU不得承做）"], ["JPM", "JPM"], ["BARCLAYS", "BARCLAYS"], ["NOMURA", "Nomura"], ["UBS", "UBS"], ["DBS", "DBS"], ["SG", "SG"], ["CITI", "CITI"], ["GS", "GS"], ["CA", "CA"]].map(([value, label]) => `<label class="issuer-pick"><input type="checkbox" class="issuer-pick-item" value="${value}" checked> ${label}</label>`).join("")}
        </div>
        <p id="backendIssuerPickerSummary" class="issuer-picker-summary" role="status"></p>
        <p id="backendIssuerPickerHint" class="backend-archive-note"></p>
        <p id="backendIssuerPickerError" class="backend-error" role="alert"></p>
        <div class="dialog-actions">
          <button type="button" id="cancelIssuerPicker" class="secondary">取消</button>
          <button type="submit" class="primary">送出詢價</button>
        </div>
      </form>
    </dialog>`;
  document.body.append(shell);

  const authDialog = document.querySelector("#backendAuth");
  const progressDialog = document.querySelector("#backendProgress");
  const finalizeButton = document.querySelector("#backendFinalizeNow");
  const recalculateButton = document.querySelector("#backendRecalculate");
  const issuerPickerDialog = document.querySelector("#backendIssuerPicker");
  const issuerPickerForm = document.querySelector("#backendIssuerPickerForm");
  const issuerPickAll = document.querySelector("#issuerPickAll");
  const issuerPickItems = [...document.querySelectorAll(".issuer-pick-item")];
  const issuerPickerSummary = document.querySelector("#backendIssuerPickerSummary");
  const issuerPickerHint = document.querySelector("#backendIssuerPickerHint");
  const issuerPickerError = document.querySelector("#backendIssuerPickerError");
  const newRfqButton = document.querySelector("#backendNewRfq");
  const myRfqsButton = document.querySelector("#backendMyRfqs");
  const rfqBadge = document.querySelector("#backendRfqBadge");
  const rfqHistoryDialog = document.querySelector("#backendRfqHistory");
  const rfqHistoryList = document.querySelector("#backendRfqHistoryList");
  const rfqHistoryError = document.querySelector("#backendRfqHistoryError");
  const rfqLoadMoreButton = document.querySelector("#backendRfqLoadMore");
  const loginForm = document.querySelector("#backendLogin");
  const registrationForm = document.querySelector("#backendRegistration");
  const userbar = document.querySelector(".backend-userbar");
  const mobileActionsToggle = document.querySelector("#backendMobileActionsToggle");
  const mobileActionsLabel = document.querySelector("#backendMobileActionsLabel");
  const mobileUserbarMedia = matchMedia("(max-width: 760px)");
  const adminRegistrationsButton = document.querySelector("#backendAdminRegistrations");
  const adminRegistrationReviewDialog = document.querySelector("#backendRegistrationReview");
  const adminRegistrationReviewList = document.querySelector("#backendRegistrationReviewList");
  const adminRegistrationReviewError = document.querySelector("#backendRegistrationReviewError");
  const adminRegistrationReviewStatus = document.querySelector("#backendRegistrationReviewStatus");
  const adminRegistrationDuplicateNote = document.querySelector("#backendRegistrationDuplicateNote");
  const adminAccountsButton = document.querySelector("#backendAdminAccounts");
  const adminAccountsDialog = document.querySelector("#backendAccounts");
  const adminAccountsList = document.querySelector("#backendAccountsList");
  const adminAccountsError = document.querySelector("#backendAccountsError");
  const adminAccountsStatus = document.querySelector("#backendAccountsStatus");
  const accountLookupRow = document.querySelector("#backendAccountLookup");
  const accountLookupInput = document.querySelector("#backendAccountLookupInput");
  const accountLookupBtn = document.querySelector("#backendAccountLookupBtn");
  const accountLookupResult = document.querySelector("#backendAccountLookupResult");
  const adminOutboundButton = document.querySelector("#backendAdminOutbound");
  const adminOutboundDialog = document.querySelector("#backendOutboundArchive");
  const adminOutboundList = document.querySelector("#backendOutboundArchiveList");
  const adminOutboundError = document.querySelector("#backendOutboundArchiveError");
  const adminOutboundSubject = document.querySelector("#backendOutboundArchiveSubject");
  const adminOutboundMeta = document.querySelector("#backendOutboundArchiveMeta");
  const adminOutboundFrame = document.querySelector("#backendOutboundArchiveFrame");
  const adminTimelinesButton = document.querySelector("#backendAdminTimelines");
  const adminTimelinesDialog = document.querySelector("#backendRfqTimelines");
  const adminTimelinesList = document.querySelector("#backendRfqTimelinesList");
  const adminTimelinesError = document.querySelector("#backendRfqTimelinesError");
  const adminRfqHealth = document.querySelector("#backendRfqHealth");
  const adminMarketHealth = document.querySelector("#backendMarketHealth");
  const artifactContainer = document.querySelector("#backendArtifacts");
  const analysisView = document.querySelector("#backendAnalysisView");
  const analysisContent = document.querySelector("#backendAnalysisContent");
  const analysisError = document.querySelector("#backendAnalysisError");
  const analysisBack = document.querySelector("#backendAnalysisBack");

  function setMobileActionsExpanded(expanded) {
    const next = Boolean(expanded && mobileUserbarMedia.matches && state.user);
    userbar.classList.toggle("is-expanded", next);
    mobileActionsToggle.setAttribute("aria-expanded", String(next));
    mobileActionsToggle.setAttribute("aria-label", next ? "收合其他操作" : "展開其他操作");
    mobileActionsLabel.textContent = next ? "收合" : "更多";
  }

  function cookie(name) {
    return document.cookie.split(";").map(item => item.trim()).find(item => item.startsWith(`${name}=`))?.slice(name.length + 1) || "";
  }

  function idempotency(prefix) {
    return `${prefix}:${crypto.randomUUID()}`;
  }

  async function request(path, options = {}) {
    const headers = new Headers(options.headers);
    if (options.body && !headers.has("content-type")) headers.set("content-type", "application/json");
    if (options.method && options.method !== "GET") {
      const csrf = cookie("__Host-fcn_csrf");
      if (csrf) headers.set("x-csrf-token", csrf);
    }
    const response = await fetch(`${api}${path}`, { ...options, headers, credentials: "same-origin" });
    const isJson = response.headers.get("content-type")?.includes("application/json");
    const payload = isJson ? await response.json() : null;
    if (!response.ok) {
      const error = new Error(payload?.error?.message || `伺服器錯誤（${response.status}）`);
      error.code = payload?.error?.code;
      throw error;
    }
    return payload;
  }

  function showAuth() {
    if (!authDialog.open) authDialog.showModal();
  }

  function setUser(user) {
    state.user = user;
    setMobileActionsExpanded(false);
    userbar.hidden = !user;
    const isSupport = !!user && (user.role === "ADMIN" || user.role === "PS");
    adminAccountsButton.hidden = !isSupport;
    adminRegistrationsButton.hidden = !isSupport;
    adminOutboundButton.hidden = !user || user.role !== "ADMIN";
    adminTimelinesButton.hidden = !user || user.role !== "ADMIN";
    document.querySelector("#backendUser").textContent = user ? `${user.displayName}｜${user.branchName}` : "";
    if (!user) {
      clearTimeout(state.timer);
      clearTimeout(state.badgeTimer);
      setRfqBadge(0);
    }
    if (user && authDialog.open) authDialog.close();
  }

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, character => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    })[character]);
  }

  function formatDateTime(value) {
    if (!value) return "—";
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString("zh-TW", { hour12: false });
  }

  const activeWorkflowStatuses = new Set(["DRAFT", "VALIDATED", "QUEUED", "SENDING", "WAITING", "PARTIAL", "FINALIZING"]);
  const workflowLabels = {
    DRAFT: "草稿",
    VALIDATED: "準備寄送",
    QUEUED: "排隊中",
    SENDING: "寄送中",
    WAITING: "等待回覆",
    PARTIAL: "已有部分報價",
    FINALIZING: "正在比價",
    COMPLETED: "已完成",
    NO_VALID_QUOTE: "無有效報價",
    FAILED: "處理失敗",
    CANCELLED: "已取消"
  };

  function setRfqBadge(count) {
    const value = Math.max(0, Number(count) || 0);
    rfqBadge.textContent = String(value);
    rfqBadge.hidden = value === 0;
    myRfqsButton.setAttribute("aria-label", value ? `我的詢價，${value} 筆進行中` : "我的詢價");
  }

  function currentRfqFromUrl() {
    const rfqId = new URL(location.href).searchParams.get("rfq");
    return rfqId && /^rfq_[A-Za-z0-9-]+$/u.test(rfqId) ? rfqId : null;
  }

  function currentAnalysisFromUrl() {
    const url = new URL(location.href);
    const rfqId = currentRfqFromUrl();
    const tradeCode = url.searchParams.get("trade");
    const quoteId = url.searchParams.get("quote");
    if (
      url.searchParams.get("view") !== "analysis"
      || !rfqId
      || !/^T(?:0[1-9]|1[0-9]|20)$/u.test(tradeCode ?? "")
      || !/^quo_[A-Za-z0-9-]+$/u.test(quoteId ?? "")
    ) return null;
    return { rfqId, tradeCode, quoteId };
  }

  function rfqResultUrl(rfqId) {
    const url = new URL(location.href);
    url.search = "";
    url.searchParams.set("rfq", rfqId);
    return `${url.pathname}${url.search}`;
  }

  function analysisUrl(rfqId, tradeCode, quoteId) {
    const url = new URL(location.href);
    url.search = "";
    url.searchParams.set("rfq", rfqId);
    url.searchParams.set("view", "analysis");
    url.searchParams.set("trade", tradeCode);
    url.searchParams.set("quote", quoteId);
    return `${url.pathname}${url.search}`;
  }

  function updateRfqUrl(rfqId, replace = false) {
    const url = new URL(location.href);
    if (rfqId) url.searchParams.set("rfq", rfqId);
    else url.searchParams.delete("rfq");
    history[replace ? "replaceState" : "pushState"]({ rfqId }, "", `${url.pathname}${url.search}${url.hash}`);
  }

  function percentText(value) {
    if (value === null || value === undefined || value === "") return "—";
    const number = Number(value);
    return Number.isFinite(number) ? `${Number(number.toFixed(4))}%` : "—";
  }

  function numberText(value) {
    if (value === null || value === undefined || value === "") return "—";
    const number = Number(value);
    return Number.isFinite(number)
      ? number.toLocaleString("zh-TW", { maximumFractionDigits: 4 })
      : "—";
  }

  function loadSpotDraft(rfqId, tradeCode, underlying) {
    try {
      const raw = localStorage.getItem(spotStorageKey(rfqId, tradeCode, underlying));
      if (!raw) return { spot: null, observedAt: "" };
      const parsed = JSON.parse(raw);
      return {
        spot: parseIndicativeSpot(parsed?.spot),
        observedAt: typeof parsed?.observedAt === "string" ? parsed.observedAt : ""
      };
    } catch {
      return { spot: null, observedAt: "" };
    }
  }

  function saveSpotDraft(rfqId, tradeCode, underlying, spot, observedAt) {
    try {
      const key = spotStorageKey(rfqId, tradeCode, underlying);
      if (spot === null && !observedAt) {
        localStorage.removeItem(key);
        return;
      }
      localStorage.setItem(key, JSON.stringify({ version: 1, spot, observedAt }));
    } catch {
      // Browsers may disable storage. Analysis still works for the current page session.
    }
  }

  function localDateTimeValue() {
    const now = new Date();
    const local = new Date(now.getTime() - now.getTimezoneOffset() * 60000);
    return local.toISOString().slice(0, 16);
  }

  function availableAnalysisQuotes(results, tradeCode) {
    const trade = results?.trades?.find(item => item.tradeCode === tradeCode);
    if (!trade) return [];
    const seen = new Set();
    return [
      ...(trade.rankings ?? []).map(item => ({
        quoteId: item.quoteId,
        label: `第 ${item.rank} 名${item.tie ? "（同價）" : ""}｜${item.issuerDisplayName}`
      })),
      ...(trade.alternateQuotes ?? []).map(item => ({
        quoteId: item.quoteId,
        label: `自選候選｜${item.issuerDisplayName}`
      }))
    ].filter(item => {
      if (seen.has(item.quoteId)) return false;
      seen.add(item.quoteId);
      return true;
    });
  }

  function isDacAnalysisProduct(product) {
    const normalized = String(product ?? "").normalize("NFKC").trim().replace(/\s+/gu, " ").toUpperCase();
    return ["DAC", "DRA", "WRA", "RANGE ACCRUAL"].includes(normalized);
  }

  function renderAnalysisCalculation() {
    const input = state.analysisInput;
    const container = document.querySelector("#backendAnalysisCalculation");
    if (!input || !container) return;
    const spots = {};
    analysisContent.querySelectorAll("[data-analysis-spot]").forEach(field => {
      spots[field.dataset.analysisSpot] = field.value;
    });
    let analysis;
    try {
      analysis = buildFcnAnalysis(input.terms, spots, ANALYSIS_SCENARIOS);
      analysisError.textContent = "";
    } catch (error) {
      container.innerHTML = "";
      analysisError.textContent = error instanceof Error ? error.message : "無法建立分析。";
      return;
    }

    const levelRows = analysis.referenceLevels.map(level => `<tr>
      <td><strong>${escapeHtml(level.underlying)}</strong></td>
      <td>${numberText(level.spot)}</td>
      <td>${numberText(level.strikePrice)}</td>
      <td>${numberText(level.koPrice)}</td>
      <td>${input.terms.barrierType === "NONE" ? "不適用" : numberText(level.kiPrice)}</td>
    </tr>`).join("");
    const scenarioRows = analysis.scenarios.map(row => {
      const projected = row.projectedPrices.map(item => `${escapeHtml(item.underlying)}：${numberText(item.price)}`).join("<br>");
      return `<tr>
        <td>${row.changePct > 0 ? "+" : ""}${escapeHtml(row.changePct)}%</td>
        <td>${escapeHtml(row.worstOfIndexPct)}%</td>
        <td>${projected || "請先輸入參考現價"}</td>
        <td>${escapeHtml(row.koAssessment)}</td>
        <td>${escapeHtml(row.kiAssessment)}</td>
        ${analysis.dacAccrualCondition ? `<td>${escapeHtml(row.accrualAssessment)}</td>` : ""}
        <td>${escapeHtml(row.outcome)}</td>
      </tr>`;
    }).join("");
    const dacNotice = analysis.dacAccrualCondition
      ? `<aside class="backend-analysis-product-warning" role="note">
          <strong>DAC／DRA 保息期後利息條件</strong>
          <p>${escapeHtml(analysis.dacAccrualCondition.description)}</p>
        </aside>`
      : "";
    const aki = analysis.akiBranches.length
      ? `<section class="backend-analysis-paths"><h2>AKI 路徑分流</h2><div>${analysis.akiBranches.map(branch => `<article><h3>${escapeHtml(branch.title)}</h3><p>${escapeHtml(branch.description)}</p></article>`).join("")}</div></section>`
      : "";
    container.innerHTML = `
      ${dacNotice}
      <section class="backend-analysis-section">
        <div class="backend-analysis-section-heading"><div><p class="eyebrow">REFERENCE LEVELS</p><h2>依參考現價換算的試算價位</h2></div>
          <div class="backend-analysis-metrics"><span>KO 所需變動 <b>${percentText(analysis.metrics.koRequiredMovePct)}</b></span><span>KI 緩衝 <b>${percentText(analysis.metrics.kiBufferPct)}</b></span></div>
        </div>
        <div class="backend-analysis-table-wrap"><table><thead><tr><th>連結標的</th><th>參考現價</th><th>試算執行價</th><th>試算 KO 價</th><th>試算 KI 價</th></tr></thead><tbody>${levelRows}</tbody></table></div>
      </section>
      <section class="backend-analysis-section">
        <p class="eyebrow">WORST-OF SCENARIOS</p><h2>最弱標的情境表</h2>
        <p class="backend-analysis-note">情境以目前參考現價為 100，並假設所有標的同步變動；多標的判斷採最弱標的，不取平均。</p>
        <div class="backend-analysis-table-wrap"><table><thead><tr><th>情境變動</th><th>最弱標的指數</th><th>試算價格</th><th>KO 判斷</th><th>KI／路徑判斷</th>${analysis.dacAccrualCondition ? "<th>保息期後利息</th>" : ""}<th>方向性說明</th></tr></thead><tbody>${scenarioRows}</tbody></table></div>
      </section>
      ${aki}
      <p class="backend-analysis-disclaimer">${escapeHtml(analysis.disclaimer)}</p>`;
  }

  function marketResourceConsent() {
    try {
      return localStorage.getItem(MARKET_RESOURCE_CONSENT_KEY) === "granted";
    } catch {
      return false;
    }
  }

  function setMarketResourceConsent(granted) {
    try {
      if (granted) localStorage.setItem(MARKET_RESOURCE_CONSENT_KEY, "granted");
      else localStorage.removeItem(MARKET_RESOURCE_CONSENT_KEY);
    } catch {
      // Consent remains valid for this page even when browser storage is unavailable.
    }
  }

  function renderMarketResourcesPanel(underlyings) {
    const descriptors = (Array.isArray(underlyings) ? underlyings : []).map(marketResourceDescriptor);
    const supported = descriptors.filter(item => item.supported);
    const consentChecked = marketResourceConsent() ? " checked" : "";
    const options = supported.map(item =>
      `<option value="${escapeHtml(item.underlying)}">${escapeHtml(item.underlying)}</option>`
    ).join("");
    const links = descriptors.map(item => {
      if (!item.supported) {
        return `<article><h3>${escapeHtml(item.underlying || "未識別標的")}</h3>
          <p>尚未建立安全的交易所代碼映射，不會載入圖表。</p>
          <a href="${escapeHtml(item.searchUrl)}" target="_blank" rel="noopener noreferrer nofollow">前往 TradingView 搜尋</a></article>`;
      }
      return `<article>
        <h3>${escapeHtml(item.ticker)} <small>${escapeHtml(item.exchange)}</small></h3>
        <nav aria-label="${escapeHtml(item.ticker)} 公開市場連結">
          <a href="${escapeHtml(item.links.yahooFinance)}" target="_blank" rel="noopener noreferrer nofollow">Yahoo Finance</a>
          <a href="${escapeHtml(item.links.googleTrends)}" target="_blank" rel="noopener noreferrer nofollow">Google Trends</a>
          <a href="${escapeHtml(item.links.cboe)}" target="_blank" rel="noopener noreferrer nofollow">Cboe 延遲報價</a>
          <a href="${escapeHtml(item.links.oic)}" target="_blank" rel="noopener noreferrer nofollow">OIC 選擇權工具</a>
        </nav>
      </article>`;
    }).join("");

    return `<details class="backend-market-resources">
      <summary>每日市場資料與標的靈感</summary>
      <div class="backend-market-resources-body">
        <p class="backend-analysis-note">Alpha Vantage 只提供此標的前一交易日的收盤價與日線統計，用於帶入上方參考現價。市場熱門榜已移至首頁，改由 TradingView 提供。這些內容只供參考，不會改變詢價、正式排名或報價圖。</p>
        <div class="backend-market-consent">
          <label><input type="checkbox" data-market-consent${consentChecked}> 我了解載入圖表後，TradingView 會收到我的 IP、瀏覽器資訊與所選股票代碼；不會傳送 RFQ、行編、分行、報價或發行機構資料。</label>
        </div>
        ${supported.length ? `<div class="backend-market-controls">
          <label>圖表標的<select data-market-symbol>${options}</select></label>
          <button type="button" class="secondary" data-market-context-load>載入公司與前收資料</button>
          <button type="button" class="secondary" data-market-load>載入外部圖表</button>
          <button type="button" class="secondary" data-market-unload hidden>卸載圖表</button>
        </div>
        <p class="backend-market-status" data-market-status role="status"></p>
        <div class="backend-market-context" data-market-context aria-live="polite"></div>
        <div class="backend-market-widget" data-market-widget></div>` : `<p class="backend-market-status">目前標的沒有可確認的美股交易所代碼，因此不載入外部圖表。</p>`}
        <div class="backend-market-links">${links}</div>
        <p class="backend-market-source-note">前收與日線統計來源：Alpha Vantage（免費資料為收盤後更新）。圖表與首頁熱門榜來源：TradingView（可能為即時、延遲或收盤資料，依市場與方案而異）。連結來源：Yahoo Finance、Google Trends、Cboe、Options Industry Council。所有內容均為公開資訊參考，不構成投資建議。</p>
      </div>
    </details>`;
  }

  function unloadMarketWidget(container) {
    const host = container.querySelector("[data-market-widget]");
    if (host) {
      host.replaceChildren();
      delete host.dataset.loaded;
    }
    const unload = container.querySelector("[data-market-unload]");
    if (unload) unload.hidden = true;
    const load = container.querySelector("[data-market-load]");
    if (load) load.hidden = false;
  }

  function loadMarketWidget(container) {
    const consent = container.querySelector("[data-market-consent]");
    const status = container.querySelector("[data-market-status]");
    const host = container.querySelector("[data-market-widget]");
    const select = container.querySelector("[data-market-symbol]");
    if (!consent?.checked) {
      if (status) status.textContent = "請先勾選同意，再載入第三方圖表。";
      return;
    }
    const descriptor = marketResourceDescriptor(select?.value);
    if (!host || !descriptor.supported) {
      if (status) status.textContent = "此標的尚未建立安全的交易所代碼映射。";
      return;
    }

    const iframe = document.createElement("iframe");
    iframe.title = `${descriptor.ticker} TradingView 公開市場圖表`;
    iframe.loading = "lazy";
    iframe.referrerPolicy = "no-referrer";
    iframe.setAttribute("sandbox", "allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox");
    iframe.src = tradingViewWidgetUrl(descriptor);
    host.replaceChildren(iframe);
    host.dataset.loaded = "1";
    setMarketResourceConsent(true);
    if (status) status.textContent = `${descriptor.ticker} 圖表已載入；其資料不會進入本頁試算。`;
    const unload = container.querySelector("[data-market-unload]");
    if (unload) unload.hidden = false;
    const load = container.querySelector("[data-market-load]");
    if (load) load.hidden = true;
  }

  function publicSourceStatus(source) {
    if (!source) return "無資料";
    if (source.status === "FRESH") return "最新快取";
    if (source.status === "STALE") return "暫用過期快取";
    return "目前無法取得";
  }

  function officialSecUrl(value) {
    try {
      const url = new URL(value);
      return url.protocol === "https:" && (url.hostname === "www.sec.gov" || url.hostname === "sec.gov")
        ? url.toString()
        : null;
    } catch {
      return null;
    }
  }

  function marketNumber(value, maximumFractionDigits = 2) {
    const number = Number(value);
    return Number.isFinite(number)
      ? number.toLocaleString("zh-TW", { maximumFractionDigits })
      : "—";
  }

  function marketPercent(value) {
    const number = Number(value);
    return Number.isFinite(number)
      ? `${number > 0 ? "+" : ""}${number.toLocaleString("zh-TW", { maximumFractionDigits: 2 })}%`
      : "—";
  }

  function marketVolume(value) {
    const number = Number(value);
    return Number.isFinite(number)
      ? Math.round(number).toLocaleString("zh-TW")
      : "—";
  }

  function marketContextRequest(descriptor) {
    const existing = state.marketContextRequests.get(descriptor.ticker);
    if (existing) return existing;
    const pending = request(`/market/instruments/${encodeURIComponent(descriptor.ticker)}/context`)
      .catch(error => {
        state.marketContextRequests.delete(descriptor.ticker);
        throw error;
      });
    state.marketContextRequests.set(descriptor.ticker, pending);
    return pending;
  }

  function renderMarketContext(container, marketContext) {
    const host = container.querySelector("[data-market-context]");
    if (!host) return;
    const sec = marketContext?.sec;
    // The Worker and this file deploy separately, so read the new field but keep accepting the old
    // one until both sides are known current. The old name is also a lie now: the close may come
    // from any provider in the chain, which is why `equity.provider` is displayed.
    const equityDaily = marketContext?.equityDaily ?? marketContext?.alphaVantage;
    const company = sec?.data?.company;
    const filings = Array.isArray(sec?.data?.recentFilings) ? sec.data.recentFilings : [];
    const equity = equityDaily?.data;
    const secContent = company
      ? `<article class="backend-market-context-card">
          <header><div><p class="eyebrow">SEC EDGAR</p><h3>${escapeHtml(company.companyName)}</h3></div><span>${escapeHtml(publicSourceStatus(sec))}</span></header>
          <dl><div><dt>Ticker</dt><dd>${escapeHtml(company.ticker)}</dd></div><div><dt>Exchange</dt><dd>${escapeHtml(company.exchange || "—")}</dd></div><div><dt>CIK</dt><dd>${escapeHtml(company.cik)}</dd></div></dl>
          <h4>最近 5 筆 10-K／10-Q／8-K</h4>
          ${filings.length ? `<ul>${filings.map(filing => {
            const url = officialSecUrl(filing.officialUrl);
            return `<li><b>${escapeHtml(filing.form)}</b><span>${escapeHtml(filing.filingDate)}</span>${url ? `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">SEC 原始文件</a>` : ""}</li>`;
          }).join("")}</ul>` : "<p>目前沒有可顯示的指定申報文件。</p>"}
          <small>資料日期 ${escapeHtml(sec.sourceAsOf || "—")}｜擷取 ${escapeHtml(formatDateTime(sec.fetchedAt))}${sec.isStale ? "｜資料已過期，暫供參考" : ""}</small>
        </article>`
      : `<article class="backend-market-context-card"><header><h3>SEC EDGAR</h3><span>${escapeHtml(publicSourceStatus(sec))}</span></header><p>目前無法取得此標的的 SEC 公司與申報資料。</p></article>`;
    // Naming the provider matters: the chain can fall back, and a price whose source is invisible
    // invites the reader to assume it came from wherever they last remember configuring.
    const providerLabel = String(equity?.provider || "").replace(/_/g, " ") || "收盤價來源";
    const alphaContent = equity
      ? `<article class="backend-market-context-card backend-alpha-card">
          <header><div><p class="eyebrow">${escapeHtml(providerLabel)}</p><h3>${escapeHtml(equity.symbol)} 前一交易日</h3></div><span>${escapeHtml(publicSourceStatus(equityDaily))}</span></header>
          <strong class="backend-market-close">USD ${escapeHtml(marketNumber(equity.closePrice, 4))}</strong>
          <small>交易日 ${escapeHtml(equity.tradingDate)}｜較前收 ${escapeHtml(marketPercent(equity.dailyChangePct))}</small>
          <dl>
            <div><dt>成交量</dt><dd>${escapeHtml(marketVolume(equity.volume))}</dd></div>
            <div><dt>相對量能</dt><dd>${escapeHtml(marketNumber(equity.relativeVolume20d))}×</dd></div>
            <div><dt>20日歷史波動</dt><dd>${escapeHtml(marketNumber(equity.realizedVolatility20dPct))}%</dd></div>
            <div><dt>20日高低區間</dt><dd>${escapeHtml(marketNumber(equity.range20dPct))}%</dd></div>
          </dl>
          <small>資料日期 ${escapeHtml(equityDaily.sourceAsOf || equity.tradingDate)}｜擷取 ${escapeHtml(formatDateTime(equityDaily.fetchedAt))}${equityDaily.isStale ? "｜資料已過期，暫供參考" : ""}</small>
        </article>`
      : `<article class="backend-market-context-card"><header><h3>前一交易日收盤價</h3><span>${escapeHtml(publicSourceStatus(equityDaily))}</span></header><p>目前無法取得此標的的前一交易日股價。</p></article>`;
    host.innerHTML = `<div class="backend-market-context-grid">${secContent}${alphaContent}</div>
      <p class="backend-market-source-note">SEC／Alpha Vantage 資料僅供公開資訊參考。前收可作為上方試算的起始值，但不會寫回詢價條件、正式排名或報價圖。</p>`;
  }

  async function loadMarketContext(container, button) {
    const select = container.querySelector("[data-market-symbol]");
    const host = container.querySelector("[data-market-context]");
    const descriptor = marketResourceDescriptor(select?.value);
    if (!host || !descriptor.supported) {
      if (host) host.innerHTML = "<p class=\"backend-market-status\">此標的尚未建立安全的美股代碼映射。</p>";
      return;
    }
    button.disabled = true;
    const original = button.textContent;
    button.textContent = "載入中…";
    host.innerHTML = "<p class=\"backend-market-status\">正在讀取 SEC 與 Alpha Vantage 公開資料…</p>";
    try {
      const payload = await marketContextRequest(descriptor);
      renderMarketContext(container, payload.marketContext);
    } catch (error) {
      host.innerHTML = `<p class="backend-error">${escapeHtml(error.message || "公開資料載入失敗。")}</p>`;
    } finally {
      button.disabled = false;
      button.textContent = original;
    }
  }

  function analysisSpotFields(underlying) {
    const spot = [...analysisContent.querySelectorAll("[data-analysis-spot]")]
      .find(field => field.dataset.analysisSpot === underlying);
    const observed = [...analysisContent.querySelectorAll("[data-analysis-observed]")]
      .find(field => field.dataset.analysisObserved === underlying);
    const source = [...analysisContent.querySelectorAll("[data-analysis-source]")]
      .find(field => field.dataset.analysisSource === underlying);
    return { spot, observed, source };
  }

  function alphaSpotSourceHtml(underlying, equity, mode) {
    const summary = `Alpha Vantage 前一交易日 ${equity.tradingDate} 收盤 USD ${marketNumber(equity.closePrice, 4)}`;
    if (mode === "manual") {
      return `${escapeHtml(summary)}；目前保留瀏覽器中的手動值。
        <button type="button" class="link-button backend-apply-close" data-apply-previous-close="${escapeHtml(underlying)}" data-close-price="${escapeHtml(equity.closePrice)}" data-close-date="${escapeHtml(equity.tradingDate)}">套用前收</button>`;
    }
    return `${escapeHtml(summary)}（自動帶入；可手動修改）`;
  }

  function applyPreviousClose(underlying, closePrice, tradingDate, persist) {
    const fields = analysisSpotFields(underlying);
    const close = parseIndicativeSpot(closePrice);
    if (!fields.spot || !fields.source || close === null || !/^\d{4}-\d{2}-\d{2}$/u.test(tradingDate)) return;
    fields.spot.value = String(close);
    if (fields.observed) fields.observed.value = `${tradingDate}T16:00`;
    fields.source.innerHTML = `${escapeHtml(`Alpha Vantage 前一交易日 ${tradingDate} 收盤 USD ${marketNumber(close, 4)}`)}${persist ? "（已套用並儲存在此瀏覽器）" : "（自動帶入；可手動修改）"}`;
    if (persist && state.analysisInput) {
      saveSpotDraft(
        state.analysisInput.rfq.id,
        state.analysisInput.trade.tradeCode,
        underlying,
        close,
        fields.observed?.value ?? ""
      );
    }
    renderAnalysisCalculation();
  }

  // Each underlying is an independent lookup. Awaiting them one at a time made the analysis page
  // wait for the sum of up to five round trips instead of the slowest one; `marketContextRequest`
  // already de-duplicates a repeated ticker, so running them together issues no extra request.
  async function autoFillPreviousCloses(input) {
    await Promise.all(input.terms.underlyings.map(async underlying => {
      const descriptor = marketResourceDescriptor(underlying);
      const fields = analysisSpotFields(underlying);
      if (!fields.source) return;
      if (!descriptor.supported) {
        fields.source.textContent = "來源：無法確認美股交易所代碼，請手動輸入。";
        return;
      }
      fields.source.textContent = "正在取得前一交易日收盤價…";
      try {
        const payload = await marketContextRequest(descriptor);
        if (state.analysisInput !== input) return;
        const equity = (payload.marketContext?.equityDaily ?? payload.marketContext?.alphaVantage)?.data;
        if (!equity || !Number.isFinite(Number(equity.closePrice))) {
          fields.source.textContent = "暫時無法取得前一交易日收盤價，請手動輸入。";
          return;
        }
        if (parseIndicativeSpot(fields.spot?.value) === null) {
          applyPreviousClose(underlying, equity.closePrice, equity.tradingDate, false);
        } else {
          fields.source.innerHTML = alphaSpotSourceHtml(underlying, equity, "manual");
        }
      } catch (error) {
        if (state.analysisInput === input) {
          fields.source.textContent = `前收自動載入失敗：${error.message || "請手動輸入。"}`;
        }
      }
    }));
  }

  function renderAnalysisPage(input, quotes) {
    state.analysisInput = input;
    state.marketContextRequests.clear();
    const selectedQuoteId = input.quote.id;
    const quoteOptions = quotes.some(item => item.quoteId === selectedQuoteId)
      ? quotes
      : [{ quoteId: selectedQuoteId, label: input.quote.issuerDisplayName }, ...quotes];
    const spotFields = input.terms.underlyings.map(underlying => {
      const saved = loadSpotDraft(input.rfq.id, input.trade.tradeCode, underlying);
      return `<article class="backend-analysis-spot-card">
        <h3>${escapeHtml(underlying)}</h3>
        <label>參考現價<input type="number" min="0.000001" step="any" inputmode="decimal" data-analysis-spot="${escapeHtml(underlying)}" value="${saved.spot ?? ""}" placeholder="自動取得或手動輸入"></label>
        <label>參考時間<input type="datetime-local" data-analysis-observed="${escapeHtml(underlying)}" value="${escapeHtml(saved.observedAt)}"></label>
        <small data-analysis-source="${escapeHtml(underlying)}">${saved.spot ? "來源：使用者手動輸入（僅儲存在此瀏覽器）" : "正在準備前一交易日收盤價…"}</small>
      </article>`;
    }).join("");
    analysisContent.innerHTML = `
      <section class="backend-analysis-hero">
        <div>
          <span>${escapeHtml(input.trade.tradeCode)}｜正式排名版本 ${escapeHtml(input.rfq.rankingVersion)}</span>
          <h2>${escapeHtml(input.terms.product)} · ${escapeHtml(input.terms.currency)}</h2>
          <p>${escapeHtml(input.terms.underlyings.join(" / "))}</p>
        </div>
        <label>分析報價
          <select id="backendAnalysisQuoteSelect">${quoteOptions.map(item => `<option value="${escapeHtml(item.quoteId)}"${item.quoteId === selectedQuoteId ? " selected" : ""}>${escapeHtml(item.label)}</option>`).join("")}</select>
        </label>
      </section>
      <section class="backend-analysis-section">
        <p class="eyebrow">SELECTED QUOTE</p><h2>${escapeHtml(input.quote.issuerDisplayName)}</h2>
        <div class="backend-analysis-terms">
          <span>期間<b>${escapeHtml(input.terms.tenorMonths)} 個月</b></span>
          <span>Coupon<b>${percentText(input.terms.couponPaPct)}</b></span>
          <span>Strike<b>${percentText(input.terms.strikePct)}</b></span>
          <span>KO Barrier<b>${percentText(input.terms.koBarrierPct)}</b><small>${escapeHtml(input.terms.koType)}</small></span>
          <span>KI Barrier<b>${input.terms.barrierType === "NONE" ? "不適用" : percentText(input.terms.kiBarrierPct)}</b><small>${escapeHtml(input.terms.barrierType)}</small></span>
          <span>Guaranteed Period<b>${escapeHtml(input.terms.guaranteedPeriodsMonths)} 個月</b></span>
          <span class="backend-analysis-underlyings-term">連結標的<b>${escapeHtml(input.terms.underlyings.join(" / "))}</b></span>
          <span>報價時間<b>${escapeHtml(formatDateTime(input.quote.receivedAt))}</b></span>
        </div>
      </section>
      <section class="backend-analysis-section">
        <p class="eyebrow">INDICATIVE SPOT</p><h2>輸入標的參考現價</h2>
        <p class="backend-analysis-note">尚未定價前，下列執行價、KO 價與 KI 價均為依百分比換算的試算值，不是正式 Fixing。</p>
        <div class="backend-analysis-spots">${spotFields}</div>
      </section>
      <div id="backendAnalysisCalculation"></div>
      ${renderMarketResourcesPanel(input.terms.underlyings)}`;
    renderAnalysisCalculation();
    void autoFillPreviousCloses(input);
  }

  async function openAnalysis(route) {
    clearTimeout(state.timer);
    state.rfqId = route.rfqId;
    state.analysisInput = null;
    document.body.classList.add("backend-analysis-active");
    analysisView.hidden = false;
    analysisBack.href = rfqResultUrl(route.rfqId);
    analysisError.textContent = "";
    analysisContent.innerHTML = "<p class=\"backend-analysis-loading\">正在載入分析資料…</p>";
    try {
      const [analysisPayload, results] = await Promise.all([
        request(`/rfqs/${route.rfqId}/trades/${encodeURIComponent(route.tradeCode)}/quotes/${encodeURIComponent(route.quoteId)}/analysis-input`),
        request(`/rfqs/${route.rfqId}/results`)
      ]);
      renderAnalysisPage(
        analysisPayload.analysisInput,
        availableAnalysisQuotes(results, route.tradeCode)
      );
    } catch (error) {
      analysisContent.innerHTML = "";
      analysisError.textContent = error instanceof Error ? error.message : "無法載入市場與風險分析。";
    }
  }

  function rfqTimingText(rfq) {
    if (!activeWorkflowStatuses.has(rfq.workflowStatus)) {
      return rfq.finalizedAt ? `完成於 ${formatDateTime(rfq.finalizedAt)}` : `建立於 ${formatDateTime(rfq.createdAt)}`;
    }
    if (!rfq.deadlineAt) return `建立於 ${formatDateTime(rfq.createdAt)}`;
    const graceStartsAt = rfq.mailGraceStartsAt ? Date.parse(rfq.mailGraceStartsAt) : null;
    if (Number.isFinite(graceStartsAt) && Date.now() >= graceStartsAt && Date.now() < Date.parse(rfq.deadlineAt)) {
      return "正在等待最後郵件轉送";
    }
    const remaining = Date.parse(rfq.deadlineAt) - Date.now();
    if (!Number.isFinite(remaining) || remaining <= 0) return "已達回覆截止，正在完成比價";
    return `回覆截止剩餘 ${Math.floor(remaining / 60000)}:${String(Math.floor((remaining % 60000) / 1000)).padStart(2, "0")}`;
  }

  function renderRfqHistory() {
    if (!state.rfqListItems.length) {
      rfqHistoryList.innerHTML = `<p class="backend-rfq-empty">${state.rfqListScope === "active"
        ? "目前沒有進行中的詢價。送出後可以放心離開，後端仍會繼續處理。"
        : "目前沒有符合此篩選條件的詢價。"}</p>`;
      return;
    }
    rfqHistoryList.innerHTML = state.rfqListItems.map(rfq => {
      const expected = Number(rfq.expectedIssuerCount) || 0;
      const terminal = Number(rfq.terminalIssuerCount) || 0;
      const percent = expected > 0 ? Math.min(100, Math.round(terminal / expected * 100)) : 0;
      const underlyings = Array.isArray(rfq.firstTrade?.underlyings) ? rfq.firstTrade.underlyings : [];
      const remainingTrades = Math.max(0, Number(rfq.tradeCount) - 1);
      const action = activeWorkflowStatuses.has(rfq.workflowStatus) ? "查看進度" : "查看結果";
      return `<article class="backend-rfq-card status-${escapeHtml(rfq.workflowStatus.toLowerCase())}">
        <header>
          <div><strong>${escapeHtml(rfq.id)}</strong><small>${escapeHtml(formatDateTime(rfq.createdAt))}</small></div>
          <span>${escapeHtml(workflowLabels[rfq.workflowStatus] || rfq.workflowStatus)}</span>
        </header>
        <p class="backend-rfq-underlyings">${escapeHtml(underlyings.join(" / ") || "尚無連結標的")}${remainingTrades ? ` <small>等 ${remainingTrades + 1} 筆交易</small>` : ""}</p>
        <div class="backend-rfq-meta">
          <span>${escapeHtml(rfq.firstTrade?.targetField || "—")}</span>
          <span>${escapeHtml(rfq.tradeCount)} 筆交易</span>
          <span>有效回覆 ${escapeHtml(rfq.validReplyCount)} 家</span>
          ${rfq.readyArtifactCount ? `<span>${escapeHtml(rfq.readyArtifactCount)} 張報價圖</span>` : ""}
        </div>
        ${expected ? `<div class="backend-rfq-progress"><span style="width:${percent}%"></span></div><small>已處理 ${terminal}/${expected} 家發行機構</small>` : ""}
        <footer><span>${escapeHtml(rfqTimingText(rfq))}</span><button type="button" class="primary" data-open-rfq="${escapeHtml(rfq.id)}">${action}</button></footer>
      </article>`;
    }).join("");
  }

  async function loadRfqHistory({ append = false } = {}) {
    rfqHistoryError.textContent = "";
    if (!append) {
      state.rfqListCursor = null;
      state.rfqListItems = [];
      rfqHistoryList.innerHTML = "<p class=\"backend-rfq-empty\">正在載入詢價紀錄…</p>";
    }
    const parameters = new URLSearchParams({ scope: state.rfqListScope, limit: "20" });
    if (append && state.rfqListCursor) parameters.set("cursor", state.rfqListCursor);
    try {
      const payload = await request(`/rfqs?${parameters}`);
      state.rfqListItems = append ? state.rfqListItems.concat(payload.rfqs) : payload.rfqs;
      state.rfqListCursor = payload.nextCursor;
      setRfqBadge(payload.summary.activeCount);
      rfqLoadMoreButton.hidden = !payload.nextCursor;
      renderRfqHistory();
    } catch (error) {
      rfqHistoryError.textContent = error.message;
      if (!append) rfqHistoryList.innerHTML = "";
    }
  }

  async function refreshRfqBadge() {
    clearTimeout(state.badgeTimer);
    if (!state.user || document.hidden) return;
    try {
      const payload = await request("/rfqs/summary");
      setRfqBadge(payload.activeCount);
    } catch {
      setRfqBadge(0);
    } finally {
      if (state.user && !document.hidden) state.badgeTimer = setTimeout(refreshRfqBadge, 30000);
    }
  }

  async function openRfqHistory() {
    clearTimeout(state.timer);
    state.rfqId = null;
    if (progressDialog.open) progressDialog.close();
    updateRfqUrl(null);
    state.rfqListScope = "active";
    document.querySelectorAll("[data-rfq-scope]").forEach(button => {
      button.setAttribute("aria-selected", String(button.dataset.rfqScope === state.rfqListScope));
    });
    if (!rfqHistoryDialog.open) rfqHistoryDialog.showModal();
    await loadRfqHistory();
  }

  async function openRfq(rfqId, { updateUrl = true, replace = false } = {}) {
    if (!/^rfq_[A-Za-z0-9-]+$/u.test(rfqId)) return;
    document.body.classList.remove("backend-analysis-active");
    analysisView.hidden = true;
    clearTimeout(state.timer);
    state.snapshotVersion = null;
    state.pollDelayMs = 4000;
    state.pollContext = null;
    state.latestStatus = null;
    state.latestResultsRfq = null;
    state.artifactByQuote = {};
    state.customFifthSelections = {};
    state.inMailGrace = false;
    if (rfqHistoryDialog.open) rfqHistoryDialog.close();
    state.rfqId = rfqId;
    state.hasRankings = false;
    document.querySelector("#backendCountdown").textContent = "正在載入詢價進度…";
    document.querySelector("#backendIssuerStates").innerHTML = "";
    document.querySelector("#backendRankings").innerHTML = "";
    artifactContainer.innerHTML = "";
    if (updateUrl) updateRfqUrl(rfqId, replace);
    if (!progressDialog.open) progressDialog.showModal();
    await refreshResults();
  }

  function closeRfqProgress({ updateUrl = true } = {}) {
    clearTimeout(state.timer);
    state.rfqId = null;
    state.snapshotVersion = null;
    state.pollDelayMs = 4000;
    state.pollContext = null;
    state.latestStatus = null;
    state.latestResultsRfq = null;
    state.artifactByQuote = {};
    state.customFifthSelections = {};
    state.inMailGrace = false;
    if (progressDialog.open) progressDialog.close();
    if (updateUrl) updateRfqUrl(null);
    void refreshRfqBadge();
  }

  async function restoreRfqFromUrl() {
    const analysis = currentAnalysisFromUrl();
    if (analysis && state.user) {
      await openAnalysis(analysis);
      return;
    }
    const rfqId = currentRfqFromUrl();
    if (rfqId && state.user) await openRfq(rfqId, { updateUrl: false });
  }

  function renderAdminOutboundList(records) {
    if (!records.length) {
      adminOutboundList.innerHTML = "<p class=\"backend-archive-empty\">尚無已建立的寄件紀錄。</p>";
      return;
    }
    adminOutboundList.innerHTML = `<table><thead><tr><th>時間</th><th>批次</th><th>詢價人</th><th>主旨</th><th>狀態</th><th></th></tr></thead><tbody>${records.map(record => `<tr>
      <td>${escapeHtml(formatDateTime(record.sentAt || record.queuedAt))}</td>
      <td>${escapeHtml(record.batchCode)}</td>
      <td>${escapeHtml(record.requester.displayName)}<small>${escapeHtml(record.requester.username)}</small></td>
      <td>${escapeHtml(record.baseSubject)}</td>
      <td>${escapeHtml(record.status)}</td>
      <td><button type="button" class="secondary backend-archive-view" data-outbound-id="${escapeHtml(record.id)}">檢視</button></td>
    </tr>`).join("")}</tbody></table>`;
  }

  function renderAdminRegistrationList(registrations) {
    if (!registrations.length) {
      adminRegistrationReviewList.innerHTML = "<p class=\"backend-archive-empty\">目前沒有待審核的使用者申請。</p>";
      return;
    }
    adminRegistrationReviewList.innerHTML = `<table><thead><tr><th>申請時間</th><th>行編（登入帳號）</th><th>分行</th><th>操作</th></tr></thead><tbody>${registrations.map(registration => `<tr>
      <td>${escapeHtml(formatDateTime(registration.createdAt))}</td>
      <td>${escapeHtml(registration.employeeNumber)}${registration.username !== registration.employeeNumber ? `<small>既有申請帳號：${escapeHtml(registration.username)}</small>` : ""}</td>
      <td>${escapeHtml(registration.branchName)}</td>
      <td class="backend-registration-actions"><button type="button" class="primary" data-registration-action="approve" data-registration-id="${escapeHtml(registration.id)}" data-registration-name="${escapeHtml(registration.employeeNumber)}">核准</button><button type="button" class="secondary" data-registration-action="reject" data-registration-id="${escapeHtml(registration.id)}" data-registration-name="${escapeHtml(registration.employeeNumber)}">拒絕</button></td>
    </tr>`).join("")}</tbody></table>`;
  }

  function renderDuplicateNote(duplicates) {
    if (!duplicates || !duplicates.count) {
      adminRegistrationDuplicateNote.hidden = true;
      adminRegistrationDuplicateNote.textContent = "";
      return;
    }
    const bits = [];
    if (duplicates.byField?.employeeNumber) bits.push(`${duplicates.byField.employeeNumber} 筆行編已存在`);
    if (duplicates.byField?.username) bits.push(`${duplicates.byField.username} 筆登入帳號已存在`);
    if (duplicates.byField?.unknown) bits.push(`${duplicates.byField.unknown} 筆無法判別`);
    const breakdown = bits.length ? `（${bits.join("、")}）` : "";
    const latest = duplicates.latestAt ? `，最近一次 ${formatDateTime(duplicates.latestAt)}` : "";
    adminRegistrationDuplicateNote.textContent = `⚠ 近 ${duplicates.windowDays} 天有 ${duplicates.count} 筆重複申請被系統擋下${breakdown}${latest}。這些申請的行編或登入帳號已存在，因此未建立帳號、也不會出現在下方名單。`;
    adminRegistrationDuplicateNote.hidden = false;
  }

  async function loadAdminRegistrations(statusMessage = "") {
    adminRegistrationReviewError.textContent = "";
    adminRegistrationReviewStatus.textContent = statusMessage;
    adminRegistrationReviewList.innerHTML = "<p class=\"backend-archive-empty\">正在載入待審核申請…</p>";
    try {
      const data = await request("/admin/registrations");
      renderAdminRegistrationList(data.registrations);
      renderDuplicateNote(data.duplicates);
    } catch (error) {
      adminRegistrationReviewError.textContent = error.message;
      adminRegistrationReviewList.innerHTML = "";
    }
  }

  function isSupportRole() {
    return state.user?.role === "ADMIN" || state.user?.role === "PS";
  }

  async function openAdminRegistrationReview() {
    if (!isSupportRole()) return;
    if (!adminRegistrationReviewDialog.open) adminRegistrationReviewDialog.showModal();
    await loadAdminRegistrations();
  }

  async function reviewRegistration(userId, action, displayName) {
    if (!isSupportRole()) return;
    let reason = "";
    if (action === "approve") {
      if (!window.confirm(`確定核准「${displayName}」的使用者申請？`)) return;
    } else {
      const suppliedReason = window.prompt(`請輸入拒絕「${displayName}」的原因（1 至 500 字）：`);
      if (suppliedReason === null) return;
      reason = suppliedReason.trim();
      if (!reason) {
        adminRegistrationReviewError.textContent = "拒絕申請時必須填寫原因。";
        return;
      }
    }

    const buttons = [...adminRegistrationReviewList.querySelectorAll("button")];
    buttons.forEach(item => { item.disabled = true; });
    adminRegistrationReviewError.textContent = "";
    adminRegistrationReviewStatus.textContent = action === "approve" ? "正在核准申請…" : "正在拒絕申請…";
    try {
      await request(`/admin/registrations/${encodeURIComponent(userId)}/${action}`, {
        method: "POST",
        body: action === "reject" ? JSON.stringify({ reason }) : "{}"
      });
      await loadAdminRegistrations(action === "approve" ? `已核准「${displayName}」。` : `已拒絕「${displayName}」。`);
    } catch (error) {
      adminRegistrationReviewError.textContent = error.message;
      adminRegistrationReviewStatus.textContent = "";
      buttons.forEach(item => { item.disabled = false; });
    }
  }

  async function openAdminOutboundArchive() {
    if (state.user?.role !== "ADMIN") return;
    adminOutboundError.textContent = "";
    adminOutboundList.innerHTML = "<p class=\"backend-archive-empty\">正在載入寄件紀錄…</p>";
    adminOutboundSubject.textContent = "請從上方選擇一封寄件紀錄";
    adminOutboundMeta.textContent = "";
    adminOutboundFrame.srcdoc = "";
    if (!adminOutboundDialog.open) adminOutboundDialog.showModal();
    try {
      renderAdminOutboundList((await request("/admin/outbound-emails?limit=100")).records);
    } catch (error) {
      adminOutboundError.textContent = error.message;
      adminOutboundList.innerHTML = "";
    }
  }

  async function openAdminOutboundRecord(batchId) {
    try {
      adminOutboundError.textContent = "正在載入郵件內容…";
      const { record } = await request(`/admin/outbound-emails/${encodeURIComponent(batchId)}`);
      adminOutboundSubject.textContent = record.subject;
      adminOutboundMeta.textContent = `${record.sender} → ${record.recipient}｜${record.generatedAt}`;
      adminOutboundFrame.srcdoc = record.html;
      adminOutboundError.textContent = "";
    } catch (error) {
      adminOutboundError.textContent = error.message;
      adminOutboundFrame.srcdoc = "";
    }
  }

  function formatDuration(value) {
    if (value === null || value === undefined) return "—";
    const minutes = Math.floor(value / 60);
    const seconds = value % 60;
    return minutes ? `${minutes}分 ${seconds}秒` : `${seconds}秒`;
  }

  function renderAdminRfqTimelines(records) {
    if (!records.length) {
      adminTimelinesList.innerHTML = "<p class=\"backend-archive-empty\">目前沒有 RFQ 處理紀錄。</p>";
      return;
    }
    adminTimelinesList.innerHTML = records.map(record => `
      <article class="backend-timeline-card">
        <header><div><b>${escapeHtml(record.rfqId)}</b><small>${escapeHtml(record.requester.displayName)}｜${escapeHtml(record.requester.branchName)}｜${record.tradeCount} 筆</small></div><span>${escapeHtml(record.workflowStatus)}</span></header>
        <div class="backend-timeline-metrics">
          <span>排隊→寄完：<b>${formatDuration(record.durationsSeconds.queueToSent)}</b></span>
          <span>寄完→首封回覆：<b>${formatDuration(record.durationsSeconds.sentToFirstInbound)}</b></span>
          <span>寄完→完成：<b>${formatDuration(record.durationsSeconds.sentToFinalized)}</b></span>
          <span>完成→最後圖片：<b>${formatDuration(record.durationsSeconds.finalizedToLastArtifact)}</b></span>
        </div>
        <p>外寄 ${record.outbound.sent}/${record.outbound.total}｜回信 ${record.inbound.total}（已解析 ${record.inbound.parsed}、逾時 ${record.inbound.late}、待人工 ${record.inbound.manualReview}、未配對 ${record.inbound.unmatched}）｜圖片 ${record.artifacts.ready}/${record.artifacts.total}</p>
        <div class="backend-timeline-issuers">${record.issuerStates.map(item => `<span class="issuer-state status-${item.status.toLowerCase()}"><b>${escapeHtml(item.issuer)}</b>${escapeHtml(item.status)}</span>`).join("")}</div>
        <small>建立 ${escapeHtml(formatDateTime(record.timestamps.createdAt))}｜寄完 ${escapeHtml(formatDateTime(record.timestamps.sentAt))}｜截止 ${escapeHtml(formatDateTime(record.timestamps.deadlineAt))}</small>
        ${record.inbound.late > 0
          && ["COMPLETED", "NO_VALID_QUOTE"].includes(record.workflowStatus)
          && (record.finalizationTrigger !== "RECALCULATION"
            || Date.parse(record.timestamps.lastInboundAt) > Date.parse(record.timestamps.finalizedAt))
          ? `<button type="button" class="secondary admin-rfq-recalculate" data-admin-recalculate-rfq="${escapeHtml(record.rfqId)}">納入晚到報價重新排名</button>`
          : ""}
      </article>`).join("");
  }

  function renderAdminRfqHealth(health) {
    if (!health?.issuers?.length) {
      adminRfqHealth.innerHTML = "";
      return;
    }
    const alertLabels = {
      ISSUER_ZERO_INBOUND: "完全未收信",
      ISSUER_PARSE_ERROR: "解析錯誤",
      ISSUER_TIMEOUT: "逾時",
      UNMATCHED_INBOUND: "未配對來信",
      INBOUND_MANUAL_REVIEW: "待人工檢查",
      FAILED_ARTIFACT: "報價圖失敗"
    };
    const alerts = health.alerts?.length
      ? `<div class="backend-health-alerts">${health.alerts.map(alert => `<span><b>${escapeHtml(alert.issuer || "系統")}</b>${escapeHtml(alertLabels[alert.code] || alert.code)} ${escapeHtml(alert.count)}</span>`).join("")}</div>`
      : "<p class=\"backend-health-ok\">目前沒有偵測到彙總異常。</p>";
    adminRfqHealth.innerHTML = `
      <section class="backend-health-panel">
        <header><h3>近 ${escapeHtml(health.windowDays)} 天發行機構健康狀態</h3><small>僅為彙總，不含郵件內容與報價數值</small></header>
        <div class="backend-health-grid">${health.issuers.map(item => `
          <article>
            <b>${escapeHtml(item.issuer)}</b>
            <strong>${item.validRatePct === null ? "—" : `${escapeHtml(item.validRatePct)}%`}</strong>
            <small>有效 ${escapeHtml(item.validReply)}/${escapeHtml(item.expected)}｜收信 ${escapeHtml(item.inbound)}｜逾時 ${escapeHtml(item.timeout)}｜解析 ${escapeHtml(item.parseError)}｜晚到 ${escapeHtml(item.lateReply)}</small>
          </article>`).join("")}
        </div>
        ${alerts}
      </section>`;
  }

  function renderAdminMarketHealth(health) {
    if (!health) {
      adminMarketHealth.innerHTML = "";
      return;
    }
    const sources = Array.isArray(health.sources) ? health.sources : [];
    const providerUsage = Array.isArray(health.providerUsageToday) ? health.providerUsageToday : [];
    adminMarketHealth.innerHTML = `
      <section class="backend-health-panel">
        <header><h3>SEC／Alpha Vantage 公開資料快取</h3><small>不含 API Key、使用者資料或上游回應全文</small></header>
        ${sources.length ? `<div class="backend-health-grid">${sources.map(item => `
          <article>
            <b>${escapeHtml(item.source)}｜${escapeHtml(item.status)}</b>
            <strong>${escapeHtml(item.row_count)}</strong>
            <small>新鮮 ${escapeHtml(item.fresh_count)}｜暫用舊資料 ${escapeHtml(item.stale_count)}｜已過期 ${escapeHtml(item.expired_count)}</small>
          </article>`).join("")}</div>` : "<p class=\"backend-health-ok\">目前尚無公開資料快取。</p>"}
        <div class="backend-health-alerts">
          <span><b>待清理</b>${escapeHtml(health.expiredRows)}</span>
          <span><b>暫用舊資料</b>${escapeHtml(health.staleRows)}</span>
          <span><b>速率限制紀錄</b>${escapeHtml(health.rateLimitRows)}</span>
          ${providerUsage.map(item => `<span><b>${escapeHtml(item.provider)} 今日上游請求</b>${escapeHtml(item.request_count)}</span>`).join("")}
        </div>
      </section>`;
  }

  async function openAdminRfqTimelines() {
    if (state.user?.role !== "ADMIN") return;
    adminTimelinesError.textContent = "";
    adminRfqHealth.innerHTML = "";
    adminMarketHealth.innerHTML = "";
    adminTimelinesList.innerHTML = "<p class=\"backend-archive-empty\">正在載入 RFQ 時間軸…</p>";
    if (!adminTimelinesDialog.open) adminTimelinesDialog.showModal();
    try {
      const [timelineResult, marketResult] = await Promise.allSettled([
        request("/admin/rfq-timelines?limit=50"),
        request("/admin/market-context-health")
      ]);
      if (timelineResult.status === "rejected") throw timelineResult.reason;
      const payload = timelineResult.value;
      renderAdminRfqHealth(payload.health);
      renderAdminRfqTimelines(payload.records);
      if (marketResult.status === "fulfilled") {
        renderAdminMarketHealth(marketResult.value.health);
      } else {
        adminMarketHealth.innerHTML = "<p class=\"backend-archive-empty\">公開資料快取健康狀態目前無法讀取；RFQ 時間軸不受影響。</p>";
      }
    } catch (error) {
      adminTimelinesError.textContent = error.message;
      adminRfqHealth.innerHTML = "";
      adminMarketHealth.innerHTML = "";
      adminTimelinesList.innerHTML = "";
    }
  }

  function accountRoleLabel(role) {
    return role === "ADMIN" ? "管理者" : role === "PS" ? "PS" : "一般";
  }

  function accountStatusLabel(status) {
    return { ACTIVE: "使用中", PENDING_APPROVAL: "待審核", REJECTED: "已拒絕", SUSPENDED: "已停權", DISABLED: "已剔除" }[status] || status;
  }

  function renderAdminAccountList(accounts) {
    if (!accounts.length) {
      adminAccountsList.innerHTML = "<p class=\"backend-archive-empty\">目前沒有帳號。</p>";
      return;
    }
    const viewer = state.user?.role;
    const selfId = state.user?.id;
    adminAccountsList.innerHTML = `<table><thead><tr><th>建立時間</th><th>使用者</th><th>分行</th><th>身份</th><th>狀態</th><th>上次上線</th><th>操作</th></tr></thead><tbody>${accounts.map(account => {
      const actions = [];
      if (viewer === "ADMIN" && account.role === "USER" && account.status === "ACTIVE") {
        actions.push(`<button type="button" class="primary" data-account-action="promote" data-account-id="${escapeHtml(account.id)}" data-account-name="${escapeHtml(account.displayName)}">升級為PS</button>`);
      }
      if (viewer === "ADMIN" && account.role === "PS") {
        actions.push(`<button type="button" class="secondary" data-account-action="demote" data-account-id="${escapeHtml(account.id)}" data-account-name="${escapeHtml(account.displayName)}">降級為一般</button>`);
      }
      if (account.role === "USER" && account.status !== "DISABLED" && account.id !== selfId) {
        actions.push(`<button type="button" class="secondary" data-account-action="disable" data-account-id="${escapeHtml(account.id)}" data-account-name="${escapeHtml(account.displayName)}">剔除</button>`);
      }
      if (viewer === "ADMIN" && account.role === "USER" && account.status === "DISABLED" && account.id !== selfId) {
        if (account.rfqCount === 0) {
          actions.push(`<button type="button" class="danger" data-account-action="delete" data-account-id="${escapeHtml(account.id)}" data-account-name="${escapeHtml(account.displayName)}" data-account-username="${escapeHtml(account.username)}">永久刪除</button>`);
        } else {
          actions.push(`<small title="為保留金融與稽核紀錄，此帳號不可永久刪除">保留 ${escapeHtml(account.rfqCount)} 筆詢價</small>`);
        }
      }
      return `<tr>
        <td>${escapeHtml(formatDateTime(account.createdAt))}</td>
        <td>${escapeHtml(account.displayName)}<br><small>${escapeHtml(account.username)}</small></td>
        <td>${escapeHtml(account.branchName)}</td>
        <td>${escapeHtml(accountRoleLabel(account.role))}</td>
        <td>${escapeHtml(accountStatusLabel(account.status))}</td>
        <td>${account.lastSeenAt ? escapeHtml(formatDateTime(account.lastSeenAt)) : "尚未登入"}</td>
        <td class="backend-registration-actions">${actions.join("") || "—"}</td>
      </tr>`;
    }).join("")}</tbody></table>`;
  }

  async function loadAdminAccounts(statusMessage = "") {
    adminAccountsError.textContent = "";
    adminAccountsStatus.textContent = statusMessage;
    adminAccountsList.innerHTML = "<p class=\"backend-archive-empty\">正在載入帳號列表…</p>";
    try {
      renderAdminAccountList((await request("/admin/accounts")).accounts);
    } catch (error) {
      adminAccountsError.textContent = error.message;
      adminAccountsList.innerHTML = "";
    }
  }

  async function openAdminAccounts() {
    if (!isSupportRole()) return;
    accountLookupRow.hidden = state.user?.role !== "ADMIN";
    accountLookupInput.value = "";
    accountLookupResult.textContent = "";
    if (!adminAccountsDialog.open) adminAccountsDialog.showModal();
    await loadAdminAccounts();
  }

  async function lookupAccountByEmployee() {
    if (state.user?.role !== "ADMIN") return;
    const employeeNumber = accountLookupInput.value.trim();
    accountLookupResult.textContent = "";
    if (!/^[0-9]{5}$/.test(employeeNumber)) { accountLookupResult.textContent = "請輸入五碼行編。"; return; }
    accountLookupBtn.disabled = true;
    try {
      const { account } = await request("/admin/accounts/lookup", { method: "POST", body: JSON.stringify({ employeeNumber }) });
      accountLookupResult.textContent = account
        ? `行編 ${employeeNumber} → ${account.displayName}（登入帳號 ${account.username}｜${account.branchName}｜${accountRoleLabel(account.role)}｜${accountStatusLabel(account.status)}）`
        : `行編 ${employeeNumber}：查無帳號。`;
    } catch (error) {
      accountLookupResult.textContent = error.message;
    } finally {
      accountLookupBtn.disabled = false;
    }
  }

  async function accountAction(userId, action, displayName, username = "") {
    if (!isSupportRole()) return;
    const prompts = {
      promote: `確定將「${displayName}」升級為 PS 帳號？PS 可審核申請並剔除一般帳號。`,
      demote: `確定將「${displayName}」降級為一般帳號？`,
      disable: `確定剔除（停用）帳號「${displayName}」？該帳號將立即無法登入。`
    };
    let body = "{}";
    if (action === "delete") {
      if (state.user?.role !== "ADMIN") return;
      if (!window.confirm(`永久刪除「${displayName}」會移除登入資料、加密行編與所有工作階段，且無法復原。確定繼續？`)) return;
      const confirmation = window.prompt(`請輸入登入帳號「${username}」確認永久刪除：`);
      if (confirmation === null) return;
      if (confirmation.trim().toLowerCase() !== username) {
        adminAccountsError.textContent = "確認文字與登入帳號不符，未執行刪除。";
        return;
      }
      body = JSON.stringify({ confirmation });
    } else if (!prompts[action] || !window.confirm(prompts[action])) {
      return;
    }
    const buttons = [...adminAccountsList.querySelectorAll("button")];
    buttons.forEach(item => { item.disabled = true; });
    adminAccountsError.textContent = "";
    adminAccountsStatus.textContent = { promote: "正在升級…", demote: "正在降級…", disable: "正在剔除…", delete: "正在永久刪除…" }[action];
    try {
      await request(`/admin/accounts/${encodeURIComponent(userId)}/${action}`, { method: "POST", body });
      const done = {
        promote: `已將「${displayName}」升級為 PS。`,
        demote: `已將「${displayName}」降級為一般帳號。`,
        disable: `已剔除「${displayName}」。`,
        delete: `已永久刪除「${displayName}」，其行編現在可重新申請。`
      };
      await loadAdminAccounts(done[action]);
    } catch (error) {
      adminAccountsError.textContent = error.message;
      adminAccountsStatus.textContent = "";
      buttons.forEach(item => { item.disabled = false; });
    }
  }

  async function loadSession() {
    try {
      setUser((await request("/auth/session")).user);
      void refreshRfqBadge();
      await restoreRfqFromUrl();
    }
    catch { setUser(null); showAuth(); }
  }

  function nullable(value) {
    const trimmed = String(value ?? "").trim();
    return trimmed === "" ? null : Number(trimmed);
  }

  function field(row, name) {
    return row.querySelector(`[name="${name}"]`)?.value.trim() ?? "";
  }

  function collectTrades() {
    return [...document.querySelectorAll("#quoteTable tbody tr")].map((row, index) => ({
      sequence: index + 1,
      product: field(row, "product"), currency: field(row, "currency"), tradeDate: field(row, "tradeDate"),
      effectiveDateOffsetCalendarDays: Number(field(row, "effectiveDateOffset")), tenorMonths: Number(field(row, "tenor")),
      guaranteedPeriodsMonths: Number(field(row, "guaranteedPeriods")),
      underlyings: [1, 2, 3, 4, 5].map(number => field(row, `bbgCode${number}`)).filter(Boolean),
      strikePct: nullable(field(row, "strike")), koType: field(row, "koType"),
      koBarrierPct: nullable(field(row, "koBarrier")), couponPaPct: nullable(field(row, "coupon")),
      upfrontOrNotePricePct: nullable(field(row, "upfront")), barrierType: field(row, "barrierType"),
      kiBarrierPct: nullable(field(row, "kiBarrier")), observationFrequencyMonths: Number(field(row, "observationFrequency")),
      otc: field(row, "otc")
    }));
  }

  // Barrier Type / KI Barrier consistency (checked before the backend RFQ is created, mirroring the
  // static validateRow): NONE must have a blank KI Barrier, and a filled KI Barrier requires EKI/AKI.
  function kiBarrierIssue() {
    const rows = [...document.querySelectorAll("#quoteTable tbody tr")];
    for (let index = 0; index < rows.length; index += 1) {
      const barrierType = field(rows[index], "barrierType");
      const ki = field(rows[index], "kiBarrier");
      if (barrierType === "NONE" && ki) return `第 ${index + 1} 筆：Barrier Type 為 NONE 時，KI Barrier 必須留白。`;
      if (ki && barrierType !== "EKI" && barrierType !== "AKI") return `第 ${index + 1} 筆：填寫 KI Barrier 時，Barrier Type 必須為 EKI 或 AKI。`;
    }
    return null;
  }

  async function submitRfq(issuers) {
    if (!state.user) { showAuth(); return; }
    const kiIssue = kiBarrierIssue();
    if (kiIssue) { statusElement.textContent = kiIssue; statusElement.classList.remove("success"); return; }
    const sendButton = document.querySelector("#sendQuotes");
    sendButton.disabled = true;
    sendButton.textContent = "建立詢價中…";
    // Open the progress dialog immediately so the user gets instant feedback while the
    // create/validate/send round trips run, instead of a frozen button.
    if (!progressDialog.open) progressDialog.showModal();
    document.querySelector("#backendCountdown").textContent = "正在建立並寄送詢價…";
    document.querySelector("#backendIssuerStates").innerHTML = "";
    document.querySelector("#backendRankings").innerHTML = "";
    artifactContainer.innerHTML = "";
    try {
      const submitted = await request("/rfqs/submit", {
        method: "POST", headers: { "idempotency-key": idempotency("submit") },
        body: JSON.stringify({
          trades: collectTrades(),
          issuers: Array.isArray(issuers) ? issuers : []
        })
      });
      const rfqId = submitted.rfq.id;
      state.rfqId = rfqId;
      state.snapshotVersion = null;
      state.pollDelayMs = 4000;
      state.pollContext = null;
      state.latestStatus = null;
      state.latestResultsRfq = null;
      state.latestResultTrades = [];
      state.artifactByQuote = {};
      state.customFifthSelections = {};
      state.inMailGrace = false;
      state.softDeadlineReached = false;
      state.expectedIssuerCount = Array.isArray(issuers) ? issuers.length : 0;
      state.pendingIssuers = [];
      state.fastCloseReady = false;
      state.hasRankings = false;
      updateRfqUrl(rfqId);
      statusElement.textContent = `詢價 ${rfqId} 已交由後端寄送，系統會在時限內完成比價。`;
      statusElement.classList.add("success");
      void refreshRfqBadge();
      await refreshResults();
    } catch (error) {
      statusElement.textContent = error.message;
      statusElement.classList.remove("success");
      document.querySelector("#backendCountdown").textContent = `建立失敗：${error.message}`;
    } finally {
      sendButton.disabled = false;
      sendButton.textContent = "發送詢價條件";
    }
  }

  function renderStatus(payload) {
    const deadline = payload.rfq.deadlineAt ? Date.parse(payload.rfq.deadlineAt) : null;
    const softDeadline = payload.rfq.softDeadlineAt ? Date.parse(payload.rfq.softDeadlineAt) : null;
    const graceStartsAt = payload.rfq.mailGraceStartsAt ? Date.parse(payload.rfq.mailGraceStartsAt) : null;
    const now = Date.now();
    const remaining = deadline ? Math.max(0, deadline - Date.now()) : 0;
    const inMailGrace = Boolean(
      Number.isFinite(graceStartsAt)
      && deadline
      && now >= graceStartsAt
      && now < deadline
      && ["WAITING", "PARTIAL"].includes(payload.rfq.workflowStatus)
    );
    state.inMailGrace = inMailGrace;
    state.softDeadlineReached = Boolean(softDeadline && now >= softDeadline);
    state.expectedIssuerCount = Array.isArray(payload.issuers) ? payload.issuers.length : 0;
    state.pendingIssuers = Array.isArray(payload.issuers)
      ? payload.issuers.filter(item => item.status === "PENDING").map(item => item.issuer)
      : [];
    const smallRfq = state.expectedIssuerCount > 0 && state.expectedIssuerCount <= 3;
    const softReminder = state.softDeadlineReached && remaining > 0 && !inMailGrace
      ? smallRfq
        ? "｜已達 7 分鐘，若報價足夠可立即完成比價"
        : "｜已達 7 分鐘，可查看暫定前四名與自選候選或提早結束"
      : "";
    document.querySelector("#backendCountdown").textContent = ["COMPLETED", "NO_VALID_QUOTE"].includes(payload.rfq.workflowStatus)
      ? `狀態：${payload.rfq.workflowStatus}｜版本 ${payload.rfq.rankingVersion}`
      : inMailGrace
        ? `正在等待最後郵件轉送｜${Math.floor(remaining / 60000)}:${String(Math.floor((remaining % 60000) / 1000)).padStart(2, "0")} 後正式排名`
        : `狀態：${payload.rfq.workflowStatus}｜詢價流程剩餘時間 ${Math.floor(remaining / 60000)}:${String(Math.floor((remaining % 60000) / 1000)).padStart(2, "0")}${softReminder}`;
    document.querySelector("#backendIssuerStates").innerHTML = payload.issuers.map(item => `<span class="issuer-state status-${item.status.toLowerCase()}"><b>${item.issuer}</b>${item.status}</span>`).join("");
    // Do not offer an early close during the final transport grace period.
    finalizeButton.hidden = !["WAITING", "PARTIAL"].includes(payload.rfq.workflowStatus) || inMailGrace;
    recalculateButton.hidden = !["COMPLETED", "NO_VALID_QUOTE"].includes(payload.rfq.workflowStatus)
      || !payload.rfq.hasUnrankedLateReplies;
    updateProvisionalBanner();
  }

  function updateFastCloseState() {
    const expected = state.expectedIssuerCount;
    const minimum = Math.min(2, expected);
    state.fastCloseReady = Boolean(
      expected > 0
      && expected <= 3
      && state.softDeadlineReached
      && !state.inMailGrace
      && state.latestResultTrades.length > 0
      && state.latestResultTrades.every(trade => Number(trade.validQuoteCount) >= minimum)
    );
    const allFive = Boolean(state.latestResultsRfq?.allTradesHaveFiveValidQuotes);
    finalizeButton.classList.toggle("attention", allFive || state.fastCloseReady);
    finalizeButton.textContent = state.fastCloseReady ? "以目前報價完成比價" : "提早結束並比價";
  }

  function updateProvisionalBanner() {
    const banner = document.querySelector("#backendProvisionalBanner");
    if (!banner || !state.latestResultsRfq?.isProvisional) return;
    updateFastCloseState();
    const expected = state.expectedIssuerCount;
    const minimum = Math.min(2, expected);
    const lowestValidCount = state.latestResultTrades.length
      ? Math.min(...state.latestResultTrades.map(trade => Number(trade.validQuoteCount) || 0))
      : 0;
    banner.textContent = state.inMailGrace
      ? "正在等待最後郵件轉送；以下仍為暫定前四名與可自選候選，60 秒緩衝結束後才會建立正式排名與報價圖。"
      : expected > 0 && expected <= 3
        ? state.fastCloseReady
          ? `本次選擇 ${expected} 家，每筆已有至少 ${minimum} 家有效報價；可立即完成比價，尚未回覆者不列入本版本。`
          : `本次選擇 ${expected} 家，每筆目前至少收到 ${lowestValidCount} 家有效報價；回覆齊全會自動完成，7 分鐘後達 ${minimum} 家即可選擇立即完成。`
      : state.latestResultsRfq.allTradesHaveFiveValidQuotes
        ? "每筆交易均已有至少五家有效報價，可提早結束並產生正式前四名與自選第五名。"
        : "以下為暫定前四名與可自選候選，回覆期間內仍可能變動，不會建立正式排名或報價圖。";
  }

  function artifactLinkHtml(artifact, tradeCode, quoteId, isImageWinner, provisional) {
    if (provisional) return "";
    if (!artifact) {
      const label = isImageWinner ? "產出第一名報價圖" : "產出此發行機構報價圖";
      // Rank-one is no longer pre-rendered (ADR 0016); every rank uses the same on-demand action,
      // which rasterizes in this browser (ADR 0017) and falls back to a server render if blocked.
      return ` <button type="button" class="secondary artifact-request" data-artifact-trade="${escapeHtml(tradeCode)}" data-artifact-quote="${escapeHtml(quoteId)}">${label}</button>`;
    }
    if (artifact.status === "READY") {
      const href = artifact.previewUrl || artifact.downloadUrl;
      return ` <a class="artifact-link" href="${escapeHtml(href)}" target="_blank" rel="noopener">查看報價圖</a>`;
    }
    if (artifact.status === "FAILED") {
      return ` <button type="button" class="secondary artifact-request" data-artifact-trade="${escapeHtml(tradeCode)}" data-artifact-quote="${escapeHtml(quoteId)}">重新產圖</button>`;
    }
    return ` <span class="artifact-pending">（報價圖${escapeHtml(artifact.status)}）</span>`;
  }

  function analysisLinkHtml(trade, quoteId, provisional) {
    const product = String(trade.product ?? "").normalize("NFKC").trim().replace(/\s+/gu, " ").toUpperCase();
    if (provisional || (product !== "FCN" && !isDacAnalysisProduct(product)) || !state.rfqId) return "";
    return ` <a class="analysis-link" href="${escapeHtml(analysisUrl(state.rfqId, trade.tradeCode, quoteId))}" target="_blank" rel="noopener">市場與風險分析</a>`;
  }

  function quoteActionsHtml(trade, quoteId, artifact, isImageWinner, provisional) {
    return `${artifactLinkHtml(artifact, trade.tradeCode, quoteId, isImageWinner, provisional)}${analysisLinkHtml(
      trade,
      quoteId,
      provisional
    )}`;
  }

  function renderResults(payload, artifactByQuote = {}) {
    state.hasRankings = payload.trades.some(trade => trade.rankings.length > 0);
    state.latestResultsRfq = payload.rfq;
    state.latestResultTrades = payload.trades;
    state.artifactByQuote = artifactByQuote;
    const provisional = Boolean(payload.rfq.isProvisional);
    updateFastCloseState();
    const banner = provisional
      ? "<p id=\"backendProvisionalBanner\" class=\"backend-provisional\"></p>"
      : "";
    document.querySelector("#backendRankings").innerHTML = banner + payload.trades.map(trade => {
      const alternates = Array.isArray(trade.alternateQuotes) ? trade.alternateQuotes : [];
      const previousSelection = state.customFifthSelections[trade.tradeCode];
      const selectedAlternate = alternates.find(item => item.quoteId === previousSelection) || alternates[0] || null;
      if (selectedAlternate) state.customFifthSelections[trade.tradeCode] = selectedAlternate.quoteId;
      const customRow = selectedAlternate
        ? `<tr class="custom-fifth-row">
            <td>5（自選）</td>
            <td><select data-custom-fifth-select="${escapeHtml(trade.tradeCode)}" data-custom-fifth-product="${escapeHtml(trade.product)}" aria-label="${escapeHtml(trade.tradeCode)} 自選第五名發行機構">
              ${alternates.map(item => `<option value="${escapeHtml(item.quoteId)}" data-value="${escapeHtml(item.value)}" data-received="${escapeHtml(item.receivedAt)}"${item.quoteId === selectedAlternate.quoteId ? " selected" : ""}>${escapeHtml(item.issuerDisplayName)}</option>`).join("")}
            </select></td>
            <td data-custom-fifth-value="${escapeHtml(trade.tradeCode)}">${escapeHtml(selectedAlternate.value)}%</td>
            <td><span data-custom-fifth-time="${escapeHtml(trade.tradeCode)}">${new Date(selectedAlternate.receivedAt).toLocaleTimeString("zh-TW")}</span><span data-custom-fifth-action="${escapeHtml(trade.tradeCode)}">${quoteActionsHtml(
              trade,
              selectedAlternate.quoteId,
              artifactByQuote[selectedAlternate.quoteId],
              false,
              provisional
            )}</span></td>
          </tr>`
        : `<tr class="custom-fifth-row"><td>5（自選）</td><td colspan="3">目前沒有前四名以外的有效發行機構報價。</td></tr>`;
      return `
      <section class="ranking-card"><h3>${escapeHtml(trade.tradeCode)} · ${escapeHtml(trade.underlyings.join(" / "))} <small>${escapeHtml(trade.targetField)}｜${provisional ? `有效 ${trade.validQuoteCount} 家${trade.lastUpdatedAt ? `｜更新 ${escapeHtml(formatDateTime(trade.lastUpdatedAt))}` : ""}` : "正式結果"}</small></h3>
      ${trade.rankings.length ? `<table><thead><tr><th>名次</th><th>發行機構</th><th>報價</th><th>時間</th></tr></thead><tbody>${trade.rankings.map(item => {
        const link = quoteActionsHtml(
          trade,
          item.quoteId,
          artifactByQuote[item.quoteId],
          item.isImageWinner,
          provisional
        );
        return `<tr><td>${item.rank}${item.tie ? "（同價）" : ""}</td><td>${escapeHtml(item.issuerDisplayName)}${link}</td><td>${item.value}%</td><td>${new Date(item.receivedAt).toLocaleTimeString("zh-TW")}</td></tr>`;
      }).join("")}${customRow}</tbody></table>` : "<p>目前沒有有效報價。</p>"}
    </section>`;
    }).join("");
    updateProvisionalBanner();
  }

  function updateCustomFifthSelection(select) {
    const tradeCode = select.dataset.customFifthSelect;
    const option = select.selectedOptions[0];
    if (!tradeCode || !option) return;
    state.customFifthSelections[tradeCode] = option.value;
    const row = select.closest(".custom-fifth-row");
    const value = row?.querySelector(`[data-custom-fifth-value="${tradeCode}"]`);
    const time = row?.querySelector(`[data-custom-fifth-time="${tradeCode}"]`);
    const action = row?.querySelector(`[data-custom-fifth-action="${tradeCode}"]`);
    if (value) value.textContent = `${option.dataset.value}%`;
    if (time) time.textContent = new Date(option.dataset.received).toLocaleTimeString("zh-TW");
    if (action) {
      const trade = { tradeCode, product: select.dataset.customFifthProduct };
      action.innerHTML = quoteActionsHtml(
        trade,
        option.value,
        state.artifactByQuote[option.value],
        false,
        Boolean(state.latestResultsRfq?.isProvisional)
      );
    }
  }

  function renderArtifactSummary(artifacts) {
    if (!artifacts.length) {
      artifactContainer.innerHTML = state.hasRankings
        ? "<p class=\"artifact-pending\">需要報價圖時，請在發行機構旁按「產出報價圖」；圖片會先顯示預覽，電腦可另開頁面，手機或平板可長按儲存。前四名及自選第五名皆可。</p>"
        : "";
      return;
    }
    artifactContainer.innerHTML = `<section class="backend-artifact-list">
      <h3>各交易報價圖</h3>
      <ul>${artifacts.map(item => `<li>${escapeHtml(item.tradeCode)}｜${item.isCustom ? "第 5 名（自選）" : `第 ${escapeHtml(item.rank)} 名`}｜${escapeHtml(item.issuer)}${item.isDefault ? "（第一名）" : ""}：${item.status === "READY"
        ? `<a class="artifact-link" href="${escapeHtml(item.previewUrl)}" target="_blank" rel="noopener">預覽</a> · <a class="artifact-link" href="${escapeHtml(item.downloadUrl)}">下載 PNG</a>`
        : item.status === "FAILED"
          ? `<button type="button" class="secondary artifact-request" data-artifact-trade="${escapeHtml(item.tradeCode)}" data-artifact-quote="${escapeHtml(item.quoteId)}">重新產圖</button>`
          : `<span class="artifact-pending">${escapeHtml(item.status)}</span>`}</li>`).join("")}</ul>
    </section>`;
  }

  function scheduleResultRefresh(delayMs) {
    clearTimeout(state.timer);
    if (!state.rfqId || document.hidden) return;
    state.timer = setTimeout(refreshResults, delayMs);
  }

  function nextResultPollDelay(changed) {
    const context = state.pollContext;
    const deadlineRemaining = context?.deadlineAt ? Date.parse(context.deadlineAt) - Date.now() : null;
    const urgent = context?.hasPendingArtifacts
      || context?.workflowStatus === "FINALIZING"
      || (Number.isFinite(deadlineRemaining) && deadlineRemaining <= 60000);
    if (urgent) {
      state.pollDelayMs = 2000;
      return state.pollDelayMs;
    }
    if (changed) {
      state.pollDelayMs = 4000;
      return state.pollDelayMs;
    }
    state.pollDelayMs = state.pollDelayMs <= 4000 || Number(context?.expectedIssuerCount) <= 3 ? 8000 : 15000;
    return state.pollDelayMs;
  }

  function shouldContinueResultPolling() {
    const context = state.pollContext;
    if (!context) return false;
    if (context.hasPendingArtifacts || context.isProvisional) return true;
    return !["COMPLETED", "NO_VALID_QUOTE", "FAILED", "CANCELLED"].includes(context.workflowStatus);
  }

  async function refreshResults() {
    clearTimeout(state.timer);
    if (!state.rfqId || document.hidden) return;
    try {
      const query = state.snapshotVersion ? `?since=${encodeURIComponent(state.snapshotVersion)}` : "";
      const snapshot = await request(`/rfqs/${state.rfqId}/snapshot${query}`);
      if (snapshot.changed) {
        state.snapshotVersion = snapshot.version;
        const status = snapshot.status;
        const results = snapshot.results;
        const artifacts = Array.isArray(snapshot.artifacts) ? snapshot.artifacts : [];
        state.latestStatus = status;
        renderStatus(status);
        if (results) {
          renderResults(results, Object.fromEntries(artifacts.map(item => [item.quoteId, item])));
          if (!results.rfq.isProvisional) renderArtifactSummary(artifacts);
        }
        state.pollContext = {
          workflowStatus: status.rfq.workflowStatus,
          deadlineAt: status.rfq.deadlineAt,
          expectedIssuerCount: Array.isArray(status.issuers) ? status.issuers.length : 0,
          isProvisional: Boolean(results?.rfq?.isProvisional),
          hasPendingArtifacts: artifacts.some(item => item.status === "QUEUED" || item.status === "RENDERING")
        };
      } else if (state.latestStatus) {
        renderStatus(state.latestStatus);
      }
      if (shouldContinueResultPolling()) scheduleResultRefresh(nextResultPollDelay(snapshot.changed));
    } catch (error) {
      document.querySelector("#backendCountdown").textContent = error.message;
      if (error.code === "RFQ_NOT_FOUND") {
        document.querySelector("#backendRankings").innerHTML = "<p>此詢價不存在，或不屬於目前登入的使用者。請回到「我的詢價」重新選擇。</p>";
        return;
      }
      scheduleResultRefresh(8000);
    }
  }

  function openIssuerPicker() {
    if (!state.user) { showAuth(); return; }
    const kiIssue = kiBarrierIssue();
    if (kiIssue) { statusElement.textContent = kiIssue; statusElement.classList.remove("success"); return; }
    issuerPickerError.textContent = "";
    updateIssuerPickerSummary();
    if (!issuerPickerDialog.open) issuerPickerDialog.showModal();
  }

  const issuerBatchByName = {
    BNP: "BMJB", MS: "BMJB", JPM: "BMJB", BARCLAYS: "BMJB",
    NOMURA: "NOMURA", UBS: "UBS", DBS: "DBS", SG: "SG", CITI: "CITI", GS: "GS", CA: "CA"
  };

  function updateIssuerPickerSummary() {
    const selected = issuerPickItems.filter(item => item.checked).map(item => item.value);
    const batchCount = new Set(selected.map(issuer => issuerBatchByName[issuer]).filter(Boolean)).size;
    const fastCloseMinimum = Math.min(2, selected.length);
    issuerPickerSummary.textContent = `已選 ${selected.length} 家發行機構，將寄出 ${batchCount} 封詢價郵件。`;
    issuerPickerHint.textContent = selected.length > 0 && selected.length <= 3
      ? `精簡詢價：全部回覆完成時會立即比價；若仍有未回覆，7 分鐘後且每筆至少有 ${fastCloseMinimum} 家有效報價時，可選擇提前完成。`
      : "系統收到全部回覆會立即完成；否則保留原有 15 分鐘等待與 60 秒郵件轉送緩衝。";
  }

  document.addEventListener("click", event => {
    if (event.target.closest("#sendQuotes")) {
      event.preventDefault(); event.stopImmediatePropagation(); openIssuerPicker();
    }
  }, true);
  issuerPickAll.addEventListener("change", () => {
    issuerPickItems.forEach(item => { item.checked = issuerPickAll.checked; });
    updateIssuerPickerSummary();
  });
  issuerPickItems.forEach(item => item.addEventListener("change", () => {
    issuerPickAll.checked = issuerPickItems.every(entry => entry.checked);
    updateIssuerPickerSummary();
  }));
  document.querySelector("#cancelIssuerPicker").addEventListener("click", () => issuerPickerDialog.close());
  issuerPickerForm.addEventListener("submit", event => {
    event.preventDefault();
    const selected = issuerPickItems.filter(item => item.checked).map(item => item.value);
    if (selected.length === 0) { issuerPickerError.textContent = "請至少選擇一家發行機構。"; return; }
    issuerPickerDialog.close();
    submitRfq(selected);
  });
  // ADR 0017: rasterize an authorized quote card in the requesting browser. The server still
  // decides which quote may be rendered and still owns the card template; only the pixel work
  // moves to the client, which removes the shared Browser Rendering budget from the hot path.
  const CARD_RENDER_STEP_TIMEOUT_MS = 12000;
  const CARD_RENDER_TOTAL_TIMEOUT_MS = 24000;
  const CARD_FONT_TIMEOUT_MS = 1500;
  // Keep every device on the phone-size output profile. This also stays below the lower canvas
  // limits seen on low-memory iOS/iPadOS devices and matches the server fallback's 1.5 scale.
  const CARD_OUTPUT_CANVAS_PIXELS = 4e6;
  const CARD_OUTPUT_MAX_SCALE = 1.5;

  // Every step below can stall indefinitely on mobile WebKit. Without this the button would sit
  // on 「產圖中…」 forever, because an unsettled promise never reaches the caller's catch.
  function withRenderTimeout(value, step, timeoutMs = CARD_RENDER_STEP_TIMEOUT_MS) {
    let timer;
    return Promise.race([
      Promise.resolve(value).finally(() => clearTimeout(timer)),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`產圖逾時（${step}）`)), timeoutMs);
      })
    ]);
  }

  function withRenderDeadline(start, step, deadlineAt, maximumMs = CARD_RENDER_STEP_TIMEOUT_MS) {
    const remainingMs = deadlineAt - Date.now();
    if (remainingMs <= 0) return Promise.reject(new Error(`產圖逾時（${step}）`));
    return withRenderTimeout(Promise.resolve().then(start), step, Math.min(maximumMs, remainingMs));
  }

  async function requestForRender(path, options, step, deadlineAt) {
    const controller = new AbortController();
    try {
      return await withRenderDeadline(
        () => request(path, { ...options, signal: controller.signal }),
        step,
        deadlineAt
      );
    } catch (error) {
      if (error?.name === "AbortError") throw new Error(`產圖逾時（${step}）`);
      throw error;
    } finally {
      controller.abort();
    }
  }

  function showCardImage(blob, filename) {
    const url = URL.createObjectURL(blob);
    progressDialog.querySelector("[data-card-preview] [data-card-close]")?.click();
    const preview = document.createElement("section");
    preview.className = "backend-card-preview";
    preview.dataset.cardPreview = "";
    preview.setAttribute("role", "dialog");
    preview.setAttribute("aria-modal", "true");
    preview.setAttribute("aria-label", "報價圖預覽");
    preview.innerHTML = `<section class="backend-panel">
      <div class="backend-results-heading"><div><p class="eyebrow">QUOTE IMAGE</p><h2>報價圖</h2></div><button type="button" class="secondary" data-card-close>關閉</button></div>
      <p class="backend-archive-note">手機或平板請「長按圖片 → 儲存影像」；電腦可在新頁面檢視，圖片會依螢幕大小縮放。</p>
      <div class="backend-card-preview-frame"><img alt="報價圖" src="${url}"></div>
      <div class="backend-card-preview-actions">
        <a class="artifact-link backend-card-open-link" href="${url}" target="_blank" rel="noopener">在新頁面檢視</a>
        <a class="artifact-link" href="${url}" download="${escapeHtml(filename)}">下載 PNG</a>
      </div>
    </section>`;
    progressDialog.append(preview);
    const onKeydown = event => {
      if (event.key === "Escape") {
        event.preventDefault();
        close();
      }
    };
    const close = () => {
      document.removeEventListener("keydown", onKeydown, true);
      preview.remove();
      URL.revokeObjectURL(url);
    };
    preview.querySelector("[data-card-close]").addEventListener("click", close);
    document.addEventListener("keydown", onKeydown, true);
    preview.querySelector("[data-card-close]").focus();
  }

  async function renderCardLocally(tradeCode, quoteId) {
    const deadlineAt = Date.now() + CARD_RENDER_TOTAL_TIMEOUT_MS;
    const { card } = await requestForRender(
      `/rfqs/${state.rfqId}/trades/${encodeURIComponent(tradeCode)}/quotes/${encodeURIComponent(quoteId)}/card`,
      {},
      "取得報價資料",
      deadlineAt
    );
    const frame = document.createElement("iframe");
    // allow-same-origin lets html2canvas read the document; scripts stay blocked.
    frame.setAttribute("sandbox", "allow-same-origin");
    frame.setAttribute("aria-hidden", "true");
    frame.setAttribute("tabindex", "-1");
    // The frame must stay render-eligible. Mobile WebKit skips layout and paint for `display:none`
    // and for offscreen `visibility:hidden` frames, which stalls both `fonts.ready` and the clone
    // iframe html2canvas creates internally. `opacity:0` stays laid out but unseen.
    frame.style.cssText = `position:fixed;left:0;top:0;width:${card.width}px;height:10px;border:0;opacity:0;pointer-events:none;z-index:0`;
    document.body.append(frame);
    try {
      await withRenderDeadline(() => new Promise((resolve, reject) => {
        frame.addEventListener("load", resolve, { once: true });
        frame.addEventListener("error", () => reject(new Error("報價圖載入失敗。")), { once: true });
        frame.srcdoc = card.html;
      }), "載入", deadlineAt);
      const frameDocument = frame.contentDocument;
      if (!frameDocument?.body) throw new Error("無法讀取報價圖內容。");
      // Fonts are a nice-to-have: rendering with the fallback face beats failing the whole export.
      if (frameDocument.fonts?.ready) {
        try {
          await withRenderDeadline(
            () => frameDocument.fonts.ready,
            "字型",
            deadlineAt,
            CARD_FONT_TIMEOUT_MS
          );
        } catch {
          // continue with whatever fonts are already resolved
        }
      }
      const height = Math.max(frameDocument.body.scrollHeight, frameDocument.documentElement.scrollHeight);
      if (!height) throw new Error("報價圖版面尚未完成，請再試一次。");
      frame.style.height = `${height}px`;
      const scale = Math.max(
        0.5,
        Math.min(CARD_OUTPUT_MAX_SCALE, Math.sqrt(CARD_OUTPUT_CANVAS_PIXELS / (card.width * height)))
      );
      const canvas = await withRenderDeadline(() => window.html2canvas(frameDocument.body, {
        backgroundColor: null,
        scale,
        logging: false,
        useCORS: false,
        width: card.width,
        height,
        windowWidth: card.width,
        windowHeight: height
      }), "繪製", deadlineAt);
      const blob = await withRenderDeadline(
        () => new Promise(resolve => canvas.toBlob(resolve, "image/png")),
        "轉檔",
        deadlineAt
      );
      if (!blob) throw new Error("報價圖轉檔失敗。");
      showCardImage(blob, `${state.rfqId}-${card.tradeCode}-${card.issuer}.png`);
    } finally {
      frame.remove();
    }
  }

  async function requestArtifactFromButton(event) {
    const target = event.target.closest("[data-artifact-trade]");
    if (!target || !state.rfqId || !target.dataset.artifactQuote) return;
    const originalLabel = target.textContent;
    const { artifactTrade, artifactQuote } = target.dataset;
    const status = document.querySelector("#backendCountdown");
    target.disabled = true;
    target.textContent = "產圖中…";
    try {
      if (typeof window.html2canvas === "function") {
        try {
          await renderCardLocally(artifactTrade, artifactQuote);
          return;
        } catch (localError) {
          // Local rasterization is best-effort. Anything from a blocked rasterizer to a mobile
          // WebKit stall falls through to the server renderer so an image is still produced.
          const message = localError instanceof Error ? localError.message : "本機產圖失敗。";
          status.textContent = `${message} 改用伺服器產圖…`;
        }
      }
      await requestForRender(
        `/rfqs/${state.rfqId}/trades/${encodeURIComponent(artifactTrade)}/quotes/${encodeURIComponent(artifactQuote)}/artifact`,
        { method: "POST", body: "{}" },
        "啟動伺服器備援",
        Date.now() + CARD_RENDER_STEP_TIMEOUT_MS
      );
      state.snapshotVersion = null;
      status.textContent = "已交由伺服器備援產圖；按鈕已恢復，完成後會顯示「查看報價圖」。";
      scheduleResultRefresh(1000);
    } catch (error) {
      status.textContent = error instanceof Error ? error.message : "產圖失敗，請稍後再試。";
    } finally {
      target.disabled = false;
      target.textContent = originalLabel;
    }
  }
  function persistAnalysisSpot(underlying) {
    const spotField = [...analysisContent.querySelectorAll("[data-analysis-spot]")]
      .find(field => field.dataset.analysisSpot === underlying);
    const observedField = [...analysisContent.querySelectorAll("[data-analysis-observed]")]
      .find(field => field.dataset.analysisObserved === underlying);
    if (!spotField || !state.analysisInput) return;
    const spot = parseIndicativeSpot(spotField.value);
    if (spot !== null && observedField && !observedField.value) observedField.value = localDateTimeValue();
    saveSpotDraft(
      state.analysisInput.rfq.id,
      state.analysisInput.trade.tradeCode,
      underlying,
      spot,
      observedField?.value ?? ""
    );
    const source = [...analysisContent.querySelectorAll("[data-analysis-source]")]
      .find(field => field.dataset.analysisSource === underlying);
    if (source) source.textContent = "來源：使用者手動輸入（僅儲存在此瀏覽器）";
    renderAnalysisCalculation();
  }
  analysisContent.addEventListener("input", event => {
    const spot = event.target.closest("[data-analysis-spot]");
    if (spot) persistAnalysisSpot(spot.dataset.analysisSpot);
  });
  analysisContent.addEventListener("change", event => {
    const select = event.target.closest("#backendAnalysisQuoteSelect");
    if (select && state.analysisInput) {
      location.assign(analysisUrl(
        state.analysisInput.rfq.id,
        state.analysisInput.trade.tradeCode,
        select.value
      ));
      return;
    }
    const observed = event.target.closest("[data-analysis-observed]");
    if (observed) persistAnalysisSpot(observed.dataset.analysisObserved);
    const consent = event.target.closest("[data-market-consent]");
    if (consent) {
      setMarketResourceConsent(consent.checked);
      if (!consent.checked) {
        const container = consent.closest(".backend-market-resources");
        if (container) unloadMarketWidget(container);
      }
    }
    const symbol = event.target.closest("[data-market-symbol]");
    if (symbol) {
      const container = symbol.closest(".backend-market-resources");
      const context = container?.querySelector("[data-market-context]");
      if (context) context.replaceChildren();
      if (container?.querySelector("[data-market-widget]")?.dataset.loaded === "1") {
        loadMarketWidget(container);
      }
    }
  });
  analysisContent.addEventListener("click", event => {
    const previousClose = event.target.closest("[data-apply-previous-close]");
    if (previousClose) {
      applyPreviousClose(
        previousClose.dataset.applyPreviousClose,
        previousClose.dataset.closePrice,
        previousClose.dataset.closeDate,
        true
      );
      return;
    }
    const contextLoad = event.target.closest("[data-market-context-load]");
    if (contextLoad) {
      const container = contextLoad.closest(".backend-market-resources");
      if (container) loadMarketContext(container, contextLoad);
      return;
    }
    const load = event.target.closest("[data-market-load]");
    if (load) {
      const container = load.closest(".backend-market-resources");
      if (container) loadMarketWidget(container);
      return;
    }
    const unload = event.target.closest("[data-market-unload]");
    if (unload) {
      const container = unload.closest(".backend-market-resources");
      if (container) {
        unloadMarketWidget(container);
        const status = container.querySelector("[data-market-status]");
        if (status) status.textContent = "外部圖表已卸載。";
      }
    }
  });
  document.querySelector("#backendRankings").addEventListener("click", requestArtifactFromButton);
  document.querySelector("#backendRankings").addEventListener("change", event => {
    const select = event.target.closest("[data-custom-fifth-select]");
    if (select) updateCustomFifthSelection(select);
  });
  artifactContainer.addEventListener("click", requestArtifactFromButton);
  loginForm.addEventListener("submit", async event => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(loginForm));
    try {
      setUser((await request("/auth/login", { method: "POST", body: JSON.stringify(data) })).user);
      document.querySelector("#backendAuthError").textContent = "";
      void refreshRfqBadge();
      await restoreRfqFromUrl();
    }
    catch (error) { document.querySelector("#backendAuthError").textContent = error.message; }
  });
  registrationForm.addEventListener("submit", async event => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(registrationForm));
    try {
      await request("/auth/register", { method: "POST", body: JSON.stringify(data) });
      document.querySelector("#backendRegistrationError").textContent = "申請已送出；核准後請以五碼行編登入。";
    } catch (error) { document.querySelector("#backendRegistrationError").textContent = error.message; }
  });
  document.querySelector("#showRegistration").addEventListener("click", () => { loginForm.hidden = true; registrationForm.hidden = false; });
  document.querySelector("#showLogin").addEventListener("click", () => { loginForm.hidden = false; registrationForm.hidden = true; });
  mobileActionsToggle.addEventListener("click", event => {
    event.stopPropagation();
    setMobileActionsExpanded(mobileActionsToggle.getAttribute("aria-expanded") !== "true");
  });
  userbar.addEventListener("click", event => {
    if (!mobileUserbarMedia.matches || event.target.closest("#backendMobileActionsToggle")) return;
    if (event.target.closest("button")) setMobileActionsExpanded(false);
  });
  document.addEventListener("click", event => {
    if (userbar.classList.contains("is-expanded") && !userbar.contains(event.target)) {
      setMobileActionsExpanded(false);
    }
  });
  document.addEventListener("keydown", event => {
    if (event.key === "Escape" && userbar.classList.contains("is-expanded")) {
      setMobileActionsExpanded(false);
      mobileActionsToggle.focus();
    }
  });
  addEventListener("resize", () => {
    if (!mobileUserbarMedia.matches) setMobileActionsExpanded(false);
  }, { passive: true });
  newRfqButton.addEventListener("click", () => {
    if (rfqHistoryDialog.open) rfqHistoryDialog.close();
    closeRfqProgress();
    document.querySelector(".entry-workspace")?.scrollIntoView({ behavior: "smooth", block: "start" });
  });
  myRfqsButton.addEventListener("click", openRfqHistory);
  document.querySelector("#backendBackToRfqs").addEventListener("click", openRfqHistory);
  document.querySelector("#closeBackendRfqHistory").addEventListener("click", () => rfqHistoryDialog.close());
  document.querySelector(".backend-rfq-tabs").addEventListener("click", event => {
    const target = event.target.closest("[data-rfq-scope]");
    if (!target) return;
    state.rfqListScope = target.dataset.rfqScope;
    document.querySelectorAll("[data-rfq-scope]").forEach(button => {
      button.setAttribute("aria-selected", String(button === target));
    });
    void loadRfqHistory();
  });
  rfqHistoryList.addEventListener("click", event => {
    const target = event.target.closest("[data-open-rfq]");
    if (target) void openRfq(target.dataset.openRfq);
  });
  rfqLoadMoreButton.addEventListener("click", () => {
    if (state.rfqListCursor) void loadRfqHistory({ append: true });
  });
  document.querySelector("#backendLogout").addEventListener("click", async () => {
    await request("/auth/logout", { method: "POST", body: "{}" });
    if (rfqHistoryDialog.open) rfqHistoryDialog.close();
    closeRfqProgress();
    setUser(null);
    showAuth();
  });
  document.querySelector("#closeBackendProgress").addEventListener("click", () => closeRfqProgress());
  progressDialog.addEventListener("cancel", event => {
    event.preventDefault();
    closeRfqProgress();
  });
  finalizeButton.addEventListener("click", async () => {
    if (!state.rfqId) return;
    const pending = state.pendingIssuers.length ? ` 尚未回覆：${state.pendingIssuers.join("、")}。` : "";
    if (!window.confirm(`確定要提早結束詢價並立即比價嗎？尚未回覆的發行機構將不列入本次排名。${pending}`)) return;
    finalizeButton.disabled = true;
    try {
      await request(`/rfqs/${state.rfqId}/finalize`, { method: "POST", body: "{}" });
      finalizeButton.hidden = true;
      document.querySelector("#backendCountdown").textContent = "已要求提早結束，正在比價…";
      await refreshResults();
    } catch (error) {
      document.querySelector("#backendCountdown").textContent = error.message;
    } finally {
      finalizeButton.disabled = false;
    }
  });
  recalculateButton.addEventListener("click", async () => {
    if (!state.rfqId) return;
    if (!window.confirm("確定要把已保存的晚到報價納入新的排名版本嗎？原本的正式結果會保留。")) return;
    recalculateButton.disabled = true;
    try {
      await request(`/rfqs/${state.rfqId}/recalculate`, { method: "POST", body: "{}" });
      recalculateButton.hidden = true;
      state.snapshotVersion = null;
      document.querySelector("#backendCountdown").textContent = "正在建立包含晚到報價的新排名版本…";
      await refreshResults();
    } catch (error) {
      document.querySelector("#backendCountdown").textContent = error.message;
    } finally {
      recalculateButton.disabled = false;
    }
  });
  adminRegistrationsButton.addEventListener("click", openAdminRegistrationReview);
  document.querySelector("#closeBackendRegistrationReview").addEventListener("click", () => adminRegistrationReviewDialog.close());
  adminRegistrationReviewList.addEventListener("click", event => {
    const target = event.target.closest("[data-registration-action][data-registration-id]");
    if (target) reviewRegistration(target.dataset.registrationId, target.dataset.registrationAction, target.dataset.registrationName);
  });
  adminOutboundButton.addEventListener("click", openAdminOutboundArchive);
  document.querySelector("#closeBackendOutboundArchive").addEventListener("click", () => adminOutboundDialog.close());
  adminOutboundList.addEventListener("click", event => {
    const target = event.target.closest("[data-outbound-id]");
    if (target) openAdminOutboundRecord(target.dataset.outboundId);
  });
  adminTimelinesButton.addEventListener("click", openAdminRfqTimelines);
  document.querySelector("#closeBackendRfqTimelines").addEventListener("click", () => adminTimelinesDialog.close());
  adminTimelinesList.addEventListener("click", async event => {
    const button = event.target.closest("[data-admin-recalculate-rfq]");
    if (!button || state.user?.role !== "ADMIN") return;
    if (!window.confirm("確定要以管理者身份將晚到報價納入新的排名版本嗎？")) return;
    button.disabled = true;
    try {
      await request(`/rfqs/${encodeURIComponent(button.dataset.adminRecalculateRfq)}/recalculate`, {
        method: "POST",
        body: "{}"
      });
      await openAdminRfqTimelines();
    } catch (error) {
      adminTimelinesError.textContent = error.message;
      button.disabled = false;
    }
  });
  adminAccountsButton.addEventListener("click", openAdminAccounts);
  document.querySelector("#closeBackendAccounts").addEventListener("click", () => adminAccountsDialog.close());
  accountLookupBtn.addEventListener("click", lookupAccountByEmployee);
  accountLookupInput.addEventListener("keydown", event => {
    if (event.key === "Enter") { event.preventDefault(); void lookupAccountByEmployee(); }
  });
  adminAccountsList.addEventListener("click", event => {
    const target = event.target.closest("[data-account-action][data-account-id]");
    if (target) accountAction(target.dataset.accountId, target.dataset.accountAction, target.dataset.accountName, target.dataset.accountUsername);
  });
  addEventListener("popstate", () => {
    const analysis = currentAnalysisFromUrl();
    if (analysis && state.user) {
      void openAnalysis(analysis);
      return;
    }
    const rfqId = currentRfqFromUrl();
    if (rfqId && state.user) void openRfq(rfqId, { updateUrl: false });
    else {
      document.body.classList.remove("backend-analysis-active");
      analysisView.hidden = true;
      if (progressDialog.open) closeRfqProgress({ updateUrl: false });
    }
  });
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      clearTimeout(state.timer);
      clearTimeout(state.badgeTimer);
    } else if (state.user) {
      void refreshRfqBadge();
      if (state.rfqId) void refreshResults();
    }
  });
  loadSession();
})();
