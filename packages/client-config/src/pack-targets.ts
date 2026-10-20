/**
 * `@iris-mcp/client-config` - where the skills pack and its always-on rule are installed for each client
 * (Story 41.6, AC 41.6.1).
 *
 * Data, not code: one row per client the package knows (the `CLIENT_ADAPTERS` ids, the `CLIENT_DISPOSITIONS` ids
 * and the generic `agents` row), each mapped onto one of four routes. The table is exhaustive as of
 * `PACK_TARGETS_CHECKED_ON`; every `sources` URL was fetched on that date.
 *
 * Portable by contract: this module imports only `adapters.ts` (for display names) and types, so the provenance
 * probe can load the built `pack-plan.js` from a scratch root. It reads no process state.
 */

import { CLIENT_ADAPTERS, CLIENT_DISPOSITIONS } from "./adapters.js";

/** The date the table was checked against each client's documentation. */
export const PACK_TARGETS_CHECKED_ON = "2026-10-19";

/** The four places a client's skills and rule can go. */
export type PackRouteId = "claude-code" | "cursor" | "gemini" | "agents";

/** The three forms a rule takes in the pack. */
export type PackRuleForm = "claudeCode" | "cursor" | "agentsMd";

/** Where a route puts the always-on rule: a whole file in a rules directory, or a marked block in a host file. */
export type PackRuleTarget =
  | { kind: "file"; form: "claudeCode" | "cursor"; dir: string }
  | { kind: "block"; host: "AGENTS.md" | "GEMINI.md" };

export interface PackRoute {
  id: PackRouteId;
  /** Project-relative directory that holds one directory per skill. */
  skillsDir: string;
  rule: PackRuleTarget;
}

/** Copy of the pack generator's per-form directories (`RULE_FORM_DIRS`); a test pins the copy. */
export const RULE_FORM_DIRS: Readonly<Record<PackRuleForm, string>> = Object.freeze({
  claudeCode: "rules/claude-code",
  cursor: "rules/cursor",
  agentsMd: "rules/agents-md",
});

/** Copy of the pack generator's per-form extensions (`RULE_FORM_EXTENSIONS`); a test pins the copy. */
export const RULE_FORM_EXTENSIONS: Readonly<Record<PackRuleForm, string>> = Object.freeze({
  claudeCode: ".md",
  cursor: ".mdc",
  agentsMd: ".md",
});

/** The third-party notice's file name (`NOTICE_FILENAME` of the pack generator). */
export const NOTICE_FILENAME = "IRIS-MCP-THIRD-PARTY-NOTICES.md";

/** Text that identifies adapted third-party content inside any file (`DISTRIBUTION_MARKER` of the provenance check). */
export const ADAPTATION_MARKER = "Adapted from intersystems-community/iris-agentic-dev";

/** The route table. A client with no project folder for skills has no route. */
export const PACK_ROUTES: Readonly<Record<PackRouteId, PackRoute>> = Object.freeze({
  "claude-code": {
    id: "claude-code",
    skillsDir: ".claude/skills",
    rule: { kind: "file", form: "claudeCode", dir: ".claude/rules" },
  },
  cursor: {
    id: "cursor",
    skillsDir: ".agents/skills",
    rule: { kind: "file", form: "cursor", dir: ".cursor/rules" },
  },
  gemini: {
    id: "gemini",
    skillsDir: ".agents/skills",
    rule: { kind: "block", host: "GEMINI.md" },
  },
  agents: {
    id: "agents",
    skillsDir: ".agents/skills",
    rule: { kind: "block", host: "AGENTS.md" },
  },
});

/** The route ids, in the order the installer payloads and the documentation list them. */
export const PACK_ROUTE_IDS: readonly PackRouteId[] = ["claude-code", "cursor", "gemini", "agents"];

/** One client's row. */
export interface PackTarget {
  /** A `CLIENT_ADAPTERS` or `CLIENT_DISPOSITIONS` id, or `agents`. */
  id: string;
  displayName: string;
  /** The route the client takes, or `null` when it has none (Claude Desktop). */
  route: PackRouteId | null;
  /** Why this route, and the other locations the client reads. */
  why: string;
  /** User-facing notes printed with an install for this client. */
  notes: readonly string[];
  /** Documentation URLs the row was checked against (https). */
  sources: readonly string[];
  /** True for a client that reads the first of `AGENTS.md` and `CLAUDE.md` and stops there. */
  readsAgentsMdBeforeClaudeMd?: boolean;
  /** Printed when the client has no route. */
  noRouteReason?: string;
}

/** The generic row for any agent that reads `.agents/skills/` and `AGENTS.md`. */
export const GENERIC_AGENTS_TARGET_ID = "agents";

