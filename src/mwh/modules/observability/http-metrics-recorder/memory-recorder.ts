import {
  type HttpMetricBucket,
  type HttpMetricSample,
  type PendingHttpMetricRequest,
  aggregateHttpMetrics,
  createHttpMetricSample,
  finishHttpMetricRequest,
  startHttpMetricRequest,
} from "./core.js";

export interface HttpMetricsSnapshot {
  generatedAtMs: number;
  totalCount: number;
  errorCount: number;
  buckets: HttpMetricBucket[];
}

export interface MemoryHttpMetricsRecorderOptions {
  now?: () => number;
  maxSamples?: number;
}

export class MemoryHttpMetricsRecorder {
  private readonly now: () => number;
  private readonly maxSamples: number;
  private readonly samples: HttpMetricSample[] = [];
  private readonly pending = new Map<string, PendingHttpMetricRequest>();

  constructor(opts: MemoryHttpMetricsRecorderOptions = {}) {
    this.now = opts.now ?? Date.now;
    this.maxSamples = opts.maxSamples ?? 10_000;
    if (!Number.isInteger(this.maxSamples) || this.maxSamples <= 0) {
      throw new Error("maxSamples must be a positive integer");
    }
  }

  record(input: {
    route: string;
    method: string;
    statusCode: number;
    durationMs: number;
    error?: boolean;
    recordedAtMs?: number;
  }): HttpMetricSample {
    const sample = createHttpMetricSample({
      ...input,
      recordedAtMs: input.recordedAtMs ?? this.now(),
    });
    this.samples.push(sample);
    while (this.samples.length > this.maxSamples) {
      this.samples.shift();
    }
    return { ...sample };
  }

  startRequest(
    id: string,
    input: {
      route: string;
      method: string;
      startedAtMs?: number;
    },
  ): PendingHttpMetricRequest {
    assertRequestId(id);
    if (this.pending.has(id)) throw new Error(`request already started: ${id}`);
    const pending = startHttpMetricRequest({
      ...input,
      startedAtMs: input.startedAtMs ?? this.now(),
    });
    this.pending.set(id, pending);
    return { ...pending };
  }

  finishRequest(
    id: string,
    input: {
      statusCode: number;
      endedAtMs?: number;
      error?: boolean;
    },
  ): HttpMetricSample {
    assertRequestId(id);
    const pending = this.pending.get(id);
    if (!pending) throw new Error(`request not found: ${id}`);
    const sample = finishHttpMetricRequest(pending, {
      ...input,
      endedAtMs: input.endedAtMs ?? this.now(),
    });
    this.pending.delete(id);
    this.samples.push(sample);
    while (this.samples.length > this.maxSamples) {
      this.samples.shift();
    }
    return { ...sample };
  }

  listPending(): Array<PendingHttpMetricRequest & { id: string }> {
    return [...this.pending.entries()].map(([id, pending]) => ({ id, ...pending }));
  }

  snapshot(): HttpMetricsSnapshot {
    return {
      generatedAtMs: this.now(),
      totalCount: this.samples.length,
      errorCount: this.samples.filter((sample) => sample.error).length,
      buckets: aggregateHttpMetrics(this.samples),
    };
  }

  pruneBefore(cutoffMs: number): number {
    if (!Number.isInteger(cutoffMs) || cutoffMs < 0) {
      throw new Error("cutoffMs must be a non-negative integer");
    }
    const before = this.samples.length;
    for (let index = this.samples.length - 1; index >= 0; index -= 1) {
      if (this.samples[index]!.recordedAtMs < cutoffMs) {
        this.samples.splice(index, 1);
      }
    }
    return before - this.samples.length;
  }

  list(): HttpMetricSample[] {
    return this.samples.map((sample) => ({ ...sample }));
  }
}

function assertRequestId(id: string): void {
  if (!id.trim()) throw new Error("request id is required");
}
