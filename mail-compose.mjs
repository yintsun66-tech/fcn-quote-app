export const ZIMBRA_URL_STORAGE_KEY = "fcn-quote-app.zimbra-web-url.v1";

function requiredText(value, fieldName) {
  const text = String(value ?? "").trim();
  if (!text) throw new Error(`${fieldName}不得為空白。`);
  return text;
}

export function buildMailtoUrl({ to, subject, body = "" }) {
  const recipient = requiredText(to, "收件人");
  const mailSubject = requiredText(subject, "郵件主旨");
  return `mailto:${encodeURIComponent(recipient)}?subject=${encodeURIComponent(mailSubject)}&body=${encodeURIComponent(String(body ?? ""))}`;
}

export function normalizeZimbraUrl(value) {
  const rawUrl = requiredText(value, "Zimbra 網頁網址");
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error("Zimbra 網頁網址格式不正確，請貼上以 https:// 開頭的完整網址。");
  }
  if (url.protocol !== "https:") {
    throw new Error("為保護郵件資料，Zimbra 網頁網址必須使用 https://。");
  }
  if (url.username || url.password) {
    throw new Error("Zimbra 網頁網址不可包含帳號或密碼。");
  }
  url.search = "";
  url.hash = "";
  return url;
}

export function buildZimbraComposeUrl(baseUrl, { to, subject }) {
  const url = normalizeZimbraUrl(baseUrl);
  url.searchParams.set("view", "compose");
  url.searchParams.set("to", requiredText(to, "收件人"));
  url.searchParams.set("subject", requiredText(subject, "郵件主旨"));
  return url.toString();
}
