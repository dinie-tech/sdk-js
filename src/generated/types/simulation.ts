/**
 * `Simulation` types — the request + result of a loan simulation (architecture §3.4, §12,
 * §15.2). Hand-authored in V0.2 to mirror what the generator will emit from the V3 OpenAPI
 * `CreateSimulationRequest`/`Simulation` schemas (V0.4 overwrites this file in place — D1).
 * Follows the serializer convention defined in `customer.ts` (the exemplar): the request body
 * gets a `serialize*`; the read-only result gets a `deserialize*`.
 *
 * ── The four rules (see `customer.ts` header) ──
 *   R-EXPLICIT  field-by-field mapping, never reflective key-casing.
 *   R-ORDER     output keys alphabetical by the *target* name (minimal V0.4 generator diff).
 *   R-OPTIONAL  absent optional omitted; required-but-nullable always present as `T | null`.
 *   R-EPOCH     integer epoch-second timestamps stay `number` (never `Date`).
 *
 * ── Field map — `CreateSimulationRequest` (request body of createSimulation) ──
 *   wire (snake_case)   → model (camelCase)   → type
 *   requested_amount    → requestedAmount     → number   (BRL, required)
 *   installment_count   → installmentCount    → number   (integer ≥ 1, required)
 *
 * ── Field map — `Simulation` (read-only result; every field required, none nullable) ──
 *   wire (snake_case)       → model (camelCase)      → type
 *   id                      → id                      → SimulationId (`sim_…`)
 *   credit_offer_id         → creditOfferId           → CreditOfferId (`co_…`)
 *   requested_amount        → requestedAmount         → number
 *   principal_amount        → principalAmount         → number
 *   interest_amount         → interestAmount          → number
 *   iof_amount              → iofAmount               → number
 *   fee_amount              → feeAmount               → number
 *   total_amount            → totalAmount             → number
 *   monthly_interest_rate   → monthlyInterestRate     → number
 *   annual_interest_rate    → annualInterestRate      → number
 *   monthly_cet_rate        → monthlyCetRate          → number
 *   annual_cet_rate         → annualCetRate           → number
 *   installment_count       → installmentCount        → number (integer)
 *   installment_amount      → installmentAmount       → number
 *   first_due_date          → firstDueDate            → string (ISO `date`, NOT epoch)
 *   created_at              → createdAt               → number (epoch seconds, R-EPOCH)
 *
 * ── `first_due_date` is a `date` string, not a timestamp ──
 * The contract types `first_due_date` as `format: date` (`'2026-04-03'`), so it surfaces as a
 * `string` — R-EPOCH does NOT apply (R-EPOCH covers integer epoch-second timestamps like
 * `created_at`). The deterministic rule: wire `format: date` → `string`; `type: integer,
 * format: int64` (a `*_at` instant) → `number`. Flagged for `principles.md` (story 009) and
 * conformance (story 008).
 *
 * ── Money typing follows the contract verbatim ──
 * Every amount here is an inline `type: number, format: double` in the schema (NOT a `$ref`
 * to `Money`), so it surfaces as `number` — same deterministic rule `credit-offer.ts` used for
 * `min_amount`. (`Loan`/`Transaction` use `$ref Money` for some fields and surface `Money`.)
 *
 * ── runtime ↔ generated boundary ──
 * Lives in `generated/`. Imports only sibling generated id types (`./ids.js`) — never
 * `runtime/`. The model + request types are public surface (generated barrel + `src/index.ts`);
 * the `*Wire` types and the (de)serializers are consumed by the `creditOffers` resource (and the
 * conformance harness — story 008) via direct import.
 */

import type { CreditOfferId, SimulationId } from './ids.js';

/** Body of `creditOffers.createSimulation` — `{ requestedAmount, installmentCount }`. */
export interface CreateSimulationRequest {
  /** Loan amount requested by the partner, BRL (required). Wire: `requested_amount`. */
  requestedAmount: number;
  /** Number of installments to simulate (integer ≥ 1, required). Wire: `installment_count`. */
  installmentCount: number;
}

