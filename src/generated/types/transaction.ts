/**
 * `Transaction` type — a loan installment (architecture §3.4, §7.5). Hand-authored in V0.2 to
 * mirror what the generator will emit from the V3 OpenAPI `Transaction` schema (V0.4 overwrites
 * this file in place — D1). Follows the serializer convention defined in `customer.ts` (the
 * exemplar): read-only model → `deserialize*` only (transactions are never POSTed by the
 * partner, so there is no request body / serializer).
 *
 * ── The four rules (see `customer.ts` header) ──
 *   R-EXPLICIT  field-by-field mapping, never reflective key-casing.
 *   R-ORDER     output keys alphabetical by the *target* name (minimal V0.4 generator diff).
 *   R-OPTIONAL  absent optional omitted; required-but-nullable always present as `T | null`.
 *   R-EPOCH     integer epoch-second timestamps stay `number` (never `Date`).
 *
 * ── Field map — `Transaction` (read model; every field in `required`) ──
 *   wire (snake_case)   → model (camelCase)   → type
 *   id                  → id                  → TransactionId (`tx_…`)
 *   loan_id             → loanId              → LoanId
 *   type                → type                → 'installment'      (const literal)
 *   status              → status              → TransactionStatus (enum)
 *   due_date            → dueDate             → string (ISO `date`, NOT epoch)
 *   amount_due          → amountDue           → Money              ($ref Money)
 *   amount_paid         → amountPaid          → Money              ($ref Money)
 *   amount_remaining    → amountRemaining     → Money              ($ref Money)
 *   principal           → principal           → Money              ($ref Money)
 *   interest            → interest            → Money              ($ref Money)
 *   fees                → fees                → Money              ($ref Money)
 *   days_overdue        → daysOverdue         → number (integer ≥ 0)
 *   paid_at             → paidAt              → number | null      (null until paid; epoch)
 *   created_at          → createdAt           → number (epoch seconds, R-EPOCH)
 *   updated_at          → updatedAt           → number (epoch seconds, R-EPOCH)
 *
 * ── `type` is a `const`, so it surfaces as a literal ──
 * The contract pins `type` to `const: installment`, so the deterministic rule emits the
 * literal type `'installment'` (a `const` → literal; a `pattern`/free string → `string`). Only
 * `paid_at` is nullable (`type: [integer, 'null']`) → carried as `number | null` (R-OPTIONAL
 * nullable rule). `due_date` is a `date` string, not epoch (same rule as `simulation.ts`).
 *
 * ── runtime ↔ generated boundary ──
 * Lives in `generated/`. Imports only sibling generated types (`./ids.js`, `./money.js`) —
 * never `runtime/`. The model + the enum/literal types are public surface (generated barrel +
 * `src/index.ts`); the `*Wire` type and the deserializer are consumed by the `loans` resource
 * (and the conformance harness — story 008) via direct import.
 */

import type { LoanId, TransactionId } from './ids.js';
import type { Money } from './money.js';

/** Transaction kind — pinned to the single `const` in the contract. */
export type TransactionType = 'installment';

/** Installment payment status (openapi enum). */
export type TransactionStatus = 'pending' | 'paid' | 'overdue' | 'partially_paid';

/** A single loan installment (`tx_…`) — read-only. */
export interface Transaction {
  /** Stable id, `tx_…`. */
  id: TransactionId;
  /** Owning loan. Wire: `loan_id`. */
  loanId: LoanId;
  /** Transaction kind — always `'installment'`. */
  type: TransactionType;
  /** Payment status. */
  status: TransactionStatus;
  /** Installment due date, ISO `date` string (NOT epoch). Wire: `due_date`. */
  dueDate: string;
  /** Amount due, BRL. Wire: `amount_due`. */
  amountDue: Money;
  /** Amount paid so far, BRL. Wire: `amount_paid`. */
  amountPaid: Money;
  /** Amount still outstanding, BRL. Wire: `amount_remaining`. */
  amountRemaining: Money;
  /** Principal portion of the installment, BRL. */
  principal: Money;
  /** Interest portion of the installment, BRL. */
  interest: Money;
  /** Fees portion of the installment, BRL. */
  fees: Money;
  /** Days overdue (≥ 0). Wire: `days_overdue`. */
  daysOverdue: number;
  /** Payment instant, epoch seconds, or `null` while unpaid. Wire: `paid_at`. */
  paidAt: number | null;
  /** Creation instant, epoch seconds (R-EPOCH). Wire: `created_at`. */
  createdAt: number;
  /** Last-modified instant, epoch seconds (R-EPOCH). Wire: `updated_at`. */
  updatedAt: number;
}

/** Snake_case wire mirror of {@link Transaction}. Decoded by {@link deserializeTransaction}. */
export interface TransactionWire {
  id: string;
  loan_id: string;
  type: TransactionType;
  status: TransactionStatus;
  due_date: string;
  amount_due: Money;
  amount_paid: Money;
  amount_remaining: Money;
  principal: Money;
  interest: Money;
  fees: Money;
  days_overdue: number;
  paid_at: number | null;
  created_at: number;
  updated_at: number;
}

/**
 * Decode a wire transaction (snake_case) into a {@link Transaction} (camelCase). Explicit,
 * alphabetical, epoch-preserving — see the four rules in `customer.ts`. `paidAt` is always
 * present and carried as `number | null` (R-OPTIONAL nullable rule); `dueDate` is a `date`
 * string (not converted to epoch).
 */
export function deserializeTransaction(raw: TransactionWire): Transaction {
  return {
    amountDue: raw.amount_due,
    amountPaid: raw.amount_paid,
    amountRemaining: raw.amount_remaining,
    createdAt: raw.created_at,
    daysOverdue: raw.days_overdue,
    dueDate: raw.due_date,
    fees: raw.fees,
    id: raw.id,
    interest: raw.interest,
    loanId: raw.loan_id,
    paidAt: raw.paid_at,
    principal: raw.principal,
    status: raw.status,
    type: raw.type,
    updatedAt: raw.updated_at,
  };
}
