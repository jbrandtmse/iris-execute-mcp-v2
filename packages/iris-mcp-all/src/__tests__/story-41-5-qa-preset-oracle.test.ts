/**
 * Story 41.5 QA (AC 41.5.1, AC 41.5.4; project rules #36, #44, #59) - the declared tool presets against the REAL servers.
 *
 * `validate:prompts` decides a skill's preset from each package's `dist/tools/presets.js` roster (`include` lists). This file
 * does not use that logic, the rosters or `scripts/lib`: it starts each of the five built servers over stdio under each of
 * `IRIS_TOOLS_PRESET=core|developer|full` and reads what `tools/list` advertises, which is what a client of that server can
 * call. A tool is visible under a preset when its owning server lists it; a skill's preset is the FIRST of core, developer
 * and full under which every `iris_*` token it names is visible. The expected value for each of the 39 agent-content files
 * is computed from those listings, and the 12 workflow skills are also checked against a typed table.
 *
 * Also pinned here: a workflow skill and its pack copy carry the same frontmatter (and the same bytes), the 12 prompt
 * definitions of the built packages declare the same preset the oracle computes, and no skill description names a tool.
 *
 * Every server is started with `default` pointing at 127.0.0.1:9, a closed local port, and no tool is called, so no IRIS
 * instance is reached. The file fails, never skips, when a dist is missing or older than its source.
 */

import { beforeAll, describe, expect, it } from "vitest";
import { pathToFileURL } from "node:url";
import path from "node:path";
import { REPO_ROOT } from "./pack-fixture";
import { distEntry, type IrisTarget, resolveSdkEsmDir, staleDistReason, withWireSession } from "./process-gate-helpers.js";
import {
  agentContentFiles,
  type ContentFile,
  declaredDescription,
  declaredPreset,
  freshPromptDefinitions,
  frontmatterLines,
  irisTokens,
  PRESET_ORDER,
  PROMPT_PACKAGE_COUNTS,
  skillDirectories,
} from "./story-41-5-qa-fixture";

const CLOSED_TARGET: IrisTarget = { host: "127.0.0.1", port: "9", username: "qa", password: "qa", namespace: "HSCUSTOM" };
const SERVERS = ["iris-admin-mcp", "iris-data-mcp", "iris-dev-mcp", "iris-interop-mcp", "iris-ops-mcp"];
/** The framework tool every server registers itself; it is visible under every preset. */
const DISCOVERY_TOOL = "iris_server_profiles";

type Preset = (typeof PRESET_ORDER)[number];

/** The 12 workflow skills and the preset each needs, as the spec's golden table states them. */
const WORKFLOW_PRESET: Record<string, Preset> = {
  "audit-security-posture": "full",
  "check-system-health": "full",
  "deploy-and-test-class": "developer",
  "diagnose-slow-query": "developer",
  "edit-and-test-class": "core",
  "find-patient-messages": "core",
  "promote-environment-change": "developer",
  "provision-project-environment": "core",
  "recover-stuck-production": "core",
  "resend-failed-messages": "core",
  "run-external-backup": "full",
  "trace-message-flow": "core",
};

/** `tools/list` of each server under each preset: key `<pkg>|<preset>`. */
const advertised = new Map<string, Set<string>>();

const listing = (pkg: string, preset: Preset): Set<string> => {
  const found = advertised.get(`${pkg}|${preset}`);
  if (found === undefined) throw new Error(`no tools/list for ${pkg} under ${preset}`);
  return found;
};

