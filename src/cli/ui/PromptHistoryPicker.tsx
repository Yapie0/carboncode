import { Box, Text, useStdout } from "ink";
// biome-ignore lint/style/useImportType: tsconfig.jsx = "react" needs React in value scope for JSX compilation
import React from "react";
import { useEffect, useMemo, useState } from "react";
import { t } from "../../i18n/index.js";
import { useKeystroke } from "./keystroke-context.js";
import { useReserveRows } from "./layout/viewport-budget.js";
import { FG, TONE } from "./theme/tokens.js";

export interface PromptHistoryPickerProps {
  history: readonly string[];
  initialQuery?: string;
  onChoose: (value: string) => void;
  onCancel: () => void;
}

export function filterPromptHistory(history: readonly string[], query: string): string[] {
  const needle = query.trim().toLowerCase();
  const seen = new Set<string>();
  const newestFirst: string[] = [];

  for (let i = history.length - 1; i >= 0; i--) {
    const value = history[i]?.trim();
    if (!value || seen.has(value)) continue;
    seen.add(value);
    if (!needle || value.toLowerCase().includes(needle)) newestFirst.push(value);
  }

  return newestFirst;
}

export function PromptHistoryPicker({
  history,
  initialQuery = "",
  onChoose,
  onCancel,
}: PromptHistoryPickerProps): React.ReactElement {
  const [query, setQuery] = useState(initialQuery);
  const [focus, setFocus] = useState(0);
  const matches = useMemo(() => filterPromptHistory(history, query), [history, query]);
  const { stdout } = useStdout();
  const visibleCount = Math.max(3, Math.min(8, (stdout?.rows ?? 30) - 8));
  const promptWidth = Math.max(20, (stdout?.columns ?? 100) - 8);
  useReserveRows("input", { min: 4, max: visibleCount + 4 });

  useEffect(() => {
    setFocus((current) => Math.max(0, Math.min(current, matches.length - 1)));
  }, [matches.length]);

  useKeystroke((ev) => {
    if (ev.paste) {
      setQuery((current) => current + oneLine(ev.input));
      setFocus(0);
      return;
    }
    if (ev.escape) return onCancel();
    if (ev.return) {
      const selected = matches[focus];
      if (selected) onChoose(selected);
      return;
    }
    if (ev.upArrow) {
      setFocus((current) => Math.max(0, current - 1));
      return;
    }
    if (ev.downArrow || (ev.ctrl && ev.input.toLowerCase() === "r")) {
      setFocus((current) => (matches.length > 0 ? (current + 1) % matches.length : 0));
      return;
    }
    if (ev.backspace) {
      setQuery((current) => current.slice(0, -1));
      setFocus(0);
      return;
    }
    if (ev.input && !ev.ctrl && !ev.meta && !ev.tab) {
      setQuery((current) => current + ev.input);
      setFocus(0);
    }
  });

  const start = Math.max(
    0,
    Math.min(focus - Math.floor(visibleCount / 2), matches.length - visibleCount),
  );
  const shown = matches.slice(start, start + visibleCount);

  return (
    <Box flexDirection="column" borderStyle="round" borderColor={TONE.brand} paddingX={1}>
      <Box>
        <Text bold color={TONE.brand}>
          {t("composer.historySearchTitle")}
        </Text>
        <Text color={FG.meta}>
          {t("composer.historySearchCount", { shown: matches.length, total: history.length })}
        </Text>
      </Box>
      <Box>
        <Text color={FG.faint}>{t("composer.historySearchPrompt")}</Text>
        <Text color={FG.strong}>{query}</Text>
        <Text backgroundColor={TONE.brand} color="black">
          {" "}
        </Text>
      </Box>
      {history.length === 0 ? (
        <Text color={FG.faint}>{t("composer.historySearchEmpty")}</Text>
      ) : matches.length === 0 ? (
        <Text color={FG.faint}>{t("composer.historySearchNoMatch")}</Text>
      ) : (
        shown.map((value, index) => {
          const selected = start + index === focus;
          return (
            <Box key={`${start + index}:${value}`}>
              <Text color={selected ? TONE.brand : FG.faint}>{selected ? "> " : "  "}</Text>
              <Text bold={selected} color={selected ? FG.strong : FG.sub}>
                {truncate(oneLine(value), promptWidth)}
              </Text>
            </Box>
          );
        })
      )}
      <Text color={FG.faint}>{t("composer.historySearchHint")}</Text>
    </Box>
  );
}

function oneLine(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max - 3)}...`;
}
