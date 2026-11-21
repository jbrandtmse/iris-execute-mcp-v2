/**
 * Story 42.4 (AC 42.4.1; AD-14), retargeted by Story 42.8 (decision #122) -- the root `module.xml`, the IPM manifest, is generated and
 * output-only: `scripts/gen-bootstrap.mjs --ipm` writes it with the stamped tree, only at the version step, and this default-suite test
 * holds the checked-in file to that contract.
 *
 *  - THE RENDERING. The file is byte for byte `renderModuleXml` of the classes and guard it declares, at the sources root `ipm/src`.
 *  - THE RESOURCES. Exactly one resource is preloaded, and it is the install guard, listed first. At a version commit (the tree's marker
 *    is `BOOTSTRAP_VERSION`) the other resources are exactly the `classes[]` roster, as `.CLS`, in order (the compile order of AD-14);
 *    between releases the tree is frozen at the last released roster, so that equality is not asserted then (`ipm-tree.test.ts` and
 *    `pnpm gen:ipm:check` hold the tree to its own marker).
 *  - THE INVOKES. The guard's `Check` runs at `Initialize`/`After` (before IPM reloads any class) with `CheckStatus="true"`, which makes
 *    IPM 0.10.0 to 0.10.4 act on the error status a refusal returns (IPM 0.10.5 and later check it by default); then `Setup.Configure`
 *    and `Setup.ConfigureMapping` as before; the manifest has no `<WebApplication>`, no application role and no `MatchRoles` (AD-31).
 *  - THE IDENTITY. `<Name>` is the embed's `IPM_MODULE_NAME`; `<Version>` is the shared package's version, which is the semver of
 *    the embed's marker.
 *  - THE HEADER. A DO-NOT-EDIT comment names the generator, the command and the version step, and the counts it states equal the counted
 *    `<Resource` lines (Rule #51).
 *
 * A hand edit of the manifest fails here (and in `pnpm gen:ipm:check`); a `classes[]` change without the version step does not, by design.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { bootstrapRoster } from "../../../../scripts/ci-seed-throwaway.mjs";
import { manifestDeclarations } from "../../../../scripts/lib/ipm-archive.mjs";
import { ipmTreeMarker, renderModuleXml } from "../../../../scripts/lib/ipm-tree.mjs";
import { REPO_ROOT } from "../../../../scripts/lib/live-gate-scan.mjs";
import { BOOTSTRAP_VERSION, IPM_INSTALL_GUARD, IPM_MODULE_NAME } from "../../../shared/src/bootstrap-classes.js";

const MANIFEST = readFileSync(path.join(REPO_ROOT, "module.xml"), "utf8");
const SHARED_VERSION = (JSON.parse(readFileSync(path.join(REPO_ROOT, "packages", "shared", "package.json"), "utf8")) as { version: string }).version;
const GUARD_RESOURCE = `${IPM_INSTALL_GUARD.name.replace(/\.cls$/, "")}.CLS`;
/** Every failure here names the file and the command that regenerates it (AC 42.4.1). */
const HINT = "module.xml is generated and must not be edited by hand: it is written by pnpm gen:ipm at the version step";
/** True when the committed tree stamps the embed's current marker: the version commit, and every commit until a class changes. */
const AT_VERSION_COMMIT = ipmTreeMarker(REPO_ROOT) === BOOTSTRAP_VERSION;

/** Every `<Resource .../>` line of the manifest, as written. */
const RESOURCE_LINES = MANIFEST.split("\n").filter((line) => line.trim().startsWith("<Resource"));
/** Every `<Invoke .../>` line of the manifest, trimmed. */
const INVOKE_LINES = MANIFEST.split("\n").map((line) => line.trim()).filter((line) => line.startsWith("<Invoke"));

