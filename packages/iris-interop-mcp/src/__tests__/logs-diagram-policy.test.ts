/**
 * Story 39.7 (DW-576, AD-26, AD-19, AD-15) - `iris_production_logs` and `iris_message_diagram` under the PHI data policy.
 *
 * Both tools return text that can carry message content: an Event Log entry's `text`, and the `Error on message <id>: `
 * warnings the diagram correlator builds from a header's sanitized `ErrorStatus`. Under `block` they withhold that
 * text in TypeScript with a fixed reason; under `redact` and `allow` they are byte-identical to before, with no
 * `dataPolicy` key (free text cannot be redacted reliably, and content sniffing is forbidden). The IRIS answers here
 * are the live shapes: the entry keys follow `Interop.cls` `EventLog`, and the diagram result follows the Correlator
 * and Writer templates.
 *
 * Sections: (A) the declaration; (B) logs under redact, allow and block; (C) diagram under redact, allow and block;
 * (D) the audit trail through the real `McpServerBase` call path.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BLOCK_REASONS, IrisApiError, McpServerBase, type DataPolicy, type ToolContext } from "@iris-mcp/shared";
import {
  auditLines,
  callTool,
  createMockCtx,
  createMockHttp,
  envelope,
  makeEnvHarness,
  stageDefaultStartup,
} from "@iris-mcp/shared/test-helpers";
import { messageDiagramTool } from "../tools/diagram.js";
import { productionLogsTool } from "../tools/monitor.js";

/** A context whose profile has the policy `policy` (or none, when it is `undefined`). */
function ctxWith(base: ToolContext, policy: DataPolicy | undefined): ToolContext {
  const { dataPolicy: _unused, ...config } = base.config;
  void _unused;
  return { ...base, config: policy === undefined ? config : { ...config, dataPolicy: policy } };
}

/** The Event Log answer: two entries in the live key order, the first with every optional key. */
function logResult(): { entries: Array<Record<string, unknown>>; count: number } {
  return {
    entries: [
      {
        id: 12,
        timestamp: "2001-02-03 12:00:02.000",
        type: "Error",
        itemName: "Story397.Operation",
        text: "SYNTHPHI397-LOG-1 PID|1||SYNTHPHI397-MRN-D",
        sourceClass: "Story397.Seed",
        sourceMethod: "Seed",
        sessionId: 397002,
      },
      {
        id: 11,
        timestamp: "2001-02-03 12:00:01.000",
        type: "Info",
        itemName: "Story397.Service",
        text: "KEEPME397-LOG-2 SYNTHPHI397-LOG-2",
      },
    ],
    count: 2,
  };
}

const ERROR_TEXT = "SYNTHPHI397-ERR PID|1||SYNTHPHI397-MRN-D";

/** One diagram entry as the endpoint returns it: an arrow, an error warning, and the same warning as a Mermaid comment. */
function diagramEntry(sessionId: number, errorId: number, extraWarnings: string[] = []): Record<string, unknown> {
  return {
    sessionId,
    mermaid:
      "sequenceDiagram\n" +
      `%% Session ${sessionId}: 2 messages, 2001-02-03 12:00:03 .. 2001-02-03 12:00:04\n` +
      "participant Story397.Service\n" +
      "participant Story397.Operation\n" +
      "Story397.Service->>Story397.Operation: Story397.StreamBody\n" +
      "Story397.Operation-->>Story397.Service: (no body) [ERROR]\n" +
      `%% Error on message ${errorId}: ${ERROR_TEXT}`,
    messageCount: 2,
    warnings: [`Error on message ${errorId}: ${ERROR_TEXT}`, ...extraWarnings],
    truncated: false,
  };
}

const NO_SYNTH = (value: unknown): void => {
  expect(JSON.stringify(value)).not.toContain("SYNTHPHI397");
};

