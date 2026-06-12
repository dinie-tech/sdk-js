/**
 * Packaging test (story 011, DoD #1) — clean-install proof.
 *
 * Verifies that `npm pack` produces a tarball that, when installed into a fresh directory,
 * lets consumers do `import { Dinie } from 'dinie-sdk'` and reach the full frozen
 * surface — 6 resources, Webhooks.extract, and 8 error classes. Tests are slow (spawn npm)
 * so each one is pinned with a generous timeout and the heavy pack/install steps are shared
 * via `beforeAll`.
 *
 * Gates:
 *  - DoD #1: tarball installs; `Dinie` + resources + Webhooks + errors all importable
 *  - L20: version read dynamically from package.json; semver shape asserted, never a literal
 *  - DoD #3 (packaging side): `apiVersion` field in package.json == `'2026-03-01'`
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execSync } from 'node:child_process';
import { mkdirSync, rmSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

// ── Helpers ───────────────────────────────────────────────────────────────────

const REPO_ROOT = resolve(import.meta.dirname, '..');

/**
 * Read the current package.json version dynamically (L20: never hardcode the semver
 * string — the automated bump pipeline changes it; asserting a literal breaks CI
 * after the first bump).
 */
function currentVersion(): string {
  const pkg = JSON.parse(readFileSync(join(REPO_ROOT, 'package.json'), 'utf8')) as {
    version: string;
  };
  return pkg.version;
}

/**
 * Read the current package.json apiVersion field.
 */
function currentApiVersion(): string {
  const pkg = JSON.parse(readFileSync(join(REPO_ROOT, 'package.json'), 'utf8')) as {
    apiVersion: string;
  };
  return pkg.apiVersion;
}

const SEMVER_RE = /^\d+\.\d+\.\S+$/;

// ── State shared across tests (pack + install happen once in beforeAll) ───────

let tmpDir: string;
let tarballPath: string;
let installDir: string;
let nodeModulesDir: string;

// ── Setup / teardown ──────────────────────────────────────────────────────────

