import { describe, expect, it } from "vitest";
import {
  finishExpressRequestSpan,
  normalizeRoute,
  shouldSampleRequest,
  startExpressRequestSpan,
} from "../src/mwh/modules/observability/otel-express-node/core.js";
import { MemoryOtelExpressExporter } from "../src/mwh/modules/observability/otel-express-node/memory-exporter.js";

describe("MWH otel-express-node stateless core", () => {
  it("starts request spans with HTTP attributes and traceparent propagation", () => {
    const ids = ["aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "bbbbbbbbbbbbbbbb"];
    const trace = startExpressRequestSpan({
      method: "get",
      route: "api/users/:id",
      nowMs: 1_000,
      idFactory: () => ids.shift()!,
      attributes: { "service.name": "api" },
    });

    expect(trace.context).toEqual({
      traceId: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      spanId: "bbbbbbbbbbbbbbbb",
      sampled: true,
    });
    expect(trace.responseHeaders.traceparent).toBe(
      "00-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-bbbbbbbbbbbbbbbb-01",
    );
    expect(trace.span).toEqual(
      expect.objectContaining({
        name: "GET /api/users/:id",
        startedAtMs: 1_000,
        attributes: expect.objectContaining({
          "http.method": "GET",
          "http.route": "/api/users/:id",
          "span.kind": "server",
          "service.name": "api",
        }),
      }),
    );
  });

  it("continues incoming traceparent as a child span", () => {
    const trace = startExpressRequestSpan({
      method: "POST",
      route: "/api/items",
      traceparent: "00-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-bbbbbbbbbbbbbbbb-01",
      nowMs: 1_000,
      idFactory: () => "cccccccccccccccc",
    });

    expect(trace.context).toEqual({
      traceId: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      parentId: "bbbbbbbbbbbbbbbb",
      spanId: "cccccccccccccccc",
      sampled: true,
    });
  });

  it("finishes spans with status and error attributes", () => {
    const trace = startExpressRequestSpan({
      method: "GET",
      route: "/api",
      nowMs: 1_000,
      idFactory: (bytes) => (bytes === 16 ? "a".repeat(32) : "b".repeat(16)),
    });

    expect(
      finishExpressRequestSpan(trace.span, {
        statusCode: 503,
        endedAtMs: 1_050,
        error: new Error("database unavailable"),
      }),
    ).toEqual(
      expect.objectContaining({
        status: "error",
        durationMs: 50,
        attributes: expect.objectContaining({
          "http.status_code": 503,
          "error.type": "Error",
          "error.message": "database unavailable",
        }),
      }),
    );
    expect(() =>
      finishExpressRequestSpan(trace.span, { statusCode: 99, endedAtMs: 1_050 }),
    ).toThrow("statusCode must be an integer between 100 and 599");
  });

  it("normalizes routes and makes deterministic sampling decisions", () => {
    expect(normalizeRoute("api/users")).toBe("/api/users");
    expect(shouldSampleRequest({ route: "/api", method: "GET", sampleRate: 0, hash: 0 })).toBe(
      false,
    );
    expect(shouldSampleRequest({ route: "/api", method: "GET", sampleRate: 1, hash: 9999 })).toBe(
      true,
    );
    expect(
      shouldSampleRequest({ route: "/api", method: "GET", sampleRate: 0.5, hash: 4_999 }),
    ).toBe(true);
    expect(
      shouldSampleRequest({ route: "/api", method: "GET", sampleRate: 0.5, hash: 5_000 }),
    ).toBe(false);
  });
});

describe("MWH otel-express-node stateful memory exporter", () => {
  it("begins, finishes, flushes, and clears request spans", () => {
    let now = 1_000;
    const ids = ["aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "bbbbbbbbbbbbbbbb"];
    const exporter = new MemoryOtelExpressExporter({
      now: () => now,
      idFactory: () => ids.shift()!,
    });

    const started = exporter.beginRequest("req-1", { method: "GET", route: "/api/users" });
    expect(started.responseHeaders.traceparent).toBe(
      "00-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-bbbbbbbbbbbbbbbb-01",
    );
    expect(exporter.listPending()).toHaveLength(1);
    now = 1_025;
    expect(exporter.finishRequest({ requestId: "req-1", statusCode: 200 })).toEqual(
      expect.objectContaining({
        name: "GET /api/users",
        status: "ok",
        durationMs: 25,
      }),
    );
    expect(exporter.listPending()).toEqual([]);
    expect(exporter.listFinished()).toHaveLength(1);
    expect(exporter.flush()).toHaveLength(1);
    expect(exporter.listFinished()).toEqual([]);
  });

  it("rejects duplicate pending requests and returns clone-safe state", () => {
    const exporter = new MemoryOtelExpressExporter({
      idFactory: (bytes) => (bytes === 16 ? "a".repeat(32) : "b".repeat(16)),
    });
    const started = exporter.beginRequest("req-1", { method: "GET", route: "/api" });
    started.span.attributes["http.route"] = "/mutated";

    expect(() => exporter.beginRequest("req-1", { method: "GET", route: "/api" })).toThrow(
      "request already pending",
    );
    expect(exporter.listPending()[0]?.span.attributes["http.route"]).toBe("/api");
    expect(() => exporter.finishRequest({ requestId: "missing", statusCode: 200 })).toThrow(
      "request not pending",
    );
  });
});
