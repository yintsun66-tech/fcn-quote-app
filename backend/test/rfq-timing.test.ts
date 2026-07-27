import { describe, expect, it } from "vitest";
import {
  rfqHardDeadlineSeconds,
  rfqMailGraceSeconds,
  rfqMailGraceStartsAt,
  rfqReplyWindowSeconds,
  rfqSoftDeadlineAt,
  rfqSoftDeadlineSeconds
} from "../src/rfq-timing";
import type { AppEnv } from "../src/types";

describe("RFQ two-stage timing", () => {
  it("uses a seven-minute reminder, fifteen-minute reply window and sixty-second transport grace", () => {
    const env = {
      RFQ_SOFT_DEADLINE_SECONDS: "420",
      RFQ_DEADLINE_SECONDS: "900",
      RFQ_MAIL_GRACE_SECONDS: "60"
    } as AppEnv;
    const sentAt = "2026-07-23T00:00:00.000Z";
    expect(rfqSoftDeadlineSeconds(env)).toBe(420);
    expect(rfqReplyWindowSeconds(env)).toBe(900);
    expect(rfqMailGraceSeconds(env)).toBe(60);
    expect(rfqHardDeadlineSeconds(env)).toBe(960);
    expect(rfqSoftDeadlineAt(env, sentAt)).toBe("2026-07-23T00:07:00.000Z");
    expect(rfqMailGraceStartsAt(env, sentAt)).toBe("2026-07-23T00:15:00.000Z");
  });

  it("keeps an invalid or oversized soft reminder before the hard deadline", () => {
    const invalid = { RFQ_SOFT_DEADLINE_SECONDS: "invalid", RFQ_DEADLINE_SECONDS: "invalid" } as unknown as AppEnv;
    expect(rfqSoftDeadlineSeconds(invalid)).toBe(420);
    expect(rfqHardDeadlineSeconds(invalid)).toBe(960);

    const oversized = { RFQ_SOFT_DEADLINE_SECONDS: "1200", RFQ_DEADLINE_SECONDS: "900" } as unknown as AppEnv;
    expect(rfqSoftDeadlineSeconds(oversized)).toBe(899);
  });
});
