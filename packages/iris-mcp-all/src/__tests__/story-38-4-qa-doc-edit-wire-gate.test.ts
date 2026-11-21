/**
 * Story 38.4 (QA) - `iris_doc_edit` and the governance `parent` mechanism on the REAL wire.
 *
 * `doc-edit-live-gate.test.ts` (iris-dev-mcp) drives the handler against real Atelier routes, and
 * `doc-edit-governance.test.ts` drives the real governance gate with handler spies and a stubbed
 * fetch. Neither reaches the deliverable as a client does. This gate spawns the BUILT iris-dev-mcp
 * dist as a child process, connects the real MCP SDK `Client` over stdio, and calls the tools
 * against the live IRIS, so these properties are proven where they happen. Before any test it asserts
 * that the deployed `ExecuteMCPv2` classes carry the `BOOTSTRAP_VERSION` of the built shared dist (the
 * version check of `process-gate-helpers.ts`):
 *
 *  - `tools/list` shows the `iris_doc_edit` schema (`action` enum, flat edit objects, no parameter
 *    that skips a guard or a version check) and its four annotations, and `iris_server_profiles`
 *    reports the default verdicts (`apply` enabled, `regenerateStorage` disabled, source `default`);
 *  - the SDK parses an `apply` whose edits omit the fields their op does not take (including
 *    `afterLine: 0`), the document is saved, `iris_doc_compile` accepts it, and the excerpts equal
 *    ranged `iris_doc_get` reads;
 *  - a stale `expected` is refused with `STALE_CONTENT` and the stored lines and `ts` are unchanged;
 *  - `regenerateStorage` is denied by governance by default and `apply` is refused with
 *    `STORAGE_DROPPED`, each leaving a compiled persistent class unchanged;
 *  - with `iris_doc_put` explicitly disabled, both `iris_doc_edit` keys are denied with
 *    `inheritedFrom`, reported as source `parent`, and nothing is written; an explicit
 *    `iris_doc_edit:apply: true` wins and writes; the verdicts agree when `iris_doc_put` is hidden;
 *  - `iris_doc_edit:regenerateStorage: true` lets the Storage-removing edit through, and the read-only
 *    preset denies `apply` with `presetApplied` unless the parent's inherited disable is the cause;
 *  - the built `iris-mcp-governance universe --json` process reports the same policy and source as
 *    the server's `iris_server_profiles` for every key the server knows, `parent` included.
 *
 * Target: `IRIS_HOST`/`IRIS_PORT`/`IRIS_USERNAME`/`IRIS_PASSWORD`/`IRIS_NAMESPACE`, all required and none
 * defaulted, and only when `IRIS_REQUIRE_LIVE` arms the run (without it every test skips before any request); every call names `server: "default"` and the namespace.
 * Writes only the disposable `ExecuteMCPv2.Temp.QaStory384WireEdit.cls` and `...WireStore.cls`
 * (persistent, compiled, no rows) documents, removes them and any data global of theirs before and
 * after the run, and asserts that nothing named `QaStory384Wire` is left.
 *
 * Placement (Rule #45): `@iris-mcp/all` spawns built dists. A missing or stale `shared` or
 * `iris-dev-mcp` dist, an unresolvable SDK or an unreachable IRIS skips each test with the reason, or
 * fails when `IRIS_REQUIRE_LIVE` is armed (listed in `scripts/prepublish-gate.mjs` `gateTestFiles`).
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import {
  assertDeployedBootstrapVersion,
  docFixtures,
  governanceDenial,
  governanceReport,
  inheritedEnv,
  irisTargetFromEnv,
  isIrisReachable,
  lineNumber,
  liveArmingSkipReason,
  openWireSession,
  resolveSdkEsmDir,
  staleDistReason,
  stemFixtures,
  storageRange,
  withWireSession,
  type DocFixtures,
  type StemFixtures,
  type WireSession as Session,
  type WireSessionOptions,
} from "./process-gate-helpers.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..", "..");
const DEV_ENTRY = path.join(REPO_ROOT, "packages", "iris-dev-mcp", "dist", "index.js");
const GOVERNANCE_CLI_BIN = path.join(REPO_ROOT, "packages", "shared", "dist", "cli", "governance-cli.js");

const TARGET = irisTargetFromEnv();
const IRIS_HOST = TARGET.host;
const IRIS_PORT = TARGET.port;
const NS = TARGET.namespace;

const REQUIRE_LIVE =
  process.env.IRIS_REQUIRE_LIVE === "1" || process.env.IRIS_REQUIRE_LIVE === "true";

const FIXTURE_FILTER = "QaStory384Wire";
const EDIT_CLASS = "ExecuteMCPv2.Temp.QaStory384WireEdit";
const STORE_CLASS = "ExecuteMCPv2.Temp.QaStory384WireStore";
const EDIT_DOC = `${EDIT_CLASS}.cls`;
const STORE_DOC = `${STORE_CLASS}.cls`;

// -- The wire --------------------------------------------------------

let skipReason: string | undefined;
let sdkEsmDir: string | undefined;
let admin: Session;
/** The document helpers and the fixture oracles of `admin`, bound when called, so a teardown after a failed start-up still reaches the tools. */
const docs = (): DocFixtures => docFixtures(admin);
const fixtures = (): StemFixtures => stemFixtures(admin, FIXTURE_FILTER);

