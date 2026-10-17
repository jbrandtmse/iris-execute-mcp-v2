/**
 * Story 39.2: the PHI data policy over the `iris_message_resend` preview (AD-26, AD-15, AD-33).
 *
 * Mocked HTTP. Pins the wire per policy (`redact` and `block` ask IRIS for the body kind only, `allow`
 * sends today's request), the per-item mapping in its documented order for every body kind and
 * availability, that a response of the legacy shape can never pass body content through, the two fixed
 * block reasons, the response and its trailing line, and that `allow` returns today's result exactly.
 * The same rows run live in `story-39-2-data-policy-live-gate.test.ts`.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { BODY_KINDS, BLOCK_REASONS } from "@iris-mcp/shared";
import type { DataPolicy, ToolContext } from "@iris-mcp/shared";
import { createMockCtx, createMockHttp, envelope } from "@iris-mcp/shared/test-helpers";
import { applyPreviewBodyPolicy, messageResendTool } from "../tools/message-resend.js";

const PREVIEW_URL = "/api/executemcp/v2/interop/message/resend/preview";

/** The em dash the preview's text lines use, by code point. */
const EM_DASH = String.fromCodePoint(0x2014);

/** A found header as IRIS sends it in `kind` mode. */
function kindHeader(id: number, bodyKind: string | undefined, bodyAvailable: boolean | undefined, bodyClassName = "Some.Body"): Record<string, unknown> {
  return {
    id,
    found: true,
    sessionId: 392000 + id,
    type: "Request",
    sourceItem: "Story392.Source",
    targetItem: "Story392.Hl7Target",
    status: "Error",
    isError: true,
    timeCreated: "2001-02-03 09:00:01",
    bodyClassName,
    bodyClassExists: bodyKind !== "missing" && bodyKind !== "literal",
    ...(bodyKind !== undefined ? { bodyKind } : {}),
    ...(bodyAvailable !== undefined ? { bodyAvailable } : {}),
    verdict: "recommended",
    reason: "This is the failed REQUEST message.",
  };
}

/** A found header as IRIS sends it in the legacy mode (what `allow` asks for). */
function legacyHeader(id: number, bodySummary: string, bodyClassName = "%Stream.GlobalCharacter"): Record<string, unknown> {
  return {
    id,
    found: true,
    sessionId: 392000 + id,
    type: "Request",
    sourceItem: "Story392.Source",
    targetItem: "Story392.Hl7Target",
    status: "Error",
    isError: true,
    timeCreated: "2001-02-03 09:00:01",
    bodyClassName,
    bodyClassExists: true,
    bodySummary,
    verdict: "recommended",
    reason: "This is the failed REQUEST message.",
  };
}

