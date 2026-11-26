/**
 * Story 45.2: the bootstrap with the automatic install off (AD-14, AD-15).
 *
 * Every branch of the probe, with the install ON (unset) and OFF from each of the three channels (the
 * variable, the read-only preset, the profile's own field), over a small stateful fake of the Atelier
 * routes the bootstrap uses. OFF sends reads only (the recorded request list is exact), logs what the spec
 * fixes, and leaves the custom REST service refused only on `missing` and `stale`. On `unconfigured` it warns once
 * and lets the tools go on (DW-772, decision #165, DW-791): since Story 45.6 that reading means the web application
 * lookup failed or the web application is absent, and the lookup can fail for a reason other than absence.
 * ON-versus-unset is pinned byte for byte per branch (Rule #19).
 *
 * Story 45.7 (DW-770): with the install off, a deployed marker that carries THIS build's hash reads `current` (or
 * `unconfigured`) whatever its semver and sequence. The `newer` fixture below therefore carries ANOTHER hash, so it still
 * stands for a deployment that is newer and different; the same-hash markers have their own describe.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { IrisHttpClient } from "../http-client.js";
import type { IrisConnectionConfig } from "../config.js";
import { bootstrap, buildIrisSideRefusal } from "../bootstrap.js";
import type { BootstrapResult } from "../bootstrap.js";
import { BOOTSTRAP_CLASSES, BOOTSTRAP_VERSION, IPM_MODULE_NAME } from "../bootstrap-classes.js";
import { parseBootstrapMarker } from "../bootstrap-version.js";
import type { AutoInstallSource } from "../auto-install.js";

const SEMVER = BOOTSTRAP_VERSION.split("+")[0] as string;
const OLD_MARKER = "abcdef123456";
const PASSWORD = "s3cret-Pw-Q7zX";

/** The hash of this build's marker. */
const EMBEDDED_HASH = (() => {
  const parsed = parseBootstrapMarker(BOOTSTRAP_VERSION);
  if (parsed.kind !== "stamped") throw new Error("the embedded marker is not stamped");
  return parsed.hash;
})();

/** Another content hash than this build's (12 lowercase hex characters). */
const OTHER_HASH = EMBEDDED_HASH === "0123456789ab" ? "ba9876543210" : "0123456789ab";

/** The embedded marker with its sequence moved up and ANOTHER hash: a newer deployment of other classes. */
function newerMarker(): string {
  const parsed = parseBootstrapMarker(BOOTSTRAP_VERSION);
  if (parsed.kind !== "stamped") throw new Error("the embedded marker is not stamped");
  const [major, minor, patch] = parsed.semver;
  return `${major}.${minor}.${patch}+${Number(parsed.sequence) + 1000}.${OTHER_HASH}`;
}

/** The embedded marker with a LOWER semver and the same hash: what a semver-only restamp leaves on an instance (DW-770). */
function olderSameHashMarker(): string {
  const parsed = parseBootstrapMarker(BOOTSTRAP_VERSION);
  if (parsed.kind !== "stamped") throw new Error("the embedded marker is not stamped");
  const [major, minor] = parsed.semver;
  return `${major}.${Number(minor) - 1}.0+${Number(parsed.sequence) - 1}.${parsed.hash}`;
}

/** The embedded marker with a HIGHER semver and sequence and the same hash. */
function newerSameHashMarker(): string {
  const parsed = parseBootstrapMarker(BOOTSTRAP_VERSION);
  if (parsed.kind !== "stamped") throw new Error("the embedded marker is not stamped");
  const [major, minor, patch] = parsed.semver;
  return `${major}.${minor}.${Number(patch) + 7}+${Number(parsed.sequence) + 1000}.${parsed.hash}`;
}

/** A state of the instance the fake answers from. */
interface InstanceState {
  /** The marker `Setup_GetBootstrapVersion()` returns; `undefined` when the query fails. */
  marker?: string;
  /** Whether the `ExecuteMCPv2.Setup` document exists (what the 404 check sees). */
  setupDoc: boolean;
  /** Whether `Setup_IsConfigured()` reports the web application. */
  configured: boolean;
  /** `ExecuteMCPv2.InstallGuard`: `found` (IPM), `absent` (404) or `fails` (HTTP 500). */
  guard: "found" | "absent" | "fails";
  /** What the `Configured` column carries, when it is not the 1/0 of a privileged account (the live least-privilege shape: `false`). */
  configuredValue?: unknown;
}

