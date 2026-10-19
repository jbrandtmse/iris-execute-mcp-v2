/**
 * Story 41.2 QA (AC 41.2.2; project rule #46) - the prompts of the five BUILT servers over real stdio.
 *
 * `story-38-6-qa-edit-prompt-sdk-wire.test.ts` drives a `McpServerBase` built from the dev dist's prompt array over an
 * in-memory transport. This file starts each server's own `dist/index.js` in a child process and connects a real SDK
 * `Client` through `StdioClientTransport`, so the entry point, the registration order and the wire framing are the ones
 * a client gets:
 *  - dev lists exactly its four remaining prompts, in order, and `prompts/get` for the retired `objectscript-review` is
 *    an InvalidParams (-32602) naming it, as it is on every other server that registers prompts;
 *  - the other servers' prompts keep their name, title and arguments (admin 2, interop 4, ops 2; data registers none, so
 *    `prompts/list` is MethodNotFound), 12 in all, and their names are the names of the generated workflow skills;
 *  - every remaining prompt renders over the wire, and none points at the retired prompt;
 *  - `prompts/get` with `arguments` omitted entirely never ends in an internal error, and the connection stays usable;
 *  - dev's npm tarball file list holds the four prompt modules and nothing of the retired one;
 *  - Story 41.5 (AC 41.5.1, AD-15, AD-28): `prompts/list` and every `prompts/get` hash to the bytes captured before a prompt
 *    gained its skill-only `skill` field, each listed entry keeps exactly its four keys and its own description, and neither
 *    the skill description nor the preset key appears anywhere on the wire.
 *
 * Every server is started with `default` pointing at 127.0.0.1:9, a closed local port, and no tool is called, so no
 * IRIS instance is reached. The expected prompt table was captured from the built dists over stdio on 2026-10-19
 * (admin, data, dev, interop and ops `dist/index.js`, `prompts/list`); the four non-dev sources are unchanged since the
 * baseline of Story 41.2.
 *
 * Reads the built dists of `shared` and the five servers and the SDK of the monorepo's pnpm store; it fails, never
 * skips, when one is missing or older than its source (run the package builds first).
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { loadAllPrompts } from "../../../../scripts/lib/prompt-catalog.mjs";
import { runNpmPack } from "../../../../scripts/lib/provenance-inputs.mjs";
import { PACK_DIR, WORKFLOW_SKILLS_DIR } from "../../../../scripts/lib/skills-pack.mjs";
import { REPO_ROOT } from "./pack-fixture";
import {
  distEntry,
  type IrisTarget,
  openWireSession,
  resolveSdkEsmDir,
  staleDistReason,
  type WireSession,
} from "./process-gate-helpers.js";
import { promptRejection, promptText } from "./prompt-gate-helpers.js";

const INVALID_PARAMS = -32602;
const METHOD_NOT_FOUND = -32601;
const RETIRED_PROMPT = "objectscript-review";

/** `default` is a closed local port: the servers start (an unreachable default never fails startup) and nothing is reached. */
const CLOSED_TARGET: IrisTarget = { host: "127.0.0.1", port: "9", username: "qa", password: "qa", namespace: "HSCUSTOM" };

/** A prompt as `prompts/list` shows it: name, title and the arguments as `name!` (required) or `name?` (optional). */
type PromptRow = [name: string, title: string, args: string[]];

interface ServerExpectation {
  pkg: string;
  /** In `prompts/list` order; `null` for a server that registers no prompt. */
  prompts: PromptRow[] | null;
}

const SERVERS: ServerExpectation[] = [
  {
    pkg: "iris-admin-mcp",
    prompts: [
      ["provision-project-environment", "Provision Project Environment", ["projectName!"]],
      ["audit-security-posture", "Audit Security Posture", ["server?"]],
    ],
  },
  { pkg: "iris-data-mcp", prompts: null },
  {
    pkg: "iris-dev-mcp",
    prompts: [
      ["diagnose-slow-query", "Diagnose Slow Query", ["query!", "namespace?"]],
      ["deploy-and-test-class", "Deploy And Test Class", ["classOrPackage!"]],
      ["promote-environment-change", "Promote Environment Change", ["source!", "target!", "spec?"]],
      ["edit-and-test-class", "Edit And Test Class", ["className!", "change!", "testClass?"]],
    ],
  },
  {
    pkg: "iris-interop-mcp",
    prompts: [
      ["trace-message-flow", "Trace Message Flow", ["sessionOrHeaderId!", "namespace?"]],
      ["recover-stuck-production", "Recover Stuck Production", ["production?", "namespace?"]],
      ["resend-failed-messages", "Resend Failed Messages", ["item!", "since!"]],
      ["find-patient-messages", "Find Patient Messages", ["patientId!", "from?", "to?", "searchTableClass?", "namespace?"]],
    ],
  },
  {
    pkg: "iris-ops-mcp",
    prompts: [
      ["check-system-health", "Check System Health", ["server?"]],
      ["run-external-backup", "Run External Backup", ["server?"]],
    ],
  },
];

