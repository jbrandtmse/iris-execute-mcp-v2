import { describe, it, expect } from "vitest";
import { loadConfig } from "../config.js";

describe("loadConfig", () => {
  it("should load all values from env vars", () => {
    const env = {
      IRIS_HOST: "myhost",
      IRIS_PORT: "1972",
      IRIS_USERNAME: "admin",
      IRIS_PASSWORD: "secret",
      IRIS_NAMESPACE: "USER",
      IRIS_HTTPS: "true",
    };
    const config = loadConfig(env);

    expect(config.host).toBe("myhost");
    expect(config.port).toBe(1972);
    expect(config.username).toBe("admin");
    expect(config.password).toBe("secret");
    expect(config.namespace).toBe("USER");
    expect(config.https).toBe(true);
    expect(config.baseUrl).toBe("https://myhost:1972");
  });

  it("should apply defaults for optional fields", () => {
    const env = {
      IRIS_USERNAME: "admin",
      IRIS_PASSWORD: "secret",
    };
    const config = loadConfig(env);

    expect(config.host).toBe("localhost");
    expect(config.port).toBe(52773);
    expect(config.namespace).toBe("HSCUSTOM");
    expect(config.https).toBe(false);
    expect(config.baseUrl).toBe("http://localhost:52773");
  });

  it("should throw when IRIS_USERNAME is missing", () => {
    const env = { IRIS_PASSWORD: "secret" };
    expect(() => loadConfig(env)).toThrow("IRIS_USERNAME");
  });

  it("should throw when IRIS_PASSWORD is missing", () => {
    const env = { IRIS_USERNAME: "admin" };
    expect(() => loadConfig(env)).toThrow("IRIS_PASSWORD");
  });

  it("should use http protocol when IRIS_HTTPS is not true", () => {
    const env = {
      IRIS_USERNAME: "admin",
      IRIS_PASSWORD: "secret",
      IRIS_HTTPS: "false",
    };
    const config = loadConfig(env);
    expect(config.baseUrl).toBe("http://localhost:52773");
    expect(config.https).toBe(false);
  });

  it("should throw when IRIS_PORT is not a valid number", () => {
    const env = {
      IRIS_USERNAME: "admin",
      IRIS_PASSWORD: "secret",
      IRIS_PORT: "abc",
    };
    expect(() => loadConfig(env)).toThrow("IRIS_PORT");
  });

  it("should throw when IRIS_PORT is out of range", () => {
    const env = {
      IRIS_USERNAME: "admin",
      IRIS_PASSWORD: "secret",
      IRIS_PORT: "99999",
    };
    expect(() => loadConfig(env)).toThrow("IRIS_PORT");
  });

  it("should use https protocol when IRIS_HTTPS is true", () => {
    const env = {
      IRIS_USERNAME: "admin",
      IRIS_PASSWORD: "secret",
      IRIS_HTTPS: "true",
    };
    const config = loadConfig(env);
    expect(config.baseUrl).toBe("https://localhost:52773");
    expect(config.https).toBe(true);
  });

  // ── IRIS_TIMEOUT ──────────────────────────────────────────────────

  it("should default timeout to 60000 when IRIS_TIMEOUT is not set", () => {
    const env = {
      IRIS_USERNAME: "admin",
      IRIS_PASSWORD: "secret",
    };
    const config = loadConfig(env);
    expect(config.timeout).toBe(60_000);
  });

  it("should parse IRIS_TIMEOUT from env var", () => {
    const env = {
      IRIS_USERNAME: "admin",
      IRIS_PASSWORD: "secret",
      IRIS_TIMEOUT: "120000",
    };
    const config = loadConfig(env);
    expect(config.timeout).toBe(120_000);
  });

  it("should throw when IRIS_TIMEOUT is not a valid number", () => {
    const env = {
      IRIS_USERNAME: "admin",
      IRIS_PASSWORD: "secret",
      IRIS_TIMEOUT: "abc",
    };
    expect(() => loadConfig(env)).toThrow("IRIS_TIMEOUT");
  });

  it("should throw when IRIS_TIMEOUT is zero", () => {
    const env = {
      IRIS_USERNAME: "admin",
      IRIS_PASSWORD: "secret",
      IRIS_TIMEOUT: "0",
    };
    expect(() => loadConfig(env)).toThrow("IRIS_TIMEOUT");
  });

  it("should throw when IRIS_TIMEOUT is negative", () => {
    const env = {
      IRIS_USERNAME: "admin",
      IRIS_PASSWORD: "secret",
      IRIS_TIMEOUT: "-5000",
    };
    expect(() => loadConfig(env)).toThrow("IRIS_TIMEOUT");
  });

  // ── IRIS_SQL_MAX_ROWS / IRIS_SQL_TIMEOUT (Story 24.2, AC 24.2.1) ────

  it("should leave sqlMaxRows/sqlTimeoutMs undefined (and absent) when unset — Rule #19 byte-for-byte no-op", () => {
    const env = {
      IRIS_USERNAME: "admin",
      IRIS_PASSWORD: "secret",
    };
    const config = loadConfig(env);
    expect(config.sqlMaxRows).toBeUndefined();
    expect(config.sqlTimeoutMs).toBeUndefined();
    expect(config).not.toHaveProperty("sqlMaxRows");
    expect(config).not.toHaveProperty("sqlTimeoutMs");
    expect(config).toEqual({
      host: "localhost",
      port: 52773,
      username: "admin",
      password: "secret",
      namespace: "HSCUSTOM",
      https: false,
      baseUrl: "http://localhost:52773",
      timeout: 60_000,
    });
  });

  it("should parse IRIS_SQL_MAX_ROWS from env var", () => {
    const env = {
      IRIS_USERNAME: "admin",
      IRIS_PASSWORD: "secret",
      IRIS_SQL_MAX_ROWS: "500",
    };
    const config = loadConfig(env);
    expect(config.sqlMaxRows).toBe(500);
  });

  it("should throw when IRIS_SQL_MAX_ROWS is not a valid number", () => {
    const env = {
      IRIS_USERNAME: "admin",
      IRIS_PASSWORD: "secret",
      IRIS_SQL_MAX_ROWS: "abc",
    };
    expect(() => loadConfig(env)).toThrow("IRIS_SQL_MAX_ROWS");
  });

  it("should throw when IRIS_SQL_MAX_ROWS is zero or negative", () => {
    const envZero = {
      IRIS_USERNAME: "admin",
      IRIS_PASSWORD: "secret",
      IRIS_SQL_MAX_ROWS: "0",
    };
    expect(() => loadConfig(envZero)).toThrow("IRIS_SQL_MAX_ROWS");

    const envNeg = {
      IRIS_USERNAME: "admin",
      IRIS_PASSWORD: "secret",
      IRIS_SQL_MAX_ROWS: "-10",
    };
    expect(() => loadConfig(envNeg)).toThrow("IRIS_SQL_MAX_ROWS");
  });

  it("should throw when IRIS_SQL_MAX_ROWS is not an integer", () => {
    const env = {
      IRIS_USERNAME: "admin",
      IRIS_PASSWORD: "secret",
      IRIS_SQL_MAX_ROWS: "10.5",
    };
    expect(() => loadConfig(env)).toThrow("IRIS_SQL_MAX_ROWS");
  });

  it("should parse IRIS_SQL_TIMEOUT (seconds) and convert to milliseconds", () => {
    const env = {
      IRIS_USERNAME: "admin",
      IRIS_PASSWORD: "secret",
      IRIS_SQL_TIMEOUT: "30",
    };
    const config = loadConfig(env);
    expect(config.sqlTimeoutMs).toBe(30_000);
  });

  it("should throw when IRIS_SQL_TIMEOUT is not a valid number", () => {
    const env = {
      IRIS_USERNAME: "admin",
      IRIS_PASSWORD: "secret",
      IRIS_SQL_TIMEOUT: "abc",
    };
    expect(() => loadConfig(env)).toThrow("IRIS_SQL_TIMEOUT");
  });

  it("should throw when IRIS_SQL_TIMEOUT is zero or negative", () => {
    const envZero = {
      IRIS_USERNAME: "admin",
      IRIS_PASSWORD: "secret",
      IRIS_SQL_TIMEOUT: "0",
    };
    expect(() => loadConfig(envZero)).toThrow("IRIS_SQL_TIMEOUT");

    const envNeg = {
      IRIS_USERNAME: "admin",
      IRIS_PASSWORD: "secret",
      IRIS_SQL_TIMEOUT: "-5",
    };
    expect(() => loadConfig(envNeg)).toThrow("IRIS_SQL_TIMEOUT");
  });

  it("should throw when IRIS_SQL_TIMEOUT is Infinity (a non-finite value must be rejected, not forwarded)", () => {
    // Number("Infinity") === Infinity, which is > 0 and not NaN; a Number.isNaN
    // guard would let it through and forward { timeout: Infinity }, which Node's
    // setTimeout clamps to ~1ms — silently disabling SQL. Number.isFinite rejects it.
    const env = {
      IRIS_USERNAME: "admin",
      IRIS_PASSWORD: "secret",
      IRIS_SQL_TIMEOUT: "Infinity",
    };
    expect(() => loadConfig(env)).toThrow("IRIS_SQL_TIMEOUT");
  });
});
