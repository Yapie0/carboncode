import { Box, Text, useStdout } from "ink";
import React, { useEffect, useRef, useState } from "react";
import { t } from "../../i18n/index.js";
import { useKeystroke } from "./keystroke-context.js";
import { useReserveRows } from "./layout/viewport-budget.js";
import { type MultilineKey, lineAndColumn, processMultilineKey } from "./multiline-keys.js";
import {
  PASTE_SENTINEL_RANGE,
  type PasteEntry,
  decodePasteSentinel,
  encodePasteSentinel,
  expandPasteSentinels,
  formatBytesShort,
  listPasteIdsInBuffer,
  makePasteEntry,
} from "./paste-sentinels.js";
import { type Segment, buildViewport, stringCells, wrapToCells } from "./prompt-viewport.js";
import { FG, SURFACE, TONE } from "./theme/tokens.js";
import {
  INITIAL_VIM_STATE,
  type VimMode,
  type VimState,
  normalCursorOnExit,
  vimNormal,
} from "./vim-keys.js";

/** Raw-stdin keystroke bus → multiline reducer; one logical line per Box row, viewport-clipped. */

/** Pastes shorter than this AND single-line render verbatim; longer ones become a `[paste #N · …]` sentinel chip (#397). */
export const INLINE_PASTE_THRESHOLD = 200;

// Tight enough that a normal typed Enter (≥80ms after the last keystroke
// for human cadence) still submits; wide enough that CJK IME commit-then-
// Enter (terminal flushes both together) falls inside the window.
const IME_GUARD_MS = 50;

function hasNonAscii(s: string): boolean {
  for (let i = 0; i < s.length; i++) {
    if (s.charCodeAt(i) > 0x7f) return true;
  }
  return false;
}

export function shouldInlinePaste(content: string): boolean {
  return !content.includes("\n") && content.length <= INLINE_PASTE_THRESHOLD;
}

export interface PromptInputProps {
  value: string;
  onChange: (v: string) => void;
  onSubmit: (v: string) => void;
  disabled?: boolean;
  placeholder?: string;
  /** ↑/↓ and Ctrl+P / Ctrl+N hand off here when no in-buffer cursor move applies — parent walks history and swaps `value` via `onChange`. */
  onHistoryPrev?: () => void;
  onHistoryNext?: () => void;
  /** Ctrl+X — parent spawns $EDITOR with the current buffer and re-injects on exit. */
  onOpenExternalEditor?: () => void;
  onCursorChange?: (cursor: number) => void;
  /** When true, the composer runs the vim NORMAL/INSERT layer (toggled by /vim). */
  vimEnabled?: boolean;
}

