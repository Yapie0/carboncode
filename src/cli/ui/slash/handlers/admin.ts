import {
  OUTPUT_STYLES,
  type StatusBarPreset,
  defaultConfigPath,
  isOutputStyle,
  loadLanguage,
  loadOutputStyle,
  loadVimMode,
  readConfig,
  saveOutputStyle,
  saveStatusBarPreset,
  saveVimMode,
} from "@/config.js";
import {
  HOOK_EVENTS,
  type HookEvent,
  type ResolvedHook,
  globalSettingsPath,
  projectSettingsPath,
} from "@/hooks.js";
import { t } from "@/i18n/index.js";
import { aggregateUsage, defaultUsageLogPath, readUsageLog } from "@/telemetry/usage.js";
import {
  VERSION,
  compareVersions,
  detectInstallSource,
  detectNpmInstallPrefix,
} from "@/version.js";
import { runDoctorChecks } from "../../../commands/doctor.js";
import { renderDashboard } from "../../../commands/stats.js";
import { MANUAL_UPDATE_COMMANDS, planUpdate } from "../../../commands/update.js";
import { detectTerminal } from "../../../terminal-info.js";
import type { SlashHandler } from "../dispatch.js";

const doctor: SlashHandler = (_args, _loop, ctx) => {
  const root = ctx.codeRoot ?? process.cwd();
  if (!ctx.postDoctor) return { info: t("handlers.admin.doctorNeedsTui") };
  void (async () => {
    const checks = await runDoctorChecks(root);
    ctx.postDoctor!(
      checks.map((c) => ({
        label: c.label.trim(),
        level: c.level,
        detail: c.detail,
        remediation: c.remediation,
      })),
    );
  })();
  return { info: t("handlers.admin.doctorRunning") };
};

const hooks: SlashHandler = (args, loop, ctx) => {
  const sub = (args[0] ?? "").toLowerCase();

  if (sub === "reload") {
    if (!ctx.reloadHooks) {
      return { info: t("handlers.admin.hooksReloadUnavailable") };
    }
    const count = ctx.reloadHooks();
    return { info: t("handlers.admin.hooksReloaded", { count }) };
  }

  if (sub !== "" && sub !== "list" && sub !== "ls") {
    return { info: t("handlers.admin.hooksUsage") };
  }

  const all = loop.hooks;
  const projPath = ctx.codeRoot ? projectSettingsPath(ctx.codeRoot) : undefined;
  const globPath = globalSettingsPath();
  if (all.length === 0) {
    const lines = [
      t("handlers.admin.hooksNone"),
      "",
      t("handlers.admin.hooksDropHint"),
      ctx.codeRoot
        ? t("handlers.admin.hooksProject", { path: projPath! })
        : t("handlers.admin.hooksProjectFallback"),
      t("handlers.admin.hooksGlobal", { path: globPath }),
      "",
      t("handlers.admin.hooksEvents"),
      t("handlers.admin.hooksExitCodes"),
    ];
    return { info: lines.join("\n") };
  }

  const grouped = new Map<HookEvent, ResolvedHook[]>();
  for (const event of HOOK_EVENTS) grouped.set(event, []);
  for (const h of all) grouped.get(h.event)?.push(h);

  const lines: string[] = [t("handlers.admin.hooksLoaded", { count: all.length })];
  for (const event of HOOK_EVENTS) {
    const list = grouped.get(event) ?? [];
    if (list.length === 0) continue;
    lines.push("", `${event}:`);
    for (const h of list) {
      const match = h.match && h.match !== "*" ? ` match=${h.match}` : "";
      const desc = h.description ? `  — ${h.description}` : "";
      lines.push(`  [${h.scope}]${match} ${h.command}${desc}`);
    }
  }
  lines.push(
    "",
    t("handlers.admin.hooksSources", {
      project: projPath ?? "(none — chat mode)",
      global: globPath,
    }),
  );
  return { info: lines.join("\n") };
};

const update: SlashHandler = (_args, _loop, ctx) => {
  const latest = ctx.latestVersion ?? null;
  const lines: string[] = [t("handlers.admin.updateCurrent", { version: VERSION })];
  if (latest === null) {
    ctx.refreshLatestVersion?.();
    lines.push(
      t("handlers.admin.updateLatestPending"),
      "",
      t("handlers.admin.updateRetryHint"),
      t("handlers.admin.updateRetryHint2"),
    );
    return { info: lines.join("\n") };
  }
  lines.push(t("handlers.admin.updateLatest", { version: latest }));
  if (compareVersions(VERSION, latest) >= 0) {
    lines.push("", t("handlers.admin.updateUpToDate"));
    return { info: lines.join("\n") };
  }
  const installSource = detectInstallSource();
  const npmPrefix = installSource === "npm" ? detectNpmInstallPrefix() : null;
  const plan = planUpdate({ current: VERSION, latest, installSource, npmPrefix });
  if (plan.action === "npx-hint") {
    lines.push("", t("handlers.admin.updateNpxHint"), t("handlers.admin.updateNpxForce"));
    return { info: lines.join("\n") };
  }
  lines.push("", t("handlers.admin.updateUpgradeHint"), t("handlers.admin.updateUpgradeCmd1"));
  if (plan.action === "run-install" && plan.command) {
    lines.push(t("handlers.admin.updateUpgradeCmd2", { command: plan.command.join(" ") }));
  } else {
    lines.push(...MANUAL_UPDATE_COMMANDS.map((c) => `  ${c}`));
  }
  lines.push(
    "",
    t("handlers.admin.updateInSessionDisabled"),
    t("handlers.admin.updateInSessionDisabled2"),
  );
  return { info: lines.join("\n") };
};

