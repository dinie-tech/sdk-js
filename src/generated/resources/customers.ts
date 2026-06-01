/**
 * `Customers` resource — the full non-KYC surface (architecture §3.1, §6, §7.1).
 * Hand-authored in V0.2 to mirror future generator output (D1); V0.4 overwrites it. V0.1
 * sketched `create`/`get`/`list`; story 002 re-wired those onto the generated (de)serializer
 * convention; story 003 expands to the 8 non-KYC methods. The KYC block
 * (`uploadKycAttachment`/`startKycReview` + `Kyc*` types) is story 004 (same file, sequential).
 *
 * ── The 8 non-KYC methods (alphabetical — minimal diff for the V0.4 generator) ──
 *   create                 POST   /v3/customers
 *   createBiometricsSession POST  /v3/customers/{id}/biometrics       (no request body)
 *   get                    GET    /v3/customers/{id}
 *   getBankAccount         GET    /v3/customers/{id}/bank-account
 *   list                   GET    /v3/customers                       → PagePromise
 *   listCreditOffers       GET    /v3/customers/{id}/credit-offers     → PagePromise
 *   update                 PATCH  /v3/customers/{id}
 *   upsertBankAccount      POST   /v3/customers/{id}/bank-account
 *
 * ── Method naming (§7.1 — strip the resource noun) ──
 * Each method name is the openapi `operationId` with the resource noun stripped, so the names
 * read idiomatically (this rule feeds `principles.md`, story 009):
 *   getCustomerBankAccount    → getBankAccount     (strip `Customer`)
 *   upsertCustomerBankAccount → upsertBankAccount  (strip `Customer`)
 *   listCustomerCreditOffers  → listCreditOffers   (strip `Customer`)
 *   createBiometricsSession   → createBiometricsSession  (no resource noun to strip)
 *   createCustomer/getCustomer/listCustomers/updateCustomer → create/get/list/update
 *
 * ── Sub-paths (D3): the parent id is the 1st positional arg ──
 * A path like `POST /customers/{id}/bank-account` becomes `upsertBankAccount(id, params, opts?)`
 * — the `{customer_id}` segment is the leading `id` argument, `encodeURIComponent`-escaped.
 *
 * ── Casing is delegated to the generated serializers (story 002 convention) ──
 * Every method serializes its camelCase params to the wire on the way out and deserializes the
 * wire response to camelCase on the way back, via the per-type `serialize*`/`deserialize*` in
 * `../types/*` — so the runtime stays case-agnostic and every resource bridges casing the same
 * way. `upsertBankAccount` additionally wraps the request under the contract's `bank_account`
 * envelope (the per-schema serializer stays 1:1 with `CustomerBankAccountRequest`).
 *
 * ── Idempotency (§7.4) ──
 * Every non-GET write passes `idempotent: true`; the runtime mints a stable `X-Idempotency-Key`
 * reused across retries. GET reads pass `idempotent: false`.
 *
 * ── runtime ↔ generated boundary ──
 * Lives in `generated/`. Imports ONLY from `runtime/` (`HttpClient`, `RequestOptions`,
 * `PagePromise`/`FetchPage`, `ListEnvelope`) plus sibling generated types — never the reverse.
 * The `HttpClient` is injected by `client.ts`; this class never builds one.
 */

import type { HttpClient, ListEnvelope, RequestOptions } from '../../runtime/http.js';
import { PagePromise, type FetchPage } from '../../runtime/paginator.js';
import {
  deserializeCustomerBankAccount,
  serializeCustomerBankAccountRequest,
  type CustomerBankAccount,
  type CustomerBankAccountRequest,
  type CustomerBankAccountWire,
} from '../types/bank-account.js';
import {
  deserializeBiometricsSession,
  type BiometricsSession,
  type BiometricsSessionWire,
  type CreateBiometricsSessionParams,
} from '../types/biometrics.js';
import {
  deserializeCreditOffer,
  type CreditOffer,
  type CreditOfferWire,
} from '../types/credit-offer.js';
import {
  deserializeCustomer,
  serializeCreateCustomerRequest,
  serializeUpdateCustomerRequest,
  type CreateCustomerRequest,
  type Customer,
  type CustomerCreditOffersListParams,
  type CustomerListParams,
  type CustomerWire,
  type UpdateCustomerRequest,
} from '../types/customer.js';

/** Path of the customers collection. */
const CUSTOMERS_PATH = '/v3/customers';

/** Path of a single customer (sub-paths hang off this). */
function customerPath(id: string): string {
  return `${CUSTOMERS_PATH}/${encodeURIComponent(id)}`;
}

