/**
 * Story 42.2 (AC 42.2.4; project rules #30 and #43) - the documents say what the bootstrap downgrade guard does and how the live
 * test legs are armed.
 *
 * The shared suite pins the comparator and the orchestration (`bootstrap-version.test.ts`, `bootstrap.test.ts`) and
 * `live-arming-guard.test.ts` pins the arming; none of them reads a document. This file reads them, one claim each:
 *  - the root README has the "Shared Instances: Upgrade Every Client Together" subsection exactly once, directly after the
 *    self-healing subsection and inside Known Limitations; it says that a server built before this release still downgrades and
 *    that every client is upgraded together, gives the marker ordering and what the server does for a newer and a foreign
 *    deployment, and names both remedies;
 *  - the root README's Contributing note says that a plain `pnpm test` touches no IRIS instance and how a live leg is armed;
 *  - the `@iris-mcp/shared` README and `tool_support.md` no longer say that the bootstrap reconciles on every restart, and describe
 *    the ordered marker;
 *  - no README or `tool_support.md` line names a retired `IRIS_TEST_*` target variable except to say it is retired;
 *  - the CHANGELOG section of Story 42.2 holds the marker move, the `### Changed (AD-14)` block and the arming note;
 *  - the changeset is a minor bump of `@iris-mcp/shared` and nothing else.
 * Needs no IRIS and no built dist: it reads documents. Cross-package documentation checks live in `@iris-mcp/all` (rule #45).
 */

import { describe, it, expect } from "vitest";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// packages/iris-mcp-all/src/__tests__/ -> repo root is 4 levels up.
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..", "..");

function read(relative: string): string {
  return readFileSync(path.join(REPO_ROOT, relative), "utf8");
}

const squash = (text: string): string => text.replace(/\s+/g, " ");

/** The em dash the CHANGELOG uses in its section titles, by code point. */
const EM_DASH = "\u{2014}";

interface Heading {
  level: number;
  text: string;
  line: number;
}

