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
});
