import {
  type GitHubAuthDiagnosis,
  type GitHubCredentialState,
  type GitHubOperationGuardResult,
  type GitHubTriageClassification,
  type GitHubTriageItem,
  classifyGitHubTriageItem,
  diagnoseGitHubAuth,
  guardGitHubOperation,
} from "./core.js";

export interface GitHubGuardAuditRecord {
  id: string;
  command: readonly string[];
  allowed: boolean;
  violations: readonly string[];
  checkedAtMs: number;
}

export interface MemoryGitHubOpsGuardOptions {
  now?: () => number;
  auth?: GitHubCredentialState;
  allowMutations?: boolean;
}

export class MemoryGitHubOpsGuard {
  private readonly now: () => number;
  private auth: GitHubCredentialState;
  private allowMutations: boolean;
  private readonly audit: GitHubGuardAuditRecord[] = [];
  private sequence = 0;

  constructor(opts: MemoryGitHubOpsGuardOptions = {}) {
    this.now = opts.now ?? Date.now;
    this.auth = cloneAuth(opts.auth ?? { ghInstalled: false });
    this.allowMutations = opts.allowMutations ?? false;
  }

  setAuth(auth: GitHubCredentialState): GitHubAuthDiagnosis {
    this.auth = cloneAuth(auth);
    return diagnoseGitHubAuth(this.auth);
  }

  setMutationPolicy(allowMutations: boolean): void {
    this.allowMutations = allowMutations;
  }

  diagnose(): GitHubAuthDiagnosis {
    return diagnoseGitHubAuth(this.auth);
  }

  guard(command: readonly string[]): GitHubOperationGuardResult {
    const result = guardGitHubOperation({
      command,
      auth: this.auth,
      allowMutations: this.allowMutations,
    });
    this.audit.push({
      id: `github-guard-${++this.sequence}`,
      command: [...command],
      allowed: result.allowed,
      violations: [...result.violations],
      checkedAtMs: this.now(),
    });
    return cloneGuardResult(result);
  }

  classifyItems(items: readonly GitHubTriageItem[]): GitHubTriageClassification[] {
    return items.map(classifyGitHubTriageItem).map(cloneClassification);
  }

  listAudit(): GitHubGuardAuditRecord[] {
    return this.audit.map((record) => ({
      ...record,
      command: [...record.command],
      violations: [...record.violations],
    }));
  }
}

function cloneAuth(auth: GitHubCredentialState): GitHubCredentialState {
  return {
    ...auth,
    tokenScopes: auth.tokenScopes ? [...auth.tokenScopes] : undefined,
  };
}

function cloneGuardResult(result: GitHubOperationGuardResult): GitHubOperationGuardResult {
  return {
    ...result,
    operation: {
      ...result.operation,
      command: [...result.operation.command],
    },
    violations: [...result.violations],
  };
}

function cloneClassification(
  classification: GitHubTriageClassification,
): GitHubTriageClassification {
  return {
    ...classification,
    item: {
      ...classification.item,
      labels: classification.item.labels ? [...classification.item.labels] : undefined,
    },
  };
}
