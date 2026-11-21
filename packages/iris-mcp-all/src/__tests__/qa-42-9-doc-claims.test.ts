/**
 * Story 42.9 QA (AC 42.9.1; project rules #56 and #59; decisions #116, #122 and #123) - the documentation guards, widened where the
 * implement stage's guards were narrower than the rule they enforce.
 *
 *  1. Rule #56, the caveat inventory. `story-42-9-doc-claims.test.ts` greps a NARROW wording (`not yet published`, `until published`, ...).
 *     The spec's inventory used a broader search. This file re-runs the inventory's own regex over every reader document and compares each
 *     hit with a reviewed allowlist, so a caveat in a new place (or a new document) shows up as a failure that needs a verdict.
 *  2. DW-707 / decision #116. The existing version-floor row recognizes three install commands. The install instructions of the four
 *     channels that are not live before 1.1.0 (the plugin, the extension, IPM, the MCP Registry) are matched here in every spelling the
 *     documents use, and each must sit in a paragraph, or under a heading, that says 1.1.0.
 *  3. Decision #123. IPM is the fallback: every document that tells a reader to run `zpm "install` is named, the README's first such
 *     command comes after the "Skip this section unless" lead, and each case the section lists is a state the code produces.
 *  4. The link checker's blind spots. It reads inline `[text](target)` links; a reference-style definition or an HTML `href`/`src`
 *     would pass it unchecked, so no reader document may use either.
 *
 * Reads documents and source text only; needs no IRIS and no built dist.
 */

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { readerDocs } from "./doc-set";
import { REPO_ROOT } from "./pack-fixture";

const read = (relative: string): string => readFileSync(path.join(REPO_ROOT, relative), "utf8");
const docs = readerDocs();

/** Dated or historical records: they say what was true then. */
const isHistory = (rel: string): boolean =>
  rel === "CHANGELOG.md" || rel.endsWith("/CHANGELOG.md") || rel === "docs/epic-summary.md" || /^docs\/(?:bugs|known-bugs)-/.test(rel);

/** The search the spec's Rule #56 inventory ran (Code Map, "Rule #56 caveat inventory"), with its "until ... published" alternative widened to
 * up to three words between, so that it also matches the commonest wording, "Until packages are published". */
const INVENTORY =
  /not yet published|not published|until (?:[a-z]+ ){0,3}published|before (the )?publish|unpublished|git clone|clone the repo|build from source|pnpm install && pnpm build|pnpm (run )?build|local path|dist\/index\.js|\bbeta\b|coming soon|once published|after publish|not yet (on|available)|pre-release|prerelease/i;

/**
 * Every hit the inventory regex has in a non-history reader document, with its verdict (2026-11-21, reviewed against the inventory
 * table). `where` is a regular expression over the hit line; `max` caps how many lines of that file it may excuse.
 */
