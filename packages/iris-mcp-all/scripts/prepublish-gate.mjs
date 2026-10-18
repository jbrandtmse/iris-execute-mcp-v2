#!/usr/bin/env node
/**
 * Story 35.8 (AC 35.8.4) — the packaging/prepublish enforcement surface for
 * `@iris-mcp/all`'s Epic 35 defect gate (`src/__tests__/epic35-defect-gate.test.ts`).
 *
 * WHY THIS EXISTS. The gate is the epic-done proof that all nine Epic 35
 * corrected contracts hold on the REAL surface. Like every live-IRIS gate in
 * this repo it degrades gracefully (beforeAll probe + ctx.skip()) when IRIS is
 * unreachable — green with nothing asserted. `IRIS_REQUIRE_LIVE=1` converts
 * that skip into a hard failure, and it must be armed SOMEWHERE on the
 * packaging path or the gate protects nothing (Rule #59's named disqualifier —
 * "an arming env var nothing sets" — Epic 34 retro incident #6; the same gap
 * Story 35.2's review closed for @iris-mcp/data as `35-2-CR-1`). This repo has
 * no CI (`.github/workflows` absent), so `prepublishOnly` IS the packaging
 * boundary. Until this story, `@iris-mcp/all`'s `prepublishOnly` ran only
 * `scripts/verify-iris-reachable.mjs` — a bare ping that never ran a single
 * gate leg.
 *
 * SUPERSEDES `scripts/verify-iris-reachable.mjs` for this package, losing
 * nothing: the dist-freshness check below runs FIRST (stronger — see the next
 * paragraph), and the reachability ping is subsumed by `IRIS_REQUIRE_LIVE=1`,
 * under which the gate's own `beforeAll` throws on an unreachable host, wrong
 * credentials, an undeployed ExecuteMCPv2 REST app, or a missing F1 fixture.
 * Mirrors the shape `@iris-mcp/dev` (34.6) and `@iris-mcp/data` (35.2)
 * established rather than inventing a third.
 *
 * DIST-FRESHNESS, WIDER THAN USUAL. `checkDistFresh(process.cwd(), ...)` on
 * this package is a deliberate no-op (`@iris-mcp/all` declares no
 * `files: ["dist"]` — it is a dependencies-only meta-package). But the gate
 * does NOT drive this package's code: it dynamically imports the BUILT
 * `dist/tools/index.js` of `@iris-mcp/shared` and the four leaf packages the
 * nine fixes live in (dev, admin, data, interop — ops carries no Epic 35 fix
 * and no leg drives it). A stale leaf dist would let the gate pass over code
 * that is not what ships, so each of those five dists is freshness-checked
 * explicitly here, fail-closed, before vitest runs.
 *
 * Implemented as a plain Node script (env set via `process.env`, inherited by
 * the spawned vitest) and spawned through `cmd.exe /d /s /c` on Windows, for
 * the two reasons documented at length in
 * `packages/iris-dev-mcp/scripts/prepublish-gate.mjs`: a POSIX
 * `IRIS_REQUIRE_LIVE=1 vitest run ...` prefix silently fails under the bare
 * `cmd.exe` npm/pnpm use on Windows, and `spawn("pnpm", ...)` without a shell
 * cannot execute the `pnpm.cmd` shim.
 */
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { checkDistFresh } from "../../../scripts/lib/dist-freshness.mjs";

const packageDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const repoRoot = path.resolve(packageDir, "..", "..");

// Self-check first (a deliberate skip for this dist-less meta-package, kept so
// the day @iris-mcp/all gains a build output it is freshness-checked too).
const selfCheck = checkDistFresh(packageDir, "@iris-mcp/all");
if (!selfCheck.ok) {
  console.error(`[prepublish-gate] FAILED CLOSED: ${selfCheck.reason}`);
  process.exit(1);
}

// The packages whose BUILT dists the gates drive (see the header).
// `iris-ops-mcp` carries no Epic 35 fix, but the Epic 37 default-outage gate
// (Story 37.1, AC 37.1.8) SPAWNS its built dist as a child process, so a stale
// ops dist would let that gate pass over code that is not what ships — the
// same reason every other entry is here.
const DRIVEN_PACKAGES = [
  ["shared", "@iris-mcp/shared"],
  ["iris-dev-mcp", "@iris-mcp/dev"],
  ["iris-admin-mcp", "@iris-mcp/admin"],
  ["iris-data-mcp", "@iris-mcp/data"],
  ["iris-interop-mcp", "@iris-mcp/interop"],
  ["iris-ops-mcp", "@iris-mcp/ops"],
];