/** Snake_case wire mirror of {@link CreateSimulationRequest}. Built by {@link serializeCreateSimulationRequest}. */
export interface CreateSimulationRequestWire {
  requested_amount: number;
  installment_count: number;
}

/** The calculated result of a loan simulation (`sim_…`) — read-only (no request body). */
export interface Simulation {
  /** Stable id, `sim_…`. */
  id: SimulationId;
  /** Owning credit offer. Wire: `credit_offer_id`. */
  creditOfferId: CreditOfferId;
  /** Amount requested by the partner, BRL. Wire: `requested_amount`. */
  requestedAmount: number;
  /** Principal (requested amount + financed fees). Wire: `principal_amount`. */
  principalAmount: number;
  /** Total interest amount. Wire: `interest_amount`. */
  interestAmount: number;
  /** IOF tax amount. Wire: `iof_amount`. */
  iofAmount: number;
  /** Fee amount (TC — Taxa de Cadastro). Wire: `fee_amount`. */
  feeAmount: number;
  /** Total amount (sum of all installments). Wire: `total_amount`. */
  totalAmount: number;
  /** Monthly interest rate, percent. Wire: `monthly_interest_rate`. */
  monthlyInterestRate: number;
  /** Annual interest rate, percent (compounded from monthly). Wire: `annual_interest_rate`. */
  annualInterestRate: number;
  /** Monthly total effective cost (CET), percent. Wire: `monthly_cet_rate`. */
  monthlyCetRate: number;
  /** Annual total effective cost (CET), percent. Wire: `annual_cet_rate`. */
  annualCetRate: number;
  /** Number of installments. Wire: `installment_count`. */
  installmentCount: number;
  /** Installment amount, BRL. Wire: `installment_amount`. */
  installmentAmount: number;
  /** First installment due date, ISO `date` string (NOT epoch). Wire: `first_due_date`. */
  firstDueDate: string;
  /** Creation instant, epoch seconds (R-EPOCH). Wire: `created_at`. */
  createdAt: number;
}

/** Snake_case wire mirror of {@link Simulation}. Decoded by {@link deserializeSimulation}. */
export interface SimulationWire {
  id: string;
  credit_offer_id: string;
  requested_amount: number;
  principal_amount: number;
  interest_amount: number;
  iof_amount: number;
  fee_amount: number;
  total_amount: number;
  monthly_interest_rate: number;
  annual_interest_rate: number;
  monthly_cet_rate: number;
  annual_cet_rate: number;
  installment_count: number;
  installment_amount: number;
  first_due_date: string;
  created_at: number;
}

/**
 * Encode a {@link CreateSimulationRequest} (camelCase) into its wire body (snake_case).
 * Both fields are required, so there are no optional spreads. Alphabetical by target key.
 */
export function serializeCreateSimulationRequest(
  params: CreateSimulationRequest,
): CreateSimulationRequestWire {
  return {
    installment_count: params.installmentCount,
    requested_amount: params.requestedAmount,
  };
}

/**
 * Decode a wire simulation (snake_case) into a {@link Simulation} (camelCase). Explicit,
 * alphabetical, epoch-preserving — see the four rules in `customer.ts`. Every field is
 * required and non-nullable, so there are no optional spreads; `firstDueDate` is copied as a
 * `date` string (not converted to epoch).
 */
export function deserializeSimulation(raw: SimulationWire): Simulation {
  return {
    annualCetRate: raw.annual_cet_rate,
    annualInterestRate: raw.annual_interest_rate,
    createdAt: raw.created_at,
    creditOfferId: raw.credit_offer_id,
    feeAmount: raw.fee_amount,
    firstDueDate: raw.first_due_date,
    id: raw.id,
    installmentAmount: raw.installment_amount,
    installmentCount: raw.installment_count,
    interestAmount: raw.interest_amount,
    iofAmount: raw.iof_amount,
    monthlyCetRate: raw.monthly_cet_rate,
    monthlyInterestRate: raw.monthly_interest_rate,
    principalAmount: raw.principal_amount,
    requestedAmount: raw.requested_amount,
    totalAmount: raw.total_amount,
  };
}
