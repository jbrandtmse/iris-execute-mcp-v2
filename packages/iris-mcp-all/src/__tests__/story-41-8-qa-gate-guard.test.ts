/**
 * Story 41.8, DW-635 -- the arming and prerequisite guard of `story-41-8-qa-accept-language-live-gate.test.ts` on its
 * own real path (project rule #59), with no live IRIS and no shared state. Each case runs the gate in its own vitest
 * process, as `scripts/prepublish-gate.mjs` does, against a local listener that stands in for the ExecuteMCPv2
 * service and records every request it receives, or against a closed port:
 *
 *  - unarmed, with a full explicit target pointing at a listener that would answer correctly: every live row is
 *    skipped with the opt-in reason, the run passes, and the listener receives NO request;
 *  - armed with only `IRIS_HOST` and `IRIS_PORT` set: `beforeAll` fails closed naming the unset variables, and the
 *    listener receives no request (the gate never falls back to a default instance);
 *  - armed against a closed port, HTTP 401, HTTP 404, a body that is not the envelope, or a deployment whose
 *    `BOOTSTRAP_VERSION` is not this tree's embed: `beforeAll` fails closed with "may not be skipped" and the reason;
 *  - armed against the listener's renderings:
 *      - `fixed`: every language rendered once; all thirteen tests pass;
 *      - `doubled`: the pre-41.8 `SanitizeError` (the two-word loop restored); the fr, de and ja rows of the refusal
 *        and exception blocks are red and their English controls green;
 *      - `fixedLanguage`: `SanitizeError`'s empty branch reading `"en-us"`; of those two blocks, only the fr, de and
 *        ja exception rows are red;
 *      - `oldSafeText`: `SafeText`'s pre-41.8 tail (the one-argument `GetErrorText` plus the English marker); only
 *        the fr, de and ja `SafeText` rows are red.
 *
 * The listener's texts are live captures (IRIS 2026.2 Build 221U, HSCUSTOM, 2026-10-20 on the IRIS clock): the
 * refusal and exception texts (`GET /global` and `POST /classmethod` of `%SYSTEM.Status:GetErrorText`, per
 * `Accept-Language`) from the deployed classes, with the two-word loop restored and with the empty-language branch
 * reading `"en-us"`; the `SafeText` texts (`POST /classmethod` of `ExecuteMCPv2.Coverage.Job:SafeText` with
 * `<word> #5001: disk full`) from the deployed classes and with `SafeText`'s pre-41.8 tail deployed. A mode with no
 * `SafeText` capture answers those rows with HTTP 500, and its case asserts only the blocks captured in that mode.
 */

import { describe, it, expect, beforeAll } from "vitest";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { createServer as createHttpServer, type Server } from "node:http";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { inheritedEnv } from "./process-gate-helpers.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PACKAGE_DIR = path.resolve(__dirname, "..", "..");
const REPO_ROOT = path.resolve(PACKAGE_DIR, "..", "..");

const GATE_FILE = "story-41-8-qa-accept-language-live-gate.test.ts";
const GATE_TAG = "story-41-8-qa-accept-language-live-gate";

/** A port nothing listens on: the privileged port 1, as the suite's own unreachable-IRIS runs use. */
const CLOSED_PORT = "1";

/** The vitest entry point this package's tests run under. */
const VITEST_ENTRY = path.join(
  path.dirname(createRequire(import.meta.url).resolve("vitest/package.json")),
  "vitest.mjs",
);

/** The `BOOTSTRAP_VERSION` of this tree's checked-in embed, which the gate compares the deployment with. */
const EMBED_VERSION =
  /^export const BOOTSTRAP_VERSION = "((?:\d+\.\d+\.\d+\+\d+\.)?[0-9a-f]+)";$/m.exec(
    readFileSync(path.join(REPO_ROOT, "packages", "shared", "src", "bootstrap-classes.ts"), "utf8"),
  )?.[1] ?? "";

const KATAKANA_ERROR = String.fromCodePoint(12456, 12521, 12540);

