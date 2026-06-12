import {
  type SessionReadResult,
  type SessionStorePolicy,
  type SessionStoreSnapshot,
  type StoredSession,
  cloneStoredSession,
  createStoredSession,
  expireStoredSession,
  readStoredSession,
  revokeStoredSession,
  sessionStoreSnapshot,
  touchStoredSession,
  updateStoredSessionData,
} from "./core.js";

export interface MemorySessionStoreOptions {
  policy: SessionStorePolicy;
  now?: () => number;
}

export class MemorySessionStore {
  private readonly sessions = new Map<string, StoredSession>();
  private readonly policy: SessionStorePolicy;
  private readonly now: () => number;

  constructor(options: MemorySessionStoreOptions) {
    this.policy = { ...options.policy };
    this.now = options.now ?? Date.now;
  }

  create(input: { id: string; subjectId: string; data: Record<string, unknown> }): StoredSession {
    if (this.sessions.has(input.id)) throw new Error("session already exists");
    const session = createStoredSession({ ...input, nowMs: this.now(), policy: this.policy });
    this.sessions.set(session.id, session);
    return cloneStoredSession(session);
  }

  read(id: string): SessionReadResult {
    const result = readStoredSession(this.sessions.get(id), this.now());
    if (result.session) this.sessions.set(id, result.session);
    return result.session
      ? { ...result, session: cloneStoredSession(result.session) }
      : { ...result };
  }

  update(id: string, data: Record<string, unknown>): StoredSession {
    const session = updateStoredSessionData(this.requireSession(id), {
      data,
      nowMs: this.now(),
    });
    this.sessions.set(id, session);
    return cloneStoredSession(session);
  }

  touch(id: string): StoredSession {
    const session = touchStoredSession(this.requireSession(id), {
      nowMs: this.now(),
      policy: this.policy,
    });
    this.sessions.set(id, session);
    return cloneStoredSession(session);
  }

  revoke(id: string, reason: string): StoredSession {
    const session = revokeStoredSession(this.requireSession(id), {
      nowMs: this.now(),
      reason,
    });
    this.sessions.set(id, session);
    return cloneStoredSession(session);
  }

  revokeSubject(subjectId: string, reason: string): StoredSession[] {
    const revoked: StoredSession[] = [];
    for (const session of this.sessions.values()) {
      if (session.subjectId !== subjectId || session.status !== "active") continue;
      const next = revokeStoredSession(session, { nowMs: this.now(), reason });
      this.sessions.set(next.id, next);
      revoked.push(cloneStoredSession(next));
    }
    return revoked;
  }

  expire(): void {
    for (const session of this.sessions.values()) {
      const next = expireStoredSession(session, this.now());
      this.sessions.set(next.id, next);
    }
  }

  list(input: { status?: StoredSession["status"]; subjectId?: string } = {}): StoredSession[] {
    return [...this.sessions.values()]
      .filter((session) => !input.status || session.status === input.status)
      .filter((session) => !input.subjectId || session.subjectId === input.subjectId)
      .sort(
        (left, right) => left.createdAtMs - right.createdAtMs || left.id.localeCompare(right.id),
      )
      .map(cloneStoredSession);
  }

  snapshot(): SessionStoreSnapshot {
    return sessionStoreSnapshot([...this.sessions.values()]);
  }

  private requireSession(id: string): StoredSession {
    const session = this.sessions.get(id);
    if (!session) throw new Error("session not found");
    return cloneStoredSession(session);
  }
}
