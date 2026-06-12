import {
  type PoolAcquireResult,
  type PoolConnection,
  type PoolReleaseResult,
  type PoolSnapshot,
  type PoolState,
  type PoolWaiter,
  acquireConnection,
  cancelPoolWaiter,
  clonePoolState,
  createPoolState,
  expirePoolWaiters,
  poolSnapshot,
  pruneIdleConnections,
  reapLeasedConnections,
  releaseConnection,
  resizePool,
} from "./core.js";

export interface MemoryConnectionPoolOptions {
  maxSize: number;
  now?: () => number;
  defaultWaitTimeoutMs?: number;
  idleTtlMs?: number;
  maxLifetimeMs?: number;
}

export class MemoryConnectionPool {
  private state: PoolState;
  private readonly now: () => number;
  private readonly defaultWaitTimeoutMs: number;
  private readonly idleTtlMs?: number;
  private readonly maxLifetimeMs?: number;
  private nextConnection = 1;
  private nextRequest = 1;

  constructor(options: MemoryConnectionPoolOptions) {
    this.state = createPoolState({ maxSize: options.maxSize });
    this.now = options.now ?? Date.now;
    this.defaultWaitTimeoutMs = options.defaultWaitTimeoutMs ?? 30_000;
    this.idleTtlMs = options.idleTtlMs;
    this.maxLifetimeMs = options.maxLifetimeMs;
  }

  acquire(input: {
    requesterId: string;
    requestId?: string;
    waitTimeoutMs?: number;
  }): PoolAcquireResult {
    const result = acquireConnection(this.state, {
      requesterId: input.requesterId,
      requestId: input.requestId ?? `req-${this.nextRequest++}`,
      waitTimeoutMs: input.waitTimeoutMs ?? this.defaultWaitTimeoutMs,
      connectionId: `conn-${this.nextConnection}`,
      nowMs: this.now(),
    });
    if (
      result.kind === "leased" &&
      result.connection.id === `conn-${this.nextConnection}` &&
      result.connection.useCount === 1
    ) {
      this.nextConnection += 1;
    }
    this.state = result.state;
    return result;
  }

  release(connectionId: string): PoolReleaseResult {
    const result = releaseConnection(this.state, { connectionId, nowMs: this.now() });
    this.state = result.state;
    return result;
  }

  pruneIdle(): PoolConnection[] {
    const result = pruneIdleConnections(this.state, {
      nowMs: this.now(),
      idleTtlMs: this.idleTtlMs,
      maxLifetimeMs: this.maxLifetimeMs,
    });
    this.state = result.state;
    return result.closed;
  }

  expireWaiters(): PoolWaiter[] {
    const result = expirePoolWaiters(this.state, this.now());
    this.state = result.state;
    return result.expired;
  }

  cancelWaiter(waiterId: string): PoolWaiter | undefined {
    const result = cancelPoolWaiter(this.state, waiterId);
    this.state = result.state;
    return result.cancelled;
  }

  resize(maxSize: number): PoolConnection[] {
    const result = resizePool(this.state, maxSize);
    this.state = result.state;
    return result.closed;
  }

  reapLeased(leaseTimeoutMs: number): PoolConnection[] {
    const result = reapLeasedConnections(this.state, {
      nowMs: this.now(),
      leaseTimeoutMs,
    });
    this.state = result.state;
    return result.reaped;
  }

  snapshot(): PoolSnapshot {
    return poolSnapshot(this.state);
  }

  listConnections(): PoolConnection[] {
    return clonePoolState(this.state).connections.map((connection) => ({ ...connection }));
  }

  listWaiters(): PoolWaiter[] {
    return clonePoolState(this.state).waiters.map((waiter) => ({ ...waiter }));
  }
}
