/**
 * TokenManager — session mode (V0.5 story 015b).
 *
 * Peer-port of the Python 015a blueprint. Covers T1–T9, lazy init, and mode symmetry:
 *
 *   T1 — exactly one two-step exchange (cc-bearer → session-exchange); single-flight
 *        under N concurrent callers.
 *   T2 — customer bearer used in all subsequent calls (not cc-bearer, not partner bearer).
 *   T3 — without `code`, behaviour is unchanged (partner mode regression guard).
 *   T4 — token-agnostic: no per-route gate; bearer goes on the wire unconditionally.
 *   T5 — expiry honest: after the token expires (or `invalidate()` is called), the next
 *        call raises `SessionTokenExpiredError`; no second exchange; no cc-bearer.
 *   T9 — exchange never succeeded: 401/403 on step 2 propagates the typed `APIError`
 *        from `APIError.fromResponse`; `#exchanged` stays false; single-flight unlocks.
 *
 * The generated error catalog (AuthError/PermissionError) is imported here as a
 * side-effect so the registry is populated and `APIError.fromResponse` dispatches
 * correctly to typed classes for the T9 assertions.
 */

import { APIStatusError, OAuthError, SessionTokenExpiredError } from '../../src/runtime/errors.js';
import { SESSION_EXCHANGE_PATH, TokenManager } from '../../src/runtime/token-manager.js';
import { AuthError } from '../../src/generated/errors/auth-error.js';
import { PermissionError } from '../../src/generated/errors/permission-error.js';
import { useMockUndici } from '../_helpers/mock-undici.js';

const CLIENT_ID = 'client-abc';
const CLIENT_SECRET = 'secret-xyz';
const CODE = 'dinie_bsc_test_code_xyz';
const EXPECTED_BASIC = `Basic ${Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64')}`;

const mock = useMockUndici();

/** Build a TokenManager in session mode. */
function makeSessionManager(): TokenManager {
  return new TokenManager({
    clientId: CLIENT_ID,
    clientSecret: CLIENT_SECRET,
    baseUrl: mock.origin,
    dispatcher: mock.dispatcher,
    code: CODE,
  });
}

/** Build a TokenManager in partner (cc-only) mode. */
function makePartnerManager(): TokenManager {
  return new TokenManager({
    clientId: CLIENT_ID,
    clientSecret: CLIENT_SECRET,
    baseUrl: mock.origin,
    dispatcher: mock.dispatcher,
  });
}

// ── T3: Partner mode unchanged ─────────────────────────────────────────────────────────

describe('T3 — partner mode unchanged (no code)', () => {
  it('returns the cc-bearer, never calls session-exchange', async () => {
    const tokens = mock.mockToken({ accessToken: 'cc-tok-1', expiresIn: 3600 });
    const tm = makePartnerManager();

    const token = await tm.getAccessToken();

    expect(token).toBe('cc-tok-1');
    expect(tokens.callCount).toBe(1);
    // No /biometrics/session-exchange interceptor registered; disableNetConnect would
    // throw if the SDK tried to call it — the test passing is the proof.
  });

  it('refreshes on invalidate — no exchange even after re-auth', async () => {
    const tokens = mock.mockToken({ expiresIn: 3600 });
    const tm = makePartnerManager();

    await tm.getAccessToken();
    tm.invalidate();
    await tm.getAccessToken();

    expect(tokens.callCount).toBe(2);
  });

  it('caches the token — multiple calls hit /auth/token only once', async () => {
    const tokens = mock.mockToken({ accessToken: 'cc-tok-cached', expiresIn: 3600 });
    const tm = makePartnerManager();

    const t1 = await tm.getAccessToken();
    const t2 = await tm.getAccessToken();
    const t3 = await tm.getAccessToken();

    expect(t1).toBe('cc-tok-cached');
    expect(t2).toBe('cc-tok-cached');
    expect(t3).toBe('cc-tok-cached');
    expect(tokens.callCount).toBe(1);
  });
});

// ── Lazy init ─────────────────────────────────────────────────────────────────────────

