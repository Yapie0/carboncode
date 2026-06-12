import {
  type RbacDecision,
  type RbacPolicy,
  type RbacRequest,
  evaluateRbacPolicies,
  expandRolePolicies,
  validatePolicy,
} from "./core.js";

export interface RoleDefinition {
  id: string;
  policies: readonly RbacPolicy[];
  inherits?: readonly string[];
}

export class MemoryRbacPolicyStore {
  private readonly roles = new Map<string, RoleDefinition>();
  private readonly subjectRoles = new Map<string, Set<string>>();

  upsertRole(role: RoleDefinition): RoleDefinition {
    assertNonEmpty(role.id, "role.id");
    for (const policy of role.policies) validatePolicy(policy);
    for (const inherited of role.inherits ?? []) assertNonEmpty(inherited, "role.inherits[]");
    const next = cloneRole(role);
    const probe = new Map(this.roles);
    probe.set(role.id, next);
    expandRolePolicies(probe, [role.id]);
    this.roles.set(role.id, next);
    return cloneRole(next);
  }

  assignRole(subjectId: string, roleId: string): void {
    assertNonEmpty(subjectId, "subjectId");
    assertNonEmpty(roleId, "roleId");
    if (!this.roles.has(roleId)) throw new Error(`unknown role: ${roleId}`);
    const roles = this.subjectRoles.get(subjectId) ?? new Set<string>();
    roles.add(roleId);
    this.subjectRoles.set(subjectId, roles);
  }

  revokeRole(subjectId: string, roleId: string): boolean {
    const roles = this.subjectRoles.get(subjectId);
    if (!roles) return false;
    const removed = roles.delete(roleId);
    if (roles.size === 0) this.subjectRoles.delete(subjectId);
    return removed;
  }

  authorize(subjectId: string, request: RbacRequest): RbacDecision {
    const policies = this.policiesForSubject(subjectId);
    return evaluateRbacPolicies(policies, request);
  }

  policiesForSubject(subjectId: string): RbacPolicy[] {
    const roleIds = this.subjectRoles.get(subjectId);
    if (!roleIds) return [];
    return expandRolePolicies(this.roles, [...roleIds]).map(clonePolicy);
  }

  listRoles(): RoleDefinition[] {
    return [...this.roles.values()].map(cloneRole);
  }
}

function cloneRole(role: RoleDefinition): RoleDefinition {
  return {
    id: role.id,
    policies: role.policies.map(clonePolicy),
    inherits: role.inherits ? [...role.inherits] : undefined,
  };
}

function clonePolicy(policy: RbacPolicy): RbacPolicy {
  return {
    ...policy,
    actions: [...policy.actions],
    resources: [...policy.resources],
    conditions: policy.conditions ? { ...policy.conditions } : undefined,
  };
}

function assertNonEmpty(value: string, name: string): void {
  if (!value.trim()) throw new Error(`${name} is required`);
}
