/**
 * Story 42.10 (DW-560, DW-662, DW-654; project rules #30 and #43) - the documents say what the pre-1.0 corrections did.
 *
 * The unit suites pin behavior and `story-43-4-sanctioned-golden-changes.test.ts` pins the ledger; none of them reads a document. This
 * file reads them, one claim each:
 *  - the README Annotations cell of each of the 13 flipped tools names `destructive`;
 *  - the interop README bullet and the built `iris_message_resend` tool carry the corrected dry-run and cap wording, and neither keeps the
 *    clause "otherwise the call is refused";
 *  - the root README says what the audit `namespace` and `targetNamespace` are, and scopes its Story 43.4 sentence about descriptions;
 *  - the CHANGELOG entry of Story 42.10 names the three sanction ids, the 13 tools and `targetNamespace`, and the facts that bound the story;
 *  - `tool_support.md` has the Story 42.10 note, the CHANGELOG and that note state the numbers of SYS-scoped tools and of justified
 *    non-destructive writes that the built catalog declares, `docs/tool-annotation-audit.md` is marked historical, and the changeset is a
 *    patch for the five packages the story changes.
 * Needs no IRIS. The built dists are read for the resend text and the SYS-scoped tool count; a stale dist fails the gate tests that own it.
 */

import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { REPO_ROOT } from "./pack-fixture";
import { loadAllTools } from "../../../../scripts/lib/tool-catalog.mjs";

const read = (relative: string): string => readFileSync(path.join(REPO_ROOT, relative), "utf8");
const squash = (text: string): string => text.replace(/\s+/g, " ");

const EM_DASH = String.fromCharCode(0x2014);

/** The 13 tools of wave-8 decision #39, by the README of the package that documents them. Written from the spec. */
const FLIPPED_BY_README: Record<string, string[]> = {
  "packages/iris-dev-mcp/README.md": [
    "iris_doc_put",
    "iris_doc_load",
    "iris_doc_export",
    "iris_sql_execute",
    "iris_global_set",
    "iris_execute_command",
    "iris_execute_classmethod",
    "iris_env_promote",
  ],
  "packages/iris-admin-mcp/README.md": ["iris_service_manage", "iris_ldap_manage", "iris_x509_manage"],
  "packages/iris-interop-mcp/README.md": ["iris_production_item"],
  "packages/iris-ops-mcp/README.md": ["iris_task_run"],
};
const FLIPPED = Object.values(FLIPPED_BY_README).flat();

/** The last cell of every markdown table row of `readme` that starts with the tool's name in backticks. */
function annotationCells(readme: string, tool: string): string[] {
  return readme
    .split("\n")
    .filter((line) => line.startsWith(`| \`${tool}\` |`))
    .map((line) => /\|\s*([^|]*?)\s*\|\s*$/.exec(line)?.[1] ?? "");
}

describe("Story 42.10: the README Annotations cells", () => {
  it("name `destructive` for each of the 13 flipped tools", () => {
    expect(FLIPPED).toHaveLength(13);
    for (const [file, tools] of Object.entries(FLIPPED_BY_README)) {
      const readme = read(file);
      for (const tool of tools) {
        const cells = annotationCells(readme, tool);
        expect(cells.length, `${file}: a table row for ${tool}`).toBeGreaterThan(0);
        for (const cell of cells) expect(cell, `${file}: the Annotations cell of ${tool}`).toContain("destructive");
      }
    }
  });

  it("keep `idempotent` where the tool is idempotent, and name nothing else", () => {
    const dev = read("packages/iris-dev-mcp/README.md");
    for (const tool of ["iris_doc_put", "iris_doc_load", "iris_doc_export", "iris_global_set"]) {
      expect(annotationCells(dev, tool), tool).toEqual(["destructive, idempotent"]);
    }
    for (const tool of ["iris_sql_execute", "iris_execute_command", "iris_execute_classmethod", "iris_env_promote"]) {
      expect(annotationCells(dev, tool), tool).toEqual(["destructive"]);
    }
  });
});