interface ListedPrompt {
  name: string;
  title?: string;
  arguments?: Array<{ name: string; required?: boolean }>;
}

const sessions = new Map<string, WireSession>();

beforeAll(async () => {
  const sdkEsmDir = resolveSdkEsmDir(REPO_ROOT);
  if (!sdkEsmDir) {
    throw new Error("Could not resolve the @modelcontextprotocol/sdk ESM build under node_modules/.pnpm - run pnpm install.");
  }
  const stale = ["shared", ...SERVERS.map((server) => server.pkg)]
    .map((pkg) => [pkg, staleDistReason(REPO_ROOT, pkg)] as const)
    .filter(([, reason]) => reason !== undefined);
  if (stale.length > 0) {
    throw new Error(`Build the packages first: ${stale.map(([pkg, reason]) => `${pkg}: ${reason}`).join("; ")}`);
  }
  for (const server of SERVERS) {
    sessions.set(
      server.pkg,
      await openWireSession({ sdkEsmDir, entry: distEntry(REPO_ROOT, server.pkg), target: CLOSED_TARGET, clientName: "story-41-2-qa-prompts-stdio" }),
    );
  }
}, 120_000);

afterAll(async () => {
  await Promise.all([...sessions.values()].map((session) => session.close()));
});

function sessionOf(pkg: string): WireSession {
  const session = sessions.get(pkg);
  if (session === undefined) throw new Error(`no session for ${pkg}`);
  return session;
}

function rowOf(prompt: ListedPrompt): PromptRow {
  return [prompt.name, prompt.title ?? "", (prompt.arguments ?? []).map((argument) => `${argument.name}${argument.required === true ? "!" : "?"}`)];
}

/** What `prompts/list` answers on a server that registers prompts. */
async function listed(pkg: string): Promise<ListedPrompt[]> {
  return (await sessionOf(pkg).listPrompts()) as ListedPrompt[];
}

describe("the built dev server over stdio lists only its four remaining prompts (AC 41.2.2)", () => {
  it("lists diagnose-slow-query, deploy-and-test-class, promote-environment-change and edit-and-test-class, in that order", async () => {
    const prompts = await listed("iris-dev-mcp");
    expect(prompts.map((prompt) => prompt.name)).toEqual([
      "diagnose-slow-query",
      "deploy-and-test-class",
      "promote-environment-change",
      "edit-and-test-class",
    ]);
    expect(prompts.map((prompt) => prompt.name)).not.toContain(RETIRED_PROMPT);
  });

  it("prompts/get for the retired objectscript-review is an InvalidParams naming it", async () => {
    const refused = await promptRejection(sessionOf("iris-dev-mcp"), { name: RETIRED_PROMPT });
    expect(refused, "the request was refused").toBeDefined();
    expect(refused?.code).toBe(INVALID_PARAMS);
    expect(refused?.message).toContain(RETIRED_PROMPT);
  });

  it("an unknown name is refused the same way, and the refusals leave the connection usable", async () => {
    const session = sessionOf("iris-dev-mcp");
    const unknown = await promptRejection(session, { name: "no-such-prompt" });
    expect(unknown?.code).toBe(INVALID_PARAMS);
    expect(unknown?.message).toContain("no-such-prompt");
    expect((await listed("iris-dev-mcp")).map((prompt) => prompt.name)).toHaveLength(4);
  });
});

