export type PoolConnectionStatus = "idle" | "leased";

export interface PoolConnection {
  id: string;
  status: PoolConnectionStatus;
  createdAtMs: number;
  lastUsedAtMs: number;
  leasedAtMs?: number;
  leasedBy?: string;
  useCount: number;
}

export interface PoolWaiter {
  id: string;
  requesterId: string;
  requestedAtMs: number;
  expiresAtMs: number;
}

export interface PoolState {
  maxSize: number;
  connections: readonly PoolConnection[];
  waiters: readonly PoolWaiter[];
}

export interface PoolSnapshot {
  maxSize: number;
  totalConnections: number;
  idleConnections: number;
  leasedConnections: number;
  waitingRequests: number;
}

export interface PoolResizeResult {
  state: PoolState;
  closed: PoolConnection[];
}

export type PoolAcquireResult =
  | {
      kind: "leased";
      state: PoolState;
      connection: PoolConnection;
    }
  | {
      kind: "queued";
      state: PoolState;
      waiter: PoolWaiter;
    }
  | {
      kind: "rejected";
      state: PoolState;
      reason: string;
    };

export interface PoolReleaseResult {
  state: PoolState;
  connection?: PoolConnection;
  assigned?: {
    waiter: PoolWaiter;
    connection: PoolConnection;
  };
}

export function createPoolState(input: { maxSize: number }): PoolState {
  assertPositiveInteger(input.maxSize, "maxSize");
  return {
    maxSize: input.maxSize,
    connections: [],
    waiters: [],
  };
}

export function acquireConnection(
  state: PoolState,
  input: {
    requesterId: string;
    requestId: string;
    nowMs: number;
    waitTimeoutMs: number;
    connectionId?: string;
  },
): PoolAcquireResult {
  assertPoolState(state);
  assertNonEmpty(input.requesterId, "requesterId");
  assertNonEmpty(input.requestId, "requestId");
  assertNonNegativeInteger(input.nowMs, "nowMs");
  assertPositiveInteger(input.waitTimeoutMs, "waitTimeoutMs");

  const { state: activeState } = expirePoolWaiters(state, input.nowMs);
  if (activeState.waiters.some((waiter) => waiter.id === input.requestId)) {
    return { kind: "rejected", state: activeState, reason: "request already queued" };
  }

  const idle = activeState.connections.find((connection) => connection.status === "idle");
  if (idle) {
    const leased = leaseConnection(idle, input.requesterId, input.nowMs);
    return {
      kind: "leased",
      state: replaceConnection(activeState, leased),
      connection: leased,
    };
  }

  if (activeState.connections.length < activeState.maxSize) {
    const connection = leaseConnection(
      {
        id: input.connectionId ?? `conn-${activeState.connections.length + 1}`,
        status: "idle",
        createdAtMs: input.nowMs,
        lastUsedAtMs: input.nowMs,
        useCount: 0,
      },
      input.requesterId,
      input.nowMs,
    );
    return {
      kind: "leased",
      state: cloneState({
        ...activeState,
        connections: [...activeState.connections, connection],
      }),
      connection,
    };
  }

  const waiter: PoolWaiter = {
    id: input.requestId,
    requesterId: input.requesterId,
    requestedAtMs: input.nowMs,
    expiresAtMs: input.nowMs + input.waitTimeoutMs,
  };
  return {
    kind: "queued",
    state: cloneState({
      ...activeState,
      waiters: [...activeState.waiters, waiter],
    }),
    waiter: { ...waiter },
  };
}

export function releaseConnection(
  state: PoolState,
  input: {
    connectionId: string;
    nowMs: number;
  },
): PoolReleaseResult {
  assertPoolState(state);
  assertNonEmpty(input.connectionId, "connectionId");
  assertNonNegativeInteger(input.nowMs, "nowMs");

  const connection = state.connections.find((candidate) => candidate.id === input.connectionId);
  if (!connection || connection.status !== "leased") {
    throw new Error("leased connection not found");
  }

  const { state: activeState } = expirePoolWaiters(state, input.nowMs);
  const nextWaiter = [...activeState.waiters].sort(
    (left, right) => left.requestedAtMs - right.requestedAtMs || left.id.localeCompare(right.id),
  )[0];

  if (!nextWaiter) {
    const released: PoolConnection = {
      id: connection.id,
      status: "idle",
      createdAtMs: connection.createdAtMs,
      lastUsedAtMs: input.nowMs,
      useCount: connection.useCount,
    };
    return {
      state: replaceConnection(activeState, released),
      connection: released,
    };
  }

  const assigned = leaseConnection(
    { ...connection, lastUsedAtMs: input.nowMs },
    nextWaiter.requesterId,
    input.nowMs,
  );
  return {
    state: cloneState({
      ...replaceConnection(activeState, assigned),
      waiters: activeState.waiters.filter((waiter) => waiter.id !== nextWaiter.id),
    }),
    assigned: {
      waiter: { ...nextWaiter },
      connection: assigned,
    },
  };
}

export function expirePoolWaiters(
  state: PoolState,
  nowMs: number,
): { state: PoolState; expired: PoolWaiter[] } {
  assertPoolState(state);
  assertNonNegativeInteger(nowMs, "nowMs");
  const expired = state.waiters.filter((waiter) => waiter.expiresAtMs <= nowMs);
  return {
    state: cloneState({
      ...state,
      waiters: state.waiters.filter((waiter) => waiter.expiresAtMs > nowMs),
    }),
    expired: expired.map((waiter) => ({ ...waiter })),
  };
}

