import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { basename, join } from "node:path";

const MAX_LINES = 80;
const MAX_CHARS = 3000;
const SKIP_DIRS = new Set([
  ".git",
  ".carboncode",
  ".reasonix",
  ".next",
  ".venv",
  "build",
  "coverage",
  "dist",
  "node_modules",
  "out",
  "target",
  "venv",
]);

export interface ProjectCommand {
  name: string;
  command: string;
  source: string;
}

export interface ProjectAnalysis {
  projectName: string;
  stack: string[];
  layout: string[];
  commands: ProjectCommand[];
  conventions: string[];
  watchOut: string[];
  evidence: string[];
}

export type ProjectGuideLanguage = "EN" | "zh-CN";

interface PackageManifest {
  name?: unknown;
  scripts?: unknown;
  dependencies?: unknown;
  devDependencies?: unknown;
  packageManager?: unknown;
  engines?: unknown;
}

export function analyzeProject(rootDir: string): ProjectAnalysis {
  const analysis: ProjectAnalysis = {
    projectName: basename(rootDir),
    stack: [],
    layout: [],
    commands: [],
    conventions: [],
    watchOut: [],
    evidence: [],
  };

  analyzeNode(rootDir, analysis);
  analyzeRust(rootDir, analysis);
  analyzeGo(rootDir, analysis);
  analyzePython(rootDir, analysis);
  analyzeLayout(rootDir, analysis);
  analyzeConventions(rootDir, analysis);
  analyzeWatchOut(rootDir, analysis);

  analysis.stack = unique(analysis.stack).slice(0, 8);
  analysis.layout = unique(analysis.layout).slice(0, 10);
  analysis.commands = uniqueBy(analysis.commands, (item) => item.command).slice(0, 12);
  analysis.conventions = unique(analysis.conventions).slice(0, 8);
  analysis.watchOut = unique(analysis.watchOut).slice(0, 6);
  analysis.evidence = unique(analysis.evidence);
  return analysis;
}

export function renderProjectRules(
  analysis: ProjectAnalysis,
  language: ProjectGuideLanguage = "EN",
): string {
  const zh = language === "zh-CN";
  const sections: string[] = [
    zh ? "# 项目指南" : "# Project Guide",
    "",
    zh
      ? `根据 \`${analysis.projectName}\` 仓库中的文件生成。请保持内容准确、简洁。`
      : `Generated from repository files for \`${analysis.projectName}\`. Keep this file factual and concise.`,
  ];

  appendListSection(
    sections,
    zh ? "技术栈" : "Stack",
    analysis.stack.map((item) => localizeItem(item, language)),
  );
  appendListSection(
    sections,
    zh ? "目录结构" : "Layout",
    analysis.layout.map((item) => localizeItem(item, language)),
  );
  if (analysis.commands.length > 0) {
    sections.push("", zh ? "## 常用命令" : "## Commands", "");
    for (const item of analysis.commands) {
      sections.push(
        zh
          ? `- \`${item.command}\` - ${item.name}（来源：${localizeSource(item.source)}）`
          : `- \`${item.command}\` - ${item.name} (${item.source})`,
      );
    }
  }
  appendListSection(
    sections,
    zh ? "项目约定" : "Conventions",
    analysis.conventions.map((item) => localizeItem(item, language)),
  );
  appendListSection(
    sections,
    zh ? "注意事项" : "Watch Out For",
    analysis.watchOut.map((item) => localizeItem(item, language)),
  );

  const output = `${sections.join("\n").trimEnd()}\n`;
  return capRules(output);
}

