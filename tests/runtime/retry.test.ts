import {
  RETRYABLE_STATUS,
  isRetryableNetworkError,
  parseRetryAfter,
  retryDelay,
  shouldRetry,
} from '../../src/runtime/retry.js';

describe('shouldRetry — V0.1 retryable status set (D5)', () => {
  it('retries exactly 429/502/503/504', () => {
    for (const status of [429, 502, 503, 504]) {
      expect(shouldRetry(status)).toBe(true);
    }
  });

  it('does NOT retry semantic 4xx (400/403/404/409/422)', () => {
    for (const status of [400, 403, 404, 409, 422]) {
      expect(shouldRetry(status)).toBe(false);
    }
  });

  it('does NOT retry 500 or 408 (V0.1 diverges from runtime-patterns ≥500 — D5)', () => {
    expect(shouldRetry(500)).toBe(false);
    expect(shouldRetry(408)).toBe(false);
  });

  it('does NOT retry success or 401 (401 is the http.ts one-shot, not a backoff retry)', () => {
    expect(shouldRetry(200)).toBe(false);
    expect(shouldRetry(201)).toBe(false);
    expect(shouldRetry(401)).toBe(false);
  });

  it('exposes the set as exactly {429, 502, 503, 504}', () => {
    expect([...RETRYABLE_STATUS].sort((a, b) => a - b)).toEqual([429, 502, 503, 504]);
    expect(RETRYABLE_STATUS.has(500)).toBe(false);
    expect(RETRYABLE_STATUS.has(408)).toBe(false);
  });
});

describe('isRetryableNetworkError — timeouts and connection resets', () => {
  it('retries ECONNRESET and ETIMEDOUT', () => {
    expect(isRetryableNetworkError(Object.assign(new Error('reset'), { code: 'ECONNRESET' }))).toBe(
      true,
    );
    expect(
      isRetryableNetworkError(Object.assign(new Error('timed out'), { code: 'ETIMEDOUT' })),
    ).toBe(true);
  });

  it('retries common transient transport codes', () => {
    for (const code of [
      'ECONNREFUSED',
      'EPIPE',
      'ENETDOWN',
      'ENETUNREACH',
      'EHOSTUNREACH',
      'EAI_AGAIN',
    ]) {
      expect(isRetryableNetworkError(Object.assign(new Error(code), { code }))).toBe(true);
    }
  });

  it("retries undici's own timeout and socket codes", () => {
    for (const code of [
      'UND_ERR_CONNECT_TIMEOUT',
      'UND_ERR_HEADERS_TIMEOUT',
      'UND_ERR_BODY_TIMEOUT',
      'UND_ERR_SOCKET',
    ]) {
      expect(isRetryableNetworkError(Object.assign(new Error(code), { code }))).toBe(true);
    }
  });

  it('retries an AbortSignal.timeout abort (TimeoutError)', () => {
    const timeout = Object.assign(new Error('The operation timed out.'), { name: 'TimeoutError' });
    expect(isRetryableNetworkError(timeout)).toBe(true);
  });

  it('does NOT retry a caller cancellation (plain AbortError)', () => {
    const aborted = Object.assign(new Error('aborted'), { name: 'AbortError', code: 'ABORT_ERR' });
    expect(isRetryableNetworkError(aborted)).toBe(false);
  });

  it('walks the cause chain (undici wraps the socket error)', () => {
    const wrapped = Object.assign(new Error('fetch failed'), {
      cause: Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' }),
    });
    expect(isRetryableNetworkError(wrapped)).toBe(true);
  });

  it('does NOT retry a plain error, an unrelated code, or non-objects', () => {
    expect(isRetryableNetworkError(new Error('boom'))).toBe(false);
    expect(isRetryableNetworkError(Object.assign(new Error('nope'), { code: 'EACCES' }))).toBe(
      false,
    );
    expect(isRetryableNetworkError(null)).toBe(false);
    expect(isRetryableNetworkError(undefined)).toBe(false);
    expect(isRetryableNetworkError('ECONNRESET')).toBe(false);
  });
});

