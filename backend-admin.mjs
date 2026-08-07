export function createAdminController({ request, getUser, escapeHtml, formatDateTime }) {
  const adminRegistrationReviewDialog = document.querySelector("#backendRegistrationReview");
  const adminRegistrationReviewList = document.querySelector("#backendRegistrationReviewList");
  const adminRegistrationReviewError = document.querySelector("#backendRegistrationReviewError");
  const adminRegistrationReviewStatus = document.querySelector("#backendRegistrationReviewStatus");
  const adminRegistrationDuplicateNote = document.querySelector("#backendRegistrationDuplicateNote");
  const adminAccountsDialog = document.querySelector("#backendAccounts");
  const adminAccountsList = document.querySelector("#backendAccountsList");
  const adminAccountsError = document.querySelector("#backendAccountsError");
  const adminAccountsStatus = document.querySelector("#backendAccountsStatus");
  const accountLookupRow = document.querySelector("#backendAccountLookup");
  const accountLookupInput = document.querySelector("#backendAccountLookupInput");
  const accountLookupBtn = document.querySelector("#backendAccountLookupBtn");
  const accountLookupResult = document.querySelector("#backendAccountLookupResult");
  const adminOutboundDialog = document.querySelector("#backendOutboundArchive");
  const adminOutboundList = document.querySelector("#backendOutboundArchiveList");
  const adminOutboundError = document.querySelector("#backendOutboundArchiveError");
  const adminOutboundSubject = document.querySelector("#backendOutboundArchiveSubject");
  const adminOutboundMeta = document.querySelector("#backendOutboundArchiveMeta");
  const adminOutboundFrame = document.querySelector("#backendOutboundArchiveFrame");
  const adminTimelinesDialog = document.querySelector("#backendRfqTimelines");
  const adminTimelinesList = document.querySelector("#backendRfqTimelinesList");
  const adminTimelinesError = document.querySelector("#backendRfqTimelinesError");
  const adminRfqPerformance = document.querySelector("#backendRfqPerformance");
  const adminRfqHealth = document.querySelector("#backendRfqHealth");
  const adminMarketHealth = document.querySelector("#backendMarketHealth");

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
    return getUser()?.role === "ADMIN" || getUser()?.role === "PS";
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
    if (getUser()?.role !== "ADMIN") return;
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
          <span>建立→排隊：<b>${formatDuration(record.durationsSeconds.createdToQueued)}</b></span>
          <span>排隊→首封寄出：<b>${formatDuration(record.durationsSeconds.queueToFirstSent)}</b></span>
          <span>首封→最後寄出：<b>${formatDuration(record.durationsSeconds.firstToLastSent)}</b></span>
          <span>排隊→全部寄完：<b>${formatDuration(record.durationsSeconds.queueToLastSent)}</b></span>
          <span>寄完→首封回覆：<b>${formatDuration(record.durationsSeconds.sentToFirstInbound)}</b></span>
          <span>寄完→完成：<b>${formatDuration(record.durationsSeconds.sentToFinalized)}</b></span>
        </div>
        <p>外寄 ${record.outbound.sent}/${record.outbound.total}｜回信 ${record.inbound.total}（已解析 ${record.inbound.parsed}、逾時 ${record.inbound.late}、待人工 ${record.inbound.manualReview}、未配對 ${record.inbound.unmatched}）｜圖片 ${record.artifacts.ready}/${record.artifacts.total}</p>
        <div class="backend-timeline-issuers">${record.issuerStates.map(item => `<span class="issuer-state status-${item.status.toLowerCase()}"><b>${escapeHtml(item.issuer)}</b>${escapeHtml(item.status)}</span>`).join("")}</div>
        <small>建立 ${escapeHtml(formatDateTime(record.timestamps.createdAt))}｜排隊 ${escapeHtml(formatDateTime(record.timestamps.queuedAt))}｜首封 ${escapeHtml(formatDateTime(record.outbound.firstSentAt))}｜末封 ${escapeHtml(formatDateTime(record.outbound.lastSentAt))}｜截止 ${escapeHtml(formatDateTime(record.timestamps.deadlineAt))}</small>
        ${record.inbound.late > 0
          && ["COMPLETED", "NO_VALID_QUOTE"].includes(record.workflowStatus)
          && (record.finalizationTrigger !== "RECALCULATION"
            || Date.parse(record.timestamps.lastInboundAt) > Date.parse(record.timestamps.finalizedAt))
          ? `<button type="button" class="secondary admin-rfq-recalculate" data-admin-recalculate-rfq="${escapeHtml(record.rfqId)}">納入晚到報價重新排名</button>`
          : ""}
      </article>`).join("");
  }

  function renderAdminRfqPerformance(performance) {
    if (!performance) {
      adminRfqPerformance.innerHTML = "";
      return;
    }
    const averages = performance.averageSeconds || {};
    const small = performance.smallRfq || {};
    const batches = Array.isArray(performance.batches) ? performance.batches : [];
    const smallResult = small.count
      ? `${formatDuration(small.averageQueuedToLastSentSeconds)}｜20 秒內 ${escapeHtml(small.withinTargetCount)}/${escapeHtml(small.count)}（${escapeHtml(small.withinTargetPct)}%）`
      : "尚無三家以下的正式樣本";
    adminRfqPerformance.innerHTML = `
      <section class="backend-health-panel">
        <header><h3>近 ${escapeHtml(performance.windowDays)} 天外寄效能</h3><small>由既有 RFQ／外寄時間戳彙總，不含郵件內容</small></header>
        <div class="backend-health-grid">
          <article><b>建立→排隊</b><strong>${formatDuration(averages.createdToQueued)}</strong><small>${escapeHtml(performance.rfqCount)} 筆 RFQ</small></article>
          <article><b>排隊→首封寄出</b><strong>${formatDuration(averages.queuedToFirstSent)}</strong><small>衡量 Queue 啟動速度</small></article>
          <article><b>首封→最後寄出</b><strong>${formatDuration(averages.firstToLastSent)}</strong><small>衡量多批次分波時間</small></article>
          <article><b>排隊→全部寄完</b><strong>${formatDuration(averages.queuedToLastSent)}</strong><small>${escapeHtml(performance.sentCount)} 筆已寄完</small></article>
          <article><b>三家以下</b><strong>${small.count ? formatDuration(small.averageQueuedToLastSentSeconds) : "—"}</strong><small>${smallResult}</small></article>
        </div>
        ${batches.length ? `<div class="backend-health-alerts">${batches.map(batch => `<span><b>${escapeHtml(batch.batchCode)}</b>平均 ${formatDuration(batch.averageQueueToSentSeconds)}｜最慢 ${formatDuration(batch.maximumQueueToSentSeconds)}</span>`).join("")}</div>` : ""}
      </section>`;
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
    if (getUser()?.role !== "ADMIN") return;
    adminTimelinesError.textContent = "";
    adminRfqPerformance.innerHTML = "";
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
      renderAdminRfqPerformance(payload.performance);
      renderAdminRfqHealth(payload.health);
      renderAdminRfqTimelines(payload.records);
      if (marketResult.status === "fulfilled") {
        renderAdminMarketHealth(marketResult.value.health);
      } else {
        adminMarketHealth.innerHTML = "<p class=\"backend-archive-empty\">公開資料快取健康狀態目前無法讀取；RFQ 時間軸不受影響。</p>";
      }
    } catch (error) {
      adminTimelinesError.textContent = error.message;
      adminRfqPerformance.innerHTML = "";
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
    const viewer = getUser()?.role;
    const selfId = getUser()?.id;
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
      if ((viewer === "ADMIN" || viewer === "PS") && account.role === "USER" && account.status === "DISABLED" && account.id !== selfId) {
        actions.push(`<button type="button" class="danger" data-account-action="delete" data-account-id="${escapeHtml(account.id)}" data-account-name="${escapeHtml(account.displayName)}" data-account-username="${escapeHtml(account.username)}">刪除帳號個資</button>`);
        if (account.rfqCount > 0) actions.push(`<small>匿名保留 ${escapeHtml(account.rfqCount)} 筆詢價</small>`);
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
    accountLookupRow.hidden = getUser()?.role !== "ADMIN";
    accountLookupInput.value = "";
    accountLookupResult.textContent = "";
    if (!adminAccountsDialog.open) adminAccountsDialog.showModal();
    await loadAdminAccounts();
  }

  async function lookupAccountByEmployee() {
    if (getUser()?.role !== "ADMIN") return;
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
      if (!window.confirm(`刪除「${displayName}」的帳號個資會移除登入資料、加密行編與所有工作階段，且無法復原；歷史詢價與稽核紀錄將匿名保留。確定繼續？`)) return;
      const confirmation = window.prompt(`請輸入登入帳號「${username}」確認刪除帳號個資：`);
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
    adminAccountsStatus.textContent = { promote: "正在升級…", demote: "正在降級…", disable: "正在剔除…", delete: "正在刪除帳號個資…" }[action];
    try {
      await request(`/admin/accounts/${encodeURIComponent(userId)}/${action}`, { method: "POST", body });
      const done = {
        promote: `已將「${displayName}」升級為 PS。`,
        demote: `已將「${displayName}」降級為一般帳號。`,
        disable: `已剔除「${displayName}」。`,
        delete: `已刪除「${displayName}」的帳號個資；歷史詢價已匿名保留，原行編現在可重新申請。`
      };
      await loadAdminAccounts(done[action]);
    } catch (error) {
      adminAccountsError.textContent = error.message;
      adminAccountsStatus.textContent = "";
      buttons.forEach(item => { item.disabled = false; });
    }
  }


  document.querySelector("#closeBackendRegistrationReview").addEventListener("click", () => adminRegistrationReviewDialog.close());
  adminRegistrationReviewList.addEventListener("click", event => {
    const target = event.target.closest("[data-registration-action][data-registration-id]");
    if (target) void reviewRegistration(target.dataset.registrationId, target.dataset.registrationAction, target.dataset.registrationName);
  });
  document.querySelector("#closeBackendOutboundArchive").addEventListener("click", () => adminOutboundDialog.close());
  adminOutboundList.addEventListener("click", event => {
    const target = event.target.closest("[data-outbound-id]");
    if (target) void openAdminOutboundRecord(target.dataset.outboundId);
  });
  document.querySelector("#closeBackendRfqTimelines").addEventListener("click", () => adminTimelinesDialog.close());
  adminTimelinesList.addEventListener("click", async event => {
    const button = event.target.closest("[data-admin-recalculate-rfq]");
    if (!button || getUser()?.role !== "ADMIN") return;
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
  document.querySelector("#closeBackendAccounts").addEventListener("click", () => adminAccountsDialog.close());
  accountLookupBtn.addEventListener("click", () => void lookupAccountByEmployee());
  accountLookupInput.addEventListener("keydown", event => {
    if (event.key === "Enter") {
      event.preventDefault();
      void lookupAccountByEmployee();
    }
  });
  adminAccountsList.addEventListener("click", event => {
    const target = event.target.closest("[data-account-action][data-account-id]");
    if (target) void accountAction(target.dataset.accountId, target.dataset.accountAction, target.dataset.accountName, target.dataset.accountUsername);
  });

  return {
    openRegistrationReview: openAdminRegistrationReview,
    openOutboundArchive: openAdminOutboundArchive,
    openTimelines: openAdminRfqTimelines,
    openAccounts: openAdminAccounts
  };
}
