/**
 * Story 45.7 -- the documents say what the last Epic 45 burn-down changed, and the source pins of the IRIS-side change (project rules #30, #36,
 * #43, #45, #59; DW-767, DW-770, DW-784, DW-788, DW-790, DW-791, DW-792).
 *
 *  - `SECURITY.md` carries the two wording texts of the Planner verbatim (Design Notes A4) and no email address;
 *  - the README, `tool_support.md`, the CHANGELOG section and the changeset carry each behavior change with its sanction id, its default state
 *    (Rule #30: `iris_sql_analyze` stays a read, enabled by default, and `block` seeds three of its actions disabled), and the
 *    `BOOTSTRAP_VERSION` move that `Setup.cls` causes;
 *  - the DW-792 change is pinned by source, in `src/ExecuteMCPv2/Setup.cls` and in the embedded `ExecuteMCPv2.Setup.cls`: the guard is still
 *    the first executable statement of `Configure` and `ConfigureMapping`; the suspension is taken only when `$TLevel > 0`, after the
 *    "already mapped" exit, around the `%ALL` and mapping creation and their record entries; and the previous state is restored after the
 *    Try/Catch, before the method's `Quit`.
 *
 * Mutation (Rule #59): the guard line moved below `Set tSC` in `Setup.cls`, `pnpm run gen:bootstrap` -> the guard pins are red (text pins on
 * the source and on the embed); `SECURITY.md` with a sentence dropped -> the SECURITY pins are red. Reads the repository's documents,
 * sources and embed only: no docker, no IRIS.
 */

import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { REPO_ROOT } from "./pack-fixture";
import { BOOTSTRAP_CLASSES, BOOTSTRAP_VERSION } from "../../../shared/src/bootstrap-classes.js";
import { parseBootstrapMarker } from "../../../shared/src/bootstrap-version.js";

const read = (relative: string): string => readFileSync(path.join(REPO_ROOT, relative), "utf8");
const squash = (text: string): string => text.replace(/\s+/g, " ");

const readme = squash(read("README.md"));
const toolSupport = squash(read("tool_support.md"));
const changelogRaw = read("CHANGELOG.md");
// `changeset version` consumes (deletes) the changesets at the release, so they are checked only while they exist (Story 42.1's rule).
const CHANGESET_45_7 = ".changeset/story-45-7-epic-45-burn-down-typescript-and-docs.md";
const CHANGESET_45_6 = ".changeset/story-45-6-epic-45-burn-down-iris-side.md";
const present = (relative: string): boolean => existsSync(path.join(REPO_ROOT, relative));
// The version step renames `## [Unreleased] - Story …` to `## [<version> detail] - Story …`; either heading form is found.
const storyHeadingIndex = (story: string): number =>
  changelogRaw.search(new RegExp(`^## \\[(?:Unreleased|\\d+\\.\\d+\\.\\d+ detail)\\] - Story ${story.replace(".", "\\.")}`, "m"));
const section = squash(changelogRaw.slice(storyHeadingIndex("45.7"), storyHeadingIndex("45.6")));

const SANCTIONS = [
  "S-45.7-same-classes-current",
  "S-45.7-default-profile-bootstrap",
  "S-45.7-block-sql-analyze",
  "S-45.7-compile-check-index",
  "S-45.7-configure-status",
  "S-45.7-mapping-survives-rollback",
];

describe("Story 45.7: SECURITY.md carries the two Planner texts and no email address", () => {
  const policy = squash(read("SECURITY.md"));

  it("the supported-versions text: the colon became a period, a minor can change a behavior for safety, a fix is a new release of the latest 1.x", () => {
    expect(policy).toContain(
      "The latest `1.x` release receives security fixes. An older release is fixed by upgrading to the latest `1.x`. Within a major, the packages, the REST routes and the tool surface only grow. " +
        "A minor release can change a behavior for safety; its CHANGELOG lists each change and what to do. A security fix is published as a new release of the latest 1.x.",
    );
    expect(policy, "the broken join of a literal replacement is not there").not.toContain("upgrading to the latest `1.x`: within a major");
    expect(policy).not.toContain("so an upgrade needs no change on your side");
  });

  it("the reporting text: private reporting rather than email or a public issue or pull request, and no address", () => {
    expect(policy).toContain("Please use private reporting rather than email or a public issue or pull request.");
    expect(policy).not.toContain("No email address is published");
    expect(policy, "no email address anywhere in the policy").not.toMatch(/[\w.+-]+@[\w-]+\.[\w.-]+/);
  });
});