/** The Markdown headings of a document, in order; a `#` line inside a code fence is not a heading. */
function headingsOf(document: string): Heading[] {
  const found: Heading[] = [];
  let fenced = false;
  document.split("\n").forEach((line, index) => {
    if (/^(```|~~~)/.test(line)) {
      fenced = !fenced;
      return;
    }
    const match = fenced ? null : /^(#{1,6}) /.exec(line);
    if (match) found.push({ level: match[1]?.length ?? 0, text: line, line: index });
  });
  return found;
}

/** The text under `heading`, up to the next heading of any level; "" when the heading is absent. */
function sectionUnder(document: string, heading: string): string {
  const headings = headingsOf(document);
  const at = headings.findIndex((candidate) => candidate.text === heading);
  if (at < 0) return "";
  const lines = document.split("\n");
  return lines.slice((headings[at]?.line ?? 0) + 1, headings[at + 1]?.line ?? lines.length).join("\n");
}

const SHARED_HEADING = "### Shared Instances: Upgrade Every Client Together";
const SELF_HEALING_HEADING = "### Migrated or `%SYS`-Reset Instances (Self-Healing)";
const KNOWN_LIMITATIONS_HEADING = "## Known Limitations";

/** The five variables an armed live leg requires. */
const LIVE_VARIABLES = ["IRIS_HOST", "IRIS_PORT", "IRIS_USERNAME", "IRIS_PASSWORD", "IRIS_NAMESPACE"];

/**
 * The `BOOTSTRAP_VERSION` values of the Story 42.2 move, as history literals: `changelog-bootstrap-move.test.ts` ties the newest
 * documented move to the committed embed, so a later move leaves this file true.
 */
const BOOTSTRAP_FROM = "d51856f74d6a";
const BOOTSTRAP_TO = "0.0.2+1.995fbbb1055d";

const rootReadme = read("README.md");
const changesetPath = ".changeset/story-42-2-bootstrap-downgrade-guard.md";

describe("Story 42.2: the root README, Shared Instances subsection", () => {
  it("is there exactly once, directly after the self-healing subsection and before the next ## heading", () => {
    const occurrences = rootReadme.split("\n").filter((line) => line === SHARED_HEADING).length;
    expect(occurrences, `README.md has "${SHARED_HEADING}" exactly once`).toBe(1);

    const headings = headingsOf(rootReadme);
    const selfHealing = headings.findIndex((heading) => heading.text === SELF_HEALING_HEADING);
    expect(selfHealing, "the self-healing subsection is still in README.md").toBeGreaterThanOrEqual(0);
    expect(headings[selfHealing + 1]?.text, "the subsection that follows the self-healing one").toBe(SHARED_HEADING);

    const limitations = headings.findIndex((heading) => heading.text === KNOWN_LIMITATIONS_HEADING);
    expect(limitations, "README.md has its Known Limitations section").toBeGreaterThanOrEqual(0);
    const after = headings.slice(limitations + 1).find((heading) => heading.level <= 2);
    const shared = headings[selfHealing + 1];
    expect(shared?.line, "the subsection is inside Known Limitations").toBeGreaterThan(headings[limitations]?.line ?? Infinity);
    expect(shared?.line, "the subsection ends before the next ## heading").toBeLessThan(after?.line ?? -1);
  });

  it("says that a server built before this release still downgrades and that every client that shares an instance is upgraded together", () => {
    const section = squash(sectionUnder(rootReadme, SHARED_HEADING));
    expect(section, "the Shared Instances subsection has a body").not.toBe("");
    expect(section).toContain("**A server built before this release still downgrades.**");
    expect(section).toContain("Earlier builds compare for equality only, so they redeploy their own classes over any deployment whose version differs, a newer one included.");
    expect(section, "the sentence that says every client is upgraded together").toContain("Upgrade every client that shares an instance together");
  });

  it("gives the marker grammar and ordering, and says a newer or foreign deployment is left alone with one [WARN]", () => {
    const raw = sectionUnder(rootReadme, SHARED_HEADING);
    const section = squash(raw);
    expect(section).toContain("`<semver>+<sequence>.<hash>`");
    expect(section).toContain("by semver first, then by sequence");
    expect(section).toContain("`SELECT ExecuteMCPv2.Setup_GetBootstrapVersion()`");
    const rows = raw.split("\n").filter((line) => line.startsWith("| **Newer**") || line.startsWith("| **Foreign**"));
    expect(rows, "one table row each for a newer and a foreign deployment").toHaveLength(2);
    for (const row of rows) {
      expect(row, row.slice(0, 20)).toContain("**Redeploys nothing.**");
      expect(row, row.slice(0, 20)).toContain("One `[WARN]` line on stderr names both markers and the remedy.");
    }
    expect(section).toContain("a bare 12-character hex hash, the marker of a build from before this release");
    expect(section).toContain("`dev`, the placeholder of a deployment loaded by hand from `src/`");
    expect(section).toContain("The marker is read again immediately before each compile");
  });

  it("names both remedies: upgrade for a newer deployment, one build per instance or deleting ExecuteMCPv2.Setup for a foreign one", () => {
    const section = squash(sectionUnder(rootReadme, SHARED_HEADING));
    expect(section, "newer: upgrade this server").toContain("upgrade this server to a build at least as new as the deployed one");
    expect(section, "newer: every client").toContain("run the same or a newer build on every client that shares the instance");
    expect(section, "foreign: one build per instance").toContain("run one build per instance");
    expect(section, "foreign: the deliberate install").toContain("delete the class `ExecuteMCPv2.Setup` in the namespace and restart the server");
  });

  it("the self-healing subsection reads the deployed marker, not a class-version hash match", () => {
    const section = squash(sectionUnder(rootReadme, SELF_HEALING_HEADING));
    expect(section, "the self-healing subsection has a body").not.toBe("");
    expect(section).toContain("a deployed version marker equal to the build's proves the *source* is current");
    expect(section).not.toContain("class-version hash matching");
  });
});

describe("Story 42.2: the Contributing note", () => {
  const contributing = rootReadme.indexOf("\n## Contributing\n");
  const note = contributing >= 0 ? squash(rootReadme.slice(contributing)) : "";

  it("says that a plain pnpm test touches no IRIS instance and that IRIS_REQUIRE_LIVE arms a live leg", () => {
    expect(contributing, "README.md has its Contributing section").toBeGreaterThanOrEqual(0);
    expect(note).toContain("A plain `pnpm test` touches no IRIS instance.");
    expect(note).toContain("only when `IRIS_REQUIRE_LIVE=1` (or `true`) is set");
    expect(note).toContain("a set `IRIS_HOST` alone arms nothing");
  });

  it("requires all five variables, names the retired target variables and leaves IRIS_TEST_TIMEOUT alone", () => {
    for (const variable of LIVE_VARIABLES) expect(note, variable).toContain(`\`${variable}\``);
    expect(note).toContain("all five");
    expect(note).toContain("There are no defaults");
    for (const retired of ["HOST", "PORT", "USERNAME", "PASSWORD", "NAMESPACE"]) {
      expect(note, `IRIS_TEST_${retired}`).toContain(`\`IRIS_TEST_${retired}\``);
    }
    expect(note).toContain("target variables are retired");
    expect(note).toContain("`IRIS_TEST_TIMEOUT`, the wait budget of `iris_execute_tests`, is a different setting and is unchanged");
  });
});

