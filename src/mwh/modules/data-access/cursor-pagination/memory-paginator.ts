import {
  type CursorPage,
  type CursorPageRequest,
  type CursorPaginationPolicy,
  type CursorProjection,
  paginateByCursor,
} from "./core.js";

export class MemoryCursorPaginator<TItem> {
  private items: TItem[];
  private readonly policy: CursorPaginationPolicy;
  private readonly projection: CursorProjection<TItem>;

  constructor(input: {
    items?: readonly TItem[];
    policy: CursorPaginationPolicy;
    projection: CursorProjection<TItem>;
  }) {
    this.items = cloneItems(input.items ?? []);
    this.policy = { ...input.policy };
    this.projection = input.projection;
  }

  upsert(item: TItem): void {
    const id = this.projection.getId(item);
    this.items = [
      ...this.items.filter((candidate) => this.projection.getId(candidate) !== id),
      cloneItem(item),
    ];
  }

  upsertMany(items: readonly TItem[]): number {
    for (const item of items) this.upsert(item);
    return items.length;
  }

  remove(id: string): boolean {
    const before = this.items.length;
    this.items = this.items.filter((item) => this.projection.getId(item) !== id);
    return this.items.length !== before;
  }

  clear(): number {
    const removed = this.items.length;
    this.items = [];
    return removed;
  }

  page(request: CursorPageRequest): CursorPage<TItem> {
    return paginateByCursor({
      items: this.items,
      request,
      policy: this.policy,
      projection: this.projection,
    });
  }

  pageUntil(input: {
    limit: number;
    maxPages: number;
    stopWhen?: (item: TItem) => boolean;
  }): CursorPage<TItem>[] {
    if (!Number.isInteger(input.maxPages) || input.maxPages <= 0) {
      throw new Error("maxPages must be a positive integer");
    }
    const pages: CursorPage<TItem>[] = [];
    let after: string | undefined;
    for (let pageIndex = 0; pageIndex < input.maxPages; pageIndex += 1) {
      const page = this.page({ limit: input.limit, after });
      pages.push(page);
      if (!page.pageInfo.hasNextPage) break;
      if (input.stopWhen && page.items.some(input.stopWhen)) break;
      after = page.pageInfo.endCursor;
      if (!after) break;
    }
    return pages;
  }

  listItems(): TItem[] {
    return cloneItems(this.items);
  }
}

function cloneItems<TItem>(items: readonly TItem[]): TItem[] {
  return items.map(cloneItem);
}

function cloneItem<TItem>(item: TItem): TItem {
  return JSON.parse(JSON.stringify(item)) as TItem;
}
