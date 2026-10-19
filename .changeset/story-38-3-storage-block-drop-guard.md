---
"@iris-mcp/shared": minor
"@iris-mcp/dev": minor
---

feat: iris_doc_put refuses a put that drops a class's Storage definition (Story 38.3)

`@iris-mcp/dev` (minor): safety change. `iris_doc_put` refuses a put to an existing class whose content drops one of
the class's Storage definitions: `isError: true`, nothing stored, and `structuredContent`
`{ code: "STORAGE_DROPPED", name, namespace, droppedStorage }`. IRIS would otherwise generate new storage at the next
compile, which can change how existing rows are read. The new optional `allowStorageRegeneration` (default false) lets the
put through. Names are compared exactly; a rename is a drop; changing a definition's content is allowed. New classes,
routines and other document types are unchanged. Fixes DW-540: an existing document is now saved without `ignoreConflict`
(the tool reads the current version from IRIS's 409 and saves with `If-None-Match`; a 409 on that save returns
`DOCUMENT_CONFLICT`), and the `ignoreConflict` description is corrected. Fixes DW-541: `iris_doc_get` `metadataOnly`
returns `{ exists, name, etag }` without the never-filled `timestamp` key.

`@iris-mcp/shared` (minor): adds the refusal-code catalog (`REFUSAL_CODES`, `refusalResult`, `RefusalCode`,
`RefusalResult`) and the Storage-drop guard (`isClassDocument`, `storageDefinitionNames`, `droppedStorageDefinitions`,
`storageDroppedRefusal`). The governance denial result is byte-identical.
