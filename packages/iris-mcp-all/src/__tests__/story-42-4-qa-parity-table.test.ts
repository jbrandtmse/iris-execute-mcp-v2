/**
 * Story 42.4 (DW-674, the IRIS-side guard and parity; Rule #51) -- the shared parity case table keeps the cases that hold the ObjectScript port
 * `ExecuteMCPv2.InstallGuard.Classify` to `classifyDeployedMarker`. The port has no default-suite host: its only oracle is this table, which
 * `scripts/ci-ipm-archive.mjs` runs inside real IRIS containers of both editions. A table without the boundary cases below lets a port that
 * accepts one character too many, or too few, in the digit and hex checks pass every parity run. Pinned here:
 *  - the ASCII neighbours of the digit range ("/" is 47, ":" is 58) in the first and the last numeric field, a bad character AFTER a good digit,
 *    and the neighbours of the hex range ("/" before 0, ":" after 9, a backtick before a) as the last character of a stamped hash and of a bare
 *    marker, a bad FIRST character of each, and a hash made of the letter f, which is the top of the hex range;
 *  - a third dot-separated part after the hash, the same neighbours in an EMBEDDED marker (which then orders nothing), a NUL and a Latin-1 letter;
 *  - the Story 42.4 CHANGELOG section states the 91 cases the table held then (counted from the file, Rule #51), and the table never
 *    holds fewer; a later story that adds cases states its own count, so this history line stays true.
 * Needs no IRIS and no built dist: it reads the fixture and the CHANGELOG.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { REPO_ROOT } from "../../../../scripts/lib/live-gate-scan.mjs";

interface ParityCase {
  note: string;
  deployed: string;
  embedded: string;
  expected: string;
}

const FIXTURE_FILE = path.join(REPO_ROOT, "packages", "shared", "src", "__tests__", "fixtures", "bootstrap-marker-parity-cases.json");
const CASES = JSON.parse(readFileSync(FIXTURE_FILE, "utf8")) as ParityCase[];

/** The embedded marker of every case below unless a probe names another. */
const E = "1.2.3+4.aaaaaaaaaaaa";

type Pattern = string | RegExp;
interface Probe {
  title: string;
  deployed: Pattern;
  embedded?: Pattern;
  expected: string;
}

const matches = (value: string, pattern: Pattern): boolean => (typeof pattern === "string" ? value === pattern : pattern.test(value));

const PROBES: readonly Probe[] = [
  // The digit check (IsDigits): the characters either side of 0-9, at the start and at the end of the numbers.
  { title: 'the character before 0 ("/") as the major', deployed: /^\/\.2\.3\+4\.a{12}$/, expected: "foreign" },
  { title: 'the character after 9 (":") as the major', deployed: /^:\.2\.3\+4\.a{12}$/, expected: "foreign" },
  { title: 'the character before 0 ("/") as the sequence', deployed: /^1\.2\.3\+\/\.a{12}$/, expected: "foreign" },
  { title: 'the character after 9 (":") as the sequence', deployed: /^1\.2\.3\+:\.a{12}$/, expected: "foreign" },
  { title: "a bad character after a good digit in the major", deployed: /^1x\.2\.3\+4\.a{12}$/, expected: "foreign" },
  { title: "a bad character after a good digit in the sequence", deployed: /^1\.2\.3\+4x\.a{12}$/, expected: "foreign" },
  // The hash check (IsHash) in a stamped marker.
  { title: 'the character before 0 ("/") as the last character of a stamped hash', deployed: /^1\.2\.2\+4\.a{11}\/$/, expected: "foreign" },
  { title: 'the character after 9 (":") as the last character of a stamped hash', deployed: /^1\.2\.2\+4\.a{11}:$/, expected: "foreign" },
  { title: "the character before a (a backtick) as the last character of a stamped hash", deployed: /^1\.2\.2\+4\.a{11}`$/, expected: "foreign" },
  { title: 'a bad first character ("/") of a stamped hash', deployed: /^1\.2\.2\+4\.\/a{11}$/, expected: "foreign" },
  { title: "a stamped hash of the letter f, the top of the hex range, is a hash", deployed: /^1\.2\.2\+4\.f{12}$/, expected: "older" },
  // The same check on a bare marker (a build that predates the sequence).
  { title: 'the character before 0 ("/") as the last character of a bare marker', deployed: /^a{11}\/$/, expected: "foreign" },
  { title: 'the character after 9 (":") as the last character of a bare marker', deployed: /^a{11}:$/, expected: "foreign" },
  { title: "the character before a (a backtick) as the last character of a bare marker", deployed: /^a{11}`$/, expected: "foreign" },
  { title: 'a bad first character ("/") of a bare marker', deployed: /^\/a{11}$/, expected: "foreign" },
  { title: "a bare marker of the letter f is a legacy marker", deployed: /^f{12}$/, expected: "older" },
  // The shape of the grammar.
  { title: "a third dot-separated part after the hash", deployed: /^1\.2\.3\+4\.a{12}\.5$/, expected: "foreign" },
  // An embedded marker that cannot be parsed orders nothing.
  { title: 'the character after 9 (":") ending the embedded hash', deployed: /^1\.2\.3\+3\.a{12}$/, embedded: /^1\.2\.3\+4\.a{11}:$/, expected: "foreign" },
  { title: 'the character after 9 (":") as the embedded sequence', deployed: /^1\.2\.3\+3\.a{12}$/, embedded: /^1\.2\.3\+:\.a{12}$/, expected: "foreign" },
  // Characters that are not letters of another script.
  { title: "a NUL character as the last character of a hash", deployed: "1.2.2+4.aaaaaaaaaaa\u0000", expected: "foreign" },
  { title: "a Latin-1 letter (U+00E9) as the last character of a hash", deployed: "1.2.2+4.aaaaaaaaaaa\u00e9", expected: "foreign" },
];

describe("the shared parity case table keeps its boundary cases (DW-674)", () => {
  it.each(PROBES)("holds a case for $title", ({ deployed, embedded, expected }) => {
    const found = CASES.filter((entry) => matches(entry.deployed, deployed) && matches(entry.embedded, embedded ?? E));
    expect(found.length, "a case with this deployed and embedded marker").toBeGreaterThan(0);
    for (const entry of found) expect(entry.expected, entry.note).toBe(expected);
  });

  it("states in the Story 42.4 CHANGELOG section the 91 cases the table held, and the table holds at least that many (Rule #51)", () => {
    const changelog = readFileSync(path.join(REPO_ROOT, "CHANGELOG.md"), "utf8");
    const start = changelog.indexOf("Story 42.4: IPM Package Revival");
    expect(start, "the CHANGELOG has the Story 42.4 section").toBeGreaterThanOrEqual(0);
    const next = changelog.indexOf("\n## ", start);
    const section = changelog.slice(start, next < 0 ? undefined : next);
    const stated = /parity table of (\d+) cases/.exec(section)?.[1];
    expect(stated, "the section states a case count").toBeDefined();
    expect(Number(stated), "the Story 42.4 section states the 91 cases of the table it shipped").toBe(91);
    expect(CASES.length, `the CHANGELOG states ${stated} cases; the fixture holds ${CASES.length}`).toBeGreaterThanOrEqual(Number(stated));
  });
});
