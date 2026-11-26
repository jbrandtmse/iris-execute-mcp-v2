/**
 * Story 45.3 -- the round trip of the careful uninstall (`ExecuteMCPv2.Setup.Uninstall()`), run against a THROWAWAY IRIS
 * for Health container: install through the built `iris-dev-mcp` (the real bootstrap), run the documented one-liner in an IRIS
 * terminal (`scripts/throwaway-iris.mjs session`), and prove the instance is back to the state it had before the install.
 *
 * ARMING. The gate runs only inside `scripts/throwaway-iris.mjs exec --state <file>` with `THROWAWAY_STATE_FILE=<file>` in the
 * environment (the CI suite `uninstall-round-trip`; locally: `up`, `exec`, `down`). It skips, before any probe, spawn or request,
 * unless both `IRIS_THROWAWAY` (set by `exec`) and `THROWAWAY_STATE_FILE` are set; a skipped armed CI run fails, because the suite
 * allows no skip (Rule #59). The uninstall is destructive: this file never runs against the shared development instance (the harness refuses its port and container name),
 * and it refuses any target that already holds ExecuteMCPv2 classes, a web application, `%ALL` or an install record.
 *
 * ORACLES. The snapshot is read in a `%SYS` terminal session, independently of the code under test: whether the web application
 * exists, whether `%ALL` exists, its mappings read with the three `Config.Map*:List` class queries (the SQL projections return the
 * package mapping under all three), and, for `USER` and `HSCUSTOM`, the `ExecuteMCPv2` classes the namespace holds itself,
 * `^UnitTestRoot` and the install record `^ExecuteMCPv2.InstallRecord`. Each leg is self-contained: it seeds its own state, runs the
 * uninstall, asserts the report lines and the end state, and `afterEach` puts the instance back to the baseline and asserts that it
 * is the baseline.
 *
 * LEGS. plain round trip (with the extra `ConfigureMapping` call an IPM reinstall makes, and a second run), foreign `%ALL`, a
 * foreign mapping added after the install, an `ExecuteMCPv2` mapping that existed before it, `^UnitTestRoot` preset, `^UnitTestRoot` changed, no record (an install by 1.2.0),
 * an install by 1.2.0 upgraded in place by IPM (the Configure phase runs in a transaction with no web request, so `%ALL` is recorded as found),
 * `^UnitTestRoot` in a namespace with no record of its own while another holds one (Story 45.6, DW-780), the web-route refusal of
 * the two configuration calls (DW-786, whose teardown re-activates the namespace table), the upgrade and self-heal bootstraps
 * through the guard (DW-786), the bootstrap into a namespace without interoperability (DW-787), two
 * namespaces with a shadowed copy, a `dev`-marked copy in a second namespace (ownership), a dev Setup over a recorded install and a
 * marker-less copy over a recorded install (ownership), IPM-owned (the guard stub) with a second
 * run, a failing step (a namespace whose only database is dismounted), a failing `^UnitTestRoot` step (a database mounted read-only) that
 * leaves the classes for a re-run which then finishes, the SQL path (`SELECT ExecuteMCPv2.Setup_Uninstall()` through the
 * built server's `iris_sql_query` fails and removes nothing), an account without `%Admin_Manage`, the return values of the five install
 * methods through the SQL route (AC 45.3.8), and a failing install step that writes no record node (AC 45.3.2).
 */

import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { atelierDocument, irisTargetFromEnv, resolveSdkEsmDir, skipTest, staleDistReason, type IrisTarget } from "./process-gate-helpers.js";
import {
  assertNoExecuteMcpClasses,
  loadEmbedded,
  replaceMarker,
  runServer,
  runServerCalls,
  seedInstance,
  snapshotInstance,
  stampedEmbedded,
  throwawayGatePlan,
  type EmbeddedBootstrap,
} from "./bootstrap-guard-legs.js";
import { LOOPBACK_HOST, assertThrowawayInspect, validateContainerName, validateHostPort } from "../../../../scripts/throwaway-iris.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// packages/iris-mcp-all/src/__tests__/ -> repo root is 4 levels up.
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..", "..");
const HARNESS = path.join(REPO_ROOT, "scripts", "throwaway-iris.mjs");

const GATE_TAG = "story-45-3-uninstall-round-trip-live-gate";
const LEG_TIMEOUT_MS = 600_000;
const SETUP_TIMEOUT_MS = 300_000;

const PLAN = throwawayGatePlan(process.env);
const STATE_FILE = process.env["THROWAWAY_STATE_FILE"] ?? "";
const SKIP_REASON: string | undefined = !PLAN.run
  ? PLAN.reason
  : STATE_FILE === ""
    ? "THROWAWAY_STATE_FILE is not set: this gate drives the terminal through `throwaway-iris.mjs session --state`, so it needs the state file of the container `up` started (CI suite uninstall-round-trip)."
    : undefined;

/** The two namespaces the snapshot reads. */
const NAMESPACES = ["USER", "HSCUSTOM"] as const;
const WEBAPP = "/api/executemcp/v2";
const WEBAPP_LINE = `Removed: web application ${WEBAPP}`;
const MAPPING_LINE = "Removed: package mapping ExecuteMCPv2 in %ALL";
const SERVER_LINE =
  "A server with the automatic install on puts the IRIS side back the next time it starts or first uses this instance: stop it, or set IRIS_AUTO_INSTALL=false (or remove it from the client configuration) before removing the IRIS side.";
const NAMESPACES_LINE_START = "Namespaces USER, HSCUSTOM used the suite: the instance has one web application and one %ALL mapping, so none of them has either now;";
const ALL_MANUAL =
  'in %SYS: Do ##class(Config.Namespaces).Delete("%ALL"). This deletes %ALL together with every mapping in it, so check what else is mapped there first';
/** Story 45.6 (DW-780): the reason of a `%ALL` that every record says the install found, with its manual command (`ALL_MANUAL`). */
const ALL_FOUND_REASON = "the install found it already there; an install by 1.2.0 or earlier that created it writes no record";
/** The README's one-line check that the uninstall finished in a namespace (decision #168): it prints `record=0 webapp=0` when nothing is left. */
const DONE_CHECK =
  'Set ns=$NAMESPACE Write "record=",$Data(^ExecuteMCPv2.InstallRecord) Set $NAMESPACE="%SYS" Write " webapp=",##class(Security.Applications).Exists("/api/executemcp/v2"),! Set $NAMESPACE=ns';
const HELD_REASON = "an earlier step failed, so the classes stay and the command can run again once it is fixed";
const RECORDS_KEPT_LINE = "Left: install records (a step failed, so the records stay and the command can run again)";
const SCRATCH_DB_DIR = "/usr/irissys/mgr/uninstalltestdb/";
/** A namespace UNINSTALLNS over a database UNINSTALLDB of its own (the reset removes both). */
const SCRATCH_NAMESPACE_SCRIPT: readonly string[] = [
  'Set $NAMESPACE="%SYS"',
  `Set dir="${SCRATCH_DB_DIR}"`,
  "Set mk=##class(%File).CreateDirectoryChain(dir)",
  "Set sc=##class(SYS.Database).CreateDatabase(dir,1)",
  'Kill p Set p("Directory")=dir',
  'Set sc=##class(Config.Databases).Create("UNINSTALLDB",.p)',
  'Kill p Set p("Globals")="UNINSTALLDB",p("Routines")="UNINSTALLDB"',
  'Set sc=##class(Config.Namespaces).Create("UNINSTALLNS",.p)',
];

/** The state of the instance, as `key -> value` lines of the snapshot script. */
type State = Record<string, string>;

let target: IrisTarget;
let sdkEsmDir: string;
let embedded: EmbeddedBootstrap;
let scratch: string | undefined;
let scriptCounter = 0;
let baseline: State = {};

// -- The terminal ---------------------------------------------------------------------------------

/** Run ObjectScript lines in an IRIS terminal session of the throwaway (namespace `ns`) and return what it printed. */
function terminal(ns: string, lines: readonly string[]): string {
  scriptCounter += 1;
  if (scratch === undefined) scratch = mkdtempSync(path.join(tmpdir(), "story-45-3-"));
  const file = path.join(scratch, `terminal-${scriptCounter}.script`);
  writeFileSync(file, `${lines.join("\n")}\nhalt\n`);
  const ran = spawnSync("node", [HARNESS, "session", "--state", STATE_FILE, "--namespace", ns, "--script", file], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    timeout: 300_000,
    maxBuffer: 16 * 1024 * 1024,
  });
  if (ran.status !== 0) {
    throw new Error(`the terminal session in ${ns} exited ${ran.status}: ${ran.stderr.trim()} ${ran.stdout.slice(-400)}`);
  }
  return ran.stdout;
}

/** The output lines of a terminal run, without the prompts and the blank lines. */
function outputLines(output: string): string[] {
  return output
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter((line) => line !== "" && !/^[%A-Za-z0-9]*>$/.test(line));
}

/** The lines printed between `<<<tag` and `>>>tag`. */
function between(output: string, tag: string): string[] {
  const lines = outputLines(output);
  const start = lines.indexOf(`<<<${tag}`);
  const end = lines.indexOf(`>>>${tag}`);
  if (start < 0 || end < start) throw new Error(`the terminal output has no ${tag} block:\n${output.slice(-1500)}`);
  return lines.slice(start + 1, end);
}