describe("Story 45.7: the CHANGELOG section, the changeset and the doc sentences", () => {
  it("the section names each behavior change with its sanction id, and BOOTSTRAP_VERSION from and to", () => {
    expect(section, "the CHANGELOG has a Story 45.7 section").not.toBe("");
    for (const id of SANCTIONS) {
      expect(section, `the CHANGELOG names ${id}`).toContain(id);
      if (present(CHANGESET_45_7)) expect(squash(read(CHANGESET_45_7)), `the changeset names ${id}`).toContain(id);
    }
    // The literal values, not the live embed: the release's version step restamps the semver of BOOTSTRAP_VERSION
    // (`1.3.0+13.864f12b75f7b`), while the notes keep the value the story recorded.
    expect(section).toContain("`BOOTSTRAP_VERSION` moves from `1.2.0+12.bd38d590c26e` to `1.2.0+13.864f12b75f7b`");
    if (present(CHANGESET_45_7)) {
      expect(squash(read(CHANGESET_45_7))).toContain("`BOOTSTRAP_VERSION` moves from `1.2.0+12.bd38d590c26e` to `1.2.0+13.864f12b75f7b`");
    }
    const embedded = parseBootstrapMarker(BOOTSTRAP_VERSION);
    expect(embedded.kind, "the embed is stamped").toBe("stamped");
    if (embedded.kind === "stamped") {
      // The classes this story recorded, or a later story's (a higher sequence): a restamp at the release keeps both.
      if (embedded.sequence === 13n) expect(embedded.hash, "sequence 13 is the classes this story recorded").toBe("864f12b75f7b");
      else expect(embedded.sequence > 13n, "the embed holds this story's classes or has moved past them").toBe(true);
    }
    expect(section).toContain("No tool, action, governance key, preset, refusal code or input field is added or changed.");
    expect(section).toContain("A failed IPM install leaves `%ALL` and the mapping in place, consistent (`S-45.7-mapping-survives-rollback`, DW-792).");
  });

  it("the changeset bumps the shared package and the five servers minor, and nothing else (while it exists)", () => {
    if (!present(CHANGESET_45_7)) return;
    const head = /^---\s*([\s\S]*?)---/.exec(read(CHANGESET_45_7))?.[1] ?? "";
    expect(head.split("\n").map((line) => line.trim()).filter((line) => line !== "")).toEqual([
      '"@iris-mcp/shared": minor',
      '"@iris-mcp/admin": minor',
      '"@iris-mcp/data": minor',
      '"@iris-mcp/dev": minor',
      '"@iris-mcp/interop": minor',
      '"@iris-mcp/ops": minor',
    ]);
  });

  it("DW-770: the README and the CHANGELOG say that a restamp with the same hash reads current with the install off, and where to tell a real change", () => {
    expect(readme).toContain("After a release that changes the IRIS-side classes (the release's CHANGELOG says so in its IRIS side section, and the hash at the end of `BOOTSTRAP_VERSION` changes; 1.3.0 does)");
    expect(readme).toContain("Every release restamps the semver of `BOOTSTRAP_VERSION`; only the hash names the classes.");
    // Every release restamps the semver, so "BOOTSTRAP_VERSION moves" would name every release as a class change.
    for (const [name, text] of [["README", readme], ["CHANGELOG", squash(changelogRaw)]] as const) {
      expect(text, name).not.toContain("and `BOOTSTRAP_VERSION` moves");
    }
    expect(readme).toContain("A release that only restamps the version (a new semver with the same classes, so the same content hash) asks for nothing");
    expect(readme).not.toContain("After every upgrade of the servers (each release stamps");
    expect(section).toContain("a deployed marker whose hash equals this build's now reads `current`");
    expect(section).toContain("A marker with another hash is refused as before, and with the install on nothing changes");
  });

  it("DW-784: block turns off the three actions; the table says off (stats, running, advise), explain and indexUsage stay on, and the default state is a read", () => {
    expect(readme).toContain("From `1.3.0`, `block` turns those three actions off, and `explain` and `indexUsage`, which run for the SQL the caller supplies, stay on.");
    expect(readme).toContain("`iris_sql_analyze:stats`, `iris_sql_analyze:running` and `iris_sql_analyze:advise` (15 keys)");
    expect(toolSupport).toContain("| `iris_sql_analyze` | residual | off (stats, running, advise) |");
    expect(toolSupport, "Rule #30: the default state is stated at the point of use").toContain("all five actions are reads, enabled by default; under `block` the three are seeded disabled");
    expect(toolSupport).toContain("## PHI data policy scope (as of 2026-11-26)");
    expect(section).toContain("The covered set is 15 keys");
    // The redact warning names only visible tools, and `core` hides iris_sql_analyze.
    expect(section).toContain("Under `redact` the dev server's startup `[WARN]` line also names the three keys when `iris_sql_analyze` is visible (it is under the default `full` preset; `core` hides it).");
    expect(readme).toContain("Under `redact`, the dev server's startup warning also names those three SQL analyzer keys when the SQL analyzer tool is visible (it is under the default `full` preset; `core` hides it).");
    // The unreleased 1.3.0 notes read as one release: the 45.5 bullet agrees with the 15 keys and no longer says "under probe".
    const notes = squash(changelogRaw.slice(storyHeadingIndex("45.7"), storyHeadingIndex("45.4")));
    expect(notes).toContain("`block` turns off the raw-read and code-execution keys (15 in 1.3.0: Story 45.7 adds the `stats`, `running` and `advise` actions of `iris_sql_analyze`");
    expect(notes).not.toContain("the 12 raw-read and code-execution keys");
    expect(notes).not.toContain("which is under probe");
    expect(notes, "the release handoff names the embed this story left").toContain("`1.2.0+13.864f12b75f7b` on the branch after Story 45.7");
  });

  it("DW-784 (Rule #30): the dev server's README names the three actions in its IRIS_DATA_POLICY row and their default state", () => {
    const devReadme = squash(read("packages/iris-dev-mcp/README.md"));
    expect(devReadme).toContain("and from `1.3.0` the `stats`, `running` and `advise` actions of `iris_sql_analyze`");
    expect(devReadme).toContain("Under `IRIS_DATA_POLICY=block`, `stats`, `running` and `advise` are seeded **disabled** (from `1.3.0`)");
  });

  it("DW-794: the CHANGELOG and the changeset say the workload candidates leave out the tool's own traffic", () => {
    expect(section).toContain("**`iris_sql_analyze` `advise` in workload mode no longer analyzes its own traffic (DW-794).**");
    expect(section).toContain("leave out statements that call `%SYSTEM.QUERY_PLAN` or read `INFORMATION_SCHEMA` or `%Dictionary`");
    if (present(CHANGESET_45_7)) expect(squash(read(CHANGESET_45_7))).toContain("The workload candidates leave out the tool's own traffic");
  });

  it("DW-788 and DW-790: the least-privilege bullets say what is true after the fix", () => {
    expect(readme).toContain("It now reads the up-to-date flag of each class that list leaves out through Atelier's `action/index`");
    expect(readme).toContain("Before `1.3.0` it logged `Bootstrap completed with errors: Compile failed: 35 of 35 classes did not compile` on every connect, although every class was compiled");
    expect(readme).toContain("the start logs `Bootstrap completed with errors: Configure failed: <IRIS's own text>`");
    expect(readme).not.toContain("This release does not fix the warning.");
    expect(readme).not.toContain("which this release does not fix");
    expect(squash(changelogRaw), "the 45.6 section no longer says the warning is not fixed").not.toContain("This release does not fix that warning");
    if (present(CHANGESET_45_6)) expect(squash(read(CHANGESET_45_6))).not.toContain("is not fixed in this release");
    expect(section).toContain("`%ODBCOUT(...)`");
    expect(section).toContain("`action/index`");
  });

  it("DW-792: the README's IPM section says a failed install may leave %ALL and the mapping in place, consistent, removed by Uninstall, with the ActivateAll recovery", () => {
    expect(readme).toContain("A failed IPM install may leave `%ALL` and the `ExecuteMCPv2` mapping in place, consistent (from `1.3.0`).");
    expect(readme).toContain("and `Setup.Uninstall()` removes them");
    expect(readme).toContain("run `Do ##class(Config.Namespaces).ActivateAll()` in `%SYS`");
    expect(section).toContain("`Do ##class(Config.Namespaces).ActivateAll()` in `%SYS`");
  });

  it("DW-791: the startup warning says what the 45.6 behavior means", () => {
    const bootstrap = read("packages/shared/src/bootstrap.ts");
    expect(bootstrap).toContain("The web application lookup failed, or the web application is not registered.");
    expect(bootstrap).not.toContain("The account may not be able to read %SYS, or the web application is not registered.");
    expect(section).toContain("`The web application lookup failed, or the web application is not registered.`");
  });
});

