/**
 * KYC shared leaf types + the discriminated-union dispatch error (architecture §3.4, §7.8).
 * Hand-authored in V0.2 to mirror future generator output (D1; V0.4 overwrites in place).
 * Follows the serializer convention defined in `../customer.ts` (the exemplar) and the four
 * rules (R-EXPLICIT / R-ORDER alphabetical / R-OPTIONAL omit-not-undefined / R-EPOCH
 * number-not-Date). See `./index.ts` for the full KYC determinism-shape header (story 009
 * input).
 *
 * These are the leaves every requirement/submitted variant reuses, so they live in one place
 * (the generator emits each once, every variant references it — no per-variant duplication):
 *   - `ReviewStatus` / `ReviewReason`  — shared review fields on every `*Submitted`.
 *   - `KycSubject`                     — who a person-specific requirement is about.
 *   - `KycAttachment`                  — one uploaded-evidence slot (`{attachmentType, submittedAt}`).
 *
 * ── runtime ↔ generated boundary ──
 * Lives in `generated/`. Imports nothing (leaf module). Model types are public surface
 * (re-exported via `./index.ts` → the generated barrel); the `*Wire` types + `deserialize*`
 * are internal, consumed by the sibling KYC modules and the conformance harness (story 008).
 */

/**
 * Review state of a submitted piece of KYC evidence (openapi enum).
 * `pending` — awaiting review · `accepted` — approved · `rejected` — partner must resubmit.
 */
export type ReviewStatus = 'pending' | 'accepted' | 'rejected';

/**
 * Explanation when `reviewStatus` is `rejected`; `null` otherwise. Wire `type: [string,'null']`
 * → required-but-nullable `string | null` (R-OPTIONAL: always present, copied as-is — never
 * made optional). Wire: `review_reason`.
 */
export type ReviewReason = string | null;

/** Who a person-specific KYC requirement is about (openapi `subject_type` enum). */
export type KycSubjectType = 'applicant' | 'co_owner';

/**
 * Identifies who a requirement is about — the applicant themselves or a company co-owner.
 * Present only on person-specific requirements (identity / selfie / proof-of-address / email).
 */
export interface KycSubject {
  /** Opaque subject id (used as the `requirement_id` suffix and in uploads). */
  id: string;
  /** Human-readable subject name. */
  name: string;
  /** `applicant` — the customer · `co_owner` — a director/shareholder. Wire: `subject_type`. */
  subjectType: KycSubjectType;
}

/** Snake_case wire mirror of {@link KycSubject}. */
export interface KycSubjectWire {
  id: string;
  name: string;
  subject_type: KycSubjectType;
}

/**
 * One uploaded-evidence slot within a `*Submitted`. Every submitted variant's `attachments`
 * array is a list of these — the openapi defines the item inline per variant, but the shape is
 * uniform (`{attachment_type, submitted_at}`), so the generator emits ONE leaf type they all
 * reference (determinism shape DS-LEAF — see `./index.ts`).
 *
 * `attachmentType` is left a broad `string` here on purpose: each variant constrains it to its
 * own enum/const (`front`/`back`/`file`/`photo`/`email`/`ei_registration_requirement`/`ccmei`),
 * documented at each `*Submitted`. Narrowing it per-variant would fork this leaf into N nearly
 * identical types for no determinism gain.
 */
export interface KycAttachment {
  /** Slot kind — see the owning `*Submitted` for its allowed values. Wire: `attachment_type`. */
  attachmentType: string;
  /** Upload instant, epoch seconds (R-EPOCH), or `null` if not yet uploaded. Wire: `submitted_at`. */
  submittedAt: number | null;
}

/** Snake_case wire mirror of {@link KycAttachment}. */
export interface KycAttachmentWire {
  attachment_type: string;
  submitted_at: number | null;
}

// ── Shared (de)serializers (the convention — see `../customer.ts`) ───────────────

/** Decode a wire {@link KycSubject} (snake→camel, explicit + alphabetical). */
export function deserializeKycSubject(raw: KycSubjectWire): KycSubject {
  return {
    id: raw.id,
    name: raw.name,
    subjectType: raw.subject_type,
  };
}

/** Decode a wire {@link KycAttachment} (snake→camel). `submitted_at` stays epoch `number|null`. */
export function deserializeKycAttachment(raw: KycAttachmentWire): KycAttachment {
  return {
    attachmentType: raw.attachment_type,
    submittedAt: raw.submitted_at,
  };
}

/**
 * Build the error thrown when a discriminated-union dispatch hits a value not in the openapi
 * `mapping` (an `oneOf` member the contract never declared). One shared helper so every KYC
 * dispatch (`deserializeKycRequirement`, `deserializeIdentitySubmitted`, `serializeKycUpload`)
 * fails the same template-emittable way — a clear, actionable message, not a silent `undefined`.
 *
 * @param union          the union's name, e.g. `'KycRequirement'`
 * @param discriminator  the discriminator property, e.g. `'requirement_type'`
 * @param value          the unrecognized wire value
 */
export function kycDispatchError(union: string, discriminator: string, value: unknown): Error {
  return new Error(
    `Unknown ${union} ${discriminator}: ${JSON.stringify(value)}. ` +
      `This discriminator value is not declared in the openapi oneOf mapping — ` +
      `the SDK and contract are out of sync.`,
  );
}
