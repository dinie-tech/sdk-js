/**
 * `Loan` types — the request to create a loan + the full loan model (architecture §3.4, §12,
 * §15.2). Hand-authored in V0.2 to mirror what the generator will emit from the V3 OpenAPI
 * `CreateLoanRequest`/`Loan` schemas (V0.4 overwrites this file in place — D1). Follows the
 * serializer convention defined in `customer.ts` (the exemplar): the request body gets a
 * `serialize*`; the read-only model gets a `deserialize*`.
 *
 * ── The four rules (see `customer.ts` header) ──
 *   R-EXPLICIT  field-by-field mapping, never reflective key-casing.
 *   R-ORDER     output keys alphabetical by the *target* name (minimal V0.4 generator diff).
 *   R-OPTIONAL  absent optional omitted; required-but-nullable always present as `T | null`.
 *   R-EPOCH     integer epoch-second timestamps stay `number` (never `Date`).
 *
 * ── `CreateLoanRequest` shape (contract-confirmed @ 3fcfd83 — resolves the story's open Q) ──
 * The request is NOT just a credit-offer id: the partner first runs `createSimulation`, then
 * passes the chosen simulation back. All five fields are required:
 *   wire (snake_case)   → model (camelCase)   → type
 *   credit_offer_id     → creditOfferId       → CreditOfferId   (the offer being accepted)
 *   simulation_id       → simulationId        → SimulationId    (the accepted simulation)
 *   installment_count   → installmentCount    → number          (echoed from the simulation)
 *   installment_amount  → installmentAmount   → number          (echoed from the simulation)
 *   first_due_date      → firstDueDate        → string (ISO `date`, NOT epoch)
 *
 * ── Field map — `Loan` (read model; every field in `required`, several nullable) ──
 *   wire (snake_case)       → model (camelCase)      → type
 *   id                      → id                      → LoanId (`ln_…`)
 *   credit_offer_id         → creditOfferId           → CreditOfferId
 *   customer_id             → customerId              → CustomerId
 *   simulation_id           → simulationId            → SimulationId
 *   status                  → status                  → LoanStatus (enum)
 *   requested_amount        → requestedAmount         → Money        ($ref Money)
 *   principal_amount        → principalAmount         → number | null (null until calculated)
 *   iof_amount              → iofAmount               → number | null
 *   monthly_interest_rate   → monthlyInterestRate     → number
 *   annual_interest_rate    → annualInterestRate      → number
 *   monthly_cet_rate        → monthlyCetRate          → number
 *   annual_cet_rate         → annualCetRate           → number
 *   total_amount            → totalAmount             → Money        ($ref Money)
 *   installment_count       → installmentCount        → number (integer)
 *   installment_amount      → installmentAmount       → number
 *   first_due_date          → firstDueDate            → string (ISO `date`, NOT epoch)
 *   ccb_number              → ccbNumber               → string | null (null until generated)
 *   disbursement_method     → disbursementMethod      → string | null (null until disbursement)
 *   signing_url             → signingUrl              → string | null (only during awaiting_signatures)
 *   created_at              → createdAt               → number (epoch seconds, R-EPOCH)
 *   updated_at              → updatedAt               → number (epoch seconds, R-EPOCH)
 *
 * Five fields are `type: [T, 'null']` (required-but-nullable): `principalAmount`, `iofAmount`,
 * `ccbNumber`, `disbursementMethod`, `signingUrl`. Per R-OPTIONAL they are ALWAYS present and
 * carried as `T | null` (not made optional). `firstDueDate` is a `date` string, not epoch (same
 * rule as `simulation.ts`). Money typing follows the contract: `$ref Money` → `Money`,
 * inline `number` → `number`.
 *
 * ── runtime ↔ generated boundary ──
 * Lives in `generated/`. Imports only sibling generated types (`./ids.js`, `./money.js`) —
 * never `runtime/`. The model + request + list-params types are public surface (generated
 * barrel + `src/index.ts`); the `*Wire` types and the (de)serializers are consumed by the
 * `loans` resource (and the conformance harness — story 008) via direct import.
 */

import type { CreditOfferId, CustomerId, LoanId, SimulationId } from './ids.js';
import type { Money } from './money.js';

/** Loan lifecycle status (openapi enum). */
export type LoanStatus =
  | 'awaiting_signatures'
  | 'processing'
  | 'active'
  | 'finished'
  | 'cancelled'
  | 'error';

/** Body of `loans.create` — the offer + the accepted simulation's chosen terms. */
export interface CreateLoanRequest {
  /** Credit offer being accepted. Wire: `credit_offer_id`. */
  creditOfferId: CreditOfferId;
  /** Accepted simulation. Wire: `simulation_id`. */
  simulationId: SimulationId;
  /** Number of installments (integer ≥ 1). Wire: `installment_count`. */
  installmentCount: number;
  /** Installment amount, BRL. Wire: `installment_amount`. */
  installmentAmount: number;
  /** First installment due date, ISO `date` string. Wire: `first_due_date`. */
  firstDueDate: string;
}

/** Snake_case wire mirror of {@link CreateLoanRequest}. Built by {@link serializeCreateLoanRequest}. */
export interface CreateLoanRequestWire {
  credit_offer_id: string;
  simulation_id: string;
  installment_count: number;
  installment_amount: number;
  first_due_date: string;
}

