export type GitHubCredentialKind = "git-transport" | "github-api";
export type GitHubOperationMode = "read" | "write";
export type GitHubItemKind = "issue" | "pr";
export type GitHubTriageKind =
  | "ISSUE_QUESTION"
  | "ISSUE_BUG"
  | "ISSUE_FEATURE"
  | "ISSUE_OTHER"
  | "PR_BUGFIX"
  | "PR_OTHER";

export interface GitHubCredentialState {
  gitRemoteUser?: string;
  ghInstalled: boolean;
  ghAuthenticatedUser?: string;
  tokenScopes?: readonly string[];
}

export interface GitHubAuthDiagnosis {
  canUseGitTransport: boolean;
  canUseGitHubApi: boolean;
  preferredAuthFlow: "gh-auth-login" | "gh-auth-switch" | "pat" | "none";
  warnings: string[];
}

export interface GitHubOperation {
  command: readonly string[];
  mode: GitHubOperationMode;
  requiresApiCredential: boolean;
  reason: string;
}

export interface GitHubOperationGuardResult {
  allowed: boolean;
  operation: GitHubOperation;
  violations: string[];
}

export interface GitHubTriageItem {
  kind: GitHubItemKind;
  number: number;
  title: string;
  labels?: readonly string[];
  author?: string;
  headRefName?: string;
  isDraft?: boolean;
  createdAt?: string;
}

export interface GitHubTriageClassification {
  item: GitHubTriageItem;
  triageKind: GitHubTriageKind;
  reportFile: string;
  taskSubject: string;
}

export interface GitHubPaginationPlan {
  itemKind: GitHubItemKind;
  state: "open" | "closed" | "all";
  batchSize: number;
  fields: string[];
  paginateWhenCountEquals: number;
  searchBeforeCreatedAt?: string;
}

const FORBIDDEN_GH_MUTATIONS = new Set([
  "comment",
  "close",
  "edit",
  "merge",
  "review",
  "reopen",
  "ready",
  "lock",
  "unlock",
  "pin",
  "unpin",
]);

export function diagnoseGitHubAuth(state: GitHubCredentialState): GitHubAuthDiagnosis {
  const warnings: string[] = [];
  const canUseGitTransport = Boolean(state.gitRemoteUser);
  const canUseGitHubApi = state.ghInstalled && Boolean(state.ghAuthenticatedUser);

  if (canUseGitTransport && !canUseGitHubApi) {
    warnings.push(
      "git transport credentials do not imply GitHub API permission for PR comments, merges, labels, or closes",
    );
  }
  if (!state.ghInstalled)
    warnings.push("GitHub CLI is not available; install gh before asking for PATs");
  if (state.ghInstalled && !state.ghAuthenticatedUser) {
    warnings.push("GitHub CLI is installed but not authenticated");
  }

  return {
    canUseGitTransport,
    canUseGitHubApi,
    preferredAuthFlow: preferredAuthFlow(state),
    warnings,
  };
}

export function classifyGitHubOperation(command: readonly string[]): GitHubOperation {
  if (command.length === 0) throw new Error("command is required");
  const normalized = command.map((part) => part.trim()).filter(Boolean);
  if (normalized.length === 0) throw new Error("command is required");
  const executable = normalized[0]!.toLowerCase();

  if (executable === "git") {
    return {
      command: normalized,
      mode: isGitWrite(normalized) ? "write" : "read",
      requiresApiCredential: false,
      reason: "git transport uses git credentials, not GitHub API credentials",
    };
  }

  if (executable === "gh") {
    const mode = isGhWrite(normalized) ? "write" : "read";
    return {
      command: normalized,
      mode,
      requiresApiCredential: true,
      reason:
        mode === "write"
          ? "gh mutation requires an authenticated GitHub API identity"
          : "gh read uses GitHub API identity but does not mutate repository state",
    };
  }

  return {
    command: normalized,
    mode: "read",
    requiresApiCredential: false,
    reason: "non-GitHub command",
  };
}

export function guardGitHubOperation(input: {
  command: readonly string[];
  auth: GitHubCredentialState;
  allowMutations?: boolean;
}): GitHubOperationGuardResult {
  const operation = classifyGitHubOperation(input.command);
  const diagnosis = diagnoseGitHubAuth(input.auth);
  const violations: string[] = [];

  if (operation.requiresApiCredential && !diagnosis.canUseGitHubApi) {
    violations.push(
      "GitHub API operation requires gh auth login or a token for the acting account",
    );
  }
  if (operation.mode === "write" && !input.allowMutations) {
    violations.push("GitHub mutation is blocked by the current read-only policy");
  }

  return {
    allowed: violations.length === 0,
    operation,
    violations,
  };
}

