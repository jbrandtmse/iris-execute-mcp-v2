/**
 * Story 39.6 (DW-573, AC-5; AD-15, AD-2) - the `tools/list` snapshot, in the default suite (no IRIS).
 *
 * `fixtures/tools-list-snapshot.json` pins the `title`, `description`, `inputSchema`, `annotations` (and
 * `outputSchema` when present) of every tool of the five built servers under preset `full`. This file imports
 * the SAME core as the CLI `scripts/gen-tools-list-snapshot.mjs` (`scripts/lib/tools-list-snapshot-core.mjs`),
 * so the two agree on one tree. Placement (Rule #45): `@iris-mcp/all` is the only package that sees every
 * server's built dist.
 *
 * The check is ONE-DIRECTIONAL: every snapshot entry must still be listed and deep-equal after a sorted-key
 * canonicalization; a live tool the snapshot lacks is reported in `added` and allowed. A stale or missing dist
 * fails the live describe with the rebuild reason: a check over stale output proves nothing.
 *
 * Four groups:
 *  - the committed file: shape, generator-exact text, pinned fields only, the framework tool identical on all
 *    five servers, and a per-server floor so a regenerate over a dist missing tools cannot shrink the pin;
 *  - the live capture of the built dists compared with the committed file (and the capture under a hostile
 *    `IRIS_TOOLS_*` environment, which must still list every tool);
 *  - `compareSnapshot` / `assertSnapshotShape` / `canonicalize` / `serializeSnapshot` / `staleDists` on
 *    SYNTHETIC inputs, one row per outcome of the intent contract's Snapshot rows;
 *  - the CLI as a spawned process: no flag refuses (exit 2, nothing written), `--check` on this tree exits 0,
 *    and a tree whose dist is older than its `src/` exits 2 with "rebuild" for both flags.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  ENTRY_FIELDS,
  SNAPSHOT_RELATIVE_PATH,
  assertSnapshotShape,
  canonicalize,
  captureToolsList,
  compareSnapshot,
  readSnapshot,
  serializeSnapshot,
  staleDistMessage,
  staleDists,
} from "../../../../scripts/lib/tools-list-snapshot-core.mjs";
import { SERVER_PACKAGES } from "../../../../scripts/lib/tool-catalog.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..", "..");
const SNAPSHOT_FILE = path.join(REPO_ROOT, SNAPSHOT_RELATIVE_PATH);
const CLI = path.join(REPO_ROOT, "scripts", "gen-tools-list-snapshot.mjs");

/** The entries each server listed when the snapshot was first written (Story 39.6): a regenerate may not pin fewer. */
const ENTRY_FLOOR: Record<string, number> = {
  "iris-dev-mcp": 33,
  "iris-admin-mcp": 27,
  "iris-interop-mcp": 25,
  "iris-ops-mcp": 22,
  "iris-data-mcp": 8,
};
const FRAMEWORK_TOOL = "iris_server_profiles";

interface Entry {
  title: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
}
type Servers = Record<string, Record<string, Entry>>;
interface Snapshot {
  comment?: string;
  capturedAt?: string;
  sdkVersion?: string;
  zodVersion?: string;
  entryCount: number;
  servers: Servers;
}

