/**
 * Prompt definitions for the IRIS Operations & Monitoring MCP server
 * (Epic 25, Story 25.1 — spec `03-skills-prompts-pack.md` §3).
 *
 * Exports the array registered with {@link McpServerBase} via
 * `McpServerBaseOptions.prompts`. Prompts carry no `mutates` classification
 * and are not tools (Rule #31).
 */

import type { PromptDefinition } from "@iris-mcp/shared";
import { checkSystemHealthPrompt } from "./checkSystemHealth.js";
import { runExternalBackupPrompt } from "./runExternalBackup.js";

/** All prompt definitions registered by the iris-ops-mcp server. */
export const prompts: PromptDefinition[] = [
  checkSystemHealthPrompt,
  runExternalBackupPrompt,
];
