# Project Rules

Durable rules for AI dev + code-review agents working on this project. Rules are accumulated from completed epic retrospectives and any other moment where a general pattern is recognized. Each rule captures a reusable lesson, with a short citation of the bug, anti-pattern, or situation that motivated it.

**How rules land here:** every retrospective ends with a "Rules to codify" step. Any lesson with general-pattern shape (would prevent a recurrence of a class of issues in a future epic, not just the specific incident at hand) is added to this file. Narrow one-off fixes stay in the source retro/story document and do NOT become rules.

**Template usage:** this header and Rule #1 (the meta-rule below) are intentionally project-agnostic — they can be dropped into any new project's `.claude/rules/project-rules.md` as the starting template. Subsequent rules (#2 onwards) are project-specific and accumulate from that project's retrospectives.

---

## 1. Meta-rule — codify retrospective lessons as rules

**Context:** Every completed epic retrospective (and any other moment a reusable lesson is explicitly identified).

**Rule:** At the end of every retrospective, add a "Rules to codify" step. For each lesson with general-pattern shape, append a new rule to this file following the format below. Narrow one-off fixes stay in the retrospective document and do NOT become rules.

**Format per rule:**
- Numbered heading with short title
- `**Context:**` — when the rule applies
- `**Rule:**` — what to do (or not do)
- `**Why:**` — the bug, anti-pattern, or cost that motivated the rule (with commit hash or bug number from the source retro if useful)
- Optional code snippet or example

**Why:** Retrospectives without a codification step produce lessons that age. The next epic then re-learns them the hard way. The value of a retro compounds only when its lessons become durable guidance the next dev/review agent actually sees before making a decision. Story files, commit messages, and retrospective prose do not survive as agent-visible context beyond the session that wrote them — `.claude/rules/*.md` does.

**How to apply:** when closing any retrospective:
1. Review the retrospective's "What could've gone better" and "Lessons learned" sections.
2. For each lesson, ask: *does this prevent a class of future bugs, or is it specific to the one that already happened?*
3. If class-of-bugs → append to this file.
4. Commit the rule file update in the same commit as the retrospective document.

**Cross-project library note:** rules here are project-scoped by default. When multiple projects adopt this system, rules with evidence from 2+ projects can be elevated into a shared library (shared npm package, git submodule, or copy-and-curate sync). Tag rules with `id:` slugs and `scopes:` frontmatter when that cross-project moment arrives so merging is mechanical rather than manual.

---

## 2. Read IRIS class source before wrapping

**Context:** A new (or modified) `ExecuteMCPv2.REST.*` handler needs to enumerate an IRIS system class via `%ResultSet.%New("<class>:List")`, or read properties back via `##class(<class>).Get(name, .props)`.

