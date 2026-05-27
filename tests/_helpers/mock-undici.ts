/**
 * Network-free transport harness for the runtime tests — born here (story 006),
 * extended by the http/customers stories (007/010).
 *
 * Wraps an `undici.MockAgent` with `disableNetConnect()` so the entire suite runs
 * without a socket: any request the SDK makes is matched against a registered
 * interceptor, and an unmatched request throws (proving the SDK made no surprise
 * calls). The same `MockAgent` is the `Dispatcher` injected into the units under
 * test (the D3 seam) — `new TokenManager({ ..., dispatcher: mock.dispatcher })`.
 *
 * Lifecycle is owned here: `useMockUndici()` registers `beforeEach`/`afterEach`
 * hooks that spin up a fresh agent per test and close it afterwards, so no mock
 * state leaks between tests.
 *
 * ── Extension contract (stories 007 / 010) ──
 * Add resource builders as methods on `MockUndici`, mirroring `mockToken()`:
 *   - `mockCustomer(...)`     → intercept `POST /v3/customers` / `GET /v3/customers/:id`
 *   - `mockCustomerPage(...)` → intercept `GET /v3/customers?limit=&starting_after=`
 * Each builder should register on `this.pool`, capture requests via the reply
 * callback, and return a handle exposing `callCount` + captured `requests`, exactly
 * like {@link TokenMock}. Keep the request-capture helpers (`normalizeHeaders`,
 * `captureRequest`) shared.
 */

import type { Dispatcher, Interceptable } from 'undici';
import { MockAgent } from 'undici';

/** Default API origin used across the runtime tests. */
export const DEFAULT_ORIGIN = 'https://api.dinie.test';

/** Path of the OAuth2 token endpoint (kept in sync with `token-manager.ts`). */
const TOKEN_PATH = '/v3/auth/token';

/** A request as captured by an interceptor's reply callback (for assertions). */
export interface CapturedRequest {
  method: string;
  path: string;
  /** Request headers, lowercased keys. */
  headers: Record<string, string>;
  /** Raw request body as a string (empty when absent). */
  body: string;
}

/** Options for {@link MockUndici.mockToken}. All fields optional with sensible defaults. */
export interface MockTokenOptions {
  /**
   * Access token to return. A function receives the 1-based call ordinal so each
   * refresh can yield a distinct token (the default), making "a new token was
   * acquired" assertions trivial. Pass a string to pin a fixed token.
   */
  accessToken?: string | ((call: number) => string);
  /** `token_type` in the response. Default `'Bearer'`. */
  tokenType?: string;
  /** `expires_in` (seconds) in the response. Default `3600`. */
  expiresIn?: number;
  /**
   * HTTP status to reply with. A function receives the 1-based call ordinal so a
   * mock can fail then recover (e.g. `(call) => (call === 1 ? 500 : 200)`).
   * Default `200`.
   */
  statusCode?: number | ((call: number) => number);
  /**
   * Override the entire response body (e.g. to exercise malformed-payload handling).
   * When set, it is returned verbatim regardless of `accessToken`/`expiresIn`.
   */
  body?: string | object | Buffer;
  /**
   * Delay each reply by this many milliseconds. Used by the concurrency test to keep
   * the refresh in flight while all N callers queue behind the shared lock.
   */
  delayMs?: number;
}

/** Handle returned by {@link MockUndici.mockToken} for asserting on token traffic. */
export interface TokenMock {
  /** Number of `POST /v3/auth/token` calls the SDK has made so far. */
  readonly callCount: number;
  /** Every captured token request, in order. */
  readonly requests: readonly CapturedRequest[];
  /** The most recent token request, or `undefined` before the first call. */
  readonly lastRequest: CapturedRequest | undefined;
}

/**
 * A `MockAgent`-backed transport for one test. Create via {@link useMockUndici},
 * which manages its per-test lifecycle. Expose the agent as `dispatcher` to inject
 * it (D3), and register interceptors with the `mockX()` builders.
 */
export class MockUndici {
  readonly origin: string;
  #agent: MockAgent | null = null;
  #pool: Interceptable | null = null;

  constructor(origin: string) {
    this.origin = origin;
  }

  /** Spin up a fresh, network-disabled agent + origin pool. Called from `beforeEach`. */
  start(): void {
    const agent = new MockAgent();
    agent.disableNetConnect();
    this.#agent = agent;
    this.#pool = agent.get(this.origin);
  }

  /** Tear down the agent. Called from `afterEach`. */
  async stop(): Promise<void> {
    const agent = this.#agent;
    this.#agent = null;
    this.#pool = null;
    if (agent !== null) await agent.close();
  }

