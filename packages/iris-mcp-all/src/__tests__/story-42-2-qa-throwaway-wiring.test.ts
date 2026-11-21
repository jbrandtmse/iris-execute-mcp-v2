/**
 * Story 42.2, AC 42.2.5 QA - the wiring between the pieces of the throwaway bootstrap-guard gate, which no run in this story
 * exercises end to end (no stage runs docker; Story 42.3's CI runs `pnpm live:bootstrap-guard`).
 *
 * `throwaway-iris.test.ts` pins each piece alone: the harness's helpers and orchestration, and the gate's arming decision.
 * Left unpinned, and only visible when CI first runs the gate: that the root script names a command that exists, and that the
 * environment the harness hands the command is the one the gate arms on and accepts as a target. A script pointing at a
 * renamed file, or a harness variable the gate never reads, would leave every test here green and the CI job dead (Rule #59).
 *
 * Reads files and calls the pure helpers; runs no docker and contacts no IRIS.
 */

import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  IRIS_COMMUNITY_IMAGE,
  LOOPBACK_HOST,
  THROWAWAY_NAMESPACE,
  assertThrowawayInspect,
  buildChildEnv,
  buildRunArgv,
  generateContainerName,
  parseCli,
  validateContainerName,
  validateHostPort,
} from "../../../../scripts/throwaway-iris.mjs";
import { throwawayGatePlan } from "./bootstrap-guard-legs.js";
import { resolveLiveTarget } from "../../../shared/src/test-helpers/live-target.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// packages/iris-mcp-all/src/__tests__/ -> repo root is 4 levels up.
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..", "..");
const ALL_PACKAGE_DIR = path.join(REPO_ROOT, "packages", "iris-mcp-all");

interface PackageJson {
  name?: string;
  scripts?: Record<string, string>;
}

const readJson = (file: string): PackageJson => JSON.parse(readFileSync(file, "utf8")) as PackageJson;

describe("the root script `live:bootstrap-guard`", () => {
  const script = readJson(path.join(REPO_ROOT, "package.json")).scripts?.["live:bootstrap-guard"] ?? "";
  const tokens = script.split(/\s+/).filter((token) => token !== "");

  it("exists, and runs the harness script, which exists", () => {
    expect(script, "the root package.json defines live:bootstrap-guard").not.toBe("");
    expect(tokens.slice(0, 3)).toEqual(["node", "scripts/throwaway-iris.mjs", "run"]);
    expect(existsSync(path.join(REPO_ROOT, tokens[1] as string)), `${tokens[1]} exists`).toBe(true);
  });

  it("hands the harness a command line it parses, with the pinned default image", () => {
    const parsed = parseCli(tokens.slice(2));

    expect(parsed.image).toBe(IRIS_COMMUNITY_IMAGE);
    expect(parsed.command[0]).toBe("pnpm");
  });

  it("filters to the @iris-mcp/all package, whose name matches the package that holds the gate", () => {
    const { command } = parseCli(tokens.slice(2));
    const filter = command[command.indexOf("--filter") + 1];

    expect(command.includes("--filter"), "the command filters to one package").toBe(true);
    expect(filter).toBe(readJson(path.join(ALL_PACKAGE_DIR, "package.json")).name);
  });

  it("runs vitest on the one file that is the throwaway gate: it exists, is a default-suite test, and reads IRIS_THROWAWAY", () => {
    const { command } = parseCli(tokens.slice(2));
    const gateFile = command[command.length - 1] as string;

    expect(command.slice(command.indexOf("exec"), command.indexOf("exec") + 3), "pnpm exec vitest run <file>").toEqual(["exec", "vitest", "run"]);
    expect(gateFile.endsWith(".test.ts"), `${gateFile} is a test file`).toBe(true);
    expect(gateFile.endsWith(".integration.test.ts"), "and not an integration file, which the package's default config excludes").toBe(false);
    const absolute = path.join(ALL_PACKAGE_DIR, gateFile);
    expect(existsSync(absolute), `${gateFile} exists under packages/iris-mcp-all`).toBe(true);
    expect(readFileSync(absolute, "utf8"), "the file is the gate the harness arms").toContain("throwawayGatePlan(process.env)");
  });
});

describe("the environment the harness hands the command is the one the gate arms on and accepts", () => {
  const name = generateContainerName();
  const env = buildChildEnv({ PATH: "/usr/bin" }, { port: "49153", name });

  it("arms the throwaway gate on the container the harness named", () => {
    expect(throwawayGatePlan(env)).toEqual({ run: true, container: name });
    expect(validateContainerName(name), "and the gate accepts that name").toBe(name);
  });

  it("is a live target the arming helper resolves, on the loopback address, at the port the harness published, in USER", () => {
    const resolution = resolveLiveTarget(env);

    expect(resolution.armed).toBe(true);
    if (!resolution.armed) return;
    expect(resolution.target.host).toBe(LOOPBACK_HOST);
    expect(resolution.target.port).toBe("49153");
    expect(validateHostPort(resolution.target.port), "and the gate accepts that port").toBe("49153");
    expect(resolution.target.namespace).toBe(THROWAWAY_NAMESPACE);
    expect(resolution.target.username).not.toBe("");
    expect(resolution.target.password).not.toBe("");
  });

  it("does not arm the gate once the container name is dropped, and does not arm any other live leg without the arming variable", () => {
    const { IRIS_THROWAWAY: _dropped, ...withoutName } = env;
    expect(throwawayGatePlan(withoutName)).toMatchObject({ run: false });

    const { IRIS_REQUIRE_LIVE: _unarmed, ...withoutArming } = env;
    expect(resolveLiveTarget(withoutArming).armed).toBe(false);
    expect(() => throwawayGatePlan(withoutArming)).toThrow(/misconfiguration/);
  });

  it("the gate's docker-inspect check accepts a container built from the label and the published port the `docker run` arguments carry", () => {
    // What `docker inspect` reports for a container started with these arguments, derived from the arguments themselves.
    const argv = buildRunArgv({ image: IRIS_COMMUNITY_IMAGE, name });
    const [labelKey, labelValue] = (argv[argv.indexOf("--label") + 1] as string).split("=");
    const [publishedHost, , containerPort] = (argv[argv.indexOf("-p") + 1] as string).split(":");
    const inspected = [
      {
        Name: `/${argv[argv.indexOf("--name") + 1]}`,
        State: { Running: true },
        Config: { Labels: { [labelKey as string]: labelValue } },
        NetworkSettings: { Ports: { [`${containerPort}/tcp`]: [{ HostIp: publishedHost, HostPort: "49153" }] } },
      },
    ];

    expect(() => assertThrowawayInspect(inspected, { name, port: "49153" })).not.toThrow();
  });
});
