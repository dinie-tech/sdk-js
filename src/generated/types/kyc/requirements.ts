/**
 * KYC *requirement* types + the `KycRequirement` discriminated union (architecture §3.4, §7.8 —
 * the hardest determinism shape in the project). Hand-authored in V0.2 to mirror future
 * generator output (D1; V0.4 overwrites in place). A requirement is something the customer must
 * verify (identity, address, company docs…). The openapi models the family as an `oneOf` of
 * nine `*Requirement` schemas with an EXPLICIT `discriminator`.
 *
 * ── Determinism shape DS-DISCRIMINATED (the headline rule for story 009) ──
 * openapi `oneOf` + `discriminator: {propertyName: requirement_type, mapping: {...}}` →
 *   1. each member is an interface carrying the discriminator as a `const` literal field
 *      (`requirementType: 'identity'`, …);
 *   2. the union is `type KycRequirement = A | B | …`;
 *   3. `deserializeKycRequirement(raw)` is a `switch (raw.requirement_type)` whose cases are
 *      EXACTLY the openapi `mapping` keys, each delegating to the member's deserializer;
 *   4. an unmapped value throws {@link kycDispatchError} (never silent `undefined`).
 * The switch is table-driven by the `mapping` — NO bespoke per-variant control flow. The V0.4
 * generator reproduces it from the schema alone; the Ruby SDK (V0.3) emits the same rule as a
 * `case`/pattern-match (the `comparison.md` canary).
 *
 * ── Determinism shape DS-CONST-ID (const vs pattern `requirement_id`) ──
 * Person-specific requirements (identity/selfie/proof-of-address/email) carry a pattern
 * `requirement_id` (`identity_{subject_id}`, …) → typed `string`; company-wide requirements
 * carry a `const requirement_id` (= the requirement type) → typed as that string literal.
 * `const` schema → literal type; `pattern` schema → `string` (the prefix is validated, not
 * encoded in the type).
 *
 * ── Determinism shape DS-SUBJECT (presence-driven optionality) ──
 * Person-specific requirements REQUIRE `subject` (a {@link KycSubject}); company-wide ones omit
 * it entirely (it is not in their schema, not merely optional). The generated member type only
 * has `subject` when the schema declares it.
 *
 * ── runtime ↔ generated boundary ──
 * Lives in `generated/`. Imports only sibling KYC leaf modules (`./common.js`, `./submitted.js`).
 * Model types + the union are public surface (via `./index.ts` → the generated barrel); the
 * `*Wire` types + `deserialize*` are internal, consumed by `./attachment.ts`, the customers
 * resource, `../customer.ts` (the `kyc` array), and conformance (story 008).
 */

import {
  deserializeKycSubject,
  kycDispatchError,
  type KycSubject,
  type KycSubjectWire,
} from './common.js';
import {
  deserializeIdentitySubmitted,
  deserializeSubmitted,
  type ArticlesOfAssociationSubmitted,
  type ArticlesOfAssociationSubmittedWire,
  type CompanyDocumentSubmitted,
  type CompanyDocumentSubmittedWire,
  type EiMeiDocumentsSubmitted,
  type EiMeiDocumentsSubmittedWire,
  type EireliIncorporationStatementSubmitted,
  type EireliIncorporationStatementSubmittedWire,
  type EmailSubmitted,
  type EmailSubmittedWire,
  type IdentitySubmitted,
  type IdentitySubmittedWire,
  type IncomeStatementSubmitted,
  type IncomeStatementSubmittedWire,
  type ProofOfAddressSubmitted,
  type ProofOfAddressSubmittedWire,
  type SelfieSubmitted,
  type SelfieSubmittedWire,
} from './submitted.js';

/** Every `requirement_type` discriminant value (= the openapi `discriminator.mapping` keys). */
export type KycRequirementType =
  | 'identity'
  | 'selfie'
  | 'proof_of_address'
  | 'company_document'
  | 'ei_mei_documents'
  | 'income_statement'
  | 'articles_of_association'
  | 'eireli_incorporation_statement'
  | 'email';

// ── 1. Identity (person-specific; submitted is CNH|RG) ──────────────────────────

