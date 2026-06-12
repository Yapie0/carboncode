import {
  type MediaConstraintsPlan,
  type VideoCallParticipant,
  type VideoCallSession,
  type VideoCallSignal,
  type VideoCallSignalType,
  cloneVideoCallSession,
  cloneVideoCallSignal,
  createIncomingVideoCall,
  createOutgoingVideoCall,
  createVideoCallSignal,
  planMediaConstraints,
  transitionVideoCall,
} from "./core.js";

export interface MemoryVideoCallSessionOptions {
  now?: () => number;
}

export interface VideoCallSnapshot {
  session: VideoCallSession;
  signals: VideoCallSignal[];
  generatedAtMs: number;
}

export class MemoryVideoCallSessionStore {
  private readonly now: () => number;
  private readonly sessions = new Map<string, VideoCallSession>();
  private readonly signals: VideoCallSignal[] = [];

  constructor(options: MemoryVideoCallSessionOptions = {}) {
    this.now = options.now ?? Date.now;
  }

  startOutgoing(input: {
    callId: string;
    from: VideoCallParticipant;
    to: VideoCallParticipant;
  }): VideoCallSession {
    if (this.sessions.has(input.callId)) throw new Error("video call already exists");
    const session = createOutgoingVideoCall({ ...input, nowMs: this.now() });
    this.sessions.set(session.callId, session);
    this.pushSignal(session, "invite", session.from.userId);
    return cloneVideoCallSession(session);
  }

  receiveIncoming(input: {
    callId: string;
    from: VideoCallParticipant;
    to: VideoCallParticipant;
  }): VideoCallSession {
    if (this.sessions.has(input.callId)) throw new Error("video call already exists");
    const session = createIncomingVideoCall({ ...input, nowMs: this.now() });
    this.sessions.set(session.callId, session);
    this.pushSignal(session, "invite", session.from.userId);
    return cloneVideoCallSession(session);
  }

  transition(
    callId: string,
    action: Parameters<typeof transitionVideoCall>[1]["action"],
    reason?: string,
  ): VideoCallSession {
    const session = this.requireSession(callId);
    const next = transitionVideoCall(session, { action, reason, nowMs: this.now() });
    this.sessions.set(callId, next);
    return cloneVideoCallSession(next);
  }

  signal(input: {
    callId: string;
    type: VideoCallSignalType;
    fromUserId: string;
    payload?: Record<string, string>;
  }): VideoCallSignal {
    return this.pushSignal(
      this.requireSession(input.callId),
      input.type,
      input.fromUserId,
      input.payload,
    );
  }

  planMedia(input?: {
    audio?: boolean;
    video?: boolean;
    allowAudioFallback?: boolean;
  }): MediaConstraintsPlan {
    return planMediaConstraints(input);
  }

  get(callId: string): VideoCallSession | undefined {
    const session = this.sessions.get(callId);
    return session ? cloneVideoCallSession(session) : undefined;
  }

  listSignals(callId?: string): VideoCallSignal[] {
    return this.signals
      .filter((signal) => !callId || signal.callId === callId)
      .map(cloneVideoCallSignal);
  }

  snapshot(callId: string): VideoCallSnapshot {
    return {
      session: cloneVideoCallSession(this.requireSession(callId)),
      signals: this.listSignals(callId),
      generatedAtMs: this.now(),
    };
  }

  private pushSignal(
    session: VideoCallSession,
    type: VideoCallSignalType,
    fromUserId: string,
    payload?: Record<string, string>,
  ): VideoCallSignal {
    const signal = createVideoCallSignal({
      session,
      type,
      fromUserId,
      nowMs: this.now(),
      payload,
    });
    this.signals.push(signal);
    return cloneVideoCallSignal(signal);
  }

  private requireSession(callId: string): VideoCallSession {
    const session = this.sessions.get(callId);
    if (!session) throw new Error("video call not found");
    return session;
  }
}
