/**
 * KYC *submitted-evidence* types (architecture §3.4, §7.8). Hand-authored in V0.2 to mirror
 * future generator output (D1; V0.4 overwrites in place). Each `*Submitted` schema records the
 * evidence uploaded against a requirement: its `evidence_type` const, the uploaded
 * `attachments`, and the review outcome (`review_status` / `review_reason`).
 *
 * ── Determinism shape DS-FAMILY (uniform-variant family → generic base) ──
 * All ten `*Submitted` schemas are STRUCTURALLY IDENTICAL — they differ only by the
 * `evidence_type` const literal. So the generator emits ONE generic base
 * (`KycSubmitted<E>` / `KycSubmittedWire<E>`) and one type-alias per variant carrying the
 * literal, plus ONE uniform deserializer (`deserializeSubmitted`). No per-variant body — the
 * only thing that varies is a string literal, which the alias captures. (This is the input
 * `principles.md`/story 009 records for "a family of schemas differing only by a const".)
 *
 * ── Determinism shape DS-COLLAPSE (oneOf of arrays with one item shape) ──
 * `IdentityCnhSubmitted.attachments` is, in the openapi, a `oneOf` of two ARRAY schemas
 * (physical CNH = 2 items `front`/`back`; digital CNH = 1 item `file`). They differ only in
 * cardinality + the item's `attachment_type` enum — the ITEM shape (`{attachment_type,
 * submitted_at}`) is identical. A structural union of `Item[] | Item[]` IS `Item[]`, so the
 * generated type collapses to `KycAttachment[]`; cardinality/enum are doc-only constraints.
 *
 * ── Determinism shape DS-IMPLICIT (oneOf without an explicit discriminator) ──
 * `IdentityRequirement.submitted` is a `oneOf` of {@link IdentityCnhSubmitted} |
 * {@link IdentityRgSubmitted} with NO `discriminator` block in the openapi — UNLIKE
 * `KycRequirement` / the upload union, which both carry an explicit `discriminator`. The
 * members still each have a `const evidence_type` (`cnh` / `rg`), so the generator falls back
 * to that const as the discriminator (architecture §7.8). ⚠️ Candidate openapi PR **P6** (add
 * an explicit `discriminator: evidence_type` to this oneOf) — NOT authorized this round; the
 * implicit-const fallback is sound and tracked.
 *
 * ── runtime ↔ generated boundary ──
 * Lives in `generated/`. Imports only the sibling leaf module (`./common.js`). Model types are
 * public surface (via `./index.ts` → the generated barrel); `*Wire` + `deserialize*` are
 * internal, consumed by `./requirements.ts`, `./attachment.ts`, and conformance (story 008).
 */

import {
  deserializeKycAttachment,
  kycDispatchError,
  type KycAttachment,
  type KycAttachmentWire,
  type ReviewReason,
  type ReviewStatus,
} from './common.js';

// ── DS-FAMILY: one generic base, one alias per variant ──────────────────────────

/**
 * The uniform shape of every `*Submitted` (DS-FAMILY). `E` is the `evidence_type` const that
 * distinguishes the variant; everything else is identical across the ten variants.
 */
export interface KycSubmitted<E extends string> {
  /** Uploaded evidence slots. See the variant alias for the allowed `attachmentType` values. */
  attachments: KycAttachment[];
  /** Evidence-type discriminant (const per variant). Wire: `evidence_type`. */
  evidenceType: E;
  /** Rejection explanation, or `null`. Wire: `review_reason`. */
  reviewReason: ReviewReason;
  /** Review outcome. Wire: `review_status`. */
  reviewStatus: ReviewStatus;
}

/** Snake_case wire mirror of {@link KycSubmitted}. */
export interface KycSubmittedWire<E extends string> {
  attachments: KycAttachmentWire[];
  evidence_type: E;
  review_reason: ReviewReason;
  review_status: ReviewStatus;
}

