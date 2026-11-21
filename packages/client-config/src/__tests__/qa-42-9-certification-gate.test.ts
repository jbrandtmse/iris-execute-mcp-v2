/**
 * Story 42.9 QA (AC 42.9.2, implement scope; Rule #59) - the generated certification table, proven to fail on the path it guards.
 *
 * `certification-docs.test.ts` proves the committed README equals a render of the committed records, and that a malformed `humanOnly`
 * exits 2. It does not prove that `--check` is RED when the committed table drifts from the records (the one thing the gate is for), nor
 * that `against` reaches the table, nor that no record in the file claims a live certification this story never ran. Each row here runs
 * the real renderer on a scratch copy of the package files (the committed tree is never written).
 */

import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import { CLIENT_ADAPTERS } from "../adapters.js";

const PACKAGE_ROOT = fileURLToPath(new URL("../..", import.meta.url));
const RESULTS_PATH = path.join(PACKAGE_ROOT, "scripts", "certification-results.json");

type Records = Record<string, Record<string, unknown>>;
const results = JSON.parse(readFileSync(RESULTS_PATH, "utf8")) as { clients: Records };

const created: string[] = [];
afterEach(() => {
  while (created.length > 0) rmSync(created.pop() as string, { recursive: true, force: true });
});

interface Scratch {
  dir: string;
  readme: string;
  render: (check: boolean) => { status: number | null; stdout: string; stderr: string };
}

/** A scratch copy of the renderer, its records and the README; `dist` and the pack are linked (read only). */
function scratch(patch: (clients: Records) => Records = (clients) => clients, readmeEdit: (text: string) => string = (text) => text): Scratch {
  const dir = mkdtempSync(path.join(tmpdir(), "qa-42-9-cert-"));
  created.push(dir);
  mkdirSync(path.join(dir, "scripts"), { recursive: true });
  for (const file of ["render-certification-table.mjs", "certify-record.mjs"]) {
    copyFileSync(path.join(PACKAGE_ROOT, "scripts", file), path.join(dir, "scripts", file));
  }
  symlinkSync(path.join(PACKAGE_ROOT, "dist"), path.join(dir, "dist"), "dir");
  symlinkSync(path.join(PACKAGE_ROOT, "skills-pack"), path.join(dir, "skills-pack"), "dir");
  const readme = path.join(dir, "README.md");
  writeFileSync(readme, readmeEdit(readFileSync(path.join(PACKAGE_ROOT, "README.md"), "utf8")));
  writeFileSync(path.join(dir, "scripts", "certification-results.json"), JSON.stringify({ ...results, clients: patch(structuredClone(results.clients)) }));
  const render: Scratch["render"] = (check) => {
    const run = spawnSync(process.execPath, [path.join(dir, "scripts", "render-certification-table.mjs"), ...(check ? ["--check"] : [])], { encoding: "utf8" });
    return { status: run.status, stdout: run.stdout, stderr: run.stderr };
  };
  return { dir, readme, render };
}

describe("the generated certification table gate is red on drift (the scratch copy, never the committed README)", () => {
  it("control: the committed README and records are in sync on the scratch copy (--check exits 0)", () => {
    const s = scratch();
    const run = s.render(true);
    expect(run.status, `${run.stdout}${run.stderr}`).toBe(0);
  });

  it("a humanOnly check edited in the records without a regeneration turns --check red", () => {
    const s = scratch((clients) => {
      (clients.zed as { humanOnly: { check: string } }).humanOnly.check = "a different check than the table shows";
      return clients;
    });
    const run = s.render(true);
    expect(run.status, `${run.stdout}${run.stderr}`).not.toBe(0);
  });

  it("a humanOnly line edited by hand in the README (a hand-edit of generated text) turns --check red", () => {
    const zed = (results.clients.zed as { humanOnly: { check: string; markedOn: string } }).humanOnly;
    const line = `human-only (marked ${zed.markedOn}): ${zed.check}`;
    expect(readFileSync(path.join(PACKAGE_ROOT, "README.md"), "utf8")).toContain(line);
    const s = scratch((clients) => clients, (text) => text.replaceAll(line, `human-only (marked 2020-01-01): ${zed.check}`));
    const run = s.render(true);
    expect(run.status, `${run.stdout}${run.stderr}`).not.toBe(0);
  });

  it("a certified-live record's `against` reaches the adapter table and the details, and the regenerated README is then in sync", () => {
    const s = scratch((clients) => {
      clients["claude-code"] = { ...clients["claude-code"], against: "@iris-mcp/dev@1 \u2192 0.0.1-qa" };
      return clients;
    });
    expect(s.render(true).status, "the committed README does not carry the new `against`").not.toBe(0);
    const written = s.render(false);
    expect(written.status, `${written.stdout}${written.stderr}`).toBe(0);
    const text = readFileSync(s.readme, "utf8");
    const row = text.split("\n").find((line) => line.startsWith("| ") && line.includes("(`claude-code`)"));
    expect(row).toContain("(incl. agent CLI probe) against @iris-mcp/dev@1 \u2192 0.0.1-qa");
    expect(text).toContain("against `@iris-mcp/dev@1 \u2192 0.0.1-qa`");
    expect(s.render(true).status, "rendered once, the check is green").toBe(0);
  });

  it("a record without `against` renders no `against` text anywhere in its certified-live cell (the 2026-07-28 records stay as recorded until a run replaces them)", () => {
    const readme = readFileSync(path.join(PACKAGE_ROOT, "README.md"), "utf8");
    for (const id of ["claude-code", "vscode", "cline", "kimi-code"]) {
      if ((results.clients[id] as { against?: unknown } | undefined)?.against !== undefined) continue;
      const row = readme.split("\n").find((line) => line.startsWith("| ") && line.includes(`(\`${id}\`)`)) ?? "";
      expect(row, id).toContain("**certified-live** 2026-07-28");
      expect(row, id).not.toContain(" against ");
    }
  });
});