for (const [dir, name] of DRIVEN_PACKAGES) {
  const check = checkDistFresh(path.join(repoRoot, "packages", dir), name);
  if (!check.ok) {
    console.error(`[prepublish-gate] FAILED CLOSED: ${check.reason}`);
    process.exit(1);
  }
  // Fail closed on the SKIPPED shape too (35.8 review, Blind B4): `skipped`
  // means the package's own package.json stopped declaring `files: ["dist"]` —
  // a manifest regression for a package whose dist the gate DRIVES. Logging
  // and proceeding would let a stale-but-present dist pass the gate.
  if (check.skipped) {
    console.error(
      `[prepublish-gate] FAILED CLOSED: ${name} declares no dist/ build output, ` +
        "but the Epic 35 defect gate drives its built dist. Restore " +
        '`files: ["dist"]` in that package\'s package.json — publishing must not ' +
        "proceed over an unverifiable build.",
    );
    process.exit(1);
  }
  console.log(`[prepublish-gate] ${name}'s dist/ is present and fresh.`);
}

// Every IRIS_REQUIRE_LIVE-ARMED live-IRIS gate file in THIS package belongs in
// this list (35.8 review, Edge E1 — precision: the membership rule is ARMED,
// not merely live). A file that uses the `beforeAll` probe + ctx.skip() shape
// without honoring IRIS_REQUIRE_LIVE gains nothing from being listed — it
// would skip even here (this package's *-process-gate.test.ts files are that
// shape today: live but unarmed); arming one means adding the REQUIRE_LIVE
// contract to the file AND listing it here (the standing instruction from
// `packages/iris-dev-mcp/scripts/prepublish-gate.mjs`, applied per-package).
const gateTestFiles = [
  "src/__tests__/epic35-defect-gate.test.ts",
  // Story 37.1 (AC 37.1.8): the Epic 37 default-profile-outage gate honors the
  // IRIS_REQUIRE_LIVE contract, so by the membership rule above it MUST be
  // listed here. Added by the 37.1 code review — the story shipped the
  // REQUIRE_LIVE contract in the file but not the roster entry, leaving the
  // arming env var set by nothing that runs it (Rule #59's named
  // disqualifier). It drives the BUILT iris-dev-mcp / iris-ops-mcp dists over
  // real stdio JSON-RPC, hence the ops entry in DRIVEN_PACKAGES above.
  "src/__tests__/epic37-default-outage-gate.test.ts",
  // Armed by the membership rule above: each refuses to skip under IRIS_REQUIRE_LIVE when the
  // built dists it reads are missing or stale (neither contacts IRIS; they use local stubs).
  "src/__tests__/story-38-0-qa-doc-claims.test.ts",
  "src/__tests__/story-38-0-qa-process.test.ts",
  // `iris_doc_edit` and the governance parent keys over real stdio JSON-RPC against the BUILT iris-dev-mcp dist:
  // writes only the disposable ExecuteMCPv2.Temp.QaStory384WireEdit.cls and ...WireStore.cls (persistent, compiled) documents.
  "src/__tests__/story-38-4-qa-doc-edit-wire-gate.test.ts",
  // `iris_sql_query`, `IRIS_SQL_READ_ONLY` and `IRIS_SQL_MAX_ROWS_AFFECTED` over real stdio JSON-RPC against the BUILT iris-dev-mcp dist:
  // writes only the disposable ExecuteMCPv2.Temp.QaStory385Wire.cls (persistent, compiled, six rows) and its data/marker globals.
  "src/__tests__/story-38-5-qa-sql-wire-gate.test.ts",
  // The Epic 38 capstone: ranged reads, guarded edits, the Storage guard and SQL safety over real stdio JSON-RPC against the BUILT iris-dev-mcp dist:
  // writes only the disposable ExecuteMCPv2.Temp.QaStory386CapEdit.cls and ...QaStory386CapRows.cls (persistent, compiled, six rows) and its table and globals.
  "src/__tests__/epic38-capstone-gate.test.ts",
  // Story 38.7 QA, DW-554: the governance document shape on the BUILT iris-dev-mcp dist against a local listener that records requests
  // (a rejected key stops startup before any request, valid documents and an unknown profile name still start); no IRIS instance is contacted.
  "src/__tests__/story-38-7-qa-governance-process.test.ts",
  // Story 38.7 QA, DW-533 and DW-528: `iris_production_manage` delete of a non-production class, the `modifiedSince` refusal, a no-range
  // `iris_doc_get` soft error and `ignoreConflict: false` over real stdio JSON-RPC against the BUILT iris-interop-mcp and iris-dev-mcp dists:
  // writes only the disposable ExecuteMCPv2.Temp.QaStory387WirePlain.cls (compiled), ...Draft.cls (never compiled) and ...Loaded.cls documents.
  "src/__tests__/story-38-7-qa-wire-gate.test.ts",
  // Story 39.1: `iris_message_search` `headers` and the `resendFiltered` wire over real stdio JSON-RPC against the BUILT iris-interop-mcp,
  // iris-dev-mcp and iris-admin-mcp dists, and raw HTTP to the route. Writes only the disposable namespaces and databases
  // EXECMCPTMP391A, EXECMCPTMP391B and EXECMCPTMP391C (their database files and directories too) and the HSCUSTOM class
  // ExecuteMCPv2.Temp.Story391Fixture, which it removes, asserting nothing is left.
  "src/__tests__/story-39-1-message-search-live-gate.test.ts",
  // Story 39.2: the PHI data policy over the `iris_message_resend` preview, `iris_server_profiles` and the audit log over real stdio JSON-RPC
  // against the BUILT iris-interop-mcp, iris-dev-mcp and iris-admin-mcp dists, raw HTTP to the preview and `resendFiltered` routes, and IRIS's
  // own HL7 parser as the oracle. Writes only the disposable namespace and database EXECMCPTMP392A (its database files and directory too), the
  // production Story392.Production started and stopped inside it, and the HSCUSTOM class ExecuteMCPv2.Temp.Story391Fixture, which it removes,
  // asserting nothing is left.
  "src/__tests__/story-39-2-data-policy-live-gate.test.ts",
  // Story 39.2: a bad data-policy setting fails the BUILT iris-interop-mcp dist's startup, and valid ones are reported, against a local
  // listener that records requests; no IRIS instance is contacted.
  "src/__tests__/story-39-2-data-policy-startup.test.ts",
  // Story 39.2 QA: the BUILT iris-interop-mcp dist against a local listener that records requests and replies as a hostile or version-skewed IRIS
  // (the wire body per policy, no body content in the result, the audit file or stderr, the four channels in order), and `redactHl7` of the BUILT
  // shared dist in a fresh Node process against the reviewed keep-list table; no IRIS instance is contacted.
  "src/__tests__/story-39-2-qa-process.test.ts",
  // Story 39.3: `iris_message_search` `body`, its data policy and audit rows over real stdio JSON-RPC against the BUILT iris-interop-mcp,
  // iris-dev-mcp and iris-admin-mcp dists, and the injection fuzz over raw HTTP to the route, with a hand-written JOIN as the oracle. Writes
  // only the disposable namespaces and databases EXECMCPTMP393A, EXECMCPTMP393B and EXECMCPTMP393C (their database files and directories
  // too, and the Story393 classes and ^Story393Side inside them) and the HSCUSTOM class ExecuteMCPv2.Temp.Story391Fixture, which it removes,
  // asserting nothing is left.
  "src/__tests__/story-39-3-body-search-live-gate.test.ts",
  // Story 39.3 QA: `iris_message_search` `body` on the BUILT iris-interop-mcp dist against a local listener that records requests and replies
  // as a padded or version-skewed IRIS (block sends no route request, the wire body of redact and allow, header rows only, the audit file
  // and the console log); no IRIS instance is contacted.
  "src/__tests__/story-39-3-qa-process.test.ts",
  // Story 39.3 QA: the value forms of date, time, timestamp and number properties, the three kinds of stream, and the statements the route
  // prepared (read back from INFORMATION_SCHEMA.STATEMENTS) over real stdio JSON-RPC against the BUILT iris-interop-mcp, iris-dev-mcp and
  // iris-admin-mcp dists and raw HTTP to the route. Writes only the disposable namespace and database EXECMCPTMP393Q (its database files and
  // directory too) and the HSCUSTOM class ExecuteMCPv2.Temp.Story391Fixture, which it removes, asserting nothing is left.
  "src/__tests__/story-39-3-qa-live-gate.test.ts",
  // Story 39.4: `iris_message_search` `searchTable`, its data policy and audit rows over real stdio JSON-RPC against the BUILT iris-interop-mcp,
  // iris-dev-mcp and iris-admin-mcp dists, the injection fuzz over raw HTTP to the route, and the plan of the statements the route prepared
  // (read back from INFORMATION_SCHEMA.STATEMENTS), with a hand-written IN / NOT IN oracle over the search table. Writes only the disposable
  // namespaces and databases EXECMCPTMP394A, EXECMCPTMP394B and EXECMCPTMP394C (their database files and directories too, and the Story393.Side
  // and Story394 classes and ^Story393Side inside them) and the HSCUSTOM class ExecuteMCPv2.Temp.Story391Fixture, which it removes, asserting
  // nothing is left.
  "src/__tests__/story-39-4-search-table-live-gate.test.ts",
  // Story 39.4 QA: `iris_message_search` `searchTable` on the BUILT iris-interop-mcp dist against a local listener that records requests and
  // replies as a padded or version-skewed IRIS (block sends no route request, the wire body of redact and allow with every scope filter and
  // the cursor, header rows only, both notApplicable answers, the audit file and the console log); no IRIS instance is contacted.
  "src/__tests__/story-39-4-qa-process.test.ts",
  // Story 39.4 QA: a lookup in HSCUSTOM (a real Interoperability namespace with no Search Table property, read-only: a row count and lookups
  // that read no message), filters that combine with AND on one multi-valued property, and every scope filter at once with paging, over real
  // stdio JSON-RPC against the BUILT iris-interop-mcp, iris-dev-mcp and iris-admin-mcp dists and raw HTTP to the route. Writes only the
  // disposable namespace and database EXECMCPTMP394Q (its database files and directory too, and the Story394 classes inside it) and the
  // HSCUSTOM class ExecuteMCPv2.Temp.Story391Fixture, which it removes, asserting nothing is left.
  "src/__tests__/story-39-4-qa-live-gate.test.ts",
  // Story 39.5: `iris_message_body`, its data policy, the wire per policy (read back through a recording proxy), the audit file and the console
  // log over real stdio JSON-RPC against the BUILT iris-interop-mcp, iris-dev-mcp and iris-admin-mcp dists, raw HTTP to the route, the DW-577
  // size precheck against the length IRIS serializes, and IRIS's own HL7 parser as the oracle. Writes only the disposable namespaces and
  // databases EXECMCPTMP395A, EXECMCPTMP395B and EXECMCPTMP395C (their database files and directories too, and the Story395 classes inside
  // them; EXECMCPTMP395P, the Task 0 probe namespace, is only removed by name) and the HSCUSTOM class ExecuteMCPv2.Temp.Story391Fixture,
  // which it removes, asserting nothing is left. No production is started.
  "src/__tests__/story-39-5-body-reader-live-gate.test.ts",
  // Story 39.5 QA: `iris_message_body` on the BUILT iris-interop-mcp dist against a local listener that records requests and replies as a hostile or
  // version-skewed IRIS (the wire of redact, allow and block, a caller that cannot widen the read, a text and an extra field for every kind of
  // body, the bounds of the input, the cut at every maxChars, the HL7 v2 shapes a hostile IRIS could send, the audit file and the console log);
  // no IRIS instance is contacted.
  "src/__tests__/story-39-5-qa-process.test.ts",
  // Story 39.5 QA: the HL7 v2 shapes IRIS stores (a BOM, LF and CRLF ends, a split line, escapes, other separators, control characters, a batch,
  // non-ASCII values), the 65536-character read limit exactly, the stream reader around its length, astral text and IRIS's own cut inside a
  // surrogate pair, bodies whose class throws, 20 headers of the largest body, and the odd forms of the route's inputs, over real stdio JSON-RPC
  // against the BUILT iris-interop-mcp, iris-dev-mcp and iris-admin-mcp dists and raw HTTP to the route. Writes only the disposable namespace and
  // database EXECMCPTMP395Q (its database files and directory too, and the Story395Q classes inside it) and the HSCUSTOM class
  // ExecuteMCPv2.Temp.Story391Fixture, which it removes, asserting nothing is left.
  "src/__tests__/story-39-5-qa-live-gate.test.ts",
  // The Epic 39 capstone: search, then read, under the PHI data policy over real stdio JSON-RPC against the BUILT iris-dev-mcp, iris-admin-mcp and iris-interop-mcp dists;
  // writes only EXECMCPTMP396A (its database files too), Story396.* and Story394.SearchTable inside it, and ExecuteMCPv2.Temp.Story391Fixture, which it removes.
  "src/__tests__/epic39-capstone-gate.test.ts",
  // Story 39.7: the Epic 39 burn-down on the BUILT iris-dev-mcp, iris-admin-mcp and iris-interop-mcp dists over real stdio JSON-RPC.
  // Writes EXECMCPTMP397A (its database files too), Story397.* inside it, and ExecuteMCPv2.Temp.Story391Fixture, which it removes.
  "src/__tests__/story-39-7-burn-down-live-gate.test.ts",
  // Story 39.7 QA: DW-569 (a 400, 404 or 500 with an empty error list is isError, a 2xx answer is unchanged, `iris_macro_info` keeps its empty result for
  // no document) on the BUILT dev, admin, ops, data and interop dists, and DW-576 (`iris_production_logs` and `iris_message_diagram` under redact, allow and
  // block: the result, a failed read, the audit file and the console log) on the BUILT interop dist, against a local listener that answers the startup
  // handshake and records requests; no IRIS instance is contacted.
  "src/__tests__/story-39-7-qa-process.test.ts",
  // Story 40.0: the Epic 39 deferred cleanup (the interop metrics counts, the Event Log type filter) on the BUILT iris-dev-mcp, iris-admin-mcp, iris-interop-mcp and iris-ops-mcp dists over real stdio JSON-RPC.
  // Writes EXECMCPTMP400A and EXECMCPTMP400B (their database files too), Story400.* inside A, and ExecuteMCPv2.Temp.Story391Fixture, which it removes.
  "src/__tests__/story-40-0-burn-down-live-gate.test.ts",
  // Story 40.0 QA: the 24-hour window boundary of iris_metrics_interop (2 minutes inside and outside), the edge values of the iris_production_logs type and count
  // filters over raw HTTP against hand-written SQL, a mapped namespace with no rows, and the trace-message-flow prompt through the spawned iris-interop-mcp entry,
  // on the BUILT dev, admin, interop and ops dists over real stdio JSON-RPC. Writes EXECMCPTMP400Q and EXECMCPTMP400R (their database files too), Story400.* and
  // Story40Q.* inside Q, and ExecuteMCPv2.Temp.Story391Fixture, which it removes.
  "src/__tests__/story-40-0-qa-live-gate.test.ts",
  // Story 40.1: `iris_test_coverage` and the `iris_test_status` `coverageRunId` companion on the BUILT iris-dev-mcp and iris-admin-mcp dists over real stdio JSON-RPC, with raw HTTP to the
  // coverage routes. It, the QA gate below and the two Story 40.2 gates (which follow them) are the only gates that start Line-by-Line sessions (the files run serially): it starts each row with the monitor idle and ends each row asserting it is idle, and
  // terminates a process only through the fixture's MayTerminate check. Writes EXECMCPTMP401A and EXECMCPTMP401B (their database files too), Story401.* inside A, and
  // ExecuteMCPv2.Temp.Story391Fixture, which it removes.
  "src/__tests__/story-40-1-coverage-live-gate.test.ts",
  // Story 40.1 QA: iris_test_coverage on SEVERAL BUILT iris-dev-mcp server processes over real stdio JSON-RPC (default, core and developer presets; the documented
  // IRIS_GOVERNANCE recipe alone; a run re-read by a second process and after the starting process ended; MONITOR_BUSY from another process), every input edge of the
  // tool and of the iris_test_status coverageRunId companion, and a second namespace. Starts Line-by-Line sessions only through the tool, starts each row with the monitor
  // idle and ends each row asserting it is idle, and terminates no process. Writes EXECMCPTMP40S and EXECMCPTMP40T (their database files too), Story401.* and
  // Story401Q.* inside them, and ExecuteMCPv2.Temp.Story391Fixture, which it removes.
  "src/__tests__/story-40-1-qa-live-gate.test.ts",
  // Story 40.2: the class-source coverage summary, `minCoverage` and its verdict, the `iris_test_status` `export` action (the Cobertura file, checked against the pinned DTD's content model) and
  // the loaded-routines check of a run, on the BUILT iris-dev-mcp and iris-admin-mcp dists over real stdio JSON-RPC, with raw HTTP to the coverage routes and raw Atelier reads of the class
  // documents. It follows the two 40.1 gates as the third that starts Line-by-Line sessions (the files run serially), starts each row with the monitor idle and ends each row asserting it is idle
  // with no ownership node, and terminates no process. Writes EXECMCPTMP402A (its database files too), Story402.* inside it, a temporary directory, one synthetic run record and
  // ExecuteMCPv2.Temp.Story391Fixture, which it removes.
  "src/__tests__/story-40-2-coverage-reports-live-gate.test.ts",
  // Story 40.2 QA: the class-source mapping against fixtures the first 40.2 gate did not use (a multi-line expression method, `_` continuation, macros, a cursor, an object generator, Try/Catch, a persistent class and a
  // call-mode method; a preprocessor line before a method's first statement and a multi-line embedded SQL statement are pinned as known defects), `minCoverage` at its edges (0, 100, a class at exactly the minimum, one ulp above it,
  // values between a class's unrounded and displayed percent), the `iris_test_status` `export` on the real file system (accepted and refused path forms, a parent that is a file, a symlinked parent, a symlink as the target, a
  // read-only file and directory, and a refused export leaving an existing file as it was), the Cobertura file read back by an independent reader, and a second namespace, on the BUILT iris-dev-mcp and iris-admin-mcp dists over
  // real stdio JSON-RPC. It is the fourth gate that starts Line-by-Line sessions (the files run serially), starts each row with the monitor idle and ends each row asserting it is idle with no ownership node, and terminates no
  // process. Writes EXECMCPTMP40U and EXECMCPTMP40V (their database files too), Story402.Qa* inside them, a temporary directory and ExecuteMCPv2.Temp.Story391Fixture, which it removes.
  "src/__tests__/story-40-2-qa-live-gate.test.ts",
];

