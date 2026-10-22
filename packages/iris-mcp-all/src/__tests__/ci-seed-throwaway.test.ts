/**
 * Story 42.3 (AC 42.3.2) -- `scripts/ci-seed-throwaway.mjs`, which prepares a throwaway IRIS for Health container for CI's armed suites:
 * the real `bootstrap()`, a check that `Ens.Director` is visible, and the test and fixture classes.
 *
 *  - THE LIST. `seedDocuments` holds exactly the 62 files of `src/ExecuteMCPv2/Tests/**` and `QAFixtures/*`, and none of the
 *    35 bootstrapped classes (a bootstrapped class loaded from `src/` carries the `dev` marker, AD-14). The disjointness
 *    guard is also run over a synthetic repository that violates it.
 *  - THE REFUSALS. An environment that is not a throwaway target is refused before the shared dist is loaded or a request is made.
 *  - ONE HERMETIC SEED. The seed runs against `stateful-fake-atelier.ts`, a stateful stand-in for Atelier on 127.0.0.1 that models
 *    the document PUT, the compile, the bootstrap queries and the `%Dictionary.CompiledClass` query, with the REAL built
 *    `@iris-mcp/shared`: the fake holds what the seed wrote, which is what the seed is observed by. The script is also run as a
 *    process against it.
 *
 * No docker is run, and no IRIS is reached: the only server is the fake on an ephemeral loopback port.
 */

import { describe, expect, it } from "vitest";
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  INTEROP_QUERY,
  bootstrapProblems,
  bootstrapRoster,
  compileProblems,
  seedDocuments,
  seedThrowaway,
} from "../../../../scripts/ci-seed-throwaway.mjs";
import { REPO_ROOT } from "../../../../scripts/lib/live-gate-scan.mjs";
import { BOOTSTRAP_CLASSES, BOOTSTRAP_VERSION } from "../../../shared/src/bootstrap-classes.js";
import { startStatefulFakeAtelier, summarizeRequests } from "./stateful-fake-atelier";

const FAKE_THROWAWAY = "iris-mcp-throwaway-0123456789ab";
const SCRIPT = path.join(REPO_ROOT, "scripts", "ci-seed-throwaway.mjs");

/** Every file under `directory`, relative to `base`, with forward slashes. */
function filesUnder(directory: string, base: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(directory, entry.name);
    return entry.isDirectory() ? filesUnder(full, base) : [path.relative(base, full).split(path.sep).join("/")];
  });
}

const throwawayEnv = (port: number | string, namespace = "HSCUSTOM"): Record<string, string> => ({
  IRIS_REQUIRE_LIVE: "1",
  IRIS_THROWAWAY: FAKE_THROWAWAY,
  IRIS_HOST: "127.0.0.1",
  IRIS_PORT: String(port),
  IRIS_USERNAME: "_SYSTEM",
  IRIS_PASSWORD: "SYS",
  IRIS_NAMESPACE: namespace,
  IRIS_HTTPS: "false",
});