describe("Story 42.10: the corrected resend wording (DW-662)", () => {
  const BULLET =
    "executing requires **both** `dryRun:false` AND `confirm:true` " +
    `${EM_DASH} ` +
    "`dryRun:false` without `confirm:true` is refused with no changes made, and leaving `dryRun` out previews again. `maxMessages` caps the batch (default 100, hard cap 500) " +
    `${EM_DASH} ` +
    "an executing call whose match count is over the cap is refused (not truncated-and-executed), while a preview reports the full count.";
  const PASSAGE =
    "executing requires BOTH dryRun:false AND confirm:true: dryRun:false without confirm:true is refused with no changes made, and leaving dryRun out previews again. maxMessages caps the batch (default 100, HARD CAP 500) " +
    `${EM_DASH} ` +
    "an executing call whose match count is over the cap is refused (not truncated-and-executed), while a preview reports the full count; narrow the window or item filter and retry.";
  const MAX_MESSAGES =
    "(resendFiltered) Cap on matched/resent messages (default: 100, HARD CAP: 500). An executing call whose match count is over this cap is refused, not truncated-and-executed; a preview reports the full count.";
  const CONFIRM =
    "(resendFiltered) Must be true together with dryRun:false to execute the resend; dryRun:false without confirm:true is refused with no changes made. Ignored while dryRun is true or omitted (the call previews).";

  it("the interop README bullet says that dryRun:false without confirm:true is refused, that omitting dryRun previews, and that an over-cap count is refused only when executing", () => {
    const readme = squash(read("packages/iris-interop-mcp/README.md"));
    expect(readme).toContain(BULLET);
    expect(readme).not.toContain("otherwise the call is refused with no changes made");
    expect(readme).not.toContain("a match count over the cap is refused (not truncated-and-executed).");
  });

  it("the built iris_message_resend tool says the same in its description, its maxMessages text and its confirm text", async () => {
    const all = (await loadAllTools(REPO_ROOT)) as Array<{
      pkg: string;
      tool: { name: string; description: string; inputSchema: { shape: Record<string, { description?: string }> } };
    }>;
    const resend = all.find(({ tool }) => tool.name === "iris_message_resend")?.tool;
    expect(resend, "the interop package lists iris_message_resend").toBeDefined();
    expect(resend!.description).toContain(PASSAGE);
    expect(resend!.description).not.toContain("otherwise the call is refused");
    expect(resend!.description).not.toContain("a match count over the cap is refused");
    expect(resend!.inputSchema.shape["maxMessages"]?.description).toBe(MAX_MESSAGES);
    expect(resend!.inputSchema.shape["confirm"]?.description).toBe(CONFIRM);
    expect(resend!.inputSchema.shape["dryRun"]?.description, "dryRun's text was already accurate").toBe(
      "(resendFiltered) Default true: return count + a first-20 sample and resend NOTHING. Must be explicitly false (with confirm:true) to execute.",
    );
    expect(resend!.description, "the Story 43.4 dialog passage is unchanged").toContain(
      "HUMAN CONFIRMATION: when the MCP client supports form elicitation, 'resend' and an executing 'resendFiltered' (when its read-only preview matches 1 to maxMessages messages) also ask the person in a confirmation dialog",
    );
  });
});