export function PromptInput({
  value,
  onChange,
  onSubmit,
  disabled,
  placeholder,
  onHistoryPrev,
  onHistoryNext,
  onOpenExternalEditor,
  onCursorChange,
  vimEnabled = false,
}: PromptInputProps) {
  const { stdout } = useStdout();
  const cols = stdout?.columns ?? 80;
  const promptPrefix = "> ";
  const continuationIndent = "  ";
  const prefixCells = promptPrefix.length;
  // Reserve for prompt prefix, cursor margin, and the rounded border (2 cells) + padding.
  const visibleCells = Math.max(8, cols - prefixCells - 5);
  // Cap at 24 — collapseLinesForDisplay hides content past ~20 logical lines.
  // Long lines SOFT-WRAP to multiple display rows now, so size the reserve by the
  // wrapped-row count (not logical lines). Quantize to 4-row buckets so per-keystroke
  // changes don't churn the viewport-budget allocator.
  const displayRowCount = (value.length > 0 ? value.split("\n") : [""]).reduce(
    (n, ln) => n + Math.max(1, Math.ceil(stringCells(ln) / visibleCells)),
    0,
  );
  const reserveMax = Math.min(Math.ceil(displayRowCount / 4) * 4 + 3, 24);
  useReserveRows("input", { min: 1, max: reserveMax });

  const [cursor, setCursor] = useState(value.length);

  useEffect(() => {
    onCursorChange?.(cursor);
  }, [cursor, onCursorChange]);

  // ── vim layer ──────────────────────────────────────────────────────
  // `vimMode` drives the badge + accent; refs carry the live value across the
  // several keystrokes that can fire in one stdin chunk before re-render.
  const [vimMode, setVimMode] = useState<VimMode>(vimEnabled ? "normal" : "insert");
  const vimModeRef = useRef<VimMode>(vimMode);
  vimModeRef.current = vimMode;
  const vimStateRef = useRef<VimState>(INITIAL_VIM_STATE);
  const undoRef = useRef<Array<{ value: string; cursor: number }>>([]);

  // Live /vim toggle: entering vim drops to NORMAL, leaving forces INSERT.
  // Reset pending + undo so a toggle never replays edits from the other mode.
  useEffect(() => {
    const target: VimMode = vimEnabled ? "normal" : "insert";
    vimModeRef.current = target;
    setVimMode(target);
    vimStateRef.current = INITIAL_VIM_STATE;
    undoRef.current = [];
  }, [vimEnabled]);

  // Paste registry — keyed by sentinel id, holds original content.
  const pastesRef = useRef<Map<number, PasteEntry>>(new Map());
  const nextPasteIdRef = useRef<number>(0);

  // CJK IMEs commit the candidate then often pass the trigger Enter through
  // as a real keystroke; terminals can't expose composition state. If submit
  // fires within IME_GUARD_MS of non-ASCII input we treat it as that commit-Enter.
  const lastNonAsciiInputAtRef = useRef(0);

  // Refs (not props/state) — multiple keystrokes in one stdin chunk dispatch
  // before re-render, so the handler must read the latest value/cursor.
  const lastLocalValueRef = useRef(value);
  const cursorRef = useRef(cursor);
  cursorRef.current = cursor;
  if (value !== lastLocalValueRef.current) {
    lastLocalValueRef.current = value;
    if (cursor !== value.length) {
      cursorRef.current = value.length;
      setCursor(value.length);
    }
  }

  const registerPaste = (content: string) => {
    const v = lastLocalValueRef.current;
    const c = cursorRef.current;
    const insertion = shouldInlinePaste(content)
      ? content
      : (() => {
          const id = nextPasteIdRef.current % PASTE_SENTINEL_RANGE;
          nextPasteIdRef.current = id + 1;
          pastesRef.current.set(id, makePasteEntry(id, content));
          return encodePasteSentinel(id);
        })();
    const next = v.slice(0, c) + insertion + v.slice(c);
    lastLocalValueRef.current = next;
    cursorRef.current = c + insertion.length;
    onChange(next);
    setCursor(c + insertion.length);
  };

  useKeystroke((ev) => {
    if (disabled) return;
    if (ev.paste) {
      // Bracketed-paste content delivered by the stdin reader.
      if (ev.input.length > 0) registerPaste(ev.input);
      return;
    }
    if (ev.input.length > 0 && hasNonAscii(ev.input)) {
      lastNonAsciiInputAtRef.current = Date.now();
    }
    const key: MultilineKey = {
      input: ev.input,
      return: ev.return,
      shift: ev.shift,
      ctrl: ev.ctrl,
      meta: ev.meta,
      backspace: ev.backspace,
      delete: ev.delete,
      tab: ev.tab,
      upArrow: ev.upArrow,
      downArrow: ev.downArrow,
      leftArrow: ev.leftArrow,
      rightArrow: ev.rightArrow,
      escape: ev.escape,
      pageUp: ev.pageUp,
      pageDown: ev.pageDown,
      home: ev.home,
      end: ev.end,
    };

    // ── vim layer ────────────────────────────────────────────────────
    if (vimEnabled) {
      // Esc: leave INSERT for NORMAL (vim nudges the cursor back one). In NORMAL,
      // let Esc fall through so the App can close suggestions / pickers.
      if (ev.escape) {
        if (vimModeRef.current === "insert") {
          const back = normalCursorOnExit(lastLocalValueRef.current, cursorRef.current);
          cursorRef.current = back;
          setCursor(back);
          vimModeRef.current = "normal";
          setVimMode("normal");
          vimStateRef.current = INITIAL_VIM_STATE;
        }
        return;
      }
      // NORMAL mode owns plain keys (motions/operators); control chords, Enter,
      // Tab, and PgUp/PgDn fall through to the standard reducer so /history,
      // submit, $EDITOR, clear-buffer, and interrupt keep working.
      const passesThrough =
        key.ctrl || key.meta || key.return || key.tab || key.pageUp || key.pageDown;
      if (vimModeRef.current === "normal" && !passesThrough) {
        const r = vimNormal(lastLocalValueRef.current, cursorRef.current, key, vimStateRef.current);
        vimStateRef.current = r.state;
        if (r.undo) {
          const prev = undoRef.current.pop();
          if (prev) {
            lastLocalValueRef.current = prev.value;
            cursorRef.current = prev.cursor;
            onChange(prev.value);
            setCursor(prev.cursor);
          }
          return;
        }
        // One undo checkpoint per command that mutates the buffer or starts an
        // insert session — so `u` reverts a whole insert as one step.
        if (r.next !== null || r.mode === "insert") {
          undoRef.current.push({ value: lastLocalValueRef.current, cursor: cursorRef.current });
          if (undoRef.current.length > 100) undoRef.current.shift();
        }
        if (r.next !== null) {
          lastLocalValueRef.current = r.next;
          onChange(r.next);
        }
        if (r.cursor !== null) {
          cursorRef.current = r.cursor;
          setCursor(r.cursor);
        }
        if (r.mode && r.mode !== vimModeRef.current) {
          vimModeRef.current = r.mode;
          setVimMode(r.mode);
        }
        return;
      }
      // INSERT mode, and NORMAL-mode pass-through keys, fall through below.
    }

    const action = processMultilineKey(lastLocalValueRef.current, cursorRef.current, key);
    if (action.pasteRequest) {
      registerPaste(action.pasteRequest.content);
      return;
    }
    if (action.next !== null) {
      lastLocalValueRef.current = action.next;
      onChange(action.next);
    }
    if (action.cursor !== null) {
      cursorRef.current = action.cursor;
      setCursor(action.cursor);
    }
    if (action.submit) {
      if (Date.now() - lastNonAsciiInputAtRef.current < IME_GUARD_MS) {
        lastNonAsciiInputAtRef.current = 0;
        return;
      }
      const raw = action.submitValue ?? lastLocalValueRef.current;
      const expanded = expandPasteSentinels(raw, pastesRef.current);
      const reachable = new Set(listPasteIdsInBuffer(raw));
      for (const id of pastesRef.current.keys()) {
        if (!reachable.has(id)) pastesRef.current.delete(id);
      }
      onSubmit(expanded);
    }
    if (action.historyHandoff === "prev") onHistoryPrev?.();
    if (action.historyHandoff === "next") onHistoryNext?.();
    if (action.openExternalEditor) onOpenExternalEditor?.();
  }, !disabled);

  // ── Render ──────────────────────────────────────────────────────

  // Hint avoids literal `/` and `@` glyphs — they render in the same row as
  // a just-cleared buffer and read as residual typed input on dim-poor terminals.
  const effectivePlaceholder = disabled
    ? (placeholder ?? t("composer.waitingForResponse"))
    : (placeholder ?? t("composer.placeholder"));

  const lines = value.length > 0 ? value.split("\n") : [""];
  // `!cmd` runs a raw shell command (bang.ts). Mirror Claude's bash mode by
  // recoloring the box + prompt to a distinct amber while the buffer leads with `!`.
  const bashMode = !disabled && value.startsWith("!");
  const accentColor = disabled ? FG.faint : bashMode ? TONE.warn : TONE.brand;
  const cursorVisible = true;
  const { line: cursorLine, col: cursorCol } = lineAndColumn(value, cursor);

  const renderItems = collapseLinesForDisplay(lines, cursorLine);
  const showHugeBufferHints = lines.length > 20;

  return (
    <Box
      flexDirection="column"
      paddingX={1}
      borderStyle="round"
      borderColor={accentColor}
      backgroundColor={SURFACE.bgInput}
    >
      {(() => {
        const rows: React.ReactNode[] = [];
        let firstRowEmitted = false;
        for (let renderIdx = 0; renderIdx < renderItems.length; renderIdx++) {
          const item = renderItems[renderIdx]!;
          if (item.kind === "skip") {
            rows.push(
              <Box key={`skip-${renderIdx}`}>
                <Text color={FG.faint}>{continuationIndent}</Text>
                <Text color={FG.faint}>
                  {`[… ${item.linesHidden} line${item.linesHidden === 1 ? "" : "s"} hidden — full content kept, submitted on Enter …]`}
                </Text>
              </Box>,
            );
            continue;
          }
          const i = item.originalIndex;
          const line = item.line;
          const isCursorLine = i === cursorLine;
          const showPlaceholder = i === 0 && value.length === 0;
          if (showPlaceholder) {
            rows.push(
              <PromptLine
                key={`ln-${i}-text-0`}
                line=""
                isFirst={true}
                isCursorLine={isCursorLine && !disabled}
                cursorCol={isCursorLine ? cursorCol : null}
                cursorVisible={cursorVisible}
                showPlaceholder
                placeholderText={effectivePlaceholder}
                promptPrefix={promptPrefix}
                continuationIndent={continuationIndent}
                visibleCells={visibleCells}
                accentColor={accentColor}
                pastes={pastesRef.current}
                disabled={disabled === true}
              />,
            );
            firstRowEmitted = true;
            continue;
          }
          const segs = splitLineByPastes(line);
          for (let segIdx = 0; segIdx < segs.length; segIdx++) {
            const seg = segs[segIdx]!;
            if (seg.kind === "paste") {
              const isFirst = !firstRowEmitted;
              firstRowEmitted = true;
              const cursorOnIt =
                isCursorLine && cursorCol >= seg.startOffset && cursorCol <= seg.startOffset + 1;
              rows.push(
                <PasteChipRow
                  key={`ln-${i}-paste-${segIdx}`}
                  entry={pastesRef.current.get(seg.id)}
                  pasteId={seg.id}
                  isFirst={isFirst}
                  active={cursorOnIt && !disabled}
                  visibleCells={visibleCells}
                  accentColor={accentColor}
                />,
              );
              continue;
            }
            // Soft-wrap this text run into display rows so a long line grows DOWNWARD
            // (the cursor follows onto the wrapped row) instead of scrolling off-screen
            // to the right. Wrapping is cell-aware (CJK-safe), so each chunk fits and
            // PromptLine renders it in full (no `‹›` clip markers).
            const relCursor = isCursorLine ? cursorCol - seg.startOffset : -1;
            const chunks = wrapToCells(seg.text, visibleCells);
            for (let ci = 0; ci < chunks.length; ci++) {
              const chunk = chunks[ci]!;
              const isFirst = !firstRowEmitted;
              firstRowEmitted = true;
              const isLastChunk = ci === chunks.length - 1;
              const chunkEnd = chunk.start + chunk.text.length;
              const cursorInChunk =
                relCursor >= chunk.start &&
                (isLastChunk ? relCursor <= chunkEnd : relCursor < chunkEnd);
              rows.push(
                <PromptLine
                  key={`ln-${i}-text-${segIdx}-${ci}`}
                  line={chunk.text}
                  isFirst={isFirst}
                  isCursorLine={cursorInChunk && !disabled}
                  cursorCol={cursorInChunk ? relCursor - chunk.start : null}
                  cursorVisible={cursorVisible}
                  showPlaceholder={false}
                  placeholderText=""
                  promptPrefix={promptPrefix}
                  continuationIndent={continuationIndent}
                  visibleCells={visibleCells}
                  accentColor={accentColor}
                  pastes={pastesRef.current}
                  disabled={disabled === true}
                />,
              );
            }
          }
          if (segs.length === 0) {
            const isFirst = !firstRowEmitted;
            firstRowEmitted = true;
            rows.push(
              <PromptLine
                key={`ln-${i}-empty`}
                line=""
                isFirst={isFirst}
                isCursorLine={isCursorLine && !disabled}
                cursorCol={isCursorLine ? 0 : null}
                cursorVisible={cursorVisible}
                showPlaceholder={false}
                placeholderText=""
                promptPrefix={promptPrefix}
                continuationIndent={continuationIndent}
                visibleCells={visibleCells}
                accentColor={accentColor}
                pastes={pastesRef.current}
                disabled={disabled === true}
              />,
            );
          }
        }
        return rows;
      })()}
      {showHugeBufferHints && !disabled ? (
        <Box>
          <Text color={FG.faint}>
            {`  [${lines.length} lines · PgUp/PgDn jump · Ctrl+U clear · Ctrl+W del word]`}
          </Text>
        </Box>
      ) : null}
      {disabled ? (
        <Box marginTop={1}>
          <Text color={FG.faint}>{"  esc to stop"}</Text>
        </Box>
      ) : null}
      {vimEnabled && !disabled ? (
        <Box>
          <Text color={vimMode === "normal" ? TONE.brand : FG.faint} bold={vimMode === "normal"}>
            {vimMode === "normal"
              ? "  -- NORMAL --  esc·hjkl·dd·i"
              : "  -- INSERT --  esc → normal"}
          </Text>
        </Box>
      ) : null}
    </Box>
  );
}