/** One entry with a nested schema, so a deep path has something to point at. */
function sampleEntry(label: string): Entry {
  return {
    title: `Tool ${label}`,
    description: `Does ${label} work. Takes edits.`,
    inputSchema: {
      type: "object",
      properties: {
        server: { type: "string" },
        edits: { type: "array", items: { type: "object", properties: { text: { type: "string" } }, required: ["text", "line"] } },
      },
      required: ["edits"],
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  };
}

/** A well-formed snapshot over the five server packages, two tools each, with a consistent `entryCount`. */
function sampleSnapshot(): Snapshot {
  const servers: Servers = {};
  for (const pkg of SERVER_PACKAGES as string[]) {
    servers[pkg] = { tool_a: sampleEntry(`${pkg}-a`), tool_b: sampleEntry(`${pkg}-b`), [FRAMEWORK_TOOL]: sampleEntry("framework") };
  }
  return { entryCount: 15, servers };
}

function cloneSnapshot(snapshot: Snapshot): Snapshot {
  return JSON.parse(JSON.stringify(snapshot)) as Snapshot;
}

/** The synthetic live capture for a snapshot: the same servers, edited by `edit`. */
function liveWith(snapshot: Snapshot, edit: (servers: Servers) => void): { servers: Servers } {
  const copy = cloneSnapshot(snapshot);
  edit(copy.servers);
  return { servers: copy.servers };
}

describe("the committed tools/list snapshot (Story 39.6, DW-573)", () => {
  const committed = readSnapshot(REPO_ROOT) as Snapshot;

  it("passes the shape check and carries a provenance header", () => {
    expect(() => assertSnapshotShape(committed)).not.toThrow();
    expect(committed.comment).toContain("never edit by hand");
    expect(committed.capturedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    expect(committed.sdkVersion).toMatch(/^\d+\.\d+\.\d+/);
    expect(committed.zodVersion).toMatch(/^\d+\.\d+\.\d+/);
  });

  it("is the generator's own output: sorted keys, 2-space JSON, ASCII, one trailing newline", () => {
    const text = readFileSync(SNAPSHOT_FILE, "utf8");
    expect(text).toBe(serializeSnapshot(JSON.parse(text)));
    expect(JSON.stringify(committed.servers)).toBe(JSON.stringify(canonicalize(committed.servers)));
    // eslint-disable-next-line no-control-regex
    expect(/[^\x00-\x7f]/.test(text)).toBe(false);
  });

  it("holds every server package, never fewer entries than the first snapshot, and entryCount equals the entries", () => {
    let counted = 0;
    for (const pkg of SERVER_PACKAGES as string[]) {
      const size = Object.keys(committed.servers[pkg] ?? {}).length;
      expect(size, `${pkg} entries`).toBeGreaterThanOrEqual(ENTRY_FLOOR[pkg] as number);
      counted += size;
    }
    expect(committed.entryCount).toBe(counted);
    expect(counted).toBeGreaterThanOrEqual(115);
  });

  it("pins the tool-owned fields only: no name, execution or _meta member in any entry", () => {
    const allowed = new Set<string>(ENTRY_FIELDS as string[]);
    for (const [pkg, tools] of Object.entries(committed.servers)) {
      for (const [name, entry] of Object.entries(tools)) {
        expect(Object.keys(entry).filter((key) => !allowed.has(key)), `${pkg} ${name}`).toEqual([]);
      }
    }
  });

  it(`${FRAMEWORK_TOOL} is identical on all five servers`, () => {
    const canonical = (SERVER_PACKAGES as string[]).map((pkg) => JSON.stringify(canonicalize(committed.servers[pkg]?.[FRAMEWORK_TOOL])));
    expect(canonical[0]).toBeDefined();
    expect(new Set(canonical).size).toBe(1);
  });
});

describe("the live tools/list of the built dists against the committed snapshot (AC-5)", () => {
  let live: Snapshot;
  const committed = readSnapshot(REPO_ROOT) as Snapshot;

  beforeAll(async () => {
    const stale = staleDists(REPO_ROOT);
    if (stale.length > 0) throw new Error(staleDistMessage(stale));
    live = (await captureToolsList(REPO_ROOT)) as Snapshot;
  });

  it("has no problems: every snapshot entry is still listed and deep-equal", () => {
    const { problems } = compareSnapshot(committed, live);
    expect(problems, problems.join("\n")).toEqual([]);
  });

  it("reports exactly the live tools the snapshot does not list as added", () => {
    const { added } = compareSnapshot(committed, live);
    const expected = (SERVER_PACKAGES as string[])
      .flatMap((pkg) =>
        Object.keys(live.servers[pkg] ?? {})
          .filter((tool) => committed.servers[pkg]?.[tool] === undefined)
          .map((tool) => `${pkg} ${tool}`),
      )
      .sort();
    expect([...added].sort()).toEqual(expected);
  });

  it(`${FRAMEWORK_TOOL} is identical on all five live servers`, () => {
    const canonical = (SERVER_PACKAGES as string[]).map((pkg) => JSON.stringify(canonicalize(live.servers[pkg]?.[FRAMEWORK_TOOL])));
    expect(canonical[0]).toBeDefined();
    expect(new Set(canonical).size).toBe(1);
  });

  it("captures preset full whatever IRIS_TOOLS_* holds, and restores those variables", async () => {
    const keys = ["IRIS_TOOLS_PRESET", "IRIS_TOOLS_DISABLE", "IRIS_TOOLS_ENABLE"] as const;
    const saved = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
    process.env.IRIS_TOOLS_PRESET = "core";
    process.env.IRIS_TOOLS_DISABLE = "iris_doc_get";
    process.env.IRIS_TOOLS_ENABLE = "iris_doc_get";
    try {
      const hostile = (await captureToolsList(REPO_ROOT)) as Snapshot;
      expect(process.env.IRIS_TOOLS_PRESET).toBe("core");
      expect(process.env.IRIS_TOOLS_DISABLE).toBe("iris_doc_get");
      expect(process.env.IRIS_TOOLS_ENABLE).toBe("iris_doc_get");
      expect(hostile.entryCount).toBe(live.entryCount);
      expect(hostile.servers["iris-dev-mcp"]?.iris_doc_get).toBeDefined();
      expect(compareSnapshot(committed, hostile).problems).toEqual([]);
    } finally {
      for (const key of keys) {
        if (saved[key] === undefined) delete process.env[key];
        else process.env[key] = saved[key];
      }
    }
  });
});

describe("compareSnapshot and assertSnapshotShape on synthetic inputs (Snapshot rows)", () => {
  const base = sampleSnapshot();

  it("match: an identical live capture has no problems and adds nothing", () => {
    expect(compareSnapshot(base, liveWith(base, () => undefined))).toEqual({ problems: [], added: [] });
  });

  it("match: member order does not matter (sorted-key canonicalization), array order does", () => {
    const reordered = liveWith(base, (servers) => {
      const entry = servers["iris-dev-mcp"]!.tool_a!;
      servers["iris-dev-mcp"]!.tool_a = { annotations: entry.annotations, inputSchema: entry.inputSchema, description: entry.description, title: entry.title };
    });
    expect(compareSnapshot(base, reordered).problems).toEqual([]);

    const swapped = liveWith(base, (servers) => {
      (servers["iris-dev-mcp"]!.tool_a!.inputSchema.properties as Record<string, { items: { required: string[] } }>).edits!.items.required.reverse();
    });
    const { problems } = compareSnapshot(base, swapped);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/^iris-dev-mcp tool_a\.inputSchema differs at \$\.inputSchema\.properties\.edits\.items\.required\[0\] \(character 0\): snapshot "text" \/ live "line"$/);
  });

  it("drift: one changed description character names <pkg> <tool>.description and the character index", () => {
    const original = base.servers["iris-ops-mcp"]!.tool_b!.description;
    const live = liveWith(base, (servers) => {
      servers["iris-ops-mcp"]!.tool_b!.description = `${original.slice(0, 9)}X${original.slice(10)}`;
    });
    const { problems, added } = compareSnapshot(base, live);
    expect(added).toEqual([]);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/^iris-ops-mcp tool_b\.description differs at \$\.description \(character 9\): snapshot "[^"]*"(\.\.\.)? \/ live "[^"]*X[^"]*"(\.\.\.)?$/);
  });

  it("drift: a changed title, annotation and a deep nested schema member each name their field and first differing path", () => {
    const live = liveWith(base, (servers) => {
      const entry = servers["iris-data-mcp"]!.tool_a!;
      entry.title = "Renamed";
      entry.annotations.destructiveHint = true;
      ((entry.inputSchema.properties as Record<string, { items: { properties: { text: { type: string } } } }>).edits!.items.properties.text).type = "number";
    });
    const { problems } = compareSnapshot(base, live);
    expect(problems).toEqual([
      expect.stringMatching(/^iris-data-mcp tool_a\.title differs at \$\.title \(character 0\): /),
      expect.stringMatching(/^iris-data-mcp tool_a\.inputSchema differs at \$\.inputSchema\.properties\.edits\.items\.properties\.text\.type \(character 0\): snapshot "string" \/ live "number"$/),
      expect.stringMatching(/^iris-data-mcp tool_a\.annotations differs at \$\.annotations\.destructiveHint: snapshot false \/ live true$/),
    ]);
  });

  it("drift: an ADDITIVE change to a listed entry (a new schema property, an outputSchema) is a problem too", () => {
    const live = liveWith(base, (servers) => {
      const entry = servers["iris-admin-mcp"]!.tool_a!;
      (entry.inputSchema.properties as Record<string, unknown>).extra = { type: "string" };
      entry.outputSchema = { type: "object" };
    });
    const { problems } = compareSnapshot(base, live);
    expect(problems).toEqual([
      expect.stringMatching(/^iris-admin-mcp tool_a\.inputSchema differs at \$\.inputSchema\.properties\.extra: snapshot \(absent\) \/ live \{"type":"string"\}$/),
      expect.stringMatching(/^iris-admin-mcp tool_a\.outputSchema differs at \$\.outputSchema: snapshot \(absent\) \/ live \{"type":"object"\}$/),
    ]);
  });

  it("new tool: a live tool the snapshot lacks is reported in added and passes", () => {
    const live = liveWith(base, (servers) => {
      servers["iris-interop-mcp"]!.tool_new = sampleEntry("new");
    });
    expect(compareSnapshot(base, live)).toEqual({ problems: [], added: ["iris-interop-mcp tool_new"] });
  });

  it("vanished tool: a snapshot entry the live capture lacks fails, naming the package and tool", () => {
    const live = liveWith(base, (servers) => {
      delete servers["iris-dev-mcp"]!.tool_b;
    });
    const { problems } = compareSnapshot(base, live);
    expect(problems).toEqual(["iris-dev-mcp tool_b vanished: the snapshot lists it, the live tools/list does not."]);
  });

  it("vanished server: a live capture without a package fails every one of its entries", () => {
    const live = liveWith(base, (servers) => {
      delete servers["iris-data-mcp"];
    });
    const { problems } = compareSnapshot(base, live);
    expect(problems).toHaveLength(3);
    expect(problems.every((line) => line.startsWith("iris-data-mcp ") && line.includes(" vanished"))).toBe(true);
  });

  it("an empty live capture fails every entry", () => {
    expect(compareSnapshot(base, { servers: {} }).problems).toHaveLength(15);
  });

  it("assertSnapshotShape rejects an empty snapshot, a missing package, an empty package, a wrong count and a malformed entry", () => {
    expect(() => assertSnapshotShape({ entryCount: 0, servers: {} })).toThrow(/no entries for the server package iris-dev-mcp/);
    expect(() => assertSnapshotShape({})).toThrow(/not an object with a "servers" object/);
    expect(() => assertSnapshotShape(null)).toThrow(/not an object/);

    const missing = cloneSnapshot(base);
    delete missing.servers["iris-ops-mcp"];
    missing.entryCount = 12;
    expect(() => assertSnapshotShape(missing)).toThrow(/no entries for the server package iris-ops-mcp/);

    const hollow = cloneSnapshot(base);
    hollow.servers["iris-data-mcp"] = {};
    hollow.entryCount = 12;
    expect(() => assertSnapshotShape(hollow)).toThrow(/iris-data-mcp lists no tools/);

    expect(() => assertSnapshotShape({ ...base, entryCount: 14 })).toThrow(/entryCount is 14 but the servers hold 15 entries/);

    const noDescription = cloneSnapshot(base);
    delete (noDescription.servers["iris-dev-mcp"]!.tool_a as Partial<Entry>).description;
    expect(() => assertSnapshotShape(noDescription)).toThrow(/iris-dev-mcp tool_a has no description/);

    expect(() => assertSnapshotShape(base)).not.toThrow();
  });

  it("compareSnapshot never passes an untrustworthy snapshot: an empty or incomplete one yields a problem and no added", () => {
    const live = liveWith(base, () => undefined);
    for (const snapshot of [{ entryCount: 0, servers: {} }, {}, null]) {
      const result = compareSnapshot(snapshot as unknown as Snapshot, live);
      expect(result.problems).toHaveLength(1);
      expect(result.problems[0]).toContain("tools/list snapshot is invalid");
      expect(result.added).toEqual([]);
    }
    const missing = cloneSnapshot(base);
    delete missing.servers["iris-dev-mcp"];
    missing.entryCount = 12;
    expect(compareSnapshot(missing, live).problems[0]).toContain("iris-dev-mcp");
  });
});

