# Epic 42 Context: Published Install & Distribution

<!-- Generated from planning artifacts. Regenerate with compile-epic-context if planning docs change. -->

## Goal

Make installing the suite "install Node 22, run one command." The epic delivers:

- every `@iris-mcp/*` package on npm at `1.0.0`, with provenance, published by a gated release workflow;
- the VS Code extension on the Marketplace and Open VSX;
- the IPM package on the IPM registry and Open Exchange;
- a Claude Code plugin that brings all five servers plus the skills pack;
- an MCP Registry listing.

The code already launches through `npx`, but nothing is published. Before `1.0.0` freezes the surface, the last tool-surface corrections land (annotations, tool text, audit namespace, and the Storage guard on every document write), because after `1.0.0` they would need a new major. The release must not downgrade IRIS classes on shared instances, must not publish from an unchecked state, and must not move clients across a major version.

## Stories

- Story 42.1: Pre-Publish Package Fixes
- Story 42.2: Bootstrap Downgrade Guard
- Story 42.3: CI Workflow
- Story 42.4: IPM Package Revival
- Story 42.5: Release Workflow
- Story 42.6: Tarball Smoke and 1.0.0 Publish
- Story 42.7: VS Code Extension Publish
- Story 42.8: Claude Code Plugin and Registry Listings
- Story 42.9: Install Docs and Client Re-Certification
- Story 42.10: Pre-1.0 Tool-Surface Corrections
- Story 42.11: Storage Guard on Every Document Write

## Requirements & Constraints

- **Versions.** All `@iris-mcp/*` packages share one version through the Changesets `fixed` group. The first release is exactly `1.0.0`, with one consolidated CHANGELOG section and no beta or prerelease tag. Until 42.6, changesets are `patch` or `minor` only, and no story runs `changeset version` or publishes.
- **Major pin.** Every `npx` spec the suite writes, spawns or documents carries `@1`: servers, the client-config and governance CLIs, the extension and the plugin. A test finds any unpinned `@iris-mcp/` spec.
- **Node floor.** `engines.node >=22.17.0` in the root and every publishable package, with `@types/node` pinned to the floor major. The extension declares no `engines.node`; `engines.vscode` governs it.
- **Package hygiene.** Every package carries `license` (MIT), `repository` (with `directory`), `author`, `keywords`, `homepage` and `bugs`, checked by a test. Dev-only exports never ship. No required native dependency; a native module is only an optional dependency with a graceful skip.
- **No implied endorsement.** No package, publisher, plugin or listing name presents the suite as InterSystems'. The extension publisher name leaves out "intersystems".
- **IRIS support.** The claim stays 2023.1+, labelled best effort below the oldest CI-tested image. The README states both the claim and the tested range.
- **CI** is secret-free, publishes nothing, and uses only throwaway IRIS containers that refuse the live instance's ports.
- **Publishing** runs only from a tagged, CI-green commit, through an approved protected environment, with npm provenance. Secrets exist only in `release.yml`; the root release script is the only way to publish. Every listing that carries a version is a release step or is declared version-less. Nothing publishes before 42.2 lands.
- **Gates** are proven red on the path they guard (the tarball or publish path, not only the default suite).
- **Storage guard on every document write.** Every path that can replace an existing class (`iris_doc_put`, `iris_doc_edit`, `iris_doc_load`, the `iris_doc_xml_export` import, `iris_env_promote` execute) refuses by default a write that would drop a Storage definition the deployed class has, naming the definitions and the override. With the explicit `allowStorageRegeneration` override the write proceeds and the result names what was dropped. Each tool's governance classification is unchanged. Each path gets a live refusal pin, proven red by removing that path's guard.
- **Shared-instance live testing.** Never stop or restart the shared IRIS; simulate outages with a closed local port. Writes go only to disposable `ExecuteMCPv2.Temp.*` artifacts or story-created namespaces, removed afterwards.
- **Accounts only the Lead can create:** the npm `iris-mcp` organization (done; the scope stays); the Marketplace publisher and Open VSX namespace (42.7); an InterSystems Developer Community account (42.8); the protected environment plus npm trusted publishing or a token (42.5).
- **Out of scope:** a public beta, 2.0 planning, and parallel test shards.

## Technical Decisions

