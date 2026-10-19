# Test Automation Summary - Story 39.6 (Message Forensics Docs, Prompt and Capstone)

QA gap analysis against the I/O and Edge-Case Matrix and AC-1 to AC-8. The implement stage's pinning tests
and recorded mutations were re-checked; two files were added where a matrix row or the project's wire rule had
no pinning test. No source file changed.

## Generated Tests

### Prompts on the real SDK wire (AC-2, AC-6; Rule #46)
- [x] `packages/iris-mcp-all/src/__tests__/story-39-6-qa-forensics-prompts-sdk-wire.test.ts` - 13 tests. Built
  interop server, real SDK `Client` over `InMemoryTransport.createLinkedPair()`: capability, `prompts/list`,
  the first-published `trace-message-flow` contract after result validation, both flows with optional
  arguments omitted and given, `getPrompt({name})` with `arguments` omitted entirely, hostile patient
  identifiers, served text equal to `build()`, tool tokens on `tools/list` and under the `core` preset, no rule
  number or repository path (prompts and generated skill bodies), no policy loosening.

### Snapshot CLI, three modes (AC-5, AC-7)
- [x] `packages/iris-mcp-all/src/__tests__/story-39-6-qa-snapshot-cli.test.ts` - 12 tests. The CLI spawned on
  throwaway trees with the real built dists linked in: no flag, unknown flag and both flags refuse; `--check`
  is read-only on a match, a new tool, a changed description, a flipped annotation and a vanished tool;
  `--force` re-pins, writes into an empty tree, rewrites a current copy and its file passes `--check`. The
  committed fixture is hashed before and after and is never rewritten.

## Mutations (5, each red then reverted byte-identical)
- CLI no-flag refusal removed -> both no-flag rows red.
- `--force` does not write -> the three `--force` rows red (one row strengthened after it stayed green).
- `--check` rewrites the snapshot -> the match and new-tool rows red, on mtime.
- `findPatientMessages.ts` writes the identifier without `JSON.stringify` -> the hostile-identifier row red.
- `traceMessageFlow.ts` `sessionOrHeaderId` `required: false` -> the contract row and the missing-argument row red.

## Coverage
- Matrix rows now pinned by a test that drives the real surface: `trace-message-flow` get, `find-patient-messages`
  get, Skills (wire description equals skill), Snapshot match, drift, new or vanished tool, no flag.
- Capstone red proof verified from the recorded mutations and the intact mutation point and dist; the armed
  capstone ran once unmutated (5 passed, none skipped) and left nothing on the instance.

## Next Steps
- None required. Observation: an all-optional prompt (`recover-stuck-production`) still refuses an omitted
  `arguments` object (documented SDK limitation, closed by an earlier decision); the new tests accept a clean
  refusal or a render for that case so a later fix does not break them.
