import {
  type Logger,
  RuntimeLogger,
  formatBody,
  redactBody,
  redactHeaders,
  resolveLogLevel,
  truncateBody,
} from '../../src/runtime/logger.js';

function spySink(): Logger {
  return { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() };
}

describe('redactHeaders', () => {
  it('masks credential/signature headers, case-insensitively', () => {
    const redacted = redactHeaders({
      Authorization: 'Bearer secret-token',
      'webhook-signature': 'v1,abc',
      'X-Dinie-Client-Secret': 'shh',
      'proxy-authorization': 'Basic xyz',
      'content-type': 'application/json',
    });
    expect(redacted['Authorization']).toBe('[REDACTED]');
    expect(redacted['webhook-signature']).toBe('[REDACTED]');
    expect(redacted['X-Dinie-Client-Secret']).toBe('[REDACTED]');
    expect(redacted['proxy-authorization']).toBe('[REDACTED]');
    expect(redacted['content-type']).toBe('application/json');
  });

  it('drops undefined header values', () => {
    expect(redactHeaders({ 'x-foo': undefined })).toEqual({});
  });
});

describe('redactBody — PII/secret fields by name', () => {
  it('masks the listed field names (case-insensitive)', () => {
    expect(
      redactBody({
        cpf: '123.456.789-00',
        cnpj: '11.222.333/0001-44',
        account: '0001-5',
        cvv: '123',
        password: 'hunter2',
        secret: 'sk_live',
        client_secret: 'cs_live',
        access_token: 'eyJhbGciOi.jwt.payload',
        phone: '+5511999998888',
        name: 'Maria',
      }),
    ).toEqual({
      cpf: '[REDACTED]',
      cnpj: '[REDACTED]',
      account: '[REDACTED]',
      cvv: '[REDACTED]',
      password: '[REDACTED]',
      secret: '[REDACTED]',
      client_secret: '[REDACTED]',
      access_token: '[REDACTED]',
      phone: '[REDACTED]',
      name: 'Maria',
    });
  });

  it('redacts access_token (token-endpoint body) and phone (E.164 PII) — §5.4', () => {
    // The OAuth2 token-endpoint response body would otherwise leak the JWT at debug level.
    expect(
      redactBody({ access_token: 'eyJ.header.sig', token_type: 'bearer', expires_in: 3600 }),
    ).toEqual({ access_token: '[REDACTED]', token_type: 'bearer', expires_in: 3600 });
    // Case-insensitive, and nested under a customer payload.
    expect(redactBody({ customer: { Phone: '+5511999998888', name: 'Ana' } })).toEqual({
      customer: { Phone: '[REDACTED]', name: 'Ana' },
    });
  });

  it('redacts recursively through nested objects and arrays', () => {
    expect(
      redactBody({
        customer: { name: 'Ana', cpf: '000', cards: [{ cvv: '999', last4: '4242' }] },
      }),
    ).toEqual({
      customer: { name: 'Ana', cpf: '[REDACTED]', cards: [{ cvv: '[REDACTED]', last4: '4242' }] },
    });
  });

  it('matches field names case-insensitively', () => {
    expect(redactBody({ CPF: '000', Password: 'x' })).toEqual({
      CPF: '[REDACTED]',
      Password: '[REDACTED]',
    });
  });

  it('passes primitives through untouched', () => {
    expect(redactBody('plain')).toBe('plain');
    expect(redactBody(42)).toBe(42);
    expect(redactBody(null)).toBeNull();
  });
});

describe('truncateBody — ≥ 2 KB', () => {
  it('leaves a sub-2KB body unchanged', () => {
    const text = 'a'.repeat(2047);
    expect(truncateBody(text)).toBe(text);
  });

  it('truncates a body of exactly 2 KB (the ≥ boundary)', () => {
    const text = 'a'.repeat(2048);
    const result = truncateBody(text);
    expect(result.startsWith('a'.repeat(2048))).toBe(true);
    expect(result.endsWith('…[truncated, full_size=2048]')).toBe(true);
  });

  it('truncates a large body and reports the full byte size', () => {
    const text = 'a'.repeat(5000);
    const result = truncateBody(text);
    expect(result.startsWith('a'.repeat(2048))).toBe(true);
    expect(result).toContain('…[truncated, full_size=5000]');
  });

  it('reports byte size (not char count) for multibyte content', () => {
    const text = 'é'.repeat(2000); // 2 bytes each = 4000 bytes
    const result = truncateBody(text);
    expect(result).toContain('full_size=4000');
  });
});

describe('formatBody — redact then truncate', () => {
  it('redacts PII in an object body before serializing', () => {
    expect(formatBody({ cpf: '123', name: 'Ana' })).toBe('{"cpf":"[REDACTED]","name":"Ana"}');
  });

  it('parses, redacts, and re-serializes a JSON string body', () => {
    expect(formatBody('{"password":"hunter2","ok":true}')).toBe(
      '{"password":"[REDACTED]","ok":true}',
    );
  });

  it('keeps a non-JSON string body as-is', () => {
    expect(formatBody('not json')).toBe('not json');
  });

  it('truncates an oversized redacted body', () => {
    const result = formatBody({ note: 'x'.repeat(5000) });
    expect(result).toContain('…[truncated, full_size=');
  });
});

