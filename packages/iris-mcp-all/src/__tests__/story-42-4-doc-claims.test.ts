/**
 * Story 42.4 (AC 42.4.2, AC 42.4.3, AC 42.4.4, DW-674, DW-686; project rules #30 and #43) -- the documents say what the IPM package is, how
 * the bootstrap treats an IPM installation, and what CI proves. One claim each, on the pattern of `story-42-2-doc-claims.test.ts`:
 *  - the root README has the "Optional: Install the IRIS-Side Classes with IPM" subsection exactly once, directly after "4. Verify": the
 *    install command with its prerequisites and the registry command, that a package is published from the first release, the ownership rule
 *    and its way back, the IRIS-side no-downgrade guard, never `-dev`, and that no governed action is added;
 *  - "Shared Instances" has the IPM-owned row and the remedy bullet, and the rows and sentences that Story 42.2 pinned are still there;
 *  - the Continuous Integration section names four jobs, the `ipm` job and what it proves, the verbs it issues, and the 2026.1 floor with
 *    the dated run of 2025.3;
 *  - the CHANGELOG section of Story 42.4 is the newest, holds the marker move as literals (history: a later move leaves this file true),
 *    the DW-686 floor, and says no tool, wire or governance change;
 *  - the changeset is a patch bump of `@iris-mcp/shared` and nothing else.
 * Needs no IRIS and no built dist: it reads documents. Cross-package documentation checks live in `@iris-mcp/all` (rule #45).
 */

import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// packages/iris-mcp-all/src/__tests__/ -> repo root is 4 levels up.
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..", "..");

const read = (relative: string): string => readFileSync(path.join(REPO_ROOT, relative), "utf8");
const squash = (text: string): string => text.replace(/\s+/g, " ");

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

const IPM_HEADING = "### Optional: Install the IRIS-Side Classes with IPM";
const VERIFY_HEADING = "### 4. Verify";
const SHARED_HEADING = "### Shared Instances: Upgrade Every Client Together";
const CI_HEADING = "### Continuous Integration";

/** The marker move of this story, as history literals: `changelog-bootstrap-move.test.ts` ties the newest move to the committed embed. */
const BOOTSTRAP_FROM = "0.0.2+1.995fbbb1055d";
const BOOTSTRAP_TO = "0.0.2+2.244fe8623c76";

const readme = read("README.md");

describe("Story 42.4: the README IPM subsection", () => {
  const section = squash(sectionUnder(readme, IPM_HEADING));

  it("is there exactly once, directly after '4. Verify'", () => {
    expect(readme.split("\n").filter((line) => line === IPM_HEADING)).toHaveLength(1);
    const headings = headingsOf(readme);
    const verify = headings.findIndex((heading) => heading.text === VERIFY_HEADING);
    expect(verify, "the Verify subsection is still in README.md").toBeGreaterThanOrEqual(0);
    expect(headings[verify + 1]?.text).toBe(IPM_HEADING);
    expect(section, "the subsection has a body").not.toBe("");
  });

  it("gives the install command with its namespace, privilege, IPM version and the registry command", () => {
    const raw = sectionUnder(readme, IPM_HEADING);
    expect(raw).toContain('zpm "install iris-execute-mcp-v2 <version>"');
    expect(section).toContain("in the target namespace, as a user with `%Admin_Manage`, with IPM 0.10 or later installed in that namespace");
    expect(section).toContain('`zpm "repo -r -n registry -reset-defaults"`');
    expect(section).toContain('When `zpm "repo -list"` shows no registry');
    expect(section, "the version is the shared semver").toContain("the `@iris-mcp/shared` semver, which is the part of the version marker before the `+`");
  });

  it("says that a package is published from the first release, and that until then the server's bootstrap installs the classes", () => {
    expect(section).toContain("A package is published to the IPM registry from the first release (`1.0.0`)");
    expect(section).toContain("the server's own bootstrap installs the classes");
  });

  it("states the ownership rule and the way back", () => {
    expect(section).toContain("IPM then owns the classes in that namespace, and the server never redeploys them.");
    expect(section).toContain("`ExecuteMCPv2.InstallGuard`");
    expect(section).toContain("writes nothing there (no upload, no compile, no web application or mapping change) and logs one `[WARN]` line that names the `zpm` command");
    expect(section).toContain('`zpm "uninstall iris-execute-mcp-v2"` in that namespace hands it back to the server');
  });

  it("states the IRIS-side no-downgrade guard and its remedy", () => {
    expect(section).toContain("The install cannot downgrade a newer deployment.");
    expect(section).toContain("with the same ordering as the server (semver first, then sequence)");
    expect(section).toContain("over `dev` or another foreign marker");
    expect(section).toContain("and nothing is installed");
    expect(section).toContain("delete the class `ExecuteMCPv2.Setup` in the namespace and run the install again");
  });

  it("says which IPM versions refuse (CheckStatus) and which IPM the proof ran on", () => {
    expect(section).toContain("The manifest sets `CheckStatus` on the guard's invoke, because IPM 0.10.0 to 0.10.4 ignore a returned error status without it");
    expect(section).toContain("the CI proof runs on the IPM 0.10.5 that ships with the IRIS images it uses, and the earlier versions are not tested");
  });

  it("says never -dev, that Configure registers no application roles, and that no tool or governed action is added", () => {
    expect(section).toContain('Install with `zpm "install ..."` only, never with `-dev`.');
    expect(section).toContain("with no application roles");
    expect(section).toContain("This adds no tool and no governed action.");
  });
});

