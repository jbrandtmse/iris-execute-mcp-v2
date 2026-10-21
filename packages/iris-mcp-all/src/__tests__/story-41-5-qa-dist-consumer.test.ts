/**
 * Story 41.5 QA (AC 41.5.1, AD-15, AD-28; project rules #46, #59) - the BUILT prompt packages as a consumer reads them.
 *
 * Three views of the same 12 prompts, each independent of the others:
 *  - a fresh Node process imports each package's `dist/prompts/index.js` (no test runner, no loader): every definition
 *    carries the skill-only `skill` field, and the 12 generated skills equal it;
 *  - a real SDK `Client` over stdio: which prompts are all-optional, what `prompts/get` does with `arguments` omitted
 *    entirely, and what it renders for `arguments: {}`;
 *  - the raw JSON-RPC frames of the same servers, read without the SDK. The SDK client parses a `prompts/list` result
 *    with a schema that DROPS a key it does not know, so a leaked top-level `skill` key could never reach
 *    `listPrompts()`; only the frames show it.
 *
 * The rendered text of a prompt for `arguments: {}` is pinned to the bytes of the generated skills at 9ae509b (before the
 * skill-only field existed): the sha256 of the text after each skill's frontmatter, without its final newline, captured with
 * `git show 9ae509b:skills/<name>/SKILL.md`. A `prompts/get` that omits `arguments` entirely renders exactly the same bytes
 * (DW-617): the framework serves `prompts/get` itself and counts an omitted `arguments` as `{}`; the SDK row and the
 * raw-frame row, both titled with DW-617, pin it.
 *
 * Every server is started with `default` pointing at 127.0.0.1:9, a closed local port, and no tool is called, so no IRIS
 * instance is reached. The file fails, never skips, when a dist is missing or older than its source.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { REPO_ROOT } from "./pack-fixture";
import { connectionEnv, distEntry, inheritedEnv, type IrisTarget, openWireSession, resolveSdkEsmDir, staleDistReason, type WireSession } from "./process-gate-helpers.js";
import { promptText } from "./prompt-gate-helpers.js";
import { handshake, openRawWire } from "../../../../scripts/lib/sdk-wire-golden-core.mjs";
import { declaredDescription, declaredPreset, freshPromptDefinitions, PRESET_ORDER, PROMPT_PACKAGE_COUNTS } from "./story-41-5-qa-fixture";

const CLOSED_TARGET: IrisTarget = { host: "127.0.0.1", port: "9", username: "qa", password: "qa", namespace: "HSCUSTOM" };

/** The prompts whose arguments are all optional, in the order their servers list them. */
const ALL_OPTIONAL = ["audit-security-posture", "recover-stuck-production", "check-system-health", "run-external-backup"];

/** sha256 of `build({})`, captured from the generated skills at 9ae509b (see the header). */
const BASELINE_BODY_SHA256: Record<string, string> = {
  "audit-security-posture": "39cc723ce306475816228312deb9116e6db0ae869619ed718ac9e723f04b6368",
  "check-system-health": "00277927426fcd58870312339188c3c5d1da959ee9a15ae5456606b63095c463",
  "deploy-and-test-class": "dd695ee94968985b16711a55b28e4a24d87af496bb9a8dc5c156dd2f5a89265a",
  "diagnose-slow-query": "a9311c9de99a7c28967f85455d84729ca413a78c1ddd894bbae7be7947bdf581",
  "edit-and-test-class": "079ecc5e9aa0ac75b8b1d678effc58b1f10eca25bf57143f60985f96a08319c1",
  "find-patient-messages": "8a4b23c39576bdebc79531d5bd8fd5d3b16b644f652935a8741da00078579dc0",
  "promote-environment-change": "08c3eccd1fa4eb24287f94c4ba16170334541f7f55e2feb53c3d600d1c672454",
  "provision-project-environment": "29e831684c069a88b31aaede2dd98afcfc4e74cbbbd57cdef072c1eccb36167c",
  "recover-stuck-production": "64395fdac525550ee29ce2d35e988600a7061a0d410688778a59a176922fed89",
  "resend-failed-messages": "2a08eb10d16ce9110f4d526109318900543353b8a462fa27bbfa834921ec0ea3",
  "run-external-backup": "028e5ff841258f03053d4fd340e04bdf92710193c836f86a5de67bfc7c4bc4d5",
  "trace-message-flow": "bfbc9039db39a6129944645d23671c1fbd7abbe21c199f4fec76c1ccaa494557",
};

