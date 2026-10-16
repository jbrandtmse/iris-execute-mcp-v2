/**
 * The one environment harness for tests that boot a real `McpServerBase`.
 *
 * `makeEnvHarness()` returns `setup`/`teardown` to register with
 * `beforeEach`/`afterEach`. `setup` mocks `process.exit` and the console, stubs
 * `fetch`, clears every variable in `STARTUP_ENV_VARS` and
 * `CONNECTION_ENV_VARS`, and (by default) gives the connection variables test
 * values. `teardown` restores `fetch`, the mocks and every variable exactly as
 * it was when the harness was constructed.
 *
 * Test-only: lives under `__tests__/`, so it is never published. Shared tests
 * import it from `./env-harness.js`; other packages import `makeEnvHarness`
 * from `@iris-mcp/shared/test-helpers`, which re-exports it.
 */

import { vi } from "vitest";
import { CONNECTION_ENV_VARS, STARTUP_ENV_VARS } from "./startup-env.js";

export interface EnvHarnessOptions {
  /** Runs first in `setup()`, before anything is mocked or cleared. */
  onSetup?: () => void;
  /**
   * `"defaults"` (the default): the connection variables are
   * `u` / `p` / `default.example.com` / `DEFAULTNS`, with `IRIS_PORT` and
   * `IRIS_HTTPS` unset. `"unset"`: all six are unset.
   */
  connection?: "defaults" | "unset";
  /** Stub `globalThis.fetch` with a fresh `vi.fn()` per `setup()` (default `true`). */
  mockFetch?: boolean;
}

/** The connection values `connection: "defaults"` sets. */
const CONNECTION_DEFAULTS: Readonly<Record<string, string>> = {
  IRIS_USERNAME: "u",
  IRIS_PASSWORD: "p",
  IRIS_HOST: "default.example.com",
  IRIS_NAMESPACE: "DEFAULTNS",
};

export function makeEnvHarness(options: EnvHarnessOptions = {}) {
  const { onSetup, connection = "defaults", mockFetch = true } = options;
  const originalFetch = globalThis.fetch;
  let fetchMock: ReturnType<typeof vi.fn> | undefined;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let exitMock: any;
  const names: readonly string[] = [...STARTUP_ENV_VARS, ...CONNECTION_ENV_VARS];
  const savedEnv = new Map<string, string | undefined>();
  for (const name of names) savedEnv.set(name, process.env[name]);

  function setup(): void {
    onSetup?.();
    if (mockFetch) {
      fetchMock = vi.fn();
      globalThis.fetch = fetchMock as unknown as typeof fetch;
    }
    exitMock = vi
      .spyOn(process, "exit")
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .mockImplementation((() => {}) as any);
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "info").mockImplementation(() => {});
    for (const name of names) delete process.env[name];
    if (connection === "defaults") Object.assign(process.env, CONNECTION_DEFAULTS);
  }

  function teardown(): void {
    globalThis.fetch = originalFetch;
    exitMock.mockRestore();
    vi.restoreAllMocks();
    for (const [name, value] of savedEnv) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }

  return {
    setup,
    teardown,
    get fetchMock(): ReturnType<typeof vi.fn> {
      if (fetchMock === undefined) {
        throw new Error(
          "makeEnvHarness: fetch is not mocked. Construct the harness with mockFetch: true (the default) and call setup() first.",
        );
      }
      return fetchMock;
    },
    get exitMock() {
      return exitMock;
    },
  };
}