describe("Story 42.4: the Shared Instances table and remedies", () => {
  const raw = sectionUnder(readme, SHARED_HEADING);
  const section = squash(raw);

  it("has one IPM-owned row that writes nothing and warns once, and keeps the rows Story 42.2 pinned", () => {
    const rows = raw.split("\n").filter((line) => line.startsWith("| **IPM-owned**"));
    expect(rows, "one IPM-owned row").toHaveLength(1);
    expect(rows[0]).toContain("`ExecuteMCPv2.InstallGuard`");
    expect(rows[0]).toContain("**Writes nothing.**");
    expect(rows[0]).toContain("`[WARN]`");
    expect(rows[0]).toContain("the `zpm` commands");
    for (const kept of ["| **Newer**", "| **Foreign**"]) expect(raw.split("\n").filter((line) => line.startsWith(kept)), kept).toHaveLength(1);
  });

  it("has the remedy bullet for a deployment IPM installed, naming both commands, and the older bullets are still there", () => {
    expect(section).toContain("**The warning says the classes were installed by IPM:**");
    expect(section).toContain('run `zpm "install iris-execute-mcp-v2 <version>"` there as a user with `%Admin_Manage`');
    expect(section).toContain('run `zpm "uninstall iris-execute-mcp-v2"` there and restart the server');
    expect(section, "deleting Setup does not reinstall into an IPM namespace").toContain("Deleting the class `ExecuteMCPv2.Setup` and restarting does not reinstall anything in such a namespace");
    expect(section, "a namespace reaching the classes by mapping needs a manual Configure").toContain('run it as a user with `%Admin_Manage`');
    expect(section, "documents uploaded before the guard appeared stay").toContain("IPM was installed while the server was deploying: the uploaded documents stay in place");
    expect(section).toContain("upgrade this server to a build at least as new as the deployed one");
    expect(section).toContain("run one build per instance");
  });
});

describe("Story 42.4: the Continuous Integration section", () => {
  const section = squash(sectionUnder(readme, CI_HEADING));

  it("names four jobs and describes the ipm job: the archive, both editions, no network, the verbs, no publish", () => {
    expect(section).toContain("It has four jobs:");
    expect(section).toContain("- `ipm` builds the IPM archive");
    expect(section).toContain("never from `src/`");
    expect(section).toContain("each with no network (`node scripts/ci-ipm-archive.mjs`)");
    expect(section).toContain("`iris-community` 2026.2 container (`USER`)");
    expect(section).toContain("`irishealth-community` 2026.2 container (`HSCUSTOM`)");
    expect(section).toContain("On the community edition it shows that the install guard refuses a newer, `dev` or marker-less `Setup`");
    expect(section).toContain("on both editions it shows that 36 classes compile");
    expect(section).toContain("`%IPM_Repo.Definition` holds 0 rows at every read");
    expect(section).toContain("only the IPM verbs `load`, `package` and `list`");
    expect(section).toContain("publishes nothing and reads no secret");
    expect(section).toContain("after `gates` and `throwaway`");
  });

  it("states the oldest tested tag, 2026.1, with the dated green run of 2025.3 and both key dates (DW-686)", () => {
    expect(section).toContain("`iris-community` 2026.2 and on 2026.1 (the oldest tag that is tested");
    expect(section).toContain("the 2026.1 key is valid to 2027-03-27");
    expect(section).toContain("2025.3 passed every guard leg in CI run 39749804619 on 2026-10-22");
    expect(section).toContain("its key expires on 2026-11-13");
    expect(section, "the guard gate includes the IPM-owned leg").toContain("the leg that leaves an IPM installation alone");
  });
});

