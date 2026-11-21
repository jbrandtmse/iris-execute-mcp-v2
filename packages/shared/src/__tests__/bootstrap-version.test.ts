import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { classifyDeployedMarker, parseBootstrapMarker } from "../bootstrap-version.js";

// The expected values below are the rows of the Story 42.2 I/O matrix and the ordering rule of AD-14
// (semver first, then sequence; equal semver and sequence with another hash, `dev` and anything
// unparseable are foreign; a bare 12-hex marker is older). The embedded marker is a literal, so the
// table does not move when the generator moves the real one.

const EMBEDDED = "0.0.2+1.995fbbb1055d";
const HASH = "995fbbb1055d";
const OTHER_HASH = "0123456789ab";

describe("parseBootstrapMarker", () => {
  it("reads a stamped marker into its semver, sequence and hash", () => {
    expect(parseBootstrapMarker(EMBEDDED)).toEqual({
      kind: "stamped",
      semver: [0n, 0n, 2n],
      sequence: 1n,
      hash: HASH,
    });
    expect(parseBootstrapMarker(`12.345.6789+10.${OTHER_HASH}`)).toEqual({
      kind: "stamped",
      semver: [12n, 345n, 6789n],
      sequence: 10n,
      hash: OTHER_HASH,
    });
  });

  it("reads a bare 12-hex marker as legacy", () => {
    expect(parseBootstrapMarker(HASH)).toEqual({ kind: "legacy", hash: HASH });
    expect(parseBootstrapMarker("000000000000")).toEqual({ kind: "legacy", hash: "000000000000" });
  });

  it("reads numbers past Number.MAX_SAFE_INTEGER exactly", () => {
    expect(parseBootstrapMarker(`1.2.3+9007199254740993.${HASH}`)).toEqual({
      kind: "stamped",
      semver: [1n, 2n, 3n],
      sequence: 9007199254740993n,
      hash: HASH,
    });
  });

  it.each([
    ["the empty string", ""],
    ["the source placeholder", "dev"],
    ["a word", "not a marker"],
    ["an uppercase hash", `0.0.2+1.${HASH.toUpperCase()}`],
    ["a hash of 11 characters", `0.0.2+1.${HASH.slice(1)}`],
    ["a hash of 13 characters", `0.0.2+1.${HASH}0`],
    ["a bare hash of 11 characters", HASH.slice(1)],
    ["a bare hash of 13 characters", `${HASH}0`],
    ["a bare uppercase hash", HASH.toUpperCase()],
    ["a bare hash with a non-hex digit", "995fbbb1055g"],
    ["a marker without a sequence", `0.0.2+${HASH}`],
    ["a marker without a hash", "0.0.2+1"],
    ["a marker with the old separator", `0.0.2+1-${HASH}`],
    ["a pre-release semver", `0.0.2-beta.1+1.${HASH}`],
    ["a two-part semver", `0.2+1.${HASH}`],
    ["a four-part semver", `0.0.0.2+1.${HASH}`],
    ["a leading v", `v0.0.2+1.${HASH}`],
    ["a negative number", `0.0.-2+1.${HASH}`],
    ["a leading space", ` ${EMBEDDED}`],
    ["a trailing newline", `${EMBEDDED}\n`],
    ["a trailing space", `${EMBEDDED} `],
    ["two markers", `${EMBEDDED} ${EMBEDDED}`],
  ])("reads %s as unparseable", (_label, raw) => {
    expect(parseBootstrapMarker(raw)).toEqual({ kind: "unparseable", raw });
  });
});