// `--no-file-parallelism`: the 38.4, 38.5 and capstone gates each spawn a built dev server whose startup
// bootstrap redeploys and compiles the ExecuteMCPv2 classes on ONE shared IRIS instance whenever the
// deployed version differs from the shipped one. Run in parallel (vitest's default), one gate's version
// check or legs can overlap another gate's redeploy, and the gate fails on that interleaving rather than on
// a defect. Sequential file execution lets each file's bootstrap finish before the next file starts.
const vitestArgs = ["exec", "vitest", "run", "--no-file-parallelism", ...gateTestFiles];

const env = { ...process.env, IRIS_REQUIRE_LIVE: "1" };

console.log(
  `[prepublish-gate] Running ${gateTestFiles.length} live-IRIS gate file(s) with ` +
    "IRIS_REQUIRE_LIVE=1 — this MUST fail closed (non-zero exit) if IRIS is " +
    "unreachable, ExecuteMCPv2 is not deployed, or the Story 35.1 fixtures are " +
    `not loaded:\n  - ${gateTestFiles.join("\n  - ")}`,
);

const result =
  process.platform === "win32"
    ? spawnSync("cmd.exe", ["/d", "/s", "/c", "pnpm", ...vitestArgs], {
        cwd: packageDir,
        stdio: "inherit",
        env,
      })
    : spawnSync("pnpm", vitestArgs, {
        cwd: packageDir,
        stdio: "inherit",
        env,
      });

if (result.error) {
  console.error("[prepublish-gate] Failed to spawn the gate:", result.error);
  process.exit(1);
}

if (result.status !== 0) {
  console.error(
    "[prepublish-gate] FAILED CLOSED: a live-IRIS gate did not pass with IRIS_REQUIRE_LIVE=1. " +
      "Publishing must not proceed. Point IRIS_HOST/IRIS_PORT/IRIS_USERNAME/IRIS_PASSWORD at a " +
      "reachable IRIS instance with src/ExecuteMCPv2/ (including src/ExecuteMCPv2/Tests/) loaded, then retry.",
  );
}

process.exit(result.status ?? 1);
