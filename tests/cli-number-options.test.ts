import { InvalidArgumentError } from "commander";
import { describe, expect, it } from "vitest";
import {
  parseNonNegativeIntegerOption,
  parsePositiveIntegerOption,
} from "../src/cli/number-options.js";

describe("CLI number option parsers", () => {
  it("accepts positive integer strings", () => {
    expect(parsePositiveIntegerOption("1")).toBe(1);
    expect(parsePositiveIntegerOption("42")).toBe(42);
  });

  it("rejects fractional, suffixed, and zero positive-integer values", () => {
    for (const raw of ["1.5", "10abc", "0", "-1", ""]) {
      expect(() => parsePositiveIntegerOption(raw)).toThrow(InvalidArgumentError);
    }
  });

  it("allows zero only for non-negative integer options", () => {
    expect(parseNonNegativeIntegerOption("0")).toBe(0);
    expect(parseNonNegativeIntegerOption("12")).toBe(12);
    expect(() => parseNonNegativeIntegerOption("-1")).toThrow(InvalidArgumentError);
  });
});
