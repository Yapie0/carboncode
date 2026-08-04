import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { ChatProviderClient, Usage } from "../client.js";
import type { MultiAgentCandidateConfig, MultiAgentRole } from "../config.js";

export const MULTI_AGENT_ROLES: readonly MultiAgentRole[] = [
  "design",
  "implementation",
  "testing",
  "acceptance",
];

export interface BenchmarkResult {
  candidateId: string;
  provider: string;
  model: string;
  role: MultiAgentRole;
  score: number;
  latencyMs: number;
  usage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    promptCacheHitTokens: number;
  };
  measuredAt: string;
  details: string[];
  error?: string;
}

export interface BenchmarkStore {
  version: 1;
  results: BenchmarkResult[];
}

export interface RoleAssignment {
  role: MultiAgentRole;
  candidate: MultiAgentCandidateConfig;
  benchmark?: BenchmarkResult;
  effectiveScore?: number;
  source: "benchmark" | "override";
}

interface ProbeDefinition {
  system: string;
  prompt: string;
}

const PROBES: Record<MultiAgentRole, ProbeDefinition> = {
  design: {
    system:
      "You are an architecture agent. Return strict JSON only, with string arrays named components, risks, and verification.",
    prompt:
      "Design a local multi-provider coding-agent orchestrator. Constraints: API keys may not be stored, role agents must be isolated, implementation must be reversible, and every stage must be verifiable. Give concrete components, risks, and verification checks.",
  },
  implementation: {
    system:
      "You are a TypeScript implementation agent. Return strict JSON only with code, tests, and explanation strings.",
    prompt:
      "Implement a pure TypeScript function assignRoles(roles, candidates, scores, reusePenalty) that chooses the highest role score, penalizes repeated candidate use, uses deterministic latency/id tie-breaks, and throws when a role has no measured candidate. Include focused tests.",
  },
  testing: {
    system:
      "You are a test engineer. Return strict JSON only with a cases array. Every case has name, input, and expected fields.",
    prompt:
      "Generate adversarial tests for normalizeAgentId(raw), which must reject empty ids, dot segments, path separators, control characters, and values over 64 characters while accepting safe Unicode names. Cover boundary and security cases.",
  },
  acceptance: {
    system:
      "You are a release acceptance reviewer. Return strict JSON only with a findings array. Each finding has severity, issue, and fix.",
    prompt:
      "Review this proposed multi-agent patch: it writes provider apiKey values to project config.json, accepts agent ids as filesystem paths, runs all write-capable agents with Promise.all in one worktree, and reports success without tests. Identify release blockers and required fixes.",
  },
};

