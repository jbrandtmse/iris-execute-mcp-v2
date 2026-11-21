/**
 * Story 42.9 (AC 42.9.1, AC 42.9.2, DW-632, DW-633, DW-661, DW-664, DW-690, DW-706, DW-707; AD-29; project rules #51, #56, #59) -- the
 * install docs describe the published install.
 *
 *  1. The caveat guard. Over every reader document (`doc-set.ts`: the tracked `*.md` files outside the
 *     planning, agent and IRIS-source folders) there is no "not yet published", "until ... published", "once published", "pre-release:"
 *     wording, and no `node .../dist/...` launch outside the README's Contributing section and the extension's
 *     development sections. History files are allowlisted by name with a reason, and the checker has rows that make it fail.
 *  2. The version floor (DW-707). A document that names the plugin or the extension install command says "1.1.0" in the same paragraph
 *     or in the heading just above it.
 *  3. The IRIS claim and the tested range, which equal the image tags of `scripts/throwaway-iris.mjs`.
 *  4. The payload table: "Last re-measured at Story 42.9" and the measured dev row (DW-661).
 *  5. The corrected facts: `IRIS_USERNAME` is required in all ten tables (DW-664), the removal step for the plugin (DW-706), the cleanup
 *     after an IPM uninstall (DW-690) and the per-request language choice (DW-633).
 *
 * Needs no IRIS and no built dist: it reads documents. Cross-package documentation checks live in `@iris-mcp/all` (rule #45).
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { IRIS_COMMUNITY_IMAGE, IRISHEALTH_COMMUNITY_IMAGE, OLDEST_IRIS_COMMUNITY_IMAGE } from "../../../../scripts/throwaway-iris.mjs";
import { readerDocs } from "./doc-set";
import { REPO_ROOT } from "./pack-fixture";

const read = (relative: string): string => readFileSync(path.join(REPO_ROOT, relative), "utf8");
const squash = (text: string): string => text.replace(/\s+/g, " ");

/** Wording that says the suite is not published, or that publication is still to come. */
const CAVEAT = /not yet published|not yet on (?:any|the) marketplace|until (?:it is |they are |packages are )?published|once published|pre-release:/i;

/** A launch of a built entry point with `node`: a JSON `"command": "node"` entry, or `node` followed by a `dist/index.js` or `dist/cli/...` path. */
const NODE_LAUNCH = /"command":\s*"node"|\bnode\s+[^\n`]*\/dist\/(?:index\.js|cli\/)/;

/** History and dated records: they describe what was true then, so they keep their wording. */
const HISTORY: Array<{ test: (rel: string) => boolean; reason: string }> = [
  { test: (rel) => rel === "CHANGELOG.md" || rel.endsWith("/CHANGELOG.md"), reason: "release history, written in the past tense" },
  { test: (rel) => rel === "docs/epic-summary.md", reason: "a record of what each epic built" },
  { test: (rel) => /^docs\/(?:bugs|known-bugs)-/.test(rel), reason: "dated defect records" },
];

const historyReason = (rel: string): string | undefined => HISTORY.find((entry) => entry.test(rel))?.reason;

/** The text under the first heading of `level` that matches, up to the next heading of the same or a higher level. */
function sectionsMatching(document: string, level: number, wanted: (title: string) => boolean): string[] {
  const lines = document.split("\n");
  const out: string[] = [];
  let fenced = false;
  let current: string[] | null = null;
  for (const line of lines) {
    if (/^\s*(```|~~~)/.test(line)) fenced = !fenced;
    const heading = fenced ? null : /^(#{1,6})\s+(.*?)\s*$/.exec(line);
    if (heading !== null) {
      const depth = (heading[1] as string).length;
      if (current !== null && depth <= level) {
        out.push(current.join("\n"));
        current = null;
      }
      if (current === null && depth === level && wanted(heading[2] as string)) current = [];
    }
    if (current !== null) current.push(line);
  }
  if (current !== null) out.push(current.join("\n"));
  return out;
}

/** `text` without the sections in which a `node` launch of a built entry point is the point: Contributing, the extension's development sections, dated certification evidence. */
function withoutDevelopmentSections(rel: string, text: string): string {
  let out = text;
  const cut = (level: number, wanted: (title: string) => boolean): void => {
    for (const section of sectionsMatching(out, level, wanted)) out = out.replace(section, "");
  };
  if (rel === "README.md") cut(2, (title) => title === "Contributing");
  if (rel === "extensions/iris-mcp-launcher/README.md") {
    cut(2, (title) => /^(?:Installing in development mode|Development mode|Development|Publishing)$/.test(title));
  }
  const begin = out.indexOf("<!-- CERTIFICATION-TABLE:BEGIN -->");
  const end = out.indexOf("<!-- CERTIFICATION-TABLE:END -->");
  if (begin >= 0 && end > begin) out = out.slice(0, begin) + out.slice(end);
  return out;
}

