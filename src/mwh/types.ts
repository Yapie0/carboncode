export type MwhSourceKind = "builtin" | "external";

export interface MwhModule {
  id: string;
  title: string;
  summary: string;
  version: string;
  tags: readonly string[];
  source: {
    kind: MwhSourceKind;
    label: string;
    url?: string;
  };
  content: string;
}

export interface MwhModuleManifest {
  schemaVersion: 1;
  id: string;
  title: string;
  summary: string;
  version: string;
  tags: readonly string[];
  source: {
    kind: MwhSourceKind;
    label: string;
    url?: string;
  };
  contentSha256: string;
  installedAt: string;
}

export interface InstalledMwhModule {
  manifest: MwhModuleManifest;
  manifestPath: string;
  modulePath: string;
  content: string;
}

export interface MwhCheckResult {
  id: string;
  status: "ok" | "modified" | "missing-module" | "invalid-manifest";
  manifestPath: string;
  modulePath?: string;
  expectedSha256?: string;
  actualSha256?: string;
  reason?: string;
}

export interface MwhUpdateCheckResult {
  id: string;
  status: "current" | "update-available" | "locally-modified" | "source-missing";
  installedVersion?: string;
  availableVersion?: string;
  installedSha256?: string;
  availableSha256?: string;
  reason?: string;
}

export interface MwhInstallOptions {
  projectRoot?: string;
  homeDir?: string;
}

export interface MwhInstallResult {
  id: string;
  manifestPath: string;
  modulePath: string;
}

export interface MwhWriteOptions extends MwhInstallOptions {
  overwrite?: boolean;
}

export interface MwhDeleteOptions extends MwhInstallOptions {
  confirm?: boolean;
}
