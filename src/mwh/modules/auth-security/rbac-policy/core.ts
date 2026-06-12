export type RbacEffect = "allow" | "deny";

export interface RbacPolicy {
  id: string;
  effect: RbacEffect;
  actions: readonly string[];
  resources: readonly string[];
  conditions?: Record<string, string | number | boolean>;
}

export interface RbacRequest {
  action: string;
  resource: string;
  attributes?: Record<string, string | number | boolean | undefined>;
}

export interface RbacDecision {
  allowed: boolean;
  effect: RbacEffect | "none";
  policyId?: string;
  reason: "explicit-deny" | "explicit-allow" | "no-match";
}

export interface RbacRoleGraphNode {
  id: string;
  policies: readonly RbacPolicy[];
  inherits?: readonly string[];
}

export function evaluateRbacPolicies(
  policies: readonly RbacPolicy[],
  request: RbacRequest,
): RbacDecision {
  assertNonEmpty(request.action, "action");
  assertNonEmpty(request.resource, "resource");
  const matches = policies.filter((policy) => policyMatches(policy, request));
  const deny = matches.find((policy) => policy.effect === "deny");
  if (deny) {
    return {
      allowed: false,
      effect: "deny",
      policyId: deny.id,
      reason: "explicit-deny",
    };
  }
  const allow = matches.find((policy) => policy.effect === "allow");
  if (allow) {
    return {
      allowed: true,
      effect: "allow",
      policyId: allow.id,
      reason: "explicit-allow",
    };
  }
  return { allowed: false, effect: "none", reason: "no-match" };
}

export function policyMatches(policy: RbacPolicy, request: RbacRequest): boolean {
  validatePolicy(policy);
  return (
    policy.actions.some((pattern) => wildcardMatches(pattern, request.action)) &&
    policy.resources.some((pattern) => wildcardMatches(pattern, request.resource)) &&
    conditionsMatch(policy.conditions, request.attributes)
  );
}

export function expandRolePolicies(
  rolesById: ReadonlyMap<string, RbacRoleGraphNode>,
  roleIds: readonly string[],
): RbacPolicy[] {
  const expanded: RbacPolicy[] = [];
  const visiting = new Set<string>();
  const visited = new Set<string>();

  const visit = (roleId: string, path: readonly string[]): void => {
    assertNonEmpty(roleId, "roleId");
    if (visiting.has(roleId)) {
      throw new Error(`role inheritance cycle: ${[...path, roleId].join(" -> ")}`);
    }
    if (visited.has(roleId)) return;
    const role = rolesById.get(roleId);
    if (!role) throw new Error(`unknown role: ${roleId}`);
    visiting.add(roleId);
    for (const inherited of role.inherits ?? []) visit(inherited, [...path, roleId]);
    for (const policy of role.policies) {
      validatePolicy(policy);
      expanded.push(clonePolicy(policy));
    }
    visiting.delete(roleId);
    visited.add(roleId);
  };

  for (const roleId of roleIds) visit(roleId, []);
  return expanded;
}

export function wildcardMatches(pattern: string, value: string): boolean {
  assertNonEmpty(pattern, "pattern");
  assertNonEmpty(value, "value");
  if (pattern === "*") return true;
  const escaped = pattern
    .split("*")
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
    .join(".*");
  return new RegExp(`^${escaped}$`).test(value);
}

export function conditionsMatch(
  conditions: RbacPolicy["conditions"],
  attributes: RbacRequest["attributes"],
): boolean {
  if (!conditions) return true;
  for (const [key, expected] of Object.entries(conditions)) {
    if (attributes?.[key] !== expected) return false;
  }
  return true;
}

export function validatePolicy(policy: RbacPolicy): void {
  assertNonEmpty(policy.id, "policy.id");
  if (policy.effect !== "allow" && policy.effect !== "deny") {
    throw new Error("policy.effect must be allow or deny");
  }
  if (!policy.actions.length) throw new Error("policy.actions is required");
  if (!policy.resources.length) throw new Error("policy.resources is required");
  for (const action of policy.actions) assertNonEmpty(action, "policy.actions[]");
  for (const resource of policy.resources) assertNonEmpty(resource, "policy.resources[]");
}

function assertNonEmpty(value: string, name: string): void {
  if (!value.trim()) throw new Error(`${name} is required`);
}

function clonePolicy(policy: RbacPolicy): RbacPolicy {
  return {
    ...policy,
    actions: [...policy.actions],
    resources: [...policy.resources],
    conditions: policy.conditions ? { ...policy.conditions } : undefined,
  };
}