/** The built dev server and the target, for the shared wire helpers. */
function wireOptions(): WireSessionOptions {
  return { sdkEsmDir: sdkEsmDir as string, entry: DEV_ENTRY, target: TARGET, clientName: "story-38-4-qa-wire-gate" };
}

/**
 * Spawn the built dev server with `extraEnv` (governance and visibility settings) on top of the
 * explicit connection settings, and connect an SDK client to it over stdio.
 */
const openSession = (extraEnv: Record<string, string> = {}): Promise<Session> => openWireSession(wireOptions(), extraEnv);

/** Run `body` with a session whose server was started with `extraEnv`, and always close it. */
const withSession = <T>(extraEnv: Record<string, string>, body: (session: Session) => Promise<T>): Promise<T> =>
  withWireSession(wireOptions(), extraEnv, body);

// -- Fixtures --------------------------------------------------------

/** The Edit class: a property, a scratch comment to delete, and a method. */
const EDIT_SOURCE = [
  `Class ${EDIT_CLASS} Extends %RegisteredObject`,
  "{",
  "",
  "Property Alpha As %String;",
  "",
  "/// Scratch comment to delete.",
  "Method Run() As %Status",
  "{",
  "\tSet tSC = $$$OK",
  "\tQuit tSC",
  "}",
  "",
  "}",
].join("\n");

/** The Store class: persistent with no rows; the compile generates its Storage. */
const STORE_SOURCE = [`Class ${STORE_CLASS} Extends %Persistent`, "{", "", "Property Name As %String;", "", "}"].join("\n");

interface StoredDoc {
  ts: string;
  content: string[];
}

async function readDoc(docName: string): Promise<StoredDoc> {
  const result = await admin.call("iris_doc_get", { name: docName });
  expect(result.isError, `reading ${docName}`).toBeFalsy();
  const stored = result.structuredContent as { ts: string; content: string[] };
  return { ts: stored.ts, content: stored.content };
}

/** A fresh Edit class, returned as stored. */
async function freshEdit(): Promise<StoredDoc> {
  await docs().putDoc(EDIT_DOC, EDIT_SOURCE);
  return readDoc(EDIT_DOC);
}

/** A fresh, compiled Store class (its Storage generated), returned as stored. */
async function freshStore(): Promise<StoredDoc> {
  await docs().putDoc(STORE_DOC, STORE_SOURCE);
  await docs().compileDoc(STORE_DOC);
  const stored = await readDoc(STORE_DOC);
  expect(storageRange(stored.content), "the compile generated a Storage definition").not.toBeUndefined();
  return stored;
}

/** One valid replace of the Edit class's `Set` line, against `stored`. */
function replaceSetLine(stored: StoredDoc): Array<Record<string, unknown>> {
  const line = lineNumber(stored.content, "\tSet tSC = $$$OK");
  return [{ op: "replace", startLine: line, endLine: line, text: "\tSet tSC = 2", expected: "\tSet tSC = $$$OK" }];
}