describe("the declaration (Story 39.7, AD-26)", () => {
  it("both tools are governed by the data policy on every call, with no PHI input", () => {
    expect(productionLogsTool.dataPolicy).toEqual({});
    expect(messageDiagramTool.dataPolicy).toEqual({});
  });

  it("neither classification changed: logs is a baseline key (no mutates), diagram is a read", () => {
    expect(productionLogsTool.mutates).toBeUndefined();
    expect(messageDiagramTool.mutates).toBe("read");
  });

  it("the descriptions state the block behaviour and the unchanged redact and allow behaviour", () => {
    expect(productionLogsTool.description).toContain(
      "Under the block PHI data policy (IRIS_DATA_POLICY) each entry's text is withheld with a reason in textPolicy; under redact and allow it is shown unchanged.",
    );
    expect(messageDiagramTool.description).toContain("Under the block PHI data policy (IRIS_DATA_POLICY)");
    expect(messageDiagramTool.description).toContain("under redact and allow it is shown unchanged");
  });
});

describe("iris_production_logs under the data policy (Story 39.7, DW-576)", () => {
  let mockHttp: ReturnType<typeof createMockHttp>;
  let base: ToolContext;

  beforeEach(() => {
    mockHttp = createMockHttp();
    base = createMockCtx(mockHttp);
  });

  it.each<DataPolicy | undefined>([undefined, "redact", "allow"])(
    "under %s the output is exactly today's: the IRIS result, shown unchanged, with no dataPolicy key (AD-15 pin)",
    async (policy) => {
      mockHttp.get.mockResolvedValue(envelope(logResult()));

      const result = await productionLogsTool.handler({ namespace: "EXECMCPTMP397A", count: 10 }, ctxWith(base, policy));

      expect(result.isError).toBeUndefined();
      expect(result.structuredContent).toEqual(logResult());
      expect(result.content).toEqual([{ type: "text", text: JSON.stringify(logResult(), null, 2) }]);
      expect(Object.keys(result.structuredContent as object)).toEqual(["entries", "count"]);
      expect(JSON.stringify(result)).not.toContain("textPolicy");
      expect(JSON.stringify(result)).not.toContain("dataPolicy");
      expect(JSON.stringify(result), "the positive control: the text is shown").toContain("SYNTHPHI397-LOG-1");
    },
  );

  it("under block each entry loses its text and gains textPolicy in its place, with the other keys in today's order", async () => {
    mockHttp.get.mockResolvedValue(envelope(logResult()));

    const result = await productionLogsTool.handler({ namespace: "EXECMCPTMP397A", count: 10 }, ctxWith(base, "block"));

    const reason = BLOCK_REASONS.eventLogText();
    const expected = {
      entries: [
        {
          id: 12,
          timestamp: "2001-02-03 12:00:02.000",
          type: "Error",
          itemName: "Story397.Operation",
          textPolicy: { outcome: "blocked", reason },
          sourceClass: "Story397.Seed",
          sourceMethod: "Seed",
          sessionId: 397002,
        },
        {
          id: 11,
          timestamp: "2001-02-03 12:00:01.000",
          type: "Info",
          itemName: "Story397.Service",
          textPolicy: { outcome: "blocked", reason },
        },
      ],
      count: 2,
      dataPolicy: { policy: "block", redacted: 0, blocked: 2 },
    };
    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toEqual(expected);
    expect(Object.keys(result.structuredContent as object)).toEqual(["entries", "count", "dataPolicy"]);
    const entries = (result.structuredContent as { entries: Array<Record<string, unknown>> }).entries;
    expect(Object.keys(entries[0] as object)).toEqual([
      "id",
      "timestamp",
      "type",
      "itemName",
      "textPolicy",
      "sourceClass",
      "sourceMethod",
      "sessionId",
    ]);
    expect(entries.every((entry) => !("text" in entry))).toBe(true);
    expect(result.content).toEqual([{ type: "text", text: JSON.stringify(expected, null, 2) }]);
    NO_SYNTH(result);
    expect(JSON.stringify(result)).not.toContain("KEEPME397-LOG-2");
  });

  it("under block an empty log is an empty list with 0 withheld, and the request is the same", async () => {
    mockHttp.get.mockResolvedValue(envelope({ entries: [], count: 0 }));

    const result = await productionLogsTool.handler({ type: "Error" }, ctxWith(base, "block"));

    expect(result.structuredContent).toEqual({ entries: [], count: 0, dataPolicy: { policy: "block", redacted: 0, blocked: 0 } });
    const blockedPath = mockHttp.get.mock.calls[0]?.[0] as string;
    mockHttp.get.mockClear();
    mockHttp.get.mockResolvedValue(envelope({ entries: [], count: 0 }));
    await productionLogsTool.handler({ type: "Error" }, ctxWith(base, "allow"));
    expect(mockHttp.get.mock.calls[0]?.[0], "the policy changes no request").toBe(blockedPath);
  });

  it("an entry that carries no text key still gains textPolicy under block", async () => {
    mockHttp.get.mockResolvedValue(envelope({ entries: [{ id: 1, itemName: "A" }], count: 1 }));

    const result = await productionLogsTool.handler({}, ctxWith(base, "block"));

    expect(result.structuredContent).toEqual({
      entries: [{ id: 1, itemName: "A", textPolicy: { outcome: "blocked", reason: BLOCK_REASONS.eventLogText() } }],
      count: 1,
      dataPolicy: { policy: "block", redacted: 0, blocked: 1 },
    });
  });

  it("an IrisApiError keeps today's text; only block adds the policy, with 0 counts", async () => {
    mockHttp.get.mockRejectedValue(new IrisApiError(500, [], "/api/executemcp/v2/interop/production/logs", "Server error"));

    for (const policy of [undefined, "redact", "allow"] as const) {
      const result = await productionLogsTool.handler({}, ctxWith(base, policy));
      expect(result.isError).toBe(true);
      expect(result.content).toEqual([{ type: "text", text: "Error querying production logs: Server error" }]);
      expect(result.structuredContent, `${policy}: no structuredContent`).toBeUndefined();
    }

    const blocked = await productionLogsTool.handler({}, ctxWith(base, "block"));
    expect(blocked.isError).toBe(true);
    expect(blocked.content).toEqual([{ type: "text", text: "Error querying production logs: Server error" }]);
    expect(blocked.structuredContent).toEqual({ dataPolicy: { policy: "block", redacted: 0, blocked: 0 } });
  });

  it("a non-IrisApiError exception propagates under every policy", async () => {
    mockHttp.get.mockRejectedValue(new Error("ECONNREFUSED"));

    for (const policy of [undefined, "block"] as const) {
      await expect(productionLogsTool.handler({}, ctxWith(base, policy))).rejects.toThrow("ECONNREFUSED");
    }
  });
});

