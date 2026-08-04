import { resolve } from "node:path";
import type { Command } from "commander";
import {
  type MultiAgentCandidateConfig,
  type MultiAgentRole,
  readConfig,
  writeConfig,
} from "../../config.js";
import {
  MULTI_AGENT_ROLES,
  assignRolesByBenchmark,
  mergeBenchmarkResults,
  readBenchmarkStore,
  runRoleBenchmark,
  writeBenchmarkStore,
} from "../../multi-agent/benchmarks.js";
import { runMultiAgentWorkflow } from "../../multi-agent/orchestrator.js";
import {
  candidateAvailability,
  createProviderClient,
  resolveMultiAgentCandidates,
  resolveMultiAgentConfig,
} from "../../providers/registry.js";

function findCandidates(
  all: readonly MultiAgentCandidateConfig[],
  ids: readonly string[],
): MultiAgentCandidateConfig[] {
  if (ids.length === 0) return [...all];
  const byId = new Map(all.map((candidate) => [candidate.id, candidate]));
  return ids.map((id) => {
    const candidate = byId.get(id);
    if (!candidate) throw new Error(`未知候选模型：${id}`);
    return candidate;
  });
}

export function parseBenchmarkRoles(raw: string | undefined): MultiAgentRole[] {
  if (!raw) return [...MULTI_AGENT_ROLES];
  const roles = raw
    .split(",")
    .map((role) => role.trim())
    .filter(Boolean);
  for (const role of roles) {
    if (!MULTI_AGENT_ROLES.includes(role as MultiAgentRole)) {
      throw new Error(`未知角色：${role}；可选 ${MULTI_AGENT_ROLES.join(", ")}`);
    }
  }
  return [...new Set(roles as MultiAgentRole[])];
}

function availableCandidates(
  candidates: readonly MultiAgentCandidateConfig[],
  config: ReturnType<typeof readConfig>,
): MultiAgentCandidateConfig[] {
  return candidates.filter((candidate) => candidateAvailability(candidate, config).available);
}

function printCandidateTable(candidates: readonly MultiAgentCandidateConfig[]): void {
  const config = readConfig();
  const store = readBenchmarkStore();
  console.log("ID\t提供商\t模型\t密钥\tBenchmark");
  for (const candidate of candidates) {
    const availability = candidateAvailability(candidate, config);
    const measured = new Set(
      store.results
        .filter((result) => result.candidateId === candidate.id && !result.error)
        .map((result) => result.role),
    );
    console.log(
      `${candidate.id}\t${candidate.provider}\t${candidate.model}\t${availability.available ? "就绪" : `缺少 ${availability.keySource}`}\t${measured.size}/4`,
    );
  }
}

function printAssignments(): void {
  const config = readConfig();
  const candidates = availableCandidates(resolveMultiAgentCandidates(config), config);
  const multi = resolveMultiAgentConfig(config);
  const assignments = assignRolesByBenchmark(
    candidates,
    readBenchmarkStore().results,
    multi.roles,
    multi.reusePenalty ?? 2,
  );
  console.log("角色\t候选\t提供商/模型\t依据\t分数");
  for (const assignment of assignments) {
    console.log(
      `${assignment.role}\t${assignment.candidate.id}\t${assignment.candidate.provider}/${assignment.candidate.model}\t${assignment.source}\t${assignment.benchmark?.score ?? "-"}`,
    );
  }
}

