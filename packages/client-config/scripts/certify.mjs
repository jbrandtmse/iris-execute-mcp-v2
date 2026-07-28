#!/usr/bin/env node
/**
 * `certify.mjs` — the adapter certification harness (Epic 33, Story 33.4;
 * AC 33.4.1/33.4.4, spec §3.7 certification discipline).
 *
 * Runs ONE scripted certification pass for ONE locally installed client
 * against its REAL config file, then restores everything byte-exact:
 *
 *   add (engine apply) → client surfaces the entry → disable → absent →
 *   remove → byte-exact restore of the config + manager state cleanup.
 *
 * SAFETY (the 33.3 real-config-overwrite incident is the precedent):
 * - Every config write goes through the BUILT `iris-mcp-clients` CLI (the
 *   engine — backup-on-write), never a hand edit.
 * - The pre-pass config bytes (or absence), the manager state.json, and the
 *   backup-dir listing are snapshotted FIRST.
 * - Restore is VERIFIED byte-exact, with a ladder: (1) `remove` round-trip;
 *   (2) engine `restore --backup <earliest pass backup>`; (3) raw write-back
 *   of the captured snapshot — a RESTORE, loudly reported, never silent.
 * - Manager side effects are cleaned up: pass-created backups deleted,
 *   state.json restored to its pre-pass bytes (or removed if the pass
 *   created it), Kimi session artifacts from the pass removed.
 * - Bare invocation is a no-op plan print; a real pass requires BOTH the
 *   `run` subcommand AND `--real-config`.
 *
 * Usage:
 *   node scripts/certify.mjs run <clientId> [--server iris-mcp-all] --real-config [--skip-agent]
 *
 * Results are merged into scripts/certification-results.json (keyed by
 * client id; other clients' records untouched).
 */

import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { mergeCertificationRecord, passCreatedPaths } from "./certify-record.mjs";

const PACKAGE_ROOT = fileURLToPath(new URL("..", import.meta.url));
const BIN = path.join(PACKAGE_ROOT, "dist", "cli", "clients-cli.js");
const RESULTS_PATH = path.join(PACKAGE_ROOT, "scripts", "certification-results.json");

// 33-5-17 (AC 33.5.7): the client roster is DERIVED from CLIENT_ADAPTERS —
// never a hand-mirrored literal (a 14th adapter would have been invisible
// here). Requires a built dist, same as render-certification-table.mjs.
const { CLIENT_ADAPTERS } = await import("../dist/adapters.js");
const CLIENT_IDS = Object.keys(CLIENT_ADAPTERS);

const TODAY = new Date().toISOString().slice(0, 10);
const DUMMY_PASSWORD = "cert-pass-not-a-real-credential"; // explicit mode (vscode): a placeholder, never a real secret

// ────────────────────────────────────────────────────────────────────
// Small utilities.
// ────────────────────────────────────────────────────────────────────

function fail(message) {
  console.error(`certify: ${message}`);
  process.exit(2);
}

