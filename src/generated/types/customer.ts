/**
 * `Customer` types + the **serializer convention** every resource/event story copies
 * (architecture §3.4, §4 R1/R3, §7.1). Hand-authored in V0.2 to mirror what the generator
 * will emit from the V3 OpenAPI `Customer`/`CreateCustomerRequest`/`UpdateCustomerRequest`
 * schemas (V0.4 overwrites this file in place — D1). This file is the **exemplar**: stories
 * 003 (customers), 005 (offers/loans), 006 (platform) and 007 (events) reproduce this exact
 * shape, so the rules below are the source for `principles.md` (story 009).
 *
 * ── The determinism shape (what the generator emits per schema) ──
 * For every schema the generator emits, in order:
 *   1. `interface <Name>`        — the camelCase SDK model (read models) …
 *   2. `interface <Name>Wire`    — the snake_case wire mirror (the bytes on the network);
 *   3. `deserialize<Name>(raw)`  — wire → model (snake→camel), for RESPONSE/read schemas;
 *   4. `serialize<Name>(model)`  — model → wire (camel→snake), for REQUEST schemas only.
 * Read models get a deserializer; request bodies get a serializer. `Customer` is read-only
 * (no `serializeCustomer` — you never POST a whole Customer), so it has a deserializer; the
 * two request bodies get serializers. `CreditOffer` (credit-offer.ts) follows the same rule
 * (read-only, deserializer only — R10).
 *
 * ── The four rules every (de)serializer obeys ──
 *   R-EXPLICIT  Field-by-field mapping, never reflective key-casing. Each rename is written
 *               out so the diff is reviewable and the generator output is auditable.
 *   R-ORDER     Output object keys are alphabetical (by the *target* name). Stable ordering
 *               keeps the V0.4 generator diff minimal.
 *   R-OPTIONAL  An absent optional is OMITTED, never set to `undefined`
 *               (`exactOptionalPropertyTypes`): `...(x !== undefined ? { k: x } : {})`.
 *               A required-but-nullable field (`type: [T, 'null']`) is always present and
 *               copied as-is (`T | null`), NOT made optional.
 *   R-EPOCH     Timestamps are integer epoch seconds and stay `number` on the surface
 *               (architecture D6). NEVER converted to `Date` (lossy, timezone-fragile,
 *               non-deterministic). The sole `Date` in the SDK is `RateLimit.resetAt`
 *               (a transport header, in `runtime/`) — out of scope here.
 *
 * ── Field map (Customer, openapi `components.schemas.Customer` @ 3fcfd83) ──
 *   wire (snake_case)   → model (camelCase)   → type
 *   id                  → id                  → CustomerId            (`cust_…`, NOT `cus_`)
 *   external_id         → externalId          → string | null        (required, nullable)
 *   name                → name                → string | null        (required, nullable)
 *   email               → email               → string
 *   phone               → phone               → string               (E.164)
 *   cpf                 → cpf                 → string                (formatted in responses)
 *   cnpj                → cnpj                → string | null         (required, nullable)
 *   trading_name        → tradingName         → string | null        (required, nullable)
 *   status              → status              → CustomerStatus (enum)
 *   kyc                 → kyc                  → KycRequirement[]?     (story 004 — see note)
 *   created_at          → createdAt           → number (epoch seconds)
 *   updated_at          → updatedAt           → number (epoch seconds)
 *
 * ── Reconciliation vs. the V0.1 sketch (architecture §4) ──
 *   R1  request is `{ email, phone, cpf, cnpj, name?, externalId? }` — there is NO `taxId`.
 *   R2  the id prefix is `cust_`, not `cus_`.
 *   R3  timestamps are `number` epoch seconds, not ISO `string`.
 *   Also: the contract's `Customer` has NO `object: 'customer'` discriminant — dropped.
 *
 * ── runtime ↔ generated boundary ──
 * Lives in `generated/`. Imports only the sibling generated id type (`./ids.js`) — never
 * `runtime/`. The page/list mapping that needs `ListEnvelope` lives in the RESOURCE
 * (`resources/customers.ts`), which may import `runtime/`; keeping it out of here is what
 * keeps these types self-contained. Model + request types are public surface (re-exported
 * via the generated barrel + `src/index.ts`); the `*Wire` types and the (de)serializers are
 * consumed by the resource (and the conformance harness — story 008) via direct import.
 */

import type { CreditOfferStatus } from './credit-offer.js';
import type { CustomerId } from './ids.js';
import {
  deserializeKycRequirement,
  type KycRequirement,
  type KycRequirementWire,
} from './kyc/index.js';

/** Customer lifecycle status (openapi enum). */
export type CustomerStatus = 'creating' | 'pending_kyc' | 'under_review' | 'active' | 'denied';

/** A Dinie customer (`cust_…`) — the full read model returned by the customers resource. */
export interface Customer {
  /** Stable id, `cust_…`. */
  id: CustomerId;
  /** Partner external reference, or `null`. Wire: `external_id`. */
  externalId: string | null;
  /** Display name (auto-fetched from CPF records when omitted at creation), or `null`. */
  name: string | null;
  /** Contact email. */
  email: string;
  /** Contact phone, E.164. */
  phone: string;
  /** Customer CPF — formatted `XXX.XXX.XXX-XX` in responses. */
  cpf: string;
  /** Company CNPJ — formatted `XX.XXX.XXX/XXXX-XX` in responses, or `null`. */
  cnpj: string | null;
  /** Company trading name, or `null`. Wire: `trading_name`. */
  tradingName: string | null;
  /** Lifecycle status. */
  status: CustomerStatus;
  /**
   * KYC requirements. Omitted during `creating`; present from `pending_kyc` onward. Each entry
   * is a {@link KycRequirement} — the discriminated union over `requirement_type` (architecture
   * §3.4 hotspot, defined in `./kyc/`). Refined from the story-002 placeholder `unknown[]` by
   * story 004. The wire field is `kyc`.
   */
  kyc?: KycRequirement[];
  /** Creation instant, epoch seconds (R-EPOCH). Wire: `created_at`. */
  createdAt: number;
  /** Last-modified instant, epoch seconds (R-EPOCH). Wire: `updated_at`. */
  updatedAt: number;
}

