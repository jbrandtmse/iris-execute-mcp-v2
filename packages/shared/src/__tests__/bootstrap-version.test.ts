import { describe, it, expect } from "vitest";
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
