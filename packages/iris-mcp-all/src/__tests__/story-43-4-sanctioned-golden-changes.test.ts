/**
 * Story 43.4 (DW-639; AD-15; Rules #19, #36, #59) - the frozen SDK v1 goldens retire through one ledger of sanctioned changes.
 *
 * `fixtures/sdk-wire-golden.json` and `fixtures/sdk-handler-golden.json` are frozen captures of the SDK v1 build. They are never
 * edited and never recaptured. Every change that AD-15 sanctions to bytes they hold is one entry of
 * `fixtures/sdk-golden-sanctioned-changes.json`, and the five golden tests compare the live bytes with the frozen capture plus those
 * entries (`scripts/lib/golden-sanctioned-changes.mjs`). This file keeps the ledger honest. It pins:
 *  - both frozen files byte for byte, by SHA-256;
 *  - the Story 43.4 entries by id and order, so adding or removing one is a visible change of this file;
 *  - each entry's `old` against the frozen value at its pointer, and that no entry is a no-op or, for a description, anything but an
 *    append that names the dialog;
 *  - that the sanctioned golden differs from the frozen one in exactly the rows the entries name, each a canonical JSON line;
 *  - that every sanction id is named, in backticks, in the CHANGELOG entry of its story;
 *  - the loader's refusals (a wrong `old`, an unresolvable pointer, an unknown row, a duplicate id, a no-op, a non-append, a
 *    non-canonical frozen line) on in-memory clones, and its two operations (`remove` an array element, rewrite one handler row).
 *
 * Needs no IRIS and no built dist: it reads documents only.
 */

import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { REPO_ROOT } from "./pack-fixture";
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

interface Row {
  label: string;
  line: string;
  [member: string]: unknown;
}

interface WireGolden {
  servers: Record<string, { sessions: Record<string, { rows: Row[] }> }>;
}

interface HandlerGolden {
  servers: Record<string, { rows: Row[] }>;
}

interface Change {
  id: string;
  sanction: string;
  story: string;
  golden: "wire" | "handler";
  server: string;
  session?: string;
  label: string;
  pointer: string;
  op: "replace" | "remove";
  old: unknown;
  new?: unknown;
  appendOnly?: boolean;
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

  it("holds the eleven Story 43.4 entries of decision #24, in order, and no other entry", () => {
    expect(changes.map((change) => change.id)).toEqual(STORY_43_4_IDS);
    expect(changes.every((change) => change.story === "43.4")).toBe(true);
    expect(changes.filter((change) => change.sanction === "S-43.4-descriptions")).toHaveLength(6);
    expect(changes.filter((change) => change.sanction === "S-43.4-governance-resource")).toHaveLength(5);
    expect(SANCTIONED_CHANGES_RELATIVE_PATH).toBe("packages/iris-mcp-all/src/__tests__/fixtures/sdk-golden-sanctioned-changes.json");
  });

  it("every entry's old is the frozen value at its pointer", () => {
    const rows = wireRows(frozenWire);
    for (const change of changes) {
      const row = rows.get(keyOf(change));
      expect(row, `${change.id}: the frozen golden holds the row ${keyOf(change)}`).toBeDefined();
      expect(valueAt(JSON.parse(row!.line), change.pointer), change.id).toEqual(change.old);
    }
  });

  it("no entry is a no-op, and a description entry only appends a sentence that names the dialog", () => {
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

  it("the handler golden has no entry yet, so it equals the frozen one", () => {
    expect(changes.filter((change) => change.golden === "handler")).toEqual([]);
    expect(readSanctionedGolden(REPO_ROOT, "handler")).toEqual(frozenHandler);
  });

  it("the sanctioned descriptions are the old text plus the entry's sentence and nothing else moved in the tools-list rows", () => {
    const sanctioned = wireRows(readSanctionedGolden(REPO_ROOT, "wire") as WireGolden);
    const frozen = wireRows(frozenWire);
    const descriptions = changes.filter((candidate) => candidate.sanction === "S-43.4-descriptions");
    for (const key of new Set(descriptions.map(keyOf))) {
      const now = JSON.parse(sanctioned.get(key)!.line) as { result: { tools: Array<Record<string, unknown>> } };
      const then = JSON.parse(frozen.get(key)!.line) as { result: { tools: Array<Record<string, unknown>> } };
      expect(now.result.tools.length, key).toBe(then.result.tools.length);
      for (const change of descriptions.filter((candidate) => keyOf(candidate) === key)) {
        const index = Number(/\/tools\/(\d+)\//.exec(change.pointer)![1]);
        expect(now.result.tools[index]!.description, change.id).toBe(change.new);
        now.result.tools[index]!.description = then.result.tools[index]!.description;
      }
      expect(now, `${key}: with the sanctioned descriptions restored the row is the frozen one`).toEqual(then);
    }
  });
});

describe("the CHANGELOG names every sanction", () => {
  const changelog = readFileSync(path.join(REPO_ROOT, "CHANGELOG.md"), "utf8");

  /** The CHANGELOG entry whose heading names `Story <story>:`, up to the next `## ` heading. */
  function entryOf(story: string): string {
    const heading = new RegExp(`^## [^\\n]*Story ${story.replace(".", "\\.")}:[^\\n]*$`, "m").exec(changelog);
    expect(heading, `a CHANGELOG entry whose heading names Story ${story}:`).not.toBeNull();
    const start = heading!.index;
    const next = changelog.indexOf("\n## ", start + 1);
    return changelog.slice(start, next === -1 ? undefined : next);
  }

  it("each sanction id appears, in backticks, in the entry of its story", () => {
    const pairs = [...new Set(changes.map((change) => `${change.story} ${change.sanction}`))];
    expect(pairs.sort()).toEqual(["43.4 S-43.4-descriptions", "43.4 S-43.4-governance-resource"]);
    for (const pair of pairs) {
      const [story, sanction] = pair.split(" ") as [string, string];
      expect(entryOf(story), `${sanction} in the Story ${story} entry`).toContain(`\`${sanction}\``);
    }
  });
});

describe("the loader refuses what it cannot apply, naming the entry", () => {
  const apply = (entries: Change[]): unknown => applySanctionedChanges(structuredClone(frozenWire), "wire", entries);

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

  it("an appendOnly change that does append is accepted", () => {
    expect(validateSanctionedChanges({ description: "d", changes: [{ ...GOOD_WIRE_CHANGE, old: "abc", new: "abc def", appendOnly: true }] })).toHaveLength(1);
  });
});

describe("the loader's two operations", () => {
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
