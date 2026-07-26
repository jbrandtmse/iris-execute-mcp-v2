/**
 * Story 31.0 — Server Manager settings discovery + JSONC parsing + profile
 * mapping (`server-manager-source.ts`).
 *
 * Scope (Rule #52 seam, see the module's own doc comment): this file covers
 * the THREE exported functions this story owns — `discoverSettingsFiles`,
 * `parseIntersystemsServers`, `resolveServerManagerProfiles` — plus
 * `parseServerManagerMode`'s fail-fast env parsing. Credential-chain
 * completion (Story 31.1) and full registry merge semantics/provenance
 * (Story 31.3) are explicitly NOT tested here — only the minimal wire-in's
 * back-compat proof, which lives in `profiles.test.ts` (AC 31.0.4/31.0.5).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, posix } from "node:path";

// Wrap the REAL node:fs implementation in vi.fn() (profiles-bootstrap.test.ts's
// established pattern) so on-disk fixture reads keep working while calls remain
// spy-able/countable (needed for the "off touches zero filesystem" proof).
vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return { ...actual, readFileSync: vi.fn(actual.readFileSync) };
});

import { readFileSync as mockedReadFileSync } from "node:fs";
const readFileSyncSpy = mockedReadFileSync as unknown as ReturnType<typeof vi.fn>;

import {
  discoverSettingsFiles,
  parseIntersystemsServers,
  parseServerManagerMode,
  resolveServerManagerProfiles,
} from "../server-manager-source.js";
import { logger } from "../logger.js";

// ── Helpers ─────────────────────────────────────────────────────────

function makeTmpDir(): string {
  return mkdtempSync(join(tmpdir(), "iris-sm-source-test-"));
}

/** Write `settings.json` (JSONC text) directly into `dir`. */
function writeSettings(dir: string, text: string): string {
  const filePath = join(dir, "settings.json");
  writeFileSync(filePath, text, "utf8");
  return filePath;
}

const BASE_ENV = { IRIS_USERNAME: "admin", IRIS_PASSWORD: "secret" };

afterEach(() => {
  vi.restoreAllMocks();
  readFileSyncSpy.mockClear();
});

// ════════════════════════════════════════════════════════════════════
// parseServerManagerMode (AC 31.0.3)
// ════════════════════════════════════════════════════════════════════

describe("parseServerManagerMode", () => {
  it("unset ⇒ off", () => {
    expect(parseServerManagerMode({})).toBe("off");
  });

  it("empty string ⇒ off", () => {
    expect(parseServerManagerMode({ IRIS_SERVER_MANAGER: "" })).toBe("off");
  });

  it.each(["off", "auto", "required"])("recognizes %s", (mode) => {
    expect(parseServerManagerMode({ IRIS_SERVER_MANAGER: mode })).toBe(mode);
  });

  it("throws naming IRIS_SERVER_MANAGER and the valid set for an unknown value", () => {
    expect(() => parseServerManagerMode({ IRIS_SERVER_MANAGER: "sometimes" })).toThrow(
      "IRIS_SERVER_MANAGER is invalid",
    );
    expect(() => parseServerManagerMode({ IRIS_SERVER_MANAGER: "sometimes" })).toThrow(
      /off, auto, required/,
    );
  });
});

// ════════════════════════════════════════════════════════════════════
// parseIntersystemsServers (AC 31.0.2)
// ════════════════════════════════════════════════════════════════════

describe("parseIntersystemsServers", () => {
  it("parses comments and trailing commas (JSONC)", () => {
    const text = `{
      // a leading comment
      "intersystems.servers": {
        "localIris": {
          "webServer": { "scheme": "http", "host": "localhost", "port": 52773, },
          "username": "_SYSTEM", // trailing comma above and here
        },
      },
    }`;
    const result = parseIntersystemsServers(text);
    expect(Object.keys(result)).toEqual(["localIris"]);
    expect(result.localIris?.override).toEqual({
      https: false,
      host: "localhost",
      port: 52773,
      username: "_SYSTEM",
    });
    expect(result.localIris?.legacyPassword).toBe(false);
  });

  it("skips the /default marker and any /-prefixed key", () => {
    const text = JSON.stringify({
      "intersystems.servers": {
        localIris: {
          webServer: { scheme: "http", host: "localhost", port: 52773 },
          username: "_SYSTEM",
        },
        "/default": "localIris",
        "/somethingElse": "ignored",
      },
    });
    const result = parseIntersystemsServers(text);
    expect(Object.keys(result)).toEqual(["localIris"]);
  });

  it("ignores superServer entirely", () => {
    const text = JSON.stringify({
      "intersystems.servers": {
        localIris: {
          webServer: { scheme: "http", host: "localhost", port: 52773 },
          superServer: { host: "localhost", port: 1972 },
          username: "_SYSTEM",
        },
      },
    });
    const result = parseIntersystemsServers(text);
    expect(result.localIris?.override).toEqual({
      https: false,
      host: "localhost",
      port: 52773,
      username: "_SYSTEM",
    });
  });

  it("maps scheme https to override.https = true, and any other/absent scheme to false", () => {
    const text = JSON.stringify({
      "intersystems.servers": {
        secure: { webServer: { scheme: "https", host: "h", port: 443 } },
        plain: { webServer: { scheme: "http", host: "h", port: 80 } },
        unspecified: { webServer: { host: "h", port: 52773 } },
      },
    });
    const result = parseIntersystemsServers(text);
    expect(result.secure?.override.https).toBe(true);
    expect(result.plain?.override.https).toBe(false);
    expect(result.unspecified?.override.https).toBe(false);
  });

  it("honors a legacy inline password and flags legacyPassword", () => {
    const text = JSON.stringify({
      "intersystems.servers": {
        legacy: {
          webServer: { scheme: "http", host: "h", port: 52773 },
          username: "u",
          password: "hunter2",
        },
      },
    });
    const result = parseIntersystemsServers(text);
    expect(result.legacy?.override.password).toBe("hunter2");
    expect(result.legacy?.legacyPassword).toBe(true);
  });

  it("does not set override.password (and legacyPassword stays false) when password is absent", () => {
    const text = JSON.stringify({
      "intersystems.servers": {
        noPw: { webServer: { scheme: "http", host: "h", port: 52773 } },
      },
    });
    const result = parseIntersystemsServers(text);
    expect(result.noPw?.override.password).toBeUndefined();
    expect(result.noPw?.legacyPassword).toBe(false);
  });

  it.each([
    ["prefix", "/prefix"],
    ["/prefix", "/prefix"],
    ["/prefix/", "/prefix"],
    ["prefix//", "/prefix"],
    ["", undefined],
    ["/", undefined],
  ])("normalizes pathPrefix %j to %j", (raw, expected) => {
    const text = JSON.stringify({
      "intersystems.servers": {
        srv: { webServer: { scheme: "http", host: "h", port: 52773, pathPrefix: raw } },
      },
    });
    const result = parseIntersystemsServers(text);
    expect(result.srv?.pathPrefix).toBe(expected);
  });

  it("absent intersystems.servers key returns {} with no error (common case)", () => {
    const result = parseIntersystemsServers(JSON.stringify({ "editor.fontSize": 14 }));
    expect(result).toEqual({});
  });

  it("non-object intersystems.servers value returns {} with no error", () => {
    const result = parseIntersystemsServers(JSON.stringify({ "intersystems.servers": "nope" }));
    expect(result).toEqual({});
  });

  it("skips an entry with no webServer block", () => {
    const text = JSON.stringify({
      "intersystems.servers": { broken: { username: "u" } },
    });
    expect(parseIntersystemsServers(text)).toEqual({});
  });

  // ── Code-review additions (2026-07-25) ───────────────────────────

  it("parses a settings file saved with a UTF-8 BOM (jsonc-parser reports it as a parse error at offset 0)", () => {
    const text =
      "﻿" +
      JSON.stringify({
        "intersystems.servers": {
          localIris: {
            webServer: { scheme: "http", host: "localhost", port: 52773 },
            username: "_SYSTEM",
          },
        },
      });
    // Pre-fix this threw "malformed JSONC (1 parse error(s), first at offset 0)"
    // and the caller discarded the whole (valid) file.
    expect(Object.keys(parseIntersystemsServers(text))).toEqual(["localIris"]);
  });

  it.each([
    ["absent host", { scheme: "https", port: 443 }],
    ["empty host", { scheme: "https", host: "", port: 443 }],
    ["whitespace-only host", { scheme: "https", host: "   ", port: 443 }],
    ["non-string host", { scheme: "https", host: 12345, port: 443 }],
  ])(
    "skips an entry whose webServer has an unusable host (%s) — it must never inherit the LOCAL default host",
    (_label, webServer) => {
      const text = JSON.stringify({
        "intersystems.servers": {
          prod: { webServer, username: "prod-admin", password: "prodpw" },
        },
      });
      expect(parseIntersystemsServers(text)).toEqual({});
    },
  );

  it.each([
    ["https", true],
    ["HTTPS", true],
    ["Https", true],
    [" https ", true],
    ["http", false],
    ["HTTP", false],
  ])("compares scheme %j case- and whitespace-insensitively (https = %s)", (scheme, expected) => {
    const text = JSON.stringify({
      "intersystems.servers": { srv: { webServer: { scheme, host: "h", port: 443 } } },
    });
    expect(parseIntersystemsServers(text).srv?.override.https).toBe(expected);
  });

  it("skips an empty/whitespace-only server name (it would be an unreachable registry entry)", () => {
    const text = JSON.stringify({
      "intersystems.servers": {
        "": { webServer: { scheme: "http", host: "h", port: 1 }, password: "pw" },
        "   ": { webServer: { scheme: "http", host: "h", port: 1 }, password: "pw" },
        ok: { webServer: { scheme: "http", host: "h", port: 1 }, password: "pw" },
      },
    });
    expect(Object.keys(parseIntersystemsServers(text))).toEqual(["ok"]);
  });

  it("treats a whitespace-only inline password as no password at all", () => {
    const text = JSON.stringify({
      "intersystems.servers": {
        wspw: { webServer: { scheme: "http", host: "h", port: 1 }, password: "   " },
      },
    });
    const result = parseIntersystemsServers(text);
    expect(result.wspw?.override.password).toBeUndefined();
    expect(result.wspw?.legacyPassword).toBe(false);
  });

  it("skips a non-object entry value", () => {
    const text = JSON.stringify({
      "intersystems.servers": { broken: "not-an-object" },
    });
    expect(parseIntersystemsServers(text)).toEqual({});
  });

  it("empty text returns {} with no error", () => {
    expect(parseIntersystemsServers("")).toEqual({});
  });

  it("throws on genuinely malformed JSONC", () => {
    expect(() => parseIntersystemsServers("{ this is not json at all !!!")).toThrow(
      /malformed JSONC/,
    );
  });
});

