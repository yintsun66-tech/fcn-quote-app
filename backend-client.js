(() => {
  "use strict";
  if (location.hostname !== "app.yintsun66.com" && new URLSearchParams(location.search).get("backend") !== "1") return;

  const api = "/api/v1";
  const DEFAULT_API_TIMEOUT_MS = 20_000;
  const statusElement = document.querySelector("#status");
  const state = {
    user: null,
    passwordResetTimer: null,
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
    rfqListItems: []
  };
  let imageControllerPromise = null;
  let analysisControllerPromise = null;
  let adminControllerPromise = null;

  const shell = document.createElement("section");
  shell.className = "backend-shell";
  shell.innerHTML = `
    <div class="backend-userbar" hidden>
      <span id="backendUser" class="backend-mobile-collapsible"></span>
      <button id="backendChangePassword" type="button" class="secondary backend-mobile-collapsible">修改密碼</button>
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
        <button id="showPasswordReset" class="link-button" type="button">忘記密碼</button>
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
      <form id="backendPasswordReset" class="backend-panel" hidden>
        <p class="eyebrow">ACCOUNT RECOVERY</p><h2>重置密碼</h2>
        <label>五碼行編（登入帳號）<input name="username" autocomplete="username" inputmode="numeric" pattern="[0-9]{5}" minlength="5" maxlength="5" required></label>
        <p class="backend-password-warning">按下重置後，臨時密碼會設為 12 個 0。請在 30 分鐘內登入，並立即設定新密碼。</p>
        <p id="backendPasswordResetStatus" class="backend-error" role="status"></p>
        <button class="primary" type="submit">重置為 12 個 0</button>
        <button id="showLoginFromReset" class="link-button" type="button">返回登入</button>
      </form>
    </dialog>
    <dialog id="backendPasswordChange" class="backend-dialog">
      <form id="backendPasswordChangeForm" class="backend-panel">
        <p class="eyebrow">ACCOUNT SECURITY</p><h2>修改密碼</h2>
        <p id="backendPasswordChangeReminder" class="backend-password-warning"></p>
        <label>目前密碼<input name="currentPassword" type="password" autocomplete="current-password" required></label>
        <label>新密碼（至少 12 個字元）<input name="newPassword" type="password" autocomplete="new-password" minlength="12" required></label>
        <label>再次輸入新密碼<input name="confirmPassword" type="password" autocomplete="new-password" minlength="12" required></label>
        <p id="backendPasswordChangeError" class="backend-error" role="alert"></p>
        <div class="dialog-actions">
          <button id="cancelBackendPasswordChange" type="button" class="secondary">取消</button>
          <button type="submit" class="primary">儲存新密碼</button>
        </div>
      </form>
    </dialog>
    <dialog id="backendProgress" class="backend-dialog backend-results-dialog">
      <section class="backend-panel">
        <div class="backend-results-heading"><div><p class="eyebrow">AUTOMATED RFQ</p><h2>詢價進度與比價結果</h2></div><div style="display:flex;gap:8px;flex-wrap:wrap"><button id="backendFinalizeNow" type="button" class="secondary" hidden>提早結束並比價</button><button id="backendRecalculate" type="button" class="secondary" hidden>納入晚到報價重新排名</button><button id="backendBackToRfqs" type="button" class="secondary">我的詢價</button><button id="closeBackendProgress" type="button" class="secondary">返回輸入</button></div></div>
        <section id="backendFinalizeConfirm" class="backend-finalize-confirm" role="alertdialog" aria-labelledby="backendFinalizeConfirmTitle" hidden>
          <strong id="backendFinalizeConfirmTitle">確認提前結束詢價</strong>
          <p id="backendFinalizeConfirmMessage"></p>
          <div class="dialog-actions">
            <button id="backendFinalizeCancel" type="button" class="secondary">繼續等待</button>
            <button id="backendFinalizeConfirmAction" type="button" class="primary">確認提前結束並比價</button>
          </div>
        </section>
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
        <p class="backend-archive-note">顯示全部帳號與上次上線時間（約 1 分鐘誤差）。ADMIN 與 PS 可先剔除一般帳號，再刪除其登入資料、行編與分行個資。歷史詢價及稽核紀錄會保留在不可登入的匿名帳號下，原行編可重新申請。</p>
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
        <div id="backendRfqPerformance" class="backend-rfq-health"></div>
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
  const finalizeConfirmPanel = document.querySelector("#backendFinalizeConfirm");
  const finalizeConfirmMessage = document.querySelector("#backendFinalizeConfirmMessage");
  const finalizeCancelButton = document.querySelector("#backendFinalizeCancel");
  const finalizeConfirmAction = document.querySelector("#backendFinalizeConfirmAction");
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
  const passwordResetForm = document.querySelector("#backendPasswordReset");
  const passwordResetStatus = document.querySelector("#backendPasswordResetStatus");
  const passwordChangeButton = document.querySelector("#backendChangePassword");
  const passwordChangeDialog = document.querySelector("#backendPasswordChange");
  const passwordChangeForm = document.querySelector("#backendPasswordChangeForm");
  const passwordChangeReminder = document.querySelector("#backendPasswordChangeReminder");
  const passwordChangeError = document.querySelector("#backendPasswordChangeError");
  const passwordChangeCancel = document.querySelector("#cancelBackendPasswordChange");
  const userbar = document.querySelector(".backend-userbar");
  const mobileActionsToggle = document.querySelector("#backendMobileActionsToggle");
  const mobileActionsLabel = document.querySelector("#backendMobileActionsLabel");
  const adminRegistrationsButton = document.querySelector("#backendAdminRegistrations");
  const adminRegistrationReviewDialog = document.querySelector("#backendRegistrationReview");
  const adminAccountsButton = document.querySelector("#backendAdminAccounts");
  const adminAccountsDialog = document.querySelector("#backendAccounts");
  const adminOutboundButton = document.querySelector("#backendAdminOutbound");
  const adminOutboundDialog = document.querySelector("#backendOutboundArchive");
  const adminTimelinesButton = document.querySelector("#backendAdminTimelines");
  const adminTimelinesDialog = document.querySelector("#backendRfqTimelines");
  const artifactContainer = document.querySelector("#backendArtifacts");
  const analysisView = document.querySelector("#backendAnalysisView");

  // Named "mobile" for historical reasons: the collapse was mobile-only until it was extended to
  // every width. Collapsed leaves 我的詢價 and the toggle visible; everything else is hidden.
  function setMobileActionsExpanded(expanded) {
    const next = Boolean(expanded && state.user);
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
    const { timeoutMs = DEFAULT_API_TIMEOUT_MS, signal, ...fetchOptions } = options;
    const headers = new Headers(fetchOptions.headers);
    if (fetchOptions.body && !headers.has("content-type")) headers.set("content-type", "application/json");
    if (fetchOptions.method && fetchOptions.method !== "GET") {
      const csrf = cookie("__Host-fcn_csrf");
      if (csrf) headers.set("x-csrf-token", csrf);
    }
    const controller = new AbortController();
    let timedOut = false;
    const forwardAbort = () => controller.abort(signal?.reason);
    if (signal?.aborted) forwardAbort();
    else signal?.addEventListener("abort", forwardAbort, { once: true });
    const timeoutId = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, Math.max(1_000, Number(timeoutMs) || DEFAULT_API_TIMEOUT_MS));
    let response;
    try {
      response = await fetch(`${api}${path}`, {
        ...fetchOptions,
        headers,
        credentials: "same-origin",
        signal: controller.signal
      });
    } catch (error) {
      if (timedOut) {
        const timeoutError = new Error("伺服器回應逾時，請確認網路後再試一次。");
        timeoutError.code = "REQUEST_TIMEOUT";
        throw timeoutError;
      }
      throw error;
    } finally {
      clearTimeout(timeoutId);
      signal?.removeEventListener("abort", forwardAbort);
    }
    const isJson = response.headers.get("content-type")?.includes("application/json");
    const payload = isJson ? await response.json() : null;
    if (!response.ok) {
      const error = new Error(payload?.error?.message || `伺服器錯誤（${response.status}）`);
      error.code = payload?.error?.code;
      throw error;
    }
    return payload;
  }

  function loadImageController() {
    if (!imageControllerPromise) {
      imageControllerPromise = import("./backend-image.mjs?v=performance-modules-v1")
        .then(({ createImageController }) => createImageController({
          getRfqId: () => state.rfqId,
          request,
          resetSnapshot: () => { state.snapshotVersion = null; },
          scheduleResultRefresh
        }))
        .catch(error => {
          imageControllerPromise = null;
          throw error;
        });
    }
    return imageControllerPromise;
  }

  function requestArtifactFromButton(event) {
    const target = event.target.closest("[data-artifact-trade]");
    if (!target) return;
    event.preventDefault();
    void loadImageController()
      .then(controller => controller.requestArtifact(target))
      .catch(error => {
        document.querySelector("#backendCountdown").textContent = error instanceof Error
          ? error.message
          : "無法載入報價圖功能。";
      });
  }

  function loadAdminController() {
    if (!adminControllerPromise) {
      adminControllerPromise = import("./backend-admin.mjs?v=performance-modules-v1")
        .then(({ createAdminController }) => createAdminController({
          request,
          getUser: () => state.user,
          escapeHtml,
          formatDateTime
        }))
        .catch(error => {
          adminControllerPromise = null;
          throw error;
        });
    }
    return adminControllerPromise;
  }

  function openAdminFeature(method) {
    void loadAdminController()
      .then(controller => controller[method]())
      .catch(error => {
        statusElement.textContent = error instanceof Error ? error.message : "無法載入管理功能。";
      });
  }

  function showAuth() {
    if (!authDialog.open) authDialog.showModal();
  }

  function closePrivateDialogs() {
    closeRfqProgress();
    [rfqHistoryDialog, adminAccountsDialog, adminRegistrationReviewDialog, adminOutboundDialog,
      adminTimelinesDialog, issuerPickerDialog].forEach(dialog => {
      if (dialog?.open) dialog.close();
    });
  }

  function showAuthPanel(panel) {
    loginForm.hidden = panel !== "login";
    registrationForm.hidden = panel !== "registration";
    passwordResetForm.hidden = panel !== "reset";
    if (panel === "reset") passwordResetStatus.textContent = "";
  }

  function updatePasswordResetReminder(user) {
    clearInterval(state.passwordResetTimer);
    state.passwordResetTimer = null;
    if (!user?.passwordChangeRequired || !user.passwordResetExpiresAt) {
      passwordChangeReminder.textContent = "修改後會登出所有裝置，請使用新密碼重新登入。";
      return;
    }
    const render = () => {
      const remaining = Math.max(0, Date.parse(user.passwordResetExpiresAt) - Date.now());
      const minutes = Math.floor(remaining / 60000);
      const seconds = Math.floor((remaining % 60000) / 1000);
      passwordChangeReminder.textContent = remaining > 0
        ? `目前使用臨時密碼，請在 ${minutes}:${String(seconds).padStart(2, "0")} 內設定新密碼。`
        : "臨時密碼已逾時，請返回登入頁重新執行忘記密碼。";
      if (remaining <= 0) {
        clearInterval(state.passwordResetTimer);
        state.passwordResetTimer = null;
        if (passwordChangeDialog.open) passwordChangeDialog.close();
        setUser(null);
        showAuthPanel("reset");
        passwordResetStatus.textContent = "臨時密碼已逾時，請重新重置。";
        showAuth();
      }
    };
    render();
    state.passwordResetTimer = setInterval(render, 1000);
  }

  function showPasswordChange(user = state.user) {
    const forced = Boolean(user?.passwordChangeRequired);
    passwordChangeForm.reset();
    passwordChangeError.textContent = "";
    passwordChangeCancel.textContent = forced ? "取消並登出" : "取消";
    updatePasswordResetReminder(user);
    if (!passwordChangeDialog.open) passwordChangeDialog.showModal();
  }

  function setUser(user) {
    state.user = user;
    setMobileActionsExpanded(false);
    userbar.hidden = !user || Boolean(user.passwordChangeRequired);
    const isSupport = !!user && (user.role === "ADMIN" || user.role === "PS");
    adminAccountsButton.hidden = !isSupport;
    adminRegistrationsButton.hidden = !isSupport;
    adminOutboundButton.hidden = !user || user.role !== "ADMIN";
    adminTimelinesButton.hidden = !user || user.role !== "ADMIN";
    document.querySelector("#backendUser").textContent = user ? `${user.displayName}｜${user.branchName}` : "";
    if (!user) {
      clearInterval(state.passwordResetTimer);
      state.passwordResetTimer = null;
      clearTimeout(state.timer);
      clearTimeout(state.badgeTimer);
      setRfqBadge(0);
    }
    if (user && authDialog.open) authDialog.close();
    if (user?.passwordChangeRequired) showPasswordChange(user);
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

  function isDacAnalysisProduct(product) {
    const normalized = String(product ?? "").normalize("NFKC").trim().replace(/\s+/gu, " ").toUpperCase();
    return ["DAC", "DRA", "WRA", "RANGE ACCRUAL"].includes(normalized);
  }

  function loadAnalysisController() {
    if (!analysisControllerPromise) {
      analysisControllerPromise = import("./backend-analysis.mjs?v=performance-modules-v1")
        .then(({ createAnalysisController }) => createAnalysisController({
          request,
          escapeHtml,
          formatDateTime,
          analysisUrl,
          rfqResultUrl,
          onOpenRfq: rfqId => {
            clearTimeout(state.timer);
            state.rfqId = rfqId;
          }
        }))
        .catch(error => {
          analysisControllerPromise = null;
          throw error;
        });
    }
    return analysisControllerPromise;
  }

  async function openAnalysis(route) {
    try {
      const controller = await loadAnalysisController();
      await controller.open(route);
    } catch (error) {
      document.body.classList.add("backend-analysis-active");
      analysisView.hidden = false;
      document.querySelector("#backendAnalysisContent").innerHTML = "";
      document.querySelector("#backendAnalysisError").textContent = error instanceof Error
        ? error.message
        : "無法載入市場與風險分析。";
    }
  }

  function updateRfqUrl(rfqId, replace = false) {
    const url = new URL(location.href);
    if (rfqId) url.searchParams.set("rfq", rfqId);
    else url.searchParams.delete("rfq");
    history[replace ? "replaceState" : "pushState"]({ rfqId }, "", `${url.pathname}${url.search}${url.hash}`);
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
    hideFinalizeConfirmation();
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
    hideFinalizeConfirmation();
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

  async function loadSession() {
    try {
      const user = (await request("/auth/session")).user;
      setUser(user);
      if (user.passwordChangeRequired) return;
      void refreshRfqBadge();
      await restoreRfqFromUrl();
    }
    catch { setUser(null); showAuthPanel("login"); showAuth(); }
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
    hideFinalizeConfirmation();
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

  function hideFinalizeConfirmation({ focusTrigger = false } = {}) {
    finalizeConfirmPanel.hidden = true;
    finalizeConfirmMessage.textContent = "";
    if (focusTrigger && !finalizeButton.hidden) finalizeButton.focus();
  }

  function showFinalizeConfirmation() {
    const pending = state.pendingIssuers.length
      ? `尚待回覆：${state.pendingIssuers.join("、")}。`
      : "目前沒有仍在等待的發行機構狀態。";
    finalizeConfirmMessage.textContent = `系統會立即以目前已收到的有效報價完成排名；之後才抵達的報價不會自動改寫本次結果。${pending}`;
    finalizeConfirmPanel.hidden = false;
    finalizeConfirmAction.focus();
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
    if (finalizeButton.hidden) hideFinalizeConfirmation();
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
      const user = (await request("/auth/login", { method: "POST", body: JSON.stringify(data) })).user;
      setUser(user);
      document.querySelector("#backendAuthError").textContent = "";
      if (user.passwordChangeRequired) return;
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
  passwordResetForm.addEventListener("submit", async event => {
    event.preventDefault();
    passwordResetStatus.textContent = "正在重置…";
    try {
      const data = Object.fromEntries(new FormData(passwordResetForm));
      const result = await request("/auth/password/reset", { method: "POST", body: JSON.stringify(data) });
      passwordResetStatus.textContent = result.message;
      loginForm.elements.username.value = data.username;
      loginForm.elements.password.value = "";
    } catch (error) {
      passwordResetStatus.textContent = error.message;
    }
  });
  passwordChangeForm.addEventListener("submit", async event => {
    event.preventDefault();
    passwordChangeError.textContent = "";
    const data = Object.fromEntries(new FormData(passwordChangeForm));
    if (data.newPassword !== data.confirmPassword) {
      passwordChangeError.textContent = "兩次輸入的新密碼不一致。";
      return;
    }
    const submit = passwordChangeForm.querySelector("button[type=submit]");
    submit.disabled = true;
    try {
      await request("/auth/password/change", {
        method: "POST",
        body: JSON.stringify({ currentPassword: data.currentPassword, newPassword: data.newPassword })
      });
      clearInterval(state.passwordResetTimer);
      state.passwordResetTimer = null;
      if (passwordChangeDialog.open) passwordChangeDialog.close();
      closePrivateDialogs();
      setUser(null);
      showAuthPanel("login");
      document.querySelector("#backendAuthError").textContent = "密碼已修改，請使用新密碼重新登入。";
      showAuth();
    } catch (error) {
      passwordChangeError.textContent = error.message;
    } finally {
      submit.disabled = false;
    }
  });
  passwordChangeButton.addEventListener("click", () => showPasswordChange());
  passwordChangeCancel.addEventListener("click", async () => {
    if (state.user?.passwordChangeRequired) {
      try { await request("/auth/logout", { method: "POST", body: "{}" }); } catch { /* Session may already be expired. */ }
      if (passwordChangeDialog.open) passwordChangeDialog.close();
      closePrivateDialogs();
      setUser(null);
      showAuthPanel("login");
      showAuth();
      return;
    }
    clearInterval(state.passwordResetTimer);
    state.passwordResetTimer = null;
    passwordChangeDialog.close();
  });
  passwordChangeDialog.addEventListener("cancel", event => {
    if (state.user?.passwordChangeRequired) event.preventDefault();
  });
  document.querySelector("#showRegistration").addEventListener("click", () => showAuthPanel("registration"));
  document.querySelector("#showPasswordReset").addEventListener("click", () => showAuthPanel("reset"));
  document.querySelector("#showLogin").addEventListener("click", () => showAuthPanel("login"));
  document.querySelector("#showLoginFromReset").addEventListener("click", () => showAuthPanel("login"));
  mobileActionsToggle.addEventListener("click", event => {
    event.stopPropagation();
    setMobileActionsExpanded(mobileActionsToggle.getAttribute("aria-expanded") !== "true");
  });
  userbar.addEventListener("click", event => {
    if (event.target.closest("#backendMobileActionsToggle")) return;
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
  // The resize listener that used to force-collapse above 760px is gone: it existed to restore the
  // always-expanded desktop bar, and with the collapse universal it would close the panel on any
  // desktop resize instead.
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
    closePrivateDialogs();
    setUser(null);
    showAuthPanel("login");
    showAuth();
  });
  document.querySelector("#closeBackendProgress").addEventListener("click", () => closeRfqProgress());
  progressDialog.addEventListener("cancel", event => {
    event.preventDefault();
    closeRfqProgress();
  });
  finalizeButton.addEventListener("click", () => {
    if (!state.rfqId) return;
    showFinalizeConfirmation();
  });
  finalizeCancelButton.addEventListener("click", () => hideFinalizeConfirmation({ focusTrigger: true }));
  finalizeConfirmAction.addEventListener("click", async () => {
    const rfqId = state.rfqId;
    if (!rfqId) { hideFinalizeConfirmation(); return; }
    finalizeButton.disabled = true;
    finalizeCancelButton.disabled = true;
    finalizeConfirmAction.disabled = true;
    document.querySelector("#backendCountdown").textContent = "正在送出提前結束要求…";
    try {
      await request(`/rfqs/${rfqId}/finalize`, { method: "POST", body: "{}" });
      if (state.rfqId !== rfqId) return;
      hideFinalizeConfirmation();
      finalizeButton.hidden = true;
      state.snapshotVersion = null;
      document.querySelector("#backendCountdown").textContent = "已要求提早結束，正在比價…";
      await refreshResults();
    } catch (error) {
      if (state.rfqId === rfqId) {
        hideFinalizeConfirmation();
        document.querySelector("#backendCountdown").textContent = error.message;
        if (["RFQ_NOT_WAITING", "RFQ_MAIL_GRACE_ACTIVE"].includes(error.code)) {
          state.snapshotVersion = null;
          await refreshResults();
        }
      }
    } finally {
      finalizeButton.disabled = false;
      finalizeCancelButton.disabled = false;
      finalizeConfirmAction.disabled = false;
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
  adminRegistrationsButton.addEventListener("click", () => openAdminFeature("openRegistrationReview"));
  adminOutboundButton.addEventListener("click", () => openAdminFeature("openOutboundArchive"));
  adminTimelinesButton.addEventListener("click", () => openAdminFeature("openTimelines"));
  adminAccountsButton.addEventListener("click", () => openAdminFeature("openAccounts"));
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