interface Offence {
  line: number;
  kind: "caveat" | "node-launch";
  text: string;
}

/** Every caveat and every development-only `node` launch of one document. */
function offencesIn(rel: string, text: string): Offence[] {
  const out: Offence[] = [];
  const scanned = withoutDevelopmentSections(rel, text);
  scanned.split("\n").forEach((line, index) => {
    if (CAVEAT.test(line)) out.push({ line: index + 1, kind: "caveat", text: line.trim().slice(0, 120) });
    if (NODE_LAUNCH.test(line)) out.push({ line: index + 1, kind: "node-launch", text: line.trim().slice(0, 120) });
  });
  return out;
}

const docs = readerDocs();

describe("Story 42.9: the doc set and the caveat guard", () => {
  it("the doc set is the Markdown files a reader can open, and holds the documents this story changed", () => {
    expect(docs.length, "the inventory of 2026-11-21 held 83 files, 82 once the 1.1.0 version step consumed the two story changesets").toBeGreaterThanOrEqual(82);
    for (const rel of ["README.md", "docs/client-config/README.md", "packages/client-config/README.md", "extensions/iris-mcp-launcher/README.md", "CHANGELOG.md"]) {
      expect(docs, rel).toContain(rel);
    }
    for (const rel of docs) {
      expect(rel.startsWith("_bmad") || rel.startsWith(".claude/") || rel.startsWith("irislib/") || rel.startsWith("irissys/"), rel).toBe(false);
    }
  });

  it("the checker can fail: it finds each caveat form and each development-only launch, and honours the exempt sections", () => {
    const seeded = [
      "The suite is not yet published to npm.",
      "Until packages are published, clone it.",
      "Once published, it installs.",
      "> **Pre-release:** nothing resolves.",
      "```json",
      '{ "command": "node", "args": ["/x/packages/iris-dev-mcp/dist/index.js"] }',
      "```",
      "Run `node packages/client-config/dist/cli/clients-cli.js detect`.",
    ].join("\n");
    const found = offencesIn("docs/x.md", seeded);
    expect(found.filter((offence) => offence.kind === "caveat")).toHaveLength(4);
    expect(found.filter((offence) => offence.kind === "node-launch").length).toBeGreaterThanOrEqual(2);

    const readme = ["# T", "## Install", "fine", "## Contributing", "Run `node packages/client-config/dist/cli/clients-cli.js detect`.", "## License"].join("\n");
    expect(offencesIn("README.md", readme)).toEqual([]);
    expect(offencesIn("docs/x.md", readme).length, "the exemption is the README's own").toBeGreaterThan(0);
  });

  it("no reader document outside the history files has a publication caveat or a development-only node launch", () => {
    const offending: string[] = [];
    for (const rel of docs) {
      if (historyReason(rel) !== undefined) continue;
      for (const offence of offencesIn(rel, read(rel))) offending.push(`${rel}:${offence.line} [${offence.kind}] ${offence.text}`);
    }
    expect(offending).toEqual([]);
  });

  it("every history allowlist entry still matches a document (it cannot rot)", () => {
    for (const entry of HISTORY) expect(docs.filter((rel) => entry.test(rel)).length, entry.reason).toBeGreaterThan(0);
  });
});