describe('retryDelay — exponential backoff with subtractive jitter', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('with no jitter (random=0) follows min(0.5·2^attempt, 8)·1000 ms', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    expect(retryDelay(0)).toBe(500);
    expect(retryDelay(1)).toBe(1000);
    expect(retryDelay(2)).toBe(2000);
    expect(retryDelay(3)).toBe(4000);
    expect(retryDelay(4)).toBe(8000);
  });

  it('caps the backoff at 8s for high attempts (before jitter)', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    expect(retryDelay(5)).toBe(8000);
    expect(retryDelay(8)).toBe(8000);
    expect(retryDelay(20)).toBe(8000);
  });

  it('applies the full 25% subtractive jitter at random≈1 (lower bound)', () => {
    vi.spyOn(Math, 'random').mockReturnValue(1);
    // 1000 · (1 − 0.25·1) = 750
    expect(retryDelay(1)).toBe(750);
    // ceiling case: 8000 · 0.75 = 6000
    expect(retryDelay(4)).toBe(6000);
  });

  it('computes the jittered value deterministically for a fixed random', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    // 2000 · (1 − 0.25·0.5) = 2000 · 0.875 = 1750
    expect(retryDelay(2)).toBe(1750);
  });

  it('stays within (0.75·backoff, backoff] for every attempt under real jitter', () => {
    const backoffMs = (attempt: number) => Math.min(0.5 * 2 ** attempt, 8) * 1000;
    for (let attempt = 0; attempt <= 10; attempt++) {
      const expected = backoffMs(attempt);
      for (let i = 0; i < 100; i++) {
        const delay = retryDelay(attempt);
        expect(delay).toBeGreaterThan(expected * 0.75 - 1e-6);
        expect(delay).toBeLessThanOrEqual(expected);
      }
    }
  });
});

describe('retryDelay — Retry-After precedence and 60s cap', () => {
  it('lets Retry-After (delta-seconds) win over the backoff, in ms', () => {
    // No jitter spy: the header path must not touch Math.random.
    expect(retryDelay(0, '30')).toBe(30_000);
    expect(retryDelay(5, '2')).toBe(2_000);
  });

  it('accepts a fractional delta-seconds value', () => {
    expect(retryDelay(0, '0.5')).toBe(500);
  });

  it('caps a large Retry-After at 60_000 ms', () => {
    expect(retryDelay(0, '120')).toBe(60_000);
    expect(retryDelay(0, '3600')).toBe(60_000);
  });

  it('takes precedence even at a high attempt where backoff is at its ceiling', () => {
    expect(retryDelay(20, '5')).toBe(5_000);
  });

  describe('HTTP-date form', () => {
    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-05-27T12:00:00.000Z'));
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    it('honors an HTTP-date and converts it to a relative delay', () => {
      const httpDate = new Date(Date.now() + 30_000).toUTCString();
      expect(retryDelay(0, httpDate)).toBe(30_000);
    });

    it('caps a far-future HTTP-date at 60_000 ms', () => {
      const httpDate = new Date(Date.now() + 2 * 60 * 60 * 1000).toUTCString();
      expect(retryDelay(0, httpDate)).toBe(60_000);
    });

    it('clamps a past HTTP-date to 0', () => {
      const httpDate = new Date(Date.now() - 60_000).toUTCString();
      expect(retryDelay(0, httpDate)).toBe(0);
    });
  });

  it('falls back to backoff when Retry-After is absent or unparseable', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    expect(retryDelay(1)).toBe(1000);
    expect(retryDelay(1, 'not-a-date')).toBe(1000);
    expect(retryDelay(1, '')).toBe(1000);
    vi.restoreAllMocks();
  });
});

describe('parseRetryAfter', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('parses delta-seconds (integer and float) to ms', () => {
    expect(parseRetryAfter('30')).toBe(30_000);
    expect(parseRetryAfter('0.5')).toBe(500);
    expect(parseRetryAfter('0')).toBe(0);
  });

  it('parses an HTTP-date to a relative delay from now', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-27T12:00:00.000Z'));
    const httpDate = new Date(Date.now() + 45_000).toUTCString();
    expect(parseRetryAfter(httpDate)).toBe(45_000);
  });

  it('returns null for absent, empty, or unparseable values', () => {
    expect(parseRetryAfter(undefined)).toBeNull();
    expect(parseRetryAfter('')).toBeNull();
    expect(parseRetryAfter('   ')).toBeNull();
    expect(parseRetryAfter('whenever')).toBeNull();
  });
});
