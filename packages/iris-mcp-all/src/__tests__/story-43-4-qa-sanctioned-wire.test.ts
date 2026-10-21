/**
 * Story 43.4 QA (AC "Descriptions", "DW-646", "DW-653"; AD-15; Rules #36, #59) - the sanctioned changes on the real wire, on both eras,
 * measured against oracles that do not pass through the ledger loader or the code under test.
 *
 * The 43.1/43.2 golden tests compare the built servers with `readSanctionedGolden(...)`: the frozen capture with the ledger applied. A defect
 * in the loader, or a ledger entry that was written to match the code, would move both sides together. This file asks the same questions of
 * the same built servers over the raw stdio driver, with three independent references:
 *  - the RAW frozen golden (`sdk-wire-golden.json`, parsed here and never passed through the loader);
 *  - the sentences of wave-8 decision #24, written below from the spec rather than read from the ledger or the sources;
 *  - the 13 tools of wave-8 decision #39 whose `destructiveHint` Story 42.10 flips, and the corrected `iris_message_resend` texts of Story
 *    42.10 (DW-662), written below from that spec;
 *  - the sha256 that the `resend-failed-messages` body had before Story 43.4 (`story-41-5-qa-dist-consumer` at its baseline).
 *
 * Per server and era it asserts that:
 *  - every tool equals its frozen entry, apart from what the specs sanction: a gated tool's description is the frozen text plus the spec's
 *    separator and sentence, once (Story 43.4); the 13 flipped tools declare `destructiveHint: true` and nothing else of them moves; and
 *    `iris_message_resend` carries the corrected passage, `maxMessages` text and `confirm` text (Story 42.10);
 *  - `resources/list` names `iris-governance://default` exactly once, as the static resource, and equals the frozen list without its
 *    second entry; `resources/templates/list` and every `resources/read` answer are the frozen ones;
 *  - `prompts/list` is the frozen one; on the interop server `resend-failed-messages` renders the spec's steps 3 and 4 and, with the old steps put
 *    back, hashes to the pre-story body;
 *  - with a second profile `prod`, `resources/list` holds the static `default` and `prod` (named `iris-governance-profile-prod`) once each, the
 *    template is still listed, and both URIs read.
 * Servers run against a closed port (127.0.0.1:1); no IRIS instance is reached. A stale dist fails the file, naming it.
 */