/** Snake_case wire mirror of {@link Customer}. Decoded by {@link deserializeCustomer}. */
export interface CustomerWire {
  id: string;
  external_id: string | null;
  name: string | null;
  email: string;
  phone: string;
  cpf: string;
  cnpj: string | null;
  trading_name: string | null;
  status: CustomerStatus;
  kyc?: KycRequirementWire[];
  created_at: number;
  updated_at: number;
}

/** Body of `customers.create` — `{ email, phone, cpf, cnpj, name?, externalId? }` (R1). */
export interface CreateCustomerRequest {
  /** Contact email (required). */
  email: string;
  /** Contact phone, E.164 (required). */
  phone: string;
  /** Customer CPF (required). Accepts formatted or unformatted. */
  cpf: string;
  /** Company CNPJ (required). Accepts formatted or unformatted. */
  cnpj: string;
  /** Optional display name; auto-fetched from CPF records when omitted. */
  name?: string;
  /** Optional partner external reference. Wire: `external_id`. */
  externalId?: string;
}

/** Snake_case wire mirror of {@link CreateCustomerRequest}. Built by {@link serializeCreateCustomerRequest}. */
export interface CreateCustomerRequestWire {
  email: string;
  phone: string;
  cpf: string;
  cnpj: string;
  name?: string;
  external_id?: string;
}

/** Body of `customers.update` — a PATCH subset (`email`/`phone`, both optional). */
export interface UpdateCustomerRequest {
  /** New contact email. */
  email?: string;
  /** New contact phone, E.164. */
  phone?: string;
}

/** Snake_case wire mirror of {@link UpdateCustomerRequest}. Built by {@link serializeUpdateCustomerRequest}. */
export interface UpdateCustomerRequestWire {
  email?: string;
  phone?: string;
}

/** Query params for `customers.list` (the cursor is normally driven by the paginator). */
export interface CustomerListParams {
  /** Page size, 1..100. */
  limit?: number;
  /** Explicit cursor (the `id` of the last item of the previous page). Wire: `starting_after`. */
  startingAfter?: string;
}

/**
 * Query params for `customers.creditOffers.list`. Mirrors the openapi query of
 * `GET /customers/{id}/credit-offers`: pagination (`limit`/`starting_after`) plus the optional
 * `status` filter. The architecture §3.1 summary table lists only `{limit?, startingAfter?}`,
 * but the contract (SoT — D2) defines `status` too, so the deterministic generator output
 * (§7.5) includes it; surfaced as an enrichment beyond the summary table.
 */
export interface CustomerCreditOffersListParams {
  /** Page size, 1..100. */
  limit?: number;
  /** Explicit cursor (the `id` of the last item of the previous page). Wire: `starting_after`. */
  startingAfter?: string;
  /** Filter by offer status. Wire: `status` (single word — passed through unchanged). */
  status?: CreditOfferStatus;
}

// ── (De)serializers — the convention stories 003–007 copy verbatim ──────────────

/**
 * Decode a wire customer (snake_case) into a {@link Customer} (camelCase). Explicit,
 * alphabetical, epoch-preserving — see the four rules in the module header. `kyc` is an
 * optional array (omitted during `creating`): each entry is run through
 * {@link deserializeKycRequirement} (the discriminated dispatch — story 004) when present.
 */
export function deserializeCustomer(raw: CustomerWire): Customer {
  return {
    cnpj: raw.cnpj,
    cpf: raw.cpf,
    createdAt: raw.created_at,
    email: raw.email,
    externalId: raw.external_id,
    id: raw.id,
    ...(raw.kyc !== undefined ? { kyc: raw.kyc.map(deserializeKycRequirement) } : {}),
    name: raw.name,
    phone: raw.phone,
    status: raw.status,
    tradingName: raw.trading_name,
    updatedAt: raw.updated_at,
  };
}

/**
 * Encode a {@link CreateCustomerRequest} (camelCase) into its wire body (snake_case).
 * Required fields always present; `name`/`external_id` omitted when absent (R-OPTIONAL).
 */
export function serializeCreateCustomerRequest(
  params: CreateCustomerRequest,
): CreateCustomerRequestWire {
  return {
    cnpj: params.cnpj,
    cpf: params.cpf,
    email: params.email,
    ...(params.externalId !== undefined ? { external_id: params.externalId } : {}),
    ...(params.name !== undefined ? { name: params.name } : {}),
    phone: params.phone,
  };
}

/**
 * Encode an {@link UpdateCustomerRequest} (camelCase) into its PATCH wire body. Every field
 * is optional; only the keys the caller set are emitted (R-OPTIONAL).
 */
export function serializeUpdateCustomerRequest(
  params: UpdateCustomerRequest,
): UpdateCustomerRequestWire {
  return {
    ...(params.email !== undefined ? { email: params.email } : {}),
    ...(params.phone !== undefined ? { phone: params.phone } : {}),
  };
}
