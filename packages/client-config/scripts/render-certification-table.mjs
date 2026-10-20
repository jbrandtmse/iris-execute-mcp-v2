#!/usr/bin/env node
/**
 * `render-certification-table.mjs` generates the README's adapter table,
 * certification disposition and skills-pack-targets sections (Story 33.4,
 * AC 33.4.1/33.4.3; Story 41.7; Rule #51/#56 discipline: the tables are
 * GENERATED from `CLIENT_ADAPTERS` joined with `scripts/certification-results.json`
 * and from `PACK_TARGETS`, never hand-authored).
 *
 * The generator REQUIRES one results record per registry adapter (the
 * enumeration is exhaustive by construction — a missing record fails the
 * render, so a new client can never ship an undocumented disposition). The
 * skills-pack-targets section has its own roster guard (exit 2).
 *
 * Usage:
 *   node scripts/render-certification-table.mjs           # rewrite the README marker sections
 *   node scripts/render-certification-table.mjs --check   # exit 1 when the README is out of sync
 *
 * Requires a built dist (`npm run build`) — adapter data is imported from
 * ../dist/adapters.js and the pack targets from ../dist/pack-targets.js so
 * the generated docs can never drift from the data the engine and the
 * installer actually use.
 */

import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PACKAGE_ROOT = fileURLToPath(new URL("..", import.meta.url));
const README_PATH = path.join(PACKAGE_ROOT, "README.md");
const RESULTS_PATH = path.join(PACKAGE_ROOT, "scripts", "certification-results.json");
const CLAUDE_CODE_RULES_DIR = path.join(PACKAGE_ROOT, "skills-pack", "rules", "claude-code");

const { CLIENT_ADAPTERS, ADAPTER_DATA_VERSION } = await import("../dist/adapters.js");
const { PACK_TARGETS, PACK_ROUTES, PACK_TARGETS_CHECKED_ON, RULE_FORM_EXTENSIONS } = await import(
  "../dist/pack-targets.js"
);
const results = JSON.parse(readFileSync(RESULTS_PATH, "utf8"));

const ADAPTER_BEGIN = "<!-- ADAPTER-TABLE:BEGIN -->";
const ADAPTER_END = "<!-- ADAPTER-TABLE:END -->";
const CERT_BEGIN = "<!-- CERTIFICATION-TABLE:BEGIN -->";
const CERT_END = "<!-- CERTIFICATION-TABLE:END -->";
const PACK_BEGIN = "<!-- PACK-TARGETS-TABLE:BEGIN -->";
const PACK_END = "<!-- PACK-TARGETS-TABLE:END -->";

/** The number of rows `PACK_TARGETS` holds: the 13 adapters, the 3 dispositions and the generic `agents` row. */
const EXPECTED_PACK_TARGET_COUNT = 17;

// ────────────────────────────────────────────────────────────────────
// Roster validation (Rule #56): one record per adapter, no extras.
// ────────────────────────────────────────────────────────────────────

const adapterIds = Object.keys(CLIENT_ADAPTERS);
const recordIds = Object.keys(results.clients);
const missing = adapterIds.filter((id) => !recordIds.includes(id));
const extra = recordIds.filter((id) => !adapterIds.includes(id));
if (missing.length > 0 || extra.length > 0) {
  console.error(
    `render: certification-results.json roster mismatch — ` +
      `missing records: [${missing.join(", ") || "none"}]; unknown ids: [${extra.join(", ") || "none"}]`,
  );
  process.exit(2);
}
const KNOWN_DISPOSITIONS = new Set(["certified-live", "fixture-only-with-residual-risk"]);
for (const id of adapterIds) {
  const record = results.clients[id];
  // 33-4-R1: an unknown disposition (e.g. certify.mjs's own
  // "certification-failed-see-story" after a failed pass) must REFUSE the
  // render — the else branch would otherwise mislabel it fixture-only with
  // a literal "undefined" note (Rule #34 honesty).
  if (!KNOWN_DISPOSITIONS.has(record.disposition)) {
    console.error(`render: ${id} has unknown disposition "${record.disposition}" — refusing to render (a failed certification is resolved by re-running certify.mjs, never by relabeling)`);
    process.exit(2);
  }
  if (record.disposition === "certified-live" && (!record.date || !Array.isArray(record.evidence))) {
    console.error(`render: ${id} is certified-live but lacks date/evidence`);
    process.exit(2);
  }
  if (record.disposition === "fixture-only-with-residual-risk" && typeof record.note !== "string") {
    console.error(`render: ${id} is fixture-only-with-residual-risk but lacks a note`);
    process.exit(2);
  }
}