// -- DW-792: the IRIS-side change, pinned by source in the class on disk and in the embed -----------------------------

/** One method of a class source: from its `ClassMethod <name>(` line to the next `ClassMethod` or the end. */
function methodOf(source: string, name: string): string {
  const start = source.indexOf(`ClassMethod ${name}(`);
  expect(start, `the class has ClassMethod ${name}`).toBeGreaterThanOrEqual(0);
  const end = source.indexOf("\nClassMethod ", start + 10);
  return source.slice(start, end === -1 ? undefined : end);
}

/** The lines of a method body, from the `{` line on, with no blank or comment-only line. */
function executableLines(method: string): string[] {
  const body = method.slice(method.indexOf("\n{") + 2);
  return body.split("\n").filter((line) => line.trim() !== "" && !line.trim().startsWith(";") && !line.trim().startsWith("///"));
}

const SOURCES: ReadonlyArray<[string, string]> = [
  ["src/ExecuteMCPv2/Setup.cls", read("src/ExecuteMCPv2/Setup.cls")],
  ["the embedded ExecuteMCPv2.Setup.cls", BOOTSTRAP_CLASSES.get("ExecuteMCPv2.Setup.cls") ?? ""],
];

describe.each(SOURCES)("Story 45.7 (DW-792): %s", (_label, source) => {
  it("the guard stays the first executable statement of Configure and of ConfigureMapping (the route refusal comes before anything else)", () => {
    expect(source, "the class source is there").not.toBe("");
    for (const name of ["Configure", "ConfigureMapping"]) {
      const first = executableLines(methodOf(source, name))[0] ?? "";
      expect(first.trim(), `${name}: the first executable statement`).toBe(
        `If ($TLevel > 0) && $IsObject($Get(%request)) Quit $$$ERROR($$$GeneralError, "${name} " _ ..#GUARDTEXT)`,
      );
    }
  });

  it("ConfigureMapping suspends transactions only inside a transaction, after the already-mapped exit, and restores the previous state after the Try/Catch before the Quit", () => {
    const method = methodOf(source, "ConfigureMapping");
    const lines = executableLines(method).map((line) => line.trim());
    const at = (text: string): number => lines.findIndex((line) => line.includes(text));

    const suspend = at("TransactionsSuspended(1)");
    expect(suspend, "the method suspends transactions").toBeGreaterThan(-1);
    expect(lines[suspend - 1], "only when $TLevel > 0").toBe("If $TLevel > 0 {");
    expect(lines[suspend], "the previous state is kept").toBe("Set tPreviousSuspended = ##class(%SYSTEM.Process).TransactionsSuspended(1)");
    expect(lines[suspend + 1], "and the fact that this call suspended").toBe("Set tSuspendedHere = 1");

    expect(suspend, "after the already-mapped exit").toBeGreaterThan(at("Quit  ; Already mapped"));
    expect(suspend, "before the %ALL creation").toBeLessThan(at('Config.Namespaces).Create("%ALL"'));
    expect(suspend, "before the mapping creation").toBeLessThan(at('Config.MapPackages).Create("%ALL", "ExecuteMCPv2"'));
    expect(suspend, "before the mapping's record entry").toBeLessThan(at('WriteRecord(pNamespace, "mapping", "created", tDatabase)'));

    const restore = at("If tSuspendedHere Do ##class(%SYSTEM.Process).TransactionsSuspended(tPreviousSuspended)");
    expect(restore, "the previous state is restored").toBeGreaterThan(-1);
    expect(restore, "after the Catch").toBeGreaterThan(at("} Catch ex {"));
    expect(lines[restore + 1], "and immediately before the method's Quit").toBe("Quit tSC");
    expect(method.match(/TransactionsSuspended\(/g)?.length, "exactly two calls: suspend and restore, nothing else").toBe(2);
  });

  it("the SqlProc set is unchanged: Configure, ConfigureMapping, EnsureUnitTestRoot, GetBootstrapVersion and IsConfigured", () => {
    const procedures = [...source.matchAll(/^ClassMethod (\w+)\([^)]*\)[^\n]*\[ SqlProc \]/gm)].map((match) => match[1]);
    expect(procedures.sort()).toEqual(["Configure", "ConfigureMapping", "EnsureUnitTestRoot", "GetBootstrapVersion", "IsConfigured"]);
  });
});

describe("Story 45.7: the roster of SetupTest", () => {
  it("SetupTest has 11 Test methods, one of them the rollback test, and the integration roster says 11", () => {
    const test = read("src/ExecuteMCPv2/Tests/SetupTest.cls");
    expect(test.match(/^Method Test/gm)?.length).toBe(11);
    expect(test).toContain("Method TestMappingSurvivesRollbackOfOuterTransaction()");
    expect(read("packages/iris-dev-mcp/src/__tests__/custom-rest.integration.test.ts")).toContain('["ExecuteMCPv2.Tests.SetupTest", 11]');
  });
});
