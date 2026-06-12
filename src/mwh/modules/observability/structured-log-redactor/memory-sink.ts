import {
  type LogLevel,
  type LogSnapshot,
  type RedactionPolicy,
  type StructuredLogEvent,
  cloneStructuredLogEvent,
  createStructuredLogEvent,
  logSnapshot,
  stableLogJson,
} from "./core.js";

export interface StoredStructuredLog {
  event: StructuredLogEvent;
  redactedPaths: readonly string[];
  json: string;
}

export interface MemoryStructuredLogSinkOptions {
  policy: RedactionPolicy;
  now?: () => number;
}

export class MemoryStructuredLogSink {
  private readonly entries: StoredStructuredLog[] = [];
  private readonly policy: RedactionPolicy;
  private readonly now: () => number;

  constructor(options: MemoryStructuredLogSinkOptions) {
    this.policy = clonePolicy(options.policy);
    this.now = options.now ?? Date.now;
  }

  append(input: {
    id: string;
    level: LogLevel;
    message: string;
    context?: Record<string, unknown>;
  }): StoredStructuredLog {
    if (this.entries.some((entry) => entry.event.id === input.id)) {
      throw new Error("structured log already exists");
    }
    const result = createStructuredLogEvent({
      ...input,
      timestampMs: this.now(),
      policy: this.policy,
    });
    const entry = {
      event: result.event,
      redactedPaths: result.redactedPaths,
      json: stableLogJson(result.event),
    };
    this.entries.push(entry);
    return cloneEntry(entry);
  }

  list(input: { level?: LogLevel } = {}): StoredStructuredLog[] {
    return this.entries
      .filter((entry) => !input.level || entry.event.level === input.level)
      .map(cloneEntry);
  }

  snapshot(): LogSnapshot {
    return logSnapshot(this.entries);
  }
}

function cloneEntry(entry: StoredStructuredLog): StoredStructuredLog {
  return {
    event: cloneStructuredLogEvent(entry.event),
    redactedPaths: [...entry.redactedPaths],
    json: entry.json,
  };
}

function clonePolicy(policy: RedactionPolicy): RedactionPolicy {
  return {
    ...policy,
    redactedKeys: [...policy.redactedKeys],
    redactedPaths: policy.redactedPaths ? [...policy.redactedPaths] : undefined,
    redactedPatterns: policy.redactedPatterns ? [...policy.redactedPatterns] : undefined,
  };
}
