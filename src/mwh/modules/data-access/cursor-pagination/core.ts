export type CursorDirection = "forward" | "backward";
export type CursorSortDirection = "asc" | "desc";
export type CursorValue = string | number;

export interface CursorPosition {
  sortValue: CursorValue;
  id: string;
}

export interface CursorPageRequest {
  limit: number;
  after?: string;
  before?: string;
  direction?: CursorDirection;
}

export interface CursorPaginationPolicy {
  sortDirection: CursorSortDirection;
  maxLimit: number;
}

export interface CursorPageInfo {
  startCursor?: string;
  endCursor?: string;
  hasNextPage: boolean;
  hasPreviousPage: boolean;
}

export interface CursorPage<TItem> {
  items: readonly TItem[];
  pageInfo: CursorPageInfo;
}

export interface CursorProjection<TItem> {
  getId: (item: TItem) => string;
  getSortValue: (item: TItem) => CursorValue;
}

export function encodeCursor(position: CursorPosition): string {
  assertCursorPosition(position);
  return Buffer.from(JSON.stringify(position), "utf8").toString("base64url");
}

export function decodeCursor(cursor: string): CursorPosition {
  assertNonEmpty(cursor, "cursor");
  try {
    const parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as CursorPosition;
    assertCursorPosition(parsed);
    return parsed;
  } catch (error) {
    throw new Error("invalid cursor");
  }
}

export function paginateByCursor<TItem>(input: {
  items: readonly TItem[];
  request: CursorPageRequest;
  policy: CursorPaginationPolicy;
  projection: CursorProjection<TItem>;
}): CursorPage<TItem> {
  assertPolicy(input.policy);
  assertPositiveInteger(input.request.limit, "limit");
  const limit = Math.min(input.request.limit, input.policy.maxLimit);
  if (input.request.after && input.request.before) {
    throw new Error("after and before cannot be used together");
  }

  const sorted = sortItems(input.items, input.projection, input.policy.sortDirection);
  const direction = input.request.direction ?? (input.request.before ? "backward" : "forward");
  const boundary = input.request.after
    ? decodeCursor(input.request.after)
    : input.request.before
      ? decodeCursor(input.request.before)
      : undefined;
  const filtered = boundary
    ? sorted.filter((item) =>
        isPastBoundary(
          itemToPosition(item, input.projection),
          boundary,
          input.policy.sortDirection,
          direction,
        ),
      )
    : sorted;
  const window = direction === "backward" ? [...filtered].reverse() : filtered;
  const selected = window.slice(0, limit);
  const pageItems = direction === "backward" ? [...selected].reverse() : selected;
  const pagePositions = pageItems.map((item) => itemToPosition(item, input.projection));
  const firstPosition = pagePositions[0];
  const lastPosition = pagePositions[pagePositions.length - 1];

  return {
    items: pageItems.map(cloneJson) as TItem[],
    pageInfo: {
      startCursor: firstPosition ? encodeCursor(firstPosition) : undefined,
      endCursor: lastPosition ? encodeCursor(lastPosition) : undefined,
      hasNextPage: hasNextPage({
        sorted,
        policy: input.policy,
        projection: input.projection,
        lastPosition,
      }),
      hasPreviousPage: hasPreviousPage({
        sorted,
        policy: input.policy,
        projection: input.projection,
        firstPosition,
      }),
    },
  };
}

export function buildCursorSqlPredicate(input: {
  cursor: string;
  sortColumn: string;
  idColumn: string;
  sortDirection: CursorSortDirection;
  pageDirection?: CursorDirection;
}): {
  where: string;
  params: readonly CursorValue[];
} {
  assertNonEmpty(input.sortColumn, "sortColumn");
  assertNonEmpty(input.idColumn, "idColumn");
  const position = decodeCursor(input.cursor);
  const direction = input.pageDirection ?? "forward";
  const operator =
    (input.sortDirection === "asc" && direction === "forward") ||
    (input.sortDirection === "desc" && direction === "backward")
      ? ">"
      : "<";
  return {
    where: `(${input.sortColumn}, ${input.idColumn}) ${operator} (?, ?)`,
    params: [position.sortValue, position.id],
  };
}

function hasNextPage<TItem>(input: {
  sorted: readonly TItem[];
  policy: CursorPaginationPolicy;
  projection: CursorProjection<TItem>;
  lastPosition?: CursorPosition;
}): boolean {
  if (!input.lastPosition) return false;
  return input.sorted.some((item) =>
    isPastBoundary(
      itemToPosition(item, input.projection),
      input.lastPosition!,
      input.policy.sortDirection,
      "forward",
    ),
  );
}

function hasPreviousPage<TItem>(input: {
  sorted: readonly TItem[];
  policy: CursorPaginationPolicy;
  projection: CursorProjection<TItem>;
  firstPosition?: CursorPosition;
}): boolean {
  if (!input.firstPosition) return false;
  return input.sorted.some((item) =>
    isPastBoundary(
      itemToPosition(item, input.projection),
      input.firstPosition!,
      input.policy.sortDirection,
      "backward",
    ),
  );
}

function sortItems<TItem>(
  items: readonly TItem[],
  projection: CursorProjection<TItem>,
  sortDirection: CursorSortDirection,
): TItem[] {
  return [...items].sort((left, right) =>
    comparePositions(
      itemToPosition(left, projection),
      itemToPosition(right, projection),
      sortDirection,
    ),
  );
}

function itemToPosition<TItem>(item: TItem, projection: CursorProjection<TItem>): CursorPosition {
  const id = projection.getId(item);
  const sortValue = projection.getSortValue(item);
  assertCursorPosition({ id, sortValue });
  return { id, sortValue };
}

function isPastBoundary(
  position: CursorPosition,
  boundary: CursorPosition,
  sortDirection: CursorSortDirection,
  direction: CursorDirection,
): boolean {
  const comparison = comparePositions(position, boundary, sortDirection);
  return direction === "forward" ? comparison > 0 : comparison < 0;
}

function comparePositions(
  left: CursorPosition,
  right: CursorPosition,
  sortDirection: CursorSortDirection,
): number {
  const sortComparison = compareCursorValues(left.sortValue, right.sortValue);
  const directionalComparison = sortDirection === "asc" ? sortComparison : -sortComparison;
  if (directionalComparison !== 0) return directionalComparison;
  return left.id.localeCompare(right.id);
}

function compareCursorValues(left: CursorValue, right: CursorValue): number {
  if (typeof left === "number" && typeof right === "number") return left - right;
  return String(left).localeCompare(String(right));
}

function assertCursorPosition(position: CursorPosition): void {
  assertNonEmpty(position.id, "id");
  if (typeof position.sortValue !== "string" && typeof position.sortValue !== "number") {
    throw new Error("sortValue must be a string or number");
  }
  if (typeof position.sortValue === "string") assertNonEmpty(position.sortValue, "sortValue");
}

function assertPolicy(policy: CursorPaginationPolicy): void {
  assertPositiveInteger(policy.maxLimit, "maxLimit");
}

function assertNonEmpty(value: string, name: string): void {
  if (!value.trim()) throw new Error(`${name} is required`);
}

function assertPositiveInteger(value: number, name: string): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
}

function cloneJson(value: unknown): unknown {
  if (value === undefined) return undefined;
  return JSON.parse(JSON.stringify(value));
}
