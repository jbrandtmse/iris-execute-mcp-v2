/**
 * Story 43.2 QA (AC 43.2.1, 43.2.3; matrix rows Probe discard, Legacy on modern; AD-3, AD-19, AD-32; Rules #19, #59) - both eras in ONE
 * process, in the orders a real client does not use.
 *
 * The cross-era pin runs each era on its own connection and the probe-discard path once, comparing response lines. Here the BUILT dev
 * server (two fake IRIS listeners, audit on; 127.0.0.1 only, no IRIS instance is reached) is driven by hand in mixed and adversarial
 * orders, and the question is always the same: it serves correctly or refuses with a JSON-RPC error that has a code and a message, and
 * the chokepoint (AD-3) is the same either way:
 *  - modern, then a legacy `initialize` (refused, and the modern session goes on); legacy `initialize`, then modern-enveloped requests
 *    (served as the pinned era or refused, a denial stays a denial); a modern opening that is not `server/discover`; an `initialize`
 *    that carries a modern envelope; refused openings (a claim of an unsupported or malformed version) that create no instance;
 *    lines that are not requests;
 *  - a `protocolVersion` in `_meta` that differs per request on one connection: no claim reaches a different profile, namespace or
 *    governance outcome;
 *  - the factory-rebuild path (`server/discover`, then `initialize`): nothing that belongs once to a process happens twice - the audit
 *    `sessionStart`, the IRIS contact at startup, the startup log lines, the governance and visibility state. A run that opens with the
 *    probe is compared, byte for byte, with a run that opens with `initialize`, with and without a governance override and a preset.
 */

import { afterEach, describe, expect, it } from "vitest";
import { REPO_ROOT } from "./pack-fixture";
import { GOLDEN_PACKAGES } from "../../../../scripts/lib/sdk-wire-golden-core.mjs";
import { staleDistReason } from "./process-gate-helpers.js";
import {
  EXAMPLE_META,
  LEGACY_ERA_LINE,
  LEGACY_VERSION,
  MINIMAL_META,
  MODERN_ERA_LINE,
  MODERN_VERSION,
  PROTOCOL_VERSION_KEY,
  eraLines,
  legacyInitializeParams,
  modernCall,
  rawWithIdZero,
  startRig,
  withoutModernFields,
  type Json,
  type Rig,
  type WireLine,
} from "./story-43-2-qa-hand-wire";

const DOC = { name: "Demo.Sample.cls" };
const DOC_GET_A = "GET /api/atelier/v8/HSCUSTOM/doc/Demo.Sample.cls";
const DENIAL = { action: "execute", source: "A", target: "B" };
const SMUGGLED_GOVERNANCE = {
  governance: { iris_env_promote: true },
  IRIS_GOVERNANCE: JSON.stringify({ "iris_env_promote:execute": true }),
};

const stale = ["shared", ...GOLDEN_PACKAGES].map((pkg) => [pkg, staleDistReason(REPO_ROOT, pkg)] as const).filter(([, reason]) => reason !== undefined);
if (stale.length > 0) throw new Error(`Build the packages first: ${stale.map(([pkg, reason]) => `${pkg}: ${reason}`).join("; ")}`);

const rigs: Rig[] = [];
/** Start a rig that this test file stops after the test, whatever the test did. */
async function rigOf(env: Record<string, string | undefined> = {}): Promise<Rig> {
  const rig = await startRig({ env });
  rigs.push(rig);
  return rig;
}
afterEach(async () => {
  while (rigs.length > 0) await rigs.pop()!.stop();
});

/** A JSON-RPC refusal: an integer code and a message. */
function expectRefusal(line: WireLine, codes?: number[]): Json {
  const error = line.message.error;
  expect(error, line.raw.slice(0, 300)).toBeDefined();
  expect(Number.isInteger(error.code) && typeof error.message === "string" && error.message.length > 0, line.raw.slice(0, 300)).toBe(true);
  if (codes !== undefined) expect(codes, line.raw.slice(0, 300)).toContain(error.code);
  return error;
}

