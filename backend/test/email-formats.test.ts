import { describe, expect, it } from "vitest";
import {
  EMAIL_INSTITUTIONS,
  MAIL_INSTITUTION_ORDER,
  branchSubjectLabel,
  buildCorrelatedSubject,
  buildInstitutionEmail,
  type MailTradeRecord
} from "../shared/email-formats.js";

const trade: MailTradeRecord = {
  product: "FCN",
  currency: "USD",
  guaranteedPeriods: "1",
  bbgCode1: "AAPL UW",
  bbgCode2: "MSFT UW",
  bbgCode3: "",
  bbgCode4: "",
  bbgCode5: "",
  strike: "",
  koType: "Daily Memory",
  koBarrier: "100",
  coupon: "12.5",
  upfront: "98",
  tenor: "6",
  barrierType: "NONE",
  kiBarrier: "",
  observationFrequency: "1",
  otc: "Note",
  effectiveDateOffset: "7",
  tradeDate: "21-Jul-26"
};

describe("shared issuer email formats", () => {
  it("keeps the eight approved batches and their spreadsheet column counts", () => {
    expect(MAIL_INSTITUTION_ORDER).toEqual(["BMJB", "NOMURA", "UBS", "DBS", "SG", "CITI", "GS", "CA"]);
    expect(Object.fromEntries(MAIL_INSTITUTION_ORDER.map(key => [key, EMAIL_INSTITUTIONS[key]?.columns.length]))).toEqual({
      BMJB: 20,
      NOMURA: 22,
      UBS: 20,
      DBS: 19,
      SG: 21,
      CITI: 24,
      GS: 19,
      CA: 19
    });
    expect(EMAIL_INSTITUTIONS.CA?.columns[8]?.label).toBe("Guaranteed Periods (m)");
  });

  it("adds SG's fixed OTC, blank funding spread, and effective-date offset cells", () => {
    const email = buildInstitutionEmail("SG", [trade]);
    const values = email.plainText.split("\r\n")[1]?.split("\t") ?? [];
    expect(EMAIL_INSTITUTIONS.SG?.columns.slice(-3).map(column => column.label)).toEqual([
      "OTC", "Funding Spread (bps)", "Effective Date Offset(Calendar Days)"
    ]);
    expect(values.slice(-3)).toEqual(["Note", "", "7"]);
    expect(email.html.match(/<td\b/g) ?? []).toHaveLength(21);
  });

  it("keeps Nomura's effective-date offset fixed at seven calendar days", () => {
    const email = buildInstitutionEmail("NOMURA", [{ ...trade, effectiveDateOffset: "3" }]);
    const values = email.plainText.split("\r\n")[1]?.split("\t") ?? [];
    expect(EMAIL_INSTITUTIONS.NOMURA?.columns.at(-2)?.label).toBe("Effective Date Offset");
    expect(values.at(-2)).toBe("7");
  });

  it("preserves a final empty cell in HTML and plain text", () => {
    for (const key of ["UBS", "CITI", "CA"]) {
      const email = buildInstitutionEmail(key, [trade]);
      const cells = email.html.match(/<td\b/g) ?? [];
      expect(cells).toHaveLength(EMAIL_INSTITUTIONS[key]?.columns.length ?? 0);
      expect(email.html).toContain("&nbsp;</td></tr>");
      expect(email.plainText.split("\r\n")[1]?.endsWith("\t")).toBe(true);
      expect(email.plainText).not.toContain("Quote");
    }
  });

  it("applies the approved CITI transformations", () => {
    const email = buildInstitutionEmail("CITI", [trade]);
    const values = email.plainText.split("\r\n")[1]?.split("\t") ?? [];
    expect(values[0]).toBe("FCA");
    expect(values[4]).toBe("5");
    expect(values[14]).toBe("0");
    expect(values[16]).toBe("TRUE");
    expect(values[17]).toBe("TRUE");
    expect(values[19]).toBe("2");
  });

  it("adds the short correlation code suffix (ADR 0002)", () => {
    const code = "K7P2R9QTBM";
    expect(buildCorrelatedSubject("UBS[詢價]FCBKTPE: FCN(T+7)", code, "UBS"))
      .toBe(`UBS[詢價]FCBKTPE: FCN(T+7) [RFQ:${code}][BATCH:UBS]`);
    expect(() => buildCorrelatedSubject("Re: UBS[詢價]FCBKTPE", code, "UBS")).toThrow();
    expect(() => buildCorrelatedSubject("UBS ##owner##", code, "UBS")).toThrow();
    expect(() => buildCorrelatedSubject("UBS[詢價]", "short", "UBS")).toThrow();
    expect(() => buildCorrelatedSubject("UBS[詢價]", "abcDEF0123456789_token", "UBS")).toThrow();
    expect(() => buildCorrelatedSubject("UBS[詢價]", "ILOU012345", "UBS")).toThrow();
    expect(() => buildCorrelatedSubject("UBS[詢價]", code, "UNKNOWN")).toThrow();
  });

  it("sanitizes the branch label and appends 分行 only when absent", () => {
    expect(branchSubjectLabel("營業部")).toBe("營業部分行");
    expect(branchSubjectLabel("002")).toBe("002分行");
    expect(branchSubjectLabel("信義分行")).toBe("信義分行");
    expect(branchSubjectLabel("台北 分行")).toBe("台北 分行");
    expect(branchSubjectLabel("台北CITI[SG]##分行")).toBe("台北分行");
    expect(branchSubjectLabel("OBU")).toBe("");
    expect(branchSubjectLabel("   ")).toBe("");
    expect(branchSubjectLabel(null)).toBe("");
    expect(branchSubjectLabel("台".repeat(30)).length).toBeLessThanOrEqual(20 + 2);
  });

  it("places the branch label before the correlation tags via subjectBase", () => {
    const code = "K7P2R9QTBM";
    const subjectBase = `SG[詢價]FCBKTPE: FCN(T+7) ${branchSubjectLabel("營業部")}`;
    const email = buildInstitutionEmail("SG", [trade], { rfqToken: code, batchCode: "SG", subjectBase });
    expect(email.subject).toBe(`SG[詢價]FCBKTPE: FCN(T+7) 營業部分行 [RFQ:${code}][BATCH:SG]`);
    expect(email.subject.startsWith(`${subjectBase} `)).toBe(true);
    // Without correlation the plain institution subject is preserved.
    expect(buildInstitutionEmail("SG", [trade]).subject).toBe("SG[詢價]FCBKTPE: FCN(T+7)");
  });
});