function analyzeNode(rootDir: string, analysis: ProjectAnalysis): void {
  const path = join(rootDir, "package.json");
  const pkg = readJson<PackageManifest>(path);
  if (!pkg) return;

  analysis.evidence.push("package.json");
  if (typeof pkg.name === "string" && pkg.name.trim()) analysis.projectName = pkg.name.trim();

  const allDeps = {
    ...asStringRecord(pkg.dependencies),
    ...asStringRecord(pkg.devDependencies),
  };
  if (allDeps.typescript || existsSync(join(rootDir, "tsconfig.json"))) {
    analysis.stack.push("TypeScript / Node.js (`package.json`, `tsconfig.json`)");
  } else {
    analysis.stack.push("JavaScript / Node.js (`package.json`)");
  }

  const frameworks: Array<[string, string]> = [
    ["react", "React"],
    ["preact", "Preact"],
    ["next", "Next.js"],
    ["vue", "Vue"],
    ["svelte", "Svelte"],
    ["express", "Express"],
    ["fastify", "Fastify"],
    ["commander", "Commander CLI"],
    ["ink", "Ink terminal UI"],
  ];
  for (const [dependency, label] of frameworks) {
    if (allDeps[dependency]) analysis.stack.push(`${label} (\`${dependency}\` dependency)`);
  }

  const scripts = asStringRecord(pkg.scripts);
  const preferred = ["dev", "build", "test", "lint", "typecheck", "format", "verify", "start"];
  for (const name of preferred) {
    if (!scripts[name]) continue;
    analysis.commands.push({
      name,
      command: `npm run ${name}`,
      source: `package.json scripts.${name}`,
    });
  }
  for (const [name] of Object.entries(scripts)) {
    if (preferred.includes(name) || analysis.commands.length >= 12) continue;
    analysis.commands.push({
      name,
      command: `npm run ${name}`,
      source: `package.json scripts.${name}`,
    });
  }

  if (existsSync(join(rootDir, "pnpm-lock.yaml"))) {
    replaceNpmCommands(analysis, "pnpm");
    analysis.stack.push("pnpm workspace/package manager (`pnpm-lock.yaml`)");
  } else if (existsSync(join(rootDir, "yarn.lock"))) {
    replaceNpmCommands(analysis, "yarn");
    analysis.stack.push("Yarn package manager (`yarn.lock`)");
  } else if (existsSync(join(rootDir, "bun.lockb")) || existsSync(join(rootDir, "bun.lock"))) {
    replaceNpmCommands(analysis, "bun");
    analysis.stack.push("Bun package manager (`bun.lock`)");
  } else if (existsSync(join(rootDir, "package-lock.json"))) {
    analysis.stack.push("npm package manager (`package-lock.json`)");
  }

  const engines = asStringRecord(pkg.engines);
  if (engines.node) {
    analysis.watchOut.push(`Node.js version constraint: \`${engines.node}\` (\`package.json\`)`);
  }
}

function analyzeRust(rootDir: string, analysis: ProjectAnalysis): void {
  if (!existsSync(join(rootDir, "Cargo.toml"))) return;
  analysis.evidence.push("Cargo.toml");
  analysis.stack.push("Rust / Cargo (`Cargo.toml`)");
  analysis.commands.push(
    { name: "build", command: "cargo build", source: "Cargo.toml" },
    { name: "test", command: "cargo test", source: "Cargo.toml" },
  );
}

function analyzeGo(rootDir: string, analysis: ProjectAnalysis): void {
  if (!existsSync(join(rootDir, "go.mod"))) return;
  analysis.evidence.push("go.mod");
  analysis.stack.push("Go modules (`go.mod`)");
  analysis.commands.push(
    { name: "build", command: "go build ./...", source: "go.mod" },
    { name: "test", command: "go test ./...", source: "go.mod" },
  );
}

