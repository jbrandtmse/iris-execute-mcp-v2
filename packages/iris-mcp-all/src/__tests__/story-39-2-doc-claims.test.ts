/**
 * Story 39.2 -- the documents state the PHI data policy, the one sanctioned preview change and its default
 * (project rules #30 and #43), and make no compliance claim (AD-26).
 *
 * The unit suites pin the policy, the engine and the scope; none reads a document. This file asserts:
 *
 *  - the CHANGELOG's Story 39.2 section: its title and headings, that it names the preview change and how to
 *    restore it, that no count or baseline moves, the `BOOTSTRAP_VERSION` move this story made (pinned as
 *    history), and that it holds no roster-summary string (the roster guard reads the first match in the file);
 *  - the changeset's exact bump map (AD-29);
 *  - the root README: the `IRIS_DATA_POLICY` row with its default, the optional-variable and fail-fast
 *    lists, the `DATA_POLICY_BLOCKED` row, the audit section and the "PHI data policy" section with the
 *    exposure sentence, describing the preview as built (the class name for an HL7 v2 body, no redacted HL7 text);
 *  - `tool_support.md` and the interop README;
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

/** The `## <heading>` section of a markdown document, up to the next `---` rule. */
function markdownSection(text: string, heading: string): string {
  const start = text.indexOf(`\n## ${heading}\n`);
  if (start === -1) return "";
  const end = text.indexOf("\n---\n", start + 1);
  return text.slice(start, end === -1 ? undefined : end);
}

/** The `BOOTSTRAP_VERSION` move this story recorded, pinned as history. */
const PREVIOUS_BOOTSTRAP_VERSION = "6dcdd238c792";
const STORY_BOOTSTRAP_VERSION = "d440a659ba1e";

/** The em dash and the right arrow the documents use, by code point. */
const EM_DASH = String.fromCodePoint(0x2014);
const RIGHT_ARROW = String.fromCodePoint(0x2192);

const EXPOSURE_SENTENCE ="The data policy reduces exposure of message-body data; it is not a compliance certification.";

