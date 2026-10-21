---
"@iris-mcp/shared": minor
"@iris-mcp/dev": minor
---

feat: the Storage guard covers every document write (Story 42.11, DW-652)

- `iris_doc_load`, the `iris_doc_xml_export` import and `iris_env_promote` `execute` now refuse by default a write that would drop one of the Storage definitions an existing class has, with `STORAGE_DROPPED` and nothing changed, because IRIS would generate new storage at the next compile, which can change how existing rows are read. `iris_doc_load` refuses per file (a `failures` entry; the other files continue), the import refuses the whole import before its one POST, and `execute` runs a GET-only preflight before its confirmation dialog and refuses the whole execute before any write. A new class and a write that drops nothing are unchanged, apart from the GETs that read the class.
- Each of the three tools takes the optional `allowStorageRegeneration` parameter (default `false`): with `true` the write goes ahead and the result's `storageDrops` names what was dropped. `iris_env_promote` writes the source text its preflight read, and its dialog names the drops.
- The `iris_doc_load` `ignoreConflict` text now says "without a version check" where it said "unconditionally", and one sentence is appended to each of the three descriptions. Both are sanctioned AD-15 changes (`S-42.11-storage-guard-schema`, `S-42.11-storage-guard-text`); the frozen SDK goldens stay byte-unchanged.
- `@iris-mcp/shared` exports `droppedStorageNames`, `xmlClassStorageNames`, `storageDroppedText`, `storageDroppedDetail`, `storageDrop`, `describeStorageDrops` and `storageDropsRefusal`, with the types `StorageDroppedDetail` and `StorageDrop`.

No tool, action, governance key, preset row, annotation, refusal code or ObjectScript class is added or changed, and the governance baseline stays `1e62c5ad5bf7` (141 keys).
