/**
 * `@iris-mcp/client-config` - the plan for installing, updating or removing the skills pack in one project
 * (Story 41.6, AC 41.6.2; AD-28, AD-30).
 *
 * Everything here is pure over a project view that is handed in: `planPackChange` reads files through
 * `project.read` and decides, for every path, whether it is created, updated, removed, adopted, left alone, kept
 * or in conflict. It never writes and never reads process state; `pack-apply.ts` executes the plan.
 *
 * **Ownership (AD-30).** The installer touches only files recorded in the project manifest
 * (`.iris-mcp/skills-pack.json`), files adopted because they are byte-identical to the pack, the marked blocks
 * of `AGENTS.md` / `GEMINI.md`, the manifest itself, and the directories it creates. A file at an owned path that
 * the installer did not install is a conflict, and a conflict refuses the whole run. An owned file whose hash
 * differs from its record is kept unless the caller asks to include modified files.
 *
 * **The notice.** `IRIS-MCP-THIRD-PARTY-NOTICES.md` is planned in the directory of every installed file that
 * carries adapted content. A rule form that carries adapted content is refused, because no safe place for the
 * notice exists beside an auto-loaded rule.
 *
 * Portable by contract: this module imports only `node:*` built-ins, `pack-targets.ts` and `rule-block.ts`.
 */

import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  ADAPTATION_MARKER,
  NOTE_CLAUDE_MD,
  NOTICE_FILENAME,
  PACK_ROUTES,
  PACK_ROUTE_IDS,
  RULE_FORM_DIRS,
  RULE_FORM_EXTENSIONS,
  firstMatchNote,
  packRouteFor,
  packTargetFor,
  type PackRoute,
  type PackRouteId,
  type PackRuleForm,
} from "./pack-targets.js";
import {
  locateRuleBlock,
  ruleSectionProblem,
  withRuleBlock,
  withoutRuleBlock,
  type LineEndingAdded,
} from "./rule-block.js";

// ------------------------------------------------------------------
// Constants and path rules.
// ------------------------------------------------------------------

/** The installer's per-project record of what it owns. */
export const MANIFEST_PATH = ".iris-mcp/skills-pack.json";

/** The directory that holds the manifest. */
export const MANIFEST_DIR = ".iris-mcp";

export const MANIFEST_SCHEMA = 1;

const MANIFEST_NOTE =
  "Written by iris-mcp-clients. It lists the files and blocks the skills installer owns in this project, so an update or an uninstall changes only those.";

/** The directory of the pack that ships inside this package (the pack is generated; see `scripts/gen-pack.mjs`). */
export const DEFAULT_PACK_DIR = fileURLToPath(new URL("../skills-pack/", import.meta.url)).replace(/[\\/]+$/, "");

const RULE_STEM = /^[a-z0-9]+(-[a-z0-9]+)*$/;

function unique(values: string[]): string[] {
  return [...new Set(values)].sort();
}

/** The directories whose files the installer may own: every route's skills directory and rules directory. */
const FILE_ROOTS: readonly string[] = unique(
  PACK_ROUTE_IDS.flatMap((id) => {
    const route = PACK_ROUTES[id];
    return route.rule.kind === "file" ? [route.skillsDir, route.rule.dir] : [route.skillsDir];
  }),
);

/** The files in the project root the installer may hold a marked block in. */
const BLOCK_HOSTS: readonly string[] = unique(
  PACK_ROUTE_IDS.flatMap((id) => {
    const rule = PACK_ROUTES[id].rule;
    return rule.kind === "block" ? [rule.host] : [];
  }),
);

/** Directories above a file root that the installer may create. */
const DIR_ANCESTORS: readonly string[] = unique(
  FILE_ROOTS.flatMap((root) => {
    const parts = root.split("/");
    return parts.slice(0, -1).map((_, index) => parts.slice(0, index + 1).join("/"));
  }),
);

/** True when `rel` is a project-relative POSIX path with no empty, `.` or `..` segment, backslash or NUL. */
export function isSafeRelativePath(rel: string): boolean {
  if (rel === "" || rel.startsWith("/") || rel.includes("\\") || rel.includes("\0")) return false;
  return rel.split("/").every((segment) => segment !== "" && segment !== "." && segment !== "..");
}

/** True when the installer may own a file at `rel`: a path inside one of its skills or rules directories. */
export function isManagedFilePath(rel: string): boolean {
  return isSafeRelativePath(rel) && FILE_ROOTS.some((root) => rel.startsWith(`${root}/`));
}

/** True when `rel` is a host file the installer may hold a marked block in. */
export function isManagedHostPath(rel: string): boolean {
  return BLOCK_HOSTS.includes(rel);
}

/** True when the installer may create (and later remove) a directory at `rel`. */
export function isManagedDirPath(rel: string): boolean {
  if (!isSafeRelativePath(rel)) return false;
  if (rel === MANIFEST_DIR || DIR_ANCESTORS.includes(rel) || FILE_ROOTS.includes(rel)) return true;
  return FILE_ROOTS.some((root) => rel.startsWith(`${root}/`));
}

/** True when `rel` is a path the installer may read or write at all. */
export function isManagedPath(rel: string): boolean {
  return rel === MANIFEST_PATH || isManagedFilePath(rel) || isManagedHostPath(rel);
}

function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function parentOf(rel: string): string {
  const at = rel.lastIndexOf("/");
  return at < 0 ? "" : rel.slice(0, at);
}

