/**
 * Story 42.10 (AC 42.10.2; AD-14, AD-15; Rules #44, #59) - the `tools/list` snapshot and the sanctioned-change ledger say the same thing.
 *
 * Two artifacts hold the bytes of a tool's `tools/list` entry: the generated snapshot (`fixtures/tools-list-snapshot.json`, regenerated
 * only by `pnpm gen:tools-list-snapshot --force` after a rebuild) and the frozen SDK v1 wire golden plus its ledger of sanctioned changes
 * (`readSanctionedGolden`). Nothing linked them, so a regenerated snapshot could move a byte that no ledger entry sanctions, and a ledger
 * entry could name a change the snapshot does not show. This file reads documents only (no dist, no IRIS) and checks, for every server:
 *  - each tool the golden's `main` tools-list lists has a snapshot entry whose title, description, input schema and annotations are
 *    exactly the sanctioned golden's, so a moved value without an entry, and an entry the snapshot does not show, both fail naming
 *    server, tool and field;
 *  - each tool of the dev `core-preset` session equals its `main` entry in the sanctioned golden;
 *  - the last entry of each tools-list `main` pointer is the value the snapshot shows at that pointer;
 *  - every chain of ledger entries on one pointer ends at a value different from the frozen one, with at most one entry per sanction.
 * The checks are pure (documents in, problems out) and have rows below that make each fail, so a green run means it could see a problem.
 */

import { describe, expect, it } from "vitest";
import { isDeepStrictEqual } from "node:util";
import { REPO_ROOT } from "./pack-fixture";
import { readSnapshot } from "../../../../scripts/lib/tools-list-snapshot-core.mjs";
import { readSanctionedChanges, readSanctionedGolden, valueAt } from "../../../../scripts/lib/golden-sanctioned-changes.mjs";

/** The members of a tool's entry that the snapshot pins and the golden also holds. */
const FIELDS = ["title", "description", "inputSchema", "annotations"] as const;
type Field = (typeof FIELDS)[number];

type Entry = Record<Field, unknown>;

interface Snapshot {
  servers: Record<string, Record<string, Entry>>;
}

interface GoldenTool extends Entry {
  name: string;
}

interface WireGolden {
  servers: Record<string, { sessions: Record<string, { rows: Array<{ label: string; line: string }> }> }>;
}

interface Change {
  id: string;
  sanction: string;
  golden: "wire" | "handler";
  server: string;
  session?: string;
  label?: string;
  section?: string;
  pointer: string;
  op: "replace" | "remove";
  old: unknown;
  new?: unknown;
}

/** The tools that `session` of `pkg` lists in `golden`, in list order. */
function toolsOf(golden: WireGolden, pkg: string, session: string): GoldenTool[] {
  const row = golden.servers[pkg]?.sessions[session]?.rows.find((candidate) => candidate.label === "tools-list");
  if (row === undefined) throw new Error(`the golden has no tools-list row for ${pkg}/${session}`);
  return (JSON.parse(row.line) as { result: { tools: GoldenTool[] } }).result.tools;
}

/**
 * What differs between `snapshot` and the sanctioned golden: for each tool the golden's `main` tools-list lists, a missing snapshot entry
 * or a pinned field that is not exactly the golden's, each naming server, tool and field.
 */
function parityProblems(snapshot: Snapshot, golden: WireGolden): string[] {
  const problems: string[] = [];
  for (const pkg of Object.keys(golden.servers)) {
    for (const tool of toolsOf(golden, pkg, "main")) {
      const entry = snapshot.servers[pkg]?.[tool.name];
      if (entry === undefined) {
        problems.push(`${pkg} ${tool.name}: the snapshot has no entry`);
        continue;
      }
      for (const field of FIELDS) {
        if (!isDeepStrictEqual(entry[field], tool[field])) problems.push(`${pkg} ${tool.name}.${field}: the snapshot is not the sanctioned golden's`);
      }
    }
  }
  return problems;
}

/** What differs between each `core-preset` tool of the golden and the same tool in its `main` session. */
function corePresetProblems(golden: WireGolden): string[] {
  const problems: string[] = [];
  for (const pkg of Object.keys(golden.servers)) {
    if (golden.servers[pkg]?.sessions["core-preset"] === undefined) continue;
    const main = new Map(toolsOf(golden, pkg, "main").map((tool) => [tool.name, tool]));
    for (const tool of toolsOf(golden, pkg, "core-preset")) {
      const full = main.get(tool.name);
      if (full === undefined) problems.push(`${pkg} core-preset ${tool.name}: not in the main session`);
      else for (const field of FIELDS) if (!isDeepStrictEqual(full[field], tool[field])) problems.push(`${pkg} core-preset ${tool.name}.${field}: differs from its main entry`);
    }
  }
  return problems;
}

