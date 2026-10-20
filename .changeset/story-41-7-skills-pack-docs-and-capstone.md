---
"@iris-mcp/client-config": patch
---

docs(skills): document the skills pack installer and gate it with an every-client capstone (Epic 41, Story 41.7)

The README of `@iris-mcp/client-config` gains a generated table of the 17 clients the skills installer knows: for each, the `--client` id, the folders the pack is installed into, the folder or marked block that holds the always-on rule, why that route, and the documentation it was checked against. The table is rendered from the installer's own `PACK_TARGETS` by `scripts/render-certification-table.mjs`, whose `--check` fails when the README drifts. The README also shows example `skills install` and `skills uninstall` commands, and every documented command is run against the built bin in the tests.

The skills pack catalog (`skills-pack/README.md`) now says that the tool presets are not nested: `developer` is not `core` plus more tools, so a skill runs under its own preset and under `full`, but not necessarily under the other one. This ships in the package.

No API, command, option, route, tool, action, governance key, preset roster, prompt or bootstrapped class changes. `iris-mcp-clients` behaves exactly as before.
