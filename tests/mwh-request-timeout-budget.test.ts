import { describe, expect, it } from "vitest";
import {
  budgetSnapshot,
  createTimeoutBudget,
  createTimeoutBudgetState,
  deriveChildBudget,
  expireBudgets,
  finishBudget,
  parseTimeoutBudgetHeaders,
  remainingBudgetMs,
  timeoutBudgetHeaders,
} from "../src/mwh/modules/api-traffic/request-timeout-budget/core.js";
import { MemoryTimeoutBudgetRegistry } from "../src/mwh/modules/api-traffic/request-timeout-budget/memory-registry.js";

describe("MWH request-timeout-budget stateless core", () => {
  it("creates budgets, caps child deadlines, and propagates headers", () => {
    const parent = createTimeoutBudget({ id: "req-1", nowMs: 1_000, timeoutMs: 500 });
    const child = deriveChildBudget(parent, { id: "call-1", nowMs: 1_100, timeoutMs: 1_000 });

    expect(parent.deadlineAtMs).toBe(1_500);
    expect(child).toEqual(
      expect.objectContaining({
        id: "call-1",
        parentId: "req-1",
        deadlineAtMs: 1_500,
      }),
    );
    expect(remainingBudgetMs(child, 1_250)).toBe(250);
    expect(timeoutBudgetHeaders(child, 1_250)).toEqual({
      "x-request-deadline-ms": "1500",
      "x-request-timeout-ms": "250",
    });
  });

  it("parses inbound headers and rejects expired external deadlines", () => {
    expect(
      parseTimeoutBudgetHeaders({
        id: "req-1",
        nowMs: 1_000,
        defaultTimeoutMs: 500,
        headers: {
          "x-request-deadline-ms": "1300",
          "x-request-timeout-ms": "1000",
        },
      }).deadlineAtMs,
    ).toBe(1_300);
    expect(() =>
      parseTimeoutBudgetHeaders({
        id: "req-2",
        nowMs: 1_000,
        defaultTimeoutMs: 500,
        headers: { "x-request-deadline-ms": "999" },
      }),
    ).toThrow("deadline header");
  });

  it("expires, completes, cancels, and snapshots budgets", () => {
    const active = createTimeoutBudget({ id: "req-1", nowMs: 1_000, timeoutMs: 100 });
    const completed = finishBudget(
      createTimeoutBudget({ id: "req-2", nowMs: 1_000, timeoutMs: 100 }),
      { nowMs: 1_010, status: "completed" },
    );
    const cancelled = finishBudget(
      createTimeoutBudget({ id: "req-3", nowMs: 1_000, timeoutMs: 100 }),
      { nowMs: 1_010, status: "cancelled", reason: "client closed" },
    );
    const state = expireBudgets(
      { ...createTimeoutBudgetState(), budgets: [active, completed, cancelled] },
      1_100,
    );

    expect(state.budgets.find((budget) => budget.id === "req-1")?.status).toBe("expired");
    expect(budgetSnapshot(state)).toEqual({
      total: 3,
      active: 0,
      expired: 1,
      cancelled: 1,
      completed: 1,
    });
  });
});

describe("MWH request-timeout-budget stateful memory registry", () => {
  it("creates, derives, completes, and keeps clone-safe budget reads", () => {
    let now = 1_000;
    const registry = new MemoryTimeoutBudgetRegistry({
      now: () => now,
      defaultTimeoutMs: 500,
    });
    registry.create({ id: "req-1" });
    const child = registry.derive("req-1", { id: "call-1", timeoutMs: 1_000 });
    expect(child.deadlineAtMs).toBe(1_500);

    const budgets = registry.listBudgets();
    budgets[0]!.status = "expired";
    expect(registry.listBudgets()[0]?.status).toBe("active");

    registry.complete("call-1");
    now = 1_500;
    registry.expire();
    expect(registry.snapshot()).toEqual({
      total: 2,
      active: 0,
      expired: 1,
      cancelled: 0,
      completed: 1,
    });
  });

  it("creates budgets from headers and supports cancellation", () => {
    const registry = new MemoryTimeoutBudgetRegistry({
      now: () => 1_000,
      defaultTimeoutMs: 500,
    });
    registry.fromHeaders({
      id: "req-1",
      headers: { "x-request-timeout-ms": "200" },
    });
    expect(registry.listBudgets()[0]?.deadlineAtMs).toBe(1_200);
    expect(registry.cancel("req-1", "client closed")).toEqual(
      expect.objectContaining({ status: "cancelled", reason: "client closed" }),
    );
  });
});