import { beforeAll, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { REPO_ROOT } from "./pack-fixture";
import {
  CLOSED_PORT_ENV,
  GOLDEN_PACKAGES,
  GOLDEN_RELATIVE_PATH,
  discoverHandshake,
  goldenSessions,
  handshake,
  inheritedGoldenEnv,
  modernEnvelope,
  openRawWire,
  rawWithIdZero,
  withEnvelope,
  withoutExecution,
  withoutMandatedFields,
} from "../../../../scripts/lib/sdk-wire-golden-core.mjs";
import { distEntry } from "./process-gate-helpers.js";
import { requireFreshDists } from "./story-43-3-qa-wire.js";

type Era = "legacy" | "modern";
type Json = Record<string, unknown>;

interface Tool extends Json {
  name: string;
  description: string;
}

interface FrozenRow {
  label: string;
  line: string;
}

interface FrozenGolden {
  servers: Record<string, { sessions: Record<string, { rows: FrozenRow[] }> }>;
}

/** The frozen capture, parsed from the file itself: no ledger is applied to it. */
const frozen = JSON.parse(readFileSync(path.join(REPO_ROOT, GOLDEN_RELATIVE_PATH), "utf8")) as FrozenGolden;

const frozenRow = (pkg: string, session: string, label: string): FrozenRow => {
  const row = frozen.servers[pkg]?.sessions[session]?.rows.find((candidate) => candidate.label === label);
  if (row === undefined) throw new Error(`the frozen golden has no row ${pkg}/${session}/${label}`);
  return row;
};
/** The frozen tools of a session; on the modern era the `execution` member the 2026-07-28 revision drops is left out of them. */
function frozenTools(pkg: string, session: string, era: Era): Tool[] {
  const message = JSON.parse(frozenRow(pkg, session, "tools-list").line) as { result: { tools: Tool[] } };
  return (era === "modern" ? (withoutExecution(message) as typeof message) : message).result.tools;
}
const frozenResult = (pkg: string, label: string): Json => (JSON.parse(frozenRow(pkg, "main", label).line) as { result: Json }).result;

/** Wave-8 decision #24: the shared tail of each gated tool's sentence. */
const ALSO_ASKS = " also asks the person in a confirmation dialog";
const TAIL =
  "; only an accept with Confirm ticked proceeds, and a decline or a dismissal returns CONFIRMATION_DECLINED with nothing changed (do not repeat the call unless the person asks). A client without elicitation is not asked, and the call works as described above.";

/** Wave-8 decision #24: the separator and the sentence appended to each gated tool's frozen description, by server. */
const SANCTIONED: Record<string, Record<string, { separator: string; sentence: string }>> = {
  "iris-admin-mcp": {
    iris_audit_manage: {
      separator: " ",
      sentence: `HUMAN CONFIRMATION: when the MCP client supports form elicitation, 'purge'${ALSO_ASKS}, after every check above and right before any record is deleted${TAIL}`,
    },
  },
  "iris-dev-mcp": {
    iris_env_promote: {
      separator: "\n\n",
      sentence: `HUMAN CONFIRMATION -- when the MCP client supports form elicitation, 'execute'${ALSO_ASKS}, after all four gates pass and right before the first write to 'target'${TAIL}`,
    },
    iris_doc_edit: {
      separator: " ",
      sentence: `Human confirmation: when the MCP client supports form elicitation, \`regenerateStorage\`${ALSO_ASKS}, after every check above and right before the document is saved${TAIL}`,
    },
  },
  "iris-interop-mcp": {
    iris_production_control: {
      separator: "\n\n",
      sentence: `HUMAN CONFIRMATION: when the MCP client supports form elicitation, 'clean' with killAppData:true and confirm:true${ALSO_ASKS} right before the production is cleaned${TAIL}`,
    },
    iris_message_resend: {
      separator: "\n\n",
      sentence: `HUMAN CONFIRMATION: when the MCP client supports form elicitation, 'resend' and an executing 'resendFiltered' (when its read-only preview matches 1 to maxMessages messages) also ask the person in a confirmation dialog, after every check above and right before anything is resent${TAIL}`,
    },
  },
};

const EM_DASH = String.fromCharCode(0x2014);

/** Wave-8 decision #39 (Story 42.10, DW-560): the tools whose `destructiveHint` moves from false to true, by server. */
const FLIPPED: Record<string, string[]> = {
  "iris-dev-mcp": [
    "iris_doc_put",
    "iris_sql_execute",
    "iris_global_set",
    "iris_execute_command",
    "iris_execute_classmethod",
    "iris_doc_load",
    "iris_doc_export",
    "iris_env_promote",
  ],
  "iris-admin-mcp": ["iris_service_manage", "iris_ldap_manage", "iris_x509_manage"],
  "iris-interop-mcp": ["iris_production_item"],
  "iris-ops-mcp": ["iris_task_run"],
};

/** Story 42.10 (DW-662): the passage of the `iris_message_resend` description that the frozen text carries, and the one that replaces it. */
const RESEND_PASSAGE_BEFORE = `executing requires BOTH dryRun:false AND confirm:true, otherwise the call is refused with no changes made. maxMessages caps the batch (default 100, HARD CAP 500) ${EM_DASH} a match count over the cap is refused (not truncated-and-executed); narrow the window or item filter and retry.`;
const RESEND_PASSAGE_AFTER = `executing requires BOTH dryRun:false AND confirm:true: dryRun:false without confirm:true is refused with no changes made, and leaving dryRun out previews again. maxMessages caps the batch (default 100, HARD CAP 500) ${EM_DASH} an executing call whose match count is over the cap is refused (not truncated-and-executed), while a preview reports the full count; narrow the window or item filter and retry.`;
const MAX_MESSAGES_BEFORE = "(resendFiltered) Cap on matched/resent messages (default: 100, HARD CAP: 500). A match count over this cap is refused, not truncated-and-executed.";
const MAX_MESSAGES_AFTER =
  "(resendFiltered) Cap on matched/resent messages (default: 100, HARD CAP: 500). An executing call whose match count is over this cap is refused, not truncated-and-executed; a preview reports the full count.";
const CONFIRM_BEFORE = "(resendFiltered) Must be true together with dryRun:false to execute the resend; otherwise the call is refused with no changes made.";
const CONFIRM_AFTER =
  "(resendFiltered) Must be true together with dryRun:false to execute the resend; dryRun:false without confirm:true is refused with no changes made. Ignored while dryRun is true or omitted (the call previews).";

interface Schema extends Json {
  properties: Record<string, { description: string } & Json>;
}

/**
 * The tool that `pkg`'s server must list for the frozen entry `then`: the frozen entry, plus what Stories 43.4 and 42.10 sanction for
 * it and nothing else. Fails when a frozen text the sanction replaces is not what the golden holds, so a stale oracle cannot pass.
 */
function sanctionedTool(pkg: string, then: Tool): Tool {
  const expected = structuredClone(then) as Tool & { annotations: Record<string, unknown>; inputSchema: Schema };
  if (pkg === "iris-interop-mcp" && then.name === "iris_message_resend") {
    expect(countOf(then.description, RESEND_PASSAGE_BEFORE), "the frozen resend description holds the old passage once").toBe(1);
    expected.description = then.description.replace(RESEND_PASSAGE_BEFORE, RESEND_PASSAGE_AFTER);
    const { maxMessages, confirm } = expected.inputSchema.properties as Record<string, { description: string }>;
    expect(maxMessages?.description, "the frozen maxMessages text").toBe(MAX_MESSAGES_BEFORE);
    expect(confirm?.description, "the frozen confirm text").toBe(CONFIRM_BEFORE);
    (maxMessages as { description: string }).description = MAX_MESSAGES_AFTER;
    (confirm as { description: string }).description = CONFIRM_AFTER;
  }
  const gated = SANCTIONED[pkg]?.[then.name];
  if (gated !== undefined) expected.description = `${expected.description}${gated.separator}${gated.sentence}`;
  if (FLIPPED[pkg]?.includes(then.name)) {
    expect(expected.annotations["destructiveHint"], `${then.name}: the frozen entry declares destructiveHint false`).toBe(false);
    expected.annotations["destructiveHint"] = true;
  }
  return expected;
}

/** The `resend-failed-messages` steps 3 and 4 as Story 43.4 wrote them (decision #24), and as they stood before. */
const NEW_STEP_3 = `3. The preview always reports the full match count. If it exceeds \`maxMessages\` (default 100, hard cap 500), the executing call in step 4 would be refused rather than truncated-and-executed ${EM_DASH} narrow the \`from\`/\`to\` window or the \`item\` filter and repeat step 1; do not raise \`maxMessages\` past what the user has reviewed.`;
const OLD_STEP_3 = `3. If the match count exceeds \`maxMessages\` (default 100, hard cap 500), the call is refused rather than truncated-and-executed ${EM_DASH} narrow the \`from\`/\`to\` window or the \`item\` filter and repeat step 1; do not raise \`maxMessages\` past what the user has reviewed.`;
const NEW_STEP_4_PAREN =
  "(`dryRun: false` without `confirm: true` is refused with no changes made; leaving `dryRun` out only previews again, because it defaults to `true`)";
const OLD_STEP_4_PAREN = `(both are required together ${EM_DASH} omitting either is refused with no changes made)`;
/** sha256 of the `resend-failed-messages` body before Story 43.4 (`story-41-5-qa-dist-consumer.test.ts` at baseline b841530). */
const PRE_STORY_BODY_SHA256 = "c4518b571d2a01b031ae88410ea3c01ef89b03cf8eaa91554cd1a175d47b9beb";

const sha256 = (text: string): string => createHash("sha256").update(text).digest("hex");
const countOf = (text: string, needle: string): number => text.split(needle).length - 1;
/** How many times `text` names the dialog with the heading both spellings of the sentence start with. */
const markerCount = (text: string): number => text.match(/human confirmation/gi)?.length ?? 0;

interface Answer {
  /** The response line as the server wrote it (the 2025-11-25 bytes). */
  line: string;
  /** The parsed frame, with the 2026-07-28 mandated fields removed. */
  frame: { result?: Json; error?: Json };
}

interface Conn {
  ask: (method: string, params?: Json) => Promise<Answer>;
  close: () => Promise<void>;
}

/** Start `pkg`'s built server on a closed port and open a connection of `era`. */
async function connect(pkg: string, era: Era, extraEnv: Record<string, string> = {}): Promise<Conn> {
  const wire = openRawWire({ entry: distEntry(REPO_ROOT, pkg), env: { ...inheritedGoldenEnv(process.env), ...CLOSED_PORT_ENV, ...extraEnv } });
  const envelope = modernEnvelope("story-43-4-qa-wire");
  try {
    if (era === "legacy") await handshake(wire, "2025-11-25", "story-43-4-qa-wire");
    else await discoverHandshake(wire, "story-43-4-qa-wire");
  } catch (error) {
    await wire.close();
    throw error;
  }
  return {
    ask: async (method, params = {}) => {
      const answer = await wire.request(method, era === "modern" ? withEnvelope(params, envelope) : params);
      return { line: answer.line, frame: era === "modern" ? withoutMandatedFields(method, answer.message) : answer.message };
    },
    close: () => wire.close(),
  };
}

/** The exchange of the golden's `main` session called `label`: the request this file repeats. */
function exchangeOf(pkg: string, label: string): { method: string; params: Json } {
  const exchanges = goldenSessions(pkg)[0]?.exchanges as Array<{ label: string; method: string; params?: Json }> | undefined;
  const exchange = exchanges?.find((candidate) => candidate.label === label);
  if (exchange === undefined) throw new Error(`the golden has no exchange ${pkg}/${label}`);
  return { method: exchange.method, params: exchange.params ?? {} };
}

const prerequisites = (): void => requireFreshDists(...(GOLDEN_PACKAGES as string[]));

const PROD_PROFILE = JSON.stringify({ prod: { host: "127.0.0.1", port: 1, username: "qa", password: "qa", namespace: "HSCUSTOM" } });

describe.each(GOLDEN_PACKAGES as string[])("%s: the sanctioned changes on the wire", (pkg) => {
  describe.each(["legacy", "modern"] as Era[])("the %s era", (era) => {
    const answers = new Map<string, Answer>();
    let twoProfiles: { list: Answer; templates: Answer; readDefault: Answer; readProd: Answer };

    beforeAll(async () => {
      prerequisites();
      const conn = await connect(pkg, era);
      try {
        for (const label of ["tools-list", "resources-list", "resources-templates-list", "resources-read:default", "resources-read:unknown-profile", "resources-read:no-match", "prompts-list"]) {
          const { method, params } = exchangeOf(pkg, label);
          answers.set(label, await conn.ask(method, params));
        }
        if (pkg === "iris-interop-mcp") {
          answers.set("prompts-get:resend", await conn.ask("prompts/get", { name: "resend-failed-messages", arguments: { item: "<item>", since: "<since>" } }));
        }
      } finally {
        await conn.close();
      }
      const two = await connect(pkg, era, { IRIS_PROFILES: PROD_PROFILE });
      try {
        twoProfiles = {
          list: await two.ask("resources/list"),
          templates: await two.ask("resources/templates/list"),
          readDefault: await two.ask("resources/read", { uri: "iris-governance://default" }),
          readProd: await two.ask("resources/read", { uri: "iris-governance://prod" }),
        };
      } finally {
        await two.close();
      }
    }, 90_000);

    const live = (label: string): Answer => {
      const answer = answers.get(label);
      if (answer === undefined) throw new Error(`no answer recorded for ${label}`);
      return answer;
    };

    it("tools/list: every tool is its frozen entry plus what the specs sanction (the dialog sentence, the 13 destructiveHint flips, the corrected resend texts) and nothing else", () => {
      const before = frozenTools(pkg, "main", era);
      const after = (live("tools-list").frame.result as { tools: Tool[] }).tools;
      expect(after.map((tool) => tool.name), "the same tools in the same order").toEqual(before.map((tool) => tool.name));
      const sanctioned = SANCTIONED[pkg] ?? {};
      for (const [index, tool] of after.entries()) {
        const then = before[index] as Tool;
        expect(tool, `${tool.name} is its frozen entry plus its sanctioned changes`).toEqual(sanctionedTool(pkg, then));
        if (sanctioned[tool.name] === undefined) continue;
        const { separator, sentence } = sanctioned[tool.name] as { separator: string; sentence: string };
        expect(tool.description.endsWith(`${separator}${sentence}`), `${tool.name}: the description ends with the spec's separator and sentence`).toBe(true);
        expect(markerCount(then.description), `${tool.name}: the frozen text never named the dialog`).toBe(0);
        expect(markerCount(tool.description), `${tool.name}: the dialog is named once`).toBe(1);
      }
      const named = after.filter((tool) => markerCount(tool.description) > 0).map((tool) => tool.name);
      expect(named.sort(), "no other tool names the dialog").toEqual(Object.keys(sanctioned).sort());
    });

    it("tools/list: exactly the flipped tools of this server declare destructiveHint true where the frozen entry said false, and every other hint is frozen", () => {
      const before = frozenTools(pkg, "main", era);
      const after = (live("tools-list").frame.result as { tools: Tool[] }).tools;
      const moved: string[] = [];
      for (const [index, tool] of after.entries()) {
        const then = before[index] as Tool;
        const now = tool["annotations"] as Record<string, unknown>;
        const was = then["annotations"] as Record<string, unknown>;
        if (now["destructiveHint"] !== was["destructiveHint"]) moved.push(tool.name);
        for (const hint of ["readOnlyHint", "idempotentHint", "openWorldHint"]) expect(now[hint], `${tool.name}: ${hint} is frozen`).toBe(was[hint]);
      }
      expect(moved.sort()).toEqual([...(FLIPPED[pkg] ?? [])].sort());
    });

    it("resources/list: iris-governance://default is listed exactly once, as the static resource, and the second entry is gone", () => {
      const before = frozenResult(pkg, "resources-list").resources as Json[];
      const after = (live("resources-list").frame.result as { resources: Json[] }).resources;
      expect(before.map((resource) => resource["name"]), "the frozen list held the duplicate").toEqual(["iris-governance-default", "iris-governance-profile-default"]);
      expect(after.filter((resource) => resource["uri"] === "iris-governance://default")).toHaveLength(1);
      expect(after, "the frozen list without its second entry").toEqual([before[0]]);
      expect(after[0]?.["name"]).toBe("iris-governance-default");
      expect(new Set(after.map((resource) => resource["uri"])).size, "no URI twice").toBe(after.length);
    });

    it("resources/templates/list and every resources/read answer are the frozen ones", () => {
      for (const label of ["resources-templates-list", "resources-read:default", "resources-read:unknown-profile", "resources-read:no-match", "prompts-list"]) {
        const answer = live(label);
        const then = JSON.parse(frozenRow(pkg, "main", label).line) as { result?: Json; error?: Json };
        if (era === "legacy") {
          expect(rawWithIdZero(answer.line), `${label}: the raw line is the frozen line`).toBe(rawWithIdZero(frozenRow(pkg, "main", label).line));
        } else if (then.result !== undefined) {
          expect(answer.frame.result, `${label}: the result is the frozen one once the mandated fields are removed`).toEqual((withoutExecution(then) as { result: Json }).result);
        } else {
          expect(answer.frame.error?.["code"], `${label}: the same error code`).toBe(then.error?.["code"]);
        }
      }
    });

    if (pkg === "iris-interop-mcp") {
      it("prompts/get resend-failed-messages renders the spec's steps 3 and 4, and with the old steps back it hashes to the pre-story body", () => {
        const messages = (live("prompts-get:resend").frame.result as { messages: Array<{ content: { text: string } }> }).messages;
        expect(messages).toHaveLength(1);
        const text = messages[0]!.content.text;
        expect(text).toContain(`\n${NEW_STEP_3}\n`);
        expect(text).toContain(NEW_STEP_4_PAREN);
        expect(text).not.toContain(OLD_STEP_3);
        expect(text).not.toContain(OLD_STEP_4_PAREN);
        expect(text, "step 3 and the step 4 parenthetical are each there once").toSatisfy((body: string) => countOf(body, NEW_STEP_3) === 1 && countOf(body, NEW_STEP_4_PAREN) === 1);
        const restored = text.replace(NEW_STEP_3, OLD_STEP_3).replace(NEW_STEP_4_PAREN, OLD_STEP_4_PAREN);
        expect(sha256(restored), "nothing but steps 3 and 4 changed").toBe(PRE_STORY_BODY_SHA256);
      });
    }

    it("with a second profile, resources/list holds default (static) and prod once each, the template is listed, and both read", () => {
      const resources = (twoProfiles.list.frame.result as { resources: Json[] }).resources;
      expect(resources.map((resource) => [resource["uri"], resource["name"]])).toEqual([
        ["iris-governance://default", "iris-governance-default"],
        ["iris-governance://prod", "iris-governance-profile-prod"],
      ]);
      expect(resources[0], "the static default entry is the frozen one").toEqual((frozenResult(pkg, "resources-list").resources as Json[])[0]);
      const templates = (twoProfiles.templates.frame.result as { resourceTemplates: Json[] }).resourceTemplates;
      expect(templates).toEqual((frozenResult(pkg, "resources-templates-list") as { resourceTemplates: Json[] }).resourceTemplates);
      const policyOf = (answer: Answer, uri: string): Json => {
        const contents = (answer.frame.result as { contents: Array<{ uri: string; text: string }> }).contents;
        expect(contents).toHaveLength(1);
        expect(contents[0]!.uri).toBe(uri);
        return (JSON.parse(contents[0]!.text) as { policy: Json }).policy;
      };
      const defaultPolicy = policyOf(twoProfiles.readDefault, "iris-governance://default");
      const prodPolicy = policyOf(twoProfiles.readProd, "iris-governance://prod");
      expect(Object.keys(prodPolicy)).toEqual(Object.keys(defaultPolicy));
      expect(Object.keys(defaultPolicy).length).toBeGreaterThan(20);
    });
  });
});

describe("iris-dev-mcp under the core preset: the iris_doc_edit description on the wire", () => {
  it.each(["legacy", "modern"] as Era[])("the %s era: the frozen core-preset entry plus the spec's separator and sentence", async (era) => {
    prerequisites();
    const conn = await connect("iris-dev-mcp", era, { IRIS_TOOLS_PRESET: "core" });
    try {
      const after = ((await conn.ask("tools/list")).frame.result as { tools: Tool[] }).tools;
      const before = frozenTools("iris-dev-mcp", "core-preset", era);
      expect(after.map((tool) => tool.name)).toEqual(before.map((tool) => tool.name));
      const { separator, sentence } = (SANCTIONED["iris-dev-mcp"] as Record<string, { separator: string; sentence: string }>)["iris_doc_edit"] as { separator: string; sentence: string };
      const flipped: string[] = [];
      for (const [index, tool] of after.entries()) {
        const then = before[index] as Tool;
        if (tool.name === "iris_doc_edit") expect(tool.description).toBe(`${then.description}${separator}${sentence}`);
        expect(tool, `${tool.name} is its frozen entry plus its sanctioned changes`).toEqual(sanctionedTool("iris-dev-mcp", then));
        if ((tool["annotations"] as Record<string, unknown>)["destructiveHint"] !== (then["annotations"] as Record<string, unknown>)["destructiveHint"]) flipped.push(tool.name);
      }
      // Six of the 13 flipped tools are in the core preset.
      expect(flipped.sort()).toEqual(["iris_doc_load", "iris_doc_put", "iris_execute_classmethod", "iris_execute_command", "iris_global_set", "iris_sql_execute"]);
      expect(after.map((tool) => tool.name)).toContain("iris_doc_edit");
    } finally {
      await conn.close();
    }
  }, 60_000);
});