function isNoticePath(rel: string): boolean {
  return rel === NOTICE_FILENAME || rel.endsWith(`/${NOTICE_FILENAME}`);
}

function ancestorsOf(rel: string): string[] {
  const parts = rel.split("/").slice(0, -1);
  return parts.map((_, index) => parts.slice(0, index + 1).join("/"));
}

// ------------------------------------------------------------------
// The manifest.
// ------------------------------------------------------------------

export interface ManifestFile {
  path: string;
  /** Lower-case hex sha256 of the bytes the installer wrote or adopted. */
  sha256: string;
  /** The client ids that need this file. */
  clients: string[];
}

export interface ManifestBlock {
  /** The host file: `AGENTS.md` or `GEMINI.md`. */
  path: string;
  /** The rule's name (the marker lines' stem). */
  rule: string;
  /** True when the installer created the host file. */
  created: boolean;
  /** The line ending the installer added to the host's last line before the block. */
  lineEndingAdded: LineEndingAdded;
  clients: string[];
}

export interface PackManifest {
  schema: 1;
  note: string;
  files: ManifestFile[];
  blocks: ManifestBlock[];
  /** Directories the installer created. */
  dirs: string[];
}

export function emptyManifest(): PackManifest {
  return { schema: 1, note: MANIFEST_NOTE, files: [], blocks: [], dirs: [] };
}

export type ParseManifestResult = { ok: true; manifest: PackManifest } | { ok: false; why: string };

const HEX_SHA256 = /^[0-9a-f]{64}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function checkClients(value: unknown, where: string): string[] | string {
  if (!Array.isArray(value) || value.length === 0) return `${where} needs a non-empty "clients" list`;
  const out: string[] = [];
  for (const client of value) {
    if (typeof client !== "string" || client === "") return `${where} has a client that is not a name`;
    if (out.includes(client)) return `${where} lists the client "${client}" twice`;
    out.push(client);
  }
  return out;
}

/**
 * Read the installer's record. Strict: an unknown schema, a missing or extra field, a repeated path, or a path
 * outside the installer's own locations makes the record invalid, so a hand-edited or cloned record can never
 * direct a write or delete elsewhere.
 *
 * @param bytes - The manifest file's bytes.
 */
export function parseManifest(bytes: Uint8Array): ParseManifestResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(bytes).toString("utf8"));
  } catch {
    return { ok: false, why: "it is not JSON" };
  }
  if (!isRecord(parsed)) return { ok: false, why: "it is not a JSON object" };
  if (parsed.schema !== MANIFEST_SCHEMA) {
    return { ok: false, why: `unknown schema ${JSON.stringify(parsed.schema) ?? "(none)"}; this installer reads schema ${MANIFEST_SCHEMA}` };
  }
  const known = new Set(["schema", "note", "files", "blocks", "dirs"]);
  for (const key of Object.keys(parsed)) {
    if (!known.has(key)) return { ok: false, why: `unexpected field "${key}"` };
  }
  if (parsed.note !== undefined && typeof parsed.note !== "string") return { ok: false, why: '"note" is not a string' };
  const { files: rawFiles, blocks: rawBlocks, dirs: rawDirs } = parsed;
  if (!Array.isArray(rawFiles) || !Array.isArray(rawBlocks) || !Array.isArray(rawDirs)) {
    return { ok: false, why: '"files", "blocks" and "dirs" must each be a list' };
  }

  const files: ManifestFile[] = [];
  for (const entry of rawFiles) {
    if (!isRecord(entry) || typeof entry.path !== "string" || typeof entry.sha256 !== "string") {
      return { ok: false, why: "a files entry needs a path and a sha256" };
    }
    if (Object.keys(entry).some((key) => !["path", "sha256", "clients"].includes(key))) {
      return { ok: false, why: `the files entry "${entry.path}" has an unexpected field` };
    }
    if (!isManagedFilePath(entry.path)) {
      return { ok: false, why: `the path "${entry.path}" is outside the locations this installer manages` };
    }
    if (!HEX_SHA256.test(entry.sha256)) return { ok: false, why: `the files entry "${entry.path}" has no valid sha256` };
    if (files.some((file) => file.path === entry.path)) return { ok: false, why: `the path "${entry.path}" is listed twice` };
    const clients = checkClients(entry.clients, `the files entry "${entry.path}"`);
    if (typeof clients === "string") return { ok: false, why: clients };
    files.push({ path: entry.path, sha256: entry.sha256, clients });
  }

  const blocks: ManifestBlock[] = [];
  for (const entry of rawBlocks) {
    if (!isRecord(entry) || typeof entry.path !== "string" || typeof entry.rule !== "string") {
      return { ok: false, why: "a blocks entry needs a path and a rule" };
    }
    if (Object.keys(entry).some((key) => !["path", "rule", "created", "lineEndingAdded", "clients"].includes(key))) {
      return { ok: false, why: `the blocks entry "${entry.path}" has an unexpected field` };
    }
    if (!isManagedHostPath(entry.path)) {
      return { ok: false, why: `the block host "${entry.path}" is outside the locations this installer manages` };
    }
    if (!RULE_STEM.test(entry.rule)) return { ok: false, why: `the blocks entry "${entry.path}" has an invalid rule name` };
    if (typeof entry.created !== "boolean") return { ok: false, why: `the blocks entry "${entry.path}" needs a boolean "created"` };
    const ending = entry.lineEndingAdded;
    if (ending !== "" && ending !== "\n" && ending !== "\r\n") {
      return { ok: false, why: `the blocks entry "${entry.path}" has an invalid "lineEndingAdded"` };
    }
    if (blocks.some((block) => block.path === entry.path && block.rule === entry.rule)) {
      return { ok: false, why: `the block "${entry.rule}" in "${entry.path}" is listed twice` };
    }
    const clients = checkClients(entry.clients, `the blocks entry "${entry.path}"`);
    if (typeof clients === "string") return { ok: false, why: clients };
    blocks.push({ path: entry.path, rule: entry.rule, created: entry.created, lineEndingAdded: ending, clients });
  }

  const dirs: string[] = [];
  for (const entry of rawDirs) {
    if (typeof entry !== "string" || !isManagedDirPath(entry)) {
      return { ok: false, why: `the directory ${JSON.stringify(entry)} is outside the locations this installer manages` };
    }
    if (dirs.includes(entry)) return { ok: false, why: `the directory "${entry}" is listed twice` };
    dirs.push(entry);
  }

  return { ok: true, manifest: { schema: 1, note: MANIFEST_NOTE, files, blocks, dirs } };
}