describe("Story 42.2: the shared README and tool_support.md", () => {
  it("the @iris-mcp/shared README describes the ordered marker, and no longer says that bootstrap deploys the classes if missing", () => {
    const sharedReadme = read("packages/shared/README.md");
    const bootstrap = squash(sectionUnder(sharedReadme, "### Bootstrap"));
    expect(bootstrap, "the shared README has its Bootstrap section").not.toBe("");
    expect(bootstrap).toContain("`<semver>+<sequence>.<hash>`; semver first, then sequence");
    expect(bootstrap).toContain("A newer or foreign deployment");
    expect(bootstrap).toContain("is never redeployed: nothing is uploaded or compiled, and one `[WARN]` names both markers and the remedy.");
    expect(bootstrap).toContain("The marker is read again immediately before each compile.");
    expect(bootstrap).toContain("A server built before this release still redeploys over a newer deployment, so every client that shares an instance is upgraded together.");
    expect(bootstrap).toContain("**`classifyDeployedMarker()`**");
    for (const old of [
      "Checks if the endpoint exists, deploys ObjectScript handler classes if missing",
      "Checks if the custom REST endpoint is already available.",
    ]) {
      expect(bootstrap, `the old claim "${old}"`).not.toContain(old);
    }
    expect(squash(sharedReadme)).not.toContain("Bootstrap checks for the custom REST endpoint and deploys it if missing");
  });

  it("tool_support.md no longer says that every restart reconciles, and says that a newer or foreign deployment is left alone", () => {
    const toolSupport = squash(read("tool_support.md"));
    expect(toolSupport).not.toContain("it guarantees that every server restart reconciles the IRIS-side handlers with the embedded classes");
    expect(toolSupport).toContain("on every server start it installs the embedded classes when they are absent and upgrades them when the deployed ones are older. It never downgrades:");
    expect(toolSupport).toContain("a newer or foreign deployment (same semver and sequence with another hash, `dev`, or an unparseable value) is left alone with one `[WARN]` naming both markers and the remedy.");
    expect(toolSupport).toContain("Builds from before Story 42.2 still redeploy over a newer deployment, so every client that shares an instance is upgraded together.");
    expect(toolSupport).toContain("(older deployments are upgraded, newer or foreign ones are never overwritten)");
  });

  it("no README or tool_support.md line names a retired IRIS_TEST_* target variable except to say it is retired", () => {
    const packages = readdirSync(path.join(REPO_ROOT, "packages")).filter((name) => existsSync(path.join(REPO_ROOT, "packages", name, "README.md")));
    expect(packages.length, "the packages that have a README").toBeGreaterThanOrEqual(7);
    const documents = ["README.md", "tool_support.md", ...packages.map((name) => `packages/${name}/README.md`)];
    const offenders: string[] = [];
    for (const document of documents) {
      for (const line of read(document).split("\n")) {
        if (/IRIS_TEST_(HOST|PORT|USERNAME|PASSWORD|NAMESPACE)/.test(line) && !squash(line).includes("target variables are retired")) {
          offenders.push(`${document}: ${line.slice(0, 80)}`);
        }
      }
    }
    expect(offenders, "a document that still tells a contributor to use a retired variable").toEqual([]);
  });
});

