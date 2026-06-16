/**
 * Carbon Code Teams — 角色模板和 onboarding prompt。
 *
 * 参考 CCteam-creator (MIT) 的 roles/onboarding/templates 设计。
 * 定义 7 个默认角色及其职责、能力标签、输入/输出要求。
 */

import type { Team, TeamAgent, TeamAgentRole, TeamRole } from "./types.js";

// ─── 默认角色定义 ──────────────────────────────────────────────────

export const DEFAULT_ROLES: Record<TeamAgentRole, TeamRole> = {
  "team-lead": {
    role: "team-lead",
    displayName: "团队负责人",
    capabilities: ["planning", "coordination", "decision-making", "task-decomposition"],
    responsibilities: "负责用户对齐、任务分解、阶段门禁、团队运营规则维护。",
    modelPreference: "deepseek-v4-pro",
    inputContext: ["项目目标", "用户需求", "团队花名册"],
    outputFiles: ["task_plan.md", "decisions.md", "team-snapshot.md"],
    escalationTriggers: ["不需要 — team-lead 是最终决策者"],
    reviewTriggers: ["阶段结束时由用户 review"],
    documentationTriggers: ["每次阶段推进后更新 task_plan.md", "每次关键决策后追加 decisions.md"],
    readOnly: false,
  },
  researcher: {
    role: "researcher",
    displayName: "研究员",
    capabilities: ["code-search", "web-research", "architecture-analysis", "plan-stress-test"],
    responsibilities: "代码库探索、技术调研、架构分析、方案压测（只读）。",
    modelPreference: "deepseek-v4-flash",
    inputContext: ["调研问题", "相关代码路径", "调研范围"],
    outputFiles: ["research-<topic>/findings.md（主要交付物）"],
    escalationTriggers: ["调研结论与初始假设冲突时", "需要超出范围的调研时"],
    reviewTriggers: ["调研完成后由 team-lead 确认"],
    documentationTriggers: ["每 2 次搜索操作后写入 findings", "调研完成时写入结论"],
    readOnly: true,
  },
  "backend-dev": {
    role: "backend-dev",
    displayName: "后端开发者",
    capabilities: ["typescript", "nodejs", "api-design", "database", "tdd", "testing"],
    responsibilities: "服务端实现（API 路由、中间件、数据库），遵循 TDD 工作流。",
    modelPreference: "deepseek-v4-flash",
    inputContext: ["API 契约", "数据库 schema", "架构文档"],
    outputFiles: ["task-<name>/task_plan.md", "task-<name>/progress.md"],
    escalationTriggers: ["需求不明确（2+ 种解释）", "范围爆炸", "架构影响跨角色"],
    reviewTriggers: ["完成大型功能/模块后"],
    documentationTriggers: [
      "代码变更 API 时更新 api-contracts.md",
      "架构变更时更新 architecture.md",
    ],
    readOnly: false,
  },
  "frontend-dev": {
    role: "frontend-dev",
    displayName: "前端开发者",
    capabilities: ["typescript", "react", "component-testing", "tdd", "accessibility"],
    responsibilities: "客户端实现（组件、状态管理、路由），遵循 TDD 工作流。",
    modelPreference: "deepseek-v4-flash",
    inputContext: ["API 契约", "设计稿/组件树", "架构文档"],
    outputFiles: ["task-<name>/task_plan.md", "task-<name>/progress.md"],
    escalationTriggers: ["需求不明确（2+ 种解释）", "范围爆炸", "API 契约缺失"],
    reviewTriggers: ["完成大型功能/模块后"],
    documentationTriggers: [
      "代码变更 API 时更新 api-contracts.md",
      "架构变更时更新 architecture.md",
    ],
    readOnly: false,
  },
  reviewer: {
    role: "reviewer",
    displayName: "代码审查者",
    capabilities: ["code-review", "security-audit", "quality-analysis", "doc-consistency-check"],
    responsibilities: "代码审查（安全/质量/性能/文档一致性），输出问题列表和修复建议。",
    modelPreference: "deepseek-v4-flash",
    inputContext: ["待审查代码（git diff）", "invariants.md", "api-contracts.md"],
    outputFiles: ["review-<target>/findings.md（完整审查报告）"],
    escalationTriggers: ["发现 CRITICAL 安全问题时立即报告"],
    reviewTriggers: ["（本身即是审查者，不需要被 review）"],
    documentationTriggers: ["每次审查后写入 review 报告", "发现重复模式时建议自动化"],
    readOnly: true,
  },
  custodian: {
    role: "custodian",
    displayName: "管家/维护者",
    capabilities: ["constraint-compliance", "doc-governance", "code-cleanup", "pattern-automation"],
    responsibilities: "约束合规检查、文档治理、模式→自动化、代码清理。",
    modelPreference: "deepseek-v4-flash",
    inputContext: ["所有 agent 的 findings.md 索引", "docs/ 文件", "CLAUDE.md Known Pitfalls"],
    outputFiles: ["audit-<scope>/findings.md"],
    escalationTriggers: ["发现 CRITICAL 合规问题时立即报告 team-lead"],
    reviewTriggers: ["每次审计完成后由 team-lead 确认"],
    documentationTriggers: ["每次审计后更新 audit 报告", "发现文档漂移时标记"],
    readOnly: false,
  },
  "e2e-tester": {
    role: "e2e-tester",
    displayName: "端到端测试者",
    capabilities: ["e2e-testing", "playwright", "browser-automation", "bug-tracking"],
    responsibilities: "E2E 测试规划与执行、Bug 追踪、回归测试。",
    modelPreference: "deepseek-v4-flash",
    inputContext: ["测试范围", "关键用户流程", "已知 Bug 列表"],
    outputFiles: ["test-<scope>/findings.md（测试结果 + Bug 报告）"],
    escalationTriggers: ["测试阻塞（环境问题、缺少依赖）", "发现 CRITICAL Bug"],
    reviewTriggers: ["测试轮次完成后由 team-lead 确认"],
    documentationTriggers: ["每轮测试后写入测试结果", "发现 Bug 时记录 root cause"],
    readOnly: false,
  },
};

