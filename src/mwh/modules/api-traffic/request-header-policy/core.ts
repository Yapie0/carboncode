export type HeaderPolicyDecisionKind = "allow" | "reject";
export type HeaderPolicyRejectReason =
  | "header-required"
  | "header-not-allowed"
  | "header-blocked"
  | "header-too-large"
  | "headers-too-large"
  | "header-value-mismatch";

export interface RequiredHeaderRule {
  name: string;
  equals?: string;
  oneOf?: readonly string[];
}

export interface HeaderPolicy {
  routeId: string;
  requiredHeaders?: readonly RequiredHeaderRule[];
  allowedHeaderNames?: readonly string[];
  blockedHeaderNames?: readonly string[];
  maxHeaderBytes?: number;
  maxTotalHeaderBytes?: number;
}

export interface HeaderPolicyRequest {
  routeId: string;
  headers: Record<string, string | readonly string[] | undefined>;
}

export interface NormalizedHeader {
  name: string;
  value: string;
  bytes: number;
}

export interface HeaderPolicyDecision {
  kind: HeaderPolicyDecisionKind;
  routeId: string;
  statusCode: number;
  reason?: HeaderPolicyRejectReason;
  headerName?: string;
  detail?: string;
}

export function evaluateRequestHeaders(
  policy: HeaderPolicy,
  request: HeaderPolicyRequest,
): HeaderPolicyDecision {
  assertPolicy(policy);
  assertNonEmpty(request.routeId, "routeId");
  if (policy.routeId !== request.routeId) {
    throw new Error("route policy mismatch");
  }

  const headers = normalizeHeaders(request.headers);
  const byName = new Map(headers.map((header) => [header.name, header]));
  const allowed = new Set(policy.allowedHeaderNames?.map(normalizeHeaderName));
  const blocked = new Set(policy.blockedHeaderNames?.map(normalizeHeaderName));

  for (const rule of policy.requiredHeaders ?? []) {
    const name = normalizeHeaderName(rule.name);
    const header = byName.get(name);
    if (!header)
      return reject(policy.routeId, 400, "header-required", name, "required header missing");
    if (rule.equals !== undefined && header.value !== rule.equals) {
      return reject(policy.routeId, 400, "header-value-mismatch", name, "required header mismatch");
    }
    if (rule.oneOf && !rule.oneOf.includes(header.value)) {
      return reject(policy.routeId, 400, "header-value-mismatch", name, "required header mismatch");
    }
  }

  for (const header of headers) {
    if (blocked.has(header.name)) {
      return reject(policy.routeId, 400, "header-blocked", header.name, "header is blocked");
    }
    if (allowed.size > 0 && !allowed.has(header.name)) {
      return reject(
        policy.routeId,
        400,
        "header-not-allowed",
        header.name,
        "header is not allowed",
      );
    }
    if (policy.maxHeaderBytes !== undefined && header.bytes > policy.maxHeaderBytes) {
      return reject(
        policy.routeId,
        431,
        "header-too-large",
        header.name,
        "header exceeds max size",
      );
    }
  }

  const totalBytes = headers.reduce((sum, header) => sum + header.bytes, 0);
  if (policy.maxTotalHeaderBytes !== undefined && totalBytes > policy.maxTotalHeaderBytes) {
    return reject(policy.routeId, 431, "headers-too-large", undefined, "headers exceed max size");
  }

  return { kind: "allow", routeId: policy.routeId, statusCode: 200 };
}

export function normalizeHeaders(
  headers: Record<string, string | readonly string[] | undefined>,
): NormalizedHeader[] {
  return Object.entries(headers)
    .filter((entry): entry is [string, string | readonly string[]] => entry[1] !== undefined)
    .map(([name, value]) => {
      const normalizedName = normalizeHeaderName(name);
      const normalizedValue = typeof value === "string" ? value : value.join(",");
      return {
        name: normalizedName,
        value: normalizedValue,
        bytes: headerByteLength(normalizedName, normalizedValue),
      };
    })
    .sort((left, right) => left.name.localeCompare(right.name));
}

export function normalizeHeaderName(name: string): string {
  assertNonEmpty(name, "headerName");
  return name.trim().toLowerCase();
}

export function headerByteLength(name: string, value: string): number {
  assertNonEmpty(name, "headerName");
  return Buffer.byteLength(`${name}: ${value}`, "utf8");
}

function reject(
  routeId: string,
  statusCode: number,
  reason: HeaderPolicyRejectReason,
  headerName: string | undefined,
  detail: string,
): HeaderPolicyDecision {
  return { kind: "reject", routeId, statusCode, reason, headerName, detail };
}

function assertPolicy(policy: HeaderPolicy): void {
  assertNonEmpty(policy.routeId, "routeId");
  for (const rule of policy.requiredHeaders ?? []) {
    assertNonEmpty(rule.name, "requiredHeader.name");
  }
  for (const name of policy.allowedHeaderNames ?? []) assertNonEmpty(name, "allowedHeaderName");
  for (const name of policy.blockedHeaderNames ?? []) assertNonEmpty(name, "blockedHeaderName");
  if (policy.maxHeaderBytes !== undefined)
    assertPositiveInteger(policy.maxHeaderBytes, "maxHeaderBytes");
  if (policy.maxTotalHeaderBytes !== undefined)
    assertPositiveInteger(policy.maxTotalHeaderBytes, "maxTotalHeaderBytes");
}

function assertNonEmpty(value: string, name: string): void {
  if (!value.trim()) throw new Error(`${name} is required`);
}

function assertPositiveInteger(value: number, name: string): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
}
