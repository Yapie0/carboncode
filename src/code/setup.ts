import { statSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, parse as parsePath, relative, resolve as resolvePath } from "node:path";
import { DeepSeekClient } from "../client.js";
import {
  loadBaseUrl,
  loadEditMode,
  loadProjectShellAllowed,
  loadResolvedSkillPaths,
  readConfig,
  searchEnabled,
  webSearchEndpoint,
  webSearchEngine,
} from "../config.js";
import { bootstrapSemanticSearchInCodeMode } from "../index/semantic/tool.js";
import { ToolRegistry } from "../tools.js";
import { registerChoiceTool } from "../tools/choice.js";
import { registerFilesystemTools } from "../tools/filesystem.js";
import { JobRegistry } from "../tools/jobs.js";
import { registerMemoryTools } from "../tools/memory.js";
import { registerPlanTool } from "../tools/plan.js";
import { registerScaffoldTools } from "../tools/scaffold.js";
import { registerShellTools } from "../tools/shell.js";
import { type SkillInstalledHook, registerSkillTools } from "../tools/skills.js";
import { formatSubagentResult, spawnSubagent } from "../tools/subagent.js";
import { registerTodoTool } from "../tools/todo.js";
import { registerWebTools } from "../tools/web.js";

export interface CodeToolsetOpts {
  rootDir: string;
  /** Internal/test hook: read Carbon config from this path instead of the user's home config. */
  configPath?: string;
  /** Fired after `install_skill` writes a new skill — desktop wires this to push a fresh `$skills` event so the sidebar updates without a tab reload. */
  onSkillInstalled?: SkillInstalledHook;
  /** Fired after `run_background` / `stop_job` mutate the JobRegistry — desktop pushes a fresh `$jobs` event so the popover updates without waiting for poll. */
  onJobsChanged?: () => void;
}

export interface CodeToolset {
  tools: ToolRegistry;
  jobs: JobRegistry;
  registerRooted: (root: string) => void;
  /** /add-dir — register an extra allowed root (file + shell tools see it). Returns the full root list or an error. */
  addRoot: (dir: string) => { roots: string[] } | { error: string };
  /** Current workspace roots (primary first, then /add-dir roots). */
  listRoots: () => string[];
  reBootstrapSemantic: (root: string) => Promise<{ enabled: boolean }>;
  semantic: { enabled: boolean };
}

