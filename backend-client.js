(() => {
  "use strict";
  if (location.hostname !== "app.yintsun66.com" && new URLSearchParams(location.search).get("backend") !== "1") return;

  const api = "/api/v1";
  const statusElement = document.querySelector("#status");
  const state = { user: null, rfqId: null, timer: null };

  const shell = document.createElement("section");
  shell.className = "backend-shell";
  shell.innerHTML = `
    <div class="backend-userbar" hidden>
      <span id="backendUser"></span>
      <button id="backendAdminRegistrations" type="button" class="secondary" hidden>使用者申請審核</button>
      <button id="backendAdminOutbound" type="button" class="secondary" hidden>管理者寄件紀錄</button>
      <button id="backendLogout" type="button" class="secondary">登出</button>
    </div>
    <dialog id="backendAuth" class="backend-dialog">
      <form id="backendLogin" class="backend-panel">
        <p class="eyebrow">SECURE QUOTE WORKSPACE</p><h2>登入詢價系統</h2>
        <label>帳號<input name="username" autocomplete="username" required minlength="5"></label>
        <label>密碼<input name="password" type="password" autocomplete="current-password" required></label>
        <p id="backendAuthError" class="backend-error" role="alert"></p>
        <button class="primary" type="submit">登入</button>
        <button id="showRegistration" class="link-button" type="button">申請新帳號</button>
      </form>
      <form id="backendRegistration" class="backend-panel" hidden>
        <p class="eyebrow">APPROVAL REQUIRED</p><h2>申請使用權限</h2>
        <label>行編（五碼）<input name="employeeNumber" inputmode="numeric" pattern="[0-9]{5}" required></label>
        <label>分行名稱<input name="branchName" required maxlength="100"></label>
        <label>使用者名稱<input name="displayName" required maxlength="100"></label>
        <label>登入帳號<input name="username" required minlength="5" maxlength="50"></label>
        <label>密碼（至少 12 個字元）<input name="password" type="password" required minlength="12"></label>
        <p id="backendRegistrationError" class="backend-error" role="alert"></p>
        <button class="primary" type="submit">送出審核</button>
        <button id="showLogin" class="link-button" type="button">返回登入</button>
      </form>
    </dialog>
    <dialog id="backendProgress" class="backend-dialog backend-results-dialog">
      <section class="backend-panel">
        <div class="backend-results-heading"><div><p class="eyebrow">AUTOMATED RFQ</p><h2>詢價進度與比價結果</h2></div><button id="closeBackendProgress" type="button" class="secondary">關閉</button></div>
        <p id="backendCountdown" class="backend-countdown"></p>
        <div id="backendIssuerStates" class="backend-issuer-grid"></div>
        <div id="backendRankings" class="backend-rankings"></div>
        <div id="backendArtifacts" class="backend-artifacts"></div>
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
        <p class="backend-archive-note">僅管理者可檢視待審核的申請資料。核准或拒絕都會留下稽核紀錄。</p>
        <p id="backendRegistrationReviewError" class="backend-error" role="alert"></p>
        <p id="backendRegistrationReviewStatus" class="backend-admin-status" role="status"></p>
        <div id="backendRegistrationReviewList" class="backend-registration-list"></div>
      </section>
    </dialog>`;
  document.body.append(shell);

  const authDialog = document.querySelector("#backendAuth");
  const progressDialog = document.querySelector("#backendProgress");
  const loginForm = document.querySelector("#backendLogin");
  const registrationForm = document.querySelector("#backendRegistration");
  const userbar = document.querySelector(".backend-userbar");
  const adminRegistrationsButton = document.querySelector("#backendAdminRegistrations");
  const adminRegistrationReviewDialog = document.querySelector("#backendRegistrationReview");
  const adminRegistrationReviewList = document.querySelector("#backendRegistrationReviewList");
  const adminRegistrationReviewError = document.querySelector("#backendRegistrationReviewError");
  const adminRegistrationReviewStatus = document.querySelector("#backendRegistrationReviewStatus");
  const adminOutboundButton = document.querySelector("#backendAdminOutbound");
  const adminOutboundDialog = document.querySelector("#backendOutboundArchive");
  const adminOutboundList = document.querySelector("#backendOutboundArchiveList");
  const adminOutboundError = document.querySelector("#backendOutboundArchiveError");
  const adminOutboundSubject = document.querySelector("#backendOutboundArchiveSubject");
  const adminOutboundMeta = document.querySelector("#backendOutboundArchiveMeta");
  const adminOutboundFrame = document.querySelector("#backendOutboundArchiveFrame");

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
    userbar.hidden = !user;
    adminRegistrationsButton.hidden = !user || user.role !== "ADMIN";
    adminOutboundButton.hidden = !user || user.role !== "ADMIN";
    document.querySelector("#backendUser").textContent = user ? `${user.displayName}｜${user.branchName}` : "";
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
    adminRegistrationReviewList.innerHTML = `<table><thead><tr><th>申請時間</th><th>行編</th><th>分行</th><th>使用者</th><th>登入帳號</th><th>操作</th></tr></thead><tbody>${registrations.map(registration => `<tr>
      <td>${escapeHtml(formatDateTime(registration.createdAt))}</td>
      <td>${escapeHtml(registration.employeeNumber)}</td>
      <td>${escapeHtml(registration.branchName)}</td>
      <td>${escapeHtml(registration.displayName)}</td>
      <td>${escapeHtml(registration.username)}</td>
      <td class="backend-registration-actions"><button type="button" class="primary" data-registration-action="approve" data-registration-id="${escapeHtml(registration.id)}" data-registration-name="${escapeHtml(registration.displayName)}">核准</button><button type="button" class="secondary" data-registration-action="reject" data-registration-id="${escapeHtml(registration.id)}" data-registration-name="${escapeHtml(registration.displayName)}">拒絕</button></td>
    </tr>`).join("")}</tbody></table>`;
  }

  async function loadAdminRegistrations(statusMessage = "") {
    adminRegistrationReviewError.textContent = "";
    adminRegistrationReviewStatus.textContent = statusMessage;
    adminRegistrationReviewList.innerHTML = "<p class=\"backend-archive-empty\">正在載入待審核申請…</p>";
    try {
      renderAdminRegistrationList((await request("/admin/registrations")).registrations);
    } catch (error) {
      adminRegistrationReviewError.textContent = error.message;
      adminRegistrationReviewList.innerHTML = "";
    }
  }

  async function openAdminRegistrationReview() {
    if (state.user?.role !== "ADMIN") return;
    if (!adminRegistrationReviewDialog.open) adminRegistrationReviewDialog.showModal();
    await loadAdminRegistrations();
  }

  async function reviewRegistration(userId, action, displayName) {
    if (state.user?.role !== "ADMIN") return;
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

  async function loadSession() {
    try { setUser((await request("/auth/session")).user); }
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

  async function submitRfq() {
    if (!state.user) { showAuth(); return; }
    const sendButton = document.querySelector("#sendQuotes");
    sendButton.disabled = true;
    sendButton.textContent = "建立詢價中…";
    try {
      const created = await request("/rfqs", {
        method: "POST", headers: { "idempotency-key": idempotency("create") },
        body: JSON.stringify({ trades: collectTrades() })
      });
      const rfqId = created.rfq.id;
      await request(`/rfqs/${rfqId}/validate`, { method: "POST", body: "{}" });
      await request(`/rfqs/${rfqId}/send`, {
        method: "POST", headers: { "idempotency-key": idempotency("send") }, body: "{}"
      });
      state.rfqId = rfqId;
      statusElement.textContent = `詢價 ${rfqId} 已交由後端寄送，系統會在 10 分鐘內完成比價。`;
      statusElement.classList.add("success");
      if (!progressDialog.open) progressDialog.showModal();
      await refreshResults();
    } catch (error) {
      statusElement.textContent = error.message;
      statusElement.classList.remove("success");
    } finally {
      sendButton.disabled = false;
      sendButton.textContent = "發送詢價條件";
    }
  }

  function renderStatus(payload) {
    const deadline = payload.rfq.deadlineAt ? Date.parse(payload.rfq.deadlineAt) : null;
    const remaining = deadline ? Math.max(0, deadline - Date.now()) : 0;
    document.querySelector("#backendCountdown").textContent = ["COMPLETED", "NO_VALID_QUOTE"].includes(payload.rfq.workflowStatus)
      ? `狀態：${payload.rfq.workflowStatus}｜版本 ${payload.rfq.rankingVersion}`
      : `狀態：${payload.rfq.workflowStatus}｜剩餘 ${Math.floor(remaining / 60000)}:${String(Math.floor((remaining % 60000) / 1000)).padStart(2, "0")}`;
    document.querySelector("#backendIssuerStates").innerHTML = payload.issuers.map(item => `<span class="issuer-state status-${item.status.toLowerCase()}"><b>${item.issuer}</b>${item.status}</span>`).join("");
  }

  function renderResults(payload) {
    document.querySelector("#backendRankings").innerHTML = payload.trades.map(trade => `
      <section class="ranking-card"><h3>${trade.tradeCode} · ${trade.underlyings.join(" / ")} <small>${trade.targetField}</small></h3>
      ${trade.rankings.length ? `<table><thead><tr><th>名次</th><th>發行機構</th><th>報價</th><th>時間</th></tr></thead><tbody>${trade.rankings.map(item => `<tr><td>${item.rank}${item.tie ? "（同價）" : ""}</td><td>${item.issuerDisplayName}</td><td>${item.value}%</td><td>${new Date(item.receivedAt).toLocaleTimeString("zh-TW")}</td></tr>`).join("")}</tbody></table>` : "<p>目前沒有有效報價。</p>"}
    </section>`).join("");
  }

  async function renderArtifacts() {
    const payload = await request(`/rfqs/${state.rfqId}/artifacts`);
    document.querySelector("#backendArtifacts").innerHTML = payload.artifacts.map(item => item.status === "READY"
      ? `<a class="primary artifact-link" href="${item.downloadUrl}">下載 ${item.issuer} 報價圖</a>`
      : `<span class="artifact-pending">${item.issuer} 圖片：${item.status}</span>`).join("");
  }

  async function refreshResults() {
    clearTimeout(state.timer);
    if (!state.rfqId) return;
    try {
      const status = await request(`/rfqs/${state.rfqId}/status`);
      renderStatus(status);
      if (["COMPLETED", "NO_VALID_QUOTE"].includes(status.rfq.workflowStatus)) {
        renderResults(await request(`/rfqs/${state.rfqId}/results`));
        await renderArtifacts();
        if (status.artifacts.some(item => item.status === "QUEUED" || item.status === "RENDERING")) state.timer = setTimeout(refreshResults, 4000);
      } else {
        state.timer = setTimeout(refreshResults, 4000);
      }
    } catch (error) {
      document.querySelector("#backendCountdown").textContent = error.message;
      state.timer = setTimeout(refreshResults, 8000);
    }
  }

  document.addEventListener("click", event => {
    if (event.target.closest("#sendQuotes")) {
      event.preventDefault(); event.stopImmediatePropagation(); submitRfq();
    }
  }, true);
  loginForm.addEventListener("submit", async event => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(loginForm));
    try { setUser((await request("/auth/login", { method: "POST", body: JSON.stringify(data) })).user); document.querySelector("#backendAuthError").textContent = ""; }
    catch (error) { document.querySelector("#backendAuthError").textContent = error.message; }
  });
  registrationForm.addEventListener("submit", async event => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(registrationForm));
    try {
      await request("/auth/register", { method: "POST", body: JSON.stringify(data) });
      document.querySelector("#backendRegistrationError").textContent = "申請已送出，請等待管理者核准後登入。";
    } catch (error) { document.querySelector("#backendRegistrationError").textContent = error.message; }
  });
  document.querySelector("#showRegistration").addEventListener("click", () => { loginForm.hidden = true; registrationForm.hidden = false; });
  document.querySelector("#showLogin").addEventListener("click", () => { loginForm.hidden = false; registrationForm.hidden = true; });
  document.querySelector("#backendLogout").addEventListener("click", async () => { await request("/auth/logout", { method: "POST", body: "{}" }); setUser(null); showAuth(); });
  document.querySelector("#closeBackendProgress").addEventListener("click", () => progressDialog.close());
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
  loadSession();
})();