describe("the root module.xml is generated from the tree's classes plus the install guard (AC 42.4.1; decision #122)", () => {
  const declared = manifestDeclarations(MANIFEST);
  const roster = bootstrapRoster();

  it("is byte for byte the generator's rendering of the classes and the guard it declares, at the sources root ipm/src", () => {
    const rendered = renderModuleXml({
      moduleName: declared.name as string,
      version: declared.version as string,
      classNames: declared.resources.filter((resource) => !resource.preload).map((resource) => resource.name.replace(/\.CLS$/, ".cls")),
      guardName: declared.resources.filter((resource) => resource.preload).map((resource) => resource.name.replace(/\.CLS$/, ".cls"))[0] as string,
      sourcesRoot: "ipm/src",
    });
    expect(MANIFEST, HINT).toBe(rendered);
    expect(declared.sourcesRoot).toBe("ipm/src");
  });

  it("lists the guard as the only preloaded resource, first, followed by the classes as .CLS in the compile order", () => {
    expect(roster.names.length, "the roster is read from the generator's literal").toBe(35);
    expect(declared.resources.filter((resource) => resource.preload), HINT).toEqual([{ name: GUARD_RESOURCE, preload: true }]);
    expect(declared.resources[0], HINT).toEqual({ name: GUARD_RESOURCE, preload: true });
    expect(RESOURCE_LINES[0], HINT).toBe(`      <Resource Name="${GUARD_RESOURCE}" Preload="true"/>`);
    expect(declared.resources.slice(1).every((resource) => !resource.preload && resource.name.endsWith(".CLS"))).toBe(true);
    expect(declared.resources[1], "Utils compiles first").toEqual({ name: "ExecuteMCPv2.Utils.CLS", preload: false });
    expect(declared.resources.at(-1), "Dispatch compiles last").toEqual({ name: "ExecuteMCPv2.REST.Dispatch.CLS", preload: false });
  });

  it.runIf(AT_VERSION_COMMIT)("at a version commit its resources are exactly classes[] in order, plus the guard", () => {
    expect(declared.resources.slice(1), HINT).toEqual(roster.names.map((name) => ({ name: name.replace(/\.cls$/, ".CLS"), preload: false })));
    expect(RESOURCE_LINES.length, HINT).toBe(roster.names.length + 1);
  });

  it("holds the install guard out of the bootstrapped roster and out of the embed's class map", () => {
    expect(roster.names).not.toContain(IPM_INSTALL_GUARD.name);
    expect(roster.paths.some((file) => file.startsWith("ipm/"))).toBe(false);
  });

  it("has the three invokes, in order, with their attributes: the guard at Initialize/After, then Configure and ConfigureMapping", () => {
    expect(INVOKE_LINES, HINT).toEqual([
      '<Invoke Class="ExecuteMCPv2.InstallGuard" Method="Check" Phase="Initialize" When="After" CheckStatus="true"/>',
      '<Invoke Class="ExecuteMCPv2.Setup" Method="Configure"/>',
      '<Invoke Class="ExecuteMCPv2.Setup" Method="ConfigureMapping"/>',
    ]);
    expect(declared.invokes, HINT).toEqual([
      { class: "ExecuteMCPv2.InstallGuard", method: "Check", phase: "Initialize", when: "After", checkStatus: true },
      { class: "ExecuteMCPv2.Setup", method: "Configure", phase: "Configure", when: "After", checkStatus: undefined },
      { class: "ExecuteMCPv2.Setup", method: "ConfigureMapping", phase: "Configure", when: "After", checkStatus: undefined },
    ]);
  });

  it("is the shared package's version, which is the semver of the embedded marker, under the embed's module name", () => {
    expect(declared.version, HINT).toBe(SHARED_VERSION);
    expect(BOOTSTRAP_VERSION.split("+")[0], HINT).toBe(SHARED_VERSION);
    expect(declared.name, HINT).toBe(IPM_MODULE_NAME);
    expect(declared.name).toBe("iris-execute-mcp-v2");
  });

  it("carries no test or fixture resource, no web application element, no application role and no MatchRoles (AD-31)", () => {
    expect(declared.resources.filter((resource) => /\.Tests\.|QAFixtures/.test(resource.name))).toEqual([]);
    expect(MANIFEST).not.toMatch(/<WebApplication/i);
    expect(MANIFEST).not.toMatch(/MatchRoles/i);
    expect(MANIFEST).not.toMatch(/\bRoles?=/i);
    expect(MANIFEST).not.toMatch(/ApplicationRoles/i);
  });

  it("does not imply endorsement by InterSystems (AD-28)", () => {
    const description = /<Description>([^<]*)<\/Description>/.exec(MANIFEST)?.[1] ?? "";
    expect(description, "the manifest has a description").not.toBe("");
    expect(description).toMatch(/community project/i);
    expect(description).not.toMatch(/\bofficial\b|\bendorsed\b|\bInterSystems'?s?\b/i);
  });

  it("opens with the DO-NOT-EDIT header that names the generator, the command and the version step, and holds no double hyphen (an XML comment may not)", () => {
    const header = /<!--([\s\S]*?)-->/.exec(MANIFEST)?.[1] ?? "";
    expect(header).toContain("GENERATED by scripts/gen-bootstrap.mjs");
    expect(header).toContain("DO NOT EDIT");
    expect(header).toContain("pnpm gen:ipm");
    expect(header).toContain("pnpm run version");
    expect(header, "a comment with -- is not well formed XML").not.toContain("--");
    expect(MANIFEST.indexOf("<!--"), "the header comes before the first element of the module").toBeLessThan(MANIFEST.indexOf("<Name>"));
  });

  it("states counts that equal the counted <Resource lines, which are the classes plus the guard (Rule #51)", () => {
    const header = /<!--([\s\S]*?)-->/.exec(MANIFEST)?.[1] ?? "";
    const resources = /(\d+) resources/.exec(header)?.[1];
    const classes = /the (\d+) classes of classes\[\]/.exec(header)?.[1];
    expect(resources, "the header states a resource count").toBeDefined();
    expect(classes, "the header states a class count").toBeDefined();
    expect(Number(resources), HINT).toBe(RESOURCE_LINES.length);
    expect(Number(classes), HINT).toBe(RESOURCE_LINES.length - 1);
  });

  it("is well formed enough for IPM: one Export, one Document named after the module, one Module", () => {
    expect(MANIFEST.startsWith('<?xml version="1.0" encoding="UTF-8"?>\n')).toBe(true);
    expect(MANIFEST.match(/<Export /g)).toHaveLength(1);
    expect(MANIFEST.match(/<Module>/g)).toHaveLength(1);
    expect(MANIFEST).toContain(`<Document name="${IPM_MODULE_NAME}.ZPM">`);
    expect(MANIFEST).toContain("<Packaging>module</Packaging>");
  });
});
