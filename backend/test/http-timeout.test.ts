import { describe, expect, it } from "vitest";
import { withTimeout } from "../src/http";

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
