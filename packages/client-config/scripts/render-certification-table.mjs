#!/usr/bin/env node
/**
 * `render-certification-table.mjs` — generates the README's adapter table and
 * certification disposition sections (Story 33.4, AC 33.4.1/33.4.3; Rule
 * #51/#56 discipline: the tables are GENERATED from `CLIENT_ADAPTERS` ⨝
 * `scripts/certification-results.json`, never hand-authored).
 *
 * The generator REQUIRES one results record per registry adapter (the
 * enumeration is exhaustive by construction — a missing record fails the
 * render, so a new client can never ship an undocumented disposition).
 *
 * Usage:
 *   node scripts/render-certification-table.mjs           # rewrite the README marker sections
 *   node scripts/render-certification-table.mjs --check   # exit 1 when the README is out of sync
 *
 * Requires a built dist (`npm run build`) — adapter data is imported from
 * ../dist/adapters.js so the generated docs can never drift from the data
 * the engine actually uses.
 */

import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PACKAGE_ROOT = fileURLToPath(new URL("..", import.meta.url));
const README_PATH = path.join(PACKAGE_ROOT, "README.md");
const RESULTS_PATH = path.join(PACKAGE_ROOT, "scripts", "certification-results.json");

const { CLIENT_ADAPTERS, ADAPTER_DATA_VERSION } = await import("../dist/adapters.js");
const results = JSON.parse(readFileSync(RESULTS_PATH, "utf8"));

const ADAPTER_BEGIN = "<!-- ADAPTER-TABLE:BEGIN -->";
const ADAPTER_END = "<!-- ADAPTER-TABLE:END -->";
const CERT_BEGIN = "<!-- CERTIFICATION-TABLE:BEGIN -->";
const CERT_END = "<!-- CERTIFICATION-TABLE:END -->";

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
    case "certified-live":
      return `**certified-live** ${record.date}`;
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
    `has an explicit disposition (Rule #34 — no silent certification):`,
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
