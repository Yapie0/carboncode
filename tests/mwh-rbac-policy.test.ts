import { describe, expect, it } from "vitest";
import {
  conditionsMatch,
  evaluateRbacPolicies,
  expandRolePolicies,
  policyMatches,
  wildcardMatches,
} from "../src/mwh/modules/auth-security/rbac-policy/core.js";
import { MemoryRbacPolicyStore } from "../src/mwh/modules/auth-security/rbac-policy/memory-store.js";

describe("MWH rbac-policy middleware", () => {
  it("matches wildcards and conditions", () => {
    expect(wildcardMatches("project:*", "project:update")).toBe(true);
    expect(wildcardMatches("tenant:*:project:*", "tenant:t1:project:p1")).toBe(true);
    expect(wildcardMatches("project:read", "project:update")).toBe(false);
    expect(
      conditionsMatch({ tenantId: "t1", internal: true }, { tenantId: "t1", internal: true }),
    ).toBe(true);
    expect(conditionsMatch({ tenantId: "t1" }, { tenantId: "t2" })).toBe(false);
  });

  it("evaluates allow, deny, deny precedence, and no-match decisions", () => {
    const policies = [
      {
        id: "allow-project-write",
        effect: "allow" as const,
        actions: ["project:*"],
        resources: ["tenant:t1:project:*"],
      },
      {
        id: "deny-delete",
        effect: "deny" as const,
        actions: ["project:delete"],
        resources: ["tenant:t1:project:*"],
      },
    ];

    expect(
      evaluateRbacPolicies(policies, {
        action: "project:update",
        resource: "tenant:t1:project:p1",
      }),
    ).toEqual({
      allowed: true,
      effect: "allow",
      policyId: "allow-project-write",
      reason: "explicit-allow",
    });
    expect(
      evaluateRbacPolicies(policies, {
        action: "project:delete",
        resource: "tenant:t1:project:p1",
      }),
    ).toEqual({
      allowed: false,
      effect: "deny",
      policyId: "deny-delete",
      reason: "explicit-deny",
    });
    expect(
      evaluateRbacPolicies(policies, { action: "billing:read", resource: "tenant:t1" }),
    ).toEqual({
      allowed: false,
      effect: "none",
      reason: "no-match",
    });
  });

  it("checks individual policy matches with trusted attributes", () => {
    const policy = {
      id: "tenant-admin",
      effect: "allow" as const,
      actions: ["project:*"],
      resources: ["tenant:t1:*"],
      conditions: { tenantId: "t1" },
    };

    expect(
      policyMatches(policy, {
        action: "project:update",
        resource: "tenant:t1:project:p1",
        attributes: { tenantId: "t1" },
      }),
    ).toBe(true);
    expect(
      policyMatches(policy, {
        action: "project:update",
        resource: "tenant:t1:project:p1",
        attributes: { tenantId: "t2" },
      }),
    ).toBe(false);
  });

  it("expands inherited role policies and rejects inheritance cycles", () => {
    const roles = new Map([
      [
        "viewer",
        {
          id: "viewer",
          policies: [
            {
              id: "allow-read",
              effect: "allow" as const,
              actions: ["project:read"],
              resources: ["tenant:t1:project:*"],
            },
          ],
        },
      ],
      [
        "editor",
        {
          id: "editor",
          inherits: ["viewer"],
          policies: [
            {
              id: "allow-write",
              effect: "allow" as const,
              actions: ["project:update"],
              resources: ["tenant:t1:project:*"],
            },
          ],
        },
      ],
    ]);

    expect(expandRolePolicies(roles, ["editor"]).map((policy) => policy.id)).toEqual([
      "allow-read",
      "allow-write",
    ]);

    expect(() =>
      expandRolePolicies(
        new Map([
          ["a", { id: "a", inherits: ["b"], policies: [] }],
          ["b", { id: "b", inherits: ["a"], policies: [] }],
        ]),
        ["a"],
      ),
    ).toThrow("role inheritance cycle");
  });

  it("runs a stateful role upsert, assignment, authorization, revocation, and clone flow", () => {
    const store = new MemoryRbacPolicyStore();
    const role = store.upsertRole({
      id: "tenant-admin",
      policies: [
        {
          id: "allow-write",
          effect: "allow",
          actions: ["project:*"],
          resources: ["tenant:t1:project:*"],
          conditions: { tenantId: "t1" },
        },
        {
          id: "deny-delete",
          effect: "deny",
          actions: ["project:delete"],
          resources: ["tenant:t1:project:*"],
        },
      ],
    });
    role.policies[0]!.actions = ["mutated"];

    store.assignRole("user-1", "tenant-admin");
    expect(
      store.authorize("user-1", {
        action: "project:update",
        resource: "tenant:t1:project:p1",
        attributes: { tenantId: "t1" },
      }),
    ).toEqual(expect.objectContaining({ allowed: true, policyId: "allow-write" }));
    expect(
      store.authorize("user-1", {
        action: "project:delete",
        resource: "tenant:t1:project:p1",
        attributes: { tenantId: "t1" },
      }),
    ).toEqual(expect.objectContaining({ allowed: false, policyId: "deny-delete" }));
    expect(store.policiesForSubject("user-1")[0]?.actions).toEqual(["project:*"]);
    expect(store.revokeRole("user-1", "tenant-admin")).toBe(true);
    expect(
      store.authorize("user-1", { action: "project:update", resource: "tenant:t1:project:p1" }),
    ).toEqual({
      allowed: false,
      effect: "none",
      reason: "no-match",
    });
  });

  it("runs stateful inherited-role authorization with inherited deny precedence", () => {
    const store = new MemoryRbacPolicyStore();
    store.upsertRole({
      id: "viewer",
      policies: [
        {
          id: "allow-read",
          effect: "allow",
          actions: ["project:read"],
          resources: ["tenant:t1:project:*"],
        },
        {
          id: "deny-secret-read",
          effect: "deny",
          actions: ["project:read"],
          resources: ["tenant:t1:project:secret"],
        },
      ],
    });
    store.upsertRole({
      id: "editor",
      inherits: ["viewer"],
      policies: [
        {
          id: "allow-update",
          effect: "allow",
          actions: ["project:update"],
          resources: ["tenant:t1:project:*"],
        },
      ],
    });

    store.assignRole("user-2", "editor");
    expect(
      store.authorize("user-2", {
        action: "project:read",
        resource: "tenant:t1:project:p1",
      }),
    ).toEqual(expect.objectContaining({ allowed: true, policyId: "allow-read" }));
    expect(
      store.authorize("user-2", {
        action: "project:read",
        resource: "tenant:t1:project:secret",
      }),
    ).toEqual(expect.objectContaining({ allowed: false, policyId: "deny-secret-read" }));

    expect(() => store.upsertRole({ id: "viewer", inherits: ["editor"], policies: [] })).toThrow(
      "role inheritance cycle",
    );
  });
});
