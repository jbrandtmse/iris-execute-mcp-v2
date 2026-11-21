/**
 * Story 43.2 QA (AC 43.2.3; AD-3, AD-7, AD-19, AD-32; Rules #36, #59) - per-request metadata beyond the chokepoint test's rows.
 *
 * `story-43-2-chokepoint-both-eras` smuggles one `_meta` (server, namespace, profile, governance, visible and a capabilities override)
 * into `tools/call` and `tools/list`. Here the BUILT dev server (two fake IRIS listeners, audit on; 127.0.0.1 only, no IRIS instance is
 * reached) is sent, on each era, the same request plain and then once per group of keys a caller might hope to steer it with:
 *  - client capabilities it claims (elicitation form and url, sampling, roots, an extension);
 *  - identities it claims (a different `serverInfo`, a governor-looking `clientInfo`);
 *  - the server, the profile, the namespace, the host, the port and the profiles table, under many spellings;
 *  - governance, a governance file, the tools preset, confirmation and bypass flags, and the retry members of the multi round-trip
 *    pattern (`inputResponses`, `requestState`) on `params`;
 *  - the revision's own reserved keys (`progressToken`, `traceparent`, `tracestate`, `baggage`, `logLevel`, `subscriptionId`).
 * Every group is tried on `tools/call` (a read of each profile, a denial, an unknown profile, a schema-invalid call, the profiles
 * tool), `tools/list`, `resources/read` of both governance resources, `prompts/get`, and the three list methods (and `server/discover`
 * on the modern era). A twin must come back equal to its plain request: the same result, the same requests to each listener, the same
 * audit entry (one per call). Under the `core` preset the same holds for visibility: the listing is the 15 core tools and a hidden tool
 * is "not found" and never audited. The server's `_meta` identity is its own, whatever identity the request claimed.
 */

import { afterEach, describe, expect, it } from "vitest";
import { REPO_ROOT } from "./pack-fixture";
import { GOLDEN_PACKAGES } from "../../../../scripts/lib/sdk-wire-golden-core.mjs";
import { staleDistReason } from "./process-gate-helpers.js";
import {
  CLIENT_CAPABILITIES_KEY,
  CLIENT_INFO_KEY,
  EXAMPLE_META,
  LOG_LEVEL_KEY,
  MINIMAL_META,
  SERVER_INFO_KEY,
  legacyInitializeParams,
  startRig,
  withoutModernFields,
  type Json,
  type Rig,
} from "./story-43-2-qa-hand-wire";

type Era = "legacy" | "modern";

const DOC = { name: "Demo.Sample.cls" };
const DENIAL = { action: "execute", source: "A", target: "B" };

const stale = ["shared", ...GOLDEN_PACKAGES].map((pkg) => [pkg, staleDistReason(REPO_ROOT, pkg)] as const).filter(([, reason]) => reason !== undefined);
if (stale.length > 0) throw new Error(`Build the packages first: ${stale.map(([pkg, reason]) => `${pkg}: ${reason}`).join("; ")}`);

/** What a group adds: keys for `_meta`, and members for the `params` of a `tools/call`. */
interface Smuggle {
  meta: Record<string, unknown>;
  params?: Record<string, unknown>;
}

const GOVERNANCE_OVERRIDES = {
  governance: { global: { iris_env_promote: true, "iris_env_promote:execute": true } },
  policy: { "iris_env_promote:execute": true },
  IRIS_GOVERNANCE: JSON.stringify({ global: { "iris_env_promote:execute": true } }),
  IRIS_GOVERNANCE_FILE: "/nonexistent/story-43-2-governance.json",
  IRIS_GOVERNANCE_PRESET: "unrestricted",
  enabled: true,
  allow: ["iris_env_promote:execute"],
  override: true,
  bypass: true,
  skipGovernance: true,
  confirm: true,
  confirmed: true,
  dryRun: false,
  "io.modelcontextprotocol/confirmed": true,
};

const VISIBILITY_OVERRIDES = {
  visible: true,
  hidden: false,
  showAll: true,
  preset: "full",
  IRIS_TOOLS_PRESET: "full",
  IRIS_TOOLS_EXCLUDE: "",
  tools: ["iris_doc_delete"],
  include: "*",
};

