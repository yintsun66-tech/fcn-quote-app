import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    cloudflareTest(async () => ({
      wrangler: { configPath: "./wrangler.jsonc" },
      miniflare: {
        bindings: {
          TEST_MIGRATIONS: await readD1Migrations("./migrations"),
          EMPLOYEE_DATA_KEY: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
          EMPLOYEE_LOOKUP_KEY: "BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
          FOLLOW_BOARD_VIEW_PIN: "2580",
          ALPHA_VANTAGE_API_KEY: "SYNTHETIC12345678",
          ALPHA_VANTAGE_DAILY_REQUEST_LIMIT: "1000",
          PASSWORD_PBKDF2_ITERATIONS: "10000",
          OUTBOUND_FROM: "rfq@yintsun66.com",
          OUTBOUND_TO: "i14053@firstbank.com.tw"
        }
      }
    }))
  ]
});
