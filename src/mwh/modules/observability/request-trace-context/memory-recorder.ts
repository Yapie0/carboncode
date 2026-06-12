import {
  type SpanRecord,
  type TraceContext,
  cloneSpanRecord,
  createChildTraceContext,
  createRootTraceContext,
  endSpan,
  extractOrCreateTraceContext,
  startSpan,
} from "./core.js";

export interface MemoryTraceRecorderOptions {
  now?: () => number;
  idFactory?: (bytes: number) => string;
}

export class MemoryTraceRecorder {
  private readonly now: () => number;
  private readonly idFactory?: (bytes: number) => string;
  private readonly spans = new Map<string, SpanRecord>();

  constructor(opts: MemoryTraceRecorderOptions = {}) {
    this.now = opts.now ?? Date.now;
    this.idFactory = opts.idFactory;
  }

  rootSpan(input: {
    name: string;
    sampled?: boolean;
    attributes?: SpanRecord["attributes"];
  }): SpanRecord {
    const context = createRootTraceContext({ sampled: input.sampled, idFactory: this.idFactory });
    return this.start(context, input.name, input.attributes);
  }

  requestSpan(input: {
    name: string;
    headers: Record<string, string | undefined>;
    sampled?: boolean;
    allowedBaggageKeys?: readonly string[];
    attributes?: SpanRecord["attributes"];
  }): SpanRecord {
    const context = extractOrCreateTraceContext({
      traceparent: input.headers.traceparent,
      baggage: input.headers.baggage,
      sampled: input.sampled,
      idFactory: this.idFactory,
      allowedBaggageKeys: input.allowedBaggageKeys,
    });
    return this.start(context, input.name, input.attributes);
  }

  childSpan(input: {
    parent: TraceContext;
    name: string;
    sampled?: boolean;
    attributes?: SpanRecord["attributes"];
  }): SpanRecord {
    const context = createChildTraceContext({
      parent: input.parent,
      sampled: input.sampled,
      idFactory: this.idFactory,
    });
    return this.start(context, input.name, input.attributes);
  }

  start(context: TraceContext, name: string, attributes?: SpanRecord["attributes"]): SpanRecord {
    const span = startSpan({ context, name, startedAtMs: this.now(), attributes });
    this.spans.set(span.spanId, span);
    return cloneSpanRecord(span);
  }

  end(
    spanId: string,
    input: { status?: "ok" | "error"; attributes?: SpanRecord["attributes"] } = {},
  ): SpanRecord {
    const span = this.spans.get(spanId);
    if (!span) throw new Error(`unknown span: ${spanId}`);
    const next = endSpan(span, { endedAtMs: this.now(), ...input });
    this.spans.set(spanId, next);
    return cloneSpanRecord(next);
  }

  list(): SpanRecord[] {
    return [...this.spans.values()].map(cloneSpanRecord);
  }

  listByTrace(traceId: string): SpanRecord[] {
    return this.list().filter((span) => span.traceId === traceId);
  }
}
