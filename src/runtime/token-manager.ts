/**
 * OAuth2 token manager — client credentials (partner mode) + session mode (D6 / V0.5).
 *
 * ## Partner mode (default)
 *
 * Acquires and transparently refreshes the Bearer token the rest of the SDK rides on.
 * The Dinie token endpoint speaks RFC 6749 client_credentials:
 *
 *   POST {baseUrl}/auth/token
 *   Authorization: Basic base64("{clientId}:{clientSecret}")
 *   Content-Type:  application/x-www-form-urlencoded
 *   body:          grant_type=client_credentials
 *   → 200 { access_token, token_type: "Bearer", expires_in }
 *
 * ## Session mode (`code` provided)
 *
 * When an authorization `code` (e.g. `dinie_bsc_…`) is supplied, the manager uses a
 * two-step exchange on the first `getAccessToken()`:
 *   1. POST /auth/token (client credentials) → cc-bearer (not cached)
 *   2. POST /biometrics/session-exchange  Authorization: Bearer <cc-bearer>
 *                                          body: {"code": "<code>"}
 *      → 200 { access_token, token_type, expires_in, customer_id }
 * The customer-scoped token from step 2 is cached. The `code` is single-use; no
 * re-exchange is possible. Once the customer token expires, `SessionTokenExpiredError`
 * is raised on the next `getAccessToken()` (T5). A failed exchange (401/403 in step 2)
 * propagates the typed `APIError` from `APIError.fromResponse` without caching (T9).
 *
 * ## Shared behaviours
 *
 *   1. Proactive refresh — cached token is considered stale `REFRESH_MARGIN_MS` (300s)
 *      BEFORE its real expiry (partner mode only; session mode never re-exchanges).
 *   2. Concurrency lock — `#refreshPromise` de-dupes concurrent `getAccessToken()`
 *      callers: N simultaneous first-calls trigger exactly ONE token POST and all await
 *      the same promise. A post-await double-check guards against a refresh that
 *      resolved without producing a usable token.
 *   3. 401 invalidation — `invalidate()` drops the cached token. In session mode, the
 *      `#exchanged` flag is preserved so the next call raises `SessionTokenExpiredError`
 *      (T5) rather than re-attempting the exchange.
 *
 * Transport is an injected `undici.Dispatcher` (D3) — tests pass a `MockAgent`, so
 * no network is touched. Adapted from `openai-node`
 * `src/auth/workload-identity-auth.ts` (client_credentials instead of token exchange;
 * the refresh lives inside the auth helper, no placeholder-key hack).
 *
 * ── runtime ↔ generated boundary ──
 * Lives in `runtime/`, imports only `./errors.js` + `undici`, and is NOT part of the
 * public barrel: `http.ts`/`client.ts` construct it internally (architecture §6).
 */

import type { Dispatcher } from 'undici';

import { APIError, OAuthError, SessionTokenExpiredError } from './errors.js';

/** Token endpoint path, appended to the configured `baseUrl`. */
const TOKEN_PATH = '/auth/token';

/**
 * Session exchange endpoint path — appended to the configured `baseUrl` in session
 * mode. Peer of `TOKEN_PATH`; runtime hand-written (outside the no-domain-names lint).
 */
export const SESSION_EXCHANGE_PATH = '/biometrics/session-exchange';

/**
 * Refresh the token this many milliseconds BEFORE its stated expiry (300s). The
 * margin absorbs clock skew and in-flight latency so a live request never carries a
 * token that expires mid-flight.
 */
const REFRESH_MARGIN_MS = 300_000;

