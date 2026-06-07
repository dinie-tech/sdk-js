/**
 * Conformance · errors — proves the RFC 9457 problem+json examples in the contract dispatch to
 * the right typed error class with the right `code`/`type`/`status`/`request_id` (story 008,
 * architecture §11, §6). Data-driven over every `application/problem+json` example the loader
 * finds; each DISTINCT payload becomes one `it` case (the contract reuses the same shapes — e.g.
 * the shared `RateLimited`/`InternalError`/`BearerTokenUnauthorized` responses — across dozens of
 * operations, so we dedupe by payload and log how many raw occurrences collapsed, rather than
 * test identical bytes scores of times: distinct signal, no silent truncation).
 *
 * ── How the round-trip works for errors ──
 * Build a synthetic HTTP error response (statusCode = the example's `status`, an injected
 * `x-request-id` header, body = the example JSON) and run it through the SAME entry point the
 * transport uses, `APIError.fromResponse`. Assert:
 *   • the instance is the class the `type` URL maps to (dispatch-by-type, the openapi catalog);
 *   • `.status` / `.type` / `.code` echo the example (`code` is `undefined` when the example omits it);
 *   • `.request_id` surfaces the injected `x-request-id` header (the support-flow contract, §5.3).
 * No network, no time, no randomness — the request id is derived from the case index.
 *
 * ── Coverage of the 8 server-response classes (§6.1) ──
 * Seven type URLs appear in the contract with examples → 7 classes covered: BadRequest(400),
 * Auth(401), NotFound(404), Conflict(409), Validation(422), RateLimit(429), Server(500). The 8th,
 * `PermissionDeniedError` (403 / `…/errors/forbidden`), is an ORPHAN: that type URL and any 403 are
 * ABSENT from the contract (tracked openapi PR **P1** — the SDK keeps the class as documented
 * debt, architecture §6.1/§6.4/§10). So it gets no example coverage here BY DESIGN; the gate
 * asserts exactly {8 classes} − {PermissionDeniedError} are covered, and flags P1 — it is not a regression.
 */

import { loadExamples, type ExampleRecord } from './loader.js';
import {
  APIError,
  APIStatusError,
  AuthError,
  BadRequestError,
  ConflictError,
  NotFoundError,
  PermissionDeniedError,
  RateLimitError,
  ServerError,
  ValidationError,
} from '../../src/index.js';

/** Shape of an RFC 9457 problem+json example (the fields the SDK surfaces). */
interface ProblemExample {
  readonly type: string;
  readonly title: string;
  readonly status: number;
  readonly detail?: string;
  readonly code?: string;
}

type ErrorClass = typeof APIStatusError;

/** openapi error `type` URL → the typed SDK class it must dispatch to (§6.1). */
const TYPE_URL_TO_CLASS: Record<string, ErrorClass> = {
  'https://docs.dinie.com/errors/invalid-request': BadRequestError,
  'https://docs.dinie.com/errors/authentication-failed': AuthError,
  'https://docs.dinie.com/errors/forbidden': PermissionDeniedError,
  'https://docs.dinie.com/errors/not-found': NotFoundError,
  'https://docs.dinie.com/errors/conflict': ConflictError,
  'https://docs.dinie.com/errors/validation-failed': ValidationError,
  'https://docs.dinie.com/errors/rate-limit-exceeded': RateLimitError,
  'https://docs.dinie.com/errors/internal': ServerError,
};

/** All 8 catalog classes now have contract-backed type URLs (P1 resolved in api-docs@3218365). */
const EXPECTED_UNCOVERED: Record<string, string> = {};

const ALL_CATALOG_CLASSES: Record<string, ErrorClass> = {
  BadRequestError,
  AuthError,
  PermissionDeniedError,
  NotFoundError,
  ConflictError,
  ValidationError,
  RateLimitError,
  ServerError,
};

// ── Build the deduped distinct-payload case list (deterministic, document order) ─────────────────

type ErrorResponse = Parameters<typeof APIError.fromResponse>[0];