/** The edit that deletes the Store class's Storage definition, against `stored`. */
function deleteStorageEdit(stored: StoredDoc): Array<Record<string, unknown>> {
  const range = storageRange(stored.content);
  expect(range, "the Store class has a Storage definition").not.toBeUndefined();
  const { first, last } = range as { first: number; last: number };
  return [{ op: "delete", startLine: first, endLine: last, expected: stored.content.slice(first - 1, last).join("\n") }];
}

// -- Cleanup ---------------------------------------------------------

async function removeFixtures(): Promise<void> {
  await fixtures().killGlobals();
  for (const docName of [EDIT_DOC, STORE_DOC]) await docs().removeDoc(docName);
}

beforeAll(async () => {
  const sharedStale = staleDistReason(REPO_ROOT, "shared");
  skipReason = liveArmingSkipReason() ?? sharedStale ?? staleDistReason(REPO_ROOT, "iris-dev-mcp");
  if (!skipReason) {
    sdkEsmDir = resolveSdkEsmDir(REPO_ROOT);
    if (!sdkEsmDir) {
      skipReason = "Could not resolve the @modelcontextprotocol/client ESM build under node_modules/.pnpm - run pnpm install from the repo root.";
    } else if (!(await isIrisReachable(IRIS_HOST, IRIS_PORT))) {
      skipReason = `IRIS is not reachable at http://${IRIS_HOST}:${IRIS_PORT}/api/atelier/ (set IRIS_HOST/IRIS_PORT to point at a live instance).`;
    }
  }
  if (skipReason && REQUIRE_LIVE) {
    throw new Error(`IRIS_REQUIRE_LIVE is set, so the Story 38.4 wire gate may not be skipped: ${skipReason}`);
  }
  if (skipReason) return;

  admin = await openSession();
  await assertDeployedBootstrapVersion(REPO_ROOT, TARGET);
  await removeFixtures();
  expect(await fixtures().documents(), "no QaStory384Wire document before the run").toEqual([]);
  expect(await fixtures().globals(), "no QaStory384Wire global before the run").toEqual([]);
}, 90000);

afterAll(async () => {
  if (skipReason) return;
  try {
    await removeFixtures();
    expect(await fixtures().documents(), "no QaStory384Wire document after the run").toEqual([]);
    expect(await fixtures().globals(), "no QaStory384Wire global after the run").toEqual([]);
  } finally {
    await admin.close();
  }
}, 90000);

// -- The defaults, as a client sees them -----------------------------

