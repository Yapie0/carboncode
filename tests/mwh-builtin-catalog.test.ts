import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { listMwhModules, readMwhModule } from "../src/mwh/index.js";

describe("MWH built-in catalog", () => {
  it("exposes every implemented module descriptor through the built-in hub", () => {
    const descriptorIds = listImplementedDescriptorIds();
    const builtinIds = listMwhModules().map((module) => module.id);

    expect(builtinIds).toHaveLength(descriptorIds.length);
    expect(builtinIds).toEqual(expect.arrayContaining(descriptorIds));
  });

  it("keeps every built-in module installable with complete metadata and content", () => {
    for (const module of listMwhModules()) {
      expect(module.id).toMatch(/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/);
      expect(module.title.trim()).toBeTruthy();
      expect(module.summary.trim()).toBeTruthy();
      expect(module.version.trim()).toBeTruthy();
      expect(module.tags.length).toBeGreaterThan(0);
      expect(module.source.kind).toBe("builtin");
      expect(module.content).toContain("# MWH Module:");
      expect(readMwhModule(module.id)?.id).toBe(module.id);
    }
  });

  it("requires every implemented module to have pure core, memory state, and matching tests", () => {
    for (const module of listImplementedModules()) {
      const implementationFiles = readdirSync(module.implementationDir);
      const testPath = join(process.cwd(), "tests", `mwh-${module.id}.test.ts`);
      const testSource = readFileSync(testPath, "utf8");

      expect(implementationFiles).toContain("core.ts");
      expect(implementationFiles.some((entry) => /^memory-.*\.ts$/.test(entry))).toBe(true);
      expect(testSource).toContain(`/modules/${module.category}/${module.id}/core.js`);
      expect(testSource).toMatch(/memory-[^"']+\.js/);
    }
  });
});

function listImplementedDescriptorIds(): string[] {
  return listImplementedModules().map((module) => module.id);
}

interface ImplementedModule {
  category: string;
  id: string;
  implementationDir: string;
}

function listImplementedModules(): ImplementedModule[] {
  const modulesRoot = join(process.cwd(), "src", "mwh", "modules");
  return readdirSync(modulesRoot)
    .flatMap((category) => {
      const categoryDir = join(modulesRoot, category);
      if (!statSync(categoryDir).isDirectory()) return [];
      return readdirSync(categoryDir)
        .filter((entry) => entry.endsWith(".ts"))
        .map((entry) => {
          const id = entry.slice(0, -".ts".length);
          return {
            category,
            id,
            implementationDir: join(categoryDir, id),
          };
        });
    })
    .sort((a, b) => a.id.localeCompare(b.id));
}
