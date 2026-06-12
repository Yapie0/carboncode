import { describe, expect, it } from "vitest";
import {
  cloneSpanRecord,
  cloneTraceContext,
  createChildTraceContext,
  createRootTraceContext,
  endSpan,
  extractOrCreateTraceContext,
  formatBaggage,
  formatTraceparent,
  injectTraceHeaders,
  parseBaggage,
  parseTraceparent,
  startSpan,
} from "../src/mwh/modules/observability/request-trace-context/core.js";
import { MemoryTraceRecorder } from "../src/mwh/modules/observability/request-trace-context/memory-recorder.js";

describe("MWH request-trace-context middleware", () => {
  const ids = [
    "11111111111111111111111111111111",
    "2222222222222222",
    "3333333333333333",
    "4444444444444444",
  ];

  it("parses and formats W3C traceparent headers", () => {
    const parsed = parseTraceparent("00-11111111111111111111111111111111-2222222222222222-01");

    expect(parsed).toEqual({
      traceId: "11111111111111111111111111111111",
      parentId: "2222222222222222",
      spanId: "2222222222222222",
      sampled: true,
    });
    expect(formatTraceparent(parsed!)).toBe(
      "00-11111111111111111111111111111111-2222222222222222-01",
    );
    expect(
      parseTraceparent("00-00000000000000000000000000000000-2222222222222222-01"),
    ).toBeUndefined();
    expect(parseTraceparent("bad")).toBeUndefined();
  });

  it("creates root and child contexts with deterministic ids", () => {
    let index = 0;
    const idFactory = () => ids[index++];
    const root = createRootTraceContext({ sampled: false, idFactory });
    root.baggage = { tenant: "t1" };
    const child = createChildTraceContext({ parent: root, idFactory });
    child.baggage!.tenant = "mutated";

    expect(root).toEqual({
      traceId: "11111111111111111111111111111111",
      spanId: "2222222222222222",
      sampled: false,
      baggage: { tenant: "t1" },
    });
    expect(child).toEqual({
      traceId: root.traceId,
      parentId: root.spanId,
      spanId: "3333333333333333",
      sampled: false,
      baggage: { tenant: "mutated" },
    });
    const clonedContext = cloneTraceContext(root);
    clonedContext.baggage!.tenant = "mutated-again";
    expect(root.baggage).toEqual({ tenant: "t1" });
    expect(injectTraceHeaders(child)).toEqual({
      traceparent: "00-11111111111111111111111111111111-3333333333333333-00",
      baggage: "tenant=mutated",
    });
  });

  it("parses, filters, formats, and injects baggage headers", () => {
    expect(parseBaggage("tenant=t1,user=ada,secret=drop", ["tenant", "user"])).toEqual({
      tenant: "t1",
      user: "ada",
    });
    expect(formatBaggage({ user: "Ada Lovelace", tenant: "t1" })).toBe(
      "tenant=t1,user=Ada%20Lovelace",
    );

    const context = extractOrCreateTraceContext({
      traceparent: "00-11111111111111111111111111111111-2222222222222222-01",
      baggage: "tenant=t1,secret=drop",
      allowedBaggageKeys: ["tenant"],
      idFactory: () => "3333333333333333",
    });
    expect(context).toEqual({
      traceId: "11111111111111111111111111111111",
      parentId: "2222222222222222",
      spanId: "3333333333333333",
      sampled: true,
      baggage: { tenant: "t1" },
    });
    expect(injectTraceHeaders(context)).toEqual({
      traceparent: "00-11111111111111111111111111111111-3333333333333333-01",
      baggage: "tenant=t1",
    });
  });

  it("starts and ends spans with duration, status, and merged attributes", () => {
    const span = startSpan({
      context: {
        traceId: "11111111111111111111111111111111",
        parentId: "2222222222222222",
        spanId: "3333333333333333",
        sampled: true,
      },
      name: "GET /users",
      startedAtMs: 1_000,
      attributes: { route: "/users" },
    });

    expect(span).toEqual(
      expect.objectContaining({
        traceId: "11111111111111111111111111111111",
        spanId: "3333333333333333",
        parentId: "2222222222222222",
        status: "unset",
      }),
    );
    expect(
      endSpan(span, { endedAtMs: 1_250, status: "ok", attributes: { statusCode: 200 } }),
    ).toEqual(
      expect.objectContaining({
        endedAtMs: 1_250,
        durationMs: 250,
        status: "ok",
        attributes: { route: "/users", statusCode: 200 },
      }),
    );
    const cloned = cloneSpanRecord(span);
    cloned.attributes.route = "/mutated";
    expect(span.attributes).toEqual({ route: "/users" });
  });

  it("records root and child spans in a stateful memory recorder", () => {
    let now = 1_000;
    let index = 0;
    const idFactory = () => ids[index++];
    const recorder = new MemoryTraceRecorder({ now: () => now, idFactory });

    const root = recorder.rootSpan({ name: "request", attributes: { route: "/api" } });
    root.attributes.route = "/mutated";
    expect(recorder.list()[0]?.attributes).toEqual({ route: "/api" });
    now = 1_050;
    const child = recorder.childSpan({
      parent: { traceId: root.traceId, spanId: root.spanId, sampled: true },
      name: "db.query",
      attributes: { db: "main" },
    });
    now = 1_080;
    recorder.end(child.spanId, { status: "ok" });
    now = 1_100;
    recorder.end(root.spanId, { status: "error", attributes: { error: true } });
    const listed = recorder.list();
    listed[0]!.attributes.route = "/mutated-again";

    expect(recorder.list()).toHaveLength(2);
    expect(recorder.listByTrace(root.traceId)).toEqual([
      expect.objectContaining({ name: "request", durationMs: 100, status: "error" }),
      expect.objectContaining({ name: "db.query", durationMs: 30, status: "ok" }),
    ]);
  });

  it("starts request spans from inbound trace headers and filtered baggage", () => {
    let now = 1_000;
    const recorder = new MemoryTraceRecorder({
      now: () => now,
      idFactory: () => "3333333333333333",
    });

    const span = recorder.requestSpan({
      name: "GET /users",
      headers: {
        traceparent: "00-11111111111111111111111111111111-2222222222222222-01",
        baggage: "tenant=t1,secret=drop",
      },
      allowedBaggageKeys: ["tenant"],
      attributes: { route: "/users" },
    });
    now = 1_125;
    recorder.end(span.spanId, { status: "ok" });

    expect(recorder.listByTrace("11111111111111111111111111111111")).toEqual([
      expect.objectContaining({
        name: "GET /users",
        parentId: "2222222222222222",
        durationMs: 125,
        attributes: { route: "/users" },
      }),
    ]);
  });

  it("rejects spans that end before they start", () => {
    const span = startSpan({
      context: {
        traceId: "11111111111111111111111111111111",
        spanId: "2222222222222222",
        sampled: true,
      },
      name: "work",
      startedAtMs: 100,
    });

    expect(() => endSpan(span, { endedAtMs: 99 })).toThrow("endedAtMs must be >= startedAtMs");
  });
});