describe("Story 42.4: the CHANGELOG section", () => {
  const changelog = read("CHANGELOG.md");
  const sections = changelog.split(/^(?=## \[)/m).slice(1);
  const own = sections.find((candidate) => (candidate.split("\n")[0] ?? "").endsWith("Story 42.4: IPM Package Revival")) ?? "";
  const text = squash(own);

  it("is the section of Story 42.4, and it comes before the section of Story 42.3", () => {
    expect(own, "the CHANGELOG has a Story 42.4 section").not.toBe("");
    const titles = sections.map((candidate) => candidate.split("\n")[0] ?? "");
    expect(titles.findIndex((title) => title.endsWith("Story 42.4: IPM Package Revival"))).toBeLessThan(titles.findIndex((title) => title.endsWith("Story 42.3: CI Workflow")));
  });

  it("names the BOOTSTRAP_VERSION move as literals", () => {
    expect(text).toContain(`\`BOOTSTRAP_VERSION\` moves from \`${BOOTSTRAP_FROM}\` to \`${BOOTSTRAP_TO}\``);
  });

  it("covers the generated manifest, the guard, the ownership, the fallback text, the ipm job and the dated DW-686 floor", () => {
    for (const claim of [
      "`ipm/module.xml`",
      "`pnpm gen:bootstrap`",
      "`ExecuteMCPv2.InstallGuard`",
      "`ipmOwned`",
      "`manualInstructions` item 3",
      "The `ipm` CI job",
      "`scripts/ci-ipm-archive.mjs`",
      "`load`, `package` and `list`",
      "`iris-community:2026.1`",
      "run 39749804619",
      "(commit `6a8574f`, 2026-10-22)",
      "expires on 2026-11-13",
      "valid to 2027-03-27",
      "DW-674",
      "DW-686",
      "DW-34",
    ]) {
      expect(text, claim).toContain(claim);
    }
  });

  it("says that a guard found only at the re-check comes after the upload, so the documents stay and the compile is skipped", () => {
    expect(text).toContain("at startup, on every path that would write (`stale`, `unconfigured`, `missing`) the server uploads, compiles and configures nothing");
    expect(text).toContain("class documents were uploaded, so those stay, and the compile and every later step are skipped");
  });

  it("says no tool, wire or governance change", () => {
    expect(text).toContain("No tool, action, governance key, preset row, annotation, refusal code, product environment variable, REST route or REST response is added, removed or changed");
    expect(text).toContain("the frozen governance baseline stays at hash `1e62c5ad5bf7` (141 keys)");
    expect(text).toContain("`classes[]` is unchanged (35 classes)");
  });
});

describe("Story 42.4: the changeset", () => {
  const file = ".changeset/story-42-4-ipm-package-revival.md";
  // `changeset version` consumes (deletes) the file and moves its text into the generated package changelogs, so the bump is
  // checked while the file exists; the README and CHANGELOG claims above hold either way.
  const present = existsSync(path.join(REPO_ROOT, file));

  it.skipIf(!present)("is a patch bump of @iris-mcp/shared and nothing else", () => {
    const text = read(file);
    const front = /^---\n([\s\S]*?)\n---\n/.exec(text)?.[1] ?? "";
    expect(front.split("\n").filter((line) => line.trim() !== "")).toEqual(['"@iris-mcp/shared": patch']);
    expect(text).toContain("`MANUAL_INSTRUCTIONS` item 3");
    expect(text).toContain("`ipmOwned`");
    expect(text).not.toMatch(/: (?:major|minor)\b/);
  });
});
