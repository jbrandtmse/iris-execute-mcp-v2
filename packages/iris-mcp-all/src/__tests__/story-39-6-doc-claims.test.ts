/**
 * Story 39.6 -- the documents state the message forensics loop, the two prompts, the PHI data policy configuration and
 * the `tools/list` snapshot, each with its default state at the point of use (project rules #30 and #43), and make no
 * compliance claim (AD-26).
 *
 * The unit and live suites pin the behavior; none reads a document. This file asserts:
 *
 *  - the CHANGELOG's Story 39.6 section: its exact title and four headings, the counts that do not move, the
 *    `trace-message-flow` change, and that it holds no roster-summary string and quotes no other section's title;
 *  - the changeset's exact bump map (AD-29);
 *  - the root README: the Integration engineer row, the Message forensics subsection (each action's key and default
 *    state), the audit paragraph, the prompts heading and rows, and the Backward Compatibility bullet;
 *  - the interop README: the intro, the core paragraph, the `IRIS_DATA_POLICY` row and section, the audit fields, the
 *    `headers` sentence, the Prompts rows and the `DATA_POLICY_BLOCKED` error row;
 *  - `tool_support.md`, the three client guides and the epic history;
 *  - that no new text claims regulatory compliance.
 *
 * Needs no IRIS and no built dist: it reads documents. Cross-package documentation checks live in
 * `@iris-mcp/all` (rule #45).
 */

import { describe, it, expect } from "vitest";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CLAIMS, REDACTED_TEXT_SHOWN } from "./doc-claims-patterns.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// packages/iris-mcp-all/src/__tests__/ -> repo root is 4 levels up.
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..", "..");

function read(relative: string): string {
  return readFileSync(path.join(REPO_ROOT, relative), "utf8");
}

const squash = (text: string): string => text.replace(/\s+/g, " ");

/** The em dash the documents use, by code point. */
const EM_DASH = String.fromCodePoint(0x2014);

/** The first line of `text` that starts with `prefix`, whitespace squashed ("" when there is none). */
function lineStarting(text: string, prefix: string): string {
  return squash(text.split("\n").find((line) => line.startsWith(prefix)) ?? "");
}

/**
 * The slice of `text` from the first match of `startPattern` up to (not including) the next match of `endPattern`
 * after the start line, or to the end of the text. "" when `startPattern` does not match.
 */
function sliceBetween(text: string, startPattern: RegExp, endPattern: RegExp): string {
  const start = text.search(startPattern);
  if (start === -1) return "";
  const lineEnd = text.indexOf("\n", start);
  const bodyStart = lineEnd === -1 ? text.length : lineEnd + 1;
  const end = text.slice(bodyStart).search(endPattern);
  return text.slice(start, end === -1 ? undefined : bodyStart + end);
}

