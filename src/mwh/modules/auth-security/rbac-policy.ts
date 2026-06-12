import type { MwhModule } from "../../types.js";

const CONTENT = `# MWH Module: RBAC Policy Middleware

## Purpose

Use this module as a reusable reference when building role-based access control, admin permissions, tenant-scoped authorization, resource action checks, or policy-backed route guards.

The module contains pure RBAC policy evaluation plus a deterministic memory store for tests. Production adapters can store roles and bindings in SQL, directory services, identity providers, config files, or policy services while reusing the same deny-first decision rules.

## When To Use

- Authorize user actions against resource identifiers.
- Model admin, maintainer, viewer, and service roles.
- Apply tenant or environment conditions to policies.
- Keep authorization decisions testable outside HTTP frameworks.

## When Not To Use

- Do not use RBAC alone for complex relationship-based authorization.
- Do not trust client-provided attributes without server validation.
- Do not hide deny rules after broad allow rules; deny must win.

## Recommended Architecture

- core.ts: pure wildcard matching, condition matching, policy validation, and deny-first evaluation.
- memory-store.ts: deterministic role store with role assignment, revocation, and authorization checks.
- adapters/sql.ts: durable role, policy, and subject-role mapping tables.
- middleware/http.ts: route guard that builds server-side authorization requests.
- audit.ts: decision logging with subject, action, resource, policy id, and reason.

## Public API Sketch

\`\`\`ts
const rbac = new MemoryRbacPolicyStore();
rbac.upsertRole({
  id: "tenant-admin",
  policies: [
    {
      id: "tenant-admin-write",
      effect: "allow",
      actions: ["project:*"],
      resources: ["tenant:tenant-1:*"],
      conditions: { tenantId: "tenant-1" },
    },
  ],
});
rbac.assignRole("user-1", "tenant-admin");

const decision = rbac.authorize("user-1", {
  action: "project:update",
  resource: "tenant:tenant-1:project:p1",
  attributes: { tenantId: "tenant-1" },
});
\`\`\`

## Integration Rules

1. Build authorization requests from server-side subject, action, resource, and attributes.
2. Evaluate explicit deny policies before allow policies.
3. Keep resource ids stable and namespaced.
4. Audit every denied privileged action.
5. Cache role assignments carefully and invalidate on permission changes.
6. Add relationship-based checks separately when ownership matters.

## Failure Modes

- Broad wildcard allow rules bypass narrower deny expectations if deny does not win.
- Client-controlled attributes produce privilege escalation.
- Role caches serve stale permissions after revocation.
- Resource naming drift makes policies silently fail open or fail closed.

## Security Notes

- Treat authorization as server-side only.
- Avoid logging secrets in resource ids or attributes.
- Prefer fail-closed decisions when role data is unavailable.

## Verification Checklist

- Stateless tests cover wildcard matching, condition matching, explicit allow, explicit deny, deny precedence, and no-match.
- Stateful tests cover role upsert, assignment, revocation, subject policy collection, authorization, and clone isolation.
- Adapter tests should verify cache invalidation and transactional role updates.
- HTTP guard tests should verify request construction uses trusted server data.

## Source References

- AWS IAM-style deny precedence and wildcard action/resource matching.
- Kubernetes RBAC role and binding separation.
- Casbin-style policy evaluation concepts.
`;

export const RBAC_POLICY_MODULE: MwhModule = {
  id: "rbac-policy",
  title: "RBAC Policy Middleware",
  summary:
    "Reusable role-based access control reference with deny-first policy evaluation, conditions, role bindings, and stateful tests.",
  version: "0.1.0",
  tags: ["auth-security", "rbac", "authorization", "policy", "middleware"],
  source: { kind: "builtin", label: "Carbon Code built-in" },
  content: CONTENT,
};
