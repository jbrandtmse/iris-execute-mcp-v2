/**
 * Story 42.8 (AC 42.8.5; AD-29) - the pure additions of `scripts/lib/release-core.mjs`: the pinned GitHub host keys, the pinned `mcp-publisher`, its
 * argv builder, the MCP Registry lookup and what its answers mean, and the files that embed the shared version.
 *
 * Oracles (Rule #36), all read-only on 2026-11-21: the three host keys and their SHA256 fingerprints are the `ssh_keys` of
 * `GET https://api.github.com/meta` and GitHub's published fingerprints; the registry statuses are `GET /v0.1/servers/<name>/versions/<v>` for
 * `io.github.upstash/context7@4.7.3` (200 `{"server":{...},"_meta":{...}}`) and for `@0.0.0-nonexistent` and
 * `io.github.jbrandtmse/iris-dev-mcp@1.0.0` (404 `{"title":"Not Found","status":404,"detail":"Server not found"}`); the publisher digest is the
 * `digest` of the v1.8.8 release asset, re-verified by hashing the downloaded tarball.
 */

import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { NO_ENDORSEMENT_SENTENCE } from "../../../../scripts/lib/endorsement.mjs";
import { CONNECTION_VARIABLES, MARKETPLACE_PATH, SERVER_PACKAGES, serverJsonPath } from "../../../../scripts/lib/listings.mjs";
import {
  GITHUB_SSH_KNOWN_HOSTS,
  MARKETPLACE_RELATIVE,
  MCP_PUBLISHER,
  MCP_REGISTRY_BASE,
  NPM_PUBLISH_ORDER,
  PLUGIN_ENTRY_NAME,
  PLUGIN_MANIFEST_RELATIVE,
  SERVER_JSON_DIRS,
  githubKnownHostsText,
  ipmReadme,
  mcpPublisherArgv,
  mcpPublisherUrl,
  npmVersionUrl,
  registryLookupUrl,
  registryOutcome,
  skippedText,
} from "../../../../scripts/lib/release-core.mjs";
import { PACK_DIR, PLUGIN_MANIFEST_PATH, PLUGIN_NAME } from "../../../../scripts/lib/skills-pack.mjs";

/** GitHub's published SHA256 fingerprints of its three host keys (https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/githubs-ssh-key-fingerprints). */
const PUBLISHED_FINGERPRINTS: Record<string, string> = {
  "ssh-ed25519": "+DiY3wvvV6TuJJhbpZisF/zLDA0zPMSvHdkr4UvCOqU",
  "ecdsa-sha2-nistp256": "p2QAMXNIC1TJYWeIOttrVc98/R1BUFWu3/LiyKgUfQM",
  "ssh-rsa": "uNiVztksCsDhcc0u9e8BujQXVUpKZIDTMczCvj3tD2s",
};

describe("the pinned GitHub host keys (the IPM push trusts only these)", () => {
  const entries = (GITHUB_SSH_KNOWN_HOSTS as readonly string[]).map((line) => {
    const [host, type, blob] = line.split(" ");
    return { host, type: type as string, blob: blob as string };
  });

  it("are three github.com lines: ed25519, ecdsa-sha2-nistp256 and rsa", () => {
    expect(entries.map((entry) => entry.host)).toEqual(["github.com", "github.com", "github.com"]);
    expect(entries.map((entry) => entry.type)).toEqual(["ssh-ed25519", "ecdsa-sha2-nistp256", "ssh-rsa"]);
  });

  it.each(entries.map((entry) => [entry.type, entry] as const))("%s: the SHA256 of the key (base64-decoded, unpadded base64) is the fingerprint GitHub publishes", (type, entry) => {
    const recomputed = createHash("sha256").update(Buffer.from(entry.blob, "base64")).digest("base64").replace(/=+$/, "");
    expect(recomputed).toBe(PUBLISHED_FINGERPRINTS[type]);
  });

  it("each key's blob names its own type, so a line cannot pair one type with another's key", () => {
    for (const entry of entries) {
      const blob = Buffer.from(entry.blob, "base64");
      const length = blob.readUInt32BE(0);
      expect(blob.subarray(4, 4 + length).toString("ascii")).toBe(entry.type);
    }
  });

  it("the known_hosts text is those three lines and a final newline", () => {
    expect(githubKnownHostsText()).toBe(`${(GITHUB_SSH_KNOWN_HOSTS as readonly string[]).join("\n")}\n`);
  });
});

describe("the pinned mcp-publisher (decision #110)", () => {
  it("is v1.8.8 of the linux_amd64 tarball, with the digest the release asset publishes", () => {
    expect(MCP_PUBLISHER).toEqual({
      version: "v1.8.8",
      asset: "mcp-publisher_linux_amd64.tar.gz",
      sha256: "09f1fa70ee146b640584274a1a6b2b8a0310b05d4321fa9224e6df6a016d67f4",
    });
    expect(mcpPublisherUrl()).toBe("https://github.com/modelcontextprotocol/registry/releases/download/v1.8.8/mcp-publisher_linux_amd64.tar.gz");
  });

  it("builds only the verbs the release runs: login github-oidc, validate <file> and publish <file>", () => {
    expect(mcpPublisherArgv("login")).toEqual(["login", "github-oidc"]);
    expect(mcpPublisherArgv("validate", "/a/server.json")).toEqual(["validate", "/a/server.json"]);
    expect(mcpPublisherArgv("publish", "/a/server.json")).toEqual(["publish", "/a/server.json"]);
    expect(() => mcpPublisherArgv("publish")).toThrow(/needs the server\.json/);
    expect(() => mcpPublisherArgv("validate", "")).toThrow(/needs the server\.json/);
    expect(() => mcpPublisherArgv("logout" as never)).toThrow(/not an mcp-publisher verb/);
  });
});