- **One pin constant** lives in `@iris-mcp/client-config`. The extension (no runtime dependencies, no bundler) keeps one literal copy, pinned equal to the constant by a cross-package test.
- **`mcpName`.** Each server package sets `io.github.jbrandtmse/<bin>`, matching its MCP Registry `server.json`; it must be set before `1.0.0`.
- **Bootstrap version marker** (an assumption 42.2 and 42.4 confirm): `<shared semver>+<content hash>`, ordered by semver. Older deployments upgrade; newer ones are never downgraded and the bootstrap warns, naming both versions and the remedy. Same semver with a different hash, or the `"dev"` placeholder, is foreign: no redeploy, plus a warning. IPM-installed classes are never redeployed by bootstrap (it reports the `zpm` command), and the IPM path runs the same check IRIS-side. The marker is re-checked just before `Setup` compiles. Pre-fix builds still downgrade, so docs say to upgrade every client on a shared instance together.
- **REST compatibility.** Within a major, custom REST routes are additive-only (older requests accepted, response a superset), because the guard leaves newer classes in place for older `@1` clients. A pin proves it per changed route.
- **Generated artifacts change only through their generators** (bootstrap embed, `ipm/module.xml`, skills pack). `module.xml` comes from the bootstrap class list with the npm version; IPM archives are built from stamped generator output, never `src/`. A root `version` script, run by the Changesets version step, regenerates every version-embedding artifact; the tag commit passes every `:check`.
- **Publishing goes through pnpm.** Only pnpm applies `publishConfig.exports` and rewrites `workspace:*`; `prepublishOnly` needs a reachable IRIS. The release script handles both.
- **Release toolchain facts for 42.5 to verify:** trusted publishing needs npm 11.5.1+, Node 22.14+ and `id-token: write` (pnpm 9 delegates to system `npm`); the Changesets OIDC fix is in 3.x, which needs pnpm 10+; the first publish can't use a trusted publisher, and a staged publish's `0.0.0-stage` placeholder conflicts with "no beta", so the Lead decides; Marketplace global PATs end 2026-12-01.
- **Frozen goldens** are never edited or recaptured. Each sanctioned byte change is one ledger entry (golden, row, JSON pointer, exact old and new values, a sanction id the CHANGELOG names); every other byte must stay unchanged. Entries may come from any story after the capture; a description change appends unless its sanction is a recorded correction (then it replaces); handler entries may address the `audit` array. The tools-list snapshot is regenerated only by its generator, with exactly one entry per moved byte.
- **Annotations.** An existing tool's hint changes only through a sanctioned change. A non-read-only tool declaring `destructiveHint: false` must be on a justified list, and no tool with a delete, remove, purge, kill or clean action may declare it; both are checked mechanically.
- **Audit namespace.** A `SYS`-scoped tool's entry records `namespace: "%SYS"`; a non-empty string `namespace` argument goes in the additive `targetNamespace` field regardless of `IRIS_AUDIT_LOG_PARAMS`. Other tools record the override or the profile default.
- **Storage-guard extension design.** One shared guard in `@iris-mcp/shared` serves every path; no per-tool copy. The override is a parameter, never an `action` enum on a frozen-baseline tool. `iris_doc_load` refuses per file as a `failures[]` entry with code `STORAGE_DROPPED`. The XML import refuses the whole import before its single POST, using per-class Storage names read from the XML. `iris_env_promote` runs a GET-only preflight before its confirmation dialog, reusing the checked source text (no TOCTOU); with the override, the dialog's scope names the drops. Each new refusal is a sanctioned backward-compatibility change named in the CHANGELOG, and the architecture's document-write rule drops its recorded exclusions. Document-write roster tests list every path as guarded.
- **After `1.0.0`**, a breaking change needs a new major. Dropping an end-of-life Node major is a minor release, announced in the CHANGELOG.
- **Live gates** are armed by `IRIS_REQUIRE_LIVE` and listed in each package's `prepublish-gate.mjs` roster; from 42.3, CI runs every roster. A plain local `pnpm test` runs no live leg without an explicit opt-in.

## UX & Interaction Patterns

- **One install path per client:** the plugin for Claude Code, the extension for VS Code, and the `iris-mcp-clients` CLI for everything else. Every "not yet published" or clone-and-build caveat is removed.
- **The plugin** brings the five servers (IRIS connection via the plugin's user configuration or environment), the skills pack (`packages/client-config/skills-pack/`) and the third-party notice. Plugins can't carry rules, so its README points to the installer for the always-on rule; once the plugin exists, the installer's Claude Code route installs only the rule. The marketplace entry pins the release tag.
- **The extension** keeps the server major it recorded at first activation and never changes it without the user's confirmation (an assumption 42.7 confirms).

## Cross-Story Dependencies

- **Epic 43 is done.** SDK v2 packages are pinned exactly at 2.3.1. Right before the `1.0.0` tag, re-check for an SDK release pinning fast-uri 3.1.8+.
- **42.1 is done:** the `@1` constant, the floor, the metadata and exports checks, and the `1.0.0` mechanism. 42.3 gates on them; 42.5 and 42.6 consume them.
- **42.10 is done:** the widened goldens ledger (later stories, corrections, the `audit` array), 13 tools corrected to `destructiveHint: true`, the corrected resend text, and the SYS-scoped audit namespace.
- **42.11 runs next.** It consumes 42.10's goldens machinery and must be done before 42.6.
- **42.2** runs before 42.6; nothing publishes before the downgrade guard.
- **42.3's package job** picks up 42.4's IPM offline-install proof. IPM publishes from 42.5's workflow; its Open Exchange listing is in 42.8.
- **42.5's publish order:** npm first, in dependency order (client-config, shared, admin, data, dev, interop, ops, all), then the extension (42.7), then IPM (42.4). A failed step stops the rest and reports which channels published. A dry run is proven before the first real run.
- **42.6** needs 42.1–42.5, 42.10 and 42.11, plus the Lead's npm organization and environment. A local tarball smoke in a real client comes before the `v1.0.0` tag.
- **42.7, 42.8 and 42.9 follow npm `1.0.0`.** 42.8 builds on Epic 41's pack and installer and extends its provenance check to the plugin folder. 42.9 re-certifies clients against the published packages and aligns the CHANGELOG and PRD with what shipped.
