import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { initCollab, renderCollabConnectPrompt } from "../../../../collab/inbox.js";
import type { SlashHandler } from "../dispatch.js";

const collab: SlashHandler = (args, _loop, ctx) => {
  const agent = args[0] ?? "carboncode";
  const collabRoot = ctx.collabRoot;
  if (!collabRoot) {
    return { info: "/collab needs a collaboration root from the current session." };
  }
  const result = initCollab({ agent, collabRoot });
  const status = result.ok ? "collab protocol ready" : `collab protocol invalid: ${result.reason}`;
  const promptPath = join(collabRoot, "connect-prompt.md");
  writeFileSync(promptPath, `${renderCollabConnectPrompt(agent, collabRoot)}\n`, "utf8");
  return {
    collab: { agent, root: collabRoot },
    info: [
      status,
      `protocol: ${result.protocolPath}`,
      `hash: ${result.hashPath}`,
      `prompt: ${promptPath}`,
      `agent: ${agent}`,
      "Copy the prompt file to Codex, Claude Code, or another coding agent.",
    ].join("\n"),
  };
};

export const handlers: Record<string, SlashHandler> = { collab };
