export type VideoCallStatus =
  | "idle"
  | "outgoing-ringing"
  | "incoming-ringing"
  | "connecting"
  | "active"
  | "ended"
  | "rejected"
  | "failed";

export type VideoCallSignalType =
  | "invite"
  | "accept"
  | "reject"
  | "offer"
  | "answer"
  | "ice-candidate"
  | "hangup"
  | "media-failed";

export interface VideoCallParticipant {
  userId: string;
  displayName?: string;
}

export interface VideoCallSession {
  callId: string;
  from: VideoCallParticipant;
  to: VideoCallParticipant;
  status: VideoCallStatus;
  direction: "outgoing" | "incoming";
  createdAtMs: number;
  updatedAtMs: number;
  acceptedAtMs?: number;
  endedAtMs?: number;
  failureReason?: string;
}

export interface VideoCallSignal {
  callId: string;
  type: VideoCallSignalType;
  fromUserId: string;
  toUserId: string;
  atMs: number;
  payload?: Record<string, string>;
}

export interface MediaConstraintsPlan {
  audio: boolean;
  video: boolean;
  fallbackOrder: Array<"audio-video" | "audio-only" | "none">;
}

export function createOutgoingVideoCall(input: {
  callId: string;
  from: VideoCallParticipant;
  to: VideoCallParticipant;
  nowMs: number;
}): VideoCallSession {
  assertNonEmpty(input.callId, "callId");
  assertParticipant(input.from, "from");
  assertParticipant(input.to, "to");
  assertNonNegativeInteger(input.nowMs, "nowMs");
  if (input.from.userId === input.to.userId) throw new Error("cannot call self");
  return {
    callId: input.callId,
    from: cloneParticipant(input.from),
    to: cloneParticipant(input.to),
    status: "outgoing-ringing",
    direction: "outgoing",
    createdAtMs: input.nowMs,
    updatedAtMs: input.nowMs,
  };
}

export function createIncomingVideoCall(input: {
  callId: string;
  from: VideoCallParticipant;
  to: VideoCallParticipant;
  nowMs: number;
}): VideoCallSession {
  return {
    ...createOutgoingVideoCall(input),
    status: "incoming-ringing",
    direction: "incoming",
  };
}

export function transitionVideoCall(
  session: VideoCallSession,
  input: {
    action:
      | "receive-accept"
      | "accept"
      | "reject"
      | "receive-offer"
      | "receive-answer"
      | "connected"
      | "hangup"
      | "media-failed"
      | "timeout";
    nowMs: number;
    reason?: string;
  },
): VideoCallSession {
  assertNonNegativeInteger(input.nowMs, "nowMs");
  const next = cloneVideoCallSession(session);
  next.updatedAtMs = input.nowMs;

  switch (input.action) {
    case "receive-accept":
      assertStatus(session, ["outgoing-ringing"], input.action);
      next.status = "connecting";
      next.acceptedAtMs = input.nowMs;
      return next;
    case "accept":
      assertStatus(session, ["incoming-ringing"], input.action);
      next.status = "connecting";
      next.acceptedAtMs = input.nowMs;
      return next;
    case "receive-offer":
      assertStatus(session, ["incoming-ringing", "connecting"], input.action);
      next.status = "connecting";
      return next;
    case "receive-answer":
      assertStatus(session, ["connecting"], input.action);
      return next;
    case "connected":
      assertStatus(session, ["connecting"], input.action);
      next.status = "active";
      return next;
    case "reject":
      assertStatus(session, ["outgoing-ringing", "incoming-ringing", "connecting"], input.action);
      next.status = "rejected";
      next.endedAtMs = input.nowMs;
      next.failureReason = input.reason;
      return next;
    case "hangup":
      assertStatus(
        session,
        ["outgoing-ringing", "incoming-ringing", "connecting", "active"],
        input.action,
      );
      next.status = "ended";
      next.endedAtMs = input.nowMs;
      return next;
    case "media-failed":
      assertStatus(session, ["outgoing-ringing", "incoming-ringing", "connecting"], input.action);
      next.status = "failed";
      next.endedAtMs = input.nowMs;
      next.failureReason = input.reason ?? "media failed";
      return next;
    case "timeout":
      assertStatus(session, ["outgoing-ringing", "incoming-ringing", "connecting"], input.action);
      next.status = "failed";
      next.endedAtMs = input.nowMs;
      next.failureReason = input.reason ?? "call timeout";
      return next;
  }
}

