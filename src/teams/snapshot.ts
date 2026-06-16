import { readFileSync, statSync, writeFileSync } from "node:fs";
import { teamSnapshotPath } from "./paths.js";
import { renderOnboardingPrompt } from "./templates.js";
import type { Team, TeamSnapshot, TeamSnapshotAgent } from "./types.js";

export function generateSnapshot(team: Team, workspaceRoot: string): TeamSnapshot {
  const now = new Date().toISOString();
  const sourceTimestamps = getSourceTimestamps();

  const agents: TeamSnapshotAgent[] = team.agents.map((a) => ({
    id: a.id,
    role: a.role,
    displayName: a.displayName,
    capabilities: a.capabilities,
    modelPreference: a.modelPreference,
    onboardingPrompt: renderOnboardingPrompt(team, a),
  }));

  const snapshot: TeamSnapshot = {
    version: 1,
    teamId: team.id,
    teamName: team.name,
    goal: team.goal,
    createdAt: now,
    sourceTimestamps,
    agents,
  };

  // 写入 team-snapshot.md
  const md = renderSnapshotMarkdown(snapshot);
  writeFileSync(teamSnapshotPath(workspaceRoot, team.id), md, "utf-8");

  return snapshot;
}

export function loadSnapshot(workspaceRoot: string, teamId: string): TeamSnapshot | null {
  try {
    const raw = readFileSync(teamSnapshotPath(workspaceRoot, teamId), "utf-8");
    return parseSnapshotMarkdown(raw, teamId);
  } catch {
    return null;
  }
}

export interface SnapshotStaleness {
  stale: boolean;
  changedFiles: string[];
}

export function checkSnapshotStaleness(snapshot: TeamSnapshot): SnapshotStaleness {
  const currentTimestamps = getSourceTimestamps();
  const changedFiles: string[] = [];

  for (const [file, mtime] of Object.entries(currentTimestamps)) {
    const snapshotTime = snapshot.sourceTimestamps[file];
    if (!snapshotTime || snapshotTime !== mtime) {
      changedFiles.push(file);
    }
  }

  return {
    stale: changedFiles.length > 0,
    changedFiles,
  };
}

function getSourceTimestamps(): Record<string, string> {
  const files = ["src/teams/templates.ts", "src/teams/types.ts"];
  const timestamps: Record<string, string> = {};
  for (const file of files) {
    try {
      const stat = statSync(file);
      timestamps[file] = stat.mtime.toISOString();
    } catch {
      timestamps[file] = "not-found";
    }
  }
  return timestamps;
}

function renderSnapshotMarkdown(snapshot: TeamSnapshot): string {
  const lines: string[] = [
    `# ${snapshot.teamName} — Team Snapshot`,
    "",
    `> 版本: ${snapshot.version}`,
    `> 团队: ${snapshot.teamId}`,
    `> 目标: ${snapshot.goal}`,
    `> 生成时间: ${snapshot.createdAt}`,
    "",
    "## 源文件时间戳",
    "> 用于检测模板变更，决定 resume 时用缓存还是重新读取。",
    "",
    ...Object.entries(snapshot.sourceTimestamps).map(([file, mtime]) => `- \`${file}\`: ${mtime}`),
    "",
    "## 团队成员",
    "",
    ...snapshot.agents.flatMap((a) => [
      `### ${a.displayName} (\`${a.id}\`)`,
      "",
      `- 角色: ${a.role}`,
      `- 模型: ${a.modelPreference}`,
      `- 能力: ${a.capabilities.join(", ") || "无"}`,
      "",
      "#### Onboarding Prompt",
      "",
      "```",
      a.onboardingPrompt,
      "```",
      "",
    ]),
  ];

  return lines.join("\n");
}

function parseSnapshotMarkdown(raw: string, teamId: string): TeamSnapshot | null {
  try {
    const lines = raw.split("\n");
    let teamName = "";
    let goal = "";
    let createdAt = "";
    const sourceTimestamps: Record<string, string> = {};
    const agents: TeamSnapshotAgent[] = [];

    let currentAgent: Partial<TeamSnapshotAgent> | null = null;
    let inPrompt = false;
    let promptLines: string[] = [];

    let section: "header" | "timestamps" | "agents" = "header";

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i] ?? "";

      // 检测 section
      if (line.startsWith("## 源文件时间戳")) {
        section = "timestamps";
        continue;
      }
      if (line.startsWith("## 团队成员")) {
        section = "agents";
        continue;
      }

      if (section === "header") {
        if (line.startsWith("> 团队: ")) teamName = line.slice(5).trim();
        else if (line.startsWith("> 目标: ")) goal = line.slice(5).trim();
        else if (line.startsWith("> 生成时间: ")) createdAt = line.slice(7).trim();
      } else if (section === "timestamps") {
        const m = line.match(/^- `(.+)`: (.+)$/);
        if (m) {
          sourceTimestamps[m[1]!] = m[2]!;
        }
      } else if (section === "agents") {
        if (line.startsWith("### ")) {
          // 保存上一个 agent
          if (currentAgent?.id) {
            currentAgent.onboardingPrompt = promptLines.join("\n").trim();
            agents.push(currentAgent as TeamSnapshotAgent);
            promptLines = [];
          }

          const displayName = line.slice(4).split("(")[0]?.trim() ?? "";
          const idMatch = line.match(/`(.+)`/);
          const id = idMatch?.[1] ?? "";
          currentAgent = {
            id,
            displayName,
            role: "researcher",
            capabilities: [],
            modelPreference: "deepseek-v4-flash",
            onboardingPrompt: "",
          };
          inPrompt = false;
        } else if (currentAgent && line.startsWith("- 角色: ")) {
          currentAgent.role = line.slice(5).trim() as TeamSnapshotAgent["role"];
        } else if (currentAgent && line.startsWith("- 模型: ")) {
          currentAgent.modelPreference = line.slice(5).trim();
        } else if (currentAgent && line.startsWith("- 能力: ")) {
          currentAgent.capabilities = line
            .slice(5)
            .trim()
            .split(",")
            .map((c) => c.trim())
            .filter(Boolean);
        } else if (line === "```" && !inPrompt) {
          inPrompt = true;
        } else if (line === "```" && inPrompt) {
          inPrompt = false;
        } else if (inPrompt) {
          promptLines.push(line);
        }
      }
    }

    // 保存最后一个 agent
    if (currentAgent?.id) {
      currentAgent.onboardingPrompt = promptLines.join("\n").trim();
      agents.push(currentAgent as TeamSnapshotAgent);
    }

    return {
      version: 1,
      teamId,
      teamName,
      goal,
      createdAt,
      sourceTimestamps,
      agents,
    };
  } catch {
    return null;
  }
}
