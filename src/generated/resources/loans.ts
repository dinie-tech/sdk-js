/**
 * `Loans` resource — loans + transactions (architecture §3.1, §7.1, §7.5, §12, §15.2).
 * Hand-authored in V0.2 to mirror future generator output (D1); V0.4 overwrites it. A mechanical
 * copy of the `customers.ts` convention (story 003): inject the {@link HttpClient}, delegate the
 * camelCase ↔ snake_case bridge to the per-type generated serializers, methods alphabetical.
 *
 * ── The 3 methods (alphabetical — minimal diff for the V0.4 generator) ──
 *   create             POST   /v3/loans                       → Loan (201, idempotent)
 *   get                GET    /v3/loans/{id}                   → Loan
 *   listTransactions   GET    /v3/loans/{id}/transactions      → PagePromise<Transaction>
 *
 * ── Method naming (§7.1 — strip the resource noun) ──
 *   createLoan       → create   (strip `Loan`)
 *   getLoan          → get      (strip `Loan`)
 *   listTransactions → listTransactions  (no resource noun to strip — `Transaction` ≠ `Loan`)
 *
 * ── Sub-path (D3): the parent id is the 1st positional arg ──
 * `GET /loans/{id}/transactions` becomes `listTransactions(id, params?, opts?)` — the `{loan_id}`
 * segment is the leading `id`, `encodeURIComponent`-escaped.
 *
 * ── `create` body (contract-confirmed) ──
 * `CreateLoanRequest` carries the offer id PLUS the accepted simulation's chosen terms
 * (`simulationId`, `installmentCount`, `installmentAmount`, `firstDueDate`) — the loan is created
 * from a credit offer and an accepted simulation (see `../types/loan.ts`).
 *
 * ── runtime ↔ generated boundary ──
 * Lives in `generated/`. Imports ONLY from `runtime/` (`HttpClient`, `RequestOptions`,
 * `PagePromise`/`FetchPage`, `ListEnvelope`) plus sibling generated types — never the reverse.
 * The `HttpClient` is injected by `client.ts`; this class never builds one.
 */

import type { HttpClient, ListEnvelope, RequestOptions } from '../../runtime/http.js';
import { PagePromise, type FetchPage } from '../../runtime/paginator.js';
import {
  deserializeLoan,
  serializeCreateLoanRequest,
  type CreateLoanRequest,
  type Loan,
  type LoanTransactionsListParams,
  type LoanWire,
} from '../types/loan.js';
import {
  deserializeTransaction,
  type Transaction,
  type TransactionWire,
} from '../types/transaction.js';

/** Path of the loans collection. */
const LOANS_PATH = '/v3/loans';

/** Path of a single loan (sub-paths hang off this). */
function loanPath(id: string): string {
  return `${LOANS_PATH}/${encodeURIComponent(id)}`;
}

/**
 * The loans resource, composed onto `client.loans` by `Dinie` (architecture §6). Holds the
 * injected {@link HttpClient}; the casing bridge is delegated to the generated serializers
 * (story 002). Methods are alphabetical.
 */
export class Loans {
  readonly #http: HttpClient;

  constructor(http: HttpClient) {
    this.#http = http;
  }

  /**
   * Create a loan from a credit offer and accepted simulation. `POST /v3/loans` (idempotent — the
   * runtime mints a stable `X-Idempotency-Key` reused across retries). The CCB contract is
   * generated synchronously; the loan starts in `awaiting_signatures`. The camelCase request is
   * serialized to the wire body and the wire response (201) deserialized to a {@link Loan}.
   */
  async create(params: CreateLoanRequest, options?: RequestOptions): Promise<Loan> {
    const wire = await this.#http.request<LoanWire>({
      method: 'POST',
      path: LOANS_PATH,
      body: serializeCreateLoanRequest(params),
      idempotent: true,
      ...(options !== undefined ? { options } : {}),
    });
    return deserializeLoan(wire);
  }

  /** Retrieve a loan by id. `GET /v3/loans/{id}`. */
  async get(id: string, options?: RequestOptions): Promise<Loan> {
    const wire = await this.#http.request<LoanWire>({
      method: 'GET',
      path: loanPath(id),
      idempotent: false,
      ...(options !== undefined ? { options } : {}),
    });
    return deserializeLoan(wire);
  }

  /**
   * List a loan's installment transactions, auto-paginated. `GET /v3/loans/{id}/transactions`.
   * Returns a {@link PagePromise}<{@link Transaction}> with the same dual nature as the other
   * `list*` methods: `await` for the first page, `for await` to stream every transaction, or
   * `.withResponse()` for the first page's HTTP response. `params.limit`/`startingAfter` and the
   * paginator cursor drive pagination (mapped to the wire `limit`/`starting_after` query params).
   */
  listTransactions(
    id: string,
    params?: LoanTransactionsListParams,
    options?: RequestOptions,
  ): PagePromise<Transaction> {
    const fetchPage: FetchPage<Transaction> = (cursor) => {
      const startingAfter = cursor ?? params?.startingAfter;
      return this.#http
        .requestPage<TransactionWire>({
          method: 'GET',
          path: `${loanPath(id)}/transactions`,
          query: {
            ...(params?.limit !== undefined ? { limit: params.limit } : {}),
            ...(startingAfter !== undefined ? { starting_after: startingAfter } : {}),
          },
          idempotent: false,
          ...(options !== undefined ? { options } : {}),
        })
        ._thenUnwrap(toTransactionPage);
    };
    return new PagePromise<Transaction>(fetchPage);
  }
}

/** Map a wire list envelope to one of deserialized {@link Transaction}s (preserving `has_more`). */
function toTransactionPage(wire: ListEnvelope<TransactionWire>): ListEnvelope<Transaction> {
  return {
    object: 'list',
    data: wire.data.map(deserializeTransaction),
    has_more: wire.has_more,
  };
}
