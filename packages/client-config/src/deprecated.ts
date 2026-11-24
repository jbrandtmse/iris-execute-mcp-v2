/**
 * Deprecated public names of `@iris-mcp/client-config`, kept so an importer
 * of the 1.x API still compiles and runs. No adapter writes VS Code native
 * `inputs` any more: every adapter's env expansion is something other than
 * `vscode`, so `ensureInputs` refuses for every client, exactly as it always
 * refused for a non-`vscode` adapter. These names are removed in the next
 * major version.
 */

import { parse as parseJsonc, type ParseError } from "jsonc-parser";

import { CLIENT_ADAPTERS } from "./adapters.js";
import type { EngineOptions } from "./engine.js";
import type { EngineHostContext } from "./state.js";
import type { ClientScope } from "./types.js";

/**
 * One VS Code native `inputs` descriptor.
 * @deprecated No adapter writes `inputs`; removed in the next major version.
 */
export interface VscodeInput {
  id: string;
  type: "promptString";
  description: string;
  password: boolean;
}

/**
 * The id of the VS Code promptString input that carried the IRIS password.
 * @deprecated No adapter writes `inputs`; removed in the next major version.
 */
export const VSCODE_PASSWORD_INPUT_ID = "iris-password";

/**
 * The result of {@link ensureInputs}.
 * @deprecated Removed with `ensureInputs` in the next major version.
 */
export interface EnsureInputsResult {
  ok: boolean;
  client: string;
  scope: ClientScope;
  path: string | null;
  /** True when the config file's bytes changed. */
  changed: boolean;
  /** The input ids this call merged (empty when none were missing). */
  added: string[];
  backupPath?: string;
  restartHint?: string;
  reason?: string;
}

/**
 * The ids present in a JSON/JSONC document's top-level `inputs` array. An
 * unparseable document, or a non-array `inputs` key, is `{ok:false}`.
 * @deprecated No adapter writes `inputs`; removed in the next major version.
 */
export function presentInputIds(content: string): { ok: true; ids: string[] } | { ok: false; error: string } {
  if (content.trim() === "") return { ok: true, ids: [] };
  const errors: ParseError[] = [];
  let parsed: unknown;
  try {
    parsed = parseJsonc(content, errors, { allowTrailingComma: true, disallowComments: false });
  } catch (err) {
    return { ok: false, error: `JSON parser threw: ${err instanceof Error ? err.message : String(err)}` };
  }
  if (errors.length > 0) {
    return { ok: false, error: `JSON parse error at offset ${errors[0]?.offset ?? 0}` };
  }
  if (parsed === undefined || parsed === null) return { ok: true, ids: [] };
  if (typeof parsed !== "object" || Array.isArray(parsed)) {
    return { ok: false, error: "top-level JSON value is not an object" };
  }
  const inputs = (parsed as Record<string, unknown>).inputs;
  if (inputs === undefined) return { ok: true, ids: [] };
  if (!Array.isArray(inputs)) {
    return { ok: false, error: `the top-level "inputs" key is not an array` };
  }
  const ids: string[] = [];
  for (const item of inputs) {
    if (typeof item === "object" && item !== null) {
      const id = (item as { id?: unknown }).id;
      if (typeof id === "string") ids.push(id);
    }
  }
  return { ok: true, ids };
}

/**
 * Merge VS Code native `inputs` descriptors into a client's config file.
 * It writes nothing: no adapter uses the `vscode` env expansion, so the call
 * returns `{ok:false, changed:false}` with the reason, for an unknown client
 * as for every known one.
 * @deprecated No adapter writes `inputs`; removed in the next major version.
 */
export function ensureInputs(
  _ctx: EngineHostContext,
  client: string,
  scope: ClientScope,
  _inputs: VscodeInput[],
  _options: EngineOptions = {},
): EnsureInputsResult {
  const refuse = (reason: string): EnsureInputsResult => ({
    ok: false,
    client,
    scope,
    path: null,
    changed: false,
    added: [],
    reason,
  });
  const adapter = CLIENT_ADAPTERS[client];
  if (!adapter) {
    const known = Object.keys(CLIENT_ADAPTERS).join(", ");
    return refuse(`unknown client "${client}" (known clients: ${known})`);
  }
  return refuse(`native inputs are a VS Code concept; ${client} (${adapter.envExpansion} expansion) does not use them`);
}
