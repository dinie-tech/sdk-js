/**
 * `Customers` resource — `create` / `get` / `list` (architecture §6, §5.1).
 * Hand-authored in V0.1 to mirror future generator output (D1); V0.4 overwrites it.
 *
 * This is where the provisional casing decision (D4) is realized: the public surface is
 * camelCase, and THIS layer maps it to/from the snake_case wire (`taxId` ↔ `tax_id`,
 * `createdAt` ↔ `created_at`, `startingAfter` ↔ `starting_after`). The runtime stays
 * case-agnostic. The mapping is explicit (not reflective) so the V0.4 generator output
 * is a small, reviewable diff.
 *
 * ── runtime ↔ generated boundary ──
 * Lives in `generated/`. Imports ONLY from `runtime/` (`HttpClient`, `RequestOptions`,
 * `PagePromise`/`FetchPage`, `ListEnvelope`) plus sibling generated types — never the
 * reverse. The `HttpClient` is injected by `client.ts`; this class never builds one.
 */

import type { HttpClient, ListEnvelope, RequestOptions } from '../../runtime/http.js';
import { PagePromise, type FetchPage } from '../../runtime/paginator.js';
import type { Customer, CustomerCreateParams, CustomerListParams } from '../types/customer.js';

/** Path of the customers collection. */
const CUSTOMERS_PATH = '/v3/customers';

/** Snake_case wire shape of a customer (architecture §4.2). Mapped to {@link Customer}. */
interface CustomerWire {
  id: string;
  object: 'customer';
  tax_id: string;
  name: string;
  email?: string;
  status: string;
  created_at: string;
}

/**
 * The customers resource, composed onto `client.customers` by `Dinie` (architecture §6).
 * Holds the injected {@link HttpClient} and translates between the camelCase surface and
 * the snake_case wire.
 */
export class Customers {
  readonly #http: HttpClient;

  constructor(http: HttpClient) {
    this.#http = http;
  }

  /**
   * Create a customer. `POST /v3/customers` (idempotent — the runtime mints a stable
   * `Idempotency-Key` reused across retries). Maps the camelCase params to the wire body
   * and the wire response back to a camelCase {@link Customer}.
   */
  async create(params: CustomerCreateParams, options?: RequestOptions): Promise<Customer> {
    const wire = await this.#http.request<CustomerWire>({
      method: 'POST',
      path: CUSTOMERS_PATH,
      body: toCreateBody(params),
      idempotent: true,
      ...(options !== undefined ? { options } : {}),
    });
    return toCustomer(wire);
  }

  /** Retrieve a customer by id. `GET /v3/customers/{id}`. */
  async get(id: string, options?: RequestOptions): Promise<Customer> {
    const wire = await this.#http.request<CustomerWire>({
      method: 'GET',
      path: `${CUSTOMERS_PATH}/${encodeURIComponent(id)}`,
      idempotent: false,
      ...(options !== undefined ? { options } : {}),
    });
    return toCustomer(wire);
  }

  /**
   * List customers, auto-paginated. Returns a {@link PagePromise} (D7): `await` it for
   * the first {@link import('../../runtime/paginator.js').Page}, or `for await` over it to
   * stream every customer across every page.
   *
   * The paginator drives the cursor: it calls `fetchPage()` for the first page and
   * `fetchPage(lastId)` thereafter; this resource maps that cursor to the wire
   * `starting_after` query param. An explicit `params.startingAfter` seeds the first page.
   */
  list(params?: CustomerListParams, options?: RequestOptions): PagePromise<Customer> {
    const fetchPage: FetchPage<Customer> = async (cursor) => {
      const startingAfter = cursor ?? params?.startingAfter;
      const wire = await this.#http.requestPage<CustomerWire>({
        method: 'GET',
        path: CUSTOMERS_PATH,
        query: {
          ...(params?.limit !== undefined ? { limit: params.limit } : {}),
          ...(startingAfter !== undefined ? { starting_after: startingAfter } : {}),
        },
        idempotent: false,
        ...(options !== undefined ? { options } : {}),
      });
      return toCustomerPage(wire);
    };
    return new PagePromise<Customer>(fetchPage);
  }
}

// ── camelCase ↔ snake_case mapping (D4 — the single place wire casing is bridged) ──

/** Map a wire customer (snake_case) to the public {@link Customer} (camelCase). */
function toCustomer(wire: CustomerWire): Customer {
  return {
    id: wire.id,
    object: wire.object,
    taxId: wire.tax_id,
    name: wire.name,
    // Omit `email` entirely when absent (exactOptionalPropertyTypes — never set `undefined`).
    ...(wire.email !== undefined ? { email: wire.email } : {}),
    status: wire.status,
    createdAt: wire.created_at,
  };
}

/** Map a wire list envelope to one of decoded {@link Customer}s (preserving `has_more`). */
function toCustomerPage(wire: ListEnvelope<CustomerWire>): ListEnvelope<Customer> {
  return {
    object: 'list',
    data: wire.data.map(toCustomer),
    has_more: wire.has_more,
  };
}

/** Map camelCase {@link CustomerCreateParams} to the snake_case wire body. */
function toCreateBody(params: CustomerCreateParams): Record<string, unknown> {
  return {
    tax_id: params.taxId,
    name: params.name,
    ...(params.email !== undefined ? { email: params.email } : {}),
  };
}
