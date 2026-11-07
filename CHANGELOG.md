# Changelog

All notable changes to `dinie-sdk` are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed

- A `409` with the problem code `idempotency_key_in_use`, sent while an earlier request with the same idempotency key is still running, is now retried like a `429`: same key, after its `Retry-After`, within `maxRetries`. The call returns the stored response the API replays once the first request finishes. Any other `409` is still raised without a retry.

## [1.1.1] - 2026-11-06

### Fixed

- The default `baseUrl` is now `https://api.dinie.com/api/v3`. The previous default, `https://api.dinie.com.br/api/v3`, does not resolve, so a client built without a `baseUrl` could not reach the API.
- The README sandbox examples use `https://api-dev.dinietech.io/api/v3`.

## [1.1.0] - 2026-06-13

## [1.0.0] — 2026-06-12

Initial public release.
