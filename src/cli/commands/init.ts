import {
  closeSync,
  fstatSync,
  ftruncateSync,
  openSync,
  readFileSync,
  statSync,
  writeFileSync,
  writeSync,
} from "node:fs";
import { resolve } from "node:path";
import { stdin, stdout } from "node:process";
import { createInterface } from "node:readline/promises";
import { getLanguage } from "../../i18n/index.js";
import { resolveProjectMemoryWritePath } from "../../memory/project.js";
import { analyzeProject, renderProjectRules } from "../init/analyze.js";

export interface InitCommandOptions {
  dir?: string;
  dryRun?: boolean;
  force?: boolean;
  json?: boolean;
  yes?: boolean;
}

export interface InitCommandResult {
  status: "created" | "updated" | "preview" | "cancelled" | "needs-confirmation" | "exists";
  root: string;
  path: string;
  content: string;
  evidence: string[];
  changed: boolean;
}

export async function initCommand(opts: InitCommandOptions = {}): Promise<InitCommandResult> {
  const root = resolve(opts.dir ?? process.cwd());
  if (!isDirectory(root)) {
    throw new Error(`carboncode init: project directory not found: ${root}`);
  }
  const target = resolveProjectMemoryWritePath(root);
  const existingFd = openExistingFile(target);
  try {
    const existed = existingFd !== null;
    const previous = existingFd === null ? "" : readFileSync(existingFd, "utf8");
    const analysis = analyzeProject(root);
    const content = renderProjectRules(analysis, getLanguage());
    const changed = normalize(previous) !== normalize(content);

    if (opts.dryRun) {
      const result = makeResult("preview", root, target, content, analysis.evidence, changed);
      emitResult(result, opts, previous);
      return result;
    }
    if (existed && !opts.force) {
      const result = makeResult("exists", root, target, content, analysis.evidence, changed);
      emitResult(result, opts, previous);
      return result;
    }
    if (!changed) {
      const result = makeResult("preview", root, target, content, analysis.evidence, changed);
      emitResult(result, opts, previous);
      return result;
    }

    if (!opts.yes) {
      if (opts.json || !stdin.isTTY || !stdout.isTTY) {
        const result = makeResult(
          "needs-confirmation",
          root,
          target,
          content,
          analysis.evidence,
          changed,
        );
        emitResult(result, opts, previous);
        return result;
      }
      printPreview(target, previous, content);
      if (!(await confirmWrite(existed))) {
        const result = makeResult("cancelled", root, target, content, analysis.evidence, changed);
        emitResult(result, { ...opts, json: false }, previous, false);
        return result;
      }
    }

    writeProjectRulesFile(target, content, existingFd);
    const result = makeResult(
      existed ? "updated" : "created",
      root,
      target,
      content,
      analysis.evidence,
      changed,
    );
    emitResult(result, opts, previous, false);
    return result;
  } finally {
    if (existingFd !== null) closeSync(existingFd);
  }
}

function openExistingFile(path: string): number | null {
  try {
    const fd = openSync(path, "r+");
    if (!fstatSync(fd).isFile()) {
      closeSync(fd);
      throw new Error(`carboncode init: project rules path is not a file: ${path}`);
    }
    return fd;
  } catch (error) {
    if (isFileNotFound(error)) return null;
    throw error;
  }
}

export function writeProjectRulesFile(
  path: string,
  content: string,
  existingFd: number | null,
): void {
  if (existingFd === null) {
    writeFileSync(path, content, { encoding: "utf8", flag: "wx" });
    return;
  }

  writeSync(existingFd, content, 0, "utf8");
  ftruncateSync(existingFd, Buffer.byteLength(content));
}

function isFileNotFound(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "ENOENT"
  );
}

function makeResult(
  status: InitCommandResult["status"],
  root: string,
  path: string,
  content: string,
  evidence: string[],
  changed: boolean,
): InitCommandResult {
  return { status, root, path, content, evidence, changed };
}

function emitResult(
  result: InitCommandResult,
  opts: InitCommandOptions,
  previous: string,
  includePreview = true,
): void {
  if (opts.json) {
    console.log(JSON.stringify(result));
    return;
  }

  const zh = getLanguage() === "zh-CN";
  if (includePreview) printPreview(result.path, previous, result.content);
  switch (result.status) {
    case "created":
      process.stdout.write(zh ? `已创建 ${result.path}\n` : `Created ${result.path}\n`);
      break;
    case "updated":
      process.stdout.write(zh ? `已更新 ${result.path}\n` : `Updated ${result.path}\n`);
      break;
    case "preview":
      process.stdout.write(
        zh ? "预览完成，未写入文件。\n" : "Preview complete; no file was written.\n",
      );
      break;
    case "exists":
      process.stderr.write(
        zh
          ? `${result.path} 已存在。检查后使用 --force 才能覆盖。\n`
          : `${result.path} already exists. Review it, then pass --force to overwrite.\n`,
      );
      break;
    case "needs-confirmation":
      process.stderr.write(
        zh
          ? "非交互环境不会自动写入。使用 --yes 写入，或使用 --dry-run 仅预览。\n"
          : "Non-interactive mode will not write automatically. Pass --yes to write or --dry-run to preview.\n",
      );
      break;
    case "cancelled":
      process.stderr.write(zh ? "已取消初始化。\n" : "Initialization cancelled.\n");
      break;
  }
}

function printPreview(path: string, previous: string, content: string): void {
  const zh = getLanguage() === "zh-CN";
  process.stdout.write(`\n${zh ? "目标" : "Target"}: ${path}\n`);
  process.stdout.write(renderSimpleDiff(previous, content));
}

export function renderSimpleDiff(previous: string, content: string): string {
  const lines: string[] = ["--- current", "+++ generated"];
  if (previous.trim()) {
    for (const line of previous.replace(/\r\n/g, "\n").split("\n")) lines.push(`-${line}`);
  }
  for (const line of content.replace(/\r\n/g, "\n").split("\n")) lines.push(`+${line}`);
  return `${lines.join("\n")}\n`;
}

async function confirmWrite(existed: boolean): Promise<boolean> {
  const zh = getLanguage() === "zh-CN";
  const prompt = zh
    ? `${existed ? "覆盖" : "创建"}这个项目规则文件？[y/N] `
    : `${existed ? "Overwrite" : "Create"} this project rules file? [y/N] `;
  const rl = createInterface({ input: stdin, output: stdout });
  try {
    const answer = (await rl.question(prompt)).trim().toLowerCase();
    return answer === "y" || answer === "yes";
  } finally {
    rl.close();
  }
}

function normalize(value: string): string {
  return value.replace(/\r\n/g, "\n").trim();
}

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}
