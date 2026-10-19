/**
 * Prompt definitions for the IRIS Development MCP server
 * (Epic 25, Story 25.1 — spec `03-skills-prompts-pack.md` §3).
 *
 * Exports the array registered with {@link McpServerBase} via
 * `McpServerBaseOptions.prompts`. Prompts carry no `mutates` classification
 * and are not tools (Rule #31).
 */

import type { PromptDefinition } from "@iris-mcp/shared";
import { diagnoseSlowQueryPrompt } from "./diagnoseSlowQuery.js";
import { deployAndTestClassPrompt } from "./deployAndTestClass.js";
import { promoteEnvironmentChangePrompt } from "./promoteEnvironmentChange.js";
import { editAndTestClassPrompt } from "./editAndTestClass.js";

/** All prompt definitions registered by the iris-dev-mcp server. */
export const prompts: PromptDefinition[] = [
  diagnoseSlowQueryPrompt,
  deployAndTestClassPrompt,
  promoteEnvironmentChangePrompt,
  editAndTestClassPrompt,
];
