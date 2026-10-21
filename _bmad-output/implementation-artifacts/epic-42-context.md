# Epic 42 Context: Published Install & Distribution

<!-- Generated from planning artifacts. Regenerate with compile-epic-context if planning docs change. -->

## Goal

Make installing the suite "install Node 22, run one command." The epic delivers:

- every `@iris-mcp/*` package on npm at `1.0.0`, with provenance, published by a gated release workflow;
- the VS Code extension on the Marketplace and Open VSX;
- the IPM package on the IPM registry and Open Exchange;
- a Claude Code plugin that brings all five servers plus the skills pack;
- an MCP Registry listing.

The code already launches through `npx`, but nothing is published. The last tool-surface corrections land before `1.0.0` freezes the surface, because after it they would need a new major. The release must not downgrade IRIS classes on a shared instance, must not publish from an unchecked state, and must not move clients across a major version.

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
- **Major pin.** Every `npx` spec the suite writes, spawns or documents carries `@1`, and a test finds any unpinned `@iris-mcp/` spec.
- **Node floor.** `engines.node >=22.17.0` in the root and every publishable package, with `@types/node` pinned to the floor major. The extension declares no `engines.node`; `engines.vscode` governs it.
- **Package hygiene.** Full metadata on every package (MIT `license`, `repository` with `directory`, `author`, `keywords`, `homepage`, `bugs`), checked by a test. Dev-only exports never ship. No required native dependency.
- **No implied endorsement.** No package, publisher, plugin, marketplace or listing name presents the suite as InterSystems'; "intersystems" stays out of the publisher name.
- **IRIS support.** The claim stays 2023.1+, labelled best effort below the oldest CI-tested image; the README states the claim and the tested range.
- **No downgrade.** The bootstrap never downgrades IRIS-side classes deployed by a newer build. Nothing publishes before 42.2 lands.
- **CI** is secret-free, publishes nothing, and uses only throwaway IRIS containers that refuse the live instance's ports.
- **Publishing** runs only from a tagged, CI-green commit, through an approved protected environment, with npm provenance. Secrets exist only in `release.yml`; the root release script is the only way to publish. Every listing that carries a version is a release step or is declared version-less.
- **Gates** are proven red on the path they guard (the tarball or publish path, not only the default suite).
- **Live legs need an explicit opt-in.** A plain local `pnpm test` must touch no IRIS instance. Live legs run only when armed (`IRIS_REQUIRE_LIVE`, or an `IRIS_HOST` the caller set), and armed lead and CI runs keep working.
- **Shared-instance live testing.** Never stop or restart the shared IRIS; simulate outages with a closed local port. Writes go only to disposable `ExecuteMCPv2.Temp.*` artifacts or story-created namespaces, removed afterwards.
- **Accounts only the Lead can create:** the npm `iris-mcp` organization (done; the scope stays); the Marketplace publisher and Open VSX namespace (42.7); an InterSystems Developer Community account (42.8); the protected environment plus npm trusted publishing or a token (42.5).
- **Out of scope:** a public beta, 2.0 planning, and parallel test shards.

## Technical Decisions

- **Bootstrap version marker** (an assumption that 42.2 and 42.4 confirm). The marker is `<shared semver>+<content hash>`, stamped at generation and ordered by semver:
  - an older deployment is upgraded;
  - a newer one is never redeployed, and the bootstrap warns, naming both markers and the remedy;
  - an equal semver with a different hash, or the source `"dev"` placeholder, is foreign: no redeploy, plus a warning;
  - classes that IPM installed are never redeployed by bootstrap, which reports the `zpm` command instead. The IPM install and upgrade path runs the same check IRIS-side;
  - the marker is re-checked immediately before `Setup` compiles.

  Builds made before the fix still downgrade, so the docs tell operators to upgrade every client on a shared instance together.
- **REST compatibility.** Within a major, custom REST routes are additive-only: older requests are accepted and the response is a superset. This is needed because the guard leaves newer classes in place for older `@1` clients. A pin proves it for each route a story changes.
- **Generated artifacts change only through their generators** (the bootstrap embed, `ipm/module.xml`, the skills pack). A bootstrapped-class change regenerates the embed in the same story; the generator, drift test and version scheme move together. `module.xml` is generated from the bootstrap class list and carries the npm version. IPM archives are built from stamped generator output, never from `src/`. A root `version` script, run by the Changesets version step, regenerates every version-embedding artifact, and the tag commit passes every `:check`.
- **One pin constant** lives in `@iris-mcp/client-config`. The extension, which has no runtime dependencies and no bundler, keeps one literal copy that a cross-package test pins equal to it.
- **`mcpName`.** Each server package sets `io.github.jbrandtmse/<bin>`, matching its MCP Registry `server.json`.
- **Publishing goes through pnpm.** Only pnpm applies `publishConfig.exports` and rewrites `workspace:*`, and `prepublishOnly` needs a reachable IRIS. The release script handles both.
- **Release toolchain facts for 42.5 to verify:**
  - trusted publishing needs npm 11.5.1+, Node 22.14+ and `id-token: write`, and pnpm 9 delegates publishing to the system `npm`;
  - the Changesets OIDC fix is in 3.x, which needs pnpm 10+;
  - the first publish can't use a trusted publisher, and a staged publish's `0.0.0-stage` placeholder conflicts with "no beta tag", so the Lead decides;
  - Marketplace global PATs end on 2026-12-01.
