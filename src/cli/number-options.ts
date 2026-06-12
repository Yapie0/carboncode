import { InvalidArgumentError } from "commander";

export function parsePositiveIntegerOption(raw: string): number {
  return parseIntegerOption(raw, { min: 1 });
}

export function parseNonNegativeIntegerOption(raw: string): number {
  return parseIntegerOption(raw, { min: 0 });
}

function parseIntegerOption(raw: string, opts: { min: number }): number {
  if (!/^\d+$/.test(raw)) {
    throw new InvalidArgumentError("must be an integer");
  }
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed < opts.min) {
    throw new InvalidArgumentError(
      opts.min === 0 ? "must be a non-negative integer" : "must be a positive integer",
    );
  }
  return parsed;
}
