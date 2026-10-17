/**
 * Story 39.5: `iris_message_body` (AD-26, AD-9, AD-11, AD-19, AD-4, AD-7).
 *
 * Mocked HTTP; every fake reply has the shape the live route returns (pinned to a capture of
 * `POST /interop/message/body` against the Story 39.5 fixture, Rule #54), and every redacted expectation is
 * pinned by running the engine on the fixture text (Rule #36):
 * `node --input-type=module -e 'import { redactHl7 } from "@iris-mcp/shared"; ...'` from this package, on the
 * built shared dist of Story 39.5. Pins the definition and schema bounds, the wire per policy and per tighten
 * case, every row of the per-body policy table, redaction before sanitization and truncation, the
 * sanitization rules, the surrogate-safe cut, `notApplicable`, not-found items, the `IrisApiError` text, and
 * that no `SYNTHPHI` value appears in any `redact` or `block` result. The same rows run live in
 * `story-39-5-body-reader-live-gate.test.ts`.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { BLOCK_REASONS, BODY_KINDS, HL7_BODY_TEXT_MAX_CHARS, IrisApiError, redactHl7 } from "@iris-mcp/shared";
import type { DataPolicy, ToolContext } from "@iris-mcp/shared";

// The engine runs unchanged; the wrapper only records what it is given, so a row can pin what reaches it.
vi.mock("@iris-mcp/shared", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@iris-mcp/shared")>();
  return { ...actual, redactHl7: vi.fn(actual.redactHl7) };
});
import { createMockCtx, createMockHttp, envelope } from "@iris-mcp/shared/test-helpers";
import {
  applyBodyReaderPolicy,
  bodyReadWire,
  cutText,
  messageBodyTool,
  sanitizeBodyText,
  type BodyReaderRawItem,
} from "../tools/message-body.js";

const BODY_URL = "/api/executemcp/v2/interop/message/body";

/** The ER7 text of a fixture ADT message, with CR segment terminators. */
const ADT_ER7 =
  "MSH|^~\\&|SYNTHPHI-APP|SYNTHPHI-FAC|||20010203090001||ADT^A01^ADT_A01|SYNTHPHI-CTL1|P|2.5.1\r" +
  "PID|1||SYNTHPHI-MRN^^^SYNTHPHI-AA||SYNTHPHI-LAST^SYNTHPHI-FIRST||19010101|F\r" +
  "OBX|1|TX|GLU^KEEPME-GLUCOSE^L||SYNTHPHI-free text|mg/dL|||||F\r";

/** What the engine makes of {@link ADT_ER7} (8 fields redacted), with the CR terminators it keeps. */
const ADT_REDACTED =
  "MSH|^~\\&|***|***|||***||ADT^A01^ADT_A01|***|P|2.5.1\r" +
  "PID|1||***^^^***||***^***||***|F\r" +
  "OBX|1|TX|GLU^KEEPME-GLUCOSE^L||***|mg/dL|||||F\r";

/** The same text after sanitization: one segment per line. */
const ADT_REDACTED_LF = ADT_REDACTED.replace(/\r/g, "\n");

/** A fixture message with other separators. */
const ALT_ER7 =
  "MSH#!@$%#SYNTHPHI-APP#SYNTHPHI-FAC###20010203090008##ADT!A01!ADT_A01#SYNTHPHI-CTL8#P#2.5.1\r" +
  "PID#1##SYNTHPHI-MRN!!!SYNTHPHI-AA@SYNTHPHI-MRN2##SYNTHPHI-LAST!SYNTHPHI-FIRST%X##19010101#F\r";

const ALT_REDACTED =
  "MSH#!@$%#***#***###***##ADT!A01!ADT_A01#***#P#2.5.1\r" +
  "PID#1##***!!!***@***##***!***%***##***#F\r";

const ENGINE_REFUSAL = "The text does not start with an MSH, FHS or BHS segment.";

/** A found item as the live route sends it (`bodyId` is left out for a literal header unless `all`). */
function found(
  id: number,
  bodyClassName: string,
  bodyId: string | undefined,
  bodyKind: string,
  bodyAvailable: boolean,
  extra: Partial<BodyReaderRawItem> = {},
): BodyReaderRawItem {
  return {
    id,
    found: true,
    bodyClassName,
    ...(bodyId !== undefined ? { bodyId } : {}),
    bodyKind,
    bodyAvailable,
    ...extra,
  };
}

/** The route's HL7 v2 items. */
const hl7 = (id: number, text: string): BodyReaderRawItem =>
  found(id, "EnsLib.HL7.Message", String(id), "hl7v2", true, { bodyText: text, bodyTextComplete: true });

/** The `all` items of fixture kappa that the policy table decides, as the route sends them (cap 65536). */
function allItems(): BodyReaderRawItem[] {
  return [
    hl7(1, ADT_ER7),
    found(3, "%Stream.GlobalCharacter", "1", "stream", true, {
      bodyText: "SYNTHPHI-S1\r\n\txSYNTHPHI-S2",
      bodyTextComplete: true,
    }),
    found(4, "Ens.StringRequest", "1", "persistent", true, {
      bodyText: '{"StringValue":"SYNTHPHI-STRING"}',
      bodyTextComplete: true,
    }),
    found(5, "Ens.StreamContainer", "1", "streamContainer", true, {
      bodyText: "SYNTHPHI-CONTAINER",
      bodyTextComplete: true,
    }),
    found(6, "Story395.Body.Missing", "1", "missing", false),
    found(7, "", "SYNTHPHI-LITERAL", "literal", false, { bodyText: "SYNTHPHI-LITERAL", bodyTextComplete: true }),
    found(9, "EnsLib.HL7.Message", "4", "hl7v2", true, { bodyTextOmitted: "tooLarge" }),
    found(10, "EnsLib.EDI.XML.Document", "1", "xmlvdoc", true, {
      bodyText: "<Patient><Name>SYNTHPHI-XML-NAME</Name></Patient>",
      bodyTextComplete: true,
    }),
    found(14, "EnsLib.HL7.Message", "999999", "hl7v2", false),
    found(17, "%Library.DynamicObject", "1", "other", false),
  ];
}

