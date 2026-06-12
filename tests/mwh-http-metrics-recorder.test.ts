import { describe, expect, it } from "vitest";
import {
  aggregateHttpMetricBucket,
  aggregateHttpMetrics,
  createHttpMetricSample,
  finishHttpMetricRequest,
  metricKey,
  metricKeyString,
  percentile,
  startHttpMetricRequest,
  statusClass,
} from "../src/mwh/modules/observability/http-metrics-recorder/core.js";
import { MemoryHttpMetricsRecorder } from "../src/mwh/modules/observability/http-metrics-recorder/memory-recorder.js";

describe("MWH http-metrics-recorder middleware", () => {
  it("normalizes samples, status classes, and metric keys", () => {
    const sample = createHttpMetricSample({
      route: "api/users/:id",
      method: "get",
      statusCode: 200,
      durationMs: 42,
      recordedAtMs: 1_000,
    });

    expect(sample).toEqual({
      route: "/api/users/:id",
      method: "GET",
      statusCode: 200,
      durationMs: 42,
      recordedAtMs: 1_000,
      error: false,
    });
    expect(statusClass(101)).toBe("1xx");
    expect(statusClass(302)).toBe("3xx");
    expect(statusClass(404)).toBe("4xx");
    expect(statusClass(500)).toBe("5xx");
    expect(metricKeyString(metricKey(sample))).toBe("GET /api/users/:id 2xx");
  });

  it("aggregates samples into deterministic buckets and percentiles", () => {
    const samples = [10, 20, 30, 40, 50].map((durationMs, index) =>
      createHttpMetricSample({
        route: "/api/users",
        method: "GET",
        statusCode: index === 4 ? 503 : 200,
        durationMs,
        recordedAtMs: 1_000 + index,
      }),
    );

    expect(percentile([10, 20, 30, 40, 50], 0.5)).toBe(30);
    expect(percentile([10, 20, 30, 40, 50], 0.95)).toBe(50);
    expect(
      aggregateHttpMetricBucket(
        { route: "/api/users", method: "GET", statusClass: "2xx" },
        samples,
      ),
    ).toEqual({
      key: { route: "/api/users", method: "GET", statusClass: "2xx" },
      count: 4,
      errorCount: 0,
      totalDurationMs: 100,
      minDurationMs: 10,
      maxDurationMs: 40,
      p50DurationMs: 20,
      p95DurationMs: 40,
    });
    expect(aggregateHttpMetrics(samples).map((bucket) => metricKeyString(bucket.key))).toEqual([
      "GET /api/users 2xx",
      "GET /api/users 5xx",
    ]);
  });

  it("rejects invalid metric inputs", () => {
    expect(() =>
      createHttpMetricSample({
        route: "/api",
        method: "GET",
        statusCode: 99,
        durationMs: 1,
        recordedAtMs: 1,
      }),
    ).toThrow("statusCode must be an integer between 100 and 599");
    expect(() => percentile([], 0.5)).toThrow("percentile requires at least one value");
    expect(() => percentile([1], 2)).toThrow("ratio must be between 0 and 1");
  });

  it("creates samples from a stateless request lifecycle", () => {
    const pending = startHttpMetricRequest({
      route: "api/orders/:id",
      method: "post",
      startedAtMs: 1_000,
    });
    const sample = finishHttpMetricRequest(pending, {
      statusCode: 201,
      endedAtMs: 1_125,
    });

    expect(pending).toEqual({
      route: "/api/orders/:id",
      method: "POST",
      startedAtMs: 1_000,
    });
    expect(sample).toEqual({
      route: "/api/orders/:id",
      method: "POST",
      statusCode: 201,
      durationMs: 125,
      recordedAtMs: 1_125,
      error: false,
    });
    expect(() => finishHttpMetricRequest(pending, { statusCode: 200, endedAtMs: 999 })).toThrow(
      "endedAtMs must be >= startedAtMs",
    );
  });

  it("records stateful samples and creates snapshots", () => {
    let now = 1_000;
    const recorder = new MemoryHttpMetricsRecorder({ now: () => now });

    recorder.record({ route: "/api/users", method: "GET", statusCode: 200, durationMs: 25 });
    now = 1_100;
    recorder.record({ route: "/api/users", method: "GET", statusCode: 503, durationMs: 80 });
    now = 1_200;
    recorder.record({
      route: "/api/users",
      method: "POST",
      statusCode: 400,
      durationMs: 10,
      error: true,
    });

    expect(recorder.snapshot()).toEqual({
      generatedAtMs: 1_200,
      totalCount: 3,
      errorCount: 2,
      buckets: [
        expect.objectContaining({
          key: { route: "/api/users", method: "GET", statusClass: "2xx" },
          count: 1,
        }),
        expect.objectContaining({
          key: { route: "/api/users", method: "GET", statusClass: "5xx" },
          errorCount: 1,
        }),
        expect.objectContaining({
          key: { route: "/api/users", method: "POST", statusClass: "4xx" },
          errorCount: 1,
        }),
      ],
    });
  });

  it("bounds memory retention and prunes old samples by time", () => {
    const recorder = new MemoryHttpMetricsRecorder({ maxSamples: 2 });
    recorder.record({
      route: "/first",
      method: "GET",
      statusCode: 200,
      durationMs: 1,
      recordedAtMs: 100,
    });
    recorder.record({
      route: "/second",
      method: "GET",
      statusCode: 200,
      durationMs: 2,
      recordedAtMs: 200,
    });
    recorder.record({
      route: "/third",
      method: "GET",
      statusCode: 200,
      durationMs: 3,
      recordedAtMs: 300,
    });

    expect(recorder.list().map((sample) => sample.route)).toEqual(["/second", "/third"]);
    expect(recorder.pruneBefore(250)).toBe(1);
    expect(recorder.list().map((sample) => sample.route)).toEqual(["/third"]);
  });

  it("tracks stateful request lifecycle and clears pending requests on finish", () => {
    let now = 1_000;
    const recorder = new MemoryHttpMetricsRecorder({ now: () => now });

    expect(
      recorder.startRequest("req-1", {
        route: "/api/orders/:id",
        method: "GET",
      }),
    ).toEqual({
      route: "/api/orders/:id",
      method: "GET",
      startedAtMs: 1_000,
    });
    expect(recorder.listPending()).toEqual([
      { id: "req-1", route: "/api/orders/:id", method: "GET", startedAtMs: 1_000 },
    ]);
    expect(() =>
      recorder.startRequest("req-1", { route: "/api/orders/:id", method: "GET" }),
    ).toThrow("request already started: req-1");

    now = 1_240;
    expect(recorder.finishRequest("req-1", { statusCode: 502 })).toEqual({
      route: "/api/orders/:id",
      method: "GET",
      statusCode: 502,
      durationMs: 240,
      recordedAtMs: 1_240,
      error: true,
    });
    expect(recorder.listPending()).toEqual([]);
    expect(() => recorder.finishRequest("missing", { statusCode: 200 })).toThrow(
      "request not found: missing",
    );
    expect(recorder.snapshot().buckets).toEqual([
      expect.objectContaining({
        key: { route: "/api/orders/:id", method: "GET", statusClass: "5xx" },
        count: 1,
        errorCount: 1,
      }),
    ]);
  });
});
