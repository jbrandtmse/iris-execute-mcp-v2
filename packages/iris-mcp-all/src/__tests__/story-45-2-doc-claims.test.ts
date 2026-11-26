/**
 * Story 45.2 QA (AC 45.2.6; project rules #30, #43, #45) - the documents say what the automatic-install setting does, and each claim
 * has an oracle other than the document itself:
 *  - the README variable table has one `IRIS_AUTO_INSTALL` row whose parse claims (case-insensitive, empty is unset, anything else
 *    fails startup naming the variable) are run against the built `parseOperatorAutoInstall`, and whose precedence and conflict claims are
 *    run against the built `applyAutoInstall`;
 *  - the refusal table row names the code `REFUSAL_CODES` holds, and its `structuredContent` field list is the field list of the real
 *    `buildIrisSideRefusal` (the order and the optional `deployedVersion` included);
 *  - the roster bullet names the two discovery fields in the order `buildRosterEntry` emits them, and the four channels are the ones
 *    `applyAutoInstall` can write;
 *  - the section links the new text uses point at headings that exist (GitHub's slug rule);
 *  - the CHANGELOG section (found by title) names the sanction id, the code, the discovery fields, the upgrade note, the unknown
 *    residual and the unchanged `BOOTSTRAP_VERSION`; the changeset (asserted only while it exists) is a minor bump of the shared package
 *    and the five servers and names the sanction id.
 * Needs no IRIS. The built shared dist is the oracle, and this file fails when it is stale.
 */

import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { REPO_ROOT } from "./pack-fixture";
import { checkDistFresh } from "../../../../scripts/lib/dist-freshness.mjs";

const read = (relative: string): string => readFileSync(path.join(REPO_ROOT, relative), "utf8");
const squash = (text: string): string => text.replace(/\s+/g, " ");

const readme = read("README.md");
const changelog = read("CHANGELOG.md");
const changesetPath = ".changeset/story-45-2-auto-install-setting-off-under-read-only.md";
const SANCTION = "`S-45.2-read-only-no-install`";

type SharedApi = typeof import("../../../shared/dist/index.js");
const shared = (await import(pathToFileURL(path.join(REPO_ROOT, "packages/shared/dist/index.js")).href)) as SharedApi;

describe("Story 45.2 doc claims: the oracle", () => {
  it("is a fresh build of the shared package (a stale dist would check the documents against old code)", () => {
    const fresh = checkDistFresh(path.join(REPO_ROOT, "packages", "shared"), "shared");
    expect(fresh.ok ? undefined : fresh.reason).toBeUndefined();
    expect(fresh.skipped, "the shared package declares its dist output").toBeFalsy();
  });
});

/** The README table row (a single line) whose first cell is exactly `cell`. */
function tableRow(cell: string): string {
  const rows = readme.split("\n").filter((line) => line.startsWith(`| \`${cell}\` |`));
  expect(rows, `exactly one README table row for ${cell}`).toHaveLength(1);
  return squash(rows[0] as string);
}

/** GitHub's heading anchor: lower case, punctuation (not hyphens or spaces) removed, spaces to hyphens. */
function slug(heading: string): string {
  return heading
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\- _]/gu, "")
    .replace(/ /g, "-");
}