export function registerMultiAgentCli(program: Command): void {
  const command = program.command("multi-agent").description("实验性多提供商、多角色 Agent 编排");

  command
    .command("models")
    .description("列出候选模型、密钥就绪状态和 benchmark 覆盖")
    .action(() => printCandidateTable(resolveMultiAgentCandidates(readConfig())));

  command
    .command("enable [candidateIds...]")
    .description("启用实验功能；可指定要使用的候选模型 ID")
    .action((candidateIds: string[]) => {
      const config = readConfig();
      const current = resolveMultiAgentCandidates(config);
      const selected = findCandidates(current, candidateIds);
      config.experimental ??= {};
      config.experimental.multiAgent = {
        ...config.experimental.multiAgent,
        enabled: true,
        candidateIds:
          candidateIds.length > 0
            ? selected.map((item) => item.id)
            : config.experimental.multiAgent?.candidateIds,
      };
      writeConfig(config);
      console.log(
        `已启用 multi-agent${candidateIds.length > 0 ? `：${selected.map((item) => item.id).join(", ")}` : ""}`,
      );
    });

  command
    .command("disable")
    .description("关闭实验性多 Agent 执行，不删除 benchmark")
    .action(() => {
      const config = readConfig();
      config.experimental ??= {};
      config.experimental.multiAgent = { ...config.experimental.multiAgent, enabled: false };
      writeConfig(config);
      console.log("已关闭 multi-agent；已有 benchmark 保留。");
    });

  command
    .command("role <role> <candidateId>")
    .description("手动覆盖一个角色；candidateId 使用 auto 可恢复自动选择")
    .action((roleRaw: string, candidateId: string) => {
      const [role] = parseBenchmarkRoles(roleRaw);
      if (!role || roleRaw.includes(",")) throw new Error("role 命令一次只能设置一个角色");
      const config = readConfig();
      const candidates = resolveMultiAgentCandidates(config);
      if (candidateId !== "auto" && !candidates.some((candidate) => candidate.id === candidateId)) {
        throw new Error(`未知候选模型：${candidateId}`);
      }
      config.experimental ??= {};
      const multi = config.experimental.multiAgent ?? {};
      const roles = { ...multi.roles };
      if (candidateId === "auto") delete roles[role];
      else roles[role] = candidateId;
      config.experimental.multiAgent = { ...multi, roles };
      writeConfig(config);
      console.log(`${role}：${candidateId === "auto" ? "自动选择" : `固定为 ${candidateId}`}`);
    });

  command
    .command("benchmark [candidateIds...]")
    .description("对候选模型执行四角色实测（会产生真实 API 调用和费用）")
    .option("--roles <roles>", "逗号分隔：design,implementation,testing,acceptance")
    .action(async (candidateIds: string[], opts: { roles?: string }) => {
      const config = readConfig();
      const selected = findCandidates(resolveMultiAgentCandidates(config), candidateIds);
      const ready = availableCandidates(selected, config);
      const roles = parseBenchmarkRoles(opts.roles);
      if (ready.length === 0) {
        throw new Error("没有密钥就绪的候选模型；先设置 OPENAI_API_KEY 或 DEEPSEEK_API_KEY");
      }
      let store = readBenchmarkStore();
      for (const candidate of ready) {
        const client = createProviderClient(candidate, config);
        for (const role of roles) {
          process.stdout.write(`评测 ${candidate.id} / ${role} ... `);
          const result = await runRoleBenchmark(client, candidate, role);
          store = mergeBenchmarkResults(store, [result]);
          writeBenchmarkStore(store);
          console.log(
            result.error ? `失败：${result.error}` : `${result.score}/100 · ${result.latencyMs}ms`,
          );
        }
      }
      const skipped = selected.filter((candidate) => !ready.includes(candidate));
      if (skipped.length > 0) {
        console.log(`跳过未配置密钥：${skipped.map((candidate) => candidate.id).join(", ")}`);
      }
    });

  command
    .command("assignments")
    .description("根据最新 benchmark 显示四角色分配")
    .action(() => printAssignments());

  command
    .command("run <task...>")
    .description("按设计→实施→测试→验收顺序执行一个开发任务")
    .option("--dir <path>", "目标工作区", process.cwd())
    .action(async (taskParts: string[], opts: { dir: string }) => {
      const config = readConfig();
      const multi = resolveMultiAgentConfig(config);
      if (multi.enabled !== true) {
        throw new Error("multi-agent 尚未启用；先运行 carboncode multi-agent enable");
      }
      const candidates = availableCandidates(resolveMultiAgentCandidates(config), config);
      if (candidates.length === 0) throw new Error("没有密钥就绪的候选模型");
      const store = readBenchmarkStore();
      const assignments = assignRolesByBenchmark(
        candidates,
        store.results,
        multi.roles,
        multi.reusePenalty ?? 2,
      );
      console.log("角色分配：");
      for (const assignment of assignments) {
        console.log(
          `  ${assignment.role}: ${assignment.candidate.id} (${assignment.candidate.provider}/${assignment.candidate.model}, ${assignment.source})`,
        );
      }
      const result = await runMultiAgentWorkflow({
        rootDir: resolve(opts.dir),
        task: taskParts.join(" "),
        config,
        candidates,
        benchmarks: store.results,
        assignments,
        onStageStart: (assignment) => {
          console.log(
            `\n开始 ${assignment.role}：${assignment.candidate.provider}/${assignment.candidate.model}`,
          );
        },
        onStageComplete: (stage) => {
          console.log(
            `${stage.role} ${stage.success ? "完成" : "失败"} · ${stage.elapsedMs}ms · ${stage.usage.totalTokens} tokens`,
          );
        },
      });
      for (const stage of result.stages) {
        console.log(`\n=== ${stage.role} · ${stage.provider}/${stage.model} ===`);
        console.log(stage.output || stage.error || "无输出");
      }
      if (!result.success) {
        throw new Error(`multi-agent 在 ${result.failedRole ?? "unknown"} 阶段失败`);
      }
      console.log("\n四阶段执行完成。");
    });
}
