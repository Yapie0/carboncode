import {
  type MultipartCompletionPlan,
  type MultipartSessionSnapshot,
  type MultipartUploadPolicy,
  type MultipartUploadSession,
  abortMultipartSession,
  cloneMultipartSession,
  completeMultipartSession,
  createMultipartSession,
  expireMultipartSession,
  multipartSessionProgress,
  multipartSessionSnapshot,
  nextMultipartPartNumber,
  planMultipartCompletion,
  recordMultipartPart,
} from "./core.js";

export interface MemoryMultipartUploadStoreOptions {
  policy: MultipartUploadPolicy;
  now?: () => number;
}

export class MemoryMultipartUploadStore {
  private sessions = new Map<string, MultipartUploadSession>();
  private readonly policy: MultipartUploadPolicy;
  private readonly now: () => number;

  constructor(options: MemoryMultipartUploadStoreOptions) {
    this.policy = { ...options.policy };
    this.now = options.now ?? Date.now;
  }

  create(input: {
    uploadId: string;
    objectKey: string;
    totalBytes: number;
    expectedParts: number;
  }): MultipartUploadSession {
    if (this.sessions.has(input.uploadId)) throw new Error("session already exists");
    const session = createMultipartSession({ ...input, nowMs: this.now(), policy: this.policy });
    this.sessions.set(session.uploadId, session);
    return cloneMultipartSession(session);
  }

  recordPart(input: {
    uploadId: string;
    partNumber: number;
    sizeBytes: number;
    checksum: string;
    etag: string;
  }): MultipartUploadSession {
    const updated = recordMultipartPart(this.requireSession(input.uploadId), {
      ...input,
      nowMs: this.now(),
      policy: this.policy,
    });
    this.sessions.set(updated.uploadId, updated);
    return cloneMultipartSession(updated);
  }

  completionPlan(uploadId: string): MultipartCompletionPlan {
    return planMultipartCompletion(this.requireSession(uploadId));
  }

  progress(uploadId: string): ReturnType<typeof multipartSessionProgress> {
    return multipartSessionProgress(this.requireSession(uploadId));
  }

  nextPartNumber(uploadId: string): number | undefined {
    return nextMultipartPartNumber(this.requireSession(uploadId));
  }

  complete(uploadId: string): MultipartUploadSession {
    const updated = completeMultipartSession(this.requireSession(uploadId), this.now());
    this.sessions.set(uploadId, updated);
    return cloneMultipartSession(updated);
  }

  abort(uploadId: string, reason: string): MultipartUploadSession {
    const updated = abortMultipartSession(this.requireSession(uploadId), {
      nowMs: this.now(),
      reason,
    });
    this.sessions.set(uploadId, updated);
    return cloneMultipartSession(updated);
  }

  expireOpen(): void {
    for (const session of this.sessions.values()) {
      const updated = expireMultipartSession(session, this.now());
      this.sessions.set(updated.uploadId, updated);
    }
  }

  snapshot(): MultipartSessionSnapshot {
    return multipartSessionSnapshot([...this.sessions.values()]);
  }

  listSessions(): MultipartUploadSession[] {
    return [...this.sessions.values()].map(cloneMultipartSession);
  }

  private requireSession(uploadId: string): MultipartUploadSession {
    const session = this.sessions.get(uploadId);
    if (!session) throw new Error("session not found");
    return cloneMultipartSession(session);
  }
}
