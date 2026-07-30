import {
  approveRegistration,
  deleteAccountPermanently,
  demoteAccount,
  disableAccount,
  listAccounts,
  lookupAccountByEmployeeNumber,
  listRegistrations,
  login,
  logout,
  promoteAccount,
  register,
  rejectRegistration,
  requireSession,
  sessionInfo
} from "./auth";
import { getAdminOutboundEmail, listAdminOutboundEmails } from "./admin-outbound";
import { listAdminRfqTimelines } from "./admin-rfq";
import { getAdminMarketContextHealth } from "./admin-market";
import { isAppError } from "./errors";
import { emptyResponse, jsonResponse, requestId } from "./http";
import { ingestInboundEmail } from "./inbound";
import { consumeInboundEmail } from "./inbound-parser";
import { consumeOutboundEmail, sendRfq } from "./outbound";
import { createRfq, getRfq, getRfqListSummary, listRfqs, validateRfq } from "./rfqs";
import { consumeQuoteNormalize } from "./quote-normalize";
import { consumeQuoteRank } from "./ranking";
import { consumeImageRender, getTradeCardDocument, requestTradeArtifact } from "./artifacts";
import { getTradeAnalysisInput } from "./analysis";
import { scheduledWorkflowRecovery } from "./coordinator";
import { cleanupExpiredMarketData, getMarketContext } from "./market-context";
import { applyRetention } from "./retention";
import { getFollowBoardImage, handleLineWebhook } from "./line-push";
import {
  archiveFollowBoardProduct,
  cleanupFollowBoardOperationalData,
  followBoardCorsHeaders,
  followBoardOptions,
  getFollowBoardManifest,
  isPublicFollowBoardPath,
  listAdminFollowBoardInterests,
  submitFollowBoardInterest
} from "./follow-board";
import {
  downloadArtifact,
  finalizeRfqNow,
  getRfqResults,
  getRfqSnapshot,
  getRfqStatus,
  listRfqArtifacts,
  recalculateRfq
} from "./results";
import type { AppEnv } from "./types";

export { RfqCoordinator } from "./coordinator";

function errorResponse(error: unknown, currentRequestId: string, request: Request): Response {
  const path = new URL(request.url).pathname.replace(/\/+$/, "") || "/";
  const extraHeaders = isPublicFollowBoardPath(path) ? followBoardCorsHeaders(request) : undefined;
  if (isAppError(error)) {
    return jsonResponse({
      error: {
        code: error.code,
        message: error.message.trim(),
        requestId: currentRequestId,
        ...(error.fieldErrors ? { fieldErrors: error.fieldErrors } : {})
      }
    }, error.status, extraHeaders);
  }
  console.error("request_failed", { requestId: currentRequestId, errorType: error instanceof Error ? error.name : "unknown" });
  return jsonResponse({
    error: {
      code: "INTERNAL_ERROR",
      message: "系統暫時無法處理請求。",
      requestId: currentRequestId
    }
  }, 500, extraHeaders);
}