// ─── 获取默认角色列表 ──────────────────────────────────────────────

/** 返回建议的默认 agent 列表（不含 team-lead，因为 team-lead 是控制面）。 */
export function getDefaultAgentList(): Omit<TeamAgent, "id" | "inboxPath" | "outboxPath">[] {
  const roles: TeamAgentRole[] = [
    "researcher",
    "backend-dev",
    "frontend-dev",
    "reviewer",
    "custodian",
    "e2e-tester",
  ];

  return roles.map((role) => {
    const def = DEFAULT_ROLES[role];
    return {
      role: def.role,
      displayName: def.displayName,
      capabilities: def.capabilities,
      status: "idle" as const,
      modelPreference: def.modelPreference,
    };
  });
}

/** 返回精简的 agent 列表（适合小项目）。 */
export function getLeanAgentList(): Omit<TeamAgent, "id" | "inboxPath" | "outboxPath">[] {
  const roles: TeamAgentRole[] = ["researcher", "backend-dev", "reviewer"];
  return roles.map((role) => {
    const def = DEFAULT_ROLES[role];
    return {
      role: def.role,
      displayName: def.displayName,
      capabilities: def.capabilities,
      status: "idle" as const,
      modelPreference: def.modelPreference,
    };
  });
}

// ─── Onboarding Prompt 渲染 ────────────────────────────────────────

/** 为指定 agent 渲染 onboarding prompt。 */
export function renderOnboardingPrompt(team: Team, agent: TeamAgent): string {
  const role = DEFAULT_ROLES[agent.role];
  if (!role) return `# ${agent.displayName}\n\n无可用角色模板。`;

  const lines = [
    `你是 ${agent.displayName}（\`${agent.id}\`），"${team.name}" 团队的一员。`,
    "",
    "## 团队目标",
    team.goal,
    "",
    "## 角色职责",
    role.responsibilities,
    "",
    "## 能力标签",
    role.capabilities.join("、"),
    "",
    "## 输入上下文要求",
    ...role.inputContext.map((ctx) => `- ${ctx}`),
    "",
    "## 输出文件要求",
    ...role.outputFiles.map((f) => `- ${f}`),
    "",
    "## 升级规则",
    "以下情况必须升级给 team-lead：",
    ...role.escalationTriggers.map((t) => `- ${t}`),
    "",
    "## 请求审查",
    ...role.reviewTriggers.map((t) => `- ${t}`),
    "",
    "## 文档写入",
    ...role.documentationTriggers.map((t) => `- ${t}`),
    "",
    "## 工作目录",
    `.carboncode/teams/${team.id}/agents/${agent.id}/`,
    "",
    "## 协议",
    "- **2-Action Rule**: 连续 2 次搜索/读取后立即写 findings。",
    "- **3-Strike 升级**: 同类失败 3 次后升级给 team-lead，不静默重试。",
    "- **Doc-Code Sync**: 代码变更时同步更新 docs/。",
    "- **进展报告**: 完成任务后发送 completion message，附带证据。",
    "",
  ];

  return lines.join("\n");
}
