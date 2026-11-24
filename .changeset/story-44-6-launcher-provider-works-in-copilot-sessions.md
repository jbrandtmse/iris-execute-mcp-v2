---
"@iris-mcp/shared": patch
---

fix: the launcher's servers can read their password from the keychain, so they start in Copilot-harness sessions (Story 44.6, DW-731)

- New opt-in variable `IRIS_CREDENTIAL_NAME` (sanctioned AD-15 change, wave-9 decision #140). Set, with `IRIS_PASSWORD` unset or empty, the `default` profile takes its password from the iris-mcp keychain entry of that name (service `iris-mcp`, then `IRIS_CREDENTIAL_HELPER`), and each `IRIS_PROFILES` entry without a `password` looks up its own name (a miss keeps the inherited password and warns). A non-empty `IRIS_PASSWORD` wins; an exhausted chain fails startup naming the variable and `iris-mcp-credentials set <name>`. Unset, empty or blank: configuration and error texts are byte-identical to before.
- `@iris-mcp/shared` exports `resolveStoredCredential` (links 2 and 3 of the credential chain); `resolveCredential` calls it after link 1.

No tool, action, input field, governance key, visibility or description changes. The VS Code extension has no changeset: its version follows the fixed group, and the vsix is a must-carry artifact of the end-of-epic release.
