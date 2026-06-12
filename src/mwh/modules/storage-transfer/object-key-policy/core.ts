export interface ObjectKeyPolicy {
  maxKeyBytes: number;
  tenantPrefixTemplate: "{tenantId}" | "tenants/{tenantId}";
  allowedExtensions?: readonly string[];
  deniedSegments?: readonly string[];
}

export interface NormalizedObjectKey {
  tenantId: string;
  relativeKey: string;
  objectKey: string;
  extension?: string;
}

export function normalizeRelativeObjectKey(rawKey: string): string {
  assertNonEmpty(rawKey, "rawKey");
  const normalized = rawKey
    .replaceAll("\\", "/")
    .split("/")
    .map((segment) => segment.trim())
    .filter(Boolean)
    .join("/");

  if (!normalized) throw new Error("object key is empty");
  if (normalized.startsWith("/") || /^[a-zA-Z]:/.test(normalized)) {
    throw new Error("absolute object keys are not allowed");
  }
  if (hasControlCharacter(normalized)) {
    throw new Error("object key contains control characters");
  }
  return normalized;
}

export function buildTenantObjectKey(input: {
  tenantId: string;
  rawKey: string;
  policy: ObjectKeyPolicy;
}): NormalizedObjectKey {
  assertTenantId(input.tenantId);
  assertPolicy(input.policy);
  const relativeKey = normalizeRelativeObjectKey(input.rawKey);
  assertSafeSegments(relativeKey, input.policy);
  assertAllowedExtension(relativeKey, input.policy);
  const prefix = renderTenantPrefix(input.tenantId, input.policy.tenantPrefixTemplate);
  const objectKey = `${prefix}/${relativeKey}`;
  if (byteLength(objectKey) > input.policy.maxKeyBytes) {
    throw new Error("object key exceeds maxKeyBytes");
  }
  return {
    tenantId: input.tenantId,
    relativeKey,
    objectKey,
    extension: extensionOf(relativeKey),
  };
}

export function objectKeyBelongsToTenant(input: {
  tenantId: string;
  objectKey: string;
  policy: ObjectKeyPolicy;
}): boolean {
  assertTenantId(input.tenantId);
  assertPolicy(input.policy);
  const prefix = `${renderTenantPrefix(input.tenantId, input.policy.tenantPrefixTemplate)}/`;
  return input.objectKey.startsWith(prefix) && input.objectKey.length > prefix.length;
}

export function splitTenantObjectKey(input: {
  tenantId: string;
  objectKey: string;
  policy: ObjectKeyPolicy;
}): NormalizedObjectKey {
  if (!objectKeyBelongsToTenant(input)) throw new Error("object key is outside tenant prefix");
  const prefix = `${renderTenantPrefix(input.tenantId, input.policy.tenantPrefixTemplate)}/`;
  const relativeKey = input.objectKey.slice(prefix.length);
  assertSafeSegments(relativeKey, input.policy);
  assertAllowedExtension(relativeKey, input.policy);
  return {
    tenantId: input.tenantId,
    relativeKey,
    objectKey: input.objectKey,
    extension: extensionOf(relativeKey),
  };
}

function renderTenantPrefix(
  tenantId: string,
  template: ObjectKeyPolicy["tenantPrefixTemplate"],
): string {
  return template.replace("{tenantId}", tenantId);
}

function assertSafeSegments(relativeKey: string, policy: ObjectKeyPolicy): void {
  const denied = new Set([".", "..", ...(policy.deniedSegments ?? [])]);
  for (const segment of relativeKey.split("/")) {
    if (denied.has(segment)) throw new Error(`denied object key segment: ${segment}`);
    if (segment.includes("..")) throw new Error("object key segment cannot contain traversal");
  }
}

function assertAllowedExtension(relativeKey: string, policy: ObjectKeyPolicy): void {
  if (!policy.allowedExtensions?.length) return;
  const extension = extensionOf(relativeKey);
  const allowed = new Set(policy.allowedExtensions.map(normalizeExtension));
  if (!extension || !allowed.has(extension)) {
    throw new Error("object key extension is not allowed");
  }
}

function extensionOf(relativeKey: string): string | undefined {
  const lastSegment = relativeKey.split("/").at(-1) ?? "";
  const dotIndex = lastSegment.lastIndexOf(".");
  if (dotIndex <= 0 || dotIndex === lastSegment.length - 1) return undefined;
  return normalizeExtension(lastSegment.slice(dotIndex + 1));
}

function normalizeExtension(extension: string): string {
  return extension.trim().replace(/^\./, "").toLowerCase();
}

function assertPolicy(policy: ObjectKeyPolicy): void {
  assertPositiveInteger(policy.maxKeyBytes, "maxKeyBytes");
  if (
    policy.tenantPrefixTemplate !== "{tenantId}" &&
    policy.tenantPrefixTemplate !== "tenants/{tenantId}"
  ) {
    throw new Error("unsupported tenantPrefixTemplate");
  }
}

function assertTenantId(tenantId: string): void {
  assertNonEmpty(tenantId, "tenantId");
  if (!/^[a-zA-Z0-9_-]+$/.test(tenantId)) {
    throw new Error("tenantId must be url-safe");
  }
}

function assertNonEmpty(value: string, name: string): void {
  if (!value.trim()) throw new Error(`${name} is required`);
}

function assertPositiveInteger(value: number, name: string): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
}

function byteLength(value: string): number {
  return Buffer.byteLength(value, "utf8");
}

function hasControlCharacter(value: string): boolean {
  return [...value].some((char) => {
    const code = char.charCodeAt(0);
    return code <= 31 || code === 127;
  });
}