// ════════════════════════════════════════════════════════════════════
// discoverSettingsFiles (AC 31.0.1)
// ════════════════════════════════════════════════════════════════════

describe("discoverSettingsFiles", () => {
  it("IRIS_SM_SETTINGS_PATHS (win32 delimiter ;) replaces discovery entirely", () => {
    const files = discoverSettingsFiles(
      {
        IRIS_SM_SETTINGS_PATHS: "C:\\a\\settings.json;C:\\b\\settings.json",
        APPDATA: "C:\\Users\\test\\AppData\\Roaming", // must be ignored — replaced entirely
      },
      "win32",
    );
    expect(files).toEqual(["C:\\a\\settings.json", "C:\\b\\settings.json"]);
  });

  it("IRIS_SM_SETTINGS_PATHS (posix delimiter :) replaces discovery entirely", () => {
    const files = discoverSettingsFiles(
      { IRIS_SM_SETTINGS_PATHS: "/a/settings.json:/b/settings.json" },
      "linux",
    );
    expect(files).toEqual(["/a/settings.json", "/b/settings.json"]);
  });

  it("win32: workspace + all 4 product user-settings paths, from APPDATA", () => {
    const files = discoverSettingsFiles(
      { APPDATA: "C:\\Users\\test\\AppData\\Roaming", IRIS_SM_WORKSPACE: "C:\\myworkspace" },
      "win32",
    );
    expect(files).toEqual([
      "C:\\myworkspace\\.vscode\\settings.json",
      "C:\\Users\\test\\AppData\\Roaming\\Code\\User\\settings.json",
      "C:\\Users\\test\\AppData\\Roaming\\Code - Insiders\\User\\settings.json",
      "C:\\Users\\test\\AppData\\Roaming\\VSCodium\\User\\settings.json",
      "C:\\Users\\test\\AppData\\Roaming\\Cursor\\User\\settings.json",
    ]);
  });

  it("win32: missing APPDATA skips user-settings candidates gracefully (never throws)", () => {
    const files = discoverSettingsFiles({ IRIS_SM_WORKSPACE: "C:\\myworkspace" }, "win32");
    expect(files).toEqual(["C:\\myworkspace\\.vscode\\settings.json"]);
  });

  it("darwin: workspace + all 4 product user-settings paths, from HOME", () => {
    const files = discoverSettingsFiles(
      { HOME: "/Users/test", IRIS_SM_WORKSPACE: "/Users/test/project" },
      "darwin",
    );
    expect(files).toEqual([
      "/Users/test/project/.vscode/settings.json",
      "/Users/test/Library/Application Support/Code/User/settings.json",
      "/Users/test/Library/Application Support/Code - Insiders/User/settings.json",
      "/Users/test/Library/Application Support/VSCodium/User/settings.json",
      "/Users/test/Library/Application Support/Cursor/User/settings.json",
    ]);
  });

  it("linux: workspace + all 4 product user-settings paths, from HOME", () => {
    const files = discoverSettingsFiles(
      { HOME: "/home/test", IRIS_SM_WORKSPACE: "/home/test/project" },
      "linux",
    );
    expect(files).toEqual([
      "/home/test/project/.vscode/settings.json",
      "/home/test/.config/Code/User/settings.json",
      "/home/test/.config/Code - Insiders/User/settings.json",
      "/home/test/.config/VSCodium/User/settings.json",
      "/home/test/.config/Cursor/User/settings.json",
    ]);
  });

  it("linux: missing HOME skips user-settings candidates gracefully (never throws)", () => {
    const files = discoverSettingsFiles({ IRIS_SM_WORKSPACE: "/home/test/project" }, "linux");
    expect(files).toEqual(["/home/test/project/.vscode/settings.json"]);
  });

  it("a non-existent candidate path never throws, and still yields the candidate (existence is not checked here)", () => {
    let files: string[] = [];
    expect(() => {
      files = discoverSettingsFiles({ IRIS_SM_WORKSPACE: "/does/not/exist" }, "linux");
    }).not.toThrow();
    expect(files).toEqual(["/does/not/exist/.vscode/settings.json"]);
  });

  // ── Code-review addition (2026-07-25) ────────────────────────────
  //
  // The workspace fallback used to read `process.cwd()` INSIDE the function
  // (Task 2: "never read from globals inside the function"), so the branch that
  // runs for essentially every real user — nobody sets IRIS_SM_WORKSPACE — was
  // the only one with no coverage. `cwd` is now a signature-defaulted parameter.
  it("falls back to the injected cwd for the workspace candidate when IRIS_SM_WORKSPACE is unset", () => {
    const files = discoverSettingsFiles({}, "linux", "/injected/workspace");
    expect(files).toEqual(["/injected/workspace/.vscode/settings.json"]);
  });

  it("IRIS_SM_WORKSPACE takes precedence over the injected cwd", () => {
    const files = discoverSettingsFiles(
      { IRIS_SM_WORKSPACE: "/explicit/ws" },
      "linux",
      "/injected/workspace",
    );
    expect(files).toEqual(["/explicit/ws/.vscode/settings.json"]);
  });

  it("defaults cwd to process.cwd() when the parameter is omitted", () => {
    const files = discoverSettingsFiles({}, "linux");
    expect(files[0]).toBe(posix.join(process.cwd(), ".vscode", "settings.json"));
  });
});

// ════════════════════════════════════════════════════════════════════
// resolveServerManagerProfiles (AC 31.0.1, 31.0.2, 31.0.3, 31.0.5)
// ════════════════════════════════════════════════════════════════════

