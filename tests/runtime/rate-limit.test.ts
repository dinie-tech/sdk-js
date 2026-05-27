import { RateLimitTracker, parseRateLimit } from '../../src/runtime/rate-limit.js';

describe('parseRateLimit — the three X-RateLimit-* headers', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('parses limit/remaining/reset into a RateLimit', () => {
    const result = parseRateLimit({
      'x-ratelimit-limit': '100',
      'x-ratelimit-remaining': '99',
      'x-ratelimit-reset': '1800000000',
    });
    expect(result).not.toBeNull();
    expect(result?.limit).toBe(100);
    expect(result?.remaining).toBe(99);
    expect(result?.resetAt).toBeInstanceOf(Date);
  });

  it('reads X-RateLimit-Reset as an absolute Unix epoch (seconds)', () => {
    const epochSeconds = 1_800_000_000; // ~2027 — above the epoch threshold
    const result = parseRateLimit({
      'x-ratelimit-limit': '100',
      'x-ratelimit-remaining': '0',
      'x-ratelimit-reset': String(epochSeconds),
    });
    expect(result?.resetAt.getTime()).toBe(epochSeconds * 1000);
  });

  it('reads a small X-RateLimit-Reset as a delta in seconds from now', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-27T12:00:00.000Z'));
    const result = parseRateLimit({
      'x-ratelimit-limit': '100',
      'x-ratelimit-remaining': '0',
      'x-ratelimit-reset': '60',
    });
    expect(result?.resetAt.getTime()).toBe(Date.now() + 60_000);
  });

  it('is case-insensitive and tolerates whitespace + repeated headers', () => {
    const result = parseRateLimit({
      'X-RateLimit-Limit': ' 50 ',
      'X-RateLimit-Remaining': ['25', '24'],
      'X-RateLimit-Reset': '1800000000',
    });
    expect(result?.limit).toBe(50);
    expect(result?.remaining).toBe(25);
  });

  it('returns null when any header is missing', () => {
    expect(parseRateLimit({})).toBeNull();
    expect(parseRateLimit({ 'x-ratelimit-limit': '100' })).toBeNull();
    expect(
      parseRateLimit({ 'x-ratelimit-limit': '100', 'x-ratelimit-remaining': '99' }),
    ).toBeNull();
  });

  it('returns null on garbage values (never throws, never a partial)', () => {
    expect(
      parseRateLimit({
        'x-ratelimit-limit': 'nope',
        'x-ratelimit-remaining': '99',
        'x-ratelimit-reset': '1800000000',
      }),
    ).toBeNull();
    expect(
      parseRateLimit({
        'x-ratelimit-limit': '100',
        'x-ratelimit-remaining': '99',
        'x-ratelimit-reset': 'soon',
      }),
    ).toBeNull();
  });
});

describe('RateLimitTracker — mutable snapshot for client.rate_limit', () => {
  it('is null before the first response', () => {
    expect(new RateLimitTracker().snapshot).toBeNull();
  });

  it('populates the snapshot from a valid response', () => {
    const tracker = new RateLimitTracker();
    tracker.update({
      'x-ratelimit-limit': '100',
      'x-ratelimit-remaining': '42',
      'x-ratelimit-reset': '1800000000',
    });
    expect(tracker.snapshot?.limit).toBe(100);
    expect(tracker.snapshot?.remaining).toBe(42);
  });

  it('keeps the previous snapshot when a later response has no rate-limit headers', () => {
    const tracker = new RateLimitTracker();
    tracker.update({
      'x-ratelimit-limit': '100',
      'x-ratelimit-remaining': '42',
      'x-ratelimit-reset': '1800000000',
    });
    tracker.update({ 'content-type': 'application/json' }); // e.g. the token call
    expect(tracker.snapshot?.remaining).toBe(42);
  });

  it('overwrites the snapshot when a newer response carries headers', () => {
    const tracker = new RateLimitTracker();
    tracker.update({
      'x-ratelimit-limit': '100',
      'x-ratelimit-remaining': '42',
      'x-ratelimit-reset': '1800000000',
    });
    tracker.update({
      'x-ratelimit-limit': '100',
      'x-ratelimit-remaining': '41',
      'x-ratelimit-reset': '1800000060',
    });
    expect(tracker.snapshot?.remaining).toBe(41);
  });
});
