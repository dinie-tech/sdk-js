/**
 * HttpClient — request-lifecycle orchestrator (story 007), key-component tier
 * (architecture §8). One solid pass over the stitched-together lifecycle, all via an
 * injected MockAgent (D3) — zero sockets. A `sleep` spy (the `HttpClientInternals`
 * seam) makes backoff instant and lets us assert the delay actually fed to it.
 *
 * Cases: header assembly · success parse · error mapping (semantic 4xx → typed, no
 * retry) · rate-limit capture · retry integration (retryable status retries with a
 * stable Idempotency-Key + climbing X-Dinie-Retry-Count, up to maxRetries then throws,
 * Retry-After respected) · network-error retry · 401 one-shot (re-auth → success;
 * persistent 401 → AuthError) · idempotency-key override + stability.
 */

import {
  AuthError,
  ConflictError,
  NotFoundError,
  ServerError,
  ValidationError,
} from '../../src/generated/errors/index.js';
import { HttpClient, type InternalRequest } from '../../src/runtime/http.js';
import { useMockUndici } from '../_helpers/mock-undici.js';

const mock = useMockUndici();

/** Build a client on the mock transport, with an instant `sleep` spy for assertions. */
function makeClient(sleep: (ms: number) => Promise<void> = async () => {}): HttpClient {
  return new HttpClient(
    {
      clientId: 'client-abc',
      clientSecret: 'secret-xyz',
      baseUrl: mock.origin,
      dispatcher: mock.dispatcher,
    },
    { sleep },
  );
}

const POST_CUSTOMER: InternalRequest = {
  method: 'POST',
  path: '/v3/customers',
  body: { tax_id: '12345678000190', name: 'Acme Ltda' },
  idempotent: true,
};

const GET_CUSTOMER: InternalRequest = {
  method: 'GET',
  path: '/v3/customers/cus_1',
  idempotent: false,
};

