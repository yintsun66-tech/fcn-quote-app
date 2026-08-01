import { requireCsrf } from "./auth";
import { sha256Text } from "./crypto";
import { AppError } from "./errors";
import { readJson, requireIdempotencyKey, requireSameOrigin } from "./http";
import { sendRfq } from "./outbound";
import { createRfq, validateRfq } from "./rfqs";
import type { AppEnv, SessionContext } from "./types";

interface SubmitInput {
  trades?: unknown;
  issuers?: unknown;
}

function workflowRequest(
  original: Request,
  pathname: string,
  body: unknown,
  idempotencyKey?: string
): Request {
  const headers = new Headers({
    "content-type": "application/json",
    origin: new URL(original.url).origin
  });
  for (const name of ["cookie", "x-csrf-token", "cf-connecting-ip", "cf-ray"]) {
    const value = original.headers.get(name);
    if (value) headers.set(name, value);
  }
  if (idempotencyKey) headers.set("idempotency-key", idempotencyKey);
  return new Request(new URL(pathname, original.url), {
    method: "POST",
    headers,
    body: JSON.stringify(body)
  });
}

/**
 * Compatibility workflow that performs create → validate → queue in one browser round trip.
 * The existing three endpoints remain public and authoritative; deterministic child keys make a
 * retry resume the same RFQ instead of creating or dispatching a duplicate.
 */
export async function submitRfq(
  request: Request,
  env: AppEnv,
  session: SessionContext
): Promise<Response> {
  requireSameOrigin(request);
  await requireCsrf(request, session);
  const parentKey = requireIdempotencyKey(request);
  const input = await readJson(request) as SubmitInput;
  const childKeyHash = await sha256Text(`SUBMIT_RFQ:${session.user.id}:${parentKey}`);
  const createKey = `submit-create:${childKeyHash}`;
  const sendKey = `submit-send:${childKeyHash}`;

  const createResponse = await createRfq(
    workflowRequest(request, "/api/v1/rfqs", { trades: input.trades }, createKey),
    env,
    session
  );
  const created = await createResponse.json() as { rfq?: { id?: unknown } };
  const rfqId = typeof created.rfq?.id === "string" ? created.rfq.id : "";
  if (!rfqId) throw new AppError(500, "RFQ_SUBMIT_CREATE_FAILED", "建立詢價資料失敗。 ");

  await validateRfq(
    workflowRequest(request, `/api/v1/rfqs/${rfqId}/validate`, {}),
    env,
    session,
    rfqId
  );
  return sendRfq(
    workflowRequest(request, `/api/v1/rfqs/${rfqId}/send`, { issuers: input.issuers }, sendKey),
    env,
    session,
    rfqId
  );
}
