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

## 19. Additive-epic back-compat gate AC with a mechanical proof

**Context:** Any strictly-additive feature epic — a new capability gated behind opt-in config where the "off" state MUST equal today's behavior (the back-compat promise is a release gate).

**Rule:** Require EACH story to carry a back-compat gate AC backed by a **mechanical proof**, not a prose claim. Mechanical = an assertion/test that fails if behavior drifts: an unchanged-output equality (`toEqual` the pre-feature output), an all-enabled/all-unchanged sweep under empty config, a "no extra side-effect" spy assertion, or a byte-for-byte source-unchanged check. The "off" path must be provably identical to pre-feature behavior.

**Why:** Epic 14 (commits `213756b`–`f201a88`): the foundation contract was "no `IRIS_PROFILES` + no `IRIS_GOVERNANCE` = byte-for-byte today's." Every story proved it mechanically rather than asserting it — `loadConfig` left byte-for-byte unchanged (14.1), the generated 141-key baseline all-enabled under empty `IRIS_GOVERNANCE` (14.3), the enforcement gate a pure pass-through under empty config (14.4), the added `server` field / `resources` capability provably additive (14.2/14.5). No back-compat regression shipped across 6 stories that all modified the central dispatch path of all 5 servers.

**How to apply:**
- Story creation: if the epic is additive, add a back-compat AC naming the exact "off" condition AND the proof mechanism (which assertion fails if it regresses).
- Code review: treat a prose-only back-compat claim with no failing-if-drift assertion as a finding (HIGH for a release-gated promise).

---

## 20. Generated baseline for provable back-compat over existing capability

**Context:** A feature that could silently disable, hide, or alter an EXISTING capability — governance/policy gates, feature flags over current behavior, deprecation, permission tightening.

