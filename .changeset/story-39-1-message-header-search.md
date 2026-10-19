---
"@iris-mcp/shared": minor
"@iris-mcp/interop": minor
---

feat: message header search (Story 39.1)

`@iris-mcp/interop` (minor): new read tool `iris_message_search` (interop 22 to 23 tools). Its `action` enum is fixed:
`headers` returns paged message-header rows for a required window of at most 7 days, filtered by item, source, target,
status, session, body class and error flag, with a keyset cursor and a `limit` of 100 (500 at most) that caps the output
only; `body` and `searchTable` answer with the `NOT_IMPLEMENTED` refusal until Stories 39.3 and 39.4. All three
governance keys are reads and are enabled by default. New route `POST /interop/message/search` and handler
`ExecuteMCPv2.REST.MessageSearch`, which also owns the filters-to-WHERE helper that `resendFiltered` now uses (its dry runs
and guard refusals answer byte for byte as before; the path that resends is covered by `MessageResendLiveTest` only). The `core` preset gains `iris_message_search` (10 to 11 runtime tools).

`@iris-mcp/shared` (minor): the refusal code `NOT_IMPLEMENTED`, and the bootstrap embed now holds 31 classes
(`ExecuteMCPv2.REST.MessageSearch` is new).
