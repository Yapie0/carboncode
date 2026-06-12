import { describe, expect, it } from "vitest";
import { listMwhModules, searchMwhModules } from "../src/mwh/index.js";
import {
  classifyGitHubOperation,
  classifyGitHubTriageItem,
  createGitHubPaginationPlan,
  diagnoseGitHubAuth,
  guardGitHubOperation,
  requiredGitHubAuthMessage,
} from "../src/mwh/modules/service-governance/github-ops-guard/core.js";
import { MemoryGitHubOpsGuard } from "../src/mwh/modules/service-governance/github-ops-guard/memory-store.js";

describe("MWH github-ops-guard stateless core", () => {
  it("diagnoses git transport credentials separately from GitHub API credentials", () => {
    const diagnosis = diagnoseGitHubAuth({
      gitRemoteUser: "Yapie0",
      ghInstalled: true,
    });

    expect(diagnosis).toEqual({
      canUseGitTransport: true,
      canUseGitHubApi: false,
      preferredAuthFlow: "gh-auth-login",
      warnings: [
        "git transport credentials do not imply GitHub API permission for PR comments, merges, labels, or closes",
        "GitHub CLI is installed but not authenticated",
      ],
    });
    expect(requiredGitHubAuthMessage(diagnosis)).toContain("gh auth login");

    expect(
      diagnoseGitHubAuth({
        gitRemoteUser: "Yapie0",
        ghInstalled: true,
        ghAuthenticatedUser: "Cyberforker",
      }).preferredAuthFlow,
    ).toBe("gh-auth-switch");
  });

  it("classifies GitHub commands and blocks mutations in read-only mode", () => {
    expect(classifyGitHubOperation(["git", "push"]).requiresApiCredential).toBe(false);
    expect(classifyGitHubOperation(["gh", "pr", "view", "1"]).mode).toBe("read");
    expect(classifyGitHubOperation(["gh", "pr", "merge", "1"]).mode).toBe("write");
    expect(classifyGitHubOperation(["gh", "api", "-X", "PATCH", "repos/o/r/issues/1"]).mode).toBe(
      "write",
    );

    expect(
      guardGitHubOperation({
        command: ["gh", "pr", "merge", "1"],
        auth: { ghInstalled: true, ghAuthenticatedUser: "Cyberforker" },
      }),
    ).toEqual(
      expect.objectContaining({
        allowed: false,
        violations: ["GitHub mutation is blocked by the current read-only policy"],
      }),
    );
    expect(
      guardGitHubOperation({
        command: ["gh", "pr", "view", "1"],
        auth: { ghInstalled: true, ghAuthenticatedUser: "Cyberforker" },
      }).allowed,
    ).toBe(true);
  });

  it("builds exhaustive pagination plans and classifies issue/PR triage items", () => {
    expect(createGitHubPaginationPlan({ itemKind: "issue" })).toEqual({
      itemKind: "issue",
      state: "open",
      batchSize: 500,
      fields: ["number", "title", "labels", "author", "createdAt"],
      paginateWhenCountEquals: 500,
      searchBeforeCreatedAt: undefined,
    });
    expect(
      createGitHubPaginationPlan({
        itemKind: "pr",
        state: "all",
        lastCreatedAt: "2026-06-01T00:00:00Z",
      }).searchBeforeCreatedAt,
    ).toBe("2026-06-01T00:00:00Z");

    expect(
      classifyGitHubTriageItem({
        kind: "issue",
        number: 12,
        title: "Bug: login fails",
        labels: ["bug"],
      }),
    ).toEqual(
      expect.objectContaining({
        triageKind: "ISSUE_BUG",
        reportFile: "issue-12.md",
        taskSubject: "Triage: #12 Bug: login fails",
      }),
    );
    expect(
      classifyGitHubTriageItem({
        kind: "pr",
        number: 13,
        title: "fix auth regression",
        headRefName: "fix/auth",
      }).triageKind,
    ).toBe("PR_BUGFIX");
  });
});

describe("MWH github-ops-guard stateful memory store", () => {
  it("updates auth, guards commands, audits decisions, and keeps audit clone-safe", () => {
    let now = 1_000;
    const guard = new MemoryGitHubOpsGuard({ now: () => now });

    expect(guard.diagnose().preferredAuthFlow).toBe("pat");
    expect(
      guard.setAuth({
        gitRemoteUser: "Yapie0",
        ghInstalled: true,
        ghAuthenticatedUser: "Cyberforker",
      }).preferredAuthFlow,
    ).toBe("gh-auth-switch");

    expect(guard.guard(["gh", "pr", "view", "1"]).allowed).toBe(true);
    now = 1_100;
    expect(guard.guard(["gh", "pr", "merge", "1"])).toEqual(
      expect.objectContaining({ allowed: false }),
    );
    guard.setMutationPolicy(true);
    expect(guard.guard(["gh", "pr", "merge", "1"]).allowed).toBe(true);

    const audit = guard.listAudit();
    audit[0]!.violations = ["mutated"] as never;
    expect(guard.listAudit()[0]?.violations).toEqual([]);
    expect(guard.listAudit().map((record) => record.checkedAtMs)).toEqual([1_000, 1_100, 1_100]);
  });

  it("classifies batches and exposes the built-in MWH module", () => {
    const guard = new MemoryGitHubOpsGuard();
    const classifications = guard.classifyItems([
      { kind: "issue", number: 1, title: "How to configure auth?" },
      { kind: "pr", number: 2, title: "docs: update readme" },
    ]);

    expect(classifications.map((item) => item.triageKind)).toEqual(["ISSUE_QUESTION", "PR_OTHER"]);
    classifications[0]!.item.labels = ["mutated"];
    expect(
      guard.classifyItems([{ kind: "issue", number: 1, title: "How to configure auth?" }])[0]?.item
        .labels,
    ).toBeUndefined();

    expect(listMwhModules().some((module) => module.id === "github-ops-guard")).toBe(true);
    expect(searchMwhModules("github triage").map((module) => module.id)).toContain(
      "github-ops-guard",
    );
  });
});
