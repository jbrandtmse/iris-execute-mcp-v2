/**
 * Story 38.1 (AD-23) -- a transport other than `stdio` is a startup
 * configuration error, proven at the PROCESS on all five built servers.
 *
 * Exit code and network activity are observable only at the process, so this
 * gate launches each built `dist/index.js` in a fresh Node process, the real
 * entry path (Rule #59):
 *
 *   A. **Rejection.** `MCP_TRANSPORT=http`, `--transport http`,
 *      `--transport=http` and `MCP_TRANSPORT=websocket` each exit 1 with
 *      `Fatal: Error: <the exact message>` on stderr, log neither an
 *      `IRIS health check` line nor `Connected via stdio transport`, and make
 *      NO connection to the configured IRIS port -- observed by a local
 *      `net` listener that counts every connection it receives.
 *   B. **Control.** The same process with no transport configured DOES connect
 *      to that listener and reaches `Connected via stdio transport`, which
 *      proves the oracle in A can see a connection at all.
 *   C. **Docs.** No user-facing doc offers an HTTP transport, and the README
 *      env table carries the `MCP_TRANSPORT` row.
 *
 * Needs no IRIS: the only network target is a local listener on an ephemeral
 * port of 127.0.0.1. It never skips: a missing or stale dist FAILS with the
 * rebuild command, because a skip here would leave the gate a dead check.
 */

import { describe, it, expect, beforeAll } from "vitest";
import { existsSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { checkDistFresh } from "../../../../scripts/lib/dist-freshness.mjs";
import { SERVER_PACKAGES as SERVER_PACKAGE_DIRS } from "../../../../scripts/lib/tool-catalog.mjs";
import { spawnAndWaitForExit } from "./process-gate-helpers.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// packages/iris-mcp-all/src/__tests__/ -> repo root is 4 levels up.
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..", "..");

/** The servers, from the suite's single roster: package directory under `packages/`, and published name from its package.json. */
const SERVERS: ReadonlyArray<{ dir: string; name: string }> = SERVER_PACKAGE_DIRS.map((dir) => ({
  dir,
  name: (
    JSON.parse(readFileSync(path.join(REPO_ROOT, "packages", dir, "package.json"), "utf8")) as { name: string }
  ).name,
}));

/** Every package whose dist the spawned processes run: the shared framework plus the servers. */
const DIST_PACKAGES: ReadonlyArray<{ dir: string; name: string }> = [
  { dir: "shared", name: "@iris-mcp/shared" },
  ...SERVERS,
];

/** Exact text for a bad `MCP_TRANSPORT` value (`json` is `JSON.stringify(value)`). */
function envMessage(json: string): string {
  return (
    `Unsupported transport ${json} from MCP_TRANSPORT: stdio is the only ` +
    `supported transport. Unset MCP_TRANSPORT or set it to "stdio".`
  );
}

/** Exact text for a bad `--transport` value (`json` is `JSON.stringify(value)`). */
function flagMessage(json: string): string {
  return (
    `Unsupported transport ${json} from --transport: stdio is the only ` +
    `supported transport. Remove --transport or pass --transport stdio.`
  );
}

/** The four rejection forms: how the transport is configured, and the exact message each must produce. */
const REJECTION_FORMS: ReadonlyArray<{
  label: string;
  args: string[];
  env: Record<string, string>;
  message: string;
}> = [
  { label: "MCP_TRANSPORT=http", args: [], env: { MCP_TRANSPORT: "http" }, message: envMessage('"http"') },
  { label: "--transport http", args: ["--transport", "http"], env: {}, message: flagMessage('"http"') },
  { label: "--transport=http", args: ["--transport=http"], env: {}, message: flagMessage('"http"') },
  {
    label: "MCP_TRANSPORT=websocket",
    args: [],
    env: { MCP_TRANSPORT: "websocket" },
    message: envMessage('"websocket"'),
  },
];

/** Spawn timeout for a process that must exit on its own (a rejection exits within a second or two). */
const REJECTION_TIMEOUT_MS = 20_000;
/** Spawn timeout for the control: stdin at EOF ends it, otherwise it is killed here. */
const CONTROL_TIMEOUT_MS = 10_000;

/**
 * The child environment: the parent's, minus every `IRIS_*`, `MCP_TRANSPORT` and `LOG_LEVEL` key
 * (matched case-insensitively, as Windows treats names), plus a synthetic connection that points
 * at the local listener.
 */
function childEnv(port: number, extra: Record<string, string>): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (typeof value !== "string") continue;
    const upper = key.toUpperCase();
    if (upper.startsWith("IRIS_") || upper === "MCP_TRANSPORT" || upper === "LOG_LEVEL") continue;
    env[key] = value;
  }
  return {
    ...env,
    IRIS_HOST: "127.0.0.1",
    IRIS_PORT: String(port),
    IRIS_USERNAME: "transport-gate",
    IRIS_PASSWORD: "transport-gate",
    IRIS_NAMESPACE: "USER",
    IRIS_TIMEOUT: "2000",
    ...extra,
  };
}

