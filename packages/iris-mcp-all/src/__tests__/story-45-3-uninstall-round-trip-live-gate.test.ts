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
 * foreign mapping added after the install, an `ExecuteMCPv2` mapping that existed before it, `^UnitTestRoot` preset, `^UnitTestRoot` changed, no record (an install by 1.2.0), two
 * namespaces with a shadowed copy, a `dev`-marked copy in a second namespace (ownership), a dev Setup over a recorded install and a
 * marker-less copy (ownership), IPM-owned (the guard stub) with a second
 * run, a failing step (a namespace whose only database is dismounted), the SQL path (`SELECT ExecuteMCPv2.Setup_Uninstall()` through the
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
const ALL_MANUAL =
  'in %SYS: Do ##class(Config.Namespaces).Delete("%ALL"). This deletes %ALL together with every mapping in it, so check what else is mapped there first';

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
  const dirty = Object.entries(baseline).filter(([key, value]) => (key === "webapp" || key === "%ALL" ? value !== "0" : /^(classes|record) /.test(key) ? !/^0\b/.test(value) : false));
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

    const run = runOneLiner();
    expect(run.lines).toEqual([WEBAPP_LINE, MAPPING_LINE, classesLine("USER", embedded.classes.size), "Removed: %ALL", "Removed: ^UnitTestRoot (USER)", "Removed: install record (USER)", SERVER_LINE]);
    expect(differences(baseline, snapshot()), "the instance equals the state before the install").toEqual([]);

    // A second run: the class is gone, so the terminal cannot call it and nothing changes. (The idempotent, status-OK second run is the IPM-owned leg.)
    const second = terminal("USER", ["Do ##class(ExecuteMCPv2.Setup).Uninstall()"]);
    expect(second).toContain("CLASS DOES NOT EXIST");
    expect(differences(baseline, snapshot())).toEqual([]);
  });

  leg("run from %SYS, which sees the class only through the %ALL mapping the command removes: the same result as in the install namespace", async () => {
    await install();
    const run = runOneLiner("%SYS");
    expect(run.lines).toEqual([WEBAPP_LINE, MAPPING_LINE, classesLine("USER", embedded.classes.size), "Removed: %ALL", "Removed: ^UnitTestRoot (USER)", "Removed: install record (USER)", SERVER_LINE]);
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
      classesLine("USER", embedded.classes.size),
      "Removed: ^UnitTestRoot (USER)",
      "Removed: install record (USER)",
      "Left: %ALL (the install did not create it)",
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
      classesLine("USER", embedded.classes.size),
      "Removed: ^UnitTestRoot (USER)",
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
      classesLine("USER", embedded.classes.size),
      "Removed: ^UnitTestRoot (USER)",
      "Removed: install record (USER)",
      "Left: %ALL (the install did not create it)",
      SERVER_LINE,
    ]);
    expect(differences(baselinePlus({ "%ALL": "1" }), snapshot())).toEqual([]);
  });

  leg("^UnitTestRoot set before the install: the value survives and is not reported", async () => {
    terminal("USER", ['Set ^UnitTestRoot="/preset/before/the/install/"']);
    await install();
    expect(snapshot()["record USER"], "the install recorded no unitTestRoot node for a value it did not set").not.toContain("unitTestRoot=");

    const run = runOneLiner();
    expect(run.lines).toEqual([WEBAPP_LINE, MAPPING_LINE, classesLine("USER", embedded.classes.size), "Removed: %ALL", "Removed: install record (USER)", SERVER_LINE]);
    expect(differences(baselinePlus({ "utr USER": "/preset/before/the/install/" }), snapshot())).toEqual([]);
  });

  leg("^UnitTestRoot changed after the install: the value survives and is reported with its command", async () => {
    await install();
    terminal("USER", ['Set ^UnitTestRoot="/changed/after/the/install/"']);

    const run = runOneLiner();
    expect(run.lines).toEqual([
      WEBAPP_LINE,
      MAPPING_LINE,
      classesLine("USER", embedded.classes.size),
      "Removed: %ALL",
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

  leg("two namespaces with a shadowed copy: both lose the web application, the mapping and their classes, and the report names both", async () => {
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
      // Entries follow the order of the namespace list; the current namespace's own classes go last, because its copy is the one running.
      classesLine("HSCUSTOM", embedded.classes.size),
      classesLine("USER", embedded.classes.size + 1),
      "Removed: %ALL",
      "Removed: ^UnitTestRoot (HSCUSTOM)",
      "Removed: ^UnitTestRoot (USER)",
      "Removed: install record (HSCUSTOM)",
      "Removed: install record (USER)",
      "Namespaces USER, HSCUSTOM used the suite: each loses the web application, the %ALL mapping and its classes (the instance has one of each).",
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
      classesLine("USER", embedded.classes.size),
      "Removed: %ALL",
      "Removed: ^UnitTestRoot (USER)",
      "Removed: install record (USER)",
      "Left: classes (HSCUSTOM) (its Setup class carries the dev marker, so it is not a copy this install deployed). To remove it by hand: in HSCUSTOM: Do $System.OBJ.DeletePackage(\"ExecuteMCPv2\")",
      "Namespaces USER, HSCUSTOM used the suite: each loses the web application, the %ALL mapping and its classes (the instance has one of each).",
      SERVER_LINE,
    ]);
    const after = await Promise.all(devNames.map((name) => atelierDocument(hsTarget, name)));
    expect(after, "every document of the dev copy is byte for byte what it was, timestamps included").toEqual(before);
    const state = snapshot();
    expect(state["classes HSCUSTOM"]).toMatch(/^2 /);
    expect(differences({ ...baseline, "classes HSCUSTOM": state["classes HSCUSTOM"] as string }, state)).toEqual([]);
  });

  leg("ownership: a dev Setup over a recorded install and a marker-less copy in a second namespace are both left byte for byte untouched", async () => {
    await install("USER");
    terminal("%SYS", ['Set sc=##class(Config.MapPackages).Delete("%ALL","ExecuteMCPv2")']);
    // USER keeps its install record (it names a release marker) but now holds a hand-loaded dev Setup; HSCUSTOM holds a copy with no Setup class.
    await putClass("USER", "ExecuteMCPv2.Setup.cls", replaceMarker(embedded.classes.get("ExecuteMCPv2.Setup.cls") as string, "dev"));
    await putClass("HSCUSTOM", "ExecuteMCPv2.Temp.NoSetupProbe.cls", "Class ExecuteMCPv2.Temp.NoSetupProbe Extends %RegisteredObject\n{\n}");
    const userTarget = { ...target, namespace: "USER" };
    const hsTarget = { ...target, namespace: "HSCUSTOM" };
    const before = [await atelierDocument(userTarget, "ExecuteMCPv2.Setup.cls"), await atelierDocument(hsTarget, "ExecuteMCPv2.Temp.NoSetupProbe.cls")];
    expect(snapshot()["record USER"], "the record still names the release marker").toContain(`deployed=${embedded.marker};`);
    terminal("%SYS", ['Kill p Set p("Database")="USER"', 'Set sc=##class(Config.MapPackages).Create("%ALL","ExecuteMCPv2",.p)']);

    const run = runOneLiner("USER");
    const manual = (ns: string): string => `. To remove it by hand: in ${ns}: Do $System.OBJ.DeletePackage("ExecuteMCPv2")`;
    expect(run.lines).toEqual([
      WEBAPP_LINE,
      MAPPING_LINE,
      "Removed: %ALL",
      "Removed: ^UnitTestRoot (USER)",
      "Removed: install record (USER)",
      `Left: classes (HSCUSTOM) (it has no release marker (no Setup class, or none on it) and no install record names it)${manual("HSCUSTOM")}`,
      `Left: classes (USER) (its Setup class carries the dev marker, so it is not a copy this install deployed)${manual("USER")}`,
      "Namespaces USER, HSCUSTOM used the suite: each loses the web application, the %ALL mapping and its classes (the instance has one of each).",
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
    expect(installed["record USER"], "IPM's Configure and ConfigureMapping wrote the record").toContain(`deployed=${embedded.marker};`);
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

  leg("a failing step: a namespace whose only database is dismounted is a failed item with IRIS's text, the independent steps still run and the records stay", async () => {
    await install();
    terminal("%SYS", [
      'Set dir="/usr/irissys/mgr/uninstalltestdb/"',
      "Set mk=##class(%File).CreateDirectoryChain(dir)",
      "Set sc=##class(SYS.Database).CreateDatabase(dir,1)",
      'Kill p Set p("Directory")=dir',
      'Set sc=##class(Config.Databases).Create("UNINSTALLDB",.p)',
      'Kill p Set p("Globals")="UNINSTALLDB",p("Routines")="UNINSTALLDB"',
      'Set sc=##class(Config.Namespaces).Create("UNINSTALLNS",.p)',
      "Set sc=##class(SYS.Database).DismountDatabase(dir)",
    ]);
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
    expect(run.lines).toContain(classesLine("USER", embedded.classes.size));
    expect(run.lines, "the independent steps ran: %ALL and ^UnitTestRoot are gone").toContain("Removed: %ALL");
    expect(run.lines).toContain("Removed: ^UnitTestRoot (USER)");
    expect(run.lines.some((line) => line.startsWith("Removed: install record")), "no record was removed").toBe(false);
    expect(run.lines).toContain("Left: install records (a step failed, so the records stay and the command can run again)");
    const state = snapshot();
    expect(state["record USER"], "the record stays").toBe(installed["record USER"]);
    expect(differences(baselinePlus({ "record USER": installed["record USER"] as string }), state), "only the record is left behind").toEqual([]);
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

    // EnsureUnitTestRoot on an undefined global sets it, returns what it set, and records the value it set.
    terminal("USER", ["Kill ^UnitTestRoot"]);
    const returned = await sqlValue("SELECT ExecuteMCPv2.Setup_EnsureUnitTestRoot() AS V");
    expect.soft(returned, "EnsureUnitTestRoot returns the value it set").toBe(installed["utr USER"]);
    expect.soft(snapshot()["utr USER"], "and the global holds it").toBe(returned);
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
    expect(noSys.lines.some((line) => line.startsWith("Left: classes, %ALL, ^UnitTestRoot and the install records")), "the rest is left, with the reason").toBe(true);
    expect(differences(installed, snapshot()), "the instance is unchanged").toEqual([]);

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