/** The in-band governance refusal of `iris_env_promote:execute`. */
function expectDenied(result: Json): void {
  expect(result.isError).toBe(true);
  expect(result.structuredContent).toMatchObject({ code: "GOVERNANCE_DISABLED", action: "iris_env_promote:execute" });
}

const entriesOf = (audit: Json[], tool: string): Json[] => audit.filter((entry) => entry.tool === tool);

describe("both eras in one process, in the wrong order", () => {
  it("modern, then a legacy initialize: the initialize is refused, the modern session and its gates go on, and the refusal creates no instance", async () => {
    const rig = await rigOf();
    const { wire } = rig;
    expect((await wire.request(1, "server/discover", { _meta: EXAMPLE_META })).message.result.supportedVersions).toContain(MODERN_VERSION);
    const before = (await wire.request(2, "tools/list", { _meta: MINIMAL_META })).message.result;
    for (const [id, version] of [[3, LEGACY_VERSION], [4, MODERN_VERSION]] as const) {
      const error = expectRefusal(await wire.request(id, "initialize", legacyInitializeParams(version)), [-32022]);
      expect(error.data.supported).toContain(MODERN_VERSION);
    }
    expectDenied((await wire.request(5, "tools/call", modernCall("iris_env_promote", DENIAL))).message.result);
    const read = (await wire.request(6, "tools/call", modernCall("iris_doc_get", DOC))).message.result;
    expect(read.resultType).toBe("complete");
    expect(read.structuredContent.name).toBe("Demo.Sample.cls");
    expect((await wire.request(7, "tools/list", { _meta: MINIMAL_META })).message.result, "the listing is unchanged").toEqual(before);

    expect(rig.requests.a().filter((request) => request.includes("/doc/"))).toEqual([DOC_GET_A]);
    expect(rig.requests.b()).toEqual([]);
    const audit = await rig.audit(3);
    expect(audit.map((entry) => entry.type ?? `${entry.tool}:${entry.outcome}`)).toEqual(["sessionStart", "iris_env_promote:denied", "iris_doc_get:ok"]);
    expect(eraLines(wire.stderr()), "one factory call: the refused initializes never reached it").toEqual([MODERN_ERA_LINE]);
  });

  it("a legacy initialize, then modern-enveloped requests: each is served as the pinned era or refused, and a denial stays a denial", async () => {
    const rig = await rigOf();
    const { wire } = rig;
    const init = (await wire.request(1, "initialize", legacyInitializeParams())).message.result;
    expect(init.protocolVersion).toBe(LEGACY_VERSION);
    wire.send({ jsonrpc: "2.0", method: "notifications/initialized" });
    const plainRead = (await wire.request(2, "tools/call", { name: "iris_doc_get", arguments: DOC })).message.result;
    const plainList = (await wire.request(3, "tools/list", {})).message.result;

    const enveloped = await wire.request(4, "tools/call", modernCall("iris_doc_get", DOC, { server: "other", namespace: "%SYS" }));
    if (enveloped.message.error === undefined) {
      expect(enveloped.message.result.resultType, "served in the pinned 2025 era's shape").toBeUndefined();
      expect(withoutModernFields(enveloped.message.result), "served: the same answer as without the envelope").toEqual(withoutModernFields(plainRead));
    } else expectRefusal(enveloped);
    const list = await wire.request(5, "tools/list", { _meta: MINIMAL_META });
    if (list.message.error === undefined) {
      expect(list.message.result.resultType, "served in the pinned 2025 era's shape").toBeUndefined();
      expect(withoutModernFields(list.message.result)).toEqual(withoutModernFields(plainList));
    } else expectRefusal(list);
    const denial = await wire.request(6, "tools/call", modernCall("iris_env_promote", DENIAL, SMUGGLED_GOVERNANCE));
    const deniedCount = denial.message.error === undefined ? 1 : 0;
    if (deniedCount === 1) expectDenied(denial.message.result);
    else expectRefusal(denial);
    const discover = await wire.request(7, "server/discover", { _meta: MINIMAL_META });
    if (discover.message.error === undefined) expect(discover.message.result.supportedVersions).toContain(MODERN_VERSION);
    else expectRefusal(discover);

    // The smuggled server and namespace reached nothing but A in HSCUSTOM.
    expect(rig.requests.b()).toEqual([]);
    expect(rig.requests.a().filter((request) => request.includes("/doc/")).every((request) => request === DOC_GET_A)).toBe(true);
    const audit = await rig.audit(2);
    expect(entriesOf(audit, "iris_env_promote").map((entry) => entry.outcome), "a served denial is audited as denied; none ever succeeds").toEqual(
      Array(deniedCount).fill("denied"),
    );
    expect(eraLines(wire.stderr())).toEqual([LEGACY_ERA_LINE]);
  });

  it("a modern opening that is not server/discover pins the modern era on one factory call, and a later server/discover is answered by that instance", async () => {
    const rig = await rigOf();
    const { wire } = rig;
    const list = (await wire.request(1, "tools/list", { _meta: MINIMAL_META })).message.result;
    expect(list.resultType).toBe("complete");
    expect((await wire.request(2, "tools/call", modernCall("iris_server_profiles", {}))).message.result.resultType).toBe("complete");
    expect((await wire.request(3, "server/discover", { _meta: MINIMAL_META })).message.result.supportedVersions).toContain(MODERN_VERSION);
    expectRefusal(await wire.request(4, "initialize", legacyInitializeParams()), [-32022]);
    expect(eraLines(wire.stderr())).toEqual([MODERN_ERA_LINE]);
  });

  it("an initialize that carries a valid modern envelope is refused with a JSON-RPC error, and the connection it opened serves the modern era", async () => {
    const rig = await rigOf();
    const { wire } = rig;
    expectRefusal(await wire.request(1, "initialize", { ...legacyInitializeParams(), _meta: EXAMPLE_META }));
    expect((await wire.request(2, "tools/list", { _meta: MINIMAL_META })).message.result.resultType).toBe("complete");
    expect(eraLines(wire.stderr())).toEqual([MODERN_ERA_LINE]);
  });

  it("a refused opening creates no instance: an unsupported, unknown or malformed claim is a JSON-RPC error, and a legacy initialize then works", async () => {
    const rig = await rigOf();
    const { wire } = rig;
    let id = 0;
    for (const claim of [LEGACY_VERSION, "2099-01-01", "garbage"]) {
      const error = expectRefusal(await wire.request(++id, "tools/list", { _meta: { ...MINIMAL_META, [PROTOCOL_VERSION_KEY]: claim } }), [-32022]);
      expect(error.data.supported, claim).toContain(MODERN_VERSION);
      expect(error.data.requested, claim).toBe(claim);
    }
    expectRefusal(await wire.request(++id, "tools/list", { _meta: { ...MINIMAL_META, [PROTOCOL_VERSION_KEY]: 42 } }), [-32602]);
    expectRefusal(await wire.request(++id, "tools/list", { _meta: { [PROTOCOL_VERSION_KEY]: MODERN_VERSION } }), [-32602]);
    expect(eraLines(wire.stderr()), "no factory call so far").toEqual([]);
    expect((await wire.request(++id, "initialize", legacyInitializeParams())).message.result.protocolVersion).toBe(LEGACY_VERSION);
    // The era line goes to stderr and the answer to stdout, two pipes with no order between them: let stderr catch up.
    await wire.quiet(150);
    expect(eraLines(wire.stderr())).toEqual([LEGACY_ERA_LINE]);
  });

  it("lines that are not requests are ignored: stdout stays JSON-RPC responses, and the next request is answered", async () => {
    const rig = await rigOf();
    const { wire } = rig;
    await wire.request(1, "server/discover", { _meta: MINIMAL_META });
    for (const junk of ["not json at all", "[]", "{}", '{"jsonrpc":"2.0"}', JSON.stringify([{ jsonrpc: "2.0", id: 50, method: "tools/list", params: { _meta: MINIMAL_META } }])]) {
      wire.sendRaw(junk);
    }
    expect((await wire.request(2, "tools/list", { _meta: MINIMAL_META })).message.result.resultType).toBe("complete");
    await wire.quiet(200);
    for (const line of wire.stdout()) {
      expect(line.message, `stdout is not JSON: ${line.raw.slice(0, 200)}`).toBeDefined();
      expect(line.message.method, "the server writes no request or notification").toBeUndefined();
    }
    expect(wire.stdout().map((line) => line.message?.id), "no line is written for a junk line: no -32700, -32600 or batch answer").toEqual([1, 2]);
  });
});

