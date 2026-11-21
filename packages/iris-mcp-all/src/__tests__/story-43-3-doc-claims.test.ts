/**
 * Story 43.3 (AC 43.3.6 docs, Release bookkeeping, project rules #30 and #43) - the documents say what the confirmation gates do.
 *
 * The unit suites and the stdio tests pin the behavior; none of them reads a document. This file reads them: the root README's
 * refusal table and its "Human confirmation (elicitation)" section, the package README of each server that holds a gate, the shared
 * README, the CHANGELOG's Story 43.3 entry and the changeset's bump map. A reader who opens a gated tool's README must learn that a
 * client that supports elicitation asks the person, that any other client keeps today's contract, that a Claude Code `Elicitation`
 * hook can answer for the person and that this is the user's choice, and that `CONFIRMATION_DECLINED` is a refusal code.
 *
 * Needs no IRIS and no built dist: it reads documents only. Cross-package documentation checks live in `@iris-mcp/all` (rule #45).
 */

import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// packages/iris-mcp-all/src/__tests__/ -> repo root is 4 levels up.
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..", "..");

const read = (relative: string): string => readFileSync(path.join(REPO_ROOT, relative), "utf8");
const squash = (text: string): string => text.replace(/\s+/g, " ");

const rootReadme = read("README.md");
const sharedReadme = read("packages/shared/README.md");
const changelog = read("CHANGELOG.md");
// `changeset version` consumes (deletes) the file, so the bump map is read and checked while it exists.
const changesetPresent = existsSync(path.join(REPO_ROOT, ".changeset/story-43-3-human-confirmation.md"));
const changeset = changesetPresent ? read(".changeset/story-43-3-human-confirmation.md") : "";

/** The first line of `text` that starts with `prefix`; fails the test when there is none. */
function lineStarting(text: string, prefix: string): string {
  const line = text.split("\n").find((candidate) => candidate.startsWith(prefix));
  expect(line, `a line starting ${prefix}`).toBeDefined();
  return line as string;
}

