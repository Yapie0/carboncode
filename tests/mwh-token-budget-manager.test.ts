import { describe, expect, it } from "vitest";
import {
  availableInputTokens,
  createTokenFragment,
  createTokenUsageRecord,
  planTokenBudget,
  summarizeTokenUsage,
} from "../src/mwh/modules/ai-infra/token-budget-manager/core.js";
import { MemoryTokenBudgetManager } from "../src/mwh/modules/ai-infra/token-budget-manager/memory-manager.js";

describe("MWH token-budget-manager middleware", () => {
  it("calculates available input tokens and rejects impossible policies", () => {
    expect(
      availableInputTokens({
        maxInputTokens: 8_000,
        reservedOutputTokens: 1_000,
        systemTokens: 500,
      }),
    ).toBe(6_500);
    expect(() =>
      availableInputTokens({ maxInputTokens: 100, reservedOutputTokens: 80, systemTokens: 30 }),
    ).toThrow("reserved tokens exceed maxInputTokens");
  });

  it("creates fragments and plans priority-aware prompt packing", () => {
    const fragments = [
      createTokenFragment({ id: "low", tokens: 400, priority: 1, content: "low" }),
      createTokenFragment({ id: "high", tokens: 700, priority: 10, content: "high" }),
      createTokenFragment({ id: "small", tokens: 200, priority: 1, content: "small" }),
    ];

    expect(
      planTokenBudget({ maxInputTokens: 1_200, reservedOutputTokens: 200 }, fragments),
    ).toEqual({
      maxInputTokens: 1_200,
      reservedOutputTokens: 200,
      availableInputTokens: 1_000,
      usedInputTokens: 900,
      droppedTokens: 400,
      selected: [expect.objectContaining({ id: "high" }), expect.objectContaining({ id: "small" })],
      dropped: [expect.objectContaining({ id: "low" })],
    });
    expect(() => createTokenFragment({ id: "bad", tokens: 0, content: "x" })).toThrow(
      "tokens must be a positive integer",
    );
  });

  it("creates usage records and summarizes token usage", () => {
    const first = createTokenUsageRecord({
      id: "req-1",
      promptTokens: 100,
      completionTokens: 50,
      nowMs: 1_000,
      metadata: { model: "chat" },
    });
    const second = createTokenUsageRecord({
      id: "req-2",
      promptTokens: 200,
      completionTokens: 75,
      nowMs: 1_100,
    });

    expect(first.totalTokens).toBe(150);
    expect(summarizeTokenUsage([first, second])).toEqual({
      requests: 2,
      promptTokens: 300,
      completionTokens: 125,
      totalTokens: 425,
    });
  });

  it("runs stateful policy, fragment, plan, usage, remove, summary, and clone-safe flows", () => {
    let now = 1_000;
    const manager = new MemoryTokenBudgetManager<{ source: string }>({
      policy: { maxInputTokens: 2_000, reservedOutputTokens: 500, systemTokens: 200 },
      now: () => now,
    });
    manager.upsertFragment({
      id: "system",
      tokens: 200,
      priority: 100,
      content: "policy",
      metadata: { source: "system" },
    });
    manager.upsertFragment({
      id: "retrieval",
      tokens: 1_000,
      priority: 10,
      content: "retrieved context",
      metadata: { source: "vector" },
    });
    manager.upsertFragment({
      id: "extra",
      tokens: 800,
      priority: 1,
      content: "extra",
      metadata: { source: "memory" },
    });

    const plan = manager.plan();
    expect(plan.selected.map((fragment) => fragment.id)).toEqual(["system", "retrieval"]);
    expect(plan.dropped.map((fragment) => fragment.id)).toEqual(["extra"]);
    now = 1_200;
    manager.recordUsage({
      id: "req-1",
      promptTokens: plan.usedInputTokens,
      completionTokens: 300,
      metadata: { model: "chat" },
    });
    expect(manager.usageSummary()).toEqual({
      requests: 1,
      promptTokens: 1_200,
      completionTokens: 300,
      totalTokens: 1_500,
    });

    expect(manager.removeFragment("extra")).toBe(true);
    manager.setPolicy({ maxInputTokens: 2_000, reservedOutputTokens: 300 });
    expect(manager.plan().dropped).toEqual([]);
    const read = manager.listFragments()[0]!;
    read.metadata!.source = "mutated";
    expect(manager.listFragments()[0]?.metadata).toEqual({ source: "vector" });
    expect(manager.audit()).toEqual([expect.objectContaining({ id: "req-1" })]);
  });
});
