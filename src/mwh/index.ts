import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { CARBON_RUNTIME_DIRNAME } from "../skills.js";
import { BUILTIN_MWH_MODULES } from "./builtin.js";
import type {
  InstalledMwhModule,
  MwhCheckResult,
  MwhDeleteOptions,
  MwhInstallOptions,
  MwhInstallResult,
  MwhModule,
  MwhModuleManifest,
  MwhUpdateCheckResult,
  MwhWriteOptions,
} from "./types.js";

export const MWH_DIRNAME = "mwh";
export const MWH_MODULES_DIRNAME = "modules";
export const MWH_MANIFEST_FILE = "manifest.json";
export const MWH_MODULE_FILE = "MWH.md";

const VALID_MWH_ID = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/;

export type {
  InstalledMwhModule,
  MwhCheckResult,
  MwhInstallOptions,
  MwhInstallResult,
  MwhModule,
  MwhModuleManifest,
  MwhUpdateCheckResult,
  MwhDeleteOptions,
  MwhWriteOptions,
} from "./types.js";

export function listMwhModules(): MwhModule[] {
  return [...BUILTIN_MWH_MODULES].sort((a, b) => a.id.localeCompare(b.id));
}

export function searchMwhModules(query: string): MwhModule[] {
  const normalized = query.trim().toLowerCase();
  const modules = listMwhModules();
  if (!normalized) return modules;
  const terms = normalized.split(/\s+/).filter(Boolean);
  return modules.filter((module) => {
    const haystack = [module.id, module.title, module.summary, module.source.label, ...module.tags]
      .join("\n")
      .toLowerCase();
    return terms.every((term) => haystack.includes(term));
  });
}

export function readMwhModule(id: string, opts?: MwhInstallOptions): MwhModule | null {
  const normalized = id.trim().toLowerCase();
  if (opts) {
    const installed = readInstalledMwhModule(normalized, opts);
    if (installed) return installedToModule(installed);
  }
  return listMwhModules().find((module) => module.id.toLowerCase() === normalized) ?? null;
}

export function mwhRoot(opts: MwhInstallOptions): string {
  const base = resolve(opts.homeDir ?? opts.projectRoot ?? homedir());
  return join(base, CARBON_RUNTIME_DIRNAME, MWH_DIRNAME);
}

export function mwhModulesRoot(opts: MwhInstallOptions): string {
  return join(mwhRoot(opts), MWH_MODULES_DIRNAME);
}

export function listInstalledMwhModules(opts: MwhInstallOptions): InstalledMwhModule[] {
  const root = mwhModulesRoot(opts);
  if (!existsSync(root)) return [];
  let entries: import("node:fs").Dirent[];
  try {
    entries = readdirSync(root, { withFileTypes: true });
  } catch {
    return [];
  }
  const modules: InstalledMwhModule[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const module = readInstalledMwhModule(entry.name, opts);
    if (module) modules.push(module);
  }
  return modules.sort((a, b) => a.manifest.id.localeCompare(b.manifest.id));
}

export function readInstalledMwhModule(
  id: string,
  opts: MwhInstallOptions,
): InstalledMwhModule | null {
  if (!VALID_MWH_ID.test(id)) return null;
  const moduleDir = join(mwhModulesRoot(opts), id);
  const manifestPath = join(moduleDir, MWH_MANIFEST_FILE);
  const modulePath = join(moduleDir, MWH_MODULE_FILE);
  if (!existsSync(manifestPath) || !existsSync(modulePath)) return null;
  try {
    const manifest = parseManifest(readFileSync(manifestPath, "utf8"));
    if (!manifest || manifest.id !== id) return null;
    return {
      manifest,
      manifestPath,
      modulePath,
      content: readFileSync(modulePath, "utf8"),
    };
  } catch {
    return null;
  }
}