/** CNH evidence — physical (`front`+`back`) or digital (`file`); attachments collapse (DS-COLLAPSE). */
export type IdentityCnhSubmitted = KycSubmitted<'cnh'>;
/** RG evidence — `front`+`back` photos. */
export type IdentityRgSubmitted = KycSubmitted<'rg'>;
/** Selfie evidence — a single `photo`. */
export type SelfieSubmitted = KycSubmitted<'selfie'>;
/** Proof-of-address evidence — a single `file`. */
export type ProofOfAddressSubmitted = KycSubmitted<'proof_of_address'>;
/** Company document (CCMEI) evidence — a single `file`. */
export type CompanyDocumentSubmitted = KycSubmitted<'ccmei'>;
/** EI/MEI evidence — `ei_registration_requirement` + `ccmei`. */
export type EiMeiDocumentsSubmitted = KycSubmitted<'ei_mei'>;
/** Income-statement (DRE) evidence — a single `file`. */
export type IncomeStatementSubmitted = KycSubmitted<'income_statement'>;
/** Articles-of-association (contrato social) evidence — a single `file`. */
export type ArticlesOfAssociationSubmitted = KycSubmitted<'articles_of_association'>;
/** EIRELI incorporation-statement evidence — a single `file`. */
export type EireliIncorporationStatementSubmitted = KycSubmitted<'eireli_incorporation_statement'>;
/** Co-owner email evidence — a single `email` value (submitted via the upload endpoint's `value`). */
export type EmailSubmitted = KycSubmitted<'email'>;

/** Wire aliases — one per variant (snake_case mirrors). */
export type IdentityCnhSubmittedWire = KycSubmittedWire<'cnh'>;
export type IdentityRgSubmittedWire = KycSubmittedWire<'rg'>;
export type SelfieSubmittedWire = KycSubmittedWire<'selfie'>;
export type ProofOfAddressSubmittedWire = KycSubmittedWire<'proof_of_address'>;
export type CompanyDocumentSubmittedWire = KycSubmittedWire<'ccmei'>;
export type EiMeiDocumentsSubmittedWire = KycSubmittedWire<'ei_mei'>;
export type IncomeStatementSubmittedWire = KycSubmittedWire<'income_statement'>;
export type ArticlesOfAssociationSubmittedWire = KycSubmittedWire<'articles_of_association'>;
export type EireliIncorporationStatementSubmittedWire =
  KycSubmittedWire<'eireli_incorporation_statement'>;
export type EmailSubmittedWire = KycSubmittedWire<'email'>;

/** DS-IMPLICIT: identity evidence is CNH **or** RG, discriminated by the const `evidence_type`. */
export type IdentitySubmitted = IdentityCnhSubmitted | IdentityRgSubmitted;
/** Wire mirror of {@link IdentitySubmitted}. */
export type IdentitySubmittedWire = IdentityCnhSubmittedWire | IdentityRgSubmittedWire;

// ── (De)serializers ─────────────────────────────────────────────────────────────

/**
 * Decode any wire `*Submitted` (snake→camel, explicit + alphabetical). One uniform body for
 * every variant (DS-FAMILY): map the attachments, copy the const `evidence_type`, and carry the
 * review fields through. `E` is inferred from the call site so the result keeps its literal.
 */
export function deserializeSubmitted<E extends string>(raw: KycSubmittedWire<E>): KycSubmitted<E> {
  return {
    attachments: raw.attachments.map(deserializeKycAttachment),
    evidenceType: raw.evidence_type,
    reviewReason: raw.review_reason,
    reviewStatus: raw.review_status,
  };
}

/**
 * Decode the identity `submitted` oneOf by dispatching on the const `evidence_type` (DS-IMPLICIT
 * — no explicit discriminator in the openapi). `cnh` → {@link IdentityCnhSubmitted}, `rg` →
 * {@link IdentityRgSubmitted}; anything else throws a clear {@link kycDispatchError}.
 */
export function deserializeIdentitySubmitted(raw: IdentitySubmittedWire): IdentitySubmitted {
  switch (raw.evidence_type) {
    case 'cnh':
      return deserializeSubmitted<'cnh'>(raw);
    case 'rg':
      return deserializeSubmitted<'rg'>(raw);
    default:
      throw kycDispatchError(
        'IdentitySubmitted',
        'evidence_type',
        (raw as { evidence_type: unknown }).evidence_type,
      );
  }
}