const headingSlugs = new Set(
  readme
    .split("\n")
    .filter((line) => /^#{1,6} /.test(line))
    .map((line) => slug(line.replace(/^#{1,6} /, "").trim())),
);

describe("Story 45.2: the README variable table row for IRIS_AUTO_INSTALL", () => {
  const row = tableRow("IRIS_AUTO_INSTALL");

  it("states the default, the read-only rule, the precedence, Server Manager, the conflict and the malformed value", () => {
    for (const needle of [
      "*(unset — on, except under `IRIS_GOVERNANCE_PRESET=read-only`)*",
      "**Optional.**",
      "`true` or `false` (case-insensitive; empty is unset)",
      "Default **on**; **`IRIS_GOVERNANCE_PRESET=read-only` forces it off**",
      "`false` turns it off for any other setup",
      "whose IRIS side is missing or older are refused with `IRIS_SIDE_NOT_INSTALLED`, an `unconfigured` reading only warns (a call refuses only if the web application then answers 404), and Atelier-only tools keep working",
      "`\"autoInstall\": true` or `false` in `IRIS_PROFILES`, which wins over this variable and is never inherited from the `default` entry",
      "Server Manager profiles take this variable",
      "together with the read-only preset fails startup naming both settings",
      "a malformed value fails startup naming it",
    ]) {
      expect(row, needle).toContain(needle);
    }
  });

  it("'case-insensitive; empty is unset; a malformed value fails naming it' holds on the built parse", () => {
    const parse = shared.parseOperatorAutoInstall;
    expect(parse({ IRIS_AUTO_INSTALL: "TRUE" })).toBe(true);
    expect(parse({ IRIS_AUTO_INSTALL: "False" })).toBe(false);
    expect(parse({ IRIS_AUTO_INSTALL: "" })).toBeUndefined();
    expect(parse({})).toBeUndefined();
    expect(() => parse({ IRIS_AUTO_INSTALL: "yes" })).toThrow(/IRIS_AUTO_INSTALL/);
  });

  it("'read-only forces it off; a profile's own value wins and is never inherited; true with read-only fails' holds on the built resolution", () => {
    const profile = (name: string, own?: boolean) => ({
      name,
      ...(own === undefined ? {} : { autoInstall: own, autoInstallSource: "IRIS_PROFILES" as const }),
    });
    const registry = new Map([
      ["default", profile("default", false)],
      ["p2", profile("p2")],
    ]);
    shared.applyAutoInstall(registry, undefined, "read-only");
    expect(registry.get("default")).toMatchObject({ autoInstall: false, autoInstallSource: "IRIS_PROFILES" });
    expect(registry.get("p2")).toMatchObject({ autoInstall: false, autoInstallSource: "IRIS_GOVERNANCE_PRESET" });

    const off = new Map([["default", profile("default", false)], ["p2", profile("p2")]]);
    shared.applyAutoInstall(off, undefined, undefined);
    expect(off.get("p2"), "the default entry's value is not inherited").toMatchObject({ autoInstall: true, autoInstallSource: "default" });

    const variableWins = new Map([["p", profile("p", true)]]);
    shared.applyAutoInstall(variableWins, false, undefined);
    expect(variableWins.get("p"), "a profile's own value wins over the variable").toMatchObject({ autoInstall: true, autoInstallSource: "IRIS_PROFILES" });

    expect(() => shared.applyAutoInstall(new Map([["p", profile("p")]]), true, "read-only")).toThrow(/IRIS_AUTO_INSTALL=true.*IRIS_GOVERNANCE_PRESET=read-only/);
    expect(() => shared.applyAutoInstall(new Map([["p", profile("p", true)]]), undefined, "read-only")).toThrow(/profile "p".*autoInstall.*IRIS_GOVERNANCE_PRESET=read-only/);
  });

  it("links to sections that exist", () => {
    for (const anchor of ["read-only-mode--point-it-at-production-with-one-environment-variable", "2-set-environment-variables"]) {
      expect(headingSlugs.has(anchor), `a heading whose anchor is #${anchor}`).toBe(true);
    }
  });
});

describe("Story 45.2: the README refusal table row and the real refusal", () => {
  const row = tableRow("IRIS_SIDE_NOT_INSTALLED");
  const config = { host: "iris.example.com", port: 52773, namespace: "APP", name: "p9" } as import("../../../shared/dist/index.js").IrisConnectionConfig;
  const base = { probeFound: true, deployed: false, compiled: false, configured: false, mapped: false, unitTestRootEnsured: false, errors: [] };

  it("names a code REFUSAL_CODES holds", () => {
    expect(shared.REFUSAL_CODES.IRIS_SIDE_NOT_INSTALLED).toBe("IRIS_SIDE_NOT_INSTALLED");
  });

  it("lists the structuredContent fields the real refusal carries, in order, deployedVersion only for stale", () => {
    const stale = shared.buildIrisSideRefusal(config, { ...base, probeStatus: "stale", deployedVersion: "1.0.0+1.abc", autoInstallOff: "IRIS_AUTO_INSTALL", customRestRefused: true });
    const missing = shared.buildIrisSideRefusal(config, { ...base, probeFound: false, probeStatus: "missing", autoInstallOff: "IRIS_AUTO_INSTALL", customRestRefused: true });
    expect(Object.keys(stale.fields)).toEqual(["profile", "namespace", "found", "deployedVersion", "requiredVersion", "autoInstallSource"]);
    expect(Object.keys(missing.fields)).toEqual(["profile", "namespace", "found", "requiredVersion", "autoInstallSource"]);
    expect(row).toContain("`{code, profile, namespace, found, deployedVersion?, requiredVersion, autoInstallSource}`");
  });

  it("the way out it documents is the one the refusal gives: one start with the install on, or zpm", () => {
    const refusal = shared.buildIrisSideRefusal(config, { ...base, probeFound: false, probeStatus: "missing", autoInstallOff: "IRIS_GOVERNANCE_PRESET", customRestRefused: true });
    expect(refusal.text).toContain("start one server against iris.example.com:52773 without the read-only preset");
    expect(refusal.text).toContain('zpm "install iris-execute-mcp-v2 ');
    expect(row).toContain("start one server against that instance with the automatic install on");
    expect(row).toContain('run `zpm "install iris-execute-mcp-v2 <version>"`');
    const unconfigured = shared.buildIrisSideRefusal(config, { ...base, probeStatus: "unconfigured", autoInstallOff: "IRIS_AUTO_INSTALL", webAppUnconfirmed: true });
    expect(unconfigured.text).toContain('Do ##class(ExecuteMCPv2.Setup).Configure("APP")');
    expect(unconfigured.fields).toMatchObject({ found: "unconfigured" });
    expect(row).toContain('`Do ##class(ExecuteMCPv2.Setup).Configure("<namespace>")` also fixes it');
  });

  // DW-772: the row says what the real code does: missing and stale refuse up front, unconfigured only on the 404 of an absent web application.
  it("says missing and stale refuse before any request, and unconfigured only on the HTTP 404 of an absent web application", () => {
    const text = squash(row);
    expect(text).toContain("is missing or older than this server, and the profile's automatic install is off");
    expect(text).not.toContain("older than this server or unconfigured");
    expect(text).toContain("the probe read `unconfigured` (the web application could not be confirmed) and the request was answered with the HTTP 404 of an absent web application (`found: \"unconfigured\"`)");
    expect(text).toContain("For `missing` and `stale` no request reached the custom REST service for this call; for `unconfigured` the call's request was sent and answered 404 (requests the tool had already sent in parallel were answered the same way), and no IRIS code ran.");
  });
});

describe("Story 45.2: the README roster bullet and the real roster entry", () => {
  const bullet = squash(readme.split("\n").find((line) => line.startsWith("- **Profile roster**")) ?? "");

  it("names autoInstall then autoInstallSource right after dataPolicySource, as buildRosterEntry emits them", () => {
    const keys = Object.keys(
      shared.buildRosterEntry({
        name: "p",
        host: "h",
        port: 1,
        username: "u",
        password: "secret",
        namespace: "N",
        https: false,
        baseUrl: "http://h:1",
        timeout: 1,
        source: "env",
      } as import("../../../shared/dist/index.js").IrisProfile),
    );
    expect(keys.slice(keys.indexOf("dataPolicySource"))).toEqual(["dataPolicySource", "autoInstall", "autoInstallSource"]);
    expect(bullet.indexOf("`dataPolicySource`")).toBeGreaterThan(-1);
    expect(bullet.indexOf("`autoInstall` (`true` or `false`")).toBeGreaterThan(bullet.indexOf("`dataPolicySource`"));
    expect(bullet.indexOf("`autoInstallSource`")).toBeGreaterThan(bullet.indexOf("`autoInstall` ("));
  });

  it("the four channels it lists are exactly the ones the resolution writes", () => {
    const written = new Set<string>();
    const carrier = (name: string, own?: boolean) => ({ name, ...(own === undefined ? {} : { autoInstall: own, autoInstallSource: "IRIS_PROFILES" as const }) });
    for (const [operator, preset, own] of [
      [undefined, undefined, undefined],
      [false, undefined, undefined],
      [undefined, "read-only", undefined],
      [undefined, undefined, false],
    ] as const) {
      const registry = new Map([["p", carrier("p", own)]]);
      shared.applyAutoInstall(registry, operator, preset);
      written.add((registry.get("p") as { autoInstallSource: string }).autoInstallSource);
    }
    expect([...written].sort()).toEqual(["IRIS_AUTO_INSTALL", "IRIS_GOVERNANCE_PRESET", "IRIS_PROFILES", "default"]);
    for (const channel of written) expect(bullet, channel).toContain(`\`${channel}\``);
  });
});

describe("Story 45.2: the README read-only section, the Quick Start line and the back-compat list", () => {
  it("the Quick Start line says the install can be off, and the read-only section says what it installs and what it leaves", () => {
    const quick = squash(readme.split("\n").find((line) => line.startsWith("**The IRIS side installs itself.**")) ?? "");
    expect(quick).toContain("unless the automatic install is off (`IRIS_AUTO_INSTALL=false`, a profile's `autoInstall: false`, or the [read-only preset]");
    const section = squash(readme.split("\n").find((line) => line.startsWith("- **Installs nothing on IRIS (Story 45.2).**")) ?? "");
    for (const needle of [
      "never uploads or compiles the `ExecuteMCPv2` classes",
      "registers the `/api/executemcp/v2` web application, creates the `%ALL` namespace or mapping, or sets `^UnitTestRoot`",
      "Bootstrap only reads.",
      "The default state is on; the preset forces it off",
      "**Upgrading is a deliberate admin step.**",
      "restart the refusing server",
      // Every release restamps the marker's semver (gen-bootstrap.mjs at the version step); since Story 45.7 (DW-770) only a release that
      // changes the classes (the hash at the end of `BOOTSTRAP_VERSION`) reads as stale with the install off.
      "After a release that changes the IRIS-side classes (the release's CHANGELOG says so in its IRIS side section, and the hash at the end of `BOOTSTRAP_VERSION` changes; 1.3.0 does)",
      "A release that only restamps the version (a new semver with the same classes, so the same content hash) asks for nothing",
      "an `unknown` IRIS side whose marker reads older",
      // DW-772 (decision #165): the unconfigured reading warns, it does not refuse, and the residual is stated plainly.
      "Where the IRIS side is `missing` or `stale` (older than this server), the server's custom-REST tools of that profile are refused",
      "With the install off, an `unconfigured` reading (the classes are current, but the `/api/executemcp/v2` web application could not be confirmed) only warns once at startup and the tools go on",
      "a call refuses with `IRIS_SIDE_NOT_INSTALLED` (`found: \"unconfigured\"`) only if the web application then answers the HTTP 404 of an absent application",
      "with the install off, an `unconfigured` reading only warns, because the lookup can fail for a reason other than absence; a truly missing web application answers 404, the call refuses with `IRIS_SIDE_NOT_INSTALLED`, and nothing runs",
      // Story 45.6 (DW-773): a least-privilege account reads `current` through the CSP application lookup.
      "reads `current` when the web application is registered (from `1.3.0` the check falls back to the CSP application lookup, which needs no `%SYS` privilege) and `unconfigured` when it is not",
      "`iris_execute_tests` and `iris_test_coverage` refuse on a profile whose IRIS side is not installed while the install is off",
    ]) {
      expect(section, needle).toContain(needle);
    }
  });

  it("the IPM section's 'hands it back' sentence is qualified by the automatic install", () => {
    const ipm = squash(readme.split("\n").find((line) => line.startsWith("- **IPM then owns the classes in that namespace")) ?? "");
    expect(ipm).toContain("hands it back to the server (restart a running server): with the automatic install on, it installs its own classes again");
    expect(ipm).toContain("With the automatic install off (`IRIS_AUTO_INSTALL=false`");
  });

  it("the back-compat list says the unset default is byte-for-byte unchanged and names the sanction", () => {
    const item = squash(readme.split("\n").find((line) => line.startsWith("- With `IRIS_AUTO_INSTALL` and every profile's `autoInstall` **unset**")) ?? "");
    for (const needle of ["byte-for-byte unchanged", "`IRIS_AUTO_INSTALL=true` behaves the same", "`S-45.2-read-only-no-install`", "additive"]) {
      expect(item, needle).toContain(needle);
    }
  });
});

describe("Story 45.2: the CHANGELOG entry", () => {
  // Found by its title, not its position: a later story's section may sit above it, and the release relabels the heading.
  const section = /^## \[[^\]\n]*\] [-—–] Story 45\.2: Auto-Install Setting, Off Under Read-Only\n[\s\S]*?(?=\n## \[)/m.exec(changelog)?.[0] ?? "";

  it("is a section above the 1.2.0 release's, with the behavior-change, upgrade-note, limitation and IRIS-side blocks", () => {
    expect(section, "the Story 45.2 section").not.toBe("");
    expect(changelog.indexOf(section)).toBeLessThan(changelog.indexOf("\n## [1.2.0] — "));
    for (const heading of ["### Behavior changes", "### Upgrade note", "### Known limitation", "### IRIS side"]) expect(section, heading).toContain(heading);
  });

  it("names the sanction id on each behavior change, the code, the discovery fields, the upgrade note, the unknown residual and the unchanged marker", () => {
    const text = squash(section);
    const behavior = squash(/### Behavior changes\n([\s\S]*?)\n### /.exec(section)?.[1] ?? "");
    const bullets = behavior.split(/(?:^| )- \*\*/).filter((part) => part.trim() !== "");
    expect(bullets, "the behavior-change bullets").toHaveLength(5);
    // Every change but the additive roster fields names the sanction (the fields' golden rows are covered by it in the sentence).
    for (const bullet of bullets.filter((part) => !part.startsWith("`iris_server_profiles` reports the setting"))) {
      expect(bullet, bullet.slice(0, 60)).toContain("S-45.2-read-only-no-install");
    }
    for (const needle of [
      "IRIS_SIDE_NOT_INSTALLED",
      "`IRIS_AUTO_INSTALL`",
      "`autoInstall` and `autoInstallSource`",
      "after `dataPolicySource`",
      "After a release that changes the IRIS-side classes (the release's CHANGELOG says so in its IRIS side section, and the hash at the end of `BOOTSTRAP_VERSION` changes; 1.3.0 does)",
      "A release that only restamps the version (the same classes, so the same content hash) asks for nothing",
      "Upgrading is a deliberate admin step.",
      "An `unknown` IRIS side is not refused.",
      "With the install off and the IRIS side `missing` or `stale` (older than this server), every call that reaches the `/api/executemcp/` service of that profile is refused before a request is sent",
      "An `unconfigured` reading (the classes are current, the web application could not be confirmed) only logs one `[WARN]` and the tools go on",
      "An `unconfigured` reading only warns (DW-772).",
      "only if the web application then answers the HTTP 404 of an absent application, and a 404 from an installed web application (an unknown route) is never mapped",
      "`iris_execute_tests` and `iris_test_coverage` refuse on such a profile",
      "the startup requests and the bootstrap result are byte-identical",
      "No class changed; `BOOTSTRAP_VERSION` is unchanged.",
    ]) {
      expect(text, needle).toContain(needle);
    }
    expect(text).toContain(SANCTION);
  });
});

describe("Story 45.2: the changeset", () => {
  // `changeset version` consumes (deletes) the file and moves its text into the generated package changelogs, so it is checked while it exists.
  const present = existsSync(path.join(REPO_ROOT, changesetPath));

  // Decision #160: a new setting is a feature, so the bump is minor (the `fixed` group makes one minor changeset the release's 1.3.0).
  it.skipIf(!present)("bumps @iris-mcp/shared and the five servers minor, and nothing else, and names the sanction id and the upgrade note", () => {
    const text = read(changesetPath);
    const front = /^---\n([\s\S]*?)\n---\n/.exec(text)?.[1] ?? "";
    expect(front.split("\n").map((line) => line.trim()).sort()).toEqual(
      ["admin", "data", "dev", "interop", "ops", "shared"].map((name) => `"@iris-mcp/${name}": minor`).sort(),
    );
    const body = squash(text);
    for (const needle of [
      SANCTION,
      "GitHub issue #1 point 3",
      "`IRIS_AUTO_INSTALL`",
      "`IRIS_SIDE_NOT_INSTALLED`",
      "On a `missing` or `stale` IRIS side, a call that would reach the `/api/executemcp/` custom REST service of that profile is refused before any request is sent",
      "An `unconfigured` reading only logs one `[WARN]` and the tools go on",
      "Upgrading is a deliberate admin step.",
      "after a release that changes the IRIS-side classes (its CHANGELOG says so in its IRIS side section, and the hash at the end of `BOOTSTRAP_VERSION` changes; 1.3.0 does)",
      "No `.cls` changed, so `BOOTSTRAP_VERSION` is unchanged.",
    ]) {
      expect(body, needle).toContain(needle);
    }
  });
});