export function HintRow(): React.ReactElement {
  const items: Array<{ key: string; tKey: string }> = [
    { key: "\u23ce", tKey: "composer.hintSend" },
    { key: "\u21e7\u23ce", tKey: "composer.hintNewline" },
    { key: "^U", tKey: "composer.hintClear" },
    { key: "↑/↓", tKey: "composer.hintHistory" },
    { key: "esc", tKey: "composer.hintAbort" },
    { key: "^C", tKey: "composer.hintQuit" },
  ];
  return (
    <Box flexDirection="row">
      <Text>{"  "}</Text>
      {items.map((item, i) => (
        <React.Fragment key={item.key}>
          {i > 0 && <Text color={FG.faint}>{"  \u00b7  "}</Text>}
          <Text color={FG.meta}>{item.key}</Text>
          <Text color={FG.faint}>{` ${t(item.tKey)}`}</Text>
        </React.Fragment>
      ))}
    </Box>
  );
}

type LineSegment =
  | { kind: "text"; text: string; startOffset: number }
  | { kind: "paste"; id: number; startOffset: number };

function splitLineByPastes(line: string): LineSegment[] {
  const out: LineSegment[] = [];
  let textBuf = "";
  let textStart = 0;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    const id = decodePasteSentinel(ch);
    if (id === null) {
      if (textBuf === "") textStart = i;
      textBuf += ch;
      continue;
    }
    if (textBuf !== "") {
      out.push({ kind: "text", text: textBuf, startOffset: textStart });
      textBuf = "";
    }
    out.push({ kind: "paste", id, startOffset: i });
  }
  if (textBuf !== "") out.push({ kind: "text", text: textBuf, startOffset: textStart });
  return out;
}