/** The manifest's bytes: sorted, two-space JSON, LF, no timestamp. */
export function renderManifest(manifest: PackManifest): Buffer {
  const files = [...manifest.files]
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
    .map((file) => ({ path: file.path, sha256: file.sha256, clients: [...file.clients].sort() }));
  const blocks = [...manifest.blocks]
    .sort((a, b) => (a.path + "\0" + a.rule < b.path + "\0" + b.rule ? -1 : 1))
    .map((block) => ({
      path: block.path,
      rule: block.rule,
      created: block.created,
      lineEndingAdded: block.lineEndingAdded,
      clients: [...block.clients].sort(),
    }));
  const dirs = [...manifest.dirs].sort();
  return Buffer.from(`${JSON.stringify({ schema: MANIFEST_SCHEMA, note: MANIFEST_NOTE, files, blocks, dirs }, null, 2)}\n`, "utf8");
}

// ------------------------------------------------------------------
// The pack.
// ------------------------------------------------------------------

export interface PackRule {
  /** The rule's name: its file name without the extension. */
  stem: string;
  claudeCode: Buffer;
  cursor: Buffer;
  agentsMd: Buffer;
}

export interface LoadedPack {
  dir: string;
  /** Every file under `skills/`, keyed by its path below `skills/` (POSIX). */
  skills: ReadonlyMap<string, Buffer>;
  rules: readonly PackRule[];
  notice: Buffer;
}

export type LoadPackResult = { ok: true; pack: LoadedPack } | { ok: false; message: string };

function listFiles(dir: string, prefix = ""): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
    const rel = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
    if (entry.isDirectory()) out.push(...listFiles(`${dir}/${entry.name}`, rel));
    else if (entry.isFile()) out.push(rel);
  }
  return out;
}

function isDirectorySync(dir: string): boolean {
  try {
    return statSync(dir).isDirectory();
  } catch {
    return false;
  }
}

function stemsIn(dir: string, extension: string): string[] {
  if (!isDirectorySync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => name.endsWith(extension))
    .map((name) => name.slice(0, -extension.length));
}

/**
 * Read the skills pack from `packDir`: every file of `skills/`, the three forms of each rule and the notice.
 * Refuses a pack with no `skills/` directory, no notice, a rule missing one of its forms, or an `agents-md` form
 * that is not exactly its own section.
 *
 * @param packDir - The pack directory (default: the one shipped in this package).
 */
export function loadPack(packDir: string = DEFAULT_PACK_DIR): LoadPackResult {
  const fail = (message: string): LoadPackResult => ({ ok: false, message });
  const skillsDir = `${packDir}/skills`;
  if (!isDirectorySync(packDir) || !isDirectorySync(skillsDir)) {
    return fail(`the skills pack is missing at ${packDir}`);
  }
  let notice: Buffer;
  try {
    notice = readFileSync(`${packDir}/${NOTICE_FILENAME}`);
  } catch {
    return fail(`the skills pack at ${packDir} has no ${NOTICE_FILENAME}`);
  }

  const skills = new Map<string, Buffer>();
  for (const rel of listFiles(skillsDir)) {
    if (!isSafeRelativePath(rel)) return fail(`the skills pack holds a file with an unusable name: ${rel}`);
    skills.set(rel, readFileSync(`${skillsDir}/${rel}`));
  }
  if (skills.size === 0) return fail(`the skills pack at ${packDir} holds no skill`);

  const stems = unique([
    ...stemsIn(`${packDir}/${RULE_FORM_DIRS.claudeCode}`, RULE_FORM_EXTENSIONS.claudeCode),
    ...stemsIn(`${packDir}/${RULE_FORM_DIRS.cursor}`, RULE_FORM_EXTENSIONS.cursor),
    ...stemsIn(`${packDir}/${RULE_FORM_DIRS.agentsMd}`, RULE_FORM_EXTENSIONS.agentsMd),
  ]);
  const rules: PackRule[] = [];
  for (const stem of stems) {
    if (!RULE_STEM.test(stem)) return fail(`the skills pack holds a rule with an unusable name: ${stem}`);
    const forms = {} as Record<PackRuleForm, Buffer>;
    for (const form of ["claudeCode", "cursor", "agentsMd"] as const) {
      const file = `${RULE_FORM_DIRS[form]}/${stem}${RULE_FORM_EXTENSIONS[form]}`;
      try {
        forms[form] = readFileSync(`${packDir}/${file}`);
      } catch {
        return fail(`the skills pack lacks ${file}; every rule needs all three forms`);
      }
    }
    const problem = ruleSectionProblem(forms.agentsMd, stem);
    if (problem !== null) return fail(`${RULE_FORM_DIRS.agentsMd}/${stem}${RULE_FORM_EXTENSIONS.agentsMd}: ${problem}`);
    rules.push({ stem, claudeCode: forms.claudeCode, cursor: forms.cursor, agentsMd: forms.agentsMd });
  }
  return { ok: true, pack: { dir: packDir, skills, rules, notice } };
}

