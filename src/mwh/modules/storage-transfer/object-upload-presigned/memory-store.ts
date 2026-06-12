import {
  type CompleteUploadResult,
  type UploadPartPlan,
  type UploadSession,
  abortUploadSession,
  cloneCompleteUploadResult,
  cloneUploadSession,
  completeUploadSession,
  createUploadSession,
  expireUploadSession,
  missingUploadParts,
  nextUploadPart,
  planMultipartUpload,
  recordUploadedPart,
  uploadSessionProgress,
} from "./core.js";

export interface PresignedPart extends UploadPartPlan {
  method: "PUT";
  url: string;
  expiresAtMs: number;
}

export interface MemoryUploadStoreOptions {
  now?: () => number;
  ttlMs: number;
  signPartUrl?: (input: {
    uploadId: string;
    objectKey: string;
    partNumber: number;
    expiresAtMs: number;
  }) => string;
}

export class MemoryUploadStore {
  private readonly now: () => number;
  private readonly ttlMs: number;
  private readonly signPartUrl: NonNullable<MemoryUploadStoreOptions["signPartUrl"]>;
  private readonly sessions = new Map<string, UploadSession>();

  constructor(opts: MemoryUploadStoreOptions) {
    this.now = opts.now ?? Date.now;
    this.ttlMs = opts.ttlMs;
    this.signPartUrl =
      opts.signPartUrl ??
      ((input) =>
        `https://upload.local/${encodeURIComponent(input.objectKey)}?uploadId=${encodeURIComponent(
          input.uploadId,
        )}&partNumber=${input.partNumber}`);
  }

  initiate(input: {
    uploadId: string;
    objectKey: string;
    contentType: string;
    totalBytes: number;
    partSizeBytes: number;
  }): UploadSession {
    if (this.sessions.has(input.uploadId))
      throw new Error(`upload already exists: ${input.uploadId}`);
    const session = createUploadSession({ ...input, nowMs: this.now(), ttlMs: this.ttlMs });
    this.sessions.set(session.uploadId, session);
    return cloneUploadSession(session);
  }

  signParts(uploadId: string): PresignedPart[] {
    const session = this.require(uploadId);
    const expiresAtMs = session.expiresAtMs;
    return planMultipartUpload(session.totalBytes, session.partSizeBytes).map((part) => ({
      ...part,
      method: "PUT",
      expiresAtMs,
      url: this.signPartUrl({
        uploadId: session.uploadId,
        objectKey: session.objectKey,
        partNumber: part.partNumber,
        expiresAtMs,
      }),
    }));
  }

  signMissingParts(uploadId: string): PresignedPart[] {
    const session = this.require(uploadId);
    const expiresAtMs = session.expiresAtMs;
    return missingUploadParts(session).map((part) => ({
      ...part,
      method: "PUT",
      expiresAtMs,
      url: this.signPartUrl({
        uploadId: session.uploadId,
        objectKey: session.objectKey,
        partNumber: part.partNumber,
        expiresAtMs,
      }),
    }));
  }

  progress(uploadId: string) {
    return uploadSessionProgress(this.require(uploadId));
  }

  nextPart(uploadId: string) {
    return nextUploadPart(this.require(uploadId));
  }

  recordPart(uploadId: string, partNumber: number, etag: string): UploadSession {
    const next = recordUploadedPart(this.require(uploadId), partNumber, etag, this.now());
    this.sessions.set(uploadId, next);
    return cloneUploadSession(next);
  }

  complete(uploadId: string): CompleteUploadResult {
    const result = completeUploadSession(this.require(uploadId), this.now());
    this.sessions.set(uploadId, result.session);
    return cloneCompleteUploadResult(result);
  }

  abort(uploadId: string): UploadSession {
    const next = abortUploadSession(this.require(uploadId), this.now());
    this.sessions.set(uploadId, next);
    return cloneUploadSession(next);
  }

  expireDue(): number {
    let expired = 0;
    for (const [uploadId, session] of this.sessions) {
      const next = expireUploadSession(session, this.now());
      if (next !== session) {
        this.sessions.set(uploadId, next);
        expired++;
      }
    }
    return expired;
  }

  get(uploadId: string): UploadSession | undefined {
    const session = this.sessions.get(uploadId);
    return session ? cloneUploadSession(session) : undefined;
  }

  private require(uploadId: string): UploadSession {
    const session = this.sessions.get(uploadId);
    if (!session) throw new Error(`upload session not found: ${uploadId}`);
    return session;
  }
}
