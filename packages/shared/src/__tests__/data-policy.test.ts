/**
 * Story 39.2: the PHI data policy's pure parts (AD-9, AD-6, AD-8, AD-26).
 *
 * Pins the three values, the precedence of the five channels, that a `default` entry's value is never
 * inherited, tightening, the body-kind tokens, the fixed block reasons, the governance file's
 * `dataPolicy` grammar and the `IRIS_PROFILES` field. The server-level rows (startup, discovery, audit)
 * are in `data-policy-server.test.ts`.
 */

import { describe, it, expect } from "vitest";
import {
  BLOCK_REASONS,
  BODY_KINDS,
  DATA_POLICIES,
  HL7_BODY_TEXT_MAX_CHARS,
  applyDataPolicies,
  decideBodyPolicy,
  effectiveDataPolicy,
  isBodyKind,
  isRedactableBodyKind,
  parseDataPolicyValue,
  parseOperatorDataPolicy,
  resolveDataPolicy,
  tightenDataPolicy,
} from "../data-policy.js";
import type { DataPolicy } from "../data-policy.js";
import { buildProfileRegistry, mergeProfile } from "../profiles.js";
import { loadConfig } from "../config.js";
import {
  parseGovernanceConfig,
  parseGovernanceFileText,
  unknownProfileWarnings,
} from "../governance.js";
import type { GovernanceConfig } from "../governance.js";

const CONNECTION_ENV = { IRIS_USERNAME: "u", IRIS_PASSWORD: "p" };

/** A governance file config holding a `dataPolicy` section, parsed by the real file parser. */
function fileWith(dataPolicy: unknown, path = "/tmp/policy.json"): GovernanceConfig {
  return parseGovernanceFileText(JSON.stringify({ dataPolicy }), path);
}

describe("the policy values", () => {
  it("are block, redact and allow, from the strictest to the loosest", () => {
    expect([...DATA_POLICIES]).toEqual(["block", "redact", "allow"]);
  });

  it("parseDataPolicyValue accepts each value in any letter case and stores it in lowercase", () => {
    expect(parseDataPolicyValue("block")).toBe("block");
    expect(parseDataPolicyValue("BLOCK")).toBe("block");
    expect(parseDataPolicyValue("Redact")).toBe("redact");
    expect(parseDataPolicyValue("aLLoW")).toBe("allow");
  });

  it("parseDataPolicyValue rejects anything else, a non-string included", () => {
    for (const bad of ["", "open", " block", "block ", "none", 3, true, null, undefined, {}, ["block"]]) {
      expect(parseDataPolicyValue(bad), JSON.stringify(bad)).toBeUndefined();
    }
  });

  it("effectiveDataPolicy is redact for a config without one", () => {
    expect(effectiveDataPolicy({})).toBe("redact");
    expect(effectiveDataPolicy({ dataPolicy: "allow" })).toBe("allow");
    expect(effectiveDataPolicy({ dataPolicy: "block" })).toBe("block");
  });
});

describe("IRIS_DATA_POLICY", () => {
  it("is unset, or empty, when the variable is unset or the empty string", () => {
    expect(parseOperatorDataPolicy({})).toBeUndefined();
    expect(parseOperatorDataPolicy({ IRIS_DATA_POLICY: "" })).toBeUndefined();
  });

  it("is case-insensitive and stored in lowercase", () => {
    expect(parseOperatorDataPolicy({ IRIS_DATA_POLICY: "BLOCK" })).toBe("block");
    expect(parseOperatorDataPolicy({ IRIS_DATA_POLICY: "Allow" })).toBe("allow");
  });

  it("fails fast naming the variable, with the value received", () => {
    expect(() => parseOperatorDataPolicy({ IRIS_DATA_POLICY: "open" })).toThrow(
      'IRIS_DATA_POLICY must be "block", "redact" or "allow". Received: "open".',
    );
  });
});

