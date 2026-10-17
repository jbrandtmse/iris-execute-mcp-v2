/**
 * Story 39.2 (QA) - the PHI data policy on the BUILT processes, where the in-process suites and the live gate stop
 * short (AC-1, AC-2, AC-3, AC-4, AC-5; AD-9, AD-15, AD-26; Rules #36, #54, #59).
 *
 * Part 1 spawns the BUILT iris-interop-mcp dist against a local HTTP listener that stands in for IRIS: it records
 * every request and answers the resend-preview route with a reply the test controls. No IRIS instance is contacted.
 * That makes three properties observable where they happen, which the other suites reach only through mocks (the
 * wire body) or through a well-behaved IRIS (the replies):
 *
 *  - the request the server really POSTs: `redact` and `block` send `bodyDetail:"kind"` and no cap, `allow` sends
 *    today's exact body (the live gate cannot tell: a handler that asked for `text` and then dropped `bodyText`
 *    leaves its results unchanged);
 *  - a hostile or version-skewed IRIS reply (the legacy shape captured from the real route before the change; a
 *    `kind` reply that still carries `bodySummary` and `bodyText`; unknown kind tokens; a non-boolean
 *    `bodyAvailable`) never carries body content into the result, the audit file or stderr under `redact` or `block`,
 *    while `allow` shows the same reply as the capture (the positive control: the sentinel is reachable);
 *  - the precedence of the four configuration channels, walked one layer at a time with a DIFFERENT value on every
 *    layer (so the value, not only the reported source, tells the layers apart), in mixed letter case, for a named
 *    profile, the default profile and a Server Manager profile.
 *
 * Part 2 runs `redactHl7` of the BUILT shared dist in a fresh Node process, resolved the way a consumer resolves it
 * (`@iris-mcp/shared` from the interop package), fed over stdin and read over stdout. The oracle is the reviewed
 * keep-list table of the spec (`hl7-keeplist-oracle.ts`), never the engine: every reviewed segment, unreviewed
 * sibling and Z-segment, in three separator sets, must come out exactly as prescribed, and the shipped keep-list must
 * equal the table.
 *
 * Expected values come from the Story 39.2 intent contract and the capture of the real route
 * (`fixtures/story-39-2-preview-baseline.json`), never from the implementation (Rule #36). Placement (Rule #45):
 * `@iris-mcp/all` is the only package that depends on every server's built dist. A missing or stale `shared` or
 * `iris-interop-mcp` dist, or an unresolvable SDK, skips each test with the reason, or fails when `IRIS_REQUIRE_LIVE`
 * is armed (listed in `scripts/prepublish-gate.mjs` `gateTestFiles`).
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  inheritedEnv,
  openWireSession,
  resolveSdkEsmDir,
  staleDistReason,
  type IrisTarget,
  type WireSession,
  type WireSessionOptions,
  type WireToolResult,
} from "./process-gate-helpers.js";
import {
  ALT_SEPARATORS,
  DEFAULT_SEPARATORS,
  PUNCTUATION_SEPARATORS,
  REVIEWED_BODY_SEGMENT_NAMES,
  SPEC_KEEP_TABLE,
  UNREVIEWED_SEGMENT_NAMES,
  buildSegment,
  joinSegments,
} from "../../../shared/src/__tests__/hl7-keeplist-oracle.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..", "..");
const INTEROP_ENTRY = path.join(REPO_ROOT, "packages", "iris-interop-mcp", "dist", "index.js");
const INTEROP_DIR = path.join(REPO_ROOT, "packages", "iris-interop-mcp");
const BASELINE_PATH = path.join(__dirname, "fixtures", "story-39-2-preview-baseline.json");

const REQUIRE_LIVE = process.env.IRIS_REQUIRE_LIVE === "1" || process.env.IRIS_REQUIRE_LIVE === "true";

/** A WARN or DEBUG line is not logged under LOG_LEVEL=ERROR, which a developer shell may set. */
const SERVER_LOG_LEVEL = "DEBUG";

/** The marker of every identifying value of the fixtures: it must reach no output of a governed call. */
const SENTINEL = "SYNTHPHI";

/** The namespace the calls name. The listener answers whatever it is asked, so no IRIS namespace is involved. */
const NS = "STORY392QA";

const PREVIEW_ROUTE = "/api/executemcp/v2/interop/message/resend/preview";

type Item = Record<string, unknown>;

// -- The matrix's expectations for fixture pi (spec I/O matrix; never read from the implementation) ------------

/** The body kind of each header 1..9 of fixture pi, and whether IRIS can open its body. */
const PI_KINDS = ["hl7v2", "hl7v2", "stream", "persistent", "streamContainer", "missing", "literal", "hl7v2", "hl7v2"];
const PI_AVAILABLE = [true, true, true, true, true, false, false, true, true];