describe("the built servers keep their prompts over stdio, 12 in all (AC 41.2.2)", () => {
  it.each(SERVERS.filter((server) => server.prompts !== null))("$pkg lists its prompts with their names, titles and arguments", async ({ pkg, prompts }) => {
    expect((await listed(pkg)).map(rowOf)).toEqual(prompts);
  });

  it("iris-data-mcp registers no prompt: prompts/list and prompts/get are MethodNotFound", async () => {
    const session = sessionOf("iris-data-mcp");
    const listRefusal = await session.listPrompts().then(
      () => undefined,
      (error: unknown) => error as { code?: number },
    );
    expect(listRefusal?.code).toBe(METHOD_NOT_FOUND);
    expect((await promptRejection(session, { name: RETIRED_PROMPT }))?.code).toBe(METHOD_NOT_FOUND);
  });

  it("the suite lists 12 prompts, each name once, and the retired one on none", async () => {
    const names: string[] = [];
    for (const server of SERVERS) {
      if (server.prompts === null) continue;
      names.push(...(await listed(server.pkg)).map((prompt) => prompt.name));
    }
    expect(names).toHaveLength(12);
    expect(new Set(names).size, "no prompt name is registered twice").toBe(12);
    expect(names).not.toContain(RETIRED_PROMPT);
  });

  it.each(SERVERS.filter((server) => server.prompts !== null && server.pkg !== "iris-dev-mcp"))(
    "prompts/get for the retired name on $pkg is an InvalidParams naming it",
    async ({ pkg }) => {
      const refused = await promptRejection(sessionOf(pkg), { name: RETIRED_PROMPT });
      expect(refused?.code).toBe(INVALID_PARAMS);
      expect(refused?.message).toContain(RETIRED_PROMPT);
    },
  );
});

