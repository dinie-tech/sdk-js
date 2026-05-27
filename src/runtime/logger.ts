/**
 * Leveled logger with PII redaction + body truncation (D10).
 *
 * A financial backend carries PII in request/response bodies, so the logger
 * **defaults to `off`** in V0.1 — nothing is emitted unless the caller opts in via
 * `DinieConfig.logLevel` or the `DINIE_LOG` env var. When enabled it:
 *   - gates by level (`off < error < warn < info < debug`),
 *   - redacts sensitive headers and body fields by name,
 *   - truncates bodies ≥ 2 KB,
 *   - tags every line with a `requestLogID` (and `retryOf` on retries) so a request
 *     and its retries can be correlated.
 *
 * `LogLevel` and `Logger` are the public symbols (re-exported via the runtime barrel
 * per architecture §4.1 — `DinieConfig.logger`/`logLevel`). Everything else
 * (`RuntimeLogger`, the pure redaction/truncation helpers) is internal to the runtime
 * and imported directly by `http.ts` (story 007). Mirrors the leveling/redaction
 * approach of `openai-node/src/internal/utils/log.ts`.
 */

/** A sink method — same shape as `console.error`/`warn`/`info`/`debug`. */
type LogFn = (message: string, ...rest: unknown[]) => void;

/** Injectable log sink. Defaults to `console`; satisfied by most logging libraries. */
export interface Logger {
  error: LogFn;
  warn: LogFn;
  info: LogFn;
  debug: LogFn;
}

/** Verbosity, least to most. `off` (default in V0.1) emits nothing. */
export type LogLevel = 'off' | 'error' | 'warn' | 'info' | 'debug';

/** Ordering for level gating — a call emits when `level <= configured level`. */
const LEVEL_NUMBERS: Record<LogLevel, number> = {
  off: 0,
  error: 1,
  warn: 2,
  info: 3,
  debug: 4,
};

/** Mask substituted for any redacted header or body field. */
const REDACTED = '[REDACTED]';

/** Bodies whose serialized size reaches this many bytes are truncated. */
const MAX_BODY_BYTES = 2048;

/** Header names (lowercased) whose values carry credentials/signatures → masked. */
const REDACTED_HEADERS: ReadonlySet<string> = new Set([
  'authorization',
  'webhook-signature',
  'x-dinie-client-secret',
  'proxy-authorization',
]);

/** Body field names (lowercased) that carry PII/secrets → masked recursively. */
const REDACTED_BODY_FIELDS: ReadonlySet<string> = new Set([
  'cpf',
  'cnpj',
  'account',
  'cvv',
  'password',
  'secret',
  'client_secret',
]);

/** Headers as undici delivers them (lowercased keys; arrays for repeated headers). */
type HeaderMap = Record<string, string | string[] | undefined>;

/** Default sink: forward to `console`, preserving each native method's behavior. */
const consoleLogger: Logger = {
  error: (message, ...rest) => console.error(message, ...rest),
  warn: (message, ...rest) => console.warn(message, ...rest),
  info: (message, ...rest) => console.info(message, ...rest),
  debug: (message, ...rest) => console.debug(message, ...rest),
};

function isLogLevel(value: string): value is LogLevel {
  return Object.prototype.hasOwnProperty.call(LEVEL_NUMBERS, value);
}

/**
 * Effective level: an explicit `level` wins; else a valid `DINIE_LOG` (or the passed
 * `env` override, for tests); else `off`. An unset/garbage env value yields `off`.
 */
export function resolveLogLevel(
  level?: LogLevel | undefined,
  env: string | undefined = process.env['DINIE_LOG'],
): LogLevel {
  if (level !== undefined) return level;
  if (env !== undefined) {
    const trimmed = env.trim();
    if (isLogLevel(trimmed)) return trimmed;
  }
  return 'off';
}