describe("iris_doc_edit on the wire, default governance (Story 38.4, AC-4, AC-6)", () => {
  it("tools/list shows the schema, the annotations and no parameter that skips a guard; iris_server_profiles reports the defaults", async (testCtx) => {
    if (skipReason) return testCtx.skip();

    const tools = await admin.listTools();
    const edit = tools.find((tool) => tool.name === "iris_doc_edit");
    expect(edit, "iris_doc_edit is listed").not.toBeUndefined();
    const schema = edit?.inputSchema as {
      properties: Record<string, { enum?: string[]; items?: { properties: Record<string, unknown>; required?: string[] } }>;
      required: string[];
    };
    expect(schema.properties.action?.enum).toEqual(["apply", "regenerateStorage"]);
    expect([...schema.required].sort()).toEqual(["action", "edits", "name"]);
    expect(Object.keys(schema.properties)).toEqual(expect.arrayContaining(["action", "name", "edits", "namespace"]));
    for (const forbidden of ["ts", "ignoreConflict", "allowStorageRegeneration", "force"]) {
      expect(schema.properties[forbidden], forbidden).toBeUndefined();
    }
    expect(Object.keys(schema.properties.edits?.items?.properties ?? {})).toEqual([
      "op",
      "afterLine",
      "startLine",
      "endLine",
      "text",
      "expected",
    ]);
    expect(schema.properties.edits?.items?.required).toEqual(["op", "expected"]);
    expect(edit?.annotations).toMatchObject({
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: false,
    });
    expect(tools.find((tool) => tool.name === "iris_doc_get"), "the paired read tool is listed too").not.toBeUndefined();

    const { policy, configSource } = await governanceReport(admin);
    expect(policy["iris_doc_edit:apply"]).toBe(true);
    expect(policy["iris_doc_edit:regenerateStorage"]).toBe(false);
    expect(policy["iris_doc_put"]).toBe(true);
    expect(configSource["iris_doc_edit:apply"]).toBe("default");
    expect(configSource["iris_doc_edit:regenerateStorage"]).toBe("default");
    expect(configSource["iris_doc_put"]).toBe("default");
  }, 60000);

  it("apply saves edits whose omitted fields the SDK parses (afterLine 0 included), the class compiles, and the excerpts equal ranged reads", async (testCtx) => {
    if (skipReason) return testCtx.skip();
    const before = await freshEdit();
    const setLine = lineNumber(before.content, "\tSet tSC = $$$OK");
    const alphaLine = lineNumber(before.content, "Property Alpha As %String;");
    const commentLine = lineNumber(before.content, "/// Scratch comment to delete.");

    const result = await admin.call("iris_doc_edit", {
      action: "apply",
      name: EDIT_DOC,
      edits: [
        { op: "replace", startLine: setLine, endLine: setLine, text: "\tSet tSC = 2", expected: "\tSet tSC = $$$OK" },
        { op: "insert", afterLine: alphaLine, text: "Property Beta As %String;", expected: "Property Alpha As %String;" },
        { op: "delete", startLine: commentLine, endLine: commentLine, expected: "/// Scratch comment to delete." },
        { op: "insert", afterLine: 0, text: "/// Edited over the MCP wire.", expected: before.content[0] as string },
      ],
    });

    expect(result.isError, result.content?.[0]?.text).toBeFalsy();
    const answer = result.structuredContent as {
      ts: string;
      totalLines: number;
      changed: boolean;
      unifiedDiff: string;
      excerpts: Array<{ edit: number; op: string; startLine: number; endLine: number; lines: string[] }>;
    };
    expect(answer.changed).toBe(true);

    const fresh = await readDoc(EDIT_DOC);
    expect(answer.ts).toBe(fresh.ts);
    expect(answer.ts).not.toBe(before.ts);
    expect(answer.totalLines).toBe(fresh.content.length);
    expect(fresh.content).toContain("\tSet tSC = 2");
    expect(fresh.content).toContain("Property Beta As %String;");
    expect(fresh.content).toContain("/// Edited over the MCP wire.");
    expect(fresh.content).not.toContain("/// Scratch comment to delete.");
    expect(answer.unifiedDiff.split("\n").slice(0, 2)).toEqual([`--- ${EDIT_DOC}\t${before.ts}`, `+++ ${EDIT_DOC}\t${fresh.ts}`]);
    expect(answer.excerpts.map((excerpt) => [excerpt.edit, excerpt.op])).toEqual([
      [1, "replace"],
      [2, "insert"],
      [3, "delete"],
      [4, "insert"],
    ]);
    for (const excerpt of answer.excerpts) {
      const slice = await admin.call("iris_doc_get", {
        name: EDIT_DOC,
        startLine: excerpt.startLine,
        endLine: excerpt.endLine,
      });
      expect(slice.isError, `ranged read of excerpt ${excerpt.edit}`).toBeFalsy();
      expect((slice.structuredContent as { lines: string[] }).lines, `excerpt ${excerpt.edit}`).toEqual(excerpt.lines);
    }
    expect(result.content?.[0]?.text).toContain("It is not compiled: run iris_doc_compile next.");

    await docs().compileDoc(EDIT_DOC);
  }, 120000);

  it("a stale expected text is STALE_CONTENT with the current text, and the stored lines and ts are unchanged", async (testCtx) => {
    if (skipReason) return testCtx.skip();
    const before = await freshEdit();
    const setLine = lineNumber(before.content, "\tSet tSC = $$$OK");

    const result = await admin.call("iris_doc_edit", {
      action: "apply",
      name: EDIT_DOC,
      edits: [{ op: "replace", startLine: setLine, endLine: setLine, text: "\tSet tSC = 2", expected: "\tSet tSC = $$$NOT_THE_TEXT" }],
    });

    expect(result.isError).toBe(true);
    expect(result.structuredContent).toEqual({
      code: "STALE_CONTENT",
      name: EDIT_DOC,
      namespace: NS,
      ts: before.ts,
      totalLines: before.content.length,
      mismatches: [{ edit: 1, op: "replace", startLine: setLine, endLine: setLine, current: "\tSet tSC = $$$OK\n" }],
    });
    expect(await readDoc(EDIT_DOC)).toEqual(before);
  }, 120000);

  it("on a compiled persistent class, regenerateStorage is denied by governance and apply is STORAGE_DROPPED; the document is unchanged either way", async (testCtx) => {
    if (skipReason) return testCtx.skip();
    const before = await freshStore();
    const edits = deleteStorageEdit(before);

    const denied = await admin.call("iris_doc_edit", { action: "regenerateStorage", name: STORE_DOC, edits });

    expect(denied.isError).toBe(true);
    expect(denied.structuredContent).toEqual(governanceDenial("iris_doc_edit:regenerateStorage"));
    expect(denied.content?.[0]?.text).toBe(
      "action 'iris_doc_edit:regenerateStorage' is disabled by governance policy for server 'default'",
    );
    expect(await readDoc(STORE_DOC)).toEqual(before);

    const refused = await admin.call("iris_doc_edit", { action: "apply", name: STORE_DOC, edits });

    expect(refused.isError).toBe(true);
    expect(refused.structuredContent).toEqual({
      code: "STORAGE_DROPPED",
      name: STORE_DOC,
      namespace: NS,
      droppedStorage: ["Default"],
    });
    expect(await readDoc(STORE_DOC)).toEqual(before);
  }, 120000);
});