// ------------------------------------------------------------------
// The desired state of one route.
// ------------------------------------------------------------------

interface DesiredBlock {
  host: string;
  stem: string;
  section: Buffer;
}

interface DesiredState {
  files: Map<string, Buffer>;
  blocks: DesiredBlock[];
}

/** The files and blocks a route installs from `pack`, or why the pack cannot be installed. */
function desiredState(pack: LoadedPack, route: PackRoute): DesiredState | { error: string } {
  const files = new Map<string, Buffer>();
  const put = (rel: string, bytes: Buffer): string | null => {
    const earlier = files.get(rel);
    if (earlier !== undefined && !earlier.equals(bytes)) return `${rel} is produced twice with different bytes`;
    files.set(rel, bytes);
    return null;
  };

  for (const rule of pack.rules) {
    for (const form of ["claudeCode", "cursor", "agentsMd"] as const) {
      if (rule[form].includes(ADAPTATION_MARKER)) {
        return {
          error:
            `the ${form} form of the rule ${rule.stem} carries adapted content, and the installer cannot place ` +
            `${NOTICE_FILENAME} beside a rule that a client loads automatically`,
        };
      }
    }
  }

  for (const [rel, bytes] of pack.skills) {
    const path = `${route.skillsDir}/${rel}`;
    if (!isManagedFilePath(path)) return { error: `the skills pack names a path the installer cannot manage: ${rel}` };
    const clash = put(path, bytes);
    if (clash !== null) return { error: clash };
    if (bytes.includes(ADAPTATION_MARKER)) {
      const noticeClash = put(`${parentOf(path)}/${NOTICE_FILENAME}`, pack.notice);
      if (noticeClash !== null) return { error: noticeClash };
    }
  }

  const blocks: DesiredBlock[] = [];
  for (const rule of pack.rules) {
    if (route.rule.kind === "file") {
      const path = `${route.rule.dir}/${rule.stem}${RULE_FORM_EXTENSIONS[route.rule.form]}`;
      const clash = put(path, rule[route.rule.form]);
      if (clash !== null) return { error: clash };
    } else {
      blocks.push({ host: route.rule.host, stem: rule.stem, section: rule.agentsMd });
    }
  }
  return { files, blocks };
}

// ------------------------------------------------------------------
// The plan.
// ------------------------------------------------------------------

export type PackAction = "install" | "uninstall";

export type PackChange = "create" | "update" | "remove" | "adopt" | "unchanged" | "keep" | "conflict";

export interface PlanItem {
  path: string;
  change: PackChange;
  detail?: string;
}

/** One file to write (`after` set) or delete (`after` null). `before` is the file's bytes now, or null when absent. */
export interface PlanWrite {
  rel: string;
  before: Buffer | null;
  after: Buffer | null;
  /** The blocks that must be present, whole and equal to their section, after the write. */
  blocks?: Array<{ stem: string; section: Buffer }>;
}

export interface PlanCounts {
  create: number;
  update: number;
  remove: number;
  adopt: number;
  unchanged: number;
  keep: number;
  conflict: number;
}

export interface PackPlan {
  ok: true;
  action: PackAction;
  client: string;
  displayName: string;
  route: PackRouteId;
  /** True when the project's record already lists files or blocks for this client. */
  installed: boolean;
  /** Every path the plan decided about, sorted by path. Directories are not items. */
  items: PlanItem[];
  writes: PlanWrite[];
  /** Directories to create, shallow first. */
  createDirs: string[];
  /** Recorded directories to remove when empty, deepest first. */
  removeDirs: string[];
  manifestBefore: Buffer | null;
  /** The manifest to write, or null to delete it (or when there is none). */
  manifestAfter: Buffer | null;
  /** The sha256 of every path the plan read (null when the path was absent), for the changed-since-preview check. */
  observed: Array<{ rel: string; sha256: string | null }>;
  notes: string[];
  counts: PlanCounts;
  conflicts: PlanItem[];
  /** The number of paths the plan creates, updates or removes. */
  changes: number;
}

export type PackRefusalKind = "unknown-client" | "no-route" | "manifest" | "pack";

export interface PackRefusal {
  ok: false;
  kind: PackRefusalKind;
  message: string;
}

/** The part of a project the planner reads. Paths are project-relative and POSIX. */
export interface ProjectView {
  /** The file's bytes, or null when the path is absent or is not a file. */
  read(rel: string): Uint8Array | null;
  isDirectory(rel: string): boolean;
  /** Entry names of a directory, or null when it does not exist. Optional: without it, emptiness is assumed. */
  listDir?(rel: string): string[] | null;
}

export interface PlanInput {
  action: PackAction;
  client: string;
  includeModified: boolean;
  /** Required for `install`; an `uninstall` needs no pack. */
  pack?: LoadedPack;
  project: ProjectView;
}