**Rule:** Before writing handler code that reads specific fields, open the actual IRIS class source in [`irislib/`](../../irislib/) or [`irissys/`](../../irissys/) and verify:
- The **ROWSPEC** of any named query (`Query X:List` declaration — look for `ROWSPEC = "Col1:%String,Col2:..."`).
- The **property list** of the class (`Property X As Y;` declarations).
- Any **`[Deprecated]`** annotations (see Rule #4).

`List` ROWSPEC is usually narrower than the full property list. Don't assume a field exists because it's on the class — it may not be exposed by the query you're calling. If the field you need isn't in the ROWSPEC, either (a) switch to a wider named query (e.g., `ListAll` on `Security.Roles`), or (b) call `.Get(name, .props)` per row and read from the property array.

**Why:** Epic 11 Bugs #3, #4, #5 (commits `fabddc0`): `Security.Roles:List` ROWSPEC has no `Resources` column; handler read `tRS.Get("Resources")` and got empty string for every role. Fix: switch to `Security.Roles:ListAll`. Same pattern for `Security.Users:List` missing `FullName`/`Comment`. Same handler file, three bugs from the same root cause.

---

## 3. Config.* vs SYS.* vs Security.* class separation

**Context:** Reading or writing IRIS configuration / runtime state.

**Rule:** IRIS system classes split along these axes:
- `Config.*` classes hold **persistent configuration** (what's declared in the CPF, stored in `^%SYS("CONFIG",...)`).
- `SYS.*` classes hold **runtime / live state** (what's actually happening in the running instance).
- `Security.*` classes hold **authorization state** (users, roles, resources — always namespace `%SYS`).

Joining is often needed. A handler that lists databases must read `Config.Databases` (for configuration: name, directory, journal policy) AND `SYS.Database` (for runtime state: Size, MaxSize, ExpansionSize, Mounted). Neither class alone is sufficient.

**Why:** Epic 11 Bug #2 (commit `524d170`): `iris_database_list` returned `size:0` for every database because the handler only read `Config.Databases`. `Config.Databases.Size` doesn't exist; `SYS.Database.Size` is the real property. Fix: open `SYS.Database.%OpenId(directory)` per row and read sizes from there.

---

## 4. `[Deprecated]` property caution

**Context:** Any SELECT or property read against an IRIS system class.

**Rule:** Check for `[ Deprecated ]` (or `[Deprecated, Internal]`) annotations on IRIS class properties before writing code that reads or writes them. Deprecated properties:
- May still be SELECT-able but return empty or stale values.
- May be disconnected from the non-deprecated replacement that actually reflects runtime state.
- Are often kept for binary-compat, not for actual use.

When found, locate the replacement property (usually in the same class, with a note in the deprecated property's doc comment) and use it. Document the choice in a comment near the SELECT / property access.

**Why:** Epic 11 Bug #6 (commit `fabddc0`): `Security.SSLConfigs.Protocols` is `[ Deprecated ]`; the real fields are `TLSMinVersion` + `TLSMaxVersion`. MCP tool's `iris_ssl_manage` wrote to `protocols`, got silently dropped. Pre-release schema break required to fix cleanly.

---

## 5. `$ZU(...)` per-process vs instance-wide

**Context:** Reading system counters (global refs, routine commands, process count, etc.).

**Rule:** Most `$ZU()` built-in functions return **per-process** values (the current IRIS job's counters). Do NOT use them for instance-wide metrics that report system totals. Use these instead:
- **System-wide global references**: `##class(SYS.Stats.Global).Sample()` → sum of `RefLocal + RefPrivate + RefRemote`.
- **System-wide routine commands**: `##class(SYS.Stats.Routine).Sample().RtnCommands`.
- **Uptime, process count, database sizes**: see existing patterns in [`src/ExecuteMCPv2/REST/Monitor.cls`](../../src/ExecuteMCPv2/REST/Monitor.cls).
- When in doubt: cross-check the implementation against the IRIS Management Portal System Dashboard. Numbers should be within an order of magnitude and monotonically increasing.

**Why:** Epic 11 Bug #9 (commit `524d170`): `iris_metrics_system` returned `iris_global_references_total=2, iris_routine_commands_total=0` after 33 hours of uptime. Root cause: `$ZU(190,0)` / `$ZU(190,1)` are per-process. Fix: switch to `SYS.Stats.Global.Sample()` / `SYS.Stats.Routine.Sample()`. Verified via monotonicity (+675 globals / +15,045 routine cmds over ~5s in live verification).

---

## 6. `%All` super-role short-circuit in permission checks

**Context:** Any handler that checks whether a user or role has a permission on a resource.

**Rule:** The IRIS `%All` super-role is special-cased by the security subsystem — it grants every permission on every resource but does NOT encode that grant as explicit `resource:permission` pairs in its `Resources` property. Any handler that walks `tProps("Resources")` (from `Security.Users.Get` or `Security.Roles.Get`) MUST short-circuit for `%All`.

Implementation: check if the target IS the `%All` role, OR if the target is a user whose role list contains `%All`. When yes, return `granted: true` with a clear `reason` field explaining the short-circuit.

Use **exact `$Piece` equality** when scanning the user's role list — NOT substring `[` match — to avoid false-positives on hypothetical names like `%AllCustom`:

```objectscript
Set tIsSuperUser = 0
If tTarget = "%All" {
    Set tIsSuperUser = 1
} ElseIf tIsUser {
    For tI = 1:1:$Length(tUserRoles, ",") {
        If $Piece(tUserRoles, ",", tI) = "%All" {
            Set tIsSuperUser = 1
            Quit
        }
    }
}
```

**Why:** Epic 11 Bug #10 (commit `fabddc0`): `iris_permission_check({target:"_SYSTEM", resource:"%DB_USER", permission:"RW"})` returned `granted:false` because `_SYSTEM` holds `%All` and `Security.Roles.Get("%All").Resources` is empty.

---

## 7. REST handler I/O redirect + single-response dispatch

**Context:** An `ExecuteMCPv2.REST.*` handler method that uses `##class(%Library.Device).ReDirectIO(1)` to capture `Write` output from executed code (e.g., `Command:Execute` XECUTE path).

**Rule:** Error-envelope integrity depends on two related guarantees:

**(a) Fully restore I/O redirect state BEFORE calling `RenderResponseBody`.** If the redirect is still active when you render the response, the JSON envelope writes go to the capture buffer instead of the HTTP response stream — client sees "non-JSON response". Required restore sequence:

```objectscript
Do ##class(%Library.Device).ReDirectIO(0)  ; unconditionally disable redirect
Use tInitIO                                  ; restore original device (no mnemonic arg)
Set tRedirected = 0
; NOW it is safe to call RenderResponseBody
```

`Use tInitIO::("")` (passed when `tOldMnemonic=""`) is a **no-op** that does NOT reset the mnemonic — use `Use tInitIO` without the `::(...)` clause to fully clear the device state.

**(b) Guarantee exactly one `RenderResponseBody` per request.** Do NOT place `RenderResponseBody` inside both a `Catch` block AND the success path of a surrounding `Try` — argumentless `Quit` inside `Catch exCmd { ... Quit }` exits only the catch body, not the outer Try, so control falls through to the success-path render which clobbers the error envelope. Pattern to use instead:

```objectscript
Set tCmdErrored = 0
Try {
    ; ... code that may throw ...
} Catch exCmd {
    Set tCmdErrored = 1
    Set tCmdStatus = exCmd.AsStatus()
    ; Do NOT call RenderResponseBody here.
}

; I/O restore happens here, unconditionally, after the Try/Catch.
Do ##class(%Library.Device).ReDirectIO(0)
Use tInitIO
Set tRedirected = 0

; Single dispatch — exactly one RenderResponseBody call per request.
If tCmdErrored {
    Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tCmdStatus))
} Else {
    Do ..RenderResponseBody($$$OK, , tResult)
}
```

**Why:** Epic 11 Bug #1 (commit `b3be8a4`): `iris_execute_command` with any runtime error (bad syntax, `<DIVIDE>`, `<CLASS DOES NOT EXIST>`) returned `"IRIS returned a non-JSON response"` because TWO defects compounded — redirect wasn't disabled before render, AND argumentless `Quit` inside catch fell through to the success-path render.

**Related:** the `$QUIT` special-variable / argumentless-Quit guidance in [`iris-objectscript-basics.md`](./iris-objectscript-basics.md#quit-statement-restrictions-in-trycatch-blocks) covers the Try/Catch semantics but doesn't address the double-render risk. This rule is the Try/Catch × RenderResponseBody composition.

---

## 8. `SanitizeError` / status wrapping — strip existing prefixes

**Context:** Any utility that takes a `%Status`, extracts its text via `$System.Status.GetErrorText()`, sanitizes it, and re-wraps in a new status.

**Rule:** `GetErrorText()` returns text that already has `ERROR #N: ` (or locale variant like `خطأ #N: `) prepended. Re-wrapping that text via `$$$ERROR($$$GeneralError, tSafe)` produces a doubly-wrapped status like `ERROR #5001: ERROR #5001: <original>`. Before the final wrap, strip a single leading `^(ERROR|خطأ)\s+#\d+:\s*` prefix:

```objectscript
; Strip leading "ERROR #N: " or "خطأ #N: " (single occurrence)
For tPrefix = "ERROR #", "خطأ #" {
    If $Extract(tSafe, 1, $Length(tPrefix)) = tPrefix {
        Set tRest = $Extract(tSafe, $Length(tPrefix) + 1, *)
        Set tColon = $Find(tRest, ": ")
        If tColon > 0 {
            Set tCodeChunk = $Extract(tRest, 1, tColon - 3)
            If tCodeChunk ? 1.N {
                Set tSafe = $Extract(tRest, tColon, *)
                Quit ; single strip only
            }
        }
    }
}
```

Do NOT strip `<ERROR>` bracket-style tokens like `<UNDEFINED>` — those don't have `#<digits>:` and are legitimate error info.

**Why:** Epic 11 Bug #11 (commit `b3be8a4`): errors propagated through multiple handler layers came out as `خطأ #5001: خطأ #5001: Failed to change password for user 'X'`. The Arabic `خطأ` comes from the IRIS locale (see Rule #13 on locale vs message tables) — the double-wrap was the bug; the locale was incidental.

---

## 9. Error propagation in handlers — don't swallow `%Status`

**Context:** A REST handler that calls an IRIS system class method (`Security.*.Modify()`, `Config.*.Create()`, etc.) and the call can fail.

**Rule:** If the system-class call returns a non-OK `%Status`, propagate its text via `##class(ExecuteMCPv2.Utils).SanitizeError(tSC)` instead of wrapping in a generic `"Failed to X for Y"` string. The IRIS error text usually contains the real reason (policy violation, missing argument, nonexistent target) that the client needs to fix their request.

Exception: if the `%Status` text could embed a sensitive value (e.g., a password) that the client submitted, apply field-specific redaction BEFORE propagating — but don't drop the diagnostic signal entirely. Handle short-substring corruption (a single-letter password replacing every occurrence of that letter) with a minimum-length gate on the `$Replace` call.

**Why:** Epic 11 Bug #12 (commit `fabddc0`): `iris_user_password action:"change"` for a non-existent user returned a generic `"Failed to change password for user 'NoSuchUser'"` instead of the actual IRIS error `"User NoSuchUser does not exist"`. Fix: pass the `%Status` from `Security.Users.Modify()` through `SanitizeError` directly.

---

## 10. Wire-explicit defaults in MCP tools

**Context:** A TypeScript MCP tool whose Zod schema declares a default value for a parameter via description text (e.g., `"Default: '*.cls,*.mac,*.int,*.inc'"`).

**Rule:** Do NOT rely on "when caller omits the param, the server defaults." Server-side defaults may differ from what the tool description advertises. Send the documented default explicitly on the wire every time:

```typescript
// Bad:
if (files !== undefined) params.set("files", files);

// Good:
params.set("files", files ?? "*.cls,*.mac,*.int,*.inc");
```

If the server genuinely needs "caller omitted" to trigger some special behavior, use a separate sentinel or an opt-out param name — don't conflate "omitted" with "use the documented default."

**Why:** Epic 11 Bug #7 (commit `938c5b2`): `iris_doc_search({query: "X"})` with no `files` arg returned empty matches even when the marker existed in `.cls` files. Atelier's server-side default for `files` doesn't match `.cls`. Tool description said default was `*.cls,*.mac,*.int,*.inc` but the handler never sent it.

---

## 11. `$HOROLOG` → ISO 8601 in TypeScript layer

**Context:** Any MCP tool that forwards a timestamp field from IRIS to the client.

**Rule:** IRIS returns timestamps in `$HOROLOG` format: `days,seconds.frac` (day 0 = 1840-12-31). This format is opaque to clients. Convert to ISO 8601 in the tool's TypeScript response mapping; preserve the raw value in a `<field>Raw` field for debugging and round-trip.

```typescript
function horologToIso(h: string): string {
  if (!h || typeof h !== "string" || !h.includes(",")) return "";
  const [daysStr, secondsStr] = h.split(",");
  const days = parseInt(daysStr, 10);
  const seconds = parseFloat(secondsStr);
  if (!Number.isFinite(days) || !Number.isFinite(seconds)) return "";
  // IRIS $HOROLOG epoch: day 0 = 1840-12-31; day 1 = 1841-01-01
  const epoch = Date.UTC(1840, 11, 31);
  const ms = epoch + (days * 86400 + seconds) * 1000;
  return new Date(ms).toISOString();
}
```

Round-trip verify one known value against IRIS `$ZDATETIME` output during unit tests. Handle malformed/empty inputs gracefully (return `""`, never throw).

**Why:** Epic 11 Bug #14 (commit `938c5b2`): `iris_analytics_cubes` returned `lastBuildTime: "67360,85964.1540167"` — raw horolog. Fix: added `horologToIso` helper, preserved raw in `lastBuildTimeRaw`. Cross-verified `67360,85964.1540167` → `2025-06-04T23:52:44.154Z` against IRIS `$ZDATETIME` output `2025-06-04 23:52:44.154`.

---

## 12. Spec-first vs all REST application listing

**Context:** A TypeScript tool that lists REST applications in an IRIS namespace.

**Rule:** The InterSystems Mgmnt API endpoint `/api/mgmnt/v2/{namespace}/` wraps `%REST.API.GetAllRESTApps`, which filters to **spec-first** REST applications only — those generated from an OpenAPI/Swagger spec (have both `<appname>.spec` and `<appname>.disp` classes). Hand-written `%CSP.REST` dispatch classes (like `ExecuteMCPv2.REST.Dispatch`) are excluded by design of the InterSystems API.

Any tool advertising "list REST applications" MUST offer both modes:

- `scope: "spec-first"` (default) — preserves existing Mgmnt API behavior for clients that want the swagger-registered subset.
- `scope: "all"` — includes hand-written `%CSP.REST` subclasses. Implementation: call the ExecuteMCPv2 webapp listing endpoint (`/api/executemcp/v2/security/webapp`), filter for entries with non-empty `dispatchClass`, normalize to the same response shape as the Mgmnt API output (`{name, dispatchClass, namespace, swaggerSpec: null}` for hand-written).

Tool description must state which mode is default and what each includes, so AI clients can pick correctly without reading the source.

**Why:** Epic 11 Bug #13 (commit `938c5b2`): `iris_rest_manage action:"list"` in HSCUSTOM omitted `/api/executemcp/v2` (registered with `dispatchClass: "ExecuteMCPv2.REST.Dispatch"` — our own REST service). Root cause at [`irislib/%SYS/%REST.API.cls`](../../irislib/%SYS/%REST.API.cls): `FilterApplication` explicitly skips any dispatch whose name doesn't end in `.disp` AND requires an accompanying `.spec` class. Path A fix (no bootstrap bump) reused the existing webapp endpoint.

---

## 13. IRIS locale vs NLS message tables

**Context:** Any code that interprets error-text prefixes or non-English strings from IRIS.

**Rule:** IRIS has two independently configurable NLS surfaces:

- **Instance locale** — `%SYS.NLS.Locale` / `^%SYS("LOCALE","CURRENT")`. Controls default character encoding, date/time formats, sort collations. Default on modern installs is `enuw` (English-Windows).
- **Message translation tables** — loaded from `msg_<locale>.dat` files, control which language error strings are rendered in. Can be loaded independently of the instance locale.

The Arabic `خطأ` prefix on IRIS error text does NOT mean the instance locale is Arabic — it means the Arabic message table is loaded. On this project's test instance, locale is `enuw` but error messages render with `خطأ` because multiple message tables are loaded and Arabic is being selected.

**Rule implications:**
- Don't infer instance locale from error text prefixes.
- Error-prefix strippers (see Rule #8) must handle BOTH English `ERROR #N:` and locale variants like `خطأ #N:`.
- `iris_config_manage get locale` returns the active **instance locale** (`%SYS.NLS.Locale.%New().Name`), not the message-table language.

**Why:** Epic 11 Bug #15 and Epic 11 retrospective observations (commit `524d170`): story specs repeatedly predicted Arabic locale based on `خطأ` prefix; actual locale is `enuw`. Dev correctly separated the two concerns when implementing the fix.

---

## 14. Prefer live IRIS probe over web research for IRIS-specific APIs

**Context:** Implementing a handler that needs to call an uncommon IRIS system class method, and the exact API is uncertain.

**Rule:** When Perplexity MCP / web search returns irrelevant or outdated results for IRIS-specific API questions, pivot to live IRIS exploration:

1. `iris_doc_list` with a class-prefix filter (e.g., `SYS.Stats%`, `%SYS.NLS%`) to enumerate candidate classes.
2. `iris_doc_get` on the specific class file to read the source (or consult `irislib/` / `irissys/` local exports).
3. Prototype the call via a temporary `ExecuteMCPv2.Temp.*` probe class, compile, invoke via `iris_execute_classmethod`, inspect the result.
4. Clean up the probe class before commit.

This is almost always faster than iterating on search queries when the API is IRIS-idiosyncratic. Supplements the [`research-first.md`](./research-first.md) Perplexity-first guidance — use Perplexity for concepts and best practices, use live probe for exact IRIS API shapes.

**Why:** Epic 11 Stories 11.2 and 11.3: Perplexity returned unrelated results twice (`%All` permission semantics, system-wide counter API). Dev pivoted to live IRIS probe both times and found the correct API (`Security.Roles.Get` + short-circuit, `SYS.Stats.Global.Sample`) in under five tool calls.

---

---

## 15. Don't wrap method calls in `$Get()`

**Context:** Reading a field from a `%DynamicObject` (or any object returned from a method call) in ObjectScript.

**Rule:** Never pass a method-call expression to `$Get()`. `$Get(expr, default)` expects `expr` to be a simple variable reference (local, global, or multi-dimensional array node). When `expr` is a method call like `tBody.%Get("timeout")`, the parser collapses `tBody` to the variable-name position and tries multi-dim access on the receiver. For `%DynamicObject` instances this raises `<INVALID CLASS>Class '%Library.DynamicObject' does not support MultiDimensional operations`. For plain locals it can produce subtle wrong-value bugs.

Use one of these corrected patterns instead:

```objectscript
; Preferred (explicit presence check):
Set tTimeout = 120
If tBody.%IsDefined("timeout") Set tTimeout = +tBody.%Get("timeout")

; Simpler (coercion-friendly — %Get returns "" for missing keys; +"" = 0):
Set tTimeout = +tBody.%Get("timeout")
If tTimeout = 0 Set tTimeout = 120
```

**Why:** Epic 12 Story 12.2 / BUG-3 (commit `9ed3023`): `iris_production_control` failed with `<INVALID CLASS>` on every one of its five actions (`start`, `stop`, `restart`, `update`, `recover`) because `Interop.cls:145,147` wrapped `tBody.%Get(…)` calls in `$Get(…, default)`. Two-line fix unblocked all five actions. A prophylactic audit across the full `src/ExecuteMCPv2/` tree confirmed only these two lines had the anti-pattern — easy to miss in review without a rule.

**How to apply:**
- During code review: grep for `\$Get\([a-zA-Z_]+\.%Get\(` or `\$Get\([a-zA-Z_]+\.[A-Z]` — any hit is suspect.
- During dev: use `%IsDefined` + `%Get` + default literal pattern for `%DynamicObject` field reads. Never reach for `$Get()` with a method call inside it.

---

## 16. Verify story-spec "X exists" claims via live probe before trusting

**Context:** A story spec says an IRIS class method (or property, or behavior) exists and instructs the dev not to touch it, OR claims a specific API shape that guides the implementation.

**Rule:** Before trusting a story-spec claim about IRIS API shape ("method X exists, don't touch it", "property Y is available", "method Z takes these parameters"), verify empirically via live probe — read the actual class source in `irislib/` / `irissys/`, or call the method/property from a disposable `ExecuteMCPv2.Temp.*` probe class. Specs can be wrong about IRIS API shape because the author may have read outdated docs, extrapolated from partial evidence, or relied on superficially-similar IRIS class patterns. If the spec's claim is empirically wrong, widen the story scope to fix the underlying method AND flag the spec error in dev notes so the retrospective can learn from it.

**Why:** Epic 12 had this pattern twice:
- **Story 12.3** (commit `13f45d5`): spec said "`Ens.Config.Production.Delete(tName)` exists and should continue to work — don't touch the delete branch". Dev discovered mid-implementation that `Delete()` does NOT exist on `Ens.Config.Production`. Had to widen scope to fix the delete branch (use `%Dictionary.ClassDefinition.%DeleteId()` and let `Ens.Projection.Production.RemoveProjection()` handle cleanup) in addition to the originally-scoped create fix.
- **Story 12.6** (commit `a373316`): spec proposed three actions (`clear` / `clearAll` / `acknowledge`), with implementation note "consider scope-down to just `acknowledge` (which is additive/safe)". Pre-dev research against `irislib/%SYSTEM/Monitor.cls` + `%Monitor/Manager.cls` revealed that `acknowledge` is NOT a safe native-IRIS operation — system Monitor alerts have no native acknowledgement API. Scope was correctly narrowed to a single `reset` action mapped to `$SYSTEM.Monitor.Clear()`. If the research had happened pre-spec instead of pre-dev, the spec would've been right from the start.

**How to apply:**
- During story creation: when writing a spec that references a specific IRIS class method by name, open the class in `irislib/` / `irissys/` and verify the method exists with the claimed signature. Especially important for methods named `Create()`, `Delete()`, `Get()`, `Modify()` — these are idiomatic method names that *sometimes* exist on IRIS classes but often don't.
- During dev: when a spec says "don't touch X", verify X works before trusting the claim. If X fails with `<METHOD DOES NOT EXIST>` or similar, the spec is wrong — widen scope to fix it AND record the discovery for the retro.
- During retro: when scope-widening happened due to a wrong spec, ensure the retro triage surfaces it as a process signal (not a dev complaint).

---

## 17. `iris_doc_load` requires a glob-prefixed path

**Context:** Deploying an ObjectScript `.cls` file to IRIS via the `iris_doc_load` MCP tool.

**Rule:** Always pass a glob-prefixed path to `iris_doc_load`, even when deploying a single file. Use the form `c:/path/to/src/**/FileName.cls` or at minimum `c:/path/to/src/**/*.cls`. Do NOT pass a bare file path like `c:/path/to/src/ExecuteMCPv2/REST/Security.cls` — the tool's path-to-classname mapping uses the directory prefix BEFORE the first glob metacharacter as the base, so a bare path collapses the class name to the file stem only (`Security.cls` → class `User.Security`, not `ExecuteMCPv2.REST.Security`).

Correct examples:
```
# Single file:
iris_doc_load path="c:/git/iris-execute-mcp-v2/src/**/Security.cls" compile=true namespace=HSCUSTOM

# All ObjectScript in a tree:
iris_doc_load path="c:/git/iris-execute-mcp-v2/src/ExecuteMCPv2/**/*.cls" compile=true namespace=HSCUSTOM

# WRONG — produces wrong class name:
iris_doc_load path="c:/git/iris-execute-mcp-v2/src/ExecuteMCPv2/REST/Security.cls"
```

**Why:** Epic 12 Story 12.1 (commit `cc810a0`): lead's first post-CR redeploy hit `Class 'User.Security' does not exist` because the bare path was mapped to the file stem. The same pattern was re-learned in Stories 12.2, 12.3, and 12.4 before being codified. Three-time lesson = rule.

**How to apply:**
- Deploy scripts, CI pipelines, dev instructions: all use the glob-prefixed form.
- If writing a new story's dev notes, include the exact command template per the examples above.

---

## 18. Auto-generated files are output-only

**Context:** Any file produced by a script (e.g., `pnpm run gen:bootstrap` produces `packages/shared/src/bootstrap-classes.ts`).

**Rule:** Never hand-edit auto-generated files. If a fix is needed in content that ends up in a generated file, edit the SOURCE that the generator reads (the ObjectScript `.cls`, the Zod schema, whatever), then re-run the generator to regenerate the output. Manual edits to generated files do not survive the next regeneration.

This applies to:
- `packages/shared/src/bootstrap-classes.ts` — produced by `scripts/gen-bootstrap.mjs` from `src/ExecuteMCPv2/**/*.cls`.
- Any future `*.generated.ts`, `*.d.ts` from codegen tools, `openapi.json` from spec-gen, etc.

The generator script should ideally include a header comment like `// DO NOT EDIT — auto-generated by <script>. Regenerate via: <command>.` If a generated file doesn't have such a header, add one when touching it.

**Why:** Epic 12 Story 12.6 code review (commit `a373316`): CR auto-fixed a MEDIUM finding (ISO 8601 T-separator in `Monitor.cls:AlertsManage`) correctly in the `.cls` source file, then ALSO manually applied the fix to the embedded copy in `bootstrap-classes.ts`. The manual edit produced a bootstrap hash (`f77518a0e09d`) that didn't survive the next `pnpm run gen:bootstrap` run, which produced a *third* hash (`974bbeab53a1`) because the regenerator re-read `Monitor.cls` from disk and encoded the actually-current content. Lead had to update CHANGELOG + story references to the real hash. Minor — caught within one regenerate cycle — but if a future CR edits a generated file AND the regenerate step is skipped, the generated file silently drifts from its source.

**How to apply:**
- Code review: if a finding needs a fix in generated content, edit the source and regenerate. Never edit the generated file directly.
- `.gitignore` vs checked-in generated files: some projects check in generated files for bootstrap / package-manager reasons (as with `bootstrap-classes.ts`). Checked-in ≠ editable. The header comment is the signal.
- If a regenerate step is needed as part of the fix, record it in the CR's file list for the lead to run.

---

## Rules captured: 18
## Epics contributing: 12 (retros 2026-04-21, 2026-04-22)

**Audit note (2026-04-21):** Rule #14 ("Password redaction — gate on length") was initially codified during Epic 11 retro, then removed during the retro's self-audit. The retro's own Murat-triage had flagged Bug #8 as narrow ("not a general pattern — fix is in code, no rule needed"), but it was codified anyway. Removal enforces Rule #1's "narrow one-off fixes do NOT become rules" principle. The fix remains in the code and the retro bug log.

**Audit note (2026-04-22):** Epic 12 retro triaged 6 rule candidates; 4 passed the general-pattern-shape bar (Rules #15, #16, #17, #18) and 2 were skipped:
- "Property-name vs property-type distinction" (BUG-1 `ChangePassword` boolean vs `Password` setter) — narrow one-property pair; Rule #2 ("read IRIS class source") already covers prevention.
- "One consolidated bootstrap bump per epic" — process-shape, better tracked in epic-cycle-log conventions than as a rule.

These decisions enforce Rule #1's general-pattern-shape requirement.