// -- Parent inheritance, as a client sees it -------------------------

describe("iris_doc_put disabled: the parent mechanism on the wire (Story 38.4, AC-6)", () => {
  const PARENT_OFF = { IRIS_GOVERNANCE: JSON.stringify({ global: { iris_doc_put: false } }) };

  it("both iris_doc_edit keys are denied with inheritedFrom and write nothing; iris_doc_put keeps its own denial; the report says parent", async (testCtx) => {
    if (skipReason) return testCtx.skip();
    const edit = await freshEdit();
    const store = await freshStore();

    await withSession(PARENT_OFF, async (session) => {
      const applied = await session.call("iris_doc_edit", { action: "apply", name: EDIT_DOC, edits: replaceSetLine(edit) });
      expect(applied.isError).toBe(true);
      expect(applied.structuredContent).toEqual(governanceDenial("iris_doc_edit:apply", { inheritedFrom: "iris_doc_put" }));
      expect(applied.content?.[0]?.text).toBe(
        "action 'iris_doc_edit:apply' is disabled by governance policy for server 'default' (inherited from 'iris_doc_put')",
      );

      const regenerated = await session.call("iris_doc_edit", {
        action: "regenerateStorage",
        name: STORE_DOC,
        edits: deleteStorageEdit(store),
      });
      expect(regenerated.isError).toBe(true);
      expect(regenerated.structuredContent).toEqual(
        governanceDenial("iris_doc_edit:regenerateStorage", { inheritedFrom: "iris_doc_put" }),
      );

      const put = await session.call("iris_doc_put", { name: EDIT_DOC, content: "Class X {}" });
      expect(put.isError).toBe(true);
      expect(put.structuredContent).toEqual(governanceDenial("iris_doc_put"));

      const { policy, configSource } = await governanceReport(session);
      expect(policy["iris_doc_edit:apply"]).toBe(false);
      expect(policy["iris_doc_edit:regenerateStorage"]).toBe(false);
      expect(policy["iris_doc_put"]).toBe(false);
      expect(configSource["iris_doc_edit:apply"]).toBe("parent");
      expect(configSource["iris_doc_edit:regenerateStorage"]).toBe("parent");
      expect(configSource["iris_doc_put"]).toBe("env");

      // The disable reaches only the keys that declare the parent: reads still work.
      const read = await session.call("iris_doc_get", { name: EDIT_DOC });
      expect(read.isError).toBeFalsy();
    });

    expect(await readDoc(EDIT_DOC)).toEqual(edit);
    expect(await readDoc(STORE_DOC)).toEqual(store);
  }, 120000);

  it("an explicit iris_doc_edit:apply: true wins and writes; regenerateStorage still inherits and writes nothing", async (testCtx) => {
    if (skipReason) return testCtx.skip();
    const edit = await freshEdit();
    const store = await freshStore();

    await withSession(
      { IRIS_GOVERNANCE: JSON.stringify({ global: { iris_doc_put: false, "iris_doc_edit:apply": true } }) },
      async (session) => {
        const applied = await session.call("iris_doc_edit", { action: "apply", name: EDIT_DOC, edits: replaceSetLine(edit) });
        expect(applied.isError, applied.content?.[0]?.text).toBeFalsy();
        expect(applied.structuredContent).toMatchObject({ changed: true, name: EDIT_DOC });

        const regenerated = await session.call("iris_doc_edit", {
          action: "regenerateStorage",
          name: STORE_DOC,
          edits: deleteStorageEdit(store),
        });
        expect(regenerated.isError).toBe(true);
        expect(regenerated.structuredContent).toEqual(
          governanceDenial("iris_doc_edit:regenerateStorage", { inheritedFrom: "iris_doc_put" }),
        );

        const put = await session.call("iris_doc_put", { name: EDIT_DOC, content: "Class X {}" });
        expect(put.structuredContent).toEqual(governanceDenial("iris_doc_put"));

        const { policy, configSource } = await governanceReport(session);
        expect(policy["iris_doc_edit:apply"]).toBe(true);
        expect(configSource["iris_doc_edit:apply"]).toBe("env");
        expect(policy["iris_doc_edit:regenerateStorage"]).toBe(false);
        expect(configSource["iris_doc_edit:regenerateStorage"]).toBe("parent");
      },
    );

    const after = await readDoc(EDIT_DOC);
    expect(after.content).toContain("\tSet tSC = 2");
    expect(after.ts).not.toBe(edit.ts);
    expect(await readDoc(STORE_DOC)).toEqual(store);
  }, 120000);

  it("with iris_doc_put hidden by IRIS_TOOLS_DISABLE the server starts, the tool is gone, and the inherited disable still applies", async (testCtx) => {
    if (skipReason) return testCtx.skip();
    const edit = await freshEdit();

    await withSession({ ...PARENT_OFF, IRIS_TOOLS_DISABLE: "iris_doc_put" }, async (session) => {
      const names = (await session.listTools()).map((tool) => tool.name);
      expect(names).toContain("iris_doc_edit");
      expect(names).not.toContain("iris_doc_put");

      const applied = await session.call("iris_doc_edit", { action: "apply", name: EDIT_DOC, edits: replaceSetLine(edit) });
      expect(applied.isError).toBe(true);
      expect(applied.structuredContent).toEqual(governanceDenial("iris_doc_edit:apply", { inheritedFrom: "iris_doc_put" }));
    });
    expect(await readDoc(EDIT_DOC)).toEqual(edit);

    await withSession({ IRIS_TOOLS_DISABLE: "iris_doc_put" }, async (session) => {
      const applied = await session.call("iris_doc_edit", { action: "apply", name: EDIT_DOC, edits: replaceSetLine(edit) });
      expect(applied.isError, applied.content?.[0]?.text).toBeFalsy();
    });
    expect((await readDoc(EDIT_DOC)).content).toContain("\tSet tSC = 2");
  }, 120000);
});

