/**
 * Story 41.7 -- AC 41.7.1 and DW-624: every claim of the skills pack documentation is checked against the source of truth
 * it describes, never against another copy of the same words (project rules #51 and #59).
 *
 * The sources: the pack tree on disk, the built `@iris-mcp/client-config` dist (`PACK_TARGETS`, `PACK_ROUTES`,
 * `MANIFEST_PATH`, `LINK_DETAILS`), the built bin's own output (its `Usage:` line, `--help`, and its refusals), and the
 * `core` and `developer` rosters of the built admin server. The documents: the root README's `### The skills pack` section,
 * the retirement sentence (root and dev READMEs), the `#the-skills-pack` links (root README, four package READMEs and
 * `tool_support.md`), and the catalog's not-nested sentence.
 *
 * Every command the section documents is run with `--dry-run` and `--project` pointed at a temp project; each exits 0 and
 * writes nothing. The bin runs with HOME, USERPROFILE and APPDATA set to temp directories, so nothing reaches the real home.
 *
 * Needs the built client-config dist and the built server dists (the preset rosters); a stale client-config dist fails the
 * file with the remedy. No IRIS is contacted. Cross-package documentation checks live in `@iris-mcp/all` (rule #45).
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  existsSync,
  linkSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { checkDistFresh } from "../../../../scripts/lib/dist-freshness.mjs";
import { loadToolPresetCatalog } from "../../../../scripts/lib/tool-catalog.mjs";
import { declaredToolPreset } from "../../../../scripts/lib/validate-prompts-core.mjs";
import { makeTempRoot, REPO_ROOT, removeTempRoot, runNode } from "./pack-fixture";

const CLIENT_CONFIG = path.join(REPO_ROOT, "packages", "client-config");
const PACK = path.join(CLIENT_CONFIG, "skills-pack");
const DOC_BIN = "packages/client-config/dist/cli/clients-cli.js";
const BIN = path.join(REPO_ROOT, ...DOC_BIN.split("/"));

interface PackTarget {
  id: string;
  displayName: string;
  route: string | null;
  noRouteReason?: string;
}
interface PackRoute {
  id: string;
  skillsDir: string;
  rule: { kind: "file"; form: "claudeCode" | "cursor" | "agentsMd"; dir: string } | { kind: "block"; host: string };
}
interface PackTargetsModule {
  PACK_TARGETS: readonly PackTarget[];
  PACK_ROUTES: Readonly<Record<string, PackRoute>>;
  PACK_ROUTE_IDS: readonly string[];
  CLAUDE_DESKTOP_REFUSAL: string;
  RULE_FORM_EXTENSIONS: Readonly<Record<string, string>>;
}
interface PackPlanModule {
  MANIFEST_PATH: string;
  LINK_DETAILS: Readonly<Record<"symbolic" | "hard", string>>;
}

let targets: PackTargetsModule;
let plan: PackPlanModule;
let rosters: Record<string, { core: { include: string[] }; developer: { include: string[] } }>;
let temp: string;
let home: string;
let project: string;

function read(relative: string): string {
  return readFileSync(path.join(REPO_ROOT, relative), "utf8");
}

const squash = (text: string): string => text.replace(/\s+/g, " ");

function directories(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

/** The `### The skills pack` section of the root README, up to the thematic break that ends the chapter. */
function skillsPackSection(readme: string): string {
  const start = readme.indexOf("\n### The skills pack\n");
  expect(start, "the README has the `### The skills pack` section").toBeGreaterThan(-1);
  const end = readme.indexOf("\n---\n", start);
  expect(end).toBeGreaterThan(start);
  return readme.slice(start + 1, end);
}

/** GitHub's heading slug: lower case, punctuation dropped, spaces to hyphens. */
function slug(heading: string): string {
  return heading
    .toLowerCase()
    .replace(/[^a-z0-9 _-]/g, "")
    .trim()
    .replace(/ /g, "-");
}