function run(cmd, args, opts = {}) {
  const result = spawnSync(cmd, args, {
    encoding: "utf8",
    timeout: opts.timeout ?? 180_000,
    input: opts.input,
    cwd: opts.cwd,
    env: opts.env,
  });
  return {
    status: result.status,
    timedOut: result.error?.code === "ETIMEDOUT",
    spawnError: result.error ? String(result.error.code ?? result.error) : undefined,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

/**
 * Spawn a command that may be a .cmd/.bat shim on Windows (e.g. the npm
 * global `claude`). A bare spawnSync("claude", ...) cannot execute the shim
 * (ENOENT; EINVAL since CVE-2024-27980) — route through cmd.exe /d /s /c
 * with the argv array intact (the Story 32.2 review pattern; shell:true is
 * rejected for its unescaped concatenation).
 */
function runMaybeShim(cmd, args, opts = {}) {
  if (process.platform === "win32") {
    const quoted = [cmd, ...args]
      .map((a) => (/[\s"&|<>^]/.test(a) ? `"${a.replace(/"/g, '\\"')}"` : a))
      .join(" ");
    return run("cmd.exe", ["/d", "/s", "/c", quoted], opts);
  }
  return run(cmd, args, opts);
}

function cli(args, opts = {}) {
  return run(process.execPath, [BIN, ...args], opts);
}

function envelope(result, label) {
  try {
    return JSON.parse(result.stdout);
  } catch {
    throw new Error(`${label}: stdout was not a JSON envelope:\n${result.stdout}\n(stderr: ${result.stderr})`);
  }
}

function excerpt(text, max = 400) {
  const oneLine = text.replace(/\s+/g, " ").trim();
  return oneLine.length > max ? `${oneLine.slice(0, max)}…` : oneLine;
}

/** Recursively list files under dir (relative paths, sorted); [] when absent. */
function listFiles(dir) {
  if (!existsSync(dir)) return [];
  const out = [];
  const walk = (current) => {
    for (const name of readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, name.name);
      if (name.isDirectory()) walk(full);
      else out.push(path.relative(dir, full));
    }
  };
  walk(dir);
  return out.sort();
}

/** Recursively list DIRECTORIES under dir (relative paths, sorted); [] when absent. */
function listDirs(dir) {
  if (!existsSync(dir)) return [];
  const out = [];
  const walk = (current) => {
    for (const name of readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, name.name);
      if (name.isDirectory()) {
        out.push(path.relative(dir, full));
        walk(full);
      }
    }
  };
  walk(dir);
  return out.sort();
}

// ────────────────────────────────────────────────────────────────────
// Argument parsing (manual, mirrors the repo's no-framework CLI style).
// ────────────────────────────────────────────────────────────────────

const argv = process.argv.slice(2);
const subcommand = argv[0];
const positional = [];
const flags = new Set();
for (let i = 1; i < argv.length; i++) {
  const arg = argv[i];
  if (arg === "--server") {
    flags.server = argv[++i];
  } else if (arg === "--residual-risk") {
    flags.residualRisk = argv[++i];
  } else if (arg.startsWith("--")) {
    flags.add(arg);
  } else {
    positional.push(arg);
  }
}
const clientId = positional[0];
const server = flags.server ?? "iris-mcp-all";

if (subcommand !== "run" || !flags.has("--real-config")) {
  console.log(
    `certify — adapter certification harness (Story 33.4)\n\n` +
      `A bare invocation does NOTHING. To run a REAL certification pass:\n\n` +
      `  node scripts/certify.mjs run <clientId> --real-config [--server iris-mcp-all] [--skip-agent]\n\n` +
      `clients: ${CLIENT_IDS.join(", ")}\n\n` +
      `The pass writes the REAL user-scope config of the named client through the\n` +
      `built iris-mcp-clients engine (backup-on-write), verifies the client surfaces\n` +
      `the entry, then restores the pre-pass bytes (verified byte-exact) and cleans\n` +
      `up manager side effects (state.json, pass-created backups, Kimi sessions).`,
  );
  process.exit(subcommand === undefined ? 0 : 2);
}
if (!clientId || !CLIENT_IDS.includes(clientId)) {
  fail(`a client id is required (${CLIENT_IDS.join(", ")})`);
}
if (!existsSync(BIN)) {
  fail(`the built CLI is missing at ${BIN} — run "npm run build" in packages/client-config first`);
}

// ────────────────────────────────────────────────────────────────────
// Client-specific verification surfaces.
// ────────────────────────────────────────────────────────────────────

const HOME = process.env.USERPROFILE ?? process.env.HOME ?? "";
const KIMI_BIN = process.platform === "win32"
  ? path.join(HOME, ".kimi-code", "bin", "kimi.exe")
  : path.join(HOME, ".kimi-code", "bin", "kimi");

/** File-level status probe shared by the clients whose agent-side tool
 * listing is a manual GUI step (never claimed here). */
function verifyFileLevel(client, entryName, agentNote) {
  const status = cli(["status", "--json"]);
  const payload = envelope(status, "status");
  const row = payload.data.clients
    .find((entry) => entry.client === client)
    ?.scopes.flatMap((scope) => scope.servers)
    .find((s) => s.server === entryName);
  const fileLevel = row?.state === "present-enabled";
  return {
    ok: fileLevel,
    summary: fileLevel
      ? `file-level: "${entryName}" present-enabled${agentNote}`
      : `file-level: "${entryName}" NOT present-enabled`,
    evidence: [`$ iris-mcp-clients status --json → ${client} ${entryName} = ${row?.state ?? "missing"}`],
  };
}

/**
 * The scripted verification surfaces, keyed by client id — the SINGLE
 * source for "which clients can be certified live" (AC 33.5.6c: the
 * fail-fast gate derives from THIS map, so a surface added here is
 * immediately certifiable and a missing one is refused BEFORE any write).
 */
const VERIFIERS = {
  "claude-code": (entryName) => {
    const result = runMaybeShim("claude", ["mcp", "list"], { timeout: 240_000 });
    // 33-4-R3: line-anchored ("name:" at a line start), never a bare
    // substring — "iris-mcp-all" also matches "iris-mcp-all-2".
    const listed = result.stdout
      .split("\n")
      .some((line) => line.trimStart().startsWith(`${entryName}:`) || line.trim() === entryName);
    return {
      ok: listed,
      summary: listed
        ? `\`claude mcp list\` listed the manager-written entry "${entryName}"`
        : `\`claude mcp list\` did NOT list "${entryName}"${result.spawnError ? ` (spawn error: ${result.spawnError})` : ""}`,
      evidence: [
        `$ claude mcp list → ${excerpt(result.stdout.split("\n").find((line) => line.includes(entryName)) ?? result.stdout)}`,
      ],
    };
  },
  "kimi-code": (entryName, skipAgent) => {
    // File-level first (deterministic): the engine's own matrix reads the
    // file the manager wrote.
    const base = verifyFileLevel("kimi-code", entryName, "");
    const evidence = [...base.evidence];
    let agentNote = "agent-surface probe skipped (--skip-agent)";
    if (!skipAgent && existsSync(KIMI_BIN)) {
      // The agent surface: kimi answers which MCP servers it has. The added
      // entry's npx target is unpublished pre-release, so the honest
      // expectation is recorded, not forced.
      const probe = run(
        KIMI_BIN,
        ["-p", `List the MCP servers available in this session as a bare comma-separated list of names, then stop.`, "--output-format", "stream-json"],
        { timeout: 240_000, cwd: scratchWorkdir() },
      );
      agentNote = excerpt(`${probe.stdout} ${probe.stderr}`, 600);
      evidence.push(`$ kimi -p "list MCP servers" → ${excerpt(probe.stdout || probe.stderr, 300)}`);
    }
    return {
      ok: base.ok,
      summary: base.ok
        ? `file-level: "${entryName}" present-enabled in ~/.kimi-code/mcp.json (agent surface: ${agentNote})`
        : base.summary,
      evidence,
    };
  },
  vscode: (entryName) =>
    // File-level round-trip; the agent-side tool listing is a manual GUI
    // step (AC 33.3.4 pattern) and is NEVER claimed here.
    verifyFileLevel("vscode", entryName, " (agent-side tool listing stays a manual GUI step — not claimed)"),
  cline: (entryName) =>
    verifyFileLevel("cline", entryName, " (agent-side tool listing stays a manual GUI step — not claimed)"),
};

// AC 33.5.6c: a client with NO scripted verification surface fails fast —
// BEFORE detection, snapshots, or any engine write (previously the pass
// discovered this AFTER the real-config write had already landed).
if (!(clientId in VERIFIERS)) {
  fail(
    `${clientId} has no scripted verification surface (scripted: ${Object.keys(VERIFIERS).join(", ")}) — ` +
      `its disposition stays fixture-only-with-residual-risk; refusing BEFORE any real-config write`,
  );
}

/**
 * Verify the client surfaces the added entry. Returns
 * { ok, summary, evidence[] } — evidence strings are quoted command/output
 * pairs for the results record (never file contents, never secrets).
 */
function verifyPresent(client, entryName, skipAgent) {
  const verifier = VERIFIERS[client];
  if (!verifier) {
    // Unreachable through the pass (the fail-fast gate above); defensive for
    // direct import.
    return { ok: false, summary: `no scripted verification surface for ${client}`, evidence: [] };
  }
  return verifier(entryName, skipAgent);
}

/** A scratch working directory for kimi -p probes (session artifacts land here). */
let scratchDir = null;
function scratchWorkdir() {
  if (scratchDir === null) {
    scratchDir = path.join(tmpdir(), `iris-cert-kimi-${process.pid}`);
    mkdirSync(scratchDir, { recursive: true });
  }
  return scratchDir;
}

// ────────────────────────────────────────────────────────────────────
// The pass.
// ────────────────────────────────────────────────────────────────────

const evidence = [];
const steps = [];
let passOk = true;

function step(name, ok, detail) {
  steps.push({ name, ok });
  evidence.push(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) passOk = false;
  console.log(`${ok ? "✓" : "✗"} ${name}${detail ? ` — ${detail}` : ""}`);
}

// 0. Detect: refuse when the client is not installed, or the entry already exists.
const detection = envelope(cli(["detect", "--json"]), "detect");
const detected = detection.data.clients.find((row) => row.client === clientId);
if (!detected?.detected) {
  fail(`${clientId} is not detected on this machine — disposition stays fixture-only-with-residual-risk`);
}
const userProbe = detected.probes.find((probe) => probe.kind === "config" && probe.scope === "user");
if (!userProbe) fail(`${clientId} has no user-scope config probe`);
const configPath = userProbe.path;

const preStatus = envelope(cli(["status", "--json"]), "status");
const preRow = preStatus.data.clients
  .find((entry) => entry.client === clientId)
  ?.scopes.flatMap((scope) => scope.servers)
  .find((s) => s.server === server);
if (preRow && preRow.state !== "absent") {
  fail(
    `"${server}" already exists in ${configPath} (state: ${preRow.state}) — refusing to clobber a real entry; pick a different --server ` +
      `(to roll the file back to a pre-write state instead, use: iris-mcp-clients restore --client ${clientId})`,
  );
}

// 1. Snapshots (BEFORE any write). The config bytes are captured as a
// BUFFER (33-4-R2): a utf8 string round-trip is lossy for non-UTF-8 files,
// so a string comparison could report "byte-exact" while the raw write-back
// silently re-encodes — Buffer.compare/write make byte-exact literal.
const preConfigBytes = existsSync(configPath) ? readFileSync(configPath) : null;
const stateDir = path.join(HOME, ".iris-mcp", "client-manager");
const statePath = path.join(stateDir, "state.json");
const preStateBytes = existsSync(statePath) ? readFileSync(statePath, "utf8") : null;
const backupRoot = path.join(stateDir, "backups");
const preBackups = listFiles(backupRoot);
// 33-5-18: pass-created empty DIRECTORIES strand even after every file is
// deleted — snapshot the dir listing too so they are cleaned as well.
const preBackupDirs = listDirs(backupRoot);
const kimiSessionIndex = path.join(HOME, ".kimi-code", "session_index.jsonl");
const preKimiIndex = existsSync(kimiSessionIndex) ? readFileSync(kimiSessionIndex, "utf8") : null;
const kimiSessionsRoot = path.join(HOME, ".kimi-code", "sessions");
const preKimiSessions = clientId === "kimi-code" ? listFiles(kimiSessionsRoot) : [];
const preKimiSessionDirs = clientId === "kimi-code" ? listDirs(kimiSessionsRoot) : [];

step("snapshot", true, `config ${preConfigBytes === null ? "absent" : `${preConfigBytes.length} bytes`}; state.json ${preStateBytes === null ? "absent" : "present"}; ${preBackups.length} pre-existing backup(s)`);

// 2. Restore ladder + cleanup, executed in `finally` no matter how the pass ends.
/** null-safe Buffer comparison for the byte-exact restore checks (33-4-R2). */
function bytesEqual(a, b) {
  if (a === null || b === null) return a === b;
  return Buffer.compare(a, b) === 0;
}

function restoreAndClean() {
  const report = [];
  // (a) Config bytes.
  const nowBytes = existsSync(configPath) ? readFileSync(configPath) : null;
  if (!bytesEqual(nowBytes, preConfigBytes)) {
    // Engine restore from the EARLIEST pass-created backup (the pre-first-write snapshot).
    const postBackups = listFiles(backupRoot);
    const created = postBackups.filter((file) => !preBackups.includes(file)).sort();
    if (created.length > 0) {
      const earliest = path.basename(created[0]);
      const restored = cli(["restore", "--client", clientId, "--backup", earliest, "--json"]);
      report.push(`engine restore --backup ${earliest}: exit ${restored.status}`);
    }
    const afterEngine = existsSync(configPath) ? readFileSync(configPath) : null;
    if (!bytesEqual(afterEngine, preConfigBytes)) {
      // Last resort: write back the captured snapshot (a RESTORE, not an edit).
      if (preConfigBytes === null) {
        rmSync(configPath, { force: true });
      } else {
        writeFileSync(configPath, preConfigBytes);
      }
      const finalBytes = existsSync(configPath) ? readFileSync(configPath) : null;
      report.push(`RAW snapshot restore performed (byte-exact: ${bytesEqual(finalBytes, preConfigBytes)}) — LOUD: investigate why the engine path did not converge`);
    }
  }
  const configOk = bytesEqual(existsSync(configPath) ? readFileSync(configPath) : null, preConfigBytes);
  // (b) Manager state.json.
  const nowState = existsSync(statePath) ? readFileSync(statePath, "utf8") : null;
  if (nowState !== preStateBytes) {
    if (preStateBytes === null) {
      rmSync(statePath, { force: true });
      report.push("state.json removed (the pass created it)");
    } else {
      writeFileSync(statePath, preStateBytes, "utf8");
      report.push("state.json restored to pre-pass bytes");
    }
  }
  // (c) Pass-created backups, then the pass-created backup DIRECTORIES
  // (deepest-first — file deletion alone leaves empty shells, 33-5-18).
  for (const file of passCreatedPaths(preBackups, listFiles(backupRoot))) {
    rmSync(path.join(backupRoot, file), { force: true });
  }
  for (const dir of passCreatedPaths(preBackupDirs, listDirs(backupRoot))) {
    rmSync(path.join(backupRoot, dir), { recursive: true, force: true });
  }
  // (d) Kimi session artifacts from the pass (kimi-code only): pass-created
  // session FILES, then any pass-created DIRECTORY (session dirs hold their
  // files; deleting files alone would leave empty shells behind).
  if (clientId === "kimi-code") {
    // 33-4-R4: restore the pre-pass index bytes — or REMOVE a pass-created
    // index (preKimiIndex null); leaving it behind strands a session record.
    if (preKimiIndex !== null) writeFileSync(kimiSessionIndex, preKimiIndex, "utf8");
    else rmSync(kimiSessionIndex, { force: true });
    for (const file of listFiles(kimiSessionsRoot).filter((f) => !preKimiSessions.includes(f))) {
      rmSync(path.join(kimiSessionsRoot, file), { recursive: true, force: true });
    }
    for (const dir of listDirs(kimiSessionsRoot).filter((d) => !preKimiSessionDirs.includes(d)).sort().reverse()) {
      rmSync(path.join(kimiSessionsRoot, dir), { recursive: true, force: true });
    }
  }
  if (scratchDir !== null) rmSync(scratchDir, { recursive: true, force: true });
  return { configOk, report };
}

try {
  // 3. ADD through the engine. vscode uses explicit mode with a DUMMY
  // password (single write — env-reference would also merge a top-level
  // inputs[] descriptor that `remove` does not roll back).
  const applyArgs = ["apply", "--client", clientId, "--servers", server, "--yes", "--json"];
  let applyInput;
  if (clientId === "vscode") {
    applyArgs.push("--mode", "explicit", "--confirm-secret", server, "--password-stdin");
    applyInput = `${DUMMY_PASSWORD}\n`;
  }
  const applied = cli(applyArgs, { input: applyInput });
  const applyOk = applied.status === 0;
  step("add (engine apply)", applyOk, applyOk ? `${server} written to ${configPath}` : excerpt(applied.stderr));
  if (!applyOk) throw new Error("apply failed — aborting the pass (restore follows)");

  // 4. Client surfaces the entry.
  const verified = verifyPresent(clientId, server, flags.has("--skip-agent"));
  step("client surfaces the entry", verified.ok, verified.summary);
  evidence.push(...verified.evidence);

  // 5. DISABLE through the engine; verify the entry is no longer active.
  const disabled = cli(["disable", "--client", clientId, "--server", server, "--json"]);
  step("disable (engine)", disabled.status === 0, disabled.status === 0 ? "" : excerpt(disabled.stderr));
  const midStatus = envelope(cli(["status", "--json"]), "status");
  const midRow = midStatus.data.clients
    .find((entry) => entry.client === clientId)
    ?.scopes.flatMap((scope) => scope.servers)
    .find((s) => s.server === server);
  const inactive = midRow !== undefined && midRow.state !== "present-enabled";
  step("entry inactive after disable", inactive, `state = ${midRow?.state ?? "missing"}`);

  // 6. REMOVE through the engine (purges the entry + ownership records).
  const removed = cli(["remove", "--client", clientId, "--server", server, "--json"]);
  step("remove (engine)", removed.status === 0, removed.status === 0 ? "" : excerpt(removed.stderr));
} finally {
  const { configOk, report } = restoreAndClean();
  for (const line of report) console.log(`  restore: ${line}`);
  step("byte-exact restore + side-effect cleanup", configOk, configOk ? "config bytes identical to pre-pass" : "CONFIG BYTES DIFFER — MANUAL CHECK REQUIRED");
}

// 7. Record the result (AC 33.5.6a/b): a FAILED pass never overwrites a
// certified-live record (keep-passing guard); a written record is MERGED
// over the existing one so hand-authored evidence keys (sharing, ac3344)
// survive a re-run.
const results = JSON.parse(readFileSync(RESULTS_PATH, "utf8"));
const record = {
  disposition: passOk ? "certified-live" : "certification-failed-see-story",
  date: TODAY,
  host: `${process.platform}/${process.arch}`,
  server,
  steps: steps.map((s) => `${s.ok ? "PASS" : "FAIL"} ${s.name}`),
  evidence,
};
if (flags.residualRisk) record.residualRisk = flags.residualRisk;
if (!passOk) process.exitCode = 1;
const decision = mergeCertificationRecord(results.clients[clientId], record, passOk);
if (decision.action === "keep") {
  console.log(
    `\ncertify: ${clientId} pass FAILED — the existing certified-live record is KEPT, not overwritten ` +
      `(re-run until the pass succeeds to update it)`,
  );
} else {
  results.clients[clientId] = decision.merged;
  writeFileSync(RESULTS_PATH, `${JSON.stringify(results, null, 2)}\n`, "utf8");
  console.log(`\ncertify: ${clientId} → ${record.disposition} (recorded in scripts/certification-results.json)`);
}
