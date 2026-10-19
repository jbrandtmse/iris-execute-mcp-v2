# Test Automation Summary - Story 38.2 (Line-Range Document Read)

QA gap analysis of the diff `8fae074..689f785` against the spec's I/O & Edge-Case Matrix and ACs. Every matrix row and
AC already had a pinning test with a recorded mutation. The gaps closed here are the ones the implement stage's suite
was blind to.

## Generated / Modified Tests

### Vitest (`@iris-mcp/all`)
- [x] `packages/iris-mcp-all/src/__tests__/story-38-2-qa-doc-claims.test.ts` - 9 tests (new, AC-6, AD-29): the README
  line-range example is executed against the built `iris_doc_get` (fed the README's own full-read example); the README
  tool-table row equals the built schema's parameters; the CHANGELOG header form, field list and shared exports match
  the built code; the "right-aligned in 6 columns" claim holds in four documents against the built
  `NUMBERED_LINE_WIDTH`; the changeset bumps shared and dev minor.

### Vitest (`@iris-mcp/dev`)
- [x] `packages/iris-dev-mcp/src/__tests__/doc-get-range-framework.test.ts` - 10 tests (one added, AC-2): `metadataOnly`
  sent as the string "true" or "false" through the real `McpServerBase`. (Code review later made it 11, adding the SDK
  `tools/call` wire case, and made the file's env harness clear the visibility, governance and Server Manager inputs;
  it also added a read-only `%occStatus.inc` case to the live gate, making 20 there.)
- [x] `packages/iris-dev-mcp/src/__tests__/doc-get-range-live-gate.test.ts` - 19 tests (two added, AC-5), armed against
  `default` / HSCUSTOM (IRIS 2026.2 build 221U): a ranged read of the read-only `%`-prefixed system class
  `%Library.RegisteredObject.cls`, and a class's `totalLines` equal to `iris_loc_count`'s.

## Runs
- `@iris-mcp/dev` full suite 49 files / 898 tests; `@iris-mcp/all` full suite 29 files / 273 tests; lint and
  type-check for dev clean.
- Both live gates armed (`IRIS_REQUIRE_LIVE=1`, six `IRIS_*` variables explicit): 25 passed, none skipped;
  `live-gate-roster.test.ts` 5 passed.
- `iris_doc_list` for `ExecuteMCPv2.Temp.QaStory382` returned `{"items":[]}` afterwards.

## Falsifiability
Seven mutations demonstrated red and reverted byte-identical (recorded under the spec's `## Verification`).

## Not tested (by decision)
- `iris_doc_edit` is named by the description, README, CHANGELOG and changeset but is registered by Story 38.4; a test
  that it exists would be red until then.
- Precedence among M1, M2 and M3 beyond the pinned M1-before-M2 is not in the spec.