/** Constructor inputs. `dispatcher` is the D3 transport seam (default: a real Pool, wired by `http.ts`). */
export interface TokenManagerOptions {
  clientId: string;
  clientSecret: string;
  /**
   * API base URL incl. the version prefix (e.g. `https://api.dinie.com.br/api/v3`); the bare
   * token path is resolved against it, preserving the base pathname.
   */
  baseUrl: string;
  /** Injected undici transport — production passes a `Pool`, tests a `MockAgent`. */
  dispatcher: Dispatcher;
  /**
   * Customer authorization code (`dinie_bsc_…`), obtained from the biometric session
   * exchange flow. When provided, the manager operates in **session mode**: the first
   * `getAccessToken()` performs a two-step exchange (client-credentials → session) and
   * caches the resulting customer-scoped token. The code is single-use; once the token
   * expires, `SessionTokenExpiredError` is raised. Omit (or `undefined`) for the default
   * partner / client-credentials mode.
   */
  code?: string;
}

/** Wire response of `POST /auth/token` or `POST /biometrics/session-exchange`. */
interface TokenResponse {
  access_token: string;
  token_type: 'Bearer';
  /** Lifetime in seconds. */
  expires_in: number;
}

/** Cached token plus its absolute expiry (epoch ms), computed at acquisition time. */
interface CachedToken {
  accessToken: string;
  expiresAt: number;
}

/**
 * Transparent OAuth2 token cache with a concurrency-safe refresh.
 *
 * State machine (architecture §10.1): Empty → Refreshing → Valid; concurrent
 * refreshes are serialized by `#refreshPromise`; `invalidate()` returns to Empty.
 * In session mode, the state machine is one-way: once `#exchanged` is set it stays
 * set (Empty is re-entered by invalidate, but the next Refreshing → Valid transition
 * raises `SessionTokenExpiredError` instead of re-exchanging).
 */
export class TokenManager {
  readonly #clientId: string;
  readonly #clientSecret: string;
  /** Absolute token URL; `origin`/`pathname` are handed to the dispatcher separately. */
  readonly #tokenUrl: URL;
  /** Absolute session-exchange URL; constructed from the same base as `#tokenUrl`. */
  readonly #exchangeUrl: URL;
  readonly #dispatcher: Dispatcher;

  /** Cached token, or `null` when empty/invalidated. */
  #token: CachedToken | null = null;
  /** The in-flight refresh shared by concurrent callers, or `null` when idle (the lock). */
  #refreshPromise: Promise<void> | null = null;

  /**
   * Session mode: the one-time authorization code (null = partner/cc mode).
   * Readonly after construction — the same manager always operates in the same mode.
   */
  readonly #code: string | null;

  /**
   * True once a successful session exchange has been completed. In session mode, after
   * a successful exchange the token is never re-exchanged; when it expires (or after
   * `invalidate()` is called), `SessionTokenExpiredError` is raised instead (T5).
   *
   * Set AFTER `#performExchange()` returns successfully so that a failed exchange (T9)
   * leaves this `false` — `#exchanged` distinguishes "expired" (T5) from "never
   * succeeded" (T9).
   */
  #exchanged: boolean = false;

  constructor(options: TokenManagerOptions) {
    this.#clientId = options.clientId;
    this.#clientSecret = options.clientSecret;
    // Preserve the base pathname (e.g. `/api/v3`) that the bare, absolute TOKEN_PATH would
    // otherwise REPLACE: join `basePath + '/auth/token'` against the origin so the token URL
    // matches the openapi server (`…/api/v3/auth/token`). An origin-only base yields `/auth/token`.
    const base = new URL(options.baseUrl);
    const basePath = base.pathname.replace(/\/+$/, '');
    this.#tokenUrl = new URL(`${basePath}${TOKEN_PATH}`, base.origin);
    this.#exchangeUrl = new URL(`${basePath}${SESSION_EXCHANGE_PATH}`, base.origin);
    this.#dispatcher = options.dispatcher;
    this.#code = options.code ?? null;
  }