function displayNameOf(id: string): string {
  if (id === GENERIC_AGENTS_TARGET_ID) return "Other agents";
  const adapter = CLIENT_ADAPTERS[id];
  if (adapter !== undefined) return adapter.displayName;
  const disposition = CLIENT_DISPOSITIONS.find((entry) => entry.id === id);
  return disposition !== undefined ? disposition.displayName : id;
}

/** What `--client claude-desktop` is refused with: the client has no project folder for skills or rules. */
export const CLAUDE_DESKTOP_REFUSAL =
  "Claude Desktop has no project folder for skills or rules: upload skills as a ZIP under Customize > Skills. " +
  "Its Code tab runs Claude Code, so use --client claude-code for that.";

const ALSO_READS_CLAUDE_SKILLS_TWICE =
  "It also reads .claude/skills/, so a project that also installs for Claude Code shows each skill twice.";

const NO_MCP_FOR = (name: string): string =>
  `iris-mcp-clients does not configure MCP for ${name}, so add the IRIS MCP servers to ${name} yourself before using the workflow skills.`;

/**
 * The 17 rows: the 13 adapters, the 3 dispositions, and `agents`, in that order. Rows are data; the route
 * table above decides where each one installs.
 */
export const PACK_TARGETS: readonly PackTarget[] = Object.freeze([
  {
    id: "claude-code",
    displayName: displayNameOf("claude-code"),
    route: "claude-code",
    why:
      "Claude Code never reads .agents/. A rule in .claude/rules/ without a paths: scope is loaded at launch. " +
      "AGENTS.md is read only when there is no CLAUDE.md, so .claude/rules/ is the route that always works.",
    notes: [],
    sources: ["https://code.claude.com/docs/en/skills", "https://code.claude.com/docs/en/memory"],
  },
  {
    id: "claude-desktop",
    displayName: displayNameOf("claude-desktop"),
    route: null,
    why:
      "Skills are only uploaded as a ZIP (Customize > Skills) and instructions are only settings fields; " +
      "the Code tab is Claude Code.",
    notes: [],
    sources: [
      "https://support.claude.com/en/articles/12512180-use-skills-in-claude",
      "https://code.claude.com/docs/en/desktop",
    ],
    noRouteReason: CLAUDE_DESKTOP_REFUSAL,
  },
  {
    id: "cursor",
    displayName: displayNameOf("cursor"),
    route: "cursor",
    why:
      "Project rules in .cursor/rules/ must be .mdc files with alwaysApply: true to be always included. " +
      "Cursor also reads .cursor/skills/, .claude/skills/, .codex/skills/, AGENTS.md and CLAUDE.md.",
    notes: [
      "Cursor also reads .claude/skills/ and AGENTS.md, so a project that also installs for Claude Code or for an AGENTS.md client shows Cursor each skill, or the rule, twice.",
    ],
    sources: ["https://cursor.com/docs/skills", "https://cursor.com/docs/rules"],
  },
  {
    id: "vscode",
    displayName: displayNameOf("vscode"),
    route: "agents",
    why:
      "An .instructions.md file with applyTo: attaches only to files the agent creates or modifies, so the rule " +
      "goes in AGENTS.md at the repository root, which is always applied. VS Code also reads .github/skills/, " +
      ".claude/skills/, .github/copilot-instructions.md and CLAUDE.md.",
    notes: [
      "VS Code reads the rule from AGENTS.md at the repository root while its chat.useAgentsMdFile setting is on, the default. " +
        ALSO_READS_CLAUDE_SKILLS_TWICE,
    ],
    sources: [
      "https://code.visualstudio.com/docs/agent-customization/agent-skills",
      "https://code.visualstudio.com/docs/agent-customization/custom-instructions",
    ],
  },
  {
    id: "cline",
    displayName: displayNameOf("cline"),
    route: "agents",
    why:
      "Cline scans .agents/skills/ for skills and reads the workspace-root AGENTS.md as a rule, so no Cline-only " +
      "file is needed. Its native .clinerules/ directory is not used.",
    notes: [
      "Cline lists AGENTS.md in its Rules panel, where the rule can be switched off. " + ALSO_READS_CLAUDE_SKILLS_TWICE,
    ],
    sources: [
      "https://docs.cline.bot/customization/skills",
      "https://docs.cline.bot/customization/cline-rules",
      "https://github.com/cline/cline/blob/main/apps/vscode/src/core/storage/skill-directories.ts",
    ],
  },
  {
    id: "roo-code",
    displayName: displayNameOf("roo-code"),
    route: "agents",
    why:
      "Roo Code reads .agents/skills/ and the root AGENTS.md while roo-cline.useAgentRules is on, the default. " +
      "It was discontinued on 2026-05-15; its native .roo/skills/ and .roo/rules/ are not used.",
    notes: [
      "Roo Code was discontinued on 2026-05-15. Its last release reads .agents/skills/, and reads AGENTS.md while its roo-cline.useAgentRules setting is on, the default.",
    ],
    sources: [
      "https://roocodeinc.github.io/Roo-Code/features/skills",
      "https://roocodeinc.github.io/Roo-Code/features/custom-instructions",
    ],
  },
  {
    id: "windsurf",
    displayName: displayNameOf("windsurf"),
    route: "agents",
    why:
      "Windsurf is now Devin Desktop. A root AGENTS.md is treated as an always-on rule; its native .devin/rules/ " +
      "and .windsurf/rules/ are not used.",
    notes: ["Windsurf is now Devin Desktop, which treats AGENTS.md at the repository root as an always-on rule."],
    sources: ["https://docs.devin.ai/desktop/cascade/skills", "https://docs.devin.ai/desktop/cascade/agents-md"],
  },
  {
    id: "codex",
    displayName: displayNameOf("codex"),
    route: "agents",
    why: "Codex reads .agents/skills/ and AGENTS.md natively. Its 32 KiB combined cap is far above the 2.2 KB block.",
    notes: [],
    sources: [
      "https://learn.chatgpt.com/docs/build-skills",
      "https://learn.chatgpt.com/docs/agent-configuration/agents-md",
    ],
  },
  {
    id: "gemini",
    displayName: displayNameOf("gemini"),
    route: "gemini",
    why:
      "Gemini CLI reads GEMINI.md by default and AGENTS.md only after a context.fileName setting, which the " +
      "installer never edits. .agents/skills/ is an alias for its skills directory.",
    notes: ["For unpaid-tier and Google One users, Gemini CLI was replaced by Antigravity CLI on 2026-06-18."],
    sources: ["https://geminicli.com/docs/cli/skills/", "https://geminicli.com/docs/cli/gemini-md/"],
  },
  {
    id: "zed",
    displayName: displayNameOf("zed"),
    route: "agents",
    why:
      "Zed reads .agents/skills/ only (trusted worktrees only) and the first of .rules, .cursorrules, " +
      ".windsurfrules, .clinerules, .github/copilot-instructions.md, AGENT.md, AGENTS.md, CLAUDE.md and GEMINI.md.",
    notes: [
      "Zed loads project skills only in a trusted worktree, and reads only the first instructions file it finds, in the order .rules, .cursorrules, .windsurfrules, .clinerules, .github/copilot-instructions.md, AGENT.md, AGENTS.md, CLAUDE.md, GEMINI.md.",
    ],
    sources: ["https://zed.dev/docs/ai/skills", "https://zed.dev/docs/ai/instructions"],
    readsAgentsMdBeforeClaudeMd: true,
  },
  {
    id: "goose",
    displayName: displayNameOf("goose"),
    route: "agents",
    why:
      "Goose reads .agents/skills/ and AGENTS.md natively. It also reads .goose/skills/, .claude/skills/ and " +
      ".goosehints, and its context files need the Developer extension.",
    notes: ["Goose reads AGENTS.md through its Developer extension, which must be enabled."],
    sources: [
      "https://goose-docs.ai/docs/guides/context-engineering/using-skills/",
      "https://goose-docs.ai/docs/guides/context-engineering/using-goosehints/",
    ],
  },
  {
    id: "kimi",
    displayName: displayNameOf("kimi"),
    route: "agents",
    why:
      "Kimi CLI reads .agents/skills/ and AGENTS.md natively. It is archived. It also reads .kimi/skills/, " +
      ".claude/skills/ and .codex/skills/.",
    notes: ["Kimi CLI is archived and no longer maintained; Kimi Code replaces it."],
    sources: [
      "https://moonshotai.github.io/kimi-cli/en/customization/skills.html",
      "https://moonshotai.github.io/kimi-cli/en/customization/agents.html",
    ],
  },
  {
    id: "kimi-code",
    displayName: displayNameOf("kimi-code"),
    route: "agents",
    why:
      "Kimi Code reads .agents/skills/ and AGENTS.md natively. It also reads .kimi-code/skills/ and " +
      ".kimi-code/AGENTS.md.",
    notes: [],
    sources: [
      "https://moonshotai.github.io/kimi-code/en/customization/skills",
      "https://moonshotai.github.io/kimi-code/en/customization/agents",
    ],
  },
  {
    id: "pi",
    displayName: displayNameOf("pi"),
    route: "agents",
    why:
      "Pi reads .agents/skills/ (trusted project only) and AGENTS.md natively, per folder with AGENTS.md before " +
      "CLAUDE.md. It also reads .pi/skills/. iris-mcp-clients configures no MCP for it.",
    notes: [
      "Pi loads project skills only in a trusted project. " + NO_MCP_FOR("Pi"),
    ],
    sources: [
      "https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/skills.md",
      "https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/configuration.md",
    ],
    readsAgentsMdBeforeClaudeMd: true,
  },
  {
    id: "jetbrains-junie",
    displayName: displayNameOf("jetbrains-junie"),
    route: "agents",
    why:
      "Junie reads .agents/skills/ (trusted project only) and AGENTS.md natively; it ignores AGENTS.md when " +
      ".junie/AGENTS.md exists or a custom guidelines file is set. It also reads .junie/skills/ and .junie/rules/. " +
      "iris-mcp-clients configures no MCP for it.",
    notes: [
      "Junie loads project skills only in a trusted project, and ignores AGENTS.md when .junie/AGENTS.md exists or a custom guidelines file is set. " +
        NO_MCP_FOR("Junie"),
    ],
    sources: [
      "https://junie.jetbrains.com/docs/agent-skills.html",
      "https://junie.jetbrains.com/docs/guidelines-and-memory.html",
    ],
  },
  {
    id: "kilo-code",
    displayName: displayNameOf("kilo-code"),
    route: "agents",
    why:
      "Kilo Code reads .agents/skills/ and AGENTS.md natively, with AGENTS.md before CLAUDE.md (first match). It " +
      "also reads .kilo/skills/, .claude/skills/ and .kilo/rules/. iris-mcp-clients configures no MCP for it.",
    notes: [NO_MCP_FOR("Kilo Code")],
    sources: ["https://kilo.ai/docs/customize/skills", "https://kilo.ai/docs/customize/agents-md"],
    readsAgentsMdBeforeClaudeMd: true,
  },
  {
    id: GENERIC_AGENTS_TARGET_ID,
    displayName: displayNameOf(GENERIC_AGENTS_TARGET_ID),
    route: "agents",
    why: "The cross-client convention for any agent that reads both .agents/skills/ and AGENTS.md.",
    notes: [],
    sources: ["https://agentskills.io/client-implementation/adding-skills-support", "https://agents.md"],
  },
] satisfies PackTarget[]);

