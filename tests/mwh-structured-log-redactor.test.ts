import { describe, expect, it } from "vitest";
import {
  type RedactionPolicy,
  createStructuredLogEvent,
  logSnapshot,
  redactLogContext,
  stableLogJson,
} from "../src/mwh/modules/observability/structured-log-redactor/core.js";
import { MemoryStructuredLogSink } from "../src/mwh/modules/observability/structured-log-redactor/memory-sink.js";

const policy: RedactionPolicy = {
  redactedKeys: ["password", "authorization", "token"],
  redactedPaths: ["request.headers.cookie"],
  redactedPatterns: [/sk_live_[a-z0-9]+/gi],
  maxDepth: 3,
};

describe("structured-log-redactor MWH module", () => {
  it("redacts sensitive keys, paths, patterns, arrays, and deep values", () => {
    const result = createStructuredLogEvent({
      id: "log-1",
      level: "info",
      message: "using sk_live_abc123",
      timestampMs: 1000,
      policy,
      context: {
        userId: "u1",
        password: "secret",
        request: {
          headers: {
            authorization: "Bearer token",
            cookie: "sid=secret",
          },
        },
        nested: {
          token: "nested-token",
          items: [{ password: "array-secret" }],
        },
        deep: { a: { b: { c: "too-deep" } } },
      },
    });

    expect(result.event.message).toBe("using [REDACTED]");
    expect(result.event.context).toEqual({
      userId: "u1",
      password: "[REDACTED]",
      request: {
        headers: {
          authorization: "[REDACTED]",
          cookie: "[REDACTED]",
        },
      },
      nested: {
        token: "[REDACTED]",
        items: [{ password: "[REDACTED]" }],
      },
      deep: { a: { b: { c: "[TRUNCATED]" } } },
    });
    expect(result.redactedPaths).toEqual([
      "message",
      "password",
      "request.headers.authorization",
      "request.headers.cookie",
      "nested.token",
      "nested.items.0.password",
      "deep.a.b.c",
    ]);
  });

  it("redacts standalone contexts and produces stable JSON", () => {
    const result = redactLogContext(
      { b: 2, a: { token: "secret", value: 1 } },
      { redactedKeys: ["token"] },
    );

    expect(result.event.context).toEqual({ b: 2, a: { token: "[REDACTED]", value: 1 } });
    expect(stableLogJson(result.event)).toBe(
      '{"context":{"a":{"token":"[REDACTED]","value":1},"b":2},"id":"redacted-context","level":"info","message":"","timestampMs":0}',
    );
  });

  it("stores redacted logs in a clone-safe memory sink", () => {
    let now = 1000;
    const sink = new MemoryStructuredLogSink({ policy, now: () => now });

    const entry = sink.append({
      id: "log-2",
      level: "warn",
      message: "request failed",
      context: { authorization: "Bearer secret", route: "/pay" },
    });
    expect(entry.event.timestampMs).toBe(1000);
    expect(entry.event.context.authorization).toBe("[REDACTED]");
    expect(entry.redactedPaths).toEqual(["authorization"]);

    const leaked = sink.list();
    (leaked[0]!.event.context as { authorization: string }).authorization = "mutated";
    now = 1010;
    sink.append({
      id: "log-3",
      level: "error",
      message: "fatal sk_live_def456",
      context: { route: "/pay" },
    });

    expect(sink.list({ level: "warn" })[0]!.event.context.authorization).toBe("[REDACTED]");
    expect(sink.snapshot()).toEqual({
      total: 2,
      debug: 0,
      info: 0,
      warn: 1,
      error: 1,
      redacted: 2,
    });
  });

  it("rejects duplicate logs and summarizes redaction counts", () => {
    const sink = new MemoryStructuredLogSink({ policy, now: () => 1000 });
    sink.append({ id: "log-4", level: "info", message: "ok", context: { route: "/health" } });
    expect(() =>
      sink.append({ id: "log-4", level: "info", message: "duplicate", context: {} }),
    ).toThrow("structured log already exists");

    expect(
      logSnapshot([
        {
          event: createStructuredLogEvent({
            id: "log-5",
            level: "debug",
            message: "debug",
            timestampMs: 1000,
            context: {},
            policy,
          }).event,
          redactedPaths: [],
        },
      ]),
    ).toEqual({ total: 1, debug: 1, info: 0, warn: 0, error: 0, redacted: 0 });
  });
});
