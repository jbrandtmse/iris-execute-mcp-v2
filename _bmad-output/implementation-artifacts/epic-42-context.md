# Epic 42 Context: Published Install & Distribution

<!-- Generated from planning artifacts. Regenerate with compile-epic-context if planning docs change. -->

## Goal

Make installing the suite "install Node 22, run one command." The epic delivers:

- every `@iris-mcp/*` package on npm at `1.0.0`, with provenance, published by a gated release workflow;
- the VS Code extension on the Marketplace and Open VSX;
- the IPM package on the IPM registry and Open Exchange;
- a Claude Code plugin that brings all five servers plus the skills pack;
- an MCP Registry listing.

The code already launches through `npx`, but nothing is published yet. The release must not downgrade IRIS classes on a shared instance, must not publish from an unchecked state, and must not move clients across a major version.

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

- **What users get.** Install from npm (`1.0.0`, Node 22+) with clients launching `@1`. The bootstrap never downgrades IRIS classes that a newer build deployed. An IRIS administrator can install the IRIS-side classes through IPM, backed by an offline install proof. Claude Code users install one plugin, and VS Code users install the extension from either store.
- **Versions.** All `@iris-mcp/*` packages share one version through the Changesets `fixed` group. The first release is exactly `1.0.0`, with one consolidated CHANGELOG section and no beta or prerelease tag. Until 42.6, changesets are `patch` or `minor` only, and no story runs `changeset version` or publishes.
- **Major pin.** Every `npx` spec the suite writes, spawns or documents carries `@1`.
- **Node floor.** `engines.node >=22.17.0`. The extension declares no `engines.node`; `engines.vscode` governs it.
- **Package hygiene.** Full metadata on every package. Dev-only exports never ship. No required native dependency.
- **No implied endorsement.** No package, publisher, plugin, marketplace or listing name presents the suite as InterSystems'.
- **IRIS support.** The claim stays 2023.1+, labelled best effort below the oldest CI-tested image. The oldest green CI tag is the tested floor that the README states.
- **CI** is secret-free, publishes nothing, and uses only throwaway IRIS containers that refuse the live instance's ports.
- **Publishing** runs only from a tagged, CI-green commit, through an approved protected environment, with npm provenance. Secrets exist only in `release.yml`. The root release script is the only way to publish. Every listing that carries a version is a release step or is declared version-less.
- **Gates prove they can fail.** Prove each gate red on the path it guards, not only in the default suite. Each new self-test or check is broken once on a throwaway branch, and the red run's URL is recorded.
- **Shared-instance live testing.** Never stop or restart the shared IRIS; simulate outages with a closed local port. Writes go only to disposable `ExecuteMCPv2.Temp.*` artifacts or story-created namespaces, removed afterwards.
- **Accounts only the Lead can create:** the npm `iris-mcp` organization (done; the scope stays); the Marketplace publisher and Open VSX namespace (42.7); an InterSystems Developer Community account (42.8); the protected environment plus npm trusted publishing or a token (42.5).
- **Out of scope:** a public beta, 2.0 planning, and parallel test shards.

## Technical Decisions

- **Bootstrap version marker (landed in 42.2).** The marker is `<shared semver>+<sequence>.<content hash>`. Markers order by semver, then sequence.
  - **Older**, including a bare 12-hex pre-42.2 marker, means upgrade.
  - **Newer**, **foreign** (equal semver and sequence with a different hash, `"dev"`, or unparseable) and **unknown** (a failed or empty read) mean no redeploy, plus one warning naming both markers and the remedy.
  - Only a positive absence installs. The marker is re-checked before each compile.
- **Ownership and IPM upgrades (42.4 confirms or corrects, and amends the spine).** Each deployment has one owner. Bootstrap detects IPM-installed classes and never redeploys them; instead it reports the mismatch and the `zpm` command. The IPM install/upgrade path runs the same no-downgrade check IRIS-side, reusing the marker grammar and ordering, with a parity test against the TypeScript comparator.
- **IPM manifest (42.4).**
  - `ipm/module.xml` is generated and output-only. It is built from `gen-bootstrap.mjs` `classes[]`, and its version is the npm version.
  - Its drift test runs in the default suite and is proven red. The class count is pinned mechanically.
  - IPM archives are built from stamped generator output, never from `src/`.
- **IPM `Configure`.** It sets up the REST app with no application roles or `MatchRoles`; handlers run with the user's own privileges.
- **IRIS-side changes** follow the thin-handler, one-envelope and namespace save/restore conventions. Changing a bootstrapped class regenerates the embed in the same story, and a new class joins both rosters.
- **REST compatibility.** Within a major, custom REST routes are additive-only. This matters because the guard leaves newer classes in place for older `@1` clients. A pin proves it for each route a story changes.
- **CI (landed in 42.3).**
  - **Jobs.** `ci.yml` has three jobs:
    - `gates`, on Node 22.17.0, 24.0.0 and 26.0.0;
    - `throwaway`;
    - `package`, which runs only after both pass. So CI, not a `prepack` hook, is the publish-time gate.
  - **Registering a gate.** A new gate goes in `scripts/lib/ci-checks.mjs` and in `ci.yml`, and a self-test enforces that the two match.
  - **Pins.** Every action is pinned to a SHA and every tool to an exact version. No `continue-on-error` and no `|| true`.
  - **Skips.** An armed suite fails on any skipped test its allowlist doesn't name with a reason (`scripts/ci-live-suite.mjs`).