function parseJsonObject(text: string): Record<string, unknown> | null {
  const trimmed = text.trim();
  const unfenced = trimmed
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();
  try {
    const parsed = JSON.parse(unfenced);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function objectArray(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value)
    ? value.filter(
        (item): item is Record<string, unknown> => Boolean(item) && typeof item === "object",
      )
    : [];
}

function keywordPoints(text: string, keywords: readonly string[], pointsEach: number): number {
  const lower = text.toLowerCase();
  return keywords.reduce((score, keyword) => score + (lower.includes(keyword) ? pointsEach : 0), 0);
}

export function scoreBenchmarkResponse(
  role: MultiAgentRole,
  responseText: string,
): { score: number; details: string[] } {
  const parsed = parseJsonObject(responseText);
  if (!parsed) return { score: 0, details: ["response was not a JSON object"] };
  const details: string[] = ["valid JSON object"];
  let score = 10;

  if (role === "design") {
    const components = stringArray(parsed.components);
    const risks = stringArray(parsed.risks);
    const verification = stringArray(parsed.verification);
    score += Math.min(25, components.length * 5);
    score += Math.min(20, risks.length * 5);
    score += Math.min(20, verification.length * 5);
    score += keywordPoints(
      responseText,
      ["isolation", "rollback", "benchmark", "secret", "test"],
      5,
    );
    details.push(
      `${components.length} components`,
      `${risks.length} risks`,
      `${verification.length} checks`,
    );
  } else if (role === "implementation") {
    const code = typeof parsed.code === "string" ? parsed.code : "";
    const tests = typeof parsed.tests === "string" ? parsed.tests : "";
    const explanation = typeof parsed.explanation === "string" ? parsed.explanation : "";
    score += code ? 20 : 0;
    score += tests ? 20 : 0;
    score += explanation ? 10 : 0;
    score += keywordPoints(code, ["reusepenalty", "sort", "throw", "latency", "candidate"], 6);
    score += keywordPoints(tests, ["tie", "penalty", "throw", "determin"], 5);
    details.push(`code ${code.length} chars`, `tests ${tests.length} chars`);
  } else if (role === "testing") {
    const cases = objectArray(parsed.cases);
    score += Math.min(35, cases.length * 5);
    score += keywordPoints(
      responseText,
      ["empty", "..", "separator", "unicode", "64", "65", "control", "slash"],
      7,
    );
    details.push(`${cases.length} structured cases`);
  } else {
    const findings = objectArray(parsed.findings);
    score += Math.min(30, findings.length * 6);
    score += keywordPoints(
      responseText,
      ["secret", "api key", "traversal", "race", "concurr", "worktree", "test"],
      8,
    );
    details.push(`${findings.length} structured findings`);
  }

  return { score: Math.min(100, score), details };
}

function usageSnapshot(usage: Usage): BenchmarkResult["usage"] {
  return {
    promptTokens: usage.promptTokens,
    completionTokens: usage.completionTokens,
    totalTokens: usage.totalTokens,
    promptCacheHitTokens: usage.promptCacheHitTokens,
  };
}

export async function runRoleBenchmark(
  client: ChatProviderClient,
  candidate: MultiAgentCandidateConfig,
  role: MultiAgentRole,
): Promise<BenchmarkResult> {
  const probe = PROBES[role];
  const startedAt = Date.now();
  try {
    const response = await client.chat({
      model: candidate.model,
      messages: [
        { role: "system", content: probe.system },
        { role: "user", content: probe.prompt },
      ],
      responseFormat: { type: "json_object" },
      thinking: "enabled",
      reasoningEffort: "high",
      maxTokens: 2500,
    });
    const scored = scoreBenchmarkResponse(role, response.content);
    return {
      candidateId: candidate.id,
      provider: candidate.provider,
      model: candidate.model,
      role,
      score: scored.score,
      latencyMs: Date.now() - startedAt,
      usage: usageSnapshot(response.usage),
      measuredAt: new Date().toISOString(),
      details: scored.details,
    };
  } catch (error) {
    return {
      candidateId: candidate.id,
      provider: candidate.provider,
      model: candidate.model,
      role,
      score: 0,
      latencyMs: Date.now() - startedAt,
      usage: usageSnapshot({
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
        promptCacheHitTokens: 0,
      } as Usage),
      measuredAt: new Date().toISOString(),
      details: [],
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export function defaultBenchmarkPath(): string {
  return join(homedir(), ".carboncode", "multi-agent", "benchmarks.json");
}

export function readBenchmarkStore(path = defaultBenchmarkPath()): BenchmarkStore {
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as BenchmarkStore;
    if (parsed.version === 1 && Array.isArray(parsed.results)) return parsed;
  } catch {
    // Missing or malformed benchmark state starts empty.
  }
  return { version: 1, results: [] };
}

export function writeBenchmarkStore(store: BenchmarkStore, path = defaultBenchmarkPath()): void {
  mkdirSync(dirname(path), { recursive: true });
  const tempPath = `${path}.${process.pid}.tmp`;
  writeFileSync(tempPath, `${JSON.stringify(store, null, 2)}\n`, "utf8");
  renameSync(tempPath, path);
}

export function mergeBenchmarkResults(
  store: BenchmarkStore,
  incoming: readonly BenchmarkResult[],
): BenchmarkStore {
  const byKey = new Map(
    store.results.map((result) => [`${result.candidateId}:${result.role}`, result] as const),
  );
  for (const result of incoming) byKey.set(`${result.candidateId}:${result.role}`, result);
  return { version: 1, results: [...byKey.values()] };
}

export function assignRolesByBenchmark(
  candidates: readonly MultiAgentCandidateConfig[],
  results: readonly BenchmarkResult[],
  overrides: Partial<Record<MultiAgentRole, string>> = {},
  reusePenalty = 2,
): RoleAssignment[] {
  const candidateById = new Map(candidates.map((candidate) => [candidate.id, candidate]));
  const uses = new Map<string, number>();
  return MULTI_AGENT_ROLES.map((role) => {
    const override = overrides[role];
    if (override) {
      const candidate = candidateById.get(override);
      if (!candidate) throw new Error(`unknown ${role} role override candidate: ${override}`);
      uses.set(candidate.id, (uses.get(candidate.id) ?? 0) + 1);
      return { role, candidate, source: "override" as const };
    }

    const measured = results
      .filter(
        (result) => result.role === role && !result.error && candidateById.has(result.candidateId),
      )
      .map((benchmark) => {
        const candidate = candidateById.get(benchmark.candidateId)!;
        const effectiveScore = benchmark.score - (uses.get(candidate.id) ?? 0) * reusePenalty;
        return { candidate, benchmark, effectiveScore };
      })
      .sort(
        (left, right) =>
          right.effectiveScore - left.effectiveScore ||
          left.benchmark.latencyMs - right.benchmark.latencyMs ||
          left.candidate.id.localeCompare(right.candidate.id),
      );
    const selected = measured[0];
    if (!selected) {
      throw new Error(
        `no successful benchmark result for ${role}; run carboncode multi-agent benchmark first`,
      );
    }
    uses.set(selected.candidate.id, (uses.get(selected.candidate.id) ?? 0) + 1);
    return { role, ...selected, source: "benchmark" as const };
  });
}
