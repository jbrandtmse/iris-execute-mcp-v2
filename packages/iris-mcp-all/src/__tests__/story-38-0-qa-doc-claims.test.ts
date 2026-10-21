/**
 * Story 38.0 (AC-3 and AC-13; ledger DW-469, DW-384, DW-514, DW-520) - the documentation claims the
 * story corrected, held against the thing each one describes.
 *
 * The story verified these claims with one-off `grep` checks. A grep run once proves nothing a
 * month later, and a claim written from memory is the way these four went wrong in the first place,
 * so each check here reads the claim and its subject:
 *
 *  - DW-469: the documented `IRIS_NAMESPACE` default is compared with what the BUILT `loadConfig`
 *    returns when the variable is unset, and every helper or script that defaults the variable
 *    names its fallback explicitly (`HSCUSTOM`), so none of them follows the suite default by accident.
 *  - DW-384: the truncation marker is described by the form the ObjectScript source really emits
 *    (`ExecuteMCPv2.Utils`), and no line that quotes the literal `ceiling=32768chars` omits the
 *    `ceiling=<N>` form or the stable-prefix advice.
 *  - DW-514: `health.ts` no longer describes a monitoring loop, and contains no timer.
 *  - DW-520: the README states the unreachable-at-startup scope and the `Tool error:` form of a
 *    mid-session outage, and the server really prefixes a failed tool call that way.
 *
 * Cross-package documentation checks live here (Rule #45).
 */

import { describe, it, expect } from "vitest";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { checkDistFresh } from "../../../../scripts/lib/dist-freshness.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..", "..");
const REQUIRE_LIVE =
  process.env.IRIS_REQUIRE_LIVE === "1" || process.env.IRIS_REQUIRE_LIVE === "true";

function read(relative: string): string {
  return readFileSync(path.join(REPO_ROOT, relative), "utf8");
}

/** Every file under `dir` (relative to the repo root) whose name satisfies `keep`, skipping build and dependency trees. */
function walk(dir: string, keep: (name: string) => boolean): string[] {
  const found: string[] = [];
  const visit = (current: string): void => {
    for (const entry of readdirSync(path.join(REPO_ROOT, current))) {
      if (entry === "node_modules" || entry === "dist") continue;
      const relative = path.join(current, entry);
      const stats = statSync(path.join(REPO_ROOT, relative));
      if (stats.isDirectory()) visit(relative);
      else if (keep(entry)) found.push(relative);
    }
  };
  visit(dir);
  return found;
}

