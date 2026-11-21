# Test Automation Summary - Story 43.4 (SDK v2 docs, smokes and capstone)

QA gap analysis against the implement stage's recorded mutations. Every run used a closed port (`IRIS_HOST=127.0.0.1 IRIS_PORT=1`) or the in-process fake listener; no IRIS instance, `claude` or Inspector was contacted.

## Generated Tests

### Real wire (built servers, both protocol eras)
- [x] `packages/iris-mcp-all/src/__tests__/story-43-4-qa-sanctioned-wire.test.ts` - 44 tests. The five servers over the raw stdio driver, against the RAW frozen golden, the spec's decision #24 sentences and the pre-story `resend-failed-messages` body hash, none of which pass through the ledger loader. Descriptions, `resources/list` (once, with a second profile too), templates, reads, prompts.
- [x] `packages/iris-mcp-all/src/__tests__/story-43-4-qa-probe-copy.test.ts` - 5 tests. The DW-641 probe copy on the real SDK client: process starts, `sessionStart` lines, bootstrap version queries, stderr, SIGTERM, no survivor; the silent-probe fallback to 2025-11-25; the SDK's 60 s default.
- [x] `packages/iris-mcp-all/src/__tests__/story-43-4-qa-docs-runtime.test.ts` - 10 tests. The documented `Elicitation` hook output answered to a live dialog on both eras; the revisions on every server; the era line at the default log level.

### Gates
- [x] `packages/iris-mcp-all/src/__tests__/story-43-4-qa-gate-guards.test.ts` - 6 tests. The five golden tests read through the ledger (the handler golden test would stay green on a raw read); the capstone is in the default suite (`vitest list`), cannot skip, and is not a prepublish roster entry.

### Extended
- [x] `epic43-capstone-gate.test.ts` - step 9: the era line is still written once after the whole walk (a mutation that the early count could not see).
- [x] `qa-41-7-doc-links.test.ts` - the two client docs; `KNOWN_BROKEN` carries DW-631 and fails once the anchor is fixed.
- [x] `process-gate-helpers.ts` - an optional `probe` member of the `SdkVersionNegotiation` type.

## Coverage
- Ledger: 9 mutations on the real loader path (unnamed row, replace-not-append, consistent one-character `old`, duplicate id, pointer outside the row, unknown key, raw-golden bypass, two silent loader bugs); the SHA-256 pin and CHANGELOG sanction-id rows were demonstrated by the implement stage.
- Capstone: one surviving mutation found and closed (step 9); three candidates confirmed caught (audit `confirmation`, validation text, era line).
- 26 mutations demonstrated by QA, recorded in the spec's `## Verification`.

## Next Steps
- The lead's live smoke (AC 43.4.1) still owns: Claude Code and Inspector on both eras, the hook matcher, and the Claude Code single server start.