/** Fresh correlation id for a logical request (shared across its retries). */
export function newRequestLogID(): string {
  return `req_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;
}

/** Replace the value of any sensitive header with the mask (case-insensitive). */
export function redactHeaders(headers: HeaderMap): Record<string, string | string[]> {
  const out: Record<string, string | string[]> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (value === undefined) continue;
    out[key] = REDACTED_HEADERS.has(key.toLowerCase()) ? REDACTED : value;
  }
  return out;
}

/**
 * Deep-clone `value`, masking any property whose name matches a redacted body field
 * (case-insensitive). Arrays and nested objects are walked; primitives pass through.
 */
export function redactBody(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactBody);
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value)) {
      out[key] = REDACTED_BODY_FIELDS.has(key.toLowerCase()) ? REDACTED : redactBody(nested);
    }
    return out;
  }
  return value;
}

/**
 * Truncate a string to `MAX_BODY_BYTES` on a codepoint boundary, appending
 * `…[truncated, full_size=NNN]` (NNN = full UTF-8 byte size). Returns the input
 * unchanged when under the threshold.
 */
export function truncateBody(text: string): string {
  const fullSize = Buffer.byteLength(text, 'utf8');
  if (fullSize < MAX_BODY_BYTES) return text;

  let bytes = 0;
  let end = 0;
  for (const char of text) {
    const charBytes = Buffer.byteLength(char, 'utf8');
    if (bytes + charBytes > MAX_BODY_BYTES) break;
    bytes += charBytes;
    end += char.length;
  }
  return `${text.slice(0, end)}…[truncated, full_size=${fullSize}]`;
}

/**
 * Render a body for logging: redact PII field names, serialize to JSON, then
 * truncate. A string body is first JSON-parsed (so its fields can be redacted) and
 * left as-is when it is not JSON.
 */
export function formatBody(body: unknown): string {
  let serialized: string;
  if (typeof body === 'string') {
    const parsed = tryParseJson(body);
    serialized = parsed === undefined ? body : safeStringify(redactBody(parsed));
  } else {
    serialized = safeStringify(redactBody(body));
  }
  return truncateBody(serialized);
}

/** Fields shared by request/response log payloads from `http.ts`. */
interface LogCorrelation {
  /** Correlation id for the logical request. */
  requestLogID: string;
  /** The original request's id when this line is a retry. */
  retryOf?: string | undefined;
  /** Zero-based attempt number within the retry loop. */
  attempt?: number | undefined;
}

/** Request details `http.ts` hands to `logRequest`. */
export interface RequestLogPayload extends LogCorrelation {
  method: string;
  url: string;
  headers?: HeaderMap | undefined;
  body?: unknown;
}

/** Response details `http.ts` hands to `logResponse`. */
export interface ResponseLogPayload extends LogCorrelation {
  status: number;
  url: string;
  headers?: HeaderMap | undefined;
  body?: unknown;
  durationMs?: number | undefined;
}

/**
 * Runtime logging facade owned by `HttpClient`. Resolves the effective level once,
 * gates every call, and applies redaction/truncation before handing structured
 * detail to the sink. Constructed from `DinieConfig`:
 * `new RuntimeLogger({ level: config.logLevel, logger: config.logger })`.
 */
export class RuntimeLogger {
  /** Effective level after config + `DINIE_LOG` resolution. */
  readonly level: LogLevel;
  readonly #sink: Logger;

  constructor(
    options: {
      level?: LogLevel | undefined;
      logger?: Logger | undefined;
      env?: string | undefined;
    } = {},
  ) {
    this.level = resolveLogLevel(options.level, options.env);
    this.#sink = options.logger ?? consoleLogger;
  }

  /** Whether a call at `level` would emit under the configured level. */
  isEnabled(level: Exclude<LogLevel, 'off'>): boolean {
    return LEVEL_NUMBERS[this.level] >= LEVEL_NUMBERS[level];
  }

  error(message: string, ...rest: unknown[]): void {
    if (this.isEnabled('error')) this.#sink.error(message, ...rest);
  }
  warn(message: string, ...rest: unknown[]): void {
    if (this.isEnabled('warn')) this.#sink.warn(message, ...rest);
  }
  info(message: string, ...rest: unknown[]): void {
    if (this.isEnabled('info')) this.#sink.info(message, ...rest);
  }
  debug(message: string, ...rest: unknown[]): void {
    if (this.isEnabled('debug')) this.#sink.debug(message, ...rest);
  }

  /** Log an outgoing request at `debug` with redacted headers + body. */
  logRequest(payload: RequestLogPayload): void {
    if (!this.isEnabled('debug')) return;
    this.#sink.debug('[dinie] → request', {
      ...correlationFields(payload),
      method: payload.method,
      url: payload.url,
      ...(payload.headers !== undefined ? { headers: redactHeaders(payload.headers) } : {}),
      ...(payload.body !== undefined ? { body: formatBody(payload.body) } : {}),
    });
  }

  /** Log an incoming response at `debug` with redacted headers + body. */
  logResponse(payload: ResponseLogPayload): void {
    if (!this.isEnabled('debug')) return;
    this.#sink.debug('[dinie] ← response', {
      ...correlationFields(payload),
      status: payload.status,
      url: payload.url,
      ...(payload.durationMs !== undefined ? { durationMs: payload.durationMs } : {}),
      ...(payload.headers !== undefined ? { headers: redactHeaders(payload.headers) } : {}),
      ...(payload.body !== undefined ? { body: formatBody(payload.body) } : {}),
    });
  }
}

/** Correlation triple, dropping the optional members when unset. */
function correlationFields(correlation: LogCorrelation): Record<string, unknown> {
  return {
    requestLogID: correlation.requestLogID,
    ...(correlation.retryOf !== undefined ? { retryOf: correlation.retryOf } : {}),
    ...(correlation.attempt !== undefined ? { attempt: correlation.attempt } : {}),
  };
}

function tryParseJson(raw: string): unknown {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return undefined;
  }
}

/** `JSON.stringify` that tolerates circular structures (logs must never throw). */
function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return '[unserializable]';
  }
}