/** The chains of entries on one pointer of one row (or audit element), in ledger order. */
function chainsOf(changes: Change[]): Map<string, Change[]> {
  const chains = new Map<string, Change[]>();
  for (const change of changes) {
    const key = [change.golden, change.server, change.session ?? "", change.section ?? change.label ?? "", change.pointer].join("|");
    chains.set(key, [...(chains.get(key) ?? []), change]);
  }
  return chains;
}

/** The chains that end where they began (a replace chain whose last `new` is its first `old`), and the chains with two entries of one sanction. */
function chainProblems(changes: Change[]): string[] {
  const problems: string[] = [];
  for (const [key, chain] of chainsOf(changes)) {
    const first = chain[0] as Change;
    const last = chain[chain.length - 1] as Change;
    if (last.op === "replace" && isDeepStrictEqual(first.old, last.new)) problems.push(`${last.id}: the chain on ${key} ends at the frozen value`);
    const sanctions = chain.map((change) => change.sanction);
    if (new Set(sanctions).size !== sanctions.length) problems.push(`${key}: more than one entry of one sanction (${chain.map((change) => change.id).join(", ")})`);
  }
  return problems;
}

/**
 * For the last entry of each pointer of a `main` tools-list row, what the snapshot shows at that pointer when it is not the entry's `new`,
 * naming server, tool and the path inside the tool's entry.
 */
function shownProblems(snapshot: Snapshot, golden: WireGolden, changes: Change[]): string[] {
  const problems: string[] = [];
  for (const chain of chainsOf(changes.filter((change) => change.golden === "wire" && change.session === "main" && change.label === "tools-list")).values()) {
    const last = chain[chain.length - 1] as Change;
    const [result, tools, index, ...rest] = last.pointer.slice(1).split("/");
    if (result !== "result" || tools !== "tools" || rest.length === 0) continue;
    const tool = toolsOf(golden, last.server, "main")[Number(index)];
    const inside = `/${rest.join("/")}`;
    const shown = tool === undefined ? undefined : valueAt(snapshot.servers[last.server]?.[tool.name], inside);
    if (tool === undefined || !isDeepStrictEqual(shown, last.new)) problems.push(`${last.server} ${tool?.name ?? `tool ${index}`}${inside}: the snapshot does not show the value of ${last.id}`);
  }
  return problems;
}

const snapshot = readSnapshot(REPO_ROOT) as Snapshot;
const golden = readSanctionedGolden(REPO_ROOT, "wire") as WireGolden;
const changes = readSanctionedChanges(REPO_ROOT) as Change[];

describe("the tools/list snapshot and the sanctioned golden", () => {
  it("every tool of the golden's main session has a snapshot entry that is the sanctioned golden's, field for field", () => {
    expect(parityProblems(snapshot, golden)).toEqual([]);
    const listed = Object.keys(golden.servers).flatMap((pkg) => toolsOf(golden, pkg, "main").map((tool) => `${pkg}/${tool.name}`));
    expect(listed, "the golden lists the 115 tools the snapshot pins").toHaveLength(115);
  });

  it("each dev core-preset tool equals its main entry in the sanctioned golden, the 6 flipped ones included", () => {
    expect(corePresetProblems(golden)).toEqual([]);
    const core = toolsOf(golden, "iris-dev-mcp", "core-preset");
    expect(core).toHaveLength(15);
    const destructive = core.filter((tool) => (tool.annotations as { destructiveHint: boolean }).destructiveHint).map((tool) => tool.name);
    expect(destructive).toEqual(
      expect.arrayContaining(["iris_doc_load", "iris_doc_put", "iris_execute_classmethod", "iris_execute_command", "iris_global_set", "iris_sql_execute"]),
    );
  });

  it("the last entry of each tools-list pointer is the value the snapshot shows there", () => {
    expect(shownProblems(snapshot, golden, changes)).toEqual([]);
  });

  it("every chain of ledger entries ends at a value other than the frozen one, with at most one entry per sanction", () => {
    expect(chainProblems(changes)).toEqual([]);
    const chains = [...chainsOf(changes).values()];
    expect(Math.max(...chains.map((chain) => chain.length)), "a corrected pointer is a chain of two entries").toBe(2);
    expect(chains.filter((chain) => chain.length === 2).map((chain) => chain[1]?.sanction)).toEqual(["S-42.10-resend-text"]);
  });
});

