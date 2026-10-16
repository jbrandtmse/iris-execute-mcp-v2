---
"@iris-mcp/shared": minor
"@iris-mcp/dev": minor
---

feat: iris_doc_get reads a line range (Story 38.2)

`@iris-mcp/dev` (minor): `iris_doc_get` takes optional `startLine` and `endLine` (1-based, inclusive). A ranged read
returns the lines in the `cat -n` layout (the number right-aligned in 6 columns, a tab, then the line exactly), plus
`totalLines` and the document's version timestamp `ts`; an `endLine` past the end is clamped to the last line. Use it for
large classes, and to read the exact lines before changing them with `iris_doc_edit`, which uses the same line numbers.
Ranges apply only to UDL text, so a range with `metadataOnly` or `format: "xml"`, or on a binary document, is an error;
so are `startLine` after `endLine`, `startLine` past the last line and an unreadable document. Each error says how to
fix it. With neither parameter the request and the result are unchanged. The `metadataOnly` description now names `etag`.

`@iris-mcp/shared` (minor): the line utility exports `documentLines`, `linesInRange`, `formatNumberedLines` and
`NUMBERED_LINE_WIDTH`. `atelierDocStatusError` is unchanged; its documentation now covers any Atelier `/doc` result.
