import { describe, expect, it } from "vitest";
import {
  type SessionStorePolicy,
  createStoredSession,
  expireStoredSession,
  readStoredSession,
  revokeStoredSession,
  sessionStoreSnapshot,
  touchStoredSession,
  updateStoredSessionData,
} from "../src/mwh/modules/cache-state/session-store/core.js";
import { MemorySessionStore } from "../src/mwh/modules/cache-state/session-store/memory-store.js";

const policy: SessionStorePolicy = {
  ttlMs: 100,
  absoluteTtlMs: 250,
  touchAfterMs: 50,
};

describe("session-store MWH module", () => {
  it("creates, reads, updates, touches, and caps sessions by absolute TTL", () => {
    let session = createStoredSession({
      id: "sess-1",
      subjectId: "user-1",
      data: { role: "admin" },
      nowMs: 1000,
      policy,
    });

    expect(readStoredSession(session, 1010)).toEqual({ found: true, session });
    session = updateStoredSessionData(session, {
      data: { role: "admin", theme: "dark" },
      nowMs: 1020,
    });
    expect(session.data).toEqual({ role: "admin", theme: "dark" });

    expect(touchStoredSession(session, { nowMs: 1040, policy }).expiresAtMs).toBe(1100);
    session = touchStoredSession(session, { nowMs: 1080, policy });
    expect(session.expiresAtMs).toBe(1180);
    session = touchStoredSession(session, { nowMs: 1170, policy });
    expect(session.expiresAtMs).toBe(1250);
  });

  it("expires, revokes, and snapshots sessions", () => {
    const active = createStoredSession({
      id: "sess-2",
      subjectId: "user-1",
      data: {},
      nowMs: 1000,
      policy,
    });
    const expired = expireStoredSession(active, 1100);
    const revoked = revokeStoredSession(
      createStoredSession({
        id: "sess-3",
        subjectId: "user-2",
        data: {},
        nowMs: 1000,
        policy,
      }),
      { nowMs: 1010, reason: "logout" },
    );

    expect(readStoredSession(expired, 1110)).toMatchObject({ found: false, reason: "expired" });
    expect(readStoredSession(revoked, 1110)).toMatchObject({ found: false, reason: "revoked" });
    expect(sessionStoreSnapshot([active, expired, revoked])).toEqual({
      active: 1,
      expired: 1,
      revoked: 1,
      bySubject: { "user-1": 1 },
    });
  });

  it("runs a clone-safe memory store with read expiry persistence", () => {
    let now = 1000;
    const store = new MemorySessionStore({ policy, now: () => now });

    store.create({ id: "sess-4", subjectId: "user-1", data: { cart: ["a"] } });
    expect(() => store.create({ id: "sess-4", subjectId: "user-1", data: {} })).toThrow(
      "session already exists",
    );

    const leaked = store.list();
    (leaked[0]!.data.cart as string[])[0] = "mutated";
    expect(store.read("sess-4").session?.data).toEqual({ cart: ["a"] });

    now = 1100;
    expect(store.read("sess-4")).toMatchObject({ found: false, reason: "expired" });
    expect(store.snapshot()).toEqual({
      active: 0,
      expired: 1,
      revoked: 0,
      bySubject: {},
    });
  });

  it("updates, touches, filters, revokes by subject, and expires active sessions", () => {
    let now = 1000;
    const store = new MemorySessionStore({ policy, now: () => now });

    store.create({ id: "sess-5", subjectId: "user-1", data: { role: "reader" } });
    store.create({ id: "sess-6", subjectId: "user-1", data: { role: "writer" } });
    store.create({ id: "sess-7", subjectId: "user-2", data: { role: "reader" } });

    now = 1060;
    expect(store.touch("sess-5").expiresAtMs).toBe(1160);
    expect(store.update("sess-5", { role: "admin" }).data).toEqual({ role: "admin" });
    expect(store.list({ subjectId: "user-1" })).toHaveLength(2);

    expect(store.revokeSubject("user-1", "password reset")).toHaveLength(2);
    expect(store.list({ status: "revoked" })).toHaveLength(2);

    now = 1110;
    store.expire();
    expect(store.snapshot()).toEqual({
      active: 0,
      expired: 1,
      revoked: 2,
      bySubject: {},
    });
  });
});
