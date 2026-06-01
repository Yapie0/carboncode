import { describe, expect, it } from "vitest";
import { parseGitDiff } from "../src/server/api/git-diffs.js";

describe("parseGitDiff", () => {
  it("counts changed lines without counting diff file headers", () => {
    const diff = [
      "diff --git a/src/app.ts b/src/app.ts",
      "index 1111111..2222222 100644",
      "--- a/src/app.ts",
      "+++ b/src/app.ts",
      "@@ -1,3 +1,4 @@",
      " const keep = true;",
      "-const oldName = 'reasonix';",
      "+const newName = 'carboncode';",
      "+const enabled = true;",
      " export { keep };",
      "diff --git a/src/new.ts b/src/new.ts",
      "new file mode 100644",
      "index 0000000..3333333",
      "--- /dev/null",
      "+++ b/src/new.ts",
      "@@ -0,0 +1,2 @@",
      "+export const one = 1;",
      "+export const two = 2;",
      "diff --git a/src/old.ts b/src/old.ts",
      "deleted file mode 100644",
      "index 4444444..0000000",
      "--- a/src/old.ts",
      "+++ /dev/null",
      "@@ -1,2 +0,0 @@",
      "-export const gone = true;",
      "-export const alsoGone = true;",
      "",
    ].join("\n");

    expect(parseGitDiff(diff)).toEqual([
      {
        file: "src/app.ts",
        additions: 2,
        deletions: 1,
        patch: expect.any(String),
        status: "modified",
      },
      {
        file: "src/new.ts",
        additions: 2,
        deletions: 0,
        patch: expect.any(String),
        status: "added",
      },
      {
        file: "src/old.ts",
        additions: 0,
        deletions: 2,
        patch: expect.any(String),
        status: "deleted",
      },
    ]);
  });
});