function analyzePython(rootDir: string, analysis: ProjectAnalysis): void {
  const pyproject = join(rootDir, "pyproject.toml");
  const requirements = join(rootDir, "requirements.txt");
  if (!existsSync(pyproject) && !existsSync(requirements)) return;

  analysis.stack.push(
    existsSync(pyproject) ? "Python (`pyproject.toml`)" : "Python (`requirements.txt`)",
  );
  if (existsSync(pyproject)) {
    analysis.evidence.push("pyproject.toml");
    const raw = safeRead(pyproject);
    if (/\[tool\.pytest/i.test(raw)) {
      analysis.commands.push({ name: "test", command: "pytest", source: "pyproject.toml" });
    }
    if (/\[tool\.ruff/i.test(raw)) {
      analysis.commands.push({ name: "lint", command: "ruff check .", source: "pyproject.toml" });
    }
  } else {
    analysis.evidence.push("requirements.txt");
  }
}

function analyzeLayout(rootDir: string, analysis: ProjectAnalysis): void {
  const descriptions: Record<string, string> = {
    src: "application and library source",
    tests: "automated tests",
    test: "automated tests",
    docs: "documentation",
    examples: "usage examples",
    scripts: "project automation",
    packages: "workspace packages",
    apps: "workspace applications",
    dashboard: "web dashboard",
    desktop: "desktop application",
    public: "static assets",
    assets: "project assets",
    cmd: "command entry points",
    internal: "private implementation packages",
  };

  let entries: string[] = [];
  try {
    entries = readdirSync(rootDir);
  } catch {
    return;
  }
  for (const name of entries.sort()) {
    if (SKIP_DIRS.has(name) || name.startsWith(".")) continue;
    if (!isDirectory(join(rootDir, name))) continue;
    const description = descriptions[name] ?? inferDirectoryDescription(rootDir, name);
    if (description) analysis.layout.push(`\`${name}/\` - ${description}`);
  }
}

function analyzeConventions(rootDir: string, analysis: ProjectAnalysis): void {
  if (existsSync(join(rootDir, "tsconfig.json"))) {
    analysis.conventions.push("Follow the TypeScript compiler settings in `tsconfig.json`.");
    analysis.evidence.push("tsconfig.json");
  }
  if (existsSync(join(rootDir, "biome.json")) || existsSync(join(rootDir, "biome.jsonc"))) {
    analysis.conventions.push("Use Biome for repository formatting and lint rules.");
    analysis.evidence.push(existsSync(join(rootDir, "biome.json")) ? "biome.json" : "biome.jsonc");
  } else if (
    hasAny(rootDir, [".eslintrc", ".eslintrc.json", "eslint.config.js", "eslint.config.mjs"])
  ) {
    analysis.conventions.push("Follow the repository ESLint configuration.");
  }
  if (hasAny(rootDir, [".prettierrc", ".prettierrc.json", "prettier.config.js"])) {
    analysis.conventions.push("Use the repository Prettier configuration for formatting.");
  }

  const testFiles = findFiles(rootDir, 3, (name) => /\.(test|spec)\.[cm]?[jt]sx?$/.test(name), 3);
  if (testFiles.length > 0) {
    const location = testFiles.every((path) => path.startsWith("tests/"))
      ? "`tests/`"
      : "files ending in `.test.*` or `.spec.*`";
    analysis.conventions.push(`Automated tests are organized under ${location}.`);
  }
  if (existsSync(join(rootDir, "AGENTS.md"))) {
    analysis.conventions.push(
      "Treat `AGENTS.md` as the highest-priority project instruction file.",
    );
  }
}

function analyzeWatchOut(rootDir: string, analysis: ProjectAnalysis): void {
  if (
    existsSync(join(rootDir, "package-lock.json")) &&
    existsSync(join(rootDir, "pnpm-lock.yaml"))
  ) {
    analysis.watchOut.push(
      "Both `package-lock.json` and `pnpm-lock.yaml` exist; confirm the intended package manager.",
    );
  }
  if (existsSync(join(rootDir, ".env.example"))) {
    analysis.watchOut.push(
      "Use `.env.example` as the environment-variable reference; do not commit secrets.",
    );
    analysis.evidence.push(".env.example");
  }
  if (existsSync(join(rootDir, "dist")) || existsSync(join(rootDir, "build"))) {
    analysis.watchOut.push("Avoid hand-editing generated output under `dist/` or `build/`.");
  }
  if (existsSync(join(rootDir, "CONTRIBUTING.md"))) {
    analysis.watchOut.push(
      "Read `CONTRIBUTING.md` before changing contribution or release workflows.",
    );
    analysis.evidence.push("CONTRIBUTING.md");
  }
}

function appendListSection(lines: string[], heading: string, items: string[]): void {
  if (items.length === 0) return;
  lines.push("", `## ${heading}`, "");
  for (const item of items) lines.push(`- ${item}`);
}

function capRules(content: string): string {
  let lines = content.split("\n");
  if (lines.length > MAX_LINES) lines = lines.slice(0, MAX_LINES);
  let output = `${lines.join("\n").trimEnd()}\n`;
  if (output.length <= MAX_CHARS) return output;

  output = output.slice(0, MAX_CHARS);
  const lastNewline = output.lastIndexOf("\n");
  return `${output.slice(0, lastNewline > 0 ? lastNewline : MAX_CHARS).trimEnd()}\n`;
}

function replaceNpmCommands(analysis: ProjectAnalysis, manager: "pnpm" | "yarn" | "bun"): void {
  for (const item of analysis.commands) {
    if (!item.command.startsWith("npm run ")) continue;
    const script = item.command.slice("npm run ".length);
    item.command = manager === "yarn" ? `yarn ${script}` : `${manager} run ${script}`;
  }
}

function inferDirectoryDescription(rootDir: string, name: string): string | null {
  const files = safeReadDir(join(rootDir, name));
  if (files.some((file) => /\.(test|spec)\./.test(file))) return "automated tests";
  if (files.some((file) => /\.(ts|tsx|js|jsx|py|rs|go)$/.test(file))) return "source code";
  return null;
}

function findFiles(
  rootDir: string,
  maxDepth: number,
  predicate: (name: string) => boolean,
  cap: number,
): string[] {
  const found: string[] = [];
  const visit = (dir: string, relativeDir: string, depth: number): void => {
    if (depth > maxDepth || found.length >= cap) return;
    for (const name of safeReadDir(dir)) {
      if (found.length >= cap) break;
      if (SKIP_DIRS.has(name)) continue;
      const full = join(dir, name);
      const relative = relativeDir ? `${relativeDir}/${name}` : name;
      if (isDirectory(full)) visit(full, relative, depth + 1);
      else if (predicate(name)) found.push(relative);
    }
  };
  visit(rootDir, "", 0);
  return found;
}

function readJson<T>(path: string): T | null {
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8"));
    return parsed && typeof parsed === "object" ? (parsed as T) : null;
  } catch {
    return null;
  }
}

function asStringRecord(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  );
}

