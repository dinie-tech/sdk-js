/**
 * `Money` — the shared monetary value type (architecture §3.4). Hand-authored in V0.2 to
 * mirror what the generator will emit from `components.schemas.Money` (V0.4 overwrites this
 * file in place — D1).
 *
 * The contract defines `Money` as `type: number, format: double` (BRL). The SDK surfaces it
 * as a plain `number` — no cents/bigint wrapper, no currency object — because that is what
 * the wire carries and a faithful, deterministic mapping does not invent structure the
 * contract does not express. A `number` round-trips losslessly through `JSON.parse`.
 *
 * ── runtime ↔ generated boundary ──
 * Lives in `generated/`. Pure type alias; depends on nothing (and never on `runtime/`).
 * Re-exported as public surface via the generated barrel and `src/index.ts`.
 */

/** A monetary value in BRL (`type: number, format: double`). */
export type Money = number;