// --------------------------------------------------------------------
// Roster validation for the skills pack targets (Rule #56): the table is
// exhaustive over PACK_TARGETS, and every row is renderable.
// --------------------------------------------------------------------

function packRosterProblems() {
  const problems = [];
  if (PACK_TARGETS.length !== EXPECTED_PACK_TARGET_COUNT) {
    problems.push(`PACK_TARGETS has ${PACK_TARGETS.length} rows, expected ${EXPECTED_PACK_TARGET_COUNT}`);
  }
  const seen = new Set();
  for (const target of PACK_TARGETS) {
    if (seen.has(target.id)) problems.push(`duplicate id "${target.id}"`);
    seen.add(target.id);
    if (target.route !== null && PACK_ROUTES[target.route] === undefined) {
      problems.push(`${target.id}: route "${target.route}" has no PACK_ROUTES entry`);
    }
    if (target.route === null && (typeof target.noRouteReason !== "string" || target.noRouteReason === "")) {
      problems.push(`${target.id}: a null route needs a noRouteReason`);
    }
    if (!Array.isArray(target.sources) || target.sources.length === 0 || !target.sources.every((url) => url.startsWith("https://"))) {
      problems.push(`${target.id}: every row needs at least one https:// source`);
    }
  }
  return problems;
}

const packProblems = packRosterProblems();
if (packProblems.length > 0) {
  console.error(`render: PACK_TARGETS roster violation: ${packProblems.join("; ")}`);
  process.exit(2);
}

/** The always-on rules' stems: the file names under skills-pack/rules/claude-code/, without `.md`. */
function ruleStems() {
  let names = [];
  try {
    names = readdirSync(CLAUDE_CODE_RULES_DIR);
  } catch {
    names = [];
  }
  return names.filter((name) => name.endsWith(".md")).map((name) => name.slice(0, -".md".length)).sort();
}

const RULE_STEMS = ruleStems();
if (RULE_STEMS.length === 0) {
  console.error(`render: no always-on rule found under ${CLAUDE_CODE_RULES_DIR}`);
  process.exit(2);
}

// ────────────────────────────────────────────────────────────────────
// Shared render helpers.
// ────────────────────────────────────────────────────────────────────

/** Per-OS paths for a scope, collapsed when all three agree. */
function pathsCell(scopeDef) {
  if (!scopeDef) return "—";
  const { win32, darwin, linux } = scopeDef.paths;
  const tag = scopeDef.envOverride ? ` (or $${scopeDef.envOverride.var}/${scopeDef.envOverride.pathSuffix})` : "";
  if (win32 === darwin && darwin === linux) return `\`${win32}\`${tag}`;
  return `win \`${win32}\`<br>mac \`${darwin}\`<br>linux \`${linux}\`${tag}`;
}

function disableCell(adapter) {
  if (adapter.disableSupport === "native" && adapter.nativeDisableFlag) {
    const flag = adapter.nativeDisableFlag;
    return `native \`${flag.key}\` flag`;
  }
  return "manager stash";
}

