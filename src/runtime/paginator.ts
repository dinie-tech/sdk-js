/**
 * Cursor-based auto-pagination — `Page<T>` + `PagePromise<T>` (story 008, D7).
 *
 * Dinie has exactly ONE cursor scheme (inherited contract D#1): `starting_after`
 * (the `id` of the last item of the previous page) + `has_more` (the source of truth
 * for the end of the list). We deliberately do NOT copy OpenAI's three CursorPage
 * variants — see `openai-node/src/core/pagination.ts:13-113` for the dual-nature
 * `PagePromise` pattern this file adapts to that single scheme.
 *
 * Two pieces:
 *   - {@link Page} — one page of results (`data` + `hasMore`) that also knows how to
 *     fetch the *next* page (cursor = the last item's `id`). It is `AsyncIterable<T>`
 *     over EVERY item of EVERY following page (auto-pagination), and exposes a manual
 *     `.nextPage()` / `.hasNextPage()` mode for page-by-page control.
 *   - {@link PagePromise} — the return type of `list()`. It is *simultaneously* a
 *     `Promise<Page<T>>` (so `await list()` yields the first `Page`) AND an
 *     `AsyncIterable<T>` (so `for await (const c of list())` iterates every item across
 *     every page WITHOUT an explicit `await` before the `for`). This dual nature is the
 *     only way to support both ergonomics from one return value (D7).
 *
 * ── Decoupled from transport ──
 * The paginator is generic over an injected `fetchPage(cursor?)` (see {@link FetchPage})
 * supplied by the resource (story 009 — `Customers.list`). It does NOT import the
 * concrete `HttpClient`; the resource's `fetchPage` is what calls `http.requestPage`
 * and maps the runtime cursor to the `starting_after` query param. This keeps the
 * paginator pure and testable with an in-memory fake — no network, no `http` coupling.
 *
 * ── runtime ↔ generated boundary ──
 * Lives in `runtime/`. The only `http` dependency is the type-only `ListEnvelope<T>`
 * (erased at compile time under `verbatimModuleSyntax`, so there is no runtime cycle).
 * `Page`/`PagePromise` ARE public surface — re-exported via `runtime/index.ts` (§6).
 */

import type { ListEnvelope } from './http.js';

/**
 * The minimum an item must expose for cursor pagination: a stable `id`. The next
 * page's `starting_after` cursor is the `id` of the last item on the current page
 * (inherited contract D#1). `Customer` (and every other list item) satisfies this.
 */
export interface HasId {
  id: string;
}

/**
 * Fetch one page given an optional cursor. Injected by the resource (story 009): its
 * implementation calls `http.requestPage` with `starting_after = cursor` and returns
 * the wire {@link ListEnvelope}. `undefined` cursor ⇒ the first page (no
 * `starting_after`). The paginator owns *when* to call this and *what* cursor to pass;
 * the resource owns *how* it reaches the network.
 */
export type FetchPage<T> = (cursor?: string) => Promise<ListEnvelope<T>>;

/**
 * One page of a cursor-paginated list. Holds the page's `data` and the `hasMore` flag
 * from the wire envelope, and carries the injected `fetchPage` so it can mint the next
 * `Page`. Iterating a `Page` (`for await`) walks EVERY item of this page and all
 * following pages; for page-by-page control use `hasNextPage()` + `nextPage()`.
 */
export class Page<T extends HasId> implements AsyncIterable<T> {
  /** Items on this page (already wire-decoded by `fetchPage`). */
  readonly data: T[];
  /** Whether the API reports more pages after this one — the ONLY end-of-list signal. */
  readonly hasMore: boolean;
  readonly #fetchPage: FetchPage<T>;

  constructor(envelope: ListEnvelope<T>, fetchPage: FetchPage<T>) {
    this.data = envelope.data;
    this.hasMore = envelope.has_more;
    this.#fetchPage = fetchPage;
  }

  /**
   * Whether a next page can be fetched. Driven by `has_more` (never by
   * `data.length === limit` — D#1). The extra `data.length > 0` guard is a safety net:
   * an empty page has no last item, so there is no `starting_after` cursor to send —
   * we stop rather than loop forever on a malformed `{ data: [], has_more: true }`.
   */
  hasNextPage(): boolean {
    return this.hasMore && this.data.length > 0;
  }

  /**
   * Fetch the next page. The cursor is the `id` of the LAST item on this page, passed
   * to `fetchPage` (which maps it to `starting_after`). Throws if there is no next page
   * — guard with {@link hasNextPage} (or check `hasMore`) before calling.
   */
  async nextPage(): Promise<Page<T>> {
    if (!this.hasNextPage()) {
      throw new Error(
        'No next page available; check hasNextPage() (or hasMore) before calling nextPage().',
      );
    }
    // Safe: hasNextPage() guarantees data.length > 0, so the last item exists.
    const cursor = this.data[this.data.length - 1]!.id;
    const envelope = await this.#fetchPage(cursor);
    return new Page(envelope, this.#fetchPage);
  }

  /**
   * Auto-paginate: yield every item of this page, then every item of each following
   * page, until `has_more` is false. This is what powers `for await (const c of page)`.
   */
  async *[Symbol.asyncIterator](): AsyncIterator<T> {
    let page: Page<T> = this;
    for (;;) {
      yield* page.data;
      if (!page.hasNextPage()) return;
      page = await page.nextPage();
    }
  }
}

/**
 * The dual-natured return value of `list()` (D7): a `Promise<Page<T>>` AND an
 * `AsyncIterable<T>`.
 *
 *   - `const page = await list()` → the first {@link Page} (manual mode entry point).
 *   - `for await (const item of list())` → every item across every page, with no
 *     explicit `await` before the loop.
 *
 * The first page is fetched lazily and memoized: the first `await`/iteration triggers
 * `fetchPage(undefined)` exactly once, and a second consumer reuses that same result.
 */
export class PagePromise<T extends HasId> implements Promise<Page<T>>, AsyncIterable<T> {
  readonly #fetchPage: FetchPage<T>;
  /** Memoized first-page request; created on first consumption (lazy). */
  #firstPage: Promise<Page<T>> | undefined;

  constructor(fetchPage: FetchPage<T>) {
    this.#fetchPage = fetchPage;
  }

  /** Fetch (once) and wrap the first page. Subsequent calls reuse the same promise. */
  #loadFirstPage(): Promise<Page<T>> {
    this.#firstPage ??= this.#fetchPage().then((envelope) => new Page(envelope, this.#fetchPage));
    return this.#firstPage;
  }

  // ── Promise<Page<T>> surface (delegated to the memoized first-page promise) ──

  then<TResult1 = Page<T>, TResult2 = never>(
    onfulfilled?: ((value: Page<T>) => TResult1 | PromiseLike<TResult1>) | undefined | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | undefined | null,
  ): Promise<TResult1 | TResult2> {
    return this.#loadFirstPage().then(onfulfilled, onrejected);
  }

  catch<TResult = never>(
    onrejected?: ((reason: unknown) => TResult | PromiseLike<TResult>) | undefined | null,
  ): Promise<Page<T> | TResult> {
    return this.#loadFirstPage().catch(onrejected);
  }

  finally(onfinally?: (() => void) | undefined | null): Promise<Page<T>> {
    return this.#loadFirstPage().finally(onfinally);
  }

  get [Symbol.toStringTag](): string {
    return 'PagePromise';
  }

  // ── AsyncIterable<T> surface (await the first page, then auto-paginate) ──

  async *[Symbol.asyncIterator](): AsyncIterator<T> {
    const page = await this.#loadFirstPage();
    yield* page;
  }
}