/** A local listener on an ephemeral 127.0.0.1 port that counts every connection, then destroys it. */
interface CountingListener {
  port: number;
  connections: () => number;
  close: () => Promise<void>;
}

function startCountingListener(): Promise<CountingListener> {
  return new Promise((resolve, reject) => {
    let count = 0;
    const server = net.createServer((socket) => {
      count += 1;
      socket.destroy();
    });
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (address === null || typeof address === "string") {
        reject(new Error("the counting listener did not report a port"));
        return;
      }
      resolve({
        port: address.port,
        connections: () => count,
        close: () => new Promise<void>((done) => server.close(() => done())),
      });
    });
  });
}

beforeAll(() => {
  // A missing or stale dist FAILS (never skips): this gate needs no IRIS, so a
  // skip would leave it a dead check on exactly the checkouts that need it.
  const stale: string[] = [];
  for (const pkg of DIST_PACKAGES) {
    const fresh = checkDistFresh(path.join(REPO_ROOT, "packages", pkg.dir), pkg.name);
    if (!fresh.ok) {
      stale.push(`${fresh.reason ?? `${pkg.name} dist is not fresh.`} Rebuild: pnpm --filter ${pkg.name} build`);
    } else if (fresh.skipped) {
      stale.push(`${pkg.name} declares no dist/ build output, but this gate spawns its built dist.`);
    }
  }
  if (stale.length > 0) {
    throw new Error(`The transport-rejection gate runs the BUILT dists, which are not ready:\n${stale.join("\n")}`);
  }
});

describe("Story 38.1 -- a non-stdio transport is a startup configuration error (built servers)", () => {
  it("the gate covers all five servers", () => {
    // A shrunken roster would register no per-server case and pass vacuously.
    expect(SERVERS.map((server) => server.name)).toEqual(
      expect.arrayContaining(["@iris-mcp/dev", "@iris-mcp/admin", "@iris-mcp/interop", "@iris-mcp/ops", "@iris-mcp/data"]),
    );
  });

  for (const pkg of SERVERS) {
    it(
      `${pkg.name}: every rejection form exits 1 with the exact Fatal message and no IRIS connection, while the control connects`,
      async () => {
        const entryPoint = path.join(REPO_ROOT, "packages", pkg.dir, "dist", "index.js");
        const listener = await startCountingListener();
        const cwd = mkdtempSync(path.join(realpathSync(tmpdir()), "transport-gate-"));
        try {
          const outcomes = await Promise.all(
            REJECTION_FORMS.map((form) =>
              spawnAndWaitForExit(
                entryPoint,
                form.args,
                childEnv(listener.port, form.env),
                REJECTION_TIMEOUT_MS,
                cwd,
              ),
            ),
          );

          REJECTION_FORMS.forEach((form, index) => {
            const outcome = outcomes[index];
            const where = `${pkg.name} ${form.label}`;
            expect(outcome?.timedOut, `${where}: must exit on its own`).toBe(false);
            expect(outcome?.code, `${where}: exit code (stderr: ${outcome?.stderr})`).toBe(1);
            expect(outcome?.stderr, `${where}: stderr`).toContain(`Fatal: Error: ${form.message}`);
            expect(outcome?.stderr, `${where}: stderr`).not.toContain("IRIS health check");
            expect(outcome?.stderr, `${where}: stderr`).not.toContain("Connected via stdio transport");
          });

          // The direct observation: not one connection reached the configured IRIS port.
          expect(listener.connections(), `${pkg.name}: connections made by the four rejected launches`).toBe(0);

          // Control: with no transport configured the same process DOES connect to the
          // listener, so the count above is a count that can see a connection. Its exit
          // code is not asserted (stdin at EOF ends it; the timeout kills it otherwise).
          const control = await spawnAndWaitForExit(
            entryPoint,
            [],
            childEnv(listener.port, {}),
            CONTROL_TIMEOUT_MS,
            cwd,
          );
          expect(listener.connections(), `${pkg.name}: control connections`).toBeGreaterThanOrEqual(1);
          expect(control.stderr, `${pkg.name}: control stderr`).toContain("Connected via stdio transport");
        } finally {
          await listener.close();
          rmSync(cwd, { recursive: true, force: true });
        }
      },
      90_000,
    );
  }
});