async function route(request: Request, env: AppEnv): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, "") || "/";
  const method = request.method.toUpperCase();

  if (method === "OPTIONS" && isPublicFollowBoardPath(path)) return followBoardOptions(request);
  if (method === "GET" && path === "/api/v1/public/follow-board/manifest") {
    return getFollowBoardManifest(request, env);
  }
  if (method === "POST" && path === "/api/v1/public/follow-board/interests") {
    return submitFollowBoardInterest(request, env);
  }
  // Unauthenticated by necessity: LINE fetches the image itself and sends no credentials. The
  // unguessable keyed token is the access control, and the image carries no 手收.
  const followBoardImageMatch = /^\/api\/v1\/public\/follow-board\/images\/([A-Za-z0-9_-]{32,128})\.png$/.exec(path);
  if (method === "GET" && followBoardImageMatch?.[1]) {
    return getFollowBoardImage(env, followBoardImageMatch[1]);
  }
  // LINE calls this unauthenticated, so the channel-secret signature is the only gate. It 404s
  // unless LINE_WEBHOOK_ENABLED is "1", and exists only to capture the group id, which LINE
  // delivers nowhere else. Turn it off again once the id is configured.
  if (method === "POST" && path === "/api/v1/public/line/webhook") {
    return handleLineWebhook(request, env);
  }
  if (method === "OPTIONS") return emptyResponse(204, { allow: "GET, POST, OPTIONS" });
  if (method === "GET" && path === "/api/v1/health") return jsonResponse({ status: "ok" });
  if (method === "POST" && path === "/api/v1/auth/register") return register(request, env);
  if (method === "POST" && path === "/api/v1/auth/login") return login(request, env);

  const session = await requireSession(request, env);
  if (method === "POST" && path === "/api/v1/auth/logout") return logout(request, env, session);
  if (method === "GET" && path === "/api/v1/auth/session") return sessionInfo(session);
  if (method === "GET" && path === "/api/v1/admin/registrations") return listRegistrations(env, session);
  if (method === "GET" && path === "/api/v1/admin/accounts") return listAccounts(env, session);
  if (method === "POST" && path === "/api/v1/admin/accounts/lookup") return lookupAccountByEmployeeNumber(request, env, session);
  if (method === "GET" && path === "/api/v1/admin/outbound-emails") return listAdminOutboundEmails(request, env, session);
  if (method === "GET" && path === "/api/v1/admin/rfq-timelines") return listAdminRfqTimelines(request, env, session);
  if (method === "GET" && path === "/api/v1/admin/market-context-health") {
    return getAdminMarketContextHealth(request, env, session);
  }
  if (method === "GET" && path === "/api/v1/admin/follow-board/interests") {
    return listAdminFollowBoardInterests(request, env, session);
  }
  const archiveFollowBoardMatch = /^\/api\/v1\/admin\/follow-board\/products\/([^/]+)\/archive$/.exec(path);
  if (method === "POST" && archiveFollowBoardMatch?.[1]) {
    return archiveFollowBoardProduct(
      request,
      env,
      session,
      decodeURIComponent(archiveFollowBoardMatch[1])
    );
  }
  const outboundEmailMatch = /^\/api\/v1\/admin\/outbound-emails\/([^/]+)$/.exec(path);
  if (method === "GET" && outboundEmailMatch?.[1]) return getAdminOutboundEmail(request, env, session, outboundEmailMatch[1]);

  const approveMatch = /^\/api\/v1\/admin\/registrations\/([^/]+)\/approve$/.exec(path);
  if (method === "POST" && approveMatch?.[1]) return approveRegistration(request, env, session, approveMatch[1]);
  const rejectMatch = /^\/api\/v1\/admin\/registrations\/([^/]+)\/reject$/.exec(path);
  if (method === "POST" && rejectMatch?.[1]) return rejectRegistration(request, env, session, rejectMatch[1]);

  const promoteMatch = /^\/api\/v1\/admin\/accounts\/([^/]+)\/promote$/.exec(path);
  if (method === "POST" && promoteMatch?.[1]) return promoteAccount(request, env, session, promoteMatch[1]);
  const demoteMatch = /^\/api\/v1\/admin\/accounts\/([^/]+)\/demote$/.exec(path);
  if (method === "POST" && demoteMatch?.[1]) return demoteAccount(request, env, session, demoteMatch[1]);
  const disableMatch = /^\/api\/v1\/admin\/accounts\/([^/]+)\/disable$/.exec(path);
  if (method === "POST" && disableMatch?.[1]) return disableAccount(request, env, session, disableMatch[1]);
  const deleteMatch = /^\/api\/v1\/admin\/accounts\/([^/]+)\/delete$/.exec(path);
  if (method === "POST" && deleteMatch?.[1]) return deleteAccountPermanently(request, env, session, deleteMatch[1]);

  if (method === "GET" && path === "/api/v1/rfqs/summary") return getRfqListSummary(env, session);
  if (method === "POST" && path === "/api/v1/rfqs") return createRfq(request, env, session);
  if (method === "GET" && path === "/api/v1/rfqs") return listRfqs(request, env, session);
  const validateMatch = /^\/api\/v1\/rfqs\/([^/]+)\/validate$/.exec(path);
  if (method === "POST" && validateMatch?.[1]) return validateRfq(request, env, session, validateMatch[1]);
  const sendMatch = /^\/api\/v1\/rfqs\/([^/]+)\/send$/.exec(path);
  if (method === "POST" && sendMatch?.[1]) return sendRfq(request, env, session, sendMatch[1]);
  const statusMatch = /^\/api\/v1\/rfqs\/([^/]+)\/status$/.exec(path);
  if (method === "GET" && statusMatch?.[1]) return getRfqStatus(env, session, statusMatch[1]);
  const snapshotMatch = /^\/api\/v1\/rfqs\/([^/]+)\/snapshot$/.exec(path);
  if (method === "GET" && snapshotMatch?.[1]) return getRfqSnapshot(request, env, session, snapshotMatch[1]);
  const resultsMatch = /^\/api\/v1\/rfqs\/([^/]+)\/results$/.exec(path);
  if (method === "GET" && resultsMatch?.[1]) return getRfqResults(env, session, resultsMatch[1]);
  const artifactsMatch = /^\/api\/v1\/rfqs\/([^/]+)\/artifacts$/.exec(path);
  if (method === "GET" && artifactsMatch?.[1]) return listRfqArtifacts(env, session, artifactsMatch[1]);
  const quoteArtifactMatch = /^\/api\/v1\/rfqs\/([^/]+)\/trades\/([^/]+)\/quotes\/([^/]+)\/artifact$/.exec(path);
  if (method === "POST" && quoteArtifactMatch?.[1] && quoteArtifactMatch[2] && quoteArtifactMatch[3]) {
    return requestTradeArtifact(
      request,
      env,
      session,
      quoteArtifactMatch[1],
      quoteArtifactMatch[2],
      quoteArtifactMatch[3]
    );
  }
  const quoteCardMatch = /^\/api\/v1\/rfqs\/([^/]+)\/trades\/([^/]+)\/quotes\/([^/]+)\/card$/.exec(path);
  if (method === "GET" && quoteCardMatch?.[1] && quoteCardMatch[2] && quoteCardMatch[3]) {
    return getTradeCardDocument(env, session, quoteCardMatch[1], quoteCardMatch[2], quoteCardMatch[3]);
  }
  const quoteAnalysisMatch = /^\/api\/v1\/rfqs\/([^/]+)\/trades\/([^/]+)\/quotes\/([^/]+)\/analysis-input$/.exec(path);
  if (method === "GET" && quoteAnalysisMatch?.[1] && quoteAnalysisMatch[2] && quoteAnalysisMatch[3]) {
    return getTradeAnalysisInput(
      env,
      session,
      quoteAnalysisMatch[1],
      quoteAnalysisMatch[2],
      quoteAnalysisMatch[3]
    );
  }
  const marketContextMatch = /^\/api\/v1\/market\/instruments\/([^/]+)\/context$/.exec(path);
  if (method === "GET" && marketContextMatch?.[1]) {
    return getMarketContext(request, env, session, decodeURIComponent(marketContextMatch[1]));
  }
  const tradeCardMatch = /^\/api\/v1\/rfqs\/([^/]+)\/trades\/([^/]+)\/card$/.exec(path);
  if (method === "GET" && tradeCardMatch?.[1] && tradeCardMatch[2]) {
    return getTradeCardDocument(env, session, tradeCardMatch[1], tradeCardMatch[2]);
  }
  const tradeArtifactMatch = /^\/api\/v1\/rfqs\/([^/]+)\/trades\/([^/]+)\/artifact$/.exec(path);
  if (method === "POST" && tradeArtifactMatch?.[1] && tradeArtifactMatch[2]) {
    return requestTradeArtifact(request, env, session, tradeArtifactMatch[1], tradeArtifactMatch[2]);
  }
  const recalculateMatch = /^\/api\/v1\/rfqs\/([^/]+)\/recalculate$/.exec(path);
  if (method === "POST" && recalculateMatch?.[1]) return recalculateRfq(request, env, session, recalculateMatch[1]);
  const finalizeMatch = /^\/api\/v1\/rfqs\/([^/]+)\/finalize$/.exec(path);
  if (method === "POST" && finalizeMatch?.[1]) return finalizeRfqNow(request, env, session, finalizeMatch[1]);
  const artifactDownloadMatch = /^\/api\/v1\/artifacts\/([^/]+)\/download$/.exec(path);
  if (method === "GET" && artifactDownloadMatch?.[1]) return downloadArtifact(request, env, session, artifactDownloadMatch[1]);
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
      return errorResponse(error, currentRequestId, request);
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
    try {
      await cleanupExpiredMarketData(env);
    } catch (error) {
      console.error("market_context_cleanup_failed", {
        errorType: error instanceof Error ? error.name : "unknown"
      });
    }
    try {
      await cleanupFollowBoardOperationalData(env);
    } catch (error) {
      console.error("follow_board_cleanup_failed", {
        errorType: error instanceof Error ? error.name : "unknown"
      });
    }
    try {
      await applyRetention(env);
    } catch (error) {
      console.error("retention_failed", {
        errorType: error instanceof Error ? error.name : "unknown"
      });
    }
  }
} satisfies ExportedHandler<AppEnv>;
