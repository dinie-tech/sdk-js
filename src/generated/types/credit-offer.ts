/**
 * `CreditOffer` types (architecture §3.4, §3.5, §4 R10). Hand-authored in V0.2 to mirror
 * what the generator will emit from `components.schemas.CreditOffer` (V0.4 overwrites in
 * place — D1). Follows the serializer convention defined in `customer.ts` (the exemplar):
 * read-only model → deserializer only, no `serializeCreditOffer` — credit offers are minted
 * by the Core (`credit_offer.available` webhook), never POSTed by the partner, so there is
 * NO `POST /credit-offers` and NO create request (R10).
 *
 * ── Hoisted to foundational on purpose ──
 * `CreditOffer` is referenced by THREE later stories: `customers.listCreditOffers` (003),
 * the `creditOffers` resource (005), and the `credit_offer.*` webhook events (007). Defining
 * it here lets 003 and 005 stay parallelizable without cross-importing each other.
 *
 * ── Field map (openapi `components.schemas.CreditOffer` @ 3fcfd83) ──
 *   wire (snake_case)      → model (camelCase)     → type
 *   id                     → id                    → CreditOfferId (`co_…`)
 *   customer_id            → customerId            → CustomerId
 *   external_id            → externalId            → string?            (optional)
 *   status                 → status                → CreditOfferStatus (enum)
 *   approved_amount        → approvedAmount        → Money
 *   min_amount             → minAmount             → number
 *   monthly_interest_rate  → monthlyInterestRate   → number
 *   installments           → installments          → number?           (see XOR note)
 *   min_installments       → minInstallments       → number?           (see XOR note)
 *   max_installments       → maxInstallments       → number?           (see XOR note)
 *   due_date_rule          → dueDateRule           → string | null ?   (optional, nullable)
 *   valid_until            → validUntil            → number (epoch seconds)
 *   created_at             → createdAt             → number (epoch seconds)
 *   updated_at             → updatedAt             → number (epoch seconds)
 *
 * ── installments XOR (architecture §3.5) ──
 * The product is EITHER fixed-count (`installments`) XOR a range (`min_installments` +
 * `max_installments`). A generator cannot infer mutual exclusivity from prose, so all three
 * are typed **optional** and the exclusivity is documented, not enforced by the type.
 * ⚠️ Contract note: openapi lists `installments` in `CreditOffer.required`, which contradicts
 * its own "Present when the product has a fixed installment count … Mutually exclusive with
 * min/max" description (a range offer omits it). The architecture §3.5 decision — three
 * optional — wins here; flagged upstream so story 005/008 (conformance) handle range offers
 * and the contract inconsistency is tracked.
 *
 * ── runtime ↔ generated boundary ──
 * Lives in `generated/`. Imports only sibling generated types (`./ids.js`, `./money.js`) —
 * never `runtime/`. Model type is public surface (generated barrel + `src/index.ts`); the
 * `*Wire` type + `deserializeCreditOffer` are consumed by resources/events/conformance via
 * direct import.
 */

import type { CreditOfferId, CustomerId } from './ids.js';
import type { Money } from './money.js';

/** Credit-offer lifecycle status (openapi enum). */
export type CreditOfferStatus = 'available' | 'accepted' | 'expired';

/** A pre-approved credit offer for a customer (`co_…`) — read-only (R10). */
export interface CreditOffer {
  /** Stable id, `co_…`. */
  id: CreditOfferId;
  /** Owning customer. Wire: `customer_id`. */
  customerId: CustomerId;
  /** Partner reference for the customer this offer belongs to. Wire: `external_id`. */
  externalId?: string;
  /** Offer status. */
  status: CreditOfferStatus;
  /** Approved credit amount, BRL. Wire: `approved_amount`. */
  approvedAmount: Money;
  /** Minimum withdrawal amount, BRL. Wire: `min_amount`. */
  minAmount: number;
  /** Monthly interest rate, percent. Wire: `monthly_interest_rate`. */
  monthlyInterestRate: number;
  /** Fixed installment count. Mutually exclusive with min/max (see XOR note). */
  installments?: number;
  /** Minimum installments for a range product. Wire: `min_installments`. */
  minInstallments?: number;
  /** Maximum installments for a range product. Wire: `max_installments`. */
  maxInstallments?: number;
  /** Due-date rule for installments (pending Core), or `null`. Wire: `due_date_rule`. */
  dueDateRule?: string | null;
  /** Offer expiration, epoch seconds. Wire: `valid_until`. */
  validUntil: number;
  /** Creation instant, epoch seconds. Wire: `created_at`. */
  createdAt: number;
  /** Last-modified instant, epoch seconds. Wire: `updated_at`. */
  updatedAt: number;
}

/** Snake_case wire mirror of {@link CreditOffer}. Decoded by {@link deserializeCreditOffer}. */
export interface CreditOfferWire {
  id: string;
  customer_id: string;
  external_id?: string;
  status: CreditOfferStatus;
  approved_amount: Money;
  min_amount: number;
  monthly_interest_rate: number;
  installments?: number;
  min_installments?: number;
  max_installments?: number;
  due_date_rule?: string | null;
  valid_until: number;
  created_at: number;
  updated_at: number;
}

/**
 * Decode a wire credit offer (snake_case) into a {@link CreditOffer} (camelCase). Explicit,
 * alphabetical, epoch-preserving (the four rules in `customer.ts`). The optional
 * installment fields and `due_date_rule` are omitted when absent (R-OPTIONAL).
 */
export function deserializeCreditOffer(raw: CreditOfferWire): CreditOffer {
  return {
    approvedAmount: raw.approved_amount,
    createdAt: raw.created_at,
    customerId: raw.customer_id,
    ...(raw.due_date_rule !== undefined ? { dueDateRule: raw.due_date_rule } : {}),
    ...(raw.external_id !== undefined ? { externalId: raw.external_id } : {}),
    id: raw.id,
    ...(raw.installments !== undefined ? { installments: raw.installments } : {}),
    ...(raw.max_installments !== undefined ? { maxInstallments: raw.max_installments } : {}),
    minAmount: raw.min_amount,
    ...(raw.min_installments !== undefined ? { minInstallments: raw.min_installments } : {}),
    monthlyInterestRate: raw.monthly_interest_rate,
    status: raw.status,
    updatedAt: raw.updated_at,
    validUntil: raw.valid_until,
  };
}
