import {
  ANALYSIS_SCENARIOS,
  buildFcnAnalysis,
  parseIndicativeSpot,
  spotStorageKey
} from "./market-analysis.mjs?v=dac-analysis-v1";
import {
  MARKET_RESOURCE_CONSENT_KEY,
  marketResourceDescriptor,
  tradingViewWidgetUrl
} from "./market-resources.mjs?v=market-hotlist-v4";

export function createAnalysisController({
  request,
  escapeHtml,
  formatDateTime,
  analysisUrl,
  rfqResultUrl,
  onOpenRfq
}) {
  const analysisState = { input: null, marketContextRequests: new Map() };
  const analysisView = document.querySelector("#backendAnalysisView");
  const analysisContent = document.querySelector("#backendAnalysisContent");
  const analysisError = document.querySelector("#backendAnalysisError");
  const analysisBack = document.querySelector("#backendAnalysisBack");

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
    const input = analysisState.input;
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
    const existing = analysisState.marketContextRequests.get(descriptor.ticker);
    if (existing) return existing;
    const pending = request(`/market/instruments/${encodeURIComponent(descriptor.ticker)}/context`)
      .catch(error => {
        analysisState.marketContextRequests.delete(descriptor.ticker);
        throw error;
      });
    analysisState.marketContextRequests.set(descriptor.ticker, pending);
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
    if (persist && analysisState.input) {
      saveSpotDraft(
        analysisState.input.rfq.id,
        analysisState.input.trade.tradeCode,
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
        if (analysisState.input !== input) return;
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
        if (analysisState.input === input) {
          fields.source.textContent = `前收自動載入失敗：${error.message || "請手動輸入。"}`;
        }
      }
    }));
  }

  function renderAnalysisPage(input, quotes) {
    analysisState.input = input;
    analysisState.marketContextRequests.clear();
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
    onOpenRfq(route.rfqId);
    analysisState.input = null;
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

  function persistAnalysisSpot(underlying) {
    const spotField = [...analysisContent.querySelectorAll("[data-analysis-spot]")]
      .find(field => field.dataset.analysisSpot === underlying);
    const observedField = [...analysisContent.querySelectorAll("[data-analysis-observed]")]
      .find(field => field.dataset.analysisObserved === underlying);
    if (!spotField || !analysisState.input) return;
    const spot = parseIndicativeSpot(spotField.value);
    if (spot !== null && observedField && !observedField.value) observedField.value = localDateTimeValue();
    saveSpotDraft(
      analysisState.input.rfq.id,
      analysisState.input.trade.tradeCode,
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
    if (select && analysisState.input) {
      location.assign(analysisUrl(
        analysisState.input.rfq.id,
        analysisState.input.trade.tradeCode,
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
  return { open: openAnalysis };
}
