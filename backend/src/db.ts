import { sha256Text } from "./crypto";
import type { AppEnv, SessionContext } from "./types";

export function newId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID()}`;
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function addSeconds(date: Date, seconds: number): string {
  return new Date(date.getTime() + seconds * 1000).toISOString();
}

export async function insertAudit(
  env: AppEnv,
  action: string,
  entityType: string,
  entityId: string | null,
  actorUserId: string | null,
  requestId: string,
  metadata: Record<string, unknown> = {}
): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO audit_events
      (id, actor_user_id, action, entity_type, entity_id, request_id, safe_metadata_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(newId("aud"), actorUserId, action, entityType, entityId, requestId, JSON.stringify(metadata), nowIso()).run();
}

interface SessionRow {
  session_id: string;
  csrf_token_hash: string;
  absolute_expires_at: string;
  expires_at: string;
  credential_version: number;
  user_credential_version: number;
  user_id: string;
  username_normalized: string;
  display_name: string;
  branch_name: string;
  role: "USER" | "ADMIN";
}

export async function loadSession(env: AppEnv, rawToken: string): Promise<SessionContext | null> {
  const tokenHash = await sha256Text(rawToken);
  const row = await env.DB.prepare(
    `SELECT s.id AS session_id, s.csrf_token_hash, s.absolute_expires_at, s.expires_at,
            s.credential_version, u.credential_version AS user_credential_version,
            u.id AS user_id, u.username_normalized, u.display_name, u.branch_name, u.role
       FROM user_sessions s
       JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = ? AND s.revoked_at IS NULL AND u.status = 'ACTIVE'`
  ).bind(tokenHash).first<SessionRow>();

  if (!row) return null;
  const now = new Date();
  if (Date.parse(row.expires_at) <= now.getTime() || Date.parse(row.absolute_expires_at) <= now.getTime()) return null;
  if (row.credential_version !== row.user_credential_version) return null;

  const idleSeconds = Number(env.SESSION_IDLE_SECONDS);
  const nextExpiryMs = Math.min(now.getTime() + idleSeconds * 1000, Date.parse(row.absolute_expires_at));
  await env.DB.prepare("UPDATE user_sessions SET last_seen_at = ?, expires_at = ? WHERE id = ?")
    .bind(now.toISOString(), new Date(nextExpiryMs).toISOString(), row.session_id).run();

  return {
    id: row.session_id,
    csrfTokenHash: row.csrf_token_hash,
    absoluteExpiresAt: row.absolute_expires_at,
    user: {
      id: row.user_id,
      username: row.username_normalized,
      displayName: row.display_name,
      branchName: row.branch_name,
      role: row.role,
      credentialVersion: row.user_credential_version
    }
  };
}
