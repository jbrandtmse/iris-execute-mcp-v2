/**
 * Story 45.6 QA (Rules #19, #59; doc claims against code) -- the sentences Story 45.6 wrote or moved in the README and the CHANGELOG, each
 * held to an oracle that is not the document:
 *
 *   - the refusal the README and the CHANGELOG describe is the guard text of the embedded `Setup` class (what it says changed nothing, and the
 *     three ways to run the call), and both methods open with the guard;
 *   - the reasons the uninstall report gives for a found `%ALL` and for a `^UnitTestRoot` without a record of its own are the strings of the
 *     embedded class, and the README and the CHANGELOG quote them;
 *   - "`iris_execute_command` and `iris_execute_classmethod` are off under the read-only preset" is the preset's own decision over the
 *     tools' classification (`presetSeed` over `BASELINE_ACTION_CLASSIFICATIONS`), with a read tool as the contrast;
 *   - "`Compile failed: 35 of 35 classes did not compile`" is the text the bootstrap builds for as many classes as the embed holds, under the
 *     `Bootstrap completed with errors:` prefix the server logs, and the README names it for the install-off outcome too (a least-privilege
 *     account logs it with the install off as well as on, run live on a throwaway);
 *   - the README no longer says that an account that cannot read `%SYS` reads `unconfigured` when the web application is registered.
 *
 * Reads the repository's documents, sources and the built shared dist: no docker, no IRIS.
 */

import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { REPO_ROOT } from "./pack-fixture";
import { BOOTSTRAP_CLASSES } from "../../../shared/src/bootstrap-classes.js";
import { BASELINE_ACTION_CLASSIFICATIONS } from "../../../shared/src/baseline-classifications.js";
import { presetSeed } from "../../../shared/src/governance.js";

const read = (relative: string): string => readFileSync(path.join(REPO_ROOT, relative), "utf8");
const squash = (text: string): string => text.replace(/\s+/g, " ");

const readme = squash(read("README.md"));
const changelog = squash(read("CHANGELOG.md"));
const setup = BOOTSTRAP_CLASSES.get("ExecuteMCPv2.Setup.cls") ?? "";
const bootstrapSource = read("packages/shared/src/bootstrap.ts");
const serverBaseSource = read("packages/shared/src/server-base.ts");

/** The value of the `Parameter <name> = "...";` line of the embedded Setup class. */
function parameter(name: string): string {
  return new RegExp(`^Parameter ${name} = "([^"]*)";$`, "m").exec(setup)?.[1] ?? "";
}

describe("Story 45.6 QA: the documents against the embedded Setup class", () => {
  it("the refusal: both methods open with the guard, and its text is what the README and the CHANGELOG say it says", () => {
    const guard = parameter("GUARDTEXT");
    expect(guard, "the embed carries the guard text").not.toBe("");
    expect(guard).toContain("changed nothing");
    expect(guard).toContain("inside a transaction during a web request");
    expect(guard).toContain("an IRIS terminal");
    expect(guard).toContain("the automatic install or IPM");
    expect(setup).toContain('If ($TLevel > 0) && $IsObject($Get(%request)) Quit $$$ERROR($$$GeneralError, "Configure " _ ..#GUARDTEXT)');
    expect(setup).toContain('If ($TLevel > 0) && $IsObject($Get(%request)) Quit $$$ERROR($$$GeneralError, "ConfigureMapping " _ ..#GUARDTEXT)');
    expect(readme).toContain("an error that says it changed nothing and that the configuration is to be run from an IRIS terminal, the automatic install or IPM");
    expect(changelog).toContain("an IRIS terminal, the automatic install or IPM");
  });

  it("the report text: the found-%ALL reason, its command and the no-record ^UnitTestRoot reason are the class's strings, and both documents quote them", () => {
    const found = "the install found it already there; an install by 1.2.0 or earlier that created it writes no record";
    const command = 'Do ##class(Config.Namespaces).Delete(""%ALL"")';
    expect(setup, "DecideAll's found branch").toContain(`Set pReason = "${found}"`);
    expect(setup, "DecideAll's manual command").toContain(command);
    expect(readme).toContain(found);
    expect(changelog).toContain(found);
    expect(readme).toContain('`Delete("%ALL")` command');
    // The per-namespace rule: the caller passes the namespace's own record flag, and the reason names the namespace.
    expect(setup).toContain('..DecideUnitTestRoot(tScan(tN, "recUTR"), tScan(tN, "utrCurrent"), tScan(tN, "hasRecord"))');
    expect(setup).toContain('"no install record in " _ tN _ " says the install set it"');
    expect(changelog).toContain("`Left: ^UnitTestRoot (<ns>) (no install record in <ns> says the install set it ...)`");
    expect(readme).toContain("A `^UnitTestRoot` in a namespace that holds no install record of its own is reported with its command even when another namespace holds one");
  });

  it("IsConfigured: the fallback is the CSP application lookup the CHANGELOG names", () => {
    expect(setup).toContain('Set tResult = ($System.CSP.GetAppName(..#WEBAPP _ "/") = (..#WEBAPP _ "/"))');
    expect(setup).toContain("Set tResult = ..WebAppRegistered()");
    // The fallback runs after the Try/Catch, in the caller's namespace, whenever Exists did not answer 1 (an account that can enter
    // %SYS but may not read Security.Applications gets 0 without an exception), and the Catch restores the namespace first (DW-789).
    const isConfigured = /^ClassMethod IsConfigured\(\)[\s\S]*?^}/m.exec(setup)?.[0] ?? "";
    expect(isConfigured, "the embed carries IsConfigured").not.toBe("");
    expect(isConfigured).toMatch(/\} Catch ex \{\n\s+Set \$NAMESPACE = tOrigNS\n/);
    expect(isConfigured).toMatch(/\n\s+\}\n\s+If 'tResult Set tResult = \.\.WebAppRegistered\(\)\n\s+Quit tResult\n\}$/);
    expect(changelog).toContain("`$System.CSP.GetAppName`");
    expect(readme).toContain("falls back to the CSP application lookup");
  });
});