const SNAPSHOT_SCRIPT: readonly string[] = [
  'Set $NAMESPACE="%SYS"',
  'Write "<<<SNAP",!',
  'Write "SNAP webapp=",##class(Security.Applications).Exists("/api/executemcp/v2"),!',
  'Write "SNAP %ALL=",##class(Config.Namespaces).Exists("%ALL"),!',
  'For tk="Config.MapPackages:List","Config.MapGlobals:List","Config.MapRoutines:List" { Set rs=##class(%ResultSet).%New(tk) Set sc=rs.Execute("%ALL") Set n=0,s="" While rs.Next() { Set n=n+1,s=s_rs.GetData(2)_";" } Write "SNAP map ",tk,"=",n," ",s,! }',
  `For tn=${NAMESPACES.map((ns) => `"${ns}"`).join(",")} { Set $NAMESPACE=tn Kill ti Do $System.OBJ.GetPackageList(.ti,"ExecuteMCPv2","/includesubpackages") Set n=0,k="",s="" For { Set k=$Order(ti(k)) Quit:k=""  Set n=n+1,s=s_k_"," } Write "SNAP classes ",tn,"=",n," ",s,! Write "SNAP utr ",tn,"=",$Get(^UnitTestRoot,"<undefined>"),! Set rk="",s="" For { Set rk=$Order(^ExecuteMCPv2.InstallRecord(rk)) Quit:rk=""  Set s=s_rk_"="_$Get(^ExecuteMCPv2.InstallRecord(rk))_";" } Write "SNAP record ",tn,"=",$Data(^ExecuteMCPv2.InstallRecord)," ",s,"database=",$Get(^ExecuteMCPv2.InstallRecord("mapping","database")),! }`,
  'Set $NAMESPACE="%SYS"',
  // What the legs make besides the IRIS side: the gate accounts and roles, the scratch namespace and its database (1 = it exists).
  'Write "SNAP extras=",##class(Security.Users).Exists("uninstalllp1"),##class(Security.Users).Exists("uninstalllp2"),##class(Security.Roles).Exists("uninstalllprole1"),##class(Security.Roles).Exists("uninstalllprole2"),##class(Config.Namespaces).Exists("UNINSTALLNS"),##class(Config.Databases).Exists("UNINSTALLDB"),!',
  'Write ">>>SNAP",!',
];

/** The state of the instance. */
function snapshot(): State {
  const state: State = {};
  for (const line of between(terminal("%SYS", SNAPSHOT_SCRIPT), "SNAP")) {
    const match = /^SNAP (.+?)=(.*)$/.exec(line);
    if (match === null) throw new Error(`unreadable snapshot line: ${line}`);
    state[match[1] as string] = match[2] as string;
  }
  return state;
}

/** What differs between two states, one sentence each; empty when equal. */
function differences(expected: State, actual: State): string[] {
  const keys = [...new Set([...Object.keys(expected), ...Object.keys(actual)])].sort();
  return keys.filter((key) => expected[key] !== actual[key]).map((key) => `${key}: expected ${JSON.stringify(expected[key])}, got ${JSON.stringify(actual[key])}`);
}

/** The baseline with `changes` applied: the expected state of a leg that leaves something behind on purpose. */
function baselinePlus(changes: State): State {
  return { ...baseline, ...changes };
}

// -- The uninstall -------------------------------------------------------------------------------

interface UninstallRun {
  /** The report lines the terminal printed (the entries, the namespaces line, the server line). */
  lines: string[];
  /** The returned status, when the run captured it. */
  statusOk?: boolean;
  statusText?: string;
  /** The report object as JSON, when the run captured it. */
  report?: { removed: Array<Record<string, string>>; left: Array<Record<string, string>>; failed: Array<Record<string, string>>; namespaces: string[] };
  raw: string;
}

/** The report lines among the lines a terminal printed. */
function reportLines(lines: readonly string[]): string[] {
  return lines.filter((line) => /^(Removed|Left|Failed): |^Namespaces .* used the suite: |^Nothing was removed: |^A server with the automatic install /.test(line));
}

/** The documented one-liner, exactly as the README gives it, run in `ns` as the instance's superuser. */
function runOneLiner(ns = "USER"): UninstallRun {
  const output = terminal(ns, ['Write "<<<RUN",!', "Do ##class(ExecuteMCPv2.Setup).Uninstall()", 'Write ">>>RUN",!']);
  return { lines: reportLines(between(output, "RUN")), raw: output };
}

/** The uninstall with its status and report object captured, run in `ns` (as `login` when given). */
function runUninstall(ns = "USER", login?: { user: string; password: string }): UninstallRun {
  const output = terminal(ns, [
    ...(login === undefined ? [] : [`Set ok=$System.Security.Login("${login.user}","${login.password}")`, 'Write "LOGIN-AS=",$Username,!']),
    'Write "<<<RUN",!',
    "Set tSC=##class(ExecuteMCPv2.Setup).Uninstall(1,.rep)",
    'Write ">>>RUN",!',
    'Write "STATUS-OK=",$System.Status.IsOK(tSC),!',
    'Write "STATUS-TEXT=",$System.Status.GetErrorText(tSC),!',
    'Write "REPORT=",rep.%ToJSON(),!',
  ]);
  const all = outputLines(output);
  const field = (name: string): string => (all.find((line) => line.startsWith(`${name}=`)) ?? "").slice(name.length + 1);
  if (login !== undefined && field("LOGIN-AS") !== login.user) throw new Error(`the terminal did not log in as ${login.user}: ${output.slice(-600)}`);
  return {
    lines: reportLines(between(output, "RUN")),
    statusOk: field("STATUS-OK") === "1",
    statusText: field("STATUS-TEXT"),
    report: JSON.parse(field("REPORT")) as UninstallRun["report"],
    raw: output,
  };
}

// -- Seeding and cleaning -----------------------------------------------------------------------------

/** Install through the built `iris-dev-mcp`: the real bootstrap, with the automatic install on. */
async function install(namespace = "USER"): Promise<void> {
  await runServer("startup", { repoRoot: REPO_ROOT, sdkEsmDir, target: { ...target, namespace } });
}

/** Every user, role, namespace and database a leg makes, and every ExecuteMCPv2 piece, removed (best effort; the baseline check follows). */
const RESET_SCRIPT: readonly string[] = [
  'Set $NAMESPACE="%SYS"',
  `Set sc=##class(Security.Applications).Delete("${WEBAPP}")`,
  'Set sc=##class(Config.MapPackages).Delete("%ALL","ExecuteMCPv2")',
  'Set sc=##class(Config.Namespaces).Delete("%ALL")',
  'Set sc=##class(Security.Users).Delete("uninstalllp1")',
  'Set sc=##class(Security.Users).Delete("uninstalllp2")',
  'Set sc=##class(Security.Roles).Delete("uninstalllprole1")',
  'Set sc=##class(Security.Roles).Delete("uninstalllprole2")',
  'Set dir="/usr/irissys/mgr/uninstalltestdb/"',
  "Set sc=##class(SYS.Database).MountDatabase(dir)",
  'Set sc=##class(Config.Namespaces).Delete("UNINSTALLNS")',
  'Set sc=##class(Config.Databases).Delete("UNINSTALLDB")',
  "Set sc=##class(SYS.Database).DismountDatabase(dir)",
  "Set rm=##class(%File).RemoveDirectoryTree(dir)",
  `For tn=${NAMESPACES.map((ns) => `"${ns}"`).join(",")} { Set $NAMESPACE=tn Set sc=$System.OBJ.DeletePackage("ExecuteMCPv2","-d") Kill ^UnitTestRoot Kill ^ExecuteMCPv2.InstallRecord }`,
  'Set $NAMESPACE="%SYS"',
];

function reset(): void {
  terminal("%SYS", RESET_SCRIPT);
}