const BLOCK_REASON = "The block data policy withholds every message body.";
const kindReason = (kind: string): string => `A ${kind} body cannot be redacted reliably, so the redact data policy withholds it.`;
const classNote = (className: string): string => `(non-stream body; class=${className})`;

/** What the policy must do to the body of fixture-pi header `index` (0-based). */
function expectedOutcome(policy: "redact" | "block", index: number): Item {
  const kind = PI_KINDS[index] as string;
  if (!PI_AVAILABLE[index]) return { outcome: "none" };
  if (policy === "block") return { outcome: "blocked", reason: BLOCK_REASON };
  if (kind === "hl7v2") return { outcome: "redacted", redactedFields: 0 };
  return { outcome: "blocked", reason: kindReason(kind) };
}

// -- The listener ----------------------------------------------------------------------------------------------

interface Recorded {
  method: string;
  url: string;
  body: string;
}

interface Stub {
  port: number;
  requests: Recorded[];
  /** While false every request is answered 503, which is how the server starts without an IRIS. */
  serving: boolean;
  /** The reply of the preview route, built from the parsed request. */
  reply: (request: Record<string, unknown>) => unknown;
  close: () => Promise<void>;
}

/** The preview POSTs the listener has recorded. */
const previewsOf = (stub: Stub): Recorded[] => stub.requests.filter((r) => r.method === "POST" && r.url === PREVIEW_ROUTE);

async function startStub(): Promise<Stub> {
  const stub: Stub = {
    port: 0,
    requests: [],
    serving: false,
    reply: () => ({}),
    close: () => Promise.resolve(),
  };
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      const body = Buffer.concat(chunks).toString("utf8");
      stub.requests.push({ method: req.method ?? "", url: req.url ?? "", body });
      if (stub.serving && req.method === "HEAD" && req.url === "/api/atelier/") {
        res.statusCode = 200;
        res.end();
        return;
      }
      if (stub.serving && req.method === "POST" && req.url === PREVIEW_ROUTE) {
        res.statusCode = 200;
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify(stub.reply(JSON.parse(body) as Record<string, unknown>)));
        return;
      }
      res.statusCode = 503;
      res.end();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  stub.port = (server.address() as AddressInfo).port;
  stub.close = () => new Promise<void>((resolve) => server.close(() => resolve()));
  return stub;
}

/** The answer of the real route to `headerIds:[1..9]` before this story: the legacy shape, `bodySummary` and no `bodyKind`. */
let legacyResult: { headers: Item[]; count: number };
/** The tool's output for that answer before this story. */
let toolCapture: { structuredContent: unknown; text: string };

const envelope = (result: unknown): unknown => ({ status: { errors: [], summary: "" }, console: [], result });

/** The legacy answer, as the old IRIS classes sent it (a version-skewed deployment). */
const legacyReply = (): unknown => envelope(legacyResult);

/** What IRIS sends in `kind` mode: kind and availability, no body content. */
function kindHeaders(): Item[] {
  return legacyResult.headers.map((header, index) => {
    const copy: Item = { ...header, bodyKind: PI_KINDS[index], bodyAvailable: PI_AVAILABLE[index] };
    delete copy.bodySummary;
    return copy;
  });
}

/** A `kind` reply that still carries body content, and a header that was not found with body fields too. */
function hostileKindReply(): unknown {
  const headers: Item[] = kindHeaders().map((header, index) => ({
    ...header,
    bodySummary: `${SENTINEL}-HOSTILE-SUMMARY-${index + 1}`,
    bodyText: `MSH|^~\\&|${SENTINEL}-HOSTILE-TEXT-${index + 1}\r`,
    bodyTextOmitted: "tooLarge",
  }));
  headers.push({ id: 999, found: false, error: "Header 999 not found", bodySummary: `${SENTINEL}-NOT-FOUND`, bodyKind: "hl7v2", bodyAvailable: true });
  return envelope({ headers, count: headers.length });
}

// -- Sessions --------------------------------------------------------------------------------------------------

let skipReason: string | undefined;
let sdkEsmDir: string | undefined;
let fixtureDir = "";
let stub: Stub;
const opened: WireSession[] = [];

function stubTarget(s: Stub): IrisTarget {
  return { host: "127.0.0.1", port: String(s.port), username: "story392-qa", password: "not-a-real-password", namespace: "HSCUSTOM" };
}

/**
 * A session on the built interop server pointed at the listener, with `extraEnv`. The listener refuses
 * everything while the server starts (the server starts without its default profile established) and serves
 * the preview route afterwards.
 */