describe("Story 38.1 -- no user-facing doc offers an HTTP transport", () => {
  /** Repo-relative paths of the `.md` files directly inside `dir` (itself repo-relative). */
  const markdownIn = (dir: string): string[] =>
    readdirSync(path.join(REPO_ROOT, dir))
      .filter((name) => name.endsWith(".md"))
      .sort()
      .map((name) => path.join(dir, name));
  const PACKAGE_READMES = readdirSync(path.join(REPO_ROOT, "packages"), { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && existsSync(path.join(REPO_ROOT, "packages", entry.name, "README.md")))
    .map((entry) => path.join("packages", entry.name, "README.md"))
    .sort();
  const DOCS = [
    "README.md",
    "tool_support.md",
    ...PACKAGE_READMES,
    ...markdownIn("docs"),
    ...markdownIn(path.join("docs", "client-config")),
  ];

  const FORBIDDEN: ReadonlyArray<{ label: string; pattern: RegExp }> = [
    { label: "a stdio-or-Streamable-HTTP claim", pattern: /stdio\W*(or|vs|\/)\W*(\*\*)?Streamable HTTP/i },
    { label: "the --transport http flag", pattern: /--transport[ =]http/ },
    { label: "MCP_TRANSPORT=http", pattern: /MCP_TRANSPORT=http/ },
  ];

  it("the scan covers the docs a reader configures a server from", () => {
    // A partial scan would pass the cases below vacuously, so the known docs are listed here independently.
    expect(DOCS).toEqual(
      expect.arrayContaining([
        "README.md",
        "tool_support.md",
        ...["shared", "iris-dev-mcp", "iris-admin-mcp", "iris-interop-mcp", "iris-ops-mcp", "iris-data-mcp", "iris-mcp-all"].map(
          (dir) => path.join("packages", dir, "README.md"),
        ),
        ...["README.md", "claude-code.md", "claude-desktop.md", "cursor.md"].map((name) =>
          path.join("docs", "client-config", name),
        ),
      ]),
    );
  });

  for (const doc of DOCS) {
    it(`${doc} offers no HTTP transport`, () => {
      const text = readFileSync(path.join(REPO_ROOT, doc), "utf8");
      for (const { label, pattern } of FORBIDDEN) {
        expect(pattern.test(text), `${doc} contains ${label}`).toBe(false);
      }
    });
  }

  it("README.md carries the MCP_TRANSPORT env-table row", () => {
    const readme = readFileSync(path.join(REPO_ROOT, "README.md"), "utf8");
    expect(readme).toMatch(/^\| `MCP_TRANSPORT` \| `stdio` \| /m);
  });
});
