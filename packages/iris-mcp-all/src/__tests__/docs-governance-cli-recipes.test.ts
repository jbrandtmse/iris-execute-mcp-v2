/**
 * Story 32.1 QA — doc-rot guard for the `iris-mcp-governance` CLI recipes
 * (AC 32.1.4), in the Rule #45 home for cross-package checks and the
 * Rule #51 spirit (consistency derived MECHANICALLY from the files, never
 * hand-tallied).
 *
 * AC 32.1.4's promise is that an operator can wire ONE governance file into
 * every client by copying the recipes: the same env var name, the same CLI
 * bin path, and the same example policy path in Claude Code (.mcp.json),
 * Cursor (mcp.json), and Codex (config.toml), backed by a CLI reference in
 * the root README and a mention in the shared package README (the 31-3-9
 * lesson — the shared README must name the suite CLIs).
 *
 * Nothing in the source suite would fail if a future edit silently renamed
 * the placeholder path in ONE of the three client docs (an operator copying
 * two recipes would then point two clients at two different policy files),
 * dropped the bin path from a recipe, or let the shared README forget the
 * CLI exists. This test is the mechanical guard against that drift. It is
 * ORTHOGONAL to `docs-prompt-sync.test.ts` (prompts docs) and to the
 * governance unit/process tests (which never read the docs).
 *
 * NOT an `*.integration.test.ts` (Rule #21) — runs in the default suite.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
// packages/iris-mcp-all/src/__tests__/ -> repo root is 4 levels up.
const root = resolve(__dirname, "../../../..");

/** The three client-recipe docs AC 32.1.4 names (Claude Code, Cursor, Codex). */
const CLIENT_DOCS = [
  "docs/client-config/claude-code.md",
  "docs/client-config/cursor.md",
  "docs/client-config/README.md", // the Codex config.toml recipe
] as const;

/** All five doc surfaces the story's docs task touched. */
const ALL_SURFACES = [...CLIENT_DOCS, "README.md", "packages/shared/README.md"] as const;

const CLI_BIN_PATH = "packages/shared/dist/cli/governance-cli.js";

function readDoc(rel: string): string {
  return readFileSync(resolve(root, rel), "utf-8");
}

/**
 * Extract the recipe placeholder policy path(s) from a doc, normalized to
 * single-backslash form. The docs write the same Windows path in three
 * escapings: JSON (`C:\\governance\\iris-policy.json`), TOML (same), and
 * shell (`C:\governance\iris-policy.json`) — the guard compares the
 * CANONICAL path, not the escaping.
 */
function placeholderPaths(doc: string): string[] {
  const matches = doc.match(/C:(?:\\\\|\\)governance(?:\\\\|\\)iris-policy\.json/g) ?? [];
  return matches.map((m) => m.replace(/\\\\/g, "\\"));
}

describe("governance CLI recipes stay in sync across the client docs (Story 32.1, AC 32.1.4)", () => {
  it("every touched surface names the IRIS_GOVERNANCE_FILE variable AND the iris-mcp-governance CLI", () => {
    for (const rel of ALL_SURFACES) {
      const doc = readDoc(rel);
      expect(doc, `${rel} names the env var`).toContain("IRIS_GOVERNANCE_FILE");
      expect(doc, `${rel} names the CLI`).toContain("iris-mcp-governance");
    }
  });

  it("each client recipe wires the SAME example policy path placeholder (one file, every client)", () => {
    const seen = new Set<string>();
    for (const rel of CLIENT_DOCS) {
      const paths = placeholderPaths(readDoc(rel));
      expect(paths.length, `${rel} carries at least one iris-policy.json placeholder`).toBeGreaterThan(0);
      for (const p of paths) seen.add(p);
    }
    // Mechanically derived: every placeholder across all three client docs
    // normalizes to ONE canonical path — an operator copying any two recipes
    // points both clients at the same file.
    expect([...seen]).toEqual(["C:\\governance\\iris-policy.json"]);
  });

  it("each client recipe invokes the built CLI bin at its real dist path", () => {
    for (const rel of CLIENT_DOCS) {
      expect(readDoc(rel), `${rel} references the built bin`).toContain(CLI_BIN_PATH);
    }
  });

  it("the CLI bin path the docs advertise is the one package.json actually ships (doc-vs-manifest pin)", () => {
    const pkg = JSON.parse(readDoc("packages/shared/package.json")) as {
      bin?: Record<string, string>;
    };
    expect(pkg.bin?.["iris-mcp-governance"]).toBe(`./dist/cli/governance-cli.js`);
    // The docs' path is packageRoot + the manifest's bin target — derived,
    // not restated, so the two can never drift in opposite directions.
    expect(CLI_BIN_PATH).toBe(`packages/shared/${pkg.bin!["iris-mcp-governance"]!.replace("./", "")}`);
  });

  it("the client docs' cross-link anchor resolves to a real heading in the root README", () => {
    // docs/client-config/README.md links the CLI reference as
    // ../../README.md#iris-mcp-governance-cli — the anchor exists only if
    // the root README keeps a heading whose slug is exactly that.
    expect(readDoc("docs/client-config/README.md")).toContain("README.md#iris-mcp-governance-cli");
    expect(readDoc("README.md")).toMatch(/^#+\s+`iris-mcp-governance` CLI/m);
  });
});
