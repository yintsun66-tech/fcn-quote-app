import type { AppEnv } from "./types";

const DEFAULT_SOFT_DEADLINE_SECONDS = 7 * 60;
const DEFAULT_HARD_DEADLINE_SECONDS = 15 * 60;

function positiveSeconds(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

export function rfqHardDeadlineSeconds(env: AppEnv): number {
  return positiveSeconds(env.RFQ_DEADLINE_SECONDS, DEFAULT_HARD_DEADLINE_SECONDS);
}

export function rfqSoftDeadlineSeconds(env: AppEnv): number {
  const hard = rfqHardDeadlineSeconds(env);
  const requested = positiveSeconds(env.RFQ_SOFT_DEADLINE_SECONDS, DEFAULT_SOFT_DEADLINE_SECONDS);
  return Math.min(requested, Math.max(1, hard - 1));
}

export function rfqSoftDeadlineAt(env: AppEnv, sentAt: string | null): string | null {
  if (!sentAt) return null;
  const timestamp = Date.parse(sentAt);
  if (!Number.isFinite(timestamp)) return null;
  return new Date(timestamp + rfqSoftDeadlineSeconds(env) * 1_000).toISOString();
}
