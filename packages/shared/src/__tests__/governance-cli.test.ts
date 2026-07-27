/**
 * Unit tests for `iris-mcp-governance` (Epic 32, Story 32.1).
 *
 * Streams/env are injected (the credentials-CLI discipline); filesystem
 * operations use REAL temp files under `mkdtempSync` (the
 * `governance-file.test.ts` style) — no test touches a developer's real
 * `IRIS_GOVERNANCE_FILE`, because `deps.env` is always an explicit map.
 *
 * Single-sourcing proofs live here too: the `effective` render is compared
 * against a DIRECT call to the shared `effective()`/`configSource()` engine
 * with the same inputs, so the CLI can never silently drift from the server
 * cascade (AC 32.1.1's load-bearing constraint).
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync, lstatSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { runCli, writeGovernanceFileAtomic, VALUED_OPTIONS, type CliDeps } from "../cli/governance.js";
import {
  effective,
  configSource,
  loadGovernanceFile,
  type GovernanceConfigSource,
} from "../governance.js";
import { GOVERNANCE_BASELINE } from "../governance-baseline.js";
import { BASELINE_ACTION_CLASSIFICATIONS } from "../baseline-classifications.js";

// ── Harness ────────────────────────────────────────────────────────────

function createCollector(): { write: (chunk: string) => void; text: string } {
  const collector = {
    text: "",
    write(chunk: string): void {
      collector.text += chunk;
    },
  };
  return collector;
}

function baseDeps(env: Record<string, string | undefined> = {}): {
  deps: CliDeps;
  stdout: ReturnType<typeof createCollector>;
  stderr: ReturnType<typeof createCollector>;
} {
  const stdout = createCollector();
  const stderr = createCollector();
  return { deps: { env, stdout, stderr }, stdout, stderr };
}

let dir: string;
let file: string;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "iris-gov-cli-"));
  file = path.join(dir, "governance.json");
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function writeGovernance(content: unknown, at: string = file): void {
  writeFileSync(at, typeof content === "string" ? content : JSON.stringify(content, null, 2), "utf8");
}

// ── Top-level dispatch / help / usage errors ───────────────────────────

describe("runCli dispatch", () => {
  it("--help prints usage and exits 0", async () => {
    const { deps, stdout } = baseDeps();
    const code = await runCli(["--help"], deps);
    expect(code).toBe(0);
    expect(stdout.text).toContain("Usage: iris-mcp-governance <command>");
    expect(stdout.text).toContain("--file <path>   wins when present");
  });

  it("no command prints help to stderr and exits 2", async () => {
    const { deps, stderr } = baseDeps();
    const code = await runCli([], deps);
    expect(code).toBe(2);
    expect(stderr.text).toContain("no command given");
  });

  it("an unknown command exits 2 naming the valid commands", async () => {
    const { deps, stderr } = baseDeps();
    const code = await runCli(["definitely-not-a-command"], deps);
    expect(code).toBe(2);
    expect(stderr.text).toContain('unknown command "definitely-not-a-command"');
    expect(stderr.text).toContain("validate, get, set, unset, preset, effective, diff");
  });

  it("an unknown option exits 2", async () => {
    const { deps, stderr } = baseDeps();
    const code = await runCli(["validate", "--frobnicate"], deps);
    expect(code).toBe(2);
    expect(stderr.text).toContain('Unknown option "--frobnicate"');
  });

  it("a valued option missing its value exits 2", async () => {
    const { deps, stderr } = baseDeps();
    const code = await runCli(["validate", "--file"], deps);
    expect(code).toBe(2);
    expect(stderr.text).toContain('Option "--file" requires a value');
  });
});

// ── validate ───────────────────────────────────────────────────────────

describe("validate", () => {
  it("accepts a valid file, reporting global/profile counts", async () => {
    writeGovernance({ global: { iris_doc_put: false }, profiles: { prod: { iris_sql_execute: false } } });
    const { deps, stdout } = baseDeps();
    const code = await runCli(["validate", "--file", file], deps);
    expect(code).toBe(0);
    expect(stdout.text).toContain("is a valid governance file (1 global key(s), 1 profile(s))");
  });

  it("an empty object is a valid file (0 keys)", async () => {
    writeGovernance({});
    const { deps, stdout } = baseDeps();
    const code = await runCli(["validate", "--file", file], deps);
    expect(code).toBe(0);
    expect(stdout.text).toContain("(0 global key(s), 0 profile(s))");
  });

  it("a missing file exits 1 with the server's exact loader text (names var + path)", async () => {
    const { deps, stderr } = baseDeps();
    const code = await runCli(["validate", "--file", file], deps);
    expect(code).toBe(1);
    expect(stderr.text).toContain("IRIS_GOVERNANCE_FILE is invalid: could not read the file");
    expect(stderr.text).toContain(`(path: ${file})`);
  });

  it("malformed JSON exits 1 with the loader's exact text", async () => {
    writeGovernance("{ not json");
    const { deps, stderr } = baseDeps();
    const code = await runCli(["validate", "--file", file], deps);
    expect(code).toBe(1);
    expect(stderr.text).toContain("IRIS_GOVERNANCE_FILE is invalid: could not parse JSON");
  });

  it("a non-boolean value exits 1 with the loader's shape error", async () => {
    writeGovernance({ global: { iris_doc_put: "false" } });
    const { deps, stderr } = baseDeps();
    const code = await runCli(["validate", "--file", file], deps);
    expect(code).toBe(1);
    expect(stderr.text).toContain('value for "iris_doc_put" must be a boolean');
  });

  it("a reserved key in the file exits 1 with the loader's reserved-key error", async () => {
    writeGovernance('{"global":{"__proto__":false}}');
    const { deps, stderr } = baseDeps();
    const code = await runCli(["validate", "--file", file], deps);
    expect(code).toBe(1);
    expect(stderr.text).toContain('"__proto__" is a reserved key');
  });

  it("--json on an invalid file still emits parseable JSON to stdout and exits 1 (the 31-2 lesson)", async () => {
    writeGovernance("{ not json");
    const { deps, stdout, stderr } = baseDeps();
    const code = await runCli(["validate", "--file", file, "--json"], deps);
    expect(code).toBe(1);
    const payload = JSON.parse(stdout.text) as { ok: boolean; error: string };
    expect(payload.ok).toBe(false);
    expect(payload.error).toContain("IRIS_GOVERNANCE_FILE is invalid");
    expect(stderr.text).toContain("IRIS_GOVERNANCE_FILE is invalid");
  });

  it("--json on a valid file emits ok:true with counts", async () => {
    writeGovernance({ global: { iris_doc_put: false } });
    const { deps, stdout } = baseDeps();
    const code = await runCli(["validate", "--file", file, "--json"], deps);
    expect(code).toBe(0);
    const payload = JSON.parse(stdout.text) as { ok: boolean; globalKeys: number; profiles: number };
    expect(payload).toMatchObject({ ok: true, globalKeys: 1, profiles: 0 });
  });

  it("no --file and no IRIS_GOVERNANCE_FILE exits 2 (usage) naming both resolution sources", async () => {
    const { deps, stderr } = baseDeps();
    const code = await runCli(["validate"], deps);
    expect(code).toBe(2);
    expect(stderr.text).toContain("pass --file <path> or set IRIS_GOVERNANCE_FILE");
  });

  it('an empty --file "" is treated as unset (exit 2 usage), never a phantom-valid empty path', async () => {
    const { deps, stderr } = baseDeps();
    const code = await runCli(["validate", "--file", ""], deps);
    expect(code).toBe(2);
    expect(stderr.text).toContain("pass --file <path> or set IRIS_GOVERNANCE_FILE");
  });

  it("falls back to IRIS_GOVERNANCE_FILE when --file is absent (resolution order)", async () => {
    writeGovernance({ global: { iris_doc_put: false } });
    const { deps, stdout } = baseDeps({ IRIS_GOVERNANCE_FILE: file });
    const code = await runCli(["validate"], deps);
    expect(code).toBe(0);
    expect(stdout.text).toContain("is a valid governance file");
  });

  it("--file WINS over IRIS_GOVERNANCE_FILE (resolution order)", async () => {
    const envFile = path.join(dir, "env.json");
    writeGovernance("{ not json", envFile); // invalid via env…
    writeGovernance({ global: {} }); // …but valid via --file
    const { deps, stdout } = baseDeps({ IRIS_GOVERNANCE_FILE: envFile });
    const code = await runCli(["validate", "--file", file], deps);
    expect(code).toBe(0);
    expect(stdout.text).toContain("is a valid governance file");
  });
});

// ── get ────────────────────────────────────────────────────────────────

describe("get", () => {
  it("prints the file's explicit global-layer value", async () => {
    writeGovernance({ global: { iris_doc_put: false } });
    const { deps, stdout } = baseDeps();
    const code = await runCli(["get", "iris_doc_put", "--file", file], deps);
    expect(code).toBe(0);
    expect(stdout.text).toBe(`"iris_doc_put" = false  (${file}, global layer)\n`);
  });

  it("prints the profile-layer value with --profile", async () => {
    writeGovernance({ profiles: { prod: { iris_doc_put: true } } });
    const { deps, stdout } = baseDeps();
    const code = await runCli(["get", "iris_doc_put", "--profile", "prod", "--file", file], deps);
    expect(code).toBe(0);
    expect(stdout.text).toContain('"iris_doc_put" = true');
    expect(stdout.text).toContain('profile "prod" layer');
  });

  it("an unset key reports not-set (exit 0, value null in --json)", async () => {
    writeGovernance({ global: { iris_doc_put: false } });
    const { deps, stdout } = baseDeps();
    const code = await runCli(["get", "iris_sql_execute", "--file", file, "--json"], deps);
    expect(code).toBe(0);
    const payload = JSON.parse(stdout.text) as { key: string; value: boolean | null };
    expect(payload).toMatchObject({ key: "iris_sql_execute", value: null });
  });

  it("a key set only at the global layer is NOT read through --profile (layers are distinct)", async () => {
    writeGovernance({ global: { iris_doc_put: false } });
    const { deps, stdout } = baseDeps();
    const code = await runCli(["get", "iris_doc_put", "--profile", "prod", "--file", file], deps);
    expect(code).toBe(0);
    expect(stdout.text).toContain("is not set");
  });

  it("a reserved key is rejected with exit 2 before any file read", async () => {
    writeGovernance({});
    const { deps, stderr } = baseDeps();
    const code = await runCli(["get", "__proto__", "--file", file], deps);
    expect(code).toBe(2);
    expect(stderr.text).toContain("reserved key");
  });

  it("an invalid file exits 1 and --json still emits parseable JSON", async () => {
    writeGovernance("{ not json");
    const { deps, stdout } = baseDeps();
    const code = await runCli(["get", "iris_doc_put", "--file", file, "--json"], deps);
    expect(code).toBe(1);
    const payload = JSON.parse(stdout.text) as { error: string };
    expect(payload.error).toContain("IRIS_GOVERNANCE_FILE is invalid");
  });
});

// ── set ────────────────────────────────────────────────────────────────

describe("set", () => {
  it("creates a missing file and writes the key (the AC 32.1.3 'create file' step)", async () => {
    const { deps, stdout } = baseDeps();
    const code = await runCli(["set", "iris_doc_put", "false", "--file", file], deps);
    expect(code).toBe(0);
    expect(stdout.text).toContain(`Created ${file} and set "iris_doc_put" = false (global layer).`);
    expect(JSON.parse(readFileSync(file, "utf8"))).toEqual({ global: { iris_doc_put: false } });
  });

  it("a missing PARENT directory is an operational failure (exit 1), no file created", async () => {
    const missing = path.join(dir, "no-such-dir", "governance.json");
    const { deps, stderr } = baseDeps();
    const code = await runCli(["set", "iris_doc_put", "false", "--file", missing], deps);
    expect(code).toBe(1);
    expect(stderr.text).toContain("does not exist");
    expect(existsSync(missing)).toBe(false);
  });

  it("writes the profile layer with --profile, preserving the existing global layer", async () => {
    writeGovernance({ global: { iris_sql_execute: false } });
    const { deps } = baseDeps();
    const code = await runCli(["set", "iris_doc_put", "true", "--profile", "prod", "--file", file], deps);
    expect(code).toBe(0);
    expect(JSON.parse(readFileSync(file, "utf8"))).toEqual({
      global: { iris_sql_execute: false },
      profiles: { prod: { iris_doc_put: true } },
    });
  });

  it("preserves existing key order; new keys append (AC 32.1.2)", async () => {
    writeGovernance({ global: { alpha_key: true, beta_key: false } });
    const { deps } = baseDeps();
    // New key appends AFTER the existing two…
    expect(await runCli(["set", "gamma_key", "true", "--file", file], deps)).toBe(0);
    expect(Object.keys(JSON.parse(readFileSync(file, "utf8")).global)).toEqual([
      "alpha_key",
      "beta_key",
      "gamma_key",
    ]);
    // …and re-setting an EXISTING key keeps its position.
    expect(await runCli(["set", "alpha_key", "false", "--file", file], deps)).toBe(0);
    expect(Object.keys(JSON.parse(readFileSync(file, "utf8")).global)).toEqual([
      "alpha_key",
      "beta_key",
      "gamma_key",
    ]);
    expect(JSON.parse(readFileSync(file, "utf8")).global.alpha_key).toBe(false);
  });

  it("the written file validates with the REAL loader (production validator round-trip)", async () => {
    const { deps } = baseDeps();
    expect(await runCli(["set", "iris_doc_put", "false", "--file", file], deps)).toBe(0);
    expect(loadGovernanceFile({ IRIS_GOVERNANCE_FILE: file })).toEqual({
      global: { iris_doc_put: false },
    });
  });

  it("leaves NO stray temp file on success (the CR 10.2 lesson)", async () => {
    const { deps } = baseDeps();
    expect(await runCli(["set", "iris_doc_put", "false", "--file", file], deps)).toBe(0);
    const strays = readdirSync(dir).filter((name) => name.includes(".tmp-"));
    expect(strays).toEqual([]);
  });

  it("rejects a reserved key with exit 2 and writes nothing (__proto__-safe mutation)", async () => {
    const { deps, stderr } = baseDeps();
    const code = await runCli(["set", "__proto__", "false", "--file", file], deps);
    expect(code).toBe(2);
    expect(stderr.text).toContain("reserved key");
    expect(existsSync(file)).toBe(false);
  });

  it("rejects a non-boolean value with exit 2 and writes nothing", async () => {
    const { deps, stderr } = baseDeps();
    const code = await runCli(["set", "iris_doc_put", "yes", "--file", file], deps);
    expect(code).toBe(2);
    expect(stderr.text).toContain('must be exactly "true" or "false"');
    expect(existsSync(file)).toBe(false);
  });

  it("warns (stderr, non-fatal) on a non-baseline key but still writes it (recorded decision: warn-not-reject)", async () => {
    const { deps, stderr } = baseDeps();
    const code = await runCli(["set", "iris_env_promote:execute", "true", "--file", file], deps);
    expect(code).toBe(0);
    expect(stderr.text).toContain("is not a pre-foundation (baseline) governance key");
    expect(JSON.parse(readFileSync(file, "utf8"))).toEqual({
      global: { "iris_env_promote:execute": true },
    });
  });

  it("no warning for a baseline key", async () => {
    const baselineKey = [...GOVERNANCE_BASELINE][0] as string;
    const { deps, stderr } = baseDeps();
    const code = await runCli(["set", baselineKey, "false", "--file", file], deps);
    expect(code).toBe(0);
    expect(stderr.text).toBe("");
  });

  it("an invalid EXISTING file exits 1 (loader text) and is left byte-for-byte untouched", async () => {
    writeGovernance("{ not json");
    const before = readFileSync(file, "utf8");
    const { deps, stderr } = baseDeps();
    const code = await runCli(["set", "iris_doc_put", "false", "--file", file], deps);
    expect(code).toBe(1);
    expect(stderr.text).toContain("could not parse JSON");
    expect(readFileSync(file, "utf8")).toBe(before);
  });

  it("a DIRECTORY as --file exits 1 with the loader's clean text, not a raw EISDIR (review patch: loader before raw read)", async () => {
    const { deps, stderr } = baseDeps();
    const code = await runCli(["set", "iris_doc_put", "false", "--file", dir], deps);
    expect(code).toBe(1);
    expect(stderr.text).toContain("IRIS_GOVERNANCE_FILE is invalid");
    expect(stderr.text).toContain("could not read the file");
  });
});

// ── writeGovernanceFileAtomic (rollback contract) ─────────────────────

describe("writeGovernanceFileAtomic", () => {
  it("rolls back to the original bytes when post-write validation fails", () => {
    writeGovernance({ global: { iris_doc_put: true } });
    const original = readFileSync(file, "utf8");
    expect(() =>
      writeGovernanceFileAtomic(file, "{}\n", original, () => {
        throw new Error("synthetic post-write validation failure");
      }),
    ).toThrow("synthetic post-write validation failure");
    expect(readFileSync(file, "utf8")).toBe(original);
    expect(readdirSync(dir).filter((name) => name.includes(".tmp-"))).toEqual([]);
  });

  it("removes a NEWLY-created file when post-write validation fails (no pre-existing content)", () => {
    expect(() =>
      writeGovernanceFileAtomic(file, "{}\n", undefined, () => {
        throw new Error("synthetic post-write validation failure");
      }),
    ).toThrow("synthetic post-write validation failure");
    expect(existsSync(file)).toBe(false);
    expect(readdirSync(dir).filter((name) => name.includes(".tmp-"))).toEqual([]);
  });

  it("returns the validated config on success (production validator)", () => {
    const config = writeGovernanceFileAtomic(file, '{"global":{"iris_doc_put":false}}\n', undefined);
    expect(config).toEqual({ global: { iris_doc_put: false } });
    expect(readdirSync(dir).filter((name) => name.includes(".tmp-"))).toEqual([]);
  });
});

// ── 32-1-R3 (Story 32.4): unknown top-level keys survive set/unset ──────

describe("32-1-R3 — unknown top-level keys are preserved on write; layer-shaped typos warn", () => {
  it("set preserves unknown top-level keys verbatim (annotation keys are NOT dropped on rewrite)", async () => {
    writeGovernance({ version: 1, comment: "team policy", global: { iris_doc_put: true } });
    const { deps, stderr } = baseDeps();
    const code = await runCli(["set", "iris_sql_execute", "false", "--file", file], deps);
    expect(code).toBe(0);
    // Non-layer-shaped unknown keys are preserved SILENTLY (no warning).
    expect(stderr.text).toBe("");
    expect(JSON.parse(readFileSync(file, "utf8"))).toEqual({
      version: 1,
      comment: "team policy",
      global: { iris_doc_put: true, iris_sql_execute: false },
    });
  });

  it("unset preserves unknown top-level keys too", async () => {
    writeGovernance({ comment: "keep me", global: { iris_doc_put: true, iris_sql_execute: false } });
    const { deps } = baseDeps();
    const code = await runCli(["unset", "iris_doc_put", "--file", file], deps);
    expect(code).toBe(0);
    expect(JSON.parse(readFileSync(file, "utf8"))).toEqual({
      comment: "keep me",
      global: { iris_sql_execute: false },
    });
  });

  it("a layer-SHAPED unknown key (\"globals\") warns that it has no effect, and is still preserved", async () => {
    writeGovernance({ globals: { iris_doc_put: false }, global: { iris_sql_execute: true } });
    const { deps, stderr } = baseDeps();
    const code = await runCli(["set", "iris_doc_put", "true", "--file", file], deps);
    expect(code).toBe(0);
    expect(stderr.text).toContain('"globals"');
    expect(stderr.text).toContain("NO effect");
    expect(stderr.text).toContain("preserved as-is");
    // The typo'd layer is preserved (never silently dropped), and the real
    // layer got the write.
    expect(JSON.parse(readFileSync(file, "utf8"))).toEqual({
      globals: { iris_doc_put: false },
      global: { iris_sql_execute: true, iris_doc_put: true },
    });
  });

  it("unknown keys keep their original position; mutated layers keep theirs", async () => {
    writeGovernance({ global: { iris_doc_put: true }, comment: "middle", profiles: { prod: {} } });
    const { deps } = baseDeps();
    const code = await runCli(["set", "iris_sql_execute", "false", "--file", file], deps);
    expect(code).toBe(0);
    expect(Object.keys(JSON.parse(readFileSync(file, "utf8")))).toEqual([
      "global",
      "comment",
      "profiles",
    ]);
  });
});

// ── 32-1-R4 (Story 32.4): the help check honors the dash-value contract ──

describe("32-1-R4 — help is honored only in option position", () => {
  it("get -- -h addresses the KEY \"-h\" (the -- terminator), it does NOT print help", async () => {
    writeGovernance({ global: { iris_doc_put: true } });
    const { deps, stdout, stderr } = baseDeps();
    const code = await runCli(["get", "--file", file, "--", "-h"], deps);
    // The key "-h" is simply not set — the ordinary not-set report, NO help text.
    expect(code).toBe(0);
    expect(stdout.text).toContain('"-h" is not set');
    expect(stdout.text).not.toContain("Usage: iris-mcp-governance <command>");
    expect(stderr.text).toBe("");
  });

  it("validate --file --help treats --help as the --file VALUE (dash-value contract), not as a help request", async () => {
    const { deps, stdout, stderr } = baseDeps();
    const code = await runCli(["validate", "--file", "--help"], deps);
    // "--help" is the file path — unreadable, so exit 1 with the loader text.
    expect(code).toBe(1);
    expect(stdout.text).not.toContain("Usage: iris-mcp-governance <command>");
    expect(stderr.text).toContain("could not read the file");
  });

  it("set -h still prints help (option position is honored)", async () => {
    const { deps, stdout } = baseDeps();
    const code = await runCli(["set", "-h"], deps);
    expect(code).toBe(0);
    expect(stdout.text).toContain("Usage: iris-mcp-governance <command>");
  });
});

// ── 32-1-R6 (Story 32.4): writing through a symlinked governance file ────

describe("32-1-R6 — set/unset write THROUGH a symlink (the link survives)", () => {
  it("set on a symlinked file updates the TARGET and leaves the link a link", async () => {
    const target = path.join(dir, "real-governance.json");
    writeGovernance({ global: { iris_doc_put: true } }, target);
    const link = path.join(dir, "linked-governance.json");
    let symlinked = true;
    try {
      symlinkSync(target, link);
    } catch {
      // Windows without Developer Mode / privileges cannot create symlinks —
      // the nix/etckeeper scenario this pins is a posix one; skip there.
      symlinked = false;
    }
    if (!symlinked) return;

    const { deps } = baseDeps();
    const code = await runCli(["set", "iris_sql_execute", "false", "--file", link], deps);
    expect(code).toBe(0);
    expect(lstatSync(link).isSymbolicLink()).toBe(true);
    expect(JSON.parse(readFileSync(target, "utf8"))).toEqual({
      global: { iris_doc_put: true, iris_sql_execute: false },
    });
  });
});

// ── unset ──────────────────────────────────────────────────────────────

describe("unset", () => {
  it("removes a global-layer key", async () => {
    writeGovernance({ global: { iris_doc_put: false, iris_sql_execute: true } });
    const { deps, stdout } = baseDeps();
    const code = await runCli(["unset", "iris_doc_put", "--file", file], deps);
    expect(code).toBe(0);
    expect(stdout.text).toContain(`Unset "iris_doc_put" in ${file} (global layer).`);
    expect(JSON.parse(readFileSync(file, "utf8"))).toEqual({ global: { iris_sql_execute: true } });
  });

  it("removes a profile-layer key; an emptied profile stays a valid (empty) object", async () => {
    writeGovernance({ profiles: { prod: { iris_doc_put: false } } });
    const { deps } = baseDeps();
    const code = await runCli(["unset", "iris_doc_put", "--profile", "prod", "--file", file], deps);
    expect(code).toBe(0);
    expect(JSON.parse(readFileSync(file, "utf8"))).toEqual({ profiles: { prod: {} } });
    // …and the emptied file still validates with the real loader.
    expect(loadGovernanceFile({ IRIS_GOVERNANCE_FILE: file })).toEqual({ profiles: { prod: {} } });
  });

  it("an unset key that is not set exits 1 (the credentials-delete not-found convention)", async () => {
    writeGovernance({ global: { iris_doc_put: false } });
    const { deps, stderr } = baseDeps();
    const code = await runCli(["unset", "iris_sql_execute", "--file", file], deps);
    expect(code).toBe(1);
    expect(stderr.text).toContain("nothing to unset");
  });

  it("a missing file exits 1 with the loader text (unset never creates)", async () => {
    const { deps, stderr } = baseDeps();
    const code = await runCli(["unset", "iris_doc_put", "--file", file], deps);
    expect(code).toBe(1);
    expect(stderr.text).toContain("could not read the file");
    expect(existsSync(file)).toBe(false);
  });

  it("leaves no stray temp file", async () => {
    writeGovernance({ global: { iris_doc_put: false } });
    const { deps } = baseDeps();
    expect(await runCli(["unset", "iris_doc_put", "--file", file], deps)).toBe(0);
    expect(readdirSync(dir).filter((name) => name.includes(".tmp-"))).toEqual([]);
  });
});

// ── preset ─────────────────────────────────────────────────────────────

describe("preset", () => {
  it("prints env-level guidance and writes NOTHING (recorded decision: no file-default)", async () => {
    const { deps, stdout } = baseDeps();
    const code = await runCli(["preset", "read-only"], deps);
    expect(code).toBe(0);
    expect(stdout.text).toContain("IRIS_GOVERNANCE_PRESET");
    expect(stdout.text).toContain("writes nothing");
    expect(stdout.text).toContain('"read-only"');
    // Nothing was written anywhere — no file appeared in the temp dir.
    expect(readdirSync(dir)).toEqual([]);
  });

  it("rejects an unrecognized preset with exit 2 naming the valid values", async () => {
    const { deps, stderr } = baseDeps();
    const code = await runCli(["preset", "read_only"], deps);
    expect(code).toBe(2);
    expect(stderr.text).toContain("must be one of: read-only, full");
  });
});

// ── effective ──────────────────────────────────────────────────────────

describe("effective", () => {
  it("renders the cascade from the CLI's env + the resolved file — matching a DIRECT shared-engine call (single-sourcing proof)", async () => {
    writeGovernance({ global: { iris_doc_put: false }, profiles: { default: { iris_sql_execute: false } } });
    const env = {
      IRIS_GOVERNANCE: JSON.stringify({ global: { iris_doc_get: false } }),
    };
    const { deps, stdout } = baseDeps(env);
    const code = await runCli(["effective", "--file", file, "--json"], deps);
    expect(code).toBe(0);
    const payload = JSON.parse(stdout.text) as {
      profile: string;
      policy: Record<string, boolean>;
      configSource: Record<string, GovernanceConfigSource>;
    };
    expect(payload.profile).toBe("default");

    // Independently compute the expected render with the SAME shared engine…
    const fileConfig = loadGovernanceFile({ IRIS_GOVERNANCE_FILE: file });
    const envConfig = { global: { iris_doc_get: false } };
    const keys = new Set<string>(GOVERNANCE_BASELINE);
    keys.add("iris_doc_put");
    keys.add("iris_sql_execute");
    keys.add("iris_doc_get");
    const emptyLookup = new Map<string, never>();
    for (const key of keys) {
      expect(payload.policy[key], `policy[${key}]`).toBe(
        effective(key, "default", envConfig, emptyLookup, GOVERNANCE_BASELINE, new Set(), undefined, BASELINE_ACTION_CLASSIFICATIONS, fileConfig),
      );
      expect(payload.configSource[key], `configSource[${key}]`).toBe(
        configSource(key, "default", envConfig, emptyLookup, undefined, BASELINE_ACTION_CLASSIFICATIONS, fileConfig),
      );
    }

    // …and spot-check the load-bearing semantics.
    expect(payload.policy["iris_doc_put"]).toBe(false);
    expect(payload.configSource["iris_doc_put"]).toBe("file");
    expect(payload.policy["iris_doc_get"]).toBe(false);
    expect(payload.configSource["iris_doc_get"]).toBe("env");
    expect(payload.policy["iris_sql_execute"]).toBe(false);
    expect(payload.configSource["iris_sql_execute"]).toBe("file");
  });

  it("env layers sit above file layers (AC 32.0.2 ordering at the CLI surface)", async () => {
    writeGovernance({ profiles: { default: { iris_doc_get: true } } });
    const env = { IRIS_GOVERNANCE: JSON.stringify({ global: { iris_doc_get: false } }) };
    const { deps, stdout } = baseDeps(env);
    const code = await runCli(["effective", "--file", file, "--json"], deps);
    expect(code).toBe(0);
    const payload = JSON.parse(stdout.text) as {
      policy: Record<string, boolean>;
      configSource: Record<string, string>;
    };
    expect(payload.policy["iris_doc_get"]).toBe(false);
    expect(payload.configSource["iris_doc_get"]).toBe("env");
  });

  it("with no file resolvable, renders env+seed only (no 'file' source anywhere)", async () => {
    const { deps, stdout } = baseDeps({});
    const code = await runCli(["effective", "--json"], deps);
    expect(code).toBe(0);
    const payload = JSON.parse(stdout.text) as { file: string | null; configSource: Record<string, string> };
    expect(payload.file).toBeNull();
    for (const source of Object.values(payload.configSource)) {
      expect(source).not.toBe("file");
    }
  });

  it("an invalid IRIS_GOVERNANCE env exits 1 with the env channel's exact fail-fast text", async () => {
    const { deps, stderr } = baseDeps({ IRIS_GOVERNANCE: "{ not json" });
    const code = await runCli(["effective"], deps);
    expect(code).toBe(1);
    expect(stderr.text).toContain("IRIS_GOVERNANCE is invalid");
  });

  it("a read-only preset is reflected through the shared presetSeed layer (source: preset)", async () => {
    const { deps, stdout } = baseDeps({ IRIS_GOVERNANCE_PRESET: "read-only" });
    const code = await runCli(["effective", "--json"], deps);
    expect(code).toBe(0);
    const payload = JSON.parse(stdout.text) as {
      preset: string;
      policy: Record<string, boolean>;
      configSource: Record<string, string>;
    };
    expect(payload.preset).toBe("read-only");
    // A baseline WRITE-classified key resolves disabled with source 'preset'…
    expect(payload.policy["iris_doc_put"]).toBe(false);
    expect(payload.configSource["iris_doc_put"]).toBe("preset");
    // …and a baseline READ-classified key stays enabled.
    expect(payload.policy["iris_doc_get"]).toBe(true);
  });

  it("--profile selects the profile layer of the render", async () => {
    writeGovernance({ profiles: { prod: { iris_doc_put: false } } });
    const { deps, stdout } = baseDeps();
    const code = await runCli(["effective", "--profile", "prod", "--file", file, "--json"], deps);
    expect(code).toBe(0);
    const payload = JSON.parse(stdout.text) as {
      profile: string;
      policy: Record<string, boolean>;
      configSource: Record<string, string>;
    };
    expect(payload.profile).toBe("prod");
    expect(payload.policy["iris_doc_put"]).toBe(false);
    expect(payload.configSource["iris_doc_put"]).toBe("file");
  });
});

// ── diff ───────────────────────────────────────────────────────────────

describe("diff", () => {
  it("compares every file entry against the default seed (baseline keys seed true)", async () => {
    writeGovernance({
      global: { iris_doc_put: false, iris_doc_get: true },
      profiles: { prod: { iris_sql_execute: false } },
    });
    const { deps, stdout } = baseDeps();
    const code = await runCli(["diff", "--file", file, "--json"], deps);
    expect(code).toBe(0);
    const payload = JSON.parse(stdout.text) as {
      entries: Array<{ layer: string; key: string; file: boolean; default: boolean; differs: boolean }>;
    };
    expect(payload.entries).toEqual([
      { layer: "global", key: "iris_doc_put", file: false, default: true, differs: true },
      { layer: "global", key: "iris_doc_get", file: true, default: true, differs: false },
      { layer: "profile \"prod\"", key: "iris_sql_execute", file: false, default: true, differs: true },
    ]);
  });

  it("a file that sets no keys reports defaults-govern-everything", async () => {
    writeGovernance({});
    const { deps, stdout } = baseDeps();
    const code = await runCli(["diff", "--file", file], deps);
    expect(code).toBe(0);
    expect(stdout.text).toContain("sets no keys");
  });

  it("an invalid file exits 1 and --json still emits parseable JSON", async () => {
    writeGovernance("{ not json");
    const { deps, stdout } = baseDeps();
    const code = await runCli(["diff", "--file", file, "--json"], deps);
    expect(code).toBe(1);
    const payload = JSON.parse(stdout.text) as { error: string };
    expect(payload.error).toContain("IRIS_GOVERNANCE_FILE is invalid");
  });
});

describe("32-4-R1 — VALUED_OPTIONS single-sourcing pin", () => {
  it("every parseArgs call site's allowed options are a subset of VALUED_OPTIONS, and helpRequested consumes the same set", () => {
    // Mechanical cross-check (the finding's ask): a valued option added to a
    // command's parseArgs call but NOT to VALUED_OPTIONS makes helpRequested
    // treat that option's value as a flag — the 32-1-R4 class. Scan the
    // source so the lists can never silently diverge.
    const source = readFileSync(new URL("../cli/governance.ts", import.meta.url), "utf8");
    const callSites = [...source.matchAll(/parseArgs\(\s*args\s*,\s*\[[^\]]*\]\s*,\s*\[([^\]]*)\]/g)];
    expect(callSites.length).toBeGreaterThanOrEqual(7);
    const used = new Set<string>();
    for (const site of callSites) {
      for (const opt of site[1]!.match(/"--[a-z-]+"/g) ?? []) used.add(opt.slice(1, -1));
    }
    for (const opt of used) {
      expect(VALUED_OPTIONS.has(opt), `parseArgs option ${opt} missing from VALUED_OPTIONS`).toBe(true);
    }
    // helpRequested must skip values for exactly the same set — a second
    // hand-maintained literal is the defect this pin exists to catch.
    expect(source).toContain("const valuedOptions = VALUED_OPTIONS");
    expect(source).not.toMatch(/const valuedOptions = new Set\(/);
  });
});