const KEPT_DETAIL_INSTALL = "changed since it was installed; --include-modified replaces it";
const KEPT_DETAIL_UNINSTALL = "changed since it was installed; --include-modified removes it";
const BACKED_UP_DETAIL = "your changes are backed up first";
const GONE_DETAIL = "already gone; its record is dropped";
const KEPT_NOTICE_DETAIL = "kept beside a file you changed, which may still carry the adapted content";
const STALE_DETAIL = "no longer in the skills pack";
const ADOPT_DETAIL = "already identical to the skills pack; recorded as installed";
const MANIFEST_DETAIL = "the installer's record of what it owns here";
const FOREIGN_DETAIL = "exists, and this installer did not install it; move or delete it, then re-run";

function addClient(clients: readonly string[] | undefined, client: string): string[] {
  const out = [...(clients ?? [])];
  if (!out.includes(client)) out.push(client);
  return out.sort();
}

function blockKey(path: string, rule: string): string {
  return `${path}\0${rule}`;
}

function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Plan an install, update or uninstall of the skills pack for one client in one project.
 *
 * - **install** makes the project hold exactly the route's files and blocks: new files are created, changed pack
 *   files are updated, byte-identical files are adopted, owned paths no longer in the pack are removed.
 * - **uninstall** removes the files and blocks this client owns, unless another client still needs them.
 *
 * A refusal (unknown client, no route, invalid manifest, unusable pack) is returned, never thrown.
 */