function certCell(id) {
  const record = results.clients[id];
  switch (record.disposition) {
    case "certified-live": {
      // 33-5-15 (aa-33-4 #1): the cell carries the file-level-vs-agent-side
      // qualifier — a certified-live pass proves the agent-side CLI listing
      // only where the evidence holds an agent probe (`claude mcp list`,
      // `kimi -p`); everywhere else it is a FILE-LEVEL lifecycle proof and
      // the agent-side tool listing stays a manual GUI step.
      const agentProbe = (record.evidence ?? []).some(
        (line) => line.startsWith("$ claude mcp list") || line.startsWith("$ kimi -p"),
      );
      return agentProbe
        ? `**certified-live** ${record.date} (incl. agent CLI probe)`
        : `**certified-live** ${record.date} (file-level; agent-side GUI stays manual)`;
    }
    case "fixture-only-with-residual-risk":
      return "fixture-only (residual risk)";
    default:
      return record.disposition;
  }
}

// ────────────────────────────────────────────────────────────────────
// Section 1: the adapter table.
// ────────────────────────────────────────────────────────────────────

function renderAdapterTable() {
  const lines = [
    `Paths, formats, and mechanisms below are GENERATED from \`CLIENT_ADAPTERS\``,
    `(adapter data ${ADAPTER_DATA_VERSION}) by \`scripts/render-certification-table.mjs\` —`,
    `never hand-edit this section.`,
    ``,
    `| Client | Format | Root key | User config | Project config | Disable | Restart hint | Certification |`,
    `| --- | --- | --- | --- | --- | --- | --- | --- |`,
  ];
  for (const id of adapterIds) {
    const adapter = CLIENT_ADAPTERS[id];
    const user = adapter.scopes.find((s) => s.scope === "user");
    const project = adapter.scopes.find((s) => s.scope === "project");
    lines.push(
      `| ${adapter.displayName} (\`${id}\`) | ${adapter.format} | \`${adapter.rootKey}\` | ` +
        `${pathsCell(user)} | ${pathsCell(project)} | ${disableCell(adapter)} | ${adapter.restartHint} | ${certCell(id)} |`,
    );
  }
  return lines.join("\n");
}

// ────────────────────────────────────────────────────────────────────
// Section 2: the certification dispositions.
// ────────────────────────────────────────────────────────────────────

function renderCertificationDetails() {
  const lines = [
    `Dispositions are GENERATED from \`scripts/certification-results.json\` (real recorded`,
    `runs — commands + outputs, never edited to match) ⨝ the \`CLIENT_ADAPTERS\` roster by`,
    `\`scripts/render-certification-table.mjs\` — never hand-edit this section. Every client`,
    `has an explicit disposition (Rule #34 — no silent certification). A **certified-live**`,
    `pass proves the scripted lifecycle against the real config; the "client surfaces the`,
    `entry" step is the client's own agent CLI listing where the evidence shows one`,
    `(\`claude mcp list\`, \`kimi -p\`) and a FILE-LEVEL status read otherwise — an agent-side`,
    `GUI tool listing is never claimed by the harness (33-5-15).`,
    ``,
  ];
  for (const id of adapterIds) {
    const adapter = CLIENT_ADAPTERS[id];
    const record = results.clients[id];
    lines.push(`#### ${adapter.displayName} (\`${id}\`)`);
    lines.push(``);
    if (record.disposition === "certified-live") {
      lines.push(
        `**certified-live** (${record.date}, ${record.host}) — scripted pass via \`scripts/certify.mjs\` ` +
          `(server used: \`${record.server}\`): add (engine apply) → client surfaces the entry → disable → ` +
          `entry inactive → remove → byte-exact restore + side-effect cleanup.`,
      );
      lines.push(``);
      lines.push(`Recorded evidence:`);
      for (const line of record.evidence) lines.push(`- ${line}`);
      lines.push(``);
      if (record.residualRisk) {
        lines.push(`Residual risk: ${record.residualRisk}`);
        lines.push(``);
      }
      if (record.sharing) {
        lines.push(`Repo \`.mcp.json\` sharing (Claude half, AC 33.4.4): **${record.sharing.verdict}** (${record.sharing.date}) — ${record.sharing.evidence}.`);
        lines.push(``);
      }
      if (record.ac3344) {
        const a = record.ac3344;
        lines.push(`AC 33.4.4 dual-surface:`);
        lines.push(`- CLI/TUI half: **${a.cliTuiHalf.verdict}** (${a.cliTuiHalf.date}) — ${a.cliTuiHalf.evidence}.`);
        lines.push(`- VS Code extension half: **${a.vscodeExtensionHalf.verdict}** (${a.vscodeExtensionHalf.date}) — ${a.vscodeExtensionHalf.note}.`);
        lines.push(`- Repo \`.mcp.json\` sharing: Claude side ${a.mcpJsonSharing.claudeSide}; Kimi side — ${a.mcpJsonSharing.kimiSide}. Consequence: ${a.mcpJsonSharing.consequence}.`);
        lines.push(``);
      }
    } else {
      lines.push(`**fixture-only-with-residual-risk** (${record.date}) — ${record.note}`);
      lines.push(``);
    }
  }
  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd();
}

