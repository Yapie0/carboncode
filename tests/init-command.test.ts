import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { initCommand, renderSimpleDiff } from "../src/cli/commands/init.js";
import { analyzeProject, renderProjectRules } from "../src/cli/init/analyze.js";
import { setLanguageRuntime } from "../src/i18n/index.js";

describe("project init analysis", () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "carbon-project-init-"));
  });

  afterEach(() => {
    setLanguageRuntime("EN");
    vi.restoreAllMocks();
    rmSync(root, { recursive: true, force: true });
  });

  it("extracts Node stack, package scripts, layout, and repository conventions", () => {
    writeFileSync(
      join(root, "package.json"),
      JSON.stringify({
        name: "@example/widget",
        scripts: {
          build: "tsc",
          test: "vitest run",
          lint: "biome check src tests",
        },
        dependencies: { commander: "^13.0.0" },
        devDependencies: { typescript: "^5.0.0", vitest: "^2.0.0" },
        engines: { node: ">=22" },
      }),
    );
    writeFileSync(join(root, "tsconfig.json"), "{}");
    writeFileSync(join(root, "biome.json"), "{}");
    writeFileSync(join(root, "package-lock.json"), "{}");
    writeFileSync(join(root, ".env.example"), "TOKEN=\n");
    const src = join(root, "src");
    const tests = join(root, "tests");
    mkdirSync(src);
    mkdirSync(tests);
    writeFileSync(join(tests, "widget.test.ts"), "");

    const analysis = analyzeProject(root);
    const rendered = renderProjectRules(analysis);

    expect(analysis.projectName).toBe("@example/widget");
    expect(rendered).toContain("TypeScript / Node.js");
    expect(rendered).toContain("Commander CLI");
    expect(rendered).toContain("`npm run build`");
    expect(rendered).toContain("`src/` - application and library source");
    expect(rendered).toContain("Use Biome");
    expect(rendered).toContain("Node.js version constraint: `>=22`");
    expect(rendered).toContain("do not commit secrets");
  });

  it("uses the lockfile-selected package manager in generated commands", () => {
    writeFileSync(
      join(root, "package.json"),
      JSON.stringify({ scripts: { test: "vitest run", build: "tsc" } }),
    );
    writeFileSync(join(root, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n");

    const rendered = renderProjectRules(analyzeProject(root));

    expect(rendered).toContain("`pnpm run test`");
    expect(rendered).toContain("`pnpm run build`");
    expect(rendered).not.toContain("`npm run test`");
  });

  it("recognizes Python, Rust, and Go manifests without inventing dependencies", () => {
    writeFileSync(join(root, "pyproject.toml"), "[tool.pytest.ini_options]\n[tool.ruff]\n");
    writeFileSync(join(root, "Cargo.toml"), '[package]\nname = "demo"\nversion = "0.1.0"\n');
    writeFileSync(join(root, "go.mod"), "module example.com/demo\n");

    const rendered = renderProjectRules(analyzeProject(root));

    expect(rendered).toContain("Python (`pyproject.toml`)");
    expect(rendered).toContain("Rust / Cargo");
    expect(rendered).toContain("Go modules");
    expect(rendered).toContain("`pytest`");
    expect(rendered).toContain("`ruff check .`");
    expect(rendered).toContain("`cargo test`");
    expect(rendered).toContain("`go test ./...`");
  });

  it("keeps generated rules within the documented size limits", () => {
    const scripts = Object.fromEntries(
      Array.from({ length: 40 }, (_, index) => [`script-${index}`, `echo ${index}`]),
    );
    writeFileSync(join(root, "package.json"), JSON.stringify({ scripts }));

    const rendered = renderProjectRules(analyzeProject(root));

    expect(rendered.length).toBeLessThanOrEqual(3000);
    expect(rendered.split("\n").length).toBeLessThanOrEqual(80);
  });
});

describe("initCommand", () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "carbon-init-command-"));
    writeFileSync(
      join(root, "package.json"),
      JSON.stringify({ name: "demo", scripts: { test: "vitest run" } }),
    );
    vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  });

  afterEach(() => {
    setLanguageRuntime("EN");
    vi.restoreAllMocks();
    rmSync(root, { recursive: true, force: true });
  });

  it("creates CARBON.md with --yes", async () => {
    const result = await initCommand({ dir: root, yes: true });

    expect(result.status).toBe("created");
    expect(existsSync(join(root, "CARBON.md"))).toBe(true);
    expect(readFileSync(join(root, "CARBON.md"), "utf8")).toContain("`npm run test`");
  });

  it("protects an existing highest-priority AGENTS.md without --force", async () => {
    const agents = join(root, "AGENTS.md");
    writeFileSync(agents, "# Hand-written rules\n");

    const result = await initCommand({ dir: root, yes: true });

    expect(result.status).toBe("exists");
    expect(readFileSync(agents, "utf8")).toBe("# Hand-written rules\n");
    expect(existsSync(join(root, "CARBON.md"))).toBe(false);
  });

  it("updates the existing rules file only when --force is explicit", async () => {
    const carbon = join(root, "CARBON.md");
    writeFileSync(carbon, "# Old\n");

    const result = await initCommand({ dir: root, force: true, yes: true });

    expect(result.status).toBe("updated");
    expect(readFileSync(carbon, "utf8")).toContain("# Project Guide");
  });

  it("dry-run previews without writing", async () => {
    const result = await initCommand({ dir: root, dryRun: true });

    expect(result.status).toBe("preview");
    expect(existsSync(join(root, "CARBON.md"))).toBe(false);
  });

  it("dry-run can preview a replacement without requiring --force", async () => {
    const carbon = join(root, "CARBON.md");
    writeFileSync(carbon, "# Hand-written\n");

    const result = await initCommand({ dir: root, dryRun: true });

    expect(result.status).toBe("preview");
    expect(readFileSync(carbon, "utf8")).toBe("# Hand-written\n");
  });

  it("JSON mode requires --yes before writing", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});

    const result = await initCommand({ dir: root, json: true });

    expect(result.status).toBe("needs-confirmation");
    expect(existsSync(join(root, "CARBON.md"))).toBe(false);
    expect(JSON.parse(String(log.mock.calls[0]![0])).status).toBe("needs-confirmation");
  });

  it("emits Chinese plain output when the runtime language is zh-CN", async () => {
    setLanguageRuntime("zh-CN");

    await initCommand({ dir: root, yes: true });

    expect(process.stdout.write).toHaveBeenCalledWith(expect.stringContaining("已创建"));
    expect(readFileSync(join(root, "CARBON.md"), "utf8")).toContain("# 项目指南");
    expect(readFileSync(join(root, "CARBON.md"), "utf8")).toContain("## 常用命令");
  });

  it("renders a readable creation and replacement preview", () => {
    expect(renderSimpleDiff("", "# New\n")).toContain("+# New");
    const replacement = renderSimpleDiff("# Old\n", "# New\n");
    expect(replacement).toContain("-# Old");
    expect(replacement).toContain("+# New");
  });

  it("rejects a missing project directory with a clear error", async () => {
    await expect(initCommand({ dir: join(root, "missing"), yes: true })).rejects.toThrow(
      /project directory not found/,
    );
  });
});
