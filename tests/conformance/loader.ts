/**
 * Conformance loader — reads the openapi contract (the SoT) and extracts every example that is
 * attached to a request/response/webhook schema (story 008, architecture §11). NO network, NO
 * SDK imports: this module only parses YAML and walks the tree, so the round-trip + error suites
 * can layer the SDK mapping on top of a contract-only view.
 *
 * ── What "an example associated with a schema" means here ──
 * The contract carries 146 `example:` + 48 `examples:` blocks, but most are FIELD-LEVEL scalars
 * on individual properties (`CustomerId.example: cust_…`, `email.example: joao@…`) — those are
 * not whole-object payloads and cannot round-trip through a schema (de)serializer. The
 * round-trippable corpus is the set of WHOLE-OBJECT examples attached at a media-type object
 * (`…content.<mediaType>.example` or `…content.<mediaType>.examples.<key>.value`), where the
 * sibling `schema` (a `$ref`, a list envelope, or an inline body) tells us which SDK type the
 * example belongs to. Those are exactly the request bodies, success responses, error bodies, and
 * the 15 webhook event payloads. This loader extracts that corpus; the field-level scalars are
 * intentionally out of scope (logged by the coverage gate — no silent truncation, architecture
 * §11). The component-schema name list is exposed (`getComponentSchemaNames`) so the gate can
 * report which schemas never produced a round-trippable example.
 *
 * ── Resolution ──
 * YAML anchors/aliases (e.g. the shared `*webhook-responses`) are resolved by the parser. Local
 * JSON-pointer `$ref`s (`#/components/responses/…`, `#/components/examples/…`) are resolved here.
 * External `$ref`s do not occur in this single-file contract; an unresolvable `$ref` yields
 * `undefined` and is skipped (it would surface as missing coverage, never as a silent pass).
 *
 * ── Path (no network) ──
 * Reads the contract from `DINIE_OPENAPI_PATH` (env override) or the known sibling-repo path. A
 * missing file throws — the gate fails loudly rather than silently reporting zero examples.
 *
 * ── Dependency ──
 * `yaml` (dev dependency, added by story 008). It is a parser only — NOT a runtime dependency of
 * the SDK (`package.json` `dependencies` stays `undici`-only). Chosen over `@redocly/openapi-core`
 * because the loader needs nothing beyond a YAML parse + manual local-`$ref` resolution, and
 * `yaml` is a single zero-dependency package versus Redocly's large transitive tree.
 */

import { readFileSync } from 'node:fs';
import { parse } from 'yaml';

/** Default contract location — the api-docs sibling repo (read-only SoT, @ 3fcfd83). */
export const DEFAULT_OPENAPI_PATH = '/Users/jaisonerick/code/dinie-tech/api-docs/apis/openapi.yaml';

/** Resolved contract path — env override (`DINIE_OPENAPI_PATH`) wins, else the default. */
export const OPENAPI_PATH: string = process.env['DINIE_OPENAPI_PATH'] ?? DEFAULT_OPENAPI_PATH;

/** Where an example sits relative to the operation. */
export type ExampleRole = 'request' | 'response' | 'event';

/** `single` = the example IS the schema; `list` = `{ data: T[], has_more }` envelope of `schemaName`. */
export type ExampleContainer = 'single' | 'list';

/** One whole-object example, tagged with everything the round-trip/error suites need to map it. */
export interface ExampleRecord {
  /** Human-readable origin, e.g. `POST /customers → 201` or `webhook customer.created`. */
  readonly location: string;
  /** The operation's `operationId`, when the example came from a path operation. */
  readonly operationId: string | null;
  /** Where the example sits relative to the operation. */
  readonly role: ExampleRole;
  /** HTTP status, for response examples (`'201'`, `'400'`, …); `null` otherwise. */
  readonly status: string | null;
  /** Media type of the containing content object (`application/json`, `application/problem+json`, …). */
  readonly mediaType: string;
  /**
   * Resolved schema name: the `$ref` target (`Customer`), the list element for a `{data,has_more}`
   * envelope (`Customer`, with `container: 'list'`), or `null` for an inline/anonymous schema
   * (e.g. the rotate-secret body — mapped by `operationId` + `role` in the round-trip suite).
   */
  readonly schemaName: string | null;
  /** `single` or `list` (see {@link ExampleContainer}). */
  readonly container: ExampleContainer;
  /** Example key: `(example)` for a single `example:`, or the `examples:` map key. */
  readonly exampleKey: string;
  /** The example payload (parsed YAML → JS value). */
  readonly exampleValue: unknown;
}

// ── Tiny typed navigators (the spec is dynamic; keep `noUncheckedIndexedAccess` happy) ──────────

