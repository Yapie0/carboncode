import type { SpanRecord } from "../request-trace-context/core.js";
import {
  type ExpressRequestSpanInput,
  type ExpressRequestTrace,
  finishExpressRequestSpan,
  startExpressRequestSpan,
} from "./core.js";

export interface MemoryOtelExpressExporterOptions {
  now?: () => number;
  idFactory?: (bytes: number) => string;
}

export interface FinishExpressRequestInput {
  requestId: string;
  statusCode: number;
  error?: Error | string;
  attributes?: Record<string, string | number | boolean>;
}

export class MemoryOtelExpressExporter {
  private readonly now: () => number;
  private readonly idFactory?: (bytes: number) => string;
  private readonly pending = new Map<string, ExpressRequestTrace>();
  private readonly spans: SpanRecord[] = [];

  constructor(options: MemoryOtelExpressExporterOptions = {}) {
    this.now = options.now ?? Date.now;
    this.idFactory = options.idFactory;
  }

  beginRequest(
    requestId: string,
    input: Omit<ExpressRequestSpanInput, "nowMs" | "idFactory">,
  ): ExpressRequestTrace {
    if (this.pending.has(requestId)) throw new Error(`request already pending: ${requestId}`);
    const trace = startExpressRequestSpan({
      ...input,
      nowMs: this.now(),
      idFactory: this.idFactory,
    });
    this.pending.set(requestId, trace);
    return cloneTrace(trace);
  }

  finishRequest(input: FinishExpressRequestInput): SpanRecord {
    const trace = this.pending.get(input.requestId);
    if (!trace) throw new Error(`request not pending: ${input.requestId}`);
    const span = finishExpressRequestSpan(trace.span, {
      statusCode: input.statusCode,
      error: input.error,
      endedAtMs: this.now(),
      attributes: input.attributes,
    });
    this.pending.delete(input.requestId);
    this.spans.push(span);
    return { ...span, attributes: { ...span.attributes } };
  }

  flush(): SpanRecord[] {
    const exported = this.spans.map((span) => ({ ...span, attributes: { ...span.attributes } }));
    this.spans.length = 0;
    return exported;
  }

  listFinished(): SpanRecord[] {
    return this.spans.map((span) => ({ ...span, attributes: { ...span.attributes } }));
  }

  listPending(): ExpressRequestTrace[] {
    return [...this.pending.values()].map(cloneTrace);
  }
}

function cloneTrace(trace: ExpressRequestTrace): ExpressRequestTrace {
  return {
    context: { ...trace.context },
    span: { ...trace.span, attributes: { ...trace.span.attributes } },
    responseHeaders: { ...trace.responseHeaders },
  };
}