interface PasteChipRowProps {
  entry: PasteEntry | undefined;
  pasteId: number;
  isFirst: boolean;
  active: boolean;
  visibleCells: number;
  accentColor: string;
}

function PasteChipRow({
  entry,
  pasteId,
  isFirst,
  active,
  visibleCells,
  accentColor,
}: PasteChipRowProps): React.ReactElement {
  const promptPrefix = "> ";
  const continuationIndent = "  ";
  const lead = isFirst ? promptPrefix : continuationIndent;
  const leadColor = isFirst ? accentColor : FG.faint;
  const labelText = formatChipLabel(entry, pasteId, visibleCells - 6);
  if (active) {
    return (
      <Box>
        <Text bold color={leadColor}>
          {lead}
        </Text>
        <Text bold color={accentColor}>
          {"▸ "}
        </Text>
        <Text bold color="black" backgroundColor={accentColor}>
          {`  ${labelText}  `}
        </Text>
      </Box>
    );
  }
  return (
    <Box>
      <Text bold color={leadColor}>
        {lead}
      </Text>
      <Text color={FG.faint}>{"  "}</Text>
      <Text color={FG.meta}>{"┌ "}</Text>
      <Text color={FG.body} backgroundColor={SURFACE.bgElev}>
        {`${labelText} `}
      </Text>
      <Text color={FG.meta}>{" ┐"}</Text>
    </Box>
  );
}

