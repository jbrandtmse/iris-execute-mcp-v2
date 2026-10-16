/**
 * The shared env harness and its setup scrub (`env-harness.ts`, `startup-env.ts`).
 *
 * Every test here starts from a HOSTILE environment: all 30 startup and
 * connection variables set to a value no default suite should ever see, and
 * restores the ambient values exactly afterwards. The assertions are about the
 * harness contract, so they hold in any developer environment.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { makeEnvHarness } from "./env-harness.js";
import {
  CONNECTION_ENV_VARS,
  PLATFORM_ENV_VARS,
  STARTUP_ENV_VARS,
  scrubStartupEnv,
} from "./startup-env.js";

// The roster as the Story 39.0 spec fixes it (exhaustive as of 2026-10-16), copied by hand: the behavior rows below
// run over THESE names, so removing a name from `startup-env.ts` makes them fail instead of silently shrinking.
const STARTUP_NAMES = [
  "IRIS_PROFILES", "IRIS_TIMEOUT", "IRIS_ACCEPT_LANGUAGE", "IRIS_GOVERNANCE", "IRIS_GOVERNANCE_FILE",
  "IRIS_GOVERNANCE_PRESET", "IRIS_TOOLS_PRESET", "IRIS_TOOLS_DISABLE", "IRIS_TOOLS_ENABLE", "IRIS_SERVER_MANAGER",
  "IRIS_SM_SERVERS", "IRIS_SM_SETTINGS_PATHS", "IRIS_SM_WORKSPACE", "IRIS_CREDENTIAL_HELPER", "IRIS_SQL_MAX_ROWS",
  "IRIS_SQL_TIMEOUT", "IRIS_SQL_READ_ONLY", "IRIS_SQL_MAX_ROWS_AFFECTED", "IRIS_TEST_TIMEOUT", "IRIS_AUDIT_LOG",
  "IRIS_AUDIT_LOG_MAX_MB", "IRIS_AUDIT_LOG_PARAMS", "LOG_LEVEL", "MCP_TRANSPORT",
];
const CONNECTION_NAMES = ["IRIS_HOST", "IRIS_PORT", "IRIS_USERNAME", "IRIS_PASSWORD", "IRIS_NAMESPACE", "IRIS_HTTPS"];
const PLATFORM_NAMES = ["HOME", "APPDATA", "XDG_CONFIG_HOME"];

const ALL_NAMES: readonly string[] = [...STARTUP_NAMES, ...CONNECTION_NAMES];

/** IRIS_TIMEOUT is the empty string and IRIS_USERNAME is absent: exact restoration must tell them apart. */
const EMPTY_STRING_NAME = "IRIS_TIMEOUT";
const ABSENT_NAME = "IRIS_USERNAME";

const CONSOLE_METHODS = ["error", "warn", "info"] as const;
const consoleObject = console as unknown as Record<string, unknown>;

function hostileValue(name: string): string {
  return `hostile-${name}`;
}

let ambient: Map<string, string | undefined>;
let ambientPlatform: Map<string, string | undefined>;

beforeEach(() => {
  ambient = new Map(ALL_NAMES.map((name) => [name, process.env[name]]));
  ambientPlatform = new Map(PLATFORM_NAMES.map((name) => [name, process.env[name]]));
  for (const name of ALL_NAMES) process.env[name] = hostileValue(name);
  process.env[EMPTY_STRING_NAME] = "";
  delete process.env[ABSENT_NAME];
});