describe("precedence (AD-9, mirroring AD-6): the first value found wins", () => {
  const profile = (extra: Record<string, unknown> = {}) => {
    const registry = buildProfileRegistry(
      loadConfig(CONNECTION_ENV),
      { ...CONNECTION_ENV, IRIS_PROFILES: JSON.stringify({ p: extra }) },
    );
    return registry.get("p")!;
  };
  const file = fileWith({ global: "allow", profiles: { p: "allow" } });

  it("the IRIS_PROFILES entry beats the operator variable and both file layers", () => {
    expect(resolveDataPolicy(profile({ dataPolicy: "block" }), "allow", file)).toEqual({
      policy: "block",
      source: "IRIS_PROFILES",
    });
  });

  it("IRIS_DATA_POLICY beats the file's profile and global values", () => {
    expect(resolveDataPolicy(profile(), "block", file)).toEqual({ policy: "block", source: "IRIS_DATA_POLICY" });
  });

  it("the file's profile value beats its global value", () => {
    const layered = fileWith({ global: "block", profiles: { p: "allow" } });
    expect(resolveDataPolicy(profile(), undefined, layered)).toEqual({
      policy: "allow",
      source: "IRIS_GOVERNANCE_FILE:profiles",
    });
  });

  it("the file's global value applies to a profile it does not name", () => {
    const layered = fileWith({ global: "block", profiles: { other: "allow" } });
    expect(resolveDataPolicy(profile(), undefined, layered)).toEqual({
      policy: "block",
      source: "IRIS_GOVERNANCE_FILE:global",
    });
  });

  it("falls to redact from default when no channel names a value", () => {
    expect(resolveDataPolicy(profile(), undefined, undefined)).toEqual({ policy: "redact", source: "default" });
    expect(resolveDataPolicy(profile(), undefined, {})).toEqual({ policy: "redact", source: "default" });
    expect(resolveDataPolicy(profile(), undefined, fileWith({}))).toEqual({ policy: "redact", source: "default" });
  });

  it("removing one layer at a time walks down the whole order", () => {
    const order: Array<[DataPolicy | undefined, GovernanceConfig | undefined, string, DataPolicy]> = [];
    const full = fileWith({ global: "allow", profiles: { p: "allow" } });
    order.push(["allow", full, "IRIS_DATA_POLICY", "allow"]);
    order.push([undefined, full, "IRIS_GOVERNANCE_FILE:profiles", "allow"]);
    order.push([undefined, fileWith({ global: "allow" }), "IRIS_GOVERNANCE_FILE:global", "allow"]);
    order.push([undefined, undefined, "default", "redact"]);
    for (const [operator, fileConfig, source, policy] of order) {
      expect(resolveDataPolicy(profile(), operator, fileConfig), source).toEqual({ policy, source });
    }
  });

  it("a profile named like an Object.prototype member does not read the prototype", () => {
    const fileConfig: GovernanceConfig = { dataPolicy: { global: "block", profiles: {} } };
    const registry = new Map([
      ["constructor", { name: "constructor" }],
      ["toString", { name: "toString" }],
    ]);
    applyDataPolicies(registry, undefined, fileConfig);
    for (const name of ["constructor", "toString"]) {
      expect(registry.get(name), name).toMatchObject({ dataPolicy: "block", dataPolicySource: "IRIS_GOVERNANCE_FILE:global" });
    }
  });
});