export function cancelPoolWaiter(
  state: PoolState,
  waiterId: string,
): { state: PoolState; cancelled?: PoolWaiter } {
  assertPoolState(state);
  assertNonEmpty(waiterId, "waiterId");
  const cancelled = state.waiters.find((waiter) => waiter.id === waiterId);
  return {
    state: cloneState({
      ...state,
      waiters: state.waiters.filter((waiter) => waiter.id !== waiterId),
    }),
    cancelled: cancelled ? { ...cancelled } : undefined,
  };
}

export function resizePool(state: PoolState, maxSize: number): PoolResizeResult {
  assertPoolState(state);
  assertPositiveInteger(maxSize, "maxSize");
  const leased = state.connections.filter((connection) => connection.status === "leased");
  if (leased.length > maxSize) throw new Error("maxSize cannot be below leased connection count");
  const idle = state.connections
    .filter((connection) => connection.status === "idle")
    .sort(
      (left, right) => left.lastUsedAtMs - right.lastUsedAtMs || left.id.localeCompare(right.id),
    );
  const idleToKeep = Math.max(0, maxSize - leased.length);
  const keepIdleIds = new Set(
    (idleToKeep === 0 ? [] : idle.slice(-idleToKeep)).map((connection) => connection.id),
  );
  const closed = idle.filter((connection) => !keepIdleIds.has(connection.id));
  return {
    state: cloneState({
      maxSize,
      waiters: state.waiters,
      connections: state.connections.filter(
        (connection) => connection.status === "leased" || keepIdleIds.has(connection.id),
      ),
    }),
    closed: closed.map((connection) => ({ ...connection })),
  };
}

export function reapLeasedConnections(
  state: PoolState,
  input: {
    nowMs: number;
    leaseTimeoutMs: number;
  },
): { state: PoolState; reaped: PoolConnection[] } {
  assertPoolState(state);
  assertNonNegativeInteger(input.nowMs, "nowMs");
  assertPositiveInteger(input.leaseTimeoutMs, "leaseTimeoutMs");
  const reaped = state.connections.filter(
    (connection) =>
      connection.status === "leased" &&
      connection.leasedAtMs !== undefined &&
      input.nowMs - connection.leasedAtMs >= input.leaseTimeoutMs,
  );
  return {
    state: cloneState({
      ...state,
      connections: state.connections.filter(
        (connection) => !reaped.some((candidate) => candidate.id === connection.id),
      ),
    }),
    reaped: reaped.map((connection) => ({ ...connection })),
  };
}

export function pruneIdleConnections(
  state: PoolState,
  input: {
    nowMs: number;
    idleTtlMs?: number;
    maxLifetimeMs?: number;
  },
): { state: PoolState; closed: PoolConnection[] } {
  assertPoolState(state);
  assertNonNegativeInteger(input.nowMs, "nowMs");
  if (input.idleTtlMs !== undefined) assertPositiveInteger(input.idleTtlMs, "idleTtlMs");
  if (input.maxLifetimeMs !== undefined)
    assertPositiveInteger(input.maxLifetimeMs, "maxLifetimeMs");

  const closed: PoolConnection[] = [];
  const kept = state.connections.filter((connection) => {
    if (connection.status === "leased") return true;
    const idleExpired =
      input.idleTtlMs !== undefined && input.nowMs - connection.lastUsedAtMs >= input.idleTtlMs;
    const lifetimeExpired =
      input.maxLifetimeMs !== undefined &&
      input.nowMs - connection.createdAtMs >= input.maxLifetimeMs;
    if (!idleExpired && !lifetimeExpired) return true;
    closed.push({ ...connection });
    return false;
  });

  return {
    state: cloneState({ ...state, connections: kept }),
    closed,
  };
}

export function poolSnapshot(state: PoolState): PoolSnapshot {
  assertPoolState(state);
  return {
    maxSize: state.maxSize,
    totalConnections: state.connections.length,
    idleConnections: state.connections.filter((connection) => connection.status === "idle").length,
    leasedConnections: state.connections.filter((connection) => connection.status === "leased")
      .length,
    waitingRequests: state.waiters.length,
  };
}

export function clonePoolState(state: PoolState): PoolState {
  assertPoolState(state);
  return cloneState(state);
}

function leaseConnection(
  connection: PoolConnection,
  requesterId: string,
  nowMs: number,
): PoolConnection {
  return {
    id: connection.id,
    status: "leased",
    createdAtMs: connection.createdAtMs,
    lastUsedAtMs: nowMs,
    leasedAtMs: nowMs,
    leasedBy: requesterId,
    useCount: connection.useCount + 1,
  };
}

function replaceConnection(state: PoolState, connection: PoolConnection): PoolState {
  return cloneState({
    ...state,
    connections: state.connections.map((candidate) =>
      candidate.id === connection.id ? connection : candidate,
    ),
  });
}

function cloneState(state: PoolState): PoolState {
  return {
    maxSize: state.maxSize,
    connections: state.connections.map((connection) => ({ ...connection })),
    waiters: state.waiters.map((waiter) => ({ ...waiter })),
  };
}

function assertPoolState(state: PoolState): void {
  assertPositiveInteger(state.maxSize, "maxSize");
  if (state.connections.length > state.maxSize) {
    throw new Error("connections must not exceed maxSize");
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

function assertNonNegativeInteger(value: number, name: string): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative integer`);
  }
}
