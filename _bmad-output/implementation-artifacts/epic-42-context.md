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

- **Versions.** All `@iris-mcp/*` packages share one version through the Changesets `fixed` group. The first release is exactly `1.0.0`, with one consolidated CHANGELOG section and no beta or prerelease tag. Until 42.6, changesets are `patch` or `minor` only, and no story runs `changeset version` or publishes.
- **Major pin.** Every `npx` spec the suite writes, spawns or documents carries `@1`.
- **Node floor.** `engines.node >=22.17.0` in the root and every publishable package. The extension declares no `engines.node`; `engines.vscode` governs it.
- **Package hygiene.** Full metadata on every package. Dev-only exports never ship. No required native dependency.
- **No implied endorsement.** No package, publisher, plugin, marketplace or listing name presents the suite as InterSystems'.
- **IRIS support.** The claim stays 2023.1+, labelled best effort below the oldest CI-tested image. The README states the claim and the tested range.
- **CI** is secret-free, publishes nothing, and uses only throwaway IRIS containers that refuse the live instance's ports.
- **Publishing** runs only from a tagged, CI-green commit, through an approved protected environment, with npm provenance. Secrets exist only in `release.yml`. The root release script is the only way to publish. Every listing that carries a version is a release step or is declared version-less.
- **Gates prove they can fail.** Each gate is proven red on the path it guards (the tarball or publish path, not only the default suite). An armed CI run must not go green by skipping a leg.
- **Shared-instance live testing.** Never stop or restart the shared IRIS; simulate outages with a closed local port. Writes go only to disposable `ExecuteMCPv2.Temp.*` artifacts or story-created namespaces, removed afterwards.
- **Accounts only the Lead can create:** the npm `iris-mcp` organization (done; the scope stays); the Marketplace publisher and Open VSX namespace (42.7); an InterSystems Developer Community account (42.8); the protected environment plus npm trusted publishing or a token (42.5).
- **Out of scope:** a public beta, 2.0 planning, and parallel test shards.

## Technical Decisions

- **Bootstrap version marker (landed in 42.2).** The marker is `<shared semver>+<sequence>.<content hash>`, stamped at generation. The sequence lives in `scripts/bootstrap-sequence.json` and rises by one whenever the hash changes. Markers order by semver, then sequence.
  - **Older** deployments are upgraded. A bare 12-hex marker (a pre-42.2 build) counts as older.
  - **Newer** and **foreign** deployments are never redeployed. Foreign means an equal semver and sequence with a different hash, the source `"dev"` placeholder, or an unparseable marker. The bootstrap logs one warning naming both markers and the remedy.
  - **Unknown** (a version read that fails or comes back empty) also means no redeploy, plus one warning. Only a positive absence installs: the REST route or the `Setup` class provably missing.
  - The marker is re-checked immediately before each compile. Builds made before 42.2 still downgrade, so the docs tell operators to upgrade every client on a shared instance together.
  - **Still to be confirmed by 42.4:** bootstrap never redeploys classes that IPM installed, and reports the `zpm` command instead. The IPM install/upgrade path runs the same no-downgrade check IRIS-side, reusing the marker grammar and ordering, with a parity test against the TypeScript comparator.
- **REST compatibility.** Within a major, custom REST routes are additive-only: older requests are accepted and the response is a superset. This matters because the guard leaves newer classes in place for older `@1` clients. A pin proves it for each route a story changes.
- **Live gates.** Only `IRIS_REQUIRE_LIVE` (`1` or `true`) arms a live leg. A set `IRIS_HOST` does not, and `IRIS_TEST_*` is retired.
  - An armed leg needs all five of `IRIS_HOST`, `IRIS_PORT`, `IRIS_USERNAME`, `IRIS_PASSWORD` and `IRIS_NAMESPACE`, and has no defaults. Unarmed, it makes no request.
  - Targets resolve through `@iris-mcp/shared/test-helpers/live-target`, and a scan refuses inline defaults.
  - Live gates are listed in each package's `scripts/prepublish-gate.mjs` `gateTestFiles`; cross-package gates go in `iris-mcp-all`. From 42.3, CI runs every roster.
- **Throwaway containers.** A check that deploys the `ExecuteMCPv2` package can't be isolated in a namespace of the shared instance, because the `%ALL` mapping wins. It runs in a throwaway container instead.
  - `scripts/throwaway-iris.mjs` creates, labels and removes only its own container. `pnpm live:bootstrap-guard` runs the 42.2 gate through it, armed by `IRIS_THROWAWAY` and kept off the rosters.
  - Throwaways run in CI. On a development machine one runs only with the Lead's explicit authorization, and only the lead starts it.