/** A loan (`ln_…`) — the full read model returned by the loans resource. */
export interface Loan {
  /** Stable id, `ln_…`. */
  id: LoanId;
  /** Originating credit offer. Wire: `credit_offer_id`. */
  creditOfferId: CreditOfferId;
  /** Owning customer. Wire: `customer_id`. */
  customerId: CustomerId;
  /** Accepted simulation. Wire: `simulation_id`. */
  simulationId: SimulationId;
  /** Lifecycle status. */
  status: LoanStatus;
  /** Amount requested by the partner, BRL. Wire: `requested_amount`. */
  requestedAmount: Money;
  /** Principal (requested + financed fees), or `null` until calculated. Wire: `principal_amount`. */
  principalAmount: number | null;
  /** IOF tax amount, or `null` until calculated. Wire: `iof_amount`. */
  iofAmount: number | null;
  /** Monthly interest rate, percent. Wire: `monthly_interest_rate`. */
  monthlyInterestRate: number;
  /** Annual interest rate, percent (compounded from monthly). Wire: `annual_interest_rate`. */
  annualInterestRate: number;
  /** Monthly total effective cost (CET), percent. Wire: `monthly_cet_rate`. */
  monthlyCetRate: number;
  /** Annual total effective cost (CET), percent. Wire: `annual_cet_rate`. */
  annualCetRate: number;
  /** Total amount (sum of all installments), BRL. Wire: `total_amount`. */
  totalAmount: Money;
  /** Number of installments. Wire: `installment_count`. */
  installmentCount: number;
  /** Installment amount, BRL. Wire: `installment_amount`. */
  installmentAmount: number;
  /** First installment due date, ISO `date` string (NOT epoch). Wire: `first_due_date`. */
  firstDueDate: string;
  /** CCB contract number, or `null` until the contract is generated. Wire: `ccb_number`. */
  ccbNumber: string | null;
  /** Disbursement method (e.g. `pix`), or `null` until disbursement. Wire: `disbursement_method`. */
  disbursementMethod: string | null;
  /** ClickSign widget URL — present only during `awaiting_signatures`, else `null`. Wire: `signing_url`. */
  signingUrl: string | null;
  /** Creation instant, epoch seconds (R-EPOCH). Wire: `created_at`. */
  createdAt: number;
  /** Last-modified instant, epoch seconds (R-EPOCH). Wire: `updated_at`. */
  updatedAt: number;
}

/** Snake_case wire mirror of {@link Loan}. Decoded by {@link deserializeLoan}. */
export interface LoanWire {
  id: string;
  credit_offer_id: string;
  customer_id: string;
  simulation_id: string;
  status: LoanStatus;
  requested_amount: Money;
  principal_amount: number | null;
  iof_amount: number | null;
  monthly_interest_rate: number;
  annual_interest_rate: number;
  monthly_cet_rate: number;
  annual_cet_rate: number;
  total_amount: Money;
  installment_count: number;
  installment_amount: number;
  first_due_date: string;
  ccb_number: string | null;
  disbursement_method: string | null;
  signing_url: string | null;
  created_at: number;
  updated_at: number;
}

/** Query params for `loans.listTransactions` (the cursor is normally driven by the paginator). */
export interface LoanTransactionsListParams {
  /** Page size, 1..100. */
  limit?: number;
  /** Explicit cursor (the `id` of the last item of the previous page). Wire: `starting_after`. */
  startingAfter?: string;
}

/**
 * Encode a {@link CreateLoanRequest} (camelCase) into its wire body (snake_case). Every field
 * is required, so there are no optional spreads. Alphabetical by target key.
 */
export function serializeCreateLoanRequest(params: CreateLoanRequest): CreateLoanRequestWire {
  return {
    credit_offer_id: params.creditOfferId,
    first_due_date: params.firstDueDate,
    installment_amount: params.installmentAmount,
    installment_count: params.installmentCount,
    simulation_id: params.simulationId,
  };
}

/**
 * Decode a wire loan (snake_case) into a {@link Loan} (camelCase). Explicit, alphabetical,
 * epoch-preserving — see the four rules in `customer.ts`. The five nullable fields are always
 * present and copied as-is (`T | null`, R-OPTIONAL nullable rule); `firstDueDate` is a `date`
 * string (not converted to epoch).
 */
export function deserializeLoan(raw: LoanWire): Loan {
  return {
    annualCetRate: raw.annual_cet_rate,
    annualInterestRate: raw.annual_interest_rate,
    ccbNumber: raw.ccb_number,
    createdAt: raw.created_at,
    creditOfferId: raw.credit_offer_id,
    customerId: raw.customer_id,
    disbursementMethod: raw.disbursement_method,
    firstDueDate: raw.first_due_date,
    id: raw.id,
    installmentAmount: raw.installment_amount,
    installmentCount: raw.installment_count,
    iofAmount: raw.iof_amount,
    monthlyCetRate: raw.monthly_cet_rate,
    monthlyInterestRate: raw.monthly_interest_rate,
    principalAmount: raw.principal_amount,
    requestedAmount: raw.requested_amount,
    signingUrl: raw.signing_url,
    simulationId: raw.simulation_id,
    status: raw.status,
    totalAmount: raw.total_amount,
    updatedAt: raw.updated_at,
  };
}
