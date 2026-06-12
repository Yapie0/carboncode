import {
  type TransactionEntry,
  type TransactionRegistry,
  type TransactionSnapshot,
  beginTransaction,
  cloneTransactionRegistry,
  commitTransaction,
  createSavepoint,
  createTransactionRegistry,
  expireTransactions,
  releaseSavepoint,
  rollbackToSavepoint,
  rollbackTransaction,
  transactionSnapshot,
} from "./core.js";

export interface MemoryTransactionManagerOptions {
  now?: () => number;
  defaultTimeoutMs?: number;
  defaultIsolationLevel?: string;
}

export class MemoryTransactionManager {
  private registry: TransactionRegistry = createTransactionRegistry();
  private readonly now: () => number;
  private readonly defaultTimeoutMs: number;
  private readonly defaultIsolationLevel: string;
  private nextTransaction = 1;

  constructor(options: MemoryTransactionManagerOptions = {}) {
    this.now = options.now ?? Date.now;
    this.defaultTimeoutMs = options.defaultTimeoutMs ?? 30_000;
    this.defaultIsolationLevel = options.defaultIsolationLevel ?? "read-committed";
  }

  begin(input: {
    connectionId: string;
    ownerId: string;
    transactionId?: string;
    timeoutMs?: number;
    isolationLevel?: string;
  }): TransactionEntry {
    const result = beginTransaction(this.registry, {
      id: input.transactionId ?? `tx-${this.nextTransaction++}`,
      connectionId: input.connectionId,
      ownerId: input.ownerId,
      nowMs: this.now(),
      timeoutMs: input.timeoutMs ?? this.defaultTimeoutMs,
      isolationLevel: input.isolationLevel ?? this.defaultIsolationLevel,
    });
    this.registry = result.registry;
    return result.transaction;
  }

  async runInTransaction<T>(input: {
    connectionId: string;
    ownerId: string;
    transactionId?: string;
    timeoutMs?: number;
    isolationLevel?: string;
    run: (transaction: TransactionEntry) => Promise<T> | T;
  }): Promise<T> {
    const transaction = this.begin(input);
    try {
      const value = await Promise.resolve(input.run(transaction));
      this.commit(transaction.id);
      return value;
    } catch (error) {
      this.rollback(transaction.id, (error as Error).message);
      throw error;
    }
  }

  savepoint(transactionId: string, name: string): TransactionEntry {
    const result = createSavepoint(this.registry, { transactionId, name, nowMs: this.now() });
    this.registry = result.registry;
    return result.transaction;
  }

  releaseSavepoint(transactionId: string, name: string): TransactionEntry {
    const result = releaseSavepoint(this.registry, { transactionId, name, nowMs: this.now() });
    this.registry = result.registry;
    return result.transaction;
  }

  rollbackToSavepoint(transactionId: string, name: string): TransactionEntry {
    const result = rollbackToSavepoint(this.registry, { transactionId, name, nowMs: this.now() });
    this.registry = result.registry;
    return result.transaction;
  }

  commit(transactionId: string): TransactionEntry {
    const result = commitTransaction(this.registry, { transactionId, nowMs: this.now() });
    this.registry = result.registry;
    return result.transaction;
  }

  rollback(transactionId: string, reason?: string): TransactionEntry {
    const result = rollbackTransaction(this.registry, {
      transactionId,
      reason,
      nowMs: this.now(),
    });
    this.registry = result.registry;
    return result.transaction;
  }

  expire(): TransactionEntry[] {
    const result = expireTransactions(this.registry, this.now());
    this.registry = result.registry;
    return result.expired;
  }

  snapshot(): TransactionSnapshot {
    return transactionSnapshot(this.registry);
  }

  listTransactions(): TransactionEntry[] {
    return cloneTransactionRegistry(this.registry).transactions.map((transaction) => ({
      ...transaction,
    }));
  }
}