export function planPackChange(input: PlanInput): PackPlan | PackRefusal {
  const { action, client, includeModified, project } = input;
  const target = packTargetFor(client);
  if (target === undefined) return { ok: false, kind: "unknown-client", message: `unknown client "${client}"` };
  const route = packRouteFor(client);
  if (target.route === null || route === undefined) {
    return { ok: false, kind: "no-route", message: target.noRouteReason ?? `${target.displayName} has no skills route` };
  }

  const observed = new Map<string, string | null>();
  const readTracked = (rel: string): Buffer | null => {
    const raw = project.read(rel);
    const bytes = raw === null ? null : Buffer.from(raw);
    observed.set(rel, bytes === null ? null : sha256Hex(bytes));
    return bytes;
  };

  // The manifest.
  if (project.isDirectory(MANIFEST_PATH)) {
    return {
      ok: false,
      kind: "manifest",
      message: `the installer's record ${MANIFEST_PATH} is not valid (it is a directory); fix or delete it, then re-run`,
    };
  }
  const manifestBefore = readTracked(MANIFEST_PATH);
  let before = emptyManifest();
  if (manifestBefore !== null) {
    const parsed = parseManifest(manifestBefore);
    if (!parsed.ok) {
      return {
        ok: false,
        kind: "manifest",
        message: `the installer's record ${MANIFEST_PATH} is not valid (${parsed.why}); fix or delete it, then re-run`,
      };
    }
    before = parsed.manifest;
  }

  // The desired state of this client, and of any other client whose records are re-evaluated.
  const desiredCache = new Map<string, DesiredState | { error: string }>();
  const desiredFor = (clientId: string): DesiredState | { error: string } | undefined => {
    const clientRoute = packRouteFor(clientId);
    if (clientRoute === undefined || input.pack === undefined) return undefined;
    let cached = desiredCache.get(clientId);
    if (cached === undefined) {
      cached = desiredState(input.pack, clientRoute);
      desiredCache.set(clientId, cached);
    }
    return cached;
  };
  let desired: DesiredState = { files: new Map(), blocks: [] };
  if (action === "install") {
    if (input.pack === undefined) return { ok: false, kind: "pack", message: "the skills pack was not loaded" };
    const own = desiredFor(client);
    if (own === undefined || "error" in own) {
      return { ok: false, kind: "pack", message: own === undefined ? "the skills pack was not loaded" : own.error };
    }
    desired = own;
  }
  /** True unless the pack no longer puts `rel` at the place `clientId` installs it. */
  const stillDesired = (clientId: string, rel: string): boolean => {
    const state = desiredFor(clientId);
    return state === undefined || "error" in state ? true : state.files.has(rel);
  };
  const stillDesiredBlock = (clientId: string, host: string, stem: string): boolean => {
    const state = desiredFor(clientId);
    return state === undefined || "error" in state ? true : state.blocks.some((b) => b.host === host && b.stem === stem);
  };

  // Working copy of the records.
  const files = new Map<string, ManifestFile>(before.files.map((file) => [file.path, { ...file, clients: [...file.clients] }]));
  const blocks = new Map<string, ManifestBlock>(
    before.blocks.map((block) => [blockKey(block.path, block.rule), { ...block, clients: [...block.clients] }]),
  );

  const items: PlanItem[] = [];
  const writes: PlanWrite[] = [];
  const deleted = new Set<string>();
  const item = (path: string, change: PackChange, detail?: string): void => {
    items.push(detail === undefined ? { path, change } : { path, change, detail });
  };

  // Files wanted by this client (install).
  for (const [rel, bytes] of [...desired.files].sort((a, b) => compare(a[0], b[0]))) {
    if (project.isDirectory(rel)) {
      item(rel, "conflict", "a directory is in the way; move or delete it, then re-run");
      continue;
    }
    const record = files.get(rel);
    const current = readTracked(rel);
    const want = sha256Hex(bytes);
    const have = current === null ? null : sha256Hex(current);
    const own = (sha: string): void => {
      files.set(rel, { path: rel, sha256: sha, clients: addClient(record?.clients, client) });
    };
    if (record !== undefined) {
      if (current === null) {
        writes.push({ rel, before: null, after: bytes });
        item(rel, "create");
        own(want);
      } else if (have === want) {
        item(rel, "unchanged");
        own(want);
      } else if (have === record.sha256) {
        writes.push({ rel, before: current, after: bytes });
        item(rel, "update");
        own(want);
      } else if (includeModified) {
        writes.push({ rel, before: current, after: bytes });
        item(rel, "update", BACKED_UP_DETAIL);
        own(want);
      } else {
        item(rel, "keep", KEPT_DETAIL_INSTALL);
        own(record.sha256);
      }
    } else if (current === null) {
      writes.push({ rel, before: null, after: bytes });
      item(rel, "create");
      own(want);
    } else if (have === want) {
      item(rel, "adopt", ADOPT_DETAIL);
      own(want);
    } else {
      item(rel, "conflict", FOREIGN_DETAIL);
    }
  }

  // Records this client no longer needs (stale after an update, or everything on uninstall). A notice stays for as
  // long as a file the user changed stays in its directory, so adapted content is never left without it.
  const keptDirs = new Set<string>();
  const removeFileRecord = (record: ManifestFile, remaining: string[], stale: boolean): void => {
    if (remaining.length > 0) {
      files.set(record.path, { ...record, clients: remaining });
      if (action === "uninstall") item(record.path, "unchanged", `still used by ${remaining.join(", ")}`);
      return;
    }
    const current = project.isDirectory(record.path) ? null : readTracked(record.path);
    if (current === null) {
      files.delete(record.path);
      item(record.path, "remove", GONE_DETAIL);
      return;
    }
    const modified = sha256Hex(current) !== record.sha256;
    if (modified && !includeModified) {
      keptDirs.add(parentOf(record.path));
      item(record.path, "keep", KEPT_DETAIL_UNINSTALL);
      return;
    }
    if (isNoticePath(record.path) && keptDirs.has(parentOf(record.path))) {
      item(record.path, "keep", KEPT_NOTICE_DETAIL);
      return;
    }
    writes.push({ rel: record.path, before: current, after: null });
    deleted.add(record.path);
    files.delete(record.path);
    const detail = [stale ? STALE_DETAIL : "", modified ? BACKED_UP_DETAIL : ""].filter((part) => part !== "").join("; ");
    item(record.path, "remove", detail === "" ? undefined : detail);
  };
  const noticesLast = (a: ManifestFile, b: ManifestFile): number =>
    Number(isNoticePath(a.path)) - Number(isNoticePath(b.path)) || compare(a.path, b.path);
  for (const record of [...files.values()].sort(noticesLast)) {
    if (!record.clients.includes(client)) continue;
    if (action === "install" && desired.files.has(record.path)) continue;
    if (action === "install") {
      const remaining = record.clients.filter((other) => other !== client && stillDesired(other, record.path));
      removeFileRecord(record, remaining, true);
    } else {
      removeFileRecord(
        record,
        record.clients.filter((other) => other !== client),
        false,
      );
    }
  }

  // Marked blocks.
  const hostOriginal = new Map<string, Buffer | null>();
  const hostBytes = new Map<string, Buffer | null>();
  const hostChecks = new Map<string, Array<{ stem: string; section: Buffer }>>();
  const hostUsable = (host: string): boolean => {
    if (project.isDirectory(host)) {
      item(host, "conflict", "a directory is in the way; move or delete it, then re-run");
      return false;
    }
    if (!hostBytes.has(host)) {
      const original = readTracked(host);
      hostOriginal.set(host, original);
      hostBytes.set(host, original);
    }
    return true;
  };
  const hostNow = (host: string): Buffer | null => hostBytes.get(host) ?? null;

  const removeBlockRecord = (record: ManifestBlock, remaining: string[]): void => {
    const key = blockKey(record.path, record.rule);
    if (remaining.length > 0) {
      blocks.set(key, { ...record, clients: remaining });
      if (action === "uninstall") item(record.path, "unchanged", `the ${record.rule} block is still used by ${remaining.join(", ")}`);
      return;
    }
    if (!hostUsable(record.path)) return;
    const current = hostNow(record.path);
    if (current === null) {
      blocks.delete(key);
      item(record.path, "remove", GONE_DETAIL);
      return;
    }
    const location = locateRuleBlock(current, record.rule);
    const result = withoutRuleBlock(current, record.rule, { lineEndingAdded: record.lineEndingAdded, created: record.created });
    if (!result.ok) {
      item(record.path, "conflict", result.location);
      return;
    }
    if (result.change === "absent") {
      blocks.delete(key);
      item(record.path, "remove", GONE_DETAIL);
      return;
    }
    hostBytes.set(record.path, result.bytes);
    blocks.delete(key);
    if (result.bytes === null) {
      deleted.add(record.path);
      item(record.path, "remove", `it holds only the ${record.rule} block this installer created`);
    } else if (location.status === "one") {
      item(record.path, "remove", `remove the ${record.rule} block, lines ${location.beginLine}-${location.endLine}`);
    }
  };

  for (const block of [...desired.blocks].sort((a, b) => compare(blockKey(a.host, a.stem), blockKey(b.host, b.stem)))) {
    if (!hostUsable(block.host)) continue;
    const key = blockKey(block.host, block.stem);
    const record = blocks.get(key);
    const result = withRuleBlock(hostNow(block.host), block.section, block.stem);
    if (!result.ok) {
      item(block.host, "conflict", result.location);
      continue;
    }
    const located = locateRuleBlock(hostNow(block.host) ?? Buffer.alloc(0), block.stem);
    const claim = (created: boolean, lineEndingAdded: LineEndingAdded): void => {
      blocks.set(key, {
        path: block.host,
        rule: block.stem,
        created,
        lineEndingAdded,
        clients: addClient(record?.clients, client),
      });
    };
    hostBytes.set(block.host, result.bytes);
    hostChecks.set(block.host, [...(hostChecks.get(block.host) ?? []), { stem: block.stem, section: block.section }]);
    switch (result.change) {
      case "create":
        item(block.host, "create", `a new file holding the ${block.stem} block`);
        claim(true, "");
        break;
      case "insert":
        item(
          block.host,
          "update",
          result.lineEndingAdded === ""
            ? `add the ${block.stem} block at the end`
            : `end the last line, then add the ${block.stem} block at the end`,
        );
        claim(false, result.lineEndingAdded);
        break;
      case "replace":
        item(
          block.host,
          "update",
          located.status === "one"
            ? `replace the ${block.stem} block, lines ${located.beginLine}-${located.endLine}`
            : `replace the ${block.stem} block`,
        );
        claim(record?.created ?? false, record?.lineEndingAdded ?? "");
        break;
      case "unchanged":
        if (record === undefined) item(block.host, "adopt", ADOPT_DETAIL);
        else item(block.host, "unchanged");
        claim(record?.created ?? false, record?.lineEndingAdded ?? "");
        break;
    }
  }

  for (const record of [...blocks.values()].sort((a, b) => compare(blockKey(a.path, a.rule), blockKey(b.path, b.rule)))) {
    if (!record.clients.includes(client)) continue;
    if (action === "install" && desired.blocks.some((b) => b.host === record.path && b.stem === record.rule)) continue;
    if (action === "install") {
      removeBlockRecord(
        record,
        record.clients.filter((other) => other !== client && stillDesiredBlock(other, record.path, record.rule)),
      );
    } else {
      removeBlockRecord(
        record,
        record.clients.filter((other) => other !== client),
      );
    }
  }

  for (const [host, original] of hostOriginal) {
    const final = hostBytes.get(host) ?? null;
    if ((original === null && final === null) || (original !== null && final !== null && original.equals(final))) continue;
    const checks = hostChecks.get(host);
    writes.push({
      rel: host,
      before: original,
      after: final,
      ...(final !== null && checks !== undefined ? { blocks: checks } : {}),
    });
  }

  // Conflicts refuse the whole run: nothing is planned to be written.
  const conflicts = items.filter((entry) => entry.change === "conflict");

  // Directories.
  const createDirs: string[] = [];
  const createSet = new Set<string>();
  const dirConflicts: PlanItem[] = [];
  const manifestWillExist = files.size > 0 || blocks.size > 0;
  if (conflicts.length === 0) {
    const ensureDirs = (rel: string): void => {
      for (const ancestor of ancestorsOf(rel)) {
        if (project.isDirectory(ancestor) || createSet.has(ancestor)) continue;
        if (project.read(ancestor) !== null) {
          dirConflicts.push({
            path: rel,
            change: "conflict",
            detail: `a file is in the way of the directory ${ancestor}; move or delete it, then re-run`,
          });
          return;
        }
        createSet.add(ancestor);
        createDirs.push(ancestor);
      }
    };
    for (const write of writes) {
      if (write.before === null && write.after !== null) ensureDirs(write.rel);
    }
    if (manifestWillExist && manifestBefore === null) ensureDirs(MANIFEST_PATH);
    createDirs.sort((a, b) => a.split("/").length - b.split("/").length || compare(a, b));
  }
  items.push(...dirConflicts);
  conflicts.push(...dirConflicts);

  // Recorded directories that are no longer needed.
  const remainingOwned = [
    ...files.keys(),
    ...[...blocks.values()].map((block) => block.path),
    ...(manifestWillExist ? [MANIFEST_PATH] : []),
  ];
  if (!manifestWillExist && manifestBefore !== null) deleted.add(MANIFEST_PATH);
  const removeSet = new Set<string>();
  const removeDirs: string[] = [];
  const dropped = new Set<string>();
  for (const dir of [...before.dirs].sort((a, b) => b.split("/").length - a.split("/").length || compare(a, b))) {
    if (remainingOwned.some((owned) => owned.startsWith(`${dir}/`))) continue;
    if (!project.isDirectory(dir)) {
      dropped.add(dir);
      continue;
    }
    if (project.listDir !== undefined) {
      const entries = project.listDir(dir);
      if (entries === null) {
        dropped.add(dir);
        continue;
      }
      const empty = entries.every((name) => deleted.has(`${dir}/${name}`) || removeSet.has(`${dir}/${name}`));
      if (!empty) continue;
    }
    removeSet.add(dir);
    removeDirs.push(dir);
  }

  // The manifest.
  const after: PackManifest = {
    schema: 1,
    note: MANIFEST_NOTE,
    files: [...files.values()],
    blocks: [...blocks.values()],
    dirs: [...new Set([...before.dirs, ...createDirs])].filter((dir) => !removeSet.has(dir) && !dropped.has(dir)),
  };
  let manifestAfter: Buffer | null;
  if (!manifestWillExist) {
    manifestAfter = null;
  } else if (manifestBefore !== null && renderManifest(after).equals(renderManifest(before))) {
    manifestAfter = manifestBefore;
  } else {
    manifestAfter = renderManifest(after);
  }
  if (manifestBefore === null && manifestAfter === null) {
    // Nothing to record and nothing recorded.
  } else if (manifestBefore === null) {
    item(MANIFEST_PATH, "create", MANIFEST_DETAIL);
  } else if (manifestAfter === null) {
    item(MANIFEST_PATH, "remove", MANIFEST_DETAIL);
  } else if (manifestAfter.equals(manifestBefore)) {
    item(MANIFEST_PATH, "unchanged", MANIFEST_DETAIL);
  } else {
    item(MANIFEST_PATH, "update", MANIFEST_DETAIL);
  }

  // Notes.
  const notes: string[] = [];
  if (action === "install") {
    if (
      target.id === "claude-code" &&
      ["CLAUDE.md", ".claude/CLAUDE.md", "CLAUDE.local.md"].some((rel) => project.read(rel) !== null)
    ) {
      notes.push(NOTE_CLAUDE_MD);
    }
    if (
      route.rule.kind === "block" &&
      route.rule.host === "AGENTS.md" &&
      hostOriginal.get("AGENTS.md") === null &&
      project.read("CLAUDE.md") !== null
    ) {
      notes.push(firstMatchNote());
    }
    notes.push(...target.notes);
  }

  const sorted = items.sort((a, b) => compare(a.path, b.path));
  const counts: PlanCounts = { create: 0, update: 0, remove: 0, adopt: 0, unchanged: 0, keep: 0, conflict: 0 };
  for (const entry of sorted) counts[entry.change] += 1;

  const refused = conflicts.length > 0;
  return {
    ok: true,
    action,
    client,
    displayName: target.displayName,
    route: route.id,
    installed:
      before.files.some((record) => record.clients.includes(client)) ||
      before.blocks.some((record) => record.clients.includes(client)),
    items: sorted,
    writes: refused ? [] : writes.sort((a, b) => compare(a.rel, b.rel)),
    createDirs: refused ? [] : createDirs,
    removeDirs: refused ? [] : removeDirs,
    manifestBefore,
    manifestAfter: refused ? manifestBefore : manifestAfter,
    observed: [...observed].map(([rel, sha256]) => ({ rel, sha256 })).sort((a, b) => compare(a.rel, b.rel)),
    notes,
    counts,
    conflicts: sorted.filter((entry) => entry.change === "conflict"),
    changes: counts.create + counts.update + counts.remove,
  };
}