/** The row for a client id, or `undefined`. */
export function packTargetFor(id: string): PackTarget | undefined {
  return PACK_TARGETS.find((target) => target.id === id);
}

/** The route of a client id, or `undefined` when the client is unknown or has none. */
export function packRouteFor(id: string): PackRoute | undefined {
  const target = packTargetFor(id);
  return target !== undefined && target.route !== null ? PACK_ROUTES[target.route] : undefined;
}

/** `N-claude-md`: printed for a Claude Code install into a project that has a CLAUDE.md. */
export const NOTE_CLAUDE_MD =
  "This project has a CLAUDE.md, so Claude Code does not read AGENTS.md here. The always-on rule is installed in " +
  ".claude/rules/, which Claude Code loads either way. To have Claude Code also read this project's AGENTS.md, " +
  "add the line @AGENTS.md to CLAUDE.md; this installer never edits CLAUDE.md.";

/** The order the clients that read AGENTS.md before CLAUDE.md are named in `N-first-match`. */
const FIRST_MATCH_NAME_ORDER: readonly string[] = ["zed", "kilo-code", "pi"];

/** A client's short name: its display name without a trailing parenthesised qualifier. */
export function shortDisplayName(displayName: string): string {
  return displayName.replace(/\s*\([^)]*\)\s*$/, "");
}

/** `N-first-match`: printed when a run creates AGENTS.md in a project that has a CLAUDE.md. */
export function firstMatchNote(): string {
  const flagged = PACK_TARGETS.filter((target) => target.readsAgentsMdBeforeClaudeMd === true);
  const ordered = [
    ...FIRST_MATCH_NAME_ORDER.map((id) => flagged.find((target) => target.id === id)).filter(
      (target): target is PackTarget => target !== undefined,
    ),
    ...flagged.filter((target) => !FIRST_MATCH_NAME_ORDER.includes(target.id)),
  ];
  const names = ordered.map((target) => shortDisplayName(target.displayName));
  const list = names.length < 2 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
  return (
    "This run creates AGENTS.md in a project that has a CLAUDE.md. " +
    `${list} read only one of the two, and they take AGENTS.md first, so they stop reading CLAUDE.md here.`
  );
}