const stats: SlashHandler = () => {
  const path = defaultUsageLogPath();
  const records = readUsageLog(path);
  if (records.length === 0) {
    return {
      info: [
        t("handlers.admin.statsNoData"),
        "",
        `  ${path}`,
        "",
        t("handlers.admin.statsEveryTurn"),
        t("handlers.admin.statsWillAppear"),
      ].join("\n"),
    };
  }
  const agg = aggregateUsage(records);
  return { info: renderDashboard(agg, path) };
};

const terminalSetup: SlashHandler = () => {
  const info = detectTerminal(process.env, process.stdout.isTTY === true, process.platform);
  const yes = t("terminalSetup.yes");
  const no = t("terminalSetup.no");
  return {
    info: t("terminalSetup.report", {
      program: info.program,
      term: info.term || "—",
      color: info.trueColor ? yes : no,
      tty: info.isTTY ? yes : no,
      platform: info.platform,
      advice: t(`terminalSetup.advice.${info.adviceKey}`),
    }),
  };
};

const outputStyle: SlashHandler = (args) => {
  const arg = (args[0] ?? "").toLowerCase();
  if (!arg) {
    return {
      info: t("handlers.admin.outputStyleCurrent", {
        current: loadOutputStyle(),
        list: OUTPUT_STYLES.join(" · "),
      }),
    };
  }
  if (!isOutputStyle(arg)) {
    return { info: t("handlers.admin.outputStyleUsage", { list: OUTPUT_STYLES.join(" | ") }) };
  }
  saveOutputStyle(arg);
  return { info: t("handlers.admin.outputStyleSet", { style: arg }) };
};

function reviewPrompt(ref: string): string {
  const target = ref
    ? `the changes between \`${ref}\` and the working tree (run \`git diff ${ref}\`)`
    : "the current uncommitted changes (run `git diff`, plus `git diff --staged` for staged work)";
  return [
    "# Task: code review",
    "",
    `Review ${target} for correctness bugs, regressions, and obvious simplification / reuse opportunities.`,
    "",
    "Rules:",
    "1. Get the diff first. If there are no changes, say so and stop.",
    "2. Each finding: `file:line` · severity (high / med / low) · one-line problem · concrete fix.",
    "3. Ground every finding in the actual diff. Do NOT invent 'missing' / 'not handled' findings — if you suspect an absence, `search_content` first (cite-or-shut-up).",
    "4. Group by file. End with a one-line verdict (ship / fix-first). Keep it concise.",
    "",
    "Reply in the user's language.",
  ].join("\n");
}

const review: SlashHandler = (args) => ({
  info: t("handlers.admin.reviewRunning"),
  resubmit: reviewPrompt(args.join(" ").trim()),
});

const config: SlashHandler = () => {
  const cfg = readConfig();
  // label · current value · command to change it (blank = read-only status)
  const rows: Array<[string, string, string]> = [
    ["theme", cfg.theme ?? "auto", "/theme"],
    ["language", loadLanguage() ?? "auto", "/language"],
    ["preset", cfg.preset ?? "default", "/preset · /model"],
    ["output style", loadOutputStyle(), "/output-style"],
    ["status bar", cfg.statusBar ? "custom" : "default", "/statusline"],
    ["reasoning", cfg.reasoningEffort ?? "default", "/pro"],
    ["thinking", cfg.thinkingMode ?? "auto", "/thinking"],
    ["max output", cfg.maxOutputTokens?.toLocaleString() ?? "provider default", "/max-output"],
    ["auto-update", cfg.autoUpdate === false ? "off" : "on", ""],
  ];
  const labelW = Math.max(...rows.map((r) => r[0].length));
  const valueW = Math.max(...rows.map((r) => r[1].length));
  const body = rows
    .map(([label, value, cmd]) =>
      `  ${label.padEnd(labelW)}  ${value.padEnd(valueW)}  ${cmd}`.trimEnd(),
    )
    .join("\n");
  return {
    info: `${t("handlers.admin.configTitle")}\n\n${body}\n\n${t("handlers.admin.configFooter", { path: defaultConfigPath() })}`,
  };
};

const vim: SlashHandler = (args, _loop, ctx) => {
  const arg = (args[0] ?? "").toLowerCase();
  const current = ctx.vimEnabled ?? loadVimMode();
  const next = arg === "on" ? true : arg === "off" ? false : !current;
  saveVimMode(next);
  ctx.setVimEnabled?.(next);
  return { info: t(next ? "handlers.admin.vimOn" : "handlers.admin.vimOff") };
};

const STATUS_BAR_PRESETS: readonly StatusBarPreset[] = ["minimal", "default", "full"];

const statusline: SlashHandler = (args) => {
  const arg = (args[0] ?? "").toLowerCase();
  if (!STATUS_BAR_PRESETS.includes(arg as StatusBarPreset)) {
    return { info: t("handlers.admin.statuslineUsage", { list: STATUS_BAR_PRESETS.join(" | ") }) };
  }
  saveStatusBarPreset(arg as StatusBarPreset);
  return { info: t("handlers.admin.statuslineSet", { preset: arg }) };
};

export const handlers: Record<string, SlashHandler> = {
  hook: hooks,
  hooks,
  update,
  stats,
  doctor,
  "terminal-setup": terminalSetup,
  "output-style": outputStyle,
  review,
  statusline,
  config,
  vim,
};
