/**
 * Story 44.6 (AC-13; project rules #30 and #43) -- the documents say what a Copilot-harness session gets from the launcher and
 * what `IRIS_CREDENTIAL_NAME` does. One claim each, on the pattern of `story-42-7-doc-claims.test.ts`:
 *  - the extension README's Copilot-harness section says the provided definition carries `IRIS_CREDENTIAL_NAME` and never a
 *    password, gives the one-time `iris-mcp-credentials set <server name>` step, says `combineProfiles` is Local-only, a server
 *    without a username is unsupported there, only user-scope servers get a connection (DW-749), and names the residual risks;
 *    the old "Known limitation" paragraph is gone;
 *  - the root and shared READMEs carry an `IRIS_CREDENTIAL_NAME` env row whose default is "unset", the root `IRIS_PASSWORD` row
 *    is no longer unconditionally required, and the "all optional and additive" list names the variable;
 *  - `docs/client-config/README.md` caveat 2 says the keychain covers the base credentials with `IRIS_CREDENTIAL_NAME`;
 *  - the extension CHANGELOG opens with `## [Unreleased]` recording the fix, and the root CHANGELOG has the Story 44.6 block
 *    naming the sanctioned AD-15 change and that it resolves 44.2's known limitation;
 *  - the one changeset is `"@iris-mcp/shared": patch`.
 * Needs no IRIS and no built dist: it reads documents. Cross-package documentation checks live in `@iris-mcp/all` (rule #45).
 */

import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { REPO_ROOT } from "./pack-fixture";

const read = (relative: string): string => readFileSync(path.join(REPO_ROOT, relative), "utf8");
const squash = (text: string): string => text.replace(/\s+/g, " ");

/** The markdown table row whose first cell is `` `name` ``, or "" when there is none. */
function envRow(document: string, name: string): string {
  return document.split("\n").find((line) => line.startsWith(`| \`${name}\` |`)) ?? "";
}

describe("Story 44.6: the extension README's Copilot-harness section", () => {
  const readme = read("extensions/iris-mcp-launcher/README.md");
  const start = readme.indexOf("**The servers this extension registers in a Copilot-harness session.**");
  const section = squash(start < 0 ? "" : readme.slice(start, readme.indexOf("\n\n", readme.indexOf("- **Residual risks.**", start))));

  it("exists, and the Known limitation paragraph it replaces is gone", () => {
    expect(start).toBeGreaterThan(-1);
    expect(readme).not.toContain("**Known limitation: the servers this extension registers do not carry their connection settings");
  });

  it("says what a provided definition carries and that it never carries a password", () => {
    expect(section).toContain("`IRIS_CREDENTIAL_NAME=<server name>`");
    expect(section).toContain("It never carries a password");
  });

  it("gives the one-time step, the Local-only combineProfiles, the username requirement, the user-scope rule and the residual risks", () => {
    expect(section).toContain("iris-mcp-credentials set <server name>");
    expect(section).toContain("**`combineProfiles` works under the Local harness only.**");
    expect(section).toContain("without a `username` in `intersystems.servers` is not supported in a Copilot-harness session");
    expect(section).toContain("**Only servers defined in your user settings get a connection.**");
    expect(section).toContain("`IRIS_AUDIT_LOG_MAX_MB`");
    expect(section).toContain("a credential helper cannot stand in for a keychain there");
  });
});

describe("Story 44.6: the IRIS_CREDENTIAL_NAME env rows", () => {
  const root = read("README.md");
  const shared = read("packages/shared/README.md");

  it("the root README has the row, default unset, and the optional list names the variable", () => {
    expect(envRow(root, "IRIS_CREDENTIAL_NAME")).toMatch(/^\| `IRIS_CREDENTIAL_NAME` \| \*\(unset/);
    const optional = root.split("\n").find((line) => line.includes("**Single-server installs need no changes.**")) ?? "";
    expect(optional).toContain("`IRIS_CREDENTIAL_NAME`");
  });

  it("the root README's IRIS_PASSWORD row is required only without IRIS_CREDENTIAL_NAME", () => {
    expect(envRow(root, "IRIS_PASSWORD")).toContain("required unless `IRIS_CREDENTIAL_NAME` is set");
  });

  it("the shared README has the row, default unset", () => {
    expect(envRow(shared, "IRIS_CREDENTIAL_NAME")).toMatch(/^\| `IRIS_CREDENTIAL_NAME` \| unset/);
  });

  it("docs/client-config caveat 2 says the keychain covers the base credentials with IRIS_CREDENTIAL_NAME", () => {
    expect(read("docs/client-config/README.md")).toContain(
      "### 2. The OS keychain covers Server-Manager profiles, and the base credentials only with `IRIS_CREDENTIAL_NAME`",
    );
  });
});

describe("Story 44.6: the changelogs and the changeset", () => {
  const changesetPath = ".changeset/story-44-6-launcher-provider-works-in-copilot-sessions.md";
  const changesetPresent = existsSync(path.join(REPO_ROOT, changesetPath));

  // The release step renames "## [Unreleased]" to "## [<version>] — <date>"; either heading form passes. The fix was released in 1.2.0,
  // and later releases (1.3.0 onward) sit above it, so its section is found by name.
  it("the extension CHANGELOG's first section records the Copilot-harness fix", () => {
    const changelog = read("extensions/iris-mcp-launcher/CHANGELOG.md");
    const first = changelog.split(/^(?=## \[)/m).find((section) => section.startsWith("## [1.2.0]")) ?? "";
    expect(first.split("\n")[0]).toMatch(/^## \[(Unreleased|\d+\.\d+\.\d+)\]/);
    expect(squash(first)).toContain("start in a Copilot-harness chat session");
  });

  it("the root CHANGELOG has the Story 44.6 block naming the sanctioned AD-15 change and the 44.2 limitation it resolves", () => {
    const block = read("CHANGELOG.md").split(/^(?=## \[)/m).find((section) => /^## \[(?:Unreleased|\d+\.\d+\.\d+ detail)\] — Story 44\.6/.test(section)) ?? "";
    const flat = squash(block);
    expect(flat).toContain("sanctioned AD-15 change");
    expect(flat).toContain("resolves the \"Known limitation (deferred)\" bullet of Story 44.2");
  });

  // The changeset is consumed by the release version step, so it is asserted only while it exists.
  it.skipIf(!changesetPresent)("one changeset carries the release as an @iris-mcp/shared patch", () => {
    const changeset = read(changesetPath);
    expect(changeset.split("---")[1]?.trim()).toBe('"@iris-mcp/shared": patch');
  });
});