describe("seedDocuments: the classes the seed deploys", () => {
  const documents = seedDocuments(REPO_ROOT);

  it("holds exactly the 62 files of src/ExecuteMCPv2/Tests and QAFixtures, as documents of the same name", () => {
    const onDisk = [
      ...filesUnder(path.join(REPO_ROOT, "src", "ExecuteMCPv2", "Tests"), path.join(REPO_ROOT, "src")),
      ...filesUnder(path.join(REPO_ROOT, "src", "ExecuteMCPv2", "QAFixtures"), path.join(REPO_ROOT, "src")),
    ].sort();

    expect(onDisk.length).toBe(62);
    expect(documents.length).toBe(62);
    expect(documents.map((document: { path: string }) => document.path)).toEqual(onDisk.map((file) => `src/${file}`));
    expect(documents.every((document: { name: string }) => /^ExecuteMCPv2\.(Tests|QAFixtures)\.[A-Za-z0-9]+\.cls$/.test(document.name))).toBe(true);
    expect(documents.map((document: { name: string }) => document.name)).toContain("ExecuteMCPv2.QAFixtures.LongRunningTest.cls");
    expect(documents.map((document: { name: string }) => document.name)).toContain("ExecuteMCPv2.Tests.UtilsTest.cls");
    expect(new Set(documents.map((document: { name: string }) => document.name)).size).toBe(62);
  });

  it("holds none of the bootstrapped classes, by the embed and by the roster of gen-bootstrap.mjs", () => {
    const names = new Set<string>(documents.map((document: { name: string }) => document.name));
    const roster = bootstrapRoster(REPO_ROOT);

    expect(BOOTSTRAP_CLASSES.size).toBe(35);
    expect(roster.names.length).toBe(35);
    expect([...roster.names].sort()).toEqual([...BOOTSTRAP_CLASSES.keys()].sort());
    for (const name of BOOTSTRAP_CLASSES.keys()) expect(names.has(name), name).toBe(false);
    for (const file of roster.paths) expect(documents.some((document: { path: string }) => document.path === file), file).toBe(false);
    expect(names.has("ExecuteMCPv2.Setup.cls")).toBe(false);
  });

  it("gives each document the text of its file with LF line ends and no trailing space", () => {
    const first = documents[0] as { path: string; content: string };

    expect(first.content).toBe(readFileSync(path.join(REPO_ROOT, first.path), "utf8").replace(/\r\n?/g, "\n").replace(/\s+$/, ""));
    expect(documents.every((document: { content: string }) => !document.content.includes("\r") && document.content.trim().length > 0)).toBe(true);
  });

  describe("over a synthetic repository", () => {
    function syntheticRepo(files: Record<string, string>, rosterEntries: string): string {
      const root = mkdtempSync(path.join(tmpdir(), "ci-seed-repo-"));
      for (const [relative, content] of Object.entries({ ...files, "scripts/gen-bootstrap.mjs": `const classes = [\n${rosterEntries}\n];\n` })) {
        mkdirSync(path.dirname(path.join(root, relative)), { recursive: true });
        writeFileSync(path.join(root, relative), content, "utf8");
      }
      return root;
    }
    const roster = "  { name: 'ExecuteMCPv2.Utils.cls', path: 'src/ExecuteMCPv2/Utils.cls' },\n  { name: 'ExecuteMCPv2.Setup.cls', path: 'src/ExecuteMCPv2/Setup.cls' },";

    it("maps nested directories to dotted document names, sorts by path, and normalizes the text", () => {
      const root = syntheticRepo(
        { "src/ExecuteMCPv2/Tests/ATest.cls": "Class A {\r\n}\r\n\r\n", "src/ExecuteMCPv2/Tests/Sub/BTest.cls": "Class B {}\n", "src/ExecuteMCPv2/QAFixtures/C.cls": "Class C {}" },
        roster,
      );
      try {
        expect(seedDocuments(root)).toEqual([
          { name: "ExecuteMCPv2.QAFixtures.C.cls", path: "src/ExecuteMCPv2/QAFixtures/C.cls", content: "Class C {}" },
          { name: "ExecuteMCPv2.Tests.ATest.cls", path: "src/ExecuteMCPv2/Tests/ATest.cls", content: "Class A {\n}" },
          { name: "ExecuteMCPv2.Tests.Sub.BTest.cls", path: "src/ExecuteMCPv2/Tests/Sub/BTest.cls", content: "Class B {}" },
        ]);
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    });

    it("refuses a document that the bootstrap roster also lists, by name or by path", () => {
      const byName = syntheticRepo({ "src/ExecuteMCPv2/Tests/ATest.cls": "Class A {}" }, "  { name: 'ExecuteMCPv2.Tests.ATest.cls', path: 'src/elsewhere/ATest.cls' },");
      const byPath = syntheticRepo({ "src/ExecuteMCPv2/Tests/ATest.cls": "Class A {}" }, "  { name: 'ExecuteMCPv2.Other.cls', path: 'src/ExecuteMCPv2/Tests/ATest.cls' },");
      try {
        expect(() => seedDocuments(byName)).toThrow(/shares ExecuteMCPv2\.Tests\.ATest\.cls with the bootstrap roster/);
        expect(() => seedDocuments(byPath)).toThrow(/shares ExecuteMCPv2\.Tests\.ATest\.cls with the bootstrap roster/);
      } finally {
        rmSync(byName, { recursive: true, force: true });
        rmSync(byPath, { recursive: true, force: true });
      }
    });

    it("refuses a directory with no class, and a file that is not a class", () => {
      const empty = syntheticRepo({}, roster);
      const notClass = syntheticRepo({ "src/ExecuteMCPv2/Tests/Helper.inc": "#define X 1" }, roster);
      try {
        expect(() => seedDocuments(empty)).toThrow(/found no class/);
        expect(() => seedDocuments(notClass)).toThrow(/deploys classes only/);
      } finally {
        rmSync(empty, { recursive: true, force: true });
        rmSync(notClass, { recursive: true, force: true });
      }
    });
  });
});

describe("what makes a bootstrap or a compile a problem", () => {
  it("accepts a bootstrap that found the service current or installed it completely", () => {
    expect(bootstrapProblems({ probeStatus: "current", errors: [] })).toEqual([]);
    expect(bootstrapProblems({ probeStatus: "missing", deployed: true, compiled: true, configured: true, mapped: true, errors: [] })).toEqual([]);
  });

  it.each([
    ["an error", { probeStatus: "missing", deployed: true, compiled: true, configured: true, mapped: true, errors: ["Compile failed: x"] }, /bootstrap reported: Compile failed: x/],
    ["a newer deployment left alone", { probeStatus: "newer", deployed: false, compiled: false, configured: false, mapped: false, errors: [] }, /did not finish \(probe newer/],
    ["a foreign deployment left alone", { probeStatus: "foreign", errors: [] }, /did not finish \(probe foreign/],
    ["an unknown deployment", { probeStatus: "unknown", errors: [] }, /did not finish \(probe unknown/],
    ["no web application", { probeStatus: "missing", deployed: true, compiled: true, configured: false, mapped: true, errors: [] }, /configured false/],
    ["no package mapping", { probeStatus: "missing", deployed: true, compiled: true, configured: true, mapped: false, errors: [] }, /mapped false/],
    ["no result at all", undefined, /did not finish/],
  ])("refuses %s", (_label, result, expected) => {
    expect(bootstrapProblems(result).join("\n")).toMatch(expected);
  });

  it("accepts a console that reports the compilation finished successfully and prints no error line", () => {
    expect(compileProblems({ console: ["Compilation started on 10/21/2026", "Compiling class A", "Compilation finished successfully in 0.123s."] })).toEqual([]);
  });

  it.each([
    ["an error line and no success line", ["ERROR #5030: An error occurred while compiling class 'A'", "Detected 1 errors during compilation in 0.1s."], 2],
    ["an error line that is not at the start of the line", ["Class A : ERROR #5001: bad", "Compilation finished successfully."], 1],
    ["no success line", ["Compilation started", "Compiling class A"], 1],
    ["an empty console", [], 1],
  ])("finds %s", (_label, lines, count) => {
    const problems = compileProblems({ status: { errors: [], summary: "" }, console: lines, result: { content: [] } });

    expect(problems).toHaveLength(count);
    expect(problems.join("\n")).toMatch(lines.some((line) => /ERROR\s*#/.test(line)) ? /console: .*ERROR #\d+/ : /did not report that it finished successfully/);
  });

  it("finds a response with no console, and no response at all, as a compile that did not finish", () => {
    expect(compileProblems({})).toHaveLength(1);
    expect(compileProblems(undefined)).toHaveLength(1);
  });
});

describe("seedThrowaway refuses an environment that is not a throwaway target, before anything else", () => {
  it.each([
    ["no environment", {}],
    ["no arming variable", { ...throwawayEnv(49153), IRIS_REQUIRE_LIVE: undefined }],
    ["no IRIS_THROWAWAY", { ...throwawayEnv(49153), IRIS_THROWAWAY: undefined }],
    ["the shared instance's container name", { ...throwawayEnv(49153), IRIS_THROWAWAY: "iris-community-edition" }],
    ["another host", { ...throwawayEnv(49153), IRIS_HOST: "prod.example" }],
    ["port 52773", throwawayEnv(52773)],
    ["port 1972", throwawayEnv(1972)],
  ])("%s: exit 2, the shared dist is not loaded", async (_label, env) => {
    const logs: string[] = [];
    let loaded = false;

    const code = await seedThrowaway({
      env: env as Record<string, string | undefined>,
      loadShared: async () => {
        loaded = true;
        return {};
      },
      log: (line: string) => logs.push(line),
    });

    expect(code).toBe(2);
    expect(loaded).toBe(false);
    expect(logs.join("\n")).toMatch(/refusing to seed/);
  });

  it("exits 1 when the built shared dist cannot be loaded", async () => {
    const logs: string[] = [];
    const code = await seedThrowaway({
      env: throwawayEnv(49153),
      loadShared: async () => {
        throw new Error("Cannot find module");
      },
      log: (line: string) => logs.push(line),
    });

    expect(code).toBe(1);
    expect(logs.join("\n")).toMatch(/run pnpm build first/);
  });
});

describe("seeding the stateful fake Atelier with the real shared dist", () => {
  async function withFake<T>(options: { visibleClasses?: string[] }, body: (fake: Awaited<ReturnType<typeof startStatefulFakeAtelier>>) => Promise<T>): Promise<T> {
    const fake = await startStatefulFakeAtelier({ namespace: "HSCUSTOM", visibleClasses: ["Ens.Director"], ...options });
    try {
      return await body(fake);
    } finally {
      await fake.close();
    }
  }
  const seed = async (fake: { port: number }) => {
    const logs: string[] = [];
    const code = await seedThrowaway({ env: throwawayEnv(fake.port), log: (line: string) => logs.push(line) });
    return { code, logs: logs.join("\n") };
  };
  const fixtureNames = (seedDocuments(REPO_ROOT) as Array<{ name: string }>).map((document) => document.name);

  it("runs the real bootstrap, checks Ens.Director, then deploys and compiles only the 62 test and fixture classes", async () => {
    await withFake({}, async (fake) => {
      const { code, logs } = await seed(fake);

      expect(code, logs).toBe(0);
      const summary = summarizeRequests(fake.requests);
      expect(summary.puts.slice(0, 35)).toEqual([...BOOTSTRAP_CLASSES.keys()]);
      expect(summary.puts.slice(35)).toEqual(fixtureNames);
      expect(summary.puts.length).toBe(97);
      expect(summary.compiles, "one compile for the bootstrap classes, one for the fixtures").toBe(2);
      expect(summary.queries).toContain(INTEROP_QUERY);
      expect([...fake.state.docs.keys()].sort()).toEqual([...BOOTSTRAP_CLASSES.keys(), ...fixtureNames].sort());
      const compileBodies = fake.requests.filter((request) => request.url.endsWith("/action/compile")).map((request) => JSON.parse(request.body) as string[]);
      expect(compileBodies[0]).toEqual([...BOOTSTRAP_CLASSES.keys()]);
      expect(compileBodies[1]).toEqual(fixtureNames);
      expect(logs).toContain("Ens.Director is visible in HSCUSTOM");
      expect(logs).toContain("deployed and compiled 62 test and fixture classes");
    });
  }, 120_000);

  it("leaves the bootstrapped classes as the embed wrote them: Setup carries the embedded marker, never the dev placeholder", async () => {
    await withFake({}, async (fake) => {
      expect((await seed(fake)).code).toBe(0);

      const setup = (fake.state.docs.get("ExecuteMCPv2.Setup.cls") as { lines: string[] }).lines.join("\n");
      expect(setup).toContain(`Parameter BOOTSTRAPVERSION = "${BOOTSTRAP_VERSION}";`);
      expect(setup).not.toContain('BOOTSTRAPVERSION = "dev"');
      expect(fake.state.compiledMarker).toBe(BOOTSTRAP_VERSION);
    });
  }, 120_000);

  it("a second seed finds the service current and only deploys and compiles the fixtures again", async () => {
    await withFake({}, async (fake) => {
      expect((await seed(fake)).code).toBe(0);
      const before = fake.requests.length;

      const second = await seed(fake);
      const summary = summarizeRequests(fake.requests.slice(before));

      expect(second.code, second.logs).toBe(0);
      expect(second.logs).toContain("found the ExecuteMCPv2 service current");
      expect(summary.puts).toEqual(fixtureNames);
      expect(summary.compiles).toBe(1);
    });
  }, 120_000);

  it("fails closed, naming the namespace, when Ens.Director is not visible, and deploys no fixture", async () => {
    await withFake({ visibleClasses: [] }, async (fake) => {
      const { code, logs } = await seed(fake);

      expect(code).toBe(1);
      expect(logs).toMatch(/HSCUSTOM is not interoperability-enabled: Ens\.Director is not visible/);
      expect(summarizeRequests(fake.requests).puts).toEqual([...BOOTSTRAP_CLASSES.keys()]);
    });
  }, 120_000);

  it("fails on a compile error in the fixtures, naming it, after the bootstrap compiled", async () => {
    await withFake({}, async (fake) => {
      fake.failCompile = (names) => (names.some((name) => name.startsWith("ExecuteMCPv2.Tests.")) ? ["ERROR #5030: An error occurred while compiling class 'ExecuteMCPv2.Tests.UtilsTest'"] : undefined);

      const { code, logs } = await seed(fake);

      expect(code).toBe(1);
      expect(logs).toMatch(/ERROR #5030: An error occurred while compiling class 'ExecuteMCPv2\.Tests\.UtilsTest'/);
      expect(summarizeRequests(fake.requests).compiles).toBe(2);
    });
  }, 120_000);

  it("fails on a compile in which IRIS answers HTTP 200 with no status error and the failure only in the console, after the bootstrap compiled", async () => {
    await withFake({}, async (fake) => {
      fake.compileConsole = (names) =>
        names.some((name) => name.startsWith("ExecuteMCPv2.Tests.")) ? ["Compiling class ExecuteMCPv2.Tests.UtilsTest", "ERROR #5030: An error occurred while compiling class 'ExecuteMCPv2.Tests.UtilsTest'", "Detected 1 errors during compilation in 1.2s."] : undefined;

      const { code, logs } = await seed(fake);

      expect(code).toBe(1);
      expect(logs).toMatch(/2 compile problem\(s\)/);
      expect(logs).toMatch(/console: ERROR #5030: An error occurred while compiling class 'ExecuteMCPv2\.Tests\.UtilsTest'/);
      expect(logs).toMatch(/did not report that it finished successfully/);
      expect(summarizeRequests(fake.requests).compiles).toBe(2);
    });
  }, 120_000);

  it("fails when the bootstrap cannot compile, and asks nothing about Ens.Director", async () => {
    await withFake({}, async (fake) => {
      fake.failCompile = () => ["ERROR #5001: the classes do not compile"];

      const { code, logs } = await seed(fake);

      expect(code).toBe(1);
      expect(logs).toMatch(/the bootstrap of HSCUSTOM failed/);
      expect(logs).toMatch(/Compile failed/);
      expect(summarizeRequests(fake.requests).queries).not.toContain(INTEROP_QUERY);
    });
  }, 120_000);

  it("fails, and changes nothing, when the namespace holds a newer deployment than this build's", async () => {
    await withFake({}, async (fake) => {
      fake.state.docs.set("ExecuteMCPv2.Setup.cls", { lines: ['Parameter BOOTSTRAPVERSION = "99.0.0+1.aaaaaaaaaaaa";'], ts: "2026-01-01 00:00:00.000" });
      fake.state.compiledMarker = "99.0.0+1.aaaaaaaaaaaa";

      const { code, logs } = await seed(fake);

      expect(code).toBe(1);
      expect(logs).toMatch(/did not finish \(probe newer/);
      expect(summarizeRequests(fake.requests).puts).toEqual([]);
    });
  }, 120_000);

  it("run as a process, the script seeds the fake and exits 0, and refuses a non-throwaway environment with exit 2", async () => {
    await withFake({}, async (fake) => {
      const run = (env: Record<string, string>): Promise<{ status: number | null; stderr: string }> =>
        new Promise((resolve, reject) => {
          const base: Record<string, string> = {};
          for (const [key, value] of Object.entries(process.env)) {
            const upper = key.toUpperCase();
            if (typeof value === "string" && !upper.startsWith("IRIS_") && !upper.startsWith("VITEST") && !["NODE_OPTIONS", "TEST", "NODE_ENV"].includes(upper)) base[key] = value;
          }
          const child = spawn(process.execPath, [SCRIPT], { cwd: REPO_ROOT, env: { ...base, ...env } });
          let stderr = "";
          child.stderr.on("data", (chunk: Buffer) => {
            stderr += chunk.toString("utf8");
          });
          child.once("error", reject);
          child.once("close", (status) => resolve({ status, stderr }));
        });

      const refused = await run({ ...throwawayEnv(fake.port), IRIS_REQUIRE_LIVE: "0" });
      expect(refused.status).toBe(2);
      expect(fake.requests.length, "a refusal made no request").toBe(0);

      const seeded = await run(throwawayEnv(fake.port));
      expect(seeded.status, seeded.stderr.slice(-2000)).toBe(0);
      expect(summarizeRequests(fake.requests).puts.length).toBe(97);
    });
  }, 180_000);
});