describe("canonicalize and serializeSnapshot", () => {
  it("canonicalize sorts every object's keys, keeps array order and drops undefined members", () => {
    const value = canonicalize({ b: 1, a: { d: [3, { z: 1, y: undefined, x: 2 }], c: null } });
    expect(JSON.stringify(value)).toBe('{"a":{"c":null,"d":[3,{"x":2,"z":1}]},"b":1}');
  });

  it("serializeSnapshot writes ASCII 2-space JSON with one trailing newline that parses back unchanged", () => {
    const document = { text: "dash \u2014 arrow \u2192 emoji \ud83d\ude00 del \u007f", nested: { a: [1] } };
    const text = serializeSnapshot(document);
    // eslint-disable-next-line no-control-regex
    expect(/[^\x00-\x7e]/.test(text.replace(/\n$/, ""))).toBe(false);
    expect(text.endsWith("}\n")).toBe(true);
    expect(text).toContain('\n  "text": "dash \\u2014 arrow \\u2192 emoji \\ud83d\\ude00 del \\u007f"');
    expect(JSON.parse(text)).toEqual(document);
  });
});

/** A throwaway repository tree whose six dists exist and are fresh, except the packages in `staleNames`. */
function buildTree(root: string, staleNames: string[]) {
  const manifestNames: Record<string, string> = {
    shared: "@iris-mcp/shared",
    "iris-dev-mcp": "@iris-mcp/dev",
    "iris-admin-mcp": "@iris-mcp/admin",
    "iris-interop-mcp": "@iris-mcp/interop",
    "iris-ops-mcp": "@iris-mcp/ops",
    "iris-data-mcp": "@iris-mcp/data",
  };
  const older = new Date("2026-01-01T00:00:00Z");
  const newer = new Date("2026-01-02T00:00:00Z");
  for (const [pkg, name] of Object.entries(manifestNames)) {
    const dir = path.join(root, "packages", pkg);
    mkdirSync(path.join(dir, "dist"), { recursive: true });
    mkdirSync(path.join(dir, "src"), { recursive: true });
    writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name, version: "0.0.0", files: ["dist"] }), "utf8");
    writeFileSync(path.join(dir, "dist", "index.js"), "export {};\n", "utf8");
    writeFileSync(path.join(dir, "src", "index.ts"), "export {};\n", "utf8");
    const stale = staleNames.includes(pkg);
    utimesSync(path.join(dir, "src", "index.ts"), stale ? newer : older, stale ? newer : older);
    utimesSync(path.join(dir, "dist", "index.js"), stale ? older : newer, stale ? older : newer);
  }
}

