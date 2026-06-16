import { Box, Static, Text } from "ink";
import React from "react";
import { t } from "../../../i18n/index.js";
import { CardRenderer } from "../cards/CardRenderer.js";
import type { Card } from "../state/cards.js";
import { useAgentState } from "../state/provider.js";
import { FG } from "../theme/tokens.js";

/** Buffer of rows kept rendered on each side of the viewport so a single scroll
 * step doesn't reveal an unmeasured card. Larger = smoother but renders more. */
export const VISIBLE_BUFFER_ROWS = 30;
const LIVE_CARD_TAIL_LIMIT = 4;

export type CardStreamItem<T> =
  | { kind: "spacer"; rows: number; key: string }
  | { kind: "card"; card: T };
type LiveRenderItem = { kind: "fold"; count: number; key: string } | { kind: "card"; card: Card };

/** Decide which cards render live vs collapse into a spacer, given the cached
 * heights and the current viewport position. Window is quantized to
 * VISIBLE_BUFFER_ROWS buckets so small scrollRows / outerHeight wiggles don't
 * toggle a boundary card and re-trigger inner.height oscillation. */
export function computeCardStreamItems<T extends { id: string }>(
  cards: readonly T[],
  cardHeights: ReadonlyMap<string, number>,
  scrollRows: number,
  outerHeight: number,
): CardStreamItem<T>[] {
  const bucket = Math.floor(scrollRows / VISIBLE_BUFFER_ROWS) * VISIBLE_BUFFER_ROWS;
  const winStart = Math.max(0, bucket - VISIBLE_BUFFER_ROWS);
  const winEnd = bucket + outerHeight + VISIBLE_BUFFER_ROWS * 2;
  const out: CardStreamItem<T>[] = [];
  let cursor = 0;
  let pendingSpacer = 0;
  let spacerKey = 0;
  for (const card of cards) {
    const h = cardHeights.get(card.id);
    const cardEnd = cursor + (h ?? 0);
    const live = h === undefined || (cardEnd >= winStart && cursor <= winEnd);
    if (live) {
      if (pendingSpacer > 0) {
        out.push({ kind: "spacer", rows: pendingSpacer, key: `sp-${spacerKey++}` });
        pendingSpacer = 0;
      }
      out.push({ kind: "card", card });
    } else {
      pendingSpacer += h ?? 0;
    }
    cursor = cardEnd;
  }
  if (pendingSpacer > 0) {
    out.push({ kind: "spacer", rows: pendingSpacer, key: `sp-${spacerKey}` });
  }
  return out;
}

export function CardStream({
  suppressLive = false,
  maxRows,
}: {
  suppressLive?: boolean;
  /** Kept for call-site compatibility; native scrollback is handled by Static. */
  maxRows?: number;
}): React.ReactElement {
  const cards = useAgentState((s) => s.cards);
  const { committed, live } = React.useMemo(() => splitCardsForNativeScroll(cards), [cards]);
  const visibleLive =
    suppressLive && live.length > 0 && !isFullySettled(live[live.length - 1]!)
      ? live.slice(0, -1)
      : live;
  const liveItems = selectLiveRenderItems(visibleLive);

  return (
    <>
      <Static items={committed}>
        {(card) => (
          <Box key={card.id} flexDirection="column">
            <CardRenderer card={card} />
          </Box>
        )}
      </Static>
      {liveItems.length > 0 ? (
        <Box
          flexDirection="column"
          flexShrink={1}
          maxHeight={maxRows !== undefined ? Math.max(1, maxRows) : undefined}
          overflow="hidden"
        >
          {liveItems.map((item) =>
            item.kind === "fold" ? (
              <LiveFoldHint key={item.key} count={item.count} />
            ) : (
              <Box key={item.card.id} flexDirection="column">
                <CardRenderer card={item.card} compact={isFullySettled(item.card)} />
              </Box>
            ),
          )}
        </Box>
      ) : null}
    </>
  );
}

function selectLiveRenderItems(cards: ReadonlyArray<Card>): LiveRenderItem[] {
  if (cards.length <= LIVE_CARD_TAIL_LIMIT) return cards.map((card) => ({ kind: "card", card }));

  const tailStart = Math.max(0, cards.length - LIVE_CARD_TAIL_LIMIT);
  const lastUserIndex = findLastIndex(cards, (card) => card.kind === "user");

  if (lastUserIndex >= 0 && lastUserIndex < tailStart) {
    const items: LiveRenderItem[] = [];
    if (lastUserIndex > 0)
      items.push({ kind: "fold", count: lastUserIndex, key: "fold-before-user" });
    items.push({ kind: "card", card: cards[lastUserIndex]! });
    const hiddenBetween = tailStart - lastUserIndex - 1;
    if (hiddenBetween > 0)
      items.push({ kind: "fold", count: hiddenBetween, key: "fold-after-user" });
    for (const card of cards.slice(tailStart)) items.push({ kind: "card", card });
    return items;
  }

  return [
    { kind: "fold", count: tailStart, key: "fold-live-head" },
    ...cards.slice(tailStart).map((card) => ({ kind: "card" as const, card })),
  ];
}

function findLastIndex<T>(items: ReadonlyArray<T>, predicate: (item: T) => boolean): number {
  for (let i = items.length - 1; i >= 0; i--) {
    if (predicate(items[i]!)) return i;
  }
  return -1;
}

function LiveFoldHint({ count }: { count: number }): React.ReactElement {
  return (
    <Box paddingLeft={2}>
      <Text color={FG.faint}>{t("cardLabels.more", { count })}</Text>
    </Box>
  );
}

function splitCardsForNativeScroll(cards: ReadonlyArray<Card>): {
  committed: Card[];
  live: Card[];
} {
  const firstLive = cards.findIndex((card) => !isFullySettled(card));
  if (firstLive < 0) return { committed: [...cards], live: [] };
  return {
    committed: cards.slice(0, firstLive),
    live: cards.slice(firstLive),
  };
}

function isFullySettled(card: Card): boolean {
  switch (card.kind) {
    case "streaming":
    case "tool":
      return card.done || !!card.aborted;
    case "reasoning":
      return !card.streaming || !!card.aborted;
    case "task":
    case "subagent":
      return card.status !== "running";
    case "plan":
      return card.steps.every((s) => s.status === "done" || s.status === "skipped");
    default:
      return true;
  }
}