/** Identity-document requirement (CNH or RG). Person-specific. */
export interface IdentityRequirement {
  /** Discriminant. Wire: `requirement_type`. */
  requirementType: 'identity';
  /** `identity_{subject_id}`. Wire: `requirement_id`. */
  requirementId: string;
  /** Human-readable label. */
  label: string;
  /** Whether this requirement is mandatory. */
  mandatory: boolean;
  /** Who the requirement is about. */
  subject: KycSubject;
  /** Submitted evidence (CNH or RG), absent until something is uploaded. */
  submitted?: IdentitySubmitted;
}
/** Snake_case wire mirror of {@link IdentityRequirement}. */
export interface IdentityRequirementWire {
  requirement_type: 'identity';
  requirement_id: string;
  label: string;
  mandatory: boolean;
  subject: KycSubjectWire;
  submitted?: IdentitySubmittedWire;
}

// ── 2. Selfie (person-specific) ─────────────────────────────────────────────────

/** Selfie requirement. Person-specific. */
export interface SelfieRequirement {
  requirementType: 'selfie';
  /** `selfie_{subject_id}`. Wire: `requirement_id`. */
  requirementId: string;
  label: string;
  mandatory: boolean;
  subject: KycSubject;
  submitted?: SelfieSubmitted;
}
/** Snake_case wire mirror of {@link SelfieRequirement}. */
export interface SelfieRequirementWire {
  requirement_type: 'selfie';
  requirement_id: string;
  label: string;
  mandatory: boolean;
  subject: KycSubjectWire;
  submitted?: SelfieSubmittedWire;
}

// ── 3. Proof of address (person-specific) ───────────────────────────────────────

/** Proof-of-address requirement. Person-specific. */
export interface ProofOfAddressRequirement {
  requirementType: 'proof_of_address';
  /** `proof_of_address_{subject_id}`. Wire: `requirement_id`. */
  requirementId: string;
  label: string;
  mandatory: boolean;
  subject: KycSubject;
  submitted?: ProofOfAddressSubmitted;
}
/** Snake_case wire mirror of {@link ProofOfAddressRequirement}. */
export interface ProofOfAddressRequirementWire {
  requirement_type: 'proof_of_address';
  requirement_id: string;
  label: string;
  mandatory: boolean;
  subject: KycSubjectWire;
  submitted?: ProofOfAddressSubmittedWire;
}

// ── 4. Company document / CCMEI (company-wide; no subject; const id) ─────────────

/** Company-document (CCMEI) requirement. Company-wide — no subject (DS-SUBJECT). */
export interface CompanyDocumentRequirement {
  requirementType: 'company_document';
  /** Fixed const id (DS-CONST-ID). Wire: `requirement_id`. */
  requirementId: 'company_document';
  label: string;
  mandatory: boolean;
  submitted?: CompanyDocumentSubmitted;
}
/** Snake_case wire mirror of {@link CompanyDocumentRequirement}. */
export interface CompanyDocumentRequirementWire {
  requirement_type: 'company_document';
  requirement_id: 'company_document';
  label: string;
  mandatory: boolean;
  submitted?: CompanyDocumentSubmittedWire;
}

// ── 5. EI/MEI documents (company-wide) ──────────────────────────────────────────

/** EI/MEI documents requirement (EI registration + CCMEI). Company-wide. */
export interface EiMeiDocumentsRequirement {
  requirementType: 'ei_mei_documents';
  requirementId: 'ei_mei_documents';
  label: string;
  mandatory: boolean;
  submitted?: EiMeiDocumentsSubmitted;
}
/** Snake_case wire mirror of {@link EiMeiDocumentsRequirement}. */
export interface EiMeiDocumentsRequirementWire {
  requirement_type: 'ei_mei_documents';
  requirement_id: 'ei_mei_documents';
  label: string;
  mandatory: boolean;
  submitted?: EiMeiDocumentsSubmittedWire;
}

// ── 6. Income statement / DRE (company-wide) ────────────────────────────────────

/** Income-statement (DRE) requirement. Company-wide. */
export interface IncomeStatementRequirement {
  requirementType: 'income_statement';
  requirementId: 'income_statement';
  label: string;
  mandatory: boolean;
  submitted?: IncomeStatementSubmitted;
}
/** Snake_case wire mirror of {@link IncomeStatementRequirement}. */
export interface IncomeStatementRequirementWire {
  requirement_type: 'income_statement';
  requirement_id: 'income_statement';
  label: string;
  mandatory: boolean;
  submitted?: IncomeStatementSubmittedWire;
}

// ── 7. Articles of association / contrato social (company-wide) ──────────────────

