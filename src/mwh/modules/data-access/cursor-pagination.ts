import type { MwhModule } from "../../types.js";

const CONTENT = `# MWH Module: Cursor Pagination Middleware

## Purpose

Use this module as a reusable reference when implementing cursor-based pagination in repository, API, or data-access query adapters.

The module defines deterministic cursor encoding, stable ordering with a unique tie-breaker, forward/backward page windows, hasNext/hasPrevious flags, and SQL predicate generation. It is designed to replace fragile offset pagination for changing datasets.

## When To Use

- A list endpoint needs stable pagination while rows are inserted or deleted.
- A repository needs one pagination contract across SQL, search, and in-memory adapters.
- API responses need opaque cursors rather than raw offset numbers.
- Tests need deterministic page windows without a database.

## When Not To Use

- Do not use cursor pagination without a stable sort column and unique id tie-breaker.
- Do not expose raw internal database primary keys as public cursor strings when that leaks sensitive information.
- Do not combine arbitrary ad-hoc sorting with precomputed cursors unless the sort is encoded in the cursor namespace.
- Do not use offset pagination as the source of truth for large mutable datasets.

## Implementation Variants

- memory-paginator: deterministic in-process paginator for unit tests and adapter contracts.
- SQL adapter: maps cursor positions to tuple predicates such as (created_at, id) > (?, ?).
- API adapter: maps pageInfo to GraphQL Relay or REST response shapes.
- Search adapter: maps cursor positions to search_after-style sort arrays.

## Recommended Architecture

- core.ts: pure cursor encode/decode, stable sorting, page selection, pageInfo, and SQL predicate generation.
- memory-paginator.ts: stateful reference implementation with upsert/remove and clone-safe reads.
- adapters/sql.ts: maps CursorPageRequest to ORDER BY, WHERE tuple predicate, LIMIT + 1, and reverse paging.
- adapters/api.ts: maps CursorPage to response metadata.

## Public API Sketch

\`\`\`ts
const paginator = new MemoryCursorPaginator({
  items: posts,
  policy: { sortDirection: "desc", maxLimit: 50 },
  projection: {
    getId: (post) => post.id,
    getSortValue: (post) => post.createdAt,
  },
});

const firstPage = paginator.page({ limit: 20 });
const nextPage = paginator.page({ limit: 20, after: firstPage.pageInfo.endCursor });
\`\`\`

## Integration Steps

1. Pick one stable sort column and a unique id tie-breaker for each paginated resource.
2. Use the pure core in unit tests to verify page windows and cursor semantics.
3. Map the generated cursor position to SQL tuple predicates or search_after arrays.
4. Keep cursors opaque at API boundaries and include tenant/filter namespace in production cursor signing if needed.

## Failure Modes

- Non-unique sorting produces duplicate or skipped rows.
- Changing filters between pages invalidates cursor semantics.
- Missing tie-breaker makes page order unstable.
- Backward pagination returns reversed display order if the adapter does not normalize output order.

## Security Notes

- Base64 cursors are opaque but not encrypted.
- Sign or encrypt public cursors if they expose sensitive sort values.
- Include tenant/filter scope in signed cursor payloads to prevent cursor reuse across datasets.

## Verification Checklist

- Stateless tests cover cursor encode/decode, forward pages, backward pages, hasNext/hasPrevious, desc sorting, invalid cursor rejection, and SQL predicates.
- Stateful tests cover memory upsert, remove, clone-safe reads, and pagination after data changes.
- SQL adapter tests should verify ORDER BY, tuple predicate direction, LIMIT + 1, and reverse-page normalization.

## Source References

- GraphQL Relay cursor connection pagination.
- SQL keyset pagination patterns with tuple comparison.
- search_after pagination patterns in search engines.
- Repository pagination adapter patterns.
`;

export const CURSOR_PAGINATION_MODULE: MwhModule = {
  id: "cursor-pagination",
  title: "Cursor Pagination Middleware",
  summary:
    "Reusable data-access reference for keyset/cursor pagination, stable sorting, pageInfo, SQL predicates, and adapter tests.",
  version: "0.1.0",
  tags: ["data-access", "database", "pagination", "query-adapter", "middleware"],
  source: { kind: "builtin", label: "Carbon Code built-in" },
  content: CONTENT,
};
