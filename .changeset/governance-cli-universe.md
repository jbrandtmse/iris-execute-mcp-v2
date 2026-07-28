---
"@iris-mcp/shared": patch
---

feat(governance): `iris-mcp-governance universe` — full governed-key universe render from built dist

A new additive command on the `iris-mcp-governance` CLI (Epic 32, Story 32.2): `universe [--profile <name>] [--file <path>] [--root <path>] [--json]` renders the FULL governance-key universe — the frozen baseline ∪ the five server packages' registered tool keys, derived from their built `dist/tools/index.js` with the exact `SERVER_PACKAGES` + `deriveKeysForTool` derivation the `iris-mcp-all` cross-package tests and the baseline generator use, ∪ the framework `iris_server_profiles` tool — with the REAL `mutates`/default-enabled classifications (`buildMutatesLookup`/`buildDefaultEnabledWrites` over the real dist tools). This is the render a running server's `iris_server_profiles` computes over its own registered subset: post-foundation write keys seed default-DISABLED (and F2 default-enabled writes ENABLED), which `effective`/`diff` — deliberately unchanged — cannot reproduce over their baseline-scoped universe.

Dist resolution: `--root <path>` (a monorepo root, or a directory containing the package folders) wins; otherwise the CLI auto-detects from its own install location (monorepo `packages/` layout, or npm `node_modules/@iris-mcp/` siblings). A package whose dist cannot be located fails with an actionable error naming every probed path. Every cascade render composes the shared `getEffectivePolicy`/`getEffectiveConfigSources` engine functions directly — nothing is reimplemented. Existing commands, the frozen baseline, and all tool/governance surfaces are byte-for-byte unchanged (additive only).
