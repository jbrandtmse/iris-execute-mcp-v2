/**
 * Story 41.6 - the installer payloads in the provenance check (D10; AC 41.1.4 assigned the payload to this story).
 *
 * `check:provenance` gathers one `installer:<route>` distribution per route from the BUILT installer
 * (`packages/client-config/dist/pack-plan.js`, through the probe script), so the check runs the installer's own
 * placement logic. A `noticeBeside` distribution needs, for each file that carries adapted content, a notice in
 * the same directory that equals the canonical notice.
 *
 * Rows:
 *  - the real tree: the four installer distributions, each holding the notice beside the adapted SQL skill;
 *  - the beside rule is proven red through an injected payload that has the notice elsewhere but not beside the
 *    skill (and with a notice one byte off), and the same payload without the `noticeBeside` flag passes, so the
 *    rule is what catches it;
 *  - the gatherer: probe results map to distributions, a failing probe is fail-closed as `installer`, and a root
 *    without client-config's manifest gathers none;
 *  - the real CLI in a scratch copy with client-config unbuilt exits 1 naming `installer`.
 */

import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { checkDistFresh } from "../../../../scripts/lib/dist-freshness.mjs";
import { checkProvenance } from "../../../../scripts/lib/provenance-core.mjs";
import { gatherProvenanceInputs, runInstallerProbe } from "../../../../scripts/lib/provenance-inputs.mjs";
import { NOTICE_FILENAME, PACK_SOURCE_DIR } from "../../../../scripts/lib/skills-pack.mjs";
import { makeTempRoot, put, removeTempRoot, REPO_ROOT } from "./pack-fixture";
import { flipMiddleByte, makeScratchRepo, problemPairs, removeScratchRepo, runScript } from "./story-41-1-qa-fixture";

interface Distribution {
  name: string;
  mustShipPack: boolean;
  noticeBeside?: boolean;
  files: Array<{ path: string; bytes: Buffer }>;
  problem?: string;
}

interface Inputs {
  sourceNotice: Buffer | null;
  distributions: Distribution[];
  [key: string]: unknown;
}

const ROUTES = ["claude-code", "cursor", "gemini", "agents"] as const;
const SQL_DIR = (route: string): string => `${route === "claude-code" ? ".claude" : ".agents"}/skills/iris-mcp-objectscript-sql`;
const canonical = readFileSync(join(REPO_ROOT, PACK_SOURCE_DIR, NOTICE_FILENAME));

let inputs: Inputs;
beforeAll(() => {
  const fresh = checkDistFresh(join(REPO_ROOT, "packages", "client-config"), "@iris-mcp/client-config");
  if (!fresh.ok || fresh.skipped) {
    throw new Error(
      `${fresh.reason ?? "@iris-mcp/client-config declares no dist/ build output."} ` +
        'Run "pnpm --filter @iris-mcp/client-config build" and retry.',
    );
  }
  inputs = gatherProvenanceInputs(REPO_ROOT) as Inputs;
});

const temps: string[] = [];
afterEach(() => {
  for (const root of temps.splice(0)) removeTempRoot(root);
});

/** The real inputs with one installer distribution rewritten. */
function withInstaller(route: string, edit: (files: Distribution["files"]) => Distribution["files"], keepFlag = true): Inputs {
  return {
    ...inputs,
    distributions: inputs.distributions.map((distribution) =>
      distribution.name === `installer:${route}`
        ? {
            ...distribution,
            ...(keepFlag ? {} : { noticeBeside: false }),
            files: edit(distribution.files.map((file) => ({ ...file }))),
          }
        : distribution,
    ),
  };
}

const installerProblems = (candidate: Inputs): Array<{ rule: string; label: string; message: string }> =>
  (checkProvenance(candidate) as Array<{ rule: string; label: string; message: string }>).filter((problem) => problem.label.startsWith("installer"));

describe("the real tree: the installer distributions", () => {
  it("has one distribution per route, in route order, each marked noticeBeside and not a pack shipper", () => {
    const installers = inputs.distributions.filter((distribution) => distribution.name.startsWith("installer"));
    expect(installers.map((distribution) => distribution.name)).toEqual(ROUTES.map((route) => `installer:${route}`));
    for (const distribution of installers) {
      expect(distribution.problem, distribution.name).toBeUndefined();
      expect(distribution.noticeBeside, distribution.name).toBe(true);
      expect(distribution.mustShipPack, distribution.name).toBe(false);
    }
  });

  it.each(ROUTES)("%s: the notice sits beside the adapted SQL skill, byte-equal to the canonical notice", (route) => {
    const distribution = inputs.distributions.find((entry) => entry.name === `installer:${route}`) as Distribution;
    const skill = distribution.files.find((file) => file.path === `${SQL_DIR(route)}/SKILL.md`);
    const notice = distribution.files.find((file) => file.path === `${SQL_DIR(route)}/${NOTICE_FILENAME}`);
    expect(skill?.bytes.includes("Adapted from intersystems-community/iris-agentic-dev")).toBe(true);
    expect(notice?.bytes.equals(canonical)).toBe(true);
  });

  it("raises no problem for any installer distribution", () => {
    expect(installerProblems(inputs)).toEqual([]);
    expect(checkProvenance(inputs)).toEqual([]);
  });
});