// ------------------------------------------------------------------
// Rendering.
// ------------------------------------------------------------------

/** The counts line of a preview. */
export function renderCounts(counts: PlanCounts): string {
  return (
    `${counts.create} to create, ${counts.update} to update, ${counts.remove} to remove, ${counts.adopt} to adopt, ` +
    `${counts.unchanged} unchanged, ${counts.keep} kept, ${counts.conflict} conflict(s).`
  );
}

/** One preview line: the change padded to 9 columns, the path, and the detail in parentheses. */
export function renderPlanItem(entry: PlanItem): string {
  return `  ${entry.change.padEnd(9)} ${entry.path}${entry.detail === undefined ? "" : ` (${entry.detail})`}`;
}

/**
 * The preview of a plan: a header, one line per path, the counts and the notes. It names paths and line numbers
 * only, never the bytes of a user file.
 *
 * @param plan - The plan.
 * @param project - The absolute project path, for the header.
 */
export function renderPlanPreview(plan: PackPlan, project: string): string {
  const lines = [`Skills pack ${plan.action} for ${plan.displayName} in ${project}:`];
  for (const entry of plan.items) lines.push(renderPlanItem(entry));
  lines.push(renderCounts(plan.counts));
  if (plan.notes.length > 0) {
    lines.push("Notes:");
    for (const note of plan.notes) lines.push(`  - ${note}`);
  }
  return `${lines.join("\n")}\n`;
}

