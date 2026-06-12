import {
  type EmbeddingRecord,
  type SearchResult,
  createEmbeddingRecord,
  embeddingCacheKey,
  isEmbeddingExpired,
  searchEmbeddings,
} from "./core.js";

export interface MemoryEmbeddingIndexOptions {
  now?: () => number;
}

export class MemoryEmbeddingIndex<TMetadata = Record<string, unknown>> {
  private readonly now: () => number;
  private readonly records = new Map<string, EmbeddingRecord<TMetadata>>();
  private readonly cacheKeys = new Map<string, string>();

  constructor(opts: MemoryEmbeddingIndexOptions = {}) {
    this.now = opts.now ?? Date.now;
  }

  upsert(input: {
    id: string;
    model: string;
    text: string;
    vector: readonly number[];
    metadata?: TMetadata;
    ttlMs?: number;
  }): EmbeddingRecord<TMetadata> {
    const record = createEmbeddingRecord({ ...input, nowMs: this.now() });
    this.records.set(record.id, record);
    this.cacheKeys.set(record.textHash, record.id);
    return cloneRecord(record);
  }

  getByText(model: string, text: string): EmbeddingRecord<TMetadata> | undefined {
    const id = this.cacheKeys.get(embeddingCacheKey({ model, text }));
    if (!id) return undefined;
    const record = this.records.get(id);
    if (!record || isEmbeddingExpired(record, this.now())) return undefined;
    return cloneRecord(record);
  }

  search(input: {
    model: string;
    queryVector: readonly number[];
    topK?: number;
    minScore?: number;
  }): SearchResult<TMetadata>[] {
    return searchEmbeddings({
      records: [...this.records.values()],
      nowMs: this.now(),
      ...input,
    }).map((result) => ({ score: result.score, record: cloneRecord(result.record) }));
  }

  pruneExpired(): number {
    let removed = 0;
    const nowMs = this.now();
    for (const [id, record] of this.records) {
      if (isEmbeddingExpired(record, nowMs)) {
        this.records.delete(id);
        this.cacheKeys.delete(record.textHash);
        removed += 1;
      }
    }
    return removed;
  }

  size(): number {
    return this.records.size;
  }
}

function cloneRecord<TMetadata>(record: EmbeddingRecord<TMetadata>): EmbeddingRecord<TMetadata> {
  return { ...record, vector: [...record.vector] };
}