**Rule:** Encode the "existing set" in a **generated, output-only** artifact (mirror `gen-bootstrap.mjs`: enumerate from source, deterministic sorted output, content hash, DO-NOT-EDIT header per Rule #18) and assert the new behavior preserves ALL of it. Derive "is this new?" from **baseline membership**, never a hand-maintained `isNew`/allowlist flag that drifts. A test must prove every baseline entry retains its pre-feature behavior under the feature's default/empty config.

**Why:** Epic 14 Story 14.3 (commit `4b506ff`, arch decision D3): `scripts/gen-governance-baseline.mjs` enumerated every existing tool/action into `governance-baseline.ts` (141 keys); the default seed grandfathers exactly the baseline, and a test asserts all 141 resolve enabled under empty `IRIS_GOVERNANCE`. "No pre-existing action disabled by default" became mechanically verifiable instead of maintainable-by-hand. Generalizes Rule #18 (generated files output-only) to the back-compat-proof use case; pairs with Rule #19 (this IS the mechanical proof for a capability gate).

**How to apply:**
- When adding a gate/flag over existing behavior, build the generator + checked-in baseline + the all-preserved test BEFORE wiring enforcement.
- Run the generator wherever `gen:bootstrap` drift is checked; the baseline is output-only (never hand-edit — Rule #18).

---

## 21. Named capstone = epic-done gate, in the default suite, review-verified genuine

**Context:** A foundation / cross-cutting epic with a risk that no single per-story unit test covers end-to-end — isolation across components, uniform behavior across servers, an invariant that only emerges when multiple pieces combine.

**Rule:** Designate ONE capstone integration test as the explicit "epic done" gate, name it in the epic's ACs, require it to run in the **DEFAULT** test suite (NOT an excluded `*.integration.test.ts` / tagged-out suffix), and have code review verify it is **genuine** (exercises the real surfaces and would actually fail if the property broke) rather than illusory (asserting on mocks that can't violate the property, or testing one component twice).

**Why:** Epic 14 Story 14.5 (commit `0ed5264`, AC 14.5.6): the cross-server capstone (D1 per-profile session isolation + D5 uniform enforcement across two servers) was the explicit Epic-14-done gate. The dev named it `governance-cross-server.test.ts` — NOT `.integration.test.ts` — precisely because the vitest config excludes that suffix from the default run; otherwise the gate would silently never run. Code review scrutinized it hardest, confirmed it genuinely drives real per-instance cookie jars + the shared gate, and caught a Node-18 `getSetCookie` mock bug that would have made the D1 isolation assertions flake/falsely pass on the supported Node floor.

**How to apply:**
- Epic planning: identify the cross-cutting risk; assign a capstone AC to the last implementation story; flag it as the de-risking priority (land the unit-level version early — see the Epic 14 "prove isolation first" note).
- Review of that story: verify the capstone is in the default run and would fail if the property regressed; a capstone that can't fail is a HIGH finding.

---

## 22. Lead per-story smoke against the BUILT artifact, in a real process

**Context:** The lead's per-story smoke gate for a shared-framework / library / TypeScript-build story (no obvious UI/CLI/service to drive manually).

**Rule:** Smoke the **built output** (`dist/`) in a fresh real Node process — NOT the source via the vitest runner — exercising the new public surface as a real consumer would (`import` from `dist/index.js` or the dist module; for connection/resource/enforcement paths, touch live IRIS where cheap and read-only). This catches export-wiring, ESM-resolution, capability-advertisement, and real-runtime issues that mocked-fetch unit tests structurally cannot. Rebuild first so `dist` reflects the latest code-review fixes; remove the disposable smoke script before staging.

**Why:** Epic 14 (Stories 14.1–14.6): each lead smoke ran the built `@iris-mcp/shared` standalone — back-compat + session isolation (14.1); the central `server`-param injection + two live-IRIS authenticated calls through profile-selected clients (14.2); generator determinism + the 141-key all-enabled proof (14.3); the real `handleToolCall` gate denying a governed action against live IRIS (14.4); the real MCP SDK resource handlers returning the per-profile policy over live IRIS (14.5); copy-paste-parsing the doc JSON-in-env examples (14.6). These confirmed the wired-up system end-to-end exactly where the (correct) unit tests used mocked fetch. *Note:* `process.exit` with open keepalive sockets emits a benign Windows libuv `UV_HANDLE_CLOSING` assertion AFTER the pass line — a teardown artifact, not a defect.

**How to apply:**
- For a shared/library story, write a disposable smoke that imports the built dist and asserts the user-observable outcome in a real process; `pnpm --filter <pkg> build` first; `rm` the script before `git add`.
- Match the smoke method to the deliverable: pure module → import+assert; connection/resource/enforcement → drive the real surface against live IRIS read-only.

---

## 23. Frozen-foundation baseline when a gate sits over an EVOLVING surface

**Context:** A governance/policy/feature gate whose back-compat proof is a generated baseline, applied to a capability surface that will KEEP GROWING (new tools/actions/flags added in later epics) — not a one-time foundation epic.

**Rule:** The back-compat baseline must be a **FROZEN foundation snapshot** (the surface as of the gate's introduction), and the drift test must be **one-directional**: every committed (foundation) key MUST still exist in the live surface (catches a removed/renamed pre-existing capability — a real regression), but NEW live keys outside the foundation are EXPECTED and allowed. New capability is governed by its **classification** (`mutates`/seed), NOT by baseline membership. Do NOT regenerate the baseline to absorb new keys — that would grandfather a new default-disabled write as enabled (defeating the gate). A bidirectional `committed == live` drift test is correct ONLY for a closed/frozen surface, never for one a future epic extends.

**Why:** Epic 15 Story 15.1 (commit `5d59d83`). Epic 14's D3 baseline + bidirectional drift test was authored for the foundation epic; Epic 14 retro AI#4 ("regenerate `governance-baseline.ts` whenever a tool is added; drift test enforces") assumed the baseline grows. The FIRST real governed write tool exposed the contradiction: `defaultSeed` returns enabled for any baseline member, so a new `iris_service_manage:enable` key that is IN the baseline ships enabled — defeating default-disable; but excluding it fails the bidirectional `missing`-keys assertion. Resolution: freeze `GOVERNANCE_BASELINE` at the Epic-14 141-key snapshot (hash `1e62c5ad5bf7`), relax the drift test to one-directional, govern new keys via `mutates`+`defaultSeed`. Held across all of Epic 15 (89→93 tools) with the foundation hash unchanged.

**How to apply:**
- When introducing a gate over a growing surface, design the drift test one-directional from the start (assert foundation persists; allow new keys). Reframe any "regenerate the baseline on every change" guidance as "freeze the foundation; classify new entries."
- Generalizes Rule #20 (generated baseline for back-compat) to the multi-epic / growing-surface case; pairs with Rule #25 (the generator must not silently regrow the frozen file).

---

## 24. Bootstrap/embedded-artifact regen is per-change, not deferrable to a closing story

**Context:** An epic that edits a class/file whose content is embedded in a generated artifact guarded by a **content-hash drift test** (e.g. `bootstrap-classes.ts` + `BOOTSTRAP_VERSION` = SHA-256 of the on-disk classes; `bootstrap.test.ts` asserts on-disk == embedded == version), where the plan says "one consolidated bump at the closing story."

**Rule:** Editing a hash-bootstrapped class REQUIRES regenerating the embedded copy (`gen:bootstrap`, Rule #18 — never hand-edit) and moving the version **in the SAME story**. "Defer the bump to a closing story" is **incompatible** with the drift test — the moment a bootstrapped class changes, on-disk ≠ embedded and version ≠ hash, so the suite goes red and stays red until regen. The version moving each ObjectScript-touching story is correct (it IS a content hash). Reinterpret any "single bump at story N" plan as: the version moves incrementally per change; the CLOSING story VERIFIES idempotence (`gen:bootstrap` produces no diff) and finalizes docs — it does not introduce a deferred bump.

**Why:** Epic 15 Story 15.1 (commit `5d59d83`). The epic plan (and Epics 16/17) said "one `BOOTSTRAP_VERSION` bump at the closing story." Story 15.1's dev correctly halted (Rule 5) — editing `Security.cls` made `bootstrap.test.ts` fail and no amount of deferral kept the suite green. Lead resolved "Option A": regen per ObjectScript story (`8f0cf75be984`→`fae7cadc22fb`→…→`e5f4f6d88c56`); Story 15.6 confirmed `gen:bootstrap` idempotent (no fresh bump). Same reinterpretation applies to any epic whose closing story claims a single deferred bump.

**How to apply:**
- Story-spec a bootstrapped-ObjectScript story with an explicit "regenerate `bootstrap-classes.ts` + record `BOOTSTRAP_VERSION` from→to" AC; make the closing/docs story an idempotence VERIFY, not the sole bump.
- If a plan inherits "one bump at the closing story" language, flag it at story creation and reinterpret rather than discovering it mid-dev.

---

## 25. A generator that emits a frozen/committed artifact needs a no-write `--check` mode

**Context:** Any `scripts/gen-*.mjs` (or equivalent) that `writeFileSync`s a committed artifact which has become FROZEN under a frozen-foundation policy (Rule #23) — i.e. the generator's natural output (the full live surface) now DIFFERS from the intentionally-frozen committed file.

**Rule:** Such a generator is a **footgun**: running it for ANY reason (even "just to check counts") silently overwrites the frozen file with a regrown surface, un-freezing it. It MUST gain a `--check`/no-write mode that re-derives and diffs WITHOUT writing (exit non-zero on drift, for CI), and ideally REFUSE to overwrite a file marked frozen (or require an explicit `--force`). Until then, treat invoking it as dangerous: never run it to fetch counts (read the test assertions / count the source arrays instead); if it IS run, immediately `git checkout -- <frozen-file>` to restore. Document the hazard prominently in the generator header and in any story that touches the area.

**Why:** Epic 15 Story 15.6 (retro 2026-06-16). Under the Story 15.1 frozen-foundation model, `gen-governance-baseline.mjs` still enumerates ALL live tools and writes the full set — so running it regrows the frozen 141-key baseline (93 tools → 66 admin keys) and breaks `1e62c5ad5bf7`. The lead tripped this exact footgun fetching tool counts during Story 15.6 prep and had to `git checkout -- governance-baseline.ts`. Story 15.1's AC 15.1.7 added only a prose "do not re-run" note — insufficient, because "re-run to re-verify" still overwrites. The deferred `--check` item (routed from Story 15.0) is the real fix.

**How to apply:**
- Pair every frozen-foundation artifact (Rule #23) with a `--check` generator mode before the freeze ships; add a DO-NOT-RUN-TO-REGROW banner to the generator.
- In stories near a frozen artifact, instruct devs to derive facts (counts, membership) from tests/source, never by invoking the generator.

---

## 26. Live-endpoint smoke for stories backed by a deployed REST/ObjectScript surface

**Context:** The lead's per-story smoke for a story whose user-observable deliverable is served by a DEPLOYED endpoint (a `%CSP.REST`/Atelier route, an ObjectScript handler on a live IRIS instance) — as opposed to a pure TS library.

**Rule:** Extend Rule #22: for an endpoint-backed story, drive the **LIVE deployed endpoint over real HTTP** (e.g. `curl` the `%SYS`-namespace REST route against the running instance), not just `import` the built lib. Exercise the read paths (`list`/`get`/`status`) AND a **safe rejection of the destructive path** (send the dangerous request and assert it is REFUSED, changing nothing) — this confirms a security guard is effective on the actual running server, which mocked-fetch unit tests structurally cannot. Use clearly-disposable targets for any state-changing verification and clean up; never run a real destructive op against live data.

**Why:** Epic 15 (Stories 15.1–15.5). Live-HTTP lead smokes confirmed three security fixes end-to-end that unit tests could not: the `iris_service_manage` error envelope + boolean coercion (15.1), and crucially the **rejections** — `iris_audit_manage` wildcard-only purge refused with "Purge requires a bounded scope" on the live server (15.4, the HIGH full-wipe fix), and `iris_resource_manage` `grant SELECT,BOGUS` refused before `SaveObjPriv` (15.5, the HIGH partial-grant fix). Each rejection proved the guard live while changing nothing.

**How to apply:**
- Endpoint-backed story → smoke method = live HTTP against the deployed route; include at least one "destructive request is rejected" assertion when the tool has a write/destructive action.
- Governance is enforced at the MCP/tool layer, not the REST route — so a direct REST smoke bypasses governance and tests the ObjectScript handler's OWN guards (bounds, confirmation, validation); that is exactly what you want to verify for the handler.

---

## 27. `Ens.Config` config objects: class-XData is source of truth, the SQL extent is a synced cache

**Context:** Any handler that adds/removes/edits Interoperability config items via `Ens.Config.Production` / `Ens.Config.Item` (e.g. `iris_production_item` add/remove), and a LATER action in the same flow (or a follow-up call) reads the item back via the SQL extent (`Ens_Config.Item` SELECT, `Ens.Config.Item.NameExists`, `%OpenId` on the item id).

**Rule:** `Ens.Config.Production.SaveToClass()` and `RemoveItem()` write the **production class definition (XData `ProductionDefinition`)** — NOT the `Ens.Config.Item` SQL extent. The extent is a synced cache populated from the XData by `Ens.Config.Production.LoadFromClass(pClassName)` (single arg; it deletes + re-saves the extent from the class). Consequences a handler MUST account for:
- After a fresh `%OpenId(prod)`, `tProd.Items` reflects the **stale extent**, not the XData. Call `##class(Ens.Config.Production).LoadFromClass(prod)` BEFORE `%OpenId` in add/remove so you operate on current items (the add→remove round-trip otherwise can't see a just-added item).
- A just-`add`-ed item is in the XData but NOT yet in the extent, so an immediate `get`/`set` (which use `NameExists`/raw `Ens_Config.Item` SQL) returns "not found" until a `LoadFromClass`/compile syncs the extent. This is expected, not a bug — but document it, and consider a post-add `LoadFromClass` if immediate get/set visibility is desired.
- `Ens.Config.Item` has a COMPOSITE `Index Name On (Production, Name)`, so `NameExists(name)` (one-arg) does not uniquely resolve an item in an arbitrary/non-active production.

**Why:** Epic 17 Story 17.2 (commit `a4100a0`): the Story 17.0 probe recipe (Area 2a) read items via a bare `%OpenId(prod)` and the add→remove round-trip failed because the extent was stale; dev added the `LoadFromClass` sync (DISCREPANCY #1b, Rule #5 probe-doc amendment). The 17.2 lead smoke then observed `get`-after-`add` returning "not found" while `remove` (which uses `LoadFromClass`+`FindItemByConfigName` on the XData) succeeded — confirming the extent/XData split live. Pairs with Rule #2 (read IRIS source) and Rule #16 (live probe).

---

## 28. New governance keys need a `mutates` class even when they're reads

**Context:** Adding ANY new tool (or new `action` to an existing tool) on a governance-wired server (all 5 suite servers since Epic 14), where the new tool/action is a READ.

**Rule:** Every NEW (post-foundation, absent-from-frozen-baseline) governance key MUST carry a `mutates` classification — `read` OR `write` — or `assertGovernanceClassification` THROWS at server registration. A read is NOT exempt: declare `mutates: "read"` (or per-action `{action: "read", …}`). A read resolves to default-ENABLED via `defaultSeed` (only `write` → default-disabled), but the classification is still mandatory; omitting it is a registration-time crash, not a silent enable. Do NOT conclude "reads need no `mutates`" — they need `mutates: "read"`.

**Why:** Epic 17 Story 17.3 (commit `56cde54`): `iris_sql_analyze`'s four actions (`explain`/`stats`/`indexUsage`/`running`) are all reads; the Story 17.0 probe doc wrote "READ-ONLY → reads → default-enabled (no mutates)", which would have thrown at registration (`server-base.ts rebuildGovernedKeys` derives a `tool:action` key per enum value; none are in the frozen baseline `1e62c5ad5bf7`; `assertGovernanceClassification` rejects any unclassified non-baseline key). Spec corrected to `mutates: {explain:"read", stats:"read", indexUsage:"read", running:"read"}`. Generalizes the Story 15.0 strict-classification contract to the reads case; pairs with Rule #23 (frozen-foundation baseline).

---

## 29. Reject the delimiter in user-supplied slots of a composite IdKey

**Context:** Any handler that assembles a multi-part IRIS IdKey from caller-supplied values to feed `%OpenId`/`%ExistsId`/`%DeleteId` — e.g. `prod_"||"_item_"||"_hostClass_"||"_setting` for `Ens.Config.DefaultSettings`, or any `$ListBuild`/concatenation-delimited compound id.

**Rule:** Before assembling the id, REJECT any slot value that itself contains the delimiter (`||` for `Ens.Config.DefaultSettings`; the relevant separator for other compound keys). A slot carrying the delimiter splits into the wrong subscripts and silently targets a DIFFERENT row — a get/set/delete against an unintended key (a quiet correctness + integrity hole, injection-flavored). Reject with a clear error (`"Key slot values may not contain the '||' delimiter"`) before any `%OpenId`/`%Save`/`%DeleteId`.

**Why:** Epic 17 Story 17.1 (commit `d36e085`, CR 17.1 patch): `iris_default_settings_manage` built its IdKey from four caller slots joined by `||`; without a guard, `production:"X||evil"` would mis-target. The reviewer added a reject-before-assemble guard; the lead smoke proved it live — `production:"ZZZSmoke171||evil"` returned `ERROR #5001: Key slot values may not contain the '||' delimiter` with `result:{}` (no write). Pairs with Rule #26 (live destructive/guarded-path rejection in the smoke).

---

## 30. Per-epic docs rollup must flag governance default-disabled state

**Context:** A per-epic documentation rollup (the closing "docs rollup" story, or any doc pass) that adds a NEW governed tool or action to the user-facing docs (README, per-server READMEs, `tool_support.md`, catalogs) on a governance-wired server.

**Rule:** Updating the docs for a new governed tool/action is NOT complete when the catalog row + tool count are added. The rollup MUST ALSO state **which new actions are default-disabled** under `IRIS_GOVERNANCE` (the `write`-classified actions) vs **enabled by default** (reads + pre-governance baseline). Put the callout where a reader of that tool will see it — the per-server README's tool section AND the authoritative catalog (`tool_support.md`) — mirroring the established Epic-15 note style. A user deciding whether to enable a tool needs the default-state at the point of documentation, not only the abstract default-seed rule buried in the governance section.

**Why:** Epic 18 Story 18.0 close-out (commits `b7e7da0`, `e4bcad8`): the per-epic rollups for Epics 16 (16.4) and 17 (17.4) added catalog rows + refreshed counts but omitted the governance default-disabled callout that Epic 15's rollup (15.6) had included. So `iris_process_manage`/`iris_database_action`/`iris_backup_manage` (Epic 16) and `iris_default_settings_manage`/`iris_production_item` add-remove/`iris_sql_analyze` (Epic 17) were documented without indicating which actions ship default-disabled. The Project Lead caught it at Epic 18 close and required a doc pass across README + `tool_support.md` + every per-server README. The gap is recurring-shape — it would silently recur on every future governed-tool epic — so it is a rule, not a one-off.

**How to apply:**
- Closing-story docs-rollup AC: add an explicit "state default-disabled vs default-enabled for each new tool/action" requirement, not just "add catalog row + bump counts."
- Code review of a docs-rollup story: a new governed tool documented WITHOUT its default-state callout is a finding.
- The default-state derives mechanically from `mutates` (writes → default-disabled, reads → enabled) per Rule #23/#28 — so the callout is a copy of the classification the tool already carries, never a fresh judgment.

---

## 31. Framework-provided tool — docs/counting shape (not in any package tool array)

**Context:** Adding a **framework-provided** tool/capability — one registered centrally in `@iris-mcp/shared` `server-base.ts` so it appears on all five servers, NOT in any package's `tools/index.ts` (the pattern of the D2 `server` param, the D6 governance resource, and the E1 `iris_server_profiles` discovery tool).

**Rule:** A framework tool is **not a member of any package's tool array**, so the package `index.test.ts` `toHaveLength(...)` / `getToolNames()` assertions (which count that array) do NOT change when it is added — and must NOT be inflated to "account for" it. But the tool IS advertised on every server (`tools/list`) and IS a live governance key on every server. Handle the two count surfaces distinctly:
- **Package-array counts** (the per-package `tools/index.ts` length + its `index.test.ts`): unchanged. Leave them.
- **Advertised / suite counts** (README prose, `tool_support.md` rollups, per-server "N tools" figures): bump by **+1 per server** (and the suite total by +1×servers), and document the framework tool **separately** from the per-package catalogs (it has no home package). Per Rule #30, still state its default-state (read → enabled by default; write → default-disabled).
- **Cross-server test expectations** that assert advertised `toolCount` / policy-map size / `getToolNames()` on a *constructed server* DO move (+1 for the always-present framework key) — update those, and the governance key-universe (`governedKeys`) cross-checks.

**Why:** Epic 19 Story 19.0 (commit `1248d2f`): adding `iris_server_profiles` centrally broke 13 pre-existing count/shape assertions (advertised `toolCount`/`getToolNames` + policy-map-size cross-checks) while the package `tools/index.ts` length tests correctly stayed unchanged. The dev resolved it by updating only the advertised/cross-server expectations and documenting the tool as a framework surface (suite advertised 98→103 = +1×5 servers), leaving package-array lengths alone. This is recurring-shape — every future framework tool (a 4th, 5th… central capability) hits the same two-count split — so it is a rule, not a one-off. Generalizes the Rule #30 docs-rollup discipline to the framework-tool case (where "per-server count" ≠ "package array length").

**How to apply:**
- Story/docs-rollup AC for a framework tool: specify "bump advertised/suite counts +1/server; document the tool as a framework surface (no home package); leave package `index.test.ts` lengths unchanged."
- Code review: a framework tool that inflated a package-array length test, OR that bumped only package catalogs without the advertised/suite rollup, is a finding.

---

## 32. "Write, default-enabled" governance mechanism — orthogonal marker, never misclassify or mutate the frozen baseline

**Context:** A governance/policy gate that defaults a *class* of actions OFF (e.g. new `write` actions → default-disabled per Rule #28's seed), but a specific NEW action in that class must ship **enabled** by default (a recovery / safety tool that should be available out of the box), while the "existing set" is a **frozen baseline** you cannot add to (Rule #23/#25).

**Rule:** Do NOT achieve default-enable by (a) **misclassifying** the action (marking a genuine write as `read`), or (b) **adding the key to the frozen baseline**. Both corrupt an invariant: (a) lies in the `mutates` contract and the advertised policy; (b) un-freezes the foundation and would grandfather other writes. Instead add an **orthogonal opt-in marker** (`defaultEnabled`) that a tool declares for specific action values, collect it into a set, and thread that set as an **OPTIONAL, DEFAULT-EMPTY** parameter through the seed/cascade functions (`defaultSeed` → `effective` → `getEffectivePolicy`) so an empty set is **byte-for-byte** the prior behavior (every other write still default-disabled). The action keeps its **truthful** `mutates:"write"` (and `annotations.destructiveHint:true`); the marker only flips its default seed, not its classification. Guard the marker with a **registration-time cross-validation** (fail-fast if a `defaultEnabled` action is not a per-action `write` in `mutates`) so a typo cannot silently ship the write DISABLED. Operators can still override via explicit `IRIS_GOVERNANCE` (the cascade honors explicit `false`).

**Why:** Epic 20 Story 20.0 (commit `7aca352`, decision F2). `iris_production_control:clean` is a destructive write, but as a *recovery* tool it must be callable out of the box. The framework had only `read→enabled` / `write→disabled` + the frozen baseline (`1e62c5ad5bf7`), and the Project Lead explicitly rejected the misclassify-as-read shortcut. A `defaultEnabled` marker + default-empty `defaultEnabledWrites` threaded through `defaultSeed`/`effective`/`getEffectivePolicy` shipped `clean` enabled while keeping `mutates:"write"` honest and the baseline untouched; the empty set proved byte-for-byte back-compat for the other 4 servers (capstone test, Rule #21 shape). Code review added the fail-fast cross-validation after both the Blind and Edge hunters independently flagged that a mis-declared `defaultEnabled` action would otherwise silently ship DISABLED.

**How to apply:**
- When a new write must default-enabled, reach for an orthogonal marker + default-empty threaded param — never misclassification or baseline mutation.
- Pair it with a capstone test (in the DEFAULT suite) proving the marker flips ONLY the intended key and every other write stays default-disabled; mutation-test it (inject the marker on a sibling → assert red).
- Generalizes Rule #23 (frozen baseline) + Rule #28 (truthful `mutates`) to the default-enable exception; the truthful destructive signal stays in `annotations.destructiveHint`.

---

## 33. `SanitizeError` strips caret-globals — omit the caret when an error message names a global

**Context:** Any ObjectScript handler that builds a human-readable error string which is later passed through `##class(ExecuteMCPv2.Utils).SanitizeError` (i.e. essentially every `$$$ERROR`/`%Status` message a REST handler surfaces to the client) whose text needs to **name an IRIS global** (e.g. `^Ens.AppData`, `^SYS(...)`).

**Rule:** `SanitizeError` **strips caret-global references** from the message text — a `^Name` token is removed as part of sanitization — so a message written as `"... wipes ^Ens.AppData ..."` reaches the client with the global name **blanked**, silently losing the very detail the message exists to convey. When an error message must name a global, write it **without the leading caret** (`"Ens.AppData"`, not `"^Ens.AppData"`). Keep the caret form only on **non-sanitized** surfaces — TS tool descriptions, READMEs, doc comments — where the caret is informative and is NOT stripped.

**Why:** Epic 20 Story 20.0 (commit `7aca352`). The `clean` double-gate refusal first read `"killAppData wipes the persistent ^Ens.AppData business state ..."`; after `SanitizeError` the `^Ens.AppData` token was blanked, gutting the consequence the message was meant to convey. Reworded to `"... persistent Ens.AppData business state ..."` (no caret) — verified live over HTTP that the full message renders. The TS `killAppData` schema description retains `^Ens.AppData` (never sanitized there).

**How to apply:**
- In any handler error string destined for `SanitizeError`, drop the caret when naming a global; keep the descriptive caret form in TS descriptions/docs.
- Code review: a caret-global (`^Name`) inside a `$$$ERROR(...)`/`%Status` message that flows through `SanitizeError` is a finding — the token will be silently stripped, so the message must be reworded.
- Pairs with Rule #8 (SanitizeError prefix-stripping) and Rule #26 (verify the refusal message renders correctly on the LIVE endpoint).

---

## 34. Cross-namespace/environment live smoke for namespace-dependent tools

**Context:** A tool's output depends on IRIS state that varies by namespace or worker process — SQL schema/table presence, message-table/locale mappings, per-worker rendering variance — and the story's AC-mandated lead smoke (Rule #22/#26) only specifies "live against `<primary namespace>`."

**Rule:** For such tools, the lead smoke must exercise at least one additional namespace with meaningfully different characteristics (different message-table mappings, different schema population, different real sample data) — not just a second call against the same namespace. If no second namespace with real data exists at story-close time, record that as an explicit residual risk in the story's Dev Notes / `deferred-work.md`, not a silently-accepted gap.

**Why:** Epic 21 (commits `65e4e57`, `3469628`, retro 2026-07-03): AC 21.0.13/21.1.8 smoke only exercised HSCUSTOM. All three post-review defects found afterward were namespace/environment-shape bugs invisible to ~86 green ObjectScript tests + 0-HIGH code review + the HSCUSTOM-only smoke: (1) cross-session dedup never fired on real traces because anomaly-warning comments embed per-session message row-ids; (2) error summaries rendered raw kernel boilerplate on SADEMO, which lacks the Ens message-table mapping HSCUSTOM has; (3) the SAME session's rendering varied between REST worker processes because `GetErrorText`'s message-table language selection is per-process. All three surfaced only when the Project Lead walked every Ensemble-enabled namespace and diagrammed real data on each — zero were logic bugs; all three were test-shape blind spots.

**How to apply:** at story creation, when a story's AC specifies a live smoke and the tool's behavior is namespace/locale/environment-sensitive, name a second namespace in the smoke AC (or explicitly declare "no second real-data namespace available — flagged as residual risk"). Code review should treat a namespace-sensitive tool's smoke plan as incomplete if it names only one namespace.

## 35. `iris_execute_tests` early-partial-snapshot caveat

**Context:** Running `iris_execute_tests` at package or class level immediately after a fresh `iris_doc_load` + compile.

**Rule:** The tool can return an early partial result set (a subset of the expected tests, all reporting pass, 0 failures) instead of the full suite. Always compare the returned `total` against the expected test count before trusting a "0 failures" result; if short, rerun the same target (or verify each class individually) before treating the run as authoritative.

**Why:** Epic 21 (Stories 21.0 and 21.1, retro 2026-07-03): this exact caveat was independently rediscovered by the dev stage, the QA stage, and the code-review stage — in BOTH stories — each time losing a round-trip to "rerun and verify per-class" before trusting green. The tool never reported a failure; it silently returned fewer tests than existed, which reads identically to a genuine green run unless the count is checked.

**How to apply:** after any `iris_execute_tests` call whose `total` doesn't match the number of test methods expected (e.g. from the file just written), immediately rerun before reporting a stage as green. Prefer per-class `iris_execute_tests` calls when precision matters — the partial-snapshot behavior is most likely at the package level right after a compile.

---

## 36. Reference-parity ground-truth pinning — run the reference, don't reason about it

**Context:** Any story that ports / reimplements the classification, calculation, or parsing semantics of an **executable** reference (a stakeholder-owned script, an existing tool, a spec with a runnable oracle) and asserts "parity" as an acceptance criterion — e.g. porting an AWK/bash state machine into ObjectScript, reimplementing a formula, matching another tool's output format.

**Rule:** Pin every expected test value by **RUNNING the reference on the exact fixture** and capturing its actual output — never by reasoning about what the reference "should" produce. Reasoning about the reference's intent is precisely where a subtle port defect hides, because the port author's mental model of the reference is what's wrong. When a fixture is adversarial or boundary-shaped (the cases most likely to diverge), the reference's *observed* output is the oracle; a hand-predicted expected value that happens to match the port's (buggy) output silently certifies the bug. Where the reference is available, a parity test whose expected values were hand-derived rather than reference-captured is a weaker test — prefer capturing.

**Why:** Epic 22 Story 22.0 (commit `a1e4008`, CR 22.0-1 MED). The ObjectScript `MaskStrings` port diverged from the reference AWK's leftmost-**longest** regex backtracking on a doubled-quote-at-EOL literal (`Set x = "/*abc""`): the reference backtracks to the shorter close and masks `"/*abc"` (no `/*` survives → 3 code lines), while the port consumed the trailing `""` as an escape pair, ran off end-of-line, left the literal raw, and let the exposed `/*` poison the rest of the document as comments (1 code + 2 comment). The defect was caught **only** because the reviewer ran `cos_loc_counter.sh --csv` on the adversarial fixture and got `source_code_loc,3`, contradicting the port — then added that reference-captured value as the regression's expected. A hand-reasoned "this should be 3 code" would likely have been mis-reasoned the same way the port was. The broader AC 22.0.12 cross-verification (run the counter over the live package vs the reference over the same tree on disk) is the same discipline at aggregate scale — it landed all four code/comment buckets EXACT at 45 files, and every delta (the +45 trailing-empty artifact) was explained against the reference's actual output, not assumed.

**How to apply:**
- Story creation: when an AC says "parity with `<reference>`", require the fixture-level tests to record reference-captured expected values (note the exact reference invocation in the test or dev notes), and require an aggregate cross-verification AC (run both over the same corpus, explain every delta) when the reference can run over real data.
- Code review: a parity claim whose adversarial/boundary fixtures carry hand-derived (not reference-captured) expected values is a finding — re-run the reference on those fixtures and reconcile.
- Pairs with Rule #16 (probe the live system before trusting an assumption) — this is the same "observe, don't assume" discipline applied to an executable reference rather than an IRIS API.

## 37. Deferred-work ledger needs a scheduled terminal-disposition burn-down, not indefinite re-deferral

**Context:** A project that accumulates code-review/retro deferrals in a central `deferred-work.md` ledger across a run of **feature** epics, each of which (correctly) re-defers the carried batch at its retro-review gate because it is not the cleanup epic the items are routed to.

**Rule:** Re-deferral is a valid *per-epic* decision but an invalid *steady state*. When a ledger has been re-deferred by **N consecutive** epics (this project's threshold surfaced at N=3), the next epic to be planned MUST include a dedicated burn-down story whose contract is **terminal disposition for every carried item — re-deferral is not an allowed outcome**. Each item lands in exactly one of: **resolved** (code/test/doc fix), **closed-with-evidence** (a live probe/measurement demonstrates no action needed), or **closed-by-decision** (stakeholder explicitly accepts the behavior). The burn-down uses probe-first discipline (Rule #16) on every item whose suggested resolution embeds an unverified API claim, and a disposition table is recorded in the story AND mirrored into the ledger so the ledger visibly closes to zero carried-open (only the burn-down epic's OWN new review findings may remain).

**Why:** Epic 22 Story 22.1 (commit `9b5e540`). The ledger reached **14 carried items** after Epics 19→20→21 each re-deferred it (each a focused feature epic, correctly declining to scope-creep). Story 22.1 drove all 14 + an operational carry-over to terminal disposition — **8 resolved / 6 closed-with-evidence / 1 operational-close / 0 re-deferred** — via exactly this structure. The verify-then-dispose subset mattered: six items' "suggested resolutions" embedded unverified API claims (StartTask `Device` arg was `[Internal]`, `(Production,Name)` index was `Exact`/case-sensitive so the guard was already correct, `ExternalThaw` body was empty so no password echo, `ProcessGet` was 4.8ms so immaterial, correlator worst-case measured 2000→0.14s), and probing each closed it with evidence rather than speculative code. The ledger closed to zero carried-open with only Epic-22's own two new items (CR 22.0-D1/D2) remaining — the first time in four epics the ledger did not grow.

**How to apply:**
- Retro-review gate: track the re-deferral count per ledger batch. On the first feature epic that re-defers a batch a **3rd** time, the retro's process commitment is "the next planned epic INCLUDES this ledger as in-scope burn-down work" (mirror the Epic 21 retro directive), and the burn-down story's AC set forbids re-deferral.
- Burn-down story creation: enumerate the exact item list from the ledger (do not re-triage from scratch), assign each a planned disposition + AC, and require probe-first on every asserted-but-unverified API claim.
- Code review of a burn-down: a carried item left in an open/ambiguous state (not one of the three terminal outcomes) is a HIGH finding — it violates the epic's core directive.

## 38. Namespace/dictionary-enumerating tools require a scope filter + documented timeout risk; output caps are not scan caps

**Context:** Any read tool whose work is proportional to the number of documents/rows it enumerates from a connected IRIS namespace (a LOC counter, a dictionary walker, a bulk-search / bulk-analyze surface) served synchronously over a `%CSP.REST` route behind the Web Gateway.

**Rule:** Such a tool MUST require a caller-supplied **scope filter** (package prefix / doc spec / bounded query) rather than defaulting to a whole-namespace scan, and its description MUST document the ~60s Web Gateway "Server Response Timeout" risk of an unscoped run. Critically: an **output cap** (top-N, page size, result limit) does NOT bound the **scan work** — the handler still enumerates and processes every in-scope document before truncating the *output*, so a `topN`-style parameter provides zero timeout protection. A whole-namespace scan must be an explicit opt-in (`spec="*"`) with the risk documented at the point of use, never the silent default. If an unscoped mode is offered, it needs either a documented risk note or a background-job/async pattern — not a synchronous best-effort that 504s on any real codebase.

**Why:** Epic 22 Story 22.0 (commit `a1e4008`, decision D2). `iris_loc_count` required a doc spec by design; the lead's Rule #34 cross-namespace smoke drove `spec="*"` against SADEMO (9,186 user classes) and got **HTTP 504** — a live confirmation that the documented D2 timeout risk is real, and that `topN` (which caps only the top-documents output list) did nothing to prevent it because the classifier still scanned all 9,186 files first. The scoped calls (`HSMOD.*` 17 files, `MALIB.*` 15 files, `ExecuteMCPv2.Loc.*` 3 files) all returned fast with bucket sums intact. The 504 was not a defect — it was the design working as documented, surfaced live by the second-namespace smoke (Rule #34) exactly as that rule predicts.

**How to apply:**
- Tool design: make the scope filter a REQUIRED input (or default it to a narrow scope); document the unscoped-scan timeout risk in the tool description AND the docs rollup (Rule #30 style). Do NOT advertise an output cap as if it mitigates scan cost.
- Lead smoke: for such a tool, include one unscoped/large-scope call against a populous namespace to confirm the timeout behavior is the documented one (a clean 504 or a documented degradation), not an opaque hang or a misleading partial result.
- Pairs with Rule #34 (a second, differently-populated namespace is where the scan-cost reality shows up) and Rule #30 (state the scoping requirement + risk in the user-facing docs).

---

## 39. Bootstrap dual-roster — a new bootstrapped class must be added to BOTH the generator array AND the drift-test roster

**Context:** Adding a NEW ObjectScript class (`.cls`) that ships embedded in the bootstrap — a new REST handler / domain class under `src/ExecuteMCPv2/` whose content lands in `packages/shared/src/bootstrap-classes.ts`.

**Rule:** `bootstrap-classes.ts` is generated from a HAND-MAINTAINED, explicitly-ordered `classes` array in `scripts/gen-bootstrap.mjs` (NOT a glob — see the Epic-21 A2 note under Rule #24), AND `packages/shared/src/__tests__/bootstrap.test.ts` carries a SEPARATE hand-maintained roster + class-count that the drift test asserts. Adding a new bootstrapped class REQUIRES editing **both** lists (each carries a "MUST stay in sync" comment); running `gen:bootstrap` only regenerates the embedded *content*, it does NOT add the class to either roster. Test classes (`ExecuteMCPv2.Test*`) are intentionally NOT in the manifest — do not add them. Miss either edit and `bootstrap.test.ts` goes red. Order matters in the generator array: a new class must precede any class that depends on it being present (e.g. before `REST/Interop.cls` dependents).

**Why:** Epic 23 Story 23.1 (commit `214d8ef`): adding `ExecuteMCPv2.REST.Health.cls` required updating the `gen-bootstrap.mjs` `classes` array AND the `bootstrap.test.ts` roster + count; the dev discovered mid-implementation that both are hand-maintained (the architecture summary implied a glob) and must be kept in sync. This recurs for every future new bootstrapped `.cls`; it does NOT fire when merely adding a METHOD to an existing bootstrapped class (the common case), which is why it is easy to forget.

**How to apply:** a new-`.cls` story's spec includes an explicit AC — "add the class to `gen-bootstrap.mjs` `classes` array (correct order) + `bootstrap.test.ts` roster + count, then `gen:bootstrap`, record `BOOTSTRAP_VERSION` from→to (Rule #24)". Code review verifies BOTH rosters moved and the drift test is green. Generalizes the Rule #18/#24 regen discipline to the two-hand-maintained-lists reality.

---

## 40. Disposable-webapp second-namespace smoke for `scope:"NONE"` namespace-sensitive tools

**Context:** The lead's Rule #34 second-namespace live smoke for a namespace-sensitive tool that is `scope:"NONE"` (instance-wide; NO `namespace`/profile knob the caller can point at a second namespace) — e.g. a composite health/diagnostic tool whose per-area output varies by namespace (interop enabled/not, schema present/not).

**Rule:** Do NOT default to recording a Rule #34 residual-risk gap just because the tool has no namespace parameter. Instead stand up a DISPOSABLE `%CSP.REST` web application bound to a second namespace (via the admin webapp surface / `iris_webapp_manage`), drive the tool/endpoint through it to genuinely exercise that namespace, confirm the namespace-sensitive area actually DIFFERS across the two namespaces (proving the smoke is real, not vacuous) while the truly instance-wide areas match, then DELETE the temporary webapp. Clean up before staging (the webapp is a live-IRIS object, not a repo file). A "no second namespace reachable" residual-risk note is the fallback ONLY when a disposable webapp genuinely cannot be stood up.

**Why:** Epic 23 Story 23.2 (commit `b7680f9`): `iris_health_check` is `scope:"NONE"` and the `/api/executemcp/v2` webapp is bound to HSCUSTOM only. Rather than log a gap, the dev created a disposable SADEMO-bound webapp, proved `interop` is genuinely namespace-sensitive (HSCUSTOM 0 queues/stopped vs SADEMO 7 queues/running) while `mirror`/`ecp` are instance-wide, then deleted it — a genuine Rule #34 smoke, not a documented gap.

**How to apply:** for a namespace-sensitive `scope:"NONE"` tool, the AC-mandated second-namespace smoke uses create→drive→delete a disposable webapp. Extends Rule #34; pairs with Rule #41 (the unit-test analogue — pin the not-configured branch).

---

## 41. Test the "not-configured" branch that the fully-configured default namespace masks

**Context:** A per-area / per-branch handler whose behavior forks on whether an IRIS subsystem is CONFIGURED in the target namespace (interop/Ens classes present, mirror membership, ECP configured, or a system class that only resolves in `%SYS`), being tested primarily against the project's fully-configured default namespace (HSCUSTOM).

**Rule:** The fully-configured default namespace exercises only the "configured/present" branch; the "not-configured/absent" branch — which usually carries a DISTINCT contract (e.g. `notApplicable`-not-`error`) — ships UNTESTED behind a green suite AND a green single-namespace smoke. Add a test that deterministically drives the ABSENT branch by choosing a namespace/state where the subsystem is genuinely absent (`%SYS` has no `Ens.Director`; a non-mirror member; `SYS.Lock` does not exist outside `%SYS`), so the forced failure/absence is REAL, not mocked.

**Why:** Epic 23 Story 23.1: the `interop` gate-failure branch (`interopEnabled:false` when Ens classes are absent — the story's own §5-AC-4 highest-named regression risk) was untested because the dev's `%UnitTest` AND the dev's live smoke both ran only against HSCUSTOM, which HAS `Ens.Director`. QA caught it, proved `%SYS` lacks `Ens.Director`, and pinned the branch with a real forced-failure test (`TestInteropAreaGateFailureYieldsNotApplicable`). Extends Rule #34 down to the unit-test-coverage level.

**How to apply:** for a config-dependent handler, code review treats "the not-configured branch is covered only by the fully-configured default namespace" as a coverage gap (MED when that branch has a distinct contract). The unit test pins the absent branch; the Rule #34 / Rule #40 lead smoke confirms it live.

---

## 42. Dedicated pre-implementation research story for a live-verifiable contract

**Context:** A feature whose implementation-guiding contract (thresholds, classifications, API pins, formulas, area applicability) can be VERIFIED against live system semantics before the implementing stories code against it, and the epic is split so a dedicated research/probe story precedes the endpoint/tool stories (a "Story X.0"-style research story).

**Rule:** Front-load a dedicated research story that (a) pins every uncertain API against live source + probe (Rule #16), AND — critically — (b) sanity-checks the SPEC'S OWN CLAIMS (threshold directions, defaults, which areas are applicable) against live semantics, not just the API shapes. A spec authored from docs/extrapolation can carry a directional or semantic error that silently corrupts the downstream engine; amend the spec IN PLACE. The catch is cheap in the research story and expensive after two stories build on the wrong claim.

**Why:** Epic 23 Story 23.0 (commit `afb5e39`): the research story caught the threshold-DIRECTION bug (journal/license/lockTable are ascending %-utilized, not the spec's implied "free% below" descending) and folded `memory` out with live evidence (`SYS.Stats.Dashboard` has no memory field) — BEFORE 23.1's endpoint and 23.2's verdict engine coded against the spec. Reinforces/extends Rule #16 from "verify API shapes" to "verify the spec's own claims."

**How to apply:** when an epic's contract is live-verifiable, give Story X.0 an AC to reconcile the spec's CLAIMS against live semantics (not merely fill `[PROBE]` markers); code review of that research story adversarially re-verifies the load-bearing pins AND claims live (Epic 23's 23.0 review re-ran the locks formula + confirmed the memory-drop + all four threshold directions against live HSCUSTOM).

---

## 43. A user-facing / safety feature ships minimal docs in its OWN story — never 100% deferred to a closing rollup

**Context:** A multi-story epic that introduces a user-facing or safety-relevant feature (a new env var, a governance mode, a client-visible capability) in one story and defers the ENTIRE documentation rollup (Rule #30) to a later/closing story.

**Rule:** The feature-introducing story must carry at LEAST minimal user-facing docs for what it ships — a README env-var-table row and a one-line description of the capability and its default state — even when the full marketing-grade rollup (all client-config guides, per-server READMEs, CHANGELOG polish) is intentionally consolidated into a closing docs story. Deferring 100% of docs to a later story means the interim build (and any independent checkout of the feature story) ships a live, possibly security-relevant capability that appears NOWHERE in the docs. "The epic ships as a unit via the merge gate" is not sufficient — a feature story should be independently doc-complete for what it introduces. The closing rollup then ENRICHES (worked examples, guides, marketing framing), it does not FIRST-DOCUMENT.

**Why:** Epic 24 (Story 24.1, commit `b284f61`): the `IRIS_GOVERNANCE_PRESET=read-only` engine shipped with ZERO README mentions — the docs obligation lived only in Story 24.2's AC. The 24.2 dev discovered the gap and folded the full preset rollup in (`6b71297`), but that was luck-of-the-pipeline, not a guaranteed gate; a 24.1-only build had an undocumented, security-relevant safety feature. The Project Lead flagged the concern at the retro. Recurring-shape: it would silently recur on every multi-story epic whose docs are deferred to the closing story. Pairs with Rule #30 (the full-rollup discipline) — this rule ensures the feature is never *undocumented in the interim*, #30 ensures the rollup is *complete at the end*.

**How to apply:** a feature-introducing story's ACs include a minimal-docs line (env-table row + capability + default state per Rule #30's default-state discipline); the closing docs-rollup story's AC says "enrich + complete," not "first-document." Code review of a feature story treats a shipped user-facing capability with no doc footprint as a finding.

---

## 44. Hand-curated safety classification needs a mechanical cross-check against the tools' own declared signals

**Context:** Building a hand-curated map that classifies an EXISTING tool/action surface for a safety gate (e.g. `BASELINE_ACTION_CLASSIFICATIONS` mapping every governance key to `read`/`write` for `IRIS_GOVERNANCE_PRESET=read-only`), where a wrong entry silently defeats the gate (a false `read` lets a mutation through read-only mode).

**Rule:** A completeness test (key-set parity) + human review + named value-pins are necessary but NOT sufficient — they are blind to whether a given key landed on the correct SIDE of the classification. Add a mechanical cross-check against an INDEPENDENT signal the tools already declare — for read/write, each tool's own `annotations.readOnlyHint`: flag any key classified `read` whose tool declares `readOnlyHint:false` (it either needs a justification comment explaining the divergence, or is a misclassification). The cross-check is an oracle the hand-curation author cannot fool with the same mental-model error that produced the wrong classification. It cannot be a FULL oracle (some reads legitimately diverge from `readOnlyHint`, and a runtime oracle would require executing every tool), so it flags-for-review rather than hard-fails — but it mechanically surfaces the exact class of error human review misses.

**Why:** Epic 24 Story 24.0 (commit `826c2bc`): the completeness test + value-pin safety test both passed, yet the Opus review caught TWO HIGH misclassifications by reading tool source — `iris_oauth_manage:discover` (`%SYS.OAuth2.Registration.Discover()` persists in a committed txn) and `iris_transform_test` (executes arbitrary DTL; its own `readOnlyHint:false`) — both classified `read`, both would have punched a hole through read-only mode. A `readOnlyHint` cross-check would have auto-flagged `iris_transform_test` (read + `readOnlyHint:false`). Routed to Story 25.0. Generalizes Rule #20 (mechanical baseline proof) from "the set is complete" to "each entry is on the correct side, cross-checked against an independent declared signal"; pairs with Rule #16 (verify against live source) as the automated analogue.

**How to apply:** when hand-classifying an existing surface for a safety gate, add a test that cross-checks each classification against the tools' own declared annotations and flags divergences for a justification comment or reclassification. Fail-safe direction on any unresolved divergence (classify the stricter/safer side — for read-only that is `write`).

---

## Rules captured: 44
## Epics contributing: 22 (retros 2026-04-21, 2026-04-22, 2026-06-16, 2026-06-17, 2026-06-18, 2026-07-02, 2026-07-03, 2026-07-04, 2026-07-08 ×2)

**Audit note (2026-07-08, Epic 24):** Epic 24 (Governance Safety Presets & SQL Resource Caps) was a three-story, pure-TS `@iris-mcp/shared` feature epic (24.0 generated-shape `baseline-classifications.ts` read/write map of the frozen 141-key baseline + completeness/safety tests → 24.1 `IRIS_GOVERNANCE_PRESET` cascade engine + surfacing + capstones → 24.2 `IRIS_SQL_MAX_ROWS`/`TIMEOUT` caps + docs rollup + live smokes). No ObjectScript, no bootstrap bump, no new tool/governance key (Rule #31), frozen baseline `1e62c5ad5bf7` untouched throughout (`gen:governance-baseline:check` exit 0 every checkpoint). The retro nominated 2 rule candidates; the Project Lead confirmed both pass the general-pattern bar (Rule #43 — user-facing/safety feature ships minimal docs in its OWN story; Rule #44 — hand-curated safety classification needs a mechanical cross-check against the tools' declared signals). Both generalize beyond trigger: #43 recurs on every multi-story epic that defers 100% of docs to a closing rollup (Story 24.1 shipped `IRIS_GOVERNANCE_PRESET` with zero README mention; the 24.2 dev folded the rollup in by luck-of-the-pipeline); #44 recurs whenever an existing surface is hand-classified for a safety gate (the completeness + value-pin tests passed yet the Opus review caught 2 HIGH misclassifications — `iris_oauth_manage:discover`, `iris_transform_test` — a `readOnlyHint` cross-check would auto-flag the latter; routed to Story 25.0). All three stories closed at **0 HIGH, 0 rework**; fixes applied inline: 2 HIGH safety misclassifications (24.0, verified vs live IRIS source), 1 LOW (24.1), 2 MED (24.2 — `IRIS_SQL_TIMEOUT="Infinity"` → `setTimeout` ~1ms silent-disable via `Number.isNaN`-not-`isFinite`; `mergeProfile` dropping SQL caps for non-default profiles). The Story-24.0 `iris_transform_test` spec-divergence was lead-RATIFIED (the story AC over-broadened the read-verb allowlist vs binding spec 02 §2.1 — the fix aligns with the spec). Retro dispositions: CR 24.2-1 RESOLVED (docs softened — "hard cap" → "ceiling on the number of rows returned … post-fetch, not the server-side result set or transfer", `9bda487`), CR 24.1-1 CLOSED (in-spec `presetApplied` non-but-for edge on new default-disabled writes), CR 24.0-1 preventive `readOnlyHint` guard ROUTED to Story 25.0. Existing rules exercised and held, not re-codified (Rule #1): Rule #16 (24.0 classifications verified vs tool `annotations` + `Security.cls` handlers + `%SYS.OAuth2.Registration` source; 24.2 `[PROBE]` resolved — `ctx.http.post` `RequestOptions.timeout` ms plumbing + `IrisConnectionConfig`); Rule #19 (byte-for-byte back-compat capstones — unset preset deep-equals pre-change over the full 141-key universe; unset SQL caps produce no `rowsCapped`/no timeout arg via conditional-spread absent-key shape); Rule #20 (generated/enforced baseline over an existing capability — the completeness test; #44 extends it to per-entry correctness); Rule #21 (both capstones + QA cross-surface tests in the DEFAULT suite, not `*.integration.test.ts`); Rule #23/#25 (frozen baseline git-clean, `:check` exit 0, bare generator never run); Rule #26 (live lead smoke — built dist over MCP stdio, HSCUSTOM: read-only refused `iris_global_set` with `presetApplied` and NO PUT reached IRIS [logs prove changes-nothing], read succeeded, explicit override wrote live, `IRIS_SQL_MAX_ROWS=2`→`rowsCapped`); Rule #28 (no new key — the preset is server CONFIGURATION, not a tool); Rule #30 (docs rollup across README + 3 client guides + per-server README + CHANGELOG with default-state callouts; #43 ensures the feature story is not undocumented in the interim); Rule #31 (framework configuration — package tool-array lengths unchanged, only discovery output `+preset` + read-only policy contents moved); Rule #32 (read-only blocks `defaultEnabled` writes — `iris_production_control:clean` pinned `false`; `presetSeed` never consults `defaultEnabledWrites`). Retro-review gate at kickoff re-deferred the 10 carried LOW items (4 Epic-22 + 6 Epic-23; feature epic, below the Rule #37 ≥3 threshold, no colliding Story X.0 — the 24.0 slot is a feature story). Epic 24 closes 0 HIGH / 0 rework / 0 post-close smoke defects; the deferred-work ledger carries the 10 older LOW + CR 24.0-1 (routed to 25.0) into the Epic 25 retro-review gate.

**Audit note (2026-07-08, Epic 23):** Epic 23 (Composite Health Check — `iris_health_check`) was a three-story feature epic (23.0 spec-pin research → 23.1 `/monitor/health` ObjectScript endpoint → 23.2 TS tool + verdict engine + docs), the first of the Wave-1 feature-differentiation epics. The retro nominated 4 rule candidates; the Project Lead confirmed all 4 pass the general-pattern bar (Rule #39 — bootstrap dual-roster; Rule #40 — disposable-webapp second-namespace smoke; Rule #41 — test the not-configured branch the default namespace masks; Rule #42 — dedicated pre-implementation research story for a live-verifiable contract). Each generalizes beyond its trigger: #39 recurs for every future new bootstrapped `.cls` (Health.cls surfaced the two hand-maintained rosters — `gen-bootstrap.mjs` array + `bootstrap.test.ts` roster); #40 and #41 recur for every namespace-sensitive tool (the `interop` gate-failure branch was masked by HSCUSTOM's fully-configured state at BOTH the smoke and unit-test levels — QA caught the unit gap and pinned it against `%SYS`-lacks-`Ens.Director`, the dev's disposable SADEMO webapp caught the smoke gap); #42 recurs for any epic whose contract is live-verifiable (23.0 caught the threshold-DIRECTION spec bug and the `memory`-drop before 23.1/23.2 coded against the spec). All three stories closed at **0 HIGH, 0 rework** (fixes applied inline: 9 spec clarifications in 23.0, 0 in 23.1, 2 LOW hardening in 23.2 — non-finite guard + worst-DB tie-break). Deferred: 6 forward-looking items from 23.0 (CR 23.0-1..6, all resolved/owned by 23.2's verdict engine), 5 LOW from 23.1 (CR 23.1-1..5 handler-hardening/23.2-scope), 3 LOW from 23.2 (CR 23.2-1..3 — `server`-field omission [ToolContext genuinely lacks the profile name, verified vs `server-base.ts`], two near-unreachable paths); CR 22.1-3 + CR 23.0-2/-5 + 4 further prior items reconciled RESOLVED across the epic. `server` omitted from `structuredContent` is an evidence-based spec divergence, not an oversight. Existing rules exercised and held, not re-codified (Rule #1): Rule #16 (23.0 pinned every `[PROBE]` via live probe + `irislib` source; `locks`→`SYS.Lock.GetLockSpaceInfo()`, `GetMaxLockTableSize` rejected as a 1TB sentinel; the review re-verified live); Rule #17 (glob-load `src/**/*.cls`); Rule #18/#24 (bootstrap regen-only, `e931a96373f0`→`13b4b5f003ab`, idempotent; 23.0 + 23.2 TS-only, no bump); Rule #19 (strictly additive — no existing tool/output changed; ops 20→21); Rule #23/#25 (frozen baseline `1e62c5ad5bf7` git-clean all epic, `gen:governance-baseline:check` exit 0, new `iris_health_check` key post-foundation/default-enabled, bare generator never run); Rule #26 (live-HTTP smokes: 23.1 malformed-body clean `SanitizeError` envelope; 23.2 threshold-override verdict FLIP + injected-error-caps-at-`warning`); Rule #28 (`mutates:"read"` on the new tool — mandatory even for a read); Rule #30 (docs rollup across all four surfaces stated read/enabled-by-default + the v1 informational-areas + `databases` maxSize=0 caveats); Rule #33 (23.1 folded in CR 22.1-3 — de-caret the `BackupManage` restore message so `SanitizeError` no longer blanks `^DBREST`/`CLUMENU^JRNRESTO`); Rule #34/#35 (34 generalized into the new #40/#41; 35 → 23.1 hit the partial-snapshot again, handled via `%UnitTest_Result` SQL, 15/15). Retro-review gate at kickoff re-deferred the 5 Epic-22-own LOW items (feature epic, first deferral, below the Rule #37 ≥3 threshold — no colliding Story X.0, mirroring Epics 19/20/21). Epic 23 closes 0 HIGH / 0 rework / 0 post-close smoke defects; the deferred-work ledger carries the 4 remaining Epic-22 LOW + Epic-23's own 8 LOW into the Epic 24 retro-review gate.

**Audit note (2026-07-04, Epic 22):** Epic 22 (ObjectScript LOC Counter & Deferred-Work Cleanup) was a two-story epic — a feature story (22.0 `iris_loc_count`: new `ExecuteMCPv2.Loc.*` library + `/dev/loc` endpoint + dev tool, 25→26) AND the long-deferred cleanup story (22.1 ledger burn-down). It is the epic the Epic 21 retro directed to finally include the ledger rather than re-defer it. The retro nominated 3 rule candidates; the Project Lead confirmed all 3 pass the general-pattern bar (Rule #36 — reference-parity ground-truth pinning; Rule #37 — deferred-ledger terminal-disposition burn-down cadence; Rule #38 — namespace-enumerating tool scope-filter + timeout, output-cap ≠ scan-cap). Each generalizes beyond its trigger: #36 recurs for any future port/reimplementation with an executable reference (the MaskStrings MED was caught only by running `cos_loc_counter.sh` on the adversarial fixture, not by reasoning); #37 recurs whenever a ledger accumulates across ≥3 feature epics (this one closed the 14-item ledger to zero carried-open — 8 resolved / 6 closed-with-evidence / 1 operational-close / 0 re-deferred, the first non-growth in 4 epics); #38 recurs for any synchronous namespace/dictionary-enumerating REST tool (the SADEMO `spec="*"` 504 confirmed D2 live and proved `topN` caps output not scan). Both stories closed at **0 HIGH** (2 MED auto-fixed inline — CR 22.0-1 MaskStrings leftmost-longest backtracking parity, reference-pinned; CR 22.1 ledger-hygiene reconciliation of historical OPEN/DEFER sections); 5 new Epic-22-own LOW deferred (CR 22.0-D1/D2 scan-abort TOCTOU + StudioOpenDialog overlap-order; CR 22.1-1/-2/-3 pairloop-reqsrc-unreachable + dist-coupling + Monitor restore-msg caret) — permitted by AC 22.1.7 as the burn-down epic's own findings, ledger otherwise at zero. CR 21.1-1 was resolved as a stakeholder-decided CODE fix (Option A — extend episode rule A to pairloops, symmetric grouping) rather than doc-only. Existing rules exercised and held, not re-codified (Rule #1): Rule #16 (22.0 Task-1 live probes of GetTextAsArray pFlags/StudioOpenDialog ShowGenerated/`%IsA`/CompiledMethod.Language before freezing; 22.1 verify-then-dispose probed 6 items before closing); Rule #17 (glob-load `src/**/*.cls` — the review's wrong-glob-base slip caught and corrected immediately, the exact Rule #17 trap); Rule #18/#24 (bootstrap regen-only per ObjectScript story: `c3cc801cfead`→`919124293f66`→`e931a96373f0`, idempotent each time); Rule #19 (both stories strictly additive — no existing tool/output changed; CR 20.0-1 chose docs over a schema-shape change to preserve the AC 20.0.7 gate); Rule #23/#25 (frozen baseline `1e62c5ad5bf7` git-clean all epic, `gen:governance-baseline:check` exit 0, bare generator never run; the CR 16.0-1 shared key-derivation helper extraction left the emitted baseline byte-identical); Rule #26 (live-HTTP smokes: 22.0 spec-rejection + includeGenerated toggle + topN cap; 22.1 `||`-delimiter + abstract/non-host `add` rejections, each empty-result no-write); Rule #28 (scalar `mutates:"read"` on `iris_loc_count`); Rule #30 (docs rollup stated read/enabled-by-default + the D2 scope/timeout caveat); Rule #34 (22.0 second-namespace SADEMO smoke — the direct trigger for Rule #38's live 504); Rule #35 (partial-snapshot AND a NEW shape — class-level report truncation on slow classes even when all pass — verified via `%UnitTest_Result.TestMethod` SQL). Epic 22 closes with 0 HIGH, 0 rework, 0 post-close smoke defects, and the deferred-work ledger at zero carried-open for the first time since Epic 18.

**Audit note (2026-07-03, Epic 21):** Epic 21 (Message Trace Sequence Diagram) was a two-story feature epic (21.0 diagram library core + endpoint + tool; 21.1 episode compression + cross-session dedup + docs), plus three post-close smoke-fix commits driven by the Project Lead's own extended live testing across all Ensemble-enabled namespaces. The retro nominated 2 rule candidates; the Project Lead confirmed both pass the general-pattern bar (Rule #34 — cross-namespace/environment live smoke; Rule #35 — `iris_execute_tests` early-partial-snapshot caveat). Both generalize beyond their triggering incident: #34 recurs for every future tool whose output depends on namespace-varying IRIS state (message tables, locale, schema presence) — the exact gap that let 3 real defects (dedup id-masking, unresolved-message-table boilerplate, per-worker locale variance) ship past 0-HIGH review and ~86 green tests; #35 recurs for every future ObjectScript story, having independently resurfaced in every pipeline stage (dev/QA/review) of both stories this epic. Both story-level code reviews closed at 0 HIGH (12 findings auto-fixed inline across the two stories, incl. the Mermaid `;`-escape MED and the dedup junk-coercion MED); CR 21.0-1 resolved same-epic as improvement I3 (stakeholder decision) rather than deferred. Retro-review gate re-deferred all 11 carried ObjectScript/ops items at kickoff (feature epic, not the cleanup epic they're routed to — mirrors Epics 19/20); ledger now carries **14 open items** (11 carried + CR 21.0-2/21.1-1/21.1-2) after 3 consecutive feature epics — the Project Lead has directed that the next epic to be planned **include** this cleanup batch (not defer again). Existing rules exercised and held, not re-codified (Rule #1): Rule #2/#16 (3 story-creation discrepancies caught before dev — proposal's "embedded SQL" claim, gen-bootstrap.mjs's actual ordered-array shape vs the proposal's "glob" claim, and the test package name — all amended in epics.md pre-dev); Rule #7/#8/#33 (namespace save/restore, single-render, SanitizeError prefix-strip + caret-global discipline held across the new handler); Rule #10 (dedup wire-explicit); Rule #17 (glob-load correction `src/**/*.cls` vs `src/ExecuteMCPv2/**` recorded for future stories); Rule #18 (bootstrap-classes.ts regenerated only, 6 regens this epic, idempotent at every checkpoint); Rule #19 (iris_production_messages byte-for-byte unchanged, mechanically snapshotted); Rule #23/#25 (frozen baseline `1e62c5ad5bf7` untouched all epic, `gen:governance-baseline:check` used, bare generator never run); Rule #24 (6 bootstrap regens: `5376735fabab`→`5bd5579c25c1`→`1040c6dcfce3`→`5ece56d776a2`→`c3cc801cfead`); Rule #28 (scalar `mutates:"read"` on the new tool, mandatory even for a read); Rule #30 (docs rollup stated read/enabled-by-default with the why). Epic 21 closes with 0 HIGH, 0 rework, 3 post-close smoke defects (all namespace/environment-shape, all same-day fixed with regression tests — the direct trigger for Rule #34).

**Audit note (2026-07-02, Epic 20):** Epic 20 was a single-story feature epic (Story 20.0 only — `iris_production_control` `clean` action via `Ens.Director.CleanProduction()`, decision F1; plus a governance-foundation extension, decision F2). The retro nominated 2 rule candidates; the Project Lead confirmed BOTH pass the general-pattern bar (Rule #32 — "write, default-enabled" governance mechanism; Rule #33 — `SanitizeError` strips caret-globals). Both generalize beyond their triggering incident: #32 recurs for every future safety/recovery write that must ship enabled under a default-off gate (the misclassify-as-read and mutate-the-baseline shortcuts are both traps); #33 recurs for every handler error message that must name an IRIS global. Retro-review gate re-deferred all 10 carried ObjectScript/ops items (routed to a future cleanup epic — Epic 20 is a feature epic, not the cleanup epic), no colliding Story X.0 (mirrors Epic 19). Existing rules were exercised and held, not re-codified (Rule #1): Rule #16 (story written against live `Interop.cls`/`governance.ts`/`server-base.ts` source; the `CleanProduction`/`RecoverProduction` signatures + `^Ens.AppData` mapping verified in `irislib` before wrapping — surfaced the latent `RecoverProduction(tForce)` arg bug, fixed in-scope), Rule #19/#21 (strictly additive; default-empty `defaultEnabledWrites` proved byte-for-byte back-compat; mutation-tested all-writes-still-disabled capstone in the default suite), Rule #23/#25 (frozen baseline `1e62c5ad5bf7` git-clean), Rule #24 (bootstrap regen `daeb5f0bd525`→`5376735fabab`), Rule #26 (live-HTTP smoke proved the `killAppData`-without-`confirm` destructive-path refusal changed nothing + recover no-arg fix + guard intact), Rule #28 (`clean` carries truthful `mutates:"write"`), Rule #30 (docs rollup stated `clean` is a write ENABLED by default with the *why*, across all surfaces). 1 LOW review item (CR 20.0-1 — `recover` still forwards an ignored `force` param, pre-existing tool-wide) deferred to `deferred-work.md`. Epic 20 closes with 0 HIGH, 0 rework, 0 smoke defects.

**Audit note (2026-06-18, Epic 19):** Epic 19 was a single-story feature epic (Story 19.0 only — the `iris_server_profiles` framework discovery tool, decision E1; TS-only `@iris-mcp/shared`, no ObjectScript/bootstrap, frozen baseline `1e62c5ad5bf7` untouched). The retro nominated 1 rule candidate; the Project Lead confirmed it passes the general-pattern bar (Rule #31 — framework-provided tool docs/counting shape). It generalizes beyond its triggering incident: the two-count split (package-array length unchanged vs advertised/suite +1/server) recurs for every future framework-registered capability, of which E1 is now the third (after D2 `server`-param injection and the D6 resource). Both CR 19.0 LOW findings (CR 19.0-1 `profile` validation under `allProfiles`; CR 19.0-2 invalid `server` fallback for the connection-agnostic discovery tool) were RESOLVED during the retro at the Project Lead's request (commit `537ccd8`, +3 regression tests, live re-smoked) — Epic 19 closes with zero deferred items. Existing rules were exercised and held, not re-codified (Rule #1): Rule #16 (story written against live `server-base.ts`/`profiles.ts`/`governance.ts` source — the special-case-in-`handleToolCall` design landed clean), Rule #19/#23 (strictly additive; default-only back-compat proven; frozen baseline + no BOOTSTRAP_VERSION change), Rule #25 (`gen:governance-baseline:check` used, bare generator NOT run), Rule #28 (`mutates:"read"` mandatory even for the read tool — `assertGovernanceClassification` passes), Rule #30 (docs rollup stated "read / enabled by default" across all surfaces — live-verified), Rule #22/#26 (lead smoke drove the BUILT dist + live IRIS: roster redaction, per-server default-disabled writes, tool↔D6-resource non-drift). The live MCP-reload test was the strongest validation — it surfaced that each server reports its OWN governed surface (admin Security writes, ops database/backup writes, interop production_item add/remove all correctly default-disabled), which mocked unit/e2e tests structurally cannot show.

**Audit note (2026-06-17, Epic 18):** Epic 18 was a minimal single-story cleanup epic (Story 18.0 only — Epic 17 deferred-item triage + include-now hardening). The retro nominated 1 rule candidate; the Project Lead confirmed it passes the general-pattern bar (Rule #30 — per-epic docs rollup must flag governance default-disabled state). It generalizes beyond its triggering incident: the docs-rollup governance-callout gap would silently recur on every future governed-tool epic (it was the Epic 15 rollup that included the callout; Epics 16/17 rollups omitted it). Existing rules were exercised and held, not re-codified (Rule #1): Rule #16 (18.0 dev re-probed `Ens.Config.*` + `Interop.cls` before trusting deferred-item suggestions), Rule #19 (the new guards stayed strictly additive — 17.2 back-compat snapshots green), Rule #23/#25 (baseline frozen `1e62c5ad5bf7`), Rule #24 (bootstrap regen `39dc932907cb`→`fd3f065bcd3c`), Rule #26 (live-HTTP smoke proved 5 guarded-path rejections with 0-row no-write integrity), Rule #27 (`LoadFromClass` sync preserved in CR 17.2-5), Rule #29 (the `add` className/dup-name guard is the analogous input-hygiene guard to the `||` IdKey guard). 2 review items (CR 18.0-1 MED, CR 18.0-2 LOW) are tracked work in `deferred-work.md`, not patterns — routed to the next cleanup-epic Story X.0.

**Audit note (2026-06-16, Epic 17):** Epic 17 retro nominated 3 rule candidates; the Project Lead confirmed all 3 pass the general-pattern bar (Rules #27, #28, #29). Each generalizes beyond its triggering incident: #27 (Ens.Config XData-vs-extent / LoadFromClass) applies to any future Interop config-item handler and was confirmed both in 17.2 dev (the add→remove round-trip) and the 17.2 live smoke (get-after-add miss); #28 (reads still need `mutates`) corrects the Story 17.0 probe doc and applies to every future read tool/action on a governed server; #29 (composite-IdKey delimiter guard) applies to any compound-id-from-input handler and was proven live. Existing rules were exercised and held, not re-codified: Rule #16 (pre-spec probe caught 2 discrepancies in 17.0 + a 3rd in 17.2), Rule #19 (17.2 back-compat gate, strengthened to full-object `toEqual`), Rule #24 (per-story bootstrap regen `fe972c4cb317`→`39dc932907cb`; 17.4 verified idempotent — NOT a deferred bump), Rule #23/#25 (baseline frozen `1e62c5ad5bf7` across the epic). No candidates skipped; 5 MED/LOW review items deferred to `deferred-work.md` (tracked work, not patterns) for Epic 18 Story 18.0 triage.

## Original audit notes (pre-Epic-17)
## Rules captured (prior): 26
## Epics contributing (prior): 14 (retros 2026-04-21, 2026-04-22, 2026-06-16)

**Audit note (2026-06-16):** Epic 14 retro nominated 4 rule candidates; the Project Lead confirmed all 4 pass the general-pattern-shape bar (Rules #19, #20, #21, #22). All four generalize from evidence spanning the full 6-story foundation epic (not single incidents): #19 back-compat gates held across all stories; #20 the D3 generated baseline; #21 the AC 14.5.6 capstone; #22 the per-story lead smokes 14.1–14.6. No candidates were skipped this retro. Two deferred items were NOT codified as rules (correctly — they are tracked work, not patterns): the `.optional()`-wrapped-action-enum gate/baseline hardening (deferred to Epic 15's first governed write tool) and the pre-existing doc drift (migration-guide dotted names, architecture.md stale counts).

**Audit note (2026-04-21):** Rule #14 ("Password redaction — gate on length") was initially codified during Epic 11 retro, then removed during the retro's self-audit. The retro's own Murat-triage had flagged Bug #8 as narrow ("not a general pattern — fix is in code, no rule needed"), but it was codified anyway. Removal enforces Rule #1's "narrow one-off fixes do NOT become rules" principle. The fix remains in the code and the retro bug log.

**Audit note (2026-04-22):** Epic 12 retro triaged 6 rule candidates; 4 passed the general-pattern-shape bar (Rules #15, #16, #17, #18) and 2 were skipped:
- "Property-name vs property-type distinction" (BUG-1 `ChangePassword` boolean vs `Password` setter) — narrow one-property pair; Rule #2 ("read IRIS class source") already covers prevention.
- "One consolidated bootstrap bump per epic" — process-shape, better tracked in epic-cycle-log conventions than as a rule.

These decisions enforce Rule #1's general-pattern-shape requirement.

**Audit note (2026-06-16, Epic 15):** Epic 15 retro nominated 4 rule candidates; the Project Lead confirmed all 4 pass the general-pattern bar (Rules #23, #24, #25, #26). All generalize beyond their triggering incident: #23 (frozen-foundation baseline) held across all of Epic 15 (89→93 tools, foundation hash unchanged) and corrects Epic 14 retro AI#4, which was proven wrong by the first real governed write tool; #24 (bootstrap-regen per change) recurs in Epics 16/17's identical "one bump at the closing story" plans; #25 (generator `--check` mode) is the real fix for a footgun the lead tripped live, superseding Story 15.1's insufficient prose note; #26 (live-endpoint smoke) caught/confirmed 3 security fixes across 15.1–15.5. Notably, the Epic 14 retro's own AI#4 became a retro lesson here — a planning assumption ("regenerate the baseline on every tool add") that only a real consumer could falsify. Two items were NOT codified (tracked work, not patterns): the `gen-governance-baseline --check` implementation itself (deferred to a CI story) and the per-alert/per-cleanup deferrals carried in `deferred-work.md`.
