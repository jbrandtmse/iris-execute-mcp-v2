/**
 * Prompt definitions for the IRIS Interoperability MCP server
 * (Epic 25, Story 25.1 — spec `03-skills-prompts-pack.md` §3; extended in
 * Epic 26, Story 26.3 with the previously-gated `resend-failed-messages`).
 *
 * Exports the array registered with {@link McpServerBase} via
 * `McpServerBaseOptions.prompts`. Prompts carry no `mutates` classification
 * and are not tools (Rule #31).
 */

import type { PromptDefinition } from "@iris-mcp/shared";
import { traceMessageFlowPrompt } from "./traceMessageFlow.js";
import { recoverStuckProductionPrompt } from "./recoverStuckProduction.js";
import { resendFailedMessagesPrompt } from "./resendFailedMessages.js";

/** All prompt definitions registered by the iris-interop-mcp server. */
export const prompts: PromptDefinition[] = [
  traceMessageFlowPrompt,
  recoverStuckProductionPrompt,
  resendFailedMessagesPrompt,
];
