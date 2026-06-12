import {
  type CompleteResumableUploadResult,
  type ResumableUploadManifest,
  type ResumableUploadStatus,
  abortResumableUpload,
  completeResumableUpload,
  createResumableUploadManifest,
  expireResumableUpload,
  missingUploadChunks,
  nextMissingUploadChunk,
  recordUploadChunk,
  resumableUploadProgress,
} from "./core.js";

export interface MemoryResumableUploadStoreOptions {
  ttlMs: number;
  now?: () => number;
}

export interface InitiateResumableUploadInput {
  id: string;
  objectKey: string;
  totalBytes: number;
  chunkSizeBytes: number;
}

export class MemoryResumableUploadStore {
  private readonly manifests = new Map<string, ResumableUploadManifest>();
  private readonly now: () => number;
  private readonly ttlMs: number;

  constructor(options: MemoryResumableUploadStoreOptions) {
    this.ttlMs = options.ttlMs;
    this.now = options.now ?? Date.now;
  }

  initiate(input: InitiateResumableUploadInput): ResumableUploadManifest {
    if (this.manifests.has(input.id))
      throw new Error(`upload manifest already exists: ${input.id}`);
    const manifest = createResumableUploadManifest({
      ...input,
      nowMs: this.now(),
      ttlMs: this.ttlMs,
    });
    this.manifests.set(input.id, manifest);
    return cloneManifest(manifest);
  }

  recordChunk(
    id: string,
    index: number,
    bytes: Uint8Array | string,
    checksumSha256?: string,
  ): ResumableUploadManifest {
    const manifest = recordUploadChunk(this.require(id), {
      index,
      bytes,
      checksumSha256,
      nowMs: this.now(),
    });
    this.manifests.set(id, manifest);
    return cloneManifest(manifest);
  }

  missing(id: string): number[] {
    return missingUploadChunks(this.require(id));
  }

  progress(id: string): ReturnType<typeof resumableUploadProgress> {
    return resumableUploadProgress(this.require(id));
  }

  nextMissingChunk(id: string): ReturnType<typeof nextMissingUploadChunk> {
    const chunk = nextMissingUploadChunk(this.require(id));
    return chunk ? { ...chunk } : undefined;
  }

  complete(id: string): CompleteResumableUploadResult {
    const result = completeResumableUpload(this.require(id), this.now());
    this.manifests.set(id, result.manifest);
    return {
      ...result,
      mergePlan: result.mergePlan.map((chunk) => ({ ...chunk })),
      manifest: cloneManifest(result.manifest),
    };
  }

  abort(id: string): ResumableUploadManifest {
    const manifest = abortResumableUpload(this.require(id), this.now());
    this.manifests.set(id, manifest);
    return cloneManifest(manifest);
  }

  expireDue(): number {
    let expired = 0;
    const nowMs = this.now();
    for (const [id, manifest] of this.manifests.entries()) {
      const next = expireResumableUpload(manifest, nowMs);
      if (manifest.status !== "expired" && next.status === "expired") expired += 1;
      this.manifests.set(id, next);
    }
    return expired;
  }

  get(id: string): ResumableUploadManifest | undefined {
    const manifest = this.manifests.get(id);
    return manifest ? cloneManifest(manifest) : undefined;
  }

  list(status?: ResumableUploadStatus): ResumableUploadManifest[] {
    return [...this.manifests.values()]
      .filter((manifest) => !status || manifest.status === status)
      .map(cloneManifest);
  }

  private require(id: string): ResumableUploadManifest {
    const manifest = this.manifests.get(id);
    if (!manifest) throw new Error(`upload manifest not found: ${id}`);
    return manifest;
  }
}

function cloneManifest(manifest: ResumableUploadManifest): ResumableUploadManifest {
  return {
    ...manifest,
    chunks: manifest.chunks.map((chunk) => ({ ...chunk })),
  };
}