describe("iris_message_body", () => {
  let mockHttp: ReturnType<typeof createMockHttp>;
  let base: ToolContext;

  /** A context whose profile has the policy `policy` (or none, when it is `undefined`). */
  function ctxWith(policy: DataPolicy | undefined): ToolContext {
    const { dataPolicy: _unused, ...config } = base.config;
    void _unused;
    return { ...base, config: policy === undefined ? config : { ...config, dataPolicy: policy } };
  }

  /** Call the tool as the framework would after validation, with IRIS answering `items`. */
  async function read(
    policy: DataPolicy | undefined,
    items: BodyReaderRawItem[],
    args: Record<string, unknown> = {},
  ) {
    mockHttp.post.mockResolvedValueOnce(envelope({ interopEnabled: true, items, count: items.length }));
    return messageBodyTool.handler({ headerIds: [1], ...args }, ctxWith(policy));
  }

  type Structured = {
    items: Array<Record<string, unknown>>;
    count: number;
    maxChars: number;
    dataPolicy: { policy: string; redacted: number; blocked: number };
    dataPolicyClamped?: boolean;
  };
  const structured = (result: { structuredContent?: unknown }): Structured => result.structuredContent as Structured;

  beforeEach(() => {
    mockHttp = createMockHttp();
    base = createMockCtx(mockHttp);
  });

  describe("the definition", () => {
    it("is a read with truthful annotations, scope NS, and a governed data-policy declaration with no actions", () => {
      expect(messageBodyTool.name).toBe("iris_message_body");
      expect(messageBodyTool.title).toBe("Read Interoperability Message Bodies");
      expect(messageBodyTool.mutates).toBe("read");
      expect(messageBodyTool.scope).toBe("NS");
      expect(messageBodyTool.annotations).toEqual({
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      });
      expect(messageBodyTool.dataPolicy).toEqual({});
      expect(Object.keys(messageBodyTool.dataPolicy ?? {})).not.toContain("phiInputs");
    });

    it("has no action input, so it is one governance key", () => {
      const shape = (messageBodyTool.inputSchema as unknown as { shape: Record<string, unknown> }).shape;
      expect(Object.keys(shape).sort()).toEqual(["dataPolicy", "headerIds", "maxChars", "namespace"]);
    });
  });

  describe("the input schema bounds (AC 39.5.1)", () => {
    const schema = messageBodyTool.inputSchema;
    const ok = (value: unknown): boolean => schema.safeParse(value).success;

    it("takes 1 to 20 header IDs, each a positive integer or a string of digits", () => {
      expect(ok({ headerIds: [1] })).toBe(true);
      expect(ok({ headerIds: ["7", 8] })).toBe(true);
      expect(ok({ headerIds: Array.from({ length: 20 }, (_, i) => i + 1) })).toBe(true);
      expect(ok({ headerIds: [] })).toBe(false);
      expect(ok({ headerIds: Array.from({ length: 21 }, (_, i) => i + 1) })).toBe(false);
      expect(ok({ headerIds: ["0"] })).toBe(false);
      expect(ok({ headerIds: [0] })).toBe(false);
      expect(ok({ headerIds: [1.5] })).toBe(false);
      expect(ok({ headerIds: ["x"] })).toBe(false);
      expect(ok({})).toBe(false);
    });

    it("takes maxChars from 1 to 1048576, a whole number", () => {
      expect(ok({ headerIds: [1], maxChars: 1 })).toBe(true);
      expect(ok({ headerIds: [1], maxChars: 1048576 })).toBe(true);
      expect(ok({ headerIds: [1], maxChars: 0 })).toBe(false);
      expect(ok({ headerIds: [1], maxChars: 1048577 })).toBe(false);
      expect(ok({ headerIds: [1], maxChars: 2.5 })).toBe(false);
    });

    it("takes dataPolicy block, redact or allow, and nothing else", () => {
      for (const policy of ["block", "redact", "allow"]) expect(ok({ headerIds: [1], dataPolicy: policy })).toBe(true);
      expect(ok({ headerIds: [1], dataPolicy: "open" })).toBe(false);
      expect(ok({ headerIds: [1], dataPolicy: "REDACT" })).toBe(false);
    });

    it("takes an optional namespace", () => {
      expect(ok({ headerIds: [1], namespace: "EXECMCPTMP395A" })).toBe(true);
    });
  });

  describe("the description (Conventions: Tool descriptions)", () => {
    const text = messageBodyTool.description;

    it("leads with what the tool does, when to use it and what it returns", () => {
      expect(text.startsWith("Read the bodies of 1 to 20 Interoperability messages by header ID")).toBe(true);
      expect(text).toContain("iris_message_search");
      for (const phrase of [
        "ER7 text",
        "XML",
        "JSON",
        "%JSON.Adaptor",
        "a dump of its public properties",
        "stream container",
        "notShown",
        "found: false",
      ]) {
        expect(text, phrase).toContain(phrase);
      }
    });

    it("says maxChars is an output cap, that XML and JSON are serialized whole, and how to read a longer HL7 v2 body", () => {
      expect(text).toContain("maxChars (default 10000, max 1048576)");
      expect(text).toContain("caps the text shown per body");
      expect(text).toContain("It caps the output only");
      expect(text).toContain("An XML body is serialized whole before it is cut, and so is a JSON export");
      expect(text).toContain("a character stream in a property dump is read only up to the read limit");
      expect(text).toContain("a character stream shows its text and a binary stream its class and size");
      expect(text).toContain("An HL7 v2 body is read only whole");
      expect(text).toContain("65536 characters");
      expect(text).toContain("under the allow policy a larger maxChars (at most 1048576) reads a longer one");
    });

    it("states the policy, the tighten-only parameter, the per-body fields and that it is not a certification", () => {
      expect(text).toContain("IRIS_DATA_POLICY, set per profile; default redact");
      expect(text).toContain("block withholds every body");
      expect(text).toContain("reviewed keep-list");
      expect(text).toContain("withholds every other kind of body");
      expect(text).toContain("allow shows bodies as stored");
      expect(text).toContain("can only tighten");
      expect(text).toContain("dataPolicyClamped: true");
      expect(text).toContain("bodyPolicy (redacted, blocked or none)");
      expect(text).toContain("dataPolicy {policy, redacted, blocked}");
      expect(text).toContain("not a compliance certification");
    });

    it("states notApplicable and the default state of the governed read, with the operator key", () => {
      expect(text).toContain("notApplicable: true");
      expect(text).toContain("a read, enabled by default");
      expect(text).toContain('{"global": {"iris_message_body": false}}');
    });

    it("names no REST path", () => {
      expect(text).not.toMatch(/\/api\//);
      expect(text).not.toContain("/interop/");
      expect(text).not.toContain("executemcp");
    });
  });

  describe("the wire per policy (Rule #10: both fields are always sent)", () => {
    it("bodyReadWire is the documented table", () => {
      expect(bodyReadWire("block", 1)).toEqual({ bodyRead: "kind", bodyTextMaxChars: 65536 });
      expect(bodyReadWire("block", 1048576)).toEqual({ bodyRead: "kind", bodyTextMaxChars: 65536 });
      expect(bodyReadWire("redact", 1)).toEqual({ bodyRead: "hl7", bodyTextMaxChars: HL7_BODY_TEXT_MAX_CHARS });
      expect(bodyReadWire("redact", 1048576)).toEqual({ bodyRead: "hl7", bodyTextMaxChars: 65536 });
      expect(bodyReadWire("allow", 100)).toEqual({ bodyRead: "all", bodyTextMaxChars: 65536 });
      expect(bodyReadWire("allow", 100000)).toEqual({ bodyRead: "all", bodyTextMaxChars: 100000 });
    });

    it("each policy sends exactly headerIds, namespace, bodyRead and bodyTextMaxChars", async () => {
      const expected: Array<[DataPolicy | undefined, string, number]> = [
        ["block", "kind", 65536],
        ["redact", "hl7", 65536],
        [undefined, "hl7", 65536],
        ["allow", "all", 65536],
      ];
      for (const [policy, bodyRead, cap] of expected) {
        mockHttp.post.mockClear();
        await read(policy, [hl7(1, ADT_ER7)], { headerIds: [1, "2"] });
        expect(mockHttp.post).toHaveBeenCalledTimes(1);
        expect(mockHttp.post).toHaveBeenCalledWith(BODY_URL, {
          headerIds: [1, "2"],
          namespace: "USER",
          bodyRead,
          bodyTextMaxChars: cap,
        });
      }
    });

    it("allow with a large maxChars raises the read limit and a small one does not lower it", async () => {
      await read("allow", [], { maxChars: 100000 });
      expect(mockHttp.post.mock.calls[0]?.[1]).toMatchObject({ bodyRead: "all", bodyTextMaxChars: 100000 });
      mockHttp.post.mockClear();
      await read("allow", [], { maxChars: 100 });
      expect(mockHttp.post.mock.calls[0]?.[1]).toMatchObject({ bodyRead: "all", bodyTextMaxChars: 65536 });
    });

    it("sends the namespace the call resolves", async () => {
      await read("redact", [], { namespace: "EXECMCPTMP395A" });
      expect(mockHttp.post.mock.calls[0]?.[1]).toMatchObject({ namespace: "EXECMCPTMP395A" });
    });
  });

  describe("tightening (AD-9): a caller dataPolicy only tightens", () => {
    it("operator allow, caller redact: redact, no clamp", async () => {
      const result = await read("allow", allItems(), { dataPolicy: "redact" });
      expect(mockHttp.post.mock.calls[0]?.[1]).toMatchObject({ bodyRead: "hl7" });
      expect(structured(result).dataPolicy.policy).toBe("redact");
      expect(structured(result)).not.toHaveProperty("dataPolicyClamped");
      expect(result.content[0]?.text).not.toContain("is looser than");
    });

    it("operator redact, caller allow: redact, clamped, with the clamp line", async () => {
      const result = await read("redact", allItems(), { dataPolicy: "allow" });
      expect(mockHttp.post.mock.calls[0]?.[1]).toMatchObject({ bodyRead: "hl7" });
      expect(structured(result).dataPolicy.policy).toBe("redact");
      expect(structured(result).dataPolicyClamped).toBe(true);
      const lines = (result.content[0]?.text ?? "").split("\n");
      expect(lines[lines.length - 1]).toBe("The requested data policy allow is looser than the profile's redact, so redact applies.");
    });

    it("operator allow, caller block: block", async () => {
      const result = await read("allow", allItems(), { dataPolicy: "block" });
      expect(mockHttp.post.mock.calls[0]?.[1]).toMatchObject({ bodyRead: "kind", bodyTextMaxChars: 65536 });
      expect(structured(result).dataPolicy.policy).toBe("block");
      expect(structured(result)).not.toHaveProperty("dataPolicyClamped");
    });

    it("the same policy as the operator's is not a clamp", async () => {
      const result = await read("redact", allItems(), { dataPolicy: "redact" });
      expect(structured(result)).not.toHaveProperty("dataPolicyClamped");
    });

    it("a profile with no policy is redact", async () => {
      const result = await read(undefined, allItems());
      expect(structured(result).dataPolicy.policy).toBe("redact");
    });
  });

  describe("the per-body policy table (AD-26)", () => {
    it("redact: HL7 v2 is redacted from the complete text; every other body is withheld with its reason", async () => {
      const result = await read("redact", allItems());
      const items = structured(result).items;
      const by = (id: number) => items.find((item) => item.id === id) as Record<string, unknown>;

      expect(by(1)).toEqual({
        id: 1,
        found: true,
        bodyClassName: "EnsLib.HL7.Message",
        bodyId: "1",
        bodyKind: "hl7v2",
        bodyPolicy: { outcome: "redacted", redactedFields: 8 },
        format: "er7",
        text: ADT_REDACTED_LF,
        truncated: false,
      });
      for (const [id, kind] of [
        [3, "stream"],
        [4, "persistent"],
        [5, "streamContainer"],
        [10, "xmlvdoc"],
      ] as const) {
        expect(by(id).bodyPolicy, `item ${id}`).toEqual({ outcome: "blocked", reason: BLOCK_REASONS.unredactableKind(kind) });
        expect(by(id).notShown, `item ${id}`).toBe(BLOCK_REASONS.unredactableKind(kind));
        expect(by(id)).not.toHaveProperty("text");
        expect(by(id)).not.toHaveProperty("format");
      }
      expect(by(7)).toMatchObject({
        bodyId: "",
        bodyKind: "literal",
        bodyPolicy: { outcome: "blocked", reason: BLOCK_REASONS.unredactableKind("literal") },
      });
      expect(by(9)).toMatchObject({ bodyPolicy: { outcome: "blocked", reason: BLOCK_REASONS.hl7TooLarge() } });
      expect(by(6).bodyPolicy).toEqual({ outcome: "none" });
      expect(by(14).bodyPolicy).toEqual({ outcome: "none" });
      expect(by(17).bodyPolicy).toEqual({ outcome: "none" });
      // 1 redacted; 3, 4, 5, 7, 9, 10 withheld.
      expect(structured(result).dataPolicy).toEqual({ policy: "redact", redacted: 1, blocked: 6 });
    });

    it("block: every available body is withheld, none is read, and the counts say so", async () => {
      const result = await read("block", allItems());
      const items = structured(result).items;
      for (const item of items) {
        expect(item, `item ${item.id}`).not.toHaveProperty("text");
        expect(item, `item ${item.id}`).not.toHaveProperty("format");
      }
      const blockedIds = items.filter((item) => (item.bodyPolicy as { outcome: string }).outcome === "blocked").map((item) => item.id);
      expect(blockedIds).toEqual([1, 3, 4, 5, 7, 9, 10]);
      for (const id of blockedIds) {
        const item = items.find((candidate) => candidate.id === id) as { bodyPolicy: { reason: string } };
        expect(item.bodyPolicy.reason).toBe(BLOCK_REASONS.blockPolicy());
      }
      expect(structured(result).dataPolicy).toEqual({ policy: "block", redacted: 0, blocked: 7 });
      expect((items.find((item) => item.id === 7) as Record<string, unknown>).bodyId).toBe("");
    });

    it("allow: every renderable body is shown in its format and nothing is redacted or withheld", async () => {
      const result = await read("allow", allItems(), { maxChars: 100000 });
      const items = structured(result).items;
      const by = (id: number) => items.find((item) => item.id === id) as Record<string, unknown>;

      expect(by(1)).toMatchObject({ format: "er7", text: ADT_ER7.replace(/\r/g, "\n"), truncated: false, bodyPolicy: { outcome: "none" } });
      expect(by(3)).toMatchObject({ format: "text", text: "SYNTHPHI-S1\n\txSYNTHPHI-S2" });
      expect(by(4)).toMatchObject({ format: "json", text: '{"StringValue":"SYNTHPHI-STRING"}' });
      expect(by(5)).toMatchObject({ format: "text", text: "SYNTHPHI-CONTAINER" });
      expect(by(7)).toMatchObject({ format: "text", text: "SYNTHPHI-LITERAL", bodyId: "SYNTHPHI-LITERAL" });
      expect(by(10)).toMatchObject({ format: "xml", text: "<Patient><Name>SYNTHPHI-XML-NAME</Name></Patient>" });
      expect(structured(result).dataPolicy).toEqual({ policy: "allow", redacted: 0, blocked: 0 });
    });

    it("allow keeps the bodyId of a literal header IRIS sends", async () => {
      const result = await read("allow", [
        found(7, "", "SYNTHPHI-LITERAL", "literal", false, { bodyText: "SYNTHPHI-LITERAL", bodyTextComplete: true }),
      ]);
      expect(structured(result).items[0]).toMatchObject({ bodyId: "SYNTHPHI-LITERAL", format: "text", text: "SYNTHPHI-LITERAL" });
    });

    it("an unavailable body is not shown, whatever the policy: missing and does-not-open have their own reasons", async () => {
      for (const policy of ["block", "redact", "allow"] as const) {
        const result = await read(policy, allItems());
        const items = structured(result).items;
        const by = (id: number) => items.find((item) => item.id === id) as Record<string, unknown>;
        expect(by(6), policy).toMatchObject({
          bodyPolicy: { outcome: "none" },
          notShown: "The body class is not compiled in this namespace, so the body cannot be read.",
        });
        expect(by(14), policy).toMatchObject({
          bodyPolicy: { outcome: "none" },
          notShown: "The body does not open (it may have been purged), so it cannot be read.",
        });
        expect(by(17), policy).toMatchObject({
          bodyPolicy: { outcome: "none" },
          notShown: "The body does not open (it may have been purged), so it cannot be read.",
        });
      }
    });

    it("every kind x policy x availability combination, with no text sent, is decided by the table", () => {
      for (const kind of BODY_KINDS) {
        for (const policy of ["block", "redact", "allow"] as const) {
          for (const available of [true, false]) {
            const raw = found(1, kind === "literal" ? "" : "Some.Body", "1", kind, available);
            const { items, summary } = applyBodyReaderPolicy([raw], policy, 10000);
            const item = items[0] as { bodyPolicy: unknown };
            const label = `${kind} ${policy} available=${available}`;
            // A literal header is its own body, so it counts as available.
            if (!available && kind !== "literal") {
              expect(item.bodyPolicy, label).toEqual({ outcome: "none" });
            } else if (policy === "block") {
              expect(item.bodyPolicy, label).toEqual({ outcome: "blocked", reason: BLOCK_REASONS.blockPolicy() });
            } else if (policy === "redact") {
              // No HL7 text was sent, so even an HL7 v2 body is withheld: it was not read.
              const reason = kind === "hl7v2" ? BLOCK_REASONS.hl7Unreadable() : BLOCK_REASONS.unredactableKind(kind);
              expect(item.bodyPolicy, label).toEqual({ outcome: "blocked", reason });
            } else {
              expect(item.bodyPolicy, label).toEqual({ outcome: "none" });
            }
            expect(summary.redacted, label).toBe(0);
          }
        }
      }
    });

    it("an unknown bodyKind is kind other and is withheld under redact and block (a version-skewed reply)", () => {
      for (const policy of ["redact", "block"] as const) {
        const { items } = applyBodyReaderPolicy(
          [found(1, "Some.Body", "1", "futureKind", true, { bodyText: "SYNTHPHI-SKEW", bodyTextComplete: true })],
          policy,
          10000,
        );
        const item = items[0] as unknown as Record<string, unknown>;
        expect(item.bodyKind, policy).toBe("other");
        expect(item.bodyPolicy, policy).toEqual({
          outcome: "blocked",
          reason: policy === "block" ? BLOCK_REASONS.blockPolicy() : BLOCK_REASONS.unredactableKind("other"),
        });
        expect(JSON.stringify(item), policy).not.toContain("SYNTHPHI");
      }
      const { items: allowed } = applyBodyReaderPolicy(
        [found(1, "Some.Body", "1", "futureKind", true, { bodyText: "SYNTHPHI-SKEW" })],
        "allow",
        10000,
      );
      expect(allowed[0]).toMatchObject({ bodyKind: "other", notShown: "No renderer reads a other body, so only its class and ID are shown." });
      expect(allowed[0]).not.toHaveProperty("text");
    });

    it("a missing bodyKind is kind other as well", () => {
      const raw = { id: 1, found: true, bodyClassName: "Some.Body", bodyId: "1", bodyAvailable: true } as BodyReaderRawItem;
      const { items } = applyBodyReaderPolicy([raw], "redact", 10000);
      expect(items[0]).toMatchObject({ bodyKind: "other", bodyPolicy: { outcome: "blocked" } });
    });

    it("an unknown or missing bodyKind is withheld and counted under redact and block even when bodyAvailable is false", () => {
      const unknown = found(1, "Some.Body", "1", "futureKind", false);
      const missingKind = { id: 2, found: true, bodyClassName: "Some.Body", bodyId: "1", bodyAvailable: false } as BodyReaderRawItem;
      for (const policy of ["redact", "block"] as const) {
        const { items, summary } = applyBodyReaderPolicy([unknown, missingKind], policy, 10000);
        const reason = policy === "block" ? BLOCK_REASONS.blockPolicy() : BLOCK_REASONS.unredactableKind("other");
        for (const item of items) {
          expect(item, policy).toMatchObject({ bodyKind: "other", bodyPolicy: { outcome: "blocked", reason }, notShown: reason });
        }
        expect(summary, policy).toEqual({ policy, redacted: 0, blocked: 2 });
      }
    });

    it("a version-skewed reply with text on a stream or a literal bodyId is dropped under redact and block", () => {
      const skewed = [
        found(3, "%Stream.GlobalCharacter", "1", "stream", true, { bodyText: "SYNTHPHI-SKEW-STREAM", bodyTextComplete: true }),
        found(7, "", "SYNTHPHI-SKEW-LITERAL", "literal", false, { bodyText: "SYNTHPHI-SKEW-LITERAL", bodyTextComplete: true }),
        found(4, "Ens.StringRequest", "1", "persistent", true, { bodyText: '{"v":"SYNTHPHI-SKEW"}' }),
        { ...hl7(1, ADT_ER7) },
      ];
      for (const policy of ["redact", "block"] as const) {
        const { items } = applyBodyReaderPolicy(skewed, policy, 10000);
        const text = JSON.stringify(items);
        expect(text, policy).not.toContain("SKEW");
        expect(items.find((item) => item.id === 7), policy).toMatchObject({ bodyId: "" });
      }
      // Under block, even HL7 text that IRIS should not have sent is dropped.
      const { items: blockedItems } = applyBodyReaderPolicy(skewed, "block", 10000);
      expect(JSON.stringify(blockedItems)).not.toContain("SYNTHPHI");
    });

    it("a literal header with an empty body ID has no body: none with its reason, never withheld or counted, under every policy", () => {
      // The route sends bodyId "" for it in every mode, and under all an empty text with it.
      const noBody = found(7, "", "", "literal", false);
      const noBodyAll = found(7, "", "", "literal", false, { bodyText: "", bodyTextComplete: true });
      for (const [policy, raw] of [["block", noBody], ["redact", noBody], ["allow", noBodyAll]] as const) {
        const { items, summary } = applyBodyReaderPolicy([raw], policy, 10000);
        expect(items[0], policy).toEqual({
          id: 7,
          found: true,
          bodyClassName: "",
          bodyId: "",
          bodyKind: "literal",
          bodyPolicy: { outcome: "none" },
          notShown: "The message has no body: its header names no body class and no body ID.",
        });
        expect(summary, policy).toEqual({ policy, redacted: 0, blocked: 0 });
      }
      // A literal header that holds a value is still its own body: withheld under redact and block.
      const { items: valued } = applyBodyReaderPolicy([found(7, "", undefined, "literal", false)], "redact", 10000);
      expect(valued[0]).toMatchObject({ bodyPolicy: { outcome: "blocked", reason: BLOCK_REASONS.unredactableKind("literal") } });
    });

    it("only the ten fields of an item are read: a field a later IRIS adds never reaches the result", () => {
      const raw = {
        ...found(3, "%Stream.GlobalCharacter", "1", "stream", true),
        bodySummary: "SYNTHPHI-SUMMARY",
        extra: "SYNTHPHI-EXTRA",
      } as BodyReaderRawItem;
      for (const policy of ["block", "redact", "allow"] as const) {
        const { items } = applyBodyReaderPolicy([raw], policy, 10000);
        expect(JSON.stringify(items), policy).not.toContain("SYNTHPHI");
        // The stream was sent no text, so the item holds the base fields, the policy and the reason it is not shown.
        expect(Object.keys(items[0] as object).sort(), policy).toEqual(
          ["bodyClassName", "bodyId", "bodyKind", "bodyPolicy", "found", "id", "notShown"],
        );
      }
    });
  });

  describe("HL7 v2 under redact (AD-26)", () => {
    it("redacts the complete text of each message, with the engine's own separators", async () => {
      const result = await read("redact", [hl7(1, ADT_ER7), hl7(8, ALT_ER7)]);
      const [first, second] = structured(result).items as Array<{ text: string; bodyPolicy: unknown }>;
      expect(first?.text).toBe(ADT_REDACTED_LF);
      expect(second?.text).toBe(ALT_REDACTED.replace(/\r/g, "\n"));
      expect(second?.text.startsWith("MSH#!@$%#")).toBe(true);
      expect(structured(result).dataPolicy).toEqual({ policy: "redact", redacted: 2, blocked: 0 });
      expect(JSON.stringify(result)).not.toContain("SYNTHPHI");
      expect(JSON.stringify(result)).toContain("KEEPME-GLUCOSE");
    });

    it("an engine refusal withholds the body with the engine's fixed reason", async () => {
      const result = await read("redact", [hl7(1, "not hl7 SYNTHPHI-SECRET")]);
      const item = structured(result).items[0] as Record<string, unknown>;
      expect(item.bodyPolicy).toEqual({ outcome: "blocked", reason: BLOCK_REASONS.hl7Unparseable(ENGINE_REFUSAL) });
      expect(item.notShown).toBe(BLOCK_REASONS.hl7Unparseable(ENGINE_REFUSAL));
      expect(JSON.stringify(result)).not.toContain("SYNTHPHI");
      expect(structured(result).dataPolicy).toEqual({ policy: "redact", redacted: 0, blocked: 1 });
    });

    it("tooLarge and unreadable have their own reasons; a text IRIS reports as incomplete is unreadable, never redacted", async () => {
      const incomplete = found(3, "EnsLib.HL7.Message", "3", "hl7v2", true, { bodyText: ADT_ER7, bodyTextComplete: false });
      const neither = found(4, "EnsLib.HL7.Message", "4", "hl7v2", true);
      // A text with no bodyTextComplete at all (a version-skewed reply) is not known to be whole: unreadable too.
      const unstated = found(5, "EnsLib.HL7.Message", "5", "hl7v2", true, { bodyText: ADT_ER7 });
      const result = await read("redact", [
        found(1, "EnsLib.HL7.Message", "1", "hl7v2", true, { bodyTextOmitted: "tooLarge" }),
        found(2, "EnsLib.HL7.Message", "2", "hl7v2", true, { bodyTextOmitted: "unreadable" }),
        incomplete,
        neither,
        unstated,
      ]);
      const reasons = structured(result).items.map((item) => (item.bodyPolicy as { reason: string }).reason);
      expect(reasons).toEqual([
        BLOCK_REASONS.hl7TooLarge(),
        BLOCK_REASONS.hl7Unreadable(),
        BLOCK_REASONS.hl7Unreadable(),
        BLOCK_REASONS.hl7Unreadable(),
        BLOCK_REASONS.hl7Unreadable(),
      ]);
      expect(JSON.stringify(result)).not.toContain("SYNTHPHI");
    });

    it("an empty text is a refusal of the engine, not a redacted empty body", async () => {
      const result = await read("redact", [hl7(1, "")]);
      expect(structured(result).items[0]).toMatchObject({
        bodyPolicy: { outcome: "blocked", reason: BLOCK_REASONS.hl7Unparseable(ENGINE_REFUSAL) },
      });
    });
  });

  describe("redaction before truncation (AD-26)", () => {
    it("redact with maxChars 5: the first 5 characters of the REDACTED text, truncated", async () => {
      const result = await read("redact", [hl7(1, ADT_ER7)], { maxChars: 5 });
      const item = structured(result).items[0] as { bodyPolicy: { outcome: string }; text: string; truncated: boolean };
      expect(item.bodyPolicy.outcome).toBe("redacted");
      expect(item.text).toBe(ADT_REDACTED_LF.slice(0, 5));
      expect(item.text).toBe("MSH|^");
      expect(item.truncated).toBe(true);
    });

    it("a cut that would reveal a field is impossible: the redaction ran on the complete text first", async () => {
      // With maxChars 120 the cut falls inside the PID segment; no identifying value is in the text it keeps.
      const result = await read("redact", [hl7(1, ADT_ER7)], { maxChars: 120 });
      expect(JSON.stringify(result)).not.toContain("SYNTHPHI");
    });

    it("a text no longer than maxChars is not truncated", async () => {
      const result = await read("redact", [hl7(1, ADT_ER7)], { maxChars: ADT_REDACTED_LF.length });
      expect(structured(result).items[0]).toMatchObject({ truncated: false, text: ADT_REDACTED_LF });
    });

    it("allow: truncated when the text is cut, or when IRIS reports bodyTextComplete false", async () => {
      const cut = await read("allow", [
        found(3, "%Stream.GlobalCharacter", "1", "stream", true, { bodyText: "0123456789", bodyTextComplete: true }),
      ], { maxChars: 4 });
      expect(structured(cut).items[0]).toMatchObject({ text: "0123", truncated: true });

      const partial = await read("allow", [
        found(3, "%Stream.GlobalCharacter", "1", "stream", true, { bodyText: "0123", bodyTextComplete: false }),
      ], { maxChars: 100 });
      expect(structured(partial).items[0]).toMatchObject({ text: "0123", truncated: true });

      const whole = await read("allow", [
        found(3, "%Stream.GlobalCharacter", "1", "stream", true, { bodyText: "0123", bodyTextComplete: true }),
      ], { maxChars: 100 });
      expect(structured(whole).items[0]).toMatchObject({ text: "0123", truncated: false });
    });
  });

  describe("allow: why a body is not shown", () => {
    it("tooLarge names the cap that was sent, and how to read it whole", async () => {
      const item = found(9, "EnsLib.HL7.Message", "4", "hl7v2", true, { bodyTextOmitted: "tooLarge" });
      const dflt = await read("allow", [item]);
      expect(structured(dflt).items[0]).toMatchObject({
        notShown:
          "The HL7 v2 body is longer than 65536 characters, so it is not shown; a larger maxChars (at most 1048576) reads it whole.",
        bodyPolicy: { outcome: "none" },
      });
      const raised = await read("allow", [item], { maxChars: 100000 });
      expect((structured(raised).items[0] as { notShown: string }).notShown).toContain("longer than 100000 characters");
    });

    it("noRenderer names the kind; unreadable is the fixed text; a missing reply is unreadable", async () => {
      const result = await read("allow", [
        found(1, "EnsLib.EDI.X12.Document", "1", "vdoc", true, { bodyTextOmitted: "noRenderer" }),
        found(2, "Ens.StringRequest", "2", "persistent", true, { bodyTextOmitted: "unreadable" }),
        found(3, "%Stream.GlobalCharacter", "3", "stream", true),
      ]);
      const reasons = structured(result).items.map((item) => item.notShown);
      expect(reasons).toEqual([
        "No renderer reads a vdoc body, so only its class and ID are shown.",
        "The body could not be read.",
        "The body could not be read.",
      ]);
    });
  });

  describe("sanitization and the surrogate-safe cut", () => {
    it("CRLF and a lone CR become LF, and TAB and LF stay", () => {
      expect(sanitizeBodyText("a\r\nb\rc\nd\te")).toBe("a\nb\nc\nd\te");
    });

    it("every other C0 control and DEL become U+FFFD", () => {
      const replaced = "\uFFFD";
      for (let code = 0; code < 32; code += 1) {
        const ch = String.fromCharCode(code);
        const expected = code === 9 || code === 10 ? ch : code === 13 ? "\n" : replaced;
        expect(sanitizeBodyText(`a${ch}b`), `U+${code.toString(16).padStart(4, "0")}`).toBe(`a${expected}b`);
      }
      expect(sanitizeBodyText("a\u007Fb")).toBe(`a${replaced}b`);
      expect(sanitizeBodyText("caf\u00E9 \u4E2D")).toBe("caf\u00E9 \u4E2D");
    });

    it("sanitization comes after redaction: a control character in an HL7 value never decides the redaction", () => {
      const { items } = applyBodyReaderPolicy([hl7(1, ADT_ER7.replace("SYNTHPHI-free text", "SYNTHPHI-free\u0001text"))], "redact", 10000);
      expect((items[0] as { text: string }).text).toBe(ADT_REDACTED_LF);
    });

    it("the engine is given the complete text exactly as IRIS sent it: not sanitized, not cut", () => {
      const raw = ADT_ER7.replace(/\r/g, "\r\n").replace("SYNTHPHI-free text", "SYNTHPHI-free\u0001text");
      const engine = vi.mocked(redactHl7);
      engine.mockClear();
      applyBodyReaderPolicy([hl7(1, raw)], "redact", 5);
      expect(engine).toHaveBeenCalledTimes(1);
      expect(engine.mock.calls[0]?.[0]).toBe(raw);
    });

    it("the engine is not run for a body the policy withholds or leaves alone", () => {
      const engine = vi.mocked(redactHl7);
      engine.mockClear();
      applyBodyReaderPolicy([hl7(1, ADT_ER7)], "block", 10000);
      applyBodyReaderPolicy([hl7(1, ADT_ER7)], "allow", 10000);
      expect(engine).not.toHaveBeenCalled();
    });

    it("cutText never splits a surrogate pair", () => {
      const pair = "\uD83D\uDE00";
      expect(cutText(`ab${pair}cd`, 3)).toEqual({ text: "ab", truncated: true });
      expect(cutText(`ab${pair}cd`, 4)).toEqual({ text: `ab${pair}`, truncated: true });
      expect(cutText(`ab${pair}`, 4)).toEqual({ text: `ab${pair}`, truncated: false });
      expect(cutText("abcdef", 3)).toEqual({ text: "abc", truncated: true });
      expect(cutText("abc", 3)).toEqual({ text: "abc", truncated: false });
      expect(cutText(`${pair}a`, 1)).toEqual({ text: "", truncated: true });
    });

    it("a lone high surrogate that was already in the text is not removed by the cut", () => {
      expect(cutText("ab\uD83Dxy", 3)).toEqual({ text: "ab\uD83D", truncated: true });
    });
  });

  describe("the result", () => {
    it("is {items, count, maxChars, dataPolicy} with the heading, text and policy lines in content", async () => {
      const result = await read("redact", [hl7(1, ADT_ER7), found(3, "%Stream.GlobalCharacter", "1", "stream", true)], {
        headerIds: [1, 3],
      });
      expect(Object.keys(structured(result)).sort()).toEqual(["count", "dataPolicy", "items", "maxChars"]);
      expect(structured(result).count).toBe(2);
      expect(structured(result).maxChars).toBe(10000);
      const lines = (result.content[0]?.text ?? "").split("\n");
      expect(lines[0]).toBe("#1 EnsLib.HL7.Message [hl7v2] redacted");
      expect(lines.slice(1, 4)).toEqual(ADT_REDACTED_LF.split("\n").slice(0, 3));
      expect(lines).toContain("#3 %Stream.GlobalCharacter [stream] blocked");
      expect(lines).toContain(BLOCK_REASONS.unredactableKind("stream"));
      expect(lines[lines.length - 1]).toBe("Data policy redact: 1 redacted, 1 withheld.");
      expect(result.content).toHaveLength(1);
    });

    it("keeps request order, duplicates included, and reports a header that does not exist", async () => {
      const result = await read(
        "allow",
        [
          found(1, "Ens.StringRequest", "1", "persistent", true, { bodyText: "{}", bodyTextComplete: true }),
          { id: 999, found: false, error: "Header 999 not found" },
          found(1, "Ens.StringRequest", "1", "persistent", true, { bodyText: "{}", bodyTextComplete: true }),
        ],
        { headerIds: [1, 999, 1] },
      );
      const items = structured(result).items;
      expect(items.map((item) => item.id)).toEqual([1, 999, 1]);
      expect(items[1]).toEqual({ id: 999, found: false, error: "Header 999 not found" });
      expect(result.content[0]?.text).toContain("#999: Header 999 not found");
      expect(structured(result).count).toBe(3);
    });

    it("a header IRIS could not read carries the route's fixed text", async () => {
      const result = await read("redact", [{ id: 4, found: false, error: "Header 4 could not be read." }]);
      expect(structured(result).items[0]).toEqual({ id: 4, found: false, error: "Header 4 could not be read." });
    });
  });

  describe("notApplicable (Rule #41)", () => {
    it("a namespace without Interoperability answers notApplicable with a reason, no items and the policy", async () => {
      mockHttp.post.mockResolvedValueOnce(envelope({ interopEnabled: false, items: [], count: 0 }));
      const result = await messageBodyTool.handler({ headerIds: [1], namespace: "EXECMCPTMP395C" }, ctxWith(undefined));
      expect(result.isError).toBeFalsy();
      const body = structured(result) as unknown as Record<string, unknown>;
      expect(body.notApplicable).toBe(true);
      expect(String(body.reason)).toContain("Interoperability is not configured in namespace 'EXECMCPTMP395C'");
      expect(body.items).toEqual([]);
      expect(body.dataPolicy).toEqual({ policy: "redact", redacted: 0, blocked: 0 });
      expect(result.content[0]?.text).toContain("Data policy redact: 0 redacted, 0 withheld.");
    });

    it("a clamp is reported there too", async () => {
      mockHttp.post.mockResolvedValueOnce(envelope({ interopEnabled: false, items: [], count: 0 }));
      const result = await messageBodyTool.handler({ headerIds: [1], dataPolicy: "allow" }, ctxWith("block"));
      expect(structured(result).dataPolicyClamped).toBe(true);
      expect(result.content[0]?.text).toContain("The requested data policy allow is looser than the profile's block, so block applies.");
    });
  });

  describe("errors", () => {
    it("an IrisApiError is an isError result with the message", async () => {
      mockHttp.post.mockRejectedValueOnce(
        new IrisApiError(
          500,
          [{ error: "Parameter 'bodyRead' must be kind, hl7 or all" }],
          BODY_URL,
          "Parameter 'bodyRead' must be kind, hl7 or all",
        ),
      );
      const result = await messageBodyTool.handler({ headerIds: [1] }, ctxWith(undefined));
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text.startsWith("Error reading message bodies with iris_message_body: ")).toBe(true);
      expect(result.content[0]?.text).toContain("Parameter 'bodyRead' must be kind, hl7 or all");
      // The policy that applied, with no counts, so the audit entry records it rather than the profile's.
      expect(result.structuredContent).toEqual({ dataPolicy: { policy: "redact", redacted: 0, blocked: 0 } });
    });

    it("an IrisApiError under a tightened or clamped policy reports the policy that applied", async () => {
      const error = (): IrisApiError => new IrisApiError(500, [{ error: "boom" }], BODY_URL, "boom");
      mockHttp.post.mockRejectedValueOnce(error());
      const tightened = await messageBodyTool.handler({ headerIds: [1], dataPolicy: "block" }, ctxWith("allow"));
      expect(tightened.structuredContent).toEqual({ dataPolicy: { policy: "block", redacted: 0, blocked: 0 } });
      mockHttp.post.mockRejectedValueOnce(error());
      const clamped = await messageBodyTool.handler({ headerIds: [1], dataPolicy: "allow" }, ctxWith("redact"));
      expect(clamped.structuredContent).toEqual({ dataPolicy: { policy: "redact", redacted: 0, blocked: 0 }, dataPolicyClamped: true });
    });

    it("an error that is not an IrisApiError propagates to the framework", async () => {
      mockHttp.post.mockRejectedValueOnce(new Error("boom"));
      await expect(messageBodyTool.handler({ headerIds: [1] }, ctxWith(undefined))).rejects.toThrow("boom");
    });
  });

  describe("no SYNTHPHI value in any redact or block result", () => {
    it("the whole result of the fixture, content and structuredContent, holds none", async () => {
      for (const policy of ["redact", "block"] as const) {
        const result = await read(policy, allItems(), { maxChars: 100000 });
        expect(JSON.stringify(result), policy).not.toContain("SYNTHPHI");
      }
    });

    it("allow is the positive control: the same fixture shows them", async () => {
      const result = await read("allow", allItems(), { maxChars: 100000 });
      expect(JSON.stringify(result)).toContain("SYNTHPHI-STRING");
      expect(JSON.stringify(result)).toContain("SYNTHPHI-LITERAL");
    });
  });
});
