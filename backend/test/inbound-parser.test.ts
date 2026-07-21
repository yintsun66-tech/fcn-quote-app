import { describe, expect, it } from "vitest";
import type { Email } from "postal-mime";
import {
  correlationTags,
  detectSender,
  extractHtmlTables,
  normalizeEmailSubject,
  requesterMarker,
  subjectBatchCode
} from "../src/inbound-parser";

function parsedEmail(overrides: Partial<Email> = {}): Email {
  return { headers: [], headerLines: [], attachments: [], ...overrides };
}

describe("inbound subject and sender evidence", () => {
  it("normalizes forwarding wrappers without trusting the requester marker", () => {
    const subject = "ＲＥ： FW: External 轉寄-外來信件(OuterMail)-BMJB詢價FCBKTPE FCN(T+7)##user@example.invalid## [RFQ:abcdefghijklmnop][BATCH:BMJB]";
    const normalized = normalizeEmailSubject(subject);
    expect(normalized).toContain("BMJB詢價FCBKTPE");
    expect(subjectBatchCode(normalized)).toBe("BMJB");
    expect(requesterMarker(normalized)).toBe("user@example.invalid");
    expect(correlationTags(normalized)).toEqual({ token: "abcdefghijklmnop", batchCode: "BMJB" });
  });

  it("extracts the short correlation code past a branch label and detects the batch (ADR 0002)", () => {
    const subject = "Re: SG[詢價]FCBKTPE: FCN(T+7) 營業部分行 [RFQ:K7P2R9QTBM][BATCH:SG]";
    const normalized = normalizeEmailSubject(subject);
    expect(subjectBatchCode(normalized)).toBe("SG");
    expect(correlationTags(normalized)).toEqual({ token: "K7P2R9QTBM", batchCode: "SG" });
  });

  it("uses sender evidence to disambiguate BMJB", () => {
    const detected = detectSender(
      parsedEmail({ from: { name: "Pricing", address: "mstwsp@morganstanley.com" } }),
      { envelope_from: "forwarder@example.invalid", header_from: null, return_path: null, authentication_results: null }
    );
    expect(detected).toMatchObject({ issuer: "MS", conflict: false });
  });

  it("flags conflicting issuer evidence instead of guessing", () => {
    const detected = detectSender(
      parsedEmail({
        from: { name: "Pricing", address: "quotation.tw@bnpparibas.com" },
        text: "Original sender: no_reply_jpm_autopricer@jpmorgan.com"
      }),
      { envelope_from: "quotation.tw@bnpparibas.com", header_from: null, return_path: null, authentication_results: null }
    );
    expect(detected.issuer).toBeNull();
    expect(detected.conflict).toBe(true);
  });
});

describe("safe HTML table extraction", () => {
  it("extracts cell text while dropping executable markup", async () => {
    const result = await extractHtmlTables(
      "<table><tr><th>Issuer</th><th>Coupon</th></tr><tr><td>BNP<script>alert(1)</script></td><td>12.5%</td></tr></table>"
    );
    expect(result.tables).toHaveLength(1);
    expect(result.tables[0]?.rows).toEqual([["Issuer", "Coupon"], ["BNP", "12.5%"]]);
    expect(JSON.stringify(result)).not.toContain("alert");
  });
});