describe("iris_message_resend preview under the data policy", () => {
  let mockHttp: ReturnType<typeof createMockHttp>;
  let base: ToolContext;

  /** A context whose profile has the policy `policy` (or none, when it is `undefined`). */
  function ctxWith(policy: DataPolicy | undefined): ToolContext {
    const { dataPolicy: _unused, ...config } = base.config;
    void _unused;
    return { ...base, config: policy === undefined ? config : { ...config, dataPolicy: policy } };
  }

  async function preview(policy: DataPolicy | undefined, headers: Array<Record<string, unknown>>, ids = [1]) {
    mockHttp.post.mockResolvedValueOnce(envelope({ headers, count: headers.length }));
    return messageResendTool.handler({ action: "preview", headerIds: ids }, ctxWith(policy));
  }

  beforeEach(() => {
    mockHttp = createMockHttp();
    base = createMockCtx(mockHttp);
  });

  it("is declared a data-policy tool for its preview action only", () => {
    expect(messageResendTool.dataPolicy).toEqual({ actions: ["preview"] });
  });

  it("its description states the policy and the default", () => {
    expect(messageResendTool.description).toContain("under the operator's data policy");
    expect(messageResendTool.description).toContain("IRIS_DATA_POLICY");
    expect(messageResendTool.description).toContain("default `redact`");
    expect(messageResendTool.description).toContain("an HL7 v2 body shows only its class name");
    expect(messageResendTool.description).toContain("`block` withholds every body");
    expect(messageResendTool.description).toContain("`allow` shows the summary unchanged");
  });

  describe("the wire", () => {
    it("redact and block ask IRIS for the body kind only, and send no text cap", async () => {
      for (const policy of ["redact", "block"] as const) {
        mockHttp.post.mockClear();
        await preview(policy, [kindHeader(1, "stream", true)], [1, 2]);
        expect(mockHttp.post).toHaveBeenCalledTimes(1);
        expect(mockHttp.post).toHaveBeenCalledWith(PREVIEW_URL, { headerIds: [1, 2], namespace: "USER", bodyDetail: "kind" });
        const sent = mockHttp.post.mock.calls[0]?.[1] as Record<string, unknown>;
        expect(Object.keys(sent).sort()).toEqual(["bodyDetail", "headerIds", "namespace"]);
      }
    });

    it("a profile with no data policy is redact", async () => {
      await preview(undefined, [kindHeader(1, "stream", true)]);
      expect(mockHttp.post).toHaveBeenCalledWith(PREVIEW_URL, { headerIds: [1], namespace: "USER", bodyDetail: "kind" });
    });

    it("allow sends today's request exactly", async () => {
      await preview("allow", [legacyHeader(1, "text")]);
      expect(mockHttp.post.mock.calls[0]).toEqual([PREVIEW_URL, { headerIds: [1], namespace: "USER" }]);
    });
  });

  describe("allow returns today's result exactly", () => {
    it("with the IRIS body summary, no dataPolicy and no bodyPolicy anywhere", async () => {
      const result = await preview("allow", [legacyHeader(1, "SYNTHPHI-S1  \tx..."), { id: 99, found: false, error: "Header 99 not found" }], [1, 99]);
      expect(result).toEqual({
        content: [
          {
            type: "text",
            text:
              `#1 [recommended] Request Story392.Source -> Story392.Hl7Target (Error) [isError] ${EM_DASH} This is the failed REQUEST message.\n` +
              `#99: NOT FOUND ${EM_DASH} Header 99 not found`,
          },
        ],
        structuredContent: {
          headers: [
            {
              ...legacyHeader(1, "SYNTHPHI-S1  \tx..."),
              timeCreated: "2001-02-03T09:00:01Z",
              timeCreatedRaw: "2001-02-03 09:00:01",
            },
            { id: 99, found: false, error: "Header 99 not found" },
          ],
          count: 2,
        },
      });
    });
  });

  describe("the per-item mapping, in its order", () => {
    const outcomeOf = async (policy: DataPolicy, header: Record<string, unknown>) => {
      const result = await preview(policy, [header]);
      return (result.structuredContent as { headers: Array<Record<string, unknown>> }).headers[0] as Record<string, unknown>;
    };

    it("rule 1: a bodyKind that is not one of the nine tokens, or is missing, is withheld as kind other", async () => {
      for (const policy of ["redact", "block"] as const) {
        for (const kind of ["bogus", "HL7V2", "", undefined]) {
          const item = await outcomeOf(policy, kindHeader(1, kind, true, "EnsLib.HL7.Message"));
          expect(item.bodyKind, `${policy} ${String(kind)}`).toBe("other");
          expect(item.bodyPolicy, `${policy} ${String(kind)}`).toEqual({ outcome: "blocked", reason: BLOCK_REASONS.unredactableKind("other") });
          expect(item.bodySummary).toBe("");
        }
      }
    });

    it("rule 2: a body that is not available is none, with an empty summary, whatever the kind and the policy", async () => {
      for (const policy of ["redact", "block"] as const) {
        for (const kind of BODY_KINDS) {
          for (const available of [false, undefined]) {
            const item = await outcomeOf(policy, kindHeader(1, kind, available));
            expect(item.bodyPolicy, `${policy} ${kind} ${String(available)}`).toEqual({ outcome: "none" });
            expect(item.bodySummary).toBe("");
            expect(item.bodyKind).toBe(kind);
          }
        }
      }
    });

    it("rule 3: block withholds every available body with the block reason, an hl7v2 one included", async () => {
      for (const kind of BODY_KINDS) {
        const item = await outcomeOf("block", kindHeader(1, kind, true, "EnsLib.HL7.Message"));
        expect(item.bodyPolicy, kind).toEqual({ outcome: "blocked", reason: "The block data policy withholds every message body." });
        expect(item.bodySummary, kind).toBe("");
      }
    });

    it("rule 4: redact keeps the class note of an hl7v2 body and withholds every other available kind", async () => {
      for (const kind of BODY_KINDS) {
        const item = await outcomeOf("redact", kindHeader(1, kind, true, "Some.Body"));
        if (kind === "hl7v2") {
          expect(item.bodyPolicy).toEqual({ outcome: "redacted", redactedFields: 0 });
          expect(item.bodySummary).toBe("(non-stream body; class=Some.Body)");
        } else {
          expect(item.bodyPolicy, kind).toEqual({
            outcome: "blocked",
            reason: `A ${kind} body cannot be redacted reliably, so the redact data policy withholds it.`,
          });
          expect(item.bodySummary, kind).toBe("");
        }
        expect(item.bodyKind).toBe(kind);
      }
    });

    it("the class note equals the text IRIS's BodySummary gives a non-stream body", async () => {
      const item = await outcomeOf("redact", kindHeader(1, "hl7v2", true, "EnsLib.HL7.Message"));
      expect(item.bodySummary).toBe("(non-stream body; class=EnsLib.HL7.Message)");
    });

    it("drops bodyAvailable, bodyText and bodyTextOmitted from every item", async () => {
      const header = { ...kindHeader(1, "hl7v2", true), bodyText: "MSH|SYNTHPHI", bodyTextOmitted: "tooLarge" };
      for (const policy of ["redact", "block"] as const) {
        const item = await outcomeOf(policy, header);
        for (const key of ["bodyAvailable", "bodyText", "bodyTextOmitted"]) expect(key in item, `${policy} ${key}`).toBe(false);
      }
    });
  });

  describe("a response of the legacy shape never passes body content through", () => {
    it("redact and block replace bodySummary and ignore a bodyText, whatever IRIS sent", async () => {
      const hostile = {
        ...legacyHeader(1, "MSH|^~\\&|SYNTHPHI-APP"),
        bodyText: "MSH|SYNTHPHI-TEXT",
        bodyTextOmitted: "SYNTHPHI-OMITTED",
        bodyAvailable: true,
      };
      for (const policy of ["redact", "block"] as const) {
        const result = await preview(policy, [hostile, { ...legacyHeader(2, "SYNTHPHI-STREAM") }], [1, 2]);
        const serialized = JSON.stringify(result);
        expect(serialized, policy).not.toContain("SYNTHPHI");
        const items = (result.structuredContent as { headers: Array<Record<string, unknown>> }).headers;
        for (const item of items) {
          expect(item.bodyKind, policy).toBe("other");
          expect(item.bodyPolicy, policy).toMatchObject({ outcome: "blocked" });
          expect(item.bodySummary, policy).toBe("");
        }
      }
    });

    it("a header that was not found carries no body field, even one IRIS should not have sent", async () => {
      const result = await preview("redact", [{ id: 5, found: false, error: "Header 5 not found", bodySummary: "SYNTHPHI-X", bodyText: "SYNTHPHI-Y" }], [5]);
      expect(JSON.stringify(result)).not.toContain("SYNTHPHI");
      expect((result.structuredContent as { headers: unknown[] }).headers[0]).toEqual({ id: 5, found: false, error: "Header 5 not found" });
    });
  });

  describe("the response", () => {
    const mixed = [
      kindHeader(1, "hl7v2", true, "EnsLib.HL7.Message"),
      kindHeader(2, "hl7v2", true, "EnsLib.HL7.Message"),
      kindHeader(3, "stream", true, "%Stream.GlobalCharacter"),
      kindHeader(4, "persistent", true, "Ens.StringRequest"),
      kindHeader(5, "missing", false, "Story392.Body.Missing"),
      kindHeader(6, "literal", false, ""),
    ];

    it("carries dataPolicy {policy, redacted, blocked}, one bodyPolicy per found item, and a trailing line", async () => {
      const result = await preview("redact", mixed, [1, 2, 3, 4, 5, 6]);
      const structured = result.structuredContent as { headers: Array<{ bodyPolicy: { outcome: string } }>; dataPolicy: unknown; count: number };
      expect(structured.dataPolicy).toEqual({ policy: "redact", redacted: 2, blocked: 2 });
      expect(structured.headers.map((h) => h.bodyPolicy.outcome)).toEqual(["redacted", "redacted", "blocked", "blocked", "none", "none"]);
      expect(structured.count).toBe(6);
      const lines = (result.content?.[0] as { text: string }).text.split("\n");
      expect(lines).toHaveLength(7);
      expect(lines[6]).toBe("Data policy redact: 2 redacted, 2 withheld.");
      expect(result.content).toHaveLength(1);
    });

    it("under block every available body is withheld", async () => {
      const result = await preview("block", mixed, [1, 2, 3, 4, 5, 6]);
      const structured = result.structuredContent as { dataPolicy: unknown };
      expect(structured.dataPolicy).toEqual({ policy: "block", redacted: 0, blocked: 4 });
      const lines = (result.content?.[0] as { text: string }).text.split("\n");
      expect(lines[lines.length - 1]).toBe("Data policy block: 0 redacted, 4 withheld.");
    });

    it("an empty result still reports the policy", async () => {
      const result = await preview("redact", [], [1]);
      expect((result.content?.[0] as { text: string }).text).toBe("No headers found.\nData policy redact: 0 redacted, 0 withheld.");
      expect((result.structuredContent as { dataPolicy: unknown }).dataPolicy).toEqual({ policy: "redact", redacted: 0, blocked: 0 });
    });

    it("still turns the times into ISO 8601 with a Raw sibling", async () => {
      const result = await preview("redact", [kindHeader(1, "stream", true)]);
      const item = (result.structuredContent as { headers: Array<Record<string, unknown>> }).headers[0] as Record<string, unknown>;
      expect(item.timeCreated).toBe("2001-02-03T09:00:01Z");
      expect(item.timeCreatedRaw).toBe("2001-02-03 09:00:01");
    });

    it("has no bodyText, bodyTextOmitted or bodyAvailable key anywhere", async () => {
      const result = await preview("redact", mixed, [1, 2, 3, 4, 5, 6]);
      const serialized = JSON.stringify(result);
      for (const key of ["bodyText", "bodyTextOmitted", "bodyAvailable"]) expect(serialized, key).not.toContain(`"${key}"`);
    });
  });

  describe("applyPreviewBodyPolicy", () => {
    it("returns what the policy did over the headers it was given", () => {
      const applied = applyPreviewBodyPolicy([kindHeader(1, "hl7v2", true) as never, kindHeader(2, "stream", true) as never], "redact");
      expect(applied.summary).toEqual({ policy: "redact", redacted: 1, blocked: 1 });
      expect(applied.headers).toHaveLength(2);
    });

    it("does not change the headers it is given", () => {
      const header = kindHeader(1, "stream", true) as never;
      const before = JSON.stringify(header);
      applyPreviewBodyPolicy([header], "block");
      expect(JSON.stringify(header)).toBe(before);
    });
  });

  it("the other actions are unchanged by the policy", async () => {
    mockHttp.post.mockResolvedValueOnce(envelope({ action: "resend", results: [{ originalId: 1, newHeaderId: 2, ok: true }], summary: { total: 1, succeeded: 1, failed: 0 } }));
    const result = await messageResendTool.handler({ action: "resend", headerIds: [1] }, ctxWith("block"));
    expect(mockHttp.post).toHaveBeenCalledWith("/api/executemcp/v2/interop/message/resend", { action: "resend", headerIds: [1], namespace: "USER" });
    expect(JSON.stringify(result)).not.toContain("dataPolicy");
  });
});
