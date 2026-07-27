/**
 * Story 32.3 QA — Server Manager PRECEDENCE/drop behavior as a process-level
 * gate (Rule #21 shape, Rule #45 placement), complementing
 * `server-manager-process-gate.test.ts`.
 *
 * The existing process gate proves the roster GAINS/LOSES a Server-Manager
 * profile with the `IRIS_SERVER_MANAGER` switch. This gate exercises the NEW
 * Story-32.3 behaviors end-to-end against the BUILT `iris-dev-mcp` dist with
 * real settings fixtures on disk — the layer unit tests (which call
 * `resolveServerManagerProfiles`/`loadProfileRegistry` in-process) do not
 * cover:
 *
 *   A. **PD-1 first-file-wins (31-1-2 + 31-3-3) across two real files.** A
 *      higher-precedence UNRESOLVED definition wins over a lower-precedence
 *      RESOLVED (inline-password) one; the skipped password-bearing definition
 *      produces exactly the "First-file-wins" warning naming BOTH hosts, and
 *      the roster never carries the lower-precedence host. The unresolved
 *      winner is completed by `IRIS_CREDENTIAL_HELPER` (never the OS keychain
 *      for the password itself).
 *   B. **31-3-2 parser-drop visibility.** A non-object entry and a blank-host
 *      entry each produce ONE startup warning naming file + server + reason,
 *      and neither reaches the roster.
 *   C. **31-3-1 `required` all-collided throw.** A Server Manager server
 *      literally named `default` collides with the RESERVED profile; under
 *      `required` the server process FAILS startup with the paired-decision
 *      error (and the reserved-name NOTE).
 *   D. **31-3-3 terminal-invalid never reconsidered, under `required`.** A
 *      name that fails field validation on its FIRST sighting is not rescued
 *      by a valid lower-precedence definition; `required` fails startup with
 *      the "NONE could be imported" error.
 *   E. **32-3-R1 (Story 32.4) — a PARSER-LEVEL drop is terminal too, at the
 *      wire.** A name whose FIRST sighting is structurally unusable (no
 *      `webServer` block) marks the name `"invalid"` exactly like a
 *      mergeProfile-invalid first sighting: a lower-precedence file's fully
 *      VALID definition of the same name (inline password included) is NOT
 *      imported, and the roster never carries the lower-precedence host. The
 *      drop warning names file + server + reason.
 *   F. **32-3-R1 under `required`: the THIRD check fires (not the first).**
 *      The parser-drop name counts as found/considered but lands nothing, so
 *      `required` fails startup with the "NONE could be imported … NOT
 *      reconsidered" error — never the misleading "zero definitions found"
 *      one — with the per-drop warning visible above it.
 *
 * Cases C/D/F need no live IRIS (startup fails before any connection) and touch
 * no keychain (the colliding/invalid entries never reach the credential
 * chain). Cases A/B/E use the real SDK handshake against live IRIS, like the
 * existing gate.
 *
 * **Keychain note (review directive: no test may touch the real keychain).**
 * No test here READS or WRITES any real stored credential: A completes the
 * unresolved winner via `IRIS_CREDENTIAL_HELPER`; the chain's keychain link
 * does perform its normal read-only `getPassword` probe for the deliberately
 * nonexistent, test-unique account name first — the production code path
 * itself, returning null. Nothing is written and no real credential is
 * reachable (there is none under that name). C/D never run the chain at all.
 *
 * **Never fails on a pristine/offline checkout** (mirrors the existing gate):
 * an unbuilt dist, an unresolvable SDK, or unreachable IRIS SKIPS with a
 * logged reason. Credentials come from `IRIS_TEST_*` env vars with the
 * documented local dev defaults as fallback (the `31-6-5` convention).
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { existsSync, readdirSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { pathToFileURL, fileURLToPath } from "node:url";
import type { Readable } from "node:stream";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// packages/iris-mcp-all/src/__tests__/ -> repo root is 4 levels up.
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..", "..");
const DEV_MCP_ENTRY_POINT = path.join(REPO_ROOT, "packages", "iris-dev-mcp", "dist", "index.js");

const IRIS_HOST = process.env.IRIS_TEST_HOST ?? "localhost";
const IRIS_PORT = Number(process.env.IRIS_TEST_PORT ?? 52773);
const IRIS_USERNAME = process.env.IRIS_TEST_USERNAME ?? "_SYSTEM";
const IRIS_PASSWORD = process.env.IRIS_TEST_PASSWORD ?? "SYS";
const IRIS_NAMESPACE = process.env.IRIS_TEST_NAMESPACE ?? "HSCUSTOM";

/** Deliberately unique, guaranteed-nonexistent keychain account / server names. */
const DUP_NAME = "qaFfwGateDup";
const DROP_NO_WS = "qaGateDropNoWebServer";
const DROP_BLANK_HOST = "qaGateDropBlankHost";
const INVALID_NAME = "qaGateBadPort";
const SHADOWED_HOST = "shadowed-lower-precedence.example.invalid";
// 32-3-R1 (Story 32.4, Case E/F): a PARSER-LEVEL drop's terminality across
// files — the higher-precedence file's entry is structurally unusable (no
// webServer), the lower-precedence file's same-name entry is fully valid.
const R1_NAME = "qaGateParserDropTerminal";
const R1_SHADOWED_HOST = "r1-rescue-attempt.example.invalid";

