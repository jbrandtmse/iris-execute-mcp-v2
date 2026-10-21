# Epic 42 Context: Published Install & Distribution

<!-- Generated from planning artifacts. Regenerate with compile-epic-context if planning docs change. -->

## Goal

Make installing the suite "install Node 22, run one command." The epic delivers:

- every `@iris-mcp/*` package on npm at `1.0.0`, with provenance, published by a gated release workflow;
- the VS Code extension on the Marketplace and Open VSX;
- the IPM package on the IPM registry and Open Exchange;
- a Claude Code plugin that brings all five servers plus the skills pack;
- an MCP Registry listing.

The code already launches through `npx`, but nothing is published, so every `npx` path fails today. The release must not downgrade IRIS classes on shared instances, must not publish from an unchecked state, and must not move clients across a major version.

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

## Requirements & Constraints

- **Versions.** All `@iris-mcp/*` packages share one version through the Changesets `fixed` group. The first release is exactly `1.0.0`, with one consolidated CHANGELOG section and no beta or prerelease tag. Until 42.6, changesets are `patch` or `minor` only, and no story runs `changeset version` or publishes.
- **Major pin.** Every `npx` spec the suite writes, spawns or documents carries `@1`. That covers servers, the client-config and governance CLIs, the extension and the plugin. A test finds any unpinned `@iris-mcp/` spec.
- **Node floor.** `engines.node >=22.17.0` in the root and in every publishable package, with `@types/node` pinned to the floor major. The extension declares no `engines.node`; `engines.vscode` governs it.
- **Package hygiene.**
  - Every package carries `license` (MIT), `repository` (with `directory`), `author`, `keywords`, `homepage` and `bugs`, checked by a test.
  - Dev-only exports never ship.
  - No required native dependency; a native module is allowed only as an optional dependency with a graceful skip.
- **No implied endorsement.** No package, publisher, plugin or listing name presents the suite as InterSystems'. The extension publisher name leaves out "intersystems".
- **IRIS support.** The claim stays 2023.1+, labelled best effort below the oldest CI-tested image. The README states both the claim and the tested range.
- **CI.** It is secret-free, publishes nothing, and uses only throwaway IRIS containers that refuse the live instance's ports.
- **Publishing.**
  - It runs only from a tagged, CI-green commit, through an approved protected environment, with npm provenance.
  - Secrets exist only in `release.yml`, and the root release script is the only way to publish.
  - Every listing that carries a version is a release step, or is declared version-less.
  - Nothing publishes before 42.2 lands.
- **Gates** are proven red on the path they guard, such as the tarball or publish path, not only in the default suite.
- **Accounts only the Lead can create:**
  - the npm `iris-mcp` organization: done, and the scope stays;
  - the Marketplace publisher and the Open VSX namespace (42.7);
  - an InterSystems Developer Community account (42.8);
  - the protected environment plus npm trusted publishing or a token (42.5).
- **Out of scope:** a public beta, 2.0 planning, and parallel test shards.

## Technical Decisions

- **One pin constant.** It lives in `@iris-mcp/client-config`. The extension has no runtime dependencies and no bundler, so it keeps one literal copy, and a cross-package test pins the copy equal to the constant.
- **`mcpName`.** Each server package sets it to `io.github.jbrandtmse/<bin>`, matching its MCP Registry `server.json`. It must be set before `1.0.0`, because the registry checks it against the published version.
- **Bootstrap version marker.** This is an assumption that 42.2 and 42.4 confirm.
  - It takes the form `<shared semver>+<content hash>`, and markers are ordered by semver.
  - Older deployments are upgraded. Newer ones are never downgraded; instead the bootstrap warns, naming both versions and the remedy.
  - A marker with the same semver but a different hash, or the `"dev"` placeholder, is foreign: no redeploy, and a warning.
  - Classes installed by IPM are never redeployed by the bootstrap, which reports the `zpm` command instead. The IPM path runs the same check on the IRIS side.
  - The marker is re-checked just before `Setup` compiles.
  - Builds from before the fix still downgrade, so the docs say to upgrade every client on a shared instance together.
