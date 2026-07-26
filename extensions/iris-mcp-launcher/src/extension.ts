/**
 * Extension activation entry point (Task 2). The ONLY file in this extension
 * with a value-level `import * as vscode from "vscode"` — every other module
 * is plain-data / injected-dependency and unit-testable without a VS Code
 * host (see `serverDefinitionProvider.ts`'s doc comment).
 *
 * Acquires the Server Manager extension API (`extensionDependencies` in
 * package.json guarantees it is installed; activation itself is still
 * defensive — see `getServerManagerApi` below), registers the
 * `iris-mcp-launcher` MCP server definition provider
 * (`contributes.mcpServerDefinitionProviders` in package.json), and adapts
 * `LauncherProvider`'s plain-data output onto real
 * `vscode.McpStdioServerDefinition` instances.
 */
import * as vscode from "vscode";

import { SERVER_MANAGER_EXTENSION_ID } from "./constants.js";
import { LauncherProvider } from "./serverDefinitionProvider.js";
import { readSettings, type ConfigReader } from "./settings.js";
import type { AuthApi, ServerManagerApi } from "./types.js";

const PROVIDER_ID = "iris-mcp-launcher";

let cachedApi: ServerManagerApi | undefined;

/**
 * Acquire (and cache) the Server Manager extension's exported API, activating
 * the extension if needed. Returns `undefined` — never throws — if the
 * extension is absent or inactive-and-unactivatable, so a missing dependency
 * degrades to "no servers registered" rather than crashing this extension's
 * own activation (story Dev Notes / Task 2: "should not happen given
 * extensionDependencies, but do not crash activation").
 */
async function getServerManagerApi(): Promise<ServerManagerApi | undefined> {
  if (cachedApi) return cachedApi;

  const extension = vscode.extensions.getExtension<ServerManagerApi>(SERVER_MANAGER_EXTENSION_ID);
  if (!extension) return undefined;

  try {
    if (!extension.isActive) {
      await extension.activate();
    }
  } catch {
    return undefined;
  }

  cachedApi = extension.exports;
  return cachedApi;
}

const authApi: AuthApi = {
  getSession: (providerId, scopes, options) =>
    vscode.authentication.getSession(providerId, scopes, options),
};

function toConfigReader(config: vscode.WorkspaceConfiguration): ConfigReader {
  return { get: (section, defaultValue) => config.get(section, defaultValue) };
}

export function activate(context: vscode.ExtensionContext): void {
  const outputChannel = vscode.window.createOutputChannel("IRIS MCP Launcher");
  context.subscriptions.push(outputChannel);

  // Credential containment (AC 31.4.3): this output channel and every
  // `showWarning` call below carry only the fixed, human-authored strings
  // built in `serverDefinitionProvider.ts` (server/package/plan labels) —
  // never a resolved profile, env map, or session/token value. No code path
  // in this extension writes a credential to `context.globalState`,
  // `context.workspaceState`, `vscode.workspace.getConfiguration(...).update`,
  // or any log/output channel.
  const showWarning = (message: string): void => {
    outputChannel.appendLine(message);
    void vscode.window.showWarningMessage(message);
  };

  const provider = new LauncherProvider({
    getServerManagerApi,
    authApi,
    getSettings: () =>
      readSettings((section) => toConfigReader(vscode.workspace.getConfiguration(section))),
    showWarning,
  });

  const registration = vscode.lm.registerMcpServerDefinitionProvider(PROVIDER_ID, {
    provideMcpServerDefinitions: async () => {
      const planned = await provider.providePlannedDefinitions();
      return planned.map(
        (definition) =>
          new vscode.McpStdioServerDefinition(
            definition.label,
            definition.command,
            definition.args,
            {},
          ),
      );
    },
    resolveMcpServerDefinition: async (server) => {
      const env = await provider.resolveEnvForLabel(server.label);
      if (!env) {
        // First-class cancellation/error outcome: return undefined so the
        // editor quietly does not start this server (Task 3) — no exception,
        // no toast storm beyond the single `showWarning` already issued above.
        return undefined;
      }
      if (!(server instanceof vscode.McpStdioServerDefinition)) {
        // Fail CLOSED. Returning `server` unmodified here would spawn a child
        // with none of the resolved IRIS_* variables — after having already
        // prompted the user for their password — and it would die with an
        // opaque "IRIS_USERNAME environment variable is required".
        showWarning(
          `IRIS MCP Launcher: "${server.label}" was not started — the editor returned an ` +
            `unexpected server definition type, so the resolved connection could not be applied.`,
        );
        return undefined;
      }
      server.env = env;
      return server;
    },
  });

  context.subscriptions.push(registration);
}

export function deactivate(): void {
  cachedApi = undefined;
}
