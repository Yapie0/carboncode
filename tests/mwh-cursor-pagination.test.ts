import { describe, expect, it } from "vitest";
import {
  buildCursorSqlPredicate,
  decodeCursor,
  encodeCursor,
  paginateByCursor,
} from "../src/mwh/modules/data-access/cursor-pagination/core.js";
import { MemoryCursorPaginator } from "../src/mwh/modules/data-access/cursor-pagination/memory-paginator.js";

interface Post {
  id: string;
  createdAt: number;
  title: string;
}

const posts: Post[] = [
  { id: "p1", createdAt: 100, title: "one" },
  { id: "p2", createdAt: 200, title: "two" },
  { id: "p3", createdAt: 200, title: "three" },
  { id: "p4", createdAt: 300, title: "four" },
];

const projection = {
  getId: (post: Post) => post.id,
  getSortValue: (post: Post) => post.createdAt,
};

describe("MWH cursor-pagination stateless core", () => {
  it("encodes cursors and paginates forward with stable tie-breakers", () => {
    const cursor = encodeCursor({ sortValue: 200, id: "p2" });
    expect(decodeCursor(cursor)).toEqual({ sortValue: 200, id: "p2" });

    const firstPage = paginateByCursor({
      items: posts,
      request: { limit: 2 },
      policy: { sortDirection: "asc", maxLimit: 50 },
      projection,
    });
    expect(firstPage.items.map((post) => post.id)).toEqual(["p1", "p2"]);
    expect(firstPage.pageInfo.hasNextPage).toBe(true);
    expect(firstPage.pageInfo.hasPreviousPage).toBe(false);

    const secondPage = paginateByCursor({
      items: posts,
      request: { limit: 2, after: firstPage.pageInfo.endCursor },
      policy: { sortDirection: "asc", maxLimit: 50 },
      projection,
    });
    expect(secondPage.items.map((post) => post.id)).toEqual(["p3", "p4"]);
    expect(secondPage.pageInfo.hasNextPage).toBe(false);
    expect(secondPage.pageInfo.hasPreviousPage).toBe(true);
  });

  it("paginates backward and preserves display order", () => {
    const page = paginateByCursor({
      items: posts,
      request: { limit: 2, before: encodeCursor({ sortValue: 300, id: "p4" }) },
      policy: { sortDirection: "asc", maxLimit: 50 },
      projection,
    });

    expect(page.items.map((post) => post.id)).toEqual(["p2", "p3"]);
    expect(page.pageInfo.hasNextPage).toBe(true);
    expect(page.pageInfo.hasPreviousPage).toBe(true);
  });

  it("supports descending order and SQL tuple predicates", () => {
    const page = paginateByCursor({
      items: posts,
      request: { limit: 2 },
      policy: { sortDirection: "desc", maxLimit: 50 },
      projection,
    });
    expect(page.items.map((post) => post.id)).toEqual(["p4", "p2"]);

    expect(
      buildCursorSqlPredicate({
        cursor: encodeCursor({ sortValue: 200, id: "p2" }),
        sortColumn: "created_at",
        idColumn: "id",
        sortDirection: "desc",
      }),
    ).toEqual({
      where: "(created_at, id) < (?, ?)",
      params: [200, "p2"],
    });
    expect(() => decodeCursor("not-valid")).toThrow("invalid cursor");
  });
});

describe("MWH cursor-pagination stateful memory paginator", () => {
  it("upserts, removes, paginates, and keeps clone-safe reads", () => {
    const paginator = new MemoryCursorPaginator<Post>({
      items: posts.slice(0, 2),
      policy: { sortDirection: "asc", maxLimit: 2 },
      projection,
    });
    paginator.upsert({ id: "p3", createdAt: 300, title: "three" });
    paginator.upsert({ id: "p2", createdAt: 250, title: "two updated" });

    const listed = paginator.listItems();
    listed[0]!.title = "mutated";
    expect(paginator.listItems()[0]?.title).toBe("one");

    const page = paginator.page({ limit: 10 });
    expect(page.items.map((post) => post.id)).toEqual(["p1", "p2"]);
    expect(page.pageInfo.hasNextPage).toBe(true);

    expect(paginator.remove("p2")).toBe(true);
    expect(paginator.page({ limit: 10 }).items.map((post) => post.id)).toEqual(["p1", "p3"]);
  });

  it("uses page cursors after data changes without offset drift", () => {
    const paginator = new MemoryCursorPaginator<Post>({
      items: posts,
      policy: { sortDirection: "asc", maxLimit: 2 },
      projection,
    });
    const firstPage = paginator.page({ limit: 2 });
    paginator.upsert({ id: "p0", createdAt: 50, title: "new earlier item" });
    const nextPage = paginator.page({ limit: 2, after: firstPage.pageInfo.endCursor });

    expect(nextPage.items.map((post) => post.id)).toEqual(["p3", "p4"]);
  });

  it("supports batch upsert, bounded page scans, stop predicates, and clear", () => {
    const paginator = new MemoryCursorPaginator<Post>({
      policy: { sortDirection: "asc", maxLimit: 2 },
      projection,
    });

    expect(paginator.upsertMany(posts)).toBe(4);
    const pages = paginator.pageUntil({ limit: 2, maxPages: 3 });
    expect(pages.map((page) => page.items.map((post) => post.id))).toEqual([
      ["p1", "p2"],
      ["p3", "p4"],
    ]);

    const stopped = paginator.pageUntil({
      limit: 2,
      maxPages: 3,
      stopWhen: (post) => post.id === "p2",
    });
    expect(stopped).toHaveLength(1);
    expect(() => paginator.pageUntil({ limit: 2, maxPages: 0 })).toThrow(
      "maxPages must be a positive integer",
    );
    expect(paginator.clear()).toBe(4);
    expect(paginator.page({ limit: 2 }).items).toEqual([]);
  });
});