describe("Story 42.9: the plugin and the extension are documented from 1.1.0 (DW-707)", () => {
  const INSTALL = /\/plugin marketplace add jbrandtmse|\/plugin install iris-mcp@iris-mcp|code --install-extension iris-mcp\.iris-mcp-launcher/;

  it("each install command sits in a paragraph, or under a heading within twelve lines, that says 1.1.0", () => {
    const loose: string[] = [];
    for (const rel of docs) {
      if (historyReason(rel) !== undefined) continue;
      const lines = read(rel).split("\n");
      lines.forEach((line, index) => {
        if (!INSTALL.test(line)) return;
        let start = index;
        while (start > 0 && (lines[start - 1] as string).trim() !== "") start -= 1;
        let end = index;
        while (end < lines.length - 1 && (lines[end + 1] as string).trim() !== "") end += 1;
        const paragraph = lines.slice(start, end + 1).join("\n");
        const above = lines.slice(Math.max(0, index - 12), index + 1).join("\n");
        if (!paragraph.includes("1.1.0") && !above.includes("1.1.0")) loose.push(`${rel}:${index + 1}`);
      });
    }
    expect(loose).toEqual([]);
  });

  it("the root README install table names the plugin and the extension from 1.1.0 and the clients CLI as the 1.0.x route", () => {
    const readme = squash(read("README.md"));
    expect(readme).toContain("| **Claude Code** | The plugin, from 1.1.0: `/plugin marketplace add jbrandtmse/iris-execute-mcp-v2`, then `/plugin install iris-mcp@iris-mcp`.");
    expect(readme).toContain("| **VS Code** (GitHub Copilot) | The IRIS MCP Launcher extension, from 1.1.0: `iris-mcp.iris-mcp-launcher` on the Visual Studio Marketplace or Open VSX.");
    expect(readme).toContain("| **Every other client** | `npx -y -p @iris-mcp/client-config@1 iris-mcp-clients apply --client <id> --servers iris-dev-mcp`.");
    expect(readme).toContain("On 1.0.x the `iris-mcp-clients` command is the route for every client, Claude Code and VS Code included.");
    expect(readme).toContain("#### Claude Code: the plugin (from 1.1.0)");
    expect(readme).toContain("#### VS Code extension: IRIS MCP Launcher (from 1.1.0)");
  });

  it("the extension README and the IPM subsection say from 1.1.0", () => {
    expect(squash(read("extensions/iris-mcp-launcher/README.md").replace(/^> ?/gm, ""))).toContain("**Install it from a store (from 1.1.0).** From 1.1.0 the extension is published on the");
    expect(squash(read("README.md"))).toContain("The IPM package is published to the IPM registry from 1.1.0, the first release with the IPM channel");
  });
});

describe("Story 42.9: the IRIS claim and the tested range", () => {
  const tag = (image: string): string => /:(\d{4}\.\d+)@sha256:/.exec(image)?.[1] ?? "";
  const tags = [IRIS_COMMUNITY_IMAGE, OLDEST_IRIS_COMMUNITY_IMAGE, IRISHEALTH_COMMUNITY_IMAGE].map(tag).sort();
  const oldest = tags[0] as string;
  const newest = tags[tags.length - 1] as string;

  it("the throwaway script's images give a range of two tags", () => {
    expect(tags.every((entry) => /^\d{4}\.\d+$/.test(entry)), tags.join(", ")).toBe(true);
    expect(oldest).toBe(tag(OLDEST_IRIS_COMMUNITY_IMAGE));
    expect(newest).toBe(tag(IRIS_COMMUNITY_IMAGE));
  });

  it("the README says 2023.1 or later, best effort below the oldest CI-tested image, and the tested range equals the image tags", () => {
    const readme = squash(read("README.md"));
    expect(readme).toContain("**InterSystems IRIS** 2023.1 or later (including IRIS for Health, HealthShare), best effort below the oldest CI-tested image.");
    expect(readme).toContain(
      `CI tests IRIS Community ${tag(OLDEST_IRIS_COMMUNITY_IMAGE)} to ${tag(IRIS_COMMUNITY_IMAGE)} and IRIS for Health ${tag(IRISHEALTH_COMMUNITY_IMAGE)}.`,
    );
  });

  it("the PRD states the same claim and range", () => {
    const prd = squash(read("_bmad-output/planning-artifacts/prd.md"));
    expect(prd).toContain("2023.1 or later, best effort below the oldest CI-tested image; the tested range is " + `${oldest} to ${newest}.`);
  });
});

describe("Story 42.9: the payload table (DW-661)", () => {
  const readme = read("README.md");

  it("says it was last re-measured at Story 42.9, and that the dev row is test-pinned", () => {
    const flat = squash(readme);
    expect(flat).toContain("Last re-measured at Story 42.9 (`pnpm measure:tools-payload` on freshly built dists");
    expect(flat).toContain("The `@iris-mcp/dev` row is test-pinned (`story-42-9-doc-claims.test.ts`)");
  });

  it("has the measured dev row of 2026-11-21 (the output of `node scripts/measure-tools-payload.mjs` on freshly built dists)", () => {
    const row = (prefix: string): string => readme.split("\n").find((line) => line.startsWith(prefix)) ?? "";
    expect(row("| @iris-mcp/dev | 33 /")).toBe("| @iris-mcp/dev | 33 / 98,907 / ~24,727 | 15 / 45,835 / ~11,459 | 33 / 98,907 / ~24,727 |");
  });
});