function headingSlugs(markdown: string): string[] {
  return markdown
    .split("\n")
    .filter((line) => /^#{1,6} /.test(line))
    .map((line) => slug(line.replace(/^#+ /, "")));
}

function runBin(args: string[], env: Record<string, string> = {}) {
  return runNode(project, BIN, args, {
    env: { HOME: home, USERPROFILE: home, APPDATA: path.join(home, "AppData", "Roaming"), ...env },
    timeout: 90_000,
  });
}

/** Every entry below `dir` as `<kind> <path>`, sorted; links are not followed. */
function treeOf(dir: string): string[] {
  const out: string[] = [];
  const walk = (current: string, prefix: string): void => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const rel = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
      out.push(`${entry.isDirectory() ? "dir" : entry.isSymbolicLink() ? "link" : "file"} ${rel}`);
      if (entry.isDirectory()) walk(path.join(current, entry.name), rel);
    }
  };
  walk(dir, "");
  return out.sort();
}

/** The `--flag` words in a text, in order. */
function flagsIn(text: string): string[] {
  return text.match(/--[a-z][a-z-]*/g) ?? [];
}

beforeAll(async () => {
  const fresh = checkDistFresh(CLIENT_CONFIG, "@iris-mcp/client-config");
  if (!fresh.ok || fresh.skipped === true) {
    throw new Error(`${fresh.reason ?? "client-config is not built."} Run "pnpm --filter @iris-mcp/client-config build" and retry.`);
  }
  targets = (await import(pathToFileURL(path.join(CLIENT_CONFIG, "dist", "pack-targets.js")).href)) as PackTargetsModule;
  plan = (await import(pathToFileURL(path.join(CLIENT_CONFIG, "dist", "pack-plan.js")).href)) as PackPlanModule;
  rosters = (await loadToolPresetCatalog(REPO_ROOT)).rosters;
  temp = makeTempRoot("story-41-7-doc-claims");
  home = path.join(temp, "home");
  project = path.join(temp, "proj");
  for (const dir of [home, project]) mkdirSync(dir, { recursive: true });
});

afterAll(() => {
  if (temp !== undefined) removeTempRoot(temp);
});

describe("the root README's `### The skills pack` section: what the pack holds", () => {
  it("states the pack's counts: skills, knowledge skills, workflow skills and rules, read from the pack tree and its sources", () => {
    const packSkills = directories(path.join(PACK, "skills"));
    const knowledge = directories(path.join(REPO_ROOT, "skills-pack-src", "knowledge"));
    const workflow = directories(path.join(REPO_ROOT, "skills")).filter((name) =>
      existsSync(path.join(REPO_ROOT, "skills", name, "SKILL.md")),
    );
    const rules = readdirSync(path.join(PACK, "rules", "claude-code")).filter((name) => name.endsWith(".md"));
    expect(packSkills).toEqual([...knowledge, ...workflow].sort());
    expect([packSkills.length, knowledge.length, workflow.length, rules.length]).toEqual([18, 6, 12, 1]);
    const section = skillsPackSection(read("README.md"));
    expect(section).toContain(
      `${packSkills.length} Agent Skills (${knowledge.length} knowledge skills and the ${workflow.length} workflow skills above) and ${rules.length} always-on rule`,
    );
  });

  it("states the four routes as the rows the installer's own route table renders, and no other row", () => {
    const section = skillsPackSection(read("README.md"));
    const stems = readdirSync(path.join(PACK, "rules", "claude-code"))
      .filter((name) => name.endsWith(".md"))
      .map((name) => name.slice(0, -".md".length));
    const expected = targets.PACK_ROUTE_IDS.map((routeId) => {
      const route = targets.PACK_ROUTES[routeId] as PackRoute;
      const clients = targets.PACK_TARGETS.filter((target) => target.route === routeId);
      const label = clients.length === 1 ? (clients[0] as PackTarget).displayName : "Every other client";
      const ids = clients.map((target) => `\`${target.id}\``).join(", ");
      const rule =
        route.rule.kind === "block"
          ? `a marked block in \`${route.rule.host}\``
          : stems.map((stem) => `\`${(route.rule as { dir: string }).dir}/${stem}${targets.RULE_FORM_EXTENSIONS[(route.rule as { form: string }).form]}\``).join(", ");
      return `| ${label} | ${ids} | \`${route.skillsDir}/\` | ${rule} |`;
    });
    expect(expected).toHaveLength(4);
    const lines = section.split("\n");
    const header = lines.indexOf("| Route | `--client` | Skills go to | The always-on rule goes to |");
    expect(header, "the route table header").toBeGreaterThan(-1);
    expect(lines[header + 1]).toBe("|---|---|---|---|");
    const rows: string[] = [];
    for (let i = header + 2; i < lines.length && (lines[i] as string).startsWith("|"); i += 1) rows.push(lines[i] as string);
    expect(rows, "the route table body").toEqual(expected);
  });

  it("states that Claude Desktop has no route, as the installer's data and the built bin say", () => {
    expect(targets.PACK_TARGETS.filter((target) => target.route === null).map((target) => target.id)).toEqual(["claude-desktop"]);
    const section = skillsPackSection(read("README.md"));
    expect(section).toContain("Claude Desktop (`claude-desktop`) has no route");
    const refused = runBin(["skills", "install", "--client", "claude-desktop", "--yes"]);
    expect(refused.status).toBe(2);
    expect(refused.stderr.startsWith(`Error: ${targets.CLAUDE_DESKTOP_REFUSAL}`)).toBe(true);
    expect(section).toContain("it takes skills only as an uploaded ZIP");
  });

  it("names the record the installer writes by its manifest path", () => {
    expect(skillsPackSection(read("README.md"))).toContain(`\`${plan.MANIFEST_PATH}\``);
  });
});

describe("the root README's documented commands run", () => {
  const section = (): string => skillsPackSection(read("README.md"));

  it("lists the six commands, each a built-bin invocation of `skills`", () => {
    const block = /```bash\n([\s\S]*?)```/.exec(section())?.[1] ?? "";
    const lines = block.split("\n").filter((line) => line.trim() !== "");
    expect(lines).toHaveLength(6);
    for (const line of lines) expect(line.startsWith(`node ${DOC_BIN} skills `), line).toBe(true);
  });

  it("each command uses only flags of the bin's usage line and a routed client, and runs as a dry run that writes nothing", () => {
    const usage = runBin(["skills"]);
    expect(usage.status).toBe(2);
    const usageLine = usage.stderr.split("\n").find((line) => line.startsWith("Usage: iris-mcp-clients skills"));
    expect(usageLine, `the usage line in:\n${usage.stderr}`).toBeDefined();
    const allowed = new Set(flagsIn(usageLine ?? ""));
    const routed = targets.PACK_TARGETS.filter((target) => target.route !== null).map((target) => target.id);

    const block = /```bash\n([\s\S]*?)```/.exec(section())?.[1] ?? "";
    for (const line of block.split("\n").filter((entry) => entry.trim() !== "")) {
      for (const flag of flagsIn(line)) expect(allowed.has(flag), `${flag} in "${line}" is not a flag of the bin`).toBe(true);
      const words = line.trim().split(/\s+/);
      expect(words[1]).toBe(DOC_BIN);
      expect(["install", "uninstall"], line).toContain(words[3]);
      expect(routed, `--client in "${line}"`).toContain(words[words.indexOf("--client") + 1]);

      const args = words.slice(2);
      const at = args.indexOf("--project");
      expect(at, `--project in "${line}"`).toBeGreaterThan(-1);
      args[at + 1] = project;
      if (!args.includes("--dry-run")) args.push("--dry-run");

      const before = treeOf(temp);
      const run = runBin(args);
      expect(run.status, `${line}\n${run.stdout}${run.stderr}`).toBe(0);
      expect(treeOf(temp), `"${line}" wrote files`).toEqual(before);
    }
  });

  it("the installer asks before it writes: without --yes and without a terminal it prints the plan, refuses and writes nothing", () => {
    expect(squash(section())).toContain("The installer prints its plan and asks before it writes (`--yes` skips the question).");
    const usage = runBin(["skills"]);
    expect(flagsIn(usage.stderr.split("\n").find((line) => line.startsWith("Usage: iris-mcp-clients skills")) ?? "")).toContain("--yes");

    const before = treeOf(temp);
    const run = runBin(["skills", "install", "--client", "claude-code", "--project", project]);
    expect(run.status, `${run.stdout}${run.stderr}`).toBe(2);
    expect(run.stdout).toMatch(/\d+ to create, 0 to update/);
    expect(run.stderr).toContain("needs confirmation before writing");
    expect(treeOf(temp)).toEqual(before);
  });
});

describe("the root README's known limits", () => {
  const section = (): string => skillsPackSection(read("README.md"));

  it("`--scope user` is refused by the bin", () => {
    expect(section()).toContain("- Project scope only: `--scope user` is refused.");
    const run = runBin(["skills", "install", "--client", "codex", "--scope", "user", "--yes"]);
    expect(run.status).toBe(2);
    expect(run.stderr.startsWith("Error: skills supports only --scope project")).toBe(true);
  });

  it("the Claude Code route installs both the skills and the rule, as its route row says", () => {
    expect(section()).toContain("- The Claude Code route always installs both the skills and the rule; it does not detect a Claude Code plugin.");
    const route = targets.PACK_ROUTES["claude-code"] as PackRoute;
    expect(route.skillsDir).toBe(".claude/skills");
    expect(route.rule).toMatchObject({ kind: "file", dir: ".claude/rules" });
  });

  it.skipIf(process.platform === "win32")("a symbolic link refuses the run, and both files keep their bytes", () => {
    expect(section()).toContain(
      "- A symbolic link at or above a path the installer would write, or a second hard link to such a file, refuses the run.",
    );
    const linked = path.join(temp, "linked");
    mkdirSync(linked, { recursive: true });
    const claude = Buffer.from("# claude, my words\r\nsecond line\n");
    writeFileSync(path.join(linked, "CLAUDE.md"), claude);
    symlinkSync("CLAUDE.md", path.join(linked, "AGENTS.md"));

    const run = runNode(linked, BIN, ["skills", "install", "--client", "codex", "--yes"], {
      env: { HOME: home, USERPROFILE: home, APPDATA: path.join(home, "AppData", "Roaming") },
      timeout: 90_000,
    });
    expect(run.status, `${run.stdout}${run.stderr}`).toBe(1);
    expect(`${run.stdout}${run.stderr}`).toContain(plan.LINK_DETAILS.symbolic);
    expect(readFileSync(path.join(linked, "CLAUDE.md")).equals(claude)).toBe(true);
    expect(lstatSync(path.join(linked, "AGENTS.md")).isSymbolicLink()).toBe(true);
    expect(readlinkSync(path.join(linked, "AGENTS.md"))).toBe("CLAUDE.md");
    expect(existsSync(path.join(linked, ".agents"))).toBe(false);
    expect(existsSync(path.join(linked, ".iris-mcp"))).toBe(false);
  });

  it.skipIf(process.platform === "win32")("a symbolic link above a written path refuses the run, and nothing is written", () => {
    const linked = path.join(temp, "linked-folder");
    // `.claude` is a link to a real folder that already holds `skills/`, so only `.claude` itself is a link; every path the
    // installer writes below it resolves to a real file or folder.
    mkdirSync(path.join(linked, "real", "skills"), { recursive: true });
    symlinkSync("real", path.join(linked, ".claude"));

    const run = runNode(linked, BIN, ["skills", "install", "--client", "claude-code", "--yes"], {
      env: { HOME: home, USERPROFILE: home, APPDATA: path.join(home, "AppData", "Roaming") },
      timeout: 90_000,
    });
    expect(run.status, `${run.stdout}${run.stderr}`).toBe(1);
    expect(`${run.stdout}${run.stderr}`).toContain(`.claude (${plan.LINK_DETAILS.symbolic})`);
    expect(readdirSync(path.join(linked, "real"))).toEqual(["skills"]);
    expect(readdirSync(path.join(linked, "real", "skills"))).toEqual([]);
    expect(readlinkSync(path.join(linked, ".claude"))).toBe("real");
    expect(existsSync(path.join(linked, ".iris-mcp"))).toBe(false);
  });

  it.skipIf(process.platform === "win32")("a second hard link to a file the installer would edit refuses the run, and both names keep their bytes", () => {
    const linked = path.join(temp, "hard-linked");
    mkdirSync(linked, { recursive: true });
    const claude = Buffer.from("# claude, my words\r\nsecond line\n");
    writeFileSync(path.join(linked, "CLAUDE.md"), claude);
    linkSync(path.join(linked, "CLAUDE.md"), path.join(linked, "AGENTS.md"));

    const run = runNode(linked, BIN, ["skills", "install", "--client", "codex", "--yes"], {
      env: { HOME: home, USERPROFILE: home, APPDATA: path.join(home, "AppData", "Roaming") },
      timeout: 90_000,
    });
    expect(run.status, `${run.stdout}${run.stderr}`).toBe(1);
    expect(`${run.stdout}${run.stderr}`).toContain(plan.LINK_DETAILS.hard);
    expect(readFileSync(path.join(linked, "CLAUDE.md")).equals(claude)).toBe(true);
    expect(readFileSync(path.join(linked, "AGENTS.md")).equals(claude)).toBe(true);
    expect(existsSync(path.join(linked, ".agents"))).toBe(false);
    expect(existsSync(path.join(linked, ".iris-mcp"))).toBe(false);
  });

  it("`--include-modified` and the skills-pack backup directory are the bin's own words", () => {
    const text = section();
    expect(text).toContain(
      "- A file you edit after installing is kept; `--include-modified` replaces or removes it after a backup under `~/.iris-mcp/client-manager/backups/skills-pack/`.",
    );
    const help = runBin(["--help"]);
    expect(help.status).toBe(0);
    expect(help.stdout).toContain("--include-modified");
    expect(help.stdout).toContain("Skills-pack backups live under ~/.iris-mcp/client-manager/backups/skills-pack/.");
  });

  it("links the client-config README anchors that exist as headings there", () => {
    const text = section();
    const slugs = headingSlugs(read("packages/client-config/README.md"));
    for (const anchor of ["skills-pack-targets-generated", "installing-the-skills-pack"]) {
      expect(text, anchor).toContain(`(packages/client-config/README.md#${anchor})`);
      expect(slugs, anchor).toContain(anchor);
    }
  });

  it("every relative link of the section points at a file that exists", () => {
    for (const match of skillsPackSection(read("README.md")).matchAll(/\]\(([^)#\s]+)(?:#[^)\s]*)?\)/g)) {
      const target = match[1] as string;
      if (/^[a-z]+:/.test(target)) continue;
      expect(existsSync(path.join(REPO_ROOT, target)), target).toBe(true);
    }
  });
});

describe("DW-624: the tool presets are not nested, and the example holds", () => {
  const EXAMPLE =
    "For example, `provision-project-environment` declares `core` and uses `iris_user_manage`, which the admin server's `developer` preset hides.";

  it("the admin rosters show `iris_user_manage` under `core` and hide it under `developer`, and the skill declares `core`", () => {
    const admin = rosters["iris-admin-mcp"];
    expect(admin?.core.include).toContain("iris_user_manage");
    expect(admin?.developer.include).not.toContain("iris_user_manage");
    const text = read("packages/client-config/skills-pack/skills/provision-project-environment/SKILL.md");
    expect(declaredToolPreset(text, "skills/provision-project-environment/SKILL.md")).toBe("core");
    expect(text).toContain("iris_user_manage");
  });

  it("the root README section says so, with the example", () => {
    const section = squash(skillsPackSection(read("README.md")));
    expect(section).toContain("**Tool presets are not nested.**");
    expect(section).toContain("`developer` is not `core` plus more tools: it hides some tools that `core` shows.");
    expect(section).toContain(EXAMPLE);
  });

  it("the skills pack catalog says so, with the example", () => {
    const catalog = squash(read("packages/client-config/skills-pack/README.md"));
    expect(catalog).toContain("The presets are not nested: `developer` is not `core` plus more tools, and it hides some tools that `core` shows");
    expect(catalog).toContain(EXAMPLE);
  });

  it("the workflow-skills bullet no longer reads the presets as nested", () => {
    const bullet = read("README.md")
      .split("\n")
      .find((line) => line.startsWith("- **As installable Agent Skills**"));
    expect(bullet).toBeDefined();
    expect(bullet).not.toContain("the tool preset under which every tool it names is visible");
    expect(bullet).toContain("the first of `core`, `developer` and `full` under which every tool it names is visible (the presets are not nested)");
  });
});

describe("the retirement sentence and the `#the-skills-pack` links", () => {
  it("names the places the installer puts the rule, as the route table has them", () => {
    const claudeCode = targets.PACK_ROUTES["claude-code"] as PackRoute;
    const cursor = targets.PACK_ROUTES["cursor"] as PackRoute;
    const gemini = targets.PACK_ROUTES["gemini"] as PackRoute;
    const agents = targets.PACK_ROUTES["agents"] as PackRoute;
    const dir = (route: PackRoute): string => (route.rule as { dir: string }).dir;
    const host = (route: PackRoute): string => (route.rule as { host: string }).host;
    const sentence =
      "`objectscript-review` was retired in Story 41.2: its checklist is now the always-on rule in the skills pack, " +
      "which `iris-mcp-clients skills install` puts where each client loads it " +
      `(\`${dir(claudeCode)}/\` for Claude Code, \`${dir(cursor)}/\` for Cursor, a marked block in \`${host(gemini)}\` for Gemini CLI ` +
      `and in \`${host(agents)}\` for every other client).`;
    for (const file of ["README.md", "packages/iris-dev-mcp/README.md"]) {
      expect(read(file).split("\n"), file).toContain(sentence);
    }
  });

  it("`### The skills pack` is one heading, and every document that points at it holds the link", () => {
    const readme = read("README.md");
    expect(readme.split("\n").filter((line) => line === "### The skills pack")).toHaveLength(1);
    expect(headingSlugs(readme)).toContain("the-skills-pack");

    const lines = readme.split("\n");
    const bullet = lines.find((line) => line.startsWith("- **As installable Agent Skills**")) ?? "";
    expect(bullet).toContain("(see [The skills pack](#the-skills-pack))");
    expect(bullet).not.toContain("Copy the skills");
    const manager = lines.find((line) => line.startsWith("`apply` prints the pending diff first")) ?? "";
    expect(manager).toContain("It also installs the skills pack into a project: see [The skills pack](#the-skills-pack).");

    for (const server of ["admin", "dev", "interop", "ops"]) {
      const text = read(`packages/iris-${server}-mcp/README.md`);
      expect(text.split("\n"), server).toContain("Also installable as [Agent Skills](../../README.md#the-skills-pack).");
    }
    const toolSupport = squash(read("tool_support.md"));
    expect(toolSupport).toContain("and the [skills pack](README.md#the-skills-pack), which installs these workflows as Agent Skills.");
    expect(toolSupport).not.toContain("the generated [`skills/`](skills/README.md) install pack");
  });
});
