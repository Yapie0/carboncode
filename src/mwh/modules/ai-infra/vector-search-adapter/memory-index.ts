import {
  type VectorDocument,
  type VectorMetric,
  type VectorSearchFilter,
  type VectorSearchResult,
  cloneVectorDocument,
  createVectorDocument,
  searchVectorDocuments,
} from "./core.js";

export class MemoryVectorSearchIndex<TMetadata = Record<string, unknown>> {
  private readonly documents = new Map<string, VectorDocument<TMetadata>>();
  private readonly now: () => number;

  constructor(input: { now?: () => number } = {}) {
    this.now = input.now ?? Date.now;
  }

  upsert(input: {
    id: string;
    namespace: string;
    vector: readonly number[];
    metadata?: TMetadata;
    content?: string;
  }): VectorDocument<TMetadata> {
    const document = createVectorDocument({ ...input, nowMs: this.now() });
    this.documents.set(document.id, document);
    return cloneVectorDocument(document);
  }

  get(id: string): VectorDocument<TMetadata> | undefined {
    const document = this.documents.get(id);
    return document ? cloneVectorDocument(document) : undefined;
  }

  delete(id: string): boolean {
    return this.documents.delete(id);
  }

  search(input: {
    queryVector: readonly number[];
    topK: number;
    metric?: VectorMetric;
    minScore?: number;
    filter?: VectorSearchFilter;
  }): VectorSearchResult<TMetadata>[] {
    return searchVectorDocuments({
      documents: [...this.documents.values()],
      ...input,
    });
  }

  list(input: { namespace?: string } = {}): VectorDocument<TMetadata>[] {
    return [...this.documents.values()]
      .filter((document) => input.namespace === undefined || document.namespace === input.namespace)
      .sort((left, right) => left.id.localeCompare(right.id))
      .map(cloneVectorDocument);
  }

  size(): number {
    return this.documents.size;
  }
}
