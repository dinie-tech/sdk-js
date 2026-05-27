/**
 * Idempotency-Key generation (D9).
 *
 * One job: mint a fresh auto-generated key. The `dinie-sdk-retry-` prefix lets the
 * Dinie backend tell an SDK-generated key apart from a user-supplied one.
 *
 * The *policy* around the key lives in `http.ts` (story 007), NOT here:
 *   - only non-GET requests get one,
 *   - the key is generated ONCE before the retry loop so every attempt of the same
 *     logical request reuses it (a retry must never create a duplicate resource),
 *   - a caller can override it via `RequestOptions.idempotencyKey`.
 *
 * This generator is internal to the runtime (imported directly by `http.ts`); it is
 * NOT part of the public SDK surface, so it stays out of the barrel.
 */

import { randomUUID } from 'node:crypto';

/** Prefix marking a key as SDK-auto-generated (vs. user-supplied) on the backend. */
export const IDEMPOTENCY_KEY_PREFIX = 'dinie-sdk-retry-';

/** A fresh auto-generated Idempotency-Key: `dinie-sdk-retry-<uuid v4>`. */
export function generateIdempotencyKey(): string {
  return `${IDEMPOTENCY_KEY_PREFIX}${randomUUID()}`;
}