async function session(extraEnv: Record<string, string> = {}, onStderr?: (chunk: string) => void): Promise<WireSession> {
  stub.serving = false;
  const options: WireSessionOptions = {
    sdkEsmDir: sdkEsmDir as string,
    entry: INTEROP_ENTRY,
    target: stubTarget(stub),
    clientName: "story-39-2-qa-process",
    ...(onStderr ? { onStderr } : {}),
  };
  const created = await openWireSession(options, { LOG_LEVEL: SERVER_LOG_LEVEL, ...extraEnv });
  opened.push(created);
  stub.serving = true;
  return created;
}

let fileCounter = 0;
function writeJson(name: string, document: unknown): string {
  fileCounter += 1;
  const file = path.join(fixtureDir, `${fileCounter}-${name}`);
  writeFileSync(file, JSON.stringify(document), "utf8");
  return file;
}

/** The text of every content block of a tool result, joined by newlines. */
const textOf = (result: { content?: Array<{ text?: string }> }): string => (result.content ?? []).map((b) => b.text ?? "").join("\n");

/** The preview of `headerIds` on the default profile, or on `profile`. */
function preview(s: WireSession, profile?: string, headerIds: number[] = [1, 2, 3, 4, 5, 6, 7, 8, 9]): Promise<WireToolResult> {
  const args = { action: "preview", headerIds, namespace: NS };
  return profile === undefined ? s.call("iris_message_resend", args) : s.callOn(profile, "iris_message_resend", args);
}

const itemsOf = (result: WireToolResult): Item[] => (result.structuredContent as { headers: Item[] }).headers;
const summaryOf = (result: WireToolResult): unknown => (result.structuredContent as { dataPolicy?: unknown }).dataPolicy;

beforeAll(async () => {
  skipReason = staleDistReason(REPO_ROOT, "shared") ?? staleDistReason(REPO_ROOT, "iris-interop-mcp");
  if (!skipReason) {
    sdkEsmDir = resolveSdkEsmDir(REPO_ROOT);
    if (!sdkEsmDir) {
      skipReason =
        "Could not resolve the @modelcontextprotocol/sdk ESM build under node_modules/.pnpm - run pnpm install from the repo root.";
    }
  }
  if (!skipReason && !existsSync(BASELINE_PATH)) skipReason = `The pre-change capture ${BASELINE_PATH} is missing.`;
  if (skipReason && REQUIRE_LIVE) {
    throw new Error(`IRIS_REQUIRE_LIVE is set, so the Story 39.2 QA process gate may not be skipped: ${skipReason}`);
  }
  if (skipReason) {
    // eslint-disable-next-line no-console
    console.log(`[SKIP] story-39-2-qa-process: ${skipReason}`);
    return;
  }
  fixtureDir = mkdtempSync(path.join(tmpdir(), "story-39-2-qa-"));
  const baseline = JSON.parse(readFileSync(BASELINE_PATH, "utf8")) as {
    rest: Array<{ text: string }>;
    tool: Array<{ structuredContent: unknown; text: string }>;
  };
  legacyResult = (JSON.parse((baseline.rest[0] as { text: string }).text) as { result: { headers: Item[]; count: number } }).result;
  toolCapture = baseline.tool[0] as { structuredContent: unknown; text: string };
  expect(legacyResult.headers, "the capture holds fixture pi").toHaveLength(9);
  expect(JSON.stringify(legacyResult), "the capture's stream summary is the sentinel's positive control").toContain(SENTINEL);
  stub = await startStub();
});

afterAll(async () => {
  for (const s of opened) await s.close();
  if (stub) await stub.close();
  if (fixtureDir) rmSync(fixtureDir, { recursive: true, force: true });
});

function skipIfNeeded(ctx: { skip: () => void }): boolean {
  if (!skipReason) return false;
  ctx.skip();
  return true;
}

// ---------------------------------------------------------------------------------------------------------------
// Part 1a: the request the built server really sends
// ---------------------------------------------------------------------------------------------------------------

