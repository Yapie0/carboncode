import type { MultiAgentCandidateConfig, MultiAgentRole } from "../../../../config.js";
import { readConfig, writeConfig } from "../../../../config.js";
import {
  MULTI_AGENT_ROLES,
  assignRolesByBenchmark,
  mergeBenchmarkResults,
  readBenchmarkStore,
  runRoleBenchmark,
  writeBenchmarkStore,
} from "../../../../multi-agent/benchmarks.js";
import {
  candidateAvailability,
  createProviderClient,
  resolveMultiAgentCandidates,
  resolveMultiAgentConfig,
} from "../../../../providers/registry.js";
import type { SlashHandler } from "../dispatch.js";

function help(): string {
  return [
    "## 实验性 Multi-Agent",
    "",
    "- `/multi-agent setup`：打开与 `/model add` 相同的模型配置向导",
    "- `/multi-agent models`：候选模型、Key 和 benchmark 状态",
    "- `/multi-agent enable [candidate...]`：启用并可限制候选",
    "- `/multi-agent disable`：关闭模式",
    "- `/multi-agent benchmark [candidate...]`：执行四角色实测，会产生费用",
    "- `/multi-agent assignments`：查看设计/实施/测试/验收分配",
    "- `/multi-agent role <role> <candidate|auto>`：手动覆盖角色",
    "- `/multi-agent run <task>`：在当前工作区执行四阶段任务",
  ].join("\n");
}

function selectCandidates(
  all: readonly MultiAgentCandidateConfig[],
  ids: readonly string[],
): MultiAgentCandidateConfig[] | string {
  if (ids.length === 0) return [...all];
  const byId = new Map(all.map((candidate) => [candidate.id, candidate]));
  const selected: MultiAgentCandidateConfig[] = [];
  for (const id of ids) {
    const candidate = byId.get(id);
    if (!candidate) return `未知候选模型：${id}`;
    selected.push(candidate);
  }
  return selected;
}

function modelsText(configPath?: string): string {
  const config = readConfig(configPath);
  const store = readBenchmarkStore();
  const multi = resolveMultiAgentConfig(config);
  const lines = [
    `Multi-Agent：${multi.enabled ? "已启用" : "未启用"}`,
    `OpenAI Key：${process.env.OPENAI_API_KEY ? "已配置" : "未配置"}`,
    "",
    "候选模型：",
  ];
  for (const candidate of resolveMultiAgentCandidates(config)) {
    const availability = candidateAvailability(candidate, config);
    const measured = new Set(
      store.results
        .filter((result) => result.candidateId === candidate.id && !result.error)
        .map((result) => result.role),
    );
    lines.push(
      `- ${candidate.id}: ${candidate.provider}/${candidate.model} · ${availability.available ? "Key 就绪" : `缺少 ${availability.keySource}`} · benchmark ${measured.size}/4`,
    );
  }
  return lines.join("\n");
}