- **IRIS CI images**, each pinned by manifest-list digest:
  - `irishealth-community:2026.2` in `HSCUSTOM`, seeded, for the armed rosters, integration suites, process gates and launcher live files;
  - `iris-community:2026.2` plus an oldest leg in `USER`, for the bootstrap guard.
  - Community license keys expire, so every image moves forward before its key does. 42.4 moves the oldest leg from 2025.3 (key expires 2026-11-13) to 2026.1 (key valid to 2027-03-27), and keeps 2025.3's green run of 2026-10-22 as support-claim evidence (DW-686).
- **Live gates.**
  - Only `IRIS_REQUIRE_LIVE` arms a live leg. An armed leg needs all five `IRIS_HOST`, `IRIS_PORT`, `IRIS_USERNAME`, `IRIS_PASSWORD` and `IRIS_NAMESPACE`, with no defaults; unarmed, it makes no request.
  - Gates are listed in each package's `prepublish-gate.mjs` `gateTestFiles`.
  - The throwaway gate arms on `IRIS_THROWAWAY` and stays off the rosters.
- **Throwaway containers.**
  - **Why.** A check that deploys `ExecuteMCPv2` can't be isolated on the shared instance, because the `%ALL` mapping wins.
  - **The script.** `scripts/throwaway-iris.mjs` (`up`, `exec`, `logs`, `down`) creates, labels and removes only its own container.
  - **On a dev machine.** One runs only with the Lead's authorization, started by the lead or a stage the lead names. The lead checks that none is left, and removes the images it pulled.
- **Generated artifacts change only through their generators.** The 42.5 root `version` script, run by the Changesets version step, regenerates every artifact that embeds the version, and the tag commit passes every `:check`.
- **Pins and listings.**
  - One pin constant lives in `@iris-mcp/client-config`; the extension keeps one literal copy, pinned equal to it by a test.
  - Each server package's `mcpName` is `io.github.jbrandtmse/<bin>`, matching its MCP Registry `server.json`.
- **Release mechanics (42.5).**
  - **Publishing goes through pnpm.** Only pnpm applies `publishConfig.exports` and rewrites `workspace:*`. The release script exports all five `IRIS_*` for its gate run.
  - **Trusted publishing** needs npm 11.5.1+, Node 22.14+ and `id-token: write`. pnpm 9 delegates publishing to the system `npm`. The Changesets OIDC fix is in 3.x, which needs pnpm 10+.
  - **The first publish** can't use a trusted publisher, and a staged publish's `0.0.0-stage` placeholder conflicts with "no beta tag", so the Lead chooses the route.
  - **Marketplace.** Global PATs stop working on 2026-12-01.
  - **Also decided in 42.5:** the bad-release policy and `SECURITY.md`. The version policies for the extension, the plugin and IPM are decided in 42.7, 42.8 and 42.4.
- **Pre-1.0 wire changes** are sanctioned changes named in the CHANGELOG with their story. Frozen goldens are never edited; each changed byte gets one sanctioned-change ledger entry. The sanctioned list is pruned into the CHANGELOG at the Epic 42 retro. After `1.0.0`, a breaking change needs a new major.

## UX & Interaction Patterns

- **One install path per client:** the plugin for Claude Code, the extension for VS Code, and the `iris-mcp-clients` CLI for everything else. Every "not yet published" or clone-and-build caveat is removed.
- **The plugin** brings the five servers (IRIS connection from plugin user config or env), the skills pack and the third-party notice. Plugins can't carry rules, so its README points to the installer. Once the plugin exists, the installer's Claude Code route installs only the rule. The marketplace entry pins the release tag.
- **The extension** keeps the server major it recorded at first activation, and never changes it without the user's confirmation. This is an assumption that 42.7 confirms.

## Cross-Story Dependencies

- **Epic 43 is done.** The SDK v2 packages are pinned exactly at 2.3.1. Right before the `1.0.0` tag, re-check for an SDK release that pins fast-uri 3.1.8+ (DW-637).
- **Done:**
  - 42.1: the pin, floor, metadata and exports checks, and the `1.0.0` mechanism;
  - 42.10: the widened goldens ledger and the tool-surface corrections;
  - 42.11: the storage guard on every document-write path;
  - 42.2: the downgrade guard, opt-in live gates and the throwaway script;
  - 42.3: CI, which runs the bootstrap-guard live proof (DW-672) and the no-skip rule (DW-676).
- **42.4 runs next.** It has three parts:
  - **The IPM offline install proof**, run in the 42.3 `package` job (the seam). It builds the archive on one throwaway and installs it on a second with `--network none`, on both editions. It asserts that nothing was fetched, the classes compiled, and the REST app is configured.
  - **The bootstrap's `zpm` fallback message**, made accurate for the published package.
  - **DW-674 and DW-686**, as described above.
- **42.5** publishes in order:
  1. npm, in dependency order (client-config, shared, admin, data, dev, interop, ops, all);
  2. the extension (42.7);
  3. IPM (42.4).

  A failed step stops the rest and reports which channels published. A dry run is proven before the first real run.
- **42.6** needs 42.1–42.5, 42.10 and 42.11, the Lead's npm organization and environment, and a local tarball smoke in a real client before the `v1.0.0` tag. It also adds `gen:pack --check` and `check:provenance` to the publish path (DW-612), and decides whether the tarballs ship their CHANGELOG (DW-665).
- **42.7, 42.8 and 42.9 follow npm `1.0.0`.**
  - 42.7 makes the launcher suite green on every platform first (DW-532).
  - 42.8 builds on Epic 41's pack and installer, extends the provenance check to the plugin folder, and publishes the Open Exchange listing.
  - 42.9 re-certifies the clients against the published packages, and aligns the CHANGELOG and the PRD with what shipped.