- **Pre-1.0 wire changes.** Each one is a sanctioned backward-compatibility change, named in the CHANGELOG with its story, and recorded through the frozen-goldens ledger. Frozen goldens are never edited or recaptured: one entry per changed byte, and every other byte stays unchanged. The sanctioned-change list is pruned into the CHANGELOG at the Epic 42 retro.
- **Storage guard on every document write** (landed in 42.11). One shared guard in `@iris-mcp/shared` covers `iris_doc_put`, `iris_doc_edit`, `iris_doc_load`, the `iris_doc_xml_export` import and `iris_env_promote` execute. By default it refuses a Storage-dropping write with `STORAGE_DROPPED`, and nothing changes. The `allowStorageRegeneration` override lets the write proceed, and the result's `storageDrops` names what was dropped. The bootstrap PUT is not applicable, because its classes have no Storage. A grep test fails on any new document-write path that has no verdict.
- **Live gates** are armed by `IRIS_REQUIRE_LIVE` and listed in each package's `prepublish-gate.mjs` roster. Cross-package gates live in `iris-mcp-all`. From 42.3, CI runs every roster.
- **After `1.0.0`**, a breaking change needs a new major. Dropping an end-of-life Node major is a minor release, announced in the CHANGELOG.

## UX & Interaction Patterns

- **One install path per client:** the plugin for Claude Code, the extension for VS Code, and the `iris-mcp-clients` CLI for everything else. Every "not yet published" or clone-and-build caveat is removed.
- **The plugin** brings:
  - the five servers, with the IRIS connection supplied through the plugin's user configuration or the environment;
  - the skills pack (`packages/client-config/skills-pack/`);
  - the third-party notice.

  Plugins can't carry rules, so its README points to the installer for the always-on rule. Once the plugin exists, the installer's Claude Code route installs only the rule. The marketplace entry pins the release tag.
- **The extension** keeps the server major it recorded at first activation, and never changes it without the user's confirmation (an assumption that 42.7 confirms).

## Cross-Story Dependencies

- **Epic 43 is done.** The SDK v2 packages are pinned exactly at 2.3.1. Right before the `1.0.0` tag, re-check for an SDK release that pins fast-uri 3.1.8+.
- **42.1 is done.** It delivered the `@1` constant, the Node floor, the metadata and exports checks, and the `1.0.0` mechanism. 42.3 gates on them; 42.5 and 42.6 consume them.
- **42.10 is done.** It widened the goldens ledger (later stories, corrections, handler `audit` entries), corrected 13 tools to `destructiveHint: true`, fixed the resend text, and made a SYS-scoped tool's audit namespace `%SYS`.
- **42.11 is done.** It landed the storage guard on every write path, `allowStorageRegeneration` and `storageDrops`. `@iris-mcp/shared` now exports `CONFIRMATION_TEXT_LIMIT` (600), the cut-off for the target and scope that a confirmation dialog shows.
- **42.2 runs next.** It must be done before 42.6, because nothing publishes before the downgrade guard. It also owns two live-gate items:
  - the version-ordered guard must hold against the default-suite outage gate, which deploys the bootstrap on first touch. The gate's write footprint is recorded;
  - every live leg moves behind an explicit opt-in.
- **42.3's package job** picks up 42.4's IPM offline-install proof. IPM publishes from 42.5's workflow, and its Open Exchange listing is in 42.8.
- **42.5's publish order:** npm first, in dependency order (client-config, shared, admin, data, dev, interop, ops, all); then the extension (42.7); then IPM (42.4). A failed step stops the rest and reports which channels published. A dry run is proven before the first real run.
- **42.6** needs 42.1–42.5, 42.10 and 42.11, plus the Lead's npm organization and environment. A local tarball smoke in a real client comes before the `v1.0.0` tag.
- **42.7, 42.8 and 42.9 follow npm `1.0.0`.**
  - 42.8 builds on Epic 41's pack and installer, and extends its provenance check to the plugin folder.
  - 42.9 re-certifies the clients against the published packages, and aligns the CHANGELOG and the PRD with what shipped.