/** Articles-of-association (contrato social) requirement. Company-wide. */
export interface ArticlesOfAssociationRequirement {
  requirementType: 'articles_of_association';
  requirementId: 'articles_of_association';
  label: string;
  mandatory: boolean;
  submitted?: ArticlesOfAssociationSubmitted;
}
/** Snake_case wire mirror of {@link ArticlesOfAssociationRequirement}. */
export interface ArticlesOfAssociationRequirementWire {
  requirement_type: 'articles_of_association';
  requirement_id: 'articles_of_association';
  label: string;
  mandatory: boolean;
  submitted?: ArticlesOfAssociationSubmittedWire;
}

// ── 8. EIRELI incorporation statement (company-wide) ────────────────────────────

/** EIRELI incorporation-statement requirement. Company-wide. */
export interface EireliIncorporationStatementRequirement {
  requirementType: 'eireli_incorporation_statement';
  requirementId: 'eireli_incorporation_statement';
  label: string;
  mandatory: boolean;
  submitted?: EireliIncorporationStatementSubmitted;
}
/** Snake_case wire mirror of {@link EireliIncorporationStatementRequirement}. */
export interface EireliIncorporationStatementRequirementWire {
  requirement_type: 'eireli_incorporation_statement';
  requirement_id: 'eireli_incorporation_statement';
  label: string;
  mandatory: boolean;
  submitted?: EireliIncorporationStatementSubmittedWire;
}

// ── 9. Email (person-specific) ──────────────────────────────────────────────────

/** Co-owner email-collection requirement (for CCB digital signature). Person-specific. */
export interface EmailRequirement {
  requirementType: 'email';
  /** `email_{subject_id}`. Wire: `requirement_id`. */
  requirementId: string;
  label: string;
  mandatory: boolean;
  subject: KycSubject;
  submitted?: EmailSubmitted;
}
/** Snake_case wire mirror of {@link EmailRequirement}. */
export interface EmailRequirementWire {
  requirement_type: 'email';
  requirement_id: string;
  label: string;
  mandatory: boolean;
  subject: KycSubjectWire;
  submitted?: EmailSubmittedWire;
}

// ── The union + the discriminated dispatch (DS-DISCRIMINATED) ────────────────────

/** A KYC requirement — discriminated by `requirementType` (architecture §7.8). */
export type KycRequirement =
  | IdentityRequirement
  | SelfieRequirement
  | ProofOfAddressRequirement
  | CompanyDocumentRequirement
  | EiMeiDocumentsRequirement
  | IncomeStatementRequirement
  | ArticlesOfAssociationRequirement
  | EireliIncorporationStatementRequirement
  | EmailRequirement;

/** Snake_case wire mirror of {@link KycRequirement} (discriminated by `requirement_type`). */
export type KycRequirementWire =
  | IdentityRequirementWire
  | SelfieRequirementWire
  | ProofOfAddressRequirementWire
  | CompanyDocumentRequirementWire
  | EiMeiDocumentsRequirementWire
  | IncomeStatementRequirementWire
  | ArticlesOfAssociationRequirementWire
  | EireliIncorporationStatementRequirementWire
  | EmailRequirementWire;

/** Decode a wire {@link IdentityRequirement} (person-specific; nested CNH/RG submitted). */
export function deserializeIdentityRequirement(raw: IdentityRequirementWire): IdentityRequirement {
  return {
    label: raw.label,
    mandatory: raw.mandatory,
    requirementId: raw.requirement_id,
    requirementType: raw.requirement_type,
    subject: deserializeKycSubject(raw.subject),
    ...(raw.submitted !== undefined
      ? { submitted: deserializeIdentitySubmitted(raw.submitted) }
      : {}),
  };
}

/** Decode a wire {@link SelfieRequirement}. */
export function deserializeSelfieRequirement(raw: SelfieRequirementWire): SelfieRequirement {
  return {
    label: raw.label,
    mandatory: raw.mandatory,
    requirementId: raw.requirement_id,
    requirementType: raw.requirement_type,
    subject: deserializeKycSubject(raw.subject),
    ...(raw.submitted !== undefined ? { submitted: deserializeSubmitted(raw.submitted) } : {}),
  };
}

/** Decode a wire {@link ProofOfAddressRequirement}. */
export function deserializeProofOfAddressRequirement(
  raw: ProofOfAddressRequirementWire,
): ProofOfAddressRequirement {
  return {
    label: raw.label,
    mandatory: raw.mandatory,
    requirementId: raw.requirement_id,
    requirementType: raw.requirement_type,
    subject: deserializeKycSubject(raw.subject),
    ...(raw.submitted !== undefined ? { submitted: deserializeSubmitted(raw.submitted) } : {}),
  };
}