function formatChipLabel(entry: PasteEntry | undefined, pasteId: number, budget: number): string {
  if (!entry) return `📋 paste #${pasteId + 1} · (missing)`;
  const lines = `${entry.lineCount} line${entry.lineCount === 1 ? "" : "s"}`;
  const bytes = formatBytesShort(entry.charCount);
  const kind = sniffChipKind(entry.content);
  const full = `📋 pasted  ${lines} · ${bytes}  ·  ${kind}  ^O expand · ⌫ remove`;
  if (full.length <= Math.max(40, budget)) return full;
  const compact = `📋 pasted  ${lines} · ${bytes}  ·  ${kind}`;
  if (compact.length <= Math.max(30, budget)) return compact;
  return `📋 pasted  ${lines} · ${bytes}`;
}

function sniffChipKind(content: string): string {
  const head = content.slice(0, 1024);
  if (/^\s*[{[]/.test(head)) {
    try {
      JSON.parse(head);
      return "json";
    } catch {
      /* not parseable; fall through */
    }
  }
  if (/\n\s+at\s+\S+\s*\(/.test(head)) return "stacktrace";
  if (/^(diff --git|@@ )/m.test(head)) return "diff";
  if (/^\s*<!doctype|^\s*<html/i.test(head)) return "html";
  if (/^\s*\$\s+\w/.test(head) || /\n\s*\$\s+\w/.test(head)) return "shell";
  return "text";
}

// ── PromptLine ────────────────────────────────────────────────────

interface PromptLineProps {
  line: string;
  isFirst: boolean;
  isCursorLine: boolean;
  cursorCol: number | null;
  cursorVisible: boolean;
  showPlaceholder: boolean;
  placeholderText: string;
  promptPrefix: string;
  continuationIndent: string;
  visibleCells: number;
  accentColor: string;
  pastes: ReadonlyMap<number, PasteEntry>;
  disabled: boolean;
}

const PromptLine = React.forwardRef<unknown, PromptLineProps>(function PromptLine(
  {
    line,
    isFirst,
    isCursorLine,
    cursorCol,
    cursorVisible,
    showPlaceholder,
    placeholderText,
    promptPrefix,
    continuationIndent,
    visibleCells,
    accentColor,
    pastes,
    disabled,
  },
  ref,
) {
  if (showPlaceholder) {
    return (
      <Box ref={ref as any}>
        <Text bold color={accentColor}>
          {promptPrefix}
        </Text>
        {!disabled ? <Text color={accentColor}>{cursorVisible ? "▌" : " "}</Text> : null}
        <Text color={FG.faint}>{placeholderText}</Text>
      </Box>
    );
  }

  const viewport = buildViewport(line, isCursorLine ? cursorCol : null, visibleCells, pastes);

  return (
    <Box ref={ref as any}>
      {isFirst ? (
        <Text bold color={accentColor}>
          {promptPrefix}
        </Text>
      ) : (
        <Text color={FG.faint}>{continuationIndent}</Text>
      )}
      {viewport.hiddenLeft ? <Text color={FG.faint}>{"‹"}</Text> : null}
      <ViewportContent
        segments={viewport.segments}
        cursorCell={isCursorLine ? viewport.cursorCell : null}
        accentColor={accentColor}
        cursorVisible={cursorVisible}
      />
      {viewport.hiddenRight ? <Text color={FG.faint}>{"›"}</Text> : null}
    </Box>
  );
});

// ── ViewportContent ────────────────────────────────────────────────

/** Cursor splits at most one segment; trailing block when past the last cell. */
function ViewportContent({
  segments,
  cursorCell,
  accentColor,
  cursorVisible,
}: {
  segments: Segment[];
  cursorCell: number | null;
  accentColor: string;
  cursorVisible: boolean;
}) {
  // No cursor on this line — straight render.
  if (cursorCell === null) {
    return <>{segments.map((seg, i) => renderSegment(seg, i, false))}</>;
  }

  const out: React.ReactNode[] = [];
  let cells = 0;
  let placed = false;
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i]!;
    const segCells = segmentCells(seg);
    if (placed) {
      out.push(renderSegment(seg, i, false));
      continue;
    }
    if (cursorCell >= cells + segCells) {
      out.push(renderSegment(seg, i, false));
      cells += segCells;
      continue;
    }
    if (seg.kind === "paste") {
      out.push(
        <Text
          key={`p-${i}-cursor`}
          color={FG.body}
          backgroundColor={SURFACE.bgElev}
          inverse={cursorVisible}
        >
          {seg.label}
        </Text>,
      );
      placed = true;
      cells += segCells;
      continue;
    }
    const offsetIntoSeg = cursorCell - cells;
    const split = splitTextByCells(seg.text, offsetIntoSeg);
    if (split.before.length > 0) {
      out.push(<Text key={`t-${i}-b`}>{split.before}</Text>);
    }
    if (split.atCursor.length > 0) {
      out.push(
        <Text key={`t-${i}-c`} inverse={cursorVisible} color={accentColor}>
          {split.atCursor}
        </Text>,
      );
    } else {
      out.push(
        <Text key={`t-${i}-c-eol`} color={accentColor}>
          {cursorVisible ? "▌" : " "}
        </Text>,
      );
    }
    if (split.after.length > 0) {
      out.push(<Text key={`t-${i}-a`}>{split.after}</Text>);
    }
    placed = true;
    cells += segCells;
  }

  if (!placed) {
    out.push(
      <Text key="cursor-eol" color={accentColor}>
        {cursorVisible ? "▌" : " "}
      </Text>,
    );
  }

  return <>{out}</>;
}

function segmentCells(seg: Segment): number {
  if (seg.kind === "paste") return seg.label.length;
  return stringCells(seg.text);
}

/** Wide char straddling the offset is treated as the cursor's char. */
function splitTextByCells(
  text: string,
  cellOffset: number,
): { before: string; atCursor: string; after: string } {
  let cells = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    const cw = charCellsForText(ch);
    if (cells === cellOffset) {
      return { before: text.slice(0, i), atCursor: ch, after: text.slice(i + 1) };
    }
    if (cells + cw > cellOffset) {
      return { before: text.slice(0, i), atCursor: ch, after: text.slice(i + 1) };
    }
    cells += cw;
  }
  return { before: text, atCursor: "", after: "" };
}