describe('HttpClient — header assembly', () => {
  it('assembles auth, telemetry, idempotency and content-type on a POST', async () => {
    mock.mockToken({ accessToken: 'tok-1' });
    const ep = mock.mockEndpoint({
      method: 'POST',
      path: '/v3/customers',
      responses: { statusCode: 201, body: { id: 'cus_1', object: 'customer' } },
    });
    const client = makeClient();

    await client.request<unknown>(POST_CUSTOMER);

    const req = ep.lastRequest;
    expect(req).toBeDefined();
    expect(req?.headers['authorization']).toBe('Bearer tok-1');
    expect(req?.headers['accept']).toBe('application/json');
    expect(req?.headers['content-type']).toBe('application/json');
    expect(req?.headers['idempotency-key']).toMatch(/^dinie-sdk-retry-/);
    expect(req?.headers['user-agent']).toMatch(
      /^Dinie-SDK-JS\/0\.1\.0 \(api-version=2026-05-10; node\/.+\)$/,
    );
    expect(req?.headers['x-dinie-sdk-language']).toBe('javascript');
    expect(req?.headers['x-dinie-sdk-version']).toBe('0.1.0');
    expect(req?.headers['x-dinie-sdk-runtime']).toMatch(/^node\//);
    // First attempt carries no retry counter.
    expect(req?.headers['x-dinie-retry-count']).toBeUndefined();
    expect(JSON.parse(req?.body ?? '{}')).toEqual({ tax_id: '12345678000190', name: 'Acme Ltda' });
  });

  it('omits the Idempotency-Key and Content-Type on a GET', async () => {
    mock.mockToken();
    const ep = mock.mockEndpoint({
      method: 'GET',
      path: '/v3/customers/cus_1',
      responses: { statusCode: 200, body: { id: 'cus_1' } },
    });

    await makeClient().request<unknown>(GET_CUSTOMER);

    expect(ep.lastRequest?.headers['idempotency-key']).toBeUndefined();
    expect(ep.lastRequest?.headers['content-type']).toBeUndefined();
  });

  it('honors a caller Idempotency-Key override', async () => {
    mock.mockToken();
    const ep = mock.mockEndpoint({
      method: 'POST',
      path: '/v3/customers',
      responses: { statusCode: 201, body: { id: 'cus_1' } },
    });

    await makeClient().request<unknown>({
      ...POST_CUSTOMER,
      options: { idempotencyKey: 'my-key' },
    });

    expect(ep.lastRequest?.headers['idempotency-key']).toBe('my-key');
  });

  it('lets a caller header override a default and a null value remove one', async () => {
    mock.mockToken();
    const ep = mock.mockEndpoint({
      method: 'GET',
      path: '/v3/customers/cus_1',
      responses: { statusCode: 200, body: { id: 'cus_1' } },
    });

    await makeClient().request<unknown>({
      ...GET_CUSTOMER,
      options: { headers: { 'x-dinie-sdk-language': null, 'x-extra': 'yes' } },
    });

    expect(ep.lastRequest?.headers['x-dinie-sdk-language']).toBeUndefined();
    expect(ep.lastRequest?.headers['x-extra']).toBe('yes');
  });
});

describe('HttpClient — success parse', () => {
  it('returns the parsed JSON body on a 2xx', async () => {
    mock.mockToken();
    mock.mockEndpoint({
      method: 'GET',
      path: '/v3/customers/cus_1',
      responses: {
        statusCode: 200,
        body: { id: 'cus_1', object: 'customer', name: 'Acme Ltda' },
      },
    });

    const customer = await makeClient().request<{ id: string; name: string }>(GET_CUSTOMER);

    expect(customer).toEqual({ id: 'cus_1', object: 'customer', name: 'Acme Ltda' });
  });

  it('requestPage returns the typed list envelope', async () => {
    mock.mockToken();
    mock.mockEndpoint({
      method: 'GET',
      path: /^\/v3\/customers/,
      responses: {
        statusCode: 200,
        body: { object: 'list', data: [{ id: 'cus_1' }, { id: 'cus_2' }], has_more: false },
      },
    });

    const page = await makeClient().requestPage<{ id: string }>({
      method: 'GET',
      path: '/v3/customers',
      query: { limit: 2 },
      idempotent: false,
    });

    expect(page.object).toBe('list');
    expect(page.data.map((c) => c.id)).toEqual(['cus_1', 'cus_2']);
    expect(page.has_more).toBe(false);
  });
});

describe('HttpClient — error mapping (semantic 4xx → typed, no retry)', () => {
  it('maps a 404 Problem Details to NotFoundError without retrying', async () => {
    mock.mockToken();
    const sleep = vi.fn(async () => {});
    const ep = mock.mockEndpoint({
      method: 'GET',
      path: '/v3/customers/cus_x',
      responses: {
        statusCode: 404,
        body: {
          type: 'https://docs.dinie.com/errors/not-found',
          title: 'Not found',
          status: 404,
          detail: 'no such customer',
        },
      },
    });

    await expect(
      makeClient(sleep).request<unknown>({
        method: 'GET',
        path: '/v3/customers/cus_x',
        idempotent: false,
      }),
    ).rejects.toBeInstanceOf(NotFoundError);

    expect(ep.callCount).toBe(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it('maps a 422 to ValidationError and a 409 to ConflictError, neither retried', async () => {
    mock.mockToken();
    mock.mockEndpoint({
      method: 'POST',
      path: '/v3/customers',
      responses: { statusCode: 422, body: { status: 422, title: 'invalid' } },
    });
    await expect(makeClient().request<unknown>(POST_CUSTOMER)).rejects.toBeInstanceOf(
      ValidationError,
    );

    const conflict = mock.mockEndpoint({
      method: 'POST',
      path: '/v3/charges',
      responses: { statusCode: 409, body: { status: 409, title: 'conflict' } },
    });
    await expect(
      makeClient().request<unknown>({
        method: 'POST',
        path: '/v3/charges',
        body: {},
        idempotent: true,
      }),
    ).rejects.toBeInstanceOf(ConflictError);
    expect(conflict.callCount).toBe(1);
  });
});

describe('HttpClient — rate-limit capture', () => {
  it('folds X-RateLimit-* headers into the snapshot read by client.rate_limit', async () => {
    mock.mockToken();
    mock.mockEndpoint({
      method: 'GET',
      path: '/v3/customers/cus_1',
      responses: {
        statusCode: 200,
        body: { id: 'cus_1' },
        headers: {
          'x-ratelimit-limit': '100',
          'x-ratelimit-remaining': '99',
          'x-ratelimit-reset': '60',
        },
      },
    });
    const client = makeClient();

    expect(client.rateLimit).toBeNull();
    await client.request<unknown>(GET_CUSTOMER);

    const rl = client.rateLimit;
    expect(rl).not.toBeNull();
    expect(rl?.limit).toBe(100);
    expect(rl?.remaining).toBe(99);
    expect(rl?.resetAt).toBeInstanceOf(Date);
  });
});

describe('HttpClient — retry integration', () => {
  it('retries a 503 → 201 reusing the Idempotency-Key, bumping X-Dinie-Retry-Count, honoring Retry-After', async () => {
    const sleep = vi.fn(async () => {});
    const tokens = mock.mockToken({ accessToken: 'tok-1' });
    const ep = mock.mockEndpoint({
      method: 'POST',
      path: '/v3/customers',
      responses: [
        { statusCode: 503, headers: { 'retry-after': '2' } },
        { statusCode: 201, body: { id: 'cus_1', object: 'customer' } },
      ],
    });

    const result = await makeClient(sleep).request<{ id: string }>(POST_CUSTOMER);

    expect(result).toEqual({ id: 'cus_1', object: 'customer' });
    expect(ep.callCount).toBe(2);

    const [first, second] = ep.requests;
    // Same Idempotency-Key across the retry (D9) — never a duplicate resource.
    expect(first?.headers['idempotency-key']).toBe(second?.headers['idempotency-key']);
    // Retry counter climbs; the same cached token is reused (one token POST).
    expect(first?.headers['x-dinie-retry-count']).toBeUndefined();
    expect(second?.headers['x-dinie-retry-count']).toBe('1');
    expect(first?.headers['authorization']).toBe('Bearer tok-1');
    expect(second?.headers['authorization']).toBe('Bearer tok-1');
    expect(tokens.callCount).toBe(1);
    // Retry-After (2s) takes precedence over computed backoff and is fed to sleep.
    expect(sleep).toHaveBeenCalledTimes(1);
    expect(sleep).toHaveBeenCalledWith(2000);
  });

  it('retries up to maxRetries then throws the typed status error', async () => {
    const sleep = vi.fn(async () => {});
    mock.mockToken();
    const ep = mock.mockEndpoint({
      method: 'POST',
      path: '/v3/customers',
      responses: { statusCode: 503, headers: { 'retry-after': '0' } },
    });

    await expect(
      makeClient(sleep).request<unknown>({ ...POST_CUSTOMER, options: { maxRetries: 2 } }),
    ).rejects.toBeInstanceOf(ServerError);

    // First attempt + 2 retries = 3 calls; 2 backoff sleeps.
    expect(ep.callCount).toBe(3);
    expect(sleep).toHaveBeenCalledTimes(2);
    expect(ep.requests[0]?.headers['x-dinie-retry-count']).toBeUndefined();
    expect(ep.requests[1]?.headers['x-dinie-retry-count']).toBe('1');
    expect(ep.requests[2]?.headers['x-dinie-retry-count']).toBe('2');
  });

  it('retries a transient transport error then succeeds', async () => {
    const sleep = vi.fn(async () => {});
    mock.mockToken();
    const reset = Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' });
    const ep = mock.mockEndpoint({
      method: 'POST',
      path: '/v3/customers',
      responses: [{ error: reset }, { statusCode: 201, body: { id: 'cus_1' } }],
    });

    const result = await makeClient(sleep).request<{ id: string }>(POST_CUSTOMER);

    expect(result).toEqual({ id: 'cus_1' });
    expect(sleep).toHaveBeenCalledTimes(1);
    // The errored attempt is not captured; only the successful reply is.
    expect(ep.callCount).toBe(1);
  });
});

describe('HttpClient — 401 one-shot re-auth', () => {
  it('invalidates the token, re-auths once and succeeds', async () => {
    const sleep = vi.fn(async () => {});
    const tokens = mock.mockToken(); // distinct token per refresh
    const ep = mock.mockEndpoint({
      method: 'POST',
      path: '/v3/customers',
      responses: [
        {
          statusCode: 401,
          body: { type: 'https://docs.dinie.com/errors/authentication-failed', status: 401 },
        },
        { statusCode: 201, body: { id: 'cus_1' } },
      ],
    });

    const result = await makeClient(sleep).request<{ id: string }>(POST_CUSTOMER);

    expect(result).toEqual({ id: 'cus_1' });
    expect(ep.callCount).toBe(2);
    // A fresh token was acquired and used on the retry.
    expect(tokens.callCount).toBe(2);
    expect(ep.requests[0]?.headers['authorization']).toBe('Bearer dinie-test-access-token-1');
    expect(ep.requests[1]?.headers['authorization']).toBe('Bearer dinie-test-access-token-2');
    // Same Idempotency-Key preserved across the re-auth; re-auth is not a backoff sleep.
    expect(ep.requests[0]?.headers['idempotency-key']).toBe(
      ep.requests[1]?.headers['idempotency-key'],
    );
    expect(sleep).not.toHaveBeenCalled();
  });

  it('gives up with AuthError on a persistent 401 (no loop)', async () => {
    const tokens = mock.mockToken();
    const ep = mock.mockEndpoint({
      method: 'GET',
      path: '/v3/customers/cus_1',
      responses: {
        statusCode: 401,
        body: { type: 'https://docs.dinie.com.br/errors/authentication-error', status: 401 },
      },
    });

    await expect(makeClient().request<unknown>(GET_CUSTOMER)).rejects.toBeInstanceOf(AuthError);

    // One-shot only: original attempt + a single re-auth attempt = 2 resource calls,
    // 2 token POSTs. It does not loop.
    expect(ep.callCount).toBe(2);
    expect(tokens.callCount).toBe(2);
  });
});
