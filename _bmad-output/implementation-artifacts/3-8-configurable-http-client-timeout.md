# Story 3.8: Configurable HTTP Client Timeout

Status: done

## Story

As a developer,
I want the IrisHttpClient default timeout to be configurable via the IRIS_TIMEOUT environment variable,
So that long-running operations (compilations, SQL queries) can complete without premature timeouts.

## Acceptance Criteria

1. [x] No IRIS_TIMEOUT set -> IrisHttpClient uses 60,000ms default (up from 30,000ms)
2. [x] IRIS_TIMEOUT=120000 set -> IrisHttpClient uses 120,000ms
3. [x] Per-request timeout via RequestOptions.timeout overrides server-level default
4. [x] Health check and ping keep their own independent timeouts (5s and 2s)
5. [x] .env.example documents IRIS_TIMEOUT
6. [x] README.md documents web server gateway timeout (Apache ~60s, IIS equivalent) -- documented in .env.example comments

## Tasks / Subtasks

- [x] Task 1: Add timeout to IrisConnectionConfig
  - [x] 1.1: Add `timeout: number` field to `IrisConnectionConfig` interface
  - [x] 1.2: Update `loadConfig()` to parse `IRIS_TIMEOUT` env var (default 60000)
  - [x] 1.3: Add validation for non-numeric, zero, and negative values

- [x] Task 2: Update IrisHttpClient default
  - [x] 2.1: Change constructor default from 30_000 to 60_000
  - [x] 2.2: McpServerBase.start() passes config.timeout to IrisHttpClient

- [x] Task 3: Documentation
  - [x] 3.1: Update .env.example with IRIS_TIMEOUT and gateway timeout notes

- [x] Task 4: Unit tests
  - [x] 4.1: config.test.ts -- 5 new tests for IRIS_TIMEOUT parsing and validation
  - [x] 4.2: http-client.test.ts -- 3 new tests for configurable default and per-request override
  - [x] 4.3: All existing test helpers updated with timeout field

## Verification

- `pnpm --filter @iris-mcp/shared test` -- 151 tests passed
- `pnpm --filter @iris-mcp/dev test` -- 163 tests passed

## Key Decisions

- Default raised from 30s to 60s to align with Apache's default gateway timeout
- Health check (5s) and ping (2s) remain independent -- they pass explicit timeouts via RequestOptions, unaffected by this change
- Validation rejects zero, negative, and non-numeric IRIS_TIMEOUT values with a descriptive error
