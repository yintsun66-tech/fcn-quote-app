import { describe, expect, it } from "vitest";
import { deadlineAt, withDeadline, withTimeout } from "../src/http";

const never = () => new Promise<never>(() => {});
const after = <T>(milliseconds: number, value: T) =>
  new Promise<T>(resolve => setTimeout(() => resolve(value), milliseconds));

describe("withDeadline", () => {
  it("shares one budget across sequential steps instead of restarting it", async () => {
    // The point of a deadline over a per-step timeout: two 60s steps allow 120s against the same
    // job lease. Here the first step consumes the whole budget, so the second cannot extend it.
    const deadline = deadlineAt(60);
    await expect(withDeadline(after(20, "first"), deadline, "BROWSER_RENDER_TIMEOUT"))
      .resolves.toBe("first");
    await expect(withDeadline(never(), deadline, "BROWSER_RENDER_TIMEOUT"))
      .rejects.toThrow("BROWSER_RENDER_TIMEOUT");
  });

  it("fails immediately once the budget is already spent", async () => {
    await expect(withDeadline(never(), deadlineAt(-1), "BROWSER_RENDER_TIMEOUT"))
      .rejects.toThrow("BROWSER_RENDER_TIMEOUT");
  });
});

describe("withTimeout", () => {
  it("returns the value when the work settles first", async () => {
    await expect(withTimeout(Promise.resolve("rendered"), 1_000, "BROWSER_RENDER_TIMEOUT"))
      .resolves.toBe("rendered");
  });

  it("rejects with the named code when the work stalls", async () => {
    // A promise that never settles is exactly the failure mode this guards: Browser Rendering has
    // no client-side timeout, so without this the invocation would hold its render slot open.
    await expect(withTimeout(new Promise<never>(() => {}), 10, "BROWSER_RENDER_TIMEOUT"))
      .rejects.toThrow("BROWSER_RENDER_TIMEOUT");
  });

  it("passes the original failure through unchanged", async () => {
    await expect(withTimeout(Promise.reject(new Error("BROWSER_RENDER_HTTP_429")), 1_000, "BROWSER_RENDER_TIMEOUT"))
      .rejects.toThrow("BROWSER_RENDER_HTTP_429");
  });
});
