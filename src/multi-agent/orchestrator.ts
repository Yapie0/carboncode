import type { ChatProviderClient } from "../client.js";
import { type CodeToolset, buildCodeToolset } from "../code/setup.js";
import type { MultiAgentCandidateConfig, MultiAgentRole, ReasonixConfig } from "../config.js";
import { createProviderClient, resolveMultiAgentConfig } from "../providers/registry.js";
import type { ToolRegistry } from "../tools.js";
import {
  type SpawnSubagentOptions,
  type SubagentResult,
  type SubagentSink,
  spawnSubagent,
} from "../tools/subagent.js";
import { type BenchmarkResult, type RoleAssignment, assignRolesByBenchmark } from "./benchmarks.js";

export interface MultiAgentStageResult {
  role: MultiAgentRole;
  candidateId: string;
  provider: string;
  model: string;
  success: boolean;
  output: string;
  error?: string;
  elapsedMs: number;
  usage: SubagentResult["usage"];
}

export interface MultiAgentWorkflowResult {
  success: boolean;
  assignments: RoleAssignment[];
  stages: MultiAgentStageResult[];
  failedRole?: MultiAgentRole;
}

export interface MultiAgentWorkflowOptions {
  rootDir: string;
  task: string;
  config: ReasonixConfig;
  candidates: readonly MultiAgentCandidateConfig[];
  benchmarks: readonly BenchmarkResult[];
  signal?: AbortSignal;
  configPath?: string;
  assignments?: RoleAssignment[];
  clientFactory?: (
    candidate: MultiAgentCandidateConfig,
    config: ReasonixConfig,
  ) => ChatProviderClient;
  buildToolset?: typeof buildCodeToolset;
  spawn?: (options: SpawnSubagentOptions) => Promise<SubagentResult>;
  /** Reuse the active TUI registry and job lifecycle instead of creating a second tool runtime. */
  toolset?: Pick<CodeToolset, "tools" | "jobs">;
  subagentSink?: SubagentSink;
  onStageStart?: (assignment: RoleAssignment) => void;
  onStageComplete?: (stage: MultiAgentStageResult) => void;
}

const ROLE_SYSTEM: Record<MultiAgentRole, string> = {
  design: `You are the design agent in a staged Carbon Code multi-agent workflow.
Analyze the repository and produce a concrete implementation plan, interfaces, risks, and acceptance checks.
You are read-only. Do not edit files or claim that implementation has happened.`,
  implementation: `You are the implementation agent in a staged Carbon Code multi-agent workflow.
Implement the approved task in the current repository. Keep scope tight, preserve local patterns, and run focused checks when tools permit.
Report exact files changed, remaining risks, and validation results.`,
  testing: `You are the testing agent in a staged Carbon Code multi-agent workflow.
Inspect the implementation, add or improve focused tests, run deterministic validation, and fix defects that are clearly within scope.
Do not redesign unrelated modules. Report failures honestly.`,
  acceptance: `You are the independent acceptance agent in a staged Carbon Code multi-agent workflow.
Review the task, design, implementation, and test evidence. Inspect the repository read-only and decide whether the result is acceptable.
Lead with blocking findings. Never edit files. End with ACCEPTED or REJECTED and a concise reason.`,
};

function readOnlyToolNames(registry: ToolRegistry): string[] {
  return registry
    .specs()
    .map((spec) => spec.function.name)
    .filter((name) => registry.get(name)?.readOnly === true);
}

function clipArtifact(text: string, maxChars = 16_000): string {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}\n\n[artifact truncated by orchestrator]`;
}

function stageTask(
  role: MultiAgentRole,
  task: string,
  priorStages: readonly MultiAgentStageResult[],
): string {
  const artifacts = priorStages
    .map(
      (stage) =>
        `## ${stage.role} artifact (${stage.provider}/${stage.model})\n${clipArtifact(stage.output)}`,
    )
    .join("\n\n");
  const evidence = artifacts ? `\n\nPrior stage artifacts:\n${artifacts}` : "";
  return `User task:\n${task}${evidence}\n\nComplete only the ${role} stage.`;
}

export async function runMultiAgentWorkflow(
  options: MultiAgentWorkflowOptions,
): Promise<MultiAgentWorkflowResult> {
  const multiAgentConfig = resolveMultiAgentConfig(options.config);
  const assignments =
    options.assignments ??
    assignRolesByBenchmark(
      options.candidates,
      options.benchmarks,
      multiAgentConfig.roles,
      multiAgentConfig.reusePenalty ?? 2,
    );
  const makeClient =
    options.clientFactory ??
    ((candidate: MultiAgentCandidateConfig, config: ReasonixConfig) =>
      createProviderClient(candidate, config));
  const buildTools = options.buildToolset ?? buildCodeToolset;
  const spawn = options.spawn ?? spawnSubagent;
  const ownsToolset = !options.toolset;
  const toolset =
    options.toolset ??
    (await buildTools({
      rootDir: options.rootDir,
      configPath: options.configPath,
    }));
  const readOnlyTools = readOnlyToolNames(toolset.tools);
  const stages: MultiAgentStageResult[] = [];

  try {
    for (const assignment of assignments) {
      if (options.signal?.aborted) {
        return { success: false, assignments, stages, failedRole: assignment.role };
      }
      options.onStageStart?.(assignment);
      const client = makeClient(assignment.candidate, options.config);
      const result = await spawn({
        client,
        parentRegistry: toolset.tools,
        system: ROLE_SYSTEM[assignment.role],
        task: stageTask(assignment.role, options.task, stages),
        model: assignment.candidate.model,
        parentSignal: options.signal,
        skillName: `multi-agent:${assignment.role}`,
        sink: options.subagentSink,
        allowedTools:
          assignment.role === "design" || assignment.role === "acceptance"
            ? readOnlyTools
            : undefined,
        maxResultChars: 20_000,
      });
      const stage: MultiAgentStageResult = {
        role: assignment.role,
        candidateId: assignment.candidate.id,
        provider: assignment.candidate.provider,
        model: assignment.candidate.model,
        success: result.success,
        output: result.output,
        error: result.error,
        elapsedMs: result.elapsedMs,
        usage: result.usage,
      };
      stages.push(stage);
      options.onStageComplete?.(stage);
      if (!result.success) {
        return { success: false, assignments, stages, failedRole: assignment.role };
      }
    }
    return { success: true, assignments, stages };
  } finally {
    if (ownsToolset) await toolset.jobs.shutdown();
  }
}
