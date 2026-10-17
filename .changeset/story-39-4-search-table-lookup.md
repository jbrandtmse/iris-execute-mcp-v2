---
"@iris-mcp/interop": minor
"@iris-mcp/shared": minor
---

feat(interop): Search Table lookup, the `searchTable` action of `iris_message_search` (Story 39.4)

`iris_message_search` finds messages by an indexed Search Table value, such as an HL7 medical record number: `action: "searchTable"` takes a required `searchTableClass` (the exact name of a compiled virtual-document Search Table class, such as `EnsLib.HL7.SearchTable`) and 1 to 10 structured `filters` (`{property, op, value}`, combined with AND, the operators of `body`), and returns the same header rows as `headers`, never a Search Table or body value. The IRIS handler resolves each property to the PropId of its `Ens.Config.SearchTableProp` row, maps each operator from a closed list and binds every value, so no caller text becomes SQL; the action is under the PHI data policy and is refused with `DATA_POLICY_BLOCKED` under `block`. `filters` on the `headers` action is refused naming both actions, `searchTableClass` is refused off its action, and no tool returns `NOT_IMPLEMENTED` any more. `BOOTSTRAP_VERSION` moves `f7b0868c95d0` to `a6df36481aa9`.
