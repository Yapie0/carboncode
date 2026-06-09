import {
  checkInstalledMwhModules,
  checkMwhUpdates,
  installMwhModule,
  listInstalledMwhModules,
  listMwhModules,
  mwhRoot,
  readMwhModule,
  searchMwhModules,
} from "@/mwh/index.js";
import type { SlashHandler } from "../dispatch.js";

const mwh: SlashHandler = (args, _loop, ctx) => {
  const action = (args[0] ?? "list").toLowerCase();
  const root = mwhRoot({ projectRoot: ctx.codeRoot, homeDir: ctx.homeDir });

  if (action === "list" || action === "ls") {
    const modules = listMwhModules();
    const installed = listInstalledMwhModules({ projectRoot: ctx.codeRoot, homeDir: ctx.homeDir });
    const installedIds = new Set(installed.map((module) => module.manifest.id));
    const lines = [`Middlewave Hub modules (${modules.length})`, `root: ${root}`];
    for (const module of modules) {
      const marker = installedIds.has(module.id) ? "installed" : "available";
      lines.push(
        `  ${module.id.padEnd(24)} ${marker.padEnd(9)} v${module.version}  ${module.summary}  [${module.tags.join(", ")}]`,
      );
    }
    lines.push("", "Use `/mwh show <id>`, `/mwh install <id>`, `/mwh installed`, or `/mwh check`.");
    return { info: lines.join("\n") };
  }

  if (action === "installed") {
    const modules = listInstalledMwhModules({ projectRoot: ctx.codeRoot, homeDir: ctx.homeDir });
    if (modules.length === 0) return { info: `No installed MWH modules.\nroot: ${root}` };
    const lines = [`Installed MWH modules (${modules.length})`, `root: ${root}`];
    for (const module of modules) {
      lines.push(
        `  ${module.manifest.id.padEnd(24)} v${module.manifest.version}  ${module.manifest.summary}`,
      );
    }
    return { info: lines.join("\n") };
  }

  if (action === "search" || action === "find") {
    const query = args.slice(1).join(" ").trim();
    if (!query) return { info: "Usage: /mwh search <query>" };
    const modules = searchMwhModules(query);
    if (modules.length === 0) return { info: `No MWH modules matched: ${query}` };
    const lines = [`MWH matches (${modules.length})`];
    for (const module of modules) {
      lines.push(`  ${module.id.padEnd(24)} ${module.summary}`);
    }
    return { info: lines.join("\n") };
  }

  if (action === "show" || action === "cat") {
    const id = args[1];
    if (!id) return { info: "Usage: /mwh show <id>" };
    const module = readMwhModule(id, { projectRoot: ctx.codeRoot, homeDir: ctx.homeDir });
    if (!module) return { info: `MWH module not found: ${id}` };
    return {
      info: [
        `# ${module.title}`,
        `id: ${module.id}`,
        `version: ${module.version}`,
        `source: ${module.source.label}`,
        `tags: ${module.tags.join(", ")}`,
        "",
        module.content,
      ].join("\n"),
    };
  }

  if (action === "install" || action === "add") {
    const id = args[1];
    if (!id) return { info: "Usage: /mwh install <id>" };
    const result = installMwhModule(id, {
      projectRoot: ctx.codeRoot,
      homeDir: ctx.homeDir,
    });
    if ("error" in result) return { info: result.error };
    return {
      info: [
        `Installed MWH module "${result.id}".`,
        `manifest: ${result.manifestPath}`,
        `module: ${result.modulePath}`,
        "",
        "This is a reusable reference package, not a persistent skill. Use `/skill middlewave-hub` when you want the agent to query and apply MWH modules.",
      ].join("\n"),
    };
  }

  if (action === "root") {
    return { info: root };
  }

  if (action === "check") {
    const results = checkInstalledMwhModules({ projectRoot: ctx.codeRoot, homeDir: ctx.homeDir });
    if (results.length === 0) return { info: `No installed MWH modules to check.\nroot: ${root}` };
    const lines = [`MWH check (${results.length})`, `root: ${root}`];
    for (const result of results) {
      lines.push(`  ${result.status.padEnd(16)} ${result.id}`);
      if (result.status === "modified") {
        lines.push(`    expected: ${result.expectedSha256}`);
        lines.push(`    actual:   ${result.actualSha256}`);
      }
      if (result.reason) lines.push(`    ${result.reason}`);
    }
    return { info: lines.join("\n") };
  }

  if (action === "update" || action === "outdated") {
    const results = checkMwhUpdates({ projectRoot: ctx.codeRoot, homeDir: ctx.homeDir });
    if (results.length === 0) {
      return { info: `No installed MWH modules to update.\nroot: ${root}` };
    }
    const lines = [`MWH update check (${results.length})`, `root: ${root}`];
    for (const result of results) {
      const version =
        result.availableVersion && result.installedVersion
          ? ` ${result.installedVersion} -> ${result.availableVersion}`
          : "";
      lines.push(`  ${result.status.padEnd(16)} ${result.id}${version}`);
      if (result.reason) lines.push(`    ${result.reason}`);
    }
    lines.push(
      "",
      "No files were changed. Apply updates will be added after conflict policy is defined.",
    );
    return { info: lines.join("\n") };
  }

  return {
    info: "Usage: /mwh [list|installed|search <query>|show <id>|install <id>|check|update|root]",
  };
};

export const handlers: Record<string, SlashHandler> = {
  mwh,
  middlewave: mwh,
};