describe("the checks fail on what they guard (they are not vacuous)", () => {
  const cloneSnapshot = (): Snapshot => structuredClone(snapshot);

  it("a moved value without an entry: a snapshot annotation, description or schema that the sanctioned golden does not have", () => {
    const moved = cloneSnapshot();
    (moved.servers["iris-ops-mcp"]!["iris_task_list"]!.annotations as Record<string, unknown>)["destructiveHint"] = true;
    expect(parityProblems(moved, golden)).toEqual(["iris-ops-mcp iris_task_list.annotations: the snapshot is not the sanctioned golden's"]);
    const reworded = cloneSnapshot();
    reworded.servers["iris-interop-mcp"]!["iris_message_resend"]!.description += " ";
    expect(parityProblems(reworded, golden)).toEqual(["iris-interop-mcp iris_message_resend.description: the snapshot is not the sanctioned golden's"]);
    const schema = cloneSnapshot();
    ((schema.servers["iris-interop-mcp"]!["iris_message_resend"]!.inputSchema as { properties: Record<string, { description: string }> }).properties["confirm"] as { description: string }).description = "old text";
    expect(parityProblems(schema, golden)).toEqual(["iris-interop-mcp iris_message_resend.inputSchema: the snapshot is not the sanctioned golden's"]);
  });

  it("a ledger entry the snapshot does not show: the sanctioned golden moves, the snapshot still holds the frozen value", () => {
    const stale = cloneSnapshot();
    (stale.servers["iris-ops-mcp"]!["iris_task_run"]!.annotations as Record<string, unknown>)["destructiveHint"] = false;
    expect(parityProblems(stale, golden)).toEqual(["iris-ops-mcp iris_task_run.annotations: the snapshot is not the sanctioned golden's"]);
    expect(shownProblems(stale, golden, changes)).toEqual([
      "iris-ops-mcp iris_task_run/annotations/destructiveHint: the snapshot does not show the value of 42.10/annotations/iris_task_run@ops-main",
    ]);
    const old = cloneSnapshot();
    const properties = (old.servers["iris-interop-mcp"]!["iris_message_resend"]!.inputSchema as { properties: Record<string, { description: string }> }).properties;
    properties["maxMessages"]!.description = "(resendFiltered) Cap on matched/resent messages (default: 100, HARD CAP: 500). A match count over this cap is refused, not truncated-and-executed.";
    expect(shownProblems(old, golden, changes)).toEqual([
      "iris-interop-mcp iris_message_resend/inputSchema/properties/maxMessages/description: the snapshot does not show the value of 42.10/resend-text/maxMessages@interop-main",
    ]);
  });

  it("a snapshot that lacks a tool the golden lists", () => {
    const missing = cloneSnapshot();
    delete missing.servers["iris-data-mcp"]!["iris_analytics_cubes"];
    expect(parityProblems(missing, golden)).toEqual(["iris-data-mcp iris_analytics_cubes: the snapshot has no entry"]);
  });

  it("a core-preset tool that differs from its main entry", () => {
    const skewed = structuredClone(golden);
    const row = skewed.servers["iris-dev-mcp"]!.sessions["core-preset"]!.rows.find((candidate) => candidate.label === "tools-list")!;
    const message = JSON.parse(row.line) as { result: { tools: GoldenTool[] } };
    (message.result.tools[1]!.annotations as Record<string, unknown>)["destructiveHint"] = false;
    row.line = JSON.stringify(message);
    expect(corePresetProblems(skewed)).toEqual(["iris-dev-mcp core-preset iris_doc_put.annotations: differs from its main entry"]);
  });

  it("a chain that ends where it began, and two entries of one sanction on one pointer", () => {
    const entry = (id: string, sanction: string, before: unknown, after: unknown): Change => ({
      id,
      sanction,
      golden: "wire",
      server: "iris-dev-mcp",
      session: "main",
      label: "tools-list",
      pointer: "/result/tools/1/description",
      op: "replace",
      old: before,
      new: after,
    });
    expect(chainProblems([entry("a", "S-1.1-x", "one", "two"), entry("b", "S-1.2-y", "two", "one")])).toEqual([
      "b: the chain on wire|iris-dev-mcp|main|tools-list|/result/tools/1/description ends at the frozen value",
    ]);
    expect(chainProblems([entry("a", "S-1.1-x", "one", "two"), entry("b", "S-1.1-x", "two", "three")])).toEqual([
      "wire|iris-dev-mcp|main|tools-list|/result/tools/1/description: more than one entry of one sanction (a, b)",
    ]);
    expect(chainProblems([entry("a", "S-1.1-x", "one", "two"), entry("b", "S-1.2-y", "two", "three")])).toEqual([]);
  });
});
