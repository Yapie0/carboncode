import { Box, Text, useStdout } from "ink";
import React from "react";
import { clipToCells } from "../../../frame/width.js";
import { t } from "../../../i18n/index.js";
import { Markdown } from "../markdown.js";
import { Card } from "../primitives/Card.js";
import { CardHeader, type MetaItem } from "../primitives/CardHeader.js";
import { Spinner } from "../primitives/Spinner.js";
import type { ToolCard as ToolCardData } from "../state/cards.js";
import { useIsInflight } from "../state/inflight-context.js";
import { GLYPH } from "../theme.js";
import { FG, TONE, TONE_ACTIVE } from "../theme/tokens.js";
import {
  formatStructuredErrorOutput,
  friendlyToolName,
  summarizeCommandOutput,
} from "../tool-summary.js";

const READ_TAIL = 2;
const OTHER_TAIL = 5;

/** Read-style tools dump file/list bodies — short tail is enough; the model already has the full text in context. */
function isReadStyleTool(name: string): boolean {
  const lower = name.toLowerCase();
  return (
    /(?:^|_)(read|search|list|tree|get|status|diff|fetch|grep)(_|$)/.test(lower) ||
    lower === "job_output"
  );
}

function tailLinesFor(name: string): number {
  return isReadStyleTool(name) ? READ_TAIL : OTHER_TAIL;
}

function isShellTool(name: string): boolean {
  return (
    name === "run_command" ||
    name === "run_background" ||
    /(?:^|_)(run_command|run_background)$/.test(name)
  );
}

export function ToolCard({
  card,
  compact = false,
}: {
  card: ToolCardData;
  compact?: boolean;
}): React.ReactElement {
  const { stdout } = useStdout();
  const cols = stdout?.columns ?? 80;
  const lineCells = Math.max(20, cols - 4);
  // Result lines sit under a "  ⎿  " gutter (5 cells), so reserve room to avoid wrap.
  const bodyCells = Math.max(16, cols - 6);
  const argsLabel = formatArgsSummary(card.args);
  // Claude-style header: friendly verb + parenthesized primary arg, e.g. "Bash(npm test)".
  const headerTitle = argsLabel
    ? `${friendlyToolName(card.name)}(${argsLabel})`
    : friendlyToolName(card.name);

  const subagentMarkdown = React.useMemo(
    () => unwrapSubagentMarkdown(card.name, card.output),
    [card.name, card.output],
  );

  const displayOutput = React.useMemo(() => {
    const formatted = formatStructuredErrorOutput(card.output);
    if (!isShellTool(card.name)) return formatted;
    const summary = summarizeCommandOutput(formatted);
    if (summary.status !== "failed") return formatted;
    const details = summary.failures.length > 0 ? summary.failures : summary.tail;
    return compactFailureLines(summary.headline, details).join("\n");
  }, [card.name, card.output]);
  const allLines = displayOutput.length > 0 ? displayOutput.split("\n") : [];
  const tail = tailLinesFor(card.name);
  const truncated = allLines.length > tail;
  const visible = truncated ? allLines.slice(-tail) : allLines;
  const hidden = truncated ? allLines.length - visible.length : 0;
  const isInflight = useIsInflight(card.id);
  const status = toolStatus(card, isInflight);
  const headColor = headerColorFor(status);
  const errColor = card.exitCode && card.exitCode !== 0 ? TONE.err : FG.sub;
  // Rejected calls show a single trailing badge — the verbose JSON error body
  // is already conveyed by the badge, so dropping the body keeps the card tight.
  const readStyleSuccess = isReadStyleTool(card.name) && status === "ok";
  const compactSuccess = compact && card.done && status === "ok";
  const showBody =
    !card.rejected &&
    !readStyleSuccess &&
    !compactSuccess &&
    (subagentMarkdown !== null || visible.length > 0);

  const meta: MetaItem[] = [];
  if (card.retry) {
    meta.push({ text: `↻ ${card.retry.attempt}/${card.retry.max}`, color: TONE.warn });
  }
  if (card.rejected) {
    meta.push({ text: t("cardLabels.rejected"), color: TONE.err });
  }
  for (const part of metaTrail(card)) meta.push(part);

  return (
    <Card tone={headColor}>
      <CardHeader
        glyph={statusGlyph(status)}
        tone={headColor}
        title={headerTitle}
        meta={meta.length > 0 ? meta : undefined}
        right={
          status === "running" ? (
            <Spinner kind="braille" color={TONE_ACTIVE.brand} bold />
          ) : undefined
        }
      />
      {showBody &&
        (subagentMarkdown !== null ? (
          <Markdown text={subagentMarkdown} width={lineCells} />
        ) : (
          <Box flexDirection="row">
            <Text color={FG.faint}>{`  ${GLYPH.vine}  `}</Text>
            <Box flexDirection="column">
              {hidden > 0 ? (
                <Text color={FG.faint}>
                  {t(hidden === 1 ? "cardLabels.earlierLine" : "cardLabels.earlierLines", {
                    count: hidden,
                  })}
                </Text>
              ) : null}
              {visible.map((line, i) => (
                <Text
                  key={`${card.id}:${hidden + i}`}
                  color={errColor}
                  dimColor={!card.exitCode || card.exitCode === 0}
                >
                  {clipToCells(line, bodyCells) || " "}
                </Text>
              ))}
            </Box>
          </Box>
        ))}
    </Card>
  );
}

