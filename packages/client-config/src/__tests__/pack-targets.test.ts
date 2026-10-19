/**
 * Story 41.6 - AC 41.6.1: the client disposition table (`PACK_TARGETS`) and its cross-checks (Rule #44, #56).
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { describe, expect, it } from "vitest";

import { CLIENT_ADAPTERS, CLIENT_DISPOSITIONS } from "../adapters.js";
import {
  ADAPTATION_MARKER,
  CLAUDE_DESKTOP_REFUSAL,
  NOTE_CLAUDE_MD,
  NOTICE_FILENAME,
  PACK_ROUTES,
  PACK_ROUTE_IDS,
  PACK_TARGETS,
  PACK_TARGETS_CHECKED_ON,
  RULE_FORM_DIRS,
  RULE_FORM_EXTENSIONS,
  firstMatchNote,
  packRouteFor,
  packTargetFor,
} from "../pack-targets.js";
import { ruleBlockMarkers } from "../rule-block.js";

const SRC_DIR = fileURLToPath(new URL("..", import.meta.url));
const REPO_ROOT = path.resolve(SRC_DIR, "..", "..", "..");

const EXPECTED_IDS = [...Object.keys(CLIENT_ADAPTERS), ...CLIENT_DISPOSITIONS.map((entry) => entry.id), "agents"];

describe("PACK_TARGETS coverage (AC 41.6.1, Rule #56)", () => {
  it("has exactly one row per adapter id, disposition id and the generic agents row", () => {
    const ids = PACK_TARGETS.map((target) => target.id);
    expect([...ids].sort()).toEqual([...EXPECTED_IDS].sort());
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("covers every client id individually, so deleting any row fails here", () => {
    for (const id of EXPECTED_IDS) {
      expect(packTargetFor(id), `PACK_TARGETS has no row for ${id}`).toBeDefined();
    }
  });

  it("takes each display name from the adapter or disposition data", () => {
    for (const target of PACK_TARGETS) {
      if (target.id === "agents") {
        expect(target.displayName).toBe("Other agents");
        continue;
      }
      const adapter = CLIENT_ADAPTERS[target.id];
      const disposition = CLIENT_DISPOSITIONS.find((entry) => entry.id === target.id);
      expect(target.displayName).toBe(adapter !== undefined ? adapter.displayName : disposition?.displayName);
    }
  });

  it("gives every row a reason, at least one https source and a route (only claude-desktop has none)", () => {
    for (const target of PACK_TARGETS) {
      expect(target.why.length, `${target.id} needs a reason`).toBeGreaterThan(20);
      expect(target.sources.length, `${target.id} needs a source`).toBeGreaterThan(0);
      for (const source of target.sources) {
        expect(source, `${target.id} source`).toMatch(/^https:\/\/[a-z0-9.-]+(\/\S*)?$/);
      }
      if (target.id === "claude-desktop") {
        expect(target.route).toBeNull();
        expect(target.noRouteReason).toBe(CLAUDE_DESKTOP_REFUSAL);
      } else {
        expect(target.route, `${target.id} needs a route`).not.toBeNull();
        expect(target.noRouteReason).toBeUndefined();
      }
    }
  });

  it("prints notes that are ASCII and carry no internal reference", () => {
    for (const target of PACK_TARGETS) {
      for (const text of [target.why, ...target.notes]) {
        expect(text).toMatch(/^[\x20-\x7e]*$/);
      }
    }
    expect(NOTE_CLAUDE_MD).toMatch(/^[\x20-\x7e]*$/);
    expect(firstMatchNote()).toMatch(/^[\x20-\x7e]*$/);
  });
});

describe("the AC minimum, asserted literally (AC 41.6.1)", () => {
  it("routes claude-code to .claude/skills and .claude/rules", () => {
    expect(packRouteFor("claude-code")).toEqual({
      id: "claude-code",
      skillsDir: ".claude/skills",
      rule: { kind: "file", form: "claudeCode", dir: ".claude/rules" },
    });
  });

  it("routes cursor to .cursor/rules .mdc files", () => {
    const route = packRouteFor("cursor");
    expect(route?.rule).toEqual({ kind: "file", form: "cursor", dir: ".cursor/rules" });
    expect(RULE_FORM_EXTENSIONS.cursor).toBe(".mdc");
  });

  it("routes every other routed client to .agents/skills and a marked AGENTS.md or GEMINI.md block", () => {
    for (const target of PACK_TARGETS) {
      if (target.route === null || target.id === "claude-code" || target.id === "cursor") continue;
      const route = PACK_ROUTES[target.route];
      expect(route.skillsDir, target.id).toBe(".agents/skills");
      expect(route.rule.kind, target.id).toBe("block");
      const host = route.rule.kind === "block" ? route.rule.host : "";
      expect(host, target.id).toBe(target.id === "gemini" ? "GEMINI.md" : "AGENTS.md");
    }
  });

  it("has exactly the four routes", () => {
    expect([...PACK_ROUTE_IDS]).toEqual(["claude-code", "cursor", "gemini", "agents"]);
    expect(Object.keys(PACK_ROUTES).sort()).toEqual([...PACK_ROUTE_IDS].sort());
  });

  it("sends VS Code / Copilot to the AGENTS.md block, not an applyTo instructions file", () => {
    expect(packTargetFor("vscode")?.route).toBe("agents");
  });
});

describe("table data", () => {
  it("flags exactly zed, kilo-code and pi as reading AGENTS.md before CLAUDE.md", () => {
    const flagged = PACK_TARGETS.filter((target) => target.readsAgentsMdBeforeClaudeMd === true).map((target) => target.id);
    expect(flagged.sort()).toEqual(["kilo-code", "pi", "zed"]);
    expect(firstMatchNote()).toBe(
      "This run creates AGENTS.md in a project that has a CLAUDE.md. Zed, Kilo Code and Pi read only one of the two, " +
        "and they take AGENTS.md first, so they stop reading CLAUDE.md here.",
    );
  });

  it("pins the date the table was checked", () => {
    expect(PACK_TARGETS_CHECKED_ON).toBe("2026-10-19");
  });

  it("pins the golden notes", () => {
    expect(packTargetFor("pi")?.notes).toEqual([
      "Pi loads project skills only in a trusted project. iris-mcp-clients does not configure MCP for Pi, so add the IRIS MCP servers to Pi yourself before using the workflow skills.",
    ]);
    expect(packTargetFor("gemini")?.notes).toEqual([
      "For unpaid-tier and Google One users, Gemini CLI was replaced by Antigravity CLI on 2026-06-18.",
    ]);
    for (const id of ["claude-code", "codex", "kimi-code", "agents"]) {
      expect(packTargetFor(id)?.notes, id).toEqual([]);
    }
    expect(CLAUDE_DESKTOP_REFUSAL).toBe(
      "Claude Desktop has no project folder for skills or rules: upload skills as a ZIP under Customize > Skills. Its Code tab runs Claude Code, so use --client claude-code for that.",
    );
  });
});

describe("copies are pinned against the pack generator (Rule #44)", () => {
  it("equals scripts/lib/skills-pack.mjs: forms, extensions, notice name and marker lines", async () => {
    const generator = (await import(pathToFileURL(path.join(REPO_ROOT, "scripts", "lib", "skills-pack.mjs")).href)) as {
      RULE_FORM_DIRS: Record<string, string>;
      RULE_FORM_EXTENSIONS: Record<string, string>;
      NOTICE_FILENAME: string;
      agentsMdMarkers: (stem: string) => { begin: string; end: string };
    };
    expect({ ...RULE_FORM_DIRS }).toEqual({ ...generator.RULE_FORM_DIRS });
    expect({ ...RULE_FORM_EXTENSIONS }).toEqual({ ...generator.RULE_FORM_EXTENSIONS });
    expect(NOTICE_FILENAME).toBe(generator.NOTICE_FILENAME);
    for (const stem of ["iris-mcp-objectscript-pre-write", "a", "x-1"]) {
      expect(ruleBlockMarkers(stem)).toEqual(generator.agentsMdMarkers(stem));
    }
  });

  it("equals the provenance check's adaptation marker", async () => {
    const core = (await import(pathToFileURL(path.join(REPO_ROOT, "scripts", "lib", "provenance-core.mjs")).href)) as {
      DISTRIBUTION_MARKER: string;
    };
    expect(ADAPTATION_MARKER).toBe(core.DISTRIBUTION_MARKER);
  });
});

describe("the installer modules stay portable and injectable (source scans)", () => {
  const read = (file: string): string => readFileSync(path.join(SRC_DIR, file), "utf8");
  const importSpecifiers = (source: string): string[] =>
    [...source.matchAll(/^import\s[^;]*?from\s+"([^"]+)";/gms)]
      .filter((match) => !/^import\s+type\b/.test(match[0]))
      .map((match) => match[1] as string);

  it("pack-targets, rule-block and pack-plan import only node built-ins and each other", () => {
    const allowed = new Set(["./pack-targets.js", "./rule-block.js", "./pack-plan.js", "./adapters.js"]);
    for (const file of ["pack-targets.ts", "rule-block.ts", "pack-plan.ts"]) {
      for (const specifier of importSpecifiers(read(file))) {
        expect(specifier.startsWith("node:") || allowed.has(specifier), `${file} imports ${specifier}`).toBe(true);
      }
    }
  });

  it("never imports the JSON, TOML or YAML engine from a portable module", () => {
    for (const file of ["pack-targets.ts", "rule-block.ts", "pack-plan.ts"]) {
      const source = read(file);
      expect(source, file).not.toMatch(/jsonc-parser|smol-toml|from "yaml"|\.\/write\.js|\.\/engine\.js|\.\/readers\.js/);
    }
  });

  it("no installer module reads the home directory, the working directory or the environment", () => {
    for (const file of ["pack-targets.ts", "rule-block.ts", "pack-plan.ts", "pack-apply.ts"]) {
      expect(read(file), file).not.toMatch(/homedir\(|process\.cwd\(|process\.env/);
    }
  });

  it("keeps the installer source ASCII (Rule 14)", () => {
    for (const file of ["pack-targets.ts", "rule-block.ts", "pack-plan.ts", "pack-apply.ts"]) {
      const source = read(file);
      expect(Buffer.byteLength(source, "utf8"), file).toBe(source.length);
    }
  });
});
