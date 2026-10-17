---
"@iris-mcp/interop": minor
---

feat(interop): the `find-patient-messages` prompt and a forensic `trace-message-flow` (Story 39.6)

The Interoperability server gains the prompt `find-patient-messages`, which finds a patient's messages by a Search Table value (`iris_message_search` `searchTable`, `PatientID`) in windows of at most 7 days and reads bodies with `iris_message_body` only when the user wants content, under the PHI data policy. `trace-message-flow` now searches the headers of a session, reads the bodies that matter, draws the diagram and reads the logs of erroring items; its name, title and arguments are unchanged. Both prompts call reads only, which are enabled by default, keep their main path in the `core` preset, never loosen the data policy and never read a withheld body another way. No tool, action, governance key or default is added, so no tool count moves, and the prompt pack goes from 12 to 13 prompts.