describe("the beside rule is proven red through an injected payload", () => {
  const BESIDE = (route: string): string =>
    `the installed copy ${SQL_DIR(route)}/SKILL.md carries adapted content but no ${NOTICE_FILENAME} beside it equal to the canonical notice`;

  it.each(ROUTES)("%s: a notice elsewhere in the payload, none beside the skill, is refused with the golden message", (route) => {
    const bad = withInstaller(route, (files) => [
      ...files.filter((file) => file.path !== `${SQL_DIR(route)}/${NOTICE_FILENAME}`),
      { path: `docs/${NOTICE_FILENAME}`, bytes: canonical },
    ]);
    expect(installerProblems(bad)).toEqual([{ rule: "distribution", label: `installer:${route}`, message: BESIDE(route) }]);
  });

  it("a notice beside the skill that differs by one byte is refused", () => {
    const bad = withInstaller("claude-code", (files) =>
      files.map((file) => (file.path.endsWith(`iris-mcp-objectscript-sql/${NOTICE_FILENAME}`) ? { ...file, bytes: flipMiddleByte(file.bytes) } : file)),
    );
    const problems = installerProblems(bad);
    expect(problems.map((problem) => problem.message)).toContain(BESIDE("claude-code"));
  });

  it("a notice in a sibling skill directory is not beside the adapted skill", () => {
    const bad = withInstaller("cursor", (files) => [
      ...files.filter((file) => file.path !== `${SQL_DIR("cursor")}/${NOTICE_FILENAME}`),
      { path: `.agents/skills/iris-mcp-system-classes/${NOTICE_FILENAME}`, bytes: canonical },
    ]);
    expect(installerProblems(bad).map((problem) => problem.message)).toEqual([BESIDE("cursor")]);
  });

  it("the same payload without the noticeBeside flag passes the older rule, so the beside rule is what catches it", () => {
    const edit = (files: Distribution["files"]): Distribution["files"] => [
      ...files.filter((file) => file.path !== `${SQL_DIR("gemini")}/${NOTICE_FILENAME}`),
      { path: `docs/${NOTICE_FILENAME}`, bytes: canonical },
    ];
    expect(installerProblems(withInstaller("gemini", edit, true)).length).toBe(1);
    expect(installerProblems(withInstaller("gemini", edit, false))).toEqual([]);
  });

  it("each installed file that carries adapted content is checked, a root-level one included", () => {
    const bad = withInstaller("agents", (files) => [...files, { path: "marked.md", bytes: Buffer.from("Adapted from intersystems-community/iris-agentic-dev\n") }]);
    expect(installerProblems(bad).map((problem) => problem.message)).toEqual([
      `the installed copy marked.md carries adapted content but no ${NOTICE_FILENAME} beside it equal to the canonical notice`,
    ]);
    const ok = withInstaller("agents", (files) => [
      ...files,
      { path: "marked.md", bytes: Buffer.from("Adapted from intersystems-community/iris-agentic-dev\n") },
      { path: NOTICE_FILENAME, bytes: canonical },
    ]);
    expect(installerProblems(ok)).toEqual([]);
  });
});

