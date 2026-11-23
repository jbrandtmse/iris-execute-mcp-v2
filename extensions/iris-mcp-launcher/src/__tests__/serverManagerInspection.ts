/**
 * Test fixture: the `vscode.workspace.getConfiguration("intersystems", scope).inspect("servers")` result a provider fake
 * hands `LauncherProvider` through `inspectServerManagerServers`. Shapes follow `vscode.d.ts`
 * `WorkspaceConfiguration.inspect`: one optional value per layer, each that layer's whole `servers` object.
 */
import type { ServerManagerServersInspection } from "../types.js";

/** Every named server defined in user settings only (no workspace or folder layer). */
export function userScopeServers(names: readonly string[]): ServerManagerServersInspection {
  return { globalValue: Object.fromEntries(names.map((name) => [name, {}])) };
}
