/**
 * Shared plumbing for the fresh-process wire legs (DW-749 characterization, Story 44.8 / DW-752): a built `iris-dev-mcp`
 * spawned the way an MCP client spawns it, a fake IRIS listener standing for a chosen host, and a fake keyring preload so
 * nothing touches the real keychain. Needs no IRIS. Not a `*.test.ts` file, so it is never collected as a suite.
 *
 * Each test file keeps its own `beforeAll`/`afterEach`/`afterAll` and calls `createFreshProcessKit`, `kit.closeOpen` and
 * `kit.dispose`.
 */
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { resolveSdkEsmDir, REPO_ROOT } from "./sdkClientStore.js";

export { REPO_ROOT };

const SHARED_DIST = path.join(REPO_ROOT, "packages", "shared", "dist");
const DEV_ENTRY = path.join(REPO_ROOT, "packages", "iris-dev-mcp", "dist", "index.js");
const FAKE_LISTENER = path.join(REPO_ROOT, "scripts", "lib", "fake-iris-listener.mjs");
const FAKE_KEYRING_PRELOAD = path.join(REPO_ROOT, "scripts", "lib", "fake-keyring-preload.mjs");

export interface FakeIris {
  port: number;
  requests: unknown[];
  authorizations: Array<{ method: string; url: string; authorization: string | undefined }>;
  close: () => Promise<void>;
}

interface SdkClient {
  connect: (transport: unknown) => Promise<void>;
  close: () => Promise<void>;
  listTools: () => Promise<{ tools: Array<{ name: string }> }>;
}

/** A process to spawn: `env` entries that are `null` are dropped (the Local harness deletes them) over the scrubbed base env. */
export interface Launch {
  command: string;
  args: string[];
  env: Record<string, string | null>;
}

export interface FreshProcessKit {
  /** Why the wire legs cannot run here (unbuilt dists, missing SDK or `module.registerHooks`), or `undefined` when they can. */
  unbuiltReason: string | undefined;
  /** Start a fake IRIS listener; it is closed by the next `closeOpen`. */
  startFakeIris: () => Promise<FakeIris>;
  /**
   * Spawn `launch` as a fresh built-server process over a scratch HOME and the fake keyring (`keyring` is the `iris-mcp`
   * service's `account -> password` entries; empty by default), list its tools, and tear the client down at `closeOpen`.
   * A server that cannot start is expected; what matters is what reached the listener.
   */
  spawn: (launch: Launch, options?: { keyring?: Record<string, string> }) => Promise<void>;
  /** Close every listener and client started since the last call. */
  closeOpen: () => Promise<void>;
  /** Close everything and remove the scratch directory. */
  dispose: () => Promise<void>;
}

/** The `Authorization` headers a fake listener received. */
export function sentAuthorizations(fake: FakeIris): string[] {
  return fake.authorizations.flatMap((entry) => (entry.authorization === undefined ? [] : [entry.authorization]));
}

/** `Basic base64(user:password)`, the header the server sends to an IRIS host. */
export function basicAuthorization(username: string, password: string): string {
  return `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`;
}

/** Build the kit; call it from `beforeAll`. `scratchPrefix` names the scratch directory. */
export async function createFreshProcessKit(scratchPrefix: string): Promise<FreshProcessKit> {
  const missing = [
    [path.join(SHARED_DIST, "bootstrap-classes.js"), "packages/shared is not built"],
    [DEV_ENTRY, "packages/iris-dev-mcp is not built"],
    [FAKE_LISTENER, "scripts/lib/fake-iris-listener.mjs is missing"],
    [FAKE_KEYRING_PRELOAD, "scripts/lib/fake-keyring-preload.mjs is missing"],
  ].find(([file]) => !existsSync(file as string));
  const sdk = resolveSdkEsmDir();
  let unbuiltReason: string | undefined;
  if (missing !== undefined) unbuiltReason = `${missing[1]} (${missing[0]}); run "pnpm turbo run build" from the repo root.`;
  else if (sdk === undefined) unbuiltReason = "the @modelcontextprotocol/client ESM build is not under node_modules/.pnpm; run pnpm install.";
  else if (typeof (await import("node:module")).registerHooks !== "function") unbuiltReason = "this Node has no module.registerHooks (>= 22.15), so the fake keyring cannot be preloaded.";

  const open: Array<() => Promise<void>> = [];
  const closeOpen = async (): Promise<void> => {
    for (const close of open.splice(0).reverse()) await close().catch(() => undefined);
  };
  if (unbuiltReason !== undefined) {
    const unavailable = async (): Promise<never> => {
      throw new Error(`the fresh-process kit is unavailable: ${unbuiltReason}`);
    };
    return { unbuiltReason, startFakeIris: unavailable, spawn: unavailable, closeOpen, dispose: async () => undefined };
  }

  const sdkEsmDir = sdk as string;
  const { startFakeIris } = (await import(pathToFileURL(FAKE_LISTENER).href)) as {
    startFakeIris: (options: { bootstrapVersion: string }) => Promise<FakeIris>;
  };
  const embed = (await import(pathToFileURL(path.join(SHARED_DIST, "bootstrap-classes.js")).href)) as { BOOTSTRAP_VERSION: string };
  const scratch = mkdtempSync(path.join(tmpdir(), `${scratchPrefix}-`));

  return {
    unbuiltReason,
    startFakeIris: async () => {
      const fake = await startFakeIris({ bootstrapVersion: embed.BOOTSTRAP_VERSION });
      open.push(() => fake.close());
      return fake;
    },
    spawn: async (launch, options = {}) => {
      const caseDir = mkdtempSync(path.join(scratch, "case-"));
      const keyringFile = path.join(caseDir, "fake-keyring.json");
      writeFileSync(keyringFile, JSON.stringify({ "iris-mcp": options.keyring ?? {} }), "utf8");
      const existing = process.env.NODE_OPTIONS;
      const preload = `--import=${pathToFileURL(FAKE_KEYRING_PRELOAD).href}`;
      const env: Record<string, string> = {
        HOME: caseDir,
        USERPROFILE: caseDir,
        FAKE_KEYRING_FILE: keyringFile,
        NODE_OPTIONS: existing === undefined || existing.trim() === "" ? preload : `${existing} ${preload}`,
      };
      if (process.env.PATH !== undefined) env["PATH"] = process.env.PATH;
      for (const [key, value] of Object.entries(launch.env)) {
        if (value === null) delete env[key];
        else env[key] = value;
      }

      const { Client } = (await import(pathToFileURL(path.join(sdkEsmDir, "index.mjs")).href)) as {
        Client: new (info: { name: string; version: string }) => SdkClient;
      };
      const { StdioClientTransport } = (await import(pathToFileURL(path.join(sdkEsmDir, "stdio.mjs")).href)) as {
        StdioClientTransport: new (params: { command: string; args: string[]; env: Record<string, string>; stderr: string }) => unknown;
      };
      const client = new Client({ name: "iris-mcp-launcher-wire-leg", version: "0.0.0" });
      open.push(() => client.close());
      try {
        await client.connect(new StdioClientTransport({ command: launch.command, args: launch.args, env, stderr: "ignore" }));
        await client.listTools();
      } catch {
        // A definition without connection settings exits at startup; what matters is what reached the listener.
      }
    },
    closeOpen,
    dispose: async () => {
      await closeOpen();
      rmSync(scratch, { recursive: true, force: true });
    },
  };
}
