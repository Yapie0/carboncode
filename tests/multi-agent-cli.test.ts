import { describe, expect, it } from "vitest";
import { parseBenchmarkRoles } from "../src/cli/commands/multi-agent.js";

describe("multi-agent CLI parsing", () => {
  it("defaults to every staged role", () => {
    expect(parseBenchmarkRoles(undefined)).toEqual([
      "design",
      "implementation",
      "testing",
      "acceptance",
    ]);
  });

  it("deduplicates selected roles and rejects unknown values", () => {
    expect(parseBenchmarkRoles("testing,design,testing")).toEqual(["testing", "design"]);
    expect(() => parseBenchmarkRoles("design,security")).toThrow(/未知角色：security/);
  });
});
