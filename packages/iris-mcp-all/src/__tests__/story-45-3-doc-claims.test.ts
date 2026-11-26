/**
 * Story 45.3 (AC 45.3.9; project rules #30, #43, #45) - the documents say what the careful uninstall does, and each load-bearing claim has an
 * oracle other than the document itself:
 *  - the README section "Removing the IRIS Side" names the one-liner, the privilege, the order with IPM, the no-record case with both manual
 *    commands, the warning that deleting `%ALL` removes every mapping, the running-server warning and the install record; it does not claim
 *    that an `EXECUTE` grant protects the `Setup` methods (DW-771); its commands are the ones the class source and the report use;
 *  - `Setup.cls` (source): `Uninstall` and every helper are not SQL procedures, and the five install methods keep `[ SqlProc ]` and their
 *    signatures (the compiled-class pin runs on a throwaway: `SetupUninstallTest`);
 *  - the CHANGELOG section (found by title) names the sanction id, the record, the one-liner, the no-record rule, the IPM order and the
 *    `BOOTSTRAP_VERSION` move; the changeset (asserted only while it exists) is a minor bump of the shared package that names the sanction id.
 * Needs no IRIS.
 */

import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { REPO_ROOT } from "./pack-fixture";
import { parseBootstrapMarker } from "../../../shared/src/bootstrap-version.js";
import { BOOTSTRAP_VERSION } from "../../../shared/src/bootstrap-classes.js";

const read = (relative: string): string => readFileSync(path.join(REPO_ROOT, relative), "utf8");
const squash = (text: string): string => text.replace(/\s+/g, " ");

const readme = read("README.md");
const changelog = read("CHANGELOG.md");
const setup = read("src/ExecuteMCPv2/Setup.cls");
const changesetPath = ".changeset/story-45-3-careful-uninstall-of-the-iris-side.md";
const SANCTION = "`S-45.3-careful-uninstall`";