describe("a default entry's value is never inherited (AD-9)", () => {
  it("applies to default only; a named profile falls through to the next channel", () => {
    const registry = buildProfileRegistry(loadConfig(CONNECTION_ENV), {
      ...CONNECTION_ENV,
      IRIS_PROFILES: JSON.stringify({ default: { dataPolicy: "allow" }, p: {} }),
    });
    applyDataPolicies(registry, undefined, undefined);
    expect(registry.get("default")).toMatchObject({ dataPolicy: "allow", dataPolicySource: "IRIS_PROFILES" });
    expect(registry.get("p")).toMatchObject({ dataPolicy: "redact", dataPolicySource: "default" });
  });

  it("a named profile with its own value does not leak it to default or to another profile", () => {
    const registry = buildProfileRegistry(loadConfig(CONNECTION_ENV), {
      ...CONNECTION_ENV,
      IRIS_PROFILES: JSON.stringify({ p: { dataPolicy: "block" }, q: {} }),
    });
    applyDataPolicies(registry, "allow", undefined);
    expect(registry.get("p")).toMatchObject({ dataPolicy: "block", dataPolicySource: "IRIS_PROFILES" });
    expect(registry.get("q")).toMatchObject({ dataPolicy: "allow", dataPolicySource: "IRIS_DATA_POLICY" });
    expect(registry.get("default")).toMatchObject({ dataPolicy: "allow", dataPolicySource: "IRIS_DATA_POLICY" });
  });

  it("a profile that came from outside IRIS_PROFILES (Server Manager) takes the file's profile value", () => {
    const base = loadConfig(CONNECTION_ENV);
    const registry = new Map([["sm", mergeProfile("sm", base, { host: "sm.example.com" }, "settings", "server-manager")]]);
    applyDataPolicies(registry, undefined, fileWith({ profiles: { sm: "block" } }));
    expect(registry.get("sm")).toMatchObject({ dataPolicy: "block", dataPolicySource: "IRIS_GOVERNANCE_FILE:profiles" });
  });

  it("applyDataPolicies is idempotent and changes the registry in place", () => {
    const registry = buildProfileRegistry(loadConfig(CONNECTION_ENV), {
      ...CONNECTION_ENV,
      IRIS_PROFILES: JSON.stringify({ p: { dataPolicy: "allow" } }),
    });
    expect(registry.get("default")).not.toHaveProperty("dataPolicy");
    applyDataPolicies(registry, "block", undefined);
    expect(registry.get("default")).toMatchObject({ dataPolicy: "block", dataPolicySource: "IRIS_DATA_POLICY" });
    expect(registry.get("p")).toMatchObject({ dataPolicy: "allow", dataPolicySource: "IRIS_PROFILES" });
    const once = [...registry.entries()];
    applyDataPolicies(registry, "block", undefined);
    expect([...registry.entries()]).toEqual(once);
  });
});

describe("tightenDataPolicy (AD-9): a caller only tightens", () => {
  it("clamps a looser request to the operator's policy and says so", () => {
    expect(tightenDataPolicy("redact", "allow")).toEqual({ policy: "redact", clamped: true });
    expect(tightenDataPolicy("block", "redact")).toEqual({ policy: "block", clamped: true });
    expect(tightenDataPolicy("block", "allow")).toEqual({ policy: "block", clamped: true });
  });

  it("takes a stricter request", () => {
    expect(tightenDataPolicy("redact", "block")).toEqual({ policy: "block", clamped: false });
    expect(tightenDataPolicy("allow", "redact")).toEqual({ policy: "redact", clamped: false });
    expect(tightenDataPolicy("allow", "block")).toEqual({ policy: "block", clamped: false });
  });

  it("keeps the operator's policy when the request is the same or absent", () => {
    expect(tightenDataPolicy("redact")).toEqual({ policy: "redact", clamped: false });
    expect(tightenDataPolicy("redact", "redact")).toEqual({ policy: "redact", clamped: false });
    expect(tightenDataPolicy("allow", "allow")).toEqual({ policy: "allow", clamped: false });
  });
});

describe("the body-kind classifier's vocabulary", () => {
  it("holds the nine tokens MessageSearch.BodyKind returns", () => {
    expect([...BODY_KINDS].sort()).toEqual(
      ["hl7v2", "literal", "missing", "other", "persistent", "stream", "streamContainer", "vdoc", "xmlvdoc"].sort(),
    );
    expect(BODY_KINDS).toHaveLength(9);
  });

  it("isBodyKind accepts exactly those tokens", () => {
    for (const kind of BODY_KINDS) expect(isBodyKind(kind), kind).toBe(true);
    for (const bad of ["HL7V2", "hl7", "", "xml", undefined, null, 1]) expect(isBodyKind(bad), String(bad)).toBe(false);
  });

  it("only hl7v2 is redactable", () => {
    for (const kind of BODY_KINDS) expect(isRedactableBodyKind(kind), kind).toBe(kind === "hl7v2");
  });
});