describe("Story 42.10: the root README", () => {
  const rootReadme = read("README.md");

  it("says what the audit namespace and targetNamespace are", () => {
    expect(squash(rootReadme)).toContain(
      "`namespace` is `%SYS` for a `SYS`-scoped tool, which always runs there (the `SYS`-scoped tools of `@iris-mcp/admin`, whatever their `namespace` argument says). When such a call has a non-empty `namespace` argument, the entry also carries `targetNamespace` with that argument, for example the namespace whose mappings `iris_mapping_manage` changes: on every outcome, a refused call included, and whatever `IRIS_AUDIT_LOG_PARAMS` says. A call without one has no `targetNamespace`, and no other tool's entry carries it. For every other tool `namespace` is the call's `namespace` argument or, when it has none, the profile's default namespace; that value names the call's target and does not say where the call ran (an `@iris-mcp/ops` tool records its `namespace` argument when a call gives one, else the profile's default, as in the entry above) (Story 42.10).",
    );
    expect(squash(rootReadme)).not.toContain("is the namespace the call ran in");
    expect(squash(rootReadme), "the ops tools record a namespace argument they are given").not.toContain("have no namespace concept and record the profile's default");
  });

  it("scopes the Story 43.4 sentence about descriptions to that story, and names the later correction", () => {
    expect(squash(rootReadme)).toContain(
      "Story 43.4 changed no other byte of any description; Story 42.10 later corrected the dry-run and cap wording of `iris_message_resend` (see the CHANGELOG).",
    );
    expect(rootReadme).not.toContain("No other byte of any description changed.");
  });
});