  /**
   * Return a valid Bearer access token, acquiring or refreshing transparently.
   *
   * Fast path: a cached token still inside the margin is returned without a request.
   * Otherwise a single shared refresh runs (de-duping concurrent callers via
   * `#refreshPromise`); after awaiting it, a double-check ensures a usable token
   * actually landed — if not, the refresh failed and we surface `OAuthError`.
   *
   * In session mode, once the customer token expires, `SessionTokenExpiredError` is
   * raised (T5). The `#doRefresh` rejection propagates through `await #refreshPromise`
   * and this method re-throws it directly (the double-check is never reached).
   *
   * @throws {OAuthError} The token refresh did not yield a usable token (partner mode).
   * @throws {SessionTokenExpiredError} Session token expired; obtain a fresh code (T5).
   * @throws {APIError} Session exchange failed (T9 — propagated from `APIError.fromResponse`).
   */
  async getAccessToken(): Promise<string> {
    if (this.#token !== null && !this.#needsRefresh()) {
      return this.#token.accessToken; // fast path — cached and inside the margin
    }

    // Lock: the first caller starts the refresh; the rest reuse the same promise.
    // `finally` clears the lock whether the refresh resolves or rejects, so a later
    // call can try again (no permanently-stuck lock, no infinite loop).
    this.#refreshPromise ??= this.#doRefresh().finally(() => {
      this.#refreshPromise = null;
    });

    await this.#refreshPromise;

    // Double-check after awaiting: a concurrent `invalidate()` or a refresh that
    // resolved without a token means we have nothing valid to hand back.
    if (this.#token === null || this.#needsRefresh()) {
      throw new OAuthError('OAuth2 token refresh failed.');
    }
    return this.#token.accessToken;
  }

  /**
   * Drop the cached token. Called by `http.ts` on a 401 so the next
   * `getAccessToken()` re-authenticates (the one-shot re-auth is orchestrated there).
   *
   * In session mode, `#exchanged` is intentionally NOT cleared: the next
   * `getAccessToken()` call will raise `SessionTokenExpiredError` (T5) rather than
   * re-attempting the exchange (the code is single-use).
   */
  invalidate(): void {
    this.#token = null;
  }

  /** True when there is no token, or the cached one is within `REFRESH_MARGIN_MS` of expiry. */
  #needsRefresh(): boolean {
    return this.#token === null || Date.now() >= this.#token.expiresAt - REFRESH_MARGIN_MS;
  }

  /**
   * Main refresh orchestrator — branches by mode:
   *   - Partner mode (`#code === null`): client-credentials POST + cache.
   *   - Session mode, first call (`!#exchanged`): two-step exchange + cache + set `#exchanged`.
   *   - Session mode, expired (`#exchanged`): throw `SessionTokenExpiredError` (T5).
   */
  async #doRefresh(): Promise<void> {
    if (this.#code === null) {
      // Partner mode: client credentials only.
      const cached = await this.#performClientCredentials();
      this.#token = cached;
    } else if (this.#exchanged) {
      // Session mode — already exchanged; customer token expired. No second exchange.
      throw new SessionTokenExpiredError(
        'Customer session token expired. The authorization code is single-use — ' +
          'obtain a fresh code and construct a new Dinie({ ..., code }) instance.',
      );
    } else {
      // Session mode — first call: two-step exchange.
      // Step 1: acquire cc-bearer (NOT cached — only needed for the exchange header).
      const cc = await this.#performClientCredentials();
      // Step 2: exchange cc-bearer + code for customer-scoped token.
      const sessionCached = await this.#performExchange(cc.accessToken, this.#code);
      // Set `#exchanged` AFTER `#performExchange` returns successfully so that a failed
      // exchange (T9) leaves `#exchanged = false` — the next call will retry the exchange
      // rather than raising `SessionTokenExpiredError`.
      this.#token = sessionCached;
      this.#exchanged = true;
    }
  }

  /**
   * Perform the client-credentials token POST and return the resulting `CachedToken`.
   * Does NOT mutate `#token` — the caller (`#doRefresh`) decides.
   * Throws `OAuthError` on any transport or protocol failure.
   */
  async #performClientCredentials(): Promise<CachedToken> {
    const credentials = Buffer.from(`${this.#clientId}:${this.#clientSecret}`).toString('base64');

    let response: Dispatcher.ResponseData;
    try {
      response = await this.#dispatcher.request({
        origin: this.#tokenUrl.origin,
        path: this.#tokenUrl.pathname,
        method: 'POST',
        headers: {
          authorization: `Basic ${credentials}`,
          'content-type': 'application/x-www-form-urlencoded',
        },
        body: 'grant_type=client_credentials',
      });
    } catch (cause) {
      throw new OAuthError('OAuth2 token request failed before a response was received.', {
        cause,
      });
    }

    if (response.statusCode < 200 || response.statusCode >= 300) {
      const detail = await readBodyText(response.body);
      throw new OAuthError(formatStatusFailure(response.statusCode, detail));
    }

    let parsed: unknown;
    try {
      parsed = await response.body.json();
    } catch (cause) {
      throw new OAuthError('OAuth2 token response body was not valid JSON.', { cause });
    }

    const token = parseTokenResponse(parsed);
    return {
      accessToken: token.access_token,
      expiresAt: Date.now() + token.expires_in * 1000,
    };
  }

  /**
   * Perform the session exchange: `POST /biometrics/session-exchange` with the cc-bearer
   * in `Authorization` and `{ code }` in the JSON body. Returns the customer-scoped
   * `CachedToken` on success.
   *
   * On a non-2xx response, throws the typed `APIError` from `APIError.fromResponse`
   * (T9 semantics — `AuthError` for 401, `PermissionError` for 403, etc.; no new class).
   * On a transport failure, throws `OAuthError`.
   */
  async #performExchange(ccToken: string, code: string): Promise<CachedToken> {
    let response: Dispatcher.ResponseData;
    try {
      response = await this.#dispatcher.request({
        origin: this.#exchangeUrl.origin,
        path: this.#exchangeUrl.pathname,
        method: 'POST',
        headers: {
          authorization: `Bearer ${ccToken}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ code }),
      });
    } catch (cause) {
      throw new OAuthError('Session exchange request failed before a response was received.', {
        cause,
      });
    }

    if (response.statusCode < 200 || response.statusCode >= 300) {
      // Propagate as a typed API error (T9): AuthError on 401, PermissionError on 403, …
      // Mirrors the `http.ts` pattern (no new error class — DD-5).
      throw await APIError.fromResponse(response);
    }

    let parsed: unknown;
    try {
      parsed = await response.body.json();
    } catch (cause) {
      throw new OAuthError('Session exchange response body was not valid JSON.', { cause });
    }

    const token = parseTokenResponse(parsed);
    return {
      accessToken: token.access_token,
      expiresAt: Date.now() + token.expires_in * 1000,
    };
  }
}

/** Validate the wire payload into a `TokenResponse`, throwing `OAuthError` if malformed. */
function parseTokenResponse(value: unknown): TokenResponse {
  if (typeof value !== 'object' || value === null) {
    throw new OAuthError('OAuth2 token response was not a JSON object.');
  }
  const record = value as Record<string, unknown>;
  const accessToken = record['access_token'];
  const expiresIn = record['expires_in'];
  if (typeof accessToken !== 'string' || accessToken.length === 0) {
    throw new OAuthError('OAuth2 token response was missing a valid "access_token".');
  }
  if (typeof expiresIn !== 'number' || !Number.isFinite(expiresIn) || expiresIn <= 0) {
    throw new OAuthError('OAuth2 token response was missing a valid "expires_in".');
  }
  return {
    access_token: accessToken,
    token_type: 'Bearer',
    expires_in: expiresIn,
  };
}

/** Compose a concise failure message for a non-2xx token response. */
function formatStatusFailure(statusCode: number, detail: string): string {
  const suffix = detail.length > 0 ? `: ${detail}` : '';
  return `OAuth2 token request failed with status ${statusCode}${suffix}`;
}

/** Read a response body to text, swallowing read errors (best-effort error detail). */
async function readBodyText(body: { text(): Promise<string> }): Promise<string> {
  try {
    return (await body.text()).trim();
  } catch {
    return '';
  }
}
