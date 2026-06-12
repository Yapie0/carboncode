import { describe, expect, it } from "vitest";
import {
  corsRequestFromHttp,
  evaluateCorsRequest,
  mergeCorsPolicies,
  normalizeCorsPolicy,
  parseAccessControlRequestHeaders,
} from "../src/mwh/modules/api-traffic/cors-policy/core.js";
import { MemoryCorsPolicyRegistry } from "../src/mwh/modules/api-traffic/cors-policy/memory-registry.js";

const policy = {
  routeId: "api.users",
  allowedOrigins: ["https://app.example.com/"],
  allowedMethods: ["get", "post"],
  allowedHeaders: ["authorization", "content-type"],
  exposedHeaders: ["x-request-id"],
  allowCredentials: true,
  maxAgeSeconds: 600,
};

describe("MWH cors-policy middleware", () => {
  it("normalizes policies and rejects wildcard origins with credentials", () => {
    expect(normalizeCorsPolicy(policy)).toEqual({
      routeId: "api.users",
      allowedOrigins: ["https://app.example.com"],
      allowedMethods: ["GET", "POST"],
      allowedHeaders: ["authorization", "content-type"],
      exposedHeaders: ["x-request-id"],
      allowCredentials: true,
      maxAgeSeconds: 600,
    });
    expect(() =>
      normalizeCorsPolicy({
        routeId: "api.public",
        allowedOrigins: ["*"],
        allowedMethods: ["GET"],
        allowedHeaders: ["*"],
        allowCredentials: true,
      }),
    ).toThrow("wildcard origin cannot be used with credentials");
  });

  it("evaluates preflight and actual CORS decisions", () => {
    expect(
      evaluateCorsRequest(policy, {
        routeId: "api.users",
        origin: "https://app.example.com",
        method: "POST",
        requestHeaders: ["Authorization"],
        preflight: true,
      }),
    ).toEqual({
      kind: "allow",
      routeId: "api.users",
      statusCode: 204,
      headers: {
        "access-control-allow-origin": "https://app.example.com",
        "access-control-allow-credentials": "true",
        "access-control-allow-methods": "GET, POST",
        "access-control-allow-headers": "authorization, content-type",
        "access-control-max-age": "600",
        vary: "Origin",
      },
    });
    expect(
      evaluateCorsRequest(policy, {
        routeId: "api.users",
        origin: "https://app.example.com",
        method: "GET",
      }),
    ).toEqual(
      expect.objectContaining({
        kind: "allow",
        statusCode: 200,
        headers: expect.objectContaining({
          "access-control-expose-headers": "x-request-id",
        }),
      }),
    );
    expect(evaluateCorsRequest(policy, { routeId: "api.users", method: "GET" })).toEqual({
      kind: "allow",
      routeId: "api.users",
      statusCode: 200,
      headers: {
        "access-control-allow-credentials": "true",
        "access-control-expose-headers": "x-request-id",
      },
    });
  });

  it("rejects origin, method, header, and route mismatches", () => {
    expect(
      evaluateCorsRequest(policy, {
        routeId: "api.users",
        origin: "https://evil.example.com",
        method: "GET",
      }),
    ).toEqual(
      expect.objectContaining({ kind: "reject", statusCode: 403, reason: "origin-not-allowed" }),
    );
    expect(
      evaluateCorsRequest(policy, {
        routeId: "api.users",
        origin: "https://app.example.com",
        method: "DELETE",
      }),
    ).toEqual(
      expect.objectContaining({ kind: "reject", statusCode: 405, reason: "method-not-allowed" }),
    );
    expect(
      evaluateCorsRequest(policy, {
        routeId: "api.users",
        origin: "https://app.example.com",
        method: "POST",
        requestHeaders: ["x-admin"],
      }),
    ).toEqual(
      expect.objectContaining({ kind: "reject", statusCode: 400, reason: "headers-not-allowed" }),
    );
    expect(evaluateCorsRequest(policy, { routeId: "wrong", method: "GET" })).toEqual(
      expect.objectContaining({ kind: "reject", statusCode: 404, reason: "route-mismatch" }),
    );
    expect(parseAccessControlRequestHeaders(" Authorization, X-Request-ID ")).toEqual([
      "authorization",
      "x-request-id",
    ]);
  });

  it("builds CORS requests from HTTP headers and merges policies", () => {
    expect(
      corsRequestFromHttp({
        routeId: "api.users",
        method: "OPTIONS",
        headers: {
          Origin: "https://app.example.com",
          "Access-Control-Request-Method": "POST",
          "Access-Control-Request-Headers": "Authorization, Content-Type",
        },
      }),
    ).toEqual({
      routeId: "api.users",
      origin: "https://app.example.com",
      method: "POST",
      requestHeaders: ["authorization", "content-type"],
      preflight: true,
    });
    expect(mergeCorsPolicies(policy, { allowedMethods: ["GET"], maxAgeSeconds: 60 })).toEqual(
      expect.objectContaining({
        allowedMethods: ["GET"],
        maxAgeSeconds: 60,
        allowedOrigins: ["https://app.example.com"],
      }),
    );
  });

  it("runs stateful register, evaluate, remove, list, and clone-safe registry flows", () => {
    const registry = new MemoryCorsPolicyRegistry();
    const registered = registry.register(policy);
    registered.allowedOrigins.push("https://mutated.example.com");

    expect(registry.get("api.users")?.allowedOrigins).toEqual(["https://app.example.com"]);
    expect(
      registry.evaluate({
        routeId: "api.users",
        origin: "https://app.example.com",
        method: "GET",
      }),
    ).toEqual(expect.objectContaining({ kind: "allow", statusCode: 200 }));
    expect(registry.evaluate({ routeId: "missing", method: "GET" })).toEqual(
      expect.objectContaining({ kind: "reject", reason: "route-mismatch" }),
    );
    expect(registry.list().map((item) => item.routeId)).toEqual(["api.users"]);
    expect(
      registry.evaluateHttp({
        routeId: "api.users",
        method: "OPTIONS",
        headers: {
          origin: "https://app.example.com",
          "access-control-request-method": "POST",
        },
      }),
    ).toEqual(expect.objectContaining({ kind: "allow", statusCode: 204 }));
    expect(registry.extend("api.users", { allowedMethods: ["GET"] }).allowedMethods).toEqual([
      "GET",
    ]);
    expect(registry.decisionHistory().map((decision) => decision.kind)).toEqual([
      "allow",
      "reject",
      "allow",
    ]);
    expect(registry.remove("api.users")).toBe(true);
    expect(registry.get("api.users")).toBeUndefined();
  });
});