const REVIEWED: Array<{ file: string; where: RegExp; reason: string; max: number }> = [
  { file: "README.md", where: /Linux specifics\.\*\* VS Code is Electron/, reason: "VS Code config-root path discussion; 'local path' is not a publication caveat", max: 1 },
  { file: "README.md", where: /`sourceFile` is a local path/, reason: "describes a field of a profile, not the install", max: 1 },
  { file: "README.md", where: /git clone|pnpm install|"args": \["\/path\/to|packages\/iris-[a-z]+-mcp\/dist\/index\.js/, reason: "inside ## Contributing: clone-and-build and the entry-point table are contributor docs", max: 8 },
  { file: "extensions/iris-mcp-launcher/README.md", where: /dist\/index\.js|npm run package|checkout/, reason: "the extension's development-mode sections (a local build is the point)", max: 14 },
  { file: "packages/client-config/README.md", where: /unpublished as of 2026-07-28|no bin, so its in-session launch fails/, reason: "dated certification evidence inside CERTIFICATION-TABLE; the lead's re-run replaces it", max: 2 },
  { file: "packages/iris-admin-mcp/README.md", where: /Breaking \(pre-release\)/, reason: "dated schema-history note", max: 2 },
  { file: "packages/iris-data-mcp/README.md", where: /Breaking change \(pre-release\)|pre-release, before the Story 12\.5 rename/, reason: "dated schema-history note", max: 2 },
  { file: "packages/iris-dev-mcp/README.md", where: /ENAMETOOLONG: local path exceeds/, reason: "an example error string about a Windows path length", max: 3 },
  { file: "tool_support.md", where: /beta users without manual intervention/, reason: "the word beta in a past-tense design note about the version-stamped auto-upgrade; not a publication caveat", max: 1 },
  { file: "tool_support.md", where: /Pre-release breaking change|BREAKING pre-release/, reason: "dated schema-history note", max: 2 },
  { file: "SECURITY.md", where: /until an advisory is published/, reason: "the disclosure process (a security advisory is published), not a package publication caveat", max: 1 },
];

describe("QA 42.9 (Rule #56): the caveat inventory, re-run with its own regex, has only reviewed hits", () => {
  it("the inventory regex can fail: it matches each of the spec's caveat wordings", () => {
    for (const sample of ["not yet published to npm", "Until they are published", "Until packages are published", "Once published", "git clone https://x", "pnpm build", "dist/index.js", "Pre-release:", "not yet available", "build from source"]) {
      expect(INVENTORY.test(sample), sample).toBe(true);
    }
  });

  it("every hit in a non-history reader document is reviewed (a new caveat, or a new document with one, is a failure that needs a verdict)", () => {
    const unreviewed: string[] = [];
    const used = new Map<number, number>();
    for (const rel of docs) {
      if (isHistory(rel)) continue;
      read(rel).split("\n").forEach((line, index) => {
        if (!INVENTORY.test(line)) return;
        const entryIndex = REVIEWED.findIndex((entry) => entry.file === rel && entry.where.test(line) && (used.get(REVIEWED.indexOf(entry)) ?? 0) < entry.max);
        if (entryIndex < 0) unreviewed.push(`${rel}:${index + 1} ${line.trim().slice(0, 110)}`);
        else used.set(entryIndex, (used.get(entryIndex) ?? 0) + 1);
      });
    }
    expect(unreviewed).toEqual([]);
  });

  it("every reviewed entry still excuses at least one hit (the allowlist cannot rot into a blanket pass)", () => {
    const hits = (entry: (typeof REVIEWED)[number]): number =>
      read(entry.file)
        .split("\n")
        .filter((line) => INVENTORY.test(line) && entry.where.test(line)).length;
    for (const entry of REVIEWED) expect(hits(entry), `${entry.file}: ${entry.reason}`).toBeGreaterThan(0);
  });
});

describe("QA 42.9 (DW-707, decision #116): every install instruction for a channel that starts at 1.1.0 says 1.1.0", () => {
  /** Install instructions for the plugin, the extension, IPM and the MCP Registry, in the spellings the documents and clients use. */
  const INSTALL =
    /\/plugin (?:marketplace add|install)|claude plugin (?:marketplace add|install)|--install-extension\s+iris-mcp|ext install iris-mcp|zpm "install iris-execute-mcp-v2|marketplace\.visualstudio\.com\/items\?itemName=iris-mcp|open-vsx\.org\/extension\/iris-mcp|registry\.modelcontextprotocol\.io|io\.github\.jbrandtmse/;

  /**
   * Places that carry such an instruction without a 1.1.0 qualifier, each with its reason. Nothing else may.
   * - the IPM-owned troubleshooting bullets: they remedy a namespace that IPM already owns, which only a 1.1.0 install can create.
   */
  const KNOWN_UNQUALIFIED: Array<{ file: string; where: RegExp; reason: string }> = [
    { file: "README.md", where: /^README\.md:\d+ - \*\*The warning says the classes were installed by IPM/, reason: "remedy for a namespace IPM already owns, which only a 1.1.0 install can create" },
    { file: "README.md", where: /^README\.md:\d+ \*\*MCP Registry\.\*\*/, reason: "the Releasing section's description of the release workflow's registry channel (contributor docs), not an install instruction" },
  ];

  function unqualified(rel: string, text: string): string[] {
    const lines = text.split("\n");
    const out: string[] = [];
    lines.forEach((line, index) => {
      if (!INSTALL.test(line)) return;
      let start = index;
      while (start > 0 && (lines[start - 1] as string).trim() !== "") start -= 1;
      let end = index;
      while (end < lines.length - 1 && (lines[end + 1] as string).trim() !== "") end += 1;
      const paragraph = lines.slice(start, end + 1).join("\n");
      // The section the instruction sits in (its nearest heading to the next heading) and the headings above it: a "(from 1.1.0)" heading
      // or a sentence "from 1.1.0" in the same section covers it.
      let sectionStart = index;
      while (sectionStart > 0 && !/^#{1,6}\s/.test(lines[sectionStart] as string)) sectionStart -= 1;
      let sectionEnd = index + 1;
      while (sectionEnd < lines.length && !/^#{1,6}\s/.test(lines[sectionEnd] as string)) sectionEnd += 1;
      const section = lines.slice(sectionStart, sectionEnd).join("\n");
      const headings = lines.slice(0, index).filter((candidate) => /^#{1,6}\s/.test(candidate)).slice(-3).join("\n");
      if (!paragraph.includes("1.1.0") && !section.includes("1.1.0") && !headings.includes("1.1.0")) out.push(`${rel}:${index + 1} ${line.trim().slice(0, 100)}`);
    });
    return out;
  }

  it("the matcher can fail: an install command with no version floor is reported, one with it is not", () => {
    expect(unqualified("x.md", "# Title\n\nRun `/plugin install iris-mcp@iris-mcp` now.")).toHaveLength(1);
    expect(unqualified("x.md", "# Title\n\nFrom 1.1.0, run `/plugin install iris-mcp@iris-mcp`.")).toEqual([]);
    expect(unqualified("x.md", "## Plugin (from 1.1.0)\n\n### Steps\n\n```\n/plugin install iris-mcp@iris-mcp\n```")).toEqual([]);
    expect(unqualified("x.md", "Use `codium --install-extension iris-mcp.iris-mcp-launcher`.")).toHaveLength(1);
    expect(unqualified("x.md", 'Run zpm "install iris-execute-mcp-v2 1.1.0"')).toEqual([]);
    expect(unqualified("x.md", 'Run zpm "install iris-execute-mcp-v2 <version>"')).toHaveLength(1);
  });

  it("every instruction outside the history files is qualified, or is a named exception", () => {
    const loose: string[] = [];
    for (const rel of docs) {
      if (isHistory(rel)) continue;
      for (const hit of unqualified(rel, read(rel))) {
        const excused = KNOWN_UNQUALIFIED.some((entry) => hit.startsWith(`${entry.file}:`) && entry.where.test(hit));
        if (!excused) loose.push(hit);
      }
    }
    expect(loose).toEqual([]);
  });

  it("each named exception still exists (fixing the document removes its entry)", () => {
    for (const entry of KNOWN_UNQUALIFIED) {
      const hits = unqualified(entry.file, read(entry.file)).filter((hit) => entry.where.test(hit));
      expect(hits.length, `${entry.file}: ${entry.reason}`).toBeGreaterThan(0);
    }
  });

  it("the installer's own plugin pointer in the CLI help and README does not tell a 1.0.x reader to install the plugin", () => {
    const cliReadme = read("packages/client-config/README.md");
    for (const line of cliReadme.split("\n")) {
      if (/\/plugin (?:marketplace add|install)/.test(line)) expect(line, "an install command in the CLI README carries its floor on the line").toContain("1.1.0");
    }
  });
});

describe("QA 42.9 (decision #123): IPM is only the fallback, and each case the section names is a state the code produces", () => {
  const readme = read("README.md");

  it("a `zpm \"install` command appears in exactly the documents reviewed here (README.md and the packaging text is not a reader doc)", () => {
    const carriers = docs.filter((rel) => !isHistory(rel) && /zpm "install/.test(read(rel)));
    expect(carriers).toEqual(["README.md"]);
  });

  it("the README's first `zpm \"install` command comes after the fallback lead, inside the IPM section, and its section says from 1.1.0", () => {
    const first = readme.indexOf('zpm "install');
    const lead = readme.indexOf("**Skip this section unless the automatic install cannot run.**");
    const heading = readme.indexOf("### Optional: Install the IRIS-Side Classes with IPM");
    expect(heading).toBeGreaterThan(0);
    expect(lead).toBeGreaterThan(heading);
    expect(first).toBeGreaterThan(lead);
    const next = readme.indexOf("\n### ", heading + 10);
    const section = readme.slice(heading, next < 0 ? undefined : next);
    expect(section).toContain("from 1.1.0");
    expect(section.indexOf("from 1.1.0")).toBeGreaterThan(0);
  });

  it("no heading, table row or install table before the IPM section presents IPM as an install path", () => {
    const before = readme.slice(0, readme.indexOf("### Optional: Install the IRIS-Side Classes with IPM"));
    expect(before).not.toMatch(/zpm "install/);
    for (const line of before.split("\n")) {
      if (/^\|/.test(line) && /\bIPM\b/.test(line)) expect(line, "an IPM mention in an install table says it is optional or the fallback").toMatch(/fallback|optional|only|Optional/i);
    }
  });

  it("each case the IPM section lists is produced by the code it names", () => {
    const bootstrap = read("packages/shared/src/bootstrap.ts");
    const setup = read("src/ExecuteMCPv2/Setup.cls");
    // Case 1: cannot upload or compile -> `Deploy failed` / `Compile failed` errors in the startup report.
    expect(readme).toContain("`Deploy failed` or `Compile failed`");
    expect(bootstrap).toMatch(/errors\.push\(`Deploy failed: /);
    expect(bootstrap).toMatch(/errors\.push\(`Compile failed: /);
    // Case 2: lacks %Admin_Manage -> `configured: false` and a logged warning with the manual instructions, repaired by `Setup.Configure("<namespace>")` in %SYS.
    expect(readme).toContain("registration requires `%Admin_Manage` privileges, with manual instructions");
    expect(bootstrap).toMatch(/configured: false/);
    expect(bootstrap).toContain("registration requires %Admin_Manage privileges");
    expect(readme).toContain('Do ##class(ExecuteMCPv2.Setup).Configure("<namespace>")');
    expect(setup).toMatch(/ClassMethod Configure\(pNamespace As %String = ""\) As %Status/);
    // The consequence: with the IPM-only guard class present, the bootstrap writes nothing and names the zpm commands.
    expect(bootstrap).toContain("ExecuteMCPv2.InstallGuard");
    expect(bootstrap).toMatch(/run zpm "install \$\{IPM_MODULE_NAME\} \$\{PACKAGE_SEMVER\}"/);
  });

  it("the README gives the two cleanup calls for an IPM uninstall", () => {
    expect(readme).toContain('Do ##class(Security.Applications).Delete("/api/executemcp/v2")');
    expect(readme).toContain('Do ##class(Config.MapPackages).Delete("%ALL","ExecuteMCPv2")');
  });

  // Rule #16: the snapshot of the system source is gitignored, so a clean checkout (CI) reports this row as skipped, not passed.
  const apps = path.join(REPO_ROOT, "irissys", "Security", "Applications.cls");
  const maps = path.join(REPO_ROOT, "irissys", "Config", "CommonMapMethods.cls");
  it.skipIf(!existsSync(apps) || !existsSync(maps))("the two cleanup calls are calls the IRIS system classes have (local system-source snapshot)", () => {
    expect(readFileSync(apps, "utf8")).toMatch(/ClassMethod Delete\(Name As %String/);
    expect(readFileSync(maps, "utf8")).toMatch(/ClassMethod Delete\(/);
  });
});

describe("QA 42.9 (Rule #59): what the link checker cannot see, no reader document uses", () => {
  it("no reader document has a reference-style link definition or an HTML href/src (the inline-link checker would skip them)", () => {
    const blind: string[] = [];
    for (const rel of docs) {
      let fenced = false;
      read(rel).split("\n").forEach((line, index) => {
        if (/^\s*(```|~~~)/.test(line)) fenced = !fenced;
        if (fenced) return;
        const visible = line.replace(/`[^`]*`/g, "");
        if (/^\s{0,3}\[[^\]]+\]:\s*\S+/.test(visible) || /<(?:a|img)\s[^>]*\b(?:href|src)=/i.test(visible)) blind.push(`${rel}:${index + 1} ${line.trim().slice(0, 80)}`);
      });
    }
    expect(blind).toEqual([]);
  });

  it("every reader document that the checker reads is in the doc set the claims test reads (one source: doc-set.ts)", () => {
    expect(docs.length, "82 after the 1.1.0 version step consumed the two story changesets").toBeGreaterThanOrEqual(82);
    expect(new Set(docs).size).toBe(docs.length);
    expect(docs.every((rel) => rel.endsWith(".md"))).toBe(true);
  });
});
