---
"@iris-mcp/interop": minor
"@iris-mcp/shared": minor
---

feat(interop): message body reader, the `iris_message_body` tool (Story 39.5)

`iris_message_body` reads the bodies of 1 to 20 messages by header ID and renders each by kind: an HL7 v2 body as ER7 text, an XML virtual document as XML, a persistent object as JSON (its `%JSON.Adaptor` export, otherwise a dump of its public properties), a stream or stream container as text, and a header with no body class as its literal value; any other body is shown as its class and ID with a reason. Each shown text is cut at `maxChars` (default 10000, at most 1048576), with `truncated`. It is a read, enabled by default, and stays enabled under the `read-only` preset. It is under the PHI data policy and is the first consumer of body text: the new route `POST /interop/message/body` is told which bodies it may read, so under `redact` (the default) IRIS reads HL7 v2 bodies only and the complete text goes through the redaction engine before it is sanitized and cut, `block` reads none, and `allow` shows bodies as stored; a call's `dataPolicy` can only tighten the profile's policy. The tool and `iris_message_search` are a pair in `TOOL_PAIRS`, in the `core` and `developer` presets. `@iris-mcp/shared` exports `decideBodyPolicy` and `BodyPolicyPlan`, which the resend preview now uses too. `Hl7Text` refuses a body over the cap from the stored segment sizes before it serializes it (DW-577), and `ValidateHeaderIds` takes a maximum. `BOOTSTRAP_VERSION` moves `b6ec56073e29` to `2fd17b50a024`, and the bootstrap embeds 32 classes.