describe("IRIS_NAMESPACE default (Story 38.0, DW-469, AC-3)", () => {
  it("the built loadConfig falls back to the namespace the documentation states", async (testCtx) => {
    const fresh = checkDistFresh(path.join(REPO_ROOT, "packages", "shared"), "shared");
    if (!fresh.ok || fresh.skipped) {
      const reason = fresh.reason ?? "shared declares no dist/ build output.";
      if (REQUIRE_LIVE) throw new Error(`IRIS_REQUIRE_LIVE is set, so this test may not be skipped: ${reason}`);
      return testCtx.skip();
    }
    const shared = (await import(
      pathToFileURL(path.join(REPO_ROOT, "packages", "shared", "dist", "index.js")).href
    )) as { loadConfig: (env: Record<string, string>) => { namespace: string } };

    const documented = /^\| `IRIS_NAMESPACE` \| `([^`]+)` \|/m.exec(read("README.md"))?.[1];

    expect(documented, "README.md has an IRIS_NAMESPACE row in its environment-variable table").toBeDefined();
    expect(shared.loadConfig({ IRIS_USERNAME: "u", IRIS_PASSWORD: "p" }).namespace).toBe(documented);
    expect(documented).toBe("USER");
  });

  it(".env.example and the loadConfig doc table state the same default", () => {
    expect(read(".env.example")).toMatch(/^IRIS_NAMESPACE=USER$/m);
    expect(read("packages/shared/src/config.ts")).toMatch(/\| IRIS_NAMESPACE\s+\| USER\s+\|/);
  });

  it("the launcher README documents the namespace default its package.json contributes, and it is the suite default", () => {
    const manifest = JSON.parse(read("extensions/iris-mcp-launcher/package.json")) as {
      contributes: { configuration: { properties: Record<string, { default?: unknown }> } };
    };
    const contributed = manifest.contributes.configuration.properties["irisMcpLauncher.namespace"]?.default;
    const documented = /^\| `irisMcpLauncher\.namespace`\s*\| `"([^"]*)"`/m.exec(
      read("extensions/iris-mcp-launcher/README.md"),
    )?.[1];

    expect(documented, "the launcher README has a namespace row").toBeDefined();
    expect(documented).toBe(contributed);
    expect(contributed).toBe(/^\| `IRIS_NAMESPACE` \| `([^`]+)` \|/m.exec(read("README.md"))?.[1]);
  });

  it("every helper and script that defaults IRIS_NAMESPACE names its own fallback explicitly; only loadConfig follows the suite default", () => {
    const sources = [
      ...walk("packages", (name) => name.endsWith(".ts") || name.endsWith(".mjs")),
      ...walk("scripts", (name) => name.endsWith(".mjs") || name.endsWith(".ts")),
    ];
    const fallbacks: Array<{ file: string; fallback: string }> = [];
    for (const file of sources) {
      for (const match of read(file).matchAll(/IRIS_NAMESPACE\s*\?\?\s*([^,;\n)]+)/g)) {
        fallbacks.push({ file: file.split(path.sep).join("/"), fallback: (match[1] ?? "").trim() });
      }
    }

    // The scan found the fallbacks at all (an empty scan would pass the next assertion vacuously): the suite default in
    // `loadConfig` is the one inline fallback that remains, because every test target is explicit (Story 42.2).
    expect(fallbacks).toContainEqual({ file: "packages/shared/src/config.ts", fallback: '"USER"' });
    const unexpected = fallbacks.filter(
      ({ file, fallback }) =>
        !(file === "packages/shared/src/config.ts" && fallback === '"USER"') && fallback !== '"HSCUSTOM"',
    );
    expect(unexpected).toEqual([]);
  });

  it("the root and launcher changelogs record the new default under Changed", () => {
    const root = read("CHANGELOG.md");
    const section = /## \[Pre-release[^\]]*\] . Story 38\.0[\s\S]*?(?=\n## \[)/.exec(root)?.[0] ?? "";
    expect(section, "CHANGELOG.md has a Story 38.0 section").not.toBe("");
    expect(section).toMatch(/### Changed [^\n]*`IRIS_NAMESPACE`[^\n]*`USER`/);

    const launcher = read("extensions/iris-mcp-launcher/CHANGELOG.md");
    const unreleased = /## \[0\.1\.0\][\s\S]*?(?=\n## \[)/.exec(launcher)?.[0] ?? launcher;
    const changed = /### Changed\n([\s\S]*?)(?=\n### |\n## |$)/.exec(unreleased)?.[1] ?? "";
    expect(changed).toMatch(/`irisMcpLauncher\.namespace` now defaults to `USER`/);
  });
});

describe("truncation marker documentation (Story 38.0, DW-384, AC-13)", () => {
  it("the marker form the docs describe is the form ExecuteMCPv2.Utils emits", () => {
    const utils = read("src/ExecuteMCPv2/Utils.cls");

    // `[IRIS-MCP-TRUNCATED ceiling=` + the remaining budget + `chars]`
    expect(utils).toMatch(/\[IRIS-MCP-TRUNCATED ceiling="_\s*\w+\s*_"chars\]/);
  });

  // The changeset is consumed (deleted) by `changeset version`, which moves its text into the
  // generated package changelogs; CHANGELOG.md is checked always, the changeset while it exists.
  const changeset = ".changeset/execute-response-ceiling-and-gate-hardening.md";
  for (const file of ["CHANGELOG.md", ...(existsSync(path.join(REPO_ROOT, changeset)) ? [changeset] : [])]) {
    it(`${file}: a line that quotes ceiling=32768chars also explains ceiling=<N> and the stable [IRIS-MCP-TRUNCATED prefix`, () => {
      const lines = read(file)
        .split("\n")
        .filter((line) => line.includes("ceiling=32768chars"));

      expect(lines.length, `${file} quotes the literal marker`).toBeGreaterThan(0);
      for (const line of lines) {
        expect(line).toContain("ceiling=<N>");
        expect(line).toContain("[IRIS-MCP-TRUNCATED");
        expect(line).toMatch(/prefix/);
      }
    });
  }
});

describe("health.ts and the startup claims (Story 38.0, DW-514 and DW-520, AC-13)", () => {
  it("health.ts describes ping() as a general availability probe: no monitoring loop, no story reference, no timer", () => {
    const health = read("packages/shared/src/health.ts");

    expect(health).not.toMatch(/Story 1\.4|monitoring loop/);
    expect(health).not.toMatch(/setInterval\s*\(/);
  });

  it("README scopes the no-exit claim to an instance unreachable at startup and names the Tool error form of a mid-session outage", () => {
    const readme = read("README.md");
    const paragraph =
      readme.split("\n").find((line) => line.includes("Startup no longer exits when the `default` instance is unreachable")) ?? "";

    expect(paragraph, "README has the startup paragraph").not.toBe("");
    expect(paragraph).toContain("unreachable at startup");
    expect(paragraph).toContain("mid-session");
    expect(paragraph).toContain("`Tool error: \u2026`");
  });

  it("the server really prefixes a failed tool call with `Tool error:` (the form the README names)", () => {
    expect(existsSync(path.join(REPO_ROOT, "packages/shared/src/server-base.ts"))).toBe(true);
    expect(read("packages/shared/src/server-base.ts")).toContain("text: `Tool error: ${message}`");
  });
});
