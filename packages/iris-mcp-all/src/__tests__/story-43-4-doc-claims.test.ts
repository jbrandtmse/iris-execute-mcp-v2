/**
 * Story 43.4 (AC 43.4.3 docs, DW-641, DW-646, DW-653; project rules #30 and #43) - the documents say what the SDK v2 close-out did.
 *
 * The capstone and the unit suites pin behavior; none of them reads a document. This file reads them, one sentence per fact:
 *  - the root README: the human-confirmation section (the scope of the "adds no ..." list, the descriptions that name the dialog, what
 *    Claude Code and MCP Inspector were observed to do, the headless no-hook case), the governance resource entry and the architecture
 *    paragraph's link;
 *  - `docs/client-config/README.md`: the section on the protocol revisions, the probe copy of an SDK v2 client (DW-641), the probe
 *    timeout, the dialog per client and what the client matrix certifies;
 *  - `docs/client-config/claude-code.md`: the section on `MCP_PROTOCOL_NEGOTIATION=legacy`, the `Elicitation` hook, headless runs and the
 *    single server start;
 *  - the CHANGELOG's Story 43.4 entry (the three sanction ids, the enumeration at close, the known limits) and the changeset's bump map.
 * A reader who opens the client docs must learn which revision each client gets, what a probe copy does to the log, and that the dialog
 * depends on the client's declared capability.
 *
 * Needs no IRIS and no built dist: it reads documents only. Cross-package documentation checks live in `@iris-mcp/all` (rule #45).
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// packages/iris-mcp-all/src/__tests__/ -> repo root is 4 levels up.
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..", "..");

const read = (relative: string): string => readFileSync(path.join(REPO_ROOT, relative), "utf8");
const squash = (text: string): string => text.replace(/\s+/g, " ");

const rootReadme = read("README.md");
const clientIndex = read("docs/client-config/README.md");
const claudeCode = read("docs/client-config/claude-code.md");
const changelog = read("CHANGELOG.md");
const changeset = read(".changeset/story-43-4-sdk-v2-close.md");

/** The text of `document` from the heading line `heading` up to the next heading line that starts with `until`, or to its end when `until` is null. */
function between(document: string, heading: string, until: string | null): string {
  const start = document.indexOf(`\n${heading}\n`);
  expect(start, `a heading line ${heading}`).toBeGreaterThanOrEqual(0);
  if (until === null) return squash(document.slice(start));
  const end = document.indexOf(`\n${until}`, start + heading.length + 2);
  expect(end, `a line starting ${until} after ${heading}`).toBeGreaterThan(start);
  return squash(document.slice(start, end));
}

/** The root README's "Human confirmation (elicitation)" section, up to the next `###` heading. */
const confirmation = between(rootReadme, "### Human confirmation (elicitation)", "### ");

/** The new section of the client index, up to the next `## ` heading. */
const indexSection = between(clientIndex, "## Protocol revisions and confirmation dialogs", "## ");

/** The new section of the Claude Code page, up to the next `## ` heading. */
const claudeSection = between(claudeCode, "## Protocol revision and confirmation dialogs", "## ");

/** The Story 43.4 entry of the CHANGELOG, up to the next `## ` heading. */
const entry = /^## \[Pre-release [^\]]*\] \S Story 43\.4: SDK v2 docs, smokes and capstone$[\s\S]*?(?=^## )/m.exec(changelog)?.[0] ?? "";

