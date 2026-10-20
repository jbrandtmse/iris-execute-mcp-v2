---
"@iris-mcp/shared": patch
"@iris-mcp/client-config": patch
---

fix: Epic 41 burn-down (Story 41.8)

`SanitizeError` removes the one leading status prefix in every message language the instance has, so a status read under an `Accept-Language` of fr, de, ja or any of eight other languages whose prefix it did not recognise no longer carries a doubled prefix (DW-622), and `Coverage.Job:SafeText` keeps the code of recorded text in any language without a wrapper prefix. `SanitizeError` and `SafeText` gain an optional trailing language argument, and a call without it behaves as before. The lines of a combined or embedded status are joined by a space. The error-handling knowledge skill in the `@iris-mcp/client-config` skills pack states what an empty or `0` status renders as. No tool, action, governance key, preset row, prompt, refusal code, environment variable or route is added or changed, so no tool count moves. `BOOTSTRAP_VERSION` moves from `5296a1c836f4` to `d51856f74d6a`.
