/**
 * `Banks` resource surface tests (story 006) — exercises `list` end to end over a mocked
 * `undici` transport (D3), ZERO network (`MockAgent` + `disableNetConnect`).
 *
 * The headline assertion is the story's KEY OPEN QUESTION (§7.5): `/banks` does NOT paginate.
 * Its `200` response is a flat `{ data: Bank[] }` envelope with NO `has_more`, so `banks.list`
 * returns a plain `Promise<Bank[]>` (an awaitable array), NOT a `PagePromise`. The compile-only
 * guard pins the return type; the runtime case proves the whole directory comes back in one call
 * and is camelCase-mapped. Imports ONLY the curated barrel (`../../src/index.js`).
 */

import { Dinie } from '../../src/index.js';
import type { Bank } from '../../src/index.js';
import { useMockUndici } from '../_helpers/mock-undici.js';

const mock = useMockUndici();

/** Build the public `Dinie` client over the mocked transport (the D3 seam). */
function makeClient(): Dinie {
  return new Dinie({
    clientId: 'test-client',
    clientSecret: 'test-secret',
    baseUrl: mock.origin,
    dispatcher: mock.dispatcher,
  });
}

/** A snake_case wire bank (the openapi example shape). */
function wireBank(id: string, name: string): Record<string, unknown> {
  return { id, name, display_name: `${id} - ${name}` };
}

// ─────────────────────────────────────────────────────────────────────────────
// Compile-only guard: `/banks` is FLAT — `list` resolves `Bank[]`, NOT a PagePromise.
// Never executed — `tsc --noEmit` fails if the surface drifts to pagination.
// ─────────────────────────────────────────────────────────────────────────────
async function _banksTypes(): Promise<void> {
  const client = makeClient();
  expectTypeOf(client.banks.list()).resolves.toEqualTypeOf<Bank[]>();
}
void _banksTypes;

describe('banks.list — flat directory (NOT paginated — §7.5)', () => {
  it('GETs /banks once and returns the full deserialized Bank[] (no has_more, no cursor)', async () => {
    mock.mockToken();
    const endpoint = mock.mockEndpoint({
      method: 'GET',
      path: '/banks',
      // Flat `{ data }` envelope — deliberately NO `has_more` (the contract's shape).
      responses: {
        statusCode: 200,
        body: {
          data: [
            wireBank('001', 'Banco do Brasil'),
            wireBank('033', 'Santander'),
            wireBank('237', 'Bradesco'),
          ],
        },
      },
    });
    const client = makeClient();

    const banks = await client.banks.list();

    // A plain array (awaited once), not a paginated stream.
    expect(Array.isArray(banks)).toBe(true);
    expect(banks).toHaveLength(3);
    // camelCase-mapped through the public surface (display_name → displayName).
    expect(banks[0]).toEqual({
      id: '001',
      name: 'Banco do Brasil',
      displayName: '001 - Banco do Brasil',
    });
    expect(banks.map((b) => b.id)).toEqual(['001', '033', '237']);
    // Exactly ONE call — no follow-up page fetch (the list is not cursor-paginated).
    expect(endpoint.callCount).toBe(1);
    expect(endpoint.lastRequest?.method).toBe('GET');
    expect(endpoint.lastRequest?.path).toBe('/banks');
    // GET read → no Idempotency-Key.
    expect(endpoint.lastRequest?.headers['x-idempotency-key']).toBeUndefined();
  });

  it('returns an empty array when the directory is empty', async () => {
    mock.mockToken();
    mock.mockEndpoint({
      method: 'GET',
      path: '/banks',
      responses: { statusCode: 200, body: { data: [] } },
    });
    const client = makeClient();

    const banks = await client.banks.list();

    expect(banks).toEqual([]);
  });
});