function asObject(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

/** Resolve a local JSON-pointer `$ref` against the root spec; pass non-`$ref` nodes through. */
function resolveRef(node: unknown, spec: Record<string, unknown>): unknown {
  const obj = asObject(node);
  const ref = obj ? asString(obj['$ref']) : undefined;
  if (ref === undefined || !ref.startsWith('#/')) return node;
  let cursor: unknown = spec;
  for (const segment of ref.slice(2).split('/')) {
    const co = asObject(cursor);
    if (co === undefined) return undefined;
    cursor = co[segment];
  }
  return cursor;
}

function lastRefSegment(ref: string): string | null {
  const segment = ref.split('/').pop();
  return segment !== undefined && segment.length > 0 ? segment : null;
}

/** Classify a media-type `schema`: a `$ref` name, a list envelope's element, or anonymous (`null`). */
function schemaInfo(schema: unknown): { name: string | null; container: ExampleContainer } {
  const s = asObject(schema);
  if (s === undefined) return { name: null, container: 'single' };

  const ref = asString(s['$ref']);
  if (ref !== undefined) return { name: lastRefSegment(ref), container: 'single' };

  // List envelope: `{ type: object, properties: { data: { type: array, items: { $ref } }, has_more } }`.
  const properties = asObject(s['properties']);
  const data = properties ? asObject(properties['data']) : undefined;
  const items = data ? asObject(data['items']) : undefined;
  const itemRef = items ? asString(items['$ref']) : undefined;
  if (itemRef !== undefined) return { name: lastRefSegment(itemRef), container: 'list' };

  return { name: null, container: 'single' };
}

interface CollectContext {
  readonly location: string;
  readonly operationId: string | null;
  readonly role: ExampleRole;
  readonly status: string | null;
}

/** Pull every `example` / `examples.*.value` out of a `content` object into `out`. */
function collectContent(
  content: unknown,
  ctx: CollectContext,
  spec: Record<string, unknown>,
  out: ExampleRecord[],
): void {
  const contentObj = asObject(content);
  if (contentObj === undefined) return;

  for (const [mediaType, mediaRaw] of Object.entries(contentObj)) {
    const media = asObject(mediaRaw);
    if (media === undefined) continue;

    const { name, container } = schemaInfo(media['schema']);

    const examples: Array<{ key: string; value: unknown }> = [];
    if (media['example'] !== undefined)
      examples.push({ key: '(example)', value: media['example'] });

    const examplesMap = asObject(media['examples']);
    if (examplesMap !== undefined) {
      for (const [key, exampleRaw] of Object.entries(examplesMap)) {
        const example = asObject(resolveRef(exampleRaw, spec));
        if (example !== undefined && example['value'] !== undefined) {
          examples.push({ key, value: example['value'] });
        }
      }
    }

    for (const { key, value } of examples) {
      out.push({
        location: ctx.location,
        operationId: ctx.operationId,
        role: ctx.role,
        status: ctx.status,
        mediaType,
        schemaName: name,
        container,
        exampleKey: key,
        exampleValue: value,
      });
    }
  }
}

const HTTP_METHODS = ['get', 'put', 'post', 'patch', 'delete', 'options', 'head'] as const;

function extractRecords(spec: Record<string, unknown>): ExampleRecord[] {
  const out: ExampleRecord[] = [];

  // ── Paths: request bodies + every response (resolving `$ref` responses) ──
  const paths = asObject(spec['paths']);
  if (paths !== undefined) {
    for (const [pathKey, pathItemRaw] of Object.entries(paths)) {
      const pathItem = asObject(pathItemRaw);
      if (pathItem === undefined) continue;

      for (const method of HTTP_METHODS) {
        const op = asObject(pathItem[method]);
        if (op === undefined) continue;
        const operationId = asString(op['operationId']) ?? null;
        const label = `${method.toUpperCase()} ${pathKey}`;

        const requestBody = asObject(resolveRef(op['requestBody'], spec));
        if (requestBody !== undefined) {
          collectContent(
            requestBody['content'],
            { location: `${label} → request`, operationId, role: 'request', status: null },
            spec,
            out,
          );
        }

        const responses = asObject(op['responses']);
        if (responses !== undefined) {
          for (const [status, responseRaw] of Object.entries(responses)) {
            const response = asObject(resolveRef(responseRaw, spec));
            if (response === undefined) continue;
            collectContent(
              response['content'],
              { location: `${label} → ${status}`, operationId, role: 'response', status },
              spec,
              out,
            );
          }
        }
      }
    }
  }

  // ── Webhooks: each event is a `post` whose requestBody carries the event payload example ──
  const webhooks = asObject(spec['webhooks']);
  if (webhooks !== undefined) {
    for (const [eventKey, itemRaw] of Object.entries(webhooks)) {
      const item = asObject(itemRaw);
      const op = item ? asObject(item['post']) : undefined;
      if (op === undefined) continue;
      const operationId = asString(op['operationId']) ?? null;
      const requestBody = asObject(resolveRef(op['requestBody'], spec));
      if (requestBody !== undefined) {
        collectContent(
          requestBody['content'],
          { location: `webhook ${eventKey}`, operationId, role: 'event', status: null },
          spec,
          out,
        );
      }
    }
  }

  return out;
}

interface LoadedSpec {
  readonly spec: Record<string, unknown>;
  readonly records: ExampleRecord[];
}

const cache = new Map<string, LoadedSpec>();

function load(path: string): LoadedSpec {
  const cached = cache.get(path);
  if (cached !== undefined) return cached;

  let raw: string;
  try {
    raw = readFileSync(path, 'utf8');
  } catch (cause) {
    throw new Error(
      `Conformance loader could not read the openapi contract at ${JSON.stringify(path)}. ` +
        `Set DINIE_OPENAPI_PATH if the api-docs repo lives elsewhere. (no network — read-only SoT)`,
      { cause },
    );
  }

  const spec = asObject(parse(raw));
  if (spec === undefined) {
    throw new Error(`Conformance loader parsed ${JSON.stringify(path)} but it is not a YAML map.`);
  }

  const loaded: LoadedSpec = { spec, records: extractRecords(spec) };
  cache.set(path, loaded);
  return loaded;
}

/** Every whole-object example associated with a request/response/webhook schema. */
export function loadExamples(path: string = OPENAPI_PATH): ExampleRecord[] {
  return load(path).records;
}

/** Names of every `components.schemas.*` entry — for the coverage gate's "schemas without examples" log. */
export function getComponentSchemaNames(path: string = OPENAPI_PATH): string[] {
  const components = asObject(load(path).spec['components']);
  const schemas = components ? asObject(components['schemas']) : undefined;
  return schemas !== undefined ? Object.keys(schemas) : [];
}
