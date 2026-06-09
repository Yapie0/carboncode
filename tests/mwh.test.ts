import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  checkInstalledMwhModules,
  checkMwhUpdates,
  installMwhModule,
  listInstalledMwhModules,
  listMwhModules,
  mwhRoot,
  readMwhModule,
  searchMwhModules,
} from "../src/mwh/index.js";
import { SkillStore } from "../src/skills.js";

describe("Middlewave Hub", () => {
  let home: string;
  let projectRoot: string;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "carbon-mwh-home-"));
    projectRoot = mkdtempSync(join(tmpdir(), "carbon-mwh-proj-"));
  });

  afterEach(() => {
    rmSync(home, { recursive: true, force: true });
    rmSync(projectRoot, { recursive: true, force: true });
  });

  it("lists and searches built-in middleware modules", () => {
    expect(listMwhModules().map((module) => module.id)).toContain("video-call-webrtc");
    expect(searchMwhModules("webrtc middleware").map((module) => module.id)).toEqual([
      "video-call-webrtc",
    ]);
  });

  it("installs a module reference package under .carboncode/mwh", () => {
    const result = installMwhModule("video-call-webrtc", { projectRoot, homeDir: home });

    expect("error" in result).toBe(false);
    if ("error" in result) throw new Error(result.error);
    expect(result.manifestPath).toBe(
      join(projectRoot, ".carboncode", "mwh", "modules", "video-call-webrtc", "manifest.json"),
    );
    expect(result.modulePath).toBe(
      join(projectRoot, ".carboncode", "mwh", "modules", "video-call-webrtc", "MWH.md"),
    );
    expect(existsSync(result.manifestPath)).toBe(true);
    expect(readFileSync(result.modulePath, "utf8")).toContain("CallProvider");
    const manifest = JSON.parse(readFileSync(result.manifestPath, "utf8")) as {
      schemaVersion: number;
      version: string;
      contentSha256: string;
    };
    expect(manifest.schemaVersion).toBe(1);
    expect(manifest.version).toBe("0.1.0");
    expect(manifest.contentSha256).toMatch(/^[a-f0-9]{64}$/);
  });

  it("lists installed modules and reads installed content before built-in content", () => {
    const result = installMwhModule("video-call-webrtc", { projectRoot, homeDir: home });
    if ("error" in result) throw new Error(result.error);
    writeFileSync(result.modulePath, "# Local Override\n", "utf8");

    const installed = listInstalledMwhModules({ projectRoot, homeDir: home });
    expect(installed.map((module) => module.manifest.id)).toEqual(["video-call-webrtc"]);
    expect(readMwhModule("video-call-webrtc", { projectRoot, homeDir: home })?.content).toBe(
      "# Local Override\n",
    );
    expect(readMwhModule("video-call-webrtc")?.content).toContain("CallProvider");
  });

  it("checks installed module content against the manifest hash", () => {
    const result = installMwhModule("video-call-webrtc", { projectRoot, homeDir: home });
    if ("error" in result) throw new Error(result.error);
    expect(checkInstalledMwhModules({ projectRoot, homeDir: home })).toEqual([
      expect.objectContaining({ id: "video-call-webrtc", status: "ok" }),
    ]);

    writeFileSync(result.modulePath, "# Changed\n", "utf8");
    expect(checkInstalledMwhModules({ projectRoot, homeDir: home })).toEqual([
      expect.objectContaining({
        id: "video-call-webrtc",
        status: "modified",
        expectedSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        actualSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      }),
    ]);
  });

  it("checks update status without mutating installed modules", () => {
    const result = installMwhModule("video-call-webrtc", { projectRoot, homeDir: home });
    if ("error" in result) throw new Error(result.error);
    expect(checkMwhUpdates({ projectRoot, homeDir: home })).toEqual([
      expect.objectContaining({
        id: "video-call-webrtc",
        status: "current",
        installedVersion: "0.1.0",
        availableVersion: "0.1.0",
      }),
    ]);

    writeFileSync(result.modulePath, "# Changed\n", "utf8");
    expect(checkMwhUpdates({ projectRoot, homeDir: home })).toEqual([
      expect.objectContaining({
        id: "video-call-webrtc",
        status: "locally-modified",
      }),
    ]);
  });

  it("does not install MWH modules as normal skills", () => {
    installMwhModule("video-call-webrtc", { projectRoot, homeDir: home });
    const store = new SkillStore({ homeDir: home, projectRoot, disableBuiltins: true });
    expect(store.read("video-call-webrtc")).toBeNull();
  });

  it("exposes the built-in middlewave-hub skill as the agent-facing guide", () => {
    const store = new SkillStore({ homeDir: home, projectRoot });
    const skill = store.read("middlewave-hub");
    expect(skill?.scope).toBe("builtin");
    expect(skill?.body).toContain("/mwh search");
  });

  it("refuses to overwrite an installed module reference package", () => {
    installMwhModule("video-call-webrtc", { projectRoot, homeDir: home });
    const result = installMwhModule("video-call-webrtc", { projectRoot, homeDir: home });
    expect(result).toEqual({
      error: expect.stringContaining("already exists"),
    });
  });

  it("uses the project MWH root when a workspace is present", () => {
    expect(mwhRoot({ projectRoot, homeDir: home })).toBe(join(projectRoot, ".carboncode", "mwh"));
  });
});
