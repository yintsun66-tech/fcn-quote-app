import type { AppEnv } from "./types";

const DEFAULT_SOFT_DEADLINE_SECONDS = 7 * 60;
const DEFAULT_REPLY_WINDOW_SECONDS = 15 * 60;
const DEFAULT_MAIL_GRACE_SECONDS = 60;

function positiveSeconds(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

export function rfqReplyWindowSeconds(env: AppEnv): number {
  return positiveSeconds(env.RFQ_DEADLINE_SECONDS, DEFAULT_REPLY_WINDOW_SECONDS);
}

export function rfqMailGraceSeconds(env: AppEnv): number {
  return positiveSeconds(env.RFQ_MAIL_GRACE_SECONDS, DEFAULT_MAIL_GRACE_SECONDS);
}

export function rfqHardDeadlineSeconds(env: AppEnv): number {
  return rfqReplyWindowSeconds(env) + rfqMailGraceSeconds(env);
}

export function rfqSoftDeadlineSeconds(env: AppEnv): number {
  const replyWindow = rfqReplyWindowSeconds(env);
  const requested = positiveSeconds(env.RFQ_SOFT_DEADLINE_SECONDS, DEFAULT_SOFT_DEADLINE_SECONDS);
  return Math.min(requested, Math.max(1, replyWindow - 1));
}

export function rfqSoftDeadlineAt(env: AppEnv, sentAt: string | null): string | null {
  if (!sentAt) return null;
  const timestamp = Date.parse(sentAt);
  if (!Number.isFinite(timestamp)) return null;
  return new Date(timestamp + rfqSoftDeadlineSeconds(env) * 1_000).toISOString();
}

export function rfqMailGraceStartsAt(env: AppEnv, sentAt: string | null): string | null {
  if (!sentAt) return null;
  const timestamp = Date.parse(sentAt);
  if (!Number.isFinite(timestamp)) return null;
  return new Date(timestamp + rfqReplyWindowSeconds(env) * 1_000).toISOString();
}
