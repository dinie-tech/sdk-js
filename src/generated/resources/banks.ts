/**
 * `Banks` resource — the bank directory (architecture §3.1, §6, §7.1, §7.5). Hand-authored in
 * V0.2 to mirror future generator output (D1); V0.4 overwrites it. A mechanical copy of the
 * `customers.ts` convention (story 003): inject the {@link HttpClient}, delegate the wire bridge
 * to the per-type generated deserializer.
 *
 * ── The 1 method ──
 *   list   GET   /v3/banks   → Promise<Bank[]>   (FLAT — NOT paginated; see below)
 *
 * ── `/banks` does NOT paginate — the story's key open question, resolved (§7.5) ──
 * Read against the contract (SoT — D2): the `GET /banks` `200` response schema is
 * `{ data: Bank[] }` with ONLY `data` required — NO `has_more`, NO `object: 'list'`, and the
 * operation declares NO query params. The §7.5 determinism rule is: "a list becomes
 * `PagePromise` iff its envelope has `has_more`; otherwise `T[]`." `/banks` has no `has_more`, so
 * `list` returns `Promise<Bank[]>` — a flat array, NOT a {@link import('../../runtime/paginator.js').PagePromise}.
 * (Contrast `credentials.list`/`webhookEndpoints.list`, whose envelopes DO carry `has_more`.)
 *
 * Because the contract defines no query params, `list` takes only `options?` — there is no
 * params object to thread (the §3.1 summary's `(params?, opts?)` is shorthand; the contract is
 * authoritative). The runtime unwraps the `{ data }` envelope here and returns the deserialized
 * array.
 *
 * ── Method naming (§7.1 — strip the resource noun) ──
 *   listBanks → list   (strip `Banks`)
 *
 * ── Idempotency (§7.4) ──
 * `list` is a GET → `idempotent: false` (no `X-Idempotency-Key`).
 *
 * ── runtime ↔ generated boundary ──
 * Lives in `generated/`. Imports ONLY from `runtime/` (`HttpClient`, `RequestOptions`) plus
 * sibling generated types — never the reverse. The `HttpClient` is injected by `client.ts`; this
 * class never builds one.
 */

import type { HttpClient, RequestOptions } from '../../runtime/http.js';
import { deserializeBank, type Bank, type BankWire } from '../types/bank.js';

/** Path of the banks collection. */
const BANKS_PATH = '/v3/banks';

/** Wire shape of the `GET /banks` response: a bare `{ data }` envelope with NO `has_more`. */
interface BankListWire {
  data: BankWire[];
}

/**
 * The banks resource, composed onto `client.banks` by `Dinie` (architecture §6). Holds the
 * injected {@link HttpClient}; the wire bridge is delegated to the generated deserializer.
 */
export class Banks {
  readonly #http: HttpClient;

  constructor(http: HttpClient) {
    this.#http = http;
  }

  /**
   * List the banks available for customer bank-account submission. `GET /v3/banks`. The response
   * is a flat `{ data: Bank[] }` envelope with NO `has_more` (§7.5), so this returns a plain
   * `Promise<Bank[]>` — the full directory in one call, NOT a paginated stream. Each entry is
   * deserialized to a camelCase {@link Bank}.
   */
  async list(options?: RequestOptions): Promise<Bank[]> {
    const wire = await this.#http.request<BankListWire>({
      method: 'GET',
      path: BANKS_PATH,
      idempotent: false,
      ...(options !== undefined ? { options } : {}),
    });
    return wire.data.map(deserializeBank);
  }
}