/** The five states of the spec's branch table. */
const BRANCHES = {
  missing: { setupDoc: false, configured: false, guard: "absent" },
  stale: { marker: OLD_MARKER, setupDoc: true, configured: true, guard: "absent" },
  unconfigured: { marker: BOOTSTRAP_VERSION, setupDoc: true, configured: false, guard: "absent" },
  current: { marker: BOOTSTRAP_VERSION, setupDoc: true, configured: true, guard: "absent" },
  newer: { marker: newerMarker(), setupDoc: true, configured: true, guard: "absent" },
  foreign: { marker: "dev", setupDoc: true, configured: true, guard: "absent" },
  unknown: { setupDoc: true, configured: true, guard: "absent" },
} satisfies Record<string, InstanceState>;
type Branch = keyof typeof BRANCHES;

function envelope(result: unknown): Response {
  return new Response(JSON.stringify({ status: { errors: [], summary: "" }, console: [], result }), { status: 200 });
}

function status(code: number): Response {
  return new Response(JSON.stringify({ status: { errors: [], summary: "" }, console: [], result: {} }), { status: code });
}

/** A fake of the Atelier routes the bootstrap uses; a write moves the state, as on a real instance. */
function installFake(state: InstanceState): ReturnType<typeof vi.fn> {
  const live = { ...state };
  const names = [...BOOTSTRAP_CLASSES.keys()];
  const fetchMock = vi.fn(async (url: string, init: { method?: string; body?: string }) => {
    const method = init.method ?? "GET";
    const path = String(url);
    if (method === "HEAD") return new Response(null, { status: 200, headers: { "X-CSRF-Token": "t" } });
    if (method === "PUT") {
      live.setupDoc = true;
      return envelope({});
    }
    if (method === "GET" && path.includes("/docnames/CLS")) {
      return envelope({ content: names.map((name) => ({ name, cat: "CLS", ts: "2026-11-25 10:00:00.000", upd: true })) });
    }
    if (method === "GET" && path.endsWith("/doc/ExecuteMCPv2.InstallGuard.cls")) {
      if (live.guard === "found") return envelope({ name: "ExecuteMCPv2.InstallGuard.cls", content: [] });
      return live.guard === "absent" ? status(404) : status(500);
    }
    if (method === "GET" && path.endsWith("/doc/ExecuteMCPv2.Setup.cls")) {
      return live.setupDoc ? envelope({ name: "ExecuteMCPv2.Setup.cls", content: [] }) : status(404);
    }
    if (method === "POST" && path.endsWith("/action/compile")) {
      live.marker = BOOTSTRAP_VERSION;
      return envelope({});
    }
    if (method === "POST" && path.endsWith("/action/query")) {
      const query = String((JSON.parse(init.body ?? "{}") as { query?: string }).query);
      if (query.includes("Setup_GetBootstrapVersion")) {
        return live.marker === undefined ? status(400) : envelope({ content: [{ Version: live.marker }] });
      }
      if (query.includes("Setup_IsConfigured")) {
        return envelope({ content: [{ Configured: "configuredValue" in live ? live.configuredValue : live.configured ? 1 : 0 }] });
      }
      if (query.includes("%Dictionary.ClassDefinition")) {
        return envelope({ content: names.map((name) => ({ ID: name.slice(0, -4), Compiled: 1, CompileError: 0 })) });
      }
      if (query.includes("Setup_Configure(")) live.configured = true;
      // The Configure queries read their own column (DW-790); "1" is the success value of `%ODBCOUT(<status>)`.
      return envelope({ content: [{ Result: "1", ConfigureResult: "1", MappingResult: "1", UnitTestRoot: "/mgr/" }] });
    }
    return status(404);
  });
  return fetchMock;
}

