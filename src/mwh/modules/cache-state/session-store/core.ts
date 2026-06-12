export type StoredSessionStatus = "active" | "expired" | "revoked";

export interface SessionStorePolicy {
  ttlMs: number;
  absoluteTtlMs: number;
  touchAfterMs?: number;
}

export interface StoredSession {
  id: string;
  subjectId: string;
  data: Record<string, unknown>;
  status: StoredSessionStatus;
  createdAtMs: number;
  updatedAtMs: number;
  expiresAtMs: number;
  absoluteExpiresAtMs: number;
  revokedAtMs?: number;
  revokeReason?: string;
}

export interface SessionReadResult {
  found: boolean;
  session?: StoredSession;
  reason?: "missing" | "expired" | "revoked";
}

export interface SessionStoreSnapshot {
  active: number;
  expired: number;
  revoked: number;
  bySubject: Record<string, number>;
}

export function createStoredSession(input: {
  id: string;
  subjectId: string;
  data: Record<string, unknown>;
  nowMs: number;
  policy: SessionStorePolicy;
}): StoredSession {
  assertText(input.id, "id");
  assertText(input.subjectId, "subjectId");
  assertNonNegativeInteger(input.nowMs, "nowMs");
  assertPolicy(input.policy);
  return {
    id: input.id,
    subjectId: input.subjectId,
    data: cloneData(input.data),
    status: "active",
    createdAtMs: input.nowMs,
    updatedAtMs: input.nowMs,
    expiresAtMs: input.nowMs + input.policy.ttlMs,
    absoluteExpiresAtMs: input.nowMs + input.policy.absoluteTtlMs,
  };
}

export function readStoredSession(
  session: StoredSession | undefined,
  nowMs: number,
): SessionReadResult {
  assertNonNegativeInteger(nowMs, "nowMs");
  if (!session) return { found: false, reason: "missing" };
  const classified = classifyStoredSession(session, nowMs);
  if (classified.status === "expired")
    return { found: false, reason: "expired", session: classified };
  if (classified.status === "revoked")
    return { found: false, reason: "revoked", session: classified };
  return { found: true, session: cloneStoredSession(classified) };
}

export function updateStoredSessionData(
  session: StoredSession,
  input: { data: Record<string, unknown>; nowMs: number },
): StoredSession {
  assertActive(session, input.nowMs);
  return cloneStoredSession({
    ...session,
    data: cloneData(input.data),
    updatedAtMs: input.nowMs,
  });
}

export function touchStoredSession(
  session: StoredSession,
  input: { nowMs: number; policy: SessionStorePolicy },
): StoredSession {
  assertPolicy(input.policy);
  assertActive(session, input.nowMs);
  const touchAfterMs = input.policy.touchAfterMs ?? 0;
  if (input.nowMs - session.updatedAtMs < touchAfterMs) return cloneStoredSession(session);
  return cloneStoredSession({
    ...session,
    updatedAtMs: input.nowMs,
    expiresAtMs: Math.min(input.nowMs + input.policy.ttlMs, session.absoluteExpiresAtMs),
  });
}

export function revokeStoredSession(
  session: StoredSession,
  input: { nowMs: number; reason: string },
): StoredSession {
  assertNonNegativeInteger(input.nowMs, "nowMs");
  assertText(input.reason, "reason");
  if (session.status === "revoked") return cloneStoredSession(session);
  return cloneStoredSession({
    ...session,
    status: "revoked",
    updatedAtMs: input.nowMs,
    revokedAtMs: input.nowMs,
    revokeReason: input.reason,
  });
}

export function expireStoredSession(session: StoredSession, nowMs: number): StoredSession {
  assertNonNegativeInteger(nowMs, "nowMs");
  if (session.status !== "active") return cloneStoredSession(session);
  if (nowMs < session.expiresAtMs && nowMs < session.absoluteExpiresAtMs) {
    return cloneStoredSession(session);
  }
  return cloneStoredSession({ ...session, status: "expired", updatedAtMs: nowMs });
}

export function classifyStoredSession(session: StoredSession, nowMs: number): StoredSession {
  return expireStoredSession(session, nowMs);
}

export function sessionStoreSnapshot(sessions: readonly StoredSession[]): SessionStoreSnapshot {
  const bySubject: Record<string, number> = {};
  for (const session of sessions) {
    if (session.status === "active")
      bySubject[session.subjectId] = (bySubject[session.subjectId] ?? 0) + 1;
  }
  return {
    active: sessions.filter((session) => session.status === "active").length,
    expired: sessions.filter((session) => session.status === "expired").length,
    revoked: sessions.filter((session) => session.status === "revoked").length,
    bySubject,
  };
}

export function cloneStoredSession(session: StoredSession): StoredSession {
  return {
    ...session,
    data: cloneData(session.data),
  };
}

function assertActive(session: StoredSession, nowMs: number): void {
  const classified = classifyStoredSession(session, nowMs);
  if (classified.status !== "active") throw new Error(`session is ${classified.status}`);
}

function assertPolicy(policy: SessionStorePolicy): void {
  assertPositiveInteger(policy.ttlMs, "ttlMs");
  assertPositiveInteger(policy.absoluteTtlMs, "absoluteTtlMs");
  if (policy.absoluteTtlMs < policy.ttlMs) throw new Error("absoluteTtlMs must be >= ttlMs");
  if (policy.touchAfterMs !== undefined)
    assertNonNegativeInteger(policy.touchAfterMs, "touchAfterMs");
}

function cloneData(data: Record<string, unknown>): Record<string, unknown> {
  return JSON.parse(JSON.stringify(data)) as Record<string, unknown>;
}

function assertText(value: string, name: string): void {
  if (!value.trim()) throw new Error(`${name} is required`);
}

function assertPositiveInteger(value: number, name: string): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
}

function assertNonNegativeInteger(value: number, name: string): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative integer`);
  }
}
