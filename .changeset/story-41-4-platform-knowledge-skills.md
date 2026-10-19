---
"@iris-mcp/client-config": minor
---

feat(skills-pack): three platform knowledge skills, one of them adapted, and the notice's first provenance row (Epic 41, Story 41.4)

`@iris-mcp/client-config` now ships six knowledge skills in its skills pack. The three new ones are `iris-mcp-objectscript-sql` (running SQL from ObjectScript with embedded SQL and `%SQL.Statement`), `iris-mcp-system-classes` (the `Config`, `SYS` and `Security` system classes, the `%SYS` namespace switch, and per-process against instance-wide counters) and `iris-mcp-interoperability` (business hosts, messages, adapters, settings and the production class). Every claim in them was run on IRIS 2026.2, and they name no tool. The installer that places them arrives in Story 41.6.

`iris-mcp-objectscript-sql` is adapted from the `objectscript-sql-patterns` skill of intersystems-community/iris-agentic-dev (MIT). It carries the adaptation header, and `IRIS-MCP-THIRD-PARTY-NOTICES.md`, which ships with the pack, gains its first provenance row.

No tool, action, governance key, preset, refusal code, route or bootstrapped class changes.
