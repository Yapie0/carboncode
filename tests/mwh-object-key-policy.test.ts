import { describe, expect, it } from "vitest";
import {
  type ObjectKeyPolicy,
  buildTenantObjectKey,
  normalizeRelativeObjectKey,
  objectKeyBelongsToTenant,
  splitTenantObjectKey,
} from "../src/mwh/modules/storage-transfer/object-key-policy/core.js";
import { MemoryObjectKeyPolicyStore } from "../src/mwh/modules/storage-transfer/object-key-policy/memory-store.js";

const policy: ObjectKeyPolicy = {
  maxKeyBytes: 128,
  tenantPrefixTemplate: "tenants/{tenantId}",
  allowedExtensions: ["png", ".jpg"],
  deniedSegments: ["private"],
};

describe("object-key-policy MWH module", () => {
  it("normalizes relative keys and builds tenant-scoped object keys", () => {
    expect(normalizeRelativeObjectKey(" avatars\\2026\\me.PNG ")).toBe("avatars/2026/me.PNG");

    expect(
      buildTenantObjectKey({
        tenantId: "tenant_a",
        rawKey: " avatars\\2026\\me.PNG ",
        policy,
      }),
    ).toEqual({
      tenantId: "tenant_a",
      relativeKey: "avatars/2026/me.PNG",
      objectKey: "tenants/tenant_a/avatars/2026/me.PNG",
      extension: "png",
    });
  });

  it("rejects traversal, absolute paths, denied segments, unsupported extensions, and long keys", () => {
    expect(() => normalizeRelativeObjectKey("C:\\temp\\avatar.png")).toThrow(
      "absolute object keys are not allowed",
    );
    expect(() =>
      buildTenantObjectKey({ tenantId: "tenant-a", rawKey: "../avatar.png", policy }),
    ).toThrow("denied object key segment: ..");
    expect(() =>
      buildTenantObjectKey({ tenantId: "tenant-a", rawKey: "private/avatar.png", policy }),
    ).toThrow("denied object key segment: private");
    expect(() =>
      buildTenantObjectKey({ tenantId: "tenant-a", rawKey: "avatar.gif", policy }),
    ).toThrow("object key extension is not allowed");
    expect(() =>
      buildTenantObjectKey({
        tenantId: "tenant-a",
        rawKey: `${"a".repeat(120)}.png`,
        policy,
      }),
    ).toThrow("object key exceeds maxKeyBytes");
  });

  it("checks tenant ownership and parses tenant-relative keys", () => {
    const objectKey = "tenants/tenant-a/avatars/me.jpg";

    expect(objectKeyBelongsToTenant({ tenantId: "tenant-a", objectKey, policy })).toBe(true);
    expect(objectKeyBelongsToTenant({ tenantId: "tenant-b", objectKey, policy })).toBe(false);
    expect(splitTenantObjectKey({ tenantId: "tenant-a", objectKey, policy })).toEqual({
      tenantId: "tenant-a",
      relativeKey: "avatars/me.jpg",
      objectKey,
      extension: "jpg",
    });
    expect(() => splitTenantObjectKey({ tenantId: "tenant-b", objectKey, policy })).toThrow(
      "object key is outside tenant prefix",
    );
  });

  it("authorizes writes and reads through a clone-safe in-memory policy store", () => {
    const store = new MemoryObjectKeyPolicyStore();
    store.registerTenant({
      tenantId: "tenant-a",
      policy,
      allowedContentTypes: ["image/png", "image/jpeg"],
      maxObjectBytes: 1000,
    });

    const leakedPolicies = store.listTenantPolicies();
    leakedPolicies[0]!.policy.allowedExtensions = ["gif"];

    expect(
      store.authorizeWrite({
        tenantId: "tenant-a",
        rawKey: "avatars/me.png",
        contentType: "image/png",
        sizeBytes: 999,
      }),
    ).toEqual({
      tenantId: "tenant-a",
      relativeKey: "avatars/me.png",
      objectKey: "tenants/tenant-a/avatars/me.png",
      extension: "png",
      contentType: "image/png",
      sizeBytes: 999,
    });

    expect(
      store.authorizeRead({
        tenantId: "tenant-a",
        objectKey: "tenants/tenant-a/avatars/me.jpg",
      }).relativeKey,
    ).toBe("avatars/me.jpg");
    expect(
      store.belongsToTenant({ tenantId: "tenant-a", objectKey: "tenants/tenant-a/a.png" }),
    ).toBe(true);
  });

  it("rejects stateful writes with unknown tenants, content-type mismatch, or oversized objects", () => {
    const store = new MemoryObjectKeyPolicyStore();
    store.registerTenant({
      tenantId: "tenant-a",
      policy,
      allowedContentTypes: ["image/png"],
      maxObjectBytes: 1000,
    });

    expect(() =>
      store.authorizeWrite({
        tenantId: "tenant-b",
        rawKey: "avatars/me.png",
        contentType: "image/png",
        sizeBytes: 100,
      }),
    ).toThrow("tenant policy not found");
    expect(() =>
      store.authorizeWrite({
        tenantId: "tenant-a",
        rawKey: "avatars/me.png",
        contentType: "image/jpeg",
        sizeBytes: 100,
      }),
    ).toThrow("contentType is not allowed");
    expect(() =>
      store.authorizeWrite({
        tenantId: "tenant-a",
        rawKey: "avatars/me.png",
        contentType: "image/png",
        sizeBytes: 1001,
      }),
    ).toThrow("object exceeds maxObjectBytes");
  });
});
