/**
 * Story 33.4 — the README's generated docs stay mechanically in sync with
 * the registry + the certification record (Rule #51/#56 discipline: the
 * adapter table and disposition sections are GENERATED, never hand-authored;
 * the certification roster is exhaustive over CLIENT_ADAPTERS).
 *
 * Two guards:
 *  1. `scripts/render-certification-table.mjs --check` exits 0 (the README
 *     marker sections equal a fresh render from the BUILT dist).
 *  2. The results JSON covers every CLIENT_ADAPTERS id exactly once, with
 *     the per-disposition required fields — a new client can never ship an
 *     undocumented disposition (the generator also refuses, this pins it at
 *     the suite level).
 */

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { CLIENT_ADAPTERS } from "../adapters.js";

const PACKAGE_ROOT = fileURLToPath(new URL("../..", import.meta.url));
const RENDERER = path.join(PACKAGE_ROOT, "scripts", "render-certification-table.mjs");
const RESULTS_PATH = path.join(PACKAGE_ROOT, "scripts", "certification-results.json");

describe("certification docs are generated + exhaustive (AC 33.4.1/33.4.3, Rule #51/#56)", () => {
  it("README marker sections are in sync with a fresh render from the built dist", () => {
    // turbo's test task depends on build, so dist is freshly compiled.
    const result = spawnSync(process.execPath, [RENDERER, "--check"], { encoding: "utf8" });
    expect(result.status, `render --check failed:\n${result.stdout}\n${result.stderr}`).toBe(0);
  });

  it("certification-results.json covers every CLIENT_ADAPTERS id exactly once, with required fields", () => {
    const results = JSON.parse(readFileSync(RESULTS_PATH, "utf8")) as {
      clients: Record<string, { disposition: string; date?: string; evidence?: unknown[]; note?: string }>;
    };
    const adapterIds = Object.keys(CLIENT_ADAPTERS).sort();
    const recordIds = Object.keys(results.clients).sort();
    expect(recordIds).toEqual(adapterIds);
    for (const [id, record] of Object.entries(results.clients)) {
      if (record.disposition === "certified-live") {
        expect(typeof record.date, id).toBe("string");
        expect(Array.isArray(record.evidence) && record.evidence.length > 0, id).toBe(true);
      } else if (record.disposition === "fixture-only-with-residual-risk") {
        expect(typeof record.note === "string" && record.note.length > 0, id).toBe(true);
      } else {
        throw new Error(`${id}: unknown disposition "${record.disposition}"`);
      }
    }
  });

  it("every certified-live record's evidence is quoted output (PASS/FAIL steps or $ commands), never bare prose claims", () => {
    const results = JSON.parse(readFileSync(RESULTS_PATH, "utf8")) as {
      clients: Record<string, { disposition: string; evidence?: string[] }>;
    };
    for (const [id, record] of Object.entries(results.clients)) {
      if (record.disposition !== "certified-live") continue;
      for (const line of record.evidence ?? []) {
        expect(
          line.startsWith("PASS ") || line.startsWith("FAIL ") || line.startsWith("$ "),
          `${id} evidence line is not a recorded run artifact: ${line}`,
        ).toBe(true);
      }
    }
  });

  it("33-5-15: the generated certification cells carry the file-level-vs-agent-side qualifier", () => {
    const readme = readFileSync(path.join(PACKAGE_ROOT, "README.md"), "utf8");
    // Derived per client from the recorded evidence: an agent CLI probe
    // (`claude mcp list`, `kimi -p`) upgrades the cell's qualifier.
    for (const id of ["vscode", "cline"]) {
      const row = readme.split("\n").find((line) => line.startsWith(`| `) && line.includes(`(\`${id}\`)`));
      expect(row, id).toContain("(file-level; agent-side GUI stays manual)");
    }
    for (const id of ["claude-code", "kimi-code"]) {
      const row = readme.split("\n").find((line) => line.startsWith(`| `) && line.includes(`(\`${id}\`)`));
      expect(row, id).toContain("(incl. agent CLI probe)");
    }
    // The details intro states the qualifier rule itself.
    expect(readme).toContain("a FILE-LEVEL status read otherwise");
  });

  it("33-5-16: the CLI npx header carries the not-yet-published caveat", () => {
    const readme = readFileSync(path.join(PACKAGE_ROOT, "README.md"), "utf8");
    const header = readme.split("\n").find((line) => line.includes("npx -y @iris-mcp/client-config iris-mcp-clients <command>"));
    expect(header).toBeDefined();
    const nextLines = readme.slice(readme.indexOf(header ?? ""), (readme.indexOf(header ?? "")) + 300);
    expect(nextLines).toContain("Not yet published to npm");
  });
});
