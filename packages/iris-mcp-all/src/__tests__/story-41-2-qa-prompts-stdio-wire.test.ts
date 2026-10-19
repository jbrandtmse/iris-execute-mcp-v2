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
 *  - dev's npm tarball file list holds the four prompt modules and nothing of the retired one.
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
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
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
