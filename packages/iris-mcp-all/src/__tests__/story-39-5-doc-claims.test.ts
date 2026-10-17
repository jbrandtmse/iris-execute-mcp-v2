/**
 * Story 39.5 -- the documents state the `iris_message_body` tool, its default state and its data-policy behavior
 * (project rules #30 and #43), the new counts, and make no compliance claim (AD-26).
 *
 * The unit and live suites pin the behavior; none reads a document. This file asserts:
 *
 *  - the CHANGELOG's Story 39.5 section: its title and headings, the new counts and the unchanged baseline, the tool's
 *    default state, the data-policy behavior, DW-577, the `BOOTSTRAP_VERSION` move this story made (pinned as history),
 *    and that it holds no roster-summary string (the roster guard reads the first match in the file);
 *  - the changeset's exact bump map (AD-29);
 *  - the root README's `IRIS_DATA_POLICY` row, governance-defaults row, interop row and policy section;
 *  - the interop README's `iris_message_body` subsection and tool-table row;
 *  - `tool_support.md`: the Story 39.5 note, the API row and the scope row;
 *  - that no document claims regulatory compliance.
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

/** The sections of a CHANGELOG, each starting at its `## [` heading. */
function sectionsOf(changelog: string): string[] {
  return changelog.split(/^(?=## \[)/m).slice(1);
}

/** The `BOOTSTRAP_VERSION` move this story recorded, pinned as history. */
const PREVIOUS_BOOTSTRAP_VERSION = "b6ec56073e29";
const STORY_BOOTSTRAP_VERSION = "fa8227a48af8";

/** The right arrow the documents use, by code point. */
const RIGHT_ARROW = String.fromCodePoint(0x2192);

describe("Story 39.5: the CHANGELOG section and the changeset", () => {
  const section =
    sectionsOf(read("CHANGELOG.md")).find((candidate) =>
      /^## \[Pre-release \u2014 2026-10-17\] \u2014 Story 39\.5: Message body reader$/.test(candidate.split("\n")[0] ?? ""),
    ) ?? "";

  it("the CHANGELOG has the Story 39.5 section at the top, with Added, Changed and Tests headings", () => {
    expect(section, "the CHANGELOG has the Story 39.5 section").not.toBe("");
    expect(section.split("\n").filter((line) => line.startsWith("### "))).toEqual(["### Added", "### Changed", "### Tests"]);
    expect(sectionsOf(read("CHANGELOG.md"))[0], "the Story 39.5 section is the first").toBe(section);
  });

  it("states the new counts and that the baseline stays", () => {
    const text = squash(section);
    expect(text).toContain("the suite goes from 108 to 109 package tools (113 to 114 advertised)");
    expect(text).toContain("the Interoperability server from 23 to 24 package tools (24 to 25 advertised)");
    expect(text).toContain("its `core` roster from 11 to 12 runtime tools");
    expect(text).toContain("`1e62c5ad5bf7`");
    expect(text).toContain("(141 keys)");
  });

  it("names the tool, its default state and the read-only preset", () => {
    const text = squash(section);
    expect(text).toContain("**`iris_message_body` reads message bodies by header ID.**");
    expect(text).toContain("1 to 20 `headerIds`");
    expect(text).toContain("It is a read, enabled by default");
    expect(text).toContain('`{"global":{"iris_message_body":false}}` restricts it');
    expect(text).toContain("it stays enabled under the `read-only` preset");
  });

  it("names the route, the bodyRead values and the data-policy behavior", () => {
    const text = squash(section);
    expect(text).toContain("`POST /interop/message/body`");
    expect(text).toContain("`ExecuteMCPv2.REST.MessageBody`");
    expect(text).toContain("(`bodyRead`: `kind`, `hl7` or `all`)");
    expect(text).toContain("Under `redact` (the default) IRIS reads HL7 v2 bodies only");
    expect(text).toContain("`block` withholds every body and IRIS reads none");
    expect(text).toContain("`allow` shows bodies as stored");
    expect(text).toContain("`dataPolicyClamped: true`");
    expect(text).toContain("body text never reaches the audit file or the console log");
  });

  it("names the pair, the shared decision, DW-577 and the ValidateHeaderIds maximum", () => {
    const text = squash(section);
    expect(text).toContain("A third pair in `TOOL_PAIRS`");
    expect(text).toContain("`decideBodyPolicy` and `BodyPolicyPlan` in `@iris-mcp/shared`");
    expect(text).toContain("`Hl7Text` refuses a body over the cap before it serializes it (DW-577)");
    expect(text).toContain("`MessageResend.ValidateHeaderIds` takes a maximum");
  });

  it("states the BOOTSTRAP_VERSION move from the version before this story to the version it left", () => {
    const text = squash(section);
    expect(text).toContain(`\`${PREVIOUS_BOOTSTRAP_VERSION}\` to \`${STORY_BOOTSTRAP_VERSION}\``);
    expect(text).toContain("embeds 32 classes instead of 31");
  });

  it("the section carries no roster-summary string, which docs-visibility-roster-sync reads from the first match in the file", () => {
    expect(section).not.toMatch(/(?:full|core|developer)\s*`?\s*\d+\/\d+\/\d+\/\d+\/\d+/);
  });

  it("the Epic 30 roster line is the Story 39.5 one", () => {
    const changelog = squash(read("CHANGELOG.md"));
    expect(changelog).toContain("tool counts, as of Story 39.5): `full` 32/27/25/22/8 (dev/admin/interop/ops/data), `core` 15/13/12/10/8, `developer` 32/11/25/10/8");
    expect(changelog).toContain("as of Story 39.5 `iris_message_search` / `iris_message_body` are a third");
  });

  // `changeset version` consumes (deletes) the file and moves its text into the generated package
  // changelogs, so the bumps are checked while the file exists.
  const changesetPath = ".changeset/story-39-5-message-body-reader.md";
  const changesetPresent = existsSync(path.join(REPO_ROOT, changesetPath));

  it.skipIf(!changesetPresent)("the changeset bumps exactly shared minor and interop minor (AD-29)", () => {
    const changeset = read(changesetPath);
    const frontMatter = /^---\n([\s\S]*?)\n---/.exec(changeset)?.[1] ?? "";
    const bumps = Object.fromEntries(
      frontMatter
        .split("\n")
        .map((line) => /^"([^"]+)":\s*(\w+)$/.exec(line))
        .filter((match): match is RegExpExecArray => match !== null)
        .map((match) => [match[1], match[2]]),
    );
    expect(bumps).toEqual({ "@iris-mcp/shared": "minor", "@iris-mcp/interop": "minor" });
    expect(squash(changeset)).toContain("It is a read, enabled by default");
  });
});

describe("Story 39.5: the root README names the tool, its default state and the policy behavior", () => {
  const readme = read("README.md");

  it("the IRIS_DATA_POLICY row says what the default does to iris_message_body", () => {
    const row = squash(readme.split("\n").find((line) => line.startsWith("| `IRIS_DATA_POLICY` |")) ?? "");
    expect(row, "the variable's row").not.toBe("");
    expect(row).toContain("`iris_message_body` shows an HL7 v2 body redacted by a reviewed keep-list and withholds every other body");
    expect(row).toContain("lets `iris_message_body` show bodies as stored");
  });

  it("the governance-defaults row says the tool is a read, enabled by default, and still enabled under the read-only preset", () => {
    const row = squash(readme.split("\n").find((line) => line.startsWith("| interop | `iris_message_body` |")) ?? "");
    expect(row, "the governance-defaults row").not.toBe("");
    expect(row).toContain("flat read tool, no actions");
    expect(row).toContain("a read, enabled by default, and still enabled under the read-only preset");
    expect(row).toContain("`redact` shows an HL7 v2 body redacted and withholds every other body, `block` withholds every body");
  });

  it("the interop row of the package table counts 24 tools and names the reader with its default state", () => {
    const row = squash(readme.split("\n").find((line) => line.startsWith("| [@iris-mcp/interop]")) ?? "");
    expect(row).toContain("| Interoperability | 24 |");
    expect(row).toContain("message body reading (`iris_message_body` \u2014 a read of 1 to 20 message bodies by header ID");
    expect(row).toContain("under the PHI data policy: enabled by default");
  });

  it("the pairs sentence names the third pair, and the roster tables carry the new counts", () => {
    const text = squash(readme);
    expect(text).toContain("`iris_message_search` / `iris_message_body` (Story 39.5: find messages, then read what they carry)");
    expect(text).toContain("| **full** (default) | 31 | 26 | 24 | 21 | 7 | 109 | 114 |");
    expect(text).toContain("| **developer** | 31 | 10 | 24 | 9 | 7 | 81 | 86 |");
    expect(text).toContain("| **core** | 14 | 12 | 11 | 9 | 7 | 53 | 58 |");
    expect(text).toContain("`developer` = the full 24-tool server.");
  });

  it("the PHI data policy section lists iris_message_body first among what the policy governs, with its parameter", () => {
    const start = readme.indexOf("**What it governs today.**");
    expect(start, "the README has the 'What it governs today' paragraph").toBeGreaterThanOrEqual(0);
    const paragraph = squash(readme.slice(start, readme.indexOf("\n\n", start)));
    expect(paragraph.startsWith("**What it governs today.** The `iris_message_body` tool (Story 39.5)")).toBe(true);
    expect(paragraph).toContain("is the one tool built to return body text");
    expect(paragraph).toContain("under `redact` it shows an HL7 v2 body redacted by the reviewed keep-list, complete or not at all, and withholds every other body");
    expect(paragraph).toContain("no other body's content leaves IRIS");
    expect(paragraph).toContain("under `block` it withholds every body and IRIS reads none");
    expect(paragraph).toContain("It is a read, enabled by default");
    expect(squash(readme)).toContain("`iris_message_body` takes an optional `dataPolicy` parameter, and a value looser than the profile's is ignored and reported as `dataPolicyClamped: true`");
    expect(squash(readme)).not.toContain("no tool takes a policy parameter yet");
  });

  it("the policy table says what each value does to the reader", () => {
    const text = squash(readme);
    expect(text).toContain("The one tool built to show body text, `iris_message_body` (Story 39.5), shows an HL7 v2 body redacted by a reviewed keep-list, complete or not at all, withholds every other body, and never has IRIS read one.");
    expect(text).toContain("| `allow` | Today's output, unchanged; `iris_message_body` shows each body as stored. |");
  });

  it("the payload table was re-measured at this story", () => {
    const match = /Last re-measured at Story 39\.(\d+) \(`pnpm measure:tools-payload`/.exec(squash(readme));
    expect(match, "the re-measured sentence").not.toBeNull();
    expect(Number(match?.[1])).toBeGreaterThanOrEqual(5);
  });
});

describe("Story 39.5: the interop README documents iris_message_body", () => {
  const interopReadme = read("packages/iris-interop-mcp/README.md");
  const start = interopReadme.indexOf("#### `iris_message_body`");
  const next = interopReadme.indexOf("\n#### ", start + 1);
  const subsection = squash(interopReadme.slice(start, next === -1 ? undefined : next));

  it("lists the tool in the monitoring table with its default state", () => {
    const row = squash(interopReadme.split("\n").find((line) => line.startsWith("| `iris_message_body` |")) ?? "");
    expect(row, "the tool table has the row").not.toBe("");
    expect(row).toContain("a read, enabled by default, under the PHI data policy");
    expect(row).toContain("`headerIds`, `maxChars?`, `dataPolicy?`, `namespace?`");
    expect(row).toContain("readOnly, idempotent");
  });

  it("has the subsection, the governance default, the option table and the renderer table", () => {
    expect(start, "the interop README has the iris_message_body subsection").toBeGreaterThanOrEqual(0);
    expect(subsection).toContain("It is a read (`mutates: \"read\"`) and **enabled by default** under `IRIS_GOVERNANCE`, including under the `read-only` preset");
    expect(subsection).toContain('`{"global": {"iris_message_body": false}}`');
    expect(subsection).toContain("always visible together with `iris_message_search`");
    expect(subsection).toContain("| `headerIds` | *(required)* | 1 to 20 header IDs");
    expect(subsection).toContain("| `maxChars` | `10000` | The most characters of text shown per body, 1 to 1048576. An **output cap**");
    expect(subsection).toContain("It can only **tighten** the profile's policy");
    for (const format of ["`er7`", "`xml`", "`json`", "`text`"]) expect(subsection, format).toContain(format);
    expect(subsection).toContain("a stream is its class and size, never its content");
  });

  it("states the whole-or-nothing rule for HL7 v2, the sanitization and the notApplicable answer", () => {
    expect(subsection).toContain("An HL7 v2 body is **read only whole**");
    expect(subsection).toContain("a larger `maxChars` (at most 1048576) raises that limit");
    expect(subsection).toContain("CRLF and a lone CR become LF");
    expect(subsection).toContain("`notApplicable: true`");
  });

  it("states the policy line: redact, block and allow, what IRIS reads, the counts, no body text in the logs", () => {
    expect(subsection).toContain("> **Data policy:** the tool is under the PHI data policy (`IRIS_DATA_POLICY`, set per profile; default `redact`)");
    expect(subsection).toContain("Under `redact` IRIS reads HL7 v2 bodies only");
    expect(subsection).toContain("every field that is not on the list is replaced by `***`");
    expect(subsection).toContain("no other body's content leaves IRIS");
    expect(subsection).toContain("Under `block` every body is withheld and IRIS reads none");
    expect(subsection).toContain("Under `allow` each body is shown as stored");
    expect(subsection).toContain("`dataPolicy` (`{policy, redacted, blocked}`)");
    expect(subsection).toContain("Neither the audit log nor the console log holds body text under any policy");
    expect(subsection).toContain("it is not a compliance certification");
  });

  it("counts 24 tools, a 12-tool core roster and 25 runtime tools", () => {
    const text = squash(interopReadme);
    expect(text).toContain("**12-tool runtime roster** (11 package tools + `iris_server_profiles`)");
    expect(text).toContain("**25 runtime tools** (24 + `iris_server_profiles`)");
    expect(text).toContain("All 24 interoperability tools operate in the context");
  });
});

describe("Story 39.5: tool_support.md states the note, the API row and the scope row", () => {
  const toolSupport = read("tool_support.md");

  it("has the Story 39.5 note: the tool, its default state, the route, DW-577 and the BOOTSTRAP_VERSION move", () => {
    const note = squash(toolSupport.split("\n").find((line) => line.startsWith("> **Story 39.5")) ?? "");
    expect(note, "tool_support.md has the Story 39.5 note").not.toBe("");
    expect(note).toContain(`added \`iris_message_body\` (interop 23 ${RIGHT_ARROW} 24; the suite goes from 108 to 109 package tools, 113 to 114 advertised)`);
    expect(note).toContain("over the new route `POST /interop/message/body`");
    expect(note).toContain("The tool is a **read, enabled by default** (and still enabled under the `read-only` preset)");
    expect(note).toContain('`{"global":{"iris_message_body":false}}`');
    expect(note).toContain("It is **governed by the PHI data policy**");
    expect(note).toContain("under `redact` IRIS reads HL7 v2 bodies only");
    expect(note).toContain("a call's `dataPolicy` can only tighten the profile's policy");
    expect(note).toContain("(`core` is 12 runtime tools)");
    expect(note).toContain("(DW-577)");
    expect(note).toContain(`\`${PREVIOUS_BOOTSTRAP_VERSION}\` ${RIGHT_ARROW} \`${STORY_BOOTSTRAP_VERSION}\``);
    expect(note).toContain(`bootstrap 31 ${RIGHT_ARROW} 32 classes`);
  });

  it("lists the tool as row 24 of the interop section", () => {
    const redSquare = String.fromCodePoint(0x1f7e5);
    expect(toolSupport).toContain(`| 24 | \`iris_message_body\` | ${redSquare} ExecuteMCPv2 | \`/interop/message/body\` |`);
  });

  it("the scope table lists iris_message_body as governed, with its default state and policy behavior", () => {
    const rows = toolSupport.split("\n").filter((line) => line.startsWith("| `iris_message_body` | governed |"));
    expect(rows, "exactly one governed row").toHaveLength(1);
    const row = squash(rows[0] ?? "");
    expect(row).toContain("a read, enabled by default");
    expect(row).toContain("`block` withholds every body");
    expect(row).toContain("`redact` shows an HL7 v2 body redacted by the reviewed keep-list, complete or not at all, and withholds every other body, which IRIS never reads");
    expect(row).toContain("`allow` shows bodies as stored");
  });

  it("the closing sentences of the scope section name the tool", () => {
    expect(squash(toolSupport)).toContain("governs every body `iris_message_body` returns (the tool Story 39.5 adds)");
  });

  it("counts the suite at 109 package tools and 114 advertised", () => {
    expect(toolSupport).toContain("| `@iris-mcp/interop` | 0 | 24 | 0 | **24** | **25** |");
    expect(toolSupport).toContain("| **Total** | **20** | **84** | **5** | **109** | **114** |");
  });
});

describe("Story 39.5: no new document text claims regulatory compliance or says the preview shows redacted text", () => {
  const documents: Array<[string, string]> = [
    ["README.md", read("README.md")],
    ["tool_support.md", read("tool_support.md")],
    ["CHANGELOG.md (Story 39.5)", sectionsOf(read("CHANGELOG.md")).find((s) => s.includes("Story 39.5: Message body reader")) ?? ""],
    ...readdirSync(path.join(REPO_ROOT, "packages"))
      .filter((dir) => existsSync(path.join(REPO_ROOT, "packages", dir, "README.md")))
      .map((dir): [string, string] => [`packages/${dir}/README.md`, read(`packages/${dir}/README.md`)]),
    ...(existsSync(path.join(REPO_ROOT, ".changeset", "story-39-5-message-body-reader.md"))
      ? [["the changeset", read(".changeset/story-39-5-message-body-reader.md")] as [string, string]]
      : []),
  ];

  for (const [name, text] of documents) {
    it(`${name} makes no compliance claim`, () => {
      for (const claim of CLAIMS) expect(text.match(claim)?.[0], `${name} matches ${String(claim)}`).toBeUndefined();
    });

    it(`${name} does not say the preview shows redacted HL7 text`, () => {
      for (const pattern of REDACTED_TEXT_SHOWN) expect(text.match(pattern)?.[0], `${name} matches ${String(pattern)}`).toBeUndefined();
    });
  }

  it("the scan reads the documents (an empty list would pass everything above)", () => {
    expect(documents.length).toBeGreaterThanOrEqual(8);
    for (const [name, text] of documents) expect(text.length, name).toBeGreaterThan(0);
  });
});
