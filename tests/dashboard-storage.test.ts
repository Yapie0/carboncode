import { beforeEach, describe, expect, it, vi } from "vitest";
import { readDashboardStorage, writeDashboardStorage } from "../dashboard/src/lib/storage.js";

describe("dashboard storage", () => {
  const values = new Map<string, string>();

  beforeEach(() => {
    values.clear();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    });
  });

  it("prefers Carbon Code keys over legacy values", () => {
    values.set("carboncode.theme", "dark");
    values.set("rx.theme", "light");

    expect(readDashboardStorage("theme")).toBe("dark");
  });

  it("reads and migrates legacy dashboard values", () => {
    values.set("rx.simpleMode", "0");

    expect(readDashboardStorage("simpleMode")).toBe("0");
    expect(values.get("carboncode.simpleMode")).toBe("0");
  });

  it("writes only the Carbon Code key", () => {
    writeDashboardStorage("lang", "zh-CN");

    expect(values.get("carboncode.lang")).toBe("zh-CN");
    expect(values.has("rx.lang")).toBe(false);
  });

  it("still returns a legacy value when migration cannot write", () => {
    values.set("rx.activeTab", "settings");
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: () => {
        throw new Error("read-only");
      },
    });

    expect(readDashboardStorage("activeTab")).toBe("settings");
  });
});
