import { describe, expect, it } from "vitest";
import {
  agentCanRunTask,
  cancelAgentTask,
  chooseAgentForTask,
  claimAgentTask,
  compareQueuedTasks,
  createAgentTask,
  createAgentWorker,
  finishAgentTask,
  requeueAgentTask,
} from "../src/mwh/modules/ai-infra/agent-task-dispatcher/core.js";
import { MemoryAgentTaskDispatcher } from "../src/mwh/modules/ai-infra/agent-task-dispatcher/memory-dispatcher.js";

describe("MWH agent-task-dispatcher middleware", () => {
  it("creates normalized workers and tasks", () => {
    const worker = createAgentWorker({
      id: "codex",
      capabilities: [" tests ", "typescript", "tests"],
      priority: 5,
      maxConcurrentTasks: 2,
      nowMs: 1_000,
    });
    const task = createAgentTask({
      id: "task-1",
      type: "implement",
      payload: { module: "mwh" },
      requiredCapabilities: ["typescript", "tests"],
      priority: 10,
      nowMs: 1_100,
    });

    expect(worker.capabilities).toEqual(["tests", "typescript"]);
    expect(task).toEqual(
      expect.objectContaining({
        id: "task-1",
        status: "queued",
        requiredCapabilities: ["tests", "typescript"],
      }),
    );
    expect(() =>
      createAgentWorker({
        id: "bad",
        capabilities: [],
        nowMs: 1_000,
      }),
    ).toThrow("capabilities are required");
  });

  it("matches agents by status, capabilities, concurrency, priority, and load", () => {
    const task = createAgentTask({
      id: "task-1",
      type: "test",
      payload: {},
      requiredCapabilities: ["tests"],
      nowMs: 1_000,
    });
    const workers = [
      createAgentWorker({
        id: "busy",
        capabilities: ["tests"],
        activeTaskIds: ["other"],
        maxConcurrentTasks: 1,
        priority: 100,
        nowMs: 1_000,
      }),
      createAgentWorker({
        id: "degraded",
        capabilities: ["tests"],
        status: "degraded",
        priority: 100,
        nowMs: 1_000,
      }),
      createAgentWorker({
        id: "healthy",
        capabilities: ["tests"],
        priority: 1,
        nowMs: 1_000,
      }),
    ];

    expect(agentCanRunTask(workers[0]!, task)).toBe(false);
    expect(chooseAgentForTask(workers, task)?.id).toBe("healthy");
  });

  it("orders queued tasks and runs claim, finish, and cancel transitions", () => {
    const low = createAgentTask({
      id: "low",
      type: "work",
      payload: {},
      requiredCapabilities: ["code"],
      priority: 1,
      nowMs: 1_000,
    });
    const high = createAgentTask({
      id: "high",
      type: "work",
      payload: {},
      requiredCapabilities: ["code"],
      priority: 5,
      nowMs: 1_100,
    });
    const worker = createAgentWorker({
      id: "codex",
      capabilities: ["code"],
      nowMs: 1_000,
    });

    expect([low, high].sort(compareQueuedTasks).map((task) => task.id)).toEqual(["high", "low"]);
    const assignment = claimAgentTask(high, worker, { nowMs: 1_200 });
    expect(assignment.task).toEqual(
      expect.objectContaining({ status: "running", assignedAgentId: "codex" }),
    );
    expect(assignment.agent.activeTaskIds).toEqual(["high"]);
    expect(
      finishAgentTask(assignment.task, assignment.agent, {
        status: "succeeded",
        nowMs: 1_300,
      }).task,
    ).toEqual(expect.objectContaining({ status: "succeeded", finishedAtMs: 1_300 }));
    const retry = requeueAgentTask({ ...assignment.task, status: "running" }, assignment.agent, {
      nowMs: 1_350,
      reason: "agent restarted",
    });
    expect(retry.task).toEqual(
      expect.objectContaining({
        status: "queued",
        assignedAgentId: undefined,
        startedAtMs: undefined,
        lastError: "agent restarted",
      }),
    );
    expect(retry.agent.activeTaskIds).toEqual([]);
    expect(cancelAgentTask(low, { nowMs: 1_400, reason: "obsolete" })).toEqual(
      expect.objectContaining({ status: "cancelled", lastError: "obsolete" }),
    );
  });

  it("runs stateful registration, enqueue, dispatch, concurrency, status, finish, fail, cancel, and clone-safe flows", () => {
    let now = 1_000;
    const dispatcher = new MemoryAgentTaskDispatcher<{ module?: string }>({ now: () => now });
    dispatcher.upsertWorker({
      id: "codex",
      capabilities: ["typescript", "tests"],
      maxConcurrentTasks: 1,
      priority: 1,
    });
    dispatcher.upsertWorker({
      id: "claude",
      capabilities: ["typescript", "tests"],
      maxConcurrentTasks: 1,
      priority: 2,
    });
    dispatcher.enqueue({
      id: "task-1",
      type: "implement",
      payload: { module: "a" },
      requiredCapabilities: ["typescript", "tests"],
      priority: 1,
    });
    dispatcher.enqueue({
      id: "task-2",
      type: "implement",
      payload: { module: "b" },
      requiredCapabilities: ["typescript"],
      priority: 5,
    });

    const first = dispatcher.dispatchNext()!;
    expect(first.task.id).toBe("task-2");
    expect(first.agent.id).toBe("claude");
    const second = dispatcher.dispatchNext()!;
    expect(second.task.id).toBe("task-1");
    expect(second.agent.id).toBe("codex");
    expect(dispatcher.dispatchNext()).toBeUndefined();

    now = 1_200;
    dispatcher.finish({
      taskId: first.task.id,
      agentId: first.agent.id,
      status: "failed",
      error: "no access",
    });
    dispatcher.finish({ taskId: second.task.id, agentId: second.agent.id, status: "succeeded" });
    expect(dispatcher.listTasks("failed")).toEqual([
      expect.objectContaining({ id: "task-2", lastError: "no access" }),
    ]);
    dispatcher.enqueue({
      id: "task-3",
      type: "review",
      payload: { module: "c" },
      requiredCapabilities: ["typescript"],
    });
    dispatcher.setWorkerStatus("claude", "offline");
    expect(dispatcher.dispatchNext()?.agent.id).toBe("codex");
    dispatcher.cancel({ taskId: "task-3", reason: "user cancelled" });

    const task = dispatcher.listTasks().find((item) => item.id === "task-1")!;
    task.payload.module = "mutated";
    expect(dispatcher.listTasks().find((item) => item.id === "task-1")?.payload).toEqual({
      module: "a",
    });
    expect(dispatcher.listWorkers().map((worker) => worker.id)).toEqual(["claude", "codex"]);
  });

  it("runs stateful batch dispatch, requeue, worker drain, and queue-depth flows", () => {
    let now = 1_000;
    const dispatcher = new MemoryAgentTaskDispatcher<{ module: string }>({ now: () => now });
    dispatcher.upsertWorker({
      id: "codex",
      capabilities: ["typescript"],
      maxConcurrentTasks: 2,
    });
    dispatcher.enqueue({
      id: "task-1",
      type: "implement",
      payload: { module: "a" },
      requiredCapabilities: ["typescript"],
    });
    dispatcher.enqueue({
      id: "task-2",
      type: "test",
      payload: { module: "b" },
      requiredCapabilities: ["typescript"],
    });

    expect(dispatcher.dispatchMany(2).map((assignment) => assignment.task.id)).toEqual([
      "task-1",
      "task-2",
    ]);
    expect(dispatcher.queueDepth()).toEqual({
      queued: 0,
      running: 2,
      succeeded: 0,
      failed: 0,
      cancelled: 0,
    });

    now = 1_100;
    expect(
      dispatcher.requeue({ taskId: "task-1", agentId: "codex", reason: "transient failure" }).task,
    ).toEqual(
      expect.objectContaining({
        id: "task-1",
        status: "queued",
        lastError: "transient failure",
      }),
    );
    expect(dispatcher.queueDepth()).toEqual({
      queued: 1,
      running: 1,
      succeeded: 0,
      failed: 0,
      cancelled: 0,
    });

    expect(dispatcher.dispatchMany(5).map((assignment) => assignment.task.id)).toEqual(["task-1"]);
    expect(
      dispatcher.requeueRunningForAgent("codex", "worker offline").map((task) => task.id),
    ).toEqual(["task-1", "task-2"]);
    expect(dispatcher.listWorkers()[0]?.activeTaskIds).toEqual([]);
    expect(dispatcher.queueDepth()).toEqual({
      queued: 2,
      running: 0,
      succeeded: 0,
      failed: 0,
      cancelled: 0,
    });
  });
});
