/**
 * `Credentials` resource surface tests (story 006) — exercises `create` / `list` / `revoke` end
 * to end over a mocked `undici` transport (D3), ZERO network (`MockAgent` + `disableNetConnect`,
 * owned by `useMockUndici`). Mirrors the credit-offers tests (story 005): one focused case per
 * method asserting path/method, the camelCase ↔ snake_case bridge (via the generated
 * serializers — story 002), idempotency behaviour, and cursor pagination on `list`.
 *
 * The `create` case is the SECRET-BEARING anchor: it proves `clientSecret` rides ONLY the
 * creation response, while `list` returns plain `Credential`s with no secret. Imports ONLY the
 * curated barrel (`../../src/index.js`) — the real partner entry point.
 */

import { Dinie } from '../../src/index.js';
import type { Credential, CredentialWithSecret } from '../../src/index.js';
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

/** A snake_case wire credential WITHOUT a secret (the `list`/read shape). */
function wireCredential(id: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id,
    client_id: id,
    name: 'Chave de Produção',
    status: 'active',
    last_used_at: 1772877600,
    expires_at: null,
    created_at: 1772791200,
    updated_at: 1772877600,
    ...extra,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Compile-only guard: the return types are exactly right (secret only on create).
// Never executed — `tsc --noEmit` fails if the surface drifts.
// ─────────────────────────────────────────────────────────────────────────────
async function _credentialsTypes(): Promise<void> {
  const client = makeClient();
  expectTypeOf(
    client.credentials.create({ name: 'k' }),
  ).resolves.toEqualTypeOf<CredentialWithSecret>();
  expectTypeOf(client.credentials.revoke('dinie_ci_1')).resolves.toEqualTypeOf<void>();
  // `list` items are plain `Credential` — no `clientSecret` field.
  const page = await client.credentials.list();
  expectTypeOf(page.data[0]!).toEqualTypeOf<Credential>();
  // @ts-expect-error a plain Credential has no `clientSecret` (secret is creation-only).
  void page.data[0]!.clientSecret;
}
void _credentialsTypes;

describe('credentials.create — POST, idempotent, secret only on creation', () => {
  it('serializes the request, attaches an Idempotency-Key, and returns the one-time secret', async () => {
    mock.mockToken();
    const endpoint = mock.mockEndpoint({
      method: 'POST',
      path: '/v3/auth/credentials',
      responses: {
        statusCode: 201,
        body: wireCredential('dinie_ci_new', {
          expires_at: 1803945600,
          last_used_at: null,
          client_secret: 'dinie_cs_live_a1b2c3d4',
        }),
      },
    });
    const client = makeClient();

    const credential = await client.credentials.create({
      name: 'Chave de Produção',
      expiresAt: 1803945600,
    });

    expect(endpoint.lastRequest?.method).toBe('POST');
    expect(endpoint.lastRequest?.path).toBe('/v3/auth/credentials');
    // POST write → auto X-Idempotency-Key (R4/D9).
    expect(endpoint.lastRequest?.headers['x-idempotency-key']).toMatch(/^dinie-sdk-retry-/);
    // camelCase params → snake_case wire body (expiresAt → expires_at).
    expect(JSON.parse(endpoint.lastRequest!.body)).toEqual({
      expires_at: 1803945600,
      name: 'Chave de Produção',
    });
    // The secret rides ONLY the creation response.
    expect(credential.clientSecret).toBe('dinie_cs_live_a1b2c3d4');
    expect(credential.id).toBe('dinie_ci_new');
    expect(credential.clientId).toBe('dinie_ci_new');
    expect(credential.status).toBe('active');
    expect(credential.expiresAt).toBe(1803945600);
    expect(credential.lastUsedAt).toBeNull();
  });

  it('omits expires_at when not provided (R-OPTIONAL)', async () => {
    mock.mockToken();
    const endpoint = mock.mockEndpoint({
      method: 'POST',
      path: '/v3/auth/credentials',
      responses: { statusCode: 201, body: wireCredential('dinie_ci_x', { client_secret: 's' }) },
    });
    const client = makeClient();

    await client.credentials.create({ name: 'No-expiry key' });

    expect(JSON.parse(endpoint.lastRequest!.body)).toEqual({ name: 'No-expiry key' });
  });
});

describe('credentials.list — auto-pagination via for await (has_more)', () => {
  it('iterates every credential across pages, threading starting_after, stopping on has_more:false', async () => {
    mock.mockToken();
    const endpoint = mock.mockEndpoint({
      method: 'GET',
      path: /^\/v3\/auth\/credentials(\?|$)/,
      responses: [
        {
          statusCode: 200,
          body: {
            data: [wireCredential('dinie_ci_a'), wireCredential('dinie_ci_b')],
            has_more: true,
          },
        },
        { statusCode: 200, body: { data: [wireCredential('dinie_ci_c')], has_more: false } },
      ],
    });
    const client = makeClient();

    const collected: Credential[] = [];
    for await (const credential of client.credentials.list({ limit: 2 })) {
      collected.push(credential);
    }

    expect(collected.map((c) => c.id)).toEqual(['dinie_ci_a', 'dinie_ci_b', 'dinie_ci_c']);
    // camelCase-mapped through the public surface (not raw wire); no secret on listed items.
    expect(collected[0]!.lastUsedAt).toBe(1772877600);
    expect('clientSecret' in collected[0]!).toBe(false);
    // Two fetches: page 1 (no cursor), page 2 (starting_after = last id of page 1).
    expect(endpoint.callCount).toBe(2);
    expect(endpoint.requests[0]!.path).toContain('limit=2');
    expect(endpoint.requests[0]!.path).not.toContain('starting_after');
    expect(endpoint.requests[1]!.path).toContain('starting_after=dinie_ci_b');
  });
});

describe('credentials.revoke — DELETE → void (204), naturally idempotent (no key)', () => {
  it('DELETEs the credential path and resolves to undefined on a 204 empty body', async () => {
    mock.mockToken();
    const endpoint = mock.mockEndpoint({
      method: 'DELETE',
      path: '/v3/auth/credentials/dinie_ci_1',
      responses: { statusCode: 204, body: '' },
    });
    const client = makeClient();

    const result = await client.credentials.revoke('dinie_ci_1');

    expect(result).toBeUndefined();
    expect(endpoint.lastRequest?.method).toBe('DELETE');
    expect(endpoint.lastRequest?.path).toBe('/v3/auth/credentials/dinie_ci_1');
    // DELETE is naturally idempotent (§3.1 marks it "—") → no auto Idempotency-Key.
    expect(endpoint.lastRequest?.headers['x-idempotency-key']).toBeUndefined();
  });
});