describe("Story 42.10: the CHANGELOG entry", () => {
  const changelog = read("CHANGELOG.md");
  const heading = /^## \[Pre-release [^\]]*\] \S Story 42\.10: Pre-1\.0 Tool-Surface Corrections$/m.exec(changelog);
  const start = heading?.index ?? -1;
  const next = changelog.indexOf("\n## ", start + 1);
  const entry = start < 0 ? "" : changelog.slice(start, next === -1 ? undefined : next);
  const sanctioned = (/^### Changed \(AD-15 sanctioned\)$[\s\S]*?(?=^### |(?![\s\S]))/m.exec(entry)?.[0] ?? "").replace(/\s+/g, " ");

  it("has a section for Story 42.10", () => {
    expect(heading, "a heading for Story 42.10").not.toBeNull();
    expect(entry.length).toBeGreaterThan(500);
  });

  it("names the three sanction ids, in backticks, under the sanctioned heading", () => {
    expect(sanctioned, "the sanctioned heading").not.toBe("");
    for (const id of ["S-42.10-annotations", "S-42.10-resend-text", "S-42.10-audit-namespace"]) expect(sanctioned, id).toContain(`\`${id}\``);
  });

  it("names the 13 flipped tools, in backticks, under the sanctioned heading", () => {
    expect(FLIPPED).toHaveLength(13);
    for (const tool of FLIPPED) expect(sanctioned, tool).toContain(`\`${tool}\``);
  });

  it("names the additive targetNamespace field under the sanctioned heading (DW-667)", () => {
    expect(sanctioned).toContain("When the call has a non-empty `namespace` argument, the new additive field `targetNamespace` records it");
  });

  it("states what bounds the story: the snapshot was regenerated, the goldens are byte-unchanged with 23 new entries, the baseline stays, DW-652 is Story 42.11", () => {
    const text = squash(entry);
    expect(text).toContain("The tools-list snapshot was regenerated through its generator");
    expect(text).toContain("are byte-unchanged (their SHA-256 pins stay); the corrections are 23 new entries");
    expect(text).toContain("the frozen governance baseline stays at hash `1e62c5ad5bf7` (141 keys)");
    expect(text).toContain("DW-652 (the Storage guard on three more document-write paths) is not in this story: it moved to Story 42.11.");
    expect(text).toContain("49 of the 110 package tools are now destructive (36 before)");
  });
});

describe("Story 42.10: tool_support.md, the annotation audit and the changeset", () => {
  it("tool_support.md has the Story 42.10 note: no tool count moves, 13 hints, the resend text and the SYS audit namespace", () => {
    const note = squash(read("tool_support.md"));
    expect(note).toContain(`**Story 42.10 (2026-10-21) ${EM_DASH} governance defaults, the pre-1.0 tool-surface corrections:**`);
    expect(note).toContain("no tool, action or governance key is added, so no default state and no tool count moves (110 package tools, 115 advertised;");
    expect(note).toContain("13 existing tools now declare `destructiveHint: true`");
    expect(note).toContain("the audit entry of a `SYS`-scoped tool (the 25 SYS-scoped tools of `@iris-mcp/admin`) records `namespace: \"%SYS\"`");
    expect(note).toContain("the additive `targetNamespace` field records it whatever `IRIS_AUDIT_LOG_PARAMS` says");
    expect(note, "the resend texts do not say only").not.toContain("now say that only `dryRun: false`");
  });

  it("the number of justified non-destructive writes that the CHANGELOG and tool_support.md state is the number of built tools that are not read-only and declare destructiveHint:false (Rule #51)", async () => {
    const all = (await loadAllTools(REPO_ROOT)) as Array<{ tool: { annotations?: Record<string, unknown> } }>;
    const count = all.filter(({ tool }) => tool.annotations?.readOnlyHint === false && tool.annotations?.destructiveHint === false).length;
    const NUMBER_WORDS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];
    expect(count, "the sweep sees the justified writes").toBeGreaterThan(0);
    const stated = `must be on a justified list (${NUMBER_WORDS[count] ?? String(count)} tools today)`;
    const changelog = read("CHANGELOG.md");
    const from = changelog.indexOf("Story 42.10: Pre-1.0 Tool-Surface Corrections");
    expect(squash(changelog.slice(from, changelog.indexOf("\n## ", from))), "the CHANGELOG entry of Story 42.10").toContain(stated);
    expect(squash(read("tool_support.md")), "the tool_support.md note").toContain(stated);
  });

  it("the number of SYS-scoped tools that the CHANGELOG and tool_support.md state is the number the built catalog declares, all in @iris-mcp/admin (Rule #51)", async () => {
    const all = (await loadAllTools(REPO_ROOT)) as Array<{ pkg: string; tool: { name: string; scope?: string } }>;
    const sysScoped = all.filter(({ tool }) => tool.scope === "SYS");
    expect(sysScoped.length, "the sweep sees the SYS-scoped tools of the catalog").toBeGreaterThan(0);
    expect([...new Set(sysScoped.map(({ pkg }) => pkg))], "every SYS-scoped tool is a tool of @iris-mcp/admin").toEqual(["iris-admin-mcp"]);
    const stated = `the ${sysScoped.length} SYS-scoped tools of \`@iris-mcp/admin\``;
    const changelog = read("CHANGELOG.md");
    const from = changelog.indexOf("Story 42.10: Pre-1.0 Tool-Surface Corrections");
    expect(from, "the CHANGELOG has the Story 42.10 entry").toBeGreaterThanOrEqual(0);
    const entry = squash(changelog.slice(from, changelog.indexOf("\n## ", from)));
    expect(entry, "the CHANGELOG entry of Story 42.10").toContain(`(${stated})`);
    expect(squash(read("tool_support.md")), "the tool_support.md note").toContain(`(${stated})`);
  });

  it("docs/tool-annotation-audit.md says it is a historical document of 2026-04-07 and where the current hints live", () => {
    const audit = squash(read("docs/tool-annotation-audit.md"));
    expect(audit).toContain("> **Historical document.** This is the audit of 2026-04-07.");
    expect(audit).toContain("The current hints live in each tool's source and in the committed `tools/list` snapshot");
  });

  // `changeset version` consumes (deletes) the file, so the bump map is read and checked while it exists.
  const changesetFile = ".changeset/story-42-10-pre-1-0-tool-surface-corrections.md";
  const changesetPresent = existsSync(path.join(REPO_ROOT, changesetFile));

  it.skipIf(!changesetPresent)("the changeset is a patch for @iris-mcp/shared, dev, admin, interop and ops, and nothing else", () => {
    const frontmatter = /^---\n([\s\S]*?)\n---/.exec(read(changesetFile))?.[1] ?? "";
    const bumps = frontmatter.split("\n").map((line) => line.trim());
    expect(bumps).toEqual([
      '"@iris-mcp/shared": patch',
      '"@iris-mcp/dev": patch',
      '"@iris-mcp/admin": patch',
      '"@iris-mcp/interop": patch',
      '"@iris-mcp/ops": patch',
    ]);
  });
});
