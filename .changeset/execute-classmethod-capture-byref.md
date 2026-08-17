---
"@iris-mcp/dev": patch
---

feat(execute): `iris_execute_classmethod` — captured output, `{byRef, value?}` markers, 20-argument ceiling

`iris_execute_classmethod` no longer requires a bespoke `%SYS.Capture` wrapper class to call an ObjectScript classmethod that `Write`s to the current device — including narrating patch/config runners, stock `%UnitTest.Manager.RunTest`, and targets that switch namespace (`ZN`) mid-execution. The response gains three additive fields: `output` (captured device text), `byRefValues` (post-call values for positions marked `{byRef: true}`, keyed by zero-based index — a plain scalar out-value is the raw value, an idiomatic subscripted `Output` array is a nested `{value?, subscripts?}` object), and `truncated` (boolean; `true` only in the rare case where captured output hit the platform's long-string ceiling mid-call — the call still succeeds with a partial capture, and this is never silent even when the target's own code would otherwise swallow the underlying condition).

`args` entries may now be plain scalars (unchanged, by value) or `{byRef: true, value?}` marker objects for `ByRef`/`Output` parameters; `value` may be omitted for Output-style undefined-in but not JSON `null`, and must be a scalar. The argument ceiling is raised from 10 to 20.

`iris_execute_command` gains the same additive `truncated` field, because the capture mechanism is shared between the two endpoints. Its previous behavior at the long-string ceiling was an opaque error; the command now completes and returns whatever was captured, flagged rather than silent. Only a genuine `<MAXSTRING>` in the capture buffer sets the flag — any other condition raised while capturing is re-thrown as the real error it is, never re-labelled as truncation.

Strictly additive (Rule #19): `returnValue`/`argCount` and existing plain-scalar calls are byte-identical to prior behavior. No new tool, governance key, or action — `iris_execute_classmethod` keeps its existing `write` classification and default state.

The `truncated` field is now also carried on the ERROR envelope returned by the underlying `/command` and `/classmethod` REST endpoints (previously it was computed there but silently discarded on any failure path reached after capture began). On the server side, every `ExecuteMCPv2.REST.*` HTTP handler now renders its JSON response through a small shared base class that pre-validates serialization before writing anything to the client — defense-in-depth against a response-render failure ever shipping a truncated, invalid body with no error signal; this closes a pattern shared by the whole handler family, not a live bug in any of them today. Both changes are internal robustness improvements with no effect on a well-formed successful call.

(Update, Story 34.5: the TS client originally discarded that error envelope's `result` at the `IrisApiError` throw site, so `truncated` was not yet reachable from a failed tool call — see the `execute-tests-zero-result-guard` changeset for the fix, which makes `truncated` actually visible to tool callers on the error path.)
