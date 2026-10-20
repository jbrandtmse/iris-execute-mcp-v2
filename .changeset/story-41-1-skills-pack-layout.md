---
"@iris-mcp/client-config": minor
---

feat(skills-pack): ship the skills pack and its third-party notice (Epic 41, Story 41.1)

`@iris-mcp/client-config` now ships `skills-pack/` through its npm `files`: the committed, generated skills pack in the standard plugin layout (`skills/<name>/SKILL.md` for each skill, `rules/` for the always-on rule, a generated `README.md`), plus `IRIS-MCP-THIRD-PARTY-NOTICES.md`. Today it holds the 13 workflow skills and the notice. The pack is built by `pnpm gen:pack` from the generated `skills/` and the hand-authored `skills-pack-src/`, copying both byte for byte; no lifecycle hook copies it at publish time.

The notice carries the upstream MIT license text for content adapted from `intersystems-community/iris-agentic-dev` (byte-exact, pinned by sha256), credits its authors, and states that the suite is not affiliated with or endorsed by InterSystems Corporation. Adapted files carry a header line and a provenance row, checked in the default test suite along with the notice's presence in every npm tarball that carries pack or adapted content.

No tool, prompt, preset, governance key or route changes.
