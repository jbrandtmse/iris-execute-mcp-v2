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
import { createHash } from "node:crypto";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
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

  it("the CLI npx header carries no not-yet-published caveat (Story 42.9)", () => {
    const readme = readFileSync(path.join(PACKAGE_ROOT, "README.md"), "utf8");
    const header = readme.split("\n").find((line) => line.includes("npx -y -p @iris-mcp/client-config@1 iris-mcp-clients <command>"));
    expect(header).toBeDefined();
    const nextLines = readme.slice(readme.indexOf(header ?? ""), readme.indexOf(header ?? "") + 400);
    expect(nextLines).not.toMatch(/not yet published/i);
    expect(readme).not.toMatch(/not yet published to npm/i);
  });

  it("a record's humanOnly marker renders as `human-only (marked <date>): <check>` in the adapter table and the details", () => {
    const results = JSON.parse(readFileSync(RESULTS_PATH, "utf8")) as {
      clients: Record<string, { humanOnly?: { check: string; markedOn: string } }>;
    };
    const readme = readFileSync(path.join(PACKAGE_ROOT, "README.md"), "utf8");
    const marked = Object.entries(results.clients).filter(([, record]) => record.humanOnly !== undefined);
    expect(marked.length).toBeGreaterThan(0);
    for (const [id, record] of marked) {
      const human = record.humanOnly as { check: string; markedOn: string };
      const text = `human-only (marked ${human.markedOn}): ${human.check}`;
      const row = readme.split("\n").find((line) => line.startsWith("| ") && line.includes(`(\`${id}\`)`));
      expect(row, id).toContain(text);
      expect(readme, id).toContain(`**${text}**`);
    }
  });

  it("render refuses a malformed humanOnly marker (exit 2, naming the client)", () => {
    const results = JSON.parse(readFileSync(RESULTS_PATH, "utf8")) as { clients: Record<string, Record<string, unknown>> };
    const broken: Record<string, unknown>[] = [
      { check: "x" },
      { check: "x", markedOn: "2026-13-40" },
      { check: "", markedOn: "2026-11-21" },
      { check: "a | b", markedOn: "2026-11-21" },
    ];
    for (const humanOnly of broken) {
      const sandbox = mkdtempSync(path.join(tmpdir(), "render-human-only-"));
      try {
        mkdirSync(path.join(sandbox, "scripts"), { recursive: true });
        for (const file of ["render-certification-table.mjs", "certify-record.mjs"]) {
          copyFileSync(path.join(PACKAGE_ROOT, "scripts", file), path.join(sandbox, "scripts", file));
        }
        symlinkSync(path.join(PACKAGE_ROOT, "dist"), path.join(sandbox, "dist"), "dir");
        symlinkSync(path.join(PACKAGE_ROOT, "skills-pack"), path.join(sandbox, "skills-pack"), "dir");
        copyFileSync(path.join(PACKAGE_ROOT, "README.md"), path.join(sandbox, "README.md"));
        const patched = { ...results, clients: { ...results.clients, cursor: { ...results.clients.cursor, humanOnly } } };
        writeFileSync(path.join(sandbox, "scripts", "certification-results.json"), JSON.stringify(patched));
        const run = spawnSync(process.execPath, [path.join(sandbox, "scripts", "render-certification-table.mjs"), "--check"], { encoding: "utf8" });
        expect(run.status, `${JSON.stringify(humanOnly)}: ${run.stdout}${run.stderr}`).toBe(2);
        expect(run.stderr).toContain("cursor has a malformed humanOnly marker");
      } finally {
        rmSync(sandbox, { recursive: true, force: true });
      }
    }
  });
});

/**
 * AC 42.9.2, implement scope: the certified-live records of 2026-07-28 are evidence, so Story 42.9 leaves them as they were.
 * Each digest is the SHA-256 of the record's keys in sorted order, without `humanOnly` and `ac3344` (the two fields this story
 * adds or rewrites), captured from `git show 915703e5:packages/client-config/scripts/certification-results.json` (Node 26.8.1,
 * 2026-11-21). A record that a re-certification run replaces carries `against` and leaves this pin.
 */
const BASELINE_CERTIFIED_LIVE_DIGESTS: Record<string, string> = {
  "claude-code": "b71175611ce68d617aecdc3caf4730b9c2c12f2e25b1009ed19d50b8b9dfbced",
  vscode: "1d4b0ca8e2ba936d7f2427bcb2132c4addc3257878fff2ddb84b97a574d87d03",
  cline: "57b8118b43ada9b5be53b72cccd097de8462f2390f2e1345773ddad1376bf4da",
  "kimi-code": "3af484a3faf0d0f1f82b940daaec94d1c8b65422607597c4f3a4d72300152abf",
};

describe("the certified-live records of 2026-07-28 are untouched (AC 42.9.2)", () => {
  const canonical = (value: unknown): unknown =>
    Array.isArray(value)
      ? value.map(canonical)
      : value !== null && typeof value === "object"
        ? Object.fromEntries(
            Object.keys(value as Record<string, unknown>)
              .sort()
              .map((key) => [key, canonical((value as Record<string, unknown>)[key])]),
          )
        : value;

  it("every certified-live record that has not been re-certified equals its baseline digest, and the four baseline records exist", () => {
    const results = JSON.parse(readFileSync(RESULTS_PATH, "utf8")) as { clients: Record<string, Record<string, unknown>> };
    const live = Object.entries(results.clients).filter(([, record]) => record.disposition === "certified-live");
    for (const id of Object.keys(BASELINE_CERTIFIED_LIVE_DIGESTS)) {
      expect(results.clients[id]?.disposition, `${id} stays certified-live`).toBe("certified-live");
    }
    for (const [id, record] of live) {
      if (record.against !== undefined) continue;
      const rest = Object.fromEntries(Object.entries(record).filter(([key]) => key !== "humanOnly" && key !== "ac3344"));
      const digest = createHash("sha256").update(JSON.stringify(canonical(rest))).digest("hex");
      expect(digest, `${id}: a certified-live record changed without a re-certification (no "against")`).toBe(BASELINE_CERTIFIED_LIVE_DIGESTS[id]);
    }
  });
});
