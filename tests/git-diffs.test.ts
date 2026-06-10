import { describe, expect, it } from "vitest";
import { type FileDiff, parseGitDiff } from "../src/server/api/git-diffs.js";

// Helper to strip leading whitespace from template literals
function stripMargin(strings: TemplateStringsArray, ...values: unknown[]): string {
  const raw = String.raw(strings, ...values);
  return raw.replace(/^[ \t]+/gm, "");
}

describe("parseGitDiff", () => {
  it("parses a single modified file", () => {
    const input = stripMargin`
      diff --git a/src/main.ts b/src/main.ts
      index abc123..def456 100644
      --- a/src/main.ts
      +++ b/src/main.ts
      @@ -1,3 +1,4 @@
       line1
      -oldLine
      +newLine
      +extraLine
       line3
    `;

    const result = parseGitDiff(input);
    expect(result).toHaveLength(1);
    expect(result[0]!.file).toBe("src/main.ts");
    expect(result[0]!.additions).toBe(2);
    expect(result[0]!.deletions).toBe(1);
    expect(result[0]!.status).toBe("modified");
    expect(result[0]!.patch).toContain("diff --git a/src/main.ts b/src/main.ts");
  });

  it("parses multiple modified files", () => {
    const input = stripMargin`
      diff --git a/src/main.ts b/src/main.ts
      index abc123..def456 100644
      --- a/src/main.ts
      +++ b/src/main.ts
      @@ -1,2 +1,2 @@
      -old
      +new
      diff --git a/src/utils.ts b/src/utils.ts
      index 111222..333444 100644
      --- a/src/utils.ts
      +++ b/src/utils.ts
      @@ -5,1 +5,1 @@
      -foo
      +bar
    `;

    const result = parseGitDiff(input);
    expect(result).toHaveLength(2);
    expect(result[0]!.file).toBe("src/main.ts");
    expect(result[1]!.file).toBe("src/utils.ts");
  });

  it("detects a new (added) file", () => {
    const input = stripMargin`
      diff --git a/src/new.ts b/src/new.ts
      new file mode 100644
      index 0000000..abc1234
      --- /dev/null
      +++ b/src/new.ts
      @@ -0,0 +1,3 @@
      +const x = 1;
      +const y = 2;
      +export { x, y };
    `;

    const result = parseGitDiff(input);
    expect(result).toHaveLength(1);
    expect(result[0]!.file).toBe("src/new.ts");
    expect(result[0]!.additions).toBe(3);
    expect(result[0]!.deletions).toBe(0);
    expect(result[0]!.status).toBe("added");
  });

  it("detects a deleted file", () => {
    const input = stripMargin`
      diff --git a/src/old.ts b/src/old.ts
      deleted file mode 100644
      index abc1234..0000000
      --- a/src/old.ts
      +++ /dev/null
      @@ -1,2 +0,0 @@
      -const x = 1;
      -export { x };
    `;

    const result = parseGitDiff(input);
    expect(result).toHaveLength(1);
    expect(result[0]!.file).toBe("src/old.ts");
    expect(result[0]!.additions).toBe(0);
    expect(result[0]!.deletions).toBe(2);
    expect(result[0]!.status).toBe("deleted");
  });

  it("returns empty array for empty input", () => {
    expect(parseGitDiff("")).toEqual([]);
  });

  it("returns empty array for input with no diff --git headers", () => {
    expect(parseGitDiff("just some text\nwithout any diff headers")).toEqual([]);
  });

  it("deduplicates files when same file appears in working tree and staged", () => {
    // Simulate combined output from git diff HEAD + git diff --cached
    const input = stripMargin`
      diff --git a/src/main.ts b/src/main.ts
      index abc123..def456 100644
      --- a/src/main.ts
      +++ b/src/main.ts
      @@ -1,1 +1,1 @@
      -a
      +b
      diff --git a/src/main.ts b/src/main.ts
      index abc123..def456 100644
      --- a/src/main.ts
      +++ b/src/main.ts
      @@ -1,1 +1,1 @@
      -b
      +c
    `;

    const result = parseGitDiff(input);
    // parseGitDiff doesn't deduplicate by itself — it returns one entry per block.
    // The caller (handleGitDiffs) deduplicates via the `seen` set.
    // So we just assert both blocks are parsed.
    expect(result).toHaveLength(2);
    expect(result[0]!.file).toBe("src/main.ts");
    expect(result[1]!.file).toBe("src/main.ts");
  });

  it("counts additions and deletions correctly with mixed changes", () => {
    const input = stripMargin`
      diff --git a/src/app.ts b/src/app.ts
      index abc123..def456 100644
      --- a/src/app.ts
      +++ b/src/app.ts
      @@ -10,7 +10,9 @@
       context
      -del1
      +add1
       context
      -del2
      -del3
      +add2
       context
    `;

    const result = parseGitDiff(input);
    expect(result).toHaveLength(1);
    expect(result[0]!.additions).toBe(2);
    expect(result[0]!.deletions).toBe(3);
    expect(result[0]!.status).toBe("modified");
  });

  it("handles rename-like diff with no content changes (just mode)", () => {
    // Some diffs show similarity index but no @@ hunk
    const input = stripMargin`
      diff --git a/src/old-name.ts b/src/new-name.ts
      similarity index 100%
      rename from src/old-name.ts
      rename to src/new-name.ts
    `;

    const result = parseGitDiff(input);
    expect(result).toHaveLength(1);
    expect(result[0]!.file).toBe("src/new-name.ts");
    expect(result[0]!.additions).toBe(0);
    expect(result[0]!.deletions).toBe(0);
    expect(result[0]!.status).toBe("modified");
  });
});
