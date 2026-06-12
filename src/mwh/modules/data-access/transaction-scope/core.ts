export type TransactionStatus = "active" | "committed" | "rolled-back" | "expired";

export interface TransactionSavepoint {
  name: string;
  createdAtMs: number;
}

export interface TransactionEntry {
  id: string;
  connectionId: string;
  ownerId: string;
  status: TransactionStatus;
  startedAtMs: number;
  updatedAtMs: number;
  expiresAtMs: number;
  isolationLevel: string;
  savepoints: readonly TransactionSavepoint[];
  events: readonly TransactionEvent[];
}

export interface TransactionEvent {
  type:
    | "begin"
    | "savepoint"
    | "release-savepoint"
    | "rollback-to-savepoint"
    | "commit"
    | "rollback"
    | "expire";
  atMs: number;
  detail?: string;
}

export interface TransactionRegistry {
  transactions: readonly TransactionEntry[];
}

export interface TransactionSnapshot {
  total: number;
  active: number;
  committed: number;
  rolledBack: number;
  expired: number;
}

export function createTransactionRegistry(): TransactionRegistry {
  return { transactions: [] };
}

export function beginTransaction(
  registry: TransactionRegistry,
  input: {
    id: string;
    connectionId: string;
    ownerId: string;
    nowMs: number;
    timeoutMs: number;
    isolationLevel?: string;
  },
): { registry: TransactionRegistry; transaction: TransactionEntry } {
  assertRegistry(registry);
  assertNonEmpty(input.id, "id");
  assertNonEmpty(input.connectionId, "connectionId");
  assertNonEmpty(input.ownerId, "ownerId");
  assertNonNegativeInteger(input.nowMs, "nowMs");
  assertPositiveInteger(input.timeoutMs, "timeoutMs");
  if (registry.transactions.some((transaction) => transaction.id === input.id)) {
    throw new Error("transaction already exists");
  }
  if (
    registry.transactions.some(
      (transaction) =>
        transaction.connectionId === input.connectionId && transaction.status === "active",
    )
  ) {
    throw new Error("connection already has an active transaction");
  }

  const transaction: TransactionEntry = {
    id: input.id,
    connectionId: input.connectionId,
    ownerId: input.ownerId,
    status: "active",
    startedAtMs: input.nowMs,
    updatedAtMs: input.nowMs,
    expiresAtMs: input.nowMs + input.timeoutMs,
    isolationLevel: input.isolationLevel ?? "read-committed",
    savepoints: [],
    events: [{ type: "begin", atMs: input.nowMs }],
  };
  return {
    registry: cloneRegistry({
      transactions: [...registry.transactions, transaction],
    }),
    transaction,
  };
}

export function createSavepoint(
  registry: TransactionRegistry,
  input: {
    transactionId: string;
    name: string;
    nowMs: number;
  },
): { registry: TransactionRegistry; transaction: TransactionEntry } {
  const transaction = getActiveTransaction(registry, input.transactionId, input.nowMs);
  assertNonEmpty(input.name, "name");
  if (transaction.savepoints.some((savepoint) => savepoint.name === input.name)) {
    throw new Error("savepoint already exists");
  }
  const updated = appendEvent(
    {
      ...transaction,
      updatedAtMs: input.nowMs,
      savepoints: [...transaction.savepoints, { name: input.name, createdAtMs: input.nowMs }],
    },
    { type: "savepoint", atMs: input.nowMs, detail: input.name },
  );
  return replaceTransaction(registry, updated);
}

export function releaseSavepoint(
  registry: TransactionRegistry,
  input: {
    transactionId: string;
    name: string;
    nowMs: number;
  },
): { registry: TransactionRegistry; transaction: TransactionEntry } {
  const transaction = getActiveTransaction(registry, input.transactionId, input.nowMs);
  assertExistingSavepoint(transaction, input.name);
  const updated = appendEvent(
    {
      ...transaction,
      updatedAtMs: input.nowMs,
      savepoints: transaction.savepoints.filter((savepoint) => savepoint.name !== input.name),
    },
    { type: "release-savepoint", atMs: input.nowMs, detail: input.name },
  );
  return replaceTransaction(registry, updated);
}

export function rollbackToSavepoint(
  registry: TransactionRegistry,
  input: {
    transactionId: string;
    name: string;
    nowMs: number;
  },
): { registry: TransactionRegistry; transaction: TransactionEntry } {
  const transaction = getActiveTransaction(registry, input.transactionId, input.nowMs);
  const index = transaction.savepoints.findIndex((savepoint) => savepoint.name === input.name);
  if (index < 0) throw new Error("savepoint not found");
  const updated = appendEvent(
    {
      ...transaction,
      updatedAtMs: input.nowMs,
      savepoints: transaction.savepoints.slice(0, index + 1),
    },
    { type: "rollback-to-savepoint", atMs: input.nowMs, detail: input.name },
  );
  return replaceTransaction(registry, updated);
}