/** The text of the README section whose heading (at `level`) is exactly `title`, up to the next heading of the same or a higher level. */
function section(document: string, level: number, title: string): string {
  const lines = document.split("\n");
  const out: string[] = [];
  let fenced = false;
  let inside = false;
  for (const line of lines) {
    if (/^\s*(```|~~~)/.test(line)) fenced = !fenced;
    const heading = fenced ? null : /^(#{1,6})\s+(.*?)\s*$/.exec(line);
    if (heading !== null) {
      const depth = (heading[1] as string).length;
      if (inside && depth <= level) break;
      if (!inside && depth === level && heading[2] === title) inside = true;
    }
    if (inside) out.push(line);
  }
  return out.join("\n");
}

describe("Story 45.3: the README section 'Removing the IRIS Side'", () => {
  const removing = section(readme, 3, "Removing the IRIS Side");
  const flat = squash(removing);

  it("exists, directly after the IPM section, and the IPM section points to it", () => {
    expect(removing).not.toBe("");
    expect(readme.indexOf("### Removing the IRIS Side")).toBeGreaterThan(readme.indexOf("### Optional: Install the IRIS-Side Classes with IPM"));
    expect(readme.indexOf("### Removing the IRIS Side")).toBeLessThan(readme.indexOf("## Multiple Servers & Governance"));
    expect(squash(readme)).toContain("[Removing the IRIS Side](#removing-the-iris-side)");
  });

  it("gives the one-liner in a code block, the privilege it needs, and says it is not an SQL procedure, a tool, a CLI command or a REST route", () => {
    expect(removing).toContain("```\nDo ##class(ExecuteMCPv2.Setup).Uninstall()\n```");
    expect(flat).toContain("It needs an account with `%Admin_Manage` and write access to the databases of the namespaces that hold the classes.");
    expect(flat).toContain("It is not a tool, not a CLI command and not a REST route, and it is not an SQL procedure");
  });

  it("says to stop the servers or turn the automatic install off before running it, and to restart only afterwards", () => {
    expect(flat).toContain("Before you run it, stop the servers that use the instance, or turn their automatic install off.");
    expect(flat).toContain("`IRIS_AUTO_INSTALL=false` (or a profile's `autoInstall: false`)");
    expect(flat).toContain("restart the servers only afterwards");
  });

  it("lists what it removes in the order the code runs, and what it leaves", () => {
    for (const needle of [
      "1. the `/api/executemcp/v2` web application;",
      "2. the `ExecuteMCPv2` package mapping in the `%ALL` namespace",
      "3. the `%ALL` namespace, only when the install created it **and** nothing else is mapped in it;",
      "4. `^UnitTestRoot` in each namespace where the install set it, only while its value is the one the install set;",
      "5. the `ExecuteMCPv2` classes, in every namespace that holds a copy of its own",
      "6. the install records, last, only when no step failed.",
    ]) {
      expect(flat, needle).toContain(needle);
    }
    // Decision #168 (DW-775): the classes go after %ALL and ^UnitTestRoot and only when every step before them succeeded; the source runs them in that order.
    expect(flat).toContain("The classes go only when every step before them succeeded, because the `Setup` class that runs the command is among them");
    const body = setup.slice(setup.indexOf("ClassMethod Uninstall("), setup.indexOf("ClassMethod DecideClasses("));
    const steps = ["; Step 3: the %ALL namespace", "; Step 4: ^UnitTestRoot", "; Step 5: the classes", "; Step 6: the records"].map((marker) => body.indexOf(marker));
    expect(steps.every((position) => position > 0), "every step marker is in Uninstall").toBe(true);
    expect([...steps].sort((a, b) => a - b), "the steps run in the documented order").toEqual(steps);
    expect(flat).toContain("shadowed copies included");
    expect(flat).toContain("A namespace where IPM installed the classes is left too, because IPM owns them");
    expect(flat).toContain("a `dev` copy loaded by hand, or a copy with no release marker");
    // The oracle for "even where an install record exists": the ownership leg seeds a record naming the release marker under both left copies.
    expect(flat).toContain("is left alone and named, with the command to remove it, even where an install record exists");
    expect(read("packages/iris-mcp-all/src/__tests__/story-45-3-uninstall-round-trip-live-gate.test.ts")).toContain(
      'leg("ownership: a dev Setup and a marker-less copy, each over an install record that names a release marker, are both left byte for byte untouched"',
    );
  });

  it("documents the install record and the failure behavior", () => {
    expect(flat).toContain("`^ExecuteMCPv2.InstallRecord`");
    expect(flat).toContain("The bootstrap and IPM's `Configure` and `ConfigureMapping` write it alike.");
    expect(flat).toContain("the report says `Failed:` with IRIS's text, the records stay, and the command returns an error status");
    expect(flat).toContain("the command leaves the classes, `%ALL`, `^UnitTestRoot` and the records alone, so you can fix the cause and run it again");
  });

  it("gives the IPM order: this command first, then zpm uninstall, and why the other order fails", () => {
    expect(flat).toContain('Run this command first, then `zpm "uninstall iris-execute-mcp-v2"` in the namespace IPM installed it in.');
    expect(flat).toContain('The other order fails: `zpm "uninstall iris-execute-mcp-v2"` deletes the `Setup` class, so the command is gone.');
  });

  it("gives the no-record case with both manual commands and the warning that deleting %ALL removes every mapping", () => {
    expect(flat).toContain("An install by `1.2.0` or earlier has no record, and a server that upgrades it in place does not add one.");
    expect(flat, "the IPM upgrade of a 1.2.0 install writes a found record, and the README says what that means").toContain(
      "says only what that later install did. It found `%ALL` and the mapping already there",
    );
    expect(flat).toContain("it never removes `%ALL` or `^UnitTestRoot`");
    expect(removing).toContain('Do ##class(Config.Namespaces).Delete("%ALL")');
    expect(removing).toContain("Kill ^UnitTestRoot");
    expect(flat).toContain("**Deleting `%ALL` removes every mapping in it, not only ours.**");
    expect(flat).toContain("Look at what else is mapped there first");
  });

  it("keeps the by-hand cleanup of an IPM uninstall that already ran, with both calls (DW-690)", () => {
    expect(removing).toContain('Do ##class(Security.Applications).Delete("/api/executemcp/v2")');
    expect(removing).toContain('Do ##class(Config.MapPackages).Delete("%ALL","ExecuteMCPv2")');
  });

  it("says the boundary is the account's privileges and never claims that an EXECUTE grant protects the Setup methods (decision #166, DW-771)", () => {
    expect(flat).toContain("The boundary is the IRIS account's privileges, not an `EXECUTE` grant on the `Setup` methods");
    expect(flat).toContain("Do not rely on an SQL `EXECUTE` grant to protect the `Setup` methods");
    expect(flat).toContain("does not check SQL privileges");
    // No sentence in the section says that EXECUTE protects, guards, restricts or limits the Setup methods, except the one that denies it.
    const claims = flat.split(/(?<=[.:;])\s/).filter((sentence) => /EXECUTE/.test(sentence) && /\b(protects?|guards?|restricts?|limits?|secures?)\b/i.test(sentence));
    expect(claims.filter((sentence) => !/not an `EXECUTE` grant|Do not rely on an SQL `EXECUTE` grant/.test(sentence))).toEqual([]);
  });

  it("states the scratch global of the coverage tools and that the command leaves it", () => {
    expect(flat).toContain("`^IRIS.TempExecuteMCPv2Coverage` lives in IRISTEMP");
    expect(flat).toContain("The command does not touch it.");
  });
});

