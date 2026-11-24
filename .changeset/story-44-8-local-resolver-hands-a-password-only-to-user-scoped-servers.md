---
"@iris-mcp/shared": patch
---

fix: a stored password goes only to a server defined in user settings, in the launcher's Local harness and in the shared Server Manager import (Story 44.8, DW-752 and DW-761; sanctioned AD-15 change, wave-9 decisions #153 and #154)

- The shared Server Manager import (`IRIS_SERVER_MANAGER=auto|required`) no longer pairs an OS-keychain or `IRIS_CREDENTIAL_HELPER` password with a definition that comes from a workspace-scope settings file (the folder's `.vscode/settings.json` or a `*.code-workspace` file). Such a server is left out of the roster with a warning that names the file; `required` fails startup naming the server. A workspace definition with its own inline `password` in the same file still uses it, files named by absolute path in `IRIS_SM_SETTINGS_PATHS` count as the operator's own (a relative entry resolves against the working directory and counts as workspace scope), and a server defined in user settings is byte-identical. `ServerManagerProfileResult` gains the optional `workspaceScope` marker.
- The VS Code launcher's Local-harness resolve step starts a server only when every server of its plan is defined in user settings alone, and calls none of Server Manager's `getServerSpec`, `getAccount` or `getSession` for one that a workspace, folder or language-specific layer defines or overrides (DW-752). The fix is in the launcher vsix, a must-carry artifact of the release; the extension cannot be named in a changeset, and its version follows the fixed `@iris-mcp/*` group.

No tool, action, input field, governance key, visibility or description changes.
