/**
 * Story 44.4 QA (AC 44.4.8) -- gaps left by `story-43-4-sanctioned-golden-changes.test.ts` in the golden ledger's `startup` section
 * (`scripts/lib/golden-sanctioned-changes.mjs`).
 *
 * That file pins a valid insert, the common refusals (an index past the end, a bad `new`, an `old`, a replace or remove, an insert
 * elsewhere) and a three-insert run on one server. This file adds:
 *
 * - every other way a `startup` pointer can be wrong (a negative, leading-zero, fractional, exponent, signed, empty or oversized
 *   index, an empty token, an invalid escape), each refusal naming its entry id;
 * - the interaction of several inserts on one server: file order decides the result and the range check (an index is counted after
 *   the earlier entries), two inserts at one index stack, two entries may carry the same request, and nothing is aliased to the entry;
 * - inserts for several servers mixed in one ledger: each server counts only its own inserts;
 * - a startup insert next to a row change and an audit change on the same server: none moves the other, in either order;
 * - a refusal part-way through a run applies nothing and leaves the input golden untouched.
 *
 * Needs no IRIS and no built dist: it reads the frozen handler golden only.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { REPO_ROOT } from "./pack-fixture";
import { HANDLER_GOLDEN_RELATIVE_PATH } from "../../../../scripts/lib/sdk-handler-golden-core.mjs";
import { applySanctionedChanges, validateSanctionedChanges } from "../../../../scripts/lib/golden-sanctioned-changes.mjs";

interface HandlerGolden {
  servers: Record<string, { startup: Array<{ method: string; url: string; body: string }>; rows: Array<{ label: string; line: string }>; audit: Array<Record<string, unknown>> }>;
}

type Entry = Record<string, unknown>;

const frozen = JSON.parse(readFileSync(path.join(REPO_ROOT, HANDLER_GOLDEN_RELATIVE_PATH), "utf8")) as HandlerGolden;
const ADMIN = "iris-admin-mcp";
const OPS = "iris-ops-mcp";

const insert = (id: string, pointer: string, request: { method: string; url: string; body: string }, server = ADMIN): Entry => ({
  id,
  sanction: "S-44.4-current-check",
  story: "44.4",
  golden: "handler",
  server,
  section: "startup",
  pointer,
  op: "insert",
  new: request,
});

const req = (url: string, method = "GET", body = ""): { method: string; url: string; body: string } => ({ method, url, body });
const apply = (entries: Entry[], golden: HandlerGolden = frozen): HandlerGolden => applySanctionedChanges(structuredClone(golden), "handler", entries) as HandlerGolden;
const validate = (entries: Entry[]): unknown => validateSanctionedChanges({ description: "d", changes: entries });
const startupOf = (golden: HandlerGolden, server: string): unknown[] => golden.servers[server]!.startup;

describe("Story 44.4 QA, AC 44.4.8: a startup pointer must be /<canonical index>, and every refusal names its entry", () => {
  const notAnIndex = ["/-1", "/01", "/00", "/1.5", "/1e0", "/+1", "/ 1", "/0x1", "/", "/1/", "//1", "/１"];

  for (const pointer of notAnIndex) {
    it(`${JSON.stringify(pointer)} is refused by the schema check, naming the entry`, () => {
      expect(() => validate([insert("t/pointer", pointer, req("/x"))])).toThrow(/^Sanctioned change 't\/pointer': a 'startup' pointer must be \/<index>/);
      // Behind a good entry, the refusal still names the bad one.
      expect(() => validate([insert("t/ok", "/0", req("/x")), insert("t/pointer", pointer, req("/x"))])).toThrow(/^Sanctioned change 't\/pointer'/);
    });
  }

  it("an empty pointer and an invalid escape are refused as pointers, naming the entry", () => {
    expect(() => validate([insert("t/empty", "", req("/x"))])).toThrow(/^Sanctioned change 't\/empty': pointer must be an RFC 6901 pointer starting with "\/"/);
    expect(() => validate([insert("t/escape", "/~2", req("/x"))])).toThrow(/^Sanctioned change 't\/escape': pointer must be an RFC 6901 pointer starting with "\/"/);
    expect(() => validate([insert("t/nopointer", "6", req("/x"))])).toThrow(/^Sanctioned change 't\/nopointer': pointer must be an RFC 6901 pointer/);
  });

  it("a canonical index of any size passes the schema and is refused by the loader as out of range, naming the entry", () => {
    for (const pointer of ["/99", "/1000000", "/99999999999999999999"]) {
      expect(validate([insert("t/far", pointer, req("/x"))])).toHaveLength(1);
      expect(() => apply([insert("t/far", pointer, req("/x"))])).toThrow(/^Sanctioned change 't\/far': index \S+ is out of range: the startup array of iris-admin-mcp holds 6 requests at this point\./);
    }
  });

  it("a startup entry with a bad new or an old names itself even when it is the last of several good entries", () => {
    const good = [insert("t/a", "/0", req("/a")), insert("t/b", "/1", req("/b"))];
    expect(() => validate([...good, { ...insert("t/last", "/2", req("/c")), new: { method: "GET", url: "/c", body: "", extra: true } }])).toThrow(/^Sanctioned change 't\/last': new must be exactly/);
    expect(() => validate([...good, { ...insert("t/last", "/2", req("/c")), old: req("/c") }])).toThrow(/^Sanctioned change 't\/last': an 'insert' change has no old/);
    expect(() => validate([...good, insert("t/a", "/2", req("/c"))])).toThrow(/^Sanctioned change 't\/a': id is not unique\./);
  });
});

describe("Story 44.4 QA, AC 44.4.8: several inserts on one server apply in file order", () => {
  const f = frozen.servers[ADMIN]!.startup;

  it("two inserts at one index stack: the later entry lands in front of the earlier one", () => {
    const a = req("/a");
    const b = req("/b");

    const sanctioned = apply([insert("t/a", "/2", a), insert("t/b", "/2", b)]);

    expect(startupOf(sanctioned, ADMIN)).toEqual([f[0], f[1], b, a, f[2], f[3], f[4], f[5]]);
  });

  it("a later entry may insert in front of an earlier one's index (descending indexes), and the earlier request is shifted, not lost", () => {
    const a = req("/a");
    const b = req("/b");

    const sanctioned = apply([insert("t/a", "/6", a), insert("t/b", "/0", b)]);

    expect(startupOf(sanctioned, ADMIN)).toEqual([b, ...f, a]);
  });

  it("the range check counts the earlier entries: the same two entries are valid in one order and refused in the other", () => {
    const first = insert("t/first", "/6", req("/first"));
    const second = insert("t/second", "/7", req("/second"));

    expect(startupOf(apply([first, second]), ADMIN)).toEqual([...f, req("/first"), req("/second")]);
    expect(() => apply([second, first])).toThrow(/^Sanctioned change 't\/second': index 7 is out of range: the startup array of iris-admin-mcp holds 6 requests at this point\./);
  });

  it("two entries may carry the same request (the same HEAD twice): both land, as separate elements", () => {
    const head = { method: "HEAD", url: "/api/atelier/", body: "" };

    const sanctioned = apply([insert("t/a", "/6", head), insert("t/b", "/7", head)]);

    const startup = startupOf(sanctioned, ADMIN) as Array<typeof head>;
    expect(startup.slice(6)).toEqual([head, head]);
    startup[6]!.url = "/mutated";
    expect(startup[7]!.url, "the two inserted elements are not one object").toBe("/api/atelier/");
  });

  it("the inserted request is a copy: changing the result changes neither the entry nor the input golden, and the entry is not changed by applying it", () => {
    const entry = insert("t/a", "/6", req("/a"));
    const entryBefore = structuredClone(entry);
    const input = structuredClone(frozen);

    const sanctioned = applySanctionedChanges(input, "handler", [entry]) as HandlerGolden;
    (startupOf(sanctioned, ADMIN)[6] as { url: string }).url = "/mutated";

    expect(entry).toEqual(entryBefore);
    expect((entry.new as { url: string }).url).toBe("/a");
    expect(input, "the golden that was passed in is untouched").toEqual(frozen);
  });

  it("a refusal part-way through a run returns nothing, and the golden that was passed in is untouched", () => {
    const input = structuredClone(frozen);

    expect(() => applySanctionedChanges(input, "handler", [insert("t/a", "/6", req("/a")), insert("t/b", "/7", req("/b")), insert("t/bad", "/9", req("/c"))])).toThrow(
      /^Sanctioned change 't\/bad': index 9 is out of range: .* holds 8 requests/,
    );

    expect(input).toEqual(frozen);
  });
});

describe("Story 44.4 QA, AC 44.4.8: startup inserts of several servers in one ledger", () => {
  const admin = frozen.servers[ADMIN]!.startup;
  const ops = frozen.servers[OPS]!.startup;

  it("each server counts only its own inserts, whatever the order of the ledger", () => {
    const entries = [
      insert("t/a1", "/6", req("/a1"), ADMIN),
      insert("t/o1", "/6", req("/o1"), OPS),
      insert("t/a2", "/7", req("/a2"), ADMIN),
      insert("t/o2", "/7", req("/o2"), OPS),
      insert("t/a3", "/0", req("/a3"), ADMIN),
    ];

    const sanctioned = apply(entries);

    expect(startupOf(sanctioned, ADMIN)).toEqual([req("/a3"), ...admin, req("/a1"), req("/a2")]);
    expect(startupOf(sanctioned, OPS)).toEqual([...ops, req("/o1"), req("/o2")]);
    for (const server of Object.keys(frozen.servers)) {
      if (server !== ADMIN && server !== OPS) expect(sanctioned.servers[server], server).toEqual(frozen.servers[server]);
    }
    // The same entries with the servers' entries grouped give the same golden.
    expect(apply([entries[0]!, entries[2]!, entries[4]!, entries[1]!, entries[3]!])).toEqual(sanctioned);
  });

  it("an index that is valid for one server is refused for another that has fewer inserts, and the refusal names the entry and the other server's count", () => {
    const entries = [insert("t/a1", "/6", req("/a1"), ADMIN), insert("t/a2", "/7", req("/a2"), ADMIN), insert("t/o", "/7", req("/o"), OPS)];

    expect(() => apply(entries)).toThrow(/^Sanctioned change 't\/o': index 7 is out of range: the startup array of iris-ops-mcp holds 6 requests at this point\./);
  });
});

describe("Story 44.4 QA, AC 44.4.8: a startup insert moves nothing else on its server, whatever the order of the ledger", () => {
  const rowEntry: Entry = {
    id: "t/row",
    sanction: "S-43.4-descriptions",
    story: "43.4",
    golden: "handler",
    server: ADMIN,
    label: "namespace-list",
    pointer: "/result/structuredContent/count",
    op: "replace",
    old: 2,
    new: 3,
  };
  const auditEntry: Entry = {
    id: "t/audit",
    sanction: "S-42.10-audit-namespace",
    story: "42.10",
    golden: "handler",
    server: ADMIN,
    section: "audit",
    pointer: "/1/namespace",
    op: "replace",
    old: "HSCUSTOM",
    new: "%SYS",
  };
  const startEntry = insert("t/start", "/3", req("/start"));

  it("a row change, an audit change and a startup insert give the same golden in every order, and each changes only its own section", () => {
    const inOrder = apply([rowEntry, auditEntry, startEntry]);
    for (const order of [
      [startEntry, rowEntry, auditEntry],
      [auditEntry, startEntry, rowEntry],
      [startEntry, auditEntry, rowEntry],
    ]) {
      expect(apply(order)).toEqual(inOrder);
    }

    const before = frozen.servers[ADMIN]!;
    const after = inOrder.servers[ADMIN]!;
    expect(after.startup).toEqual([before.startup[0], before.startup[1], before.startup[2], req("/start"), before.startup[3], before.startup[4], before.startup[5]]);
    expect(after.rows.map((row) => row.label)).toEqual(before.rows.map((row) => row.label));
    expect(after.rows.filter((row, index) => row.line !== before.rows[index]!.line).map((row) => row.label)).toEqual(["namespace-list"]);
    expect(after.audit[1]!["namespace"]).toBe("%SYS");
    expect(after.audit.length).toBe(before.audit.length);
  });
});
