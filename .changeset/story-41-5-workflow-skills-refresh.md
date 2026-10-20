---
"@iris-mcp/shared": minor
"@iris-mcp/client-config": minor
"@iris-mcp/dev": patch
"@iris-mcp/admin": patch
"@iris-mcp/interop": patch
"@iris-mcp/ops": patch
---

feat(skills): workflow skills with their own descriptions and tool presets, and a catalog of the pack (Epic 41, Story 41.5)

`@iris-mcp/shared` adds the optional `skill: { description, preset }` field to `PromptDefinition` (the `PromptSkillDefinition` type). It is read only by the skill generator and the prompt validator: the prompts the servers list and render are unchanged, byte for byte, and neither the skill description nor the preset ever reaches `prompts/list` or `prompts/get`. `@iris-mcp/dev`, `@iris-mcp/admin`, `@iris-mcp/interop` and `@iris-mcp/ops` set it on their 12 prompts.

`@iris-mcp/client-config` now ships the 12 generated workflow skills with a description that says what each covers and when to use it, a `metadata` map that declares the tool preset (`core`, `developer` or `full`) under which every tool the skill names is visible, and a one-line generated-file comment. Its pack README is now a catalog of the six knowledge skills, the twelve workflow skills and the always-on rule. The installer that places them arrives in Story 41.6.

No tool, action, governance key, preset roster, refusal code, route or bootstrapped class changes.