describe('Lazy init — no I/O on construction', () => {
  it('construction does not trigger any network call', () => {
    // No interceptors registered — any network call would throw (disableNetConnect).
    expect(() => makeSessionManager()).not.toThrow();
  });

  it('first getAccessToken() triggers the two-step exchange', async () => {
    const tokens = mock.mockToken({ accessToken: 'cc-tok', expiresIn: 3600 });
    const exchanges = mock.mockExchange({ accessToken: 'cust-tok-1', expiresIn: 3600 });
    const tm = makeSessionManager();

    const token = await tm.getAccessToken();

    expect(tokens.callCount).toBe(1);
    expect(exchanges.callCount).toBe(1);
    expect(token).toBe('cust-tok-1');
  });
});

// ── T1: Exactly one two-step exchange ─────────────────────────────────────────────────

describe('T1 — exactly one two-step exchange', () => {
  it('emits exactly 1 POST /auth/token and 1 POST /biometrics/session-exchange', async () => {
    const tokens = mock.mockToken({ accessToken: 'cc-tok', expiresIn: 3600 });
    const exchanges = mock.mockExchange({ accessToken: 'cust-tok', expiresIn: 3600 });
    const tm = makeSessionManager();

    await tm.getAccessToken();

    expect(tokens.callCount).toBe(1);
    expect(exchanges.callCount).toBe(1);
  });

  it('exchange request carries the cc-bearer in Authorization (Bearer, not Basic)', async () => {
    mock.mockToken({ accessToken: 'cc-tok-for-exchange', expiresIn: 3600 });
    const exchanges = mock.mockExchange({ accessToken: 'cust-tok', expiresIn: 3600 });
    const tm = makeSessionManager();

    await tm.getAccessToken();

    const req = exchanges.lastRequest;
    expect(req).toBeDefined();
    expect(req!.headers['authorization']).toBe('Bearer cc-tok-for-exchange');
  });

  it('exchange request body contains the code as JSON', async () => {
    mock.mockToken({ accessToken: 'cc-tok', expiresIn: 3600 });
    const exchanges = mock.mockExchange({ accessToken: 'cust-tok', expiresIn: 3600 });
    const tm = makeSessionManager();

    await tm.getAccessToken();

    const req = exchanges.lastRequest;
    expect(req).toBeDefined();
    expect(req!.body).toBe(JSON.stringify({ code: CODE }));
  });

  it('exchange request hits SESSION_EXCHANGE_PATH', async () => {
    mock.mockToken({ accessToken: 'cc-tok', expiresIn: 3600 });
    const exchanges = mock.mockExchange({ accessToken: 'cust-tok', expiresIn: 3600 });
    const tm = makeSessionManager();

    await tm.getAccessToken();

    const req = exchanges.lastRequest;
    expect(req?.path).toBe(SESSION_EXCHANGE_PATH);
  });

  it('N=8 concurrent first-calls → single-flight: still exactly 1 exchange', async () => {
    // Delay keeps the exchange in-flight while all callers queue behind #refreshPromise.
    mock.mockToken({ accessToken: 'cc-tok', delayMs: 10 });
    const exchanges = mock.mockExchange({ accessToken: 'cust-tok-shared', delayMs: 10 });
    const tm = makeSessionManager();

    const N = 8;
    const results = await Promise.all(Array.from({ length: N }, () => tm.getAccessToken()));

    expect(exchanges.callCount).toBe(1);
    expect(new Set(results)).toEqual(new Set(['cust-tok-shared']));
  });

  it('second getAccessToken() reuses the cache — no extra exchange', async () => {
    mock.mockToken({ accessToken: 'cc-tok', expiresIn: 3600 });
    const exchanges = mock.mockExchange({ accessToken: 'cust-tok', expiresIn: 3600 });
    const tm = makeSessionManager();

    const first = await tm.getAccessToken();
    const second = await tm.getAccessToken();
    const third = await tm.getAccessToken();

    expect(exchanges.callCount).toBe(1);
    expect(first).toBe('cust-tok');
    expect(second).toBe('cust-tok');
    expect(third).toBe('cust-tok');
  });
});

// ── T2: Customer bearer in all calls ──────────────────────────────────────────────────

describe('T2 — customer bearer in all subsequent calls', () => {
  it('returns the customer access token (not the cc-bearer)', async () => {
    mock.mockToken({ accessToken: 'cc-tok-should-not-surface' });
    mock.mockExchange({ accessToken: 'customer-tok-xyz' });
    const tm = makeSessionManager();

    const token = await tm.getAccessToken();
    expect(token).toBe('customer-tok-xyz');
    expect(token).not.toBe('cc-tok-should-not-surface');
  });

  it('cc-bearer and customer-bearer are distinct values', async () => {
    mock.mockToken({ accessToken: 'cc-bearer-value' });
    mock.mockExchange({ accessToken: 'customer-bearer-value' });
    const tm = makeSessionManager();

    const token = await tm.getAccessToken();
    expect(token).toBe('customer-bearer-value');
    expect(token).not.toBe('cc-bearer-value');
  });
});

