/**
 * `Customers` resource — the full customers surface (architecture §3.1, §6, §7.1).
 * Hand-authored in V0.2 to mirror future generator output (D1); V0.4 overwrites it. V0.1
 * sketched `create`/`get`/`list`; story 002 re-wired those onto the generated (de)serializer
 * convention; story 003 added the 8 non-KYC methods; story 004 added the two KYC methods.
 * Story 014 applied the canonical naming refactor (`get`→`retrieve`) and moved the two
 * COLLECTION sub-resources (`credit-offers`, `kyc-attachments`) into nested namespaces.
 *
 * ── Naming convention (principles.md §1 — canonical CRUD verbs) ──
 * The canonical CRUD verb set is `create / retrieve / update / list / delete`. `GET /x/{id}`
 * surfaces as `retrieve` (market alignment: OpenAI/Stripe/Anthropic), NOT `get`. Each method
 * name is the openapi `operationId` with the resource noun stripped, then mapped to its
 * canonical verb:
 *   getCustomer/createCustomer/listCustomers/updateCustomer → retrieve/create/list/update
 *   getCustomerBankAccount    → retrieveBankAccount   (strip `Customer`, `get`→`retrieve`)
 *   upsertCustomerBankAccount → upsertBankAccount      (strip `Customer`; non-CRUD verb kept)
 *   createBiometricsSession   → createBiometricsSession (no resource noun to strip)
 *
 * ── Resource hierarchy (principles.md §2 — singleton flat / collection nested) ──
 * A SINGLETON sub-path (≤1 per parent: `bank-account`, `biometrics`, `kyc-review`) stays a
 * FLAT method on the parent. A COLLECTION sub-path (0..N per parent: `credit-offers`,
 * `kyc-attachments`) becomes a NESTED namespace (mirrors OpenAI's `client.beta.threads.*`):
 *   customers.creditOffers.list(customerId, params?)   (was customers.listCreditOffers)
 *   customers.kycAttachments.create(customerId, params) (was customers.uploadKycAttachment —
 *                                                         renamed `upload`→`create` per CRUD)
 *
 * ── The 8 flat methods (alphabetical — minimal diff for the V0.4 generator) ──
 *   create                  POST   /customers
 *   createBiometricsSession POST   /customers/{id}/biometrics       (no request body)
 *   list                    GET    /customers                       → PagePromise
 *   retrieve                GET    /customers/{id}
 *   retrieveBankAccount     GET    /customers/{id}/bank-account      (singleton)
 *   startKycReview          POST   /customers/{id}/kyc-review        (202, no body → void)
 *   update                  PATCH  /customers/{id}
 *   upsertBankAccount       POST   /customers/{id}/bank-account      (singleton)
 *
 * ── The 2 nested collections ──
 *   creditOffers.list       GET    /customers/{id}/credit-offers     → PagePromise
 *   kycAttachments.create   POST   /customers/{id}/kyc-attachments   (multipart — see runtime gap)
 *
 * ── Sub-paths (D3): the parent id is the 1st positional arg ──
 * A path like `POST /customers/{id}/bank-account` becomes `upsertBankAccount(id, params, opts?)`
 * — the `{customer_id}` segment is the leading `id` argument, `encodeURIComponent`-escaped. The
 * nested-collection methods thread the same `{customer_id}` as their first positional arg.
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
 * The `HttpClient` is injected by `client.ts`; this class never builds one. The nested
 * namespaces receive the SAME injected `HttpClient`.
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
import {
  deserializeKycAttachmentResponse,
  kycUploadToFormData,
  serializeKycUpload,
  type KycAttachmentResponse,
  type KycAttachmentResponseWire,
  type KycUpload,
} from '../types/kyc/index.js';

/** Path of the customers collection. */
const CUSTOMERS_PATH = '/customers';

/** Path of a single customer (sub-paths hang off this). */
function customerPath(id: string): string {
  return `${CUSTOMERS_PATH}/${encodeURIComponent(id)}`;
}

/**
 * The customers resource, composed onto `client.customers` by `Dinie` (architecture §6).
 * Holds the injected {@link HttpClient}; the camelCase ↔ snake_case bridge is delegated to the
 * generated serializers (story 002). Flat methods are alphabetical; the two collection
 * sub-resources hang off the nested {@link CustomersCreditOffers}/{@link CustomersKycAttachments}
 * namespaces.
 */
export class Customers {
  readonly #http: HttpClient;

  /** A customer's credit offers (collection → nested namespace). `customers.creditOffers.list(id)`. */
  readonly creditOffers: CustomersCreditOffers;

  /** A customer's KYC attachments (collection → nested namespace). `customers.kycAttachments.create(id, …)`. */
  readonly kycAttachments: CustomersKycAttachments;

  constructor(http: HttpClient) {
    this.#http = http;
    this.creditOffers = new CustomersCreditOffers(http);
    this.kycAttachments = new CustomersKycAttachments(http);
  }

