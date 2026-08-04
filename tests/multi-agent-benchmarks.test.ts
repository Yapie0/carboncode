import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { MultiAgentCandidateConfig, MultiAgentRole } from "../src/config.js";
import type { BenchmarkResult } from "../src/multi-agent/benchmarks.js";
import {
  assignRolesByBenchmark,
  mergeBenchmarkResults,
  readBenchmarkStore,
  scoreBenchmarkResponse,
  writeBenchmarkStore,
} from "../src/multi-agent/benchmarks.js";

const candidates: MultiAgentCandidateConfig[] = [
  { id: "fast", provider: "openai", model: "fast-model" },
  { id: "strong", provider: "deepseek", model: "strong-model" },
];

function result(
  candidateId: string,
  role: MultiAgentRole,
  score: number,
  latencyMs: number,
): BenchmarkResult {
  const candidate = candidates.find((item) => item.id === candidateId)!;
  return {
    candidateId,
    provider: candidate.provider,
    model: candidate.model,
    role,
    score,
    latencyMs,
    usage: {
      promptTokens: 10,
      completionTokens: 5,
      totalTokens: 15,
      promptCacheHitTokens: 0,
    },
    measuredAt: "2026-08-04T00:00:00.000Z",
    details: [],
  };
}

describe("multi-agent benchmarks", () => {
  it("scores structured role responses with deterministic rubrics", () => {
    const design = scoreBenchmarkResponse(
      "design",
      JSON.stringify({
        components: ["provider registry", "role isolation", "benchmark store", "runner"],
        risks: ["secret exposure", "write collision", "stale benchmark"],
        verification: ["unit test", "rollback test", "isolated worktree test"],
      }),
    );
    const invalid = scoreBenchmarkResponse("testing", "not-json");

    expect(design.score).toBeGreaterThanOrEqual(70);
    expect(invalid).toEqual({ score: 0, details: ["response was not a JSON object"] });
  });

  it("assigns every role by measured score with deterministic tie breaks", () => {
    const results: BenchmarkResult[] = [];
    for (const role of ["design", "implementation", "testing", "acceptance"] as const) {
      results.push(result("fast", role, 80, 100));
      results.push(result("strong", role, role === "implementation" ? 95 : 80, 200));
    }

    const assignments = assignRolesByBenchmark(candidates, results, {}, 2);

    expect(assignments.map((item) => [item.role, item.candidate.id])).toEqual([
      ["design", "fast"],
      ["implementation", "strong"],
      ["testing", "fast"],
      ["acceptance", "strong"],
    ]);
  });

  it("honors explicit role overrides without fabricating a benchmark", () => {
    const results = [
      result("fast", "implementation", 70, 100),
      result("fast", "testing", 70, 100),
      result("fast", "acceptance", 70, 100),
    ];
    const assignments = assignRolesByBenchmark(candidates, results, { design: "strong" }, 0);

    expect(assignments[0]).toMatchObject({
      role: "design",
      candidate: { id: "strong" },
      source: "override",
    });
    expect(assignments[0]?.benchmark).toBeUndefined();
  });

  it("fails closed when a role has no successful measurement", () => {
    expect(() => assignRolesByBenchmark(candidates, [], {}, 0)).toThrow(
      /no successful benchmark result for design/,
    );
  });

  it("atomically persists and replaces candidate-role measurements", () => {
    const root = mkdtempSync(join(tmpdir(), "carboncode-benchmark-"));
    const path = join(root, "benchmarks.json");
    const initial = mergeBenchmarkResults({ version: 1, results: [] }, [
      result("fast", "design", 60, 200),
    ]);
    const updated = mergeBenchmarkResults(initial, [result("fast", "design", 90, 100)]);

    writeBenchmarkStore(updated, path);

    expect(readBenchmarkStore(path).results).toHaveLength(1);
    expect(readBenchmarkStore(path).results[0]?.score).toBe(90);
    expect(JSON.parse(readFileSync(path, "utf8")).version).toBe(1);
  });
});
