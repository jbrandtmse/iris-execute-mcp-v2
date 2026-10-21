# Epic 42 Context: Published Install & Distribution

<!-- Generated from planning artifacts. Regenerate with compile-epic-context if planning docs change. -->

## Goal

Make installing the suite "install Node 22, run one command." Nothing is published yet, so every `npx` path the code already writes fails today. This epic publishes `1.0.0` of every `@iris-mcp/*` package to npm with provenance through a gated release workflow. It also puts the VS Code extension on the Marketplace and Open VSX, revives the IPM package (IPM registry and Open Exchange), ships a Claude Code plugin with all five servers and the skills pack, and lists the suite on the MCP Registry. The first public release must be reproducible from CI and safe on a shared IRIS instance (no silent class downgrades). It is pinned so users never cross a breaking major unasked.

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

## Requirements & Constraints

- **One version:** every `@iris-mcp/*` package goes to `1.0.0` together (Changesets `fixed` group), with no beta or prerelease tag. Until the publish story, changesets are `patch`/`minor` only. No story runs `changeset version` or publishes by hand.
- **Major pin:** every `npx` spec the suite writes, spawns or documents carries `@1`, taken from one exported constant. This covers the servers, the client-config CLI, the governance CLI, the extension and the plugin. A test finds any unpinned `@iris-mcp/` spec.
- **Runtime floor:** every manifest declares `engines.node >=22` (test-asserted), and `@types/node` is pinned to the floor major. No required native dependency: a native module may only be an `optionalDependency` with a graceful skip.
- **Package hygiene:** package metadata is complete and test-asserted, and exports match the tarball contents. Whatever the MCP Registry requires must be present before `1.0.0`, or a `1.0.1` is forced.
- **Naming:** no package, publisher, plugin, marketplace, registry name or listing presents the suite as InterSystems' or implies endorsement.
- **IRIS support claim:** 2023.1+, best effort below the oldest image CI can test. The README states the claim and the range actually tested.
- **Safety:**
  - CI never touches the shared IRIS: its throwaway containers refuse the live ports.
  - A plain `pnpm test` runs no live leg without an explicit opt-in.
  - No distribution surface writes a literal credential to a file without explicit confirmation.
- **Out of scope:** a public beta, `2.0` planning, parallel CI test shards.
- **Lead-only prerequisites:** the npm `iris-mcp` org already exists. Still needed from the Lead:
  - the protected GitHub environment, plus trusted publishing or a token;
  - the Marketplace publisher and the Open VSX namespace;
  - the InterSystems Developer Community account;
  - the human-only certification rows.

## Technical Decisions

- **Publishing:**
  - Publish only from a tagged, CI-green commit, through an approved protected environment, with npm provenance.
  - Secrets exist only in `release.yml`. `ci.yml` is secret-free and publishes nothing.
  - One root release script is the only publish command. It runs the gates once, then publishes in dependency order (client-config, shared, admin, data, dev, interop, ops, all), then the extension, then IPM.
  - A failure halts the rest and reports which channels were published. A dry-run mode is proven first.
  - Every listing that carries a version is a release step, or is declared version-less.
- **Release toolchain (probe):** trusted publishing needs npm ≥11.5.1 and Node ≥22.14, which the current pnpm 9 / Changesets 2.x stack may not meet. A trusted publisher cannot do the first publish. A staged publish's `0.0.0-stage` placeholder conflicts with "no beta", so the route is the Lead's choice.
- **CI:**
  - The Node matrix runs the floor of 22.x, 24.x and 26.x, kept equal to `engines.node` by a self-test.
  - Actions are pinned to commit SHAs and tools to exact versions; no `continue-on-error` or `|| true`.
  - The code-declared check list must equal the workflow's `run:` steps (self-test), so a new gate is registered in both.
  - CI runs every live-gate roster against pinned 2026.2 `iris-community`/`irishealth-community` throwaways.
  - Every gate is proven red on the path it actually guards, the tarball path included.
- **Bootstrap versioning:**
  - The deployed version is monotonic: a newer build's deployment is never redeployed, and the bootstrap warns, naming both versions and the remedy.
  - The proposed marker is `<shared semver>+<content hash>`, ordered by semver. An equal semver with a different hash counts as foreign: no redeploy, plus a warning. To be confirmed by the downgrade-guard and IPM stories.
  - Classes IPM installed are never redeployed by bootstrap.
  - The generator, the drift test and the version scheme change together.
- **Single-sourced versions:** a root `version` script, run by the Changesets version step, regenerates every artifact that embeds the version. The IPM manifest is generated from the bootstrap class list, output-only, with the npm version. IPM archives are built from the generator's stamped output, never from `src/`.
- **IRIS-side REST routes are additive-only within a major,** because the downgrade guard keeps newer classes that older `@1` clients still call.
- **Back-compat:**
  - After `1.0.0`, a breaking change needs a new major.
  - Each sanctioned pre-1.0 change is named in the CHANGELOG: the pin, the Node floor, the annotation and description corrections, and the Storage-guard extension.
  - Frozen SDK goldens are never edited or recaptured. Each changed byte goes through the sanctioned-changes fixture.
- **SDK:** `@modelcontextprotocol/server`/`client` are pinned exactly at `2.3.1` and stay confined to `@iris-mcp/shared`. Bump only to a release that fixes the bundled fast-uri advisories.
- **Plugin:** it reuses the generated `packages/client-config/skills-pack/` directory, never the repo root, which would load the workflow skills twice. It ships the third-party notice. Rules cannot ride in a plugin, so they come from the installer. The marketplace entry pins the release tag matching npm.

## UX & Interaction Patterns

- One install path per client:
  - the plugin for Claude Code;
  - the extension for VS Code;
  - the `iris-mcp-clients` CLI for every other client.
- Documented CLI invocations must actually work for a scoped package whose `bin` has a different name.
- Every "not yet published" and clone-and-build caveat is removed.

## Cross-Story Dependencies

- Epic 43 (SDK v2) is done, so 42.1's SDK-floor bump does not apply.
- 42.1's version, metadata and exports checks become 42.3 gates, and 42.1's `@1` constant feeds 42.7 and 42.8.
- 42.2 must land before 42.6 publishes.
- 42.4's offline IPM proof joins 42.3's package job, and its registry publish runs inside 42.5's workflow.
- 42.6 needs 42.1–42.5 done and the Lead's accounts in place.
- 42.7 and 42.8 publish only after npm `1.0.0`. The plugin's arrival switches the installer's Claude Code route to rules-only.
- 42.9 re-certifies the clients against the published `1.0.0`, so it runs last.