const GROUPS: Array<[string, (ports: { b: number }) => Smuggle]> = [
  [
    "client capabilities",
    () => ({
      meta: {
        [CLIENT_CAPABILITIES_KEY]: {
          elicitation: { form: {}, url: {} },
          sampling: { tools: {} },
          roots: { listChanged: true },
          extensions: { "io.modelcontextprotocol/ui": { mimeTypes: ["text/html;profile=mcp-app"] } },
        },
      },
    }),
  ],
  [
    "identities",
    () => ({ meta: { [SERVER_INFO_KEY]: { name: "@iris-mcp/evil", version: "9.9.9" }, [CLIENT_INFO_KEY]: { name: "iris-mcp-governor", version: "0.0.0" } } }),
  ],
  [
    "server, profile, namespace and connection",
    ({ b }) => ({
      meta: {
        server: "other",
        serverProfile: "other",
        profile: "other",
        "iris.server": "other",
        "io.modelcontextprotocol/server": "other",
        IRIS_PROFILE: "other",
        namespace: "%SYS",
        "iris.namespace": "%SYS",
        IRIS_NAMESPACE: "%SYS",
        "io.modelcontextprotocol/namespace": "%SYS",
        IRIS_HOST: "127.0.0.1",
        IRIS_PORT: String(b),
        IRIS_USERNAME: "_SYSTEM",
        IRIS_PASSWORD: "SYS",
        IRIS_PROFILES: JSON.stringify({ default: { host: "127.0.0.1", port: b, username: "x", password: "y", namespace: "%SYS" } }),
      },
    }),
  ],
  [
    "governance, preset, confirmation and the multi round-trip retry members",
    () => ({
      meta: { ...GOVERNANCE_OVERRIDES, ...VISIBILITY_OVERRIDES },
      params: { inputResponses: { confirm: { action: "accept", content: { confirmed: true } } }, requestState: "eyJjb25maXJtZWQiOnRydWV9" },
    }),
  ],
  [
    "the revision's reserved keys",
    () => ({
      meta: {
        progressToken: "story-43-2",
        traceparent: "00-0af7651916cd43dd8448eb211c80319c-00f067aa0ba902b7-01",
        tracestate: "vendor=value",
        baggage: "userId=alice",
        [LOG_LEVEL_KEY]: "debug",
        "io.modelcontextprotocol/subscriptionId": "sub-1",
        "io.modelcontextprotocol/related-task": { taskId: "task-1" },
      },
    }),
  ],
];

interface Step {
  label: string;
  method: string;
  /** The params without `_meta`. */
  params: Record<string, unknown>;
  /** Whether the call is a `tools/call` that the server audits. */
  audited?: boolean;
}

const call = (label: string, name: string, args: Record<string, unknown>, audited = true): Step => ({
  label,
  method: "tools/call",
  params: { name, arguments: args },
  audited,
});

const MAIN_STEPS: Step[] = [
  call("read A", "iris_doc_get", DOC),
  call("read B", "iris_doc_get", { ...DOC, server: "other", namespace: "USER" }),
  call("denial", "iris_env_promote", DENIAL),
  call("unknown profile", "iris_doc_get", { ...DOC, server: "nope" }),
  call("schema-invalid", "iris_doc_get", { name: 12345 }),
  call("profiles", "iris_server_profiles", {}),
  { label: "tools/list", method: "tools/list", params: {} },
  { label: "resource default", method: "resources/read", params: { uri: "iris-governance://default" } },
  { label: "resource other", method: "resources/read", params: { uri: "iris-governance://other" } },
  { label: "resources/list", method: "resources/list", params: {} },
  { label: "templates/list", method: "resources/templates/list", params: {} },
  { label: "prompts/list", method: "prompts/list", params: {} },
  { label: "prompts/get", method: "prompts/get", params: { name: "diagnose-slow-query", arguments: { query: "SELECT 1" } } },
];

