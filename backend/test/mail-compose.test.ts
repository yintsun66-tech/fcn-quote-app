import { describe, expect, it } from "vitest";
// The production module is a browser-native ES module copied as a static asset.
// @ts-expect-error The root browser module intentionally has no backend TypeScript declaration.
import { buildMailtoUrl, buildZimbraComposeUrl, normalizeZimbraUrl } from "../../mail-compose.mjs";

describe("browser mail composer links", () => {
  it("builds a mailto URL with recipient, subject and plain-text fallback body", () => {
    const url = buildMailtoUrl({
      to: "i14053@firstbank.com.tw",
      subject: "BMJB[詢價]FCBKTPE: FCN(T+7)",
      body: "Product\tCurrency",
    });
    const [path, query] = url.split("?");
    expect(decodeURIComponent(path)).toBe("mailto:i14053@firstbank.com.tw");
    const params = new URLSearchParams(query);
    expect(params.get("subject")).toBe("BMJB[詢價]FCBKTPE: FCN(T+7)");
    expect(params.get("body")).toBe("Product\tCurrency");
  });

  it("builds an HTTPS Zimbra compose URL without placing quote-table content in the URL", () => {
    const url = new URL(buildZimbraComposeUrl("https://mail.example.test/zimbra/#1", {
      to: "i14053@firstbank.com.tw",
      subject: "UBS[詢價]FCBKTPE: FCN(T+7)",
    }));
    expect(url.origin).toBe("https://mail.example.test");
    expect(url.pathname).toBe("/zimbra/");
    expect(url.searchParams.get("view")).toBe("compose");
    expect(url.searchParams.get("to")).toBe("i14053@firstbank.com.tw");
    expect(url.searchParams.get("subject")).toBe("UBS[詢價]FCBKTPE: FCN(T+7)");
    expect(url.searchParams.has("body")).toBe(false);
  });

  it("removes existing query and hash state from the saved Zimbra address", () => {
    expect(normalizeZimbraUrl("https://mail.example.test/zimbra/?loginOp=logout#inbox").toString())
      .toBe("https://mail.example.test/zimbra/");
  });

  it("rejects unsafe or credential-bearing Zimbra addresses", () => {
    expect(() => normalizeZimbraUrl("http://mail.example.test/zimbra/")).toThrow(/https/);
    expect(() => normalizeZimbraUrl("https://user:secret@mail.example.test/zimbra/")).toThrow(/帳號或密碼/);
    expect(() => normalizeZimbraUrl("not a url")).toThrow(/格式/);
  });
});