export function createVideoCallSignal(input: {
  session: VideoCallSession;
  type: VideoCallSignalType;
  fromUserId: string;
  nowMs: number;
  payload?: Record<string, string>;
}): VideoCallSignal {
  assertNonEmpty(input.fromUserId, "fromUserId");
  assertNonNegativeInteger(input.nowMs, "nowMs");
  const toUserId = otherParticipantId(input.session, input.fromUserId);
  if (!isSignalAllowed(input.session.status, input.type)) {
    throw new Error(`signal ${input.type} is not allowed in ${input.session.status}`);
  }
  return {
    callId: input.session.callId,
    type: input.type,
    fromUserId: input.fromUserId,
    toUserId,
    atMs: input.nowMs,
    payload: input.payload ? { ...input.payload } : undefined,
  };
}

export function planMediaConstraints(
  input: {
    audio?: boolean;
    video?: boolean;
    allowAudioFallback?: boolean;
  } = {},
): MediaConstraintsPlan {
  const audio = input.audio ?? true;
  const video = input.video ?? true;
  const fallbackOrder: MediaConstraintsPlan["fallbackOrder"] = [];
  if (audio && video) fallbackOrder.push("audio-video");
  if (audio && (input.allowAudioFallback ?? true)) fallbackOrder.push("audio-only");
  fallbackOrder.push("none");
  return { audio, video, fallbackOrder };
}

export function cloneVideoCallSession(session: VideoCallSession): VideoCallSession {
  return {
    ...session,
    from: cloneParticipant(session.from),
    to: cloneParticipant(session.to),
  };
}

export function cloneVideoCallSignal(signal: VideoCallSignal): VideoCallSignal {
  return {
    ...signal,
    payload: signal.payload ? { ...signal.payload } : undefined,
  };
}

function isSignalAllowed(status: VideoCallStatus, type: VideoCallSignalType): boolean {
  const allowed: Record<VideoCallStatus, readonly VideoCallSignalType[]> = {
    idle: [],
    "outgoing-ringing": ["invite", "accept", "reject", "hangup", "media-failed"],
    "incoming-ringing": ["invite", "accept", "reject", "offer", "hangup", "media-failed"],
    connecting: ["offer", "answer", "ice-candidate", "hangup", "media-failed"],
    active: ["ice-candidate", "hangup"],
    ended: [],
    rejected: [],
    failed: [],
  };
  return allowed[status].includes(type);
}

function otherParticipantId(session: VideoCallSession, userId: string): string {
  if (session.from.userId === userId) return session.to.userId;
  if (session.to.userId === userId) return session.from.userId;
  throw new Error("sender is not a call participant");
}

function assertStatus(
  session: VideoCallSession,
  allowed: readonly VideoCallStatus[],
  action: string,
): void {
  if (!allowed.includes(session.status)) {
    throw new Error(`cannot ${action} from ${session.status}`);
  }
}

function assertParticipant(participant: VideoCallParticipant, name: string): void {
  assertNonEmpty(participant.userId, `${name}.userId`);
}

function cloneParticipant(participant: VideoCallParticipant): VideoCallParticipant {
  return { ...participant };
}

function assertNonEmpty(value: string, name: string): void {
  if (!value.trim()) throw new Error(`${name} is required`);
}

function assertNonNegativeInteger(value: number, name: string): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative integer`);
  }
}