describe("Story 39.2: the CHANGELOG section and the changeset", () => {
  const section =
    sectionsOf(read("CHANGELOG.md")).find((candidate) =>
      /^## \[Pre-release[^\]]*\] . Story 39\.2: PHI data policy$/.test(candidate.split("\n")[0] ?? ""),
    ) ?? "";

  it("the CHANGELOG has the Story 39.2 section, with Changed, Added and Tests headings", () => {
    expect(section, "the CHANGELOG has the Story 39.2 section").not.toBe("");
    expect(section.split("\n").filter((line) => line.startsWith("### "))).toEqual(["### Changed", "### Added", "### Tests"]);
  });

  it("names the preview change, the default that causes it and how to restore the previous output", () => {
    const text = squash(section);
    expect(text).toContain("**The `iris_message_resend` preview shows less of a message body by default.**");
    expect(text).toContain("`redact`");
    expect(text).toContain("`bodySummary: \"\"`");
    expect(text).toContain("(non-stream body; class=EnsLib.HL7.Message)");
    expect(text).toContain("no HL7 body text is requested from IRIS or shown");
    expect(text).toContain("`IRIS_DATA_POLICY=allow` restores it exactly");
    expect(text).toContain("the one sanctioned AD-15 change of the story");
  });

  it("states that no tool count or governance baseline moves", () => {
    const text = squash(section);
    expect(text).toContain("no tool count moves");
    expect(text).toContain("`1e62c5ad5bf7`");
    expect(text).toContain("(141 keys)");
    expect(text).toContain("108 package tools, 113 advertised");
  });

  it("states the BOOTSTRAP_VERSION move from the version before this story to the version it left", () => {
    const text = squash(section);
    expect(text).toContain(`\`${PREVIOUS_BOOTSTRAP_VERSION}\` to \`${STORY_BOOTSTRAP_VERSION}\``);
    expect(text).toContain("still embeds 31 classes");
  });

  it("records the new refusal code, the engine and the exposure sentence", () => {
    const text = squash(section);
    expect(text).toContain("`DATA_POLICY_BLOCKED`");
    expect(text).toContain("`redactHl7`");
    expect(text).toContain("with no tool consumer until Story 39.5");
    expect(text).toContain(EXPOSURE_SENTENCE);
  });

  it("the section carries no roster-summary string, which docs-visibility-roster-sync reads from the first match in the file", () => {
    expect(section).not.toMatch(/(?:full|core|developer)\s*`?\s*\d+\/\d+\/\d+\/\d+\/\d+/);
  });

  // `changeset version` consumes (deletes) the file and moves its text into the generated package
  // changelogs, so the bumps are checked while the file exists.
  const changesetPath = ".changeset/story-39-2-phi-data-policy.md";
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
  });
});

describe("Story 39.2: the root README states the variable, the refusal code, the audit field and the policy", () => {
  const readme = read("README.md");

  it("has the IRIS_DATA_POLICY row with its default, the channels and the fail-fast", () => {
    const row = squash(readme.split("\n").find((line) => line.startsWith("| `IRIS_DATA_POLICY` |")) ?? "");
    expect(row, "the env-table row").not.toBe("");
    expect(row).toContain(`*(unset ${EM_DASH} \`redact\`)*`);
    expect(row).toContain("`block`, `redact` or `allow`");
    expect(row).toContain("`IRIS_PROFILES`");
    expect(row).toContain("governance file");
    expect(row).toContain("`IRIS_GOVERNANCE` does not carry it");
    expect(row).toContain("A malformed value fails startup naming the channel");
  });

  it("lists the variable among the optional ones and among the fail-fast causes", () => {
    const text = squash(readme);
    expect(text).toContain("`IRIS_DATA_POLICY` (unset: `redact`)");
    expect(text).toContain("a malformed `IRIS_DATA_POLICY`, `dataPolicy` field of an `IRIS_PROFILES` entry");
  });

  it("has the DATA_POLICY_BLOCKED row, returned from Story 39.3 on", () => {
    const row = squash(readme.split("\n").find((line) => line.startsWith("| `DATA_POLICY_BLOCKED` |")) ?? "");
    expect(row, "the refusal-code row").not.toBe("");
    expect(row).toContain("A data policy withheld the requested body data.");
    expect(row).toContain("Returned from Story 39.3 on");
  });

  it("the audit section states the dataPolicy field and the PHI-input redaction", () => {
    const audit = squash(markdownSection(readme, "Compliance & Auditability"));
    expect(audit).toContain("`dataPolicy`");
    expect(audit).toContain('{"policy":"redact","redacted":4,"blocked":3}');
    expect(audit).toContain("counts only, never body content");
    expect(audit).toContain('writes `"[REDACTED]"` for those values');
    expect(audit).toContain("`redact` or `block`");
    expect(audit).toContain("The declaration decides, never the parameter's name.");
  });

  const policy = squash(markdownSection(readme, "PHI data policy"));

  it("has the PHI data policy section with the three values, the order and the scope pointer", () => {
    expect(policy, "the README has the PHI data policy section").not.toBe("");
    for (const value of ["`block`", "`redact` (**default**)", "`allow`"]) expect(policy).toContain(value);
    expect(policy).toContain("`IRIS_DATA_POLICY`");
    expect(policy).toContain("`dataPolicy.profiles.<name>`");
    expect(policy).toContain("`IRIS_GOVERNANCE` rejects the key");
    expect(policy).toContain("`dataPolicySource`");
    expect(policy).toContain("tool_support.md#phi-data-policy-scope-as-of-2026-10-17");
  });

  it("describes the preview as built: the class name for an HL7 v2 body, every other body withheld", () => {
    expect(policy).toContain("An HL7 v2 body shows only its class name");
    expect(policy).toContain("every other body is withheld with a reason");
    expect(policy).toContain("`iris_message_body` is the one tool built to return HL7 body text");
  });

  it("carries the exposure sentence exactly", () => {
    expect(policy).toContain(EXPOSURE_SENTENCE);
    expect(squash(readme)).toContain(EXPOSURE_SENTENCE);
  });

  it("the backward-compatibility list names the one default that changes an output", () => {
    const text = squash(readme);
    expect(text).toContain("**The data policy's default changes one output.**");
    expect(text).toContain("`IRIS_DATA_POLICY=allow` restores the previous preview exactly");
  });
});

describe("Story 39.2: tool_support.md and the interop README state the scope and the preview", () => {
  const toolSupport = read("tool_support.md");
  const interopReadme = read("packages/iris-interop-mcp/README.md");

  it("tool_support.md has the scope section, as of 2026-10-17 (moved from 2026-10-16 by Story 40.1), and the Story 39.2 note", () => {
    expect(toolSupport).toContain("## PHI data policy scope (as of 2026-10-17)");
    const note = squash(toolSupport.split("\n").find((line) => line.startsWith("> **Story 39.2")) ?? "");
    expect(note, "tool_support.md has the Story 39.2 note").not.toBe("");
    expect(note).toContain("No tool, action or governance key is added, so no default state and no tool count moves");
    expect(note).toContain("`preview` stays an enabled-by-default read");
    expect(note).toContain(`\`${PREVIOUS_BOOTSTRAP_VERSION}\` ${RIGHT_ARROW} \`${STORY_BOOTSTRAP_VERSION}\``);
  });

  it("tool_support.md counts the suite at 110 package tools and 115 advertised (Story 39.5 added one; Story 40.1 added iris_test_coverage)", () => {
    expect(toolSupport).toContain("| **Total** | **20** | **85** | **5** | **110** | **115** |");
  });

  it("the interop README states the policy on the preview bullet, with the exposure sentence", () => {
    const text = squash(interopReadme);
    expect(text).toContain("a first-~1KB body summary under the operator's data policy");
    expect(text).toContain("> **Data policy:**");
    expect(text).toContain("Under `redact` an HL7 v2 body shows only its class name");
    expect(text).toContain("`block` withholds every body; `allow` returns the summary as before, field for field");
    expect(text).toContain(EXPOSURE_SENTENCE);
  });
});

describe("Story 39.2: no document claims regulatory compliance or shows redacted HL7 text in the preview", () => {
  const documents: Array<[string, string]> = [
    ["README.md", read("README.md")],
    ["tool_support.md", read("tool_support.md")],
    ["CHANGELOG.md (Story 39.2)", sectionsOf(read("CHANGELOG.md")).find((s) => s.includes("Story 39.2: PHI data policy")) ?? ""],
    ...readdirSync(path.join(REPO_ROOT, "packages"))
      .filter((dir) => existsSync(path.join(REPO_ROOT, "packages", dir, "README.md")))
      .map((dir): [string, string] => [`packages/${dir}/README.md`, read(`packages/${dir}/README.md`)]),
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