describe("classifyDeployedMarker", () => {
  it.each([
    ["exactly the embedded marker", EMBEDDED, "current"],
    ["leading zeros that change no number", `0.0.02+01.${HASH}`, "current"],

    ["a legacy bare hash (a build from before the sequence)", OTHER_HASH, "older"],
    ["a legacy bare hash equal to the embedded hash", HASH, "older"],
    ["a lower patch", `0.0.1+1.${HASH}`, "older"],
    ["the same semver and a lower sequence", `0.0.2+0.${HASH}`, "older"],
    ["the same semver and a lower sequence with another hash", `0.0.2+0.${OTHER_HASH}`, "older"],
    ["a lower semver with a much higher sequence (semver dominates)", `0.0.1+999.${OTHER_HASH}`, "older"],
    ["a patch of zero", `0.0.0+1.${HASH}`, "older"],

    ["a higher patch", `0.0.3+1.${HASH}`, "newer"],
    ["a higher minor", `0.1.0+1.${HASH}`, "newer"],
    ["a higher major", `1.0.0+1.${HASH}`, "newer"],
    ["the same semver and a higher sequence", `0.0.2+2.${HASH}`, "newer"],
    ["the same semver and a higher sequence with another hash", `0.0.2+2.${OTHER_HASH}`, "newer"],
    ["a higher semver with a lower sequence (semver dominates)", `0.0.3+0.${OTHER_HASH}`, "newer"],
    ["a patch of two digits (numeric, not lexicographic)", `0.0.10+1.${HASH}`, "newer"],
    ["a sequence of two digits (numeric, not lexicographic)", `0.0.2+10.${HASH}`, "newer"],
    ["a sequence one above Number.MAX_SAFE_INTEGER", `0.0.2+9007199254740993.${HASH}`, "newer"],

    ["the same semver and sequence with a different hash", `0.0.2+1.${OTHER_HASH}`, "foreign"],
    ["the dev placeholder", "dev", "foreign"],
    ["the empty string", "", "foreign"],
    ["an unparseable word", "garbage", "foreign"],
    ["an uppercase hash", `0.0.2+2.${HASH.toUpperCase()}`, "foreign"],
    ["a pre-release marker", `0.0.3-beta+2.${HASH}`, "foreign"],
    ["a marker with a trailing newline", `${EMBEDDED}\n`, "foreign"],
  ])("deployed %s is %s", (_label, deployed, expected) => {
    expect(classifyDeployedMarker(deployed, EMBEDDED)).toBe(expected);
  });

  it("orders sequences past Number.MAX_SAFE_INTEGER that a Number would see as equal", () => {
    const embedded = `0.0.2+9007199254740992.${HASH}`;

    expect(classifyDeployedMarker(`0.0.2+9007199254740993.${HASH}`, embedded)).toBe("newer");
    expect(classifyDeployedMarker(`0.0.2+9007199254740991.${HASH}`, embedded)).toBe("older");
    expect(classifyDeployedMarker(`0.0.2+9007199254740992.${HASH}`, embedded)).toBe("current");
  });

  it("is antisymmetric over stamped markers: newer one way is older the other way, and equal sequence with another hash is foreign both ways", () => {
    const markers = [
      `0.0.1+1.${HASH}`,
      `0.0.1+5.${OTHER_HASH}`,
      `0.0.2+0.${HASH}`,
      `0.0.2+1.${HASH}`,
      `0.0.2+1.${OTHER_HASH}`,
      `0.0.2+2.${HASH}`,
      `0.0.10+1.${HASH}`,
      `0.1.0+0.${HASH}`,
      `1.0.0+0.${HASH}`,
    ];
    const opposite = { current: "current", older: "newer", newer: "older", foreign: "foreign" } as const;

    for (const a of markers) {
      for (const b of markers) {
        const forward = classifyDeployedMarker(a, b);
        expect(classifyDeployedMarker(b, a), `${a} against ${b}`).toBe(opposite[forward]);
      }
    }
  });

  it("is reflexive: any marker is current against itself, including the placeholder and garbage", () => {
    for (const marker of [EMBEDDED, HASH, "dev", "", "garbage"]) {
      expect(classifyDeployedMarker(marker, marker), marker).toBe("current");
    }
  });

  it("cannot order anything against an embedded marker that is not stamped: identical is current, anything else is foreign", () => {
    expect(classifyDeployedMarker("dev", "dev")).toBe("current");
    expect(classifyDeployedMarker(EMBEDDED, "dev")).toBe("foreign");
    expect(classifyDeployedMarker(HASH, "dev")).toBe("foreign");
    expect(classifyDeployedMarker(OTHER_HASH, HASH)).toBe("foreign");
    expect(classifyDeployedMarker("", "dev")).toBe("foreign");
  });

  it("a version bump with no class change (same hash, same sequence, higher semver) is newer than the old marker, and the old one is older", () => {
    const released = `0.0.3+1.${HASH}`;

    expect(classifyDeployedMarker(EMBEDDED, released)).toBe("older");
    expect(classifyDeployedMarker(released, EMBEDDED)).toBe("newer");
  });
});