describe("Story 43.4: the root README", () => {
  it("scopes the 'adds no ...' list to Story 43.3, and says that Story 43.4 appended a sentence to five descriptions", () => {
    expect(confirmation).toContain(
      "Story 43.3 added no tool, action, governance key, preset row, annotation, description, prompt or environment variable (Story 43.4 then appended one sentence about the dialog to the description of each of the five gated tools)",
    );
  });

  it("says that the five gated tools' descriptions name the dialog, and no longer says that descriptions are unchanged", () => {
    expect(confirmation).toContain(
      "Since Story 43.4, the description of each of the five gated tools (`iris_audit_manage`, `iris_env_promote`, `iris_production_control`, `iris_message_resend` and `iris_doc_edit`) ends with one sentence that names the dialog",
    );
    expect(confirmation).toContain("No other byte of any description changed.");
    expect(squash(rootReadme)).not.toContain("Tool descriptions are not changed in this release");
  });

  it("states what Claude Code and MCP Inspector were observed to declare, and that other clients are not verified", () => {
    expect(confirmation).toContain("Claude Code 2.1.296 declares form elicitation on both revisions, so it is asked");
    expect(confirmation).toContain(
      "MCP Inspector CLI 2.9.0 declares none, so it gets the contract it had before the dialog (for `purge`, `confirm: true` plus governance) and no dialog",
    );
    expect(confirmation).toContain("other clients are not verified here");
    expect(confirmation).toContain("the client matrix's certification covers the configuration lifecycle, not dialog behavior");
  });

  it("states the observed headless no-hook case instead of calling it undocumented", () => {
    expect(confirmation).toContain(
      "With no hook and no flag, headless `claude -p` cancels the dialog too (observed on Claude Code 2.1.296), again reported as `CONFIRMATION_DECLINED` with `response: \"cancel\"`, and nothing changes.",
    );
    expect(confirmation).not.toContain("does not document the behavior");
  });

  it("lists each governance URI once: the template's list leaves out the default profile", () => {
    expect(squash(rootReadme)).toContain(
      "enumerates one concrete `iris-governance://<profile>` entry for every configured profile except `default`, which the static entry above already lists",
    );
    expect(squash(rootReadme)).toContain("via `resources/list` and each URI appears once.");
  });

  it("links the architecture paragraph to the client docs, and keeps its stdio sentence", () => {
    expect(squash(rootReadme)).toContain(
      "is in [Protocol revisions and confirmation dialogs](docs/client-config/README.md#protocol-revisions-and-confirmation-dialogs).",
    );
    expect(rootReadme).toContain("the only supported transport: any other `MCP_TRANSPORT` or `--transport` value, `http` included, is a startup configuration error");
  });
});

describe("Story 43.4: docs/client-config/README.md", () => {
  it("puts the section before the env block", () => {
    expect(clientIndex.indexOf("\n## Protocol revisions and confirmation dialogs\n")).toBeGreaterThan(clientIndex.indexOf("\n## Client matrix\n"));
    expect(clientIndex.indexOf("\n## Protocol revisions and confirmation dialogs\n")).toBeLessThan(clientIndex.indexOf("\n## The env block (identical for every client)\n"));
  });

  it("says that one stdio process serves both revisions and that the client's first message chooses", () => {
    expect(indexSection).toContain(
      "Each server is one stdio process that serves both MCP revisions, `2025-11-25` and `2026-07-28`, and the client's first message chooses",
    );
    expect(indexSection).toContain("In this section `2026-07-28` is an MCP protocol revision; in the matrix above it is the date a client's configuration lifecycle was certified.");
  });

  it("says that Claude Code 2.1.292 and later negotiates 2026-07-28 and that MCP_PROTOCOL_NEGOTIATION=legacy keeps 2025-11-25", () => {
    expect(indexSection).toContain("Claude Code 2.1.292 and later negotiates `2026-07-28` by default.");
    expect(indexSection).toContain("Setting `MCP_PROTOCOL_NEGOTIATION=legacy` in Claude Code's own environment keeps `2025-11-25`");
    expect(indexSection).toContain("never in the `env` block of an MCP server entry");
  });

  it("describes the probe copy of an SDK v2 client as observed (DW-641): the whole startup, SIGTERM, two starts, a second sessionStart, no stderr", () => {
    expect(indexSection).toContain("A client built on the TypeScript MCP SDK v2 client, in `auto` mode or pinned to a revision");
    expect(indexSection).toContain("MCP Inspector 2.x with `--protocol-era auto` or `modern`");
    expect(indexSection).toContain("first starts a short-lived probe copy of the server");
    expect(indexSection).toContain("The probe runs the whole startup (configuration load, connection check, bootstrap version query), answers `server/discover`, and is ended by the client with SIGTERM.");
    expect(indexSection).toContain("So the server starts twice per connect");
    expect(indexSection).toContain("`IRIS_AUDIT_LOG` gains a second `sessionStart` line with no `shutdown` line");
    expect(indexSection).toContain("the probe's stderr is discarded, so its log lines are not shown");
    expect(indexSection).toContain("Claude Code probes on the same connection and starts the server once.");
  });

  it("says that a probe that is not answered within the request timeout leaves the client on 2025-11-25", () => {
    expect(indexSection).toContain(
      "A TypeScript SDK v2 client on `auto` whose probe is not answered within the request timeout (60 seconds by default) treats the server as `2025-11-25`.",
    );
  });

  it("states the dialog per client as observed, and what the matrix certifies", () => {
    expect(indexSection).toContain(
      "any other client keeps the contract it always had (`confirm: true` plus governance, or governance alone for `resend` and `regenerateStorage`)",
    );
    expect(indexSection).toContain("Claude Code 2.1.296 declares form elicitation on both revisions");
    expect(indexSection).toContain("MCP Inspector CLI 2.9.0 declares none, so it gets that previous contract and no dialog");
    expect(indexSection).toContain("other clients are not verified here");
    expect(indexSection).toContain("not its protocol negotiation or its dialog behavior");
  });
});

