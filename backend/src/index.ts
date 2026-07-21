import {
  approveRegistration,
  listRegistrations,
  login,
  logout,
  register,
  rejectRegistration,
  requireSession,
  sessionInfo
} from "./auth";
import { isAppError } from "./errors";
import { emptyResponse, jsonResponse, requestId } from "./http";
import { ingestInboundEmail } from "./inbound";
import { consumeInboundEmail } from "./inbound-parser";
import { consumeOutboundEmail, sendRfq } from "./outbound";
import { createRfq, getRfq, validateRfq } from "./rfqs";
import { consumeQuoteNormalize } from "./quote-normalize";
import { consumeQuoteRank } from "./ranking";
import { consumeImageRender } from "./artifacts";
import { scheduledWorkflowRecovery } from "./coordinator";
import {
  downloadArtifact,
  getRfqResults,
  getRfqStatus,
  listRfqArtifacts,
  recalculateRfq
} from "./results";
import type { AppEnv } from "./types";

export { RfqCoordinator } from "./coordinator";

function errorResponse(error: unknown, currentRequestId: string): Response {
  if (isAppError(error)) {
    return jsonResponse({
      error: {
        code: error.code,
        message: error.message.trim(),
        requestId: currentRequestId,
        ...(error.fieldErrors ? { fieldErrors: error.fieldErrors } : {})
      }
    }, error.status);
  }
  console.error("request_failed", { requestId: currentRequestId, errorType: error instanceof Error ? error.name : "unknown" });
  return jsonResponse({
    error: {
      code: "INTERNAL_ERROR",
      message: "系統暫時無法處理請求。",
      requestId: currentRequestId
    }
  }, 500);
}

async function route(request: Request, env: AppEnv): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, "") || "/";
  const method = request.method.toUpperCase();

  if (method === "OPTIONS") return emptyResponse(204, { allow: "GET, POST, OPTIONS" });
  if (method === "GET" && path === "/api/v1/health") return jsonResponse({ status: "ok" });
  if (method === "POST" && path === "/api/v1/auth/register") return register(request, env);
  if (method === "POST" && path === "/api/v1/auth/login") return login(request, env);

  const session = await requireSession(request, env);
  if (method === "POST" && path === "/api/v1/auth/logout") return logout(request, env, session);
  if (method === "GET" && path === "/api/v1/auth/session") return sessionInfo(session);
  if (method === "GET" && path === "/api/v1/admin/registrations") return listRegistrations(env, session);

  const approveMatch = /^\/api\/v1\/admin\/registrations\/([^/]+)\/approve$/.exec(path);
  if (method === "POST" && approveMatch?.[1]) return approveRegistration(request, env, session, approveMatch[1]);
  const rejectMatch = /^\/api\/v1\/admin\/registrations\/([^/]+)\/reject$/.exec(path);
  if (method === "POST" && rejectMatch?.[1]) return rejectRegistration(request, env, session, rejectMatch[1]);

  if (method === "POST" && path === "/api/v1/rfqs") return createRfq(request, env, session);
  const validateMatch = /^\/api\/v1\/rfqs\/([^/]+)\/validate$/.exec(path);
  if (method === "POST" && validateMatch?.[1]) return validateRfq(request, env, session, validateMatch[1]);
  const sendMatch = /^\/api\/v1\/rfqs\/([^/]+)\/send$/.exec(path);
  if (method === "POST" && sendMatch?.[1]) return sendRfq(request, env, session, sendMatch[1]);
  const statusMatch = /^\/api\/v1\/rfqs\/([^/]+)\/status$/.exec(path);
  if (method === "GET" && statusMatch?.[1]) return getRfqStatus(env, session, statusMatch[1]);
  const resultsMatch = /^\/api\/v1\/rfqs\/([^/]+)\/results$/.exec(path);
  if (method === "GET" && resultsMatch?.[1]) return getRfqResults(env, session, resultsMatch[1]);
  const artifactsMatch = /^\/api\/v1\/rfqs\/([^/]+)\/artifacts$/.exec(path);
  if (method === "GET" && artifactsMatch?.[1]) return listRfqArtifacts(env, session, artifactsMatch[1]);
  const recalculateMatch = /^\/api\/v1\/rfqs\/([^/]+)\/recalculate$/.exec(path);
  if (method === "POST" && recalculateMatch?.[1]) return recalculateRfq(request, env, session, recalculateMatch[1]);
  const artifactDownloadMatch = /^\/api\/v1\/artifacts\/([^/]+)\/download$/.exec(path);
  if (method === "GET" && artifactDownloadMatch?.[1]) return downloadArtifact(env, session, artifactDownloadMatch[1]);
  const rfqMatch = /^\/api\/v1\/rfqs\/([^/]+)$/.exec(path);
  if (method === "GET" && rfqMatch?.[1]) return getRfq(env, session, rfqMatch[1]);

  return jsonResponse({ error: { code: "NOT_FOUND", message: "找不到此 API。", requestId: requestId(request) } }, 404);
}

export default {
  async fetch(request, env, _context): Promise<Response> {
    const currentRequestId = requestId(request);
    try {
      return await route(request, env);
    } catch (error) {
      return errorResponse(error, currentRequestId);
    }
  },
  async queue(batch: MessageBatch<unknown>, env): Promise<void> {
    if (batch.queue === "fcn-email-parse") return consumeInboundEmail(batch, env);
    if (batch.queue === "fcn-quote-normalize") return consumeQuoteNormalize(batch, env);
    if (batch.queue === "fcn-quote-rank") return consumeQuoteRank(batch, env);
    if (batch.queue === "fcn-image-render") return consumeImageRender(batch, env);
    return consumeOutboundEmail(batch, env);
  },
  async email(message, env, _context): Promise<void> {
    await ingestInboundEmail(message, env);
  },
  async scheduled(_controller, env, _context): Promise<void> {
    await scheduledWorkflowRecovery(env);
  }
} satisfies ExportedHandler<AppEnv>;
