import {
  type HeaderPolicy,
  type HeaderPolicyDecision,
  type HeaderPolicyRequest,
  evaluateRequestHeaders,
} from "./core.js";

export interface HeaderPolicyAuditEntry {
  atMs: number;
  request: HeaderPolicyRequest;
  decision: HeaderPolicyDecision;
}

export interface MemoryRequestHeaderPolicyOptions {
  policies: readonly HeaderPolicy[];
  now?: () => number;
}

export class MemoryRequestHeaderPolicy {
  private policies: Map<string, HeaderPolicy>;
  private readonly now: () => number;
  private readonly audit: HeaderPolicyAuditEntry[] = [];

  constructor(options: MemoryRequestHeaderPolicyOptions) {
    this.policies = new Map(
      options.policies.map((policy) => [policy.routeId, clonePolicy(policy)]),
    );
    this.now = options.now ?? Date.now;
  }

  evaluate(request: HeaderPolicyRequest): HeaderPolicyDecision {
    const policy = this.policies.get(request.routeId);
    if (!policy) throw new Error("route policy not found");
    const decision = evaluateRequestHeaders(policy, request);
    this.audit.push({
      atMs: this.now(),
      request: cloneRequest(request),
      decision: { ...decision },
    });
    return decision;
  }

  upsertPolicy(policy: HeaderPolicy): void {
    this.policies.set(policy.routeId, clonePolicy(policy));
  }

  listPolicies(): HeaderPolicy[] {
    return [...this.policies.values()].map(clonePolicy);
  }

  listAudit(): HeaderPolicyAuditEntry[] {
    return this.audit.map((entry) => ({
      atMs: entry.atMs,
      request: cloneRequest(entry.request),
      decision: { ...entry.decision },
    }));
  }
}

function clonePolicy(policy: HeaderPolicy): HeaderPolicy {
  return {
    ...policy,
    requiredHeaders: policy.requiredHeaders?.map((rule) => ({
      ...rule,
      oneOf: rule.oneOf ? [...rule.oneOf] : undefined,
    })),
    allowedHeaderNames: policy.allowedHeaderNames ? [...policy.allowedHeaderNames] : undefined,
    blockedHeaderNames: policy.blockedHeaderNames ? [...policy.blockedHeaderNames] : undefined,
  };
}

function cloneRequest(request: HeaderPolicyRequest): HeaderPolicyRequest {
  return {
    ...request,
    headers: Object.fromEntries(
      Object.entries(request.headers).map(([name, value]) => [
        name,
        Array.isArray(value) ? [...value] : value,
      ]),
    ),
  };
}
