/**
 * OAuth2 Client Credentials token manager (D6).
 *
 * Acquires and transparently refreshes the Bearer token the rest of the SDK rides
 * on. The Dinie token endpoint speaks RFC 6749 client_credentials:
 *
 *   POST {baseUrl}/v3/auth/token
 *   Authorization: Basic base64("{clientId}:{clientSecret}")
 *   Content-Type:  application/x-www-form-urlencoded
 *   body:          grant_type=client_credentials
 *   → 200 { access_token, token_type: "Bearer", expires_in }
 *
 * Three behaviours make this one of the risky-core modules:
 *
 *   1. Proactive refresh — the cached token is considered stale `REFRESH_MARGIN_MS`
 *      (300s) BEFORE its real expiry, so a request never races the boundary.
 *   2. Concurrency lock — a single shared `#refreshPromise` de-dupes concurrent
 *      refreshes: N simultaneous `getAccessToken()` callers trigger exactly ONE
 *      token POST and all await the same promise. A post-await double-check guards
 *      against a refresh that resolved without producing a usable token.
 *   3. 401 invalidation — `invalidate()` drops the cached token. The 401 one-shot
 *      re-auth itself is orchestrated by `http.ts` (D6/story 007); this module only
 *      exposes the seam and never loops on requests itself.
 *
 * Transport is an injected `undici.Dispatcher` (D3) — tests pass a `MockAgent`, so
 * no network is touched. Adapted from `openai-node`
 * `src/auth/workload-identity-auth.ts` (client_credentials instead of token
 * exchange; the refresh lives inside the auth helper, no placeholder-key hack).
 *
 * ── runtime ↔ generated boundary ──
 * Lives in `runtime/`, imports only `./errors.js` + `undici`, and is NOT part of the
 * public barrel: `http.ts`/`client.ts` construct it internally (architecture §6).
 */

import type { Dispatcher } from 'undici';

import { OAuthError } from './errors.js';

/** Token endpoint path, appended to the configured `baseUrl`. */
const TOKEN_PATH = '/v3/auth/token';

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
  /** API origin (e.g. `https://api.dinie.com.br`); the token path is resolved against it. */
  baseUrl: string;
  /** Injected undici transport — production passes a `Pool`, tests a `MockAgent`. */
  dispatcher: Dispatcher;
}

/** Wire response of `POST /v3/auth/token` (architecture §4.3). */
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
 * Transparent OAuth2 Client Credentials token cache with a concurrency-safe refresh.
 *
 * State machine (architecture §10.1): Empty → Refreshing → Valid; concurrent
 * refreshes are serialized by `#refreshPromise`; `invalidate()` returns to Empty.
 */
export class TokenManager {
  readonly #clientId: string;
  readonly #clientSecret: string;
  /** Absolute token URL; `origin`/`pathname` are handed to the dispatcher separately. */
  readonly #tokenUrl: URL;
  readonly #dispatcher: Dispatcher;

  /** Cached token, or `null` when empty/invalidated. */
  #token: CachedToken | null = null;
  /** The in-flight refresh shared by concurrent callers, or `null` when idle (the lock). */
  #refreshPromise: Promise<void> | null = null;

  constructor(options: TokenManagerOptions) {
    this.#clientId = options.clientId;
    this.#clientSecret = options.clientSecret;
    this.#tokenUrl = new URL(TOKEN_PATH, options.baseUrl);
    this.#dispatcher = options.dispatcher;
  }

  /**
   * Return a valid Bearer access token, acquiring or refreshing transparently.
   *
   * Fast path: a cached token still inside the margin is returned without a request.
   * Otherwise a single shared refresh runs (de-duping concurrent callers via
   * `#refreshPromise`); after awaiting it, a double-check ensures a usable token
   * actually landed — if not, the refresh failed and we surface `OAuthError`.
   *
   * @throws {OAuthError} The token refresh did not yield a usable token.
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
   */
  invalidate(): void {
    this.#token = null;
  }

  /** True when there is no token, or the cached one is within `REFRESH_MARGIN_MS` of expiry. */
  #needsRefresh(): boolean {
    return this.#token === null || Date.now() >= this.#token.expiresAt - REFRESH_MARGIN_MS;
  }

  /** Perform the actual token POST and cache the result. Throws `OAuthError` on any failure. */
  async #doRefresh(): Promise<void> {
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
    // Anchor expiry on "now" so the margin math holds regardless of request latency.
    this.#token = {
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
