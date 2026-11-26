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
      "2. the `ExecuteMCPv2` package mapping in the `%ALL` namespace;",
      "4. the `%ALL` namespace, only when the install created it **and** nothing else is mapped in it;",
      "5. `^UnitTestRoot` in each namespace where the install set it, only while its value is the one the install set;",
      "6. the install records, last.",
    ]) {
      expect(flat, needle).toContain(needle);
    }
    expect(flat).toContain("shadowed copies included");
    expect(flat).toContain("A namespace where IPM installed the classes is left too, because IPM owns them");
    expect(flat).toContain("a `dev` copy loaded by hand, or a copy with no release marker");
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
    expect(flat).toContain("An install by `1.2.0` or earlier has no record, and upgrading it in place does not add one.");
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
    expect(entry).toContain("`1.2.0+8.5cedcac20ae9` to `1.2.0+9.db691c6fee3d`");
    const embedded = parseBootstrapMarker(BOOTSTRAP_VERSION);
    expect(embedded.kind).toBe("stamped");
    if (embedded.kind === "stamped") expect(embedded.sequence >= 9n, "the embed is the story's value or a later one").toBe(true);
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