  /**
   * Create a customer. `POST /customers` (idempotent — the runtime mints a stable
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
   * Create a biometrics capture session for a customer. `POST /customers/{id}/biometrics`
   * (idempotent). A SINGLETON sub-path (≤1 session per customer) → flat method. The contract
   * defines NO request body, so `params` is a forward-compat placeholder and is never sent (see
   * `../types/biometrics.ts`). The D#6 webview helper calls this with just the id.
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

  /** Retrieve a customer by id. `GET /customers/{id}`. */
  async retrieve(id: string, options?: RequestOptions): Promise<Customer> {
    const wire = await this.#http.request<CustomerWire>({
      method: 'GET',
      path: customerPath(id),
      idempotent: false,
      ...(options !== undefined ? { options } : {}),
    });
    return deserializeCustomer(wire);
  }

  /**
   * Retrieve the customer's linked bank account. `GET /customers/{id}/bank-account`. A
   * SINGLETON sub-path (≤1 account per customer) → flat method.
   */
  async retrieveBankAccount(id: string, options?: RequestOptions): Promise<CustomerBankAccount> {
    const wire = await this.#http.request<CustomerBankAccountWire>({
      method: 'GET',
      path: `${customerPath(id)}/bank-account`,
      idempotent: false,
      ...(options !== undefined ? { options } : {}),
    });
    return deserializeCustomerBankAccount(wire);
  }

  /**
   * Submit the customer's uploaded KYC documents for review. `POST /customers/{id}/kyc-review`
   * (idempotent). Signals that all documents are uploaded and ready for the verification
   * pipeline; also re-submits after corrections.
   *
   * Returns `void`: the contract replies `202 Accepted` with NO body (openapi SoT @3fcfd83).
   * The architecture §3.1 hinted at a possible `Customer` body, but the contract is
   * authoritative (D2) — confirmed `202`/empty. The endpoint is `x-internal` in the openapi
   * (driven by the KYC app flow) yet part of the frozen reference surface (architecture §3.1).
   */
  async startKycReview(id: string, options?: RequestOptions): Promise<void> {
    await this.#http.request<void>({
      method: 'POST',
      path: `${customerPath(id)}/kyc-review`,
      idempotent: true,
      ...(options !== undefined ? { options } : {}),
    });
  }

  /**
   * Update a customer's contact fields. `PATCH /customers/{id}` (idempotent). Only the keys
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
   * /customers/{id}/bank-account` (idempotent). A SINGLETON sub-path → flat method. The
   * contract wraps the request under a `bank_account` envelope, applied here; the per-schema
   * serializer emits the bare account.
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

/**
 * Nested namespace for a customer's credit offers (`client.customers.creditOffers`). A COLLECTION
 * sub-resource (0..N offers per customer) → nested namespace (principles.md §2), mirroring
 * OpenAI's `client.beta.threads.messages`. Holds the SAME injected {@link HttpClient} as its
 * parent {@link Customers}.
 */
export class CustomersCreditOffers {
  readonly #http: HttpClient;

  constructor(http: HttpClient) {
    this.#http = http;
  }

  /**
   * List a customer's credit offers, auto-paginated. `GET /customers/{id}/credit-offers`.
   * Returns a {@link PagePromise}<{@link CreditOffer}> with the same dual nature as
   * {@link Customers.list}. `customerId` is the parent id (1st positional arg); `params.status`
   * filters by offer status; `params.limit`/`startingAfter` and the paginator cursor drive
   * pagination.
   */
  list(
    customerId: string,
    params?: CustomerCreditOffersListParams,
    options?: RequestOptions,
  ): PagePromise<CreditOffer> {
    const fetchPage: FetchPage<CreditOffer> = (cursor) => {
      const startingAfter = cursor ?? params?.startingAfter;
      return this.#http
        .requestPage<CreditOfferWire>({
          method: 'GET',
          path: `${customerPath(customerId)}/credit-offers`,
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
}

/**
 * Nested namespace for a customer's KYC attachments (`client.customers.kycAttachments`). A
 * COLLECTION sub-resource (0..N attachments per customer) → nested namespace (principles.md §2).
 * Holds the SAME injected {@link HttpClient} as its parent {@link Customers}.
 */
export class CustomersKycAttachments {
  readonly #http: HttpClient;

  constructor(http: HttpClient) {
    this.#http = http;
  }

  /**
   * Upload a KYC attachment for a customer. `POST /customers/{id}/kyc-attachments`
   * (idempotent). The canonical CRUD verb is `create` (the openapi `uploadKycAttachment` op
   * surfaces as `kycAttachments.create`). `customerId` is the parent id (1st positional arg);
   * `params` is the {@link KycUpload} discriminated union (10 document/data variants):
   * `serializeKycUpload` dispatches on `evidenceType` to the correct multipart field set, and
   * `kycUploadToFormData` frames it as `multipart/form-data`. Returns the post-upload
   * {@link KycAttachmentResponse} (the full requirement state, deserialized via the discriminated
   * `deserializeKycRequirement`).
   *
   * ⚠️ RUNTIME GAP (tracked, not fixed here): the frozen JSON-only runtime
   * (`runtime/http.ts → serializeBody`) does not yet pass a `FormData` body through, so the
   * multipart body is not wire-encoded this round (see `../types/kyc/uploads.ts`). The
   * serialization (per-variant field map) is fully covered by the KYC tests + conformance
   * (story 008), independent of transport; the single runtime follow-up makes uploads encode on
   * the wire with no change to this method.
   */
  async create(
    customerId: string,
    params: KycUpload,
    options?: RequestOptions,
  ): Promise<KycAttachmentResponse> {
    const wire = await this.#http.request<KycAttachmentResponseWire>({
      method: 'POST',
      path: `${customerPath(customerId)}/kyc-attachments`,
      body: kycUploadToFormData(serializeKycUpload(params)),
      idempotent: true,
      ...(options !== undefined ? { options } : {}),
    });
    return deserializeKycAttachmentResponse(wire);
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
