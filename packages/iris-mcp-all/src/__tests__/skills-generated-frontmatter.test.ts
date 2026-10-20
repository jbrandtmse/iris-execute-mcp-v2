/**
 * Story 25.1 QA - generated `skills/<name>/SKILL.md` structural guard (AC 25.1.2, Rule #18), extended by
 * Story 41.5 (AC 41.5.1, AD-28) with each skill's model-invocation description and tool preset.
 *
 * ORTHOGONAL to `validate-prompts.test.ts`'s generated-skills describe block (which checks `iris_*` tokens, tool
 * presets and internal references inside skill bodies): this test checks the STRUCTURE every generated skill file
 * must carry, and the values that identify it.
 *
 *  - a skill directory exists for EVERY one of the 12 registered prompts (the original 9 v1 prompts of Story 25.1, plus
 *    `resend-failed-messages` (26.3), `promote-environment-change` (27.4), `edit-and-test-class` (38.6) and
 *    `find-patient-messages` (39.6), minus `objectscript-review`, retired in 41.2), with no orphan directory;
 *  - the frontmatter is exactly the one-line DO-NOT-EDIT comment, `name`, the skill `description` as one JSON string and
 *    the `metadata` map with `iris-tools-preset`, and it names no repository path and no tooling;
 *  - the typed ORACLE table below holds each skill's description, preset and sha256. It was rendered from the golden
 *    texts of the Story 41.5 spec and the bodies of 26dc8b2, not from the generator, so a generator or source edit that
 *    changes a skill cannot move it;
 *  - the description and the preset equal the prompt definition's own `skill` field, read from the built dist, and the
 *    description differs from the prompt's wire description.
 *
 * Reads `skills/` from disk (repo-committed generated output) and the prompts from the built dists (run the package
 * builds first). If `skills/` has not been generated in this checkout, the file-based suite is skipped gracefully.
 */

import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { loadAllPrompts } from "../../../../scripts/lib/prompt-catalog.mjs";
import { promptSkillProblems, renderWorkflowSkill, WORKFLOW_SKILL_COMMENT } from "../../../../scripts/lib/workflow-skills.mjs";
import { markdownHeadingSlugs } from "./pack-fixture";

const __dirname = dirname(fileURLToPath(import.meta.url));
// packages/iris-mcp-all/src/__tests__/ -> repo root is 4 levels up.
const root = resolve(__dirname, "../../../..");
const skillsDir = resolve(root, "skills");

interface SkillOracle {
  name: string;
  preset: "core" | "developer" | "full";
  /** The skill's description, verbatim (Story 41.5 spec, Design Notes, "Golden descriptions"). */
  description: string;
  /** sha256 of the whole `SKILL.md`. */
  sha256: string;
}

