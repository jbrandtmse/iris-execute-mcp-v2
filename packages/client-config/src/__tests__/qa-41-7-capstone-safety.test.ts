/**
 * Story 41.7 QA - what the Epic 41 capstone (`epic41-capstone-gate.test.ts`) leaves unpinned, closed per route on the
 * BUILT `iris-mcp-clients` bin (project rules #21 and #59).
 *
 * Gap analysis of the capstone (each hole was found by applying a mutation to `dist/` and observing the capstone stay
 * green; the mutation lines are in the spec's `## Verification`, marked `(QA)`):
 *
 *  1. Backups. The capstone only compares the backup COUNT before and after a re-install, so it passes when the installer
 *     never takes a backup at all. The contract (client-config README, "Every file an update or an uninstall overwrites or
 *     deletes is backed up first") is pinned here for every routed client: an install that edits an existing
 *     `AGENTS.md` / `GEMINI.md` backs the host up, byte for byte; an install that overwrites nothing takes no backup; an
 *     uninstall backs up every file it deletes or edits, byte for byte.
 *  2. The home directory. The capstone never looks under the temp home after the uninstall, so a file the uninstall leaves
 *     outside the backup directory goes unseen. Here every file under the home is inside the backup directory, after the
 *     install and after the uninstall.
 *  3. Host byte shapes. The capstone's block-route legs never receive the three plain shapes (`lf`, `crlf`, `bom+lf`): the
 *     fixture rotation puts them on a file-rule route or on a leg whose host is absent. A mutation that mishandles only a
 *     BOM-less, CRLF-terminated host passes the capstone. These rows give the three shapes to the block routes, rotating.
 *
 * Every row spawns `dist/cli/clients-cli.js` in a child process whose environment is built from scratch (HOME,
 * USERPROFILE and APPDATA are a temp home; cwd is a temp project), and writes only under temp directories it removes.
 * The oracles are independent of the bin: the route table comes from `src/pack-targets.ts`, the bytes from the pack on
 * disk and from the fixtures. Needs no IRIS.
 */

import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { PACK_ROUTES, PACK_TARGETS, RULE_FORM_EXTENSIONS, type PackTarget } from "../pack-targets.js";

import { hostFixtures, makeSandbox, readProjectFile, removeSandboxes, writeProjectFile } from "./pack-test-helpers.js";
import {
  assertBinFresh,
  backupsOf,
  expectedSkillFiles,
  filesOutsideBackups,
  filesUnder,
  lstatTree,
  MANIFEST,
  packRuleForms,
  RULE_STEM,
  runBin,
  SPAWN_TEST_TIMEOUT,
  treeDiff,
} from "./qa-41-6-helpers.js";

/** The three host shapes the capstone never gives to a block route, in the order they rotate. */
const PLAIN_SHAPES = ["lf", "crlf", "bom+lf"] as const;

const FIXTURES = hostFixtures(RULE_STEM);
const ROUTED = PACK_TARGETS.filter((target) => target.route !== null);
const BLOCK_LEGS = ROUTED.filter((target) => PACK_ROUTES[target.route as NonNullable<PackTarget["route"]>].rule.kind === "block");

beforeAll(assertBinFresh);
afterEach(removeSandboxes);

function fixtureNamed(name: string): Buffer {
  const found = FIXTURES.find((fixture) => fixture.name === name);
  if (found === undefined) throw new Error(`no host fixture named ${name}`);
  return found.bytes;
}

/** Every file under the temp home must live in the backup directory. */
function assertHomeHoldsOnlyBackups(home: string, when: string): void {
  expect(filesOutsideBackups(home), `${when}: files outside the backup directory`).toEqual([]);
}