describe("Story 45.6 QA: the read-only claim and the compile warning against their oracles", () => {
  it("iris_execute_command and iris_execute_classmethod are writes, so the read-only preset turns them off, and a read tool stays on", () => {
    const none = new Map<string, "read" | "write">();
    for (const tool of ["iris_execute_command", "iris_execute_classmethod"]) {
      expect(BASELINE_ACTION_CLASSIFICATIONS[tool], `${tool} is classified a write`).toBe("write");
      expect(presetSeed(tool, "read-only", none, BASELINE_ACTION_CLASSIFICATIONS), `${tool} under the read-only preset`).toBe(false);
      expect(presetSeed(tool, "full", none, BASELINE_ACTION_CLASSIFICATIONS), `${tool} under the full preset passes through`).toBeUndefined();
    }
    expect(presetSeed("iris_doc_get", "read-only", none, BASELINE_ACTION_CLASSIFICATIONS), "the contrast: a read tool stays on").toBe(true);
    expect(readme).toContain("`iris_execute_command` and `iris_execute_classmethod`, are off under the read-only preset.");
    expect(changelog).toContain("Under the read-only preset `iris_execute_command` and `iris_execute_classmethod` are off, because they are writes.");
  });

  it("the compile warning: the documented count is the embed's class count, under the prefix the server logs, and the install-off outcome names it too", () => {
    expect(bootstrapSource).toContain("`Compile failed: ${report.notCompiled.length} of ${total} classes did not compile: ${names}${context}`");
    expect(serverBaseSource).toContain("`Bootstrap completed with errors: ${result.errors.join(\"; \")}`");
    const count = BOOTSTRAP_CLASSES.size;
    const text = `Bootstrap completed with errors: Compile failed: ${count} of ${count} classes did not compile`;
    expect(readme, "the install-on outcome").toContain(`\`${text}\` on every connect`);
    expect(changelog).toContain(`\`${text}\``);
    // A least-privilege account logs it with the install off as well (run live), so the install-off outcome must not read as warning-free.
    const installOff = readme.slice(readme.indexOf("The IRIS side is installed and current, install off"), readme.indexOf("The web application is not registered, install off"));
    expect(installOff, "found the install-off outcome").toContain("logs no warning about the web application");
    expect(installOff, "and it names the compile warning").toContain(`\`Compile failed: ${count} of ${count} classes did not compile\``);
  });

  it("the README no longer says that an account that cannot read %SYS reads unconfigured when the web application is registered", () => {
    expect(readme).not.toContain("reads `unconfigured` even when the web application exists");
    expect(readme).toContain("reads `current` when the web application is registered");
  });

  it("the unreleased notes agree: neither the CHANGELOG nor a pending changeset says such an account reads unconfigured when the web application exists", () => {
    // The 1.3.0 notes hold Story 45.2's section and Story 45.6's; 45.6 made IsConfigured answer for a least-privilege account.
    const stale = /cannot read `%SYS`[^.]*reads `unconfigured` even when the web application exists|cannot tell "the web application is not registered" apart from "I cannot see it"/;
    expect(changelog, "CHANGELOG.md").not.toMatch(stale);
    for (const file of ["story-45-2-auto-install-setting-off-under-read-only.md", "story-45-6-epic-45-burn-down-iris-side.md"]) {
      const changeset = path.join(REPO_ROOT, ".changeset", file);
      if (existsSync(changeset)) expect(squash(readFileSync(changeset, "utf8")), file).not.toMatch(stale);
    }
    expect(changelog).toContain("Story 45.6 makes `IsConfigured` answer for it through the CSP application lookup, so it reads `current`.");
    // Both kinds of account the fallback serves are named where the behavior is described.
    expect(changelog).toContain("one that can but may not read `Security.Applications`");
    expect(readme).toContain("it cannot switch to `%SYS`, or it can but may not read `Security.Applications`");
  });
});
