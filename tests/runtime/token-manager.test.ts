/**
 * TokenManager — OAuth2 Client Credentials (D6), risky-core tier (architecture §8).
 *
 * Exhaustive cases (a)–(f): transparent acquisition, cached reuse, proactive refresh
 * at the 300s margin, the concurrency lock (N callers → exactly ONE token POST),
 * the 401 invalidate/re-acquire seam, and persistent-failure → OAuthError with no
 * loop. All network goes through an injected MockAgent (D3) — zero sockets.
 */

import { OAuthError } from '../../src/runtime/errors.js';
import { TokenManager } from '../../src/runtime/token-manager.js';
import { useMockUndici } from '../_helpers/mock-undici.js';

const CLIENT_ID = 'client-abc';
const CLIENT_SECRET = 'secret-xyz';
const EXPECTED_BASIC = `Basic ${Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64')}`;

const mock = useMockUndici();

function makeManager(): TokenManager {
  return new TokenManager({
    clientId: CLIENT_ID,
    clientSecret: CLIENT_SECRET,
    baseUrl: mock.origin,
    dispatcher: mock.dispatcher,
  });
}

describe('TokenManager.getAccessToken', () => {
  it('(a) acquires a Bearer token transparently on the first call, with the right request', async () => {
    const tokens = mock.mockToken({ accessToken: 'tok-1', expiresIn: 3600 });
    const tm = makeManager();

    const token = await tm.getAccessToken();

    expect(token).toBe('tok-1');
    expect(tokens.callCount).toBe(1);

    const req = tokens.lastRequest;
    expect(req).toBeDefined();
    expect(req?.method).toBe('POST');
    expect(req?.path).toBe('/v3/auth/token');
    expect(req?.headers['authorization']).toBe(EXPECTED_BASIC);
    expect(req?.headers['content-type']).toBe('application/x-www-form-urlencoded');
    expect(req?.body).toBe('grant_type=client_credentials');
  });

  it('(b) reuses the cached token on the fast path — no second POST', async () => {
    const tokens = mock.mockToken({ accessToken: 'tok-1', expiresIn: 3600 });
    const tm = makeManager();

    const first = await tm.getAccessToken();
    const second = await tm.getAccessToken();
    const third = await tm.getAccessToken();

    expect(second).toBe(first);
    expect(third).toBe(first);
    expect(tokens.callCount).toBe(1);
  });

  describe('(c) proactive refresh at the 300s margin (fake Date)', () => {
    beforeEach(() => {
      // Fake only `Date` so `needsRefresh()` is time-controlled while undici's own
      // timers (mock reply delivery) keep running for real.
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(new Date('2026-05-27T12:00:00.000Z'));
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    it('keeps the token while outside the margin, then refreshes once inside it', async () => {
      const tokens = mock.mockToken({ expiresIn: 3600 }); // distinct token per refresh
      const tm = makeManager();

      const first = await tm.getAccessToken();
      expect(tokens.callCount).toBe(1);

      // 54m59s in — still > 300s from expiry → fast path, no new POST.
      vi.setSystemTime(Date.now() + (3600 - 300 - 1) * 1000);
      expect(await tm.getAccessToken()).toBe(first);
      expect(tokens.callCount).toBe(1);

      // Two more seconds → now within 300s of expiry → refresh.
      vi.setSystemTime(Date.now() + 2_000);
      const refreshed = await tm.getAccessToken();
      expect(tokens.callCount).toBe(2);
      expect(refreshed).not.toBe(first);
    });
  });

  it('(d) de-dupes N concurrent callers into exactly ONE token POST (shared lock)', async () => {
    // Delay keeps the single refresh in flight while all callers queue behind it.
    const tokens = mock.mockToken({ accessToken: 'tok-shared', delayMs: 25 });
    const tm = makeManager();

    const N = 12;
    const results = await Promise.all(Array.from({ length: N }, () => tm.getAccessToken()));

    expect(tokens.callCount).toBe(1);
    expect(results).toHaveLength(N);
    expect(new Set(results)).toEqual(new Set(['tok-shared']));

    // A later call still reads the cache — one POST total.
    expect(await tm.getAccessToken()).toBe('tok-shared');
    expect(tokens.callCount).toBe(1);
  });

  it('(e) invalidate() drops the token so the next call re-acquires (401 one-shot seam)', async () => {
    const tokens = mock.mockToken({ expiresIn: 3600 }); // distinct token per refresh
    const tm = makeManager();

    const first = await tm.getAccessToken();
    expect(tokens.callCount).toBe(1);

    // http.ts calls invalidate() after a 401, then asks for a token again.
    tm.invalidate();

    const second = await tm.getAccessToken();
    expect(tokens.callCount).toBe(2);
    expect(second).not.toBe(first);
  });
});

describe('TokenManager refresh failures → OAuthError (no loop)', () => {
  it('(f) rejects with OAuthError on a persistent 401, one POST per call', async () => {
    const tokens = mock.mockToken({ statusCode: 401 });
    const tm = makeManager();

    await expect(tm.getAccessToken()).rejects.toBeInstanceOf(OAuthError);
    expect(tokens.callCount).toBe(1);

    // The lock cleared on failure, so a later call retries exactly once more —
    // it is not wedged and does not spin in a loop.
    await expect(tm.getAccessToken()).rejects.toBeInstanceOf(OAuthError);
    expect(tokens.callCount).toBe(2);
  });

  it('de-dupes concurrent failing refreshes into a single POST; every caller rejects', async () => {
    const tokens = mock.mockToken({ statusCode: 500, delayMs: 25 });
    const tm = makeManager();

    const settled = await Promise.allSettled(Array.from({ length: 8 }, () => tm.getAccessToken()));

    expect(tokens.callCount).toBe(1);
    expect(settled.every((r) => r.status === 'rejected')).toBe(true);
    for (const result of settled) {
      if (result.status === 'rejected') {
        expect(result.reason).toBeInstanceOf(OAuthError);
      }
    }
  });

  it('recovers on a subsequent call after a transient failure', async () => {
    const tokens = mock.mockToken({ statusCode: (call) => (call === 1 ? 503 : 200) });
    const tm = makeManager();

    await expect(tm.getAccessToken()).rejects.toBeInstanceOf(OAuthError);
    const token = await tm.getAccessToken();

    expect(token).toBe('dinie-test-access-token-2');
    expect(tokens.callCount).toBe(2);
  });

  it('rejects with OAuthError when the token body is malformed (missing access_token)', async () => {
    mock.mockToken({ body: { token_type: 'Bearer', expires_in: 3600 } });
    const tm = makeManager();

    await expect(tm.getAccessToken()).rejects.toBeInstanceOf(OAuthError);
  });

  it('rejects with OAuthError when the transport itself fails (no response)', async () => {
    // No interceptor registered + disableNetConnect → the request rejects, which
    // the manager wraps as OAuthError rather than leaking the transport error.
    const tm = makeManager();

    await expect(tm.getAccessToken()).rejects.toBeInstanceOf(OAuthError);
  });
});
