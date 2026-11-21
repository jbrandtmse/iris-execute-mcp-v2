/**
 * Story 43.4 (DW-639; AD-15; Rules #19, #36, #59), widened by Story 42.10 (DW-560, DW-662, DW-654) - the frozen SDK v1 goldens retire
 * through one ledger of sanctioned changes.
 *
 * `fixtures/sdk-wire-golden.json` and `fixtures/sdk-handler-golden.json` are frozen captures of the SDK v1 build. They are never
 * edited and never recaptured. Every change that AD-15 sanctions to bytes they hold is one entry of
 * `fixtures/sdk-golden-sanctioned-changes.json`, and the golden tests compare the live bytes with the frozen capture plus those
 * entries (`scripts/lib/golden-sanctioned-changes.mjs`). This file keeps the ledger honest. It pins:
 *  - both frozen files byte for byte, by SHA-256;
 *  - the entries of every story by id and order (43.4 first, then 42.10), so adding or removing one is a visible change of this file;
 *  - a shape for each of the five sanctions: how many entries it holds, which golden and operation, what the pointer may name, and
 *    whether a description entry appends (S-43.4-descriptions) or corrects (S-42.10-resend-text). A sanction with no shape fails;
 *  - each entry's `old` against the value before it: the frozen value at its pointer, or the `new` of the entry before it;
 *  - that the sanctioned wire golden differs from the frozen one in exactly the rows the entries name, and the sanctioned handler golden
 *    in exactly the rows and the audit elements they name (a call entry only), every other byte as frozen;
 *  - that every sanction id is named, in backticks, in the CHANGELOG entry of its story;
 *  - the loader's refusals (a wrong `old`, an unresolvable pointer, an unknown row, a duplicate id, a no-op, a non-append, a
 *    non-canonical frozen line, a bad audit entry) on in-memory clones, and its operations (`remove` an array element, rewrite one
 *    handler row, change one member of an audit element).
 *
 * Needs no IRIS and no built dist: it reads documents only.
 */

import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import { REPO_ROOT } from "./pack-fixture";
import {
  IGNORE_CONFLICT_AFTER,
  IGNORE_CONFLICT_BEFORE,
  STORAGE_GUARD_PROPERTY,
  STORAGE_GUARD_SENTENCE,
  STORAGE_GUARD_TOOLS,
} from "./story-42-11-texts";
import { GOLDEN_RELATIVE_PATH } from "../../../../scripts/lib/sdk-wire-golden-core.mjs";
import { HANDLER_GOLDEN_RELATIVE_PATH } from "../../../../scripts/lib/sdk-handler-golden-core.mjs";
import {
  SANCTIONED_CHANGES_RELATIVE_PATH,
  applySanctionedChanges,
  readSanctionedChanges,
  readSanctionedGolden,
  validateSanctionedChanges,
  valueAt,
} from "../../../../scripts/lib/golden-sanctioned-changes.mjs";

/** SHA-256 of the frozen wire golden, committed once in 5892022. */
const FROZEN_WIRE_SHA256 = "602231cca4abe8a01af7eb04ac7acb852a16f1b841408d3b8dc2c1c3a08edbc9";
/** SHA-256 of the frozen handler golden, committed once in 5d3d9e1. */
const FROZEN_HANDLER_SHA256 = "6abbd4b30794cec908312ed2dc007a2319da2c020144bc738bfe7fd91665c869";

/** The Story 43.4 entries (wave-8 decision #24), in ledger order. */
const STORY_43_4_IDS = [
  "43.4/description/iris_env_promote@dev-main",
  "43.4/description/iris_doc_edit@dev-main",
  "43.4/description/iris_doc_edit@dev-core-preset",
  "43.4/description/iris_audit_manage@admin-main",
  "43.4/description/iris_production_control@interop-main",
  "43.4/description/iris_message_resend@interop-main",
  "43.4/governance-resource/dev",
  "43.4/governance-resource/admin",
  "43.4/governance-resource/interop",
  "43.4/governance-resource/ops",
  "43.4/governance-resource/data",
];

/** The Story 42.10 entries (wave-8 decisions #38 to #40), in ledger order: 19 annotations, 3 resend texts, 1 audit namespace. */
const STORY_42_10_IDS = [
  "42.10/annotations/iris_doc_put@dev-main",
  "42.10/annotations/iris_doc_put@dev-core-preset",
  "42.10/annotations/iris_sql_execute@dev-main",
  "42.10/annotations/iris_sql_execute@dev-core-preset",
  "42.10/annotations/iris_global_set@dev-main",
  "42.10/annotations/iris_global_set@dev-core-preset",
  "42.10/annotations/iris_execute_command@dev-main",
  "42.10/annotations/iris_execute_command@dev-core-preset",
  "42.10/annotations/iris_execute_classmethod@dev-main",
  "42.10/annotations/iris_execute_classmethod@dev-core-preset",
  "42.10/annotations/iris_doc_load@dev-main",
  "42.10/annotations/iris_doc_load@dev-core-preset",
  "42.10/annotations/iris_doc_export@dev-main",
  "42.10/annotations/iris_env_promote@dev-main",
  "42.10/annotations/iris_service_manage@admin-main",
  "42.10/annotations/iris_ldap_manage@admin-main",
  "42.10/annotations/iris_x509_manage@admin-main",
  "42.10/annotations/iris_production_item@interop-main",
  "42.10/annotations/iris_task_run@ops-main",
  "42.10/resend-text/description@interop-main",
  "42.10/resend-text/maxMessages@interop-main",
  "42.10/resend-text/confirm@interop-main",
  "42.10/audit-namespace/iris_namespace_list@admin-handler",
];

/**
 * The Story 42.11 entries (wave-8 decisions #43 to #45), in ledger order: the four `inputSchema.properties` replacements, then the four
 * description appends, each for `iris_doc_load` (main, core preset), `iris_doc_xml_export` and `iris_env_promote`.
 */
const STORY_42_11_IDS = [
  "42.11/storage-guard-schema/iris_doc_load@dev-main",
  "42.11/storage-guard-schema/iris_doc_load@dev-core-preset",
  "42.11/storage-guard-schema/iris_doc_xml_export@dev-main",
  "42.11/storage-guard-schema/iris_env_promote@dev-main",
  "42.11/storage-guard-text/iris_doc_load@dev-main",
  "42.11/storage-guard-text/iris_doc_load@dev-core-preset",
  "42.11/storage-guard-text/iris_doc_xml_export@dev-main",
  "42.11/storage-guard-text/iris_env_promote@dev-main",
];

/** The entry ids of each story, in the order the ledger lists the stories (landing order). */
const STORIES: Array<[string, string[]]> = [
  ["43.4", STORY_43_4_IDS],
  ["42.10", STORY_42_10_IDS],
  ["42.11", STORY_42_11_IDS],
];