/** The sections of a CHANGELOG, each starting at its `## [` heading. */
function sectionsOf(changelog: string): string[] {
  return changelog.split(/^(?=## \[)/m).slice(1);
}

const rootReadme = read("README.md");
const interopReadme = read("packages/iris-interop-mcp/README.md");
const toolSupport = read("tool_support.md");

const CHANGELOG_TITLE = /^## \[Pre-release \u2014 2026-10-17\] \u2014 Story 39\.6: Message forensics docs, prompt and capstone$/;

describe("Story 39.6: the CHANGELOG section and the changeset", () => {
  const sections = sectionsOf(read("CHANGELOG.md"));
  const section = sections.find((candidate) => CHANGELOG_TITLE.test(candidate.split("\n")[0] ?? "")) ?? "";

  it("the CHANGELOG has the Story 39.6 section above the Story 39.5 one, with Added, Changed, Documentation and Tests headings", () => {
    expect(section, "the CHANGELOG has the Story 39.6 section").not.toBe("");
    expect(section.split("\n").filter((line) => line.startsWith("### "))).toEqual([
      "### Added",
      "### Changed",
      "### Documentation",
      "### Tests",
    ]);
    const index = sections.indexOf(section);
    const previous = sections.findIndex((candidate) => (candidate.split("\n")[0] ?? "").includes("Story 39.5:"));
    expect(previous, "the CHANGELOG still has the Story 39.5 section").toBeGreaterThanOrEqual(0);
    expect(index, "newest section first").toBeLessThan(previous);
  });

  it("states that no tool, count, baseline or bootstrap version moves, and that the prompt pack goes from 12 to 13", () => {
    const text = squash(section);
    expect(text).toContain("No tool, action, governance key, preset row, annotation, schema or environment variable is added");
    expect(text).toContain("the suite stays at 109 package tools (114 advertised)");
    expect(text).toContain("the Interoperability `core` roster stays at 12 runtime tools");
    expect(text).toContain("hash `1e62c5ad5bf7` (141 keys)");
    expect(text).toContain("`BOOTSTRAP_VERSION` stays `2fd17b50a024`");
    expect(text).toContain("The prompt pack goes from 12 to 13 prompts (the Interoperability server from 3 to 4)");
  });

  it("Added names the new prompt with its default state, the 13th skill and the snapshot scripts", () => {
    const text = squash(section);
    expect(text).toContain('**The `find-patient-messages` prompt (title "Find Patient Messages").**');
    expect(text).toContain("`patientId` is required; `from`, `to`, `searchTableClass` (default `EnsLib.HL7.SearchTable`) and `namespace` are optional");
    expect(text).toContain("It calls reads only (both tools are enabled by default)");
    expect(text).toContain("its main path is in the Interoperability `core` preset");
    expect(text).toContain("a withheld body or a refused lookup is reported, never read another way");
    expect(text).toContain("the skills pack is 13 skills");
    expect(text).toContain("`pnpm gen:tools-list-snapshot:check`");
    expect(text).toContain("a committed snapshot of 114 entries over the five servers and writes nothing");
    expect(text).toContain("`pnpm gen:tools-list-snapshot --force`");
    expect(text).toContain("The CLI refuses to run without a flag.");
  });

  it("Changed records the sanctioned trace-message-flow description and body change and its unchanged contract (AD-15)", () => {
    const text = squash(section);
    expect(text).toContain("**`trace-message-flow` searches, reads and diagrams (AD-15).**");
    expect(text).toContain("Its description now names `iris_message_search`, `iris_message_body`, `iris_message_diagram` and `iris_production_logs`");
    expect(text).toContain("Its name, title and arguments (`sessionOrHeaderId` required, `namespace` optional) are unchanged, and a test pins them.");
  });

  it("Documentation lists the default state, the least-exposure description of the capstone and no compliance claim", () => {
    const text = squash(section);
    expect(text).toContain("each a read, enabled by default (and still enabled under the `read-only` preset)");
    expect(text).toContain("the five channels in order, `iris_server_profiles` reporting `dataPolicy` and `dataPolicySource`, tighten-only");
    expect(text).toContain("The documents describe it as least exposure on synthetic messages");
    expect(text).toContain("They make no claim of regulatory compliance.");
  });

  it("Tests names the capstone, the snapshot test, the shared helpers and this file", () => {
    const text = squash(section);
    expect(text).toContain("**A capstone live gate, `epic39-capstone-gate.test.ts`, closes Epic 39.**");
    expect(text).toContain("no body PHI value and no search filter value appears in any result, in the audit file or on stderr");
    expect(text).toContain("**`tools-list-snapshot.test.ts`**");
    expect(text).toContain("**The gates share their helpers (DW-561).**");
    expect(text).toContain("**`story-39-6-doc-claims.test.ts`**");
  });

  it("the section carries no roster-summary string, which docs-visibility-roster-sync reads from the first match in the file", () => {
    expect(section).not.toMatch(/(?:full|core|developer)\s*`?\s*\d+\/\d+\/\d+\/\d+\/\d+/);
  });

  it("the section quotes no other section's title", () => {
    const titles = sections
      .filter((candidate) => candidate !== section)
      .map((candidate) => (candidate.split("\n")[0] ?? "").replace(/^## \[[^\]]*\]\s*\u2014\s*/, ""))
      .filter((title) => title.length > 0);
    expect(titles.length, "the CHANGELOG has other sections").toBeGreaterThan(10);
    for (const title of titles) expect(section.includes(title), `the section quotes "${title}"`).toBe(false);
  });

  // `changeset version` consumes (deletes) the file and moves its text into the generated package
  // changelogs, so the bumps are checked while the file exists.
  const changesetPath = ".changeset/story-39-6-message-forensics-docs-prompt-and-capstone.md";
  const changesetPresent = existsSync(path.join(REPO_ROOT, changesetPath));

  it.skipIf(!changesetPresent)("the changeset bumps exactly interop minor (AD-29) and says what the story adds", () => {
    const changeset = read(changesetPath);
    const frontMatter = /^---\n([\s\S]*?)\n---/.exec(changeset)?.[1] ?? "";
    const bumps = Object.fromEntries(
      frontMatter
        .split("\n")
        .map((line) => /^"([^"]+)":\s*(\w+)$/.exec(line))
        .filter((match): match is RegExpExecArray => match !== null)
        .map((match) => [match[1], match[2]]),
    );
    expect(bumps).toEqual({ "@iris-mcp/interop": "minor" });
    expect(frontMatter.split("\n").filter((line) => line.trim() !== "")).toHaveLength(1);
    const text = squash(changeset);
    expect(text).toContain("`find-patient-messages`");
    expect(text).toContain("No tool, action, governance key or default is added");
    expect(text).toContain("from 12 to 13 prompts");
  });
});

describe("Story 39.6: the root README states the loop, the prompts and the snapshot with their default states", () => {
  it("the Integration engineer row names message search and body reading under the policy, as reads enabled by default", () => {
    const row = lineStarting(rootReadme, "| **Integration engineer** |");
    expect(row, "the role row").not.toBe("");
    expect(row).toContain("search and read messages under the PHI data policy");
    expect(row).toContain("`iris_message_search` and `iris_message_body` are reads, enabled by default");
  });

  const forensics = sliceBetween(rootReadme, /^### Message forensics \(Epic 39\)$/m, /^#{1,3} /m);

  it("has the Message forensics subsection, between the editing section and the worked example", () => {
    expect(forensics, "the root README has the Message forensics subsection").not.toBe("");
    const editing = rootReadme.indexOf("### Agent code editing (Epic 38)");
    const worked = rootReadme.indexOf("### Worked example");
    const start = rootReadme.indexOf("### Message forensics (Epic 39)");
    expect(editing).toBeGreaterThanOrEqual(0);
    expect(start).toBeGreaterThan(editing);
    expect(worked).toBeGreaterThan(start);
  });

  it("states the loop, and that every search and read step is a read enabled by default, including under the read-only preset", () => {
    const text = squash(forensics);
    expect(text).toContain("search the message headers of a window, read the bodies that matter, draw how the messages moved, and, for a failed one, preview a resend");
    expect(text).toContain("Every search and read step below is a read and is **enabled by default**, including under the `read-only` preset.");
  });

  for (const key of [
    "iris_message_search:headers",
    "iris_message_search:body",
    "iris_message_search:searchTable",
    "iris_message_body",
  ]) {
    it(`the ${key} row states its default state: a read, enabled by default`, () => {
      const row = lineStarting(forensics, `| \`${key}\` |`);
      expect(row, `the row of ${key}`).not.toBe("");
      expect(row).toContain("| a read, enabled by default |");
    });
  }

  it("states the effect of the data policy on each row", () => {
    expect(lineStarting(forensics, "| `iris_message_search:headers` |")).toContain("Outside the policy: restrict the key where header rows are not acceptable.");
    expect(lineStarting(forensics, "| `iris_message_search:body` |")).toContain("Refused with `DATA_POLICY_BLOCKED` under `block`; under `redact` and `allow` it runs and returns header rows only.");
    expect(lineStarting(forensics, "| `iris_message_search:searchTable` |")).toContain("| As `body`. |");
    const reader = lineStarting(forensics, "| `iris_message_body` |");
    expect(reader).toContain("`redact` shows an HL7 v2 body redacted by a reviewed keep-list and withholds every other body; `block` withholds every body; `allow` shows each body as stored.");
    expect(reader).toContain("A call's `dataPolicy` can only tighten the profile's policy.");
  });

  it("states the diagram and the resend preview as reads enabled by default, and the resend writes as disabled by default", () => {
    const text = squash(forensics);
    expect(text).toContain("`iris_message_diagram` (a read, enabled by default)");
    expect(text).toContain("the `preview` action of `iris_message_resend` (a read, enabled by default)");
    expect(text).toContain("`resend` and `resendFiltered` stay writes and are disabled by default.");
  });

  it("states the window, the output cap, the paging, notApplicable and that no match is not proof of absence", () => {
    const text = squash(forensics);
    expect(text).toContain("spans at most 7 days; there is no whole-namespace mode");
    expect(text).toContain("`limit` (default 100, at most 500) is an **output cap only**");
    expect(text).toContain("~60 s Web Gateway timeout");
    expect(text).toContain("pass the same `from` and `to` on every page");
    expect(text).toContain("`notApplicable: true` with a `reason`, not an error");
    expect(text).toContain("**No match is not proof of absence.**");
  });

  it("links the policy, names the governance keys with the restricting recipe, and describes the two prompts", () => {
    const text = squash(forensics);
    expect(text).toContain("[PHI data policy](#phi-data-policy)");
    expect(text).toContain('`{"global":{"iris_message_search:body":false,"iris_message_search:searchTable":false}}`');
    expect(text).toContain('`{"global":{"iris_message_body":false}}`');
    expect(text).toContain("Each action is its own governance key, `iris_message_search:<action>`, and `iris_message_body` is one key.");
    expect(text).toContain("`trace-message-flow` searches the headers of a session, reads the bodies that matter, draws the diagram and reads the logs of erroring items.");
    expect(text).toContain("`find-patient-messages` checks the profile's data policy, asks for a window of at most 7 days");
    expect(text).toContain("Both call reads only");
    expect(text).toContain("keep their main path in the interop `core` preset");
    expect(text).toContain("A prompt adds no tool, key or default.");
  });

  it("the audit paragraph names every governed tool and the declared PHI input, and keeps its earlier text", () => {
    const audit = squash(sliceBetween(rootReadme, /^## Compliance & Auditability$/m, /^---$/m));
    expect(audit).toContain("(today `iris_message_body`, the `body` and `searchTable` actions of `iris_message_search`, and the `preview` action of `iris_message_resend`)");
    expect(audit).toContain("(a search value, a body filter value; today the `filters` of `iris_message_search`)");
    expect(audit).not.toContain("(today the `preview` action of `iris_message_resend`)");
    expect(audit).toContain('{"policy":"redact","redacted":4,"blocked":3}');
    expect(audit).toContain("The declaration decides, never the parameter's name.");
  });

  it("the prompts heading counts 13 prompts, and the table has the updated trace row and the new find row", () => {
    expect(rootReadme).toMatch(/^### The v1 pack . 13 prompts, grouped by owning server$/m);
    const trace = lineStarting(rootReadme, "| `@iris-mcp/interop` | `trace-message-flow` |");
    expect(trace, "the trace-message-flow row").not.toBe("");
    for (const tool of ["`iris_production_messages`", "`iris_message_search`", "`iris_message_body`", "`iris_message_diagram`", "`iris_production_logs`"]) {
      expect(trace, tool).toContain(tool);
    }
    expect(trace).toContain("Its name, title and arguments are unchanged.");
    expect(trace).toContain("Every tool it calls is in the interop `core` preset, and each is a read that is enabled by default.");
    expect(trace).toContain("a withheld body's reason is reported, never read another way");
    const find = lineStarting(rootReadme, "| `@iris-mcp/interop` | `find-patient-messages` |");
    expect(find, "the find-patient-messages row").not.toBe("");
    expect(find).toContain("`patientId` required; `from`, `to`, `searchTableClass` and `namespace` optional");
    expect(find).toContain("Its main path is in the interop `core` preset.");
    expect(find).toContain("It reads only: `iris_message_search:searchTable` and `iris_message_body` are reads, enabled by default.");
    expect(find).toContain("the prompt never loosens the policy and never reads a body another way");
  });

  it("the Backward Compatibility list describes the tools/list snapshot and how a sanctioned change is regenerated", () => {
    const section = squash(sliceBetween(rootReadme, /^### Backward Compatibility$/m, /^---$/m));
    expect(section).toContain("**The `tools/list` snapshot (Story 39.6).**");
    expect(section).toContain("pins the title, description, input schema and annotations of every listed tool on all five servers");
    expect(section).toContain("`pnpm gen:tools-list-snapshot:check` compares the built servers against it and writes nothing.");
    expect(section).toContain("`pnpm gen:tools-list-snapshot --force`");
    expect(section).toContain("a new tool is reported by the check and needs no regenerate");
    expect(section).toContain("The snapshot adds no tool, key or default.");
  });
});

describe("Story 39.6: the interop README states the policy configuration, the audit fields and the prompts", () => {
  it("the intro and the core paragraph name message forensics and the new prompt", () => {
    const intro = squash(interopReadme.split("\n")[2] ?? "");
    expect(intro).toContain("message forensics (searching message headers and bodies and reading message bodies under the PHI data policy, all reads that are enabled by default)");
    const text = squash(interopReadme);
    expect(text).toContain("`trace-message-flow` and `find-patient-messages` (Story 39.6; it searches for a patient's messages and reads their bodies)");
  });

  it(`the IRIS_DATA_POLICY row gives the default, the values, the effect on this server's tools and their default state`, () => {
    const row = lineStarting(interopReadme, "| `IRIS_DATA_POLICY` |");
    expect(row, "the env-table row").not.toBe("");
    expect(row).toContain(`*(unset ${EM_DASH} \`redact\`)*`);
    expect(row).toContain("`block`, `redact` or `allow` (case-insensitive)");
    expect(row).toContain("Default **`redact`**");
    expect(row).toContain("`iris_message_body` shows an HL7 v2 body redacted by a reviewed keep-list and withholds every other body");
    expect(row).toContain("the `body` and `searchTable` actions of `iris_message_search` run and return header rows only");
    expect(row).toContain("`block` withholds every body and refuses the `body` and `searchTable` actions");
    expect(row).toContain("Every one of these is a read, enabled by default.");
    expect(row).toContain("[PHI data policy](#phi-data-policy-iris_data_policy)");
  });

  const policy = squash(sliceBetween(interopReadme, /^### PHI data policy \(`IRIS_DATA_POLICY`\)$/m, /^#{1,3} /m));

  it("has the PHI data policy section: the five channels in order, the reporting, tighten-only and the exposure sentence", () => {
    expect(policy, "the interop README has the PHI data policy section").not.toBe("");
    expect(policy).toContain(
      "1. the `dataPolicy` field of the profile's `IRIS_PROFILES` entry; 2. the `IRIS_DATA_POLICY` environment variable; 3. the governance file's `dataPolicy.profiles.<name>` (`IRIS_GOVERNANCE_FILE`); 4. the governance file's `dataPolicy.global`; 5. `redact`.",
    );
    expect(policy).toContain("`redact` (the **default**)");
    expect(policy).toContain("every one of them is a read, **enabled by default**");
    expect(policy).toContain("adds no action and no governance key");
    expect(policy).toContain("The `headers` action of `iris_message_search` is outside the policy.");
    expect(policy).toContain("`iris_server_profiles` reports each profile's `dataPolicy` and `dataPolicySource` (`IRIS_PROFILES`, `IRIS_DATA_POLICY`, `IRIS_GOVERNANCE_FILE:profiles`, `IRIS_GOVERNANCE_FILE:global` or `default`)");
    expect(policy).toContain("A call can only tighten the policy, never loosen it");
    expect(policy).toContain("`dataPolicyClamped: true`");
    expect(policy).toContain("The data policy reduces exposure of message-body data; it is not a compliance certification.");
  });

  it("the section sits after Audit Logging and before Server Manager connections", () => {
    const audit = interopReadme.indexOf("### Audit Logging (`IRIS_AUDIT_LOG`)");
    const section = interopReadme.indexOf("### PHI data policy (`IRIS_DATA_POLICY`)");
    const manager = interopReadme.indexOf("### Server Manager connections (`IRIS_SERVER_MANAGER`)");
    expect(audit).toBeGreaterThanOrEqual(0);
    expect(section).toBeGreaterThan(audit);
    expect(manager).toBeGreaterThan(section);
  });

  it("Audit Logging states the dataPolicy field and the redaction of the PHI inputs", () => {
    const audit = squash(sliceBetween(interopReadme, /^### Audit Logging \(`IRIS_AUDIT_LOG`\)$/m, /^### PHI data policy/m));
    expect(audit).toContain("(`iris_message_body`, the `body` and `searchTable` actions of `iris_message_search`, and the `preview` action of `iris_message_resend`) also records `dataPolicy` (`{policy, redacted, blocked}`");
    expect(audit).toContain('(the `filters` of `iris_message_search`) are written as `"[REDACTED]"` under `redact` and `block`, and are logged only under `allow`');
    expect(audit).toContain("Message-body content never reaches the audit file or the console log, under any policy.");
  });

  it("the iris_message_search subsection says the headers action is outside the policy, and adds no heading", () => {
    const subsection = sliceBetween(interopReadme, /^#### `iris_message_search`/m, /^#### /m);
    const text = squash(subsection);
    expect(text).toContain("The `headers` action is outside the policy: it returns no Search Table or body value, with one exception, a header with no body class, whose body ID is the literal body.");
    expect(text).toContain("restrict `iris_message_search:headers` with its governance key (a read, enabled by default)");
    // The subsection ends at the next `####` heading, which must be the next tool's: no heading was added inside it.
    const after = interopReadme.slice(interopReadme.indexOf(subsection) + subsection.length);
    expect(after.startsWith("#### `iris_message_body`")).toBe(true);
    const bodyAfter = sliceBetween(interopReadme, /^#### `iris_message_body`/m, /^#### /m);
    expect(interopReadme.slice(interopReadme.indexOf(bodyAfter) + bodyAfter.length).startsWith("#### `iris_message_resend`")).toBe(true);
  });

  it("the Prompts table has the updated trace-message-flow row and the new find-patient-messages row", () => {
    const trace = lineStarting(interopReadme, "| `trace-message-flow` |");
    expect(trace, "the trace-message-flow row").not.toBe("");
    for (const tool of ["`iris_production_messages`", "`iris_message_search`", "`iris_message_body`", "`iris_message_diagram`", "`iris_production_logs`"]) {
      expect(trace, tool).toContain(tool);
    }
    expect(trace).toContain("Its name, title and arguments are unchanged (`sessionOrHeaderId` required, `namespace` optional).");
    expect(trace).toContain("Every tool it calls is in the `core` preset, and each is a read that is enabled by default.");
    const find = lineStarting(interopReadme, "| `find-patient-messages` |");
    expect(find, "the find-patient-messages row").not.toBe("");
    expect(find).toContain("(`patientId` required; `from`, `to`, `searchTableClass` and `namespace` optional)");
    expect(find).toContain("Its main path is in the `core` preset.");
    expect(find).toContain("It reads only: `iris_message_search:searchTable` and `iris_message_body` are reads, enabled by default.");
    expect(find).toContain("the prompt never loosens the policy and never reads a body another way");
  });

  it("Common Errors has a DATA_POLICY_BLOCKED row that names the actions, their default state and the resolution", () => {
    const row = lineStarting(interopReadme, "| `DATA_POLICY_BLOCKED` |");
    expect(row, "the error row").not.toBe("");
    expect(row).toContain("The `body` or `searchTable` action of `iris_message_search` (both reads, enabled by default) was called under the `block` data policy");
    expect(row).toContain("No IRIS call was made and nothing changed.");
    expect(row).toContain("`iris_message_body` is not refused under `block`: it withholds every body with a reason");
    expect(row).toContain("Use the `headers` action, or ask the operator for a looser `IRIS_DATA_POLICY` for the profile.");
  });

  /** The `<details>` block of the Tool Examples whose summary starts with `summaryStart`. */
  const example = (summaryStart: string): string => sliceBetween(interopReadme, new RegExp(`^<summary><strong>${summaryStart}`, "m"), /^<\/details>/m);

  it("Tool Examples has a searchTable lookup example with its default state, its window and the output captured on the fixture", () => {
    const block = example("iris_message_search</strong> -- Find a patient's messages");
    expect(block, "the searchTable example").not.toBe("");
    const text = squash(block);
    expect(text).toContain("It is a read, enabled by default, and under the PHI data policy: the default `redact` runs it and `block` refuses it with `DATA_POLICY_BLOCKED`.");
    expect(text).toContain("`from` is required and the window spans at most 7 days.");
    expect(text).toContain("The result holds header rows only, with no Search Table value and no body text.");
    expect(text).toContain("captured from the built server on a synthetic fixture namespace under the default `redact` policy");
    expect(text).toContain('"filters": [{ "property": "PatientID", "op": "eq", "value": "SYNTHPHI396-MRN-P" }]');
    expect(text).toContain('"dataPolicy": { "policy": "redact", "redacted": 0, "blocked": 0 }');
    expect(text).toContain('"sourceItem": "Story396.Router", "targetItem": "Story396.Operation"');
    expect(block, "the output holds no Search Table or body value").not.toContain("KEEPME396");
  });

  it("Tool Examples has a body read example under redact: the kept code, the replaced values and the counts", () => {
    const block = example("iris_message_body</strong> -- Read message bodies under the redact policy");
    expect(block, "the body read example").not.toBe("");
    const text = squash(block);
    expect(text).toContain("It is a read, enabled by default, and under the PHI data policy.");
    expect(text).toContain("Every other kind of body is withheld with a reason in `notShown`");
    expect(text).toContain('"bodyPolicy": { "outcome": "redacted", "redactedFields": 6 }');
    expect(text).toContain("MSH|^~\\\\&|***|***|||***||ADT^A01|***|P|2.5.1\\nPID|1||***\\nOBX|1|TX|KEEPME396-CODE^KEEPME396-TEXT^L||***\\n");
    expect(text).toContain('"dataPolicy": { "policy": "redact", "redacted": 3, "blocked": 0 }');
    expect(block, "the redacted example shows no identifying value").not.toContain("SYNTHPHI");
  });
});

describe("Story 39.6: tool_support.md, the client guides and the epic history", () => {
  const note = squash(toolSupport.split("\n").find((line) => line.startsWith("> **Story 39.6")) ?? "");

  it("has the Story 39.6 note: no tool, key or count change, the default states, the prompts, the snapshot and the capstone", () => {
    expect(note, "tool_support.md has the Story 39.6 note").not.toBe("");
    expect(note).toContain("no tool, action or governance key is added, so no default state and no tool count moves");
    expect(note).toContain("(109 package tools, 114 advertised;");
    expect(note).toContain("its `core` roster at 12 runtime tools");
    expect(note).toContain("`BOOTSTRAP_VERSION` stays `2fd17b50a024`");
    expect(note).toContain("are **reads, enabled by default** (and still enabled under the `read-only` preset)");
    expect(note).toContain("`resend` and `resendFiltered` stay writes, disabled by default");
    expect(note).toContain("The pack of MCP prompts goes from 12 to 13");
    expect(note).toContain("with its name, title and arguments unchanged");
    expect(note).toContain("neither loosens the PHI data policy or reads a withheld body another way");
    expect(note).toContain("`pnpm gen:tools-list-snapshot:check` compares and writes nothing");
    expect(note).toContain("`pnpm gen:tools-list-snapshot --force`");
    expect(note).toContain("`epic39-capstone-gate.test.ts`");
    expect(note).toContain("it shows least exposure and is not a compliance claim");
  });

  it("the note is placed after the Story 39.5 note", () => {
    const earlier = toolSupport.indexOf("> **Story 39.5");
    const later = toolSupport.indexOf("> **Story 39.6");
    expect(earlier).toBeGreaterThanOrEqual(0);
    expect(later).toBeGreaterThan(earlier);
  });

  it("the prompt-pack line counts 13 prompts and names the new prompt, and no earlier text carries a per-server prompt tally", () => {
    const flat = squash(toolSupport);
    expect(flat).toContain("a pack of 13 **MCP prompts** (`ops` 2, `dev` 5, `interop` 4, `admin` 2; `data` none in v1)");
    expect(flat).toContain("`interop` gained `find-patient-messages` in Story 39.6");
    expect(flat).toContain("calls reads only, and adds no tool, key or default");
    // docs-prompt-sync reads the first `interop` N: the pack line must be that match.
    const pack = toolSupport.indexOf("a pack of 13 **MCP prompts**");
    const firstTally = toolSupport.search(/`interop`\s+\d/);
    expect(pack).toBeGreaterThanOrEqual(0);
    expect(firstTally, "the first `interop` N tally is the prompt-pack line's").toBeGreaterThan(pack);
  });

  for (const guide of ["claude-code", "claude-desktop", "cursor"]) {
    it(`the ${guide} guide's IRIS_DATA_POLICY row also covers iris_message_body and the block refusal`, () => {
      const row = lineStarting(read(`docs/client-config/${guide}.md`), "| `IRIS_DATA_POLICY` |");
      expect(row, `${guide} has the row`).not.toBe("");
      expect(row).toContain("Unset means `redact`");
      expect(row).toContain("`iris_message_body` (a read, enabled by default) shows an HL7 v2 body redacted by a reviewed keep-list and withholds every other body");
      expect(row).toContain("`allow` restores the previous preview and lets `iris_message_body` show bodies as stored");
      expect(row).toContain("`block` withholds every body and refuses the `body` and `searchTable` actions of `iris_message_search` (reads, enabled by default) with `DATA_POLICY_BLOCKED`");
    });
  }

  it("the epic history no longer says Epic 39 has added two so far", () => {
    const summary = squash(read("docs/epic-summary.md"));
    expect(summary).toContain("Epic 39 added two, `iris_message_search`");
    expect(summary).not.toContain("so far");
  });
});

describe("Story 39.6: no new document text claims regulatory compliance or says a preview shows redacted HL7 text", () => {
  const sections = sectionsOf(read("CHANGELOG.md"));
  const section = sections.find((candidate) => CHANGELOG_TITLE.test(candidate.split("\n")[0] ?? "")) ?? "";
  const changesetPath = ".changeset/story-39-6-message-forensics-docs-prompt-and-capstone.md";

  const documents: Array<[string, string]> = [
    ["README.md", rootReadme],
    ["tool_support.md", toolSupport],
    ["CHANGELOG.md (Story 39.6)", section],
    ["docs/epic-summary.md", read("docs/epic-summary.md")],
    ...["claude-code", "claude-desktop", "cursor"].map((guide): [string, string] => [`docs/client-config/${guide}.md`, read(`docs/client-config/${guide}.md`)]),
    ...readdirSync(path.join(REPO_ROOT, "packages"))
      .filter((dir) => existsSync(path.join(REPO_ROOT, "packages", dir, "README.md")))
      .map((dir): [string, string] => [`packages/${dir}/README.md`, read(`packages/${dir}/README.md`)]),
    ...["skills/README.md", "skills/find-patient-messages/SKILL.md", "skills/trace-message-flow/SKILL.md"]
      .filter((relative) => existsSync(path.join(REPO_ROOT, relative)))
      .map((relative): [string, string] => [relative, read(relative)]),
    ...(existsSync(path.join(REPO_ROOT, changesetPath)) ? [["the changeset", read(changesetPath)] as [string, string]] : []),
  ];

  for (const [name, text] of documents) {
    it(`${name} makes no compliance claim`, () => {
      for (const claim of CLAIMS) expect(text.match(claim)?.[0], `${name} matches ${String(claim)}`).toBeUndefined();
    });

    it(`${name} does not say a preview or reader shows redacted HL7 text`, () => {
      for (const pattern of REDACTED_TEXT_SHOWN) expect(text.match(pattern)?.[0], `${name} matches ${String(pattern)}`).toBeUndefined();
    });
  }

  it("the scan reads the documents (an empty list would pass everything above)", () => {
    expect(documents.length).toBeGreaterThanOrEqual(12);
    for (const [name, text] of documents) expect(text.length, name).toBeGreaterThan(0);
  });
});
