# Epic 42 Context: Published Install & Distribution

<!-- Generated from planning artifacts. Regenerate with compile-epic-context if planning docs change. -->

## Goal

Make installing the suite "install Node 22, run one command". That means every `@iris-mcp/*` package on npm at `1.0.0` with provenance, published by a gated release workflow; the VS Code extension on the Marketplace and Open VSX; the IPM package on the IPM registry and Open Exchange; a Claude Code plugin that brings all five servers and the skills pack; and an MCP Registry listing. The code already launches through `npx`, but nothing is published yet. The release must never downgrade IRIS classes on a shared instance, never publish from an unchecked state, and never move clients across a major version.

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
- **Node floor.** `engines.node >=22.17.0`. The extension declares no `engines.node`; `engines.vscode` governs it.
- **Package hygiene.** Every package carries full metadata. Dev-only exports never ship. No package has a required native dependency.
- **No implied endorsement.** No package, publisher, plugin, marketplace or listing name presents the suite as InterSystems'.
- **IRIS support.** The claim stays 2023.1+, labelled best effort below the oldest CI-tested image. The tested floor is now `2026.1`.
- **CI** is secret-free, publishes nothing, and uses only throwaway IRIS containers that refuse the live instance's ports.
- **Publishing.**
  - It runs only from a tagged, CI-green commit, through an approved protected environment, with npm provenance.
  - Secrets exist only in `release.yml`.
  - The root release script is the only way to publish.
  - Every listing that carries a version is either a release step or declared version-less.
- **Gates prove they can fail** on the path they guard. Each new self-test or check is broken once on a throwaway branch, and the URL of the red run is recorded.
- **Shared-instance live testing.**
  - Never stop or restart the shared IRIS; simulate an outage with a closed local port.
  - Writes go only to disposable `ExecuteMCPv2.Temp.*` artifacts or to namespaces the story creates, and are removed afterwards.
  - A throwaway container on a dev machine needs the Lead's authorization and is started only through `scripts/throwaway-iris.mjs`. Afterwards none may be left, and any pulled images are removed.
- **Lead-only prerequisites.**
  - Still pending:
    - the GitHub release environment with required approval;
    - the npm first-publish route: a granular token, an interactive 2FA publish, or a staged publish. A staged publish creates a public `0.0.0-stage` placeholder, which conflicts with "no beta tag".
  - Needed later: the Marketplace publisher and Open VSX namespace (42.7), and an InterSystems Developer Community account (42.8).
  - Done: the `iris-mcp` npm organization exists, so the scope stays.
- **Out of scope:** a public beta, 2.0 planning, and parallel test shards.

## Technical Decisions

- **Bootstrap version marker.**
  - **Format.** The marker is `<shared semver>+<sequence>.<content hash>`. Markers order by semver, then by sequence.
  - **Older** markers, including a bare 12-hex legacy one, trigger an upgrade.
  - **Newer, foreign and unknown** markers mean no redeploy, plus one warning naming both markers and the remedy.
    - Foreign means equal semver and sequence but a different hash, `dev`, or an unparseable marker.
    - Unknown means the read failed or came back empty.
  - **Installing.** Only a positive absence installs, and the marker is re-checked before each compile.
- **Ownership (42.4).** If the IPM-only class `ExecuteMCPv2.InstallGuard` is present, IPM owns the deployment.
  - The bootstrap then writes nothing and logs one warning naming the `zpm` command.
  - A 404 for the guard class is the positive absence. Any other failure is unknown, and nothing is written.
- **IPM upgrades.**
  - The preloaded guard runs at IPM `Initialize/After`, before Reload.
  - It orders the deployed `Setup` marker against its own stamped marker, using the same table as the TypeScript comparator. A parity test keeps the two in step.
  - It refuses newer, foreign and unknown markers inside IPM's transaction. IPM's own version check ignores build metadata.
  - Installs never use `-dev`.