const sha256Hex = (text: string): string => createHash("sha256").update(text).digest("hex");

interface ListedPrompt {
  name: string;
  arguments?: Array<{ name: string; required?: boolean }>;
}

/** One frame the server wrote, as text and as parsed JSON. */
interface RawFrame {
  line: string;
  message: { id?: number; result?: Record<string, unknown>; error?: { code?: number; message?: string } };
}

interface RawWire {
  request: (method: string, params?: Record<string, unknown>) => Promise<RawFrame>;
  close: () => Promise<void>;
}

/** Start the built server and speak JSON-RPC to it over stdio by hand (the golden's driver): one JSON object per line, no SDK. */
async function openRawSession(entry: string): Promise<RawWire> {
  const wire = openRawWire({ entry, env: { ...inheritedEnv(), ...connectionEnv(CLOSED_TARGET) } });
  const initialized = await handshake(wire, "2025-06-18", "story-41-5-qa-raw");
  expect(initialized.message.error, "the server accepted the handshake").toBeUndefined();
  return wire as RawWire;
}

const sdk = new Map<string, WireSession>();
const raw = new Map<string, RawWire>();

beforeAll(async () => {
  const sdkEsmDir = resolveSdkEsmDir(REPO_ROOT);
  if (!sdkEsmDir) throw new Error("Could not resolve the @modelcontextprotocol/client ESM build under node_modules/.pnpm - run pnpm install.");
  const stale = ["shared", ...PROMPT_PACKAGE_COUNTS.map(([pkg]) => pkg)]
    .map((pkg) => [pkg, staleDistReason(REPO_ROOT, pkg)] as const)
    .filter(([, reason]) => reason !== undefined);
  if (stale.length > 0) throw new Error(`Build the packages first: ${stale.map(([pkg, reason]) => `${pkg}: ${reason}`).join("; ")}`);
  for (const [pkg] of PROMPT_PACKAGE_COUNTS) {
    sdk.set(pkg, await openWireSession({ sdkEsmDir, entry: distEntry(REPO_ROOT, pkg), target: CLOSED_TARGET, clientName: "story-41-5-qa-consumer" }));
    raw.set(pkg, await openRawSession(distEntry(REPO_ROOT, pkg)));
  }
}, 180_000);

afterAll(async () => {
  await Promise.all([...sdk.values()].map((session) => session.close()));
  await Promise.all([...raw.values()].map((wire) => wire.close()));
});

const sdkOf = (pkg: string): WireSession => {
  const session = sdk.get(pkg);
  if (session === undefined) throw new Error(`no SDK session for ${pkg}`);
  return session;
};
const rawOf = (pkg: string): RawWire => {
  const wire = raw.get(pkg);
  if (wire === undefined) throw new Error(`no raw session for ${pkg}`);
  return wire;
};

