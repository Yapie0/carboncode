import {
  type DatabaseNode,
  type DatabaseNodeStatus,
  type QueryRouteDecision,
  type QueryRouteRequest,
  type ReadWriteRoutingPolicy,
  type SplitterSnapshot,
  type WriteAffinity,
  cloneDatabaseNodes,
  createWriteAffinity,
  isWriteAffinityActive,
  routeQuery,
  splitterSnapshot,
  updateNodeStatus,
} from "./core.js";

export interface MemoryReadWriteSplitterOptions {
  nodes: readonly DatabaseNode[];
  policy: ReadWriteRoutingPolicy;
  now?: () => number;
  readYourWritesTtlMs?: number;
}

export class MemoryReadWriteSplitter {
  private readonly now: () => number;
  private nodes: DatabaseNode[];
  private readonly policy: ReadWriteRoutingPolicy;
  private readonly readYourWritesTtlMs: number;
  private replicaCursor = 0;
  private readonly history: QueryRouteDecision[] = [];
  private readonly writeAffinities = new Map<string, WriteAffinity>();
  private readonly transactions = new Set<string>();

  constructor(options: MemoryReadWriteSplitterOptions) {
    this.now = options.now ?? Date.now;
    this.nodes = cloneDatabaseNodes(options.nodes);
    this.policy = { ...options.policy };
    this.readYourWritesTtlMs = options.readYourWritesTtlMs ?? 5_000;
    if (!Number.isInteger(this.readYourWritesTtlMs) || this.readYourWritesTtlMs <= 0) {
      throw new Error("readYourWritesTtlMs must be a positive integer");
    }
  }

  route(request: QueryRouteRequest): QueryRouteDecision {
    this.pruneWriteAffinities();
    const readYourWrites =
      request.readYourWrites ||
      (request.subject !== undefined && this.writeAffinities.has(request.subject)) ||
      (request.transactionId !== undefined && this.transactions.has(request.transactionId));
    const decision = routeQuery(this.nodes, { ...request, readYourWrites }, this.policy, {
      replicaCursor: this.replicaCursor,
    });
    if (decision.role === "replica") this.replicaCursor += 1;
    this.history.push({ ...decision });
    return decision;
  }

  recordWrite(input: { key: string; nowMs?: number; ttlMs?: number }): WriteAffinity {
    const writtenAtMs = input.nowMs ?? this.now();
    const affinity = createWriteAffinity({
      key: input.key,
      writtenAtMs,
      ttlMs: input.ttlMs ?? this.readYourWritesTtlMs,
    });
    this.writeAffinities.set(affinity.key, affinity);
    return { ...affinity };
  }

  beginTransaction(transactionId: string): void {
    if (!transactionId.trim()) throw new Error("transactionId is required");
    this.transactions.add(transactionId);
  }

  endTransaction(transactionId: string): boolean {
    return this.transactions.delete(transactionId);
  }

  updateNode(input: {
    nodeId: string;
    status?: DatabaseNodeStatus;
    replicaLagMs?: number;
    weight?: number;
  }): void {
    this.nodes = updateNodeStatus(this.nodes, input);
  }

  snapshot(): SplitterSnapshot {
    return splitterSnapshot(this.nodes);
  }

  listNodes(): DatabaseNode[] {
    return cloneDatabaseNodes(this.nodes);
  }

  listHistory(): QueryRouteDecision[] {
    return this.history.map((decision) => ({ ...decision }));
  }

  listWriteAffinities(): WriteAffinity[] {
    this.pruneWriteAffinities();
    return [...this.writeAffinities.values()].map((affinity) => ({ ...affinity }));
  }

  listTransactions(): string[] {
    return [...this.transactions].sort();
  }

  private pruneWriteAffinities(nowMs: number = this.now()): number {
    let removed = 0;
    for (const [key, affinity] of this.writeAffinities) {
      if (!isWriteAffinityActive(affinity, nowMs)) {
        this.writeAffinities.delete(key);
        removed += 1;
      }
    }
    return removed;
  }
}