- **REST compatibility.** Within a major, custom REST routes are additive-only: older requests are accepted and the response is a superset. This matters because the guard leaves newer classes in place for older `@1` clients. A pin proves it per route.
- **Generated artifacts change only through their generators:** the bootstrap embed, `ipm/module.xml` and the skills pack.
  - `module.xml` comes from the bootstrap class list, with the npm version.
  - IPM archives are built from the stamped generator output, never from `src/`.
  - A root `version` script, run by the Changesets version step, regenerates every artifact that embeds the version. The tag commit passes every `:check`.
- **Publishing goes through pnpm.** Only pnpm applies `publishConfig.exports` and rewrites `workspace:*`. `prepublishOnly` needs a reachable IRIS. The release script handles both.
- **Release toolchain facts for 42.5 to verify:**
  - Trusted publishing needs npm 11.5.1+, Node 22.14+ and `id-token: write`. pnpm 9 delegates to the system `npm`.
  - The Changesets OIDC fix is in 3.x, which needs pnpm 10+.
  - The first publish can't use a trusted publisher. A staged publish creates a `0.0.0-stage` placeholder, which conflicts with "no beta", so the Lead decides.
  - Marketplace global PATs end on 2026-12-01.
- **Frozen goldens** are never edited or recaptured.
  - Each sanctioned byte change is one ledger entry naming the golden, the row, a JSON pointer, the exact old and new values, and a sanction id that the CHANGELOG names.
  - 42.10 widens the ledger to accept stories after 43.4, corrections (not only appends), and the `audit` array.
  - 42.10's tool-surface fixes are sanctioned backward-compatibility changes: annotations, tool text, the Storage-guard extension and the audit namespace.
  - Overrides are parameters, never an `action` enum on a frozen-baseline tool, and governance `mutates` is unchanged. The tools-list snapshot is regenerated only by its generator.
- **After `1.0.0`.** A breaking change needs a new major. Dropping an end-of-life Node major is a minor release, announced in the CHANGELOG.
- **Live gates.** `IRIS_REQUIRE_LIVE` arms them, and they are listed in each package's `prepublish-gate.mjs` roster. From 42.3, CI runs every roster. A plain local `pnpm test` runs no live leg without an explicit opt-in.

## UX & Interaction Patterns

- **One install path per client:** the plugin for Claude Code, the extension for VS Code, and the `iris-mcp-clients` CLI for everything else. Every "not yet published" or clone-and-build caveat is removed.
- **The plugin** brings the five servers, with the IRIS connection supplied through the plugin's user configuration or environment, plus the skills pack (`packages/client-config/skills-pack/`) and the third-party notice.
  - Plugins can't carry rules, so the plugin README points to the installer for the always-on rule.
  - Once the plugin exists, the installer's Claude Code route installs only the rule.
  - The marketplace entry pins the release tag.
- **The extension** keeps the server major it recorded at first activation, and never changes it without the user's confirmation. This is an assumption that 42.7 confirms.

## Cross-Story Dependencies

- **Epic 43 is done.** The SDK v2 packages are pinned exactly at 2.3.1. Before the `1.0.0` tag, re-check for an SDK release that pins fast-uri 3.1.8 or later.
- **42.1 is done.** It delivered the `@1` constant, the floor, the metadata and exports checks, and the `1.0.0` mechanism. 42.3 gates on them, and 42.5 and 42.6 consume them.
- **42.10 and 42.2** both run before 42.6. 42.10 runs right after 42.1.
- **42.3's package job** picks up the IPM offline-install proof in 42.4. IPM publishes from 42.5's workflow, and its Open Exchange listing is in 42.8.
- **42.5's publish order** is npm first, in dependency order (client-config, shared, admin, data, dev, interop, ops, all), then the extension (42.7), then IPM (42.4).
  - A failed step stops the rest and reports which channels published.
  - A dry run is proven before the first real run.
- **42.6** needs 42.1 to 42.5 and 42.10, plus the Lead's npm organization and environment. A local tarball smoke test in a real client comes before the `v1.0.0` tag.
- **42.7, 42.8 and 42.9 follow npm `1.0.0`.**
  - 42.8 builds on Epic 41's pack and installer, and extends its provenance check to the plugin folder.
  - 42.9 re-certifies the clients against the published packages, and aligns the CHANGELOG and the PRD with what shipped.
