import {
  type NormalizedObjectKey,
  type ObjectKeyPolicy,
  buildTenantObjectKey,
  objectKeyBelongsToTenant,
  splitTenantObjectKey,
} from "./core.js";

export interface TenantObjectPolicy {
  tenantId: string;
  policy: ObjectKeyPolicy;
  allowedContentTypes?: readonly string[];
  maxObjectBytes?: number;
}

export interface AuthorizedObjectKey extends NormalizedObjectKey {
  contentType: string;
  sizeBytes: number;
}

export class MemoryObjectKeyPolicyStore {
  private tenants = new Map<string, TenantObjectPolicy>();

  registerTenant(input: TenantObjectPolicy): void {
    if (this.tenants.has(input.tenantId)) throw new Error("tenant policy already exists");
    this.tenants.set(input.tenantId, cloneTenantPolicy(input));
  }

  authorizeWrite(input: {
    tenantId: string;
    rawKey: string;
    contentType: string;
    sizeBytes: number;
  }): AuthorizedObjectKey {
    const tenant = this.requireTenant(input.tenantId);
    assertAllowedContentType(input.contentType, tenant.allowedContentTypes);
    assertSize(input.sizeBytes, tenant.maxObjectBytes);
    return {
      ...buildTenantObjectKey({
        tenantId: input.tenantId,
        rawKey: input.rawKey,
        policy: tenant.policy,
      }),
      contentType: input.contentType,
      sizeBytes: input.sizeBytes,
    };
  }

  authorizeRead(input: { tenantId: string; objectKey: string }): NormalizedObjectKey {
    const tenant = this.requireTenant(input.tenantId);
    return splitTenantObjectKey({
      tenantId: input.tenantId,
      objectKey: input.objectKey,
      policy: tenant.policy,
    });
  }

  belongsToTenant(input: { tenantId: string; objectKey: string }): boolean {
    const tenant = this.requireTenant(input.tenantId);
    return objectKeyBelongsToTenant({
      tenantId: input.tenantId,
      objectKey: input.objectKey,
      policy: tenant.policy,
    });
  }

  listTenantPolicies(): TenantObjectPolicy[] {
    return [...this.tenants.values()].map(cloneTenantPolicy);
  }

  private requireTenant(tenantId: string): TenantObjectPolicy {
    const tenant = this.tenants.get(tenantId);
    if (!tenant) throw new Error("tenant policy not found");
    return cloneTenantPolicy(tenant);
  }
}

function assertAllowedContentType(
  contentType: string,
  allowedContentTypes: readonly string[] | undefined,
): void {
  if (!contentType.trim()) throw new Error("contentType is required");
  if (!allowedContentTypes?.length) return;
  if (!allowedContentTypes.includes(contentType)) {
    throw new Error("contentType is not allowed");
  }
}

function assertSize(sizeBytes: number, maxObjectBytes: number | undefined): void {
  if (!Number.isInteger(sizeBytes) || sizeBytes <= 0) {
    throw new Error("sizeBytes must be a positive integer");
  }
  if (maxObjectBytes !== undefined && sizeBytes > maxObjectBytes) {
    throw new Error("object exceeds maxObjectBytes");
  }
}

function cloneTenantPolicy(policy: TenantObjectPolicy): TenantObjectPolicy {
  return {
    tenantId: policy.tenantId,
    policy: {
      ...policy.policy,
      allowedExtensions: policy.policy.allowedExtensions
        ? [...policy.policy.allowedExtensions]
        : undefined,
      deniedSegments: policy.policy.deniedSegments ? [...policy.policy.deniedSegments] : undefined,
    },
    allowedContentTypes: policy.allowedContentTypes ? [...policy.allowedContentTypes] : undefined,
    maxObjectBytes: policy.maxObjectBytes,
  };
}