  /** The injectable transport (the `MockAgent` itself). Pass as `dispatcher`. */
  get dispatcher(): Dispatcher {
    if (this.#agent === null) {
      throw new Error('MockUndici is not started — use useMockUndici() so beforeEach starts it.');
    }
    return this.#agent;
  }

  /** The origin pool interceptors are registered on (shared by every `mockX()` builder). */
  get pool(): Interceptable {
    if (this.#pool === null) {
      throw new Error('MockUndici is not started — use useMockUndici() so beforeEach starts it.');
    }
    return this.#pool;
  }

  /**
   * Intercept `POST /v3/auth/token`, replying with an OAuth2 token response. The
   * interceptor is persistent (serves every call) and records each request so tests
   * can assert the POST count and request shape (Basic auth, form body).
   */
  mockToken(options: MockTokenOptions = {}): TokenMock {
    const accessToken =
      options.accessToken ?? ((call: number) => `dinie-test-access-token-${call}`);
    const tokenType = options.tokenType ?? 'Bearer';
    const expiresIn = options.expiresIn ?? 3600;
    const statusCode = options.statusCode ?? 200;
    const requests: CapturedRequest[] = [];

    const scope = this.pool
      .intercept({ path: TOKEN_PATH, method: 'POST' })
      .reply((opts) => {
        const call = requests.length + 1; // 1-based ordinal for this match
        requests.push(captureRequest(opts, TOKEN_PATH));

        const status = typeof statusCode === 'function' ? statusCode(call) : statusCode;
        const responseOptions = { headers: { 'content-type': 'application/json' } };

        if (options.body !== undefined) {
          return { statusCode: status, data: options.body, responseOptions };
        }
        if (status < 200 || status >= 300) {
          return {
            statusCode: status,
            data: { error: 'invalid_client', error_description: 'token request rejected' },
            responseOptions,
          };
        }
        const token = typeof accessToken === 'function' ? accessToken(call) : accessToken;
        return {
          statusCode: status,
          data: { access_token: token, token_type: tokenType, expires_in: expiresIn },
          responseOptions,
        };
      })
      .persist();

    if (options.delayMs !== undefined) scope.delay(options.delayMs);

    return {
      get callCount() {
        return requests.length;
      },
      get requests() {
        return requests;
      },
      get lastRequest() {
        return requests[requests.length - 1];
      },
    };
  }
}

/**
 * Install a {@link MockUndici} for the surrounding test scope: a fresh agent is
 * started in `beforeEach` and closed in `afterEach`. Returns the handle to register
 * mocks and read `dispatcher` inside each test.
 *
 * @example
 * const mock = useMockUndici();
 * it('acquires a token', async () => {
 *   const tokens = mock.mockToken();
 *   const tm = new TokenManager({ ...creds, baseUrl: mock.origin, dispatcher: mock.dispatcher });
 *   await tm.getAccessToken();
 *   expect(tokens.callCount).toBe(1);
 * });
 */
export function useMockUndici(origin: string = DEFAULT_ORIGIN): MockUndici {
  const mock = new MockUndici(origin);
  beforeEach(() => {
    mock.start();
  });
  afterEach(async () => {
    await mock.stop();
  });
  return mock;
}

// ── Shared request-capture helpers (used by every `mockX()` builder) ────────────

/** Shape of the options object undici hands to a reply callback. */
interface ReplyCallbackOptions {
  method?: string;
  path?: string;
  headers?: unknown;
  body?: unknown;
}

/** Snapshot a reply callback's request options into a {@link CapturedRequest}. */
function captureRequest(opts: ReplyCallbackOptions, fallbackPath: string): CapturedRequest {
  return {
    method: opts.method ?? 'GET',
    path: opts.path ?? fallbackPath,
    headers: normalizeHeaders(opts.headers),
    body: typeof opts.body === 'string' ? opts.body : opts.body != null ? String(opts.body) : '',
  };
}

/**
 * Normalize request headers to a plain lowercased-key object. undici may hand the
 * reply callback either a plain object or a `Headers` instance depending on how the
 * request was issued; handle both so assertions are uniform.
 */
function normalizeHeaders(raw: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (raw == null) return out;
  if (typeof Headers !== 'undefined' && raw instanceof Headers) {
    raw.forEach((value, key) => {
      out[key.toLowerCase()] = value;
    });
    return out;
  }
  if (typeof raw === 'object') {
    for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
      if (value === undefined) continue;
      out[key.toLowerCase()] = Array.isArray(value) ? String(value[0]) : String(value);
    }
  }
  return out;
}