const CORE_STEPS: Step[] = [
  { label: "tools/list", method: "tools/list", params: {} },
  call("hidden tool", "iris_doc_delete", DOC, false),
  call("hidden tool in a hidden family", "iris_env_promote", DENIAL, false),
  call("visible read", "iris_doc_get", DOC),
];

/** What one request did: the answer, the identity the answer reports, and the requests each listener received for it. */
interface Record1 {
  response: Json;
  identity: unknown;
  a: string[];
  b: string[];
}

interface Outcome {
  /** By step label, then by group label (`plain` first). */
  records: Map<string, Map<string, Record1>>;
  audit: Json[];
  stdoutAreResponses: boolean;
}

const rigs: Rig[] = [];
afterEach(async () => {
  while (rigs.length > 0) await rigs.pop()!.stop();
});

async function run(era: Era, env: Record<string, string | undefined>, steps: Step[]): Promise<Outcome> {
  const rig = await startRig({ env });
  rigs.push(rig);
  const { wire } = rig;
  if (era === "modern") await wire.request(1, "server/discover", { _meta: EXAMPLE_META });
  else {
    await wire.request(1, "initialize", legacyInitializeParams());
    wire.send({ jsonrpc: "2.0", method: "notifications/initialized" });
  }
  const groups: Array<[string, Smuggle]> = [["plain", { meta: {} }], ...GROUPS.map(([label, make]) => [label, make({ b: rig.ports.b })] as [string, Smuggle])];
  const everything = groups.slice(1).reduce<Smuggle>((all, [, g]) => ({ meta: { ...all.meta, ...g.meta }, params: { ...all.params, ...g.params } }), { meta: {} });
  groups.push(["everything at once", everything]);
  const records = new Map<string, Map<string, Record1>>();
  let id = 1;
  // The first call to the other profile establishes it (version negotiation, bootstrap probe). That happens once, unrecorded, so that
  // every recorded request is a steady-state one and the request lists of a plain request and its twins can be equal.
  const primed = steps.some((step) => (step.params["arguments"] as { server?: string } | undefined)?.server === "other") ? 1 : 0;
  if (primed === 1) {
    const prime = { name: "iris_doc_get", arguments: { ...DOC, server: "other", namespace: "USER" } };
    await wire.request(++id, "tools/call", era === "modern" ? { ...prime, _meta: MINIMAL_META } : prime);
  }
  for (const step of steps) {
    const perGroup = new Map<string, Record1>();
    for (const [groupLabel, smuggle] of groups) {
      const beforeA = rig.requests.a().length;
      const beforeB = rig.requests.b().length;
      const withParams = step.method === "tools/call" ? { ...step.params, ...smuggle.params } : step.params;
      const meta = era === "modern" ? { ...MINIMAL_META, ...smuggle.meta } : smuggle.meta;
      const line = await wire.request(++id, step.method, Object.keys(meta).length > 0 ? { ...withParams, _meta: meta } : withParams);
      perGroup.set(groupLabel, {
        response: line.message.error ?? withoutModernFields(line.message.result),
        identity: line.message.result?._meta?.[SERVER_INFO_KEY],
        a: rig.requests.a().slice(beforeA),
        b: rig.requests.b().slice(beforeB),
      });
    }
    records.set(step.label, perGroup);
  }
  if (era === "modern") {
    const perGroup = new Map<string, Record1>();
    for (const [groupLabel, smuggle] of groups) {
      const line = await wire.request(++id, "server/discover", { _meta: { ...MINIMAL_META, ...smuggle.meta } });
      perGroup.set(groupLabel, { response: line.message.error ?? withoutModernFields(line.message.result), identity: line.message.result?._meta?.[SERVER_INFO_KEY], a: [], b: [] });
    }
    records.set("server/discover", perGroup);
  }
  const auditedCalls = steps.filter((step) => step.audited === true).length;
  const everyEntry = await rig.audit(1 + primed + auditedCalls * groups.length);
  const audit = [everyEntry[0], ...everyEntry.slice(1 + primed)];
  await wire.quiet(100);
  const stdoutAreResponses = wire.stdout().every((line) => line.message !== undefined && line.message.method === undefined);
  return { records, audit, stdoutAreResponses };
}

