import { describe, expect, it } from "vitest";
import {
  createIncomingVideoCall,
  createOutgoingVideoCall,
  createVideoCallSignal,
  planMediaConstraints,
  transitionVideoCall,
} from "../src/mwh/modules/realtime/video-call-webrtc/core.js";
import { MemoryVideoCallSessionStore } from "../src/mwh/modules/realtime/video-call-webrtc/memory-session.js";

describe("MWH video-call-webrtc stateless core", () => {
  it("creates outgoing and incoming sessions without mutating participant inputs", () => {
    const from = { userId: "alice", displayName: "Alice" };
    const to = { userId: "bob", displayName: "Bob" };
    const outgoing = createOutgoingVideoCall({ callId: "call-1", from, to, nowMs: 1_000 });
    const incoming = createIncomingVideoCall({ callId: "call-2", from, to, nowMs: 1_010 });

    from.displayName = "Mutated";
    expect(outgoing).toEqual(
      expect.objectContaining({
        callId: "call-1",
        status: "outgoing-ringing",
        direction: "outgoing",
        createdAtMs: 1_000,
      }),
    );
    expect(outgoing.from.displayName).toBe("Alice");
    expect(incoming.status).toBe("incoming-ringing");
    expect(() => createOutgoingVideoCall({ callId: "self", from, to: from, nowMs: 1_020 })).toThrow(
      "cannot call self",
    );
  });

  it("transitions through accept, connecting, active, hangup, reject, timeout, and media failure", () => {
    const outgoing = createOutgoingVideoCall({
      callId: "call-1",
      from: { userId: "alice" },
      to: { userId: "bob" },
      nowMs: 1_000,
    });
    const connecting = transitionVideoCall(outgoing, {
      action: "receive-accept",
      nowMs: 1_100,
    });
    const active = transitionVideoCall(connecting, { action: "connected", nowMs: 1_200 });
    const ended = transitionVideoCall(active, { action: "hangup", nowMs: 1_300 });

    expect(connecting).toEqual(
      expect.objectContaining({ status: "connecting", acceptedAtMs: 1_100 }),
    );
    expect(active.status).toBe("active");
    expect(ended).toEqual(expect.objectContaining({ status: "ended", endedAtMs: 1_300 }));
    expect(() => transitionVideoCall(ended, { action: "connected", nowMs: 1_400 })).toThrow(
      "cannot connected from ended",
    );

    const incoming = createIncomingVideoCall({
      callId: "call-2",
      from: { userId: "alice" },
      to: { userId: "bob" },
      nowMs: 2_000,
    });
    expect(transitionVideoCall(incoming, { action: "reject", nowMs: 2_100 }).status).toBe(
      "rejected",
    );
    expect(transitionVideoCall(incoming, { action: "timeout", nowMs: 2_200 }).failureReason).toBe(
      "call timeout",
    );
    expect(
      transitionVideoCall(incoming, { action: "media-failed", nowMs: 2_300, reason: "denied" }),
    ).toEqual(expect.objectContaining({ status: "failed", failureReason: "denied" }));
  });

  it("validates signaling participants, allowed signal states, and media fallback plans", () => {
    const session = transitionVideoCall(
      createOutgoingVideoCall({
        callId: "call-1",
        from: { userId: "alice" },
        to: { userId: "bob" },
        nowMs: 1_000,
      }),
      { action: "receive-accept", nowMs: 1_100 },
    );

    expect(
      createVideoCallSignal({
        session,
        type: "offer",
        fromUserId: "alice",
        nowMs: 1_200,
        payload: { sdp: "offer" },
      }),
    ).toEqual(
      expect.objectContaining({
        callId: "call-1",
        type: "offer",
        fromUserId: "alice",
        toUserId: "bob",
      }),
    );
    expect(() =>
      createVideoCallSignal({ session, type: "invite", fromUserId: "alice", nowMs: 1_210 }),
    ).toThrow("signal invite is not allowed in connecting");
    expect(() =>
      createVideoCallSignal({ session, type: "offer", fromUserId: "mallory", nowMs: 1_220 }),
    ).toThrow("sender is not a call participant");
    expect(planMediaConstraints()).toEqual({
      audio: true,
      video: true,
      fallbackOrder: ["audio-video", "audio-only", "none"],
    });
    expect(planMediaConstraints({ audio: true, video: false })).toEqual({
      audio: true,
      video: false,
      fallbackOrder: ["audio-only", "none"],
    });
  });
});

describe("MWH video-call-webrtc stateful memory session", () => {
  it("runs outgoing call invite, accept, offer, answer, active, hangup, snapshot, and clone-safe flows", () => {
    let now = 1_000;
    const store = new MemoryVideoCallSessionStore({ now: () => now });
    const started = store.startOutgoing({
      callId: "call-1",
      from: { userId: "alice", displayName: "Alice" },
      to: { userId: "bob", displayName: "Bob" },
    });

    expect(started.status).toBe("outgoing-ringing");
    expect(store.listSignals("call-1").map((signal) => signal.type)).toEqual(["invite"]);

    now = 1_100;
    expect(store.transition("call-1", "receive-accept").status).toBe("connecting");
    now = 1_120;
    expect(store.signal({ callId: "call-1", type: "offer", fromUserId: "alice" }).toUserId).toBe(
      "bob",
    );
    now = 1_130;
    store.signal({ callId: "call-1", type: "answer", fromUserId: "bob" });
    now = 1_200;
    expect(store.transition("call-1", "connected").status).toBe("active");
    now = 1_300;
    expect(store.signal({ callId: "call-1", type: "hangup", fromUserId: "bob" }).type).toBe(
      "hangup",
    );
    expect(store.transition("call-1", "hangup").status).toBe("ended");

    const snapshot = store.snapshot("call-1");
    expect(snapshot.signals.map((signal) => signal.type)).toEqual([
      "invite",
      "offer",
      "answer",
      "hangup",
    ]);
    snapshot.session.from.displayName = "Mutated";
    expect(store.get("call-1")?.from.displayName).toBe("Alice");
  });

  it("runs incoming reject, duplicate rejection, missing call errors, and media planning", () => {
    const store = new MemoryVideoCallSessionStore({ now: () => 2_000 });
    store.receiveIncoming({
      callId: "call-2",
      from: { userId: "alice" },
      to: { userId: "bob" },
    });

    expect(() =>
      store.receiveIncoming({
        callId: "call-2",
        from: { userId: "alice" },
        to: { userId: "bob" },
      }),
    ).toThrow("video call already exists");
    expect(store.transition("call-2", "reject", "busy")).toEqual(
      expect.objectContaining({ status: "rejected", failureReason: "busy" }),
    );
    expect(() => store.transition("missing", "hangup")).toThrow("video call not found");
    expect(store.planMedia({ audio: true, video: true, allowAudioFallback: false })).toEqual({
      audio: true,
      video: true,
      fallbackOrder: ["audio-video", "none"],
    });
  });
});
