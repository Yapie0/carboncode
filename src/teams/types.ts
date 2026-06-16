/**
 * Carbon Code Teams — 内置多 agent 团队编排类型定义。
 *
 * 参考 CCteam-creator (MIT) 的角色和协议设计，适配 Carbon Code 产品形态。
 */

// ─── Team ───────────────────────────────────────────────────────────

export type TeamStatus = "active" | "archived";

export interface Team {
  /** Stable kebab-case id，例如 "demo-project"。用作目录名。 */
  id: string;
  /** 人类可读的团队名称 */
  name: string;
  /** 1-2 句项目目标描述 */
  goal: string;
  /** 团队状态 */
  status: TeamStatus;
  /** 团队成员花名册 */
  agents: TeamAgent[];
  /** 任务列表（摘要，具体任务文件在 tasks/ 下） */
  tasks: TeamTaskSummary[];
  /** ISO-8601 创建时间 */
  createdAt: string;
  /** ISO-8601 最后更新时间 */
  updatedAt: string;
  /** 团队持久化目录（运行时填充，不持久化到 team.json） */
  rootDir?: string;
}

// ─── Agent ──────────────────────────────────────────────────────────

export type TeamAgentStatus = "idle" | "busy" | "blocked" | "offline";

export type TeamAgentRole =
  | "team-lead"
  | "researcher"
  | "backend-dev"
  | "frontend-dev"
  | "reviewer"
  | "custodian"
  | "e2e-tester";

/** 角色定义模板（非运行时 agent） */
export interface TeamRole {
  role: TeamAgentRole;
  displayName: string;
  /** 默认能力标签，用于 capability-based dispatch */
  capabilities: string[];
  /** 角色职责（中文） */
  responsibilities: string;
  /** 推荐的模型 */
  modelPreference: string;
  /** 输入上下文要求 */
  inputContext: string[];
  /** 输出文件要求 */
  outputFiles: string[];
  /** 何时升级给 team-lead */
  escalationTriggers: string[];
  /** 何时请求 reviewer */
  reviewTriggers: string[];
  /** 何时写 findings/progress */
  documentationTriggers: string[];
  /** 是否只读（不能编辑项目源代码，仅 researcher + reviewer） */
  readOnly: boolean;
}

export interface TeamAgent {
  /** 稳定的 agent id，例如 "backend-dev" 或 "researcher-2" */
  id: string;
  /** 角色类型 */
  role: TeamAgentRole;
  /** 展示名 */
  displayName: string;
  /** 能力标签列表 */
  capabilities: string[];
  /** 当前状态 */
  status: TeamAgentStatus;
  /** 推荐的模型 */
  modelPreference: string;
  /** 相对于 team root 的 inbox 路径 */
  inboxPath: string;
  /** 相对于 team root 的 outbox 路径 */
  outboxPath: string;
}

// ─── Task ───────────────────────────────────────────────────────────

export type TeamTaskStatus =
  | "queued"
  | "assigned"
  | "in_progress"
  | "blocked"
  | "submitted"
  | "accepted"
  | "rejected";

export type TeamTaskPriority = "low" | "medium" | "high" | "critical";

/** team.json 中存储的任务摘要 */
export interface TeamTaskSummary {
  id: string;
  title: string;
  description: string;
  status: TeamTaskStatus;
  priority: TeamTaskPriority;
  requestedCapabilities: string[];
  assignedAgentIds: string[];
  dependencies: string[];
  createdAt: string;
  updatedAt: string;
}

/** tasks/<task-id>/ 下的完整任务定义 */
export interface TeamTask {
  id: string;
  title: string;
  description: string;
  status: TeamTaskStatus;
  priority: TeamTaskPriority;
  requestedCapabilities: string[];
  assignedAgentIds: string[];
  dependencies: string[];
  createdAt: string;
  updatedAt: string;
  /** 任务工作区（运行时填充） */
  taskDir?: string;
}

// ─── Message ────────────────────────────────────────────────────────

export type TeamMessageType =
  | "note"
  | "task"
  | "task_assigned"
  | "progress"
  | "permission_request"
  | "permission_response"
  | "submitted"
  | "blocked"
  | "review"
  | "result"
  | "ack";