// ── T5: Expiry honest ─────────────────────────────────────────────────────────────────

describe('T5 — expiry honest: SessionTokenExpiredError after exchange', () => {
  it('invalidate() + getAccessToken() raises SessionTokenExpiredError (no second exchange)', async () => {
    mock.mockToken({ accessToken: 'cc-tok', expiresIn: 3600 });
    const exchanges = mock.mockExchange({ accessToken: 'cust-tok', expiresIn: 3600 });
    const tm = makeSessionManager();

    // First call: successful exchange.
    await tm.getAccessToken();
    expect(exchanges.callCount).toBe(1);

    // http.ts calls invalidate() on 401 — simulate that here.
    tm.invalidate();

    // Next call must raise, not re-exchange.
    await expect(tm.getAccessToken()).rejects.toBeInstanceOf(SessionTokenExpiredError);
    expect(exchanges.callCount).toBe(1); // still 1 — no second exchange
  });

  it('natural TTL expiry raises SessionTokenExpiredError (fake Date)', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-05-27T12:00:00.000Z'));

    try {
      // Use a long TTL (3600s) so the token stays fresh during the first call (3600s >
      // REFRESH_MARGIN_MS of 300s). Then advance past 3600s+300s to trigger TTL expiry.
      mock.mockToken({ accessToken: 'cc-tok', expiresIn: 3600 });
      mock.mockExchange({ accessToken: 'cust-tok', expiresIn: 3600 });
      const tm = makeSessionManager();

      await tm.getAccessToken(); // successful exchange; token valid for 3600s

      // Advance past the token's TTL + REFRESH_MARGIN_MS so #needsRefresh() returns true.
      vi.setSystemTime(Date.now() + (3600 + 300 + 1) * 1000);

      await expect(tm.getAccessToken()).rejects.toBeInstanceOf(SessionTokenExpiredError);
    } finally {
      vi.useRealTimers();
    }
  });

  it('SessionTokenExpiredError is not a subclass of OAuthError', async () => {
    mock.mockToken({ accessToken: 'cc-tok', expiresIn: 3600 });
    mock.mockExchange({ accessToken: 'cust-tok', expiresIn: 3600 });
    const tm = makeSessionManager();

    await tm.getAccessToken();
    tm.invalidate();

    const err = await tm.getAccessToken().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SessionTokenExpiredError);
    expect(err).not.toBeInstanceOf(OAuthError);
  });

  it('SessionTokenExpiredError is not an APIStatusError (no HTTP response at expiry)', async () => {
    mock.mockToken({ accessToken: 'cc-tok', expiresIn: 3600 });
    mock.mockExchange({ accessToken: 'cust-tok', expiresIn: 3600 });
    const tm = makeSessionManager();

    await tm.getAccessToken();
    tm.invalidate();

    const err = await tm.getAccessToken().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SessionTokenExpiredError);
    expect(err).not.toBeInstanceOf(APIStatusError);
  });

  it('no cc-bearer on the wire after expiry (T5 ≠ partner mode)', async () => {
    // Only register an exchange interceptor — no token interceptor for post-expiry.
    // If the SDK incorrectly tried to re-do the cc POST after expiry, disableNetConnect
    // would throw. The SessionTokenExpiredError being raised proves no cc call happened.
    mock.mockToken({ accessToken: 'cc-tok', expiresIn: 3600 });
    mock.mockExchange({ accessToken: 'cust-tok', expiresIn: 3600 });
    const tm = makeSessionManager();

    await tm.getAccessToken();
    tm.invalidate();

    await expect(tm.getAccessToken()).rejects.toBeInstanceOf(SessionTokenExpiredError);
  });
});

// ── T9: Exchange failure ───────────────────────────────────────────────────────────────