describe("a stale or missing dist fails with the rebuild reason (Snapshot, stale dist or no flag)", () => {
  let scratch = "";
  beforeAll(() => {
    scratch = mkdtempSync(path.join(tmpdir(), "tools-list-snapshot-"));
  });
  afterAll(() => {
    if (scratch) rmSync(scratch, { recursive: true, force: true });
  });

  it("staleDists is empty for fresh dists and names exactly the package whose src/ is newer than its dist/", () => {
    const fresh = path.join(scratch, "fresh");
    buildTree(fresh, []);
    expect(staleDists(fresh)).toEqual([]);

    const dirty = path.join(scratch, "dirty");
    buildTree(dirty, ["iris-dev-mcp"]);
    const stale = staleDists(dirty);
    expect(stale.map((entry) => entry.pkg)).toEqual(["iris-dev-mcp"]);
    expect(stale[0]?.command).toBe("pnpm --filter @iris-mcp/dev build");
    const message = staleDistMessage(stale);
    expect(message).toContain("rebuild");
    expect(message).toContain("iris-dev-mcp");
    expect(message).toContain("pnpm --filter @iris-mcp/dev build");
  });

  it("a missing dist/ is stale too", () => {
    const missing = path.join(scratch, "missing");
    buildTree(missing, []);
    rmSync(path.join(missing, "packages", "iris-ops-mcp", "dist"), { recursive: true, force: true });
    expect(staleDists(missing).map((entry) => entry.pkg)).toEqual(["iris-ops-mcp"]);
  });

  it("the CLI exits 2 naming the package and 'rebuild' for --check and --force on a stale tree, and writes nothing", () => {
    const tree = path.join(scratch, "cli-tree");
    buildTree(tree, ["iris-interop-mcp"]);
    mkdirSync(path.join(tree, "scripts", "lib"), { recursive: true });
    copyFileSync(CLI, path.join(tree, "scripts", "gen-tools-list-snapshot.mjs"));
    for (const name of ["tools-list-snapshot-core.mjs", "dist-freshness.mjs", "measure-tools-payload-core.mjs", "tool-catalog.mjs"]) {
      copyFileSync(path.join(REPO_ROOT, "scripts", "lib", name), path.join(tree, "scripts", "lib", name));
    }
    for (const flag of ["--check", "--force"]) {
      const result = spawnSync(process.execPath, [path.join(tree, "scripts", "gen-tools-list-snapshot.mjs"), flag], { encoding: "utf8", cwd: scratch, timeout: 60000 });
      expect(result.error, "the CLI started").toBeUndefined();
      expect(result.status, `${flag}: ${result.stderr}`).toBe(2);
      expect(result.stderr).toContain("rebuild");
      expect(result.stderr).toContain("iris-interop-mcp");
      expect(result.stderr).toContain("pnpm --filter @iris-mcp/interop build");
      expect(result.stderr).not.toContain("iris-dev-mcp");
      expect(existsSync(path.join(tree, SNAPSHOT_RELATIVE_PATH))).toBe(false);
    }
  });
});

