/**
 * Story 38.1 (AC-6, AD-23, AD-29) -- the documentation claims about the transport rejection, held
 * against the thing each one describes.
 *
 * `transport-rejection-gate.test.ts` pins the NEGATIVE doc claim (no doc offers an HTTP transport)
 * and the README env-table row. This file pins what it leaves open:
 *
 *  - The CHANGELOG quotes the two exact error messages. Each quoted line is compared with what the
 *    BUILT `resolveTransport` throws for that channel, so a reworded message that leaves the
 *    CHANGELOG behind goes red here.
 *  - The CHANGELOG section names the filed ledger entry (DW-538).
 *  - The changeset carries the sanctioned bumps (AD-29: `@iris-mcp/shared` minor, the five servers
 *    patch). `changeset version` consumes the file, so the check runs while it exists.
 *  - The README states the stdio-only contract, and its fail-fast list names an unsupported
 *    transport value; the shared README describes the throwing `resolveTransport()`.
 *
 * Needs no IRIS. It reads the built shared dist and FAILS (never skips) when that dist is missing
 * or stale, because a skip would leave the CHANGELOG check a dead one.
 */

import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { checkDistFresh } from "../../../../scripts/lib/dist-freshness.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// packages/iris-mcp-all/src/__tests__/ -> repo root is 4 levels up.
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..", "..");

function read(relative: string): string {
  return readFileSync(path.join(REPO_ROOT, relative), "utf8");
}

/** The messages the built `resolveTransport` throws for `http`, one per channel. */
async function builtMessages(): Promise<{ env: string; flag: string }> {
  const fresh = checkDistFresh(path.join(REPO_ROOT, "packages", "shared"), "@iris-mcp/shared");
  if (!fresh.ok || fresh.skipped) {
    throw new Error(
      `${fresh.reason ?? "@iris-mcp/shared declares no dist/ build output."} Rebuild: pnpm --filter @iris-mcp/shared build`,
    );
  }
  const shared = (await import(pathToFileURL(path.join(REPO_ROOT, "packages", "shared", "dist", "index.js")).href)) as {
    resolveTransport: () => string;
  };

  const originalArgv = process.argv;
  const originalEnv = process.env["MCP_TRANSPORT"];
  const messageFor = (argv: string[], env: string | undefined): string => {
    process.argv = ["node", "script", ...argv];
    if (env === undefined) delete process.env["MCP_TRANSPORT"];
    else process.env["MCP_TRANSPORT"] = env;
    try {
      shared.resolveTransport();
    } catch (err) {
      return (err as Error).message;
    }
    throw new Error(`the built resolveTransport accepted argv=${JSON.stringify(argv)} env=${JSON.stringify(env)}`);
  };
  try {
    return {
      env: messageFor([], "http"),
      flag: messageFor(["--transport", "http"], undefined),
    };
  } finally {
    process.argv = originalArgv;
    if (originalEnv === undefined) delete process.env["MCP_TRANSPORT"];
    else process.env["MCP_TRANSPORT"] = originalEnv;
  }
}

describe("Story 38.1 CHANGELOG entry", () => {
  const section = /## \[Pre-release[^\]]*\] . Story 38\.1[\s\S]*?(?=\n## \[)/.exec(read("CHANGELOG.md"))?.[0] ?? "";

  it("has a Story 38.1 section under Changed that names the filed ledger entry", () => {
    expect(section, "CHANGELOG.md has a Story 38.1 section").not.toBe("");
    expect(section).toMatch(/### Changed [^\n]*transport other than stdio is a startup configuration error/);
    expect(section).toContain("DW-538");
  });

  it("quotes exactly the messages the built resolveTransport throws for http", async () => {
    const quoted = [...section.matchAll(/^- `(Unsupported transport [^`]*)`$/gm)].map((match) => match[1] ?? "");
    const built = await builtMessages();

    // One quoted line per channel; an empty list would pass the comparison below vacuously.
    expect(quoted).toHaveLength(2);
    expect(quoted).toEqual([built.env, built.flag]);
  });
});

describe("Story 38.1 changeset (AD-29)", () => {
  // `changeset version` consumes (deletes) the file and moves its text into the generated package
  // changelogs, so the bumps are checked while the file exists.
  const changeset = ".changeset/story-38-1-reject-http-transport.md";
  const present = existsSync(path.join(REPO_ROOT, changeset));

  it.skipIf(!present)("bumps @iris-mcp/shared minor and each of the five servers patch, and nothing else", () => {
    const frontmatter = /^---\n([\s\S]*?)\n---/.exec(read(changeset))?.[1] ?? "";
    const bumps = Object.fromEntries(
      frontmatter
        .split("\n")
        .map((line) => /^"([^"]+)": (\w+)$/.exec(line))
        .filter((match): match is RegExpExecArray => match !== null)
        .map((match) => [match[1] ?? "", match[2] ?? ""]),
    );

    expect(bumps).toEqual({
      "@iris-mcp/shared": "minor",
      "@iris-mcp/dev": "patch",
      "@iris-mcp/admin": "patch",
      "@iris-mcp/interop": "patch",
      "@iris-mcp/ops": "patch",
      "@iris-mcp/data": "patch",
    });
  });
});

describe("Story 38.1 README claims", () => {
  it("README.md states stdio is the only supported transport and that any other value is a startup configuration error", () => {
    expect(read("README.md")).toMatch(
      /\*\*stdio\*\* transport, the only supported transport: any other `MCP_TRANSPORT` or `--transport` value, `http` included, is a startup configuration error/,
    );
  });

  it("README.md lists an unsupported transport value among the configuration errors that still fail startup fast", () => {
    const failFast = /\*\*Invalid configuration still fails startup fast\*\* \(([^)]*)\)/.exec(read("README.md"))?.[1] ?? "";

    expect(failFast, "README.md has the fail-fast list").not.toBe("");
    expect(failFast).toMatch(/unsupported `MCP_TRANSPORT`\/`--transport` value/);
  });

  it("the shared README describes resolveTransport() as returning stdio and throwing for any other value", () => {
    expect(read("packages/shared/README.md")).toMatch(
      /\*\*`resolveTransport\(\)`\*\* -- Returns `stdio` from `--transport` \/ `MCP_TRANSPORT`, and throws a configuration error for any other configured value/,
    );
  });
});