function unwrapSubagentMarkdown(name: string, output: string): string | null {
  if (name !== "spawn_subagent") return null;
  if (output.length === 0) return null;
  try {
    const parsed = JSON.parse(output) as unknown;
    if (!parsed || typeof parsed !== "object") return null;
    const obj = parsed as Record<string, unknown>;
    if (obj.success !== true) return null;
    if (typeof obj.output !== "string") return null;
    return obj.output;
  } catch {
    return null;
  }
}

type ToolStatus = "running" | "ok" | "rejected" | "error" | "aborted";

function toolStatus(card: ToolCardData, isInflight: boolean): ToolStatus {
  // Running is derived from the loop's inflight set so a missed `tool` event
  // can't strand the spinner forever — finally in runOneToolCall guarantees
  // the id leaves the set on every exit path.
  if (isInflight) return "running";
  if (card.rejected) return "rejected";
  if (card.aborted) return "aborted";
  if (card.exitCode !== undefined && card.exitCode !== 0) return "error";
  return "ok";
}

function statusGlyph(s: ToolStatus): string {
  switch (s) {
    case "running":
    case "ok":
      // Claude-style filled event marker; header color carries the success/active state.
      return GLYPH.event;
    case "rejected":
      return "✗";
    case "error":
      return "✗";
    case "aborted":
      return "⊘";
  }
}

function headerColorFor(s: ToolStatus): string {
  switch (s) {
    case "ok":
      return TONE.ok;
    case "rejected":
    case "error":
    case "aborted":
      return TONE.err;
    case "running":
      return TONE_ACTIVE.brand;
  }
}

function metaTrail(card: ToolCardData): string[] {
  const parts: string[] = [];
  const inputBytes = largestStringInputBytes(card.args);
  if (inputBytes !== null) parts.push(t("cardLabels.bytesIn", { bytes: formatBytes(inputBytes) }));
  if (card.elapsedMs > 0)
    parts.push(t("cardLabels.elapsedSec", { secs: (card.elapsedMs / 1000).toFixed(2) }));
  if (
    card.done &&
    !card.rejected &&
    !card.aborted &&
    card.exitCode !== undefined &&
    card.exitCode !== 0
  ) {
    parts.push(t("cardLabels.exit", { code: card.exitCode }));
  }
  return parts;
}

function formatArgsSummary(args: unknown): string {
  if (typeof args === "string") return args.length > 60 ? `${args.slice(0, 60)}…` : args;
  if (args && typeof args === "object") {
    const keys = Object.keys(args as Record<string, unknown>);
    if (keys.length === 0) return "";
    const first = keys[0]!;
    const value = (args as Record<string, unknown>)[first];
    if (typeof value === "string") {
      const trimmed = value.length > 40 ? `${value.slice(0, 40)}…` : value;
      return keys.length === 1 ? trimmed : `${trimmed}  +${keys.length - 1}`;
    }
    return keys.join(" ");
  }
  return "";
}

function compactFailureLines(headline: string, details: readonly string[]): string[] {
  const lines = [headline.trim()].filter(Boolean);
  const seen = new Set(lines);
  for (const detail of details.slice(-4)) {
    const trimmed = detail.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    lines.push(trimmed);
  }
  return lines.length > 0 ? lines : ["failed"];
}

const INPUT_SIZE_THRESHOLD = 1024;

/** Largest string field on args, when above threshold. Surfaces input bulk for write_file (content), edit_file (replace), run_command (long stdin), etc. without per-tool special cases. */
export function largestStringInputBytes(args: unknown): number | null {
  let max = 0;
  if (typeof args === "string") {
    max = args.length;
  } else if (args && typeof args === "object") {
    for (const v of Object.values(args as Record<string, unknown>)) {
      if (typeof v === "string" && v.length > max) max = v.length;
    }
  }
  return max >= INPUT_SIZE_THRESHOLD ? max : null;
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}
