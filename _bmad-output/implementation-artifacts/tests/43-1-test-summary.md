# Test Automation Summary - Story 43.1 (Framework Migration to SDK v2)

QA gap analysis against the I/O and Edge-Case Matrix, AC 43.1.1 to AC 43.1.5, DW-579 and DW-617. The implement stage's golden,
pin tests and 19 recorded mutations were re-checked, not redone. Four test files were added where the brief's real-runtime
cases had no row: the results of tool HANDLERS (the golden cannot reach them, because a handler needs IRIS), the DW-579 audit
over the whole catalogue on the real process, what `npm pack` would publish, and the process ending with its client. Two
failure classes the existing tests are blind to were demonstrated by mutation. No product source changed.

## Generated Tests

### Built servers over stdio against a local fake IRIS (AC 43.1.3, DW-579; Rules 3, #36, #49, #59)
- [x] `packages/iris-mcp-all/src/__tests__/story-43-1-qa-handler-golden.test.ts` - 72 tests, about 4 s.
  - Each of the five built servers runs against `scripts/lib/fake-iris-listener.mjs` (127.0.0.1, ephemeral port, no IRIS).
  - 22 `tools/call` rows: the response line, the requests the server makes to IRIS and the audit entries are compared with
    `fixtures/sdk-handler-golden.json`, captured from the SDK v1 build of `39fd0ea` (a `git worktree`, removed afterwards).
  - Rows: success with `structuredContent`; `isError` with and without it; `isError:false` with it; a handler that
    throws; an HTTP 500 error envelope; a governance denial; numeric and boolean strings that must arrive parsed; an
    unknown key that must be dropped.
  - The one sanctioned difference is the DW-579 entry of the final schema-invalid call.
  - Includes unit tests of the comparer, so a replay that drifts cannot pass unnoticed.
- [x] `packages/iris-mcp-all/src/__tests__/story-43-1-qa-dw579-process.test.ts` - 27 tests, about 5 s.
  - For every tool of every server (115): a schema-invalid call writes exactly one entry (`outcome` `error`, the client's
    text, raw key names, no `params`, no `dataPolicy`), with `IRIS_AUDIT_LOG_PARAMS` set and unset.
  - An invented secret (as an object, as a string in a non-string field, inside an enum) reaches neither the audit file,
    the response nor stderr.
  - An unknown tool and a hidden tool write no entry, while a visible call in the same session is audited.
- [x] `packages/iris-mcp-all/src/__tests__/story-43-1-qa-stdio-lifecycle.test.ts` - 5 tests.
  - Each built server, after a call that reached the fake IRIS, exits with code 0 and no signal when stdin closes.

### What would be published (AC 43.1.1, AC 43.1.2)
- [x] `packages/iris-mcp-all/src/__tests__/story-43-1-qa-pack-confinement.test.ts` - 28 tests.
  - Reads the `npm pack --dry-run --json` file list of shared, the five servers and `@iris-mcp/all`, and the files on disk.
  - No packed file names `@modelcontextprotocol/sdk`.
  - Only shared imports an SDK module, and only `server` and `server/stdio`.
  - The one runtime SDK dependency is shared's `server` at exactly 2.3.1; `client` is a test-only exact devDependency.

### Support files
- `scripts/lib/fake-iris-listener.mjs`, `scripts/lib/sdk-handler-golden-core.mjs`, `scripts/capture-sdk-handler-golden.mjs`,
  `packages/iris-mcp-all/src/__tests__/fixtures/sdk-handler-golden.json`.
- `scripts/lib/sdk-wire-golden-core.mjs`: `openRawWire` gained `endInput()` and `exit()` (additive).

## One-time checks (recorded in the spec's Verification section)
- A real `@modelcontextprotocol/sdk@1.29.0` client against the five built v2 servers: 214 checks, 0 failures; the same
  script against the v1 baseline servers fails 11, all `prompts-get:omitted:*` (DW-617).
- v1 against v2 on the fake IRIS over the whole catalogue (1266 calls, default and all-enabled governance): lines and
  requests to IRIS identical except `iris_macro_info`, a handler-internal race that also differs between two runs of one build.
- Probes the golden does not send: 120 of 127 leaves identical; 7 differ (findings Q2, Q3).

## Coverage
- Matrix rows pinned before this stage: all except "valid calls" at the handler level, "unknown or hidden tool" at the
  audit level for a hidden tool, and the shutdown path; those three now have a pinning test.
- Mutations demonstrated by QA: 10, each red on the path it guards and reverted to the same checksum.
- Default suite: iris-mcp-all 139 files green in three slices; the four new files shuffled at seeds 11 and 22: 132 of 132.

## Findings for the lead
- Q1: the member-order exception (wave-8 decision #4, deferred entry 5) rests on a false premise. The v1 SDK server
  re-parses every `tools/call` result with its result schema, so the v1 wire already wrote `content, structuredContent,
  isError`. Evidence: byte-identical v1 and v2 lines for 3 handler-golden rows and all 90 such results of the sweep.
- Q2: a malformed `tools/call` request gets `-32602 Invalid tools/call request: ...` on v2, `-32603` with the bare zod text
  on v1 (low; not sanctioned).
- Q3: a `tools/call` with a `task` param is served as a plain call on v2; v1 answered `-32603` (low).

## Next Steps
- The lead arms the seven live-only files and the 39.3 gate at smoke (deferred entry 3).
- Decide Q1 (correct AD-15, CHANGELOG, the changeset, the comment at `sdk-wire-compat.test.ts:419-421`, entry 5), Q2 and Q3.
- Stories 43.2 and 43.4 reuse `sdk-handler-golden-core.mjs` and the fake listener for the 2026-07-28 era.
