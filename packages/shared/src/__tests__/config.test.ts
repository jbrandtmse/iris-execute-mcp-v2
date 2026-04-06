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
});