describe("Story 43.4: docs/client-config/claude-code.md", () => {
  it("puts the section before Verification", () => {
    expect(claudeCode.indexOf("\n## Protocol revision and confirmation dialogs\n")).toBeGreaterThan(claudeCode.indexOf("\n## Setting Environment Variables\n"));
    expect(claudeCode.indexOf("\n## Protocol revision and confirmation dialogs\n")).toBeLessThan(claudeCode.indexOf("\n## Verification\n"));
  });

  it("covers MCP_PROTOCOL_NEGOTIATION=legacy and where to set it", () => {
    expect(claudeSection).toContain("Claude Code 2.1.292 and later negotiates `2026-07-28` by default.");
    expect(claudeSection).toContain("set `MCP_PROTOCOL_NEGOTIATION=legacy` in Claude Code's own environment");
    expect(claudeSection).toContain("or in the `env` object of Claude Code's `settings.json`");
    expect(claudeSection).toContain("Do not set it in the `env` block of an MCP server entry in `.mcp.json`");
  });

  it("covers the single server start", () => {
    expect(claudeSection).toContain("Claude Code probes on the same connection, so it starts each server once per session on either revision (observed on Claude Code 2.1.296).");
  });

  it("shows the Elicitation hook and warns that a hook that answers removes the person from the loop", () => {
    expect(claudeSection).toContain("Claude Code runs a hook configured under `hooks.Elicitation`, with a matcher on the MCP server name such as `iris-admin`");
    expect(claudeSection).toContain('"hookEventName":"Elicitation","action":"accept","content":{"confirm":true}');
    expect(claudeSection).toContain("**A hook that answers by itself removes the person from the loop, and whether to install one is your choice.**");
    expect(claudeCode).toContain('"Elicitation": [');
  });

  it("covers headless claude -p: a hook answers, and with no hook the dialog is cancelled", () => {
    expect(claudeSection).toContain("**Headless `claude -p`.** Hooks run, so a hook answers.");
    expect(claudeSection).toContain(
      "With no hook, Claude Code 2.1.296 cancels the dialog (the call ends with `CONFIRMATION_DECLINED` and `response: \"cancel\"`, and nothing changes), and `--permission-prompts none` cancels it too.",
    );
  });
});