describe("a protocolVersion in _meta that differs per request on one connection", () => {
  it("is served as the modern era or refused, and no claim reaches a different profile, namespace or governance outcome", async () => {
    const rig = await rigOf();
    const { wire } = rig;
    await wire.request(1, "server/discover", { _meta: MINIMAL_META });
    const claims = [MODERN_VERSION, LEGACY_VERSION, "2099-01-01", "1900-01-01", "garbage", MODERN_VERSION];
    let id = 1;
    const served = { reads: 0, denials: 0 };
    let baseline: Json;
    for (const claim of claims) {
      const meta = { [PROTOCOL_VERSION_KEY]: claim, server: "other", namespace: "%SYS" };
      const read = await wire.request(++id, "tools/call", modernCall("iris_doc_get", DOC, meta));
      if (read.message.error === undefined) {
        served.reads += 1;
        baseline ??= withoutModernFields(read.message.result);
        expect(withoutModernFields(read.message.result), `read under the claim ${claim}`).toEqual(baseline);
        expect(read.message.result.resultType, "the connection is pinned: the answer keeps the era's shape").toBe("complete");
      } else expectRefusal(read, [-32022, -32602]);
      const denial = await wire.request(++id, "tools/call", modernCall("iris_env_promote", DENIAL, { ...meta, ...SMUGGLED_GOVERNANCE }));
      if (denial.message.error === undefined) {
        served.denials += 1;
        expectDenied(denial.message.result);
      } else expectRefusal(denial, [-32022, -32602]);
    }
    expect(served.reads, "the claim of the connection's own version is always served").toBeGreaterThanOrEqual(2);
    expect(rig.requests.b(), "the claims never selected the other profile").toEqual([]);
    expect(rig.requests.a().filter((request) => request.includes("/doc/"))).toEqual(Array(served.reads).fill(DOC_GET_A));
    const audit = await rig.audit(1 + served.reads + served.denials);
    expect(entriesOf(audit, "iris_doc_get").map((entry) => [entry.profile, entry.namespace, entry.outcome])).toEqual(
      Array(served.reads).fill(["default", "HSCUSTOM", "ok"]),
    );
    expect(entriesOf(audit, "iris_env_promote").map((entry) => entry.outcome)).toEqual(Array(served.denials).fill("denied"));
    expect((await wire.request(++id, "tools/list", { _meta: MINIMAL_META })).message.result.resultType).toBe("complete");
  });
});