describe("the CLI as a spawned process on this tree", () => {
  it("the root package.json scripts run this CLI: bare for the guarded regenerate, with --check for the check", () => {
    const scripts = (JSON.parse(readFileSync(path.join(REPO_ROOT, "package.json"), "utf8")) as { scripts: Record<string, string> }).scripts;
    expect(scripts["gen:tools-list-snapshot"]).toBe("node scripts/gen-tools-list-snapshot.mjs");
    expect(scripts["gen:tools-list-snapshot:check"]).toBe("node scripts/gen-tools-list-snapshot.mjs --check");
  });

  function runCli(args: string[]) {
    const result = spawnSync(process.execPath, [CLI, ...args], { encoding: "utf8", cwd: tmpdir(), timeout: 120000 });
    expect(result.error, "the CLI started").toBeUndefined();
    return result;
  }

  it("refuses without a flag, with an unknown flag and with both flags: exit 2, and the snapshot is untouched", () => {
    const before = readFileSync(SNAPSHOT_FILE);
    const mtime = statSync(SNAPSHOT_FILE).mtimeMs;
    for (const args of [[], ["--write"], ["--check", "--force"]]) {
      const result = runCli(args);
      expect(result.status, `${args.join(" ")}: ${result.stderr}`).toBe(2);
      expect(result.stderr).toContain("REFUSING");
      expect(result.stderr).toContain("nothing was written");
    }
    expect(readFileSync(SNAPSHOT_FILE).equals(before)).toBe(true);
    expect(statSync(SNAPSHOT_FILE).mtimeMs).toBe(mtime);
  });

  it("--check on the committed snapshot exits 0 with the OK line and writes nothing", () => {
    const before = readFileSync(SNAPSHOT_FILE);
    const mtime = statSync(SNAPSHOT_FILE).mtimeMs;
    const stale = staleDists(REPO_ROOT);
    if (stale.length > 0) throw new Error(staleDistMessage(stale));
    const committed = readSnapshot(REPO_ROOT) as Snapshot;

    const result = runCli(["--check"]);

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain(`OK - every one of the ${committed.entryCount} snapshot entries is still listed, unchanged.`);
    expect(readFileSync(SNAPSHOT_FILE).equals(before)).toBe(true);
    expect(statSync(SNAPSHOT_FILE).mtimeMs).toBe(mtime);
  });
});