describe("iris_message_diagram under the data policy (Story 39.7, DW-576)", () => {
  let mockHttp: ReturnType<typeof createMockHttp>;
  let base: ToolContext;

  beforeEach(() => {
    mockHttp = createMockHttp();
    base = createMockCtx(mockHttp);
  });

  const call = (policy: DataPolicy | undefined, diagrams: Array<Record<string, unknown>>, ids = [397002]) => {
    mockHttp.get.mockResolvedValue(envelope({ diagrams, count: diagrams.length }));
    return messageDiagramTool.handler({ sessionIds: ids, namespace: "EXECMCPTMP397A" }, ctxWith(base, policy));
  };

  it.each<DataPolicy | undefined>([undefined, "redact", "allow"])(
    "under %s the output is exactly today's: the IRIS result verbatim, with the error text shown and no dataPolicy key (AD-15 pin)",
    async (policy) => {
      const diagrams = [diagramEntry(397002, 41)];
      const result = await call(policy, diagrams);

      expect(result.isError).toBeUndefined();
      expect(result.structuredContent).toEqual({ diagrams: [diagramEntry(397002, 41)], count: 1 });
      expect(Object.keys(result.structuredContent as object)).toEqual(["diagrams", "count"]);
      expect(result.content).toEqual([
        {
          type: "text",
          text:
            "Session 397002: 2 messages (1 warning)\n```mermaid\n" +
            (diagramEntry(397002, 41).mermaid as string) +
            "\n```",
        },
      ]);
      expect(JSON.stringify(result), "the positive control: the error text is shown").toContain(`Error on message 41: ${ERROR_TEXT}`);
      expect(JSON.stringify(result)).not.toContain("dataPolicy");
    },
  );

  it("under block the error warning keeps its prefix and the Mermaid comment line follows, with the fixed reason", async () => {
    const result = await call("block", [diagramEntry(397002, 41)]);

    const reason = BLOCK_REASONS.diagramErrorText();
    const original = diagramEntry(397002, 41);
    const structured = result.structuredContent as {
      diagrams: Array<{ warnings: string[]; mermaid: string; sessionId: number; messageCount: number; truncated: boolean }>;
      count: number;
      dataPolicy: unknown;
    };
    expect(structured.dataPolicy).toEqual({ policy: "block", redacted: 0, blocked: 1 });
    expect(structured.count).toBe(1);
    expect(structured.diagrams[0]?.warnings).toEqual([`Error on message 41: ${reason}`]);
    const mermaid = structured.diagrams[0]?.mermaid as string;
    expect(mermaid.split("\n")).toContain(`%% Error on message 41: ${reason}`);
    const without = (text: string): string => text.split("\n").filter((line) => !line.startsWith("%% Error on message")).join("\n");
    expect(without(mermaid), "everything else in the Mermaid text is unchanged").toBe(without(original.mermaid as string));
    expect(Object.keys(structured.diagrams[0] as object)).toEqual(Object.keys(original));
    expect(Object.keys(structured)).toEqual(["diagrams", "count", "dataPolicy"]);
    expect(result.content).toEqual([
      { type: "text", text: `Session 397002: 2 messages (1 warning)\n\`\`\`mermaid\n${mermaid}\n\`\`\`` },
    ]);
    NO_SYNTH(result);
  });

  it("under block the loop and arrow indents of the Mermaid comment are kept, and every form is rewritten", async () => {
    const entry = diagramEntry(5, 7, [
      "Error on message 9: second SYNTHPHI397-E2",
      "Unpaired request: message 3 (A -> B) has no matching response",
    ]);
    entry.mermaid =
      "sequenceDiagram\n" +
      "A->>B: Req\n" +
      `%% Error on message 7: ${ERROR_TEXT}\n` +
      "loop 3 times\n" +
      "  A->>B: Req\n" +
      "  B-->>A: Resp [ERROR]\n" +
      "  %% Error on message 9: second SYNTHPHI397-E2\n" +
      "  loop 2 times\n" +
      "    %% Error on message 12: nested SYNTHPHI397-E3\n" +
      "  end\n" +
      "end\n" +
      "%% Unpaired request: message 3 (A -> B) has no matching response";

    const result = await call("block", [entry], [5]);

    const reason = BLOCK_REASONS.diagramErrorText();
    const structured = result.structuredContent as { diagrams: Array<{ warnings: string[]; mermaid: string }>; dataPolicy: unknown };
    expect(structured.diagrams[0]?.warnings).toEqual([
      `Error on message 7: ${reason}`,
      `Error on message 9: ${reason}`,
      "Unpaired request: message 3 (A -> B) has no matching response",
    ]);
    expect(structured.dataPolicy).toEqual({ policy: "block", redacted: 0, blocked: 2 });
    expect(structured.diagrams[0]?.mermaid.split("\n")).toEqual([
      "sequenceDiagram",
      "A->>B: Req",
      `%% Error on message 7: ${reason}`,
      "loop 3 times",
      "  A->>B: Req",
      "  B-->>A: Resp [ERROR]",
      `  %% Error on message 9: ${reason}`,
      "  loop 2 times",
      `    %% Error on message 12: ${reason}`,
      "  end",
      "end",
      "%% Unpaired request: message 3 (A -> B) has no matching response",
    ]);
    NO_SYNTH(result);
  });

  it("a warning that is not an error warning is untouched, even when it mentions an error message", async () => {
    const warnings = [
      "Unpaired response: message 4 (A -> B) emitted standalone",
      "Correlation conflict: response 5 paired with request 3 by order, but its CorrespondingMessageId is 4",
      "Generation failed for session 8: Error on message 6: not at the start",
    ];
    const entry = diagramEntry(8, 1);
    entry.warnings = warnings;
    entry.mermaid = "sequenceDiagram\n%% Unpaired response: message 4 (A -> B) emitted standalone";

    const result = await call("block", [entry], [8]);

    const structured = result.structuredContent as { diagrams: Array<{ warnings: string[]; mermaid: string }>; dataPolicy: unknown };
    expect(structured.diagrams[0]?.warnings).toEqual(warnings);
    expect(structured.diagrams[0]?.mermaid).toBe(entry.mermaid);
    expect(structured.dataPolicy).toEqual({ policy: "block", redacted: 0, blocked: 0 });
  });

  it("the count is over all sessions, and a multi-line error warning is replaced whole", async () => {
    const first = diagramEntry(1, 11);
    const second = diagramEntry(2, 22);
    second.warnings = ["Error on message 22: line one SYNTHPHI397-L1\nline two SYNTHPHI397-L2"];

    const result = await call("block", [first, second], [1, 2]);

    const reason = BLOCK_REASONS.diagramErrorText();
    const structured = result.structuredContent as { diagrams: Array<{ warnings: string[] }>; dataPolicy: unknown };
    expect(structured.diagrams[0]?.warnings).toEqual([`Error on message 11: ${reason}`]);
    expect(structured.diagrams[1]?.warnings).toEqual([`Error on message 22: ${reason}`]);
    expect(structured.dataPolicy).toEqual({ policy: "block", redacted: 0, blocked: 2 });
    expect(result.content).toHaveLength(2);
    NO_SYNTH(result);
  });

  it("an empty result is 'No diagrams generated.' with 0 withheld under block", async () => {
    const result = await call("block", []);

    expect(result.content).toEqual([{ type: "text", text: "No diagrams generated." }]);
    expect(result.structuredContent).toEqual({ diagrams: [], count: 0, dataPolicy: { policy: "block", redacted: 0, blocked: 0 } });
  });

  it("an IrisApiError keeps today's text; only block adds the policy, with 0 counts", async () => {
    mockHttp.get.mockRejectedValue(new IrisApiError(500, [], "/api/executemcp/v2/interop/production/messages/diagram", "Server error"));

    for (const policy of [undefined, "redact", "allow"] as const) {
      const result = await messageDiagramTool.handler({ sessionIds: [1] }, ctxWith(base, policy));
      expect(result.isError).toBe(true);
      expect(result.content).toEqual([{ type: "text", text: "Error generating message diagram: Server error" }]);
      expect(result.structuredContent, `${policy}: no structuredContent`).toBeUndefined();
    }

    const blocked = await messageDiagramTool.handler({ sessionIds: [1] }, ctxWith(base, "block"));
    expect(blocked.isError).toBe(true);
    expect(blocked.content).toEqual([{ type: "text", text: "Error generating message diagram: Server error" }]);
    expect(blocked.structuredContent).toEqual({ dataPolicy: { policy: "block", redacted: 0, blocked: 0 } });
  });
});

