/**
 * Shared helpers for the Story 41.5 QA tests (`story-41-5-qa-*.test.ts`): what a consumer of the BUILT prompt packages
 * reads, and a reader of a skill's frontmatter that is independent of the generator's and the validator's own grammar.
 *
 * Nothing here calls IRIS, and nothing writes to the repository.
 */

import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/** The server packages that own prompts, and how many each registers. */
export const PROMPT_PACKAGE_COUNTS: ReadonlyArray<readonly [pkg: string, count: number]> = [
  ["iris-admin-mcp", 2],
  ["iris-dev-mcp", 4],
  ["iris-interop-mcp", 4],
  ["iris-ops-mcp", 2],
];

/** A `skill` field that `gen:skills` and `validate:prompts` accept, as the source text of a stub prompt module. */
export const VALID_STUB_SKILL = '{ description: "A stub. Use when testing.", preset: "core" }';

/** The parts of a stub prompt that a row may change, each as it is written into the module: arguments as source text. */
export interface StubPromptFields {
  title?: string;
  description?: string;
  arguments?: string;
  body?: string;
}

/**
 * The source text of one stub prompt definition, for the `dist/prompts/index.js` of a scratch copy's ops package: the
 * name, a title, a description, the arguments and a one-line body, plus `skill: <skill>` unless `skill` is `null`.
 */
export function stubPromptSource(name: string, skill: string | null, fields: StubPromptFields = {}): string {
  return (
    `{ name: ${JSON.stringify(name)}, title: ${JSON.stringify(fields.title ?? "Stub")}, ` +
    `description: ${JSON.stringify(fields.description ?? "A stub prompt.")}, arguments: ${fields.arguments ?? "[]"}, ` +
    `${skill === null ? "" : `skill: ${skill}, `}build: () => ${JSON.stringify(fields.body ?? "A stub body.")} }`
  );
}

/** The tool presets, in the order a skill's declaration is the first that shows every tool it names. */
export const PRESET_ORDER = ["core", "developer", "full"] as const;

/** A prompt definition as a consumer that imports the built package sees it. */
export interface FreshDefinition {
  name: string;
  title: string;
  description: string;
  /** The definition's own property names, sorted. */
  keys: string[];
  /** The `skill` property's own names, sorted; `null` when the definition has none. */
  skillKeys: string[] | null;
  skillDescription: string | null;
  skillPreset: string | null;
  argumentNames: string[];
  /** `build({})`: the text a generated skill carries. */
  body: string;
}

/** Runs in a fresh Node process: imports the built prompts module named by argv[1] and prints its definitions as JSON. */
const FRESH_IMPORT = [
  'const { pathToFileURL } = await import("node:url");',
  "const mod = await import(pathToFileURL(process.argv[1]).href);",
  "const rows = mod.prompts.map((p) => ({",
  "  name: p.name, title: p.title, description: p.description,",
  "  keys: Object.keys(p).sort(),",
  "  skillKeys: p.skill === undefined ? null : Object.keys(p.skill).sort(),",
  "  skillDescription: p.skill === undefined ? null : p.skill.description,",
  "  skillPreset: p.skill === undefined ? null : p.skill.preset,",
  "  argumentNames: p.arguments.map((a) => a.name),",
  "  body: p.build({}),",
  "}));",
  "process.stdout.write(JSON.stringify(rows));",
].join("\n");

/**
 * The prompt definitions the BUILT package `pkg` exports, read by a new Node process that imports
 * `packages/<pkg>/dist/prompts/index.js` the way a consumer outside this test runner does.
 */
export function freshPromptDefinitions(repoRoot: string, pkg: string): FreshDefinition[] {
  const entry = join(repoRoot, "packages", pkg, "dist", "prompts", "index.js");
  const run = spawnSync(process.execPath, ["--input-type=module", "-e", FRESH_IMPORT, entry], {
    cwd: repoRoot,
    encoding: "utf8",
    timeout: 60_000,
  });
  if (run.status !== 0) throw new Error(`a fresh Node process could not import ${entry}: ${run.stderr}`);
  return JSON.parse(run.stdout) as FreshDefinition[];
}

/** The distinct `iris_*` tokens of a text, in first-seen order. */
export function irisTokens(text: string): string[] {
  return [...new Set(text.match(/\biris_[a-z][a-z0-9_]*/g) ?? [])];
}

/** The lines between the opening `---` (line 1) and the next `---`, or `null` when the text opens no frontmatter. */
export function frontmatterLines(text: string): string[] | null {
  const lines = text.split("\n");
  if (lines[0] !== "---") return null;
  const close = lines.indexOf("---", 1);
  return close < 0 ? null : lines.slice(1, close);
}

/**
 * The tool preset a SKILL.md declares: the `iris-tools-preset` entry of its `metadata:` map, read line by line.
 * `null` when the file has no frontmatter, no `metadata:` line or no such entry.
 */
export function declaredPreset(text: string): string | null {
  const lines = frontmatterLines(text);
  if (lines === null) return null;
  const at = lines.indexOf("metadata:");
  if (at < 0) return null;
  for (const line of lines.slice(at + 1)) {
    if (!line.startsWith("  ")) break;
    const match = /^ {2}iris-tools-preset: (.+)$/.exec(line);
    if (match) return match[1] ?? null;
  }
  return null;
}

/** The `description:` value of a SKILL.md, decoded from its JSON string; `null` when there is none. */
export function declaredDescription(text: string): string | null {
  const line = (frontmatterLines(text) ?? []).find((candidate) => candidate.startsWith("description: "));
  return line === undefined ? null : (JSON.parse(line.slice("description: ".length)) as string);
}

/** The directory names under `dir` that hold a `SKILL.md`, sorted. */
export function skillDirectories(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && existsSync(join(dir, entry.name, "SKILL.md")))
    .map((entry) => entry.name)
    .sort();
}

/** One agent-content file, read as it is on disk. */
export interface ContentFile {
  group: "workflow" | "pack-skill" | "knowledge" | "rule" | "pack-rule";
  /** Path relative to the repository root. */
  rel: string;
  text: string;
}

/**
 * Every agent-content file a user of the skills or the pack can load, found by listing the four locations
 * directly: `skills/`, the pack's `skills/` and `rules/`, and the hand-authored sources. Nothing here calls the
 * pack module's own enumeration.
 */
export function agentContentFiles(repoRoot: string): ContentFile[] {
  const out: ContentFile[] = [];
  const add = (group: ContentFile["group"], rel: string): void => {
    out.push({ group, rel, text: readFileSync(join(repoRoot, rel), "utf8") });
  };
  for (const name of skillDirectories(join(repoRoot, "skills"))) add("workflow", `skills/${name}/SKILL.md`);
  const pack = "packages/client-config/skills-pack";
  for (const name of skillDirectories(join(repoRoot, pack, "skills"))) add("pack-skill", `${pack}/skills/${name}/SKILL.md`);
  for (const name of skillDirectories(join(repoRoot, "skills-pack-src", "knowledge"))) add("knowledge", `skills-pack-src/knowledge/${name}/SKILL.md`);
  for (const file of readdirSync(join(repoRoot, "skills-pack-src", "rules")).sort()) add("rule", `skills-pack-src/rules/${file}`);
  for (const form of ["agents-md", "claude-code"]) {
    for (const file of readdirSync(join(repoRoot, pack, "rules", form)).sort()) add("pack-rule", `${pack}/rules/${form}/${file}`);
  }
  return out;
}
