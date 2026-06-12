import type { MwhModule } from "../../types.js";

const CONTENT = `# MWH Module: WebRTC Video Call Middleware

## Purpose

Use this module as a reusable reference when building browser video calls, Socket.IO/WebSocket signaling, React call UI, media permission fallback, or a dedicated call middleware package.

This is not persistent agent context. Read it only when the current task needs video-call implementation details, then adapt the design to the target project.

## Proven Failure Points

- TLS generation can block or fail when selfsigned and the active Node.js Web Crypto implementation are incompatible. Pin the known-good major version or pre-generate certificates.
- HTTPS dev servers proxying WSS traffic to Socket.IO must trust the local self-signed backend with an explicit HTTPS agent.
- Media permission fallback must not overwrite the current call direction. Preserve incoming/outgoing state through permission recovery.
- Avoid putting signaling, peer connection lifecycle, media acquisition, and overlay UI into one large chat component. That structure creates stale closures and ref/effect races.
- Treat async Socket.IO handlers as serialized state transitions. Guard every event with current call id and state.
- Windows start scripts should be UTF-8 and should not hide long-lived servers behind shells that cannot receive Ctrl+C cleanly.

## Recommended Middleware Shape

- core/state-machine.ts: pure call states and transitions.
- core/media.ts: requestMedia, fallback handling, device cleanup.
- core/webrtc.ts: peer connection creation, track binding, ICE handling.
- core/types.ts: call ids, participants, offers, answers, ICE payloads.
- adapters/SignalingAdapter.ts: transport-neutral signaling contract.
- adapters/socket-io.ts: Socket.IO adapter.
- adapters/mock.ts: deterministic test adapter.
- react/CallProvider.tsx: owns call state and lifecycle.
- react/useCall.ts: stable public hook.
- react/CallOverlay.tsx: fixed viewport call UI.

## Public API Sketch

\`\`\`ts
export interface SignalingAdapter {
  connect(): Promise<void>;
  disconnect(): void;
  send(event: CallSignal): Promise<void>;
  subscribe(handler: (event: CallSignal) => void): () => void;
}

export interface UseCallApi {
  state: CallState;
  startCall(targetUserId: string): Promise<void>;
  acceptCall(callId: string): Promise<void>;
  rejectCall(callId: string): Promise<void>;
  endCall(callId?: string): Promise<void>;
}
\`\`\`

## Integration Rules

1. Keep the state machine pure and covered by unit tests before wiring browser APIs.
2. Store current call state in both React state and a ref read by async signaling handlers.
3. Include callId, from, to, and event type in every signaling payload.
4. Never create an offer/answer unless the current state allows that transition.
5. Use a viewport-fixed overlay for active calls and incoming call prompts; do not bury it inside chat scroll layout.
6. Always stop local tracks on reject, end, remote hangup, and component unmount.
7. In Vite HTTPS development, configure WSS proxy TLS explicitly.

## Verification Checklist

- State-machine unit tests cover idle, ringing, connecting, active, ending, failed.
- Media tests cover permission denial and fallback without losing call direction.
- Adapter tests cover offer, answer, ICE, hangup, reconnect, duplicate event handling.
- React tests cover incoming prompt, outgoing ring, accept, reject, end, cleanup.
- Playwright E2E opens two tabs, completes a call, verifies both local/remote video elements receive streams, then hangs up.
`;

export const VIDEO_CALL_WEBRTC_MODULE: MwhModule = {
  id: "video-call-webrtc",
  title: "WebRTC Video Call Middleware",
  summary:
    "Reusable middleware reference for browser video calls, signaling, media fallback, and React call UI.",
  version: "0.1.0",
  tags: ["webrtc", "video-call", "socket.io", "react", "middleware"],
  source: { kind: "builtin", label: "Carbon Code built-in" },
  content: CONTENT,
};
