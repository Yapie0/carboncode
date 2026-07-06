import { describe, expect, it } from "vitest";
import { writeAllSync, writeJsonLineSync } from "../src/cli/jsonl-stdio.js";

describe("desktop JSONL stdio writer", () => {
  it("keeps writing until the whole buffer is written when writeSync returns partial writes", () => {
    const chunks: string[] = [];
    const writer = (_fd: number, buffer: Buffer, offset: number, length: number) => {
      const written = Math.min(3, length);
      chunks.push(buffer.subarray(offset, offset + written).toString("utf8"));
      return written;
    };

    writeAllSync(1, Buffer.from("abcdefghijkl", "utf8"), writer);

    expect(chunks.join("")).toBe("abcdefghijkl");
    expect(chunks.length).toBeGreaterThan(1);
  });

  it("serializes a JSON payload plus newline through the full-write path", () => {
    const chunks: string[] = [];
    const writer = (_fd: number, buffer: Buffer, offset: number, length: number) => {
      const written = Math.min(5, length);
      chunks.push(buffer.subarray(offset, offset + written).toString("utf8"));
      return written;
    };

    writeJsonLineSync(1, { type: "$session_loaded", text: "x".repeat(128) }, writer);

    const line = chunks.join("");
    expect(line.endsWith("\n")).toBe(true);
    expect(JSON.parse(line)).toEqual({ type: "$session_loaded", text: "x".repeat(128) });
    expect(chunks.length).toBeGreaterThan(1);
  });

  it("throws instead of spinning forever when the writer reports zero bytes", () => {
    expect(() => writeAllSync(1, Buffer.from("abc", "utf8"), () => 0)).toThrow(/wrote 0 bytes/);
  });

  it("retries EAGAIN writes and preserves the remaining bytes", () => {
    const chunks: string[] = [];
    let attempts = 0;
    const writer = (_fd: number, buffer: Buffer, offset: number, length: number) => {
      attempts += 1;
      if (attempts <= 2) {
        const err = new Error("resource temporarily unavailable") as NodeJS.ErrnoException;
        err.code = "EAGAIN";
        throw err;
      }
      const written = Math.min(4, length);
      chunks.push(buffer.subarray(offset, offset + written).toString("utf8"));
      return written;
    };

    writeAllSync(1, Buffer.from("abcdefghijkl", "utf8"), writer, () => {});

    expect(attempts).toBeGreaterThan(2);
    expect(chunks.join("")).toBe("abcdefghijkl");
  });
});
