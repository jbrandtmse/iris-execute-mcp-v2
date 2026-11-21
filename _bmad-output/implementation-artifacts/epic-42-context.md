# Epic 42 Context: Published Install & Distribution

<!-- Generated from planning artifacts. Regenerate with compile-epic-context if planning docs change. -->

## Goal

Make installing the suite "install Node 22, run one command". That means every `@iris-mcp/*` package on npm at `1.0.0` with provenance, published by a gated release workflow; the VS Code extension on the Marketplace and Open VSX; the IPM package on the IPM registry and Open Exchange; a Claude Code plugin that brings all five servers and the skills pack; and an MCP Registry listing. The code already launches through `npx`, and the release workflow now exists, but nothing is published yet. The release must never downgrade IRIS classes on a shared instance, never publish from an unchecked or unmerged state, and never move clients across a major version.

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

- **Versions.** All `@iris-mcp/*` packages share one version through the Changesets `fixed` group. The first release is exactly `1.0.0`, with one consolidated CHANGELOG section and no beta or prerelease tag. Only 42.6 runs the version step and publishes; until then changesets are `patch` or `minor`.
- **Major pin.** Every `npx` spec the suite writes, spawns or documents carries `@1`.
- **Node floor.** `engines.node >=22.17.0`. The extension declares no `engines.node`; `engines.vscode` governs it.
- **Package hygiene.** Full metadata on every package, no dev-only exports shipped, no required native dependency.
- **No implied endorsement.** No package, publisher, plugin, marketplace or listing name presents the suite as InterSystems'.
- **IRIS support.** The claim stays 2023.1+, labelled best effort below the oldest CI-tested image; the tested floor is `2026.1`.
- **CI** is secret-free, publishes nothing, and uses only throwaway IRIS containers that refuse the live instance's ports.
- **Publishing.**
  - Only from a tagged, CI-green commit **on `main`**, through the approved `release` environment, with npm provenance.
  - Secrets exist only in `release.yml`. The root release script is the only way to publish.
  - Every listing that carries a version is either a release step or declared version-less.
- **Gates prove they can fail** on the path they guard: each new check is broken once (throwaway branch or real path) and the red run's URL is recorded.
- **Shared-instance live testing.** Never stop or restart the shared IRIS; simulate an outage with a closed local port. Writes go only to disposable `ExecuteMCPv2.Temp.*` artifacts or story-created namespaces, removed afterwards. A throwaway container on a dev machine needs the Lead's authorization, starts only through `scripts/throwaway-iris.mjs`, and leaves no container or pulled image behind.
- **Lead-only prerequisites.**
  - Done: the `iris-mcp` npm organization; the GitHub `release` environment (required reviewer `jbrandtmse`, tag rule `v*`).
  - Still pending for 42.6: the short-lived `NPM_TOKEN` environment secret (scope `@iris-mcp` read-write, bypass 2FA, at most 7 days). If it can't create a new package in the scope, the fallback is an interactive 2FA publish by the Lead for 1.0.0 only, recorded as an exception.
  - Requested in 42.5: private vulnerability reporting turned on; recommended, a `v*` tag ruleset restricted to admins.
  - Needed later: Marketplace publisher and Open VSX namespace (42.7); the IPM packaging repository `jbrandtmse/iris-execute-mcp-v2-ipm` with its deploy key, and an InterSystems Developer Community account (42.8).
- **Out of scope:** a public beta, 2.0 planning, and parallel test shards.

## Technical Decisions