describe("a fresh Node process importing the built prompt packages (AC 41.5.1, AD-28)", () => {
  it.each(PROMPT_PACKAGE_COUNTS)("%s: every definition carries a skill-only field with a description of its own and a known preset", (pkg, count) => {
    const definitions = freshPromptDefinitions(REPO_ROOT, pkg);
    expect(definitions, `${pkg} registers its prompts`).toHaveLength(count);
    for (const definition of definitions) {
      expect(definition.keys, `${definition.name} keys`).toEqual(["arguments", "build", "description", "name", "skill", "title"]);
      expect(definition.skillKeys, `${definition.name} skill keys`).toEqual(["description", "preset"]);
      expect(PRESET_ORDER as readonly string[], `${definition.name} preset`).toContain(definition.skillPreset);
      expect(definition.skillDescription?.trim().length, `${definition.name} skill description`).toBeGreaterThan(0);
      expect(definition.skillDescription, `${definition.name} keeps its prompt description apart`).not.toBe(definition.description);
    }
  });

  it("the 12 definitions equal the 12 generated skills: name, description, preset and body", () => {
    const definitions = PROMPT_PACKAGE_COUNTS.flatMap(([pkg]) => freshPromptDefinitions(REPO_ROOT, pkg));
    expect(definitions).toHaveLength(12);
    for (const definition of definitions) {
      const text = readFileSync(path.join(REPO_ROOT, "skills", definition.name, "SKILL.md"), "utf8");
      expect(declaredDescription(text), `${definition.name} description`).toBe(definition.skillDescription);
      expect(declaredPreset(text), `${definition.name} preset`).toBe(definition.skillPreset);
      expect(text.endsWith(`\n---\n\n${definition.body}\n`), `${definition.name} body is what the prompt builds`).toBe(true);
    }
  });

  it("the text a prompt renders, and its title and description, never carry its skill description or the preset key", () => {
    for (const [pkg] of PROMPT_PACKAGE_COUNTS) {
      for (const definition of freshPromptDefinitions(REPO_ROOT, pkg)) {
        for (const [field, text] of [["title", definition.title], ["description", definition.description], ["body", definition.body]] as const) {
          expect(text, `${definition.name} ${field} holds no skill description`).not.toContain(definition.skillDescription ?? "");
          expect(text, `${definition.name} ${field} names no preset key`).not.toContain("iris-tools-preset");
        }
      }
    }
  });

  it("the rendered text of every prompt is the text the generated skills carried at 9ae509b", () => {
    const definitions = PROMPT_PACKAGE_COUNTS.flatMap(([pkg]) => freshPromptDefinitions(REPO_ROOT, pkg));
    expect(definitions.map((definition) => definition.name).sort()).toEqual(Object.keys(BASELINE_BODY_SHA256).sort());
    for (const definition of definitions) expect(sha256Hex(definition.body), definition.name).toBe(BASELINE_BODY_SHA256[definition.name]);
  });
});

describe("a real SDK client over stdio: prompts/get with `arguments` omitted entirely (project rule #46)", () => {
  it("the all-optional prompts are exactly four, found from prompts/list", async () => {
    const found: string[] = [];
    for (const [pkg] of PROMPT_PACKAGE_COUNTS) {
      for (const prompt of (await sdkOf(pkg).listPrompts()) as ListedPrompt[]) {
        const args = prompt.arguments ?? [];
        if (args.length > 0 && args.every((argument) => argument.required !== true)) found.push(prompt.name);
      }
    }
    expect(found.sort()).toEqual([...ALL_OPTIONAL].sort());
  });

  it.each(PROMPT_PACKAGE_COUNTS)("%s: an all-optional prompt asked with no `arguments` key renders exactly as with `arguments: {}` (DW-617), and the connection answers the next request", async (pkg) => {
    const session = sdkOf(pkg);
    const inPackage = ((await session.listPrompts()) as ListedPrompt[]).map((prompt) => prompt.name).filter((name) => ALL_OPTIONAL.includes(name));
    for (const name of inPackage) {
      const omitted = promptText(await session.getPrompt({ name }));
      expect(sha256Hex(omitted), `${name} omitted arguments`).toBe(BASELINE_BODY_SHA256[name]);
      expect(omitted, `${name} omitted arguments equal an empty arguments object`).toBe(promptText(await session.getPrompt({ name, arguments: {} })));
      const next = await session.listPrompts();
      expect(next.map((prompt) => prompt.name), `${pkg} still lists after ${name}`).toContain(name);
    }
  });

  it.each(PROMPT_PACKAGE_COUNTS)("%s: an all-optional prompt asked with `arguments: {}` renders the bytes the skill carried at 9ae509b", async (pkg) => {
    const session = sdkOf(pkg);
    const inPackage = ((await session.listPrompts()) as ListedPrompt[]).map((prompt) => prompt.name).filter((name) => ALL_OPTIONAL.includes(name));
    for (const name of inPackage) {
      const text = promptText(await session.getPrompt({ name, arguments: {} }));
      expect(sha256Hex(text), name).toBe(BASELINE_BODY_SHA256[name]);
    }
  });
});