/** What the listener renders per request language: the prefix word and the 5002 phrase before `<UNDEFINED>`. */
const LANGUAGES: Record<string, { word: string; innerLead: string }> = {
  fr: { word: "ERREUR", innerLead: "Erreur ObjectScript: " },
  de: { word: "FEHLER", innerLead: "ObjectScript-Fehler: " },
  ja: { word: KATAKANA_ERROR, innerLead: `ObjectScript ${KATAKANA_ERROR}:` },
  "en-US,en;q=0.9": { word: "ERROR", innerLead: "ObjectScript error: " },
};

const REFUSAL = "Required parameter 'global' is missing or empty";
const TOKEN = "<UNDEFINED>GetErrorText *statuscode";

type Mode =
  | "fixed"
  | "doubled"
  | "fixedLanguage"
  | "oldSafeText"
  | "unauthorized"
  | "notDeployed"
  | "notEnvelope"
  | "staleVersion";

/** The `errors[0].error` text the stand-in service renders for the refusal or exception route, request language and mode. */
function renderedErrorText(route: "global" | "classmethod", language: string, mode: Mode): string {
  const { word, innerLead } = LANGUAGES[language] ?? { word: "ERROR", innerLead: "ObjectScript error: " };
  // The pre-41.8 two-word loop removed an English (and an Arabic) prefix, so only a word it did not know stayed doubled.
  const doubled = mode === "doubled" && word !== "ERROR";
  if (route === "global") {
    return doubled ? `${word} #5001: ${word} #5001: ${REFUSAL}` : `${word} #5001: ${REFUSAL}`;
  }
  if (doubled) return `${word} #5001: ${word} #5002: ${innerLead}${TOKEN}`;
  if (mode === "fixedLanguage") return `${word} #5001: ObjectScript error: ${TOKEN}`;
  return `${word} #5001: ${innerLead}${TOKEN}`;
}

/**
 * The `SafeText` return value for the recorded text `<word> #5001: disk full` in the request language, or `undefined`
 * in a mode with no capture. The pre-41.8 tail re-reads the sanitized status in the request language and strips only
 * an English marker, so a non-English text comes back doubled.
 */
function renderedSafeText(language: string, mode: Mode): string | undefined {
  const { word } = LANGUAGES[language] ?? { word: "ERROR" };
  if (mode === "fixed") return `${word} #5001: disk full`;
  if (mode === "oldSafeText") return word === "ERROR" ? "ERROR #5001: disk full" : `${word} #5001: ${word} #5001: disk full`;
  return undefined;
}

interface StandIn {
  server: Server;
  port: string;
  /** Every request URL the listener received, in order. */
  requests: string[];
}