describe("resolveServerManagerProfiles", () => {
  let dirs: string[] = [];

  beforeEach(() => {
    dirs = [];
    vi.spyOn(logger, "warn").mockImplementation(() => {});
    vi.spyOn(logger, "debug").mockImplementation(() => {});
  });

  afterEach(() => {
    for (const d of dirs) rmSync(d, { recursive: true, force: true });
    dirs = [];
  });

  function tmpDir(): string {
    const d = makeTmpDir();
    dirs.push(d);
    return d;
  }

  it("off (unset) returns [] and touches ZERO filesystem", () => {
    const result = resolveServerManagerProfiles(BASE_ENV, "win32");
    expect(result).toEqual([]);
    expect(readFileSyncSpy).not.toHaveBeenCalled();
  });

  it("off (explicit) returns [] and touches ZERO filesystem", () => {
    const result = resolveServerManagerProfiles(
      { ...BASE_ENV, IRIS_SERVER_MANAGER: "off" },
      "win32",
    );
    expect(result).toEqual([]);
    expect(readFileSyncSpy).not.toHaveBeenCalled();
  });

  it("auto: resolves a legacy-password entry into a usable IrisProfile, with a deprecation warning", () => {
    const dir = tmpDir();
    const file = writeSettings(
      dir,
      JSON.stringify({
        "intersystems.servers": {
          legacyServer: {
            webServer: { scheme: "https", host: "legacy.example.com", port: 443 },
            username: "legacyuser",
            password: "hunter2",
          },
        },
      }),
    );
    const result = resolveServerManagerProfiles(
      { ...BASE_ENV, IRIS_SERVER_MANAGER: "auto", IRIS_SM_SETTINGS_PATHS: file },
      "win32",
    );
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      name: "legacyServer",
      host: "legacy.example.com",
      port: 443,
      username: "legacyuser",
      password: "hunter2",
      https: true,
      baseUrl: "https://legacy.example.com:443",
    });

    const warnSpy = vi.mocked(logger.warn);
    const deprecationCalls = warnSpy.mock.calls.filter((c) =>
      String(c[0]).includes("deprecated inline"),
    );
    expect(deprecationCalls).toHaveLength(1);
    // Secrets discipline: the deprecation warning never echoes the password.
    for (const call of warnSpy.mock.calls) {
      expect(call.map(String).join(" ")).not.toContain("hunter2");
    }
  });

  it("auto: an entry without its own password is tagged UNRESOLVED (not dropped) — never silently inherits the default profile's password (Story 31.1 widened contract)", () => {
    const dir = tmpDir();
    const file = writeSettings(
      dir,
      JSON.stringify({
        "intersystems.servers": {
          // Declares its own username so the 31-0-2 guard (an entry with no
          // "username" of its own is not imported at all) does not fire —
          // this test is about a missing PASSWORD, nothing else.
          noPassword: {
            webServer: { scheme: "http", host: "other.example.com", port: 52773 },
            username: "u",
          },
        },
      }),
    );
    const result = resolveServerManagerProfiles(
      {
        IRIS_USERNAME: "admin",
        IRIS_PASSWORD: "supersecretdefaultpw",
        IRIS_SERVER_MANAGER: "auto",
        IRIS_SM_SETTINGS_PATHS: file,
      },
      "win32",
    );
    // Story 31.1: no longer excluded outright — included, tagged unresolved,
    // for the credential chain to attempt. If the default password had
    // leaked in, credentialStatus would read "resolved" and/or password
    // would be non-empty.
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      name: "noPassword",
      credentialStatus: "unresolved",
      password: "",
    });
  });

  // The mirror image of the guard above (code review 2026-07-25): the entry
  // brings its OWN password but no host. Pre-fix it inherited the LOCAL default
  // host, producing a profile named after a remote server that pointed at
  // localhost — and shipped that server's password there on first use.
  it("auto: an entry with an inline password but NO host is EXCLUDED — its password never travels to the local default host", () => {
    const dir = tmpDir();
    const file = writeSettings(
      dir,
      JSON.stringify({
        "intersystems.servers": {
          prod: {
            webServer: { scheme: "https", port: 443 },
            username: "prod-admin",
            password: "prodsecret",
          },
        },
      }),
    );
    const result = resolveServerManagerProfiles(
      {
        IRIS_HOST: "localhost",
        IRIS_USERNAME: "admin",
        IRIS_PASSWORD: "localpw",
        IRIS_SERVER_MANAGER: "auto",
        IRIS_SM_SETTINGS_PATHS: file,
      },
      "win32",
    );
    expect(result).toEqual([]);
  });

  it("auto: unresolved profiles are all INCLUDED (tagged) and produce exactly ONE debug-level pending-resolution log line regardless of count (Story 31.1 widened contract)", () => {
    const dir = tmpDir();
    const file = writeSettings(
      dir,
      JSON.stringify({
        // Each declares its own username (31-0-2 guard) — this test is about
        // the count of password-less profiles, not about username handling.
        "intersystems.servers": {
          a: { webServer: { scheme: "http", host: "a.example.com", port: 52773 }, username: "u" },
          b: { webServer: { scheme: "http", host: "b.example.com", port: 52773 }, username: "u" },
          c: { webServer: { scheme: "http", host: "c.example.com", port: 52773 }, username: "u" },
        },
      }),
    );
    const result = resolveServerManagerProfiles(
      { ...BASE_ENV, IRIS_SERVER_MANAGER: "auto", IRIS_SM_SETTINGS_PATHS: file },
      "win32",
    );
    expect(result).toHaveLength(3);
    expect(result.every((r) => r.credentialStatus === "unresolved")).toBe(true);

    const debugSpy = vi.mocked(logger.debug);
    const summaryCalls = debugSpy.mock.calls.filter((c) =>
      String(c[0]).includes("have no password yet"),
    );
    expect(summaryCalls).toHaveLength(1);
    expect(String(summaryCalls[0]?.[0])).toContain("3 server profile(s) have no password yet");
  });

  it("auto: malformed JSONC in one file logs a warning naming that file and skips ONLY it — the other file's valid entries still resolve", () => {
    const dir1 = tmpDir();
    const dir2 = tmpDir();
    const badFile = writeSettings(dir1, "{ this is not valid json at all !!!");
    const goodFile = writeSettings(
      dir2,
      JSON.stringify({
        "intersystems.servers": {
          good: {
            webServer: { scheme: "http", host: "good.example.com", port: 52773 },
            username: "u",
            password: "pw",
          },
        },
      }),
    );
    const result = resolveServerManagerProfiles(
      {
        ...BASE_ENV,
        IRIS_SERVER_MANAGER: "auto",
        IRIS_SM_SETTINGS_PATHS: `${badFile};${goodFile}`,
      },
      "win32",
    );
    expect(result).toHaveLength(1);
    expect(result[0]?.name).toBe("good");

    const warnSpy = vi.mocked(logger.warn);
    const malformedCalls = warnSpy.mock.calls.filter((c) => String(c[0]).includes(badFile));
    expect(malformedCalls).toHaveLength(1);
  });

  it("a name defined by an earlier (higher-precedence) file wins over a later file's same-named entry", () => {
    const dir1 = tmpDir();
    const dir2 = tmpDir();
    const file1 = writeSettings(
      dir1,
      JSON.stringify({
        "intersystems.servers": {
          dup: {
            webServer: { scheme: "http", host: "first.example.com", port: 52773 },
            username: "u",
            password: "pw",
          },
        },
      }),
    );
    const file2 = writeSettings(
      dir2,
      JSON.stringify({
        "intersystems.servers": {
          dup: {
            webServer: { scheme: "http", host: "second.example.com", port: 52773 },
            username: "u",
            password: "pw",
          },
        },
      }),
    );
    const result = resolveServerManagerProfiles(
      { ...BASE_ENV, IRIS_SERVER_MANAGER: "auto", IRIS_SM_SETTINGS_PATHS: `${file1};${file2}` },
      "win32",
    );
    expect(result).toHaveLength(1);
    expect(result[0]?.host).toBe("first.example.com");
  });

  it("IRIS_SM_SERVERS allow-list filters imported names; a listed name matching nothing WARNs (never fails)", () => {
    const dir = tmpDir();
    const file = writeSettings(
      dir,
      JSON.stringify({
        "intersystems.servers": {
          a: {
            webServer: { scheme: "http", host: "a.example.com", port: 52773 },
            username: "u",
            password: "pw",
          },
          b: {
            webServer: { scheme: "http", host: "b.example.com", port: 52773 },
            username: "u",
            password: "pw",
          },
        },
      }),
    );
    const result = resolveServerManagerProfiles(
      {
        ...BASE_ENV,
        IRIS_SERVER_MANAGER: "auto",
        IRIS_SM_SETTINGS_PATHS: file,
        IRIS_SM_SERVERS: "a, doesNotExist",
      },
      "win32",
    );
    expect(result.map((p) => p.name)).toEqual(["a"]);

    const warnSpy = vi.mocked(logger.warn);
    const notFoundCalls = warnSpy.mock.calls.filter((c) => String(c[0]).includes("doesNotExist"));
    expect(notFoundCalls).toHaveLength(1);
  });

  it("required: throws an actionable error when zero definitions are found", () => {
    expect(() =>
      resolveServerManagerProfiles(
        {
          ...BASE_ENV,
          IRIS_SERVER_MANAGER: "required",
          IRIS_SM_SETTINGS_PATHS: "C:\\does\\not\\exist\\settings.json",
        },
        "win32",
      ),
    ).toThrow(/IRIS_SERVER_MANAGER=required but zero server definitions were found/);
  });

  it("required: does NOT throw when at least one definition is found, even if it is unresolved (no password)", () => {
    const dir = tmpDir();
    // Deliberately declares its OWN "username" (the 31-0-2 guard requires it
    // to survive import at all — see the "no username" tests below); the
    // point of THIS test is the password being absent, not the username.
    const file = writeSettings(
      dir,
      JSON.stringify({
        "intersystems.servers": {
          noPw: { webServer: { scheme: "http", host: "h", port: 52773 }, username: "u" },
        },
      }),
    );
    expect(() =>
      resolveServerManagerProfiles(
        { ...BASE_ENV, IRIS_SERVER_MANAGER: "required", IRIS_SM_SETTINGS_PATHS: file },
        "win32",
      ),
    ).not.toThrow();
  });

  // ── Story 31.3, Task 5 — deferred item 31-1-1's resolution ──────────
  //
  // Reproduces the exact live scenario the deferred item recorded: a sole
  // definition that fails mergeProfile's field validation (a non-numeric
  // port). Pre-Story-31.3, definitionsFound/consideredCount both incremented
  // at first sighting BEFORE validation, so neither existing `required` check
  // tripped and the function returned an EMPTY array without throwing —
  // `required` mode silently degraded to "just the default profile". This is
  // the third, narrower check this story adds.
  it("required: throws when the only definition found is rejected by field validation (deferred item 31-1-1)", () => {
    const dir = tmpDir();
    const file = writeSettings(
      dir,
      JSON.stringify({
        "intersystems.servers": {
          badPort: {
            webServer: { scheme: "http", host: "h", port: "not-a-port" },
            username: "u",
          },
        },
      }),
    );
    expect(() =>
      resolveServerManagerProfiles(
        { ...BASE_ENV, IRIS_SERVER_MANAGER: "required", IRIS_SM_SETTINGS_PATHS: file },
        "win32",
      ),
    ).toThrow(/IRIS_SERVER_MANAGER=required but 1 server definition\(s\) were considered and NONE could be imported/);
  });

  it("required: throws when the only definition found is rejected for declaring no username of its own (deferred item 31-1-1)", () => {
    const dir = tmpDir();
    const file = writeSettings(
      dir,
      JSON.stringify({
        "intersystems.servers": {
          noUsername: { webServer: { scheme: "http", host: "h", port: 52773 } },
        },
      }),
    );
    expect(() =>
      resolveServerManagerProfiles(
        { ...BASE_ENV, IRIS_SERVER_MANAGER: "required", IRIS_SM_SETTINGS_PATHS: file },
        "win32",
      ),
    ).toThrow(/IRIS_SERVER_MANAGER=required but 1 server definition\(s\) were considered and NONE could be imported/);
  });

  it("required: does NOT throw when at least one of several definitions is imported, even though another was rejected", () => {
    const dir = tmpDir();
    const file = writeSettings(
      dir,
      JSON.stringify({
        "intersystems.servers": {
          good: { webServer: { scheme: "http", host: "h1", port: 52773 }, username: "u" },
          badPort: {
            webServer: { scheme: "http", host: "h2", port: "not-a-port" },
            username: "u",
          },
        },
      }),
    );
    let result: ReturnType<typeof resolveServerManagerProfiles> = [];
    expect(() => {
      result = resolveServerManagerProfiles(
        { ...BASE_ENV, IRIS_SERVER_MANAGER: "required", IRIS_SM_SETTINGS_PATHS: file },
        "win32",
      );
    }).not.toThrow();
    expect(result.map((p) => p.name)).toEqual(["good"]);
  });

  it("pathPrefix is applied as a post-merge baseUrl suffix (composed URL)", () => {
    const dir = tmpDir();
    const file = writeSettings(
      dir,
      JSON.stringify({
        "intersystems.servers": {
          prefixed: {
            webServer: {
              scheme: "http",
              host: "localhost",
              port: 52773,
              pathPrefix: "myprefix//",
            },
            username: "u",
            password: "pw",
          },
        },
      }),
    );
    const result = resolveServerManagerProfiles(
      { ...BASE_ENV, IRIS_SERVER_MANAGER: "auto", IRIS_SM_SETTINGS_PATHS: file },
      "win32",
    );
    expect(result[0]?.baseUrl).toBe("http://localhost:52773/myprefix");
    // Deferred item 31-0-4's resolution: the prefix is now a STRUCTURED field
    // too, so baseUrl is recoverable as deriveBaseUrl(host, port, https) +
    // pathPrefix — restoring the invariant without touching deriveBaseUrl.
    expect(result[0]?.pathPrefix).toBe("/myprefix");
    expect(result[0]?.baseUrl).toBe(
      `http://${result[0]?.host}:${result[0]?.port}${result[0]?.pathPrefix}`,
    );
  });

  it("an absent/empty pathPrefix produces a baseUrl identical to today's derivation, and carries NO pathPrefix field", () => {
    const dir = tmpDir();
    const file = writeSettings(
      dir,
      JSON.stringify({
        "intersystems.servers": {
          plain: {
            webServer: { scheme: "http", host: "localhost", port: 52773, pathPrefix: "" },
            username: "u",
            password: "pw",
          },
        },
      }),
    );
    const result = resolveServerManagerProfiles(
      { ...BASE_ENV, IRIS_SERVER_MANAGER: "auto", IRIS_SM_SETTINGS_PATHS: file },
      "win32",
    );
    expect(result[0]?.baseUrl).toBe("http://localhost:52773");
    expect(result[0]?.pathPrefix).toBeUndefined();
    expect(result[0]).not.toHaveProperty("pathPrefix");
  });

  // ── Story 31.3 — AC 31.3.1 provenance + deferred item 31-0-3's resolution ──

  it("a resolved Server-Manager profile carries source:\"server-manager\" and sourceFile naming the settings file it came from", () => {
    const dir = tmpDir();
    const file = writeSettings(
      dir,
      JSON.stringify({
        "intersystems.servers": {
          someServer: {
            webServer: { scheme: "https", host: "sm.example.com", port: 443 },
            username: "smuser",
            password: "smpass",
          },
        },
      }),
    );
    const result = resolveServerManagerProfiles(
      { ...BASE_ENV, IRIS_SERVER_MANAGER: "auto", IRIS_SM_SETTINGS_PATHS: file },
      "win32",
    );
    expect(result[0]?.source).toBe("server-manager");
    expect(result[0]?.sourceFile).toBe(file);
  });

  it("the mergeProfile trap: a bad Server-Manager definition's diagnostic names the settings file/server, NEVER 'IRIS_PROFILES'", () => {
    const dir = tmpDir();
    const file = writeSettings(
      dir,
      JSON.stringify({
        "intersystems.servers": {
          badPort: {
            webServer: { scheme: "http", host: "h", port: "not-a-number" },
            username: "u",
            password: "pw",
          },
        },
      }),
    );
    expect(() =>
      resolveServerManagerProfiles(
        { ...BASE_ENV, IRIS_SERVER_MANAGER: "auto", IRIS_SM_SETTINGS_PATHS: file },
        "win32",
      ),
    ).not.toThrow();

    const warnSpy = vi.mocked(logger.warn);
    const badPortCalls = warnSpy.mock.calls.filter((c) => String(c[0]).includes("badPort"));
    expect(badPortCalls).toHaveLength(1);
    const message = String(badPortCalls[0]?.[0]);
    expect(message).not.toContain("IRIS_PROFILES");
    expect(message).toContain(file);
    expect(message).toContain("port");
  });

  // ── Containment (code review 2026-07-25) ─────────────────────────
  //
  // AC 31.0.2 requires that `auto` "never crashes startup". Malformed JSONC was
  // contained per-FILE from the start, but a malformed FIELD VALUE used to throw
  // straight out of resolveServerManagerProfiles → loadProfileRegistry →
  // McpServerBase.start(), taking down all five servers (and the perfectly good
  // env-derived `default` profile) because of one stale entry in a VS Code
  // settings file this suite does not own.
  it("auto: one entry with an invalid field value is warned-and-skipped; sibling entries in the SAME file still resolve", () => {
    const dir = tmpDir();
    const file = writeSettings(
      dir,
      JSON.stringify({
        "intersystems.servers": {
          bad: {
            webServer: { scheme: "http", host: "bad.example.com", port: "not-a-number" },
            username: "u",
            password: "pw",
          },
          good: {
            webServer: { scheme: "http", host: "good.example.com", port: 52773 },
            username: "u",
            password: "pw",
          },
        },
      }),
    );
    const result = resolveServerManagerProfiles(
      { ...BASE_ENV, IRIS_SERVER_MANAGER: "auto", IRIS_SM_SETTINGS_PATHS: file },
      "win32",
    );
    expect(result.map((p) => p.name)).toEqual(["good"]);
  });

  it.each([
    ["port 0", { webServer: { scheme: "http", host: "h", port: 0 }, password: "pw" }],
    ["port null", { webServer: { scheme: "http", host: "h", port: null }, password: "pw" }],
    [
      "port out of range",
      { webServer: { scheme: "http", host: "h", port: 99999 }, password: "pw" },
    ],
    [
      "non-string username",
      { webServer: { scheme: "http", host: "h", port: 1 }, username: 42, password: "pw" },
    ],
    [
      "empty username",
      { webServer: { scheme: "http", host: "h", port: 1 }, username: "", password: "pw" },
    ],
    [
      "non-string password",
      { webServer: { scheme: "http", host: "h", port: 1 }, username: "u", password: 42 },
    ],
  ])(
    "auto: an invalid entry (%s) never escapes as a throw — containment holds on every mergeProfile validation branch",
    (_label, brokenEntry) => {
      const dir = tmpDir();
      const file = writeSettings(
        dir,
        JSON.stringify({ "intersystems.servers": { broken: brokenEntry } }),
      );
      expect(() =>
        resolveServerManagerProfiles(
          { ...BASE_ENV, IRIS_SERVER_MANAGER: "auto", IRIS_SM_SETTINGS_PATHS: file },
          "win32",
        ),
      ).not.toThrow();
    },
  );

  it("auto: an unreadable (non-ENOENT) candidate — e.g. a directory — logs a warning naming it, and is skipped", () => {
    const dir = tmpDir(); // a directory, not a file → EISDIR/EPERM, never ENOENT
    const result = resolveServerManagerProfiles(
      { ...BASE_ENV, IRIS_SERVER_MANAGER: "auto", IRIS_SM_SETTINGS_PATHS: dir },
      "win32",
    );
    expect(result).toEqual([]);
    const warnSpy = vi.mocked(logger.warn);
    const readCalls = warnSpy.mock.calls.filter((c) => String(c[0]).includes("could not read"));
    expect(readCalls).toHaveLength(1);
    expect(String(readCalls[0]?.[0])).toContain(dir);
  });

  it("auto: a merely-missing (ENOENT) candidate stays silent — no 'could not read' noise", () => {
    resolveServerManagerProfiles(
      {
        ...BASE_ENV,
        IRIS_SERVER_MANAGER: "auto",
        IRIS_SM_SETTINGS_PATHS: "C:\\does\\not\\exist\\settings.json",
      },
      "win32",
    );
    const warnSpy = vi.mocked(logger.warn);
    expect(
      warnSpy.mock.calls.filter((c) => String(c[0]).includes("could not read")),
    ).toHaveLength(0);
  });

  it("required + an IRIS_SM_SERVERS that matches nothing fails naming IRIS_SM_SERVERS and the available names — not the settings files", () => {
    const dir = tmpDir();
    const file = writeSettings(
      dir,
      JSON.stringify({
        "intersystems.servers": {
          prodA: {
            webServer: { scheme: "http", host: "a.example.com", port: 52773 },
            username: "u",
            password: "pw",
          },
          prodB: {
            webServer: { scheme: "http", host: "b.example.com", port: 52773 },
            username: "u",
            password: "pw",
          },
        },
      }),
    );
    let caught: unknown;
    try {
      resolveServerManagerProfiles(
        {
          ...BASE_ENV,
          IRIS_SERVER_MANAGER: "required",
          IRIS_SM_SETTINGS_PATHS: file,
          IRIS_SM_SERVERS: "prodC",
        },
        "win32",
      );
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(Error);
    const message = (caught as Error).message;
    expect(message).toContain("IRIS_SM_SERVERS");
    expect(message).toContain("prodC");
    expect(message).toContain("prodA");
    expect(message).toContain("prodB");
    // The old message sent the user to fix settings files that were already correct.
    expect(message).not.toContain("zero server definitions were found");
  });

  it("auto + an IRIS_SM_SERVERS that matches nothing still only WARNs (AC 31.0.3)", () => {
    const dir = tmpDir();
    const file = writeSettings(
      dir,
      JSON.stringify({
        "intersystems.servers": {
          prodA: {
            webServer: { scheme: "http", host: "a.example.com", port: 52773 },
            username: "u",
            password: "pw",
          },
        },
      }),
    );
    expect(() =>
      resolveServerManagerProfiles(
        {
          ...BASE_ENV,
          IRIS_SERVER_MANAGER: "auto",
          IRIS_SM_SETTINGS_PATHS: file,
          IRIS_SM_SERVERS: "prodC",
        },
        "win32",
      ),
    ).not.toThrow();
  });

  it("auto: zero candidate settings files warns actionably instead of failing silently", () => {
    const result = resolveServerManagerProfiles(
      { ...BASE_ENV, IRIS_SERVER_MANAGER: "auto", IRIS_SM_SETTINGS_PATHS: "   " },
      "win32",
    );
    expect(result).toEqual([]);
    const warnSpy = vi.mocked(logger.warn);
    const noCandidateCalls = warnSpy.mock.calls.filter((c) =>
      String(c[0]).includes("no candidate settings files were derived"),
    );
    expect(noCandidateCalls).toHaveLength(1);
  });

  it("a Server-Manager profile inherits namespace/timeout from the local default config, like an IRIS_PROFILES entry", () => {
    const dir = tmpDir();
    const file = writeSettings(
      dir,
      JSON.stringify({
        "intersystems.servers": {
          srv: {
            webServer: { scheme: "http", host: "h", port: 52773 },
            username: "u",
            password: "pw",
          },
        },
      }),
    );
    const result = resolveServerManagerProfiles(
      {
        IRIS_USERNAME: "admin",
        IRIS_PASSWORD: "secret",
        IRIS_NAMESPACE: "CUSTOMNS",
        IRIS_TIMEOUT: "12345",
        IRIS_SERVER_MANAGER: "auto",
        IRIS_SM_SETTINGS_PATHS: file,
      },
      "win32",
    );
    expect(result[0]?.namespace).toBe("CUSTOMNS");
    expect(result[0]?.timeout).toBe(12345);
  });

  it("a missing settings file candidate is silently skipped (never throws, no entries)", () => {
    const result = resolveServerManagerProfiles(
      {
        ...BASE_ENV,
        IRIS_SERVER_MANAGER: "auto",
        IRIS_SM_SETTINGS_PATHS: "C:\\does\\not\\exist\\settings.json",
      },
      "win32",
    );
    expect(result).toEqual([]);
  });

  it("propagates loadConfig's fail-fast (missing IRIS_USERNAME) in auto mode", () => {
    expect(() =>
      resolveServerManagerProfiles(
        { IRIS_PASSWORD: "p", IRIS_SERVER_MANAGER: "auto" },
        "win32",
      ),
    ).toThrow("IRIS_USERNAME");
  });

  // ── Secret-safety (QA addition) ──────────────────────────────────
  //
  // The dev's existing "the mergeProfile trap" test proves the error names
  // the file/server, not IRIS_PROFILES. It does NOT combine a validation
  // failure with a genuine secret value present in the SAME entry — the one
  // shape where a careless error message (e.g. echoing the whole malformed
  // entry for debuggability) could leak a password. Prove it can't.
  it("secret-safety: a validation failure on an entry that ALSO carries a legacy password never echoes the password", () => {
    const dir = tmpDir();
    const file = writeSettings(
      dir,
      JSON.stringify({
        "intersystems.servers": {
          badEntry: {
            webServer: { scheme: "http", host: "h", port: "not-a-number" },
            username: "u",
            password: "topsecretvalue",
          },
        },
      }),
    );
    const result = resolveServerManagerProfiles(
      { ...BASE_ENV, IRIS_SERVER_MANAGER: "auto", IRIS_SM_SETTINGS_PATHS: file },
      "win32",
    );
    expect(result).toEqual([]);

    // The diagnostic naming the bad entry exists (containment, not silence)...
    const warnSpy = vi.mocked(logger.warn);
    const badEntryCalls = warnSpy.mock.calls.filter((c) => String(c[0]).includes("badEntry"));
    expect(badEntryCalls.length).toBeGreaterThan(0);
    // ...and nothing warned along the way echoes the secret.
    for (const call of warnSpy.mock.calls) {
      expect(call.map(String).join(" ")).not.toContain("topsecretvalue");
    }
  });

  it("secret-safety: the default profile's own password never appears in the required-mode zero-definitions error", () => {
    // NOTE: `.not.toThrow(/pattern/)` also passes when NOTHING throws, so this
    // must assert the throw happens first and then inspect the message — the
    // negative-matcher alone would stay green if the fail-fast were deleted.
    let caught: unknown;
    try {
      resolveServerManagerProfiles(
        {
          IRIS_USERNAME: "admin",
          IRIS_PASSWORD: "defaultsupersecret",
          IRIS_SERVER_MANAGER: "required",
          IRIS_SM_SETTINGS_PATHS: "C:\\does\\not\\exist\\settings.json",
        },
        "win32",
      );
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).toContain("zero server definitions were found");
    expect((caught as Error).message).not.toContain("defaultsupersecret");
  });

  // ── Story 31.1, Task 5 — deferred item 31-0-1 (`seenNames` shadowing) ────
  //
  // Decision (documented in the module doc comment): a later file's entry
  // for a name already claimed but still UNRESOLVED may "rescue" the slot by
  // overwriting it, but ONLY when the later entry itself resolves (a later
  // entry that is ALSO unresolved changes nothing).

  it("31-0-1: a lower-precedence file's RESOLVED entry rescues a higher-precedence file's UNRESOLVED entry of the same name", () => {
    const dir1 = tmpDir();
    const dir2 = tmpDir();
    const higherFile = writeSettings(
      dir1,
      JSON.stringify({
        "intersystems.servers": {
          dup: {
            webServer: { scheme: "http", host: "higher.example.com", port: 52773 },
            username: "u", // has its own username, so it's genuinely just password-missing
          },
        },
      }),
    );
    const lowerFile = writeSettings(
      dir2,
      JSON.stringify({
        "intersystems.servers": {
          dup: {
            webServer: { scheme: "http", host: "lower.example.com", port: 52773 },
            username: "u2",
            password: "lowerpw", // legacy inline password — immediately resolvable
          },
        },
      }),
    );
    const result = resolveServerManagerProfiles(
      {
        ...BASE_ENV,
        IRIS_SERVER_MANAGER: "auto",
        IRIS_SM_SETTINGS_PATHS: `${higherFile};${lowerFile}`,
      },
      "win32",
    );
    // Exactly one "dup" entry, using the LOWER file's full definition
    // (structure + password) — not a mix of the higher file's host with the
    // lower file's password.
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      name: "dup",
      credentialStatus: "resolved",
      host: "lower.example.com",
      username: "u2",
      password: "lowerpw",
    });

    // Code review 2026-07-25 (MEDIUM): the rescue replaces the WHOLE
    // higher-precedence definition — host included — so it must never be
    // silent. The warning names both hosts and the remedy.
    const warnSpy = vi.mocked(logger.warn);
    const rescueWarnings = warnSpy.mock.calls.filter((c) =>
      String(c[0]).includes("defined in more than one settings file"),
    );
    expect(rescueWarnings).toHaveLength(1);
    const message = String(rescueWarnings[0]?.[0]);
    expect(message).toContain("higher.example.com");
    expect(message).toContain("lower.example.com");
    expect(message).toContain("iris-mcp-credentials set dup");
    // Secret discipline: the rescuing entry's password is never echoed.
    for (const call of warnSpy.mock.calls) {
      expect(call.map(String).join(" ")).not.toContain("lowerpw");
    }
  });

  it("31-0-1: a lower-precedence file's ALSO-unresolved entry does NOT rescue — the higher-precedence structural definition remains authoritative", () => {
    const dir1 = tmpDir();
    const dir2 = tmpDir();
    const higherFile = writeSettings(
      dir1,
      JSON.stringify({
        "intersystems.servers": {
          dup: {
            webServer: { scheme: "http", host: "higher.example.com", port: 52773 },
            username: "u",
          },
        },
      }),
    );
    const lowerFile = writeSettings(
      dir2,
      JSON.stringify({
        "intersystems.servers": {
          dup: {
            webServer: { scheme: "http", host: "lower.example.com", port: 52773 },
            username: "u2",
            // No password here either — nothing to rescue with.
          },
        },
      }),
    );
    const result = resolveServerManagerProfiles(
      {
        ...BASE_ENV,
        IRIS_SERVER_MANAGER: "auto",
        IRIS_SM_SETTINGS_PATHS: `${higherFile};${lowerFile}`,
      },
      "win32",
    );
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      name: "dup",
      credentialStatus: "unresolved",
      host: "higher.example.com", // higher-precedence structure wins, unchanged
    });
  });

  // ── Story 31.1, Task 6 — deferred item 31-0-2 (`username` inheritance) ───
  //
  // Decision (documented in the module doc comment): an entry that does not
  // declare its OWN "username" is NOT IMPORTED AT ALL — never silently pair
  // an inherited local username with a password destined for a different
  // remote host.
  //
  // Code review 2026-07-25 (HIGH): the first implementation only tagged such
  // an entry "unresolved" and cleared its password. That does not work,
  // because "unresolved" is precisely what is handed to the credential chain,
  // which resolves by NAME and wrote the resulting password straight back
  // onto the inherited username — recreating the exact lockout hazard. The
  // guard now SKIPS the entry, which the chain cannot undo. The end-to-end
  // proof (chain would have resolved it, and does not) lives in
  // `profiles.test.ts`; these two pin the source-layer contract.

  it("31-0-2: a legacy-password entry WITHOUT its own username is NOT imported (never inherits the local default username)", () => {
    const dir = tmpDir();
    const file = writeSettings(
      dir,
      JSON.stringify({
        "intersystems.servers": {
          noUsername: {
            webServer: { scheme: "https", host: "remote.example.com", port: 443 },
            password: "remotepw", // legacy inline password, but no "username" field
          },
        },
      }),
    );
    const result = resolveServerManagerProfiles(
      { ...BASE_ENV, IRIS_SERVER_MANAGER: "auto", IRIS_SM_SETTINGS_PATHS: file },
      "win32",
    );
    expect(result).toEqual([]);

    const warnSpy = vi.mocked(logger.warn);
    const usernameWarnings = warnSpy.mock.calls.filter((c) =>
      String(c[0]).includes(`declares no "username" of its own`),
    );
    expect(usernameWarnings).toHaveLength(1);
    expect(String(usernameWarnings[0]?.[0])).toContain("skipping server \"noUsername\"");
    // Secret discipline: the password never appears in the warning either.
    for (const call of warnSpy.mock.calls) {
      expect(call.map(String).join(" ")).not.toContain("remotepw");
    }
  });

  it("31-0-2: an entry with NO username and NO inline password is also skipped, and still warns (the silent case the first implementation missed)", () => {
    const dir = tmpDir();
    const file = writeSettings(
      dir,
      JSON.stringify({
        "intersystems.servers": {
          noUsername: { webServer: { scheme: "https", host: "remote.example.com", port: 443 } },
        },
      }),
    );
    const result = resolveServerManagerProfiles(
      { ...BASE_ENV, IRIS_SERVER_MANAGER: "auto", IRIS_SM_SETTINGS_PATHS: file },
      "win32",
    );
    expect(result).toEqual([]);
    const warnSpy = vi.mocked(logger.warn);
    expect(
      warnSpy.mock.calls.filter((c) => String(c[0]).includes(`declares no "username" of its own`)),
    ).toHaveLength(1);
  });

  it("31-0-2: a username-less entry does NOT poison the name — a lower-precedence file's entry that DOES declare a username still claims the slot", () => {
    const dir1 = tmpDir();
    const dir2 = tmpDir();
    const higherFile = writeSettings(
      dir1,
      JSON.stringify({
        "intersystems.servers": {
          dup: { webServer: { scheme: "http", host: "higher.example.com", port: 52773 } },
        },
      }),
    );
    const lowerFile = writeSettings(
      dir2,
      JSON.stringify({
        "intersystems.servers": {
          dup: {
            webServer: { scheme: "http", host: "lower.example.com", port: 52773 },
            username: "u2",
          },
        },
      }),
    );
    const result = resolveServerManagerProfiles(
      {
        ...BASE_ENV,
        IRIS_SERVER_MANAGER: "auto",
        IRIS_SM_SETTINGS_PATHS: `${higherFile};${lowerFile}`,
      },
      "win32",
    );
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      name: "dup",
      host: "lower.example.com",
      username: "u2",
      credentialStatus: "unresolved",
    });
  });

  it("31-0-2: an entry WITH its own username and a legacy password resolves normally (no forced-unresolved, no username warning)", () => {
    const dir = tmpDir();
    const file = writeSettings(
      dir,
      JSON.stringify({
        "intersystems.servers": {
          hasUsername: {
            webServer: { scheme: "https", host: "remote.example.com", port: 443 },
            username: "remoteuser",
            password: "remotepw",
          },
        },
      }),
    );
    const result = resolveServerManagerProfiles(
      { ...BASE_ENV, IRIS_SERVER_MANAGER: "auto", IRIS_SM_SETTINGS_PATHS: file },
      "win32",
    );
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      name: "hasUsername",
      credentialStatus: "resolved",
      username: "remoteuser",
      password: "remotepw",
    });
    const warnSpy = vi.mocked(logger.warn);
    expect(
      warnSpy.mock.calls.filter((c) => String(c[0]).includes(`no "username" of its own`)),
    ).toHaveLength(0);
  });
});