export function checkInstalledMwhModules(opts: MwhInstallOptions): MwhCheckResult[] {
  const root = mwhModulesRoot(opts);
  if (!existsSync(root)) return [];
  let entries: import("node:fs").Dirent[];
  try {
    entries = readdirSync(root, { withFileTypes: true });
  } catch {
    return [];
  }
  const results: MwhCheckResult[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const moduleDir = join(root, entry.name);
    const manifestPath = join(moduleDir, MWH_MANIFEST_FILE);
    const modulePath = join(moduleDir, MWH_MODULE_FILE);
    let manifest: MwhModuleManifest | null = null;
    try {
      manifest = parseManifest(readFileSync(manifestPath, "utf8"));
    } catch {
      // handled below
    }
    if (!manifest) {
      results.push({
        id: entry.name,
        status: "invalid-manifest",
        manifestPath,
        modulePath,
        reason: "manifest.json is missing or invalid",
      });
      continue;
    }
    if (!existsSync(modulePath)) {
      results.push({
        id: manifest.id,
        status: "missing-module",
        manifestPath,
        modulePath,
        expectedSha256: manifest.contentSha256,
      });
      continue;
    }
    const actualSha256 = sha256(readFileSync(modulePath, "utf8"));
    results.push({
      id: manifest.id,
      status: actualSha256 === manifest.contentSha256 ? "ok" : "modified",
      manifestPath,
      modulePath,
      expectedSha256: manifest.contentSha256,
      actualSha256,
    });
  }
  return results.sort((a, b) => a.id.localeCompare(b.id));
}

export function checkMwhUpdates(opts: MwhInstallOptions): MwhUpdateCheckResult[] {
  return listInstalledMwhModules(opts).map((installed) => {
    const source = listMwhModules().find((module) => module.id === installed.manifest.id);
    const installedSha256 = sha256(installed.content);
    if (installedSha256 !== installed.manifest.contentSha256) {
      return {
        id: installed.manifest.id,
        status: "locally-modified",
        installedVersion: installed.manifest.version,
        installedSha256,
        reason: "local MWH.md differs from manifest hash; resolve with /mwh check before updating",
      };
    }
    if (!source) {
      return {
        id: installed.manifest.id,
        status: "source-missing",
        installedVersion: installed.manifest.version,
        installedSha256,
        reason: "installed module source is not available in the current provider set",
      };
    }
    const availableContent = normalizeContent(source.content);
    const availableSha256 = sha256(availableContent);
    const available =
      source.version !== installed.manifest.version ||
      availableSha256 !== installed.manifest.contentSha256;
    return {
      id: installed.manifest.id,
      status: available ? "update-available" : "current",
      installedVersion: installed.manifest.version,
      availableVersion: source.version,
      installedSha256: installed.manifest.contentSha256,
      availableSha256,
    };
  });
}

export function installMwhModule(
  id: string,
  opts: MwhInstallOptions,
): MwhInstallResult | { error: string } {
  const module = readMwhModule(id);
  if (!module) return { error: `MWH module not found: ${id}` };
  return writeMwhModule(module, opts);
}

export function writeMwhModule(
  module: MwhModule,
  opts: MwhWriteOptions,
): MwhInstallResult | { error: string } {
  const validation = validateMwhModule(module);
  if (validation) return { error: validation };
  const moduleDir = join(mwhModulesRoot(opts), module.id);
  const manifestPath = join(moduleDir, MWH_MANIFEST_FILE);
  const modulePath = join(moduleDir, MWH_MODULE_FILE);
  if (!opts.overwrite && (existsSync(manifestPath) || existsSync(modulePath))) {
    return { error: `MWH module "${module.id}" already exists at ${moduleDir}` };
  }

  mkdirSync(moduleDir, { recursive: true });
  const content = normalizeContent(module.content);
  const manifest = buildManifest(module, content);
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, {
    encoding: "utf8",
    flag: "wx",
  });
  writeFileSync(modulePath, content, { encoding: "utf8", flag: "wx" });

  return {
    id: module.id,
    manifestPath,
    modulePath,
  };
}

