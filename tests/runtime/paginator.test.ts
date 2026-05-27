/**
 * Paginator — `Page<T>` + `PagePromise<T>` (story 008), key-component tier (§8).
 *
 * Driven by an in-memory fake `fetchPage` — no http, no network. The fake serves a
 * fixed list of envelopes in order and RECORDS the cursor it was called with, so we can
 * assert directly that the next page's `starting_after` is the previous page's last id.
 *
 * Cases (§8): cursor application · termination by `has_more` (never by page size) ·
 * `for await` iterates every item across every page · manual `.nextPage()` · awaiting
 * the `PagePromise` resolves the first `Page` · lazy single-fetch memoization.
 */

import type { ListEnvelope } from '../../src/runtime/http.js';
import { Page, PagePromise, type FetchPage } from '../../src/runtime/paginator.js';

interface Item {
  id: string;
}

/** Build a wire list envelope from a set of ids. */
function envelope(ids: string[], hasMore: boolean): ListEnvelope<Item> {
  return { object: 'list', data: ids.map((id) => ({ id })), has_more: hasMore };
}

/**
 * Fake `fetchPage`: serves `pages` in order and records each cursor it received.
 * `cursors[0]` is the first-page cursor (always `undefined`); `cursors[n]` is what the
 * paginator passed to fetch page `n` — i.e. the last id of page `n-1`.
 */
function makeFetchPage(pages: ListEnvelope<Item>[]): {
  fetchPage: FetchPage<Item>;
  cursors: (string | undefined)[];
  callCount: () => number;
} {
  const cursors: (string | undefined)[] = [];
  let call = 0;
  const fetchPage: FetchPage<Item> = async (cursor) => {
    cursors.push(cursor);
    const page = pages[call];
    call += 1;
    if (page === undefined) {
      throw new Error(`fetchPage called more times than pages provided (call #${call})`);
    }
    return page;
  };
  return { fetchPage, cursors, callCount: () => call };
}

const idsOf = (items: Item[]): string[] => items.map((i) => i.id);

describe('PagePromise — cursor application', () => {
  it("passes the previous page's last id as the next page's starting_after cursor", async () => {
    const { fetchPage, cursors } = makeFetchPage([
      envelope(['a', 'b', 'c'], true),
      envelope(['d', 'e'], false),
    ]);

    const collected: string[] = [];
    for await (const item of new PagePromise(fetchPage)) {
      collected.push(item.id);
    }

    expect(collected).toEqual(['a', 'b', 'c', 'd', 'e']);
    // First page: no cursor. Second page: id of the last item of page 1 ('c').
    expect(cursors).toEqual([undefined, 'c']);
  });
});

describe('PagePromise — termination by has_more', () => {
  it('stops when has_more is false even though the page is full (never uses data.length)', async () => {
    // limit-sized page (2 items) but has_more === false ⇒ must NOT fetch a second page.
    const { fetchPage, callCount } = makeFetchPage([envelope(['a', 'b'], false)]);

    const collected: string[] = [];
    for await (const item of new PagePromise(fetchPage)) {
      collected.push(item.id);
    }

    expect(collected).toEqual(['a', 'b']);
    expect(callCount()).toBe(1);
  });

  it('keeps paging while has_more is true, even on full pages', async () => {
    const { fetchPage, cursors, callCount } = makeFetchPage([
      envelope(['a', 'b'], true),
      envelope(['c', 'd'], true),
      envelope(['e'], false),
    ]);

    const collected: string[] = [];
    for await (const item of new PagePromise(fetchPage)) {
      collected.push(item.id);
    }

    expect(collected).toEqual(['a', 'b', 'c', 'd', 'e']);
    expect(cursors).toEqual([undefined, 'b', 'd']);
    expect(callCount()).toBe(3);
  });

  it('does not loop on a malformed empty page that still reports has_more', async () => {
    const { fetchPage, callCount } = makeFetchPage([envelope([], true)]);

    const collected: string[] = [];
    for await (const item of new PagePromise(fetchPage)) {
      collected.push(item.id);
    }

    expect(collected).toEqual([]);
    expect(callCount()).toBe(1);
  });
});

describe('PagePromise — for await iterates all items across pages', () => {
  it('yields every item of every page in order', async () => {
    const { fetchPage } = makeFetchPage([
      envelope(['a', 'b'], true),
      envelope(['c'], true),
      envelope(['d', 'e', 'f'], false),
    ]);

    const collected: string[] = [];
    for await (const item of new PagePromise(fetchPage)) {
      collected.push(item.id);
    }

    expect(collected).toEqual(['a', 'b', 'c', 'd', 'e', 'f']);
  });
});

describe('Page — manual nextPage()', () => {
  it('walks pages one at a time using the last id as cursor', async () => {
    const { fetchPage, cursors } = makeFetchPage([
      envelope(['a', 'b'], true),
      envelope(['c'], false),
    ]);

    const first = await new PagePromise(fetchPage);
    expect(idsOf(first.data)).toEqual(['a', 'b']);
    expect(first.hasMore).toBe(true);
    expect(first.hasNextPage()).toBe(true);

    const second = await first.nextPage();
    expect(idsOf(second.data)).toEqual(['c']);
    expect(second.hasMore).toBe(false);
    expect(second.hasNextPage()).toBe(false);

    // First page fetched with no cursor; second with the last id of page 1.
    expect(cursors).toEqual([undefined, 'b']);
  });

  it('throws when nextPage() is called with no next page', async () => {
    const { fetchPage } = makeFetchPage([envelope(['a'], false)]);

    const page = await new PagePromise(fetchPage);
    expect(page.hasNextPage()).toBe(false);
    await expect(page.nextPage()).rejects.toThrow(/no next page/i);
  });
});

describe('Page — direct async iteration auto-paginates', () => {
  it('iterating a Page yields its items and all following pages', async () => {
    const { fetchPage } = makeFetchPage([envelope(['a', 'b'], true), envelope(['c'], false)]);

    const first = await new PagePromise(fetchPage);
    const collected: string[] = [];
    for await (const item of first) {
      collected.push(item.id);
    }

    expect(collected).toEqual(['a', 'b', 'c']);
  });
});

describe('PagePromise — Promise<Page<T>> nature', () => {
  it('awaiting the PagePromise resolves to the first Page', async () => {
    const { fetchPage } = makeFetchPage([envelope(['a', 'b'], true)]);

    const page = await new PagePromise(fetchPage);

    expect(page).toBeInstanceOf(Page);
    expect(idsOf(page.data)).toEqual(['a', 'b']);
    expect(page.hasMore).toBe(true);
  });

  it('exposes the PagePromise toStringTag', () => {
    const { fetchPage } = makeFetchPage([envelope(['a'], false)]);
    expect(Object.prototype.toString.call(new PagePromise(fetchPage))).toBe('[object PagePromise]');
  });

  it('fetches the first page lazily and only once across multiple awaits', async () => {
    const { fetchPage, cursors, callCount } = makeFetchPage([envelope(['a'], false)]);

    const promise = new PagePromise(fetchPage);
    // Nothing fetched until first consumption.
    expect(callCount()).toBe(0);

    const first = await promise;
    const second = await promise;

    expect(first).toBe(second);
    expect(cursors).toEqual([undefined]);
    expect(callCount()).toBe(1);
  });
});