describe("Story 39.2 QA: the request the built server POSTs to the preview route (AC-3, AC-4)", () => {
  const IDS = [1, 2, 3, 4, 5, 6, 7, 8, 9];

  it("redact (no setting) and block send bodyDetail:kind and no text cap; allow sends today's body, byte for byte", async (ctx) => {
    if (skipIfNeeded(ctx)) return;
    stub.reply = legacyReply;
    for (const [label, env] of [
      ["redact", {}],
      ["block", { IRIS_DATA_POLICY: "block" }],
      ["allow", { IRIS_DATA_POLICY: "allow" }],
    ] as Array<[string, Record<string, string>]>) {
      const s = await session(env);
      const before = previewsOf(stub).length;
      const result = await preview(s);
      expect(result.isError, `${label}: ${textOf(result)}`).toBeFalsy();
      const sent = previewsOf(stub).slice(before);
      expect(sent, `${label}: exactly one preview request`).toHaveLength(1);
      const raw = (sent[0] as Recorded).body;
      if (label === "allow") {
        expect(raw, "allow: today's request exactly, no new field").toBe(JSON.stringify({ headerIds: IDS, namespace: NS }));
      } else {
        expect(JSON.parse(raw), label).toEqual({ headerIds: IDS, namespace: NS, bodyDetail: "kind" });
        expect(raw, `${label}: no text cap and no text mode`).not.toMatch(/bodyTextMaxChars|"text"/);
      }
    }
  }, 60000);

  it("each profile sends the request of its own policy, over the same connection", async (ctx) => {
    if (skipIfNeeded(ctx)) return;
    stub.reply = legacyReply;
    const s = await session({ IRIS_PROFILES: JSON.stringify({ loose: { dataPolicy: "allow" }, strict: { dataPolicy: "BLOCK" } }) });
    for (const [profile, expected] of [
      ["loose", { headerIds: IDS, namespace: NS }],
      ["strict", { headerIds: IDS, namespace: NS, bodyDetail: "kind" }],
      [undefined, { headerIds: IDS, namespace: NS, bodyDetail: "kind" }],
    ] as Array<[string | undefined, Item]>) {
      const before = previewsOf(stub).length;
      const result = await preview(s, profile);
      expect(result.isError, `${String(profile)}: ${textOf(result)}`).toBeFalsy();
      const sent = previewsOf(stub).slice(before);
      expect(sent, String(profile)).toHaveLength(1);
      expect(JSON.parse((sent[0] as Recorded).body), String(profile)).toEqual(expected);
    }
  }, 60000);
});

// ---------------------------------------------------------------------------------------------------------------
// Part 1b: a reply the policy must not trust
// ---------------------------------------------------------------------------------------------------------------

describe("Story 39.2 QA: a hostile or version-skewed IRIS reply never carries body content through (AC-3, AC-4, AC-5)", () => {
  it("allow shows the legacy reply as the pre-change capture, which holds the sentinel (the positive control)", async (ctx) => {
    if (skipIfNeeded(ctx)) return;
    stub.reply = legacyReply;
    const s = await session({ IRIS_DATA_POLICY: "allow" });
    const result = await preview(s);
    expect(result.isError).toBeFalsy();
    expect({ structuredContent: result.structuredContent, text: textOf(result) }).toEqual({
      structuredContent: toolCapture.structuredContent,
      text: toolCapture.text,
    });
    expect(JSON.stringify(result), "the sentinel reaches the output when the policy allows it").toContain(SENTINEL);
  }, 60000);

  for (const policy of ["redact", "block"] as const) {
    describe(`under ${policy}`, () => {
      const env: Record<string, string> = policy === "block" ? { IRIS_DATA_POLICY: "block" } : {};

      it("the legacy reply (bodySummary, no bodyKind) is withheld entirely, each found item with the unknown-kind reason", async (ctx) => {
        if (skipIfNeeded(ctx)) return;
        stub.reply = legacyReply;
        const s = await session(env);
        const result = await preview(s);
        expect(result.isError).toBeFalsy();
        expect(JSON.stringify(result), "no identifying value in text or structured output").not.toContain(SENTINEL);
        for (const item of itemsOf(result)) {
          expect(item.bodySummary, `header ${String(item.id)}`).toBe("");
          expect(item.bodyKind, `header ${String(item.id)}`).toBe("other");
          expect(item.bodyPolicy, `header ${String(item.id)}`).toEqual({ outcome: "blocked", reason: kindReason("other") });
        }
        expect(summaryOf(result)).toEqual({ policy, redacted: 0, blocked: 9 });
      }, 60000);

      it("a kind reply that still carries bodySummary, bodyText and bodyTextOmitted is mapped by kind alone", async (ctx) => {
        if (skipIfNeeded(ctx)) return;
        stub.reply = hostileKindReply;
        const s = await session(env);
        const result = await preview(s);
        expect(result.isError).toBeFalsy();
        expect(JSON.stringify(result), "no identifying value in text or structured output").not.toContain(SENTINEL);
        const items = itemsOf(result);
        expect(items).toHaveLength(10);
        let redacted = 0;
        let blocked = 0;
        PI_KINDS.forEach((kind, index) => {
          const item = items[index] as Item;
          const expected = expectedOutcome(policy, index);
          expect(item.bodyKind, `header ${index + 1}`).toBe(kind);
          expect(item.bodyPolicy, `header ${index + 1}`).toEqual(expected);
          const note = expected.outcome === "redacted" ? classNote("EnsLib.HL7.Message") : "";
          expect(item.bodySummary, `header ${index + 1}`).toBe(note);
          for (const key of ["bodyText", "bodyTextOmitted", "bodyAvailable"]) expect(key in item, `header ${index + 1} ${key}`).toBe(false);
          if (expected.outcome === "redacted") redacted += 1;
          if (expected.outcome === "blocked") blocked += 1;
        });
        expect(summaryOf(result)).toEqual({ policy, redacted, blocked });
        expect(blocked + redacted, "the policy touched some bodies (a vacuous sweep would pass)").toBeGreaterThan(0);
        const notFound = items[9] as Item;
        expect(notFound.found).toBe(false);
        for (const key of ["bodySummary", "bodyText", "bodyKind", "bodyPolicy", "bodyAvailable"]) {
          expect(key in notFound, `a header that was not found carries no ${key}`).toBe(false);
        }
      }, 60000);

      it("a kind token outside the nine, in any form, is withheld as other; a non-boolean bodyAvailable hides the body", async (ctx) => {
        if (skipIfNeeded(ctx)) return;
        const tokens: unknown[] = ["hl7v3", "HL7V2", "", "hl7v2 ", null, 5, ["hl7v2"], { kind: "hl7v2" }, "constructor"];
        stub.reply = () => {
          const headers = kindHeaders().map((header, index) => {
            const mutated: Item = { ...header, bodyAvailable: true, bodySummary: `${SENTINEL}-TOKEN-${index + 1}` };
            mutated.bodyKind = tokens[index];
            return mutated;
          });
          return envelope({ headers, count: headers.length });
        };
        const s = await session(env);
        const unknown = await preview(s);
        expect(JSON.stringify(unknown)).not.toContain(SENTINEL);
        for (const item of itemsOf(unknown)) {
          expect(item.bodyKind, `header ${String(item.id)}`).toBe("other");
          expect(item.bodyPolicy, `header ${String(item.id)}`).toEqual({ outcome: "blocked", reason: kindReason("other") });
        }

        const flags: unknown[] = ["true", 1, "yes", null, [], {}, "false", 0, "TRUE"];
        stub.reply = () => {
          const headers = kindHeaders().map((header, index) => ({ ...header, bodyKind: "hl7v2", bodyAvailable: flags[index], bodySummary: `${SENTINEL}-FLAG-${index + 1}` }));
          return envelope({ headers, count: headers.length });
        };
        const flagged = await preview(s);
        expect(JSON.stringify(flagged)).not.toContain(SENTINEL);
        for (const item of itemsOf(flagged)) {
          expect(item.bodyPolicy, `header ${String(item.id)}`).toEqual({ outcome: "none" });
          expect(item.bodySummary, `header ${String(item.id)}`).toBe("");
        }
        expect(summaryOf(flagged)).toEqual({ policy, redacted: 0, blocked: 0 });
      }, 60000);
    });
  }
});