// ------------------------------------------------------------------
// The installer payload of each route.
// ------------------------------------------------------------------

export interface InstallerPayload {
  route: PackRouteId;
  /** Every file an install of the route writes into an empty project, in path order. */
  files: Array<{ path: string; bytes: Buffer }>;
}

/**
 * What an install of each route writes into an empty project, computed by the installer's own planner. The
 * provenance check reads it to prove the notice sits beside every installed copy of adapted content.
 *
 * @param packDir - The pack directory (default: the one shipped in this package).
 * @throws {Error} If the pack cannot be loaded or a route cannot be planned.
 */
export function installerPayloads(packDir: string = DEFAULT_PACK_DIR): InstallerPayload[] {
  const loaded = loadPack(packDir);
  if (!loaded.ok) throw new Error(loaded.message);
  const empty: ProjectView = { read: () => null, isDirectory: () => false };
  return PACK_ROUTE_IDS.map((route) => {
    const plan = planPackChange({ action: "install", client: route, includeModified: false, pack: loaded.pack, project: empty });
    if (!plan.ok) throw new Error(`${route}: ${plan.message}`);
    if (plan.conflicts.length > 0) throw new Error(`${route}: the plan has a conflict`);
    const files: Array<{ path: string; bytes: Buffer }> = [];
    for (const write of plan.writes) {
      if (write.after !== null) files.push({ path: write.rel, bytes: write.after });
    }
    if (plan.manifestAfter !== null) files.push({ path: MANIFEST_PATH, bytes: plan.manifestAfter });
    files.sort((a, b) => compare(a.path, b.path));
    return { route, files };
  });
}