describe("the governance CLI and the server agree on an inherited verdict (Story 38.4, AC-6)", () => {
  it("`iris-mcp-governance universe --json` and iris_server_profiles report the same policy and source for every key the server knows, parent included", async (testCtx) => {
    if (skipReason) return testCtx.skip();
    const governance = JSON.stringify({ global: { iris_doc_put: false } });

    const cli = spawnSync(process.execPath, [GOVERNANCE_CLI_BIN, "universe", "--json"], {
      encoding: "utf8",
      env: { ...inheritedEnv(), IRIS_GOVERNANCE: governance },
      maxBuffer: 16 * 1024 * 1024,
    });
    expect(cli.error).toBeUndefined();
    expect(cli.status, cli.stderr).toBe(0);
    const universe = JSON.parse(cli.stdout) as { policy: Record<string, boolean>; configSource: Record<string, string> };
    expect(universe.policy["iris_doc_edit:apply"]).toBe(false);
    expect(universe.configSource["iris_doc_edit:apply"]).toBe("parent");
    expect(universe.configSource["iris_doc_edit:regenerateStorage"]).toBe("parent");
    expect(universe.configSource["iris_doc_put"]).toBe("env");

    await withSession({ IRIS_GOVERNANCE: governance }, async (session) => {
      const served = await governanceReport(session);
      const keys = Object.keys(served.policy);
      expect(keys).toEqual(expect.arrayContaining(["iris_doc_edit:apply", "iris_doc_edit:regenerateStorage", "iris_doc_put"]));
      for (const key of keys) {
        expect(universe.policy[key], `CLI policy[${key}]`).toBe(served.policy[key]);
        expect(universe.configSource[key], `CLI configSource[${key}]`).toBe(served.configSource[key]);
      }
    });
  }, 60000);
});