- **IPM manifest.**
  - **Generation.** `ipm/module.xml` is generated and output-only. `gen-bootstrap.mjs` builds it from `classes[]` plus the preloaded guard, whose content joins the marker hash.
  - **Name and version.** The module is `iris-execute-mcp-v2`, and its version equals the npm version. That settles IPM's version policy.
  - **Archives.** They are built from the stamped generator output, never from `src/`; source `Setup` carries `dev`, which the guard refuses.
  - **CI proof.** CI's `ipm` job builds one archive and installs it offline on both editions.
  - **`Configure`.** It sets up the REST app with no application roles and no `MatchRoles`.
- **IRIS-side changes.**
  - They follow the thin-handler, one-envelope and namespace save/restore conventions.
  - Changing a bootstrapped class regenerates the embed in the same story, and a new class joins both rosters.
  - Within a major, custom REST routes are additive-only, because the guard leaves newer classes in place for older `@1` clients. A pin proves this for each route a story changes.
- **CI (`ci.yml`).**
  - **Jobs.** `gates` runs on Node 22.17.0, 24.0.0 and 26.0.0, next to `throwaway`. The `package` and `ipm` jobs run only after both pass. So CI, not `prepack`, is the publish-time gate.
  - **Registering a gate.** A new gate is registered in `scripts/lib/ci-checks.mjs` and in `ci.yml`, and a self-test enforces that the two match.
  - **Pins.** Actions are pinned by SHA and tools by exact version. No `continue-on-error` and no `|| true`.
  - **Skips.** An armed suite fails on any skipped test its allowlist doesn't name with a reason.
- **CI images**, each pinned by manifest-list digest:
  - `irishealth-community:2026.2` in `HSCUSTOM`, for the armed rosters, integration suites, process gates and launcher live files;
  - `iris-community:2026.2` and `:2026.1` in `USER`, for the bootstrap guard.
  - Community license keys expire, so every image moves forward before its key does. The 2026.1 key is valid to 2027-03-27.
- **Live gates.**
  - Only `IRIS_REQUIRE_LIVE` arms a live gate.
  - An armed gate needs all five of `IRIS_HOST`, `IRIS_PORT`, `IRIS_USERNAME`, `IRIS_PASSWORD` and `IRIS_NAMESPACE`, with no defaults. Unarmed, it makes no request.
  - The rosters are each package's `prepublish-gate.mjs` `gateTestFiles`.
  - The throwaway gate arms on `IRIS_THROWAWAY` and stays off the rosters.
- **Release mechanics (42.5).**
  - **Publishing goes through pnpm only (DW-387, DW-675).**
    - Only pnpm applies `publishConfig.exports` and rewrites `workspace:*`.
    - Each package's `prepublishOnly` runs `verify-iris-reachable` and `prepublish-gate`, and both fail when no IRIS is reachable. The release script owns both, and it exports all five `IRIS_*` for its gate run.
  - **Publish order.**
    1. npm, in dependency order: client-config, shared, admin, data, dev, interop, ops, all;
    2. the extension, to both stores;
    3. IPM.

    A failed step stops the rest and reports which channels published. The dry-run mode is proven before the first real run.
  - **Version script.** A root `version` script, run by the Changesets version step, regenerates every artifact that embeds the version, including the bootstrap embed and marker and `ipm/module.xml` (through `gen:bootstrap`). The tag commit passes every `:check`.
  - **IPM archive.** It is built with 42.4's staging library, `lib/ipm-archive.mjs`.
  - **Trusted publishing.**
    - It needs npm 11.5.1+, Node 22.14+ and `id-token: write`.
    - pnpm 9 delegates publishing to the system `npm`.
    - The Changesets OIDC fix is in 3.x, which needs pnpm 10+.
    - Trusted-publisher configurations created after 2026-09-03 allow only staged publishing unless direct publish is enabled.
    - 42.5 pins whatever toolchain the release path needs.
  - **IPM registry route (DW-689).** Open Exchange is the only feed for the public IPM registry, and it reads `module.xml` from a GitHub repository root. That conflicts with building archives from the stamped output (never `src/`) and with the manifest's `ipm/` location. 42.5 probes the current Open Exchange rules and chooses a route:
    - a published-artifact repository or branch;
    - a stamped root manifest;
    - another channel.

    42.8 lists whichever route is chosen.
  - **Policies.** 42.5 also decides the bad-release policy (fix-forward or `npm deprecate`) and adds `SECURITY.md`. The extension's and the plugin's version policies are decided in 42.7 and 42.8.
  - **Marketplace auth.** Azure DevOps global PATs stop working on 2026-12-01.