describe('resolveLogLevel — config > DINIE_LOG > off', () => {
  it('defaults to off with no config and no env', () => {
    expect(resolveLogLevel(undefined, undefined)).toBe('off');
  });

  it('honors an explicit config level over the env', () => {
    expect(resolveLogLevel('warn', 'debug')).toBe('warn');
  });

  it('falls back to a valid DINIE_LOG when config is unset', () => {
    expect(resolveLogLevel(undefined, 'debug')).toBe('debug');
    expect(resolveLogLevel(undefined, '  info  ')).toBe('info');
  });

  it('falls back to off for a garbage env value', () => {
    expect(resolveLogLevel(undefined, 'verbose')).toBe('off');
  });

  it('reads process.env.DINIE_LOG by default', () => {
    const previous = process.env['DINIE_LOG'];
    try {
      process.env['DINIE_LOG'] = 'error';
      expect(resolveLogLevel()).toBe('error');
    } finally {
      if (previous === undefined) delete process.env['DINIE_LOG'];
      else process.env['DINIE_LOG'] = previous;
    }
  });
});

describe('RuntimeLogger — level gating', () => {
  it('default is off and logs nothing, even to a custom sink', () => {
    const sink = spySink();
    const logger = new RuntimeLogger({ logger: sink });
    expect(logger.level).toBe('off');

    logger.error('e');
    logger.warn('w');
    logger.info('i');
    logger.debug('d');
    logger.logRequest({ method: 'POST', url: '/customers', requestLogID: 'req_1' });
    logger.logResponse({ status: 201, url: '/customers', requestLogID: 'req_1' });

    expect(sink.error).not.toHaveBeenCalled();
    expect(sink.warn).not.toHaveBeenCalled();
    expect(sink.info).not.toHaveBeenCalled();
    expect(sink.debug).not.toHaveBeenCalled();
  });

  it('at info, emits error/warn/info but gates debug', () => {
    const sink = spySink();
    const logger = new RuntimeLogger({ level: 'info', logger: sink });

    logger.error('e');
    logger.warn('w');
    logger.info('i');
    logger.debug('d');

    expect(sink.error).toHaveBeenCalledWith('e');
    expect(sink.warn).toHaveBeenCalledWith('w');
    expect(sink.info).toHaveBeenCalledWith('i');
    expect(sink.debug).not.toHaveBeenCalled();
  });

  it('at debug, emits every level', () => {
    const sink = spySink();
    const logger = new RuntimeLogger({ level: 'debug', logger: sink });

    logger.error('e');
    logger.warn('w');
    logger.info('i');
    logger.debug('d');

    expect(sink.error).toHaveBeenCalledTimes(1);
    expect(sink.warn).toHaveBeenCalledTimes(1);
    expect(sink.info).toHaveBeenCalledTimes(1);
    expect(sink.debug).toHaveBeenCalledTimes(1);
  });

  it('takes its level from DINIE_LOG via the env override', () => {
    const sink = spySink();
    const logger = new RuntimeLogger({ logger: sink, env: 'debug' });
    expect(logger.level).toBe('debug');
    logger.debug('d');
    expect(sink.debug).toHaveBeenCalled();
  });

  it('isEnabled reflects the configured level', () => {
    const logger = new RuntimeLogger({ level: 'warn', logger: spySink() });
    expect(logger.isEnabled('error')).toBe(true);
    expect(logger.isEnabled('warn')).toBe(true);
    expect(logger.isEnabled('info')).toBe(false);
    expect(logger.isEnabled('debug')).toBe(false);
  });
});

describe('RuntimeLogger — structured request/response logging', () => {
  it('redacts headers and body and carries correlation ids on a request', () => {
    const sink = spySink();
    const logger = new RuntimeLogger({ level: 'debug', logger: sink });

    logger.logRequest({
      method: 'POST',
      url: '/customers',
      headers: { Authorization: 'Bearer tok', 'content-type': 'application/json' },
      body: { taxId: '123', cpf: '000', name: 'Ana' },
      requestLogID: 'req_abc',
      attempt: 0,
    });

    expect(sink.debug).toHaveBeenCalledTimes(1);
    const [, detail] = (sink.debug as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      Record<string, unknown>,
    ];
    expect(detail['requestLogID']).toBe('req_abc');
    expect(detail['attempt']).toBe(0);
    expect((detail['headers'] as Record<string, unknown>)['Authorization']).toBe('[REDACTED]');
    expect(detail['body']).toBe('{"taxId":"123","cpf":"[REDACTED]","name":"Ana"}');
  });

  it('tags a retry line with retryOf for correlation', () => {
    const sink = spySink();
    const logger = new RuntimeLogger({ level: 'debug', logger: sink });

    logger.logResponse({
      status: 503,
      url: '/customers',
      requestLogID: 'req_retry',
      retryOf: 'req_abc',
      attempt: 1,
    });

    const [, detail] = (sink.debug as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      Record<string, unknown>,
    ];
    expect(detail['retryOf']).toBe('req_abc');
    expect(detail['attempt']).toBe(1);
    expect(detail['status']).toBe(503);
  });
});