describe("Story 43.4: the CHANGELOG entry and the changeset", () => {
  it("is the top entry, directly above the Story 43.3 entry", () => {
    const headings = changelog.split("\n").filter((line) => line.startsWith("## "));
    expect(headings[0]).toMatch(/^## \[Pre-release [^\]]*\] \S Story 43\.4: SDK v2 docs, smokes and capstone$/);
    expect(headings[1]).toContain("Story 43.3: Human confirmation through elicitation");
    expect(squash(entry).length).toBeGreaterThan(1000);
  });

  it("has its sections in order: Changed (AD-15 sanctioned), Added, Unchanged, Epic 43 at close, Known limits", () => {
    const headings = entry.split("\n").filter((line) => line.startsWith("### "));
    expect(headings).toEqual(["### Changed (AD-15 sanctioned)", "### Added", "### Unchanged", "### Epic 43 at close", "### Known limits"]);
  });

  it("names each sanction id in backticks, with the golden ledger (DW-639)", () => {
    const changed = between(entry, "### Changed (AD-15 sanctioned)", "### ");
    expect(changed).toContain("**`S-43.4-descriptions`.**");
    expect(changed).toContain("**`S-43.4-governance-resource` (DW-646).**");
    expect(changed).toContain("**`S-43.4-prompt-text` (DW-653).**");
    expect(changed).toContain("**The frozen goldens retire into a ledger (DW-639).**");
    expect(changed).toContain("`fixtures/sdk-golden-sanctioned-changes.json`");
  });

  it("names the capstone and the docs under Added", () => {
    const added = between(entry, "### Added", "### ");
    expect(added).toContain("`epic43-capstone-gate.test.ts`");
    expect(added).toContain("`docs/client-config/claude-code.md`");
  });

  it("says under Unchanged that the baseline and BOOTSTRAP_VERSION stay put", () => {
    const unchanged = between(entry, "### Unchanged", "### ");
    expect(unchanged).toContain("The governance baseline is `1e62c5ad5bf7` (141 keys), and `BOOTSTRAP_VERSION` stays at `d51856f74d6a`.");
  });

  it("enumerates every sanctioned wire change of Stories 43.1 to 43.4 at close", () => {
    const close = between(entry, "### Epic 43 at close", "### ");
    expect(close).toContain("110 package tools and 115 advertised (33, 27, 25, 22 and 8)");
    expect(close).toContain("`BOOTSTRAP_VERSION` stays at `d51856f74d6a`");
    expect(close).toContain("An omitted-`arguments` `prompts/get` renders like `{}` (DW-617).");
    expect(close).toContain("A schema-invalid call is audited (DW-579).");
    expect(close).toContain("`addTools` sends one `list_changed`.");
    expect(close).toContain("A malformed `tools/call` gets `-32602 Invalid tools/call request`.");
    expect(close).toContain("A `task` parameter runs a plain call.");
    expect(close).toContain("Revision 2026-07-28 is served in addition; the 2025-11-25 wire is unchanged.");
    expect(close).toContain("The dialog for clients that declare form elicitation (AD-34).");
    expect(close).toContain("A cancelled call aborts its IRIS request and is audited `error` (DW-642).");
    expect(close).toContain("Clients without the capability are byte-identical.");
    expect(close).toContain("`S-43.4-descriptions`, `S-43.4-governance-resource` and `S-43.4-prompt-text`");
  });

  it("names DW-641, the probe timeout and the unverified clients under Known limits", () => {
    const limits = between(entry, "### Known limits", null);
    expect(limits).toContain("**A probe copy starts the server twice (DW-641).**");
    expect(limits).toContain("**A probe that times out.**");
    expect(limits).toContain("(60 seconds by default)");
    expect(limits).toContain("**Clients not verified.**");
    expect(limits).toContain("observed on Claude Code 2.1.296 and MCP Inspector CLI 2.9.0 only");
  });

  it("the changeset is a patch for @iris-mcp/shared, client-config and the five servers, and nothing else", () => {
    const frontmatter = /^---\n([\s\S]*?)\n---/.exec(changeset)?.[1] ?? "";
    const bumps = frontmatter.split("\n").map((line) => line.trim());
    expect(bumps).toEqual([
      '"@iris-mcp/shared": patch',
      '"@iris-mcp/client-config": patch',
      '"@iris-mcp/dev": patch',
      '"@iris-mcp/admin": patch',
      '"@iris-mcp/interop": patch',
      '"@iris-mcp/ops": patch',
      '"@iris-mcp/data": patch',
    ]);
    expect(squash(changeset)).toContain("`CONFIRMATION_DECLINED`");
    expect(squash(changeset)).toContain("(DW-646)");
    expect(squash(changeset)).toContain("(DW-653)");
    expect(squash(changeset)).toContain("(DW-639)");
    expect(squash(changeset)).toContain("(DW-641)");
  });
});