export function commitTransaction(
  registry: TransactionRegistry,
  input: {
    transactionId: string;
    nowMs: number;
  },
): { registry: TransactionRegistry; transaction: TransactionEntry } {
  const transaction = getActiveTransaction(registry, input.transactionId, input.nowMs);
  const updated = appendEvent(
    {
      ...transaction,
      status: "committed",
      updatedAtMs: input.nowMs,
      savepoints: [],
    },
    { type: "commit", atMs: input.nowMs },
  );
  return replaceTransaction(registry, updated);
}

export function rollbackTransaction(
  registry: TransactionRegistry,
  input: {
    transactionId: string;
    nowMs: number;
    reason?: string;
  },
): { registry: TransactionRegistry; transaction: TransactionEntry } {
  const transaction = getActiveTransaction(registry, input.transactionId, input.nowMs);
  const updated = appendEvent(
    {
      ...transaction,
      status: "rolled-back",
      updatedAtMs: input.nowMs,
      savepoints: [],
    },
    { type: "rollback", atMs: input.nowMs, detail: input.reason },
  );
  return replaceTransaction(registry, updated);
}

export function expireTransactions(
  registry: TransactionRegistry,
  nowMs: number,
): { registry: TransactionRegistry; expired: TransactionEntry[] } {
  assertRegistry(registry);
  assertNonNegativeInteger(nowMs, "nowMs");
  const expired: TransactionEntry[] = [];
  const transactions = registry.transactions.map((transaction) => {
    if (transaction.status !== "active" || transaction.expiresAtMs > nowMs) {
      return cloneTransaction(transaction);
    }
    const updated = appendEvent(
      {
        ...transaction,
        status: "expired",
        updatedAtMs: nowMs,
        savepoints: [],
      },
      { type: "expire", atMs: nowMs },
    );
    expired.push(updated);
    return updated;
  });
  return {
    registry: cloneRegistry({ transactions }),
    expired,
  };
}

export function transactionSnapshot(registry: TransactionRegistry): TransactionSnapshot {
  assertRegistry(registry);
  return {
    total: registry.transactions.length,
    active: registry.transactions.filter((transaction) => transaction.status === "active").length,
    committed: registry.transactions.filter((transaction) => transaction.status === "committed")
      .length,
    rolledBack: registry.transactions.filter((transaction) => transaction.status === "rolled-back")
      .length,
    expired: registry.transactions.filter((transaction) => transaction.status === "expired").length,
  };
}

export function cloneTransactionRegistry(registry: TransactionRegistry): TransactionRegistry {
  assertRegistry(registry);
  return cloneRegistry(registry);
}

function getActiveTransaction(
  registry: TransactionRegistry,
  transactionId: string,
  nowMs: number,
): TransactionEntry {
  assertRegistry(registry);
  assertNonEmpty(transactionId, "transactionId");
  assertNonNegativeInteger(nowMs, "nowMs");
  const transaction = registry.transactions.find((candidate) => candidate.id === transactionId);
  if (!transaction) throw new Error("transaction not found");
  if (transaction.status !== "active") throw new Error("transaction is not active");
  if (transaction.expiresAtMs <= nowMs) throw new Error("transaction is expired");
  return cloneTransaction(transaction);
}

function assertExistingSavepoint(transaction: TransactionEntry, name: string): void {
  assertNonEmpty(name, "name");
  if (!transaction.savepoints.some((savepoint) => savepoint.name === name)) {
    throw new Error("savepoint not found");
  }
}

function replaceTransaction(
  registry: TransactionRegistry,
  transaction: TransactionEntry,
): { registry: TransactionRegistry; transaction: TransactionEntry } {
  return {
    registry: cloneRegistry({
      transactions: registry.transactions.map((candidate) =>
        candidate.id === transaction.id ? transaction : candidate,
      ),
    }),
    transaction: cloneTransaction(transaction),
  };
}

function appendEvent(transaction: TransactionEntry, event: TransactionEvent): TransactionEntry {
  return cloneTransaction({
    ...transaction,
    events: [...transaction.events, event],
  });
}

function cloneRegistry(registry: TransactionRegistry): TransactionRegistry {
  return {
    transactions: registry.transactions.map(cloneTransaction),
  };
}

function cloneTransaction(transaction: TransactionEntry): TransactionEntry {
  return {
    ...transaction,
    savepoints: transaction.savepoints.map((savepoint) => ({ ...savepoint })),
    events: transaction.events.map((event) => ({ ...event })),
  };
}

function assertRegistry(registry: TransactionRegistry): void {
  if (!Array.isArray(registry.transactions)) throw new Error("transactions must be an array");
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
