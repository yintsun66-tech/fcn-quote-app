import { requireAdmin } from "./auth";
import { insertAudit } from "./db";
import { jsonResponse, requestId } from "./http";
import { marketContextHealth } from "./market-context";
import type { AppEnv, SessionContext } from "./types";

export async function getAdminMarketContextHealth(
  request: Request,
  env: AppEnv,
  session: SessionContext
): Promise<Response> {
  requireAdmin(session);
  const health = await marketContextHealth(env);
  await insertAudit(
    env,
    "ADMIN_MARKET_CONTEXT_HEALTH_VIEWED",
    "PUBLIC_DATA_CACHE",
    null,
    session.user.id,
    requestId(request),
    {
      sourceGroupCount: health.sources.length,
      expiredRows: health.expiredRows,
      staleRows: health.staleRows
    }
  );
  return jsonResponse({ health });
}