describe("the records themselves: one per adapter, and nothing certified-live that no run produced (Rule #36)", () => {
  it("there is exactly one record per adapter of the registry, and no record for anything else", () => {
    expect(Object.keys(results.clients).sort()).toEqual(Object.keys(CLIENT_ADAPTERS).sort());
  });

  it("every certified-live record comes from a run: the four clients of the 2026-07-28 runs, or a later certify run that recorded `against`; a record the implement stage dated 2026-11-21 is fixture-only", () => {
    const live = Object.entries(results.clients).filter(([, record]) => record.disposition === "certified-live");
    for (const [id, record] of live) {
      if (record.against !== undefined) continue;
      expect(["claude-code", "cline", "kimi-code", "vscode"], `${id} is certified-live with no run behind it`).toContain(id);
      expect(record.date, `${id}: a certified-live date moves only with a real run`).toBe("2026-07-28");
    }
    for (const [id, record] of Object.entries(results.clients)) {
      if (record.date === "2026-11-21" && record.against === undefined) expect(record.disposition, `${id} was dated by the implement stage and ran no live certification`).toBe("fixture-only-with-residual-risk");
    }
  });

  it("every humanOnly marker is dated the implementation date, names a person-run check, and sits on a record that is not certified-live without an evidence trail", () => {
    for (const [id, record] of Object.entries(results.clients)) {
      const human = record.humanOnly as { check: string; markedOn: string } | undefined;
      if (human === undefined) continue;
      expect(human.markedOn, id).toBe("2026-11-21");
      expect(human.check.length, id).toBeGreaterThan(20);
      if (record.disposition === "certified-live") expect(Array.isArray(record.evidence) && (record.evidence as unknown[]).length > 0, `${id} keeps its recorded evidence`).toBe(true);
    }
  });

  it("the human-only rows are exactly the clients the spec's Design Notes list for a person (AC 42.9.2), and each renders its marker", () => {
    // Spec Design Notes, "Human-only": VS Code, Kimi Code, Cline, Claude Desktop, Cursor, Devin Desktop, Zed, Codex, Gemini, Goose, Pi, Junie.
    const listed = ["claude-desktop", "cline", "codex", "cursor", "gemini", "goose", "jetbrains-junie", "kimi-code", "pi", "vscode", "windsurf", "zed"];
    const marked = Object.entries(results.clients).filter(([, record]) => record.humanOnly !== undefined).map(([id]) => id).sort();
    expect(marked).toEqual(listed);
    const readme = readFileSync(path.join(PACKAGE_ROOT, "README.md"), "utf8");
    for (const id of listed) {
      const row = readme.split("\n").find((line) => line.startsWith("| ") && line.includes(`(\`${id}\`)`)) ?? "";
      expect(row, id).toMatch(/human-only \(marked \d{4}-\d{2}-\d{2}\): /);
    }
  });

  it("the new adapters (Pi, JetBrains Junie) each have a fixture-only record that says what is unproven", () => {
    for (const id of ["pi", "jetbrains-junie"]) {
      const record = results.clients[id] as { disposition: string; note?: string; humanOnly?: unknown };
      expect(record.disposition, id).toBe("fixture-only-with-residual-risk");
      expect(typeof record.note === "string" && /unproven/i.test(record.note), `${id} note says what is unproven`).toBe(true);
      expect(record.humanOnly, id).toBeDefined();
    }
  });
});