describe("the audit trail of both tools through the real call path (AD-19)", () => {
  const env = makeEnvHarness();
  beforeEach(env.setup);
  afterEach(env.teardown);

  const answer = (result: unknown): Response =>
    new Response(JSON.stringify({ status: { errors: [], summary: "" }, console: [], result }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });

  /** Start a real server with both tools, answer their routes, make one call, and return the result, the audit entry and the raw log. */
  async function auditedCall(tool: "iris_production_logs" | "iris_message_diagram", policy: string | undefined) {
    const dir = mkdtempSync(join(tmpdir(), "iris-logs-diagram-audit-"));
    const auditPath = join(dir, "audit.log");
    process.env.IRIS_AUDIT_LOG = auditPath;
    process.env.IRIS_AUDIT_LOG_PARAMS = "true";
    if (policy !== undefined) process.env.IRIS_DATA_POLICY = policy;
    const logged: string[] = [];
    const spy = vi.spyOn(console, "error").mockImplementation((...parts: unknown[]) => {
      logged.push(parts.map(String).join(" "));
    });
    try {
      stageDefaultStartup(env.fetchMock);
      const server = new McpServerBase({
        name: "@iris-mcp/interop",
        version: "0.0.0",
        tools: [productionLogsTool, messageDiagramTool],
        needsCustomRest: true,
      });
      await server.start("stdio");
      env.fetchMock.mockImplementation(async (input: unknown) => {
        const url = String(input);
        if (url.includes("/interop/production/messages/diagram")) {
          return answer({ diagrams: [diagramEntry(397002, 41)], count: 1 });
        }
        if (url.includes("/interop/production/logs")) return answer(logResult());
        return new Response(null, { status: 200 });
      });
      const args = tool === "iris_production_logs" ? { count: 10 } : { sessionIds: [397002] };
      const result = await callTool(server, tool, args);
      const entries = await auditLines(auditPath, 2);
      const entry = entries.find((candidate) => candidate.tool === tool) as Record<string, unknown>;
      return { result, entry, raw: readFileSync(auditPath, "utf-8"), log: logged.join("\n") };
    } finally {
      spy.mockRestore();
      delete process.env.IRIS_AUDIT_LOG;
      delete process.env.IRIS_AUDIT_LOG_PARAMS;
      delete process.env.IRIS_DATA_POLICY;
      rmSync(dir, { recursive: true, force: true });
    }
  }

  it("iris_production_logs: block counts the withheld entries, redact and allow record the policy with 0 counts", async () => {
    const block = await auditedCall("iris_production_logs", "block");
    expect(block.result.structuredContent.dataPolicy).toEqual({ policy: "block", redacted: 0, blocked: 2 });
    expect(block.entry).toMatchObject({ outcome: "ok", dataPolicy: { policy: "block", redacted: 0, blocked: 2 } });
    expect(JSON.stringify(block.result)).not.toContain("SYNTHPHI397");
    expect(block.raw).not.toContain("SYNTHPHI397");
    expect(block.log).not.toContain("SYNTHPHI397");

    const redact = await auditedCall("iris_production_logs", undefined);
    expect(redact.entry).toMatchObject({ outcome: "ok", dataPolicy: { policy: "redact", redacted: 0, blocked: 0 } });
    expect(JSON.stringify(redact.result), "the text is shown under redact").toContain("SYNTHPHI397-LOG-1");
    expect(redact.raw).not.toContain("SYNTHPHI397");
    expect(redact.log).not.toContain("SYNTHPHI397");

    const allow = await auditedCall("iris_production_logs", "allow");
    expect(allow.entry).toMatchObject({ outcome: "ok", dataPolicy: { policy: "allow", redacted: 0, blocked: 0 } });
    expect(JSON.stringify(allow.result)).toContain("SYNTHPHI397-LOG-1");
    expect(allow.raw).not.toContain("SYNTHPHI397");
  });

  it("iris_message_diagram: block counts the withheld warnings, redact and allow record the policy with 0 counts", async () => {
    const block = await auditedCall("iris_message_diagram", "block");
    expect(block.result.structuredContent.dataPolicy).toEqual({ policy: "block", redacted: 0, blocked: 1 });
    expect(block.entry).toMatchObject({ outcome: "ok", dataPolicy: { policy: "block", redacted: 0, blocked: 1 } });
    expect(JSON.stringify(block.result)).not.toContain("SYNTHPHI397");
    expect(block.raw).not.toContain("SYNTHPHI397");
    expect(block.log).not.toContain("SYNTHPHI397");

    const redact = await auditedCall("iris_message_diagram", undefined);
    expect(redact.entry).toMatchObject({ outcome: "ok", dataPolicy: { policy: "redact", redacted: 0, blocked: 0 } });
    expect(JSON.stringify(redact.result), "the text is shown under redact").toContain("SYNTHPHI397-ERR");
    expect(redact.raw).not.toContain("SYNTHPHI397");
    expect(redact.log).not.toContain("SYNTHPHI397");

    const allow = await auditedCall("iris_message_diagram", "allow");
    expect(allow.entry).toMatchObject({ outcome: "ok", dataPolicy: { policy: "allow", redacted: 0, blocked: 0 } });
    expect(JSON.stringify(allow.result)).toContain("SYNTHPHI397-ERR");
    expect(allow.raw).not.toContain("SYNTHPHI397");
  });
});