describe("Story 39.2 QA: neither the audit file nor the console log holds body content, whatever the reply (AC-5, AD-19)", () => {
  it("under each policy, with a hostile reply, at DEBUG, the entry carries the policy and the counts and nothing identifying", async (ctx) => {
    if (skipIfNeeded(ctx)) return;
    stub.reply = hostileKindReply;
    const cases: Array<{ label: string; env: Record<string, string>; expected: Item }> = [
      { label: "redact", env: {}, expected: { policy: "redact", redacted: 4, blocked: 3 } },
      { label: "block", env: { IRIS_DATA_POLICY: "block" }, expected: { policy: "block", redacted: 0, blocked: 7 } },
      // Allow shows the reply as it is; the entry records the policy and no counts, and still holds no body content.
      { label: "allow", env: { IRIS_DATA_POLICY: "allow" }, expected: { policy: "allow", redacted: 0, blocked: 0 } },
    ];
    for (const row of cases) {
      const file = path.join(fixtureDir, `audit-${row.label}.jsonl`);
      let stderr = "";
      const s = await session(
        { IRIS_AUDIT_LOG: file, IRIS_AUDIT_LOG_PARAMS: "true", ...row.env },
        (chunk) => {
          stderr += chunk;
        },
      );
      const result = await preview(s);
      expect(result.isError, row.label).toBeFalsy();
      if (row.label === "allow") expect(JSON.stringify(result), "the allow session's output holds the sentinel").toContain(SENTINEL);

      const started = Date.now();
      let entries: Item[] = [];
      while (Date.now() - started < 5000) {
        if (existsSync(file)) {
          entries = readFileSync(file, "utf8").split("\n").filter((line) => line.trim() !== "").map((line) => JSON.parse(line) as Item);
          if (entries.some((entry) => entry.tool === "iris_message_resend")) break;
        }
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      const entry = entries.find((candidate) => candidate.tool === "iris_message_resend");
      expect(entry, row.label).toMatchObject({ tool: "iris_message_resend", action: "preview", outcome: "ok", dataPolicy: row.expected });
      expect(readFileSync(file, "utf8"), `${row.label}: the audit file`).not.toContain(SENTINEL);
      expect(stderr.length, `${row.label}: the server logged at DEBUG`).toBeGreaterThan(0);
      expect(stderr, `${row.label}: the server's stderr`).not.toContain(SENTINEL);
    }
  }, 120000);
});

// ---------------------------------------------------------------------------------------------------------------
// Part 1c: the precedence of the channels on the built process
// ---------------------------------------------------------------------------------------------------------------

describe("Story 39.2 QA: the four channels in precedence order on the built process (AC-1; AD-9)", () => {
  interface Entry {
    name: string;
    dataPolicy: string;
    dataPolicySource: string;
  }

  /** The roster `iris_server_profiles` reports for the server started with `extraEnv`, by profile name. */
  async function roster(extraEnv: Record<string, string>): Promise<Record<string, Entry>> {
    const s = await session(extraEnv);
    const result = await s.raw("iris_server_profiles", {});
    expect(result.isError, "iris_server_profiles").toBeFalsy();
    const profiles = (result.structuredContent as { profiles: Entry[] }).profiles;
    return Object.fromEntries(profiles.map((entry) => [entry.name, entry]));
  }

  it("walks p and default down the layers, one layer at a time, each layer holding a different value in a different letter case", async (ctx) => {
    if (skipIfNeeded(ctx)) return;
    // Layer values differ between neighbours, so a swap of two layers changes the policy, not only its source.
    const file = (profiles: Record<string, string> | undefined, global: string | undefined): string =>
      writeJson("governance.json", { dataPolicy: { ...(profiles ? { profiles } : {}), ...(global ? { global } : {}) } });

    const all = await roster({
      IRIS_PROFILES: JSON.stringify({ p: { dataPolicy: "Allow" } }),
      IRIS_DATA_POLICY: "BLOCK",
      IRIS_GOVERNANCE_FILE: file({ p: "ReDact" }, "ALLOW"),
    });
    expect(all.p).toMatchObject({ dataPolicy: "allow", dataPolicySource: "IRIS_PROFILES" });
    expect(all.default).toMatchObject({ dataPolicy: "block", dataPolicySource: "IRIS_DATA_POLICY" });

    const noProfilesEntry = await roster({
      IRIS_PROFILES: JSON.stringify({ p: {} }),
      IRIS_DATA_POLICY: "BLOCK",
      IRIS_GOVERNANCE_FILE: file({ p: "ReDact" }, "ALLOW"),
    });
    expect(noProfilesEntry.p).toMatchObject({ dataPolicy: "block", dataPolicySource: "IRIS_DATA_POLICY" });

    const fileOnly = await roster({
      IRIS_PROFILES: JSON.stringify({ p: {} }),
      IRIS_GOVERNANCE_FILE: file({ p: "ReDact" }, "ALLOW"),
    });
    expect(fileOnly.p).toMatchObject({ dataPolicy: "redact", dataPolicySource: "IRIS_GOVERNANCE_FILE:profiles" });
    expect(fileOnly.default).toMatchObject({ dataPolicy: "allow", dataPolicySource: "IRIS_GOVERNANCE_FILE:global" });

    const globalOnly = await roster({
      IRIS_PROFILES: JSON.stringify({ p: {} }),
      IRIS_GOVERNANCE_FILE: file({ other: "block" }, "ALLOW"),
    });
    expect(globalOnly.p).toMatchObject({ dataPolicy: "allow", dataPolicySource: "IRIS_GOVERNANCE_FILE:global" });

    const nothing = await roster({
      IRIS_PROFILES: JSON.stringify({ p: {} }),
      IRIS_GOVERNANCE_FILE: file({ other: "block" }, undefined),
    });
    expect(nothing.p).toMatchObject({ dataPolicy: "redact", dataPolicySource: "default" });
    expect(nothing.default).toMatchObject({ dataPolicy: "redact", dataPolicySource: "default" });
  }, 120000);

  it("a Server Manager profile follows the same order without an IRIS_PROFILES entry", async (ctx) => {
    if (skipIfNeeded(ctx)) return;
    const settings = writeJson("settings.json", {
      "intersystems.servers": {
        sm: { webServer: { scheme: "http", host: "127.0.0.1", port: stub.port }, username: "smuser", password: "smpw" },
      },
    });
    const sm = { IRIS_SERVER_MANAGER: "auto", IRIS_SM_SETTINGS_PATHS: settings };
    const governance = (profiles: Record<string, string> | undefined, global?: string): string =>
      writeJson("governance.json", { dataPolicy: { ...(profiles ? { profiles } : {}), ...(global ? { global } : {}) } });

    expect((await roster({ ...sm })).sm).toMatchObject({ dataPolicy: "redact", dataPolicySource: "default" });
    expect((await roster({ ...sm, IRIS_GOVERNANCE_FILE: governance({ sm: "BLOCK" }, "allow") })).sm).toMatchObject({
      dataPolicy: "block",
      dataPolicySource: "IRIS_GOVERNANCE_FILE:profiles",
    });
    expect((await roster({ ...sm, IRIS_GOVERNANCE_FILE: governance({ other: "block" }, "allow") })).sm).toMatchObject({
      dataPolicy: "allow",
      dataPolicySource: "IRIS_GOVERNANCE_FILE:global",
    });
    expect((await roster({ ...sm, IRIS_DATA_POLICY: "Allow", IRIS_GOVERNANCE_FILE: governance({ sm: "block" }) })).sm).toMatchObject({
      dataPolicy: "allow",
      dataPolicySource: "IRIS_DATA_POLICY",
    });
  }, 120000);

  it("the Server Manager profile's calls follow the policy the file gave it, and the default profile's follow its own", async (ctx) => {
    if (skipIfNeeded(ctx)) return;
    stub.reply = legacyReply;
    const settings = writeJson("settings.json", {
      "intersystems.servers": {
        sm: { webServer: { scheme: "http", host: "127.0.0.1", port: stub.port }, username: "smuser", password: "smpw" },
      },
    });
    const governanceFile = writeJson("governance.json", { dataPolicy: { profiles: { sm: "block" } } });
    const s = await session({ IRIS_SERVER_MANAGER: "auto", IRIS_SM_SETTINGS_PATHS: settings, IRIS_GOVERNANCE_FILE: governanceFile });

    const before = previewsOf(stub).length;
    const blocked = await preview(s, "sm");
    expect(blocked.isError, textOf(blocked)).toBeFalsy();
    expect(JSON.parse((previewsOf(stub).slice(before)[0] as Recorded).body)).toEqual({
      headerIds: [1, 2, 3, 4, 5, 6, 7, 8, 9],
      namespace: NS,
      bodyDetail: "kind",
    });
    expect(summaryOf(blocked)).toEqual({ policy: "block", redacted: 0, blocked: 9 });

    const redacted = await preview(s);
    expect(summaryOf(redacted), "the default profile took no value from the sm profile's entry").toEqual({
      policy: "redact",
      redacted: 0,
      blocked: 9,
    });
  }, 60000);
});

// ---------------------------------------------------------------------------------------------------------------
// Part 2: redactHl7 of the built shared dist, in a fresh Node process
// ---------------------------------------------------------------------------------------------------------------

/** What the child prints: a result for each case and the keep-list the dist ships. */
interface ChildOutput {
  results: Array<{ ok: boolean; text?: string; redactedFields?: number; reason?: string }>;
  keep: Record<string, number[]>;
}

/** The child's program: read a JSON array of texts from stdin, redact each with the dist, print JSON. */
const CHILD_SCRIPT = [
  "const { redactHl7, HL7_KEEP_FIELDS } = await import('@iris-mcp/shared');",
  "let input = '';",
  "process.stdin.setEncoding('utf8');",
  "for await (const chunk of process.stdin) input += chunk;",
  "const texts = JSON.parse(input);",
  "process.stdout.write(JSON.stringify({ results: texts.map((text) => redactHl7(text)), keep: HL7_KEEP_FIELDS }));",
].join("\n");

/** Run the child with `texts` on stdin. `cwd` is the interop package, so `@iris-mcp/shared` resolves as it does for a consumer. */
function redactInChild(texts: string[]): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--input-type=module", "-e", CHILD_SCRIPT], {
      cwd: INTEROP_DIR,
      env: inheritedEnv(),
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("the child did not finish in 60 s"));
    }, 60000);
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
    child.stdin.end(JSON.stringify(texts));
  });
}