/**
 * QA pins (Rule #19, #36, #59). Each README sentence below makes a claim about the command's behavior; each is pinned together with the oracle that
 * can fail it (the gate leg that runs the claim, or the class source), so a sentence cannot drift from what the command does. A pin on a sentence
 * that a later wording change touches is meant to move with it: the oracle half must still hold.
 */
describe("Story 45.3 QA: the README claims against their oracles", () => {
  const gateSource = read("packages/iris-mcp-all/src/__tests__/story-45-3-uninstall-round-trip-live-gate.test.ts");
  const removing = squash(section(readme, 3, "Removing the IRIS Side"));
  const uninstallComment = (() => {
    const start = setup.indexOf("/// Remove the IRIS side of the suite");
    const end = setup.indexOf("ClassMethod Uninstall(");
    return start >= 0 && end > start ? squash(setup.slice(start, end)) : "";
  })();
  const changelogEntry = (() => {
    const start = changelog.indexOf("## [Unreleased] - Story 45.3: Careful Uninstall of the IRIS Side");
    return squash(changelog.slice(start, changelog.indexOf("\n## ", start + 1)));
  })();
  const changeset = existsSync(path.join(REPO_ROOT, changesetPath)) ? squash(read(changesetPath)) : "";

  it("never promises that the command is idempotent: after a full removal the class is gone, so the command cannot run again (the gate pins <CLASS DOES NOT EXIST>)", () => {
    expect(uninstallComment, "the doc comment of Uninstall was found").toContain("A repeat run removes nothing more");
    for (const [name, text] of [["README section", removing], ["CHANGELOG entry", changelogEntry], ["changeset", changeset], ["Uninstall doc comment", uninstallComment]] as const) {
      expect(text, `${name} does not claim idempotence`).not.toMatch(/idempoten/i);
    }
    expect(removing).toContain("A repeat run removes nothing more while a copy of the `Setup` class remains (a copy left for IPM, or a foreign one)");
    expect(removing).toContain("after a full removal the class is gone, so there is nothing to run");
    expect(uninstallComment).toContain("after a full removal the class is gone, so the call raises");
    expect(uninstallComment).toContain("<code>&lt;CLASS DOES NOT EXIST&gt;</code> and there is nothing left to do");
    // The oracles: the plain leg's second terminal call raises <CLASS DOES NOT EXIST> and changes nothing; the IPM-owned leg's second run keeps the class
    // and returns OK while removing nothing more.
    expect(gateSource).toContain('expect(second).toContain("CLASS DOES NOT EXIST")');
    expect(gateSource).toMatch(/a second run removes nothing more[\s\S]{0,200}statusOk[\s\S]{0,120}toBe\(true\)/);
  });

  it("warns that deleting %ALL removes every mapping in it, in the README, the CHANGELOG and the report the command prints", () => {
    expect(removing).toContain("**Deleting `%ALL` removes every mapping in it, not only ours.**");
    expect(changelogEntry).toContain("the warning that deleting `%ALL` removes every mapping in it");
    expect(setup).toContain("This deletes %ALL together with every mapping in it, so check what else is mapped there first");
    expect(gateSource, "the no-record leg asserts the report line that carries the warning").toContain("This deletes %ALL together with every mapping in it, so check what else is mapped there first");
  });

  it("never says an EXECUTE grant protects the Setup methods, in the README, the CHANGELOG or the changeset; the boundary is the account's privileges", () => {
    for (const [name, text] of [["README section", removing], ["CHANGELOG entry", changelogEntry], ["changeset", changeset]] as const) {
      const claims = text.split(/(?<=[.:;])\s/).filter((sentence) => /EXECUTE/.test(sentence) && /\b(protects?|guards?|restricts?|limits?|secures?|protection)\b/i.test(sentence));
      expect(
        claims.filter((sentence) => !/not an `EXECUTE` grant|Do not rely on an SQL `EXECUTE` grant|is not a protection|never a protection|not a protection/.test(sentence)),
        `${name} has no sentence that says EXECUTE protects the Setup methods`,
      ).toEqual([]);
    }
    expect(changelogEntry).toContain("an `EXECUTE` grant is not a protection for the `Setup` methods");
  });

  it("says a later failure keeps the classes and the records, and a re-run finishes and reports only what it removed (decision #168: the failing-step legs)", () => {
    expect(removing).toContain(
      "but the classes and the records stay, the `Setup` class among them: fix the cause and run the same command again, and it finishes and reports only what that run removed",
    );
    expect(removing, "the README no longer tells the user to put the install back first").not.toContain("put the install back");
    expect(gateSource).toContain("the independent steps ran: %ALL and ^UnitTestRoot are gone");
    expect(gateSource).toContain('"Left: install records (a step failed, so the records stay and the command can run again)"');
    expect(gateSource).toContain('leg("a failing ^UnitTestRoot step (a database mounted read-only): the classes and the records stay, and a re-run after the fix finishes and names only what it removed"');
    expect(setup).toContain('"an earlier step failed, so the classes stay and the command can run again once it is fixed"');
  });

  it("tells a user who sees <CLASS DOES NOT EXIST> that the uninstall already finished, with the one-line check the gate runs live (decision #168)", () => {
    expect(removing).toContain("**If the command fails with `<CLASS DOES NOT EXIST>`, the uninstall already finished in that namespace and nothing is left to do.**");
    expect(removing).toContain("it prints `record=0 webapp=0` when the install record of that namespace and the `/api/executemcp/v2` web application are both gone");
    const check = /```\n(Set ns=\$NAMESPACE [^\n]+)\n```/.exec(section(readme, 3, "Removing the IRIS Side"))?.[1];
    expect(check, "the README gives the check as one line in a code block").toBeDefined();
    // The oracle: the plain leg runs exactly this line after the full removal and the <CLASS DOES NOT EXIST> second call, and expects record=0 webapp=0
    // (and record=10 webapp=1 before the removal, so the check can vary).
    expect(gateSource).toContain(`const DONE_CHECK =\n  '${check as string}';`);
    expect(gateSource).toContain('toEqual(["record=0 webapp=0", "NS=USER"])');
    expect(gateSource).toContain('toEqual(["record=10 webapp=1"])');
  });

  it("says the last line is the running-server warning, and the source prints it last", () => {
    expect(removing).toContain("Its last line repeats the warning above about running servers.");
    const body = setup.slice(setup.indexOf("ClassMethod ReportLines("));
    expect(body.slice(0, body.indexOf("Quit tLines")).trimEnd().endsWith("Do tLines.%Push(..ServerLine())")).toBe(true);
    expect(gateSource).toContain("SERVER_LINE,\n    ]");
  });

  it("says a preset ^UnitTestRoot is not mentioned, and the gate leg pins that report", () => {
    // Story 45.6 (DW-780): the rule is per namespace, so the README says "in a namespace whose own install record exists" and names the other case.
    expect(removing).toContain("except a preset `^UnitTestRoot` in a namespace whose own install record exists, which it does not mention, because the install never touched it there");
    expect(removing).toContain("A `^UnitTestRoot` in a namespace that holds no install record of its own is reported with its command even when another namespace holds one");
    expect(gateSource).toContain("^UnitTestRoot in a namespace with no record of its own, while another namespace holds one (DW-780)");
    expect(gateSource).toContain("^UnitTestRoot set before the install: the value survives and is not reported");
  });

  it("says an account without %Admin_Manage gets a Failed: line for each step it cannot do and nothing is removed (the least-privilege leg asserts status, items, text and snapshot)", () => {
    expect(removing).toContain("an account without `%Admin_Manage` gets a `Failed:` line for each step it cannot do and nothing is removed");
    // The leg that proves it asserts all four: an error status, the failed items, IRIS's text on each, and an unchanged snapshot (records included).
    const leg = gateSource.slice(gateSource.indexOf('leg("least privilege:'));
    expect(leg).toContain("expect(noSys.statusOk).toBe(false)");
    expect(leg).toContain('expect(noSys.report?.failed.map((entry) => entry["item"]))');
    expect(leg).toContain('toContain("PROTECT")');
    expect(leg).toContain('expect(differences(installed, snapshot()), "the instance is unchanged").toEqual([])');
  });

  it("says its custom-REST tools answer IRIS_SIDE_NOT_INSTALLED after a removal with the automatic install off, a code the server defines", () => {
    expect(removing).toContain("its custom-REST tools answer `IRIS_SIDE_NOT_INSTALLED` until someone reinstalls");
    expect(read("packages/shared/src/refusals.ts")).toContain("IRIS_SIDE_NOT_INSTALLED");
  });

  it("says the record is written from 1.3.0, which is the next minor of the shared package while the changeset is pending", () => {
    expect(removing).toContain("From `1.3.0` a new install writes down what it created");
    // The version oracle holds only while the changeset is pending: `changeset version` consumes it and moves the package version (the
    // story-42-1 "after the release" simulation also rewrites versions), so after the release the sentence alone is pinned.
    if (existsSync(path.join(REPO_ROOT, changesetPath))) {
      const [major, minor] = (JSON.parse(read("packages/shared/package.json")) as { version: string }).version.split(".").map(Number) as [number, number];
      expect(`${major}.${minor + 1}.0`, "the pending minor changeset makes the next release 1.3.0").toBe("1.3.0");
    }
  });

  it("gives the manual commands the report prints, character for character (README, source and gate agree)", () => {
    expect(removing).toContain('Do ##class(Config.Namespaces).Delete("%ALL")');
    expect(setup).toContain('in %SYS: Do ##class(Config.Namespaces).Delete(""%ALL""). This deletes %ALL together');
    expect(gateSource).toContain('in %SYS: Do ##class(Config.Namespaces).Delete("%ALL"). This deletes %ALL together');
    expect(removing).toContain("Kill ^UnitTestRoot");
    expect(gateSource).toContain("in USER: Kill ^UnitTestRoot");
  });
});

