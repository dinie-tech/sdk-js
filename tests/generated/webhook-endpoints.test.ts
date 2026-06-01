/**
 * `WebhookEndpoints` resource surface tests (story 006) — exercises all 6 methods (`create` /
 * `delete` / `get` / `list` / `rotateSecret` / `update`) end to end over a mocked `undici`
 * transport (D3), ZERO network (`MockAgent` + `disableNetConnect`). Mirrors the credit-offers
 * tests (story 005): one focused case per method asserting path/method, the camelCase ↔
 * snake_case bridge (story 002), idempotency, cursor pagination on `list`, and `void` on `204`.
 *
 * This is REST management of webhook endpoints — distinct from webhook event reception
 * (`Webhooks.extract`, story 007). The secret-bearing anchors: `create` → `secret` and
 * `rotateSecret` → new `secret` (shown once); `list`/`get`/`update` carry NO secret. Imports ONLY
 * the curated barrel (`../../src/index.js`).
 */

import { Dinie } from '../../src/index.js';
import type {
  WebhookEndpoint,
  WebhookEndpointWithSecret,
  WebhookSecretRotation,
} from '../../src/index.js';
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

/** A snake_case wire webhook endpoint WITHOUT a secret (the `list`/`get`/`update` shape). */
function wireEndpoint(id: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id,
    url: 'https://parceiro.example.com/webhooks/dinie',
    events: ['customer.active', 'credit_offer.available', 'loan.*'],
    description: 'Webhook de produção',
    status: 'active',
    created_at: 1772791200,
    updated_at: 1772877600,
    ...extra,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Compile-only guard: secret only on create/rotateSecret; void on delete.
// Never executed — `tsc --noEmit` fails if the surface drifts.
// ─────────────────────────────────────────────────────────────────────────────
async function _webhookEndpointTypes(): Promise<void> {
  const client = makeClient();
  expectTypeOf(
    client.webhookEndpoints.create({ url: 'https://x' }),
  ).resolves.toEqualTypeOf<WebhookEndpointWithSecret>();
  expectTypeOf(client.webhookEndpoints.retrieve('we_1')).resolves.toEqualTypeOf<WebhookEndpoint>();
  expectTypeOf(
    client.webhookEndpoints.update('we_1', { status: 'disabled' }),
  ).resolves.toEqualTypeOf<WebhookEndpoint>();
  expectTypeOf(client.webhookEndpoints.delete('we_1')).resolves.toEqualTypeOf<void>();
  expectTypeOf(
    client.webhookEndpoints.rotateSecret('we_1'),
  ).resolves.toEqualTypeOf<WebhookSecretRotation>();
  // A plain endpoint (get/list/update) has no `secret`.
  const ep = await client.webhookEndpoints.retrieve('we_1');
  // @ts-expect-error secret is creation/rotation-only.
  void ep.secret;
}
void _webhookEndpointTypes;

describe('webhookEndpoints.create — POST, idempotent, secret only on creation', () => {
  it('serializes the request, attaches an Idempotency-Key, and returns the one-time secret', async () => {
    mock.mockToken();
    const endpoint = mock.mockEndpoint({
      method: 'POST',
      path: '/webhooks/endpoints',
      responses: {
        statusCode: 201,
        body: wireEndpoint('we_new', { secret: 'whsec_a1b2c3d4' }),
      },
    });
    const client = makeClient();

    const created = await client.webhookEndpoints.create({
      url: 'https://parceiro.example.com/webhooks/dinie',
      events: ['customer.active', 'loan.*'],
      description: 'Webhook de produção',
    });

    expect(endpoint.lastRequest?.method).toBe('POST');
    expect(endpoint.lastRequest?.path).toBe('/webhooks/endpoints');
    expect(endpoint.lastRequest?.headers['x-idempotency-key']).toMatch(/^dinie-sdk-retry-/);
    // camelCase params → snake_case wire body (all fields present here).
    expect(JSON.parse(endpoint.lastRequest!.body)).toEqual({
      description: 'Webhook de produção',
      events: ['customer.active', 'loan.*'],
      url: 'https://parceiro.example.com/webhooks/dinie',
    });
    // The secret rides ONLY the creation response.
    expect(created.secret).toBe('whsec_a1b2c3d4');
    expect(created.id).toBe('we_new');
    expect(created.status).toBe('active');
    expect(created.events).toEqual(['customer.active', 'credit_offer.available', 'loan.*']);
  });
});

describe('webhookEndpoints.retrieve — round-trips an endpoint by id', () => {
  it('GETs the resource path and maps the wire response to a camelCase WebhookEndpoint (no secret)', async () => {
    mock.mockToken();
    const endpoint = mock.mockEndpoint({
      method: 'GET',
      path: '/webhooks/endpoints/we_42',
      responses: { statusCode: 200, body: wireEndpoint('we_42') },
    });
    const client = makeClient();

    const ep = await client.webhookEndpoints.retrieve('we_42');

    expect(endpoint.lastRequest?.method).toBe('GET');
    expect(endpoint.lastRequest?.path).toBe('/webhooks/endpoints/we_42');
    expect(ep.id).toBe('we_42');
    expect(ep.url).toBe('https://parceiro.example.com/webhooks/dinie');
    expect(ep.createdAt).toBe(1772791200);
    expect('secret' in ep).toBe(false);
  });
});

describe('webhookEndpoints.list — auto-pagination via for await (has_more)', () => {
  it('iterates every endpoint across pages, threading starting_after, stopping on has_more:false', async () => {
    mock.mockToken();
    const endpoint = mock.mockEndpoint({
      method: 'GET',
      path: /^\/webhooks\/endpoints(\?|$)/,
      responses: [
        {
          statusCode: 200,
          body: { data: [wireEndpoint('we_a'), wireEndpoint('we_b')], has_more: true },
        },
        { statusCode: 200, body: { data: [wireEndpoint('we_c')], has_more: false } },
      ],
    });
    const client = makeClient();

    const collected: WebhookEndpoint[] = [];
    for await (const ep of client.webhookEndpoints.list({ limit: 2 })) {
      collected.push(ep);
    }

    expect(collected.map((e) => e.id)).toEqual(['we_a', 'we_b', 'we_c']);
    expect(collected[0]!.status).toBe('active');
    expect(endpoint.callCount).toBe(2);
    expect(endpoint.requests[0]!.path).toContain('limit=2');
    expect(endpoint.requests[0]!.path).not.toContain('starting_after');
    expect(endpoint.requests[1]!.path).toContain('starting_after=we_b');
  });
});

describe('webhookEndpoints.update — PATCH, idempotent, partial body', () => {
  it('sends only the set keys and maps the updated endpoint back', async () => {
    mock.mockToken();
    const endpoint = mock.mockEndpoint({
      method: 'PATCH',
      path: '/webhooks/endpoints/we_1',
      responses: {
        statusCode: 200,
        body: wireEndpoint('we_1', { events: ['customer.*', 'loan.*'], status: 'disabled' }),
      },
    });
    const client = makeClient();

    const updated = await client.webhookEndpoints.update('we_1', {
      events: ['customer.*', 'loan.*'],
      status: 'disabled',
    });

    expect(endpoint.lastRequest?.method).toBe('PATCH');
    expect(endpoint.lastRequest?.path).toBe('/webhooks/endpoints/we_1');
    // PATCH write → auto X-Idempotency-Key (even though the openapi op omits the param — §7.4).
    expect(endpoint.lastRequest?.headers['x-idempotency-key']).toMatch(/^dinie-sdk-retry-/);
    // Only the keys the caller set are emitted (R-OPTIONAL).
    expect(JSON.parse(endpoint.lastRequest!.body)).toEqual({
      events: ['customer.*', 'loan.*'],
      status: 'disabled',
    });
    expect(updated.status).toBe('disabled');
    expect(updated.events).toEqual(['customer.*', 'loan.*']);
  });
});

describe('webhookEndpoints.delete — DELETE → void (204), naturally idempotent (no key)', () => {
  it('DELETEs the endpoint path and resolves to undefined on a 204 empty body', async () => {
    mock.mockToken();
    const endpoint = mock.mockEndpoint({
      method: 'DELETE',
      path: '/webhooks/endpoints/we_1',
      responses: { statusCode: 204, body: '' },
    });
    const client = makeClient();

    const result = await client.webhookEndpoints.delete('we_1');

    expect(result).toBeUndefined();
    expect(endpoint.lastRequest?.method).toBe('DELETE');
    expect(endpoint.lastRequest?.path).toBe('/webhooks/endpoints/we_1');
    expect(endpoint.lastRequest?.headers['x-idempotency-key']).toBeUndefined();
  });
});

describe('webhookEndpoints.rotateSecret — POST sub-path, idempotent, returns a new secret', () => {
  it('POSTs the rotate-secret sub-path and maps the WebhookSecretRotation result', async () => {
    mock.mockToken();
    const endpoint = mock.mockEndpoint({
      method: 'POST',
      path: '/webhooks/endpoints/we_1/rotate-secret',
      responses: {
        statusCode: 200,
        body: {
          id: 'we_1',
          secret: 'whsec_novo1b2c3',
          previous_secret_expires_at: 1709550000,
        },
      },
    });
    const client = makeClient();

    const rotation = await client.webhookEndpoints.rotateSecret('we_1', { expireCurrentIn: 3600 });

    expect(endpoint.lastRequest?.method).toBe('POST');
    expect(endpoint.lastRequest?.path).toBe('/webhooks/endpoints/we_1/rotate-secret');
    expect(endpoint.lastRequest?.headers['x-idempotency-key']).toMatch(/^dinie-sdk-retry-/);
    // Optional grace-period param → snake_case wire body (expireCurrentIn → expire_current_in).
    expect(JSON.parse(endpoint.lastRequest!.body)).toEqual({ expire_current_in: 3600 });
    // The new secret + the old secret's grace deadline.
    expect(rotation.secret).toBe('whsec_novo1b2c3');
    expect(rotation.id).toBe('we_1');
    expect(rotation.previousSecretExpiresAt).toBe(1709550000);
  });

  it('sends an empty body when no params are passed (server default grace period)', async () => {
    mock.mockToken();
    const endpoint = mock.mockEndpoint({
      method: 'POST',
      path: '/webhooks/endpoints/we_2/rotate-secret',
      responses: {
        statusCode: 200,
        body: { id: 'we_2', secret: 'whsec_x', previous_secret_expires_at: 1 },
      },
    });
    const client = makeClient();

    await client.webhookEndpoints.rotateSecret('we_2');

    expect(JSON.parse(endpoint.lastRequest!.body)).toEqual({});
  });
});