export function updateMwhModule(
  id: string,
  patch: Partial<Omit<MwhModule, "id">>,
  opts: MwhInstallOptions,
): MwhInstallResult | { error: string } {
  const installed = readInstalledMwhModule(id, opts);
  if (!installed) return { error: `installed MWH module not found: ${id}` };
  const next: MwhModule = {
    id: installed.manifest.id,
    title: patch.title ?? installed.manifest.title,
    summary: patch.summary ?? installed.manifest.summary,
    version: patch.version ?? installed.manifest.version,
    tags: patch.tags ?? installed.manifest.tags,
    source: patch.source ?? installed.manifest.source,
    content: patch.content ?? installed.content,
  };
  return writeMwhModule(next, { ...opts, overwrite: true });
}

export function deleteMwhModule(
  id: string,
  opts: MwhDeleteOptions,
): { id: string; path: string } | { error: string } {
  if (!opts.confirm) return { error: "delete requires confirm: true" };
  if (!VALID_MWH_ID.test(id)) return { error: `invalid MWH module id: ${id}` };
  const root = resolve(mwhModulesRoot(opts));
  const target = resolve(join(root, id));
  const rootWithSep =
    root.endsWith("\\") || root.endsWith("/")
      ? root
      : `${root}${process.platform === "win32" ? "\\" : "/"}`;
  if (target !== root && !target.startsWith(rootWithSep)) {
    return { error: `refusing to delete outside MWH modules root: ${target}` };
  }
  if (!existsSync(target)) return { error: `installed MWH module not found: ${id}` };
  rmSync(target, { recursive: true, force: true });
  return { id, path: target };
}

function buildManifest(module: MwhModule, content: string): MwhModuleManifest {
  return {
    schemaVersion: 1,
    id: module.id,
    title: module.title,
    summary: module.summary,
    version: module.version,
    tags: module.tags,
    source: module.source,
    contentSha256: sha256(content),
    installedAt: new Date().toISOString(),
  };
}

function validateMwhModule(module: MwhModule): string | null {
  if (!VALID_MWH_ID.test(module.id)) return `invalid MWH module id: ${module.id}`;
  if (!module.title.trim()) return "MWH module title is required";
  if (!module.summary.trim()) return "MWH module summary is required";
  if (!module.version.trim()) return "MWH module version is required";
  if (!Array.isArray(module.tags) || module.tags.some((tag) => !tag.trim())) {
    return "MWH module tags must be non-empty strings";
  }
  if (module.source.kind !== "builtin" && module.source.kind !== "external") {
    return "MWH module source.kind must be builtin or external";
  }
  if (!module.source.label.trim()) return "MWH module source.label is required";
  if (!module.content.trim()) return "MWH module content is required";
  return null;
}

function installedToModule(module: InstalledMwhModule): MwhModule {
  return {
    id: module.manifest.id,
    title: module.manifest.title,
    summary: module.manifest.summary,
    version: module.manifest.version,
    tags: module.manifest.tags,
    source: module.manifest.source,
    content: module.content,
  };
}

function normalizeContent(content: string): string {
  return `${content.trim()}\n`;
}

function parseManifest(raw: string): MwhModuleManifest | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const data = parsed as Partial<MwhModuleManifest>;
  if (
    data.schemaVersion !== 1 ||
    typeof data.id !== "string" ||
    !VALID_MWH_ID.test(data.id) ||
    typeof data.title !== "string" ||
    typeof data.summary !== "string" ||
    typeof data.version !== "string" ||
    !Array.isArray(data.tags) ||
    typeof data.source !== "object" ||
    !data.source ||
    typeof data.source.kind !== "string" ||
    typeof data.source.label !== "string" ||
    typeof data.contentSha256 !== "string" ||
    typeof data.installedAt !== "string"
  ) {
    return null;
  }
  if (data.source.kind !== "builtin" && data.source.kind !== "external") return null;
  return data as MwhModuleManifest;
}

function sha256(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}
