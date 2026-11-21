/**
 * Story 42.4 (AC 42.4.1; AD-14) -- `ipm/module.xml`, the IPM manifest, is generated and output-only: `scripts/gen-bootstrap.mjs`
 * writes it from `classes[]` plus the IPM-only install guard, and this default-suite test holds the checked-in file to that contract.
 *
 *  - THE RESOURCES. The non-preload resources are exactly the `classes[]` roster, as `.CLS`, in order (the compile order of
 *    AD-14); exactly one resource is preloaded, and it is the install guard, listed first.
 *  - THE INVOKES. The guard's `Check` runs at `Initialize`/`After` (before IPM reloads any class) with `CheckStatus="true"`, which makes
 *    IPM 0.10.0 to 0.10.4 act on the error status a refusal returns (IPM 0.10.5 and later check it by default); then `Setup.Configure`
 *    and `Setup.ConfigureMapping` as before; the manifest has no `<WebApplication>`, no application role and no `MatchRoles` (AD-31).
 *  - THE IDENTITY. `<Name>` is the embed's `IPM_MODULE_NAME`; `<Version>` is the shared package's version, which is the semver of
 *    the embed's marker.
 *  - THE HEADER. A DO-NOT-EDIT comment names the generator and the command, and the counts it states equal the counted
 *    `<Resource` lines and the roster length plus one (Rule #51).
 *
 * A hand edit of the manifest, or a `classes[]`, shared-version or guard change without `pnpm gen:bootstrap`, fails here (and
 * `packages/shared/src/__tests__/gen-bootstrap-write.test.ts` holds the file equal to the generator's output byte for byte).
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { bootstrapRoster } from "../../../../scripts/ci-seed-throwaway.mjs";
import { manifestDeclarations } from "../../../../scripts/lib/ipm-archive.mjs";
import { REPO_ROOT } from "../../../../scripts/lib/live-gate-scan.mjs";
import { BOOTSTRAP_VERSION, IPM_INSTALL_GUARD, IPM_MODULE_NAME } from "../../../shared/src/bootstrap-classes.js";

const MANIFEST = readFileSync(path.join(REPO_ROOT, "ipm", "module.xml"), "utf8");
const SHARED_VERSION = (JSON.parse(readFileSync(path.join(REPO_ROOT, "packages", "shared", "package.json"), "utf8")) as { version: string }).version;
const GUARD_RESOURCE = `${IPM_INSTALL_GUARD.name.replace(/\.cls$/, "")}.CLS`;
/** Every failure here names the file and the command that regenerates it (AC 42.4.1). */
const HINT = "ipm/module.xml is generated and must not be edited by hand: run pnpm gen:bootstrap";

/** Every `<Resource .../>` line of the manifest, as written. */
const RESOURCE_LINES = MANIFEST.split("\n").filter((line) => line.trim().startsWith("<Resource"));
/** Every `<Invoke .../>` line of the manifest, trimmed. */
const INVOKE_LINES = MANIFEST.split("\n").map((line) => line.trim()).filter((line) => line.startsWith("<Invoke"));

describe("ipm/module.xml is generated from classes[] plus the install guard (AC 42.4.1)", () => {
  const declared = manifestDeclarations(MANIFEST);
  const roster = bootstrapRoster();

  it("lists the guard as the only preloaded resource, first, followed by exactly classes[] in order as .CLS", () => {
    expect(roster.names.length, "the roster is read from the generator's literal").toBe(35);
    expect(declared.resources.filter((resource) => resource.preload), HINT).toEqual([{ name: GUARD_RESOURCE, preload: true }]);
    expect(declared.resources[0], HINT).toEqual({ name: GUARD_RESOURCE, preload: true });
    expect(declared.resources.slice(1), HINT).toEqual(roster.names.map((name) => ({ name: name.replace(/\.cls$/, ".CLS"), preload: false })));
    expect(RESOURCE_LINES[0], HINT).toBe(`      <Resource Name="${GUARD_RESOURCE}" Preload="true"/>`);
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
    expect(declared.sourcesRoot).toBe("src");
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

  it("opens with the DO-NOT-EDIT header that names the generator and the command", () => {
    const header = /<!--([\s\S]*?)-->/.exec(MANIFEST)?.[1] ?? "";
    expect(header).toContain("GENERATED by scripts/gen-bootstrap.mjs");
    expect(header).toContain("DO NOT EDIT");
    expect(header).toContain("pnpm gen:bootstrap");
    expect(MANIFEST.indexOf("<!--"), "the header comes before the first element of the module").toBeLessThan(MANIFEST.indexOf("<Name>"));
  });

  it("states counts that equal the counted <Resource lines, which equal the roster length plus one (Rule #51)", () => {
    const header = /<!--([\s\S]*?)-->/.exec(MANIFEST)?.[1] ?? "";
    const resources = /(\d+) resources/.exec(header)?.[1];
    const classes = /the (\d+) classes of classes\[\]/.exec(header)?.[1];
    expect(resources, "the header states a resource count").toBeDefined();
    expect(classes, "the header states a class count").toBeDefined();
    expect(Number(resources), HINT).toBe(RESOURCE_LINES.length);
    expect(Number(classes), HINT).toBe(roster.names.length);
    expect(RESOURCE_LINES.length, HINT).toBe(roster.names.length + 1);
  });

  it("is well formed enough for IPM: one Export, one Document named after the module, one Module", () => {
    expect(MANIFEST.startsWith('<?xml version="1.0" encoding="UTF-8"?>\n')).toBe(true);
    expect(MANIFEST.match(/<Export /g)).toHaveLength(1);
    expect(MANIFEST.match(/<Module>/g)).toHaveLength(1);
    expect(MANIFEST).toContain(`<Document name="${IPM_MODULE_NAME}.ZPM">`);
    expect(MANIFEST).toContain("<Packaging>module</Packaging>");
  });
});
