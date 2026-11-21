/**
 * The 2025-11-25 wire contract that the framework owns on top of the MCP SDK (AD-15, AD-32).
 *
 * The SDK's own `tools/list`, `tools/call`, `prompts/get` and `resources/read` handlers do not produce the
 * bytes that clients of the 2025-11-25 era have always read from these servers, so the framework serves those
 * four methods itself from its own state. This module holds the pure parts of that contract:
 *
 * - **Protocol-error text.** A protocol error reaches the wire as `MCP error <code>: <message>`. The SDK's
 *   `ProtocolError` does not add the prefix, so {@link protocolError} writes it into the message.
 * - **Tool list entry.** The keys of an entry are `name`, `title`, `description`, `inputSchema`, `annotations`
 *   and `execution`, in that order, then `outputSchema` when the tool declares one. `inputSchema` is
 *   `z.toJSONSchema(z.object(extended.shape), { target: "draft-7", io: "input" })`, `outputSchema` the same
 *   with `io: "output"`, and `execution` is `{ "taskSupport": "forbidden" }`.
 * - **Tool-call validation.** Arguments are checked against `z.object(extended.shape)`, the object that the
 *   fields of the extended input schema build. That keeps the refinements declared on single fields and drops
 *   the ones declared on the whole object, which `McpServerBase` applies inside the audited chokepoint. A
 *   failure is the in-band error result `MCP error -32602: Input validation error: Invalid arguments for tool
 *   <name>: <ZodError.message>`; omitted `arguments` fail the same way, with `undefined` as the received value.
 * - **Tool-call output.** A tool that declares an `outputSchema` must return `structuredContent` that
 *   `z.object(outputShape)` accepts, unless the result is an error. A failure is the in-band error result
 *   `MCP error -32602: Output validation error: ...`.
 */

import { ProtocolError, ProtocolErrorCode } from "@modelcontextprotocol/server";
import type { CallToolResult, Tool } from "@modelcontextprotocol/server";
import { z } from "zod";
import type { ZodObject } from "zod";

import type { ToolDefinition } from "./tool-types.js";

/** The text of a protocol error on the wire: `MCP error <code>: <message>`. */
export function v1ProtocolErrorText(code: number, message: string): string {
  return `MCP error ${code}: ${message}`;
}

/** A {@link ProtocolError} whose message carries the `MCP error <code>: ` prefix that clients read. */
export function protocolError(code: number, message: string): ProtocolError {
  return new ProtocolError(code, v1ProtocolErrorText(code, message));
}

/** An in-band tool error result holding `text`. */
export function toolErrorResult(text: string): CallToolResult {
  return { content: [{ type: "text" as const, text }], isError: true };
}

/** The object the wire validation uses: the fields of `extended`, without any refinement on the whole object. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function wireInputSchema(extended: ZodObject<any>): ZodObject<any> {
  return z.object(extended.shape);
}

/** The outcome of checking the `arguments` of a `tools/call`: the parsed arguments, or the error text. */
export type WireInputCheck = { ok: true; args: Record<string, unknown> } | { ok: false; text: string };

/**
 * Check the raw `arguments` of a `tools/call` against the tool's wire schema.
 *
 * @param toolName   - The tool's name, for the error text.
 * @param wireSchema - The tool's {@link wireInputSchema}.
 * @param rawArguments - `arguments` exactly as the request carried it, `undefined` when it was omitted.
 */
export function checkWireInput(
  toolName: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  wireSchema: ZodObject<any>,
  rawArguments: unknown,
): WireInputCheck {
  const parsed = wireSchema.safeParse(rawArguments);
  if (parsed.success) return { ok: true, args: parsed.data as Record<string, unknown> };
  return {
    ok: false,
    text: v1ProtocolErrorText(
      ProtocolErrorCode.InvalidParams,
      `Input validation error: Invalid arguments for tool ${toolName}: ${parsed.error.message}`,
    ),
  };
}

/**
 * The error text for a result that breaks the tool's declared `outputSchema`, or `undefined` when the result
 * is acceptable (no schema declared, an error result, or `structuredContent` that the schema accepts).
 */
export function checkWireOutput(toolName: string, tool: ToolDefinition, result: CallToolResult): string | undefined {
  if (!tool.outputSchema || result.isError) return undefined;
  if (!result.structuredContent) {
    return v1ProtocolErrorText(
      ProtocolErrorCode.InvalidParams,
      `Output validation error: Tool ${toolName} has an output schema but no structured content was provided`,
    );
  }
  const parsed = z.object(tool.outputSchema.shape).safeParse(result.structuredContent);
  if (parsed.success) return undefined;
  return v1ProtocolErrorText(
    ProtocolErrorCode.InvalidParams,
    `Output validation error: Invalid structured content for tool ${toolName}: ${parsed.error.message}`,
  );
}

/** One entry of a `tools/list` result. */
export interface ListedTool {
  name: string;
  title: string;
  description: string;
  inputSchema: Tool["inputSchema"];
  annotations: {
    readOnlyHint: boolean | undefined;
    destructiveHint: boolean | undefined;
    idempotentHint: boolean | undefined;
    openWorldHint: boolean | undefined;
  };
  execution: { taskSupport: "forbidden" };
  outputSchema?: Tool["outputSchema"];
}

/**
 * The `tools/list` entry of a tool.
 *
 * @param tool     - The tool definition.
 * @param extended - The tool's input schema extended with the framework `server` parameter.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function listedTool(tool: ToolDefinition, extended: ZodObject<any>): ListedTool {
  const entry: ListedTool = {
    name: tool.name,
    title: tool.title,
    description: tool.description,
    inputSchema: z.toJSONSchema(wireInputSchema(extended), { target: "draft-7", io: "input" }) as Tool["inputSchema"],
    annotations: {
      readOnlyHint: tool.annotations.readOnlyHint,
      destructiveHint: tool.annotations.destructiveHint,
      idempotentHint: tool.annotations.idempotentHint,
      openWorldHint: tool.annotations.openWorldHint,
    },
    execution: { taskSupport: "forbidden" },
  };
  if (tool.outputSchema) {
    entry.outputSchema = z.toJSONSchema(z.object(tool.outputSchema.shape), {
      target: "draft-7",
      io: "output",
    }) as Tool["outputSchema"];
  }
  return entry;
}