/** One recorded request as a short, stable label. */
function label(call: unknown[]): string {
  const url = String(call[0]).replace("http://localhost:52773", "");
  const init = call[1] as { method?: string; body?: string };
  const method = init.method ?? "GET";
  if (method === "POST" && url.endsWith("/action/query")) {
    const query = String((JSON.parse(init.body ?? "{}") as { query?: string }).query);
    const proc = /Setup_(\w+)\(/.exec(query);
    return `POST query ${proc !== null ? proc[1] : query.includes("%Dictionary") ? "dictionary" : query}`;
  }
  return `${method} ${url.replace(/^\/api\/atelier\/v7\/USER\//, "")}`;
}

function requests(fetchMock: ReturnType<typeof vi.fn>): string[] {
  return fetchMock.mock.calls.map(label);
}

/** The writes of the spec: PUT, DELETE, a compile, and the three `Setup_*` configuration calls. */
function writes(fetchMock: ReturnType<typeof vi.fn>): string[] {
  return requests(fetchMock).filter(
    (r) =>
      r.startsWith("PUT") ||
      r.startsWith("DELETE") ||
      r.includes("action/compile") ||
      /query (Configure|ConfigureMapping|EnsureUnitTestRoot)$/.test(r),
  );
}

/** Every logged line as one text, the request timings (`completed in 3ms`) removed. */
function logText(): string {
  return JSON.stringify(vi.mocked(console.error).mock.calls).replace(/completed in \d+ms/g, "completed in Nms");
}

function lines(prefix: string): string[] {
  return vi
    .mocked(console.error)
    .mock.calls.map((call) => String(call[0]))
    .filter((line) => line.startsWith(prefix));
}

function configFor(source?: AutoInstallSource | "on", name?: string): IrisConnectionConfig {
  return {
    host: "localhost",
    port: 52773,
    username: "testuser",
    password: PASSWORD,
    namespace: "USER",
    https: false,
    baseUrl: "http://localhost:52773",
    timeout: 60_000,
    ...(name !== undefined ? { name } : {}),
    ...(source === "on" ? { autoInstall: true, autoInstallSource: "default" as const } : {}),
    ...(source !== undefined && source !== "on" ? { autoInstall: false, autoInstallSource: source } : {}),
  } as IrisConnectionConfig;
}

const SOURCES: Array<{ source: AutoInstallSource; label: string; wayOut: string }> = [
  { source: "IRIS_AUTO_INSTALL", label: "IRIS_AUTO_INSTALL=false", wayOut: "with IRIS_AUTO_INSTALL unset or true" },
  { source: "IRIS_GOVERNANCE_PRESET", label: "IRIS_GOVERNANCE_PRESET=read-only", wayOut: "without the read-only preset" },
  { source: "IRIS_PROFILES", label: "autoInstall: false in IRIS_PROFILES", wayOut: "with the profile's autoInstall removed or true" },
];

let originalFetch: typeof globalThis.fetch;
beforeEach(() => {
  originalFetch = globalThis.fetch;
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

async function run(
  state: InstanceState,
  config: IrisConnectionConfig,
): Promise<{ result: BootstrapResult; fetchMock: ReturnType<typeof vi.fn> }> {
  const fetchMock = installFake(state);
  globalThis.fetch = fetchMock as unknown as typeof fetch;
  const http = new IrisHttpClient(config);
  try {
    return { result: await bootstrap(http, config, 7), fetchMock };
  } finally {
    http.destroy();
  }
}

const READ_HEAD = "HEAD /api/atelier/";
const VERSION = "POST query GetBootstrapVersion";
const SETUP_DOC = "GET doc/ExecuteMCPv2.Setup.cls";
const GUARD_DOC = "GET doc/ExecuteMCPv2.InstallGuard.cls";
const IS_CONFIGURED = "POST query IsConfigured";

/** The request list of each branch with the install off (all reads). */
const OFF_REQUESTS: Record<Branch, string[]> = {
  missing: [READ_HEAD, VERSION, SETUP_DOC, GUARD_DOC],
  stale: [READ_HEAD, VERSION, GUARD_DOC],
  unconfigured: [READ_HEAD, VERSION, IS_CONFIGURED, GUARD_DOC],
  current: [READ_HEAD, VERSION, IS_CONFIGURED, "POST query dictionary", "GET docnames/CLS?filter=ExecuteMCPv2."],
  newer: [READ_HEAD, VERSION],
  foreign: [READ_HEAD, VERSION],
  unknown: [READ_HEAD, VERSION, SETUP_DOC],
};

describe.each(SOURCES)("the install off from $source", ({ source, label: sourceLabel, wayOut }) => {
  const off = (): IrisConnectionConfig => configFor(source);

  it("unconfigured: sends reads only, refuses nothing, logs exactly one warning (DW-772)", async () => {
    const { result, fetchMock } = await run(BRANCHES.unconfigured, off());

    expect(requests(fetchMock)).toEqual(OFF_REQUESTS.unconfigured);
    expect(writes(fetchMock)).toEqual([]);
    expect(result).toStrictEqual({
      probeFound: true,
      probeStatus: "unconfigured",
      autoInstallOff: source,
      webAppUnconfirmed: true,
      deployed: false,
      compiled: false,
      configured: false,
      mapped: false,
      unitTestRootEnsured: false,
      errors: [],
    });
    expect(result, "the tools go on: no up-front refusal").not.toHaveProperty("customRestRefused");

    const warnings = lines("[WARN]");
    expect(warnings, "exactly one warning").toHaveLength(1);
    expect(warnings[0]).toBe(
      "[WARN] Bootstrap: the ExecuteMCPv2 classes in 'USER' on localhost:52773 are current, but this server could not confirm that " +
        'the /api/executemcp/v2 web application is registered (profile "default"). ' +
        "The web application lookup failed, or the web application is not registered. " +
        `The automatic install is off for this profile (${sourceLabel}), so nothing was changed and the custom-REST tools go on. ` +
        'If they answer 404, an operator runs Do ##class(ExecuteMCPv2.Setup).Configure("USER") as a user with %Admin_Manage, ' +
        `or starts one server against localhost:52773 ${wayOut}.`,
    );
    expect(warnings[0], "no refusal wording").not.toContain("IRIS_SIDE_NOT_INSTALLED");
    // DW-791: the 45.6 behavior, not the pre-45.6 "an account that cannot read %SYS reads this" wording.
    expect(warnings[0]).not.toContain("may not be able to read %SYS");
    // mutation: the old sentence restored in `warnWebAppUnconfirmed` -> the exact text above and this line are red.
    expect(lines("[INFO] Bootstrap: the automatic install is off"), "the INFO line is for the other branches").toEqual([]);
  });

  it.each(["missing", "stale"] as const)(
    "%s: sends reads only, arms the refusal, logs one warning, reports the channel",
    async (branch) => {
      const { result, fetchMock } = await run(BRANCHES[branch], off());

      expect(requests(fetchMock)).toEqual(OFF_REQUESTS[branch]);
      expect(writes(fetchMock)).toEqual([]);
      expect(result).toStrictEqual({
        probeFound: branch !== "missing",
        probeStatus: branch,
        ...(branch === "stale" ? { deployedVersion: OLD_MARKER } : {}),
        autoInstallOff: source,
        customRestRefused: true,
        deployed: false,
        compiled: false,
        configured: false,
        mapped: false,
        unitTestRootEnsured: false,
        errors: [],
      });

      const warnings = lines("[WARN]");
      expect(warnings, "exactly one warning").toHaveLength(1);
      const warning = warnings[0] as string;
      expect(warning).toContain(`the automatic install is off for profile "default" (${sourceLabel})`);
      expect(warning).toContain("IRIS_SIDE_NOT_INSTALLED");
      expect(warning).toContain(`start one server against localhost:52773 ${wayOut}`);
      expect(warning).toContain(`zpm "install ${IPM_MODULE_NAME} ${SEMVER}" in 'USER'`);
      expect(warning, "the refusal is decided at connect, so the way out ends with a restart").toContain("then restart this server.");
      expect(lines("[INFO] Bootstrap: the automatic install is off"), "the INFO line is for the other branches").toEqual([]);
    },
  );

  it.each(["current", "newer", "foreign", "unknown"] as const)(
    "%s: as today, plus one INFO line, and no refusal",
    async (branch) => {
      const { result, fetchMock } = await run(BRANCHES[branch], off());
      const warnings = lines("[WARN]");
      const infos = lines("[INFO] Bootstrap: the automatic install is off");
      const onRun = await run(BRANCHES[branch], configFor("on"));

      expect(requests(fetchMock)).toEqual(OFF_REQUESTS[branch]);
      expect(writes(fetchMock)).toEqual([]);
      expect(result).not.toHaveProperty("customRestRefused");
      expect(result.autoInstallOff).toBe(source);
      // Everything but the new field is what the install on reports.
      const rest: Partial<BootstrapResult> = { ...result };
      delete rest.autoInstallOff;
      expect(rest).toStrictEqual(onRun.result);

      expect(infos).toHaveLength(1);
      expect(infos[0]).toBe(
        `[INFO] Bootstrap: the automatic install is off for profile "default" (${sourceLabel}); found ${branch}, nothing to install.`,
      );
      // The one warning of newer, foreign and unknown is still the only warning; current has none.
      expect(warnings).toHaveLength(branch === "current" ? 0 : 1);
    },
  );

  it.each(["missing", "stale", "unconfigured"] as const)(
    "%s with an IPM installation: the one IPM warning, an INFO line, no refusal, nothing written",
    async (branch) => {
      const { result, fetchMock } = await run({ ...BRANCHES[branch], guard: "found" }, off());

      expect(requests(fetchMock)).toEqual(OFF_REQUESTS[branch]);
      expect(writes(fetchMock)).toEqual([]);
      expect(result.ipmOwned).toBe(true);
      expect(result).not.toHaveProperty("customRestRefused");
      expect(result).not.toHaveProperty("webAppUnconfirmed");
      expect(result.autoInstallOff).toBe(source);
      const warnings = lines("[WARN]");
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toContain("the classes were installed by IPM");
      expect(warnings[0]).toContain("zpm");
      expect(lines("[INFO] Bootstrap: the automatic install is off")).toHaveLength(1);
    },
  );

  it("the password never reaches a log line, the result or the refusal", async () => {
    for (const branch of ["missing", "stale", "unconfigured", "current"] as const) {
      vi.mocked(console.error).mockClear();
      const config = off();
      const { result } = await run(BRANCHES[branch], config);
      const everything = JSON.stringify([vi.mocked(console.error).mock.calls, result]);
      expect(everything, branch).not.toContain(PASSWORD);
      if (result.customRestRefused === true || result.webAppUnconfirmed === true) {
        const refusal = buildIrisSideRefusal(config, result);
        expect(JSON.stringify(refusal), branch).not.toContain(PASSWORD);
      }
    }
  });
});

describe("DW-770: with the install off, a deployed marker with this build's hash is current", () => {
  const same = (marker: string, extra: Partial<InstanceState> = {}): InstanceState => ({ ...BRANCHES.current, marker, ...extra });
  const infoOf = (source: AutoInstallSource, deployed: string) =>
    `[INFO] Bootstrap: the automatic install is off for profile "default" (${SOURCES.find((s) => s.source === source)?.label}); ` +
    `found current (the deployed marker ${JSON.stringify(deployed)} has the same IRIS-side classes as this server's ${BOOTSTRAP_VERSION}), nothing to install.`;

  it.each(SOURCES)("an older semver and sequence, the same hash: current, reads only, no refusal, the INFO line names both markers ($source)", async ({ source }) => {
    const deployed = olderSameHashMarker();
    const { result, fetchMock } = await run(same(deployed), configFor(source));

    expect(requests(fetchMock)).toEqual(OFF_REQUESTS.current);
    expect(writes(fetchMock)).toEqual([]);
    expect(result).toStrictEqual({
      probeFound: true,
      probeStatus: "current",
      deployedVersion: deployed,
      autoInstallOff: source,
      deployed: true,
      compiled: true,
      configured: true,
      mapped: true,
      unitTestRootEnsured: true,
      errors: [],
    });
    expect(result).not.toHaveProperty("customRestRefused");
    expect(lines("[WARN]")).toEqual([]);
    expect(lines("[INFO] Bootstrap: the automatic install is off")).toEqual([infoOf(source, deployed)]);
    // The closing line names the deployed marker too, never this build's as if it were deployed.
    expect(lines("[INFO] Bootstrap: REST service is current")).toEqual([`[INFO] Bootstrap: REST service is current (version ${deployed}), skipping deploy`]);
    // mutation: the same-hash rule dropped from `probeCustomRest` -> this row reads `stale` and the request list differs.
  });

  it.each([
    ["a higher semver and sequence", newerSameHashMarker()],
    ["the bare legacy hash", EMBEDDED_HASH],
  ])("%s, the same hash: current (no newer warning, no stale)", async (_name, deployed) => {
    const { result, fetchMock } = await run(same(deployed), configFor("IRIS_GOVERNANCE_PRESET"));

    expect(requests(fetchMock)).toEqual(OFF_REQUESTS.current);
    expect(result.probeStatus).toBe("current");
    expect(result.deployedVersion).toBe(deployed);
    expect(writes(fetchMock)).toEqual([]);
    expect(lines("[WARN]")).toEqual([]);
  });

  it("the web application absent (IsConfigured 0): unconfirmed, one warning, the tools go on, the deployed marker is reported", async () => {
    const deployed = olderSameHashMarker();
    const { result, fetchMock } = await run(same(deployed, { configured: false }), configFor("IRIS_GOVERNANCE_PRESET"));

    expect(requests(fetchMock)).toEqual(OFF_REQUESTS.unconfigured);
    expect(writes(fetchMock)).toEqual([]);
    expect(result).toMatchObject({ probeStatus: "unconfigured", webAppUnconfirmed: true, deployedVersion: deployed });
    expect(result).not.toHaveProperty("customRestRefused");
    expect(lines("[WARN]")).toHaveLength(1);
  });

  it("another hash at a lower semver stays stale: refused, nothing written", async () => {
    const parsed = parseBootstrapMarker(BOOTSTRAP_VERSION);
    if (parsed.kind !== "stamped") throw new Error("not stamped");
    const deployed = `${parsed.semver[0]}.${Number(parsed.semver[1]) - 1}.0+${Number(parsed.sequence) - 1}.${OTHER_HASH}`;
    const { result, fetchMock } = await run({ ...BRANCHES.stale, marker: deployed }, configFor("IRIS_GOVERNANCE_PRESET"));

    expect(requests(fetchMock)).toEqual(OFF_REQUESTS.stale);
    expect(writes(fetchMock)).toEqual([]);
    expect(result).toMatchObject({ probeStatus: "stale", deployedVersion: deployed, customRestRefused: true });
    expect(buildIrisSideRefusal(configFor("IRIS_GOVERNANCE_PRESET"), result).fields).toMatchObject({ found: "stale", deployedVersion: deployed });
  });

  it("another hash at the same semver and sequence stays foreign; `dev` stays foreign", async () => {
    for (const marker of [`${BOOTSTRAP_VERSION.slice(0, -12)}${OTHER_HASH}`, "dev"]) {
      vi.mocked(console.error).mockClear();
      const { result } = await run({ ...BRANCHES.foreign, marker }, configFor("IRIS_GOVERNANCE_PRESET"));
      expect(result.probeStatus, marker).toBe("foreign");
    }
  });

  it("the install ON over the same hash at a lower semver redeploys (stale), with today's request list", async () => {
    const deployed = olderSameHashMarker();
    const onRun = await run({ ...BRANCHES.stale, marker: deployed }, configFor("on"));
    const unsetRun = await run({ ...BRANCHES.stale, marker: deployed }, configFor());

    expect(onRun.result.probeStatus).toBe("stale");
    expect(onRun.result.deployed).toBe(true);
    expect(requests(onRun.fetchMock)).toEqual(requests(unsetRun.fetchMock));
    expect(writes(onRun.fetchMock).length).toBeGreaterThan(BOOTSTRAP_CLASSES.size);
    expect(onRun.result).not.toHaveProperty("autoInstallOff");
    // mutation: applying the rule with the install on -> this reads `current` and writes nothing.
  });
});

describe("the install on is today's behavior: ON equals unset, byte for byte, on every branch", () => {
  it.each(Object.keys(BRANCHES) as Branch[])("%s", async (branch) => {
    const unset = await run(BRANCHES[branch], configFor());
    const unsetLog = logText();
    vi.mocked(console.error).mockClear();
    const on = await run(BRANCHES[branch], configFor("on"));
    const onLog = logText();

    expect(requests(on.fetchMock)).toEqual(requests(unset.fetchMock));
    expect(on.result).toStrictEqual(unset.result);
    expect(onLog, "no new log line").toBe(unsetLog);
    // The relative pin above cannot see a line that BOTH runs emit: the install on says nothing about the setting, absolutely.
    expect(unsetLog, "unset: no line about the automatic install").not.toContain("automatic install");
    expect(onLog, "on: no line about the automatic install").not.toContain("automatic install");
    expect(onLog).not.toContain("IRIS_SIDE_NOT_INSTALLED");
    expect(on.result).not.toHaveProperty("autoInstallOff");
    expect(on.result).not.toHaveProperty("customRestRefused");
    expect(on.result).not.toHaveProperty("webAppUnconfirmed");
  });

  it("a profile with the field absent installs: missing writes classes (the unset run is the oracle)", async () => {
    const { result, fetchMock } = await run(BRANCHES.missing, configFor());
    expect(writes(fetchMock).length).toBeGreaterThan(BOOTSTRAP_CLASSES.size);
    expect(result.deployed).toBe(true);
  });
});

describe("a stale deployment whose ownership cannot be read, with the install off (the unknown case)", () => {
  const stale = { ...BRANCHES.stale, guard: "fails" } satisfies InstanceState;

  it("writes nothing, logs exactly one warning that says the classes are older and gives the way out, and does not refuse", async () => {
    for (const { source, label: sourceLabel, wayOut } of SOURCES) {
      vi.mocked(console.error).mockClear();
      const { result, fetchMock } = await run(stale, configFor(source));

      expect(writes(fetchMock)).toEqual([]);
      expect(requests(fetchMock)).toEqual([READ_HEAD, VERSION, GUARD_DOC]);
      expect(result.probeStatus).toBe("unknown");
      expect(result).not.toHaveProperty("customRestRefused");
      expect(result.readFailure).toContain("could not be checked");

      const warnings = lines("[WARN]");
      expect(warnings, source).toHaveLength(1);
      const warning = warnings[0] as string;
      expect(warning).toContain("older than this server");
      expect(warning).toContain("may behave differently");
      expect(warning).toContain(JSON.stringify(OLD_MARKER));
      expect(warning).toContain(`(${sourceLabel})`);
      expect(warning).toContain(`start one server against localhost:52773 ${wayOut}`);
      expect(warning).toContain(`zpm "install ${IPM_MODULE_NAME} ${SEMVER}"`);
      expect(lines("[INFO] Bootstrap: the automatic install is off")).toHaveLength(1);
    }
  });

  it("with the install on the same finding keeps today's warning, without the extra wording", async () => {
    const { result } = await run(stale, configFor("on"));
    expect(result.probeStatus).toBe("unknown");
    const warnings = lines("[WARN]");
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).not.toContain("older than this server");
    expect(warnings[0]).not.toContain("may behave differently");
    expect(warnings[0]).toContain("the deployed marker could not be read");
    expect(warnings[0]).toContain("delete class ExecuteMCPv2.Setup");
  });

  it("an ownership failure on an unconfigured side (marker equal to this build) gets no older wording", async () => {
    const { result } = await run({ ...BRANCHES.unconfigured, guard: "fails" }, configFor("IRIS_AUTO_INSTALL"));
    expect(result.probeStatus).toBe("unknown");
    expect(lines("[WARN]")[0]).not.toContain("older than this server");
  });
});

describe("a least-privilege account, install off (DW-772)", () => {
  // Oracle: a throwaway IRIS for Health 2026.2, an account with %Development:U and %DB_USER:RW and no %All, the web
  // application present. Atelier `action/query` answered HTTP 200 and `SELECT ExecuteMCPv2.Setup_IsConfigured()`
  // returned the JSON boolean `false` (Setup.IsConfigured hits <PROTECT> in %SYS and catches it).
  const leastPrivilege = { ...BRANCHES.unconfigured, configuredValue: false } satisfies InstanceState;

  it.each(SOURCES)("reads unconfigured and goes on: one warning, nothing written, no refusal ($source)", async ({ source }) => {
    const { result, fetchMock } = await run(leastPrivilege, configFor(source));
    expect(result.probeStatus).toBe("unconfigured");
    expect(result.webAppUnconfirmed).toBe(true);
    expect(result).not.toHaveProperty("customRestRefused");
    expect(writes(fetchMock)).toEqual([]);
    expect(lines("[WARN]")).toHaveLength(1);
  });

  it("a client armed for an absent web application from this result sends the profile's custom-REST call", async () => {
    const config = configFor("IRIS_GOVERNANCE_PRESET", "ro");
    const fetchMock = installFake(leastPrivilege);
    const http = new IrisHttpClient(config);
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const result = await bootstrap(http, config, 7);
    http.refuseCustomRestWhenAbsent(buildIrisSideRefusal(config, result));

    fetchMock.mockClear();
    fetchMock.mockImplementation(async () => envelope({ ok: true }));
    await expect(http.get("/api/executemcp/v2/config/namespace")).resolves.toMatchObject({ result: { ok: true } });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    http.destroy();
  });
});

describe("buildIrisSideRefusal", () => {
  const refused = (probeStatus: "missing" | "stale" | "unconfigured", source: AutoInstallSource): BootstrapResult => ({
    probeFound: probeStatus !== "missing",
    probeStatus,
    ...(probeStatus === "stale" ? { deployedVersion: OLD_MARKER } : {}),
    autoInstallOff: source,
    ...(probeStatus === "unconfigured" ? { webAppUnconfirmed: true as const } : { customRestRefused: true as const }),
    deployed: false,
    compiled: false,
    configured: false,
    mapped: false,
    unitTestRootEnsured: false,
    errors: [],
  });

  it("missing: the fields, the finding, the way out and the upgrade note", () => {
    const { text, fields } = buildIrisSideRefusal(configFor("IRIS_GOVERNANCE_PRESET", "ro"), refused("missing", "IRIS_GOVERNANCE_PRESET"));
    expect(fields).toStrictEqual({
      profile: "ro",
      namespace: "USER",
      found: "missing",
      requiredVersion: BOOTSTRAP_VERSION,
      autoInstallSource: "IRIS_GOVERNANCE_PRESET",
    });
    expect(text).toBe(
      'The ExecuteMCPv2 service on IRIS is not available to server profile "ro": the ExecuteMCPv2 classes are not installed in \'USER\'. ' +
        "The automatic install is off for this profile (IRIS_GOVERNANCE_PRESET=read-only), so this server installs, upgrades and repairs nothing on IRIS; " +
        "tools that use only the Atelier API keep working. " +
        "To use this tool, an operator installs or upgrades the IRIS side once: start one server against localhost:52773 without the read-only preset, " +
        `or run zpm "install ${IPM_MODULE_NAME} ${SEMVER}" in 'USER' as a user with %Admin_Manage. ` +
        "Then restart this server: the refusal is decided when the profile connects. " +
        "After a release that changes the IRIS-side classes (the release's CHANGELOG says so in its IRIS side section: " +
        "the hash at the end of BOOTSTRAP_VERSION changes), an instance that only read-only servers, or servers with the automatic install off, connect to " +
        "needs this once: upgrading the IRIS side is a deliberate admin step.",
    );
  });

  it("stale: carries deployedVersion and the older-build finding", () => {
    const { text, fields } = buildIrisSideRefusal(configFor("IRIS_AUTO_INSTALL"), refused("stale", "IRIS_AUTO_INSTALL"));
    expect(fields).toMatchObject({ found: "stale", deployedVersion: OLD_MARKER, profile: "default" });
    expect(text).toContain(`are from an older build (${OLD_MARKER}; this server needs ${BOOTSTRAP_VERSION})`);
    expect(text).toContain("with IRIS_AUTO_INSTALL unset or true");
    // C-2 and DW-770: a stale reader learns that a release that changes the IRIS-side classes needs one IRIS-side upgrade by an
    // operator, and how to tell (not every release stamps new classes).
    expect(text).toContain(
      "After a release that changes the IRIS-side classes (the release's CHANGELOG says so in its IRIS side section: " +
        "the hash at the end of BOOTSTRAP_VERSION changes), an instance that only read-only servers, or servers with the automatic install off, connect to " +
        "needs this once",
    );
    // Every release restamps the semver of BOOTSTRAP_VERSION, so "it moves" would name every release; the hash names a class change.
    expect(text).not.toContain("BOOTSTRAP_VERSION moves");
    expect(text).not.toContain("After every upgrade of the servers");
    expect(text).toContain("an operator installs or upgrades the IRIS side once");
    expect(text).toContain("Then restart this server: the refusal is decided when the profile connects.");
  });

  it("unconfigured: the finding adds the Configure one-liner; no deployedVersion", () => {
    const { text, fields } = buildIrisSideRefusal(configFor("IRIS_PROFILES", "p2"), refused("unconfigured", "IRIS_PROFILES"));
    expect(fields).not.toHaveProperty("deployedVersion");
    expect(fields).toMatchObject({ found: "unconfigured", autoInstallSource: "IRIS_PROFILES", profile: "p2" });
    expect(text).toContain('Do ##class(ExecuteMCPv2.Setup).Configure("USER") as a user with %Admin_Manage also fixes this');
    expect(text).toContain("with the profile's autoInstall removed or true");
    // The refusal is raised per call, from an absent web application's 404, so no restart is asked for (Rule #54).
    expect(text).toContain("No restart is needed: this server checks the web application again on every call.");
    expect(text).not.toContain("Then restart this server");
  });
});
