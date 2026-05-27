# Changelog

All notable changes to `@dinie/sdk` are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Project scaffold: `package.json` (`@dinie/sdk`, ESM, `private`), strict
  TypeScript / Vitest / Prettier config.
- `src/runtime/` <-> `src/generated/` directory boundary with `CODEOWNERS`
  (placeholder ownership per architecture D2) and empty curated barrels.
- Test tree (`tests/runtime`, `tests/generated`, `tests/_helpers`).
- CI workflow: type-check + test + format:check on Node 18 and 20.
- `.env.example` and `npm run smoke` placeholder for the deferred (non-gate)
  live smoke E2E.