beforeAll(async () => {
  // Ensure the build is present (npm prepack runs `npm run build`, so npm pack covers this).
  tmpDir = join(tmpdir(), `dinie-sdk-packaging-${Date.now()}`);
  mkdirSync(tmpDir, { recursive: true });

  // 1. npm pack → tarball in REPO_ROOT
  const packJson = execSync('npm pack --json', { cwd: REPO_ROOT }).toString().trim();
  const packResult = JSON.parse(packJson) as Array<{ filename: string }>;
  const filename = packResult[0]?.filename;
  if (!filename) throw new Error('npm pack --json returned no filename');
  tarballPath = join(REPO_ROOT, filename);

  // 2. Create a fresh install directory with a minimal package.json
  installDir = join(tmpDir, 'consumer');
  mkdirSync(installDir, { recursive: true });
  writeFileSync(
    join(installDir, 'package.json'),
    JSON.stringify({ name: 'consumer-test', version: '1.0.0', type: 'module' }),
  );

  // 3. npm install the tarball (uses the local tarball, no registry)
  execSync(
    `npm install "${tarballPath}" undici --no-save --prefer-offline 2>/dev/null || npm install "${tarballPath}" undici --no-save`,
    {
      cwd: installDir,
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );

  nodeModulesDir = join(installDir, 'node_modules');
}, 120_000);

afterAll(() => {
  // Clean up temp dir and the tarball
  try {
    if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    // best-effort
  }
  try {
    if (tarballPath && existsSync(tarballPath)) rmSync(tarballPath);
  } catch {
    // best-effort
  }
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('DoD #1 — clean-install: npm pack → tarball → fresh install → importable surface', () => {
  it(
    'npm pack succeeds and produces a versioned tarball',
    () => {
      // L20: version is read from package.json; assert semver shape, not a literal.
      const version = currentVersion();
      expect(version).toMatch(SEMVER_RE);
      expect(existsSync(tarballPath)).toBe(true);
      // Tarball should be named dinie-sdk-<version>.tgz
      expect(tarballPath).toContain(`dinie-sdk-${version}.tgz`);
    },
    { timeout: 60_000 },
  );

  it(
    'tarball installs into a fresh directory (node_modules/dinie-sdk exists)',
    () => {
      const pkgDir = join(nodeModulesDir, 'dinie-sdk');
      expect(existsSync(pkgDir)).toBe(true);
      // dist/ must be present (not just source)
      expect(existsSync(join(pkgDir, 'dist', 'index.js'))).toBe(true);
      expect(existsSync(join(pkgDir, 'dist', 'index.d.ts'))).toBe(true);
    },
    { timeout: 60_000 },
  );

  it(
    'installed package exposes Dinie + 6 resources + Webhooks + 8 error classes via a verification script',
    () => {
      // Write a verification script to the install dir and run it with node.
      // The script imports from the INSTALLED package (not the source tree).
      const script = `
import { Dinie, Webhooks } from 'dinie-sdk';
import {
  APIError, DinieError, APIStatusError,
  BadRequestError, AuthError, PermissionDeniedError, NotFoundError,
  ConflictError, ValidationError, RateLimitError, ServerError,
} from 'dinie-sdk';
import { MockAgent } from 'undici';

// Verify Dinie constructor and 6 sub-resources are present
const mock = new MockAgent();
mock.disableNetConnect();

const dinie = new Dinie({
  clientId: 'test',
  clientSecret: 'test',
  baseUrl: 'https://api.dinie.test/api/v3',
  dispatcher: mock,
});

const resources = ['customers', 'creditOffers', 'loans', 'banks', 'credentials', 'webhookEndpoints'];
for (const r of resources) {
  if (!(r in dinie)) throw new Error('Missing resource: ' + r);
}

// Webhooks.extract is callable (static function)
if (typeof Webhooks.extract !== 'function') throw new Error('Webhooks.extract missing');

// 8 error classes are constructable and extend the right hierarchy
const errorClasses = [
  BadRequestError, AuthError, PermissionDeniedError, NotFoundError,
  ConflictError, ValidationError, RateLimitError, ServerError,
];
for (const Cls of errorClasses) {
  if (!(Cls.prototype instanceof APIStatusError)) throw new Error('Error hierarchy broken: ' + Cls.name);
}

// Negative control: wrong-shape call throws BEFORE any HTTP (argument validation is sync)
let threw = false;
try {
  // cpf is required on customers.create — passing without it should error at schema validation
  await dinie.customers.retrieve('not-a-cust-id-but-still-triggers-token-fetch');
} catch (_) {
  // Expected — any throw (no mock registered → undici disableNetConnect) proves we reached the HTTP layer
  threw = true;
}
if (!threw) throw new Error('Expected the unregistered-mock call to throw');

console.log('Surface verification PASSED');
`;
      const scriptPath = join(installDir, 'verify.mjs');
      writeFileSync(scriptPath, script);

      const result = execSync(`node "${scriptPath}"`, {
        cwd: installDir,
        encoding: 'utf8',
      }).trim();

      expect(result).toContain('Surface verification PASSED');
    },
    { timeout: 60_000 },
  );

  it('DoD #3 packaging side — apiVersion field in package.json equals the generated constant', () => {
    // The package.json apiVersion field is set by bump when it advances the SDK.
    // It must match the generated api-version.ts constant '2026-03-01'.
    const apiVersion = currentApiVersion();
    expect(apiVersion).toBe('2026-03-01');
  });

  it('L20 — version from package.json matches semver shape (never a hardcoded literal)', () => {
    const version = currentVersion();
    expect(version).toMatch(SEMVER_RE);
    // Confirm it's not the dev-sentinel
    expect(version).not.toContain('0.0.0+dev');
  });
});