/** A local listener that answers as the ExecuteMCPv2 service would in `mode`, and records each request. */
async function startService(mode: Mode): Promise<StandIn> {
  const requests: string[] = [];
  const server = createHttpServer((request, response) => {
    const url = request.url ?? "";
    requests.push(url);
    let raw = "";
    request.setEncoding("utf8");
    request.on("data", (chunk: string) => (raw += chunk));
    request.on("end", () => {
      if (url.includes("/action/query")) {
        // The gate's Atelier query of the deployed `ExecuteMCPv2.Setup_GetBootstrapVersion()`.
        const version = mode === "staleVersion" ? "000000000000" : EMBED_VERSION;
        response.writeHead(200, { "Content-Type": "application/json" }).end(
          JSON.stringify({ status: { errors: [], summary: "" }, console: [], result: { content: [{ Version: version }] } }),
        );
        return;
      }
      if (!url.startsWith("/api/executemcp/v2/")) {
        // The reachability probe (`/api/atelier/`): any status proves the instance is there.
        response.writeHead(200).end("{}");
        return;
      }
      if (mode === "unauthorized") {
        response.writeHead(401).end("");
        return;
      }
      if (mode === "notDeployed") {
        response.writeHead(404).end("");
        return;
      }
      if (mode === "notEnvelope") {
        response.writeHead(200, { "Content-Type": "text/html" }).end("<html>not the envelope</html>");
        return;
      }
      const language = String(request.headers["accept-language"] ?? "");
      const isClassMethod = url.startsWith("/api/executemcp/v2/classmethod");
      let methodName = "";
      try {
        methodName = isClassMethod ? String((JSON.parse(raw) as { methodName?: unknown }).methodName ?? "") : "";
      } catch {
        methodName = "";
      }
      if (methodName === "SafeText") {
        const value = renderedSafeText(language, mode);
        if (value === undefined) {
          response.writeHead(500).end("no SafeText capture in this mode");
          return;
        }
        response.writeHead(200, { "Content-Type": "application/json; charset=utf-8" }).end(
          JSON.stringify({ status: { errors: [], summary: "" }, console: [], result: { returnValue: value } }),
        );
        return;
      }
      const text = renderedErrorText(isClassMethod ? "classmethod" : "global", language, mode);
      const envelope = {
        status: {
          errors: [{ error: text, code: 5001, domain: "%ObjectErrors", id: "GeneralError", params: [] }],
          summary: text.replace(/'/g, "&#39;"),
        },
        console: [],
        result: {},
      };
      response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }).end(JSON.stringify(envelope));
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  const port = typeof address === "object" && address !== null ? String(address.port) : "";
  return { server, port, requests };
}

/** Close the listener. */
function stopService(standIn: StandIn): Promise<void> {
  return new Promise<void>((resolve) => standIn.server.close(() => resolve()));
}

interface GateRun {
  status: number | null;
  /** `true` when the run was still going at the deadline and was killed. */
  timedOut: boolean;
  output: string;
  /** Full test name (describe blocks and title) -> status, from the JSON reporter (empty for a default-reporter run). */
  results: Map<string, string>;
}

interface GateOptions {
  port: string;
  armed: boolean;
  json: boolean;
  /** `full` sets all five target variables; `hostPortOnly` sets only `IRIS_HOST` and `IRIS_PORT`. */
  target: "full" | "hostPortOnly";
}

/** Run the gate file in its own vitest process; async, so a listener in this process can answer it. */
function runGate(options: GateOptions): Promise<GateRun> {
  return new Promise((resolve, reject) => {
    const target: Record<string, string> =
      options.target === "full"
        ? {
            IRIS_HOST: "127.0.0.1",
            IRIS_PORT: options.port,
            IRIS_USERNAME: "qa-guard",
            IRIS_PASSWORD: "qa-guard",
            IRIS_NAMESPACE: "HSCUSTOM",
            IRIS_HTTPS: "false",
          }
        : { IRIS_HOST: "127.0.0.1", IRIS_PORT: options.port };
    const child = spawn(
      process.execPath,
      [VITEST_ENTRY, "run", `src/__tests__/${GATE_FILE}`, ...(options.json ? ["--reporter=json"] : [])],
      {
        cwd: PACKAGE_DIR,
        env: {
          ...inheritedEnv(["VITEST", "VITEST_WORKER_ID", "VITEST_POOL_ID", "VITEST_MODE", "TEST", "NODE_ENV"]),
          ...target,
          ...(options.armed ? { IRIS_REQUIRE_LIVE: "1" } : {}),
        },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    child.stdout.setEncoding("utf8").on("data", (chunk: string) => (stdout += chunk));
    child.stderr.setEncoding("utf8").on("data", (chunk: string) => (stderr += chunk));
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, 90000);
    child.once("error", reject);
    child.once("close", (status) => {
      clearTimeout(timer);
      const results = new Map<string, string>();
      if (options.json) {
        const start = stdout.indexOf('{"numTotalTestSuites"');
        if (start >= 0) {
          try {
            const parsed = JSON.parse(stdout.slice(start)) as {
              testResults: Array<{ assertionResults: Array<{ fullName: string; status: string }> }>;
            };
            for (const file of parsed.testResults) {
              for (const test of file.assertionResults) results.set(test.fullName, test.status);
            }
          } catch (error) {
            reject(new Error(`the gate's JSON report did not parse: ${error instanceof Error ? error.message : String(error)}`));
            return;
          }
        }
      }
      resolve({ status, timedOut, output: `${stdout}\n${stderr}`, results });
    });
  });
}

/** The block of each live row, by a fragment of its describe name. */
const BLOCK = {
  refusal: "GET /global refusal",
  exception: "a real <UNDEFINED> exception",
  safeText: "one-argument Coverage.Job:SafeText",
} as const;

/** The full names in `run` whose status is `status`, that sit in one of `blocks` and that mention `needle`. */
function names(run: GateRun, status: string, blocks: readonly string[], needle = ""): string[] {
  return [...run.results]
    .filter(([name, state]) => state === status && blocks.some((block) => name.includes(block)) && name.includes(needle))
    .map(([name]) => name);
}

/** The `Accept-Language ${header}:` fragment of a row title. */
const rowOf = (header: string): string => `Accept-Language ${header}:`;
/** The fragment every English-control title holds (the refusal block adds "(the English control)" before its colon). */
const CONTROL = "Accept-Language en-US,en;q=0.9";

beforeAll(() => {
  expect(EMBED_VERSION, "the embed's BOOTSTRAP_VERSION was read from packages/shared/src/bootstrap-classes.ts").toMatch(
    /^\d+\.\d+\.\d+\+\d+\.[0-9a-f]{12}$/,
  );
});

describe("Story 41.8 (DW-635): the Accept-Language live gate is opt-in and fails closed, on its own real path", () => {
  it("unarmed, with a full explicit target at a listener: every live row is skipped with the opt-in reason, and no request is made", async () => {
    const standIn = await startService("fixed");
    try {
      const run = await runGate({ port: standIn.port, armed: false, json: false, target: "full" });
      expect(run.output).toContain(`[SKIP] ${GATE_TAG}: opt-in live gate: set IRIS_REQUIRE_LIVE=1`);
      expect(run.output).toMatch(/Tests\s+1 passed \| 12 skipped \(13\)/);
      expect(run.status, run.output).toBe(0);
      expect(standIn.requests, "the unarmed gate sent no request").toEqual([]);
    } finally {
      await stopService(standIn);
    }
  }, 120000);

  it("armed with only IRIS_HOST and IRIS_PORT: the gate fails closed naming the unset variables, and no request is made", async () => {
    const standIn = await startService("fixed");
    try {
      const run = await runGate({ port: standIn.port, armed: true, json: false, target: "hostPortOnly" });
      expect(run.output).toContain(
        "may not be skipped: IRIS_USERNAME, IRIS_PASSWORD, IRIS_NAMESPACE are not set, and this gate never falls back to a default instance",
      );
      expect(run.timedOut).toBe(false);
      expect(run.status, "the armed run must not pass").not.toBe(0);
      expect(standIn.requests, "the gate sent no request with an incomplete target").toEqual([]);
    } finally {
      await stopService(standIn);
    }
  }, 120000);

  it("armed, with IRIS not reachable: the gate fails in beforeAll with 'may not be skipped: <reason>'", async () => {
    const run = await runGate({ port: CLOSED_PORT, armed: true, json: false, target: "full" });
    expect(run.output).toContain(
      `the Story 41.8 Accept-Language gate may not be skipped: IRIS is not reachable at http://127.0.0.1:${CLOSED_PORT}`,
    );
    expect(run.timedOut).toBe(false);
    expect(run.status, "the armed run must not pass").not.toBe(0);
  }, 120000);

  for (const [mode, reason] of [
    ["unauthorized", "answered HTTP 401: the IRIS_USERNAME/IRIS_PASSWORD given are not accepted"],
    ["notDeployed", "ExecuteMCPv2's REST service is not deployed"],
    ["notEnvelope", "with a body that is not the ExecuteMCPv2 envelope"],
    ["staleVersion", `report BOOTSTRAP_VERSION "000000000000" but this tree's embed`],
  ] as const) {
    it(`armed, with the service answering '${mode}': the gate fails closed with the reason`, async () => {
      const standIn = await startService(mode);
      try {
        const run = await runGate({ port: standIn.port, armed: true, json: false, target: "full" });
        expect(run.output).toContain("may not be skipped: ");
        expect(run.output).toContain(reason);
        expect(run.timedOut).toBe(false);
        expect(run.status, "the armed run must not pass").not.toBe(0);
      } finally {
        await stopService(standIn);
      }
    }, 120000);
  }

  it("armed, against a service that renders each language once: all thirteen tests pass", async () => {
    const standIn = await startService("fixed");
    try {
      const run = await runGate({ port: standIn.port, armed: true, json: true, target: "full" });
      expect(run.results.size, "the JSON reporter listed the thirteen tests").toBe(13);
      expect([...run.results.values()].filter((state) => state === "passed")).toHaveLength(13);
      expect(run.status, run.output).toBe(0);
    } finally {
      await stopService(standIn);
    }
  }, 120000);

  it("armed, against the pre-41.8 doubled prefix: the fr, de and ja refusal and exception rows are red, their English controls green", async () => {
    const standIn = await startService("doubled");
    try {
      const run = await runGate({ port: standIn.port, armed: true, json: true, target: "full" });
      const blocks = [BLOCK.refusal, BLOCK.exception];
      for (const header of ["fr", "de", "ja"]) {
        expect(names(run, "failed", blocks, rowOf(header)), `both rows for ${header} fail`).toHaveLength(2);
      }
      expect(names(run, "passed", blocks, CONTROL), "the English control passes in both blocks").toHaveLength(2);
      expect(names(run, "passed", ["the words the rows expect are the live pin"]), "the pin row passes").toHaveLength(1);
      expect(run.status, "a red row fails the run").not.toBe(0);
    } finally {
      await stopService(standIn);
    }
  }, 120000);

  it("armed, against a SanitizeError that reads in a fixed language: of the refusal and exception rows, only the fr, de and ja exception rows are red", async () => {
    const standIn = await startService("fixedLanguage");
    try {
      const run = await runGate({ port: standIn.port, armed: true, json: true, target: "full" });
      const blocks = [BLOCK.refusal, BLOCK.exception];
      expect(names(run, "failed", blocks).sort()).toEqual(
        names(run, "failed", [BLOCK.exception]).filter((name) => ["fr", "de", "ja"].some((header) => name.includes(rowOf(header)))).sort(),
      );
      expect(names(run, "failed", [BLOCK.exception]), "the fr, de and ja exception rows fail").toHaveLength(3);
      expect(names(run, "passed", [BLOCK.refusal]), "the four refusal rows still pass").toHaveLength(4);
      expect(names(run, "passed", [BLOCK.exception], CONTROL), "the English exception control passes").toHaveLength(1);
      expect(run.status, "a red row fails the run").not.toBe(0);
    } finally {
      await stopService(standIn);
    }
  }, 120000);

  it("armed, against SafeText's pre-41.8 tail: only the fr, de and ja SafeText rows are red", async () => {
    const standIn = await startService("oldSafeText");
    try {
      const run = await runGate({ port: standIn.port, armed: true, json: true, target: "full" });
      const failed = [...run.results].filter(([, state]) => state === "failed").map(([name]) => name);
      expect(failed.sort()).toEqual(
        ["fr", "de", "ja"].map((header) => names(run, "failed", [BLOCK.safeText], rowOf(header))[0] ?? `missing ${header}`).sort(),
      );
      expect(names(run, "passed", [BLOCK.safeText], CONTROL), "the English SafeText control passes").toHaveLength(1);
      expect([...run.results.values()].filter((state) => state === "passed"), "the other ten tests pass").toHaveLength(10);
      expect(run.status, "a red row fails the run").not.toBe(0);
    } finally {
      await stopService(standIn);
    }
  }, 120000);
});
