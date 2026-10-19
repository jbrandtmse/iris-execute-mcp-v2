---
"@iris-mcp/shared": minor
"@iris-mcp/interop": minor
---

feat(interop): message body content search, the `body` action of `iris_message_search` (Story 39.3)

`iris_message_search` finds messages by what their bodies hold: `action: "body"` takes a required `bodyClass` (the exact name of a persistent body class) and 1 to 10 structured `filters` (`{property, op, value}`, combined with AND; operators `eq`, `ne`, `lt`, `le`, `gt`, `ge`, `contains`, `startsWith`, `isNull`, `notNull`), and returns the same header rows as `headers`, never a body value. The IRIS handler resolves each property to its compiled SQL column from the class dictionary, maps each operator from a closed list and binds every value, so no caller text becomes SQL; the action is under the PHI data policy and is refused with `DATA_POLICY_BLOCKED` under `block`. The `headers` action now refuses a `filters` key instead of ignoring it, and `searchTable` still answers `NOT_IMPLEMENTED` with `availableActions` `headers` and `body`. `BOOTSTRAP_VERSION` moves `d440a659ba1e` to `f7b0868c95d0`.
