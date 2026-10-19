import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { MockInstance } from "vitest";
import { resolveTransport } from "../transport.js";

/**
 * Story 38.1 (AD-23): `stdio` is the only supported transport. Every
 * configured value other than `stdio` is a configuration error thrown by
 * `resolveTransport()`; startup with nothing configured, or with `stdio`, is
 * unchanged. The message texts are the exact contract of the I/O matrix.
 */

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

/** Asserts `resolveTransport()` throws an `Error` whose message is EXACTLY `expected`. */
function expectRejected(expected: string): void {
  expect(() => resolveTransport()).toThrow(expected);
  let caught: unknown;
  try {
    resolveTransport();
  } catch (err) {
    caught = err;
  }
  expect(caught).toBeInstanceOf(Error);
  expect((caught as Error).message).toBe(expected);
}

describe("resolveTransport", () => {
  const originalArgv = process.argv;
  const originalEnvTransport = process.env["MCP_TRANSPORT"];
  let errorSpy: MockInstance;
  let warnSpy: MockInstance;
  let logSpy: MockInstance;
  let infoSpy: MockInstance;
  let debugSpy: MockInstance;
  let stdoutSpy: MockInstance;
  let stderrSpy: MockInstance;

  beforeEach(() => {
    // Every console method is spied on directly: under vitest the console does
    // not write through process.stdout.write or process.stderr.write.
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});
    debugSpy = vi.spyOn(console, "debug").mockImplementation(() => {});
    stdoutSpy = vi
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true);
    stderrSpy = vi
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);
    delete process.env["MCP_TRANSPORT"];
    process.argv = ["node", "script"];
  });

  afterEach(() => {
    const writes = {
      error: errorSpy.mock.calls.length,
      warn: warnSpy.mock.calls.length,
      log: logSpy.mock.calls.length,
      info: infoSpy.mock.calls.length,
      debug: debugSpy.mock.calls.length,
      stdout: stdoutSpy.mock.calls.length,
      stderr: stderrSpy.mock.calls.length,
    };
    // Restore first, so a failing assertion below cannot leak argv, the
    // environment or live spies into the next test.
    process.argv = originalArgv;
    if (originalEnvTransport === undefined) {
      delete process.env["MCP_TRANSPORT"];
    } else {
      process.env["MCP_TRANSPORT"] = originalEnvTransport;
    }
    vi.restoreAllMocks();
    // Nothing is written on any path: stdout carries MCP, and the entry
    // point reports the thrown error.
    expect(writes).toEqual({
      error: 0,
      warn: 0,
      log: 0,
      info: 0,
      debug: 0,
      stdout: 0,
      stderr: 0,
    });
  });

  describe("not configured, or explicit stdio", () => {
    it("returns stdio when no flag is given and MCP_TRANSPORT is unset", () => {
      expect(resolveTransport()).toBe("stdio");
    });

    it('returns stdio when MCP_TRANSPORT is the empty string ("not configured")', () => {
      process.env["MCP_TRANSPORT"] = "";
      expect(resolveTransport()).toBe("stdio");
    });

    it("returns stdio from --transport stdio", () => {
      process.argv = ["node", "script", "--transport", "stdio"];
      expect(resolveTransport()).toBe("stdio");
    });

    it("returns stdio from --transport=stdio", () => {
      process.argv = ["node", "script", "--transport=stdio"];
      expect(resolveTransport()).toBe("stdio");
    });

    it("returns stdio from MCP_TRANSPORT=stdio", () => {
      process.env["MCP_TRANSPORT"] = "stdio";
      expect(resolveTransport()).toBe("stdio");
    });

    it("returns stdio from both channels set to stdio, and ignores unrelated arguments", () => {
      process.argv = ["node", "script", "--other", "x", "--transport=stdio"];
      process.env["MCP_TRANSPORT"] = "stdio";
      expect(resolveTransport()).toBe("stdio");
    });
  });

  describe("http", () => {
    it("throws the environment message for MCP_TRANSPORT=http", () => {
      process.env["MCP_TRANSPORT"] = "http";
      expectRejected(envMessage('"http"'));
    });

    it("throws the flag message for --transport http", () => {
      process.argv = ["node", "script", "--transport", "http"];
      expectRejected(flagMessage('"http"'));
    });

    it("throws the flag message for --transport=http", () => {
      process.argv = ["node", "script", "--transport=http"];
      expectRejected(flagMessage('"http"'));
    });
  });

  describe("unknown values (the match is exact and case-sensitive)", () => {
    it("throws the environment message for MCP_TRANSPORT=websocket", () => {
      process.env["MCP_TRANSPORT"] = "websocket";
      expectRejected(envMessage('"websocket"'));
    });

    it("throws the environment message for MCP_TRANSPORT=STDIO", () => {
      process.env["MCP_TRANSPORT"] = "STDIO";
      expectRejected(envMessage('"STDIO"'));
    });

    it("throws the flag message for --transport=websocket", () => {
      process.argv = ["node", "script", "--transport=websocket"];
      expectRejected(flagMessage('"websocket"'));
    });

    it("throws the flag message for --transport websocket", () => {
      process.argv = ["node", "script", "--transport", "websocket"];
      expectRejected(flagMessage('"websocket"'));
    });

    it("throws the flag message for --transport=STDIO", () => {
      process.argv = ["node", "script", "--transport=STDIO"];
      expectRejected(flagMessage('"STDIO"'));
    });

    it("renders the value as JSON, escaping quotes", () => {
      process.env["MCP_TRANSPORT"] = 'a"b';
      expectRejected(envMessage('"a\\"b"'));
    });
  });

  describe("a --transport flag without a value is present but malformed", () => {
    it('throws the flag message with "" for --transport as the last argument', () => {
      process.argv = ["node", "script", "--transport"];
      expectRejected(flagMessage('""'));
    });

    it('throws the flag message with "" for --transport=', () => {
      process.argv = ["node", "script", "--transport="];
      expectRejected(flagMessage('""'));
    });

    it('throws the flag message with "" for --transport as the last argument even when MCP_TRANSPORT=stdio', () => {
      process.argv = ["node", "script", "--transport"];
      process.env["MCP_TRANSPORT"] = "stdio";
      expectRejected(flagMessage('""'));
    });
  });

  describe("both channels: every configured value is checked", () => {
    it("throws the environment message for --transport stdio with MCP_TRANSPORT=http", () => {
      process.argv = ["node", "script", "--transport", "stdio"];
      process.env["MCP_TRANSPORT"] = "http";
      expectRejected(envMessage('"http"'));
    });

    it("throws the flag message for --transport=http with MCP_TRANSPORT=stdio (flags first)", () => {
      process.argv = ["node", "script", "--transport=http"];
      process.env["MCP_TRANSPORT"] = "stdio";
      expectRejected(flagMessage('"http"'));
    });

    it("throws the flag message when both channels are bad (flags first)", () => {
      process.argv = ["node", "script", "--transport=http"];
      process.env["MCP_TRANSPORT"] = "websocket";
      expectRejected(flagMessage('"http"'));
    });

    it("checks every --transport occurrence in argument order", () => {
      process.argv = [
        "node",
        "script",
        "--transport",
        "stdio",
        "--transport=http",
        "--transport=websocket",
      ];
      expectRejected(flagMessage('"http"'));
    });

    it("takes the value after --transport as consumed by that flag", () => {
      process.argv = ["node", "script", "--transport", "--transport=http"];
      expectRejected(flagMessage('"--transport=http"'));
    });
  });
});