/** Any HTTP response — even a 401 — proves the IRIS Web Gateway is reachable. A network error/timeout does not. */
async function isIrisReachable(): Promise<boolean> {
  try {
    const response = await fetch(`http://${IRIS_HOST}:${IRIS_PORT}/api/atelier/`, {
      signal: AbortSignal.timeout(3000),
    });
    return typeof response.status === "number";
  } catch {
    return false;
  }
}

/** Mirror of `server-manager-process-gate.test.ts`'s SDK resolution (pnpm store layout, iterated to exhaustion). */
function resolveSdkEsmDir(): string | undefined {
  const pnpmDir = path.join(REPO_ROOT, "node_modules", ".pnpm");
  if (!existsSync(pnpmDir)) return undefined;
  let entries: string[];
  try {
    entries = readdirSync(pnpmDir);
  } catch {
    return undefined;
  }
  const candidates = entries
    .filter((name) => name.startsWith("@modelcontextprotocol+sdk@"))
    .sort();
  for (const candidate of candidates) {
    const esmDir = path.join(
      pnpmDir,
      candidate,
      "node_modules",
      "@modelcontextprotocol",
      "sdk",
      "dist",
      "esm",
    );
    if (existsSync(esmDir)) return esmDir;
  }
  return undefined;
}

interface RosterEntry {
  name: string;
  host?: string;
  source?: string;
  sourceFile?: string;
}

interface SdkClient {
  connect: (transport: unknown) => Promise<void>;
  close: () => Promise<void>;
  callTool: (params: {
    name: string;
    arguments: Record<string, unknown>;
  }) => Promise<{ isError?: boolean; structuredContent?: { profiles?: RosterEntry[] } }>;
}

/**
 * Child-process env: inherit the ambient process env (PATH etc.) but scrub
 * EVERY IRIS_* variable first, so a developer shell's own suite configuration
 * can never leak into a spawned gate server, then layer the test's explicit
 * IRIS_* values on top.
 *
 * 32-3-R9 (Story 32.4): the scrub is CASE-INSENSITIVE — Windows environment
 * variables are case-insensitive, so an ambient lowercase `iris_host` would
 * otherwise survive the scrub and still be seen by the child.
 */
function childEnv(extra: Record<string, string>): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (typeof value === "string" && !key.toUpperCase().startsWith("IRIS_")) env[key] = value;
  }
  return {
    ...env,
    IRIS_HOST,
    IRIS_PORT: String(IRIS_PORT),
    IRIS_USERNAME,
    IRIS_PASSWORD,
    IRIS_NAMESPACE,
    ...extra,
  };
}

interface SpawnOutcome {
  code: number | null;
  stderr: string;
  timedOut: boolean;
}

/**
 * Spawn the built server directly (no MCP handshake) and wait for it to EXIT
 * on its own — the shape of a `required`-mode startup failure
 * (`server.start()`'s catch prints "Fatal:" + the error and exits 1). A
 * server that is still alive at the timeout is killed and reported as
 * `timedOut`, which the assertions treat as failure (a `required` violation
 * that does NOT fail startup is exactly the regression these cases pin).
 */