- **Generated artifacts change only through their generators** (the bootstrap embed, `ipm/module.xml`, the skills pack).
  - A bootstrapped-class change regenerates the embed in the same story.
  - `module.xml` is generated from the bootstrap class list and carries the npm version. IPM archives are built from stamped generator output, never from `src/`.
  - A root `version` script, run by the Changesets version step, regenerates every artifact that embeds the version, and the tag commit passes every `:check`.
- **CI check registry.** A new gate is registered both in the code-declared check list and in `ci.yml`, and a self-test enforces that they match.
- **One pin constant** lives in `@iris-mcp/client-config`. The extension keeps one literal copy, pinned equal to it by a cross-package test.
- **`mcpName`.** Each server package sets `io.github.jbrandtmse/<bin>`, matching its MCP Registry `server.json`.
- **Publishing goes through pnpm.** Only pnpm applies `publishConfig.exports` and rewrites `workspace:*`, and `prepublishOnly` needs a reachable IRIS. The release script handles both, and exports all five `IRIS_*` for its gate run.
- **Release toolchain facts for 42.5 to verify:**
  - trusted publishing needs npm 11.5.1+, Node 22.14+ and `id-token: write`, and pnpm 9 delegates publishing to the system `npm`;
  - the Changesets OIDC fix is in 3.x, which needs pnpm 10+;
  - the first publish can't use a trusted publisher, and a staged publish's `0.0.0-stage` placeholder conflicts with "no beta tag", so the Lead decides;
  - Marketplace global PATs stop working on 2026-12-01.
- **Pre-1.0 wire changes** are sanctioned backward-compatibility changes, named in the CHANGELOG with their story. Frozen goldens are never edited or recaptured: there is one sanctioned-change ledger entry per changed byte. The sanctioned-change list is pruned into the CHANGELOG at the Epic 42 retro.
- **After `1.0.0`**, a breaking change needs a new major. Dropping an end-of-life Node major is a minor release, announced in the CHANGELOG.

## UX & Interaction Patterns

- **One install path per client:** the plugin for Claude Code, the extension for VS Code, and the `iris-mcp-clients` CLI for everything else. Every "not yet published" or clone-and-build caveat is removed.
- **The plugin** brings the five servers (with the IRIS connection supplied through the plugin's user configuration or the environment), the skills pack and the third-party notice.
  - Plugins can't carry rules, so its README points to the installer for the always-on rule.
  - Once the plugin exists, the installer's Claude Code route installs only the rule.
  - The marketplace entry pins the release tag.
- **The extension** keeps the server major it recorded at first activation, and never changes it without the user's confirmation (an assumption that 42.7 confirms).

## Cross-Story Dependencies

- **Epic 43 is done.** The SDK v2 packages are pinned exactly at 2.3.1. Right before the `1.0.0` tag, re-check for an SDK release that pins fast-uri 3.1.8+.
- **Done in this epic:**
  - 42.1: the `@1` constant, the Node floor, the metadata and exports checks, and the `1.0.0` mechanism;
  - 42.10: the widened goldens ledger, and the annotation, resend-text and audit-namespace corrections;
  - 42.11: the storage guard on every document-write path, with `allowStorageRegeneration`;
  - 42.2: the version-ordered downgrade guard, opt-in-only live gates, and the throwaway-container script.
- **42.3 runs next.** It gates on 42.1's checks, and it also carries:
  - **DW-672:** run `pnpm live:bootstrap-guard` in CI, extending `scripts/throwaway-iris.mjs`. The newer, foreign and DW-518 legs leave every class byte-identical; the older and legacy legs upgrade. The script's pinned digest is arm64, so x86 runners need an amd64 or multi-arch digest. The lead's authorized local run passed, but CI owns the live DW-508 proof: one run proven red by reverting the probe to equality, with its URL recorded.
  - **DW-676:** an armed run that skips a leg fails, the launcher's arming guard runs, and this is proven red once. Also decide whether CI runs the five process gates that arm on `IRIS_REQUIRE_LIVE` but sit on no roster.
  - **DW-666:** remove the unused `eslint-disable` directive in `packages/shared/src/cli/governance.ts`, so the lint gate carries no standing warning.
- **42.3's package job** picks up 42.4's IPM offline-install proof. IPM publishes from 42.5's workflow, and its Open Exchange listing is in 42.8.
- **42.5's publish order:**
  1. npm, in dependency order (client-config, shared, admin, data, dev, interop, ops, all);
  2. the extension (42.7);
  3. IPM (42.4).

  A failed step stops the rest and reports which channels published. A dry run is proven before the first real run.
- **42.6** needs 42.1–42.5, 42.10 and 42.11, plus the Lead's npm organization and environment. A local tarball smoke in a real client comes before the `v1.0.0` tag.
- **42.7, 42.8 and 42.9 follow npm `1.0.0`.**
  - 42.8 builds on Epic 41's pack and installer, and extends its provenance check to the plugin folder.
  - 42.9 re-certifies the clients against the published packages, and aligns the CHANGELOG and the PRD with what shipped.
