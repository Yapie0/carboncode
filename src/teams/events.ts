import { randomUUID } from "node:crypto";
import { appendFileSync, readFileSync } from "node:fs";
import { eventsJsonlPath } from "./paths.js";
import type { TeamEvent, TeamEventType } from "./types.js";

export interface LogEventInput {
  type: TeamEventType;
  agentId: string;
  taskId?: string;
  body?: Record<string, unknown>;
}

export function logEvent(workspaceRoot: string, teamId: string, input: LogEventInput): TeamEvent {
  const event: TeamEvent = {
    id: randomUUID(),
    type: input.type,
    agentId: input.agentId,
    taskId: input.taskId,
    createdAt: new Date().toISOString(),
    body: input.body ?? {},
  };

  appendFileSync(eventsJsonlPath(workspaceRoot, teamId), `${JSON.stringify(event)}\n`, "utf-8");
  return event;
}

export interface ReadEventsOptions {
  type?: TeamEventType;
  agentId?: string;
  taskId?: string;
  /** 最多返回 N 条 */
  limit?: number;
}

export function readEvents(
  workspaceRoot: string,
  teamId: string,
  options: ReadEventsOptions = {},
): TeamEvent[] {
  let events = readAllEvents(workspaceRoot, teamId);

  if (options.type) events = events.filter((e) => e.type === options.type);
  if (options.agentId) events = events.filter((e) => e.agentId === options.agentId);
  if (options.taskId) events = events.filter((e) => e.taskId === options.taskId);

  // 最近优先
  events.sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  if (options.limit && options.limit > 0) {
    events = events.slice(0, options.limit);
  }

  return events;
}

function readAllEvents(workspaceRoot: string, teamId: string): TeamEvent[] {
  try {
    const raw = readFileSync(eventsJsonlPath(workspaceRoot, teamId), "utf-8").trim();
    if (!raw) return [];
    return raw.split("\n").map((line) => JSON.parse(line) as TeamEvent);
  } catch {
    return [];
  }
}