const SKILLS: SkillOracle[] = [
  {
    name: "audit-security-posture",
    preset: "full",
    description:
      "A read-only audit of an IRIS instance's security: users whose password settings look stale or that may use a well-known default credential, every user and role that holds %All, services that are enabled without authentication or not needed, SSL/TLS configurations with a minimum TLS version below 1.2 or missing certificate paths, and whether auditing is on, ending in a report of recommended fixes; it changes nothing. Use when the user asks to audit, review or harden IRIS security, asks who holds %All, or asks whether services, SSL/TLS or auditing are set up safely.",
    sha256: "8068f9063ec48465abe299f73391b61714f565f5d6cce6fe567ecc1ad84ae43d",
  },
  {
    name: "check-system-health",
    preset: "full",
    description:
      "Runs one composite health check of an IRIS instance across its nine areas (journal, databases, license, locks, alerts, mirror, ECP, interoperability and the system) and follows each warning, critical or error finding to the tool that explains or fixes it, never running a destructive fix without the user's confirmation. Use when the user asks whether IRIS is healthy or wants a health or status check, or reports trouble with journal space, database size, the license, locks or alerts.",
    sha256: "2cbc983d96fc39f826ab04ae7859de6f34c64d89a03c40c5d533561f7bd21cda",
  },
  {
    name: "deploy-and-test-class",
    preset: "developer",
    description:
      "Deploys an ObjectScript class or package from local source files to IRIS with a glob-path load and compile, fixes compile errors in the source and loads it again, runs its unit tests, compares the returned total with the number of test methods because an early partial result looks like a green run, re-attaches to a run that is still going instead of starting a second one, and measures line coverage when the user asks for it. Use when the user wants to deploy, load or import ObjectScript source into IRIS, compile it, run its %UnitTest tests, or see their coverage.",
    sha256: "ba24af252067fe92ce4046b5956b4e2918812b1ad0775371d9b25a238ab5448c",
  },
  {
    name: "diagnose-slow-query",
    preset: "developer",
    description:
      "Diagnoses a slow IRIS SQL query from its query plan, the maps and indexes the plan reads, and the statement's cumulative run-time statistics, looking for full table scans, missing indexes, hot statements and plan inefficiencies, then recommends a fix such as a new index or a rewritten WHERE clause without applying it. Use when the user says a SQL query is slow, asks why a query does not use an index, or wants a query plan explained.",
    sha256: "3a76caf480096ca68bdfdc47150d4c4e19db383b2c2a18e7321aa9ca8706d8f3",
  },
  {
    name: "edit-and-test-class",
    preset: "core",
    description:
      "Changes a few lines of an ObjectScript class directly in IRIS: reads the lines around the change, applies a guarded line edit that stores nothing when the class no longer matches what was read, compiles the class and fixes errors the same way, runs its unit tests and checks the returned total, and reports the diff. Use when the user wants a small fix or change to a class that lives in IRIS, especially one with no local source file, or asks to patch, compile and test a class in place.",
    sha256: "a26759dc2c6a14e57d28462a46a1bbd890fc3af7975d0c6d75af3bc714161b3f",
  },
  {
    name: "find-patient-messages",
    preset: "core",
    description:
      "Finds a patient's interoperability messages by an identifier such as a medical record number, through a Search Table and in search windows of at most 7 days, lists the matching message headers, and reads message bodies only when the user wants the content, under the PHI data policy, which by default redacts or withholds them. Use when the user asks for the messages, HL7 traffic or message history of a patient or medical record number in an IRIS interoperability production.",
    sha256: "9d0ccda8d608ca87c04de6e89384bc174afbef5c1ae742f0a2adf92cd1300193",
  },
  {
    name: "promote-environment-change",
    preset: "developer",
    description:
      "Promotes configuration and code drift from one IRIS environment to another in review-before-write order, diff -> plan -> confirmed execute -> second diff: it compares mappings, System Default Settings, web applications, supported CPF settings and, given a spec, ObjectScript source, executes only the plan steps the user picks and confirms, and checks that the promoted drift is gone. It never removes an item that exists only on the target. Use when the user wants to compare two IRIS servers or environments, or to promote, sync or copy changes from one to another, such as from development to test.",
    sha256: "e6458184bf4be63be6bea23d9cf1c1b141c50d820d04d0c9268d459bb5b6ed69",
  },
  {
    name: "provision-project-environment",
    preset: "core",
    description:
      "Provisions a new IRIS project environment in order: a DATA and a CODE database, a namespace over them, a user whose default namespace it is, and a web application, checking each step before the next, rolling back the completed steps when one fails, and naming the manual follow-up a new web application needs. Use when the user wants to set up or create a new IRIS project, namespace or application environment.",
    sha256: "dd8f6c73a0f16670fd93337c1fb6e2154f26fb9c246b313876b7adccd469498e",
  },
  {
    name: "recover-stuck-production",
    preset: "core",
    description:
      "Diagnoses and recovers a troubled or wedged interoperability production along an escalation ladder, in order: status, queues and error logs first, then the recover action, and the clean action only when recover does not fix it, never wiping persistent business state unless the user explicitly accepts the data loss. Use when an IRIS interoperability production is stuck, troubled or suspended, messages are not processing or queues are backing up, or the user asks to restart or recover a production.",
    sha256: "efb9c171934a20c6b6d1c611af976b4039f92d47962689e349e0bc70a433c6e1",
  },
  {
    name: "resend-failed-messages",
    preset: "core",
    description:
      "Resends failed interoperability messages for one configuration item, dry run first: it previews the match count and a sample, resends only after the user approves with an explicit confirmation, and then checks the new message headers. It states that a resend delivers the data downstream again and that the resend actions are writes disabled by default. Use when the user wants to retry, replay or resend failed or errored messages in an IRIS interoperability production.",
    sha256: "b9e38324de5fdf454f74f45b951000bc124ee5e56465fffef41dd8cb7a5b8ccf",
  },
  {
    name: "run-external-backup",
    preset: "full",
    description:
      "Freezes an IRIS instance for an external backup snapshot taken at the OS or SAN level, waits while the user takes the snapshot, and always thaws the instance afterwards, even when the snapshot fails, then confirms that journaling resumed and checks the run in the backup history. Use when the user wants to back up IRIS with an external OS-level or SAN snapshot, or asks to freeze and thaw IRIS database writes for a backup.",
    sha256: "40d01bd37a98297430ca307c2a1424a940f0b2521859e7c8e10d14ba3ee59764",
  },
  {
    name: "trace-message-flow",
    preset: "core",
    description:
      "Traces one interoperability message flow from a session or message header ID: lists every hop, searches the session's message headers, reads the bodies that matter under the PHI data policy, draws a sequence diagram, and pulls the error log entries of each failing item, then reports where the flow failed and recommends next steps, never running a recovery without the user's confirmation. Use when the user asks what happened to a message or session, why a message failed or never arrived, or how a message moved through an IRIS interoperability production.",
    sha256: "f3a2d19c2e362852419efc7ea22afd213586b41d1eae7f936b91c753ac16d6f0",
  },
];

