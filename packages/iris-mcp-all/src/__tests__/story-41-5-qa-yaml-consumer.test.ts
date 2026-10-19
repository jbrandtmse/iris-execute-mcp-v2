/**
 * Story 41.5 QA (AC 41.5.1, AC 41.5.4; project rule #59) - the skill frontmatter read by a REAL YAML parser.
 *
 * `check:provenance` and `gen:pack` read a skill's frontmatter with a small line reader of their own (`readSkillFrontmatter`).
 * A client that loads the skills does not: it hands the block to a YAML library. This file parses every `SKILL.md` frontmatter
 * with the `yaml` package of `@iris-mcp/client-config`, in a fresh Node process, and checks what that parser returns against
 * the Agent Skills shape: only `name`, `description` and `metadata`; a `metadata` map of string keys to string values; and
 * the comment line the generator writes inside the block is dropped by the parser, not read as a field.
 *
 * Three controls show the check can fail: a `metadata` value that is a scalar, a map value YAML types as a number, and a tab
 * indent the parser refuses. No IRIS, no network; the repository is only read.
 */

import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { REPO_ROOT } from "./pack-fixture";
import { agentContentFiles, declaredDescription, frontmatterLines, PRESET_ORDER, skillDirectories } from "./story-41-5-qa-fixture";

/**
 * Runs in a fresh Node process whose working directory is the client-config package, so `yaml` resolves as it does there.
 * The blocks arrive on stdin, so their size never meets a command-line length limit.
 */
const PARSE = [
  'const { parse } = await import("yaml");',
  'const { readFileSync } = await import("node:fs");',
  "const input = JSON.parse(readFileSync(0, \"utf8\"));",
  "const out = input.map(({ rel, yaml }) => {",
  "  try { return { rel, doc: parse(yaml, { strict: true }) }; }",
  "  catch (error) { return { rel, error: String(error && error.message ? error.message : error) }; }",
  "});",
  "process.stdout.write(JSON.stringify(out));",
].join("\n");

interface Parsed {
  rel: string;
  doc?: unknown;
  error?: string;
}

function parseWithYaml(blocks: Array<{ rel: string; yaml: string }>): Parsed[] {
  const run = spawnSync(process.execPath, ["--input-type=module", "-e", PARSE], {
    cwd: path.join(REPO_ROOT, "packages", "client-config"),
    input: JSON.stringify(blocks),
    encoding: "utf8",
    timeout: 60_000,
  });
  if (run.status !== 0) throw new Error(`the yaml package could not be loaded from packages/client-config: ${run.stderr}`);
  return JSON.parse(run.stdout) as Parsed[];
}

/** What is wrong with one parsed frontmatter, by the Agent Skills shape; empty when it is as a client expects. */
function shapeProblems(dirName: string, parsed: Parsed, expectMetadata: boolean): string[] {
  if (parsed.error !== undefined) return [`the YAML parser refuses it: ${parsed.error}`];
  const doc = parsed.doc;
  if (doc === null || typeof doc !== "object" || Array.isArray(doc)) return ["the frontmatter is not a mapping"];
  const fields = doc as Record<string, unknown>;
  const problems: string[] = [];
  const keys = Object.keys(fields).sort();
  const wanted = expectMetadata ? ["description", "metadata", "name"] : ["description", "name"];
  if (JSON.stringify(keys) !== JSON.stringify(wanted)) problems.push(`fields are ${keys.join(", ")}; expected ${wanted.join(", ")}`);
  if (fields.name !== dirName) problems.push(`name is ${JSON.stringify(fields.name)}, not the directory ${dirName}`);
  if (typeof fields.name !== "string" || !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(fields.name) || fields.name.length > 64) problems.push("name is not a lowercase hyphenated name of at most 64 characters");
  if (typeof fields.description !== "string" || fields.description.length === 0 || fields.description.length > 1024) problems.push("description is not a string of 1 to 1,024 characters");
  if (expectMetadata) {
    const metadata = fields.metadata;
    if (metadata === null || typeof metadata !== "object" || Array.isArray(metadata)) problems.push("metadata is not a map");
    else {
      const entries = Object.entries(metadata as Record<string, unknown>);
      if (entries.some(([key, value]) => typeof key !== "string" || typeof value !== "string")) problems.push("metadata is not a map of string keys to string values");
      if (JSON.stringify(entries.map(([key]) => key)) !== JSON.stringify(["iris-tools-preset"])) problems.push("metadata does not hold exactly iris-tools-preset");
      if (!(PRESET_ORDER as readonly string[]).includes(String((metadata as Record<string, unknown>)["iris-tools-preset"]))) problems.push("iris-tools-preset is not core, developer or full");
    }
  }
  return problems;
}