export function createGitHubPaginationPlan(input: {
  itemKind: GitHubItemKind;
  state?: "open" | "closed" | "all";
  lastCreatedAt?: string;
}): GitHubPaginationPlan {
  const fields =
    input.itemKind === "issue"
      ? ["number", "title", "labels", "author", "createdAt"]
      : [
          "number",
          "title",
          "labels",
          "author",
          "headRefName",
          "baseRefName",
          "isDraft",
          "createdAt",
        ];
  return {
    itemKind: input.itemKind,
    state: input.state ?? "open",
    batchSize: 500,
    fields,
    paginateWhenCountEquals: 500,
    searchBeforeCreatedAt: input.lastCreatedAt,
  };
}

export function classifyGitHubTriageItem(item: GitHubTriageItem): GitHubTriageClassification {
  assertPositiveInteger(item.number, "number");
  assertNonEmpty(item.title, "title");
  const triageKind = item.kind === "issue" ? classifyIssue(item) : classifyPr(item);
  return {
    item: cloneGitHubTriageItem(item),
    triageKind,
    reportFile: `${item.kind}-${item.number}.md`,
    taskSubject: `Triage: #${item.number} ${item.title}`,
  };
}

export function requiredGitHubAuthMessage(diagnosis: GitHubAuthDiagnosis): string {
  if (diagnosis.canUseGitHubApi) return "GitHub API operations can use the current gh identity.";
  if (diagnosis.preferredAuthFlow === "gh-auth-login") {
    return "Run gh auth login, then gh auth status, before using GitHub API operations.";
  }
  if (diagnosis.preferredAuthFlow === "gh-auth-switch") {
    return "Run gh auth switch to select the acting GitHub account, then gh auth status.";
  }
  if (diagnosis.preferredAuthFlow === "pat") {
    return "Use a token owned by the acting account with repo/public_repo and PR-related permissions.";
  }
  return "Install GitHub CLI or provide a GitHub API credential for the acting account.";
}

export function cloneGitHubTriageItem(item: GitHubTriageItem): GitHubTriageItem {
  return {
    ...item,
    labels: item.labels ? [...item.labels] : undefined,
  };
}

function preferredAuthFlow(state: GitHubCredentialState): GitHubAuthDiagnosis["preferredAuthFlow"] {
  if (!state.ghInstalled) return "pat";
  if (!state.ghAuthenticatedUser) return "gh-auth-login";
  if (state.gitRemoteUser && state.ghAuthenticatedUser !== state.gitRemoteUser) {
    return "gh-auth-switch";
  }
  return "none";
}

function isGitWrite(command: readonly string[]): boolean {
  const subcommand = command[1]?.toLowerCase();
  return ["push", "commit", "tag", "branch", "reset", "rebase", "merge"].includes(subcommand ?? "");
}

function isGhWrite(command: readonly string[]): boolean {
  if (command.includes("-X")) {
    const method = command[command.indexOf("-X") + 1]?.toUpperCase();
    if (["POST", "PUT", "PATCH", "DELETE"].includes(method ?? "")) return true;
  }
  const topic = command[1]?.toLowerCase();
  const action = command[2]?.toLowerCase();
  if (topic === "api") return false;
  if (!topic || !action) return false;
  return FORBIDDEN_GH_MUTATIONS.has(action);
}

function classifyIssue(item: GitHubTriageItem): GitHubTriageKind {
  const title = item.title.toLowerCase();
  const labels = new Set((item.labels ?? []).map((label) => label.toLowerCase()));
  if (labels.has("bug") || title.includes("bug") || title.includes("error")) return "ISSUE_BUG";
  if (labels.has("feature") || labels.has("enhancement") || title.includes("feature")) {
    return "ISSUE_FEATURE";
  }
  if (title.includes("?") || title.includes("how to") || title.includes("why")) {
    return "ISSUE_QUESTION";
  }
  return "ISSUE_OTHER";
}

function classifyPr(item: GitHubTriageItem): GitHubTriageKind {
  const title = item.title.toLowerCase();
  const labels = new Set((item.labels ?? []).map((label) => label.toLowerCase()));
  if (labels.has("bug") || title.startsWith("fix") || item.headRefName?.includes("fix/")) {
    return "PR_BUGFIX";
  }
  return "PR_OTHER";
}

function assertNonEmpty(value: string, name: string): void {
  if (!value.trim()) throw new Error(`${name} is required`);
}

function assertPositiveInteger(value: number, name: string): void {
  if (!Number.isInteger(value) || value <= 0) throw new Error(`${name} must be a positive integer`);
}
