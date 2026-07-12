import { describe, it, expect, vi, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, rmdirSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { AuditLogger, parseAuditConfig, redactValue } from "../audit.js";
import type { AuditEntryInput } from "../audit.js";
import { logger as sharedLogger } from "../logger.js";

afterEach(() => {
  vi.restoreAllMocks();
});

// ── Helpers ─────────────────────────────────────────────────────────

function makeTmpDir(): string {
  return mkdtempSync(join(tmpdir(), "iris-audit-test-"));
}

/**
 * Await the AuditLogger's internal write queue draining. `writeQueue` is
 * private, but it always resolves (even after a swallowed write failure), so
 * reaching into it via a loose cast is a safe, deterministic way to wait for
 * every previously-enqueued write to settle without racy timers.
 */
async function drain(auditLogger: AuditLogger): Promise<void> {
  await (auditLogger as unknown as { writeQueue: Promise<void> }).writeQueue;
}

function readLines(filePath: string): Array<Record<string, unknown>> {
  return readFileSync(filePath, "utf-8")
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

function baseEntry(overrides: Partial<AuditEntryInput> = {}): AuditEntryInput {
  return {
    tool: "iris_doc_get",
    action: null,
    profile: "default",
    namespace: "HSCUSTOM",
    outcome: "ok",
    durationMs: 5,
    paramKeys: ["name"],
    ...overrides,
  };
}

// ── parseAuditConfig (AC 29.0.1) ────────────────────────────────────

describe("parseAuditConfig", () => {
  it("returns undefined when IRIS_AUDIT_LOG is unset", () => {
    expect(parseAuditConfig({})).toBeUndefined();
  });

  it("returns undefined when IRIS_AUDIT_LOG is an empty string", () => {
    expect(parseAuditConfig({ IRIS_AUDIT_LOG: "" })).toBeUndefined();
  });

  it("defaults IRIS_AUDIT_LOG_MAX_MB to 50 and IRIS_AUDIT_LOG_PARAMS to false", () => {
    const config = parseAuditConfig({ IRIS_AUDIT_LOG: "/tmp/audit.log" });
    expect(config).toEqual({
      path: "/tmp/audit.log",
      maxBytes: 50 * 1024 * 1024,
      includeParams: false,
    });
  });

  it("parses a custom IRIS_AUDIT_LOG_MAX_MB", () => {
    const config = parseAuditConfig({
      IRIS_AUDIT_LOG: "/tmp/audit.log",
      IRIS_AUDIT_LOG_MAX_MB: "10",
    });
    expect(config?.maxBytes).toBe(10 * 1024 * 1024);
  });

  it("parses IRIS_AUDIT_LOG_PARAMS=true", () => {
    const config = parseAuditConfig({
      IRIS_AUDIT_LOG: "/tmp/audit.log",
      IRIS_AUDIT_LOG_PARAMS: "true",
    });
    expect(config?.includeParams).toBe(true);
  });

  it("treats any non-'true' IRIS_AUDIT_LOG_PARAMS value as false", () => {
    const config = parseAuditConfig({
      IRIS_AUDIT_LOG: "/tmp/audit.log",
      IRIS_AUDIT_LOG_PARAMS: "yes",
    });
    expect(config?.includeParams).toBe(false);
  });

  it.each(["0", "-5", "abc", "NaN", ""])(
    "fails fast naming IRIS_AUDIT_LOG_MAX_MB for invalid value %j",
    (bad) => {
      expect(() =>
        parseAuditConfig({
          IRIS_AUDIT_LOG: "/tmp/audit.log",
          IRIS_AUDIT_LOG_MAX_MB: bad,
        }),
      ).toThrow(/IRIS_AUDIT_LOG_MAX_MB/);
    },
  );
});

// ── redactValue (AC 29.0.2) ──────────────────────────────────────────

describe("redactValue", () => {
  it("redacts a top-level matching key", () => {
    expect(redactValue({ password: "hunter2" })).toEqual({ password: "[REDACTED]" });
  });

  it("redacts a matching key nested inside an object", () => {
    // "meta" is a deliberately non-matching wrapper key, so this test isolates
    // the nested "token" match from the (also-matching, by design) "credentials"
    // family — see the fuzz test below for the "credentials"-collapses-whole-
    // subtree case.
    const result = redactValue({ nested: { meta: { token: "abc123" } } }) as {
      nested: { meta: { token: string } };
    };
    expect(result.nested.meta.token).toBe("[REDACTED]");
  });

  it("redacts a key whose name merely CONTAINS a redact-family substring (fail-closed)", () => {
    // "credentials" (plural) contains "credential" — the whole value collapses
    // to "[REDACTED]" rather than being recursed into. This is the safe,
    // fail-closed behavior: a key structurally named for secrets is treated as
    // wholly sensitive.
    const result = redactValue({
      credentials: { username: "bob", token: "abc123" },
    }) as { credentials: unknown };
    expect(result.credentials).toBe("[REDACTED]");
  });

  it("redacts matching keys inside an array of objects", () => {
    const result = redactValue({
      items: [{ secret: "abc123" }, { ok: "fine" }],
    }) as { items: Array<Record<string, string>> };
    expect(result.items[0]?.secret).toBe("[REDACTED]");
    expect(result.items[1]?.ok).toBe("fine");
  });

  it("redacts regardless of key case", () => {
    const result = redactValue({
      Password: "a",
      SECRET: "b",
      ApiKey: "c",
      Authorization: "d",
      Passwd: "e",
      Credential: "f",
      api_key: "g",
    }) as Record<string, unknown>;
    for (const key of Object.keys(result)) {
      expect(result[key]).toBe("[REDACTED]");
    }
  });

  it("does not mutate the caller's original object", () => {
    const original = { password: "hunter2", nested: { token: "abc" } };
    const result = redactValue(original) as {
      password: string;
      nested: { token: string };
    };
    expect(original.password).toBe("hunter2");
    expect(original.nested.token).toBe("abc");
    expect(result).not.toBe(original);
    expect(result.nested).not.toBe(original.nested);
  });

  it("truncates a long non-sensitive string value to 256 chars + suffix", () => {
    const longValue = "x".repeat(3000);
    const result = redactValue({ note: longValue }) as { note: string };
    expect(result.note).toBe(`${"x".repeat(256)}[TRUNCATED]`);
  });

  it("leaves a short string value untouched", () => {
    expect(redactValue({ note: "short" })).toEqual({ note: "short" });
  });

  it("passes through non-object, non-string primitives unchanged", () => {
    expect(redactValue(42)).toBe(42);
    expect(redactValue(true)).toBe(true);
    expect(redactValue(null)).toBe(null);
  });
});

// ── AuditLogger (AC 29.0.2 / 29.0.3) ────────────────────────────────

describe("AuditLogger", () => {
  it("writes a sessionStart header line on construction", async () => {
    const dir = makeTmpDir();
    const filePath = join(dir, "audit.log");
    const auditLogger = new AuditLogger(
      { path: filePath, maxBytes: 1_000_000, includeParams: false },
      "test-pkg",
      "1.2.3",
    );
    await drain(auditLogger);

    const lines = readLines(filePath);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      type: "sessionStart",
      session: auditLogger.session,
      serverPkg: "test-pkg",
      version: "1.2.3",
    });
    expect(typeof lines[0]?.ts).toBe("string");
  });

  it("writes a well-formed entry with all base fields", async () => {
    const dir = makeTmpDir();
    const filePath = join(dir, "audit.log");
    const auditLogger = new AuditLogger(
      { path: filePath, maxBytes: 1_000_000, includeParams: false },
      "test-pkg",
      "1.0.0",
    );
    auditLogger.log(baseEntry());
    await drain(auditLogger);

    const lines = readLines(filePath);
    expect(lines).toHaveLength(2); // header + entry
    const entry = lines[1] as Record<string, unknown>;
    expect(entry.session).toBe(auditLogger.session);
    expect(entry.seq).toBe(1);
    expect(entry.serverPkg).toBe("test-pkg");
    expect(entry.tool).toBe("iris_doc_get");
    expect(entry.action).toBeNull();
    expect(entry.profile).toBe("default");
    expect(entry.namespace).toBe("HSCUSTOM");
    expect(entry.outcome).toBe("ok");
    expect(entry.durationMs).toBe(5);
    expect(entry.paramKeys).toEqual(["name"]);
    expect(entry.params).toBeUndefined();
    expect(entry.error).toBeUndefined();
    expect(typeof entry.ts).toBe("string");
    expect(new Date(entry.ts as string).toISOString()).toBe(entry.ts);
  });

  it("increments seq monotonically per entry", async () => {
    const dir = makeTmpDir();
    const filePath = join(dir, "audit.log");
    const auditLogger = new AuditLogger(
      { path: filePath, maxBytes: 1_000_000, includeParams: false },
      "p",
      "1",
    );
    auditLogger.log(baseEntry());
    auditLogger.log(baseEntry());
    auditLogger.log(baseEntry());
    await drain(auditLogger);

    const lines = readLines(filePath);
    expect(lines.slice(1).map((l) => l.seq)).toEqual([1, 2, 3]);
  });

  it("omits params when includeParams is false, even if provided", async () => {
    const dir = makeTmpDir();
    const filePath = join(dir, "audit.log");
    const auditLogger = new AuditLogger(
      { path: filePath, maxBytes: 1_000_000, includeParams: false },
      "p",
      "1",
    );
    auditLogger.log(baseEntry({ params: { name: "Foo.cls" } }));
    await drain(auditLogger);

    const lines = readLines(filePath);
    expect(lines[1]?.params).toBeUndefined();
  });

  it("includes redacted params when includeParams is true", async () => {
    const dir = makeTmpDir();
    const filePath = join(dir, "audit.log");
    const auditLogger = new AuditLogger(
      { path: filePath, maxBytes: 1_000_000, includeParams: true },
      "p",
      "1",
    );
    auditLogger.log(
      baseEntry({ params: { name: "Foo.cls", password: "hunter2" } }),
    );
    await drain(auditLogger);

    const lines = readLines(filePath);
    const params = lines[1]?.params as Record<string, unknown>;
    expect(params.name).toBe("Foo.cls");
    expect(params.password).toBe("[REDACTED]");
  });

  it("includes the error field only when outcome is error", async () => {
    const dir = makeTmpDir();
    const filePath = join(dir, "audit.log");
    const auditLogger = new AuditLogger(
      { path: filePath, maxBytes: 1_000_000, includeParams: false },
      "p",
      "1",
    );
    auditLogger.log(baseEntry({ outcome: "error", error: "boom" }));
    auditLogger.log(baseEntry({ outcome: "ok", error: "should not appear" }));
    await drain(auditLogger);

    const lines = readLines(filePath);
    expect(lines[1]?.error).toBe("boom");
    expect(lines[2]?.error).toBeUndefined();
  });

  // AC 29.0.2 (non-negotiable): a password nested at three different depths
  // must produce ZERO occurrences of its value in the written log line.
  it("produces zero occurrences of a password value nested in three positions", async () => {
    const dir = makeTmpDir();
    const filePath = join(dir, "audit.log");
    const auditLogger = new AuditLogger(
      { path: filePath, maxBytes: 1_000_000, includeParams: true },
      "p",
      "1",
    );

    const secretValue = "SuperSecretPW-9f8e7d6c";
    const params = {
      password: secretValue, // position 1: top-level key match
      nested: {
        credentials: {
          Token: secretValue, // position 2: two levels deep, case-variant key
        },
      },
      items: [
        { ok: "fine" },
        { apiKey: secretValue }, // position 3: inside an array of objects
      ],
    };

    auditLogger.log(baseEntry({ params }));
    await drain(auditLogger);

    const rawLines = readFileSync(filePath, "utf-8")
      .split("\n")
      .filter((line) => line.trim().length > 0);
    const entryLine = rawLines[1];
    expect(entryLine).toBeDefined();
    expect(entryLine as string).not.toContain(secretValue);
  });

  it("rotates the file at the configured size threshold", async () => {
    const dir = makeTmpDir();
    const filePath = join(dir, "audit.log");
    // Absurdly small threshold: the header write can't rotate (nothing to
    // rename yet), but the first real entry forces rotation.
    const auditLogger = new AuditLogger(
      { path: filePath, maxBytes: 1, includeParams: false },
      "p",
      "1",
    );
    await drain(auditLogger);
    expect(existsSync(filePath)).toBe(true);
    expect(existsSync(`${filePath}.1`)).toBe(false);

    auditLogger.log(baseEntry());
    await drain(auditLogger);

    expect(existsSync(`${filePath}.1`)).toBe(true);
    const rotated = readLines(`${filePath}.1`);
    expect(rotated).toHaveLength(1);
    expect(rotated[0]?.type).toBe("sessionStart");

    const current = readLines(filePath);
    expect(current).toHaveLength(1);
    expect(current[0]?.tool).toBe("iris_doc_get");
  });

  it("degrades without throwing when the sink becomes unwritable post-startup, then records droppedEntries at shutdown", async () => {
    const dir = makeTmpDir();
    const filePath = join(dir, "audit.log");
    const auditLogger = new AuditLogger(
      { path: filePath, maxBytes: 1_000_000, includeParams: false },
      "p",
      "1",
    );
    await drain(auditLogger); // header lands successfully

    // Simulate the sink becoming unwritable mid-session: replace the file
    // with a directory of the same name (fs.appendFile then fails EISDIR).
    rmSync(filePath, { force: true });
    mkdirSync(filePath);

    const warnSpy = vi.spyOn(sharedLogger, "warn").mockImplementation(() => {});

    expect(() => auditLogger.log(baseEntry())).not.toThrow();
    await drain(auditLogger);

    expect(auditLogger.droppedEntryCount).toBe(1);
    expect(warnSpy).toHaveBeenCalledTimes(1);

    // Restore the sink and flush: the final line records droppedEntries.
    rmdirSync(filePath);
    await expect(auditLogger.shutdown()).resolves.toBeUndefined();

    const lines = readLines(filePath);
    const shutdownLine = lines.find((l) => l.type === "shutdown");
    expect(shutdownLine).toBeDefined();
    expect(shutdownLine?.droppedEntries).toBe(1);
  });
});