/** The root README's "Human confirmation (elicitation)" section, up to the next `###` heading. */
const section = squash(/^### Human confirmation \(elicitation\)$[\s\S]*?(?=^### )/m.exec(rootReadme)?.[0] ?? "");

/** The "Human confirmation (Story 43.3)" paragraphs of a package README, whole. */
function confirmationParagraphs(readme: string): string[] {
  return readme
    .split(/\n\s*\n/)
    .map((paragraph) => squash(paragraph))
    .filter((paragraph) => paragraph.includes("Human confirmation (Story 43.3)"));
}

/** What every package README paragraph on a gate states. */
function expectGateParagraph(paragraph: string, gate: string): void {
  expect(paragraph, gate).toContain(gate);
  expect(paragraph, `${gate}: the client declares form elicitation`).toContain("declares form elicitation");
  expect(paragraph, `${gate}: today's contract for any other client`).toMatch(/keeps today's (`confirm: true` )?contract/);
  expect(paragraph, `${gate}: the refusal code`).toContain("`CONFIRMATION_DECLINED`");
  expect(paragraph, `${gate}: the hook`).toContain("`Elicitation` hook");
  expect(paragraph, `${gate}: the user's choice`).toContain("which is the user's choice");
  expect(paragraph, `${gate}: the person leaves the loop`).toContain("removes the person from the loop");
}

describe("Story 43.3: the root README", () => {
  it("lists CONFIRMATION_DECLINED in the refusal table, with a 'what happened' and a 'what to do' cell", () => {
    const cells = lineStarting(rootReadme, "| `CONFIRMATION_DECLINED` |").split("|").slice(1, -1).map((cell) => cell.trim());
    expect(cells).toHaveLength(3);
    expect(cells[1]).toContain("declined, dismissed the dialog, or accepted it without ticking Confirm");
    expect(cells[1]).toContain("`{code, action, response}`");
    expect(cells[1]).toContain("`denyReason` `CONFIRMATION_DECLINED`");
    expect(cells[2]).toContain("Do not repeat the call unless the person asks for it again");
  });

  it("names the six gates with their default states, the order, the fallback and the audit field", () => {
    for (const gate of [
      "`iris_audit_manage` action `purge`",
      "`iris_env_promote` action `execute`",
      "`iris_production_control` action `clean`",
      "`iris_message_resend` action `resendFiltered`",
      "`iris_message_resend` action `resend`",
      "`iris_doc_edit` action `regenerateStorage`",
    ]) {
      expect(section, gate).toContain(gate);
    }
    expect(section).toContain("**DEFAULT-DISABLED**");
    expect(section).toContain("**enabled by default**");
    expect(section).toContain("Only these six ask.");
    expect(section).toContain("every check of the tool itself");
    expect(section).toContain("gets exactly the contract it had before");
    expect(section).toContain("`CONFIRMATION_DECLINED`");
    expect(section).toContain("Changing any argument of the call asks again for the new arguments.");
    expect(section).toContain("`confirmation` records the person's answer: `accepted`, `declined`, `cancelled`, `unconfirmed` or `unanswered`");
  });

  it("says that a Claude Code Elicitation hook can answer, that installing one is the user's choice, and what headless runs do", () => {
    expect(section).toContain("`Elicitation` hook");
    expect(section).toContain("**Whether to install a hook that answers by itself is your choice, and an auto-answering hook removes the person from the loop.**");
    expect(section).toContain("In headless `claude -p`, hooks run, so a hook answers.");
    expect(section).toContain("`--permission-prompts none`");
    expect(section).toContain("it is only as strong as the client software that relays the person's answer");
  });

  it("states the known limits, including what a declined promotion may already have done", () => {
    expect(section).toContain("**Known limits.**");
    expect(section).toContain("The match count of `resendFiltered` can change between the preview and the run");
    expect(section).toContain("a declined promotion can still have done that");
  });

  it("states that the dialog shows a call's values on one line, cut at 600 characters", () => {
    expect(section).toContain("replaced by a space");
    expect(section).toContain("longer than 600 characters is cut there and ends in `...`");
  });
});

describe("Story 43.3: the package READMEs of the gated tools", () => {
  it("admin: iris_audit_manage purge", () => {
    const paragraphs = confirmationParagraphs(read("packages/iris-admin-mcp/README.md"));
    expect(paragraphs).toHaveLength(1);
    expectGateParagraph(paragraphs[0] as string, "`iris_audit_manage` action `purge` (a write, default-disabled)");
  });

  it("dev: iris_env_promote execute and iris_doc_edit regenerateStorage", () => {
    const paragraphs = confirmationParagraphs(read("packages/iris-dev-mcp/README.md"));
    expect(paragraphs).toHaveLength(2);
    expectGateParagraph(paragraphs[0] as string, "`iris_env_promote` action `execute` (a write, default-disabled)");
    expectGateParagraph(paragraphs[1] as string, '`action: "regenerateStorage"`');
  });

  it("interop: iris_message_resend resend and resendFiltered, and iris_production_control clean", () => {
    const paragraphs = confirmationParagraphs(read("packages/iris-interop-mcp/README.md"));
    expect(paragraphs).toHaveLength(2);
    expectGateParagraph(paragraphs[0] as string, "`resend` and `resendFiltered`");
    expectGateParagraph(paragraphs[1] as string, "`clean` with `killAppData: true` and `confirm: true`");
  });

  it("the ops and data READMEs hold no gate", () => {
    expect(confirmationParagraphs(read("packages/iris-ops-mcp/README.md"))).toEqual([]);
    expect(confirmationParagraphs(read("packages/iris-data-mcp/README.md"))).toEqual([]);
  });
});

describe("Story 43.3: the shared README", () => {
  it("documents the refusal code, ToolContext.confirm, RequestOptions.signal and the audit field", () => {
    expect(squash(lineStarting(sharedReadme, "- **`REFUSAL_CODES.CONFIRMATION_DECLINED`**"))).toContain("`denyReason: \"CONFIRMATION_DECLINED\"`");
    const confirm = squash(lineStarting(sharedReadme, "- **`ToolContext.confirm(request)`**"));
    expect(confirm).toContain("present only on a call off the wire");
    expect(confirm).toContain("`ConfirmationRequest` (`operation`, `target`, `scope`) and `ConfirmationOutcome`");
    expect(squash(lineStarting(sharedReadme, "- **`RequestOptions`**"))).toContain("`RequestOptions.signal` is an `AbortSignal`");
    expect(squash(lineStarting(sharedReadme, "- **The `confirmation` field (Story 43.3).**"))).toContain("`accepted`, `declined`, `cancelled`, `unconfirmed` or `unanswered`");
  });
});

describe("Story 43.3: the CHANGELOG entry and the changeset", () => {
  /** The top entry of the CHANGELOG, up to the next `## ` heading. */
  const entry = squash(/^## \[Pre-release [^\]]*\] \S Story 43\.3: Human confirmation through elicitation$[\s\S]*?(?=^## )/m.exec(changelog)?.[0] ?? "");

  it("sits directly below the Story 43.4 entry", () => {
    const headings = changelog.split("\n").filter((line) => line.startsWith("## "));
    const index = headings.findIndex((heading) => heading.includes("Story 43.4:"));
    expect(index, "the CHANGELOG has the Story 43.4 entry").toBeGreaterThanOrEqual(0);
    expect(headings[index + 1]).toContain("Story 43.3: Human confirmation through elicitation");
    expect(entry.length).toBeGreaterThan(1000);
  });

  it("names the dialog as the AD-15 sanctioned change, the unchanged fallback, the known limits and the DW-637 verdict", () => {
    expect(entry).toContain("the AD-15 sanctioned change for elicitation-capable clients, per AD-34");
    expect(entry).toContain("### Unchanged");
    expect(entry).toContain("gets exactly the previous contract");
    expect(entry).toContain("### Known limits");
    expect(entry).toContain("### Security");
    expect(entry).toContain("DW-637");
    expect(entry).toContain("bump the SDK when a release pins fast-uri 3.1.8 or later");
    expect(entry).toContain("New refusal code `CONFIRMATION_DECLINED`");
    expect(entry).toContain("the frozen governance baseline stays at hash `1e62c5ad5bf7` (141 keys)");
  });

  it.skipIf(!changesetPresent)("the changeset is a patch for @iris-mcp/shared and the five servers, and nothing else", () => {
    const frontmatter = /^---\n([\s\S]*?)\n---/.exec(changeset)?.[1] ?? "";
    const bumps = frontmatter.split("\n").map((line) => line.trim());
    expect(bumps).toEqual([
      '"@iris-mcp/shared": patch',
      '"@iris-mcp/dev": patch',
      '"@iris-mcp/admin": patch',
      '"@iris-mcp/interop": patch',
      '"@iris-mcp/ops": patch',
      '"@iris-mcp/data": patch',
    ]);
    expect(squash(changeset)).toContain("`CONFIRMATION_DECLINED`");
    expect(squash(changeset)).toContain("DW-637");
  });
});
