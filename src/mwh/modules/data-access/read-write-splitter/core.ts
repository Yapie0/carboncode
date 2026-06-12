export type QueryIntent = "read" | "write" | "transaction";
export type DatabaseNodeRole = "primary" | "replica";
export type DatabaseNodeStatus = "healthy" | "degraded" | "down";

export interface DatabaseNode {
  id: string;
  role: DatabaseNodeRole;
  status: DatabaseNodeStatus;
  replicaLagMs: number;
  weight: number;
}

export interface QueryRouteRequest {
  id: string;
  sql?: string;
  intent?: QueryIntent;
  transactionId?: string;
  subject?: string;
  requireFreshRead?: boolean;
  readYourWrites?: boolean;
}

export interface ReadWriteRoutingPolicy {
  maxReplicaLagMs: number;
  allowPrimaryReads: boolean;
}

export interface QueryRouteDecision {
  requestId: string;
  intent: QueryIntent;
  nodeId: string;
  role: DatabaseNodeRole;
  reason: string;
}

export interface SplitterSnapshot {
  totalNodes: number;
  healthyPrimaries: number;
  healthyReplicas: number;
  degradedNodes: number;
  downNodes: number;
}

export interface WriteAffinity {
  key: string;
  writtenAtMs: number;
  expiresAtMs: number;
}

export function inferQueryIntent(input: {
  sql?: string;
  intent?: QueryIntent;
  transactionId?: string;
}): QueryIntent {
  if (input.transactionId) return "transaction";
  if (input.intent) return input.intent;
  const normalized = input.sql?.trim().toLowerCase() ?? "";
  if (!normalized) return "write";
  if (normalized.startsWith("select") || normalized.startsWith("with")) return "read";
  return "write";
}

export function routeQuery(
  nodes: readonly DatabaseNode[],
  request: QueryRouteRequest,
  policy: ReadWriteRoutingPolicy,
  input?: {
    replicaCursor?: number;
  },
): QueryRouteDecision {
  assertNodes(nodes);
  assertNonEmpty(request.id, "request.id");
  assertNonNegativeInteger(policy.maxReplicaLagMs, "maxReplicaLagMs");
  const intent = inferQueryIntent(request);

  if (intent === "write" || intent === "transaction" || request.readYourWrites) {
    const primary = pickPrimary(nodes);
    return {
      requestId: request.id,
      intent,
      nodeId: primary.id,
      role: primary.role,
      reason:
        intent === "read" ? "read-your-writes requires primary" : `${intent} queries use primary`,
    };
  }

  if (request.requireFreshRead) {
    const primary = pickPrimary(nodes);
    return {
      requestId: request.id,
      intent,
      nodeId: primary.id,
      role: primary.role,
      reason: "fresh read requires primary",
    };
  }

  const replica = pickReplica(nodes, policy.maxReplicaLagMs, input?.replicaCursor ?? 0);
  if (replica) {
    return {
      requestId: request.id,
      intent,
      nodeId: replica.id,
      role: replica.role,
      reason: "healthy replica selected",
    };
  }

  if (policy.allowPrimaryReads) {
    const primary = pickPrimary(nodes);
    return {
      requestId: request.id,
      intent,
      nodeId: primary.id,
      role: primary.role,
      reason: "no healthy replica available; primary read fallback",
    };
  }

  throw new Error("no healthy replica available");
}

export function updateNodeStatus(
  nodes: readonly DatabaseNode[],
  input: {
    nodeId: string;
    status?: DatabaseNodeStatus;
    replicaLagMs?: number;
    weight?: number;
  },
): DatabaseNode[] {
  assertNodes(nodes);
  assertNonEmpty(input.nodeId, "nodeId");
  if (input.replicaLagMs !== undefined)
    assertNonNegativeInteger(input.replicaLagMs, "replicaLagMs");
  if (input.weight !== undefined) assertPositiveInteger(input.weight, "weight");
  let found = false;
  const updated = nodes.map((node) => {
    if (node.id !== input.nodeId) return cloneNode(node);
    found = true;
    return cloneNode({
      ...node,
      status: input.status ?? node.status,
      replicaLagMs: input.replicaLagMs ?? node.replicaLagMs,
      weight: input.weight ?? node.weight,
    });
  });
  if (!found) throw new Error("node not found");
  return updated;
}

export function splitterSnapshot(nodes: readonly DatabaseNode[]): SplitterSnapshot {
  assertNodes(nodes);
  return {
    totalNodes: nodes.length,
    healthyPrimaries: nodes.filter((node) => node.role === "primary" && node.status === "healthy")
      .length,
    healthyReplicas: nodes.filter((node) => node.role === "replica" && node.status === "healthy")
      .length,
    degradedNodes: nodes.filter((node) => node.status === "degraded").length,
    downNodes: nodes.filter((node) => node.status === "down").length,
  };
}

export function createWriteAffinity(input: {
  key: string;
  writtenAtMs: number;
  ttlMs: number;
}): WriteAffinity {
  assertNonEmpty(input.key, "key");
  assertNonNegativeInteger(input.writtenAtMs, "writtenAtMs");
  assertPositiveInteger(input.ttlMs, "ttlMs");
  return {
    key: input.key,
    writtenAtMs: input.writtenAtMs,
    expiresAtMs: input.writtenAtMs + input.ttlMs,
  };
}

export function isWriteAffinityActive(affinity: WriteAffinity, nowMs: number): boolean {
  assertNonNegativeInteger(nowMs, "nowMs");
  return nowMs < affinity.expiresAtMs;
}

export function cloneDatabaseNodes(nodes: readonly DatabaseNode[]): DatabaseNode[] {
  assertNodes(nodes);
  return nodes.map(cloneNode);
}

function pickPrimary(nodes: readonly DatabaseNode[]): DatabaseNode {
  const primary = nodes.find((node) => node.role === "primary" && node.status === "healthy");
  if (!primary) throw new Error("no healthy primary available");
  return cloneNode(primary);
}

function pickReplica(
  nodes: readonly DatabaseNode[],
  maxReplicaLagMs: number,
  replicaCursor: number,
): DatabaseNode | null {
  const replicas = nodes
    .filter((node) => node.role === "replica")
    .filter((node) => node.status === "healthy")
    .filter((node) => node.replicaLagMs <= maxReplicaLagMs)
    .flatMap((node) => Array.from({ length: node.weight }, () => node));
  if (replicas.length === 0) return null;
  return cloneNode(replicas[replicaCursor % replicas.length]!);
}

function assertNodes(nodes: readonly DatabaseNode[]): void {
  const primaryCount = nodes.filter((node) => node.role === "primary").length;
  if (primaryCount !== 1) throw new Error("exactly one primary node is required");
  for (const node of nodes) {
    assertNonEmpty(node.id, "node.id");
    assertNonNegativeInteger(node.replicaLagMs, "replicaLagMs");
    assertPositiveInteger(node.weight, "weight");
  }
}

function cloneNode(node: DatabaseNode): DatabaseNode {
  return { ...node };
}

function assertNonEmpty(value: string, name: string): void {
  if (!value.trim()) throw new Error(`${name} is required`);
}

function assertPositiveInteger(value: number, name: string): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
}

function assertNonNegativeInteger(value: number, name: string): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative integer`);
  }
}