describe("the gatherer", () => {
  const listing = JSON.stringify([{ files: [{ path: "package.json" }] }]);
  const stubPack = () => ({ status: 0, stdout: listing, stderr: "", error: null });

  function workspace(): string {
    const root = makeTempRoot("qa-41-6-workspace");
    temps.push(root);
    put(root, "packages/client-config/package.json", JSON.stringify({ name: "@iris-mcp/client-config", version: "1.0.0" }));
    return root;
  }

  it("maps the probe's payloads to installer distributions, decoding the bytes", () => {
    const root = workspace();
    const payload = { payloads: [{ route: "claude-code", files: [{ path: "a/b.txt", base64: Buffer.from("hello").toString("base64") }] }] };
    const gathered = gatherProvenanceInputs(root, {
      runNpmPack: stubPack,
      runInstallerProbe: () => ({ status: 0, stdout: JSON.stringify(payload), stderr: "", error: null }),
    }) as Inputs;
    const installer = gathered.distributions.find((distribution) => distribution.name === "installer:claude-code") as Distribution;
    expect(installer.noticeBeside).toBe(true);
    expect(installer.mustShipPack).toBe(false);
    expect(installer.files.map((file) => [file.path, file.bytes.toString("utf8")])).toEqual([["a/b.txt", "hello"]]);
  });

  it("is fail-closed: a failing probe, an unreadable payload and an error are one `installer` distribution with a problem", () => {
    const root = workspace();
    const cases: Array<[string, { status: number | null; stdout: string; stderr: string; error: Error | null }, string]> = [
      ["a non-zero exit", { status: 1, stdout: "", stderr: "first line\nsecond line\n", error: null }, "first line"],
      ["no stderr at all", { status: 1, stdout: "", stderr: "", error: null }, "exit status 1"],
      ["a spawn error", { status: null, stdout: "", stderr: "", error: new Error("spawn exploded") }, "spawn exploded"],
      ["output that is not JSON", { status: 0, stdout: "not json", stderr: "", error: null }, "the probe did not print JSON"],
      ["JSON without payloads", { status: 0, stdout: "{}", stderr: "", error: null }, "the probe printed JSON without payloads"],
      ["an empty payload list", { status: 0, stdout: JSON.stringify({ payloads: [] }), stderr: "", error: null }, "the probe printed JSON without payloads"],
      [
        "a malformed file entry",
        { status: 0, stdout: JSON.stringify({ payloads: [{ route: "x", files: [{ path: 1 }] }] }), stderr: "", error: null },
        "the probe printed JSON without payloads",
      ],
    ];
    for (const [name, result, detail] of cases) {
      const gathered = gatherProvenanceInputs(root, { runNpmPack: stubPack, runInstallerProbe: () => result }) as Inputs;
      const installer = gathered.distributions.filter((distribution) => distribution.name.startsWith("installer"));
      expect(installer.length, name).toBe(1);
      expect(installer[0]?.name, name).toBe("installer");
      expect(installer[0]?.files, name).toEqual([]);
      expect(installer[0]?.problem, name).toBe(
        `the installer payloads could not be computed (${detail}); build @iris-mcp/client-config first`,
      );
      expect(checkProvenance({ ...gathered, sourceNotice: canonical }).some((problem: { label: string }) => problem.label === "installer"), name).toBe(true);
    }
  });

  it("gathers no installer distribution from a root without client-config's manifest", () => {
    const root = makeTempRoot("qa-41-6-no-client-config");
    temps.push(root);
    put(root, "packages/other/package.json", JSON.stringify({ name: "@zz/other", version: "1.0.0" }));
    let probed = false;
    const gathered = gatherProvenanceInputs(root, {
      runNpmPack: stubPack,
      runInstallerProbe: () => {
        probed = true;
        return { status: 1, stdout: "", stderr: "", error: null };
      },
    }) as Inputs;
    expect(probed).toBe(false);
    expect(gathered.distributions.map((distribution) => distribution.name)).toEqual(["@zz/other"]);
  });

  it("the real probe prints the same payloads the installer computes for this tree", () => {
    const run = runInstallerProbe(REPO_ROOT) as { status: number | null; stdout: string; stderr: string };
    expect(run.status, run.stderr).toBe(0);
    const parsed = JSON.parse(run.stdout) as { payloads: Array<{ route: string; files: Array<{ path: string; base64: string }> }> };
    expect(parsed.payloads.map((payload) => payload.route)).toEqual([...ROUTES]);
    for (const payload of parsed.payloads) {
      const distribution = inputs.distributions.find((entry) => entry.name === `installer:${payload.route}`) as Distribution;
      expect(payload.files.map((file) => file.path)).toEqual(distribution.files.map((file) => file.path));
    }
  });
});

describe("the real CLI with client-config unbuilt (scratch copy)", () => {
  let scratch = "";
  beforeAll(() => {
    scratch = makeScratchRepo({ clientConfigManifest: true });
  });

  it("exits 1 and names `installer`, never passing and never skipping", () => {
    try {
      rmSync(join(scratch, "packages", "client-config", "dist"), { recursive: true });
      const run = runScript(scratch, "scripts/check-provenance.mjs");
      expect(run.status, `${run.stdout}${run.stderr}`).toBe(1);
      expect(run.stdout).not.toContain("check-provenance: OK");
      expect(problemPairs(run.stderr)).toContain("distribution installer");
      expect(run.stderr).toMatch(/\[distribution\] installer: the installer payloads could not be computed \(.+\); build @iris-mcp\/client-config first/);
    } finally {
      removeScratchRepo(scratch);
    }
  });
});