const multiAgent: SlashHandler = (args, _loop, ctx) => {
  const action = (args[0] ?? "help").toLowerCase();
  const configPath = ctx.configPath;

  if (action === "help") return { info: help() };
  if (action === "setup" || action === "key") return { openModelSetup: {} };
  if (action === "models" || action === "status") return { info: modelsText(configPath) };

  if (action === "enable") {
    const config = readConfig(configPath);
    const selected = selectCandidates(resolveMultiAgentCandidates(config), args.slice(1));
    if (typeof selected === "string") return { info: selected };
    config.experimental ??= {};
    config.experimental.multiAgent = {
      ...config.experimental.multiAgent,
      enabled: true,
      candidateIds:
        args.length > 1
          ? selected.map((item) => item.id)
          : config.experimental.multiAgent?.candidateIds,
    };
    writeConfig(config, configPath);
    return {
      info: `Multi-Agent 已启用${args.length > 1 ? `：${selected.map((item) => item.id).join(", ")}` : ""}`,
    };
  }

  if (action === "disable") {
    const config = readConfig(configPath);
    config.experimental ??= {};
    config.experimental.multiAgent = { ...config.experimental.multiAgent, enabled: false };
    writeConfig(config, configPath);
    return { info: "Multi-Agent 已关闭；已有 benchmark 保留。" };
  }

  if (action === "role") {
    const role = args[1] as MultiAgentRole | undefined;
    const candidateId = args[2];
    if (!role || !MULTI_AGENT_ROLES.includes(role) || !candidateId) {
      return {
        info: "用法：/multi-agent role <design|implementation|testing|acceptance> <candidate|auto>",
      };
    }
    const config = readConfig(configPath);
    const candidates = resolveMultiAgentCandidates(config);
    if (candidateId !== "auto" && !candidates.some((candidate) => candidate.id === candidateId)) {
      return { info: `未知候选模型：${candidateId}` };
    }
    config.experimental ??= {};
    const multi = config.experimental.multiAgent ?? {};
    const roles = { ...multi.roles };
    if (candidateId === "auto") delete roles[role];
    else roles[role] = candidateId;
    config.experimental.multiAgent = { ...multi, roles };
    writeConfig(config, configPath);
    return { info: `${role}：${candidateId === "auto" ? "自动选择" : candidateId}` };
  }

  if (action === "assignments") {
    try {
      const config = readConfig(configPath);
      const candidates = resolveMultiAgentCandidates(config).filter(
        (candidate) => candidateAvailability(candidate, config).available,
      );
      const multi = resolveMultiAgentConfig(config);
      const assignments = assignRolesByBenchmark(
        candidates,
        readBenchmarkStore().results,
        multi.roles,
        multi.reusePenalty ?? 2,
      );
      return {
        info: assignments
          .map(
            (assignment) =>
              `${assignment.role}: ${assignment.candidate.id} (${assignment.source}, ${assignment.benchmark?.score ?? "-"})`,
          )
          .join("\n"),
      };
    } catch (error) {
      return { info: error instanceof Error ? error.message : String(error) };
    }
  }

  if (action === "benchmark") {
    const config = readConfig(configPath);
    const selected = selectCandidates(resolveMultiAgentCandidates(config), args.slice(1));
    if (typeof selected === "string") return { info: selected };
    const ready = selected.filter(
      (candidate) => candidateAvailability(candidate, config).available,
    );
    if (ready.length === 0) {
      return { info: "没有 Key 就绪的候选。先运行 /multi-agent setup。" };
    }
    if (!ctx.postInfo) return { info: "当前界面不支持异步 benchmark 输出。" };
    const postInfo = ctx.postInfo;
    void (async () => {
      let store = readBenchmarkStore();
      for (const candidate of ready) {
        const client = createProviderClient(candidate, config);
        for (const role of MULTI_AGENT_ROLES) {
          postInfo(`评测 ${candidate.id} / ${role} ...`);
          const result = await runRoleBenchmark(client, candidate, role);
          store = mergeBenchmarkResults(store, [result]);
          writeBenchmarkStore(store);
          postInfo(
            result.error
              ? `${candidate.id} / ${role} 失败：${result.error}`
              : `${candidate.id} / ${role}: ${result.score}/100 · ${result.latencyMs}ms`,
          );
        }
      }
      postInfo("Multi-Agent benchmark 完成。运行 /multi-agent assignments 查看分配。");
    })().catch((error) => {
      postInfo(
        `Multi-Agent benchmark 失败：${error instanceof Error ? error.message : String(error)}`,
      );
    });
    return { info: `已开始 benchmark：${ready.map((candidate) => candidate.id).join(", ")}` };
  }

  if (action === "run") {
    const task = args.slice(1).join(" ").trim();
    if (!task) return { info: "用法：/multi-agent run <task>" };
    if (!ctx.runMultiAgentTask) return { info: "Multi-Agent run 仅在 code 模式可用。" };
    return { info: ctx.runMultiAgentTask(task) };
  }

  return { info: help() };
};

export const handlers: Record<string, SlashHandler> = {
  "multi-agent": multiAgent,
  multiagent: multiAgent,
};