/** Inlined cell counter — hot per-keystroke; keep in sync with prompt-viewport. */
function charCellsForText(ch: string): number {
  const code = ch.charCodeAt(0);
  if (code < 0x20 || code === 0x7f) return 0;
  if (code < 0x1100) return 1;
  if (code >= 0x1100 && code <= 0x115f) return 2;
  if (code >= 0x2e80 && code <= 0x303e) return 2;
  if (code >= 0x3041 && code <= 0x33ff) return 2;
  if (code >= 0x3400 && code <= 0x4dbf) return 2;
  if (code >= 0x4e00 && code <= 0x9fff) return 2;
  if (code >= 0xa000 && code <= 0xa4cf) return 2;
  if (code >= 0xac00 && code <= 0xd7a3) return 2;
  if (code >= 0xf900 && code <= 0xfaff) return 2;
  if (code >= 0xfe30 && code <= 0xfe4f) return 2;
  if (code >= 0xff00 && code <= 0xff60) return 2;
  if (code >= 0xffe0 && code <= 0xffe6) return 2;
  return 1;
}

function renderSegment(seg: Segment, key: number, _inverse: boolean): React.ReactNode {
  if (seg.kind === "text") {
    return <Text key={`s-${key}`}>{seg.text}</Text>;
  }
  return (
    <Text key={`s-${key}`} backgroundColor={SURFACE.bgElev} color={FG.body}>
      {seg.label}
    </Text>
  );
}