/** The 13 tools Story 42.10 flips to `destructiveHint: true` (decision #39), by server. Written from the spec, never read from the ledger. */
const FLIPPED_TOOLS: Record<string, string[]> = {
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

/** The three `iris_message_resend` pointers Story 42.10 corrects (tool 21 of the interop `main` tools-list). */
const RESEND_POINTERS = [
  "/result/tools/21/description",
  "/result/tools/21/inputSchema/properties/maxMessages/description",
  "/result/tools/21/inputSchema/properties/confirm/description",
];

interface Row {
  label: string;
  line: string;
  [member: string]: unknown;
}

interface WireGolden {
  servers: Record<string, { sessions: Record<string, { rows: Row[] }> }>;
}

interface HandlerGolden {
  servers: Record<string, { startup: unknown; rows: Row[]; audit: Array<Record<string, unknown>> }>;
}

interface Change {
  id: string;
  sanction: string;
  story: string;
  golden: "wire" | "handler";
  server: string;
  session?: string;
  label?: string;
  section?: string;
  pointer: string;
  op: "replace" | "remove";
  old: unknown;
  new?: unknown;
  appendOnly?: boolean;
}

/** How a sanction's entries treat the text they replace: `append` only appends, `correction` replaces it, `none` is no text change. */
type TextKind = "append" | "correction" | "none";

/** The shape one sanction's entries must have. `check` returns a problem per way the entry is not that shape. */
interface Shape {
  story: string;
  count: number;
  golden: "wire" | "handler";
  op: "replace" | "remove";
  text: TextKind;
  check: (change: Change, frozenToolName: string | undefined) => string[];
}

const sha256 = (relative: string): string => createHash("sha256").update(readFileSync(path.join(REPO_ROOT, relative))).digest("hex");
const frozenWire = JSON.parse(readFileSync(path.join(REPO_ROOT, GOLDEN_RELATIVE_PATH), "utf8")) as WireGolden;
const frozenHandler = JSON.parse(readFileSync(path.join(REPO_ROOT, HANDLER_GOLDEN_RELATIVE_PATH), "utf8")) as HandlerGolden;
/** The committed ledger as written, so that a ledger the loader refuses fails its own rows below and not this file's import. */
const changes = (JSON.parse(readFileSync(path.join(REPO_ROOT, SANCTIONED_CHANGES_RELATIVE_PATH), "utf8")) as { changes: Change[] }).changes;

/** The rows of a wire golden, keyed `server/session/label`. */
function wireRows(golden: WireGolden): Map<string, Row> {
  const rows = new Map<string, Row>();
  for (const [server, entry] of Object.entries(golden.servers)) {
    for (const [session, body] of Object.entries(entry.sessions)) {
      for (const row of body.rows) rows.set(`${server}/${session}/${row.label}`, row);
    }
  }
  return rows;
}

/** The rows of a handler golden, keyed `server/label`. */
function handlerRows(golden: HandlerGolden): Map<string, Row> {
  const rows = new Map<string, Row>();
  for (const [server, entry] of Object.entries(golden.servers)) {
    for (const row of entry.rows) rows.set(`${server}/${row.label}`, row);
  }
  return rows;
}

const keyOf = (change: Change): string =>
  change.golden === "wire" ? `${change.server}/${change.session}/${change.label}` : `${change.server}/${change.label}`;

/** The decoded tokens of RFC 6901 pointer `pointer` (the pointers of the ledger carry no `~`). */
const tokensOf = (pointer: string): string[] => pointer.slice(1).split("/");

/** The audit element an `audit` entry names, keyed `server/index`. */
const auditKeyOf = (change: Change): string => `${change.server}/${tokensOf(change.pointer)[0]}`;

type Container = Record<string, unknown> | unknown[];

/** Put the entry's `old` back at its pointer inside `root`, undoing the entry (`pointer` is relative to `root`). */
function restoreAt(root: unknown, pointer: string, change: Change): void {
  const tokens = tokensOf(pointer);
  let parent = root as Container;
  for (const token of tokens.slice(0, -1)) parent = (parent as Record<string, Container>)[token] as Container;
  const last = tokens[tokens.length - 1] as string;
  if (change.op === "remove" && Array.isArray(parent)) parent.splice(Number(last), 0, structuredClone(change.old));
  else (parent as Record<string, unknown>)[last] = structuredClone(change.old);
}

/** The name of the tool at `/result/tools/<i>/...` of the frozen row that `change` names, or `undefined` when it names no tool. */
function frozenToolName(change: Change): string | undefined {
  const index = /^\/result\/tools\/(\d+)\//.exec(change.pointer)?.[1];
  const row = change.golden === "wire" ? wireRows(frozenWire).get(keyOf(change)) : undefined;
  if (index === undefined || row === undefined) return undefined;
  return (JSON.parse(row.line) as { result: { tools: Array<{ name: string }> } }).result.tools[Number(index)]?.name;
}

/** The value the frozen golden holds where `change` points; `undefined` when it holds nothing there. */
function frozenValueAt(change: Change): unknown {
  if (change.section === "audit") return valueAt(frozenHandler.servers[change.server]?.audit, change.pointer);
  const row = (change.golden === "wire" ? wireRows(frozenWire) : handlerRows(frozenHandler)).get(keyOf(change));
  return row === undefined ? undefined : valueAt(JSON.parse(row.line), change.pointer);
}

/** `[problem]` when `violated`, else no problem. */
const unmet = (violated: boolean, problem: string): string[] => (violated ? [problem] : []);

const isPlainRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * What is wrong with an `inputSchema.properties` entry of Story 42.11: `new` must be `old` (the frozen object) with the one member
 * `allowStorageRegeneration` inserted just before the framework's `server`, the Design Notes property in it, every other member
 * deep-equal to the frozen one, and, for `iris_doc_load` only, the `ignoreConflict` text corrected.
 */
function storagePropertiesProblems(change: Change, toolName: string | undefined): string[] {
  const before = change.old;
  const after = change.new;
  if (!isPlainRecord(before) || !isPlainRecord(after) || toolName === undefined) return [`${change.id}: old and new must be the properties objects of a named tool`];
  const oldKeys = Object.keys(before);
  const expectedKeys = [...oldKeys.slice(0, -1), "allowStorageRegeneration", "server"];
  const problems = [
    ...unmet(oldKeys[oldKeys.length - 1] !== "server", `${change.id}: the frozen properties end with the framework's server`),
    ...unmet(oldKeys.includes("allowStorageRegeneration"), `${change.id}: the frozen properties have no allowStorageRegeneration`),
    ...unmet(
      JSON.stringify(Object.keys(after)) !== JSON.stringify(expectedKeys),
      `${change.id}: new must be the frozen members with allowStorageRegeneration just before server (got ${Object.keys(after).join(",")})`,
    ),
    ...unmet(!isDeepStrictEqual(after["allowStorageRegeneration"], STORAGE_GUARD_PROPERTY[toolName]), `${change.id}: the new member is not the Design Notes property of ${toolName}`),
  ];
  for (const key of oldKeys) {
    const frozenMember = before[key];
    const corrected = toolName === "iris_doc_load" && key === "ignoreConflict";
    if (corrected) {
      problems.push(...unmet(!isPlainRecord(frozenMember) || frozenMember["description"] !== IGNORE_CONFLICT_BEFORE, `${change.id}: the frozen ignoreConflict text is not the one Story 42.11 corrects`));
    }
    const wanted = corrected && isPlainRecord(frozenMember) ? { ...frozenMember, description: IGNORE_CONFLICT_AFTER } : frozenMember;
    problems.push(...unmet(!isDeepStrictEqual(after[key], wanted), `${change.id}: member ${key} must be ${corrected ? "the frozen member with the corrected text" : "unchanged"}`));
  }
  return problems;
}

/** The seven sanctions the ledger registers, written from the specs of Stories 43.4, 42.10 and 42.11. */
const SANCTIONS: Record<string, Shape> = {
  "S-43.4-descriptions": {
    story: "43.4",
    count: 6,
    golden: "wire",
    op: "replace",
    text: "append",
    check: (change) => unmet(!/^\/result\/tools\/\d+\/description$/.test(change.pointer), `${change.id}: must point at a tool's description`),
  },
  "S-43.4-governance-resource": {
    story: "43.4",
    count: 5,
    golden: "wire",
    op: "remove",
    text: "none",
    check: (change) => unmet(change.pointer !== "/result/resources/1" || change.label !== "resources-list", `${change.id}: must remove /result/resources/1 of resources-list`),
  },
  "S-42.10-annotations": {
    story: "42.10",
    count: 19,
    golden: "wire",
    op: "replace",
    text: "none",
    check: (change, toolName) => [
      ...unmet(change.label !== "tools-list", `${change.id}: must change the tools-list row`),
      ...unmet(!/^\/result\/tools\/\d+\/annotations\/destructiveHint$/.test(change.pointer), `${change.id}: must point at one tool's destructiveHint`),
      ...unmet(change.old !== false || change.new !== true, `${change.id}: must flip destructiveHint from false to true`),
      ...unmet(toolName === undefined || !(FLIPPED_TOOLS[change.server] ?? []).includes(toolName), `${change.id}: the tool at its pointer (${String(toolName)}) must be one of the 13 flipped tools of its server`),
    ],
  },
  "S-42.10-resend-text": {
    story: "42.10",
    count: 3,
    golden: "wire",
    op: "replace",
    text: "correction",
    check: (change) => [
      ...unmet(change.server !== "iris-interop-mcp" || change.session !== "main" || change.label !== "tools-list", `${change.id}: must correct the interop main tools-list`),
      ...unmet(!RESEND_POINTERS.includes(change.pointer), `${change.id}: must correct tool 21 at one of the three resend text pointers`),
    ],
  },
  "S-42.10-audit-namespace": {
    story: "42.10",
    count: 1,
    golden: "handler",
    op: "replace",
    text: "none",
    check: (change) => [
      ...unmet(change.server !== "iris-admin-mcp" || change.section !== "audit" || change.pointer !== "/1/namespace", `${change.id}: must change /1/namespace of the admin audit array`),
      ...unmet(change.old !== "HSCUSTOM" || change.new !== "%SYS", `${change.id}: must change the namespace from HSCUSTOM to %SYS`),
    ],
  },
  "S-42.11-storage-guard-schema": {
    story: "42.11",
    count: 4,
    golden: "wire",
    op: "replace",
    text: "none",
    check: (change, toolName) => [
      ...unmet(change.server !== "iris-dev-mcp" || change.label !== "tools-list", `${change.id}: must change a tools-list row of the dev server`),
      ...unmet(!/^\/result\/tools\/\d+\/inputSchema\/properties$/.test(change.pointer), `${change.id}: must replace one tool's inputSchema properties object`),
      ...unmet(!(STORAGE_GUARD_TOOLS as readonly string[]).includes(String(toolName)), `${change.id}: the tool at its pointer (${String(toolName)}) must be one of the three storage-guard tools`),
      ...storagePropertiesProblems(change, toolName),
    ],
  },
  "S-42.11-storage-guard-text": {
    story: "42.11",
    count: 4,
    golden: "wire",
    op: "replace",
    text: "append",
    check: (change, toolName) => {
      const sentence = toolName === undefined ? undefined : STORAGE_GUARD_SENTENCE[toolName];
      return [
        ...unmet(change.server !== "iris-dev-mcp" || change.label !== "tools-list", `${change.id}: must append to a tools-list row of the dev server`),
        ...unmet(!/^\/result\/tools\/\d+\/description$/.test(change.pointer), `${change.id}: must point at a tool's description`),
        ...unmet(sentence === undefined, `${change.id}: the tool at its pointer (${String(toolName)}) must be one of the three storage-guard tools`),
        ...unmet(
          sentence !== undefined && change.new !== `${String(change.old)}${sentence.separator}${sentence.sentence}`,
          `${change.id}: new must be old, the spec's separator and the spec's sentence`,
        ),
      ];
    },
  },
};

/**
 * What is wrong with how `entries` use `shapes`: a sanction with no shape, an entry that is not its sanction's story, golden or
 * operation, an append that is not marked `appendOnly`, a correction under an append-only sanction or an append mark on a sanction that
 * does not append, an entry the sanction's own check refuses, and a sanction whose entry count is not the registered one.
 */
function shapeProblems(entries: Change[], shapes: Record<string, Shape>, toolNameOf: (change: Change) => string | undefined): string[] {
  const problems: string[] = [];
  const seen = new Map<string, number>();
  for (const change of entries) {
    const shape = shapes[change.sanction];
    if (shape === undefined) {
      problems.push(`${change.id}: the sanction ${change.sanction} has no registered shape`);
      continue;
    }
    seen.set(change.sanction, (seen.get(change.sanction) ?? 0) + 1);
    if (change.story !== shape.story) problems.push(`${change.id}: story ${change.story}, but ${change.sanction} belongs to Story ${shape.story}`);
    if (change.golden !== shape.golden) problems.push(`${change.id}: golden ${change.golden}, but ${change.sanction} changes the ${shape.golden} golden`);
    if (change.op !== shape.op) problems.push(`${change.id}: op ${change.op}, but ${change.sanction} uses ${shape.op}`);
    if (shape.text === "append" && change.appendOnly !== true) problems.push(`${change.id}: ${change.sanction} only appends, so its entry must be appendOnly (a correction is refused)`);
    if (shape.text !== "append" && change.appendOnly === true) problems.push(`${change.id}: ${change.sanction} does not append, so its entry must not be appendOnly`);
    problems.push(...shape.check(change, toolNameOf(change)));
  }
  for (const [sanction, shape] of Object.entries(shapes)) {
    if ((seen.get(sanction) ?? 0) !== shape.count) problems.push(`${sanction}: ${seen.get(sanction) ?? 0} entries, registered ${shape.count}`);
  }
  return problems;
}

/** An in-memory wire change that is valid until a test breaks one member. */
const GOOD_WIRE_CHANGE: Change = {
  id: "t/good",
  sanction: "S-43.4-descriptions",
  story: "43.4",
  golden: "wire",
  server: "iris-admin-mcp",
  session: "main",
  label: "tools-list",
  pointer: "/result/tools/25/description",
  op: "replace",
  old: (JSON.parse(wireRows(frozenWire).get("iris-admin-mcp/main/tools-list")!.line) as { result: { tools: Array<{ description: string }> } }).result.tools[25]!.description,
  new: "replacement",
};

/** An in-memory handler audit change that is valid until a test breaks one member. */
const GOOD_AUDIT_CHANGE: Change = {
  id: "t/audit",
  sanction: "S-42.10-audit-namespace",
  story: "42.10",
  golden: "handler",
  server: "iris-admin-mcp",
  section: "audit",
  pointer: "/1/namespace",
  op: "replace",
  old: "HSCUSTOM",
  new: "%SYS",
};

describe("the frozen goldens", () => {
  it("sdk-wire-golden.json is byte-unchanged", () => {
    expect(sha256(GOLDEN_RELATIVE_PATH)).toBe(FROZEN_WIRE_SHA256);
  });

  it("sdk-handler-golden.json is byte-unchanged", () => {
    expect(sha256(HANDLER_GOLDEN_RELATIVE_PATH)).toBe(FROZEN_HANDLER_SHA256);
  });
});

describe("the ledger", () => {
  it("passes the loader's own validation: the schema, unique ids, no no-op, and appends that append", () => {
    expect(() => readSanctionedChanges(REPO_ROOT)).not.toThrow();
    expect(readSanctionedChanges(REPO_ROOT)).toHaveLength(changes.length);
  });

  it("holds the entries of Story 43.4, then Story 42.10, then Story 42.11, each story's ids in order, and no other entry", () => {
    expect(changes.map((change) => change.id)).toEqual(STORIES.flatMap(([, ids]) => ids));
    for (const [story, ids] of STORIES) {
      expect(changes.filter((change) => change.story === story).map((change) => change.id), `Story ${story}`).toEqual(ids);
    }
    expect(STORY_43_4_IDS).toHaveLength(11);
    expect(STORY_42_10_IDS).toHaveLength(23);
    expect(STORY_42_11_IDS).toHaveLength(8);
    expect(SANCTIONED_CHANGES_RELATIVE_PATH).toBe("packages/iris-mcp-all/src/__tests__/fixtures/sdk-golden-sanctioned-changes.json");
  });

  it("every entry's old is the value before it: the frozen value at its pointer, or the new value of the entry before it for that pointer", () => {
    const lastNew = new Map<string, unknown>();
    for (const change of changes) {
      const row = change.section === "audit" ? change.server : keyOf(change);
      const chain = `${change.golden}|${change.section ?? "rows"}|${row}|${change.pointer}`;
      const expected = lastNew.has(chain) ? lastNew.get(chain) : frozenValueAt(change);
      expect(expected, `${change.id}: the frozen golden holds something at ${change.pointer}`).not.toBeUndefined();
      expect(change.old, `${change.id}: old`).toEqual(expected);
      lastNew.set(chain, change.new);
    }
  });

  it("no entry is a no-op, and a description entry under S-43.4-descriptions only appends a sentence that names the dialog", () => {
    for (const change of changes) {
      if (change.op === "replace") expect(change.new, `${change.id}: new differs from old`).not.toEqual(change.old);
      else expect(Object.prototype.hasOwnProperty.call(change, "new"), `${change.id}: a remove carries no new`).toBe(false);
    }
    for (const change of changes.filter((candidate) => candidate.sanction === "S-43.4-descriptions")) {
      expect(change.op, change.id).toBe("replace");
      expect(change.appendOnly, change.id).toBe(true);
      expect(change.pointer, change.id).toMatch(/^\/result\/tools\/\d+\/description$/);
      const before = change.old as string;
      const after = change.new as string;
      expect(after.startsWith(before), `${change.id}: new starts with old`).toBe(true);
      expect(after.length, `${change.id}: new is longer`).toBeGreaterThan(before.length);
      const suffix = after.slice(before.length);
      expect(suffix, `${change.id}: the appended sentence names form elicitation`).toContain("form elicitation");
      expect(suffix, `${change.id}: the appended sentence names the refusal`).toContain("CONFIRMATION_DECLINED");
    }
    for (const change of changes.filter((candidate) => candidate.sanction === "S-43.4-governance-resource")) {
      expect(change.op, change.id).toBe("remove");
      expect(change.pointer, change.id).toBe("/result/resources/1");
      expect(change.label, change.id).toBe("resources-list");
    }
  });

  it("every sanction is registered with a shape, and each entry has its sanction's shape (an append appends, a correction is registered as one)", () => {
    expect(shapeProblems(changes, SANCTIONS, frozenToolName)).toEqual([]);
    expect(Object.keys(SANCTIONS).sort()).toEqual([...new Set(changes.map((change) => change.sanction))].sort());
  });

  it("S-42.10-annotations holds one entry for each flipped tool in each frozen tools-list row that lists it, and none for any other tool", () => {
    const expected: string[] = [];
    for (const [key, row] of wireRows(frozenWire)) {
      if (!key.endsWith("/tools-list")) continue;
      const [server, session] = key.split("/") as [string, string];
      const listed = (JSON.parse(row.line) as { result: { tools: Array<{ name: string }> } }).result.tools.map((tool) => tool.name);
      for (const tool of FLIPPED_TOOLS[server] ?? []) if (listed.includes(tool)) expected.push(`${server}/${session}/${tool}`);
    }
    const entered = changes.filter((change) => change.sanction === "S-42.10-annotations").map((change) => `${change.server}/${change.session}/${frozenToolName(change)}`);
    expect(entered.sort()).toEqual(expected.sort());
    expect(expected).toHaveLength(19);
  });

  it("each Story 42.11 sanction holds one entry for each storage-guard tool in each frozen dev tools-list row that lists it, and none for any other tool", () => {
    const expected: string[] = [];
    for (const [key, row] of wireRows(frozenWire)) {
      if (!key.startsWith("iris-dev-mcp/") || !key.endsWith("/tools-list")) continue;
      const session = key.split("/")[1] as string;
      const listed = (JSON.parse(row.line) as { result: { tools: Array<{ name: string }> } }).result.tools.map((tool) => tool.name);
      for (const tool of STORAGE_GUARD_TOOLS) if (listed.includes(tool)) expected.push(`${session}/${tool}`);
    }
    for (const sanction of ["S-42.11-storage-guard-schema", "S-42.11-storage-guard-text"]) {
      const entered = changes.filter((change) => change.sanction === sanction).map((change) => `${change.session}/${frozenToolName(change)}`);
      expect(entered.sort(), sanction).toEqual([...expected].sort());
    }
    expect(expected).toHaveLength(4);
  });

  it("a Story 42.11 schema entry holds the frozen properties as old, and the frozen properties lack the new member", () => {
    for (const change of changes.filter((candidate) => candidate.sanction === "S-42.11-storage-guard-schema")) {
      const old = change.old as Record<string, unknown>;
      expect(Object.keys(old), `${change.id}: the frozen properties do not have the parameter`).not.toContain("allowStorageRegeneration");
      expect(old, `${change.id}: old is the frozen object`).toEqual(frozenValueAt(change));
      expect(Object.keys(old).at(-1), `${change.id}: the framework's server is last`).toBe("server");
    }
  });

  it("the Story 42.11 shape checks fail on a member after server, a changed member, a wrong text, a wrong separator and a wrong tool", () => {
    const schemaEntry = changes.find((change) => change.id === "42.11/storage-guard-schema/iris_doc_xml_export@dev-main")!;
    const properties = schemaEntry.new as Record<string, unknown>;
    const { allowStorageRegeneration, server, ...others } = properties;
    const afterServer = { ...others, server, allowStorageRegeneration };
    const textEntry = changes.find((change) => change.id === "42.11/storage-guard-text/iris_doc_xml_export@dev-main")!;
    const problemsOf = (entry: Change): string => shapeProblems(changes.map((change) => (change.id === entry.id ? entry : change)), SANCTIONS, frozenToolName).join("\n");

    expect(problemsOf({ ...schemaEntry, new: afterServer })).toContain("must be the frozen members with allowStorageRegeneration just before server");
    expect(problemsOf({ ...schemaEntry, new: { ...properties, action: { type: "string" } } })).toContain("member action must be unchanged");
    expect(problemsOf({ ...schemaEntry, new: { ...properties, allowStorageRegeneration: { description: "x", type: "boolean" } } })).toContain("the new member is not the Design Notes property");
    expect(problemsOf({ ...textEntry, new: `${String(textEntry.old)}\n\n${STORAGE_GUARD_SENTENCE["iris_doc_xml_export"]!.sentence}` })).toContain("new must be old, the spec's separator and the spec's sentence");
    expect(problemsOf({ ...textEntry, new: `${String(textEntry.old)}${STORAGE_GUARD_SENTENCE["iris_doc_xml_export"]!.separator}x` })).toContain("new must be old, the spec's separator and the spec's sentence");
    expect(problemsOf({ ...schemaEntry, pointer: "/result/tools/0/inputSchema/properties" })).toContain("must be one of the three storage-guard tools");
  });

  it("the shape check fails on an unregistered sanction, a correction under an append-only sanction, a wrong story and a wrong count", () => {
    const entry = changes.find((change) => change.id === "42.10/resend-text/description@interop-main")!;
    const none = (): undefined => undefined;
    expect(shapeProblems([{ ...entry, sanction: "S-42.10-unregistered" }], SANCTIONS, none)).toContain(
      "42.10/resend-text/description@interop-main: the sanction S-42.10-unregistered has no registered shape",
    );
    const asAppend = { ...SANCTIONS, "S-42.10-resend-text": { ...SANCTIONS["S-42.10-resend-text"]!, text: "append" as const } };
    expect(shapeProblems(changes, asAppend, frozenToolName).join("\n")).toContain("42.10/resend-text/description@interop-main: S-42.10-resend-text only appends");
    const appendEntry = changes.find((change) => change.id === "43.4/description/iris_audit_manage@admin-main")!;
    const { appendOnly: _appendOnly, ...asCorrection } = appendEntry;
    expect(shapeProblems(changes.map((change) => (change === appendEntry ? asCorrection : change)), SANCTIONS, frozenToolName).join("\n")).toContain(
      "43.4/description/iris_audit_manage@admin-main: S-43.4-descriptions only appends",
    );
    expect(shapeProblems(changes.map((change) => (change === entry ? { ...entry, story: "43.4" } : change)), SANCTIONS, frozenToolName)).toContain(
      "42.10/resend-text/description@interop-main: story 43.4, but S-42.10-resend-text belongs to Story 42.10",
    );
    const audit = changes.find((change) => change.id === "42.10/audit-namespace/iris_namespace_list@admin-handler")!;
    expect(shapeProblems(changes.filter((change) => change !== audit), SANCTIONS, frozenToolName)).toContain("S-42.10-audit-namespace: 0 entries, registered 1");
    const flipped = changes.find((change) => change.id === "42.10/annotations/iris_task_run@ops-main")!;
    expect(shapeProblems(changes.map((change) => (change === flipped ? { ...flipped, server: "iris-dev-mcp" } : change)), SANCTIONS, frozenToolName).join("\n")).toContain(
      "42.10/annotations/iris_task_run@ops-main: the tool at its pointer",
    );
  });
});

describe("the sanctioned goldens", () => {
  it("the wire golden differs from the frozen one in exactly the rows the entries name, every other row and every other field as frozen", () => {
    const sanctioned = readSanctionedGolden(REPO_ROOT, "wire") as WireGolden;
    const before = wireRows(frozenWire);
    const after = wireRows(sanctioned);
    expect([...after.keys()]).toEqual([...before.keys()]);
    const named = new Set(changes.filter((change) => change.golden === "wire").map(keyOf));
    const differing = [...before.keys()].filter((key) => before.get(key)!.line !== after.get(key)!.line);
    expect(differing.sort()).toEqual([...named].sort());
    for (const key of before.keys()) {
      const { line: frozenLine, ...frozenRest } = before.get(key)!;
      const { line: sanctionedLine, ...sanctionedRest } = after.get(key)!;
      expect(sanctionedRest, `${key}: no field but line moves`).toEqual(frozenRest);
      if (!named.has(key)) expect(sanctionedLine, `${key}: the line is the frozen one`).toBe(frozenLine);
    }
    for (const key of named) {
      const line = after.get(key)!.line;
      expect(JSON.stringify(JSON.parse(line)), `${key}: the sanctioned line is canonical JSON`).toBe(line);
    }
    const { servers: frozenServers, ...frozenHeader } = frozenWire as WireGolden & Record<string, unknown>;
    const { servers: sanctionedServers, ...sanctionedHeader } = sanctioned as WireGolden & Record<string, unknown>;
    expect(sanctionedHeader).toEqual(frozenHeader);
    expect(Object.keys(sanctionedServers)).toEqual(Object.keys(frozenServers));
  });

  it("the handler golden differs from the frozen one in exactly the rows and the audit elements the entries name, and only in the members they name", () => {
    const sanctioned = readSanctionedGolden(REPO_ROOT, "handler") as HandlerGolden;
    const handlerChanges = changes.filter((change) => change.golden === "handler");
    const namedRows = new Set(handlerChanges.filter((change) => change.section !== "audit").map(keyOf));
    const namedAudit = new Set(handlerChanges.filter((change) => change.section === "audit").map(auditKeyOf));
    expect(namedAudit.size, "the ledger names an audit element").toBeGreaterThan(0);
    const { servers: frozenServers, ...frozenHeader } = frozenHandler as HandlerGolden & Record<string, unknown>;
    const { servers: sanctionedServers, ...sanctionedHeader } = sanctioned as HandlerGolden & Record<string, unknown>;
    expect(sanctionedHeader).toEqual(frozenHeader);
    expect(Object.keys(sanctionedServers)).toEqual(Object.keys(frozenServers));

    for (const [server, frozenSession] of Object.entries(frozenHandler.servers)) {
      const session = sanctioned.servers[server]!;
      expect(session.startup, `${server}: the startup requests are the frozen ones`).toEqual(frozenSession.startup);
      expect(session.rows.map((row) => row.label), `${server}: the same rows`).toEqual(frozenSession.rows.map((row) => row.label));
      for (const [index, frozenRow] of frozenSession.rows.entries()) {
        const key = `${server}/${frozenRow.label}`;
        const { line: frozenLine, ...frozenRest } = frozenRow;
        const { line: sanctionedLine, ...sanctionedRest } = session.rows[index]!;
        expect(sanctionedRest, `${key}: no field but line moves`).toEqual(frozenRest);
        if (!namedRows.has(key)) expect(sanctionedLine, `${key}: the line is the frozen one`).toBe(frozenLine);
      }
      expect(session.audit, `${server}: the same number of audit elements`).toHaveLength(frozenSession.audit.length);
      for (const [index, frozenElement] of frozenSession.audit.entries()) {
        const key = `${server}/${index}`;
        const now = session.audit[index]!;
        if (!namedAudit.has(key)) {
          expect(now, `${key}: the audit element is the frozen one`).toEqual(frozenElement);
          continue;
        }
        expect(frozenElement, `${key}: a named audit element is a call entry`).toHaveProperty("seq");
        expect(now, `${key}: the named audit element moved`).not.toEqual(frozenElement);
        const restored = structuredClone(now);
        for (const change of handlerChanges.filter((candidate) => candidate.section === "audit" && auditKeyOf(candidate) === key).reverse()) {
          const member = `/${tokensOf(change.pointer).slice(1).join("/")}`;
          expect(valueAt(restored, member), `${change.id}: the sanctioned element holds new`).toEqual(change.new);
          restoreAt(restored, member, change);
        }
        expect(restored, `${key}: with the named members restored the element is the frozen one`).toEqual(frozenElement);
      }
    }
  });

  it("with every entry undone in reverse order, each named wire row is the frozen one, so no entry moved anything but its own value", () => {
    const sanctioned = wireRows(readSanctionedGolden(REPO_ROOT, "wire") as WireGolden);
    const frozen = wireRows(frozenWire);
    const wireChanges = changes.filter((candidate) => candidate.golden === "wire");
    for (const key of new Set(wireChanges.map(keyOf))) {
      const now = JSON.parse(sanctioned.get(key)!.line) as unknown;
      const then = JSON.parse(frozen.get(key)!.line) as unknown;
      for (const change of wireChanges.filter((candidate) => keyOf(candidate) === key).reverse()) {
        if (change.op === "replace") expect(valueAt(now, change.pointer), `${change.id}: the sanctioned row holds new`).toEqual(change.new);
        else expect(valueAt(now, change.pointer), `${change.id}: the removed value is gone`).not.toEqual(change.old);
        restoreAt(now, change.pointer, change);
      }
      expect(now, `${key}: with the entries undone the row is the frozen one`).toEqual(then);
    }
  });
});

describe("the CHANGELOG names every sanction", () => {
  const changelog = readFileSync(path.join(REPO_ROOT, "CHANGELOG.md"), "utf8");

  /** The CHANGELOG entry whose heading names `Story <story>:`, up to the next `## ` heading; `undefined` when there is none. */
  function entryOf(text: string, story: string): string | undefined {
    const heading = new RegExp(`^## [^\\n]*Story ${story.replace(".", "\\.")}:[^\\n]*$`, "m").exec(text);
    if (heading === null) return undefined;
    const start = heading.index;
    const next = text.indexOf("\n## ", start + 1);
    return text.slice(start, next === -1 ? undefined : next);
  }

  /** What is missing from `text` for the (story, sanction) pairs of `entries`: the story's entry, or a sanction id in backticks. */
  function changelogProblems(entries: Change[], text: string): string[] {
    const problems: string[] = [];
    for (const pair of new Set(entries.map((change) => `${change.story} ${change.sanction}`))) {
      const [story, sanction] = pair.split(" ") as [string, string];
      const entry = entryOf(text, story);
      if (entry === undefined) problems.push(`${sanction}: the CHANGELOG has no entry whose heading names Story ${story}:`);
      else if (!entry.includes(`\`${sanction}\``)) problems.push(`${sanction}: the Story ${story} entry of the CHANGELOG does not name it in backticks`);
    }
    return problems;
  }

  it("each sanction id appears, in backticks, in the entry of its story", () => {
    const pairs = [...new Set(changes.map((change) => `${change.story} ${change.sanction}`))];
    expect(pairs.sort()).toEqual([
      "42.10 S-42.10-annotations",
      "42.10 S-42.10-audit-namespace",
      "42.10 S-42.10-resend-text",
      "42.11 S-42.11-storage-guard-schema",
      "42.11 S-42.11-storage-guard-text",
      "43.4 S-43.4-descriptions",
      "43.4 S-43.4-governance-resource",
    ]);
    expect(changelogProblems(changes, changelog)).toEqual([]);
  });

  it("the check fails on a sanction id the entry does not name in backticks, and on a story with no entry", () => {
    const entry43 = "## [Pre-release] - Story 43.4: close\n\n`S-43.4-descriptions` and S-43.4-governance-resource\n";
    expect(changelogProblems(changes.filter((change) => change.story === "43.4"), entry43)).toEqual([
      "S-43.4-governance-resource: the Story 43.4 entry of the CHANGELOG does not name it in backticks",
    ]);
    expect(changelogProblems(changes.filter((change) => change.story === "42.10"), entry43)).toEqual([
      "S-42.10-annotations: the CHANGELOG has no entry whose heading names Story 42.10:",
      "S-42.10-resend-text: the CHANGELOG has no entry whose heading names Story 42.10:",
      "S-42.10-audit-namespace: the CHANGELOG has no entry whose heading names Story 42.10:",
    ]);
  });
});

describe("the loader refuses what it cannot apply, naming the entry", () => {
  const apply = (entries: Change[]): unknown => applySanctionedChanges(structuredClone(frozenWire), "wire", entries);
  const applyHandler = (entries: Change[]): HandlerGolden => applySanctionedChanges(structuredClone(frozenHandler), "handler", entries) as HandlerGolden;

  it("a wrong old", () => {
    expect(() => apply([{ ...GOOD_WIRE_CHANGE, old: "not the frozen text", new: "x" }])).toThrow(/Sanctioned change 't\/good': old is not the value/);
  });

  it("a pointer that resolves to nothing", () => {
    expect(() => apply([{ ...GOOD_WIRE_CHANGE, pointer: "/result/tools/9999/description" }])).toThrow(/Sanctioned change 't\/good': pointer .* resolves to nothing/);
    expect(() => apply([{ ...GOOD_WIRE_CHANGE, pointer: "/result/tools/01/description" }])).toThrow(/Sanctioned change 't\/good'/);
  });

  it("a row that the golden does not hold", () => {
    expect(() => apply([{ ...GOOD_WIRE_CHANGE, label: "no-such-row" }])).toThrow(/Sanctioned change 't\/good': the golden has no row/);
    expect(() => apply([{ ...GOOD_WIRE_CHANGE, session: "no-such-session" }])).toThrow(/Sanctioned change 't\/good'/);
    expect(() => apply([{ ...GOOD_WIRE_CHANGE, server: "iris-nope-mcp" }])).toThrow(/Sanctioned change 't\/good'/);
  });

  it("a frozen line that is not canonical JSON, because re-serializing it would move bytes no entry names", () => {
    const spaced = structuredClone(frozenWire);
    const row = spaced.servers["iris-admin-mcp"]!.sessions["main"]!.rows.find((candidate) => candidate.label === "tools-list")!;
    row.line = ` ${row.line}`;
    expect(() => applySanctionedChanges(spaced, "wire", [GOOD_WIRE_CHANGE])).toThrow(/Sanctioned change 't\/good': the frozen line .* not canonical JSON/);
  });

  it("a duplicate id, a no-op, an append that is not an append, an unknown key, a missing old and a second pointer form", () => {
    expect(() => validateSanctionedChanges({ description: "d", changes: [GOOD_WIRE_CHANGE, GOOD_WIRE_CHANGE] })).toThrow(/Sanctioned change 't\/good': id is not unique/);
    expect(() => validateSanctionedChanges({ description: "d", changes: [{ ...GOOD_WIRE_CHANGE, old: "same", new: "same" }] })).toThrow(/Sanctioned change 't\/good': new equals old/);
    expect(() => validateSanctionedChanges({ description: "d", changes: [{ ...GOOD_WIRE_CHANGE, old: "abc", new: "abx", appendOnly: true }] })).toThrow(
      /Sanctioned change 't\/good': an appendOnly change must start with old/,
    );
    expect(() => validateSanctionedChanges({ description: "d", changes: [{ ...GOOD_WIRE_CHANGE, old: "abc", new: "abc", appendOnly: true }] })).toThrow(/Sanctioned change 't\/good'/);
    expect(() => validateSanctionedChanges({ description: "d", changes: [{ ...GOOD_WIRE_CHANGE, extra: 1 }] })).toThrow(/Sanctioned change 't\/good': unknown key 'extra'/);
    const { old: _old, ...withoutOld } = GOOD_WIRE_CHANGE;
    expect(() => validateSanctionedChanges({ description: "d", changes: [withoutOld] })).toThrow(/Sanctioned change 't\/good': old is required/);
    expect(() => validateSanctionedChanges({ description: "d", changes: [{ ...GOOD_WIRE_CHANGE, pointer: "result/tools" }] })).toThrow(/Sanctioned change 't\/good': pointer/);
    expect(() => validateSanctionedChanges({ description: "d", changes: [{ ...GOOD_WIRE_CHANGE, session: undefined }] })).toThrow(/Sanctioned change 't\/good': a 'wire' change needs a non-empty session/);
    expect(() => validateSanctionedChanges({ description: "d", changes: [], extra: true })).toThrow(/exactly 'description' and 'changes'/);
  });

  it("an appendOnly change that does append is accepted, and a correction (a replace without appendOnly) is accepted too", () => {
    expect(validateSanctionedChanges({ description: "d", changes: [{ ...GOOD_WIRE_CHANGE, old: "abc", new: "abc def", appendOnly: true }] })).toHaveLength(1);
    expect(validateSanctionedChanges({ description: "d", changes: [{ ...GOOD_WIRE_CHANGE, old: "abc def", new: "abc" }] })).toHaveLength(1);
  });

  it("a malformed audit entry: a label, a section on a wire change, an unknown section, a pointer with no member or no index", () => {
    const validate = (entry: Record<string, unknown>): unknown => validateSanctionedChanges({ description: "d", changes: [entry] });
    expect(validate(GOOD_AUDIT_CHANGE)).toHaveLength(1);
    expect(() => validate({ ...GOOD_AUDIT_CHANGE, label: "namespace-list" })).toThrow(/Sanctioned change 't\/audit': an 'audit' change addresses an element of the audit array and has no label/);
    expect(() => validate({ ...GOOD_WIRE_CHANGE, section: "audit" })).toThrow(/Sanctioned change 't\/good': an 'audit' change must be a 'handler' change/);
    expect(() => validate({ ...GOOD_AUDIT_CHANGE, section: "rows" })).toThrow(/Sanctioned change 't\/audit': section must be 'audit'/);
    expect(() => validate({ ...GOOD_AUDIT_CHANGE, pointer: "/1" })).toThrow(/Sanctioned change 't\/audit': an 'audit' pointer must be/);
    expect(() => validate({ ...GOOD_AUDIT_CHANGE, pointer: "/seq/namespace" })).toThrow(/Sanctioned change 't\/audit': an 'audit' pointer must be/);
    expect(() => validate({ ...GOOD_AUDIT_CHANGE, session: "main" })).toThrow(/Sanctioned change 't\/audit': a 'handler' change has no session/);
    const { label: _label, ...withoutLabel } = GOOD_WIRE_CHANGE;
    expect(() => validate(withoutLabel)).toThrow(/Sanctioned change 't\/good': label must be a non-empty string/);
  });

  it("an audit entry whose element is the sessionStart line, whose index holds no element, whose old is wrong or whose member does not exist", () => {
    expect(() => applyHandler([{ ...GOOD_AUDIT_CHANGE, pointer: "/0/version", old: "0.0.2", new: "0.0.3" }])).toThrow(
      /Sanctioned change 't\/audit': audit element 0 of iris-admin-mcp is not a call entry/,
    );
    expect(() => applyHandler([{ ...GOOD_AUDIT_CHANGE, pointer: "/9/namespace" }])).toThrow(/Sanctioned change 't\/audit': the audit array of iris-admin-mcp has no element 9/);
    expect(() => applyHandler([{ ...GOOD_AUDIT_CHANGE, old: "USER" }])).toThrow(/Sanctioned change 't\/audit': old is not the value at \/1\/namespace in the audit array/);
    expect(() => applyHandler([{ ...GOOD_AUDIT_CHANGE, pointer: "/1/no-such-member" }])).toThrow(/Sanctioned change 't\/audit': pointer \/1\/no-such-member resolves to nothing in the audit array/);
    expect(() => applyHandler([{ ...GOOD_AUDIT_CHANGE, server: "iris-nope-mcp" }])).toThrow(/Sanctioned change 't\/audit'/);
  });

  it("a refused audit entry applies nothing: the entries before it are not returned, and the input golden is untouched", () => {
    const input = structuredClone(frozenHandler);
    expect(() => applySanctionedChanges(input, "handler", [GOOD_AUDIT_CHANGE, { ...GOOD_AUDIT_CHANGE, id: "t/second", pointer: "/0/version", old: "0.0.2", new: "0.0.3" }])).toThrow(
      /Sanctioned change 't\/second'/,
    );
    expect(input).toEqual(frozenHandler);
  });
});

describe("the loader's operations", () => {
  it("a remove deletes exactly one array element, and moves nothing else in the row", () => {
    const entry: Change = {
      id: "t/remove",
      sanction: "S-43.4-governance-resource",
      story: "43.4",
      golden: "wire",
      server: "iris-admin-mcp",
      session: "main",
      label: "resources-list",
      pointer: "/result/resources/0",
      op: "remove",
      old: (JSON.parse(wireRows(frozenWire).get("iris-admin-mcp/main/resources-list")!.line) as { result: { resources: unknown[] } }).result.resources[0],
    };
    const sanctioned = wireRows(applySanctionedChanges(structuredClone(frozenWire), "wire", [entry]) as WireGolden);
    const now = JSON.parse(sanctioned.get("iris-admin-mcp/main/resources-list")!.line) as { result: { resources: unknown[] } };
    const then = JSON.parse(wireRows(frozenWire).get("iris-admin-mcp/main/resources-list")!.line) as { result: { resources: unknown[] } };
    expect(now.result.resources).toEqual(then.result.resources.slice(1));
    expect(now.result.resources).toHaveLength(then.result.resources.length - 1);
  });

  it("a handler entry rewrites only the line of its row", () => {
    const row = handlerRows(frozenHandler).get("iris-admin-mcp/namespace-list")!;
    const entry: Change = {
      id: "t/handler",
      sanction: "S-43.4-descriptions",
      story: "43.4",
      golden: "handler",
      server: "iris-admin-mcp",
      label: "namespace-list",
      pointer: "/result/structuredContent/count",
      op: "replace",
      old: 2,
      new: 3,
    };
    const sanctioned = applySanctionedChanges(structuredClone(frozenHandler), "handler", [entry]) as HandlerGolden;
    const changed = handlerRows(sanctioned);
    for (const [key, candidate] of handlerRows(frozenHandler)) {
      if (key === "iris-admin-mcp/namespace-list") continue;
      expect(changed.get(key), key).toEqual(candidate);
    }
    const { line: rewritten, ...rest } = changed.get("iris-admin-mcp/namespace-list")!;
    const { line: original, ...originalRest } = row;
    expect(rest).toEqual(originalRest);
    expect((JSON.parse(rewritten) as { result: { structuredContent: { count: number } } }).result.structuredContent.count).toBe(3);
    expect(rewritten).toBe(original.replace('"count":2', '"count":3'));
    expect(sanctioned.servers["iris-admin-mcp"]!.rows.find((candidate) => candidate.label === "schema-invalid")).toEqual(
      frozenHandler.servers["iris-admin-mcp"]!.rows.find((candidate) => candidate.label === "schema-invalid"),
    );
    expect(sanctioned.servers["iris-admin-mcp"]!.audit, "a row entry leaves the audit array as frozen").toEqual(frozenHandler.servers["iris-admin-mcp"]!.audit);
  });

  it("an audit entry changes one member of one audit element, and no row, no other element and no other server", () => {
    const sanctioned = applySanctionedChanges(structuredClone(frozenHandler), "handler", [GOOD_AUDIT_CHANGE]) as HandlerGolden;
    const admin = sanctioned.servers["iris-admin-mcp"]!;
    const frozenAdmin = frozenHandler.servers["iris-admin-mcp"]!;
    expect(admin.audit[0], "the sessionStart element is frozen").toEqual(frozenAdmin.audit[0]);
    expect(admin.audit[1]).toEqual({ ...frozenAdmin.audit[1], namespace: "%SYS" });
    expect(Object.keys(admin.audit[1]!), "the member keeps its place").toEqual(Object.keys(frozenAdmin.audit[1]!));
    expect(admin.rows, "no row line moves").toEqual(frozenAdmin.rows);
    expect(admin.startup).toEqual(frozenAdmin.startup);
    for (const [server, session] of Object.entries(frozenHandler.servers)) {
      if (server !== "iris-admin-mcp") expect(sanctioned.servers[server], server).toEqual(session);
    }
  });

  it("audit entries on one element apply in file order", () => {
    const first: Change = { ...GOOD_AUDIT_CHANGE, id: "t/first", new: "MIDDLE" };
    const second: Change = { ...GOOD_AUDIT_CHANGE, id: "t/second", old: "MIDDLE", new: "LAST" };
    const sanctioned = applySanctionedChanges(structuredClone(frozenHandler), "handler", [first, second]) as HandlerGolden;
    expect(sanctioned.servers["iris-admin-mcp"]!.audit[1]!["namespace"]).toBe("LAST");
    expect(() => applySanctionedChanges(structuredClone(frozenHandler), "handler", [second, first])).toThrow(/Sanctioned change 't\/second': old is not the value/);
  });

  it("an audit entry is ignored when the wire golden is applied, and a wire entry when the handler golden is applied", () => {
    expect(applySanctionedChanges(structuredClone(frozenWire), "wire", [GOOD_AUDIT_CHANGE])).toEqual(frozenWire);
    expect(applySanctionedChanges(structuredClone(frozenHandler), "handler", [GOOD_WIRE_CHANGE])).toEqual(frozenHandler);
  });

  it("changes to one row apply in file order", () => {
    const first: Change = { ...GOOD_WIRE_CHANGE, id: "t/first", old: GOOD_WIRE_CHANGE.old, new: "middle" };
    const second: Change = { ...GOOD_WIRE_CHANGE, id: "t/second", old: "middle", new: "last" };
    const sanctioned = wireRows(applySanctionedChanges(structuredClone(frozenWire), "wire", [first, second]) as WireGolden);
    const tools = (JSON.parse(sanctioned.get("iris-admin-mcp/main/tools-list")!.line) as { result: { tools: Array<{ description: string }> } }).result.tools;
    expect(tools[25]!.description).toBe("last");
    expect(() => applySanctionedChanges(structuredClone(frozenWire), "wire", [second, first])).toThrow(/Sanctioned change 't\/second': old is not the value/);
  });

  it("the unknown golden kind is refused", () => {
    expect(() => applySanctionedChanges(structuredClone(frozenWire), "nope" as never, [])).toThrow(/golden kind/);
    expect(() => readSanctionedGolden(REPO_ROOT, "nope" as never)).toThrow(/golden kind/);
  });
});