// -- the factory-rebuild path ----------------------------------------------------------------------------------------------------------

/** Calls a client makes after the handshake, in the 2025 era's shape. */
const FOLLOW: Array<[string, Json]> = [
  ["tools/list", {}],
  ["tools/call", { name: "iris_server_profiles", arguments: {} }],
  ["tools/call", { name: "iris_doc_get", arguments: DOC }],
  ["tools/call", { name: "iris_env_promote", arguments: DENIAL }],
  ["prompts/list", {}],
  ["resources/read", { uri: "iris-governance://default" }],
];

interface Capture {
  startup: string[];
  responses: string[];
  audit: Json[];
  stderr: string[];
  eraLines: string[];
}

/** One run: the opening, a legacy `initialize`, then {@link FOLLOW}; what IRIS was asked, what was answered, audited and logged. */
async function capture(opening: "initialize" | "probe" | "probe-twice", env: Record<string, string | undefined>, auditEntries: number): Promise<Capture> {
  const rig = await rigOf(env);
  const { wire } = rig;
  let id = 0;
  if (opening !== "initialize") await wire.request(++id, "server/discover", { _meta: EXAMPLE_META });
  if (opening === "probe-twice") await wire.request(++id, "server/discover", { _meta: MINIMAL_META });
  expect((await wire.request(++id, "initialize", legacyInitializeParams())).message.result.protocolVersion).toBe(LEGACY_VERSION);
  wire.send({ jsonrpc: "2.0", method: "notifications/initialized" });
  const startup = [...rig.requests.a(), ...rig.requests.b()];
  const responses: string[] = [];
  for (const [method, params] of FOLLOW) {
    const line = await wire.request(++id, method, params);
    responses.push(rawWithIdZero(line.raw).replaceAll(String(rig.ports.a), "0").replaceAll(String(rig.ports.b), "0"));
  }
  const audit = await rig.audit(auditEntries);
  const stderr = rig
    .maskedStderr()
    .replace(/completed in \d+ms/g, "completed in Nms")
    .split("\n")
    .filter((line) => line !== "" && !line.startsWith("[INFO] Serving "));
  return { startup, responses, audit, stderr: stderr.sort(), eraLines: eraLines(wire.stderr()) };
}

