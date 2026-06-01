/**
 * APIPromise — the dual-natured return of every non-list method (D15), key-component tier.
 *
 * Exercised in isolation against synthetic `RawResponse` objects (no http, no network): the
 * `.then()`/`await` body unwrap, `.asResponse()`/`.withResponse()` response access, the
 * `_thenUnwrap` map (wire → model), single lazy body read (memoization), and rejection
 * propagation.
 */

import { APIPromise, type RawResponse } from '../../src/runtime/api-promise.js';

interface BodyCounters {
  textCalls: number;
  dumpCalls: number;
}

/** A synthetic transport response whose body records how many times it was read/dumped. */
function makeRaw(opts: {
  statusCode?: number;
  json?: unknown;
  headers?: Record<string, string | string[] | undefined>;
}): { raw: RawResponse; counters: BodyCounters } {
  const counters: BodyCounters = { textCalls: 0, dumpCalls: 0 };
  const text = opts.json !== undefined ? JSON.stringify(opts.json) : '';
  const raw: RawResponse = {
    statusCode: opts.statusCode ?? 200,
    headers: opts.headers ?? {},
    body: {
      text: async () => {
        counters.textCalls += 1;
        return text;
      },
      dump: async () => {
        counters.dumpCalls += 1;
      },
    },
  };
  return { raw, counters };
}

/** A body parser mirroring `http.ts` parseBody (JSON), wrapped to count invocations. */
function jsonParser<T>(): { parse: (raw: RawResponse) => Promise<T>; calls: () => number } {
  let calls = 0;
  return {
    parse: async (raw) => {
      calls += 1;
      const text = await raw.body.text();
      return JSON.parse(text) as T;
    },
    calls: () => calls,
  };
}

describe('APIPromise — PromiseLike body unwrap', () => {
  it('await resolves to the parsed body', async () => {
    const { raw } = makeRaw({ json: { id: 'cus_1', object: 'customer' } });
    const p = APIPromise.fromResponse<{ id: string; object: string }>(
      Promise.resolve(raw),
      jsonParser<{ id: string; object: string }>().parse,
    );

    await expect(p).resolves.toEqual({ id: 'cus_1', object: 'customer' });
  });

  it('exposes the APIPromise toStringTag', () => {
    const { raw } = makeRaw({ json: {} });
    const p = APIPromise.fromResponse(Promise.resolve(raw), async () => ({}));
    expect(Object.prototype.toString.call(p)).toBe('[object APIPromise]');
  });
});

describe('APIPromise — response access (D15)', () => {
  it('.withResponse() returns both data and the response (status + headers)', async () => {
    const { raw } = makeRaw({
      statusCode: 201,
      json: { id: 'cus_1' },
      headers: { 'x-request-id': 'req_1', 'x-ratelimit-remaining': '99' },
    });
    const p = APIPromise.fromResponse<{ id: string }>(
      Promise.resolve(raw),
      jsonParser<{ id: string }>().parse,
    );

    const { data, response } = await p.withResponse();
    expect(data).toEqual({ id: 'cus_1' });
    expect(response.status).toBe(201);
    expect(response.headers['x-request-id']).toBe('req_1');
    expect(response.headers['x-ratelimit-remaining']).toBe('99');
  });

  it('.asResponse() returns the response metadata', async () => {
    const { raw } = makeRaw({ statusCode: 200, json: { id: 'cus_1' }, headers: { etag: 'W/"1"' } });
    const p = APIPromise.fromResponse<{ id: string }>(
      Promise.resolve(raw),
      jsonParser<{ id: string }>().parse,
    );

    const response = await p.asResponse();
    expect(response.status).toBe(200);
    expect(response.headers['etag']).toBe('W/"1"');
  });
});

describe('APIPromise — _thenUnwrap (wire → model, preserving the response)', () => {
  it('maps the data while keeping the same response', async () => {
    const { raw } = makeRaw({
      statusCode: 200,
      json: { id: 'cus_1', tax_id: '123' },
      headers: { 'x-request-id': 'req_map' },
    });
    const wire = APIPromise.fromResponse<{ id: string; tax_id: string }>(
      Promise.resolve(raw),
      jsonParser<{ id: string; tax_id: string }>().parse,
    );

    const model = wire._thenUnwrap((data) => ({ customerId: data.id, taxId: data.tax_id }));

    const { data, response } = await model.withResponse();
    expect(data).toEqual({ customerId: 'cus_1', taxId: '123' });
    expect(response.status).toBe(200);
    expect(response.headers['x-request-id']).toBe('req_map');
    // Awaiting the mapped promise directly yields the mapped data.
    await expect(model).resolves.toEqual({ customerId: 'cus_1', taxId: '123' });
  });
});

describe('APIPromise — lazy + single body read', () => {
  it('does not read the body until first consumption', async () => {
    const { raw } = makeRaw({ json: { id: 'cus_1' } });
    const parser = jsonParser<{ id: string }>();
    const p = APIPromise.fromResponse<{ id: string }>(Promise.resolve(raw), parser.parse);

    expect(parser.calls()).toBe(0); // constructed but not consumed

    await p;
    expect(parser.calls()).toBe(1);
  });

  it('reads the body exactly once across await + withResponse + asResponse + _thenUnwrap', async () => {
    const { raw, counters } = makeRaw({ json: { id: 'cus_1' } });
    const parser = jsonParser<{ id: string }>();
    const p = APIPromise.fromResponse<{ id: string }>(Promise.resolve(raw), parser.parse);

    await p;
    await p.withResponse();
    await p.asResponse();
    await p._thenUnwrap((d) => d.id);

    expect(parser.calls()).toBe(1);
    expect(counters.textCalls).toBe(1);
  });
});

describe('APIPromise — rejection propagation', () => {
  it('rejects await/.withResponse()/.asResponse() when the transport promise rejects', async () => {
    const boom = new Error('transport failed');
    const make = () => APIPromise.fromResponse<unknown>(Promise.reject(boom), async () => ({}));

    await expect(make()).rejects.toBe(boom);
    await expect(make().withResponse()).rejects.toBe(boom);
    await expect(make().asResponse()).rejects.toBe(boom);
  });

  it('rejects when the parser throws', async () => {
    const { raw } = makeRaw({ json: { id: 'cus_1' } });
    const p = APIPromise.fromResponse<never>(Promise.resolve(raw), () => {
      throw new Error('parse failed');
    });
    await expect(p).rejects.toThrow(/parse failed/);
  });
});

describe('APIPromise.fromParsed — compose from an already-parsed result', () => {
  it('wraps a {data, response} thunk and is lazy', async () => {
    let produced = 0;
    const p = APIPromise.fromParsed<{ id: string }>(async () => {
      produced += 1;
      return { data: { id: 'cus_1' }, response: { status: 200, headers: {} } };
    });

    expect(produced).toBe(0);
    await expect(p).resolves.toEqual({ id: 'cus_1' });
    await p.withResponse();
    expect(produced).toBe(1); // memoized
  });
});