const skills = agentContentFiles(REPO_ROOT).filter((file) => file.group === "workflow" || file.group === "pack-skill" || file.group === "knowledge");
/** The directory names under `skills/`: the generated workflow skills, whose frontmatter carries a `metadata` map. */
const workflowNames = new Set(skillDirectories(path.join(REPO_ROOT, "skills")));

describe("every SKILL.md frontmatter, read by the yaml package, is what a skill client expects (AC 41.5.1, AC 41.5.4)", () => {
  const parsed = parseWithYaml(skills.map((file) => ({ rel: file.rel, yaml: (frontmatterLines(file.text) ?? []).join("\n") })));

  it("parses all 36 skills: 12 workflow, 18 in the pack and 6 knowledge sources", () => {
    expect(skills).toHaveLength(36);
    expect(workflowNames.size).toBe(12);
    expect(parsed.map((row) => row.rel)).toEqual(skills.map((file) => file.rel));
  });

  it.each(skills.map((file, index) => [file.rel, file, parsed[index] as Parsed] as const))("%s", (_rel, file, row) => {
    const dirName = path.basename(path.dirname(file.rel));
    expect(shapeProblems(dirName, row, workflowNames.has(dirName)), file.rel).toEqual([]);
    expect((row.doc as Record<string, unknown>).description, "the parser reads the description the generator wrote").toBe(declaredDescription(file.text));
  });

  it("the comment line inside a generated skill's frontmatter is read as a comment, not as a field", () => {
    const generated = skills.filter((file) => file.group === "workflow");
    expect(generated).toHaveLength(12);
    for (const file of generated) {
      expect((frontmatterLines(file.text) ?? [])[0], file.rel).toMatch(/^# DO NOT EDIT/);
      const doc = parsed[skills.indexOf(file)]?.doc as Record<string, unknown>;
      expect(Object.keys(doc).some((key) => key.startsWith("#") || key.startsWith("DO")), file.rel).toBe(false);
    }
  });
});

describe("the shape check can fail (project rule #59)", () => {
  const controls = parseWithYaml([
    { rel: "scalar-metadata", yaml: "name: demo\ndescription: \"A demo.\"\nmetadata: core" },
    { rel: "numeric-value", yaml: "name: demo\ndescription: \"A demo.\"\nmetadata:\n  iris-tools-preset: 3" },
    { rel: "tab-indent", yaml: "name: demo\ndescription: \"A demo.\"\nmetadata:\n\tiris-tools-preset: core" },
    { rel: "extra-field", yaml: "name: demo\ndescription: \"A demo.\"\nmetadata:\n  iris-tools-preset: core\ntags: x" },
  ]);
  const problems = (rel: string): string[] => shapeProblems("demo", controls.find((row) => row.rel === rel) as Parsed, true);

  it("a scalar metadata value, a numeric preset, a tab indent and an extra field are each refused", () => {
    expect(problems("scalar-metadata")).toContain("metadata is not a map");
    expect(problems("numeric-value")).toContain("metadata is not a map of string keys to string values");
    expect(problems("tab-indent")[0]).toMatch(/^the YAML parser refuses it/);
    expect(problems("extra-field")[0]).toMatch(/^fields are description, metadata, name, tags/);
  });
});