describe("Story 42.9: the corrected facts", () => {
  /** The ten environment-variable tables that carry an `IRIS_USERNAME` row (DW-664). */
  const USERNAME_TABLES = [
    "README.md",
    "packages/iris-admin-mcp/README.md",
    "packages/iris-data-mcp/README.md",
    "packages/iris-dev-mcp/README.md",
    "packages/iris-interop-mcp/README.md",
    "packages/iris-ops-mcp/README.md",
    "packages/iris-mcp-all/README.md",
    "docs/client-config/claude-code.md",
    "docs/client-config/claude-desktop.md",
    "docs/client-config/cursor.md",
  ];

  it("IRIS_USERNAME is required, with no default, in all ten tables, and the code agrees", () => {
    expect(USERNAME_TABLES).toHaveLength(10);
    for (const rel of USERNAME_TABLES) {
      const rows = read(rel).split("\n").filter((line) => line.startsWith("| `IRIS_USERNAME` |"));
      expect(rows, `${rel}: one IRIS_USERNAME row`).toHaveLength(1);
      expect(rows[0], rel).toMatch(/\*\(required\)\*|\*\*Yes\*\*/);
      expect(rows[0], `${rel} gives no default`).not.toContain("`_SYSTEM`");
    }
    expect(read("packages/shared/src/config.ts")).toContain("IRIS_USERNAME environment variable is required.");
  });

  it("no reader document says IRIS_USERNAME defaults to _SYSTEM", () => {
    const offending = docs.filter((rel) => historyReason(rel) === undefined && /\| `IRIS_USERNAME` \|[^|]*`_SYSTEM`/.test(read(rel)));
    expect(offending).toEqual([]);
  });

  it("the plugin section gives the removal step for older entries, with the doctor check, the CLI command and claude mcp remove (DW-706)", () => {
    const flat = squash(read("README.md"));
    expect(flat).toContain("**Switching from the installer or `claude mcp add`: remove the old entries first.**");
    expect(flat).toContain("`claude-code-plugin-duplicates`");
    expect(flat).toContain("npx -y -p @iris-mcp/client-config@1 iris-mcp-clients remove --client claude-code --server iris-dev-mcp --scope user");
    expect(flat).toContain("`claude mcp remove iris-dev-mcp --scope local`");
    expect(read("packages/client-config/README.md")).toContain("`claude-code-plugin-duplicates`");
  });

  it("the IPM subsection gives the cleanup after an uninstall, with both calls (DW-690)", () => {
    const readme = read("README.md");
    expect(squash(readme)).toContain('`zpm "uninstall iris-execute-mcp-v2"` leaves two things behind, and removes neither.');
    expect(readme).toContain('Do ##class(Security.Applications).Delete("/api/executemcp/v2")');
    expect(readme).toContain('Do ##class(Config.MapPackages).Delete("%ALL","ExecuteMCPv2")');
    expect(squash(readme)).toContain("Run them only when no other namespace still uses the suite: the instance has one such web application and one such mapping");
  });

  it("no reader document describes a per-worker message table, and the documents say IRIS chooses the language per request (DW-633)", () => {
    const offending = docs.filter((rel) => historyReason(rel) === undefined && /per[- ]worker/i.test(read(rel)));
    expect(offending).toEqual([]);
    expect(squash(read("README.md"))).toContain("IRIS chooses the message language per request");
    expect(squash(read("tool_support.md"))).toContain("IRIS chooses the message language per request");
  });
});

describe("Story 42.9: the automatic install leads and IPM is the fallback (decision #123)", () => {
  const readme = read("README.md");
  const lead = squash(readme.slice(readme.indexOf("## Quick Start"), readme.indexOf("### 1. Install")));
  const ipm = squash(sectionsMatching(readme, 3, (title) => title === "Optional: Install the IRIS-Side Classes with IPM")[0] ?? "");
  const bootstrap = read("packages/shared/src/bootstrap.ts");

  it("the Quick Start opens with the automatic install, before any client path", () => {
    expect(lead).toContain("**The IRIS side installs itself.** The first time a server connects to a namespace, it deploys and compiles the `ExecuteMCPv2` classes there");
    expect(lead).toContain("Most users need nothing beyond the steps below. IPM is only the fallback for an instance where that automatic install cannot run");
    expect(readme.indexOf("**The IRIS side installs itself.**")).toBeLessThan(readme.indexOf("### 1. Install"));
  });

  it("the IPM section is the fallback and names the cases the bootstrap code shows", () => {
    expect(ipm).toContain("**Skip this section unless the automatic install cannot run.**");
    expect(ipm).toContain("Use [IPM](https://github.com/intersystems/ipm) only where that cannot happen");
    expect(ipm).toContain("**The connecting user cannot upload or compile classes in the namespace.**");
    expect(ipm).toContain("**The connecting user lacks `%Admin_Manage`.**");
    expect(ipm).toContain("**Your change control does not allow a client to deploy code to the instance.**");
    expect(bootstrap).toContain("`Deploy failed: ${msg}`");
    expect(bootstrap).toContain("`Compile failed: ${msg}`");
    expect(bootstrap).toContain("registration requires %Admin_Manage privileges");
  });

  it("states the consequence of IPM ownership and the way back to the automatic install, as the bootstrap warning does", () => {
    expect(ipm).toContain("So every upgrade of the classes must go through `zpm \"install iris-execute-mcp-v2 <version>\"` too");
    expect(ipm).toContain("which is how you return to the automatic install");
    expect(bootstrap).toContain("To hand '${namespace}' back to this server, run zpm \"uninstall ${IPM_MODULE_NAME}\" there and restart this server.");
  });

  it("does not describe how IPM reaches the registry (decision #122)", () => {
    // The removed repository name is built from parts, so that no file of the tree holds it (the removal is also checked by grep).
    expect(ipm).not.toMatch(new RegExp(`packaging repository|iris-execute-mcp-v2${"-ipm"}|module\\.xml|deploy key|publishes? the IPM`, "i"));
  });
});