beforeAll(async () => {
  const sdkEsmDir = resolveSdkEsmDir(REPO_ROOT);
  if (!sdkEsmDir) throw new Error("Could not resolve the @modelcontextprotocol/client ESM build under node_modules/.pnpm - run pnpm install.");
  const stale = ["shared", ...SERVERS].map((pkg) => [pkg, staleDistReason(REPO_ROOT, pkg)] as const).filter(([, reason]) => reason !== undefined);
  if (stale.length > 0) throw new Error(`Build the packages first: ${stale.map(([pkg, reason]) => `${pkg}: ${reason}`).join("; ")}`);
  for (const preset of PRESET_ORDER) {
    const lists = await Promise.all(
      SERVERS.map((pkg) =>
        withWireSession(
          { sdkEsmDir, entry: distEntry(REPO_ROOT, pkg), target: CLOSED_TARGET, clientName: "story-41-5-qa-preset-oracle" },
          { IRIS_TOOLS_PRESET: preset },
          async (session) => new Set((await session.listTools()).map((tool) => tool.name)),
        ),
      ),
    );
    SERVERS.forEach((pkg, index) => advertised.set(`${pkg}|${preset}`, lists[index] as Set<string>));
  }
}, 240_000);

/** The servers that list `tool` under `full`: its owners. */
const ownersOf = (tool: string): string[] => SERVERS.filter((pkg) => listing(pkg, "full").has(tool));

/** Whether a client of the suite can call `tool` under `preset`: its owning server advertises it. */
const visibleUnder = (tool: string, preset: Preset): boolean => tool === DISCOVERY_TOOL || ownersOf(tool).some((pkg) => listing(pkg, preset).has(tool));

/** The first preset, in core, developer, full order, under which every token is visible; `null` when none shows them all. */
function firstShowing(tokens: string[]): Preset | null {
  return PRESET_ORDER.find((preset) => tokens.every((token) => visibleUnder(token, preset))) ?? null;
}

const files: ContentFile[] = agentContentFiles(REPO_ROOT);

describe("the oracle reads the real servers, and the presets can tell a skill apart (project rule #59)", () => {
  it("under full each server advertises exactly the tools of its built package plus the discovery tool: 115 in all", async () => {
    let total = 0;
    for (const pkg of SERVERS) {
      const mod = (await import(pathToFileURL(path.join(REPO_ROOT, "packages", pkg, "dist", "tools", "index.js")).href)) as { tools: Array<{ name: string }> };
      const expected = [...mod.tools.map((tool) => tool.name), DISCOVERY_TOOL].sort();
      expect([...listing(pkg, "full")].sort(), `${pkg} under full`).toEqual(expected);
      total += expected.length;
    }
    expect(total).toBe(115);
  });

  it("core and developer each hide tools that full shows, on some server, and neither preset contains the other", () => {
    for (const preset of ["core", "developer"] as const) {
      const hidden = SERVERS.flatMap((pkg) => [...listing(pkg, "full")].filter((tool) => !listing(pkg, preset).has(tool)));
      expect(hidden.length, `${preset} hides something`).toBeGreaterThan(0);
      for (const pkg of SERVERS) for (const tool of listing(pkg, preset)) expect(listing(pkg, "full").has(tool), `${pkg} ${preset} lists a tool full lacks: ${tool}`).toBe(true);
    }
    const coreOnly = SERVERS.flatMap((pkg) => [...listing(pkg, "core")].filter((tool) => !listing(pkg, "developer").has(tool)));
    const developerOnly = SERVERS.flatMap((pkg) => [...listing(pkg, "developer")].filter((tool) => !listing(pkg, "core").has(tool)));
    expect(coreOnly, "a tool core shows and developer hides").toContain("iris_user_manage");
    expect(developerOnly.length, "a tool developer shows and core hides").toBeGreaterThan(0);
  });

  it("every iris_* token of the 40 content files names a tool some server advertises", () => {
    const unknown = files.flatMap((file) => irisTokens(file.text).filter((token) => token !== DISCOVERY_TOOL && ownersOf(token).length === 0).map((token) => `${file.rel}: ${token}`));
    expect(unknown).toEqual([]);
  });

  it("the 40 files are 12 workflow skills, 18 pack skills, 6 knowledge skills, 1 rule and 3 pack rule forms", () => {
    const count = (group: ContentFile["group"]): number => files.filter((file) => file.group === group).length;
    expect([count("workflow"), count("pack-skill"), count("knowledge"), count("rule"), count("pack-rule")]).toEqual([12, 18, 6, 1, 3]);
    expect(files).toHaveLength(40);
  });
});