describe("Story 39.2 QA: redactHl7 of the built shared dist, in a fresh process, against the reviewed table (AC-2)", () => {
  interface Case {
    name: string;
    input: string;
    expected: string;
    redactedFields: number;
  }

  const cases: Case[] = [];
  for (const seps of [DEFAULT_SEPARATORS, ALT_SEPARATORS, PUNCTUATION_SEPARATORS]) {
    const header = buildSegment("MSH", 12, seps);
    const label = `${seps.field}${seps.component}${seps.repetition}${seps.escape}${seps.subcomponent}`;
    for (const name of ["FTS", "BTS", ...REVIEWED_BODY_SEGMENT_NAMES, ...UNREVIEWED_SEGMENT_NAMES]) {
      const message = joinSegments([header, buildSegment(name, 70, seps)], ["\r", "\r"]);
      cases.push({ name: `${name} behind a header, separators ${label}`, ...message });
    }
    for (const name of ["MSH", "FHS", "BHS"]) {
      const message = joinSegments([buildSegment(name, 70, seps)], ["\r"]);
      cases.push({ name: `${name} first, separators ${label}`, ...message });
    }
  }
  const whole = joinSegments(
    [
      buildSegment("FHS", 14),
      buildSegment("BHS", 14),
      buildSegment("MSH", 20, DEFAULT_SEPARATORS, { empty: [4, 5] }),
      ...[...REVIEWED_BODY_SEGMENT_NAMES, ...UNREVIEWED_SEGMENT_NAMES].map((name) => buildSegment(name, 45)),
      buildSegment("BTS", 3),
      buildSegment("FTS", 3),
    ],
    ["\r\n", "\n", "\r", ...[...REVIEWED_BODY_SEGMENT_NAMES, ...UNREVIEWED_SEGMENT_NAMES].map(() => "\r"), "\n", ""],
  );
  cases.push({ name: "a batch with every segment, mixed terminators, no final terminator", ...whole });

  /** Texts that are not messages: each must be refused with a fixed reason, never passed through. */
  const header = `${buildSegment("MSH", 6).input}\r`;
  const refusals: Array<{ name: string; text: string }> = [
    { name: "a byte order mark before the MSH", text: `\uFEFF${header}` },
    { name: "MLLP framing before the MSH", text: `\x0b${header}\x1c\r` },
    { name: "a lower-case segment name", text: `${header}pid|1||${SENTINEL}-MRN\r` },
    { name: "a stray one-character line", text: `${header}NTE|1||${SENTINEL}-a\nS\r` },
    { name: "a stray two-character line", text: `${header}NTE|1||${SENTINEL}-a\nSY\r` },
    { name: "a stray four-character line", text: `${header}NTE|1||${SENTINEL}-a\nSYNT\r` },
    { name: "a stray line of free text", text: `${header}NTE|1||${SENTINEL}-a\nSmith, John Q.\r` },
    { name: "a segment name not followed by the field separator", text: `${header}PID 1||${SENTINEL}-MRN\r` },
    { name: "repeating separators", text: `MSH|^^\\&|${SENTINEL}-APP\r` },
    { name: "an alphanumeric separator", text: `MSH|A~\\&|${SENTINEL}-APP\r` },
  ];

  const FIXED_REASONS = [
    "The text does not start with an MSH, FHS or BHS segment.",
    "The field or encoding separators are not usable for redaction.",
    "A segment name is not three capital letters or digits followed by the field separator.",
    "The text could not be processed.",
  ];

  let output: ChildOutput | undefined;
  let childRun: { code: number | null; stderr: string } | undefined;

  beforeAll(async () => {
    if (skipReason) return;
    const run = await redactInChild([...cases.map((c) => c.input), ...refusals.map((r) => r.text)]);
    childRun = { code: run.code, stderr: run.stderr };
    if (run.code === 0) output = JSON.parse(run.stdout) as ChildOutput;
  }, 90000);

  it("the child resolves @iris-mcp/shared as a consumer does, runs cleanly and prints one result per text", (ctx) => {
    if (skipIfNeeded(ctx)) return;
    expect(childRun?.stderr).toBe("");
    expect(childRun?.code).toBe(0);
    expect(output?.results).toHaveLength(cases.length + refusals.length);
    expect(cases.length, "the sweep has cases (an empty sweep would pass)").toBeGreaterThan(100);
  });

  it("the shipped keep-list equals the reviewed table, segment for segment", (ctx) => {
    if (skipIfNeeded(ctx)) return;
    const shipped = output?.keep ?? {};
    expect(Object.keys(shipped).sort()).toEqual(Object.keys(SPEC_KEEP_TABLE).sort());
    for (const [name, fields] of Object.entries(SPEC_KEEP_TABLE)) {
      expect([...(shipped[name] ?? [])].sort((a, b) => a - b), name).toEqual([...fields]);
    }
  });

  it("every reviewed, unreviewed and Z segment comes out exactly as the table prescribes, with no identifying value", (ctx) => {
    if (skipIfNeeded(ctx)) return;
    const results = output?.results ?? [];
    cases.forEach((c, index) => {
      const result = results[index] as ChildOutput["results"][number];
      expect(result.ok, c.name).toBe(true);
      expect(result.text, c.name).toBe(c.expected);
      expect(result.redactedFields, c.name).toBe(c.redactedFields);
      expect(result.text, c.name).not.toContain(SENTINEL);
    });
  });

  it("a text that is not a message is refused with a fixed reason that holds no input, never passed through", (ctx) => {
    if (skipIfNeeded(ctx)) return;
    const results = output?.results ?? [];
    refusals.forEach((r, index) => {
      const result = results[cases.length + index] as ChildOutput["results"][number];
      expect(result.ok, r.name).toBe(false);
      expect(FIXED_REASONS, r.name).toContain(result.reason);
      expect(JSON.stringify(result), r.name).not.toContain(SENTINEL);
      expect("text" in result, `${r.name}: a refusal returns no text`).toBe(false);
    });
  });
});
