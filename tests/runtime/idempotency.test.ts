import { IDEMPOTENCY_KEY_PREFIX, generateIdempotencyKey } from '../../src/runtime/idempotency.js';

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('generateIdempotencyKey', () => {
  it('returns dinie-sdk-retry-<uuid v4>', () => {
    const key = generateIdempotencyKey();
    expect(key.startsWith(IDEMPOTENCY_KEY_PREFIX)).toBe(true);
    expect(IDEMPOTENCY_KEY_PREFIX).toBe('dinie-sdk-retry-');

    const uuid = key.slice(IDEMPOTENCY_KEY_PREFIX.length);
    expect(uuid).toMatch(UUID_V4);
  });

  it('produces a distinct key on each call', () => {
    const keys = new Set(Array.from({ length: 1000 }, () => generateIdempotencyKey()));
    expect(keys.size).toBe(1000);
  });
});