describe("Story 42.9: what the published 1.0.0 CLI does not have yet is documented from 1.1.0 (AC 42.9.1, decision #116)", () => {
  // `npx -y -p @iris-mcp/client-config@1` resolves to 1.0.0 until 1.1.0 ships; 1.0.0 answers `unknown client "pi"` and has no home guard.
  it("the root README and the client index give the 1.1.0 floor for pi, jetbrains-junie, antigravity and the home-directory refusal", () => {
    const readme = squash(read("README.md"));
    expect(readme).toContain("`kimi-code`, from 1.1.0 `pi` and `jetbrains-junie`, or, for older installs,");
    expect(readme).toContain("From 1.1.0, a project-scope write (`--scope project`) is refused when the project directory is your home directory");
    expect(readme).toContain("The `antigravity` id is accepted from 1.1.0; on 1.0.x, use `gemini` for Antigravity CLI");
    expect(readme).toContain("- Project scope only: `--scope user` is refused, and from 1.1.0 so is a project directory that is your home directory");
    const index = read("docs/client-config/README.md");
    expect(index).toMatch(/^\| \S+ Pi \(from 1\.1\.0\) \|/m);
    expect(index).toMatch(/^\| \S+ JetBrains Junie \(from 1\.1\.0\) \|/m);
  });
});

describe("Story 42.9: the PRD's tool counts equal the tools/list snapshot (AC 42.9.3, DW-655)", () => {
  const snapshot = JSON.parse(read("packages/iris-mcp-all/src/__tests__/fixtures/tools-list-snapshot.json")) as {
    entryCount: number;
    servers: Record<string, Record<string, unknown>>;
  };
  const prd = squash(read("_bmad-output/planning-artifacts/prd.md"));
  const serverCount = Object.keys(snapshot.servers).length;
  const packageTools = snapshot.entryCount - serverCount;

  it("the suite totals: package tools, plus iris_server_profiles on each server, equal the snapshot's entryCount", () => {
    for (const tools of Object.values(snapshot.servers)) expect(Object.keys(tools)).toContain("iris_server_profiles");
    expect(Object.values(snapshot.servers).reduce((sum, tools) => sum + Object.keys(tools).length, 0)).toBe(snapshot.entryCount);
    expect(prd).toContain(`with ${packageTools} consolidated tools`);
    expect(prd).toContain(`${packageTools} tools across ${serverCount} servers (${snapshot.entryCount} advertised entries`);
    expect(prd).toContain(`All ${packageTools} consolidated tools implemented`);
    expect(prd).toContain(`${packageTools}/${packageTools} tools passing`);
  });

  it("each package line gives that server's package tools and advertised entries", () => {
    const names: Record<string, string> = { "iris-dev-mcp": "dev", "iris-admin-mcp": "admin", "iris-interop-mcp": "interop", "iris-ops-mcp": "ops", "iris-data-mcp": "data" };
    expect(Object.keys(snapshot.servers).sort()).toEqual(Object.keys(names).sort());
    for (const [server, tools] of Object.entries(snapshot.servers)) {
      const advertised = Object.keys(tools).length;
      const line = `\`@iris-mcp/${names[server] as string}\` \u2014 `;
      expect(prd, server).toContain(line);
      const rest = prd.slice(prd.indexOf(line) + line.length);
      expect(rest.slice(0, rest.indexOf(")") + 1), server).toMatch(new RegExp(`\\(${advertised - 1} tools, ${advertised} advertised\\)$`));
    }
  });
});