const EXPECTED_SKILL_NAMES = SKILLS.map((skill) => skill.name);

/**
 * Minimal frontmatter parse: split on the first two `---` delimiter lines and return the frontmatter lines and the
 * body (the text after the closing line and the blank line that follows it). Deliberately simple (not a full YAML
 * parser): the exact lines are asserted by the tests below.
 */
function parseSkillMd(raw: string): { frontmatterLines: string[]; body: string } {
  const lines = raw.split("\n");
  expect(lines[0]).toBe("---");
  const closeIdx = lines.indexOf("---", 1);
  expect(closeIdx).toBeGreaterThan(0);
  expect(lines[closeIdx + 1], "one blank line follows the closing ---").toBe("");
  return { frontmatterLines: lines.slice(1, closeIdx), body: lines.slice(closeIdx + 2).join("\n") };
}

interface PromptDefinitionLike {
  name: string;
  description: string;
  skill?: { description: string; preset: string };
  build: (args: Record<string, string | undefined>) => string;
}

describe("the typed oracle table (AC 41.5.1)", () => {
  it("lists the 12 prompts once each", () => {
    expect(new Set(EXPECTED_SKILL_NAMES).size).toBe(12);
  });

  it.each(SKILLS)("$name: its description is printable ASCII, at most 1,024 characters, names what it covers then says when to use it", ({ description }) => {
    expect(/^[\x20-\x7e]+$/.test(description), "printable ASCII").toBe(true);
    expect(description.length).toBeLessThanOrEqual(1024);
    expect(description).not.toContain("|");
    expect(/<\/?[A-Za-z][^<>]*>/.test(description), "no XML-like tag").toBe(false);
    expect(/\biris_[a-z0-9_]+\b/.test(description), "no tool name").toBe(false);
    expect(description).toContain(". Use when ");
    expect(description.indexOf(". Use when "), "it names what the skill covers first").toBeGreaterThan(40);
  });
});

describe("generated skills/ directory structure (AC 25.1.2, AC 41.5.1)", () => {
  if (!existsSync(skillsDir)) {
    it.skip("skills/ has not been generated in this checkout - run `pnpm gen:skills` first", () => {});
    return;
  }

  it("has exactly one skill directory per v1 registered prompt, no orphans", () => {
    const dirNames = readdirSync(skillsDir, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .sort();
    expect(dirNames).toEqual([...EXPECTED_SKILL_NAMES].sort());
  });

  it.each(SKILLS)(
    "skills/$name/SKILL.md is the golden file: its sha256, a one-line DO-NOT-EDIT comment, name, description and the preset metadata",
    async ({ name, preset, description, sha256 }) => {
      const mdPath = resolve(skillsDir, name, "SKILL.md");
      expect(existsSync(mdPath)).toBe(true);
      const raw = readFileSync(mdPath, "utf-8");
      expect(createHash("sha256").update(raw).digest("hex"), "the whole file").toBe(sha256);

      const { frontmatterLines, body } = parseSkillMd(raw);
      expect(frontmatterLines).toEqual([
        "# DO NOT EDIT: generated from the MCP prompt of the same name.",
        `name: ${name}`,
        `description: ${JSON.stringify(description)}`,
        "metadata:",
        `  iris-tools-preset: ${preset}`,
      ]);
      expect(frontmatterLines[0]).toBe(WORKFLOW_SKILL_COMMENT);

      // The frontmatter names neither the generator script nor the package manager (Rule #18's pointer lives in skills/README.md).
      const frontmatter = frontmatterLines.join("\n");
      expect(frontmatter).not.toContain("gen-skills.mjs");
      expect(frontmatter).not.toContain("pnpm");
      expect(frontmatter).not.toContain("packages/");

      // Body: everything after the frontmatter must carry real instructional content.
      expect(body.trim().length).toBeGreaterThan(0);
    },
  );

  it("each skill's description and preset equal its prompt definition's skill field, its body equals the prompt's, and its description is not the prompt's", async () => {
    const entries = (await loadAllPrompts(root)) as Array<{ pkg: string; prompt: PromptDefinitionLike }>;
    expect(entries.map(({ prompt }) => prompt.name).sort()).toEqual([...EXPECTED_SKILL_NAMES].sort());
    for (const { prompt } of entries) {
      const oracle = SKILLS.find((skill) => skill.name === prompt.name);
      expect(oracle, `${prompt.name} is in the oracle table`).toBeDefined();
      expect(prompt.skill?.description, `${prompt.name} skill.description`).toBe(oracle?.description);
      expect(prompt.skill?.preset, `${prompt.name} skill.preset`).toBe(oracle?.preset);
      expect(prompt.skill?.description, `${prompt.name} skill.description differs from description`).not.toBe(prompt.description);

      const raw = readFileSync(resolve(skillsDir, prompt.name, "SKILL.md"), "utf-8");
      expect(parseSkillMd(raw).body, `${prompt.name} body`).toBe(`${prompt.build({})}\n`);
    }
  });

  it("skills/README.md is the generated pointer: its own DO-NOT-EDIT banner, the generator's name, the prompt sources, the catalog and the installer, and no skill table", () => {
    const readmePath = resolve(skillsDir, "README.md");
    expect(existsSync(readmePath)).toBe(true);
    const raw = readFileSync(readmePath, "utf-8");
    expect(raw).toMatch(/DO NOT EDIT/);
    expect(raw).toContain("gen-skills.mjs");
    expect(raw).toContain("packages/<server>/src/prompts/");
    expect(raw).toContain("packages/client-config/skills-pack/README.md");
    expect(raw).toContain("iris-mcp-clients skills install");
    expect(raw).toContain("#the-skills-pack");
    expect(raw).not.toContain("| Skill |");
    expect(raw).not.toContain("cp -r");
    expect(raw).not.toContain("objectscript-review");
    for (const { name } of SKILLS) {
      expect(raw, `${name} is listed only in the catalog`).not.toContain(`| \`${name}\` |`);
    }

    // The pointer's two links resolve from skills/: the catalog file, and the root README's heading.
    const links = [...raw.matchAll(/\]\(([^)]+)\)/g)].map((match) => match[1] as string);
    expect(links).toEqual(["../packages/client-config/skills-pack/README.md", "../README.md#the-skills-pack"]);
    for (const link of links) {
      const [file, anchor] = link.split("#") as [string, string | undefined];
      const target = resolve(skillsDir, file);
      expect(existsSync(target), `${link} resolves from skills/`).toBe(true);
      if (anchor !== undefined) {
        expect(markdownHeadingSlugs(readFileSync(target, "utf-8")).has(anchor), `${link} names a heading`).toBe(true);
      }
    }
  });
});