describe("Story 45.3: the claims against the class source", () => {
  it("the report lines the README describes are the ones Setup.cls prints, and its running-server line is the one it quotes", () => {
    for (const prefix of ['"Removed: "', '"Left: "', '"Failed: "', '". To remove it by hand: "']) expect(setup, prefix).toContain(prefix);
    expect(setup).toContain("IRIS_AUTO_INSTALL=false (or remove it from the client configuration) before removing the IRIS side.");
    expect(setup).toContain('Do ##class(Config.Namespaces).Delete(""%ALL"")');
    expect(setup).toContain("Kill ^UnitTestRoot");
  });

  it("Uninstall and every new helper are not SQL procedures; the five install methods keep [ SqlProc ] and their signatures", () => {
    const methods = [...setup.matchAll(/^ClassMethod (\w+)\(([^\n]*)$/gm)].map((match) => ({ name: match[1] as string, rest: match[2] as string }));
    const sqlProcs = methods.filter((method) => /\[\s*SqlProc\s*\]/.test(method.rest)).map((method) => method.name).sort();
    expect(sqlProcs).toEqual(["Configure", "ConfigureMapping", "EnsureUnitTestRoot", "GetBootstrapVersion", "IsConfigured"]);
    expect(setup).toContain('ClassMethod Configure(pNamespace As %String = "") As %Status [ SqlProc ]');
    expect(setup).toContain('ClassMethod ConfigureMapping(pNamespace As %String = "") As %Status [ SqlProc ]');
    expect(setup).toContain("ClassMethod IsConfigured() As %Boolean [ SqlProc ]");
    expect(setup).toContain("ClassMethod EnsureUnitTestRoot() As %String [ SqlProc ]");
    expect(setup).toContain("ClassMethod GetBootstrapVersion() As %String [ SqlProc ]");
    expect(setup).toContain("ClassMethod Uninstall(pVerbose As %Boolean = 1, Output pReport As %DynamicObject) As %Status\n");
    expect(methods.map((method) => method.name)).toContain("Uninstall");
  });

  it("no unit test class calls the destructive Uninstall() (a run on a shared instance would remove the suite)", () => {
    for (const file of ["src/ExecuteMCPv2/Tests/SetupTest.cls", "src/ExecuteMCPv2/Tests/SetupUninstallTest.cls"]) {
      const text = read(file);
      const code = text.split("\n").filter((line) => !/^\s*(\/\/\/|;|\/\/)/.test(line)).join("\n");
      expect(code, file).not.toMatch(/\)\.Uninstall\(/);
    }
  });
});

describe("Story 45.3: the CHANGELOG entry", () => {
  const start = changelog.indexOf("## [Unreleased] - Story 45.3: Careful Uninstall of the IRIS Side");
  const end = changelog.indexOf("\n## ", start + 1);
  const entry = squash(changelog.slice(start, end));

  it("sits above the Story 45.2 entry and names the sanction id, the record, the one-liner, the no-record rule and the IPM order", () => {
    expect(start).toBeGreaterThan(-1);
    expect(start).toBeLessThan(changelog.indexOf("## [Unreleased] - Story 45.2: Auto-Install Setting, Off Under Read-Only"));
    expect(entry).toContain(SANCTION);
    expect(entry).toContain("`^ExecuteMCPv2.InstallRecord`");
    expect(entry).toContain("`Do ##class(ExecuteMCPv2.Setup).Uninstall()`");
    expect(entry).toContain("never removes `%ALL` or `^UnitTestRoot`");
    expect(entry).toContain('Run the command first, then `zpm "uninstall iris-execute-mcp-v2"`');
    expect(entry).toContain("`Uninstall` is never an SQL procedure.");
    expect(entry).toContain("IRIS_AUTO_INSTALL=false");
  });

  it("records the BOOTSTRAP_VERSION move from the 45.2 value to a value the embed holds or has moved past", () => {
    expect(entry).toContain("`1.2.0+8.5cedcac20ae9` to `1.2.0+10.109d0129528f`");
    const embedded = parseBootstrapMarker(BOOTSTRAP_VERSION);
    expect(embedded.kind).toBe("stamped");
    if (embedded.kind === "stamped") expect(embedded.sequence >= 10n, "the embed is the story's value or a later one").toBe(true);
  });
});

describe("Story 45.3: the changeset", () => {
  // `changeset version` consumes (deletes) the file and moves its text into the generated package changelogs, so it is checked while it exists.
  const present = existsSync(path.join(REPO_ROOT, changesetPath));

  it.skipIf(!present)("is a minor bump of the shared package (the fixed group makes it the release's minor), names the sanction id and moves nothing else", () => {
    const text = read(changesetPath);
    expect(text).toMatch(/^---\n"@iris-mcp\/shared": minor\n---\n/);
    expect(text).not.toMatch(/major|patch/);
    expect(text).toContain("S-45.3-careful-uninstall");
    expect(text).toContain("1.2.0+8.5cedcac20ae9");
  });
});
