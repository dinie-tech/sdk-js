/**
 * `CreditOffers` resource — offers + simulations (architecture §3.1, §7.1, §12, §15.2).
 * Hand-authored in V0.2 to mirror future generator output (D1); V0.4 overwrites it. A mechanical
 * copy of the `customers.ts` convention (story 003): inject the {@link HttpClient}, delegate the
 * camelCase ↔ snake_case bridge to the per-type generated serializers, methods alphabetical.
 *
 * ── The 3 methods (alphabetical — minimal diff for the V0.4 generator) ──
 *   createSimulation   POST   /credit-offers/{id}/simulations   → Simulation (201, idempotent)
 *   list               GET    /credit-offers                    → PagePromise<CreditOffer>
 *   retrieve           GET    /credit-offers/{id}               → CreditOffer
 *
 * ── NO `create` (R10) ──
 * There is NO `POST /credit-offers`: offers are minted by the Core (the `credit_offer.available`
 * webhook), never POSTed by the partner. The V0.2 version-spec demo's `creditOffers.create` is
 * illustrative and does NOT belong on the frozen surface — the offer arrives via webhook/listing.
 *
 * ── Naming convention (principles.md §1 — strip the resource noun, canonical CRUD verbs) ──
 *   listCreditOffers → list      (strip `CreditOffers`)
 *   getCreditOffer   → retrieve  (strip `CreditOffer`, `get`→`retrieve`)
 *   createSimulation → createSimulation  (no resource noun to strip; non-CRUD verb kept)
 *
 * ── Sub-path (D3): the parent id is the 1st positional arg ──
 * `POST /credit-offers/{id}/simulations` becomes `createSimulation(id, params, opts?)` — the
 * `{credit_offer_id}` segment is the leading `id`, `encodeURIComponent`-escaped.
 *
 * ── runtime ↔ generated boundary ──
 * Lives in `generated/`. Imports ONLY from `runtime/` (`HttpClient`, `RequestOptions`,
 * `PagePromise`/`FetchPage`, `ListEnvelope`) plus sibling generated types — never the reverse.
 * The `HttpClient` is injected by `client.ts`; this class never builds one.
 */

import type { HttpClient, ListEnvelope, RequestOptions } from '../../runtime/http.js';
import { PagePromise, type FetchPage } from '../../runtime/paginator.js';
import {
  deserializeCreditOffer,
  type CreditOffer,
  type CreditOffersListParams,
  type CreditOfferWire,
} from '../types/credit-offer.js';
import {
  deserializeSimulation,
  serializeCreateSimulationRequest,
  type CreateSimulationRequest,
  type Simulation,
  type SimulationWire,
} from '../types/simulation.js';

/** Path of the credit-offers collection. */
const CREDIT_OFFERS_PATH = '/credit-offers';

/** Path of a single credit offer (sub-paths hang off this). */
function creditOfferPath(id: string): string {
  return `${CREDIT_OFFERS_PATH}/${encodeURIComponent(id)}`;
}

/**
 * The credit-offers resource, composed onto `client.creditOffers` by `Dinie` (architecture §6).
 * Holds the injected {@link HttpClient}; the casing bridge is delegated to the generated
 * serializers (story 002). Methods are alphabetical.
 */
export class CreditOffers {
  readonly #http: HttpClient;

  constructor(http: HttpClient) {
    this.#http = http;
  }

  /**
   * Simulate a loan against an offer. `POST /credit-offers/{id}/simulations` (idempotent — the
   * runtime mints a stable `X-Idempotency-Key` reused across retries). The camelCase request is
   * serialized to the wire body and the wire response (201) deserialized to a {@link Simulation}
   * (principal, IOF, CET, installment value — feeds the §12 Customer→Offer→Loan flow).
   */
  async createSimulation(
    id: string,
    params: CreateSimulationRequest,
    options?: RequestOptions,
  ): Promise<Simulation> {
    const wire = await this.#http.request<SimulationWire>({
      method: 'POST',
      path: `${creditOfferPath(id)}/simulations`,
      body: serializeCreateSimulationRequest(params),
      idempotent: true,
      ...(options !== undefined ? { options } : {}),
    });
    return deserializeSimulation(wire);
  }

  /**
   * List credit offers across customers, auto-paginated. Returns a {@link PagePromise} (D7/D15):
   * `await` it for the first {@link import('../../runtime/paginator.js').Page}, `for await` over
   * it to stream every offer across every page, or `.withResponse()` for the first page's HTTP
   * response. `params.customerId`/`params.status` filter; `params.limit`/`startingAfter` and the
   * paginator cursor drive pagination (mapped to the wire `customer_id`/`status`/`starting_after`
   * query params).
   */
  list(params?: CreditOffersListParams, options?: RequestOptions): PagePromise<CreditOffer> {
    const fetchPage: FetchPage<CreditOffer> = (cursor) => {
      const startingAfter = cursor ?? params?.startingAfter;
      return this.#http
        .requestPage<CreditOfferWire>({
          method: 'GET',
          path: CREDIT_OFFERS_PATH,
          query: {
            ...(params?.limit !== undefined ? { limit: params.limit } : {}),
            ...(params?.customerId !== undefined ? { customer_id: params.customerId } : {}),
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

  /** Retrieve a credit offer by id. `GET /credit-offers/{id}`. */
  async retrieve(id: string, options?: RequestOptions): Promise<CreditOffer> {
    const wire = await this.#http.request<CreditOfferWire>({
      method: 'GET',
      path: creditOfferPath(id),
      idempotent: false,
      ...(options !== undefined ? { options } : {}),
    });
    return deserializeCreditOffer(wire);
  }
}

/** Map a wire list envelope to one of deserialized {@link CreditOffer}s (preserving `has_more`). */
function toCreditOfferPage(wire: ListEnvelope<CreditOfferWire>): ListEnvelope<CreditOffer> {
  return {
    object: 'list',
    data: wire.data.map(deserializeCreditOffer),
    has_more: wire.has_more,
  };
}