/**
 * The customers resource, composed onto `client.customers` by `Dinie` (architecture §6).
 * Holds the injected {@link HttpClient}; the camelCase ↔ snake_case bridge is delegated to the
 * generated serializers (story 002). Methods are alphabetical.
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

  /**
   * Create a biometrics capture session for a customer. `POST /v3/customers/{id}/biometrics`
   * (idempotent). The contract defines NO request body, so `params` is a forward-compat
   * placeholder and is never sent (see `../types/biometrics.ts`). The D#6 webview helper calls
   * this with just the id.
   */
  async createBiometricsSession(
    id: string,
    params?: CreateBiometricsSessionParams,
    options?: RequestOptions,
  ): Promise<BiometricsSession> {
    void params; // no request body in the contract — kept for signature uniformity (§7.2)
    const wire = await this.#http.request<BiometricsSessionWire>({
      method: 'POST',
      path: `${customerPath(id)}/biometrics`,
      idempotent: true,
      ...(options !== undefined ? { options } : {}),
    });
    return deserializeBiometricsSession(wire);
  }

  /** Retrieve a customer by id. `GET /v3/customers/{id}`. */
  async get(id: string, options?: RequestOptions): Promise<Customer> {
    const wire = await this.#http.request<CustomerWire>({
      method: 'GET',
      path: customerPath(id),
      idempotent: false,
      ...(options !== undefined ? { options } : {}),
    });
    return deserializeCustomer(wire);
  }

  /** Retrieve the customer's linked bank account. `GET /v3/customers/{id}/bank-account`. */
  async getBankAccount(id: string, options?: RequestOptions): Promise<CustomerBankAccount> {
    const wire = await this.#http.request<CustomerBankAccountWire>({
      method: 'GET',
      path: `${customerPath(id)}/bank-account`,
      idempotent: false,
      ...(options !== undefined ? { options } : {}),
    });
    return deserializeCustomerBankAccount(wire);
  }

  /**
   * List customers, auto-paginated. Returns a {@link PagePromise} (D7/D15): `await` it for the
   * first {@link import('../../runtime/paginator.js').Page}, `for await` over it to stream
   * every customer across every page, or `.withResponse()` for the first page's HTTP response.
   *
   * The paginator drives the cursor: it calls `fetchPage()` for the first page and
   * `fetchPage(lastId)` thereafter; this resource maps that cursor to the wire `starting_after`
   * query param and deserializes each wire item. An explicit `params.startingAfter` seeds the
   * first page.
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

  /**
   * List a customer's credit offers, auto-paginated. `GET /v3/customers/{id}/credit-offers`.
   * Returns a {@link PagePromise}<{@link CreditOffer}> with the same dual nature as
   * {@link list}. `params.status` filters by offer status; `params.limit`/`startingAfter` and
   * the paginator cursor drive pagination. The `CreditOffer` type is hoisted to story 002.
   */
  listCreditOffers(
    id: string,
    params?: CustomerCreditOffersListParams,
    options?: RequestOptions,
  ): PagePromise<CreditOffer> {
    const fetchPage: FetchPage<CreditOffer> = (cursor) => {
      const startingAfter = cursor ?? params?.startingAfter;
      return this.#http
        .requestPage<CreditOfferWire>({
          method: 'GET',
          path: `${customerPath(id)}/credit-offers`,
          query: {
            ...(params?.limit !== undefined ? { limit: params.limit } : {}),
            ...(params?.status !== undefined ? { status: params.status } : {}),
            ...(startingAfter !== undefined ? { starting_after: startingAfter } : {}),
          },
          idempotent: false,
          ...(options !== undefined ? { options } : {}),
        })
        ._thenUnwrap(toCreditOfferPage);
    };
    return new PagePromise<CreditOffer>(fetchPage);
  }

  /**
   * Update a customer's contact fields. `PATCH /v3/customers/{id}` (idempotent). Only the keys
   * the caller set are sent (PATCH semantics); the wire response is the full updated customer.
   */
  async update(
    id: string,
    params: UpdateCustomerRequest,
    options?: RequestOptions,
  ): Promise<Customer> {
    const wire = await this.#http.request<CustomerWire>({
      method: 'PATCH',
      path: customerPath(id),
      body: serializeUpdateCustomerRequest(params),
      idempotent: true,
      ...(options !== undefined ? { options } : {}),
    });
    return deserializeCustomer(wire);
  }

  /**
   * Create or update the customer's disbursement bank account. `POST
   * /v3/customers/{id}/bank-account` (idempotent). The contract wraps the request under a
   * `bank_account` envelope, applied here; the per-schema serializer emits the bare account.
   */
  async upsertBankAccount(
    id: string,
    params: CustomerBankAccountRequest,
    options?: RequestOptions,
  ): Promise<CustomerBankAccount> {
    const wire = await this.#http.request<CustomerBankAccountWire>({
      method: 'POST',
      path: `${customerPath(id)}/bank-account`,
      body: { bank_account: serializeCustomerBankAccountRequest(params) },
      idempotent: true,
      ...(options !== undefined ? { options } : {}),
    });
    return deserializeCustomerBankAccount(wire);
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

/** Map a wire list envelope to one of deserialized {@link CreditOffer}s (preserving `has_more`). */
function toCreditOfferPage(wire: ListEnvelope<CreditOfferWire>): ListEnvelope<CreditOffer> {
  return {
    object: 'list',
    data: wire.data.map(deserializeCreditOffer),
    has_more: wire.has_more,
  };
}
