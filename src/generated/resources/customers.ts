/**
 * `Customers` resource — `create` / `get` / `list` (architecture §6, §5.1).
 * Hand-authored in V0.1 to mirror future generator output (D1); V0.4 overwrites it. Story
 * 003 expands it to the full customers surface (`update` + the KYC / bank-account /
 * biometrics / credit-offer sub-paths); story 002 only RE-WIRES it onto the reconciled
 * `Customer` types + the generated (de)serializer convention.
 *
 * ── Casing is delegated to the generated serializers (story 002 convention) ──
 * V0.1 hand-rolled the camelCase ↔ snake_case bridge inside this file. As of V0.2 that
 * mapping lives with each type as `serialize*`/`deserialize*` (see `../types/customer.ts`,
 * the exemplar). This resource just calls them — `serializeCreateCustomerRequest` on the way
 * out, `deserializeCustomer` on the way back — so every resource bridges casing the same way
 * and the runtime stays case-agnostic.
 *
 * ── APIPromise list path (story 001 follow-up) ──
 * `list`'s `fetchPage` returns `http.requestPage<CustomerWire>(...)._thenUnwrap(toWirePage)`
 * — an `APIPromise` — so `PagePromise` threads the REAL first-page HTTP response into
 * `.asResponse()`/`.withResponse()` instead of the paginator's synthetic fallback. Removing
 * that now-unused `{ status: 200, headers: {} }` bridge from `runtime/paginator.ts` is
 * deferred to story 003+ (it owns the runtime-touching cleanup; story 002 must not modify
 * `runtime/`).
 *
 * ── runtime ↔ generated boundary ──
 * Lives in `generated/`. Imports ONLY from `runtime/` (`HttpClient`, `RequestOptions`,
 * `PagePromise`/`FetchPage`, `ListEnvelope`) plus sibling generated types — never the
 * reverse. The `HttpClient` is injected by `client.ts`; this class never builds one.
 */

import type { HttpClient, ListEnvelope, RequestOptions } from '../../runtime/http.js';
import { PagePromise, type FetchPage } from '../../runtime/paginator.js';
import {
  deserializeCustomer,
  serializeCreateCustomerRequest,
  type CreateCustomerRequest,
  type Customer,
  type CustomerListParams,
  type CustomerWire,
} from '../types/customer.js';

/** Path of the customers collection. */
const CUSTOMERS_PATH = '/v3/customers';

/**
 * The customers resource, composed onto `client.customers` by `Dinie` (architecture §6).
 * Holds the injected {@link HttpClient}; the camelCase ↔ snake_case bridge is delegated to
 * the generated serializers (story 002).
 */
export class Customers {
  readonly #http: HttpClient;

  constructor(http: HttpClient) {
    this.#http = http;
  }

  /**
   * Create a customer. `POST /v3/customers` (idempotent — the runtime mints a stable
   * `X-Idempotency-Key` reused across retries). The camelCase request is serialized to the
   * wire body and the wire response deserialized back to a camelCase {@link Customer}.
   */
  async create(params: CreateCustomerRequest, options?: RequestOptions): Promise<Customer> {
    const wire = await this.#http.request<CustomerWire>({
      method: 'POST',
      path: CUSTOMERS_PATH,
      body: serializeCreateCustomerRequest(params),
      idempotent: true,
      ...(options !== undefined ? { options } : {}),
    });
    return deserializeCustomer(wire);
  }

  /** Retrieve a customer by id. `GET /v3/customers/{id}`. */
  async get(id: string, options?: RequestOptions): Promise<Customer> {
    const wire = await this.#http.request<CustomerWire>({
      method: 'GET',
      path: `${CUSTOMERS_PATH}/${encodeURIComponent(id)}`,
      idempotent: false,
      ...(options !== undefined ? { options } : {}),
    });
    return deserializeCustomer(wire);
  }

  /**
   * List customers, auto-paginated. Returns a {@link PagePromise} (D7/D15): `await` it for
   * the first {@link import('../../runtime/paginator.js').Page}, `for await` over it to
   * stream every customer across every page, or `.withResponse()` for the first page's HTTP
   * response.
   *
   * The paginator drives the cursor: it calls `fetchPage()` for the first page and
   * `fetchPage(lastId)` thereafter; this resource maps that cursor to the wire
   * `starting_after` query param and deserializes each wire item. An explicit
   * `params.startingAfter` seeds the first page.
   */
  list(params?: CustomerListParams, options?: RequestOptions): PagePromise<Customer> {
    const fetchPage: FetchPage<Customer> = (cursor) => {
      const startingAfter = cursor ?? params?.startingAfter;
      return this.#http
        .requestPage<CustomerWire>({
          method: 'GET',
          path: CUSTOMERS_PATH,
          query: {
            ...(params?.limit !== undefined ? { limit: params.limit } : {}),
            ...(startingAfter !== undefined ? { starting_after: startingAfter } : {}),
          },
          idempotent: false,
          ...(options !== undefined ? { options } : {}),
        })
        ._thenUnwrap(toCustomerPage);
    };
    return new PagePromise<Customer>(fetchPage);
  }
}

/** Map a wire list envelope to one of deserialized {@link Customer}s (preserving `has_more`). */
function toCustomerPage(wire: ListEnvelope<CustomerWire>): ListEnvelope<Customer> {
  return {
    object: 'list',
    data: wire.data.map(deserializeCustomer),
    has_more: wire.has_more,
  };
}