- **CI flake to fix before release (DW-693).**
  - **The cause.** Raw audit readers can parse a half-written last line, and `story-43-4-qa-probe-copy` intermittently fails its process bookkeeping.
  - **The fix.** Move the newline-terminated reader to `scripts/lib`, route every audit reader through it, fix the probe-copy bookkeeping, and prove each fix red once.
  - **Why it lands here.** The release workflow consumes a green CI.
- **Pins and listings.**
  - One pin constant lives in `@iris-mcp/client-config`. The extension keeps one literal copy, and a test pins it equal to the constant.
  - Each server's `mcpName` is `io.github.jbrandtmse/<bin>`, matching its MCP Registry `server.json`.
- **Pre-1.0 wire changes.**
  - They are sanctioned and named in the CHANGELOG with their story.
  - Frozen goldens are never edited. Each changed byte gets one sanctioned-change ledger entry.
  - The sanctioned list is pruned into the CHANGELOG at the Epic 42 retro.
  - After `1.0.0`, a breaking change needs a new major.

## UX & Interaction Patterns

- **One install path per client.**
  - Claude Code: the plugin.
  - VS Code: the extension.
  - Everything else: the `iris-mcp-clients` CLI.

  Every "not yet published" or clone-and-build caveat is removed.
- **The plugin.**
  - It brings the five servers, with the IRIS connection from the plugin's user configuration or the environment.
  - It also brings the skills pack and the third-party notice.
  - Plugins can't carry rules, so its README points to the installer. Once the plugin exists, the installer's Claude Code route installs only the rule.
  - The marketplace entry pins the release tag.
- **The extension** keeps the server major it recorded at first activation and never changes it without the user's confirmation. This is an assumption that 42.7 confirms.

## Cross-Story Dependencies

- **Epic 43 is done.** The SDK v2 packages are pinned exactly at 2.3.1. Right before the `v1.0.0` tag, re-check for an SDK release that pins fast-uri 3.1.8+ (DW-637).
- **Done:**
  - 42.1: the pin, floor, metadata and exports checks, and the `1.0.0` mechanism;
  - 42.10: the widened goldens ledger and the tool-surface corrections;
  - 42.11: the storage guard on every document-write path;
  - 42.2: the downgrade guard, opt-in live gates and the throwaway script;
  - 42.3: CI, including the bootstrap-guard live proof and the no-skip rule;
  - 42.4: the generated IPM manifest, the InstallGuard ownership and upgrade guard, the offline-install `ipm` job, and the oldest CI leg moved to 2026.1.
- **42.5 runs next.**
  - It consumes a green CI on the tagged commit and 42.4's archive staging.
  - It carries DW-387, DW-675, DW-689 and DW-693.
  - It waits on the Lead's release environment and first-publish route.
- **42.6** needs:
  - 42.1–42.5, 42.10 and 42.11, plus the Lead's prerequisites;
  - a local tarball smoke in a real client before the `v1.0.0` tag.

  It also adds `gen:pack --check` and `check:provenance` to the publish path (DW-612), and decides whether the tarballs ship their CHANGELOG (DW-665).
- **After npm `1.0.0`:**
  - **42.7** first makes the launcher suite green on every platform (DW-532), and gives the extension's CLI spawns an explicit or neutral `cwd` (DW-663).
  - **42.8** builds on Epic 41's pack and installer and extends the provenance check to the plugin folder. It also lists the IPM package on Open Exchange, reusing the manifest metadata and 42.5's chosen route.
  - **42.9**:
    - re-certifies the clients against the published packages;
    - states the tested floor (2026.1) and the IPM install route, plus the manual cleanup after an IPM uninstall (DW-690);
    - aligns the CHANGELOG and the PRD with what shipped.