describe("each content file declares the first preset under which every tool it names is advertised (AC 41.5.4)", () => {
  it.each(files.map((file) => [file.rel, file] as const))("%s", (_rel, file) => {
    const tokens = irisTokens(file.text);
    const declared = declaredPreset(file.text);
    if (tokens.length === 0) {
      expect(declared, "a file that names no tool declares no preset").toBeNull();
      return;
    }
    const first = firstShowing(tokens);
    expect(first, `some preset shows ${tokens.join(", ")}`).not.toBeNull();
    expect(declared, `${file.rel} names ${tokens.length} tool(s); the first preset that shows them all is ${first}`).toBe(first);
    for (const token of tokens) expect(visibleUnder(token, declared as Preset), `${token} is advertised under ${declared}`).toBe(true);
  });

  it("only the 12 workflow skills and their 12 pack copies declare a preset, and the oracle agrees with the spec's table", () => {
    const declaring = files.filter((file) => declaredPreset(file.text) !== null);
    expect(declaring.map((file) => file.group).sort()).toEqual([...Array(12).fill("pack-skill"), ...Array(12).fill("workflow")].sort());
    for (const file of declaring) {
      const name = path.basename(path.dirname(file.rel));
      expect(Object.keys(WORKFLOW_PRESET), `${file.rel} is one of the 12`).toContain(name);
      expect(firstShowing(irisTokens(file.text)), `${file.rel} by the oracle`).toBe(WORKFLOW_PRESET[name]);
      expect(declaredPreset(file.text), `${file.rel} as declared`).toBe(WORKFLOW_PRESET[name]);
    }
  });

  it("the built prompt definitions declare the preset the oracle computes from the text each one builds", () => {
    const definitions = PROMPT_PACKAGE_COUNTS.flatMap(([pkg]) => freshPromptDefinitions(REPO_ROOT, pkg));
    expect(definitions).toHaveLength(12);
    for (const definition of definitions) {
      expect(definition.skillPreset, `${definition.name} skill.preset`).toBe(firstShowing(irisTokens(definition.body)));
      expect(irisTokens(definition.skillDescription ?? ""), `${definition.name} skill description names no tool`).toEqual([]);
    }
  });
});

describe("a workflow skill and its pack copy are one file (AD-14)", () => {
  const pack = "packages/client-config/skills-pack/skills";
  const workflow = skillDirectories(path.join(REPO_ROOT, "skills"));

  it("every workflow skill is in the pack with the same frontmatter and the same bytes", () => {
    expect(workflow).toHaveLength(12);
    for (const name of workflow) {
      const source = files.find((file) => file.rel === `skills/${name}/SKILL.md`)?.text ?? "";
      const copy = files.find((file) => file.rel === `${pack}/${name}/SKILL.md`)?.text;
      expect(copy, `${name} is in the pack`).toBeDefined();
      expect(frontmatterLines(copy ?? ""), `${name} frontmatter`).toEqual(frontmatterLines(source));
      expect(declaredDescription(copy ?? ""), `${name} description`).toBe(declaredDescription(source));
      expect(copy, `${name} bytes`).toBe(source);
    }
  });

  it("every knowledge skill is in the pack with the same frontmatter and the same bytes, and the pack holds nothing else", () => {
    const knowledge = files.filter((file) => file.group === "knowledge");
    for (const file of knowledge) {
      const name = path.basename(path.dirname(file.rel));
      const copy = files.find((candidate) => candidate.rel === `${pack}/${name}/SKILL.md`);
      expect(copy, `${name} is in the pack`).toBeDefined();
      expect(frontmatterLines(copy?.text ?? ""), `${name} frontmatter`).toEqual(frontmatterLines(file.text));
      expect(copy?.text, `${name} bytes`).toBe(file.text);
    }
    expect(skillDirectories(path.join(REPO_ROOT, pack)).sort()).toEqual([...workflow, ...knowledge.map((file) => path.basename(path.dirname(file.rel)))].sort());
  });
});