describe("the fixed block reasons", () => {
  it("are exactly these five texts", () => {
    expect(HL7_BODY_TEXT_MAX_CHARS).toBe(65536);
    expect(BLOCK_REASONS.blockPolicy()).toBe("The block data policy withholds every message body.");
    expect(BLOCK_REASONS.unredactableKind("stream")).toBe(
      "A stream body cannot be redacted reliably, so the redact data policy withholds it.",
    );
    expect(BLOCK_REASONS.unredactableKind("other")).toBe(
      "A other body cannot be redacted reliably, so the redact data policy withholds it.",
    );
    expect(BLOCK_REASONS.hl7TooLarge()).toBe(
      "The HL7 v2 body is longer than 65536 characters, so the redact data policy withholds it.",
    );
    expect(BLOCK_REASONS.hl7Unreadable()).toBe(
      "The HL7 v2 body could not be read in full, so the redact data policy withholds it.",
    );
    expect(BLOCK_REASONS.hl7Unparseable("The text does not start with an MSH, FHS or BHS segment.")).toBe(
      "The HL7 v2 body could not be parsed (The text does not start with an MSH, FHS or BHS segment.), so the redact data policy withholds it.",
    );
  });
});

describe("decideBodyPolicy (Story 39.5, AD-26): the policy's decision for one body", () => {
  it("decides every kind x availability x policy combination", () => {
    // The expected plan is written out per policy, not derived from the function, so a rule that moves fails here.
    for (const kind of BODY_KINDS) {
      for (const policy of DATA_POLICIES) {
        const unavailable = decideBodyPolicy(kind, false, policy);
        expect(unavailable, `${kind} unavailable under ${policy}`).toEqual({ outcome: "none" });

        const available = decideBodyPolicy(kind, true, policy);
        if (policy === "block") {
          expect(available, `${kind} under block`).toEqual({ outcome: "blocked", reason: BLOCK_REASONS.blockPolicy() });
        } else if (policy === "redact" && kind === "hl7v2") {
          expect(available, "hl7v2 under redact").toEqual({ outcome: "redact" });
        } else if (policy === "redact") {
          expect(available, `${kind} under redact`).toEqual({
            outcome: "blocked",
            reason: BLOCK_REASONS.unredactableKind(kind),
          });
        } else {
          expect(available, `${kind} under allow`).toEqual({ outcome: "none" });
        }
      }
    }
  });

  it("decides an unavailable body before it looks at the policy (a block policy withholds nothing that is not there)", () => {
    expect(decideBodyPolicy("stream", false, "block")).toEqual({ outcome: "none" });
    expect(decideBodyPolicy("missing", false, "redact")).toEqual({ outcome: "none" });
  });

  it("names the kind in the redact reason and nothing else of the body", () => {
    const plan = decideBodyPolicy("persistent", true, "redact");
    expect(plan).toEqual({
      outcome: "blocked",
      reason: "A persistent body cannot be redacted reliably, so the redact data policy withholds it.",
    });
  });
});