export interface TeamMessage {
  id: string;
  taskId: string;
  from: string;
  to: string;
  type: TeamMessageType;
  createdAt: string;
  /** Unix ms — undefined = unread. Mirrors MWH readAtMs semantics. */
  readAtMs?: number;
  /** When replying, points to the originating message id. */
  inReplyTo?: string;
  body: Record<string, unknown>;
}

// ─── Event ──────────────────────────────────────────────────────────

export type TeamEventType =
  | "team_created"
  | "team_archived"
  | "team_resumed"
  | "agent_added"
  | "agent_removed"
  | "task_created"
  | "task_assigned"
  | "task_completed"
  | "task_failed"
  | "message_sent"
  | "message_read"
  | "protocol_violation"
  | "decision_logged";

export interface TeamEvent {
  id: string;
  type: TeamEventType;
  agentId: string;
  taskId?: string;
  createdAt: string;
  body: Record<string, unknown>;
}

// ─── Audit ──────────────────────────────────────────────────────────

export interface TeamAuditEntry {
  id: string;
  /** SHA-256 hash of this entry（含 prevHash） */
  hash: string;
  /** 前一条 audit entry 的 hash */
  prevHash: string;
  /** 自增序号，用于检测删除/重排（参考 MWH sequence） */
  sequence: number;
  /** 执行操作的 agent */
  actor: string;
  /** 操作类型 */
  action: string;
  /** 操作结果（参考 MWH outcome） */
  outcome: "success" | "failure" | "denied";
  /** 操作对象（例如 "task:task-1", "team:demo-project"） */
  resource: string;
  /** 资源类型（参考 MWH resourceType） */
  resourceType: string;
  /** 资源 ID（参考 MWH resourceId） */
  resourceId: string;
  /** ISO-8601 */
  createdAt: string;
  /** 操作的详细 metadata（敏感字段自动 redact） */
  metadata: Record<string, unknown>;
}

// ─── Snapshot ───────────────────────────────────────────────────────

export interface TeamSnapshot {
  /** 格式版本 */
  version: 1;
  /** 团队 id */
  teamId: string;
  /** 团队名称 */
  teamName: string;
  /** 团队目标 */
  goal: string;
  /** 快照生成时间 ISO-8601 */
  createdAt: string;
  /** 模板源文件的时间戳，用于 resume 时检测变更 */
  sourceTimestamps: Record<string, string>;
  /** 团队成员花名册 */
  agents: TeamSnapshotAgent[];
}

export interface TeamSnapshotAgent {
  id: string;
  role: TeamAgentRole;
  displayName: string;
  capabilities: string[];
  modelPreference: string;
  /** 完整渲染的 onboarding prompt */
  onboardingPrompt: string;
}

// ─── Decision ───────────────────────────────────────────────────────

export interface TeamDecision {
  id: string;
  title: string;
  decision: string;
  rationale: string;
  alternatives: string[];
  madeBy: string;
  createdAt: string;
  status: "active" | "superseded";
}

// ─── Review Dimension ───────────────────────────────────────────────

export interface ReviewDimension {
  id: string;
  name: string;
  weight: "high" | "medium" | "low";
  description: string;
  /** STRONG 的描述 */
  strongDescription: string;
  /** WEAK 的描述 */
  weakDescription: string;
}

// ─── Golden Rule ────────────────────────────────────────────────────

export interface GoldenRule {
  id: string;
  name: string;
  description: string;
  /** 检测模式（regex 或描述） */
  pattern: string;
  /** 修复指南 */
  fix: string;
  /** 严重级别 */
  severity: "warn" | "fail";
  /** 来源 */
  source: "universal" | "project";
}

// ─── Dispatch ───────────────────────────────────────────────────────

export interface DispatchInput {
  teamId: string;
  taskTitle: string;
  taskDescription: string;
  priority?: TeamTaskPriority;
  requestedCapabilities?: string[];
  /** 不指定则自动匹配 */
  targetAgentId?: string;
}

export interface DispatchResult {
  taskId: string;
  assignedAgentId: string;
  /** 匹配原因 */
  matchReason: string;
}