function makeResponse(status: number, body: ProblemExample, requestId: string): ErrorResponse {
  return {
    statusCode: status,
    headers: { 'x-request-id': requestId },
    body: { text: () => Promise.resolve(JSON.stringify(body)) },
  };
}

const problemRecords = loadExamples().filter((r) => r.mediaType === 'application/problem+json');

interface ErrorCase {
  readonly label: string;
  readonly value: ProblemExample;
  readonly expectedClass: ErrorClass;
}

const distinctByPayload = new Map<string, ExampleRecord>();
for (const record of problemRecords) {
  const key = JSON.stringify(record.exampleValue);
  if (!distinctByPayload.has(key)) distinctByPayload.set(key, record);
}

const errorCases: ErrorCase[] = [];
const coveredTypeUrls = new Set<string>();
const unknownTypeUrls: Array<{ location: string; type: unknown }> = [];

for (const record of distinctByPayload.values()) {
  const value = record.exampleValue as ProblemExample;
  const expectedClass = TYPE_URL_TO_CLASS[value.type];
  if (expectedClass === undefined) {
    unknownTypeUrls.push({ location: record.location, type: value.type });
    continue;
  }
  coveredTypeUrls.add(value.type);
  const codeSuffix = value.code !== undefined ? ` code=${value.code}` : '';
  errorCases.push({
    label: `${value.status} ${expectedClass.name}${codeSuffix} · ${record.location}`,
    value,
    expectedClass,
  });
}

// ── The data-driven suite ────────────────────────────────────────────────────────────────────

describe('conformance · problem+json → typed error class', () => {
  it('found problem+json examples across the catalog', () => {
    expect(errorCases.length).toBeGreaterThan(0);
    expect(unknownTypeUrls).toEqual([]); // a new error type URL in the contract would land here
  });

  it.each(errorCases)('$label', async (errorCase: ErrorCase) => {
    const requestId = `req_conf_${errorCase.value.status}_${errorCase.value.code ?? 'none'}`;
    const err = await APIError.fromResponse(
      makeResponse(errorCase.value.status, errorCase.value, requestId),
    );

    expect(err).toBeInstanceOf(errorCase.expectedClass);
    expect(err).toBeInstanceOf(APIStatusError);

    const statusError = err as APIStatusError;
    expect(statusError.status).toBe(errorCase.value.status);
    expect(statusError.type).toBe(errorCase.value.type);
    expect(statusError.code).toBe(errorCase.value.code);
    expect(statusError.request_id).toBe(requestId);
  });
});

// ── Coverage gate ──────────────────────────────────────────────────────────────────────────────

describe('conformance · errors coverage gate', () => {
  it('every catalog class is covered by an example (all 8 now contract-backed — P1 resolved)', () => {
    const covered = new Set<string>();
    for (const [typeUrl, klass] of Object.entries(TYPE_URL_TO_CLASS)) {
      if (coveredTypeUrls.has(typeUrl)) covered.add(klass.name);
    }

    const missing = Object.keys(ALL_CATALOG_CLASSES).filter(
      (name) => !covered.has(name) && EXPECTED_UNCOVERED[name] === undefined,
    );

    // eslint-disable-next-line no-console
    console.log(
      [
        '── conformance error coverage ──',
        `problem+json example records:          ${problemRecords.length}`,
        `distinct payloads tested:              ${errorCases.length}`,
        `catalog classes covered by example:    ${[...covered].sort().join(', ')}`,
        `catalog classes intentionally uncovered: ${Object.keys(EXPECTED_UNCOVERED).join(', ')} ` +
          `— ${Object.values(EXPECTED_UNCOVERED).join('; ')}`,
      ].join('\n'),
    );

    expect(missing).toEqual([]);
    // 403/forbidden is now contract-backed (api-docs@3218365 — P1 resolved). Must be covered.
    expect(coveredTypeUrls.has('https://docs.dinie.com/errors/forbidden')).toBe(true);
  });
});
