import {
  type BodyGuardDecision,
  type BodyGuardPolicy,
  type BodyGuardRequest,
  type BodyGuardStreamState,
  appendBodyChunk,
  createBodyStreamState,
  evaluateRequestBody,
  finalizeBodyStream,
} from "./core.js";

export interface BodyGuardAuditEntry {
  atMs: number;
  request: BodyGuardRequest;
  decision: BodyGuardDecision;
}

export interface MemoryRequestBodyGuardOptions {
  policies: readonly BodyGuardPolicy[];
  now?: () => number;
}

export class MemoryRequestBodyGuard {
  private policies: Map<string, BodyGuardPolicy>;
  private readonly now: () => number;
  private readonly audit: BodyGuardAuditEntry[] = [];
  private readonly streams = new Map<string, BodyGuardStreamState>();

  constructor(options: MemoryRequestBodyGuardOptions) {
    this.policies = new Map(
      options.policies.map((policy) => [policy.routeId, clonePolicy(policy)]),
    );
    this.now = options.now ?? Date.now;
  }

  evaluate(request: BodyGuardRequest): BodyGuardDecision {
    const policy = this.policies.get(request.routeId);
    if (!policy) throw new Error("route policy not found");
    const decision = evaluateRequestBody(policy, request);
    this.audit.push({
      atMs: this.now(),
      request: { ...request },
      decision: { ...decision },
    });
    return decision;
  }

  upsertPolicy(policy: BodyGuardPolicy): void {
    this.policies.set(policy.routeId, clonePolicy(policy));
  }

  startStream(sessionId: string, request: Pick<BodyGuardRequest, "routeId" | "contentType">): void {
    assertNonEmpty(sessionId, "sessionId");
    if (!this.policies.has(request.routeId)) throw new Error("route policy not found");
    this.streams.set(sessionId, createBodyStreamState(request));
  }

  appendStream(sessionId: string, chunk: string): BodyGuardDecision | undefined {
    const state = this.streams.get(sessionId);
    if (!state) throw new Error("stream session not found");
    const policy = this.policies.get(state.routeId);
    if (!policy) throw new Error("route policy not found");
    const result = appendBodyChunk(policy, state, chunk);
    this.streams.set(sessionId, result.state);
    return result.decision;
  }

  finalizeStream(sessionId: string): BodyGuardDecision {
    const state = this.streams.get(sessionId);
    if (!state) throw new Error("stream session not found");
    const policy = this.policies.get(state.routeId);
    if (!policy) throw new Error("route policy not found");
    const decision = finalizeBodyStream(policy, state);
    this.streams.delete(sessionId);
    this.audit.push({
      atMs: this.now(),
      request: {
        routeId: state.routeId,
        contentType: state.contentType,
        contentLengthBytes: state.receivedBytes,
        body: state.body,
      },
      decision: { ...decision },
    });
    return decision;
  }

  listPolicies(): BodyGuardPolicy[] {
    return [...this.policies.values()].map(clonePolicy);
  }

  listAudit(): BodyGuardAuditEntry[] {
    return this.audit.map((entry) => ({
      atMs: entry.atMs,
      request: { ...entry.request },
      decision: { ...entry.decision },
    }));
  }
}

function clonePolicy(policy: BodyGuardPolicy): BodyGuardPolicy {
  return {
    ...policy,
    allowedContentTypes: [...policy.allowedContentTypes],
  };
}

function assertNonEmpty(value: string, name: string): void {
  if (!value.trim()) throw new Error(`${name} is required`);
}