// ── collapse helper (preserved from v1) ────────────────────────────

type RenderItem =
  | { kind: "line"; line: string; originalIndex: number }
  | { kind: "skip"; linesHidden: number };

const COLLAPSE_THRESHOLD = 20;
const COLLAPSE_HEAD_LINES = 3;
const COLLAPSE_TAIL_LINES = 2;

export function collapseLinesForDisplay(lines: string[], cursorLine: number): RenderItem[] {
  if (lines.length <= COLLAPSE_THRESHOLD) {
    return lines.map((line, i) => ({ kind: "line" as const, line, originalIndex: i }));
  }
  const keep = new Set<number>();
  for (let i = 0; i < COLLAPSE_HEAD_LINES && i < lines.length; i++) keep.add(i);
  for (let i = Math.max(0, lines.length - COLLAPSE_TAIL_LINES); i < lines.length; i++) keep.add(i);
  if (cursorLine >= 0 && cursorLine < lines.length) keep.add(cursorLine);
  const sorted = [...keep].sort((a, b) => a - b);
  const out: RenderItem[] = [];
  let prev = -1;
  for (const idx of sorted) {
    if (idx - prev > 1) {
      out.push({ kind: "skip", linesHidden: idx - prev - 1 });
    }
    out.push({ kind: "line", line: lines[idx] ?? "", originalIndex: idx });
    prev = idx;
  }
  return out;
}