// ════════════════════════════════════════════════════════════════════
// Cross-platform integration (QA addition): resolveServerManagerProfiles
// driven through REAL discoverSettingsFiles precedence (workspace + one
// user-settings product), not the IRIS_SM_SETTINGS_PATHS override every
// other resolveServerManagerProfiles test above uses. This proves the
// posix path-building in discoverSettingsFiles (path.posix.join) actually
// composes a path that fs.readFileSync can open — the dev's own
// discoverSettingsFiles tests only assert the RETURNED STRINGS, never that
// a file written at that exact composed path is readable end-to-end. Run
// unconditionally (not host-OS-gated): Node's fs calls accept forward-slash
// paths on Windows too, so this exercises the posix-join code path for real
// regardless of the host platform running the suite.
// ════════════════════════════════════════════════════════════════════

describe("resolveServerManagerProfiles — real posix discovery integration (QA addition)", () => {
  let dirs: string[] = [];

  beforeEach(() => {
    vi.spyOn(logger, "warn").mockImplementation(() => {});
    vi.spyOn(logger, "debug").mockImplementation(() => {});
  });

  afterEach(() => {
    for (const d of dirs) rmSync(d, { recursive: true, force: true });
    dirs = [];
    vi.restoreAllMocks();
  });

  /** A tmpdir path normalized to forward slashes, matching path.posix.join's own output style. */
  function tmpDirPosix(): string {
    const raw = mkdtempSync(join(tmpdir(), "iris-sm-posix-"));
    dirs.push(raw);
    return raw.split("\\").join("/");
  }

  it("linux: entries from BOTH the workspace file AND a user-settings file (found via real discovery, not an override) resolve together", () => {
    const home = tmpDirPosix();
    const workspace = tmpDirPosix();

    const userSettingsDir = `${home}/.config/Code/User`;
    mkdirSync(userSettingsDir, { recursive: true });
    writeFileSync(
      `${userSettingsDir}/settings.json`,
      JSON.stringify({
        "intersystems.servers": {
          fromUserSettings: {
            webServer: { scheme: "http", host: "user.example.com", port: 52773 },
            username: "u",
            password: "pw",
          },
        },
      }),
      "utf8",
    );

    const workspaceSettingsDir = `${workspace}/.vscode`;
    mkdirSync(workspaceSettingsDir, { recursive: true });
    writeFileSync(
      `${workspaceSettingsDir}/settings.json`,
      JSON.stringify({
        "intersystems.servers": {
          fromWorkspace: {
            webServer: { scheme: "http", host: "ws.example.com", port: 52773 },
            username: "u",
            password: "pw",
          },
        },
      }),
      "utf8",
    );

    const result = resolveServerManagerProfiles(
      { ...BASE_ENV, IRIS_SERVER_MANAGER: "auto", HOME: home, IRIS_SM_WORKSPACE: workspace },
      "linux",
    );

    expect(result.map((p) => p.name).sort()).toEqual(["fromUserSettings", "fromWorkspace"]);
    expect(result.find((p) => p.name === "fromWorkspace")?.host).toBe("ws.example.com");
    expect(result.find((p) => p.name === "fromUserSettings")?.host).toBe("user.example.com");
  });

  it("linux: a name defined in BOTH files resolves to the workspace file's definition (real precedence, not IRIS_SM_SETTINGS_PATHS-forced order)", () => {
    const home = tmpDirPosix();
    const workspace = tmpDirPosix();

    const userSettingsDir = `${home}/.config/Code/User`;
    mkdirSync(userSettingsDir, { recursive: true });
    writeFileSync(
      `${userSettingsDir}/settings.json`,
      JSON.stringify({
        "intersystems.servers": {
          dup: {
            webServer: { scheme: "http", host: "user-settings-host.example.com", port: 52773 },
            username: "u",
            password: "pw",
          },
        },
      }),
      "utf8",
    );

    const workspaceSettingsDir = `${workspace}/.vscode`;
    mkdirSync(workspaceSettingsDir, { recursive: true });
    writeFileSync(
      `${workspaceSettingsDir}/settings.json`,
      JSON.stringify({
        "intersystems.servers": {
          dup: {
            webServer: { scheme: "http", host: "workspace-host.example.com", port: 52773 },
            username: "u",
            password: "pw",
          },
        },
      }),
      "utf8",
    );

    const result = resolveServerManagerProfiles(
      { ...BASE_ENV, IRIS_SERVER_MANAGER: "auto", HOME: home, IRIS_SM_WORKSPACE: workspace },
      "linux",
    );

    expect(result).toHaveLength(1);
    expect(result[0]?.host).toBe("workspace-host.example.com");
  });
});

