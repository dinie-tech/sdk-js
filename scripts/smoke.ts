/**
 * Smoke E2E placeholder — deferred, NOT a CI gate (see architecture §11).
 *
 * The live smoke test against Dinie staging depends on the `sdk-smoke-test`
 * credentials (a Dinie prerequisite not yet delivered). Until those arrive this
 * script only checks that the `DINIE_*` credentials are present: it performs NO
 * network call and never fails the build. When the credentials land, the real
 * smoke flow (create a customer, list it, verify a webhook) replaces the body
 * below.
 */

const REQUIRED_ENV = ['DINIE_CLIENT_ID', 'DINIE_CLIENT_SECRET', 'DINIE_BASE_URL'] as const;

const missing = REQUIRED_ENV.filter((name) => !process.env[name]);

if (missing.length > 0) {
  console.warn(
    `[smoke] skipped — missing credentials: ${missing.join(', ')}.\n` +
      '[smoke] Live smoke E2E is deferred (architecture §11). Populate DINIE_* in ' +
      '.env to enable it once Dinie delivers the sdk-smoke-test credentials.',
  );
  process.exit(0);
}

console.warn(
  '[smoke] credentials present, but the live smoke flow is not implemented yet ' +
    '(deferred to a later version). Exiting without making any network call.',
);
process.exit(0);