describe("Epic 41 capstone, blind spots closed: backups, the home directory and plain host shapes, per routed client", () => {
  ROUTED.forEach((target) => {
    const route = PACK_ROUTES[target.route as NonNullable<PackTarget["route"]>];
    const blockIndex = BLOCK_LEGS.indexOf(target);
    const shape = blockIndex < 0 ? "lf" : (PLAIN_SHAPES[blockIndex % PLAIN_SHAPES.length] as string);

    it(
      `${target.id} (route ${route.id}, host "${shape}"): the install backs up only what it overwrites, the uninstall backs up everything it removes`,
      () => {
        const sandbox = makeSandbox();
        const foreign = fixtureNamed(shape);
        writeProjectFile(sandbox.project, "CLAUDE.md", foreign);
        writeProjectFile(sandbox.project, ".claude/settings.json", Buffer.from('{"hooks":{}}\n'));
        const hostRel = route.rule.kind === "block" ? route.rule.host : null;
        if (hostRel !== null) writeProjectFile(sandbox.project, hostRel, foreign);
        const snapshot = lstatTree(sandbox.project, { modes: true });
        expect([...filesUnder(sandbox.home).keys()], "a fresh home holds nothing").toEqual([]);

        // 1. Install.
        const installed = runBin(sandbox, ["skills", "install", "--client", target.id, "--yes"]);
        expect(installed.status, `${installed.stdout}${installed.stderr}`).toBe(0);
        assertHomeHoldsOnlyBackups(sandbox.home, "after the install");

        if (hostRel !== null) {
          // The host is edited in place, so it is backed up first, once, with its original bytes.
          const hostBackups = backupsOf(sandbox.home, hostRel);
          expect(hostBackups, `the install backs up the existing ${hostRel}`).toHaveLength(1);
          expect((hostBackups[0] as Buffer).equals(foreign), `${hostRel} backup holds the original bytes`).toBe(true);
          expect(filesUnder(sandbox.home).size, "no other backup on an install").toBe(1);

          // The block goes after the host's own bytes, which are all kept (all three shapes end with a line feed).
          const section = packRuleForms().agentsMd;
          const host = readProjectFile(sandbox.project, hostRel);
          const first = host.indexOf(section);
          expect(first, `${hostRel} holds the section`).toBeGreaterThanOrEqual(0);
          expect(host.indexOf(section, first + 1), `${hostRel} holds the section once`).toBe(-1);
          expect(first + section.length, "nothing follows the section").toBe(host.length);
          expect(host.subarray(0, first).equals(foreign), `the bytes before the section are the "${shape}" host, untouched`).toBe(true);
        } else {
          expect(filesUnder(sandbox.home).size, "an install that overwrites nothing takes no backup").toBe(0);
        }

        // What the uninstall must back up: every owned file as it is on disk just before it.
        const owned = new Map<string, Buffer>();
        for (const rel of expectedSkillFiles(route.skillsDir).keys()) owned.set(rel, readProjectFile(sandbox.project, rel));
        if (route.rule.kind === "file") {
          const rulePath = `${route.rule.dir}/${RULE_STEM}${RULE_FORM_EXTENSIONS[route.rule.form]}`;
          owned.set(rulePath, readProjectFile(sandbox.project, rulePath));
        } else {
          owned.set(route.rule.host, readProjectFile(sandbox.project, route.rule.host));
        }
        owned.set(MANIFEST, readProjectFile(sandbox.project, MANIFEST));

        // 2. Uninstall.
        const removed = runBin(sandbox, ["skills", "uninstall", "--client", target.id, "--yes"]);
        expect(removed.status, `${removed.stdout}${removed.stderr}`).toBe(0);
        expect(treeDiff(snapshot, lstatTree(sandbox.project, { modes: true })), "the project is as it was").toEqual([]);
        expect(readProjectFile(sandbox.project, "CLAUDE.md").equals(foreign), "CLAUDE.md keeps its bytes").toBe(true);
        if (hostRel !== null) {
          expect(readProjectFile(sandbox.project, hostRel).equals(foreign), `${hostRel} is byte-identical again`).toBe(true);
        }

        assertHomeHoldsOnlyBackups(sandbox.home, "after the uninstall");
        for (const [rel, bytes] of owned) {
          const backups = backupsOf(sandbox.home, rel);
          const expectedCount = rel === hostRel ? 2 : 1;
          expect(backups, `${rel}: backups taken`).toHaveLength(expectedCount);
          expect(
            backups.some((backup) => backup.equals(bytes)),
            `${rel}: a backup holds the bytes the uninstall removed`,
          ).toBe(true);
        }
        const expectedFiles = owned.size + (hostRel === null ? 0 : 1);
        expect(filesUnder(sandbox.home).size, "one backup per removed file, plus the install's backup of the host").toBe(expectedFiles);
      },
      SPAWN_TEST_TIMEOUT,
    );
  });

  it("the rotation gives every one of the three plain shapes to at least one block route", () => {
    expect(ROUTED).toHaveLength(16);
    expect(BLOCK_LEGS).toHaveLength(14);
    const used = new Set(BLOCK_LEGS.map((_, index) => PLAIN_SHAPES[index % PLAIN_SHAPES.length]));
    expect([...used].sort()).toEqual([...PLAIN_SHAPES].sort());
    for (const shape of PLAIN_SHAPES) {
      const bytes = fixtureNamed(shape);
      expect(bytes[bytes.length - 1], `${shape} ends with a line feed`).toBe(0x0a);
    }
  });
});
