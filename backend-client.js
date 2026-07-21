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
    </dialog>`;
  document.body.append(shell);

  const authDialog = document.querySelector("#backendAuth");
  const progressDialog = document.querySelector("#backendProgress");
  const loginForm = document.querySelector("#backendLogin");
  const registrationForm = document.querySelector("#backendRegistration");
  const userbar = document.querySelector(".backend-userbar");

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
    document.querySelector("#backendUser").textContent = user ? `${user.displayName}｜${user.branchName}` : "";
    if (user && authDialog.open) authDialog.close();
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
  loadSession();
})();