// ════════════════════════════════════════════════════════════════════
// .code-workspace support — post-Epic-31 coverage-gap fix
//
// A VS Code `.code-workspace` file is a legitimate home for
// `intersystems.servers` (multi-root workspaces commonly use ONLY that file),
// but discovery originally looked at `.vscode/settings.json` and the per-product
// user settings only — so those servers were silently invisible, and `auto`
// does not fail on zero definitions. Precedence follows VS Code's own scope
// ranking: folder (`.vscode/settings.json`) > workspace (`*.code-workspace`)
// > user.
// ════════════════════════════════════════════════════════════════════

describe(".code-workspace support (coverage-gap fix)", () => {
  let dirs: string[] = [];

  beforeEach(() => {
    vi.spyOn(logger, "warn").mockImplementation(() => {});
    vi.spyOn(logger, "debug").mockImplementation(() => {});
  });

  afterEach(() => {
    for (const d of dirs) rmSync(d, { recursive: true, force: true });
    dirs = [];
    vi.restoreAllMocks();
  });

  /** A tmpdir path normalized to forward slashes, matching path.posix.join's output style. */
  function tmpDirPosix(): string {
    const raw = mkdtempSync(join(tmpdir(), "iris-sm-cw-"));
    dirs.push(raw);
    return raw.split("\\").join("/");
  }

  function entry(host: string) {
    return {
      webServer: { scheme: "http", host, port: 52773 },
      username: "u",
      password: "pw",
    };
  }

  // ── parser accepts both file shapes ──────────────────────────────

  it("parses intersystems.servers nested under a .code-workspace settings key", () => {
    const result = parseIntersystemsServers(
      JSON.stringify({
        folders: [{ path: "." }, { name: "iris", uri: "isfs://local/" }],
        settings: {
          "objectscript.export.folder": "src",
          "intersystems.servers": { wsOnly: entry("ws.example.com") },
        },
      }),
    );
    expect(Object.keys(result)).toEqual(["wsOnly"]);
    expect(result.wsOnly?.override.host).toBe("ws.example.com");
    expect(result.wsOnly?.legacyPassword).toBe(true);
  });

  it("a top-level intersystems.servers wins over a nested one in the same file", () => {
    const result = parseIntersystemsServers(
      JSON.stringify({
        "intersystems.servers": { pick: entry("top.example.com") },
        settings: { "intersystems.servers": { ignore: entry("nested.example.com") } },
      }),
    );
    expect(Object.keys(result)).toEqual(["pick"]);
    expect(result.pick?.override.host).toBe("top.example.com");
  });

  it("a non-object settings key yields no servers and does not throw", () => {
    expect(() =>
      parseIntersystemsServers(JSON.stringify({ settings: "not-an-object" })),
    ).not.toThrow();
    expect(parseIntersystemsServers(JSON.stringify({ settings: "x" }))).toEqual({});
    expect(parseIntersystemsServers(JSON.stringify({ settings: [1, 2] }))).toEqual({});
    expect(parseIntersystemsServers(JSON.stringify({ settings: null }))).toEqual({});
  });

  it("JSONC comments and trailing commas parse inside a .code-workspace too", () => {
    const result = parseIntersystemsServers(`{
      // a real .code-workspace is JSONC as well
      "folders": [{ "path": "." },],
      "settings": {
        "intersystems.servers": {
          "jsoncWs": {
            "webServer": { "scheme": "https", "host": "sec.example.com", "port": 443, },
            "username": "u",
          },
        },
      },
    }`);
    expect(Object.keys(result)).toEqual(["jsoncWs"]);
    expect(result.jsoncWs?.override.https).toBe(true);
  });

  // ── discovery ordering ───────────────────────────────────────────

  it("places code-workspace files AFTER .vscode/settings.json and BEFORE user settings", () => {
    const ws = tmpDirPosix();
    writeFileSync(`${ws}/proj.code-workspace`, "{}", "utf8");

    const candidates = discoverSettingsFiles(
      { HOME: tmpDirPosix(), IRIS_SM_WORKSPACE: ws },
      "linux",
    );

    const folderIdx = candidates.indexOf(`${ws}/.vscode/settings.json`);
    const wsFileIdx = candidates.indexOf(`${ws}/proj.code-workspace`);
    const firstUserIdx = candidates.findIndex((c) => c.includes("/.config/"));

    expect(folderIdx).toBeGreaterThanOrEqual(0);
    expect(wsFileIdx).toBeGreaterThanOrEqual(0);
    expect(firstUserIdx).toBeGreaterThanOrEqual(0);
    // folder < workspace-file < user — VS Code's own scope ranking
    expect(folderIdx).toBeLessThan(wsFileIdx);
    expect(wsFileIdx).toBeLessThan(firstUserIdx);
  });

  it("returns multiple code-workspace files sorted by name for determinism", () => {
    const ws = tmpDirPosix();
    for (const n of ["zeta.code-workspace", "alpha.code-workspace", "mid.code-workspace"]) {
      writeFileSync(`${ws}/${n}`, "{}", "utf8");
    }
    const found = discoverSettingsFiles(
      { HOME: tmpDirPosix(), IRIS_SM_WORKSPACE: ws },
      "linux",
    ).filter((c) => c.endsWith(".code-workspace"));
    expect(found).toEqual([
      `${ws}/alpha.code-workspace`,
      `${ws}/mid.code-workspace`,
      `${ws}/zeta.code-workspace`,
    ]);
  });

  it("a workspace directory that does not exist contributes no candidates and never throws", () => {
    let candidates: string[] = [];
    expect(() => {
      candidates = discoverSettingsFiles(
        { HOME: tmpDirPosix(), IRIS_SM_WORKSPACE: "/no/such/dir/anywhere" },
        "linux",
      );
    }).not.toThrow();
    expect(candidates.some((c) => c.endsWith(".code-workspace"))).toBe(false);
    // the fixed .vscode/settings.json candidate is still emitted unconditionally
    expect(candidates).toContain("/no/such/dir/anywhere/.vscode/settings.json");
  });

  it("files that merely contain the suffix mid-name are not candidates", () => {
    const ws = tmpDirPosix();
    writeFileSync(`${ws}/notes.code-workspace.bak`, "{}", "utf8");
    const found = discoverSettingsFiles(
      { HOME: tmpDirPosix(), IRIS_SM_WORKSPACE: ws },
      "linux",
    ).filter((c) => c.includes(".code-workspace"));
    expect(found).toEqual([]);
  });

  // ── the actual gap being fixed ───────────────────────────────────

  it("REGRESSION: a server defined ONLY in a .code-workspace file IS imported", () => {
    const ws = tmpDirPosix();
    writeFileSync(
      `${ws}/iris.code-workspace`,
      JSON.stringify({
        folders: [{ path: "." }],
        settings: {
          "intersystems.servers": { onlyInWorkspaceFile: entry("wsonly.example.com") },
        },
      }),
      "utf8",
    );

    const result = resolveServerManagerProfiles(
      { ...BASE_ENV, IRIS_SERVER_MANAGER: "auto", HOME: tmpDirPosix(), IRIS_SM_WORKSPACE: ws },
      "linux",
    );

    const found = result.find((r) => r.name === "onlyInWorkspaceFile");
    expect(found).toBeDefined();
    expect(found?.host).toBe("wsonly.example.com");
  });

  // ── precedence, end to end ───────────────────────────────────────

  it("precedence: .vscode/settings.json beats .code-workspace beats user settings", () => {
    const home = tmpDirPosix();
    const ws = tmpDirPosix();
    const sameName = "collide";

    const userDir = `${home}/.config/Code/User`;
    mkdirSync(userDir, { recursive: true });
    writeFileSync(
      `${userDir}/settings.json`,
      JSON.stringify({ "intersystems.servers": { [sameName]: entry("user.example.com") } }),
      "utf8",
    );

    writeFileSync(
      `${ws}/proj.code-workspace`,
      JSON.stringify({
        settings: {
          "intersystems.servers": { [sameName]: entry("workspacefile.example.com") },
        },
      }),
      "utf8",
    );

    const vscodeDir = `${ws}/.vscode`;
    mkdirSync(vscodeDir, { recursive: true });
    writeFileSync(
      `${vscodeDir}/settings.json`,
      JSON.stringify({ "intersystems.servers": { [sameName]: entry("folder.example.com") } }),
      "utf8",
    );

    const env = { ...BASE_ENV, IRIS_SERVER_MANAGER: "auto", HOME: home, IRIS_SM_WORKSPACE: ws };

    // all three present => folder scope wins
    let hit = resolveServerManagerProfiles(env, "linux").find(
      (r) => r.name === sameName,
    );
    expect(hit?.host).toBe("folder.example.com");

    // drop folder scope => the .code-workspace file wins
    rmSync(`${vscodeDir}/settings.json`);
    hit = resolveServerManagerProfiles(env, "linux").find((r) => r.name === sameName);
    expect(hit?.host).toBe("workspacefile.example.com");

    // drop the workspace file too => user settings win
    rmSync(`${ws}/proj.code-workspace`);
    hit = resolveServerManagerProfiles(env, "linux").find((r) => r.name === sameName);
    expect(hit?.host).toBe("user.example.com");
  });

  it("IRIS_SM_SETTINGS_PATHS can name a .code-workspace file directly", () => {
    const ws = tmpDirPosix();
    const file = `${ws}/explicit.code-workspace`;
    writeFileSync(
      file,
      JSON.stringify({
        settings: {
          "intersystems.servers": { viaExplicitPath: entry("explicit.example.com") },
        },
      }),
      "utf8",
    );

    const result = resolveServerManagerProfiles(
      { ...BASE_ENV, IRIS_SERVER_MANAGER: "auto", IRIS_SM_SETTINGS_PATHS: file },
      "linux",
    );
    expect(result.find((r) => r.name === "viaExplicitPath")?.host).toBe(
      "explicit.example.com",
    );
  });
});