// -- The override and the read-only preset ---------------------------

describe("regenerateStorage enabled and the read-only preset, on the wire (Story 38.4, AC-4, AC-6)", () => {
  it("iris_doc_edit:regenerateStorage: true lets the Storage-removing edit through, and the class still compiles", async (testCtx) => {
    if (skipReason) return testCtx.skip();
    const before = await freshStore();

    await withSession(
      { IRIS_GOVERNANCE: JSON.stringify({ global: { "iris_doc_edit:regenerateStorage": true } }) },
      async (session) => {
        const result = await session.call("iris_doc_edit", {
          action: "regenerateStorage",
          name: STORE_DOC,
          edits: deleteStorageEdit(before),
        });
        expect(result.isError, result.content?.[0]?.text).toBeFalsy();
        expect(result.structuredContent).toMatchObject({ changed: true, name: STORE_DOC });

        const { policy, configSource } = await governanceReport(session);
        expect(policy["iris_doc_edit:regenerateStorage"]).toBe(true);
        expect(configSource["iris_doc_edit:regenerateStorage"]).toBe("env");
        expect(configSource["iris_doc_edit:apply"]).toBe("default");
      },
    );

    const after = await readDoc(STORE_DOC);
    expect(storageRange(after.content), "the stored source has no Storage definition").toBeUndefined();
    expect(after.ts).not.toBe(before.ts);
    await docs().compileDoc(STORE_DOC);
  }, 120000);

  it("the read-only preset denies apply with presetApplied; with iris_doc_put disabled as well, the denial names the parent and carries no presetApplied", async (testCtx) => {
    if (skipReason) return testCtx.skip();
    const edit = await freshEdit();

    await withSession({ IRIS_GOVERNANCE_PRESET: "read-only" }, async (session) => {
      const applied = await session.call("iris_doc_edit", { action: "apply", name: EDIT_DOC, edits: replaceSetLine(edit) });
      expect(applied.isError).toBe(true);
      expect(applied.structuredContent).toEqual(governanceDenial("iris_doc_edit:apply", { presetApplied: "read-only" }));
    });

    await withSession(
      { IRIS_GOVERNANCE_PRESET: "read-only", IRIS_GOVERNANCE: JSON.stringify({ global: { iris_doc_put: false } }) },
      async (session) => {
        const applied = await session.call("iris_doc_edit", { action: "apply", name: EDIT_DOC, edits: replaceSetLine(edit) });
        expect(applied.isError).toBe(true);
        expect(applied.structuredContent).toEqual(governanceDenial("iris_doc_edit:apply", { inheritedFrom: "iris_doc_put" }));
      },
    );

    expect(await readDoc(EDIT_DOC)).toEqual(edit);
  }, 120000);
});
