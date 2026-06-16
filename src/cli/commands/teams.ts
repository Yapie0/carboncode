/**
 * Carbon Code Teams — CLI 命令入口（Phase 2 骨架）。
 *
 * 注册 `carboncode teams <subcommand>` CLI 命令。
 * MVP 阶段 CLI 入口做轻量包装，主要功能通过 slash commands 提供。
 */

import type { Command } from "commander";

export function registerTeamsCli(program: Command): void {
  const teams = program
    .command("teams")
    .description("multi-agent team orchestration (create, manage, dispatch)");

  teams
    .command("create <name> [goal]")
    .description("create a new team")
    .option("--lean", "use lean agent list (3 roles)")
    .action(async (name: string, goal: string | undefined, opts: { lean?: boolean }) => {
      const { createTeam, listTeams } = await import("../../teams/store.js");
      const { getDefaultAgentList, getLeanAgentList } = await import("../../teams/templates.js");
      const { suggestTeamId } = await import("../../teams/paths.js");
      const { generateSnapshot } = await import("../../teams/snapshot.js");
      const { renderTeamSummary } = await import("../../teams/render.js");

      const workspaceRoot = process.cwd();
      const teamId = suggestTeamId(name);
      const agents = opts.lean ? getLeanAgentList() : getDefaultAgentList();

      const result = createTeam({
        workspaceRoot,
        teamId,
        name,
        goal: goal ?? "（待定义）",
        agents,
      });

      if (!result.ok) {
        console.error(`Error: ${result.error}`);
        process.exit(1);
      }

      generateSnapshot(result.team, workspaceRoot);
      console.log(renderTeamSummary(result.team));
    });

  teams
    .command("status [id]")
    .description("show team status")
    .action(async (id: string | undefined) => {
      const { listTeams, loadTeam } = await import("../../teams/store.js");
      const { renderTeamSummary } = await import("../../teams/render.js");

      const workspaceRoot = process.cwd();
      const allTeams = listTeams(workspaceRoot);
      const targetId = id ?? allTeams[0]?.id;

      if (!targetId) {
        console.log("No active teams. Use `carboncode teams create` to create one.");
        return;
      }

      const team = loadTeam(workspaceRoot, targetId);
      if (!team) {
        console.error(`Team "${targetId}" not found.`);
        process.exit(1);
      }

      console.log(renderTeamSummary(team));
    });

  teams
    .command("inbox <agent>")
    .description("read agent inbox")
    .option("--unread", "show unread only")
    .action(async (agent: string, opts: { unread?: boolean }) => {
      const { listTeams } = await import("../../teams/store.js");
      const { readInbox } = await import("../../teams/mailbox.js");
      const { renderAgentInbox } = await import("../../teams/render.js");

      const workspaceRoot = process.cwd();
      const allTeams = listTeams(workspaceRoot);
      const team = allTeams[0];

      if (!team) {
        console.error("No active teams.");
        process.exit(1);
      }

      const messages = readInbox(workspaceRoot, team.id, agent, { unreadOnly: opts.unread });
      const displayAgent =
        team.agents.find((a) => a.id === agent) ??
        ({
          id: agent,
          displayName: agent,
          role: "unknown",
        } as unknown as (typeof team.agents)[0]);

      console.log(renderAgentInbox(displayAgent, messages));
    });

  teams
    .command("resume <id>")
    .description("resume a team from snapshot")
    .action(async (id: string) => {
      const { loadSnapshot } = await import("../../teams/snapshot.js");
      const { loadTeam } = await import("../../teams/store.js");
      const { renderTeamSummary } = await import("../../teams/render.js");

      const workspaceRoot = process.cwd();
      const snapshot = loadSnapshot(workspaceRoot, id);

      if (!snapshot) {
        console.error(`Cannot load snapshot for "${id}".`);
        process.exit(1);
      }

      const team = loadTeam(workspaceRoot, id);
      console.log(`Resumed team: ${snapshot.teamName}`);
      console.log(`Snapshot time: ${snapshot.createdAt}`);
      console.log(`Agents: ${snapshot.agents.length}`);
      if (team) console.log(renderTeamSummary(team));
    });

  teams
    .command("archive <id>")
    .description("archive a team")
    .action(async (id: string) => {
      const { archiveTeam } = await import("../../teams/store.js");
      const workspaceRoot = process.cwd();

      const result = archiveTeam(workspaceRoot, id);
      if (!result.ok) {
        console.error(`Error: ${result.error}`);
        process.exit(1);
      }
      console.log(`Team "${id}" archived.`);
    });
}
