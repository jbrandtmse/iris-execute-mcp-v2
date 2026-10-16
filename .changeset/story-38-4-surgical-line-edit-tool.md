---
"@iris-mcp/shared": minor
"@iris-mcp/dev": minor
---

feat: iris_doc_edit makes surgical line edits, and governance gains parent keys (Story 38.4)

`@iris-mcp/dev` (minor): the new tool `iris_doc_edit` (dev 29 to 30 tools) changes a few lines of an existing class,
routine or include file without resending the whole document. Each `insert`, `delete` or `replace` edit carries the
`expected` text of the lines it changes, in the line numbering of a ranged `iris_doc_get`. All edits apply or none, in
one save that carries `If-None-Match`; a concurrent change is a `DOCUMENT_CONFLICT`, never retried. The answer comes from
a re-read: `unifiedDiff`, an excerpt per edit, `totalLines` and `ts`. It does not compile. A class edit that would drop a
Storage definition is refused with `STORAGE_DROPPED`. `iris_doc_edit:apply` is a write that is **enabled by default**
(Project Lead decision S-3); `iris_doc_edit:regenerateStorage`, the guard override, is **disabled by default**. Both
keys seed disabled when `iris_doc_put` is explicitly disabled. The dev `core` preset grows from 13 to 14 runtime tools
(the 13 is a guideline), and `iris_doc_get` / `iris_doc_edit` are a co-visible pair. `iris_doc_put`, `iris_doc_get` and
`iris_doc_load` are unchanged.

`@iris-mcp/shared` (minor): adds parent keys: `ToolDefinition.parent`, `buildParentKeys`, `assertParentKeysKnown`,
`inheritedParentDisable` and the type `ParentKeys`. When a key's parent is explicitly disabled (its first explicit setting
in cascade order is `false`) the key seeds disabled; an explicit setting on the key still wins. The effective policy
reports the new `configSource` value `parent`, and a denial inherited from a parent carries `inheritedFrom`. With no parent
explicitly disabled, every existing key's policy, source and denial are byte-identical. Also adds the refusal code
`STALE_CONTENT` and the line utilities `splitLines`, `joinLines`, `textToLines`, `alignLines`, `unifiedDiff`,
`DIFF_CONTEXT_LINES` and `MAX_DIFF_DISTANCE`.