function spawnAndWaitForExit(
  env: Record<string, string>,
  timeoutMs: number,
): Promise<SpawnOutcome> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [DEV_MCP_ENTRY_POINT], {
      env,
      stdio: ["ignore", "ignore", "pipe"],
    });
    let stderr = "";
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      resolve({ code: null, stderr, timedOut: true });
    }, timeoutMs);
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("exit", (code) => {
      clearTimeout(timer);
      resolve({ code, stderr, timedOut: false });
    });
  });
}

let distSkipReason: string | undefined;
let liveSkipReason: string | undefined;
let sdkEsmDir: string | undefined;
let fixtureDir: string | undefined;
let fileHigh: string;
let fileLow: string;
let fileCollide: string;
let fileBad: string;
let fileGood: string;
let fileR1High: string;
let fileR1Low: string;

beforeAll(async () => {
  if (!existsSync(DEV_MCP_ENTRY_POINT)) {
    distSkipReason = `packages/iris-dev-mcp/dist/index.js is not built (run "pnpm turbo run build" first). Looked at: ${DEV_MCP_ENTRY_POINT}`;
    liveSkipReason = distSkipReason;
    return;
  }
  sdkEsmDir = resolveSdkEsmDir();
  if (!sdkEsmDir) {
    liveSkipReason =
      "Could not resolve the @modelcontextprotocol/sdk ESM build under node_modules/.pnpm — run pnpm install from the repo root.";
  } else if (!(await isIrisReachable())) {
    liveSkipReason = `IRIS is not reachable at http://${IRIS_HOST}:${IRIS_PORT}/api/atelier/ (set IRIS_TEST_* to point at a live instance).`;
  }

  fixtureDir = mkdtempSync(path.join(tmpdir(), "iris-sm-precedence-gate-"));

  // Case A/B fixture — HIGHER precedence (listed first in IRIS_SM_SETTINGS_PATHS):
  // an UNRESOLVED definition (username, no password) plus two parser drops.
  fileHigh = path.join(fixtureDir, "settings-high.json");
  writeFileSync(
    fileHigh,
    JSON.stringify({
      "intersystems.servers": {
        [DUP_NAME]: {
          webServer: { scheme: "http", host: IRIS_HOST, port: IRIS_PORT },
          username: IRIS_USERNAME,
        },
        [DROP_NO_WS]: "not-an-object",
        [DROP_BLANK_HOST]: {
          webServer: { scheme: "http", host: "   " },
          username: IRIS_USERNAME,
        },
      },
    }),
    "utf8",
  );

  // Case A fixture — LOWER precedence: the SAME name, RESOLVED via a
  // deprecated inline password, pointing at a DIFFERENT host. PD-1 says this
  // definition (including its password) is IGNORED with a First-file-wins
  // warning.
  fileLow = path.join(fixtureDir, "settings-low.json");
  writeFileSync(
    fileLow,
    JSON.stringify({
      "intersystems.servers": {
        [DUP_NAME]: {
          webServer: { scheme: "http", host: SHADOWED_HOST, port: IRIS_PORT },
          username: "qaShadowedUser",
          password: "ShadowedPass1234",
        },
      },
    }),
    "utf8",
  );

  // Case C fixture — the RESERVED name collides with the synthesized default.
  fileCollide = path.join(fixtureDir, "settings-collide.json");
  writeFileSync(
    fileCollide,
    JSON.stringify({
      "intersystems.servers": {
        default: {
          webServer: { scheme: "http", host: IRIS_HOST, port: IRIS_PORT },
          username: IRIS_USERNAME,
          password: "CollidePass1234",
        },
      },
    }),
    "utf8",
  );

  // Case D fixtures — the SAME name invalid on first sighting (higher
  // precedence), valid with an inline password on the later sighting.
  fileBad = path.join(fixtureDir, "settings-bad.json");
  writeFileSync(
    fileBad,
    JSON.stringify({
      "intersystems.servers": {
        [INVALID_NAME]: {
          webServer: { scheme: "http", host: IRIS_HOST, port: "not-a-port" },
          username: IRIS_USERNAME,
        },
      },
    }),
    "utf8",
  );
  fileGood = path.join(fixtureDir, "settings-good.json");
  writeFileSync(
    fileGood,
    JSON.stringify({
      "intersystems.servers": {
        [INVALID_NAME]: {
          webServer: { scheme: "http", host: IRIS_HOST, port: IRIS_PORT },
          username: IRIS_USERNAME,
          password: "GoodPass1234",
        },
      },
    }),
    "utf8",
  );

  // Case E/F fixtures (32-3-R1) — the SAME name whose FIRST sighting (higher
  // precedence) is a PARSER-LEVEL drop (no webServer block at all), with a
  // fully VALID same-name definition (inline password included) in the
  // lower-precedence file. PD-1 as extended by Story 32.4: the parser drop is
  // terminal "invalid", so the valid lower definition is NOT imported.
  fileR1High = path.join(fixtureDir, "settings-r1-high.json");
  writeFileSync(
    fileR1High,
    JSON.stringify({
      "intersystems.servers": {
        [R1_NAME]: { username: IRIS_USERNAME },
      },
    }),
    "utf8",
  );
  fileR1Low = path.join(fixtureDir, "settings-r1-low.json");
  writeFileSync(
    fileR1Low,
    JSON.stringify({
      "intersystems.servers": {
        [R1_NAME]: {
          webServer: { scheme: "http", host: R1_SHADOWED_HOST, port: IRIS_PORT },
          username: "qaR1RescueUser",
          password: "R1RescuePass1234",
        },
      },
    }),
    "utf8",
  );
});