/** Decode a wire {@link CompanyDocumentRequirement} (company-wide; no subject). */
export function deserializeCompanyDocumentRequirement(
  raw: CompanyDocumentRequirementWire,
): CompanyDocumentRequirement {
  return {
    label: raw.label,
    mandatory: raw.mandatory,
    requirementId: raw.requirement_id,
    requirementType: raw.requirement_type,
    ...(raw.submitted !== undefined ? { submitted: deserializeSubmitted(raw.submitted) } : {}),
  };
}

/** Decode a wire {@link EiMeiDocumentsRequirement} (company-wide). */
export function deserializeEiMeiDocumentsRequirement(
  raw: EiMeiDocumentsRequirementWire,
): EiMeiDocumentsRequirement {
  return {
    label: raw.label,
    mandatory: raw.mandatory,
    requirementId: raw.requirement_id,
    requirementType: raw.requirement_type,
    ...(raw.submitted !== undefined ? { submitted: deserializeSubmitted(raw.submitted) } : {}),
  };
}

/** Decode a wire {@link IncomeStatementRequirement} (company-wide). */
export function deserializeIncomeStatementRequirement(
  raw: IncomeStatementRequirementWire,
): IncomeStatementRequirement {
  return {
    label: raw.label,
    mandatory: raw.mandatory,
    requirementId: raw.requirement_id,
    requirementType: raw.requirement_type,
    ...(raw.submitted !== undefined ? { submitted: deserializeSubmitted(raw.submitted) } : {}),
  };
}

/** Decode a wire {@link ArticlesOfAssociationRequirement} (company-wide). */
export function deserializeArticlesOfAssociationRequirement(
  raw: ArticlesOfAssociationRequirementWire,
): ArticlesOfAssociationRequirement {
  return {
    label: raw.label,
    mandatory: raw.mandatory,
    requirementId: raw.requirement_id,
    requirementType: raw.requirement_type,
    ...(raw.submitted !== undefined ? { submitted: deserializeSubmitted(raw.submitted) } : {}),
  };
}

/** Decode a wire {@link EireliIncorporationStatementRequirement} (company-wide). */
export function deserializeEireliIncorporationStatementRequirement(
  raw: EireliIncorporationStatementRequirementWire,
): EireliIncorporationStatementRequirement {
  return {
    label: raw.label,
    mandatory: raw.mandatory,
    requirementId: raw.requirement_id,
    requirementType: raw.requirement_type,
    ...(raw.submitted !== undefined ? { submitted: deserializeSubmitted(raw.submitted) } : {}),
  };
}

/** Decode a wire {@link EmailRequirement} (person-specific). */
export function deserializeEmailRequirement(raw: EmailRequirementWire): EmailRequirement {
  return {
    label: raw.label,
    mandatory: raw.mandatory,
    requirementId: raw.requirement_id,
    requirementType: raw.requirement_type,
    subject: deserializeKycSubject(raw.subject),
    ...(raw.submitted !== undefined ? { submitted: deserializeSubmitted(raw.submitted) } : {}),
  };
}

/**
 * Decode any wire {@link KycRequirement} by dispatching on the explicit `requirement_type`
 * discriminator (DS-DISCRIMINATED). The `switch` cases are exactly the openapi
 * `discriminator.mapping` keys; an unmapped value throws {@link kycDispatchError}. This is the
 * template the V0.4 generator reproduces from the schema and the Ruby SDK (V0.3) mirrors as a
 * pattern-match.
 */
export function deserializeKycRequirement(raw: KycRequirementWire): KycRequirement {
  switch (raw.requirement_type) {
    case 'identity':
      return deserializeIdentityRequirement(raw);
    case 'selfie':
      return deserializeSelfieRequirement(raw);
    case 'proof_of_address':
      return deserializeProofOfAddressRequirement(raw);
    case 'company_document':
      return deserializeCompanyDocumentRequirement(raw);
    case 'ei_mei_documents':
      return deserializeEiMeiDocumentsRequirement(raw);
    case 'income_statement':
      return deserializeIncomeStatementRequirement(raw);
    case 'articles_of_association':
      return deserializeArticlesOfAssociationRequirement(raw);
    case 'eireli_incorporation_statement':
      return deserializeEireliIncorporationStatementRequirement(raw);
    case 'email':
      return deserializeEmailRequirement(raw);
    default:
      throw kycDispatchError(
        'KycRequirement',
        'requirement_type',
        (raw as { requirement_type: unknown }).requirement_type,
      );
  }
}