describe('T9 — exchange never succeeded: typed APIError propagates', () => {
  it('401 on step 2 → AuthError (typed dispatch via APIError.fromResponse)', async () => {
    mock.mockToken({ accessToken: 'cc-tok' });
    mock.mockExchange({ statusCode: 401 });
    const tm = makeSessionManager();

    const err = await tm.getAccessToken().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AuthError);
  });

  it('403 on step 2 → PermissionError (typed dispatch via APIError.fromResponse)', async () => {
    mock.mockToken({ accessToken: 'cc-tok' });
    mock.mockExchange({ statusCode: 403 });
    const tm = makeSessionManager();

    const err = await tm.getAccessToken().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(PermissionError);
  });

  it('#exchanged stays false after a failed exchange (T9 ≠ T5)', async () => {
    // Set up: first call fails (401), then a second mock is available for a retry.
    // The second call should attempt the exchange again (not raise SessionTokenExpiredError)
    // because #exchanged was never set.
    mock.mockToken({ accessToken: 'cc-tok' });
    mock.mockExchange({ statusCode: 401 });
    const tm = makeSessionManager();

    // First call: exchange fails with AuthError.
    await expect(tm.getAccessToken()).rejects.toBeInstanceOf(AuthError);

    // Second call: should attempt the exchange again (same 401 → same AuthError).
    // If #exchanged were incorrectly set to true, this would throw SessionTokenExpiredError instead.
    await expect(tm.getAccessToken()).rejects.toBeInstanceOf(AuthError);
    await expect(tm.getAccessToken()).rejects.not.toBeInstanceOf(SessionTokenExpiredError);
  });

  it('no token is cached after a failed exchange — retry succeeds on next call', async () => {
    // Sequence: call 1 → 401 (fail), call 2 → 200 (success). Use a single persistent
    // interceptor with status/accessToken callbacks so the second call re-uses the same mock.
    mock.mockToken({ accessToken: 'cc-tok' });
    const exchanges = mock.mockExchange({
      statusCode: (call) => (call === 1 ? 401 : 200),
      accessToken: 'cust-tok-retry',
      expiresIn: 3600,
    });
    const tm = makeSessionManager();

    // First call: exchange fails with AuthError.
    await expect(tm.getAccessToken()).rejects.toBeInstanceOf(AuthError);
    expect(exchanges.callCount).toBe(1);

    // Second call: #exchanged is still false → retries exchange → succeeds.
    const token = await tm.getAccessToken();
    expect(token).toBe('cust-tok-retry');
    expect(exchanges.callCount).toBe(2);
  });

  it('single-flight unlocks on exchange failure — later call retries', async () => {
    // Delay ensures callers queue behind the in-flight exchange.
    mock.mockToken({ accessToken: 'cc-tok', delayMs: 10 });
    mock.mockExchange({ statusCode: 401, delayMs: 10 });
    const tm = makeSessionManager();

    const N = 6;
    const settled = await Promise.allSettled(
      Array.from({ length: N }, () => tm.getAccessToken()),
    );

    // All callers should have failed with AuthError (not wedged indefinitely).
    expect(settled.every((r) => r.status === 'rejected')).toBe(true);
    for (const result of settled) {
      if (result.status === 'rejected') {
        expect(result.reason).toBeInstanceOf(AuthError);
      }
    }
  });

  it('T9 error is not a SessionTokenExpiredError', async () => {
    mock.mockToken({ accessToken: 'cc-tok' });
    mock.mockExchange({ statusCode: 401 });
    const tm = makeSessionManager();

    const err = await tm.getAccessToken().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AuthError);
    expect(err).not.toBeInstanceOf(SessionTokenExpiredError);
  });
});

// ── Mode symmetry ─────────────────────────────────────────────────────────────────────

describe('Mode symmetry — session vs partner side-by-side', () => {
  it('session and partner managers are independent instances', async () => {
    mock.mockToken({ expiresIn: 3600 });
    mock.mockExchange({ expiresIn: 3600 });

    const session = makeSessionManager();
    const partner = makePartnerManager();

    const sessionToken = await session.getAccessToken();
    const partnerToken = await partner.getAccessToken();

    // session returns the customer bearer; partner returns the cc-bearer
    expect(sessionToken).toContain('customer');
    expect(partnerToken).not.toContain('customer');
  });

  it('partner mode invalidate/re-auth does NOT raise SessionTokenExpiredError', async () => {
    mock.mockToken({ expiresIn: 3600 });
    const tm = makePartnerManager();

    await tm.getAccessToken();
    tm.invalidate();

    // Should re-acquire normally, not throw SessionTokenExpiredError.
    await expect(tm.getAccessToken()).resolves.toBeDefined();
  });
});