describe("the MCP Registry lookup (Story 42.8, I/O matrix)", () => {
  const expected = { name: "io.github.jbrandtmse/iris-dev-mcp", version: "1.1.0" };
  const json = "application/json; charset=utf-8";

  it("asks GET /v0.1/servers/<name>/versions/<version> with each part URL-encoded", () => {
    expect(registryLookupUrl("io.github.jbrandtmse/iris-dev-mcp", "1.1.0")).toBe(`${MCP_REGISTRY_BASE}/v0.1/servers/io.github.jbrandtmse%2Firis-dev-mcp/versions/1.1.0`);
    expect(MCP_REGISTRY_BASE).toBe("https://registry.modelcontextprotocol.io");
  });

  it("a 200 JSON answer whose server names the name and the version is published (the shape the registry answered for context7@4.7.3)", () => {
    const body = { server: { name: expected.name, version: expected.version, description: "x" }, _meta: {} };
    expect(registryOutcome({ status: 200, contentType: json, body }, expected)).toEqual({ outcome: "published" });
  });

  it("a 404 is absent (the shape the registry answered for an unknown version and for iris-dev-mcp@1.0.0)", () => {
    expect(registryOutcome({ status: 404, contentType: "application/problem+json", body: { title: "Not Found", status: 404, detail: "Server not found" } }, expected)).toEqual({ outcome: "absent" });
  });

  it.each([
    ["a 200 that names another version", { status: 200, contentType: json, body: { server: { name: expected.name, version: "1.0.9" } } }, /does not name/],
    ["a 200 that names another server", { status: 200, contentType: json, body: { server: { name: "io.github.other/x", version: expected.version } } }, /does not name/],
    ["a 200 whose body has no server", { status: 200, contentType: json, body: { detail: "ok" } }, /does not name/],
    ["a 200 with no body", { status: 200, contentType: json }, /does not name/],
    ["a 200 that is not JSON (a proxy or captive portal)", { status: 200, contentType: "text/html" }, /not JSON/],
    ["a 200 that is untyped", { status: 200 }, /untyped/],
    ["a 500", { status: 500 }, /HTTP 500/],
    ["a 403", { status: 403 }, /HTTP 403/],
    ["a 429", { status: 429 }, /HTTP 429/],
    ["no answer", {}, /no answer/],
  ])("%s is unknown, which stops the channel before anything is posted", (_name, answer, why) => {
    const outcome = registryOutcome(answer as never, expected);
    expect(outcome.outcome).toBe("unknown");
    expect(outcome.why).toMatch(why);
  });

  it("asks npm for the version of a scoped package at /<scope>%2F<name>/<version>", () => {
    expect(npmVersionUrl("@iris-mcp/dev", "1.1.0")).toBe("https://registry.npmjs.org/@iris-mcp%2Fdev/1.1.0");
  });
});

describe("the files that embed the shared version (lockstep, decision #103)", () => {
  it("the release's constants equal the generators' (a second copy pinned to the first)", () => {
    expect(PLUGIN_MANIFEST_RELATIVE).toBe(`${PACK_DIR}/${PLUGIN_MANIFEST_PATH}`);
    expect(MARKETPLACE_RELATIVE).toBe(MARKETPLACE_PATH);
    expect(PLUGIN_ENTRY_NAME).toBe(PLUGIN_NAME);
    expect([...SERVER_JSON_DIRS]).toEqual(SERVER_PACKAGES.map((entry: { dir: string }) => entry.dir));
    expect(SERVER_JSON_DIRS.map((dir: string) => `packages/${dir}/server.json`)).toEqual(SERVER_PACKAGES.map((entry: { dir: string }) => serverJsonPath(entry.dir)));
  });

  it("every listed server is an npm package of the publish order", () => {
    expect(SERVER_PACKAGES.map((entry: { npm: string }) => entry.npm).every((name: string) => (NPM_PUBLISH_ORDER as readonly string[]).includes(name))).toBe(true);
  });

  it("the connection variables are the six the plugin and the servers read, in the registry's order", () => {
    expect(CONNECTION_VARIABLES.map((entry: { name: string }) => entry.name)).toEqual(["IRIS_HOST", "IRIS_PORT", "IRIS_USERNAME", "IRIS_PASSWORD", "IRIS_NAMESPACE", "IRIS_HTTPS"]);
  });
});

describe("the non-endorsement sentence and the disabled-channel text", () => {
  it("the IPM README ends with the sentence that the deny-list strips (one wording, two places)", () => {
    expect(ipmReadme("1.1.0")).toContain(NO_ENDORSEMENT_SENTENCE);
  });

  it("a channel that names no reason still prints a status", () => {
    expect(skippedText({})).toBe("skipped: not enabled (no reason given)");
    expect(skippedText({ enabledBy: "Story 99.9" })).toBe("skipped: not enabled (Story 99.9)");
  });
});