afterEach(() => {
  for (const [name, value] of [...ambient, ...ambientPlatform]) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

function expectHostileRestored(): void {
  for (const name of ALL_NAMES) {
    if (name === EMPTY_STRING_NAME) expect(process.env[name], name).toBe("");
    else if (name === ABSENT_NAME) expect(process.env[name], name).toBeUndefined();
    else expect(process.env[name], name).toBe(hostileValue(name));
  }
}

describe("the variable rosters", () => {
  it("name the spec's 24 startup, 6 connection and 3 platform variables, with no name in two lists", () => {
    expect([...STARTUP_ENV_VARS].sort()).toEqual([...STARTUP_NAMES].sort());
    expect([...CONNECTION_ENV_VARS].sort()).toEqual([...CONNECTION_NAMES].sort());
    expect([...PLATFORM_ENV_VARS].sort()).toEqual([...PLATFORM_NAMES].sort());
    expect(STARTUP_NAMES).toHaveLength(24);
    const all = [...STARTUP_NAMES, ...CONNECTION_NAMES, ...PLATFORM_NAMES];
    expect(new Set(all).size).toBe(all.length);
  });
});

describe("makeEnvHarness with the default options", () => {
  it("setup clears every startup variable and defaults the connection (IRIS_PORT and IRIS_HTTPS stay unset)", () => {
    const harness = makeEnvHarness();
    harness.setup();
    try {
      for (const name of STARTUP_NAMES) expect(process.env[name], name).toBeUndefined();
      expect(process.env["IRIS_USERNAME"]).toBe("u");
      expect(process.env["IRIS_PASSWORD"]).toBe("p");
      expect(process.env["IRIS_HOST"]).toBe("default.example.com");
      expect(process.env["IRIS_NAMESPACE"]).toBe("DEFAULTNS");
      expect(process.env["IRIS_PORT"]).toBeUndefined();
      expect(process.env["IRIS_HTTPS"]).toBeUndefined();
    } finally {
      harness.teardown();
    }
  });

  it("teardown restores each of the 30 values exactly: hostile, empty string and absent alike", () => {
    const harness = makeEnvHarness();
    harness.setup();
    harness.teardown();
    expectHostileRestored();
  });

  it("restores the values it saw when it was constructed, not the values at setup", () => {
    const harness = makeEnvHarness();
    process.env["IRIS_PROFILES"] = "changed-after-construction";
    harness.setup();
    harness.teardown();
    expect(process.env["IRIS_PROFILES"]).toBe(hostileValue("IRIS_PROFILES"));
  });

  it("leaves the platform variables alone", () => {
    const harness = makeEnvHarness();
    harness.setup();
    try {
      for (const name of PLATFORM_NAMES) expect(process.env[name], name).toBe(ambientPlatform.get(name));
    } finally {
      harness.teardown();
    }
  });
});

describe('makeEnvHarness({ connection: "unset" })', () => {
  it("setup clears all 30 variables", () => {
    const harness = makeEnvHarness({ connection: "unset" });
    harness.setup();
    try {
      for (const name of ALL_NAMES) expect(process.env[name], name).toBeUndefined();
    } finally {
      harness.teardown();
    }
    expectHostileRestored();
  });
});

describe("makeEnvHarness({ onSetup })", () => {
  it("runs first in setup, before fetch is stubbed and before any variable is cleared", () => {
    const originalFetch = globalThis.fetch;
    const seen: Array<{ profiles: string | undefined; fetchIsOriginal: boolean; exitIsMock: boolean }> = [];
    const harness = makeEnvHarness({
      onSetup: () => {
        seen.push({
          profiles: process.env["IRIS_PROFILES"],
          fetchIsOriginal: globalThis.fetch === originalFetch,
          exitIsMock: vi.isMockFunction(process.exit),
        });
      },
    });
    harness.setup();
    harness.teardown();
    expect(seen).toEqual([
      { profiles: hostileValue("IRIS_PROFILES"), fetchIsOriginal: true, exitIsMock: false },
    ]);
  });
});

describe("makeEnvHarness mocks", () => {
  it("stubs fetch with a fresh vi.fn per setup and restores the original on teardown", () => {
    const originalFetch = globalThis.fetch;
    const harness = makeEnvHarness();
    harness.setup();
    const first = harness.fetchMock;
    expect(vi.isMockFunction(first)).toBe(true);
    expect(globalThis.fetch).toBe(first);
    harness.teardown();
    expect(globalThis.fetch).toBe(originalFetch);
    harness.setup();
    expect(harness.fetchMock).not.toBe(first);
    harness.teardown();
  });

  it("mockFetch: false leaves fetch alone, restores the construction-time fetch, and refuses fetchMock reads", () => {
    const originalFetch = globalThis.fetch;
    const harness = makeEnvHarness({ mockFetch: false });
    harness.setup();
    expect(globalThis.fetch).toBe(originalFetch);
    expect(() => harness.fetchMock).toThrow(/fetch is not mocked/);
    globalThis.fetch = (() => Promise.resolve(new Response(null))) as typeof fetch;
    harness.teardown();
    expect(globalThis.fetch).toBe(originalFetch);
  });

  it("mocks process.exit and the console, and restores them", () => {
    const harness = makeEnvHarness();
    harness.setup();
    try {
      // process.exit is declared `never`; call it through a plain function type so the checks below stay reachable.
      const exit = process.exit as unknown as (code?: number) => void;
      exit(3);
      expect(harness.exitMock).toHaveBeenCalledWith(3);
      for (const method of CONSOLE_METHODS) expect(vi.isMockFunction(consoleObject[method]), method).toBe(true);
    } finally {
      harness.teardown();
    }
    expect(vi.isMockFunction(process.exit)).toBe(false);
    for (const method of CONSOLE_METHODS) expect(vi.isMockFunction(consoleObject[method]), method).toBe(false);
  });
});

describe("scrubStartupEnv", () => {
  it("clears the 24 startup variables only, and the returned function puts each back exactly", () => {
    const restore = scrubStartupEnv();
    for (const name of STARTUP_NAMES) expect(process.env[name], name).toBeUndefined();
    for (const name of CONNECTION_NAMES) {
      if (name === ABSENT_NAME) expect(process.env[name], name).toBeUndefined();
      else expect(process.env[name], name).toBe(hostileValue(name));
    }
    for (const name of PLATFORM_NAMES) expect(process.env[name], name).toBe(ambientPlatform.get(name));
    restore();
    expectHostileRestored();
  });
});