describe("Story 42.2: the CHANGELOG section", () => {
  const changelog = read("CHANGELOG.md");
  const sections = changelog.split(/^(?=## \[)/m).slice(1);
  const title = new RegExp(`^## \\[Pre-release ${EM_DASH} 2026-10-21\\] ${EM_DASH} Story 42\\.2: Bootstrap Downgrade Guard$`);
  const section = sections.find((candidate) => title.test(candidate.split("\n")[0] ?? "")) ?? "";

  it("is above the Story 42.11 section and names the BOOTSTRAP_VERSION move as literals", () => {
    expect(section, "the CHANGELOG has the Story 42.2 section").not.toBe("");
    const previous = sections.findIndex((candidate) => (candidate.split("\n")[0] ?? "").includes("Story 42.11:"));
    expect(previous, "the CHANGELOG still has the Story 42.11 section").toBeGreaterThanOrEqual(0);
    expect(sections.indexOf(section), "newest section first").toBeLessThan(previous);
    expect(squash(section)).toContain(`\`BOOTSTRAP_VERSION\` moves from \`${BOOTSTRAP_FROM}\` to \`${BOOTSTRAP_TO}\``);
  });

  it("states the counts and files that do not move", () => {
    const text = squash(section);
    expect(text).toContain("no tool count moves (110 package tools, 115 advertised)");
    expect(text).toContain("the frozen governance baseline stays at hash `1e62c5ad5bf7` (141 keys)");
    expect(text).toContain("the frozen SDK goldens and the tools-list snapshot are byte-unchanged");
  });

  it("has the Changed (AD-14) block: no downgrade, the re-check before compile, the marker and its state file, the AD-15 sanction", () => {
    const block = squash(/### Changed \(AD-14\)\n[\s\S]*?(?=\n### )/.exec(section)?.[0] ?? "");
    expect(block, "the section has a '### Changed (AD-14)' heading with a block").not.toBe("");
    for (const needle of [
      "**The bootstrap never downgrades.**",
      "A newer deployment, and a foreign one",
      "one `[WARN]` on stderr names both markers and the remedy",
      "The marker is read again immediately before each compile",
      "`<semver>+<sequence>.<hash>`",
      "`scripts/bootstrap-sequence.json`",
      "raises it by exactly 1 when the hash changes and leaves it alone otherwise",
      "**Sanctioned change to an existing behavior (AD-15).**",
      "is no longer overwritten at the next start",
      "**Builds from before this release still downgrade.**",
      "Upgrade every client that shares an instance together",
    ]) {
      expect(block, needle).toContain(needle);
    }
  });

  it("has the arming note: IRIS_REQUIRE_LIVE, the five variables, the retired names and a plain pnpm test touching no instance", () => {
    const block = squash(/\n### Changed\n[\s\S]*?(?=\n## \[|$)/.exec(section)?.[0] ?? "");
    expect(block, "the section has a '### Changed' block").not.toBe("");
    expect(block).toContain("**Live test legs are opt-in (DW-627, DW-518).**");
    expect(block).toContain("runs only when `IRIS_REQUIRE_LIVE` is `1` or `true`");
    for (const variable of LIVE_VARIABLES) expect(block, variable).toContain(`\`${variable}\``);
    expect(block).toContain("a set `IRIS_HOST` alone arms nothing");
    expect(block).toContain("target variables are retired");
    expect(block).toContain("A plain `pnpm test` therefore touches no IRIS instance");
  });
});

describe("Story 42.2: the default-outage gate's header (DW-518)", () => {
  it("records the write footprint of the first-touch bootstrap of the other profile, by the deployment it finds", () => {
    const source = read("packages/iris-mcp-all/src/__tests__/epic37-default-outage-gate.test.ts");
    const header = squash(source.slice(0, source.indexOf("*/")).replace(/^[ \t]*\* ?/gm, ""));

    expect(header).toContain("**Write footprint of the `other` leg (DW-518).**");
    expect(header).toContain("The legs themselves (`iris_server_info`, `iris_license_info`) only read.");
    for (const line of [
      "`current`, `newer` or `foreign`: nothing is written;",
      "`unconfigured` (the marker matches, the web app is absent): it recompiles,",
      "`stale`: it PUTs the 35 classes and compiles them",
      "`missing`: it PUTs, compiles, configures, maps the package to `%All` and ensures `^UnitTestRoot`.",
    ]) {
      expect(header, line).toContain(line);
    }
  });
});

describe("Story 42.2: the changeset", () => {
  // `changeset version` consumes (deletes) the file and moves its text into the generated package changelogs, so the bump is
  // checked while the file exists; the README and CHANGELOG claims above hold either way.
  const present = existsSync(path.join(REPO_ROOT, changesetPath));

  it.skipIf(!present)("bumps @iris-mcp/shared minor, and nothing else", () => {
    const frontmatter = /^---\n([\s\S]*?)\n---/.exec(read(changesetPath))?.[1] ?? "";
    const bumps = Object.fromEntries(
      frontmatter
        .split("\n")
        .map((line) => /^"([^"]+)": (\w+)$/.exec(line))
        .filter((match): match is RegExpExecArray => match !== null)
        .map((match) => [match[1] ?? "", match[2] ?? ""]),
    );

    expect(bumps).toEqual({ "@iris-mcp/shared": "minor" });
  });

  it.skipIf(!present)("names DW-508, the no-downgrade guard, the builds that still downgrade and the arming", () => {
    const text = squash(read(changesetPath));
    for (const needle of [
      "DW-508",
      "`<semver>+<sequence>.<hash>`",
      "one `[WARN]` names both markers and the remedy",
      "Builds from before this release still redeploy over a newer deployment, so upgrade every client that shares an instance together.",
      "`IRIS_REQUIRE_LIVE=1`",
    ]) {
      expect(text, needle).toContain(needle);
    }
  });
});