function safeRead(path: string): string {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return "";
  }
}

function safeReadDir(path: string): string[] {
  try {
    return readdirSync(path).sort();
  } catch {
    return [];
  }
}

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

function hasAny(rootDir: string, names: string[]): boolean {
  return names.some((name) => existsSync(join(rootDir, name)));
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function uniqueBy<T>(values: T[], key: (value: T) => string): T[] {
  const seen = new Set<string>();
  return values.filter((value) => {
    const id = key(value);
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

function localizeSource(source: string): string {
  return source
    .replace(/^package\.json scripts\./, "package.json 的 scripts.")
    .replace(/^Cargo\.toml$/, "Cargo.toml")
    .replace(/^go\.mod$/, "go.mod")
    .replace(/^pyproject\.toml$/, "pyproject.toml");
}

function localizeItem(item: string, language: ProjectGuideLanguage): string {
  if (language !== "zh-CN") return item;

  const layout = item.match(/^(`[^`]+`) - (.+)$/);
  if (layout) {
    return `${layout[1]} - ${translatePhrase(layout[2] ?? "")}`;
  }
  const nodeConstraint = item.match(/^Node\.js version constraint: (`.+`) \(`package\.json`\)$/);
  if (nodeConstraint) {
    return `Node.js 版本要求：${nodeConstraint[1]}（\`package.json\`）`;
  }
  return translatePhrase(item);
}

function translatePhrase(value: string): string {
  const phrases: Record<string, string> = {
    "application and library source": "应用与库源码",
    "automated tests": "自动化测试",
    documentation: "文档",
    "usage examples": "使用示例",
    "project automation": "项目自动化脚本",
    "workspace packages": "工作区软件包",
    "workspace applications": "工作区应用",
    "web dashboard": "Web 仪表盘",
    "desktop application": "桌面应用",
    "static assets": "静态资源",
    "project assets": "项目资源",
    "command entry points": "命令入口",
    "private implementation packages": "内部实现包",
    "source code": "源码",
    "Follow the TypeScript compiler settings in `tsconfig.json`.":
      "遵循 `tsconfig.json` 中的 TypeScript 编译设置。",
    "Use Biome for repository formatting and lint rules.": "使用 Biome 执行格式化和代码检查。",
    "Follow the repository ESLint configuration.": "遵循仓库中的 ESLint 配置。",
    "Use the repository Prettier configuration for formatting.":
      "使用仓库中的 Prettier 配置格式化代码。",
    "Automated tests are organized under `tests/`.": "自动化测试集中在 `tests/` 目录。",
    "Automated tests are organized under files ending in `.test.*` or `.spec.*`.":
      "自动化测试文件以 `.test.*` 或 `.spec.*` 结尾。",
    "Treat `AGENTS.md` as the highest-priority project instruction file.":
      "将 `AGENTS.md` 视为最高优先级的项目指令文件。",
    "Both `package-lock.json` and `pnpm-lock.yaml` exist; confirm the intended package manager.":
      "同时存在 `package-lock.json` 和 `pnpm-lock.yaml`，请确认项目实际使用的包管理器。",
    "Use `.env.example` as the environment-variable reference; do not commit secrets.":
      "以 `.env.example` 为环境变量参考，不要提交密钥。",
    "Avoid hand-editing generated output under `dist/` or `build/`.":
      "不要手工修改 `dist/` 或 `build/` 下的生成文件。",
    "Read `CONTRIBUTING.md` before changing contribution or release workflows.":
      "修改贡献或发布流程前先阅读 `CONTRIBUTING.md`。",
  };
  return phrases[value] ?? value;
}