describe("the IRIS_PROFILES dataPolicy field", () => {
  const base = loadConfig(CONNECTION_ENV);

  it("is stored in lowercase with the IRIS_PROFILES source, and only for the entry that sets it", () => {
    const profile = mergeProfile("p", base, { dataPolicy: "ALLOW" });
    expect(profile.dataPolicy).toBe("allow");
    expect(profile.dataPolicySource).toBe("IRIS_PROFILES");
    const plain = mergeProfile("q", base, {});
    expect("dataPolicy" in plain).toBe(false);
    expect("dataPolicySource" in plain).toBe(false);
  });

  it("is not inherited from the base config", () => {
    const profile = mergeProfile("p", { ...base, dataPolicy: "allow", dataPolicySource: "IRIS_PROFILES" }, {});
    expect("dataPolicy" in profile).toBe(false);
  });

  it("fails fast naming the profile and the field, and never echoes the value", () => {
    expect(() => mergeProfile("p", base, { dataPolicy: 3 })).toThrow(
      'IRIS_PROFILES is invalid: profile "p": "dataPolicy" must be "block", "redact" or "allow".',
    );
    let message = "";
    try {
      mergeProfile("p", base, { dataPolicy: "SYNTHPHI-HOSTILE" });
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toContain('"dataPolicy"');
    expect(message).not.toContain("SYNTHPHI-HOSTILE");
  });
});

describe("the governance file's dataPolicy section", () => {
  const path = "/tmp/policy.json";

  it("parses global and profiles, in any letter case, stored in lowercase", () => {
    const config = fileWith({ global: "BLOCK", profiles: { a: "Allow", b: "redact" } });
    expect(config.dataPolicy?.global).toBe("block");
    expect({ ...config.dataPolicy?.profiles }).toEqual({ a: "allow", b: "redact" });
  });

  it("accepts either member alone, or an empty object", () => {
    expect(fileWith({ global: "allow" }).dataPolicy).toEqual({ global: "allow" });
    expect({ ...fileWith({ profiles: { a: "block" } }).dataPolicy?.profiles }).toEqual({ a: "block" });
    expect(fileWith({}).dataPolicy).toEqual({});
  });

  it("a document without dataPolicy parses exactly as before", () => {
    const text = JSON.stringify({ global: { iris_doc_put: false }, comment: "x" });
    const config = parseGovernanceFileText(text, path);
    expect("dataPolicy" in config).toBe(false);
    expect({ ...config.global }).toEqual({ iris_doc_put: false });
  });

  it("names the key and never the value in each error", () => {
    const bad: Array<[unknown, string]> = [
      ["SYNTHPHI-string", '"dataPolicy" must be a JSON object'],
      [null, '"dataPolicy" must be a JSON object'],
      [["block"], '"dataPolicy" must be a JSON object'],
      [{ global: "SYNTHPHI-x" }, '"dataPolicy.global" must be "block", "redact" or "allow".'],
      [{ global: 3 }, '"dataPolicy.global" must be "block", "redact" or "allow".'],
      [{ extra: "SYNTHPHI-x" }, '"dataPolicy.extra" is not a recognized key. Use "global" and "profiles".'],
      [{ profiles: "block" }, '"dataPolicy.profiles" must be a JSON object'],
      [{ profiles: { p: "SYNTHPHI-x" } }, '"dataPolicy.profiles.p" must be "block", "redact" or "allow".'],
      [{ profiles: { "": "block" } }, "profile names must be non-empty strings"],
    ];
    for (const [section, expected] of bad) {
      let message = "";
      try {
        fileWith(section, path);
      } catch (error) {
        message = (error as Error).message;
      }
      expect(message, JSON.stringify(section)).toContain(`IRIS_GOVERNANCE_FILE is invalid: `);
      expect(message, JSON.stringify(section)).toContain(expected);
      expect(message, JSON.stringify(section)).toContain(`(path: ${path})`);
      expect(message, JSON.stringify(section)).not.toContain("SYNTHPHI");
    }
  });

  it("rejects a reserved profile name", () => {
    expect(() => parseGovernanceFileText('{"dataPolicy":{"profiles":{"__proto__":"block"}}}', path)).toThrow(
      /reserved key/,
    );
  });

  it("IRIS_GOVERNANCE rejects the key, whatever its value, and points to the right channels", () => {
    const expected =
      'IRIS_GOVERNANCE is invalid: "dataPolicy" is read only from IRIS_GOVERNANCE_FILE. Set IRIS_DATA_POLICY for every profile, or "dataPolicy" on an IRIS_PROFILES entry for one.';
    for (const value of [{}, { global: "block" }, "block", 3, null]) {
      expect(() => parseGovernanceConfig({ IRIS_GOVERNANCE: JSON.stringify({ dataPolicy: value }) }), JSON.stringify(value)).toThrow(
        expected,
      );
    }
  });

  it("an unknown profile name under dataPolicy.profiles warns, naming the name and the section", () => {
    const config = fileWith({ profiles: { ghost: "block", default: "allow" } });
    const warnings = unknownProfileWarnings(config, "IRIS_GOVERNANCE_FILE (path: /tmp/policy.json)", ["default"]);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('"ghost"');
    expect(warnings[0]).toContain("dataPolicy.profiles");
  });
});
