import {
  type TrafficPolicy,
  type TrafficRouteDecision,
  type TrafficRouteRequest,
  cloneTrafficEndpoint,
  cloneTrafficPolicy,
  createTrafficPolicy,
  routeTraffic,
  updateTrafficEndpointStatus,
} from "./core.js";

export interface MemoryTrafficPolicyRouterOptions {
  now?: () => number;
}

export class MemoryTrafficPolicyRouter {
  private readonly now: () => number;
  private readonly policies = new Map<string, TrafficPolicy>();
  private readonly decisions: TrafficRouteDecision[] = [];

  constructor(opts: MemoryTrafficPolicyRouterOptions = {}) {
    this.now = opts.now ?? Date.now;
  }

  upsertPolicy(input: Parameters<typeof createTrafficPolicy>[0]): TrafficPolicy {
    const policy = createTrafficPolicy(input);
    this.policies.set(policy.serviceName, policy);
    return cloneTrafficPolicy(policy);
  }

  route(request: TrafficRouteRequest): TrafficRouteDecision | null {
    const policy = this.policies.get(request.serviceName);
    if (!policy) return null;
    const decision = routeTraffic(policy, request, { nowMs: this.now() });
    const stored = cloneTrafficDecision(decision);
    this.decisions.push(stored);
    return cloneTrafficDecision(stored);
  }

  updateEndpointStatus(input: {
    serviceName: string;
    endpointId: string;
    status: "healthy" | "degraded" | "unhealthy";
  }): TrafficPolicy | null {
    const policy = this.policies.get(input.serviceName);
    if (!policy) return null;
    const next = updateTrafficEndpointStatus(policy, input);
    this.policies.set(input.serviceName, next);
    return cloneTrafficPolicy(next);
  }

  getPolicy(serviceName: string): TrafficPolicy | null {
    const policy = this.policies.get(serviceName);
    return policy ? cloneTrafficPolicy(policy) : null;
  }

  listPolicies(): TrafficPolicy[] {
    return [...this.policies.values()]
      .map(cloneTrafficPolicy)
      .sort((a, b) => a.serviceName.localeCompare(b.serviceName));
  }

  listDecisions(): TrafficRouteDecision[] {
    return this.decisions.map(cloneTrafficDecision);
  }
}

function cloneTrafficDecision(decision: TrafficRouteDecision): TrafficRouteDecision {
  return {
    ...decision,
    endpoint: decision.endpoint ? cloneTrafficEndpoint(decision.endpoint) : null,
  };
}
