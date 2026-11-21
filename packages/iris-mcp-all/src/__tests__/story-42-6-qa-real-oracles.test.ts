/**
 * Story 42.6 (DW-696, AC 42.6.3; Rule #36) -- the answers the main-reachability gate and the registry check read, captured from the real
 * systems rather than shaped by the implementation.
 *
 * Compare bodies. Captured on 2026-11-21 with the read-only
 *   gh api -X GET "repos/jbrandtmse/iris-execute-mcp-v2/compare/main...<sha>?per_page=1" --jq '{status,ahead_by,behind_by,total_commits}'
 * for the `main` commit 9a2f515 (identical), the `epic42` commit 7626c7b (ahead), `main~5` b79a173 (behind), and the unknown sha
 * 0000000000000000000000000000000000000001 (HTTP 404, whose whole body is kept). Only the four counters are kept from a 200 body.
 *
 * `npm view` transcripts. Captured on 2026-11-21 with npm 11 and the read-only
 *   npm view @modelcontextprotocol/server@2.4.0 version dist.attestations --json     (a package published with provenance)
 *   npm view lodash@4.17.21 version dist.attestations --json                         (a version published with no attestation)
 *   npm view @iris-mcp/shared@1.0.0 version dist.attestations --json                 (a name that is not on the registry: exit 1)
 * `npm view` prints the registry's JSON error on stdout and its own text on stderr when it fails.
 *
 * The rows feed the pure functions and the whole `ci-gate` run, so a gate that only passed against bodies its own author shaped fails here.
 */

import { describe, expect, it } from "vitest";
import { ciGate, defaultDeps } from "../../../../scripts/release.mjs";
import { mainReachability, registryProblems } from "../../../../scripts/lib/release-core.mjs";
import { SHA, fakeFetch, newFakeGithub, type FakeAnswer } from "./release-script-fixtures";

const MAIN_SHA = "9a2f515028781a2f5d950bef4ad6f8af86c552a8";
const EPIC_SHA = "7626c7b2c55aac5dab51678647e60f6a56621190";
const BEHIND_SHA = "b79a1730c8f0f1969553427dd025f7277885c50e";
const UNKNOWN_SHA = "0000000000000000000000000000000000000001";

const COMPARE: Record<string, FakeAnswer> = {
  identical: { status: 200, body: { ahead_by: 0, behind_by: 0, status: "identical", total_commits: 0 } },
  ahead: { status: 200, body: { ahead_by: 115, behind_by: 0, status: "ahead", total_commits: 115 } },
  behind: { status: 200, body: { ahead_by: 0, behind_by: 292, status: "behind", total_commits: 0 } },
  unknown: { status: 404, body: { message: "Not Found", documentation_url: "https://docs.github.com/rest/commits/commits#compare-two-commits", status: "404" } },
};

describe("the real compare answers (captured 2026-11-21)", () => {
  it.each([
    ["identical", MAIN_SHA, "on-main"],
    ["behind", BEHIND_SHA, "on-main"],
    ["ahead", EPIC_SHA, "off-main"],
    ["unknown", UNKNOWN_SHA, "unreadable"],
  ])("%s: %s is %s", (name, sha, state) => {
    expect(mainReachability(COMPARE[name] as FakeAnswer, sha).state).toBe(state);
  });

  it("the unknown commit's refusal names HTTP 404 (the body's own status is a text, never read as a compare status)", () => {
    const answer = mainReachability(COMPARE["unknown"] as FakeAnswer, UNKNOWN_SHA);
    expect(answer.problem).toContain("(HTTP 404)");
    expect(answer.status).toBeUndefined();
  });

  it("the whole gate, on each captured body, refuses the two that are not on main before it reads CI, and lets the other two on to CI", async () => {
    for (const [name, expectedExit] of [["identical", 0], ["behind", 0], ["ahead", 1], ["unknown", 1]] as const) {
      const github = newFakeGithub();
      github.compare = COMPARE[name] as FakeAnswer;
      const lines: string[] = [];
      const deps = { ...defaultDeps(), fetch: fakeFetch(github), log: (line: string) => lines.push(line), now: () => 0, sleep: async () => undefined };
      const env = { GITHUB_EVENT_NAME: "push", GITHUB_REF: "refs/tags/v1.0.0", GITHUB_SHA: SHA, GITHUB_TOKEN: "ghs_unused", GITHUB_REPOSITORY: "o/r" };
      expect(await ciGate({ env }, deps), name).toBe(expectedExit);
      expect(github.requests.some((request) => request.includes("/actions/runs")), `${name}: CI read`).toBe(expectedExit === 0);
    }
  });
});

describe("the real npm view transcripts (captured 2026-11-21)", () => {
  const PROVENANCE_STDOUT = JSON.stringify({
    version: "2.4.0",
    "dist.attestations": { url: "https://registry.npmjs.org/-/npm/v1/attestations/@modelcontextprotocol%2fserver@2.4.0", provenance: { predicateType: "https://slsa.dev/provenance/v1" } },
  });
  const E404_STDERR = [
    "npm error code E404",
    "npm error 404 Not Found - GET https://registry.npmjs.org/@iris-mcp%2fshared - Not found",
    "npm error 404",
    "npm error 404  The requested resource '@iris-mcp/shared@1.0.0' could not be found or you do not have permission to access it.",
    "npm error 404",
    "npm error 404 Note that you can also install from a",
    "npm error 404 tarball, folder, http url, or git url.",
  ].join("\n");
  const E404_STDOUT = JSON.stringify({
    error: {
      code: "E404",
      summary: "Not Found - GET https://registry.npmjs.org/@iris-mcp%2fshared - Not found",
      detail: "The requested resource '@iris-mcp/shared@1.0.0' could not be found or you do not have permission to access it.\n\nNote that you can also install from a\ntarball, folder, http url, or git url.",
    },
  });

  it("a package published with provenance has none of the problems", () => {
    expect(registryProblems("@modelcontextprotocol/server", "2.4.0", { status: 0, stdout: `${PROVENANCE_STDOUT}\n`, stderr: "" })).toEqual([]);
  });

  it("a version with no attestation prints the bare version string, and is published without provenance", () => {
    expect(registryProblems("lodash", "4.17.21", { status: 0, stdout: '"4.17.21"\n', stderr: "" })).toEqual([expect.stringContaining("published without a provenance attestation")]);
  });

  it("a name that is not on the registry (exit 1, text on stderr and JSON on stdout) is not on the registry", () => {
    expect(registryProblems("@iris-mcp/shared", "1.0.0", { status: 1, stdout: E404_STDOUT, stderr: E404_STDERR })).toEqual([expect.stringContaining("@iris-mcp/shared@1.0.0: not on the registry.")]);
  });
});
