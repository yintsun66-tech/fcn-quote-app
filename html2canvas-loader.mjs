const HTML2CANVAS_URL = new URL("./vendor/html2canvas-1.4.1.min.js", import.meta.url).href;
const DEFAULT_TIMEOUT_MS = 12_000;

let loaderPromise = null;

function availableRenderer() {
  return typeof window.html2canvas === "function" ? window.html2canvas : null;
}

export function loadHtml2Canvas(timeoutMs = DEFAULT_TIMEOUT_MS) {
  const ready = availableRenderer();
  if (ready) return Promise.resolve(ready);
  if (loaderPromise) return loaderPromise;

  loaderPromise = new Promise((resolve, reject) => {
    let script = document.querySelector("script[data-html2canvas-loader]");
    let timeoutId = null;

    const cleanup = () => {
      clearTimeout(timeoutId);
      script?.removeEventListener("load", onLoad);
      script?.removeEventListener("error", onError);
    };
    const fail = message => {
      cleanup();
      script?.remove();
      loaderPromise = null;
      reject(new Error(message));
    };
    const onLoad = () => {
      const renderer = availableRenderer();
      if (!renderer) {
        fail("報價圖元件載入完成但無法啟動，請重新整理後再試。");
        return;
      }
      cleanup();
      resolve(renderer);
    };
    const onError = () => fail("報價圖元件載入失敗，請確認網路連線後再試。");

    if (!script) {
      script = document.createElement("script");
      script.src = HTML2CANVAS_URL;
      script.async = true;
      script.dataset.html2canvasLoader = "1";
    }
    script.addEventListener("load", onLoad, { once: true });
    script.addEventListener("error", onError, { once: true });
    timeoutId = setTimeout(
      () => fail("報價圖元件載入逾時，請確認網路連線後再試。"),
      Math.max(1_000, Number(timeoutMs) || DEFAULT_TIMEOUT_MS)
    );
    if (!script.isConnected) document.head.append(script);
  });

  return loaderPromise;
}
