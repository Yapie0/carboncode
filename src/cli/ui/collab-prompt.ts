import type { CollabMessage } from "../../collab/inbox.js";

const SUMMARY_STRING_FIELDS = [
  "title",
  "summary",
  "instruction",
  "promptFile",
  "text",
  "status",
  "risk",
] as const;
const MAX_FIELD_CHARS = 900;
const MAX_PROMPT_PREVIEW_CHARS = 2400;
const MAX_JSON_CHARS = 2400;
const MAX_LINE_CHARS = 180;
const MAX_FIELD_LINES = 12;

export function formatCollabPrompt(msg: CollabMessage): string {
  return [
    "You received a Carbon Code collaboration message.",
    "",
    `From: ${msg.from}`,
    `To: ${msg.to}`,
    `Type: ${msg.type}`,
    `Task ID: ${msg.taskId || "(none)"}`,
    `Message ID: ${msg.id}`,
    "",
    "Body summary:",
    ...formatCollabBodySummary(msg.body).map((line) => `- ${line}`),
    "",
    "Instructions:",
    "- If body.promptFile is present, read that file before acting.",
    "- Use the message metadata above when replying.",
    "- Your final assistant response will be sent back through .carboncode/collab.",
  ].join("\n");
}

function formatCollabBodySummary(body: Record<string, unknown>): string[] {
  const lines: string[] = [];
  const promptFile = stringValue(body.promptFile).trim();

  for (const key of SUMMARY_STRING_FIELDS) {
    const value = stringValue(body[key]);
    if (!value.trim()) continue;
    appendField(lines, key, value, MAX_FIELD_CHARS);
  }

  const prompt = stringValue(body.prompt);
  if (prompt.trim()) {
    if (promptFile) {
      lines.push(`prompt: omitted from TUI (${prompt.length} chars); use promptFile instead.`);
    } else {
      appendField(lines, "prompt", prompt, MAX_PROMPT_PREVIEW_CHARS);
    }
  }

  const remaining = compactRemainingBody(body);
  if (remaining.length > 0) {
    appendField(lines, "json", remaining, MAX_JSON_CHARS);
  }

  return lines.length > 0 ? lines : ["{}"];
}

function compactRemainingBody(body: Record<string, unknown>): string {
  const omitted = new Set<string>([...SUMMARY_STRING_FIELDS, "prompt"]);
  const rest: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(body)) {
    if (omitted.has(key)) continue;
    rest[key] = value;
  }
  if (Object.keys(rest).length === 0) return "";
  return JSON.stringify(rest, null, 2);
}

function appendField(lines: string[], key: string, raw: string, maxChars: number): void {
  const clipped = clipText(raw, maxChars);
  const parts = clipped.split(/\r?\n/).slice(0, MAX_FIELD_LINES);
  if (parts.length === 0) return;
  if (parts.length === 1) {
    lines.push(`${key}: ${clipLine(parts[0] ?? "")}`);
    return;
  }
  lines.push(`${key}:`);
  for (const part of parts) {
    lines.push(`  ${clipLine(part)}`);
  }
  if (clipped.split(/\r?\n/).length > MAX_FIELD_LINES) {
    lines.push("  ...");
  }
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function clipText(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}... [${text.length - maxChars} chars omitted]`;
}

function clipLine(line: string): string {
  if (line.length <= MAX_LINE_CHARS) return line;
  const omitted = line.match(/\.\.\. \[\d+ chars omitted\]$/)?.[0];
  if (omitted) {
    const headLength = Math.max(0, MAX_LINE_CHARS - omitted.length);
    return `${line.slice(0, headLength)}${omitted}`;
  }
  return `${line.slice(0, MAX_LINE_CHARS)}...`;
}
