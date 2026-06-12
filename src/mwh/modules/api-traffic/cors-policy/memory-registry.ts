import {
  type CorsDecision,
  type CorsHttpRequestLike,
  type CorsPolicy,
  type CorsRequest,
  corsRequestFromHttp,
  evaluateCorsRequest,
  mergeCorsPolicies,
  normalizeCorsPolicy,
} from "./core.js";

export class MemoryCorsPolicyRegistry {
  private readonly policies = new Map<string, CorsPolicy>();
  private readonly decisions: CorsDecision[] = [];

  register(policy: CorsPolicy): CorsPolicy {
    const normalized = normalizeCorsPolicy(policy);
    this.policies.set(normalized.routeId, normalized);
    return clonePolicy(normalized);
  }

  evaluate(request: CorsRequest): CorsDecision {
    const policy = this.policies.get(request.routeId);
    if (!policy) {
      const decision: CorsDecision = {
        kind: "reject",
        routeId: request.routeId,
        statusCode: 404,
        reason: "route-mismatch",
        headers: { vary: "Origin" },
      };
      this.decisions.push({ ...decision, headers: { ...decision.headers } });
      return decision;
    }
    const decision = evaluateCorsRequest(policy, request);
    this.decisions.push({ ...decision, headers: { ...decision.headers } });
    return decision;
  }

  evaluateHttp(input: CorsHttpRequestLike): CorsDecision {
    return this.evaluate(corsRequestFromHttp(input));
  }

  extend(routeId: string, override: Partial<CorsPolicy>): CorsPolicy {
    const base = this.policies.get(routeId);
    if (!base) throw new Error("CORS policy not found");
    const merged = mergeCorsPolicies(base, override);
    this.policies.set(merged.routeId, merged);
    return clonePolicy(merged);
  }

  remove(routeId: string): boolean {
    return this.policies.delete(routeId);
  }

  get(routeId: string): CorsPolicy | undefined {
    const policy = this.policies.get(routeId);
    return policy ? clonePolicy(policy) : undefined;
  }

  list(): CorsPolicy[] {
    return [...this.policies.values()]
      .sort((left, right) => left.routeId.localeCompare(right.routeId))
      .map(clonePolicy);
  }

  decisionHistory(): CorsDecision[] {
    return this.decisions.map((decision) => ({
      ...decision,
      headers: { ...decision.headers },
    }));
  }
}

function clonePolicy(policy: CorsPolicy): CorsPolicy {
  return {
    ...policy,
    allowedOrigins: [...policy.allowedOrigins],
    allowedMethods: [...policy.allowedMethods],
    allowedHeaders: [...policy.allowedHeaders],
    exposedHeaders: policy.exposedHeaders ? [...policy.exposedHeaders] : undefined,
  };
}
