/**
 * `KycAttachmentResponse` — the body returned by `POST /customers/{id}/kyc-attachments`
 * (architecture §3.1, §3.4). Hand-authored in V0.2 to mirror future generator output (D1;
 * V0.4 overwrites in place). Wraps the FULL requirement state after the upload, so the caller
 * sees the new review status without a follow-up read.
 *
 * Read-only model (a response body) → deserializer only, no serializer (the convention from
 * `../customer.ts`). Its `requirement` is a {@link KycRequirement}, so the deserializer
 * delegates to {@link deserializeKycRequirement} (the discriminated dispatch).
 *
 * ── runtime ↔ generated boundary ──
 * Lives in `generated/`. Imports only the sibling requirements module. The model type is public
 * surface (via `./index.ts` → the generated barrel); the `*Wire` type + `deserialize*` are
 * internal, consumed by the customers resource (`kycAttachments.create`) and conformance (008).
 */

import {
  deserializeKycRequirement,
  type KycRequirement,
  type KycRequirementWire,
} from './requirements.js';

/** Response from uploading a KYC attachment — the post-upload requirement state. */
export interface KycAttachmentResponse {
  /** Attachment id, `ka_…`. */
  id: string;
  /** The full requirement after this upload. */
  requirement: KycRequirement;
  /** Upload instant, epoch seconds (R-EPOCH). Wire: `uploaded_at`. */
  uploadedAt: number;
}

/** Snake_case wire mirror of {@link KycAttachmentResponse}. */
export interface KycAttachmentResponseWire {
  id: string;
  uploaded_at: number;
  requirement: KycRequirementWire;
}

/** Decode a wire {@link KycAttachmentResponse} (snake→camel, explicit + alphabetical). */
export function deserializeKycAttachmentResponse(
  raw: KycAttachmentResponseWire,
): KycAttachmentResponse {
  return {
    id: raw.id,
    requirement: deserializeKycRequirement(raw.requirement),
    uploadedAt: raw.uploaded_at,
  };
}