describe("promptSkillProblems and renderWorkflowSkill (AC 41.5.1)", () => {
  const prompt = (skill: unknown): { name: string; skill?: never; build: () => string } =>
    ({ name: "fixture-skill", build: () => "BODY", ...(skill === undefined ? {} : { skill }) }) as never;

  it("a prompt with a description and a preset has no problem", () => {
    expect(promptSkillProblems(prompt({ description: "Does a thing. Use when asked.", preset: "core" }))).toEqual([]);
  });

  it("a prompt with no skill field is told to give it one", () => {
    expect(promptSkillProblems(prompt(undefined))).toEqual([
      "has no skill field; give its prompt definition a skill with a description and a preset",
    ]);
    expect(promptSkillProblems(prompt(null))).toEqual([
      "has no skill field; give its prompt definition a skill with a description and a preset",
    ]);
  });

  it("an empty or blank description is refused, and so is a missing one", () => {
    for (const description of ["", "   ", undefined]) {
      expect(promptSkillProblems(prompt({ description, preset: "full" }))).toEqual(["has an empty skill description"]);
    }
  });

  it("a preset outside core, developer and full is refused by name", () => {
    expect(promptSkillProblems(prompt({ description: "D. Use when.", preset: "everything" }))).toEqual([
      'has the skill preset "everything", which is not one of core, developer and full',
    ]);
    expect(promptSkillProblems(prompt({ description: "D. Use when.", preset: undefined }))).toEqual([
      'has the skill preset "undefined", which is not one of core, developer and full',
    ]);
  });

  it("both problems of one prompt are reported", () => {
    expect(promptSkillProblems(prompt({ description: "", preset: "x" }))).toEqual([
      "has an empty skill description",
      'has the skill preset "x", which is not one of core, developer and full',
    ]);
  });

  it("renderWorkflowSkill renders the comment, name, JSON description, the metadata map and the body, each exactly", () => {
    const rendered = renderWorkflowSkill(
      prompt({ description: 'Quotes "stay" escaped. Use when a test renders.', preset: "developer" }) as never,
    );
    expect(rendered).toBe(
      [
        "---",
        "# DO NOT EDIT: generated from the MCP prompt of the same name.",
        "name: fixture-skill",
        'description: "Quotes \\"stay\\" escaped. Use when a test renders."',
        "metadata:",
        "  iris-tools-preset: developer",
        "---",
        "",
        "BODY",
        "",
      ].join("\n"),
    );
  });
});