// child === parent, or child sits inside parent.
function isUnder(child: string, parent: string): boolean {
  const rel = relative(parent, child);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

// Defense-in-depth for /add-dir: refuse to widen the sandbox to the filesystem
// root, the home dir, secret dirs (~/.ssh, …), or a system tree (/etc, …) whose
// secrets would then read with no gate. /add-dir is user-invoked (the model has
// no add-dir tool), but this stops an accidental or socially-engineered footgun.
export function isUnsafeRoot(resolved: string): boolean {
  if (resolved === parsePath(resolved).root) return true; // `/` or a drive root
  const home = resolvePath(homedir());
  if (resolved === home) return true;
  const secretDirs = [".ssh", ".aws", ".gnupg", ".kube", ".config/gcloud"].map((d) =>
    resolvePath(home, d),
  );
  // Equal-to or inside a secret dir.
  for (const s of secretDirs) {
    if (isUnder(resolved, s)) return true;
  }
  // Equal-to or an ancestor of a sensitive system tree / secret dir.
  const trees = [
    "/etc",
    "/var",
    "/usr",
    "/bin",
    "/sbin",
    "/root",
    "/boot",
    "/sys",
    "/proc",
    "/dev",
  ].map((p) => resolvePath(p));
  for (const t of [...trees, ...secretDirs]) {
    if (resolved === t || isUnder(t, resolved)) return true;
  }
  return false;
}

export async function buildCodeToolset(opts: CodeToolsetOpts): Promise<CodeToolset> {
  const tools = new ToolRegistry();
  const jobs = new JobRegistry();

  // Primary root + any /add-dir roots. Re-registering a tool by name overwrites
  // it (ToolRegistry uses a Map), so applyRoots() atomically re-roots the file +
  // shell tools to the full set. Switching the primary root drops added roots.
  let primaryRoot = resolvePath(opts.rootDir);
  let additionalRoots: string[] = [];

  // Lazy: constructing DeepSeekClient throws when DEEPSEEK_API_KEY is unset,
  // which would kill `carboncode code` before the setup wizard can prompt for
  // one. Defer to first subagent dispatch. Declared before applyRoots so the
  // run-skill closure (re-created on every re-root) shares one lazy client.
  let subagentClient: DeepSeekClient | null = null;

  const applyRoots = (): void => {
    registerFilesystemTools(tools, { rootDir: primaryRoot, additionalRoots });
    const cfg = readConfig(opts.configPath);
    registerShellTools(tools, {
      rootDir: primaryRoot,
      extraAllowed: () => loadProjectShellAllowed(primaryRoot, opts.configPath),
      allowAll: () => loadEditMode(opts.configPath) === "yolo",
      requireApprovalForBuiltin: true,
      jobs,
      onJobsChanged: opts.onJobsChanged,
      sensitivePaths: cfg.sensitivePaths,
    });
    registerMemoryTools(tools, { projectRoot: primaryRoot });
    // Scaffold + skills are project-scoped too: re-root them so /cwd points
    // create_skill / run_skill at the active project (not the launch dir).
    registerScaffoldTools(tools, { projectRoot: primaryRoot });
    registerSkillTools(tools, {
      projectRoot: primaryRoot,
      customSkillPaths: loadResolvedSkillPaths(primaryRoot, opts.configPath),
      onSkillInstalled: opts.onSkillInstalled,
      subagentRunner: async (skill, task, signal) => {
        if (!subagentClient) subagentClient = new DeepSeekClient({ baseUrl: loadBaseUrl() });
        const result = await spawnSubagent({
          client: subagentClient,
          parentRegistry: tools,
          parentSignal: signal,
          system: skill.body,
          task,
          model: skill.model,
          allowedTools: skill.allowedTools,
          skillName: skill.name,
        });
        return formatSubagentResult(result);
      },
    });
  };

  const registerRooted = (root: string): void => {
    primaryRoot = resolvePath(root);
    additionalRoots = [];
    applyRoots();
  };

  const listRoots = (): string[] => [primaryRoot, ...additionalRoots];

  const addRoot = (dir: string): { roots: string[] } | { error: string } => {
    const resolved = resolvePath(dir);
    let stat: ReturnType<typeof statSync>;
    try {
      stat = statSync(resolved);
    } catch (err) {
      return { error: (err as Error).message };
    }
    if (!stat.isDirectory()) return { error: `${resolved} is not a directory` };
    if (resolved === primaryRoot || additionalRoots.includes(resolved)) {
      return { error: `${resolved} is already a workspace root` };
    }
    if (isUnsafeRoot(resolved)) {
      return {
        error: `refusing to add ${resolved} — system / secret directories can't be workspace roots`,
      };
    }
    additionalRoots = [...additionalRoots, resolved];
    applyRoots();
    return { roots: [primaryRoot, ...additionalRoots] };
  };

  const reBootstrapSemantic = async (root: string): Promise<{ enabled: boolean }> => {
    const result = await bootstrapSemanticSearchInCodeMode(tools, root);
    if (!result.enabled) tools.unregister("semantic_search");
    return result;
  };

  // Root-dependent tools (filesystem / shell / memory / scaffold / skills) are
  // registered by registerRooted → applyRoots. Root-independent tools register once.
  registerRooted(opts.rootDir);
  registerPlanTool(tools);
  registerChoiceTool(tools);
  registerTodoTool(tools);
  if (searchEnabled(opts.configPath)) {
    registerWebTools(tools, {
      webSearchEngine: webSearchEngine(opts.configPath),
      webSearchEndpoint: webSearchEndpoint(opts.configPath),
    });
  }

  const semantic = await reBootstrapSemantic(opts.rootDir);

  return { tools, jobs, registerRooted, addRoot, listRoots, reBootstrapSemantic, semantic };
}
