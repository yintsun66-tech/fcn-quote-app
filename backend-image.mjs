import { loadHtml2Canvas } from "./html2canvas-loader.mjs?v=lazy-render-v1";

const CARD_RENDER_STEP_TIMEOUT_MS = 12_000;
const CARD_RENDER_TOTAL_TIMEOUT_MS = 24_000;
const CARD_FONT_TIMEOUT_MS = 1_500;
const CARD_OUTPUT_CANVAS_PIXELS = 4e6;
const CARD_OUTPUT_MAX_SCALE = 1.5;

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, character => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[character]);
}

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

export function createImageController({
  getRfqId,
  request,
  resetSnapshot,
  scheduleResultRefresh
}) {
  const progressDialog = document.querySelector("#backendProgress");

  async function requestForRender(path, options, step, deadlineAt) {
    const controller = new AbortController();
    try {
      return await withRenderDeadline(
        () => request(path, { ...options, signal: controller.signal, timeoutMs: CARD_RENDER_STEP_TIMEOUT_MS }),
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

  async function renderCardLocally(rfqId, tradeCode, quoteId) {
    const deadlineAt = Date.now() + CARD_RENDER_TOTAL_TIMEOUT_MS;
    const [{ card }, html2canvas] = await Promise.all([
      requestForRender(
        `/rfqs/${rfqId}/trades/${encodeURIComponent(tradeCode)}/quotes/${encodeURIComponent(quoteId)}/card`,
        {},
        "取得報價資料",
        deadlineAt
      ),
      withRenderDeadline(() => loadHtml2Canvas(), "載入圖片元件", deadlineAt)
    ]);
    const frame = document.createElement("iframe");
    frame.setAttribute("sandbox", "allow-same-origin");
    frame.setAttribute("aria-hidden", "true");
    frame.setAttribute("tabindex", "-1");
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
      if (frameDocument.fonts?.ready) {
        try {
          await withRenderDeadline(() => frameDocument.fonts.ready, "字型", deadlineAt, CARD_FONT_TIMEOUT_MS);
        } catch {
          // Rendering with the resolved fallback font is preferable to failing the export.
        }
      }
      const height = Math.max(frameDocument.body.scrollHeight, frameDocument.documentElement.scrollHeight);
      if (!height) throw new Error("報價圖版面尚未完成，請再試一次。");
      frame.style.height = `${height}px`;
      const scale = Math.max(
        0.5,
        Math.min(CARD_OUTPUT_MAX_SCALE, Math.sqrt(CARD_OUTPUT_CANVAS_PIXELS / (card.width * height)))
      );
      const canvas = await withRenderDeadline(() => html2canvas(frameDocument.body, {
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
      showCardImage(blob, `${rfqId}-${card.tradeCode}-${card.issuer}.png`);
    } finally {
      frame.remove();
    }
  }

  async function requestArtifact(target) {
    const rfqId = getRfqId();
    if (!target || !rfqId || !target.dataset.artifactQuote) return;
    const originalLabel = target.textContent;
    const { artifactTrade, artifactQuote } = target.dataset;
    const status = document.querySelector("#backendCountdown");
    target.disabled = true;
    target.textContent = "產圖中…";
    try {
      try {
        await renderCardLocally(rfqId, artifactTrade, artifactQuote);
        return;
      } catch (localError) {
        const message = localError instanceof Error ? localError.message : "本機產圖失敗。";
        status.textContent = `${message} 改用伺服器產圖…`;
      }
      await requestForRender(
        `/rfqs/${rfqId}/trades/${encodeURIComponent(artifactTrade)}/quotes/${encodeURIComponent(artifactQuote)}/artifact`,
        { method: "POST", body: "{}" },
        "啟動伺服器備援",
        Date.now() + CARD_RENDER_STEP_TIMEOUT_MS
      );
      resetSnapshot();
      status.textContent = "已交由伺服器備援產圖；按鈕已恢復，完成後會顯示「查看報價圖」。";
      scheduleResultRefresh(1_000);
    } catch (error) {
      status.textContent = error instanceof Error ? error.message : "產圖失敗，請稍後再試。";
    } finally {
      target.disabled = false;
      target.textContent = originalLabel;
    }
  }

  return { requestArtifact };
}