/**
 * The configurations the rebuild is compared under, and the audit entries a run holds: the session line plus the profiles call, the read
 * and the denial - or, under the core preset, no entry for the denial, because `iris_env_promote` is hidden there and a hidden tool is
 * never audited.
 */
const VARIANTS: Array<[string, Record<string, string | undefined>, number]> = [
  ["the default configuration", {}, 4],
  ["a governance override and the core preset", { IRIS_TOOLS_PRESET: "core", IRIS_GOVERNANCE: JSON.stringify({ global: { iris_doc_get: false } }) }, 3],
];

describe.each(VARIANTS)("the factory-rebuild path under %s", (_name, env, auditEntries) => {
  it("nothing that belongs once to a process happens twice: a run that opens with server/discover equals a run that opens with initialize", async () => {
    const plain = await capture("initialize", env, auditEntries);
    const rebuilt = await capture("probe", env, auditEntries);
    const twice = await capture("probe-twice", env, auditEntries);

    expect(plain.eraLines).toEqual([LEGACY_ERA_LINE]);
    expect(rebuilt.eraLines).toEqual([MODERN_ERA_LINE, LEGACY_ERA_LINE]);
    expect(twice.eraLines, "a second discover reaches the probe instance; the rebuild is still one factory call").toEqual([MODERN_ERA_LINE, LEGACY_ERA_LINE]);
    for (const run of [rebuilt, twice]) {
      expect(run.startup, "IRIS was contacted at startup exactly as a run without the probe contacts it").toEqual(plain.startup);
      expect(run.audit.filter((entry) => entry.type === "sessionStart"), "one audit session per process").toHaveLength(1);
      expect(run.audit, "the audit trail is the same entry for entry").toEqual(plain.audit);
      expect(run.stderr, "the startup log lines, once each, and nothing new").toEqual(plain.stderr);
      expect(run.responses, "every answer is the same byte for byte: the governance policy and the visible tools survive the rebuild").toEqual(plain.responses);
    }
    expect(plain.stderr.filter((line) => line.includes("Tool visibility:"))).toHaveLength(1);
    expect(plain.stderr.filter((line) => line.includes("Connected via stdio transport"))).toHaveLength(1);
    // Anchors: the comparison is not between two empty things, and the override really acts.
    expect(plain.startup.length).toBeGreaterThan(0);
    const [list, profiles, read, denial] = plain.responses.map((line) => JSON.parse(line).result);
    expect(profiles.structuredContent.governance.policy).toBeDefined();
    if (env["IRIS_TOOLS_PRESET"] === "core") {
      expect(list.tools).toHaveLength(15);
      expect(read.isError, "iris_doc_get is disabled by the override").toBe(true);
      expect(read.structuredContent.code).toBe("GOVERNANCE_DISABLED");
      expect(denial.content[0].text, "iris_env_promote is hidden by the preset").toContain("not found");
    } else {
      expect(list.tools.length).toBeGreaterThan(15);
      expect(read.structuredContent.name).toBe("Demo.Sample.cls");
      expectDenied(denial);
    }
  });
});