- **Bootstrap version marker.** `<shared semver>+<sequence>.<content hash>`, ordered by semver then sequence. Older (including a bare 12-hex legacy marker) upgrades; newer, foreign (same semver and sequence with a different hash, `dev`, unparseable) and unknown (failed or empty read) mean no redeploy plus one warning naming both markers and the remedy. Only a positive absence installs; the marker is re-checked before each compile.
- **IPM ownership and upgrades.** If `ExecuteMCPv2.InstallGuard` is present, IPM owns the deployment and bootstrap writes nothing (one warning naming the `zpm` command). The preloaded guard runs at IPM `Initialize/After` with the same ordering table as the TypeScript comparator (parity-tested). `ipm/module.xml` is generated and output-only, module `iris-execute-mcp-v2` at the npm version; archives are built from the stamped generator output, never `src/`.
- **IRIS-side changes** follow the thin-handler, one-envelope and namespace save/restore conventions; a changed bootstrapped class regenerates the embed in the same story. Within a major, custom REST routes are additive-only, with a pin per changed route.
- **CI (`ci.yml`).** `gates` (Node 22.17.0, 24.0.0, 26.0.0) and `throwaway` run first; `package` and `ipm` only after both pass, so CI is the publish-time gate. A new gate is registered in `scripts/lib/ci-checks.mjs` and `ci.yml` (self-test enforces equality). Actions pinned by SHA, tools by exact version, no `continue-on-error` or `|| true`. An armed suite fails on any skipped test its allowlist doesn't name. Images are pinned by digest; community license keys expire, so images move forward before their key (2026.1's is valid to 2027-03-27).
- **Live gates** arm only on `IRIS_REQUIRE_LIVE` and need all five `IRIS_HOST`/`PORT`/`USERNAME`/`PASSWORD`/`NAMESPACE`, no defaults; unarmed, they make no request.
- **Release workflow (`release.yml`).**
  - Jobs `ci-gate` → `prepare` → `rehearse` → `publish`, each driven by `scripts/release.mjs <job>`. Only `publish` holds the `release` environment, `id-token: write` and secrets, and only on a `v*` tag push. The dry run (push to `release-dry-run/**` or a manual dispatch) can never reach `publish`.
  - `ci-gate` waits for a green CI **push** run on the tagged commit and checks the environment exists before approval is requested. It does **not yet** check that the commit is on `main` (42.6 adds it).
  - `prepare` runs every package's `prepublishOnly` once, armed on a seeded IRIS for Health throwaway with all five `IRIS_*`, before anything is packed. Packing and uploading run no lifecycle script: pnpm 9.15.0 packs, npm uploads `<tgz> --access public --provenance --ignore-scripts`, in order client-config, shared, admin, data, dev, interop, ops, all, stopping at the first failure and reporting which channels published.
  - `rehearse` and `publish` run Node 26.0.0 (bundled npm 11.12.1 meets trusted publishing's 11.5.1). Jobs that install no pnpm set `package-manager-cache: false` on setup-node, pinned by the release self-test.
  - npm auth: a set `NPM_TOKEN` is written to a 0600 temp userconfig deleted on every exit path; an empty one means OIDC. After 1.0.0, run `npm trust github` per package bound to `release.yml` and the `release` environment, then delete the secret; no workflow edit is needed.
  - `v1.0.0` is npm only. Marketplace and Open VSX are enabled by 42.7, IPM by 42.8 (packaging repository, manual Open Exchange release press); each already has a dry step.
  - `@changesets/cli` 2.30.0 is used for versioning only; `changeset publish` is never used.
- **Version step.** `pnpm run version -- --first-release` (once) applies the 1.0.0 changeset template, runs `changeset version`, sets one shared version and runs `gen:bootstrap`, so the marker, stamped parameters and `module.xml` carry `1.0.0` with sequence and hash unchanged; the tag commit passes every `:check`. It refuses a dirty tree, mixed or prerelease versions, a repeat first release, no pending changeset, and being run as the `npm version` hook. Its tests use a fixture that owns its versions, so they must not turn into skips once the real tree is at 1.0.0.
- **Release policy.** A bad release is fixed forward; a harmful version is `npm deprecate`d, never unpublished. Vulnerabilities go through GitHub private vulnerability reporting (`SECURITY.md`, no email).
- **Pins and listings.** One pin constant in `@iris-mcp/client-config`; the extension keeps one literal copy pinned equal by a test. Each server's `mcpName` is `io.github.jbrandtmse/<bin>`.
- **Pre-1.0 wire changes** are sanctioned, ledgered one entry per changed byte (frozen goldens are never edited) and named in the CHANGELOG. After `1.0.0`, a breaking change needs a new major.

## UX & Interaction Patterns

- **One install path per client:** the plugin for Claude Code, the extension for VS Code, the `iris-mcp-clients` CLI for everything else. Every "not yet published" or clone-and-build caveat is removed.
- **The plugin** brings the five servers (IRIS connection from plugin user configuration or the environment), the skills pack and the third-party notice. Plugins can't carry rules, so its README points to the installer, whose Claude Code route then installs only the rule. The marketplace entry pins the release tag.
- **The extension** keeps the server major recorded at first activation and never changes it without the user's confirmation (assumption 42.7 confirms).

## Cross-Story Dependencies

- **Done:** 42.1 (pin, floor, metadata, exports checks, 1.0.0 template), 42.10 (goldens ledger, tool-surface corrections), 42.11 (storage guard on every document write), 42.2 (downgrade guard, opt-in live gates, throwaway script), 42.3 (CI), 42.4 (generated IPM manifest, InstallGuard, offline `ipm` job, 2026.1 leg), 42.5 (release workflow, release and version scripts, `SECURITY.md`, the audit-reader flake fix). Epic 43 is done: SDK v2 pinned exactly at 2.3.1.
- **42.6 is next** and carries:
  - **Tag-on-main gate (DW-696).** `ci-gate` refuses a `v*` tag whose commit is not reachable from `main` (e.g. compare `main...<sha>` is neither `identical` nor `behind`), before approval is requested, with no maintenance-branch allowance. Pinned, and proven red once on the real path: a `v*` tag on an unmerged branch commit with a green push run is refused.
  - **Tarball smoke (DW-47).** `npm pack` every package, install the tarballs in a clean directory, launch through `npx` in a real MCP client (Claude Code) against IRIS, one read call per server; record it.
  - **Publish-path checks (DW-612).** Add `check:provenance` to `prepare`, and prove it and `gen:pack:check` red on that path.
  - **CHANGELOG in tarballs (DW-665).** Decide, before publishing, whether `files` ships each package's `CHANGELOG.md`.
  - **SDK advisory re-check (DW-637).** Right before the tag: if an SDK release pins fast-uri 3.1.8+, bump the exact pin and re-run the epic-43 wire goldens; otherwise record the check and date.
  - **Publish (DW-300).** `pnpm run version -- --first-release`, the root `1.0.0` CHANGELOG section, then post-publish verification: every package at `1.0.0` with a provenance attestation, `npx -y @iris-mcp/dev@1` starts clean, registry 404s gone; then switch to trusted publishing and delete the token.
- **Mid-epic merge for the tag.** When 42.6's code (tag-on-main gate, its red proof, the tarball smoke) is CI-green, the orchestrator stops before tagging and sends the Planner the `epic42` sha and its green CI run id. The Planner merges `epic42` → wave-8 → `main`, pushes, and returns the `main` sha. The orchestrator tags `v1.0.0` on that `main` commit, the owner approves the `release` environment, and 42.6 closes on the publish evidence. 42.7–42.9 continue on `epic42`, merged again at epic end.
- **After npm `1.0.0`:**
  - **42.7** makes the launcher suite green on every platform (DW-532), gives the extension's CLI spawns an explicit or neutral `cwd` (DW-663), and enables the Marketplace and Open VSX channels (telling a skipped duplicate from an upload).
  - **42.8** builds on Epic 41's pack and installer, extends the provenance check to the plugin folder, enables the IPM channel, lists it on Open Exchange, adds the MCP Registry channel with `server.json` as a version embedder, and adds a gate that installs the packaging repository root as the registry serves it (DW-694).
  - **42.9** re-certifies clients against the published packages, states the tested floor and the IPM install route plus manual cleanup after an IPM uninstall (DW-690), and aligns the CHANGELOG and PRD with what shipped.