afterAll(() => {
  if (fixtureDir) {
    rmSync(fixtureDir, { recursive: true, force: true });
    fixtureDir = undefined;
  }
});

describe("Story 32.3 QA — Server Manager precedence/drop process gate (built server)", () => {
  it(
    "PD-1 first-file-wins (31-1-2/31-3-3) + 31-3-2 parser-drop warnings, over a real MCP handshake",
    async (ctx) => {
      if (liveSkipReason) {
        // eslint-disable-next-line no-console
        console.log(`[SKIP] SM precedence gate (live): ${liveSkipReason}`);
        ctx.skip();
        return;
      }

      const sdkClientIndex = pathToFileURL(path.join(sdkEsmDir!, "client", "index.js")).href;
      const sdkClientStdio = pathToFileURL(path.join(sdkEsmDir!, "client", "stdio.js")).href;
      const { Client } = (await import(sdkClientIndex)) as {
        Client: new (info: { name: string; version: string }) => SdkClient;
      };
      const { StdioClientTransport } = (await import(sdkClientStdio)) as {
        StdioClientTransport: new (params: {
          command: string;
          args: string[];
          env: Record<string, string>;
          stderr: string;
        }) => unknown;
      };

      // 32-3-R9 (Story 32.4): use the SAME inherited-then-scrubbed childEnv
      // as the other gates — the fresh-built env this replaces had NO PATH,
      // so the IRIS_CREDENTIAL_HELPER's `node -e …` resolved only via a
      // Windows CreateProcess quirk and broke on POSIX/nvm.
      const env: Record<string, string> = childEnv({
        IRIS_SERVER_MANAGER: "auto",
        // Explicit two-file list: order IS precedence (highest first).
        IRIS_SM_SETTINGS_PATHS: [fileHigh, fileLow].join(path.delimiter),
        // Completes the UNRESOLVED higher-precedence winner without the OS
        // keychain holding the password (see the file header's keychain note).
        IRIS_CREDENTIAL_HELPER: `node -e "process.stdout.write('HelperPass1234')"`,
      });

      const transport = new StdioClientTransport({
        command: "node",
        args: [DEV_MCP_ENTRY_POINT],
        env,
        stderr: "pipe",
      });
      let stderr = "";
      (transport as { stderr?: Readable | null }).stderr?.on("data", (chunk: Buffer) => {
        stderr += chunk.toString("utf8");
      });

      const client = new Client({ name: "iris-mcp-all-sm-precedence-gate", version: "0.0.0" });
      let roster: RosterEntry[] = [];
      try {
        await client.connect(transport);
        const result = await client.callTool({ name: "iris_server_profiles", arguments: {} });
        expect(result.isError).not.toBe(true);
        roster = result.structuredContent?.profiles ?? [];
      } finally {
        await client.close().catch(() => {});
      }

      // ── PD-1: the higher-precedence definition won — roster carries ITS
      // host (the live IRIS host), NEVER the shadowed lower-precedence host,
      // with provenance pointing at the higher-precedence file.
      const dup = roster.find((entry) => entry.name === DUP_NAME);
      expect(dup).toBeDefined();
      expect(dup?.host).toBe(IRIS_HOST);
      expect(dup?.host).not.toBe(SHADOWED_HOST);
      expect(dup?.source).toBe("server-manager");
      expect(dup?.sourceFile).toBe(fileHigh);
      expect(roster.some((entry) => entry.host === SHADOWED_HOST)).toBe(false);

      // ── PD-1: skipping the password-bearing lower-precedence definition is
      // NEVER silent — one warning names both hosts and the remedy.
      expect(stderr).toContain("First-file-wins");
      expect(stderr).toContain(SHADOWED_HOST);
      const ffwLine = stderr.split(/\r?\n/).find((line) => line.includes("First-file-wins"));
      expect(ffwLine).toBeDefined();
      expect(ffwLine).toContain(fileLow);
      expect(ffwLine).toContain("is IGNORED");

      // ── 31-3-2: each parser drop produced ONE warning naming file + server
      // + the specific reason, and neither drop reached the roster.
      expect(stderr).toContain(`skipping server "${DROP_NO_WS}" (${fileHigh})`);
      expect(stderr).toContain("the entry is not an object");
      expect(stderr).toContain(`skipping server "${DROP_BLANK_HOST}" (${fileHigh})`);
      expect(stderr).toContain('"webServer.host" is missing or blank');
      expect(roster.find((entry) => entry.name === DROP_NO_WS)).toBeUndefined();
      expect(roster.find((entry) => entry.name === DROP_BLANK_HOST)).toBeUndefined();
    },
    { timeout: 60000 },
  );

  it(
    "31-3-1: IRIS_SERVER_MANAGER=required FAILS startup when every definition collided (reserved-name collision)",
    async (ctx) => {
      if (distSkipReason) {
        // eslint-disable-next-line no-console
        console.log(`[SKIP] SM precedence gate (required/collision): ${distSkipReason}`);
        ctx.skip();
        return;
      }
      const outcome = await spawnAndWaitForExit(
        childEnv({
          IRIS_SERVER_MANAGER: "required",
          IRIS_SM_SETTINGS_PATHS: fileCollide,
        }),
        45000,
      );
      expect(outcome.timedOut).toBe(false);
      expect(outcome.code).not.toBe(0);
      expect(outcome.stderr).toContain(
        "IRIS_SERVER_MANAGER=required but every Server Manager definition collided",
      );
      // The paired-decision reserved-name NOTE: renaming is the only remedy.
      expect(outcome.stderr).toContain("RESERVED profile name");
      expect(outcome.stderr).toContain("rename it in");
    },
    { timeout: 60000 },
  );

  it(
    "31-3-3: a name invalid on FIRST sighting is never reconsidered — required fails startup even with a valid lower-precedence definition",
    async (ctx) => {
      if (distSkipReason) {
        // eslint-disable-next-line no-console
        console.log(`[SKIP] SM precedence gate (required/invalid): ${distSkipReason}`);
        ctx.skip();
        return;
      }
      const outcome = await spawnAndWaitForExit(
        childEnv({
          IRIS_SERVER_MANAGER: "required",
          IRIS_SM_SETTINGS_PATHS: [fileBad, fileGood].join(path.delimiter),
        }),
        45000,
      );
      expect(outcome.timedOut).toBe(false);
      expect(outcome.code).not.toBe(0);
      // The first-sighting rejection is visible with file + server + reason…
      expect(outcome.stderr).toContain(INVALID_NAME);
      expect(outcome.stderr).toContain("not-a-port");
      // …and the THIRD required check is the one that fires (not the
      // misleading "zero definitions found"), naming the no-reconsideration
      // rule.
      expect(outcome.stderr).toContain("NONE could be imported");
      expect(outcome.stderr).toContain("NOT reconsidered");
    },
    { timeout: 60000 },
  );

  it(
    "32-3-R1 (E): a PARSER-LEVEL drop is terminal — the lower-precedence file's VALID same-name definition is NOT imported (auto, real handshake)",
    async (ctx) => {
      if (liveSkipReason) {
        // eslint-disable-next-line no-console
        console.log(`[SKIP] SM precedence gate (R1 parser-drop terminality): ${liveSkipReason}`);
        ctx.skip();
        return;
      }

      const sdkClientIndex = pathToFileURL(path.join(sdkEsmDir!, "client", "index.js")).href;
      const sdkClientStdio = pathToFileURL(path.join(sdkEsmDir!, "client", "stdio.js")).href;
      const { Client } = (await import(sdkClientIndex)) as {
        Client: new (info: { name: string; version: string }) => SdkClient;
      };
      const { StdioClientTransport } = (await import(sdkClientStdio)) as {
        StdioClientTransport: new (params: {
          command: string;
          args: string[];
          env: Record<string, string>;
          stderr: string;
        }) => unknown;
      };

      // No IRIS_CREDENTIAL_HELPER needed: the parser-dropped name never
      // reaches the credential chain (it is terminal "invalid" before any
      // profile exists to complete).
      const env: Record<string, string> = childEnv({
        IRIS_SERVER_MANAGER: "auto",
        IRIS_SM_SETTINGS_PATHS: [fileR1High, fileR1Low].join(path.delimiter),
      });

      const transport = new StdioClientTransport({
        command: "node",
        args: [DEV_MCP_ENTRY_POINT],
        env,
        stderr: "pipe",
      });
      let stderr = "";
      (transport as { stderr?: Readable | null }).stderr?.on("data", (chunk: Buffer) => {
        stderr += chunk.toString("utf8");
      });

      const client = new Client({ name: "iris-mcp-all-sm-r1-gate", version: "0.0.0" });
      let roster: RosterEntry[] = [];
      try {
        await client.connect(transport);
        const result = await client.callTool({ name: "iris_server_profiles", arguments: {} });
        expect(result.isError).not.toBe(true);
        roster = result.structuredContent?.profiles ?? [];
      } finally {
        await client.close().catch(() => {});
      }

      // ── 32-3-R1: the first sighting was a parser drop ⇒ the name is
      // terminal "invalid". The lower-precedence file's fully valid
      // definition (inline password and all) is NOT imported, and the roster
      // never carries its host — the server still starts healthy on the
      // default profile.
      expect(roster.find((entry) => entry.name === R1_NAME)).toBeUndefined();
      expect(roster.some((entry) => entry.host === R1_SHADOWED_HOST)).toBe(false);
      expect(roster.some((entry) => entry.name === "default")).toBe(true);

      // ── The drop itself is loud: ONE warning naming file + server + the
      // specific reason (the operator repairs the entry in the file that OWNS
      // the first sighting — that warning is the only signal).
      expect(stderr).toContain(`skipping server "${R1_NAME}" (${fileR1High})`);
      expect(stderr).toContain('it has no "webServer" block');
    },
    { timeout: 60000 },
  );

  it(
    "32-3-R1 (F): under required, a parser-drop first sighting trips the THIRD check (NONE could be imported / NOT reconsidered), never the misleading zero-definitions one",
    async (ctx) => {
      if (distSkipReason) {
        // eslint-disable-next-line no-console
        console.log(`[SKIP] SM precedence gate (R1 required/check-3): ${distSkipReason}`);
        ctx.skip();
        return;
      }
      const outcome = await spawnAndWaitForExit(
        childEnv({
          IRIS_SERVER_MANAGER: "required",
          IRIS_SM_SETTINGS_PATHS: [fileR1High, fileR1Low].join(path.delimiter),
        }),
        45000,
      );
      expect(outcome.timedOut).toBe(false);
      expect(outcome.code).not.toBe(0);
      // The parser drop counts as a found/considered definition, so the FIRST
      // check must NOT fire…
      expect(outcome.stderr).not.toContain("zero server definitions were found");
      // …the per-drop warning names file + server + reason…
      expect(outcome.stderr).toContain(`skipping server "${R1_NAME}" (${fileR1High})`);
      expect(outcome.stderr).toContain('it has no "webServer" block');
      // …and the THIRD check is the one that fires, stating the
      // no-reconsideration rule that 32-3-R1 extended to parser drops.
      expect(outcome.stderr).toContain("NONE could be imported");
      expect(outcome.stderr).toContain("NOT reconsidered");
    },
    { timeout: 60000 },
  );
});
