/**
 * Story 41.6 (QA, project rule #59) - `check:provenance` proven RED on the path it guards: the real
 * `scripts/check-provenance.mjs` as a child process, against a SCRATCH COPY of the repository whose client-config
 * `dist/` (the installer the check imports through the probe) has been broken in one named way.
 *
 * `story-41-6-qa-installer-provenance.test.ts` proves the beside rule red through an injected payload; this file
 * proves it through the whole chain: scratch dist -> `installer-payload-probe.mjs` -> `gatherProvenanceInputs` ->
 * `checkProvenance` -> exit code and stderr. Every red case has a green control: the same scratch recipe, unbroken,
 * exits 0 first, so the red can only come from the edit.
 *
 * Each dist edit asserts that its anchor text occurs exactly once, so a rebuild that changes the compiled shape
 * fails loudly instead of leaving a vacuous edit. The scratch root lives under `os.tmpdir()` and is removed by the
 * test that made it. No IRIS, no network, no write to the real tree.
 */

import { afterEach, describe, expect, it } from "vitest";
import { mkdirSync, readdirSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { NOTICE_FILENAME } from "../../../../scripts/lib/skills-pack.mjs";
import { makeScratchRepo, problemPairs, removeScratchRepo, runScript } from "./story-41-1-qa-fixture";

const CHECK = "scripts/check-provenance.mjs";
const DIST_PLAN = "packages/client-config/dist/pack-plan.js";
const ROUTES = ["claude-code", "cursor", "gemini", "agents"] as const;
const SQL_DIR = (route: string): string => `${route === "claude-code" ? ".claude" : ".agents"}/skills/iris-mcp-objectscript-sql`;
const BESIDE = (route: string): string =>
  `[distribution] installer:${route}: the installed copy ${SQL_DIR(route)}/SKILL.md carries adapted content but no ${NOTICE_FILENAME} beside it equal to the canonical notice`;
const INSTALLER_PAIRS = ROUTES.map((route) => `distribution installer:${route}`).sort();

const temps: string[] = [];
function scratch(): string {
  const root = makeScratchRepo({ clientConfigManifest: true });
  temps.push(root);
  return root;
}
afterEach(() => {
  for (const root of temps.splice(0)) removeScratchRepo(root);
});

/** Replace the one occurrence of `anchor` in the scratch copy of `rel`. */
function editScratch(root: string, rel: string, anchor: string, replacement: string): void {
  const file = join(root, rel);
  const parts = readFileSync(file, "utf8").split(anchor);
  expect(parts.length, `exactly one occurrence of ${JSON.stringify(anchor)} in ${rel}`).toBe(2);
  writeFileSync(file, parts.join(replacement));
}

function red(root: string): { stdout: string; stderr: string } {
  const run = runScript(root, CHECK);
  expect(run.status, `${run.stdout}${run.stderr}`).toBe(1);
  expect(run.stdout).not.toContain("check-provenance: OK");
  return run;
}

describe("the green control", () => {
  it("an unbroken scratch copy passes, counting 1 package and the 4 installer distributions", () => {
    const root = scratch();
    const run = runScript(root, CHECK);
    expect(run.status, `${run.stdout}${run.stderr}`).toBe(0);
    expect(run.stdout).toContain("check-provenance: OK");
    expect(run.stdout).toMatch(/5 distribution\(s\)\./);
  });
});

describe("the notice beside the adapted skill, broken in the installer the check imports", () => {
  it("a planner that places no notice: all four routes are refused with the exact `installer:<route>` line", () => {
    const root = scratch();
    editScratch(root, DIST_PLAN, "if (bytes.includes(ADAPTATION_MARKER)) {", "if (false) {");
    const run = red(root);
    for (const route of ROUTES) expect(run.stderr, route).toContain(BESIDE(route));
    expect(problemPairs(run.stderr)).toEqual(INSTALLER_PAIRS);
  });

  it("a notice whose bytes differ from the canonical notice is refused on every route", () => {
    const root = scratch();
    editScratch(root, DIST_PLAN, "`${parentOf(path)}/${NOTICE_FILENAME}`, pack.notice)", '`${parentOf(path)}/${NOTICE_FILENAME}`, Buffer.from("not the notice\\n"))');
    const run = red(root);
    for (const route of ROUTES) expect(run.stderr, route).toContain(BESIDE(route));
    expect(problemPairs(run.stderr)).toEqual(INSTALLER_PAIRS);
  });

  it("a notice placed at the project root instead of beside the skill is refused on every route", () => {
    const root = scratch();
    editScratch(root, DIST_PLAN, "`${parentOf(path)}/${NOTICE_FILENAME}`, pack.notice)", "NOTICE_FILENAME, pack.notice)");
    const run = red(root);
    for (const route of ROUTES) expect(run.stderr, route).toContain(BESIDE(route));
    expect(problemPairs(run.stderr)).toEqual(INSTALLER_PAIRS);
  });
});

describe("a client-config dist that cannot produce the payloads fails closed as `installer`", () => {
  const FAIL_CLOSED = /\[distribution\] installer: the installer payloads could not be computed \(.+\); build @iris-mcp\/client-config first/;

  it("a stale dist whose pack-plan.js does not export installerPayloads", () => {
    const root = scratch();
    editScratch(root, DIST_PLAN, "export function installerPayloads(", "export function installerPayloadsRenamed(");
    const run = red(root);
    expect(run.stderr).toMatch(FAIL_CLOSED);
    expect(run.stderr).toContain("does not export installerPayloads");
    expect(problemPairs(run.stderr)).toEqual(["distribution installer"]);
  });

  it("a dist from before the installer: pack-plan.js is missing while the rest of dist is there", () => {
    const root = scratch();
    rmSync(join(root, DIST_PLAN));
    const run = red(root);
    expect(run.stderr).toMatch(FAIL_CLOSED);
    expect(run.stderr).toContain("could not load");
    expect(problemPairs(run.stderr)).toEqual(["distribution installer"]);
  });

  it("a truncated dist: pack-plan.js is not valid JavaScript", () => {
    const root = scratch();
    const file = join(root, DIST_PLAN);
    writeFileSync(file, `${readFileSync(file, "utf8")}\n}}} not javascript\n`);
    const run = red(root);
    expect(run.stderr).toMatch(FAIL_CLOSED);
    expect(problemPairs(run.stderr)).toEqual(["distribution installer"]);
  });

  it("a dist that outlived the pack it was built against: the cursor rule form is gone from the scratch pack", () => {
    const root = scratch();
    rmSync(join(root, "packages", "client-config", "skills-pack", "rules", "cursor"), { recursive: true });
    const run = red(root);
    expect(run.stderr).toMatch(FAIL_CLOSED);
    expect(run.stderr).toContain("every rule needs all three forms");
    expect(problemPairs(run.stderr)).toContain("distribution installer");
  });

  describe("a client-config dist that is older than its sources (Story 41.7, DW-611)", () => {
    const SRC_INDEX = "packages/client-config/src/index.ts";

    /** The newest modification time under `dir`, in milliseconds. */
    function newestMtimeMs(dir: string): number {
      let newest = -Infinity;
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        newest = Math.max(newest, entry.isDirectory() ? newestMtimeMs(full) : statSync(full).mtimeMs);
      }
      return newest;
    }

    /** Add a client-config source file whose mtime is `offsetMs` after the newest file of the scratch dist. */
    function addSource(root: string, offsetMs: number): void {
      const newestDist = newestMtimeMs(join(root, "packages", "client-config", "dist"));
      const file = join(root, SRC_INDEX);
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, "export {};\n");
      const when = new Date(newestDist + offsetMs);
      utimesSync(file, when, when);
    }

    it("a source 10 s newer than the newest dist file is refused as `installer`, naming the stale dist", () => {
      const root = scratch();
      addSource(root, 10_000);
      const run = red(root);
      expect(run.stderr).toMatch(FAIL_CLOSED);
      expect(run.stderr).toContain("not fresh");
      expect(problemPairs(run.stderr)).toEqual(["distribution installer"]);
    });

    it("the control: a source 10 s older than the newest dist file passes with the same 5 distributions", () => {
      const root = scratch();
      addSource(root, -10_000);
      const run = runScript(root, CHECK);
      expect(run.status, `${run.stdout}${run.stderr}`).toBe(0);
      expect(run.stdout).toMatch(/5 distribution\(s\)\./);
    });
  });
});