// --------------------------------------------------------------------
// Section 3: the skills pack targets (Story 41.7).
// --------------------------------------------------------------------

/** A table cell: a `|` inside the text must not end the cell. */
function cell(text) {
  return text.replaceAll("|", "\\|");
}

function skillsDirCell(target) {
  return target.route === null ? "none" : `\`${PACK_ROUTES[target.route].skillsDir}/\``;
}

function ruleCell(target) {
  if (target.route === null) return "none";
  const rule = PACK_ROUTES[target.route].rule;
  if (rule.kind === "block") return `a marked block in \`${rule.host}\``;
  return RULE_STEMS.map((stem) => `\`${rule.dir}/${stem}${RULE_FORM_EXTENSIONS[rule.form]}\``).join(", ");
}

function whyCell(target) {
  const parts = [target.why, ...target.notes.map((note) => `Installer note: ${note}`)];
  if (target.route === null) parts.push(`Refused: ${target.noRouteReason}`);
  return cell(parts.join(" "));
}

function sourcesCell(target) {
  return target.sources.map((url, index) => `[${index + 1}](${url})`).join(", ");
}

function renderPackTargetsTable() {
  const lines = [
    `Generated from \`PACK_TARGETS\` (client documentation checked ${PACK_TARGETS_CHECKED_ON}) by ` +
      `\`scripts/render-certification-table.mjs\`; do not edit by hand.`,
    ``,
    `| Client | \`--client\` | Skills go to | The always-on rule goes to | Why | Sources |`,
    `| --- | --- | --- | --- | --- | --- |`,
  ];
  for (const target of PACK_TARGETS) {
    lines.push(
      `| ${cell(target.displayName)} | \`${target.id}\` | ${skillsDirCell(target)} | ${ruleCell(target)} | ` +
        `${whyCell(target)} | ${sourcesCell(target)} |`,
    );
  }
  return lines.join("\n");
}

// ────────────────────────────────────────────────────────────────────
// Splice the rendered sections into the README (or check them).
// ────────────────────────────────────────────────────────────────────

function splice(readme, begin, end, content) {
  const start = readme.indexOf(begin);
  const stop = readme.indexOf(end);
  if (start === -1 || stop === -1 || stop < start) {
    console.error(`render: README is missing the ${begin} … ${end} marker pair`);
    process.exit(2);
  }
  return `${readme.slice(0, start + begin.length)}\n${content}\n${readme.slice(stop)}`;
}

const readme = readFileSync(README_PATH, "utf8");
let next = splice(readme, ADAPTER_BEGIN, ADAPTER_END, renderAdapterTable());
next = splice(next, CERT_BEGIN, CERT_END, renderCertificationDetails());
next = splice(next, PACK_BEGIN, PACK_END, renderPackTargetsTable());

if (process.argv.includes("--check")) {
  if (next !== readme) {
    console.error("render --check: README.md marker sections are OUT OF SYNC — run: node scripts/render-certification-table.mjs");
    process.exit(1);
  }
  console.log("render --check: README.md marker sections are in sync");
  process.exit(0);
}

writeFileSync(README_PATH, next, "utf8");
console.log("render: README.md marker sections regenerated");