// DW-674 (Story 42.4): the IPM install guard ports `classifyDeployedMarker` to ObjectScript, because the IPM install path
// has no TypeScript. This table is the oracle both sides run: `ExecuteMCPv2.InstallGuard.Classify` is held equal to it on
// the throwaway IRIS editions by `scripts/ci-ipm-archive.mjs`, and the TypeScript side is pinned to it here.
//
// Every `expected` was captured by running the reference, not by hand (Rule #36): `classifyDeployedMarker(deployed, embedded)`
// of the built packages/shared/dist/bootstrap-version.js (bootstrap-version.ts as of commit 4fd0acb, @iris-mcp/shared 0.0.2), over
// each case's pair, with this command from the repository root (it prints the case count and 0 mismatches):
//   node --input-type=module -e "import { readFileSync } from 'node:fs'; import { classifyDeployedMarker } from './packages/shared/dist/bootstrap-version.js'; const cases = JSON.parse(readFileSync('packages/shared/src/__tests__/fixtures/bootstrap-marker-parity-cases.json', 'utf8')); let bad = 0; for (const c of cases) { const got = classifyDeployedMarker(c.deployed, c.embedded); if (got !== c.expected) { bad++; console.log('MISMATCH', c.note, got, c.expected); } } console.log(cases.length, 'cases,', bad, 'mismatches');"
// A new case takes its `expected` from the same command's output. Non-ASCII digits appear in the JSON as backslash-u escapes (Rule 14).
interface ParityCase {
  note: string;
  deployed: string;
  embedded: string;
  expected: string;
}

const PARITY_CASES = JSON.parse(
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), "fixtures", "bootstrap-marker-parity-cases.json"), "utf8"),
) as ParityCase[];

describe("the shared parity case table (DW-674)", () => {
  it.each(PARITY_CASES.map((entry, index) => ({ ...entry, index })))(
    "case $index ($note): the comparator says $expected",
    ({ deployed, embedded, expected }) => {
      expect(classifyDeployedMarker(deployed, embedded)).toBe(expected);
    },
  );

  it("is a table of at least 40 cases whose fields are all strings and whose notes are unique", () => {
    expect(PARITY_CASES.length).toBeGreaterThanOrEqual(40);
    for (const entry of PARITY_CASES) {
      expect(Object.keys(entry).sort()).toEqual(["deployed", "embedded", "expected", "note"]);
      for (const value of Object.values(entry)) expect(typeof value).toBe("string");
    }
    expect(new Set(PARITY_CASES.map((entry) => entry.note)).size).toBe(PARITY_CASES.length);
  });

  it("covers every classification and every parse kind, in both roles, plus a number past 2^53 and a non-ASCII digit", () => {
    expect(new Set(PARITY_CASES.map((entry) => entry.expected))).toEqual(new Set(["current", "older", "newer", "foreign"]));
    for (const role of ["deployed", "embedded"] as const) {
      const kinds = new Set(PARITY_CASES.map((entry) => parseBootstrapMarker(entry[role]).kind));
      // The comparator only reads a legacy deployed marker; an embedded legacy marker is covered as a role of its own.
      expect(kinds, `${role} markers`).toEqual(new Set(["stamped", "legacy", "unparseable"]));
    }
    expect(
      PARITY_CASES.some((entry) =>
        [entry.deployed, entry.embedded].some((marker) => /\d{16,}/.test(marker) && Number(/\d{16,}/.exec(marker)?.[0]) > Number.MAX_SAFE_INTEGER),
      ),
      "a case with a number past 2^53",
    ).toBe(true);
    expect(
      PARITY_CASES.some((entry) => /\d{20,}/.test(entry.deployed) || /\d{20,}/.test(entry.embedded)),
      "a case with a number past 19 digits",
    ).toBe(true);
    expect(
      PARITY_CASES.some((entry) => /[\u0080-\uFFFF]/.test(entry.deployed + entry.embedded)),
      "a case with a non-ASCII digit",
    ).toBe(true);
    for (const wanted of ["dev", "", " 1.2.3+4.aaaaaaaaaaaa", "1.2.3+4.aaaaaaaaaaaa\n", "1.2.3-beta.1+4.aaaaaaaaaaaa"]) {
      expect(
        PARITY_CASES.some((entry) => entry.deployed === wanted),
        `a case with the deployed value ${JSON.stringify(wanted)}`,
      ).toBe(true);
    }
    expect(PARITY_CASES.some((entry) => /^[0-9a-f]{11}$/.test(entry.deployed)), "an 11-hex legacy marker").toBe(true);
    expect(PARITY_CASES.some((entry) => /^[0-9a-f]{13}$/.test(entry.deployed)), "a 13-hex legacy marker").toBe(true);
    expect(PARITY_CASES.some((entry) => /[A-F]{12}/.test(entry.deployed)), "an uppercase hash").toBe(true);
  });

  it("holds no literal non-ASCII character: the JSON carries escapes (Rule 14)", () => {
    const raw = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "fixtures", "bootstrap-marker-parity-cases.json"), "utf8");
    expect(/[\u0080-\uFFFF]/.test(raw)).toBe(false);
    expect(raw).toContain("\\u0661");
  });
});