/** One raw Atelier request to the throwaway, in namespace `ns`. */
async function atelier(ns: string, method: "PUT" | "POST" | "DELETE", subpath: string, body?: unknown): Promise<{ status: number; text: string }> {
  const response = await fetch(`http://${target.host}:${target.port}/api/atelier/v8/${ns}/${subpath}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      Authorization: `Basic ${Buffer.from(`${target.username}:${target.password}`).toString("base64")}`,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(300_000),
  });
  return { status: response.status, text: await response.text() };
}

/** Store and compile one class document in `ns`. */
async function putClass(ns: string, name: string, text: string): Promise<void> {
  const stored = await atelier(ns, "PUT", `doc/${encodeURIComponent(name)}?ignoreConflict=1`, { enc: false, content: text.split("\n") });
  if (stored.status !== 200 && stored.status !== 201) throw new Error(`storing ${name} in ${ns}: HTTP ${stored.status} ${stored.text.slice(0, 300)}`);
  const compiled = await atelier(ns, "POST", "action/compile", [name]);
  if (compiled.status !== 200) throw new Error(`compiling ${name} in ${ns}: HTTP ${compiled.status} ${compiled.text.slice(0, 300)}`);
}

/** The value of the one column `V` of the one row an Atelier SQL query returns (the route the bootstrap reads the install methods through). */
async function sqlValue(query: string, parameters: unknown[] = []): Promise<unknown> {
  const response = await atelier("USER", "POST", "action/query", { query, parameters });
  expect(response.status, response.text).toBe(200);
  const body = JSON.parse(response.text) as { status?: { errors?: unknown[] }; result?: { content?: Array<Record<string, unknown>> } };
  expect(body.status?.errors ?? [], `${query} raised: ${response.text.slice(0, 300)}`).toEqual([]);
  const row = body.result?.content?.[0];
  expect(row, `${query} returned a row`).toBeDefined();
  return (row as Record<string, unknown>)["V"];
}

beforeAll(async () => {
  if (SKIP_REASON !== undefined) return;
  target = irisTargetFromEnv();
  validateHostPort(target.port);
  if (target.host !== LOOPBACK_HOST) throw new Error(`the throwaway gate only targets ${LOOPBACK_HOST}, not ${target.host}.`);
  if (!PLAN.run) return;
  validateContainerName(PLAN.container);

  const stale = staleDistReason(REPO_ROOT, "shared") ?? staleDistReason(REPO_ROOT, "iris-dev-mcp");
  if (stale !== undefined) throw new Error(`The uninstall gate runs the built iris-dev-mcp and shared dists, and a stale dist fails it: ${stale}`);
  const found = resolveSdkEsmDir(REPO_ROOT);
  if (found === undefined) throw new Error("Could not resolve the @modelcontextprotocol/client ESM build under node_modules/.pnpm; run pnpm install from the repo root.");
  sdkEsmDir = found;

  const inspected = spawnSync("docker", ["inspect", PLAN.container], { encoding: "utf8", timeout: 30_000 });
  if (inspected.status !== 0) throw new Error(`docker inspect ${PLAN.container} failed: ${inspected.stderr.trim()}`);
  assertThrowawayInspect(JSON.parse(inspected.stdout) as unknown, { name: PLAN.container, port: target.port });
  await assertNoExecuteMcpClasses(target);

  embedded = await loadEmbedded(REPO_ROOT);
  baseline = snapshot();
  const dirty = Object.entries(baseline).filter(([key, value]) =>
    key === "webapp" || key === "%ALL" ? value !== "0" : key === "extras" ? value !== "000000" : /^(classes|record) /.test(key) ? !/^0\b/.test(value) : false,
  );
  if (dirty.length > 0) {
    throw new Error(`the instance is not a clean throwaway (it already holds part of the IRIS side): ${dirty.map(([key, value]) => `${key}=${value}`).join("; ")}`);
  }
}, SETUP_TIMEOUT_MS);

afterEach(async () => {
  if (SKIP_REASON !== undefined) return;
  // Each leg's cleanup runs whatever the leg did, and the baseline check proves that it left nothing behind.
  reset();
  expect(differences(baseline, snapshot()), "after the leg's cleanup the instance equals the baseline").toEqual([]);
}, SETUP_TIMEOUT_MS);

/** One leg's body, run only when armed. */
function leg(title: string, body: () => Promise<void>) {
  it(
    title,
    async (testCtx) => {
      if (SKIP_REASON !== undefined) {
        skipTest(GATE_TAG, SKIP_REASON, testCtx);
        return;
      }
      await body();
    },
    LEG_TIMEOUT_MS,
  );
}

const classesLine = (ns: string, count: number): string => `Removed: classes (${ns}): ${count} classes`;

describe("Story 45.3: the careful uninstall round trip on a throwaway IRIS for Health container", () => {
  leg("plain: install, the one-liner removes everything the install added (with the extra ConfigureMapping of an IPM reinstall), then the class is gone", async () => {
    await install();
    const installed = snapshot();
    expect(installed["webapp"], "the install registered the web application").toBe("1");
    expect(installed["%ALL"]).toBe("1");
    expect(installed["map Config.MapPackages:List"]).toMatch(/^1 ExecuteMCPv2;/);
    expect(installed["classes USER"]).toMatch(new RegExp(`^${embedded.classes.size} `));
    expect(installed["utr USER"], "the install set ^UnitTestRoot").not.toBe("<undefined>");
    expect(installed["record USER"], "the record: created %ALL, created mapping, the deployed marker, the value the install set").toContain("all=created;");
    expect(installed["record USER"]).toContain("mapping=created;");
    expect(installed["record USER"]).toContain(`deployed=${embedded.marker};`);
    expect(installed["record USER"]).toContain("database=USER");
    expect(installed["record USER"]).toContain(`unitTestRoot=${installed["utr USER"]};`);

    // The call an IPM reinstall makes through the SQL route: a repeated install never turns "created" into "found".
    const again = await atelier("USER", "POST", "action/query", { query: "SELECT ExecuteMCPv2.Setup_ConfigureMapping(?) AS MappingResult", parameters: ["USER"] });
    expect(again.status, again.text).toBe(200);
    const repeated = snapshot()["record USER"] as string;
    expect(repeated, "the record still says created").toContain("all=created;");
    expect(repeated, "the repeated install did not turn the mapping node into found either (its early-exit branch writes found)").toContain("mapping=created;");
    expect(repeated, "nor did it change the mapping's recorded database").toContain("database=USER");

    // Before the run the README's check finds the record and the web application.
    expect(between(terminal("USER", ['Write "<<<CHECK",!', DONE_CHECK, 'Write ">>>CHECK",!']), "CHECK"), "the check sees an install").toEqual(["record=10 webapp=1"]);

    const run = runOneLiner();
    expect(run.lines).toEqual([WEBAPP_LINE, MAPPING_LINE, "Removed: %ALL", "Removed: ^UnitTestRoot (USER)", classesLine("USER", embedded.classes.size), "Removed: install record (USER)", SERVER_LINE]);
    expect(differences(baseline, snapshot()), "the instance equals the state before the install").toEqual([]);

    // A second run: the class is gone, so the terminal cannot call it and nothing changes. (The idempotent, status-OK second run is the IPM-owned leg.)
    const second = terminal("USER", ["Do ##class(ExecuteMCPv2.Setup).Uninstall()"]);
    expect(second).toContain("CLASS DOES NOT EXIST");
    expect(differences(baseline, snapshot())).toEqual([]);
    // The README's one-line check confirms there is nothing left to do in the namespace, and leaves the terminal where it was.
    expect(between(terminal("USER", ['Write "<<<CHECK",!', DONE_CHECK, 'Write "NS=",$NAMESPACE,!', 'Write ">>>CHECK",!']), "CHECK")).toEqual(["record=0 webapp=0", "NS=USER"]);
  });

  leg("run from %SYS, which sees the class only through the %ALL mapping the command removes: the same result as in the install namespace", async () => {
    await install();
    const run = runOneLiner("%SYS");
    expect(run.lines).toEqual([WEBAPP_LINE, MAPPING_LINE, "Removed: %ALL", "Removed: ^UnitTestRoot (USER)", classesLine("USER", embedded.classes.size), "Removed: install record (USER)", SERVER_LINE]);
    expect(differences(baseline, snapshot())).toEqual([]);
  });

  leg("foreign %ALL: it existed with a foreign mapping before the install, so it and the mapping survive", async () => {
    terminal("%SYS", [
      'Set $NAMESPACE="%SYS"',
      'Kill p Set p("Globals")="%DEFAULTDB",p("Routines")="%DEFAULTDB",p("Library")="IRISLIB",p("TempGlobals")="IRISTEMP"',
      'Set sc=##class(Config.Namespaces).Create("%ALL",.p)',
      'Kill p Set p("Database")="USER"',
      'Set sc=##class(Config.MapGlobals).Create("%ALL","ForeignBefore",.p)',
    ]);
    await install();
    expect(snapshot()["record USER"]).toContain("all=found;");

    const run = runOneLiner();
    expect(run.lines).toEqual([
      WEBAPP_LINE,
      MAPPING_LINE,
      "Removed: ^UnitTestRoot (USER)",
      classesLine("USER", embedded.classes.size),
      "Removed: install record (USER)",
      `Left: %ALL (${ALL_FOUND_REASON}). To remove it by hand: ${ALL_MANUAL}`,
      SERVER_LINE,
    ]);
    const after = snapshot();
    expect(differences(baselinePlus({ "%ALL": "1", "map Config.MapGlobals:List": "1 ForeignBefore;" }), after), "%ALL and the foreign mapping survive, everything else is back").toEqual([]);
  });

  leg("foreign mapping added after the install: %ALL was created by the install but still holds a mapping, so it survives", async () => {
    await install();
    // One foreign mapping of each kind the check reads: the package, global and routine :List queries.
    terminal("%SYS", [
      'Set $NAMESPACE="%SYS"',
      'Kill p Set p("Database")="USER"',
      'Set sc=##class(Config.MapGlobals).Create("%ALL","ForeignAfter",.p)',
      'Set sc=##class(Config.MapRoutines).Create("%ALL","ForeignRtn",.p)',
      'Set sc=##class(Config.MapPackages).Create("%ALL","ForeignPkg",.p)',
    ]);
    expect(snapshot()["record USER"]).toContain("all=created;");

    const run = runOneLiner();
    expect(run.lines).toEqual([
      WEBAPP_LINE,
      MAPPING_LINE,
      "Removed: ^UnitTestRoot (USER)",
      classesLine("USER", embedded.classes.size),
      "Removed: install record (USER)",
      "Left: %ALL (it still holds mappings: package ForeignPkg, global ForeignAfter, routine ForeignRtn)",
      SERVER_LINE,
    ]);
    expect(
      differences(
        baselinePlus({ "%ALL": "1", "map Config.MapPackages:List": "1 ForeignPkg;", "map Config.MapGlobals:List": "1 ForeignAfter;", "map Config.MapRoutines:List": "1 ForeignRtn;" }),
        snapshot(),
      ),
    ).toEqual([]);
  });

  leg("an ExecuteMCPv2 mapping that existed before the install: the record says found, the mapping goes, %ALL survives", async () => {
    terminal("%SYS", [
      'Set $NAMESPACE="%SYS"',
      'Kill p Set p("Globals")="%DEFAULTDB",p("Routines")="%DEFAULTDB",p("Library")="IRISLIB",p("TempGlobals")="IRISTEMP"',
      'Set sc=##class(Config.Namespaces).Create("%ALL",.p)',
      'Kill p Set p("Database")="USER"',
      'Set sc=##class(Config.MapPackages).Create("%ALL","ExecuteMCPv2",.p)',
    ]);
    await install();
    const installed = snapshot()["record USER"] as string;
    expect(installed, "the early-exit branch of ConfigureMapping records what it found").toContain("all=found;");
    expect(installed).toContain("mapping=found;");
    expect(installed).toContain("database=USER");

    const run = runOneLiner();
    expect(run.lines).toEqual([
      WEBAPP_LINE,
      MAPPING_LINE,
      "Removed: ^UnitTestRoot (USER)",
      classesLine("USER", embedded.classes.size),
      "Removed: install record (USER)",
      `Left: %ALL (${ALL_FOUND_REASON}). To remove it by hand: ${ALL_MANUAL}`,
      SERVER_LINE,
    ]);
    expect(differences(baselinePlus({ "%ALL": "1" }), snapshot())).toEqual([]);
  });

  leg("^UnitTestRoot set before the install: the value survives and is not reported", async () => {
    terminal("USER", ['Set ^UnitTestRoot="/preset/before/the/install/"']);
    await install();
    expect(snapshot()["record USER"], "the install recorded no unitTestRoot node for a value it did not set").not.toContain("unitTestRoot=");

    const run = runOneLiner();
    expect(run.lines).toEqual([WEBAPP_LINE, MAPPING_LINE, "Removed: %ALL", classesLine("USER", embedded.classes.size), "Removed: install record (USER)", SERVER_LINE]);
    expect(differences(baselinePlus({ "utr USER": "/preset/before/the/install/" }), snapshot())).toEqual([]);
  });

  leg("^UnitTestRoot changed after the install: the value survives and is reported with its command", async () => {
    await install();
    terminal("USER", ['Set ^UnitTestRoot="/changed/after/the/install/"']);

    const run = runOneLiner();
    expect(run.lines).toEqual([
      WEBAPP_LINE,
      MAPPING_LINE,
      "Removed: %ALL",
      classesLine("USER", embedded.classes.size),
      "Removed: install record (USER)",
      "Left: ^UnitTestRoot (USER) (it changed since the install set it). To remove it by hand: in USER: Kill ^UnitTestRoot",
      SERVER_LINE,
    ]);
    expect(differences(baselinePlus({ "utr USER": "/changed/after/the/install/" }), snapshot())).toEqual([]);
  });

  leg("no record (an install by 1.2.0 or earlier): %ALL and ^UnitTestRoot are never removed, and the report gives the commands", async () => {
    await install();
    const installed = snapshot();
    terminal("USER", ["Kill ^ExecuteMCPv2.InstallRecord"]);

    const run = runOneLiner();
    expect(run.lines).toEqual([
      WEBAPP_LINE,
      MAPPING_LINE,
      classesLine("USER", embedded.classes.size),
      `Left: %ALL (no install record says the install created it (an install by 1.2.0 or earlier writes none)). To remove it by hand: ${ALL_MANUAL}`,
      "Left: ^UnitTestRoot (USER) (no install record says the install set it (an install by 1.2.0 or earlier writes none)). To remove it by hand: in USER: Kill ^UnitTestRoot",
      SERVER_LINE,
    ]);
    expect(differences(baselinePlus({ "%ALL": "1", "utr USER": installed["utr USER"] as string }), snapshot())).toEqual([]);
  });

  leg("a 1.2.0 install upgraded in place by IPM (DW-780): the Configure phase finds %ALL and the mapping, so %ALL is left with its command, the mapping goes, and the ^UnitTestRoot that 1.2.0 set is not reported", async () => {
    await install();
    const installed = snapshot();
    // 1.2.0 wrote no record: everything it created stays, and the record goes.
    terminal("USER", ["Kill ^ExecuteMCPv2.InstallRecord"]);
    expect(snapshot()["record USER"], "an install by 1.2.0 leaves no record").toMatch(/^0\b/);

    // The IPM Configure phase: Configure, then ConfigureMapping, inside a transaction and with no web request.
    const phase = outputLines(
      terminal("USER", [
        "TSTART",
        'Write "TLEVEL=",$TLevel,!',
        'Write "REQUEST=",$IsObject($Get(%request)),!',
        'Write "CONFIGURE-OK=",$System.Status.IsOK(##class(ExecuteMCPv2.Setup).Configure()),!',
        'Write "MAPPING-OK=",$System.Status.IsOK(##class(ExecuteMCPv2.Setup).ConfigureMapping()),!',
        "TCOMMIT",
      ]),
    );
    const phaseField = (name: string): string => (phase.find((line) => line.startsWith(`${name}=`)) ?? "").slice(name.length + 1);
    expect(phaseField("TLEVEL"), "the phase runs inside a transaction").toBe("1");
    expect(phaseField("REQUEST"), "and with no web request").toBe("0");
    expect(phaseField("CONFIGURE-OK"), "the guard lets Configure through").toBe("1");
    expect(phaseField("MAPPING-OK"), "the guard lets ConfigureMapping through").toBe("1");
    const upgraded = snapshot()["record USER"] as string;
    expect(upgraded, "%ALL was there already, so the record says found").toContain("all=found;");
    expect(upgraded).toContain("mapping=found;");
    expect(upgraded).toContain(`deployed=${embedded.marker};`);
    expect(upgraded, "no unitTestRoot node: the phase does not set the global").not.toContain("unitTestRoot=");

    const run = runOneLiner();
    expect(run.lines).toEqual([
      WEBAPP_LINE,
      MAPPING_LINE,
      classesLine("USER", embedded.classes.size),
      "Removed: install record (USER)",
      `Left: %ALL (${ALL_FOUND_REASON}). To remove it by hand: ${ALL_MANUAL}`,
      SERVER_LINE,
    ]);
    expect(differences(baselinePlus({ "%ALL": "1", "utr USER": installed["utr USER"] as string }), snapshot()), "%ALL and the value 1.2.0 set survive, everything else is back").toEqual([]);
  });

  leg("^UnitTestRoot in a namespace with no record of its own, while another namespace holds one (DW-780): the value survives and is reported with its command", async () => {
    await install("USER");
    terminal("HSCUSTOM", ['Set ^UnitTestRoot="/set/by/someone/else/in/hscustom/"']);
    const installed = snapshot();
    expect(installed["record USER"], "USER holds the install's record").toContain("all=created;");
    expect(installed["record HSCUSTOM"], "HSCUSTOM holds no record").toMatch(/^0\b/);

    const run = runOneLiner("USER");
    expect(run.lines).toEqual([
      WEBAPP_LINE,
      MAPPING_LINE,
      "Removed: %ALL",
      "Removed: ^UnitTestRoot (USER)",
      classesLine("USER", embedded.classes.size),
      "Removed: install record (USER)",
      "Left: ^UnitTestRoot (HSCUSTOM) (no install record in HSCUSTOM says the install set it (an install by 1.2.0 or earlier writes none)). To remove it by hand: in HSCUSTOM: Kill ^UnitTestRoot",
      SERVER_LINE,
    ]);
    expect(differences(baselinePlus({ "utr HSCUSTOM": "/set/by/someone/else/in/hscustom/" }), snapshot())).toEqual([]);
  });

  leg("two namespaces with a shadowed copy: both lose the web application, the mapping and their classes, and the report names both with their outcome", async () => {
    await install("USER");
    // Probe P2: the mapping goes, a probe class lands in USER (a shadowed copy), and a second install deploys to HSCUSTOM.
    terminal("%SYS", ['Set sc=##class(Config.MapPackages).Delete("%ALL","ExecuteMCPv2")']);
    terminal("USER", [
      'Set c=##class(%Dictionary.ClassDefinition).%New("ExecuteMCPv2.Temp.ShadowProbe") Set c.Super="%RegisteredObject" Set sc=c.%Save()',
      'Set sc=$System.OBJ.Compile("ExecuteMCPv2.Temp.ShadowProbe","ck-d")',
    ]);
    await install("HSCUSTOM");
    const installed = snapshot();
    // The mapping now points at HSCUSTOM, so both namespaces see HSCUSTOM's 35 classes; USER's own 36 are shadowed behind it (probe P2).
    expect(installed["classes USER"]).toMatch(new RegExp(`^${embedded.classes.size} `));
    expect(installed["classes HSCUSTOM"]).toMatch(new RegExp(`^${embedded.classes.size} `));
    expect(installed["map Config.MapPackages:List"]).toMatch(/^1 ExecuteMCPv2;/);

    const run = runOneLiner("USER");
    expect(run.lines).toEqual([
      WEBAPP_LINE,
      MAPPING_LINE,
      "Removed: %ALL",
      "Removed: ^UnitTestRoot (HSCUSTOM)",
      "Removed: ^UnitTestRoot (USER)",
      // Entries follow the order of the namespace list; the current namespace's own classes go last, because its copy is the one running.
      classesLine("HSCUSTOM", embedded.classes.size),
      classesLine("USER", embedded.classes.size + 1),
      "Removed: install record (HSCUSTOM)",
      "Removed: install record (USER)",
      `${NAMESPACES_LINE_START} USER lost its classes; HSCUSTOM lost its classes.`,
      SERVER_LINE,
    ]);
    expect(differences(baseline, snapshot()), "both namespaces end with no ExecuteMCPv2 class").toEqual([]);
  });

  leg("ownership: a dev-marked copy in a second namespace is left byte for byte untouched, and the report names it with the manual command", async () => {
    await install("USER");
    // A write into a mapped package follows the mapping, so the dev copy goes in while the mapping is out, and the mapping is put back.
    terminal("%SYS", ['Set sc=##class(Config.MapPackages).Delete("%ALL","ExecuteMCPv2")']);
    const devSetup = replaceMarker(embedded.classes.get("ExecuteMCPv2.Setup.cls") as string, "dev");
    const devNames = ["ExecuteMCPv2.Setup.cls", "ExecuteMCPv2.Temp.DevCopyProbe.cls"];
    await putClass("HSCUSTOM", devNames[0] as string, devSetup);
    await putClass("HSCUSTOM", devNames[1] as string, "Class ExecuteMCPv2.Temp.DevCopyProbe Extends %RegisteredObject\n{\n}");
    const hsTarget = { ...target, namespace: "HSCUSTOM" };
    const before = await Promise.all(devNames.map((name) => atelierDocument(hsTarget, name)));
    expect(snapshot()["classes HSCUSTOM"], "the dev copy is a real copy of its own, and USER's classes are intact").toMatch(/^2 /);
    expect(snapshot()["classes USER"]).toMatch(new RegExp(`^${embedded.classes.size} `));
    terminal("%SYS", ['Kill p Set p("Database")="USER"', 'Set sc=##class(Config.MapPackages).Create("%ALL","ExecuteMCPv2",.p)']);

    const run = runOneLiner("USER");
    expect(run.lines).toEqual([
      WEBAPP_LINE,
      MAPPING_LINE,
      "Removed: %ALL",
      "Removed: ^UnitTestRoot (USER)",
      classesLine("USER", embedded.classes.size),
      "Removed: install record (USER)",
      "Left: classes (HSCUSTOM) (its Setup class carries the dev marker, so it is not a copy this install deployed). To remove it by hand: in HSCUSTOM: Do $System.OBJ.DeletePackage(\"ExecuteMCPv2\")",
      // DW-776: the line words each namespace's own outcome, so the namespace whose copy is left is not told it lost its classes.
      `${NAMESPACES_LINE_START} USER lost its classes; HSCUSTOM kept its classes (see its Left: line).`,
      SERVER_LINE,
    ]);
    const after = await Promise.all(devNames.map((name) => atelierDocument(hsTarget, name)));
    expect(after, "every document of the dev copy is byte for byte what it was, timestamps included").toEqual(before);
    const state = snapshot();
    expect(state["classes HSCUSTOM"]).toMatch(/^2 /);
    expect(differences({ ...baseline, "classes HSCUSTOM": state["classes HSCUSTOM"] as string }, state)).toEqual([]);
  });

  leg("ownership: a dev Setup and a marker-less copy, each over an install record that names a release marker, are both left byte for byte untouched", async () => {
    await install("USER");
    terminal("%SYS", ['Set sc=##class(Config.MapPackages).Delete("%ALL","ExecuteMCPv2")']);
    // USER keeps its install record (it names a release marker) but now holds a hand-loaded dev Setup; HSCUSTOM holds a copy with no Setup class
    // under a record that names the release marker too (as an install there would have left it): a record never vouches for the copy found now.
    await putClass("USER", "ExecuteMCPv2.Setup.cls", replaceMarker(embedded.classes.get("ExecuteMCPv2.Setup.cls") as string, "dev"));
    await putClass("HSCUSTOM", "ExecuteMCPv2.Temp.NoSetupProbe.cls", "Class ExecuteMCPv2.Temp.NoSetupProbe Extends %RegisteredObject\n{\n}");
    terminal("HSCUSTOM", [`Set ^ExecuteMCPv2.InstallRecord("format")=1,^ExecuteMCPv2.InstallRecord("deployed")="${embedded.marker}"`]);
    const userTarget = { ...target, namespace: "USER" };
    const hsTarget = { ...target, namespace: "HSCUSTOM" };
    const before = [await atelierDocument(userTarget, "ExecuteMCPv2.Setup.cls"), await atelierDocument(hsTarget, "ExecuteMCPv2.Temp.NoSetupProbe.cls")];
    expect(snapshot()["record USER"], "the record still names the release marker").toContain(`deployed=${embedded.marker};`);
    expect(snapshot()["record HSCUSTOM"]).toContain(`deployed=${embedded.marker};`);
    terminal("%SYS", ['Kill p Set p("Database")="USER"', 'Set sc=##class(Config.MapPackages).Create("%ALL","ExecuteMCPv2",.p)']);

    const run = runOneLiner("USER");
    const manual = (ns: string): string => `. To remove it by hand: in ${ns}: Do $System.OBJ.DeletePackage("ExecuteMCPv2")`;
    expect(run.lines).toEqual([
      WEBAPP_LINE,
      MAPPING_LINE,
      "Removed: %ALL",
      "Removed: ^UnitTestRoot (USER)",
      "Removed: install record (HSCUSTOM)",
      "Removed: install record (USER)",
      `Left: classes (HSCUSTOM) (it has no release marker (no Setup class, or none on it), so it is not shown to be a copy this install deployed)${manual("HSCUSTOM")}`,
      `Left: classes (USER) (its Setup class carries the dev marker, so it is not a copy this install deployed)${manual("USER")}`,
      `${NAMESPACES_LINE_START} USER kept its classes (see its Left: line); HSCUSTOM kept its classes (see its Left: line).`,
      SERVER_LINE,
    ]);
    const after = [await atelierDocument(userTarget, "ExecuteMCPv2.Setup.cls"), await atelierDocument(hsTarget, "ExecuteMCPv2.Temp.NoSetupProbe.cls")];
    expect(after, "both documents are byte for byte what they were, timestamps included").toEqual(before);
    const state = snapshot();
    expect(state["classes HSCUSTOM"]).toMatch(/^1 /);
    expect(state["classes USER"]).toMatch(new RegExp(`^${embedded.classes.size} `));
    expect(differences({ ...baseline, "classes HSCUSTOM": state["classes HSCUSTOM"] as string, "classes USER": state["classes USER"] as string }, state)).toEqual([]);
  });

  leg("IPM-owned (the guard is present): the configuration goes, the classes stay with the zpm command, and a second run is a clean no-op", async () => {
    await seedInstance(target, embedded, { marker: embedded.marker, perturb: false, guard: true });
    const installed = snapshot();
    expect(installed["webapp"]).toBe("1");
    expect(installed["record USER"], "the Configure and ConfigureMapping calls IPM's module.xml makes (here through SQL) wrote the record").toContain(`deployed=${embedded.marker};`);
    expect(installed["record USER"]).toContain("all=created;");

    const classCount = Number(/^(\d+) /.exec(installed["classes USER"] as string)?.[1]);
    expect(classCount, "the 35 classes and the guard").toBe(embedded.classes.size + 1);
    const first = runUninstall("USER");
    const leftLine = 'Left: classes (USER) (IPM owns them). To remove it by hand: in USER: zpm "uninstall iris-execute-mcp-v2"';
    expect(first.lines).toEqual([WEBAPP_LINE, MAPPING_LINE, "Removed: %ALL", "Removed: install record (USER)", leftLine, SERVER_LINE]);
    expect(first.statusOk, first.statusText).toBe(true);
    expect(differences(baselinePlus({ "classes USER": installed["classes USER"] as string }), snapshot()), "only the IPM-owned classes remain").toEqual([]);

    const second = runUninstall("USER");
    expect(second.lines, "a second run removes nothing more").toEqual([leftLine, SERVER_LINE]);
    expect(second.statusOk, second.statusText).toBe(true);
    expect(second.report?.removed).toEqual([]);
    expect(differences(baselinePlus({ "classes USER": installed["classes USER"] as string }), snapshot())).toEqual([]);
  });

  leg("a failing step: a namespace whose only database is dismounted is a failed item with IRIS's text, the independent steps still run, and the classes and the records stay", async () => {
    await install();
    terminal("%SYS", [...SCRATCH_NAMESPACE_SCRIPT, "Set sc=##class(SYS.Database).DismountDatabase(dir)"]);
    const installed = snapshot();

    const run = runUninstall("USER");
    expect(run.statusOk, "the status is an error").toBe(false);
    expect(run.statusText).toContain("Uninstall did not finish: namespace (UNINSTALLNS)");
    expect(run.lines.filter((line) => line.startsWith("Failed: ")), "one failed item, with IRIS's own text").toHaveLength(1);
    const failed = run.lines.find((line) => line.startsWith("Failed: ")) as string;
    expect(failed).toMatch(/^Failed: namespace \(UNINSTALLNS\): .+/);
    expect(failed, "the text is IRIS's, with its error token").toContain("DIRECTORY");
    expect(run.lines).toContain(WEBAPP_LINE);
    expect(run.lines).toContain(MAPPING_LINE);
    expect(run.lines, "the independent steps ran: %ALL and ^UnitTestRoot are gone").toContain("Removed: %ALL");
    expect(run.lines).toContain("Removed: ^UnitTestRoot (USER)");
    expect(run.lines, "the classes, this class among them, stay for a re-run").toContain(`Left: classes (USER) (${HELD_REASON})`);
    expect(run.lines.some((line) => line.startsWith("Removed: classes")), "no class was removed").toBe(false);
    expect(run.lines.some((line) => line.startsWith("Removed: install record")), "no record was removed").toBe(false);
    expect(run.lines).toContain(RECORDS_KEPT_LINE);
    const state = snapshot();
    expect(state["record USER"], "the record stays").toBe(installed["record USER"]);
    expect(
      differences(baselinePlus({ "record USER": installed["record USER"] as string, "classes USER": installed["classes USER"] as string, extras: "000011" }), state),
      "only the classes and the record are left behind",
    ).toEqual([]);
  });

  leg("a failing ^UnitTestRoot step (a database mounted read-only): the classes and the records stay, and a re-run after the fix finishes and names only what it removed", async () => {
    await install();
    // A second namespace over a database of its own, where EnsureUnitTestRoot (as iris_execute_tests calls it) set ^UnitTestRoot and recorded it;
    // its database is then mounted read-only, so the uninstall can read that namespace but cannot kill the global.
    terminal("%SYS", [...SCRATCH_NAMESPACE_SCRIPT]);
    terminal("UNINSTALLNS", ["Set v=##class(ExecuteMCPv2.Setup).EnsureUnitTestRoot()"]);
    const scratchState = (): string[] =>
      between(terminal("UNINSTALLNS", ['Write "<<<NS",!', 'Write "utr=",$Data(^UnitTestRoot)," record=",$Data(^ExecuteMCPv2.InstallRecord("unitTestRoot")),!', 'Write ">>>NS",!']), "NS");
    expect(scratchState(), "the install set and recorded ^UnitTestRoot there").toEqual(["utr=1 record=1"]);
    terminal("%SYS", [`Set dir="${SCRATCH_DB_DIR}"`, "Set sc=##class(SYS.Database).DismountDatabase(dir)", "Set sc=##class(SYS.Database).MountDatabase(dir,1)"]);
    const installed = snapshot();

    const first = runUninstall("USER");
    expect(first.statusOk, "the status is an error").toBe(false);
    expect(first.statusText).toContain("Uninstall did not finish: ^UnitTestRoot (UNINSTALLNS)");
    const failed = first.lines.filter((line) => line.startsWith("Failed: "));
    expect(failed, "one failed item").toHaveLength(1);
    expect(failed[0], "the failed step is the ^UnitTestRoot kill, with IRIS's own text").toMatch(/^Failed: \^UnitTestRoot \(UNINSTALLNS\): .*PROTECT/);
    expect(first.lines.filter((line) => !line.startsWith("Failed: "))).toEqual([
      WEBAPP_LINE,
      MAPPING_LINE,
      "Removed: %ALL",
      "Removed: ^UnitTestRoot (USER)",
      `Left: classes (USER) (${HELD_REASON})`,
      RECORDS_KEPT_LINE,
      SERVER_LINE,
    ]);
    const held = snapshot();
    expect(held["classes USER"], "the classes, ExecuteMCPv2.Setup among them, are all still there").toBe(installed["classes USER"]);
    expect(held["classes USER"]).toMatch(/[ ,]ExecuteMCPv2\.Setup(\.cls)?,/);
    expect(held["record USER"], "the record stays").toBe(installed["record USER"]);

    // Fix the cause (the database writable again) and run the same command again: it finishes, and its report names only what this run removed.
    terminal("%SYS", [`Set dir="${SCRATCH_DB_DIR}"`, "Set sc=##class(SYS.Database).DismountDatabase(dir)", "Set sc=##class(SYS.Database).MountDatabase(dir)"]);
    const second = runUninstall("USER");
    expect(second.statusOk, second.statusText).toBe(true);
    expect(second.lines).toEqual([
      "Removed: ^UnitTestRoot (UNINSTALLNS)",
      classesLine("USER", embedded.classes.size),
      "Removed: install record (UNINSTALLNS)",
      "Removed: install record (USER)",
      SERVER_LINE,
    ]);
    expect(scratchState(), "nothing is left in the second namespace").toEqual(["utr=0 record=0"]);
    expect(differences(baselinePlus({ extras: "000011" }), snapshot()), "the instance is back to the state before the install").toEqual([]);
  });

  leg("SQL path: SELECT ExecuteMCPv2.Setup_Uninstall() through the built server's iris_sql_query fails and removes nothing", async () => {
    await install();
    const installed = snapshot();

    const served = await runServerCalls("startup", { repoRoot: REPO_ROOT, sdkEsmDir, target }, {}, [
      { tool: "iris_sql_query", args: { query: "SELECT ExecuteMCPv2.Setup_Uninstall() AS Result" } },
    ]);
    const result = served.results[0];
    expect(result?.isError, `the SQL tool reports an error: ${JSON.stringify(result)}`).toBe(true);
    expect(differences(installed, snapshot()), "nothing was removed").toEqual([]);
    expect(runOneLiner().lines).toContain(WEBAPP_LINE);
  });

  leg("DW-786: SELECT ExecuteMCPv2.Setup_ConfigureMapping and Setup_Configure through the built server's iris_sql_query are refused as an administrator, and %ALL, the mapping, iris.cpf and the web application stay as they were", async () => {
    await install("USER");
    // %ALL and the mapping removed: a call that ran would put them back in iris.cpf, which the route's rollback does not undo.
    terminal("%SYS", ['Set sc=##class(Config.MapPackages).Delete("%ALL","ExecuteMCPv2")', 'Set sc=##class(Config.Namespaces).Delete("%ALL")']);
    const cpfLines = (): number => {
      const printed = terminal("%SYS", [
        `Set f=##class(%Stream.FileCharacter).%New() Set sc=f.LinkToFile($System.Util.InstallDirectory()_"iris.cpf") Set n=0 While 'f.AtEnd { Set l=f.ReadLine() If l["%ALL" Set n=n+1 } Write "CPFALL=",n,!`,
      ]);
      const line = outputLines(printed).find((entry) => entry.startsWith("CPFALL="));
      if (line === undefined) throw new Error(`the iris.cpf read printed no count: ${printed.slice(-400)}`);
      return Number(line.slice("CPFALL=".length));
    };
    const webAppNamespace = (): string => {
      const printed = terminal("%SYS", ['Set sc=##class(Security.Applications).Get("/api/executemcp/v2",.p) Write "WEBAPPNS=",$Get(p("NameSpace")),!']);
      return (outputLines(printed).find((entry) => entry.startsWith("WEBAPPNS=")) ?? "").slice("WEBAPPNS=".length);
    };
    try {
      const before = snapshot();
      expect(before["%ALL"], "precondition: %ALL is absent").toBe("0");
      expect(cpfLines(), "precondition: iris.cpf holds no %ALL line").toBe(0);
      const appNamespaceBefore = webAppNamespace();
      expect(appNamespaceBefore, "precondition: the web application points at the install namespace").toBe("USER");

      // The automatic install is off, so no startup repair can put anything back and hide a call that ran.
      const served = await runServerCalls("startup", { repoRoot: REPO_ROOT, sdkEsmDir, target }, { IRIS_AUTO_INSTALL: "false" }, [
        { tool: "iris_sql_query", args: { query: "SELECT ExecuteMCPv2.Setup_ConfigureMapping('USER') AS Result" } },
        { tool: "iris_sql_query", args: { query: "SELECT ExecuteMCPv2.Setup_Configure('HSCUSTOM') AS Result" } },
      ]);
      expect(served.results, "both calls were answered").toHaveLength(2);
      expect(JSON.stringify(served.results[0]), "ConfigureMapping names the refusal").toContain("ConfigureMapping changed nothing: it was called inside a transaction during a web request");
      expect(JSON.stringify(served.results[1]), "Configure names the refusal").toContain("Configure changed nothing: it was called inside a transaction during a web request");
      // Beyond the refusal texts, the route rolls the statement back, which undoes a change to the web application and makes
      // Config.Namespaces and Config.MapPackages report a recreated %ALL and mapping as absent. A ConfigureMapping that ran still
      // shows in iris.cpf, and in the running configuration: HSCUSTOM then sees the ExecuteMCPv2 classes through %ALL, which the
      // snapshot reads. The web application's namespace is a side check that a Configure which ran would also pass.
      expect(cpfLines(), "iris.cpf still holds no %ALL line").toBe(0);
      expect(differences(before, snapshot()), "%ALL, the mapping and the classes (also as HSCUSTOM sees them) are as they were").toEqual([]);
      expect(webAppNamespace(), "side check: the web application still points at the install namespace").toBe(appNamespaceBefore);

      // Story 45.7 (DW-792, binding): after the refusal the namespace table still works, BEFORE the teardown's ActivateAll could hide a
      // repair. The list reads, and a namespace created now can be entered from a terminal and over Atelier. A refusal that had let a
      // ConfigureMapping run inside the route's transaction leaves a table that refuses every new namespace (iris session exits 233,
      // Atelier answers 500, plan probe P-792).
      const listed = terminal("%SYS", ['Set rs=##class(%ResultSet).%New("Config.Namespaces:List") Set sc=rs.Execute("*") Write "NSLIST-SC=",sc,!']);
      expect(outputLines(listed), "Config.Namespaces:List reads").toContain("NSLIST-SC=1");
      terminal("%SYS", SCRATCH_NAMESPACE_SCRIPT);
      expect(outputLines(terminal("UNINSTALLNS", ['Write "ENTERED=",$NAMESPACE,!'])), "iris session -U <new namespace> exits 0 and enters it").toContain("ENTERED=UNINSTALLNS");
      const entered = await fetch(`http://${target.host}:${target.port}/api/atelier/v8/UNINSTALLNS`, {
        headers: { Accept: "application/json", Authorization: `Basic ${Buffer.from(`${target.username}:${target.password}`).toString("base64")}` },
        signal: AbortSignal.timeout(60_000),
      });
      expect(entered.status, "Atelier GET /api/atelier/v8/<new namespace> answers 200").toBe(200);
    } finally {
      // The leg's own teardown. A configuration write that ran inside the route's transaction is rolled back with it, and IRIS then
      // keeps a namespace table that no namespace created afterwards can be entered through, so the legs that create a namespace
      // of their own would fail for this leg's reason. Re-activating the table restores it.
      terminal("%SYS", ["Set sc=##class(Config.Namespaces).ActivateAll()"]);
    }
  });

  leg("DW-787: the real bootstrap into a namespace that is not interoperability-enabled compiles every class, ExecuteMCPv2.REST.Interop included, and configures the web application and the mapping", async () => {
    terminal("%SYS", SCRATCH_NAMESPACE_SCRIPT);
    // Precondition: UNINSTALLNS cannot see the interoperability classes, so a compile-time Ens reference would fail there.
    const interop = outputLines(terminal("UNINSTALLNS", ['Write "ENSITEM=",##class(%Dictionary.CompiledClass).%ExistsId("Ens.Config.Item"),!']));
    expect(interop, "precondition: Ens.Config.Item is not a compiled class in UNINSTALLNS").toContain("ENSITEM=0");
    await install("UNINSTALLNS");
    const configured = snapshot();
    expect(configured["webapp"], "the bootstrap registered the web application").toBe("1");
    expect(configured["%ALL"], "and %ALL").toBe("1");
    expect(configured["map Config.MapPackages:List"], "and the ExecuteMCPv2 mapping").toMatch(/^1 ExecuteMCPv2;/);
    const appNamespace = outputLines(terminal("%SYS", ['Set sc=##class(Security.Applications).Get("/api/executemcp/v2",.p) Write "WEBAPPNS=",$Get(p("NameSpace")),!']));
    expect(appNamespace, "the web application points at UNINSTALLNS").toContain("WEBAPPNS=UNINSTALLNS");
    const names = [...embedded.classes.keys()].map((name) => name.replace(/\.cls$/, ""));
    expect(names, "the embed holds ExecuteMCPv2.REST.Interop").toContain("ExecuteMCPv2.REST.Interop");
    const printed = terminal("UNINSTALLNS", [
      `For c=${names.map((name) => `"${name}"`).join(",")} { If '##class(%Dictionary.CompiledClass).%ExistsId(c) Write "NOTCOMPILED ",c,! }`,
      'Write "CHECKED",!',
    ]);
    const lines = outputLines(printed);
    expect(lines.filter((line) => line.startsWith("NOTCOMPILED ")), "every bootstrapped class is compiled in UNINSTALLNS").toEqual([]);
    expect(lines, "the check ran").toContain("CHECKED");
  });

  leg("DW-786: the guard lets the automatic install's upgrade and self-heal through: each registers the web application, and the upgrade also creates %ALL and the mapping", async () => {
    // Upgrade: the classes deployed under an older marker, then the web application, the mapping and %ALL taken away (the seed
    // configures them), so the upgrade has to run both configuration calls.
    const olderMarker = embedded.marker.replace(/\+(\d+)\./, (_whole, sequence: string) => `+${Number(sequence) - 1}.`);
    expect(olderMarker, "an older marker can be built from the shipped one").not.toBe(embedded.marker);
    await seedInstance(target, embedded, { marker: olderMarker, perturb: false });
    terminal("%SYS", [
      `Set sc=##class(Security.Applications).Delete("${WEBAPP}")`,
      'Set sc=##class(Config.MapPackages).Delete("%ALL","ExecuteMCPv2")',
      'Set sc=##class(Config.Namespaces).Delete("%ALL")',
    ]);
    const seeded = snapshot();
    expect(seeded["webapp"], "precondition: no web application before the upgrade").toBe("0");
    expect(seeded["%ALL"], "precondition: no %ALL before the upgrade").toBe("0");
    await install();
    const upgraded = snapshot();
    expect(upgraded["webapp"], "the upgrade registered the web application").toBe("1");
    expect(upgraded["%ALL"], "the upgrade created %ALL").toBe("1");
    expect(upgraded["map Config.MapPackages:List"], "the upgrade created the mapping").toMatch(/^1 ExecuteMCPv2;/);
    expect(upgraded["record USER"], "the upgrade deployed the shipped marker").toContain(`deployed=${embedded.marker};`);

    // Self-heal: the web application removed under a current install; the next start registers it again.
    terminal("%SYS", [`Set sc=##class(Security.Applications).Delete("${WEBAPP}")`]);
    expect(snapshot()["webapp"], "precondition: the web application is gone").toBe("0");
    await install();
    expect(snapshot()["webapp"], "the self-heal registered the web application again").toBe("1");
  });

  leg("back-compat (AC 45.3.8): the five install methods return, through the SQL route the bootstrap uses, what they returned before the record existed, and a repeat call changes nothing", async () => {
    await install();
    const installed = snapshot();

    // Every value is read the way the bootstrap reads it: SELECT ExecuteMCPv2.Setup_<Method>(...) through Atelier action/query.
    // The expected wire values were captured from the live throwaway on the baseline build (Rule #36): an OK %Status arrives as the string "1"
    // and a %Boolean as `true`. `expect.soft` keeps every method's check running, so a change to one method's return value names that method alone.
    expect.soft(await sqlValue("SELECT ExecuteMCPv2.Setup_Configure(?) AS V", ["USER"]), "Configure returns an OK status").toBe("1");
    expect.soft(await sqlValue("SELECT ExecuteMCPv2.Setup_ConfigureMapping(?) AS V", ["USER"]), "ConfigureMapping returns an OK status, also when the mapping exists").toBe("1");
    expect.soft(await sqlValue("SELECT ExecuteMCPv2.Setup_IsConfigured() AS V"), "IsConfigured returns true while the web application is registered").toBe(true);
    expect.soft(await sqlValue("SELECT ExecuteMCPv2.Setup_EnsureUnitTestRoot() AS V"), "EnsureUnitTestRoot returns the value already set").toBe(installed["utr USER"]);
    expect.soft(await sqlValue("SELECT ExecuteMCPv2.Setup_GetBootstrapVersion() AS V"), "GetBootstrapVersion returns the class's marker").toBe(embedded.marker);
    expect(differences(installed, snapshot()), "calling the five methods again changes nothing: not the record, not the web application, not ^UnitTestRoot").toEqual([]);

    // EnsureUnitTestRoot on an undefined global sets it, returns what it set, and records the value it set (the record's node is killed too,
    // so the comparison below sees the node only if this call wrote it).
    terminal("USER", ['Kill ^UnitTestRoot,^ExecuteMCPv2.InstallRecord("unitTestRoot")']);
    expect(snapshot()["record USER"], "the node is gone before the call").not.toContain("unitTestRoot=");
    const returned = await sqlValue("SELECT ExecuteMCPv2.Setup_EnsureUnitTestRoot() AS V");
    expect.soft(returned, "EnsureUnitTestRoot returns the value it set").toBe(installed["utr USER"]);
    expect.soft(snapshot()["utr USER"], "and the global holds it").toBe(returned);
    expect(snapshot()["record USER"], "and the call recorded the value it set").toContain(`unitTestRoot=${String(returned)};`);
    expect(differences(installed, snapshot()), "the instance is back to the installed state, record included").toEqual([]);
  });

  leg("a step that fails writes no record node: an account that cannot register the web application or create %ALL leaves the record empty, and the same calls as the superuser write it", async () => {
    await install();
    terminal("%SYS", [
      'Set $NAMESPACE="%SYS"',
      'Set sc=##class(Security.Roles).Create("uninstalllprole2","uninstall gate account","%Development:U,%DB_USER:RW,%DB_IRISSYS:R,%DB_IRISLIB:R,%DB_IRISTEMP:RW,%DB_IRISLOCALDATA:RW")',
      'Set sc=##class(Security.Users).Create("uninstalllp2","uninstalllprole2","Pa55word!lp2")',
      // Take the install away as the superuser: no web application, no mapping, no %ALL, no record (the classes stay in USER).
      `Set sc=##class(Security.Applications).Delete("${WEBAPP}")`,
      'Set sc=##class(Config.MapPackages).Delete("%ALL","ExecuteMCPv2")',
      'Set sc=##class(Config.Namespaces).Delete("%ALL")',
      'Set $NAMESPACE="USER" Kill ^ExecuteMCPv2.InstallRecord',
    ]);
    const before = snapshot();
    expect(before["webapp"]).toBe("0");
    expect(before["%ALL"]).toBe("0");
    expect(before["record USER"], "no record before the calls").toMatch(/^0\b/);

    // lp2 reads %SYS but is not allowed to change it: both steps fail with IRIS's own privilege error.
    const output = terminal("USER", [
      'Set ok=$System.Security.Login("uninstalllp2","Pa55word!lp2")',
      'Write "LOGIN-AS=",$Username,!',
      'Write "CONFIGURE-OK=",$System.Status.IsOK(##class(ExecuteMCPv2.Setup).Configure("USER")),!',
      'Write "MAPPING-OK=",$System.Status.IsOK(##class(ExecuteMCPv2.Setup).ConfigureMapping("USER")),!',
    ]);
    const field = (name: string): string => (outputLines(output).find((line) => line.startsWith(`${name}=`)) ?? "").slice(name.length + 1);
    expect(field("LOGIN-AS"), "the terminal logged in as the account").toBe("uninstalllp2");
    expect(field("CONFIGURE-OK"), "Configure failed for the account (the premise of this leg)").toBe("0");
    expect(field("MAPPING-OK"), "ConfigureMapping failed for the account (the premise of this leg)").toBe("0");
    const after = snapshot();
    expect(after["webapp"], "no web application was registered").toBe("0");
    expect(after["%ALL"], "%ALL was not created").toBe("0");
    expect(after["record USER"], "a step that failed wrote no node of the record, not even the format version").toMatch(/^0\b/);
    expect(differences(before, after), "nothing changed").toEqual([]);

    // The oracle can vary: the superuser's Configure succeeds and writes the node.
    terminal("USER", ['Set sc=##class(ExecuteMCPv2.Setup).Configure("USER")']);
    expect(snapshot()["record USER"], "a step that succeeded wrote its node").toContain(`deployed=${embedded.marker};`);
  });

  leg("DW-770 (Story 45.7): with the install off, a deployed marker with this build's hash and a lower semver reads current, runs, and writes nothing; another hash is refused", async () => {
    const parsed = stampedEmbedded(embedded);
    const lower = `${parsed.semver[0]}.${Number(parsed.semver[1]) - 1}.0+${parsed.sequence - 1n}.${parsed.hash}`;
    const otherHash = parsed.hash === "0123456789ab" ? "ba9876543210" : "0123456789ab";
    const names = [...embedded.classes.keys()];
    const readOnly = { IRIS_GOVERNANCE_PRESET: "read-only" };

    // Same hash, lower semver and sequence: current. The custom-REST call runs, nothing is uploaded, compiled or configured.
    await seedInstance(target, embedded, { marker: lower, perturb: false });
    const beforeSame = await snapshotInstance(target, names);
    const stateBeforeSame = snapshot();
    const same = await runServerCalls("startup", { repoRoot: REPO_ROOT, sdkEsmDir, target }, readOnly, [{ tool: "iris_global_get", args: { global: "Story457Probe" } }]);
    expect(same.results[0]?.structuredContent?.["code"], "the call was not refused").not.toBe("IRIS_SIDE_NOT_INSTALLED");
    expect(same.stderr).toContain(
      `Bootstrap: the automatic install is off for profile "default" (IRIS_GOVERNANCE_PRESET=read-only); found current (the deployed marker "${lower}" has the same IRIS-side classes as this server's ${embedded.marker}), nothing to install.`,
    );
    expect(same.stderr, "no Bootstrap warning").not.toMatch(/\[WARN\] Bootstrap:/);
    expect(await snapshotInstance(target, names), "no document was uploaded or compiled, and the compiled marker is the seeded one").toEqual(beforeSame);
    expect(beforeSame.compiledMarker).toBe(lower);
    expect(differences(stateBeforeSame, snapshot()), "nothing was configured either").toEqual([]);

    // Another hash at a lower sequence: stale, refused, nothing written.
    const other = `${parsed.semver[0]}.${Number(parsed.semver[1]) - 1}.0+${parsed.sequence - 1n}.${otherHash}`;
    await seedInstance(target, embedded, { marker: other, perturb: false });
    const beforeOther = await snapshotInstance(target, names);
    const refused = await runServerCalls("startup", { repoRoot: REPO_ROOT, sdkEsmDir, target }, readOnly, [{ tool: "iris_global_get", args: { global: "Story457Probe" } }]);
    expect(refused.results[0]?.structuredContent?.["code"], "another hash is refused").toBe("IRIS_SIDE_NOT_INSTALLED");
    expect(refused.results[0]?.structuredContent?.["found"]).toBe("stale");
    expect(refused.results[0]?.structuredContent?.["deployedVersion"]).toBe(other);
    expect(await snapshotInstance(target, names), "nothing was written").toEqual(beforeOther);
  });

  leg("DW-788 and DW-790 (Story 45.7): an account without %Admin_Manage and without SQL privileges compiles without a false warning, and a refused Configure is reported as one", async () => {
    await install();
    terminal("%SYS", [
      'Set $NAMESPACE="%SYS"',
      'Set sc=##class(Security.Roles).Create("uninstalllprole1","uninstall gate account","%Development:U,%DB_USER:RW")',
      'Set sc=##class(Security.Users).Create("uninstalllp1","uninstalllprole1","Pa55word!lp1")',
    ]);
    const lp = { ...target, username: "uninstalllp1", password: "Pa55word!lp1" };
    const installed = snapshot();
    const names = [...embedded.classes.keys()];
    const docsBefore = await snapshotInstance(target, names);

    // Installed side, the install on and then off: the probe reads current, the compile check confirms every class through action/index,
    // and no `Compile failed` line is logged. (Before Story 45.7 the install-on run logged `Compile failed: 35 of 35`, plan probe P-788.)
    for (const [label, env] of [
      ["install on", {}],
      ["install off", { IRIS_AUTO_INSTALL: "false" }],
    ] as const) {
      const run = await runServerCalls("startup", { repoRoot: REPO_ROOT, sdkEsmDir, target: lp }, env, []);
      expect(run.stderr, `${label}: no Compile failed line`).not.toContain("Compile failed");
      expect(run.stderr, `${label}: no bootstrap error line`).not.toContain("Bootstrap completed with errors");
      expect(run.stderr, `${label}: the account was not refused`).not.toContain("IRIS_SIDE_NOT_INSTALLED");
    }
    expect(await snapshotInstance(target, names), "nothing was uploaded or compiled").toEqual(docsBefore);
    expect(differences(installed, snapshot()), "nothing was configured").toEqual([]);

    // The web application deleted, the install on: the account cannot register it. IRIS answers HTTP 200 with the status in the row, so the
    // bootstrap reports `Configure failed:` with IRIS's own text (before Story 45.7 it logged success), and the web application stays absent.
    terminal("%SYS", [`Set sc=##class(Security.Applications).Delete("${WEBAPP}")`]);
    const absent = snapshot();
    expect(absent["webapp"], "precondition: the web application is gone").toBe("0");
    const failed = await runServerCalls("startup", { repoRoot: REPO_ROOT, sdkEsmDir, target: lp }, {}, []);
    expect(failed.stderr, "the Configure status of IRIS is reported").toMatch(/Bootstrap completed with errors: .*Configure failed: .*PROTECT/);
    expect(failed.stderr, "the mapping step reports its refusal too").toContain("Package mapping failed: ");
    expect(failed.stderr, "the manual instructions follow").toContain("registration requires %Admin_Manage privileges");
    expect(failed.stderr, "no success line for the web application").not.toContain("Bootstrap: web application configured successfully");
    expect(snapshot()["webapp"], "the web application stays absent").toBe("0");
    expect(differences(absent, snapshot()), "nothing else changed").toEqual([]);
  });

  leg("least privilege: an account without %Admin_Manage refuses cleanly, each impossible step a failed item with IRIS's text, and nothing is removed", async () => {
    await install();
    terminal("%SYS", [
      'Set $NAMESPACE="%SYS"',
      'Set sc=##class(Security.Roles).Create("uninstalllprole1","uninstall gate account","%Development:U,%DB_USER:RW")',
      'Set sc=##class(Security.Users).Create("uninstalllp1","uninstalllprole1","Pa55word!lp1")',
      'Set sc=##class(Security.Roles).Create("uninstalllprole2","uninstall gate account","%Development:U,%DB_USER:RW,%DB_IRISSYS:R,%DB_IRISLIB:R,%DB_IRISTEMP:RW,%DB_IRISLOCALDATA:RW")',
      'Set sc=##class(Security.Users).Create("uninstalllp2","uninstalllprole2","Pa55word!lp2")',
    ]);
    const installed = snapshot();

    // lp1 holds %Development and the namespace's database resource only: it cannot even switch to %SYS.
    const noSys = runUninstall("USER", { user: "uninstalllp1", password: "Pa55word!lp1" });
    expect(noSys.statusOk).toBe(false);
    expect(noSys.report?.removed, "nothing was removed").toEqual([]);
    expect(noSys.report?.failed.map((entry) => entry["item"])).toEqual([`web application ${WEBAPP}`, "package mapping ExecuteMCPv2 in %ALL", "namespace list"]);
    for (const entry of noSys.report?.failed ?? []) expect(entry["error"], `${entry["item"]} carries IRIS's text`).toContain("PROTECT");
    expect(noSys.lines.some((line) => line.startsWith("Left: %ALL, ^UnitTestRoot, classes and the install records")), "the rest is left, with the reason").toBe(true);
    expect(differences(installed, snapshot()), "the instance is unchanged").toEqual([]);

    // DW-773: neither account can read the web application's definition, yet IsConfigured answers from the CSP application lookup,
    // both ways. lp1 cannot switch to %SYS (the switch throws); lp2 can, but Security.Applications.Exists answers 0 with an
    // access-denied status instead of throwing (the EXISTS line is the precondition that makes lp2 a distinct case).
    const lpRead = (user: string, password: string): { exists: string; configured: string } => {
      const printed = terminal("USER", [
        `Set ok=$System.Security.Login("${user}","${password}")`,
        'Write "LOGIN-AS=",$Username,!',
        'Try { Set $NAMESPACE="%SYS" Write "EXISTS=",##class(Security.Applications).Exists("/api/executemcp/v2"),! } Catch e { Write "EXISTS=throws",! } Set $NAMESPACE="USER"',
        'Write "ISCONF=",##class(ExecuteMCPv2.Setup).IsConfigured(),!',
      ]);
      const lines = outputLines(printed);
      const field = (name: string): string => (lines.find((entry) => entry.startsWith(`${name}=`)) ?? "").slice(name.length + 1);
      expect(field("LOGIN-AS"), `the terminal logged in as ${user}`).toBe(user);
      return { exists: field("EXISTS"), configured: field("ISCONF") };
    };
    expect(lpRead("uninstalllp1", "Pa55word!lp1"), "lp1: the switch to %SYS throws, and the registered web application reads as configured").toEqual({ exists: "throws", configured: "1" });
    expect(lpRead("uninstalllp2", "Pa55word!lp2"), "lp2: Exists answers 0 without throwing, and the registered web application reads as configured").toEqual({ exists: "0", configured: "1" });
    terminal("%SYS", ['Set sc=##class(Security.Applications).Delete("/api/executemcp/v2")']);
    expect(lpRead("uninstalllp1", "Pa55word!lp1").configured, "lp1 reads the absent web application as not configured").toBe("0");
    expect(lpRead("uninstalllp2", "Pa55word!lp2").configured, "lp2 reads the absent web application as not configured").toBe("0");
    terminal("USER", ['Set sc=##class(ExecuteMCPv2.Setup).Configure("USER")']);

    // lp2 can read %SYS but is not allowed to change it.
    const readOnly = runUninstall("USER", { user: "uninstalllp2", password: "Pa55word!lp2" });
    expect(readOnly.statusOk).toBe(false);
    expect(readOnly.report?.removed, "nothing was removed").toEqual([]);
    const failedItems = (readOnly.report?.failed ?? []).map((entry) => entry["item"]);
    expect(failedItems).toContain(`web application ${WEBAPP}`);
    expect(failedItems).toContain("package mapping ExecuteMCPv2 in %ALL");
    for (const entry of readOnly.report?.failed ?? []) expect(entry["error"]?.length, `${entry["item"]} carries IRIS's text`).toBeGreaterThan(10);
    expect(differences(installed, snapshot()), "the instance is unchanged").toEqual([]);

    // The superuser then finishes the job.
    expect(runOneLiner().lines).toContain(WEBAPP_LINE);
  });
});

// The scratch directory beforeAll made is removed with the process; the harness `down` removes the container.
process.on("exit", () => {
  if (scratch !== undefined) rmSync(scratch, { recursive: true, force: true });
});