describe("the live prompt names are the generated workflow skills (AC 41.2.2)", () => {
  it("equal the directories of skills/ and are each a skill directory of the pack", async () => {
    const live: string[] = [];
    for (const server of SERVERS) {
      if (server.prompts === null) continue;
      live.push(...(await listed(server.pkg)).map((prompt) => prompt.name));
    }
    const generated = readdirSync(path.join(REPO_ROOT, WORKFLOW_SKILLS_DIR), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
    expect([...live].sort()).toEqual(generated);
    for (const name of live) {
      expect(existsSync(path.join(REPO_ROOT, PACK_DIR, "skills", name, "SKILL.md")), `pack skills/${name}/SKILL.md`).toBe(true);
    }
    expect(existsSync(path.join(REPO_ROOT, PACK_DIR, "skills", RETIRED_PROMPT))).toBe(false);
  });
});

describe("every remaining prompt renders over stdio and none points at the retired prompt (AC 41.2.2)", () => {
  it.each(SERVERS.filter((server) => server.prompts !== null))("$pkg: each prompt answers one user text message with sample arguments", async ({ pkg }) => {
    const session = sessionOf(pkg);
    for (const prompt of await listed(pkg)) {
      const args = Object.fromEntries((prompt.arguments ?? []).map((argument) => [argument.name, `sample-${argument.name}`]));
      const text = promptText(await session.getPrompt({ name: prompt.name, arguments: args }));
      expect(text.length, `${prompt.name} renders text`).toBeGreaterThan(0);
      expect(text, `${prompt.name} does not name the retired prompt`).not.toContain(RETIRED_PROMPT);
      expect(text, `${prompt.name} has no unresolved placeholder`).not.toContain("undefined");
    }
  });

  it("prompts/get with `arguments` omitted entirely is a render or a clean InvalidParams naming the prompt, never an internal error, and the connection stays usable", async () => {
    let refusedCount = 0;
    let requiredCount = 0;
    for (const server of SERVERS) {
      if (server.prompts === null) continue;
      const session = sessionOf(server.pkg);
      const before = await listed(server.pkg);
      for (const prompt of before) {
        const outcome = await session.getPrompt({ name: prompt.name }).then(
          (rendered) => ({ text: promptText(rendered) }),
          (error: unknown) => ({ error: error as { code?: number; message?: string } }),
        );
        const hasRequired = (prompt.arguments ?? []).some((argument) => argument.required === true);
        if (hasRequired) requiredCount += 1;
        if ("error" in outcome) {
          refusedCount += 1;
          expect(outcome.error.code, `${prompt.name} omitted arguments`).toBe(INVALID_PARAMS);
          expect(outcome.error.message, `${prompt.name} omitted arguments`).toContain(prompt.name);
        } else {
          expect(hasRequired, `${prompt.name} declares a required argument, so it cannot render without any`).toBe(false);
          expect(outcome.text.length).toBeGreaterThan(0);
        }
      }
      expect((await listed(server.pkg)).map(rowOf), `${server.pkg} is still usable after the refusals`).toEqual(before.map(rowOf));
    }
    // A prompt with a required argument is always refused, so the refusal path is exercised.
    expect(requiredCount).toBeGreaterThan(0);
    expect(refusedCount).toBeGreaterThanOrEqual(requiredCount);
  });
});

/**
 * The wire bytes of every prompt, captured at 26dc8b2 (before Story 41.5 gave a prompt a skill-only field) from the
 * built dists over stdio, with a scratch Node script on the SDK `@modelcontextprotocol/sdk@1.29.0` (`StdioClientTransport`
 * against `packages/<pkg>/dist/index.js`, `IRIS_HOST=127.0.0.1`, `IRIS_PORT=9`). Each value is
 * `sha256(JSON.stringify(x))`: `list` hashes `(await client.listPrompts()).prompts`, and each `get` value hashes the whole
 * `getPrompt` result for `arguments` = every declared argument set to `v-<name>`. The oracle is the pre-change server,
 * so an edit that changes any wire byte cannot move it.
 */
const WIRE_GOLDEN: Record<string, { list: string; get: Record<string, string> }> = {
  "iris-admin-mcp": {
    list: "bd531fad56f723fc0bdb547d4a38bec717139f2724a3ddd3df1616488a3aa827",
    get: {
      "provision-project-environment": "72cd7ebd5c7a5283183dbf40c3bf7bdaa02465cab38b81177cfc50e60d7ce215",
      "audit-security-posture": "fed7d6bdbbcc5520297910ca88502803ea08a246d92364abc9c8e86cbe3eb116",
    },
  },
  "iris-dev-mcp": {
    list: "a1317b095ad7720e2caae07d57e3658a308a1bf42d2c3c6272d897520eade217",
    get: {
      "diagnose-slow-query": "b038a8c18dbc1b010f4f1f2662a26b17c995e735ed3f0230ed271433ebe42abb",
      "deploy-and-test-class": "a33adecb68164ce91338713b4ffac873e926d6635acbe495591c722e8edeb15d",
      "promote-environment-change": "31c9e03e31d888530ce9c021b104e0fa2b5c8144f24bc27280bc86a5f6e3704f",
      "edit-and-test-class": "f97413b0c895e5663568ef0c06037db2765898b1e28e5d4ee29b62059554173e",
    },
  },
  "iris-interop-mcp": {
    list: "71984e9be366489028552861bb096415ad6d2673f683029e35d7d94bf9785164",
    get: {
      "trace-message-flow": "d774181ef6d285aeaf14fd41abdf83422a67d01e82705d125e19b92e3e1d0482",
      "recover-stuck-production": "186084eb03b610917a641d521db127596107ee7d5b97c402fea9c11a11eb4b4f",
      "resend-failed-messages": "af4ac020ae0c2e8baace9ff5686431f60f3cb812fc479543569c36261da5211a",
      "find-patient-messages": "9f1b22aa8fc71c837b2a792f759b854ac7bc5e42bb2f1e822ddbc873401f080d",
    },
  },
  "iris-ops-mcp": {
    list: "a8a37a4ec55f819cfdfd6d9106a7ddbca413b47e3da758816119cb5398ff55bb",
    get: {
      "check-system-health": "3cdb4da3fbaffc886a64469b0e6525249ab83f52d3e9579e5b3bb2c8142d48d7",
      "run-external-backup": "70c81a1f821451a05e2e414f2d9503976e2ad9663e74a3f94a40d39a7fe29e0a",
    },
  },
};

function sha256Hex(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

interface PromptWithSkill {
  name: string;
  description: string;
  skill?: { description: string; preset: string };
}

/** The definitions each built server registers, read from the same dist the server runs. */
async function definitionsOf(pkg: string): Promise<PromptWithSkill[]> {
  const all = (await loadAllPrompts(REPO_ROOT)) as Array<{ pkg: string; prompt: PromptWithSkill }>;
  return all.filter((entry) => entry.pkg === pkg).map((entry) => entry.prompt);
}

describe("the skill-only field never reaches the wire (AC 41.5.1, AD-15, AD-28)", () => {
  it.each(Object.keys(WIRE_GOLDEN))("%s: every prompt sets its skill field, and prompts/list serves only name, title, description and arguments", async (pkg) => {
    const definitions = await definitionsOf(pkg);
    const listedPrompts = (await sessionOf(pkg).listPrompts()) as Array<Record<string, unknown>>;
    expect(listedPrompts.map((entry) => entry.name)).toEqual(definitions.map((definition) => definition.name));
    for (const entry of listedPrompts) {
      const definition = definitions.find((candidate) => candidate.name === entry.name);
      expect(definition?.skill, `${pkg}/${String(entry.name)} sets a skill field`).toBeDefined();
      expect(Object.keys(entry).sort(), `${entry.name} keys`).toEqual(["arguments", "description", "name", "title"]);
      expect(entry.description, `${entry.name} lists its own description`).toBe(definition?.description);
      expect(entry.description, `${entry.name} does not list its skill description`).not.toBe(definition?.skill?.description);
      const json = JSON.stringify(entry);
      expect(json, `${entry.name} entry holds no skill description`).not.toContain(definition?.skill?.description ?? "");
      expect(json, `${entry.name} entry names no preset key`).not.toContain("iris-tools-preset");
    }
  });

  it.each(Object.keys(WIRE_GOLDEN))("%s: prompts/get carries no skill field, no skill description and no preset key", async (pkg) => {
    const definitions = await definitionsOf(pkg);
    const session = sessionOf(pkg);
    for (const definition of definitions) {
      expect(definition.skill, `${definition.name} sets a skill field`).toBeDefined();
      const prompt = (await listed(pkg)).find((candidate) => candidate.name === definition.name);
      const args = Object.fromEntries((prompt?.arguments ?? []).map((argument) => [argument.name, `v-${argument.name}`]));
      const rendered = (await session.getPrompt({ name: definition.name, arguments: args })) as object;
      // The SDK's prompts/get result carries the callback's own fields (messages), not the registered description.
      expect(Object.keys(rendered), `${definition.name} result keys`).not.toContain("skill");
      const json = JSON.stringify(rendered);
      expect(json, `${definition.name} result holds no skill description`).not.toContain(definition.skill?.description ?? "");
      expect(json, `${definition.name} result names no preset key`).not.toContain("iris-tools-preset");
    }
  });
});

describe("the prompt wire bytes are the bytes captured before the skill-only field (AC 41.5.1, AD-15)", () => {
  it.each(Object.keys(WIRE_GOLDEN))("%s: prompts/list hashes to its golden value", async (pkg) => {
    expect(sha256Hex(await sessionOf(pkg).listPrompts())).toBe(WIRE_GOLDEN[pkg]?.list);
  });

  it.each(Object.keys(WIRE_GOLDEN))("%s: every prompts/get hashes to its golden value, and no prompt is unpinned", async (pkg) => {
    const session = sessionOf(pkg);
    const golden = WIRE_GOLDEN[pkg]?.get ?? {};
    const prompts = await listed(pkg);
    expect(prompts.map((prompt) => prompt.name).sort()).toEqual(Object.keys(golden).sort());
    for (const prompt of prompts) {
      const args = Object.fromEntries((prompt.arguments ?? []).map((argument) => [argument.name, `v-${argument.name}`]));
      expect(sha256Hex(await session.getPrompt({ name: prompt.name, arguments: args })), `${pkg}/${prompt.name}`).toBe(golden[prompt.name]);
    }
  });
});

describe("dev's npm tarball carries the four prompt modules and nothing of the retired prompt (AC 41.2.2)", () => {
  it("lists dist/prompts without any objectscriptReview file, and exactly the modules of the registered prompts", () => {
    const packed = runNpmPack(path.join(REPO_ROOT, "packages", "iris-dev-mcp"));
    expect(packed.error, String(packed.error)).toBeNull();
    expect(packed.status, packed.stderr).toBe(0);
    const files = (JSON.parse(packed.stdout) as Array<{ files: Array<{ path: string }> }>)[0]?.files.map((file) => file.path) ?? [];
    expect(files.filter((file) => /objectscript/i.test(file))).toEqual([]);
    const modules = new Set(
      files.filter((file) => file.startsWith("dist/prompts/") && file.endsWith(".js")).map((file) => path.posix.basename(file, ".js")),
    );
    expect([...modules].sort()).toEqual([
      "deployAndTestClass",
      "diagnoseSlowQuery",
      "editAndTestClass",
      "index",
      "productionBusyNote",
      "promoteEnvironmentChange",
    ]);
  }, 120_000);
});