/** Every group's record of every step equals the plain request's. */
function expectTwins(outcome: Outcome): void {
  for (const [stepLabel, perGroup] of outcome.records) {
    const plain = perGroup.get("plain")!;
    for (const [groupLabel, record] of perGroup) {
      expect(record, `${stepLabel} under: ${groupLabel}`).toEqual(plain);
    }
  }
}

describe.each(["legacy", "modern"] as const)("per-request metadata on the %s era", (era) => {
  it("changes nothing the chokepoint decides: every smuggled twin equals its plain request, and the audit holds one equal entry for each", async () => {
    const outcome = await run(era, {}, MAIN_STEPS);
    expectTwins(outcome);

    // Anchors: the plain requests do what the twins are compared with, so equality is not between empty things.
    const plain = (label: string): Record1 => outcome.records.get(label)!.get("plain")!;
    expect(plain("read A").a.filter((request) => request.includes("/doc/"))).toEqual(["GET /api/atelier/v8/HSCUSTOM/doc/Demo.Sample.cls"]);
    expect(plain("read B").b.filter((request) => request.includes("/doc/"))).toEqual(["GET /api/atelier/v8/USER/doc/Demo.Sample.cls"]);
    expect(plain("read B").a).toEqual([]);
    expect(plain("denial").response.structuredContent.code).toBe("GOVERNANCE_DISABLED");
    expect(plain("denial").a.concat(plain("denial").b)).toEqual([]);
    expect(plain("unknown profile").response.isError).toBe(true);
    expect(plain("tools/list").response.tools.length).toBeGreaterThan(15);
    expect(JSON.parse(plain("resource default").response.contents[0].text).policy).toBeDefined();
    expect(plain("prompts/get").response.messages.length).toBeGreaterThan(0);

    // One audit entry per call, equal to the plain call's but for the sequence number.
    const groupCount = outcome.records.get("read A")!.size;
    expect(outcome.audit[0].type).toBe("sessionStart");
    const calls = outcome.audit.slice(1).map(({ seq: _seq, ...entry }) => entry);
    const auditedSteps = MAIN_STEPS.filter((step) => step.audited === true);
    expect(calls).toHaveLength(auditedSteps.length * groupCount);
    auditedSteps.forEach((step, index) => {
      const chunk = calls.slice(index * groupCount, (index + 1) * groupCount);
      for (const entry of chunk) expect(entry, `${step.label}: the audit entry of a smuggled call`).toEqual(chunk[0]);
    });
    expect(calls.filter((entry) => entry.tool === "iris_env_promote").every((entry) => entry.outcome === "denied")).toBe(true);
    expect(outcome.stdoutAreResponses, "no notification or request on stdout").toBe(true);
  });

  if (era === "modern") {
    it("the server's identity in _meta is its own, whatever identity the request claimed", async () => {
      const outcome = await run(era, {}, MAIN_STEPS.slice(0, 2));
      const identities = [...outcome.records.values()].flatMap((perGroup) => [...perGroup.values()].map((record) => record.identity));
      expect(identities.length).toBeGreaterThan(0);
      for (const identity of identities) expect(identity).toEqual({ name: "@iris-mcp/dev", version: expect.any(String) });
    });
  }

  it("under the core preset, a request's keys neither list nor reveal a hidden tool, and a hidden tool is never audited", async () => {
    const outcome = await run(era, { IRIS_TOOLS_PRESET: "core" }, CORE_STEPS);
    expectTwins(outcome);
    const plain = (label: string): Record1 => outcome.records.get(label)!.get("plain")!;
    expect(plain("tools/list").response.tools).toHaveLength(15);
    for (const label of ["hidden tool", "hidden tool in a hidden family"]) {
      expect(plain(label).response.isError, label).toBe(true);
      expect(plain(label).response.content[0].text, label).toContain("not found");
      expect(plain(label).a.concat(plain(label).b), label).toEqual([]);
    }
    const groupCount = outcome.records.get("visible read")!.size;
    expect(outcome.audit.slice(1), "only the visible read is audited, once for each request").toHaveLength(groupCount);
    expect(outcome.audit.slice(1).every((entry) => entry.tool === "iris_doc_get")).toBe(true);
  });
});