describe("the raw JSON-RPC frames of the built servers, read without the SDK (AD-15, AD-28)", () => {
  /**
   * What no frame of a prompt server may hold: the skill descriptions of its prompts (as written, and as a JSON string
   * escapes them, which is how a frame carries them), the preset key, a `skill` member.
   */
  function forbiddenIn(pkg: string): string[] {
    const descriptions = freshPromptDefinitions(REPO_ROOT, pkg).map((definition) => definition.skillDescription ?? "");
    expect(
      descriptions.every((text) => text.trim().length > 0),
      `${pkg}: every prompt has a skill description for the frames to be searched for`,
    ).toBe(true);
    return [...descriptions, ...descriptions.map((text) => JSON.stringify(text).slice(1, -1)), "iris-tools-preset", '"skill"'];
  }

  it.each(PROMPT_PACKAGE_COUNTS)("%s: the prompts/list frame holds exactly name, title, description and arguments per prompt, and equals what the SDK parses", async (pkg) => {
    const frame = await rawOf(pkg).request("prompts/list");
    const prompts = (frame.message.result?.prompts ?? []) as Array<Record<string, unknown>>;
    expect(prompts.length, `${pkg} prompts in the frame`).toBeGreaterThan(0);
    for (const entry of prompts) expect(Object.keys(entry).sort(), `${String(entry.name)} frame keys`).toEqual(["arguments", "description", "name", "title"]);
    for (const text of forbiddenIn(pkg)) expect(frame.line, `the prompts/list frame holds ${text.slice(0, 40)}`).not.toContain(text);
    expect(JSON.stringify(prompts), "nothing was dropped by the SDK's parse").toBe(JSON.stringify(await sdkOf(pkg).listPrompts()));
  });

  it.each(PROMPT_PACKAGE_COUNTS)("%s: every prompts/get frame holds only the rendered messages, never a skill field", async (pkg) => {
    const forbidden = forbiddenIn(pkg);
    for (const prompt of (await sdkOf(pkg).listPrompts()) as ListedPrompt[]) {
      const args = Object.fromEntries((prompt.arguments ?? []).map((argument) => [argument.name, `v-${argument.name}`]));
      const frame = await rawOf(pkg).request("prompts/get", { name: prompt.name, arguments: args });
      expect(frame.message.error, `${prompt.name} rendered`).toBeUndefined();
      expect(Object.keys(frame.message.result ?? {}), `${prompt.name} result members`).toEqual(["messages"]);
      for (const text of forbidden) expect(frame.line, `the ${prompt.name} frame holds ${text.slice(0, 40)}`).not.toContain(text);
    }
  });

  it.each(PROMPT_PACKAGE_COUNTS)("%s: a prompts/get frame with no `arguments` member renders the same frame as `{}` for an all-optional prompt (DW-617), and both are the baseline bytes", async (pkg) => {
    const names = ((await sdkOf(pkg).listPrompts()) as ListedPrompt[]).map((prompt) => prompt.name).filter((name) => ALL_OPTIONAL.includes(name));
    for (const name of names) {
      const omitted = await rawOf(pkg).request("prompts/get", { name });
      expect(omitted.message.error, `${name} omitted arguments renders`).toBeUndefined();
      const empty = await rawOf(pkg).request("prompts/get", { name, arguments: {} });
      const text = (empty.message.result as { messages: Array<{ content: { text: string } }> }).messages[0]?.content.text ?? "";
      expect(sha256Hex(text), `${name} with an empty arguments object`).toBe(BASELINE_BODY_SHA256[name]);
      expect(JSON.stringify(omitted.message.result), `${name} omitted arguments equal an empty arguments object`).toBe(JSON.stringify(empty.message.result));
    }
  });
});
