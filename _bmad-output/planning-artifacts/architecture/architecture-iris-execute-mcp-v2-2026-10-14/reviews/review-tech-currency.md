---
review: tech-currency
target: ../ARCHITECTURE-SPINE.md
date: '2026-10-14'
lens: 'Was every committed technology decision web-researched or reality-checked, rather than asserted from training data? Covers library and framework versions, whether each named technology still exists and fits, and the live defaults of each external platform the spine leans on.'
inputs:
  - '../ARCHITECTURE-SPINE.md (Stack table; AD-15, AD-23, AD-28, AD-29; Conventions)'
  - '../.memlog.md (version lines 11-13)'
  - '../../../decision-record-2026-10-14-distribution-and-skills.md (Part 2 constraints; D1-D7; CI reference design)'
method: 'Read-only. In-repo checks: every package.json, node_modules/*/package.json, pnpm-lock.yaml, extensions/iris-mcp-launcher/package-lock.json, .changeset/config.json; a disposable import probe of the installed SDK (scratchpad, outside the repo); local docker image labels; one read-only iris_server_info call against the shared dev instance; a read-only pnpm audit. Web checks: the live npm registry, Docker Hub and MCP Registry APIs, and primary vendor documentation. Every fetch was made on 2026-10-14. A claim is marked confirmed only when a source or an in-repo check supports it.'
---

# Technology-currency review: ARCHITECTURE-SPINE.md

## Verdict

The versions in the Stack table are accurate for what is installed today: every row matches the lockfile. Not one of them was checked against current upstream releases, though. Several of the platform facts the spine depends on have changed since they were written down.

- **MCP itself has moved on.** The current MCP specification is 2026-07-28, and the TypeScript SDK's stable line is now v2. The spine pins the v1 SDK and the 2025-11-25 specification, for a public 1.0.0 that promises to stay compatible across every 1.x release.
- **The npm publishing rules have changed.** AD-29's promise of "provenance from an approved protected environment" now runs into trusted-publishing requirements that the spine does not record. Those requirements include a first-publish bootstrap problem.
- **The IRIS support floor is out of date.** The floor of 2023.1 is below InterSystems' own published minimum, and no available CI image can test it.
- **The always-on rule may never load.** A rule scoped with `paths:` loads only when Claude touches a matching local file. In this suite, agents write ObjectScript through MCP tools, so in that main workflow the rule never loads.

The Claude Code platform claims in AD-28, and the plugin and marketplace file names, are all confirmed against current documentation.

**Counts:** 0 critical, 4 high, 7 medium, 6 low. Tallied mechanically from the `Severity:` lines below (Rule #51).

## Findings

### T1 — The MCP specification and SDK line are superseded

- **Severity:** high
- **Spine:** the Stack rows `@modelcontextprotocol/sdk 1.29.0` and `MCP specification 2025-11-25`; AD-10 (capabilities and `instructions`); AD-15 (after 1.0.0, a breaking change needs a new major, and clients are pinned to `@1`).
- **Status:** contradicted, as a statement of the current specification.

**Evidence:**

- **The specification.** The current specification is **2026-07-28** (modelcontextprotocol.io/specification/versioning, fetched 2026-10-14). That revision makes the protocol stateless:
  - the `initialize` handshake is removed, and `server/discover` is mandatory;
  - every request carries its version and capabilities in `_meta`;
  - Logging, Roots and Sampling are deprecated;
  - `resources/subscribe` is replaced by `subscriptions/listen`;
  - list results gain `ttlMs` and `cacheScope`.

  Source: /specification/2026-07-28/changelog.
- **The SDK.** SDK v2 shipped as `@modelcontextprotocol/server` and `@modelcontextprotocol/client` 2.0.0 on 2026-07-27, and is now at 2.3.1 (live npm registry). The SDK README says `main` holds v2, which it calls "the stable release line", and that v1.x receives fixes and security updates "for at least six months after the v2 release". That guarantee therefore runs only to about 2027-01-27.
- **What v1 still speaks.** The v1 line is still maintained: 1.32.1 shipped on 2026-10-05. Its `LATEST_PROTOCOL_VERSION` is still `'2025-11-25'` (checked in `dist/esm/types.js` for both 1.29.0 and 1.32.1 via jsDelivr).
- **Mitigation.** On stdio, a client that supports both protocol styles SHOULD send `server/discover` first and fall back to `initialize`, so v1 servers keep working with such clients (/2026-07-28/server/discover). `instructions` survives in `DiscoverResult`.
- **Migration cost.** The v2 migration guide renames `McpError` to `ProtocolError` and `ErrorCode` to `ProtocolErrorCode`. It moves `StdioServerTransport` to the `/stdio` subpath, makes `registerResource` require `metadata`, and requires zod `^4.2.0` (ts.sdk.modelcontextprotocol.io/v2/migration/upgrade-to-v2). `server-base.ts:15-22` imports exactly these symbols.

**Impact:** 1.0.0 would ship on an SDK line that only has a maintenance window, and nothing in the spine records a plan to migrate. If the move to v2 changes observable behavior after 1.0.0 (error codes, capability advertisement), AD-15 makes it a major-version question. The `@1` pin means users would never receive that major.

**Fix:**

- Record a Lead decision: ship 1.0.0 on v1, with a dated migration story before the v1 window closes, or move to v2 before 1.0.0.
- Change the Stack row to "MCP specification: 2025-11-25, as negotiated by SDK 1.x. The current specification is 2026-07-28."

### T2 — npm trusted publishing and provenance requirements are not recorded, and the first publish cannot use them

- **Severity:** high
- **Spine:** AD-29 ("Publishing happens only from a tagged, CI-green commit, through an approved protected environment, with npm provenance"; "Secrets exist only in `release.yml`"); the Stack rows pnpm 9.15.0 and @changesets/cli 2.30.0; D2 ("publish `1.0.0` directly").
- **Status:** unconfirmed in the spine. The live platform rules below were confirmed.

**What the platform requires today:**

- **Tokens.** Classic npm tokens were permanently revoked on 2025-12-09, and granular write tokens are capped at 90 days (GitHub changelog, 2025-12-09).
- **Trusted publishing requirements.** It needs npm CLI 11.5.1 or later and Node 22.14.0 or later. It works only on GitHub-hosted runners, not self-hosted ones. Provenance is automatic only for a public repository and a public package (docs.npmjs.com/trusted-publishers, fetched 2026-10-14). Node 22 bundles npm 10.x, so the release job has to install npm 11 explicitly.
- **pnpm.** pnpm 10 and earlier publish by delegating to the system `npm`. Only from v11 does pnpm publish natively, with OIDC (pnpm.io/cli/publish; pnpm issue #11513). With pnpm 9.15.0, trusted publishing therefore works only if the release job puts npm 11.5.1 or later on `PATH`.
- **The first publish.** A trusted publisher cannot be configured until the package exists (`npm trust`: "Package must exist"). All seven `@iris-mcp/*` packages still return 404 on the registry (checked live). So the very first 1.0.0 publish has three options, none of which AD-29 records:
  - a granular token;
  - an interactive publish with two-factor authentication;
  - `npm stage publish` (npm 11.15.0 or later). Staging a package that doesn't exist creates a **public `0.0.0-stage` placeholder version** (docs.npmjs.com/staged-publishing), which conflicts with "starting at `1.0.0`, with no prerelease tag".
- **New configuration defaults.** Trusted-publisher configurations created after 2026-09-03 allow only `npm stage publish` by default; direct `npm publish` must be enabled explicitly. A new configuration must also complete a successful publish within 2 days (docs.npmjs.com/trusted-publishers; GitHub changelog, 2026-09-03).
- **Changesets.** The fix for `changeset publish` mishandling already-published errors under OIDC ("Changesets now skips npm 11 already-published errors that omit `code`…") shipped only in @changesets/cli **3.0.0** (PR #2132, raw CHANGELOG). Version 3 requires pnpm 10 or later and Node `^22.11 || ^24 || >=26`.

**Fix:** add a "Release mechanics" bullet to AD-29, or a [ASSUMPTION] for Story 42.x to confirm. It should cover:

- the release-job Node (22.14 or later) and npm (11.5.1 or later; 11.15.0 or later for staging);
- `id-token: write`;
- how the first publish is bootstrapped (token, interactive, or stage-then-approve, and what that does to the version history);
- whether direct publish is enabled on each trusted-publisher configuration;
- the Changesets and pnpm versions the release path is proven on.

### T3 — The IRIS support floor of 2023.1 is below InterSystems' minimum and cannot be CI-tested

- **Severity:** high
- **Spine:** the Stack row "InterSystems IRIS (support floor) 2023.1 (Atelier API v1+; v8 for the full feature set)"; AD-29 (CI runs on throwaway containers).
- **Status:** contradicted (vendor policy), and the floor is unverifiable by CI.

**Evidence:**

- **Vendor policy.** InterSystems' minimum supported version for IRIS and IRIS for Health has been **2024.1 since 2026-07-01**, rising to **2025.1 on 2027-07-01**. "Minimum" means the latest maintenance release of that major (intersystems.com/support/minimum-supported-version, fetched 2026-10-14).
- **Available images.** Docker Hub's oldest `intersystems/iris-community` tag is **2024.3**, and the `2023.1`, `2023.3`, `2024.1` and `2024.2` tags all return 404 (Hub API, live). I could not query `containers.intersystems.com` anonymously (it returned 401).
- **Atelier API.** The shared dev instance reports `IRIS 2026.2 (Build 221U)` with Atelier `api: 8` (a read-only `iris_server_info` call). The highest `requireMinVersion` anywhere in the code is 7 (`format.ts:167`), so "v8 for the full feature set" has no code-level anchor.

**Impact:** a 1.0.0 public support claim that no gate can exercise, and that the vendor itself no longer supports. This is the Rule #59 pattern: a claim with no path that could fail it.

**Fix:** raise the floor to 2024.1, or to the oldest version CI can pull. Alternatively, keep 2023.1 labelled "best effort, untested". Either way, state which Atelier version each floor implies.

### T4 — A `paths:`-scoped "always-on" rule does not fit the suite's main write path

- **Severity:** high
- **Spine:** AD-28 ("the always-on rule has exactly one source"; "Rules reach Claude Code only through the installer"). Decision record, Part 2, Content 1: an "always-on rule … whose `paths:` frontmatter scopes it to `**/*.cls`, `**/*.mac` and `**/*.inc`".
- **Status:**
  - `paths:` support: **confirmed**.
  - The rule's fit for this purpose: **contradicted**.

**Evidence** (code.claude.com/docs/en/memory, fetched 2026-10-14):

- "Rules without a `paths` field are loaded unconditionally."
- "A path-scoped rule loads when Claude uses the Read, Write, or Edit tool on a matching file", or a Bash read of one.

So a `paths:` rule is not always-on. In this suite, agents write ObjectScript into IRIS through `iris_doc_put`, `iris_doc_edit` and `iris_doc_load`. Those are MCP tool calls, not Read, Write or Edit on a local `.cls` file. In that flow, the pre-write checklist never enters context.

**Unconfirmed:** whether a matching rule loads before or after Claude's first `Write` of a new local file.

**Fix:** decide at Story 41.x between three options:

- an unscoped rule (truly always-on);
- carrying the checklist in a skill plus the shared MCP `instructions` string;
- accepting the scoped rule as covering local-file workflows only.

Then correct the "always-on" wording to match.

### T5 — The "runtime floor 22.0" is looser than reality, and "CI tests the floor" is ambiguous

- **Severity:** medium
- **Spine:** the Stack row "Node.js (runtime floor) 22.0 (`engines.node >=22`; CI tests the floor of 22, 24 and 26)"; AD-29.
- **Status:**
  - The `fs.globSync` claim: **confirmed with a caveat**.
  - The "floor" testing claim: **unconfirmed**.

**Evidence:**

- **`fs.globSync`.** It was added in **v22.0.0**, but stayed experimental until **v22.17.0**; it is marked stable in v24.0.0 and v22.17.0. `withFileTypes` arrived in v22.2.0, and `exclude` patterns in v22.14.0 (the history tables in nodejs.org `latest-v22.x` and `latest-v26.x` `api/fs.json`). `load.ts:382` passes `{ withFileTypes: false }`, which is harmless on 22.0 and 22.1.
- **The tool chain needs more than 22.0:**
  - the release job needs 22.14.0 or later (T2);
  - Vitest 5 needs `^22.12.0`;
  - Changesets 3 needs `^22.11`;
  - the lockfile already contains `eslint-visitor-keys@5.0.1`, which needs `^22.13.0`.
- **The reference CI.** OcuPilot's `ci.yml:88-90` pins **22.22.3**, 24.15.0 and 26.0.0. That is the latest 22.x, not the 22.0 floor. 26.0.0 is the only true floor leg.
- **In-repo state.** The root `engines` is still `>=18.0.0`, and no package declares `engines.node`. The decision is not yet implemented (Story 42.1).

**Fix:** declare `>=22.17.0` (the point where the one API you depend on is stable) or keep `>=22` with a CI leg at exactly 22.0.0. Name the exact legs either way.

### T6 — The runtime expiry dates fall inside the `@1` line's life, and no policy covers them

- **Severity:** medium
- **Spine:** AD-15 (after 1.0.0, a breaking change requires a new major, and clients pinned to `@1` get every 1.x release); AD-29 (`engines.node >=22`).
- **Status:** confirmed, against Node.js schedule.json and the release blog.

**Node.js status as of 2026-10-14:**

- **Node 22:** Maintenance LTS since 2025-10-21; **end of life 2027-04-30**, about 6.5 months away.
- **Node 24:** Active LTS; maintenance from 2026-10-20; end of life 2028-04-30.
- **Node 26:** Current since 2026-05-05; becomes LTS on 2026-10-28; end of life 2029-04-30.

From Node 27 (alpha in October 2026, released April 2027), Node makes one major release per year, and every release becomes LTS (nodejs.org blog, "Evolving the Node.js Release Schedule", 2026-03-10).

The SDK v1 support guarantee ends around 2027-01-27 (T1).

**Gap:** nothing records whether raising `engines.node` from 22 to 24 within 1.x counts as breaking. Under AD-15 as written it plausibly does, and `@1` users would then be stranded on an end-of-life runtime.

**Fix:** a one-line policy in AD-15. For example, "dropping an end-of-life Node major is a minor-version change, announced in CHANGELOG.md".

### T7 — The Stack versions are lockfile versions, not what users run, and the lockfile carries known advisories

- **Severity:** medium
- **Spine:** the Stack table; AD-29 (`npx -y @iris-mcp/<pkg>@1`).
- **Status:** confirmed by in-repo checks plus the live registry.

**Evidence:**

- **Version ranges.** The packages declare `"@modelcontextprotocol/sdk": "^1.29.0"` and `"zod": "^4.3.6"`. `npx` consumers resolve fresh, so they get SDK **1.32.1** and zod **4.6.7** today, not the versions the Stack table names and CI tests.
- **The SDK advisory.** SDK 1.29.0 falls inside a **high** advisory range, `>=1.12.0 <1.31.0`: "OAuth client could send credentials to an authorization server chosen by the MCP server". The affected code is client-side, so this server does not use it, but scanners will flag the declared floor.
- **Advisories in the lockfile's production tree.** `pnpm audit` (2026-10-14) reports 4 critical, 35 high and 54 moderate advisories overall. Production paths through the SDK's HTTP stack include `proxy-addr@2.0.7` (critical, via express 5.2.1), `fast-uri@3.1.0` (high), and `hono@4.12.10` and `ip-address@10.1.0` (high). A stdio-only server never uses that HTTP stack, but it installs it. SDK v2's server package depends only on `zod` and `@modelcontextprotocol/core`.

**Fix:** raise the SDK floor to `^1.31.0` or later, and refresh the lockfile before 1.0.0. State in the Stack table that the column means "tested lockfile version".

### T8 — Vitest 2.1.9 is an end-of-life major with critical advisories

- **Severity:** medium
- **Spine:** the Stack row Vitest 2.1.9.
- **Status:** confirmed installed. Stale against upstream.

**Evidence:**

- **Releases.** The latest is **5.0.4** (2026-10-12); the maintained tags are V4 4.1.11 and V3 3.2.7. 2.1.9 (2025-02-03) is the last 2.x release (npm registry).
- **Advisories** (`pnpm audit`, dev and CI only):
  - `vitest <3.2.6`: arbitrary file read and execute while the UI server listens (critical);
  - `tinypool <2.1.2`: a prototype-pollution-to-RCE gadget (critical);
  - `vite <=6.4.2` (the installed 5.4.21): path traversal and `fs.deny` bypass.
- **Upgrade paths compatible with a 22.0 floor:** 3.2.7 (`>=22.0.0`) or 4.1.11 (`^22.0.0`). Vitest 5 needs `^22.12.0`.

### T9 — pnpm 9.15.0 is on a line that has had no release in 19 months

- **Severity:** medium
- **Spine:** the Stack row pnpm 9.15.0 (`packageManager: pnpm@9.15.0`).
- **Status:** confirmed installed. Stale against upstream.

**Evidence:**

- **Releases.** The latest 9.x is 9.15.9 (2025-03-10), and nothing since. The current release is **12.11.2** (2026-10-09). The 10.x line (10.34.7, 2026-10-12) and the 11.x line (11.28.x) are both still being patched (npm dist-tags).
- **Knock-on effects:**
  - Changesets 3, which carries the OIDC fix from T2, requires pnpm 10 or later.
  - Native OIDC publishing exists only from pnpm 11.

**Fix:** record the pnpm major that the release path is proven on, together with T2.

### T10 — VS Code Marketplace publishing credentials are changing on 2026-12-01

- **Severity:** medium
- **Spine:** AD-29 ("Secrets exist only in `release.yml`"; the extension stores); D5 (publish the extension after npm 1.0.0).
- **Status:** confirmed from secondary sources. Not checked against Microsoft's primary page.

**Evidence:** Azure DevOps **global PATs**, the "All accessible organizations" `VSCE_PAT` that the VS Code docs historically prescribed, stop working on **2026-12-01**. The documented replacement is Microsoft Entra ID workload identity, using `vsce publish --azure-credential` (vsce 2.26.1 or later). Sources:

- a DeepWiki digest of `microsoft/vscode-docs` `publishing-extension.md` (2026-10-08);
- fjan.nl (2026-09-29);
- extension READMEs on the Marketplace (2026-10).

Whether the Marketplace accepts an organization-scoped PAT is reported as an open question (microsoft/vscode#322741, per a secondary source).

**Impact:** the extension will probably publish after 2026-12-01, so a PAT-in-secret release design would fail.

**Fix:** pin the Marketplace authentication method in the release story, and verify it against code.visualstudio.com/api/working-with-extensions/publishing-extension.

### T11 — The MCP Registry is in preview, and its ownership marker must be inside the 1.0.0 tarball

- **Severity:** medium
- **Spine:** AD-28 ("registry name or listing"); AD-29 Binds. The memlog says Story 42.1.5 probes the registry requirements.
- **Status:** confirmed (registry documentation on GitHub `main`; the live registry API answers at `registry.modelcontextprotocol.io/v0/servers`).

**Evidence:**

- **Ownership.** The registry verifies npm ownership through an `mcpName` field in `package.json`, which "MUST match the server name from `server.json`". Only the public npm registry is supported (`docs/modelcontextprotocol-io/package-types.mdx`).
- **Namespaces.**
  - `io.github.<user|org>/*`: an org namespace needs the GitHub org **Owner** role.
  - Reverse-DNS names: verified by a DNS TXT record or by HTTP `/.well-known/mcp-registry-auth` (`authentication.mdx`).
- **Status.** "The MCP Registry is currently in preview", with possible breaking changes or data resets.

**Impact:** `mcpName` is part of the published package version. If it is missing from 1.0.0, listing that version requires a re-publish.

**Fix:** have Story 42.1 add `mcpName` before the first publish, and choose the namespace: `io.github.<owner>`, or a domain the project owns, never an InterSystems one, per AD-28.

### T12 — TypeScript 5.9.3 is two majors behind

- **Severity:** low
- **Status:** confirmed installed (root and extension lockfiles both resolve 5.9.3). Stale against upstream.

**Evidence:** the latest is **7.0.2** (2026-07-08, the native port), and 6.0.3 shipped on 2026-04-16. 5.9.3 (2025-09-30) is the last 5.x release. Nothing breaks today, and `tsconfig.base.json` uses only Node16 module settings.

**Fix:** record when the project moves.

### T13 — Minor version drift on the other Stack rows

- **Severity:** low
- **Status:** confirmed installed. Behind upstream.

| Package | Installed | Latest | Release date of latest |
| --- | --- | --- | --- |
| Turborepo | 2.9.4 | 2.11.8 | 2026-10-13 |
| zod | 4.3.6 | 4.6.7 | 2026-10-12 |
| yaml | 2.9.0 | 2.9.1 | 2026-09-11 |
| smol-toml | 1.7.1 | 1.9.1 | 2026-10-09 |
| @changesets/cli | 2.30.0 | 3.0.3 (the 2.x maintenance line is at 2.31.1) | 2026-09-14 |
| jsonc-parser | 3.3.1 | 3.3.1, already the latest | 2024-06-24 |

The Changesets `fixed` group is confirmed in `.changeset/config.json` (`"fixed": [["@iris-mcp/*"]]`).

### T14 — The Stack table omits the native optional dependency and the Node type definitions

- **Severity:** low
- **Status:** confirmed by in-repo checks.

**Evidence:**

- **The native dependency.** `@napi-rs/keyring` 1.3.0 is the one native module, correctly an `optionalDependency` of `@iris-mcp/shared` per AD-29. The latest is 2.1.1, a new major. It is not in the Stack table.
- **Node types.** `@types/node` is `^25.5.2` against a runtime floor of 22. That lets code type-check against APIs that don't exist on 22, which is the same class of gap as the original `globSync` defect.

**Fix:** add both rows, and either pin `@types/node` to `^22` or rely explicitly on the CI floor leg.

### T15 — The VS Code engine is confirmed, but the extension's type definitions and packager have drifted

- **Severity:** low
- **Status:** confirmed. VS Code 1.101 (released 2025-06-12) is the release where "Extensions can now publish collections of MCP servers" (code.visualstudio.com/updates/v1_101). The extension uses `vscode.lm.registerMcpServerDefinitionProvider` and `McpStdioServerDefinition` (`extension.ts:653-661`).

**Drift:**

- **Type definitions.** The extension's lockfile resolves `@types/vscode` 1.125.0, ahead of `engines.vscode ^1.101.0`. That allows code to compile against APIs newer than the engine floor.
- **Packager.** `@vscode/vsce` is at 3.9.2, against the latest 4.0.0, which requires Node 22 or later.

### T16 — The IRIS CI image tags are confirmed; 2026.2 is a continuous-delivery release

- **Severity:** low
- **Status:** confirmed.

**Evidence:**

- **The tags.** `intersystems/iris-community:2026.2` and `intersystems/irishealth-community:2026.2` both exist on Docker Hub. Each is multi-arch (amd64 and arm64), was updated 2026-07-22, and is currently the same image as `latest-cd`.
- **Local copies.** The locally pulled copies carry the label `com.intersystems.platform-version: 2026.2.0.221.0com`.
- **No newer tag yet.** `2026.3` returns 404.
- **Extended maintenance.** The extended-maintenance line is `latest-em` = **2026.1**, which the CI matrix does not include.
- **Rate limits.** GitHub-hosted runners are exempt from Docker Hub's rate limit for public images (docs.github.com/en/actions/reference/limits), so CI can stay secret-free.

**Consider:** a 2026.1 extended-maintenance leg.

### T17 — The Claude Code distribution claims are confirmed, with small gaps

- **Severity:** low
- **Status:** confirmed (code.claude.com docs, fetched 2026-10-14).

**Evidence:**

- **Skill locations.** Skills load from:
  - `.claude/skills/`, including parent directories and nested directories (the nested ones on demand);
  - `~/.claude/skills/`;
  - a plugin's `skills/`.

  The spine's list leaves out managed settings, directories added with `--add-dir`, and skills synced from claude.ai. That is harmless.
- **`.agents/skills`.** It does not appear in the documented locations. A feature request for it, anthropics/claude-code#66352 (2026-06-08), was "Closed as not planned". I saw that via search, not by opening the issue.
- **Rules.** Plugins have no rules component. A plugin-root `CLAUDE.md` "isn't loaded as context", and the docs say to put such instructions in a skill (plugins-reference).
- **Manifest.** `.claude-plugin/plugin.json` is the manifest location, and the manifest is optional.
- **Marketplace.** The marketplace file is `.claude-plugin/marketplace.json`, with `name`, `owner` and `plugins` required.
- **Not in the spine:**
  - Plugin sources can be an **npm package**, which is a possible option for AD-28's "one assembled pack".
  - Reading `AGENTS.md` natively requires Claude Code v2.1.277 or later.

## Claim ledger

| # | Claim | Spine location | Status | Source |
| --- | --- | --- | --- | --- |
| 1 | Node floor 22, `engines.node >=22` in every package | Stack; AD-29 | Confirmed as a decision; **not implemented** (the root says `>=18`, and no package declares engines) | `package.json:37-39`; package manifests |
| 2 | `fs.globSync` exists from Node 22.0 | memlog; PRD; D4 | Confirmed (added v22.0.0); experimental until v22.17.0 | nodejs.org `latest-v22.x` and `latest-v26.x` `api/fs.json` |
| 3 | Node 22: LTS, end of life 2027-04-30 | Stack | Confirmed (maintenance since 2025-10-21) | nodejs/Release `schedule.json` |
| 4 | Node 24 supported | Stack | Confirmed: Active LTS; maintenance from 2026-10-20; end of life 2028-04-30 | `schedule.json` |
| 5 | Node 26 supported | Stack | Confirmed: Current since 2026-05-05; LTS on 2026-10-28; end of life 2029-04-30 | `schedule.json`; nodejs.org/en/about/previous-releases |
| 6 | Node 18 and 20 end of life (2025-04-30, 2026-04-30) | D4 | Confirmed | `schedule.json` |
| 7 | CI tests the floor of 22, 24 and 26 | Stack | Unconfirmed and ambiguous; the reference CI pins 22.22.3 | OcuPilot `ci.yml:88-90` |
| 8 | TypeScript 5.9.3 | Stack | Confirmed installed; latest is 7.0.2 | lockfiles; npm registry |
| 9 | @modelcontextprotocol/sdk 1.29.0 | Stack | Confirmed installed (lock); consumers resolve 1.32.1; v2 2.3.1 exists | lockfile; npm registry |
| 10 | SDK 1.29.0 provides the stdio server transport and the capabilities used | Stack; AD-10; AD-23 | Confirmed: `McpServer`, `registerTool`, `registerPrompt`, `registerResource`, `ResourceTemplate`, `StdioServerTransport`, `McpError` and `ErrorCode` all load from the installed 1.29.0 | scratchpad import probe against `node_modules/.pnpm/@modelcontextprotocol+sdk@1.29.0` |
| 11 | MCP specification 2025-11-25 | Stack | **Contradicted** as current (2026-07-28); confirmed as SDK 1.x's `LATEST_PROTOCOL_VERSION` | modelcontextprotocol.io/specification/versioning; jsDelivr `types.js` |
| 12 | zod 4.3.6 | Stack | Confirmed installed; latest is 4.6.7 | lockfile; npm registry |
| 13 | pnpm 9.15.0 | Stack | Confirmed (`packageManager`); 9.x frozen at 9.15.9; latest is 12.11.2 | `package.json`; npm dist-tags |
| 14 | Turborepo 2.9.4 | Stack | Confirmed; latest is 2.11.8 | lockfile; npm registry |
| 15 | Vitest 2.1.9 | Stack | Confirmed; end-of-life major with critical advisories | lockfile; npm registry; `pnpm audit` |
| 16 | @changesets/cli 2.30.0 and the `fixed` group | Stack; AD-29 | Confirmed; latest is 3.0.3 | lockfile; `.changeset/config.json` |
| 17 | jsonc-parser 3.3.1 | Stack | Confirmed; already the latest | npm registry |
| 18 | yaml 2.9.0 | Stack | Confirmed; latest is 2.9.1 | npm registry |
| 19 | smol-toml 1.7.1 | Stack | Confirmed; latest is 1.9.1 | npm registry |
| 20 | IRIS support floor 2023.1 | Stack | **Contradicted** (the vendor minimum has been 2024.1 since 2026-07-01); not CI-testable from Docker Hub | intersystems.com/support/minimum-supported-version; Docker Hub API |
| 21 | Atelier v8 for the full feature set | Stack | Partly confirmed: 2026.2 reports api 8, but no code needs more than v7; which IRIS release introduced v8 is unconfirmed | `iris_server_info`; `format.ts:167` |
| 22 | CI images `iris-community:2026.2` and `irishealth-community:2026.2` | Stack; AD-29 | Confirmed (multi-arch; equal to `latest-cd`) | Docker Hub tags API; local `docker image inspect` |
| 23 | VS Code engine `^1.101.0` | Stack | Confirmed | code.visualstudio.com/updates/v1_101 |
| 24 | Skills load from `.claude/skills`, `~/.claude/skills` and plugin `skills/` | AD-28 (via DR Part 2) | Confirmed (the list is incomplete but correct) | code.claude.com/docs/en/skills |
| 25 | Claude Code does not read `.agents/skills` | DR Part 2 | Confirmed | skills docs; anthropics/claude-code#66352 (via search) |
| 26 | `.claude/rules/*.md` support `paths:` | DR Part 2 | Confirmed; the "always-on" fit is **contradicted** (T4) | code.claude.com/docs/en/memory |
| 27 | Plugins cannot carry rules | AD-28 | Confirmed | code.claude.com/docs/en/plugins-reference |
| 28 | `.claude-plugin/plugin.json` | DR Part 3 / D-plugin | Confirmed (optional) | plugins-reference |
| 29 | `marketplace.json` | DR Part 2 | Confirmed at `.claude-plugin/marketplace.json` | plugins/marketplace-reference |
| 30 | Publishing with npm provenance from a protected environment | AD-29 | Feasible, but the requirements and the first-publish path are unrecorded (T2) | docs.npmjs.com/trusted-publishers; staged-publishing; npm-trust |
| 31 | Secrets exist only in `release.yml` | AD-29 | Feasible; the platform credential rules are changing (npm 90-day tokens; Azure DevOps PATs end 2026-12-01) | GitHub changelog 2025-12-09; T10 sources |
| 32 | MCP Registry listing | AD-28; memlog 42.1.5 | Confirmed live and in preview; `mcpName` required | modelcontextprotocol/registry docs; live `/v0/servers` |
| 33 | No required native dependency; a native module only as an optional dependency | AD-29 | Confirmed (`@napi-rs/keyring` 1.3.0 is optional) | `packages/shared/package.json` |
| 34 | CI is secret-free on throwaway containers | AD-29 | Confirmed feasible (public-image pulls are exempt from rate limits on GitHub-hosted runners) | docs.github.com/en/actions/reference/limits |

## What I could not confirm

- Whether `containers.intersystems.com` still hosts 2023.1 or 2024.1 community images: anonymous token exchange returned 401.
- Which IRIS release introduced Atelier API v8, and which version 2023.1 ships.
- Whether a `paths:` rule loads before or after Claude's first `Write` of a new matching file.
- Whether `fs.globSync` emits an `ExperimentalWarning` on Node 22.0–22.16. It is documented as experimental there; the warning was not observed on a real 22.0 binary.
- Whether the VS Code Marketplace accepts organization-scoped PATs. This rests on secondary sources only; I did not fetch Microsoft's primary publishing page.
- Whether the MCP Registry requires the npm version to be published before `mcp-publisher publish`. That is implied by the `mcpName` check, but not stated.
- The Open VSX and IPM registry publishing requirements, which AD-29's release step lists. I did not research them.
- The Copilot (`.github/instructions`) and Cursor (`.cursor/rules`) install locations in DR Part 2. They are outside the spine's text and were not re-verified.

## Sources (all fetched 2026-10-14)

- npm registry packuments and dist-tags: `https://registry.npmjs.org/<pkg>`, for typescript, @modelcontextprotocol/sdk, @modelcontextprotocol/server, zod, pnpm, turbo, vitest, @changesets/cli, jsonc-parser, yaml, smol-toml, @napi-rs/keyring, @types/vscode, @vscode/vsce and npm.
- SDK protocol constants: `https://cdn.jsdelivr.net/npm/@modelcontextprotocol/sdk@{1.29.0,1.32.1}/dist/esm/types.js`.
- MCP specification: `https://modelcontextprotocol.io/specification/versioning`, `/specification/2026-07-28/changelog` and `/specification/2026-07-28/server/discover`.
- MCP TypeScript SDK README (`https://github.com/modelcontextprotocol/typescript-sdk`); v2 migration guide (`https://ts.sdk.modelcontextprotocol.io/v2/migration/upgrade-to-v2`).
- Node.js: `https://raw.githubusercontent.com/nodejs/Release/main/schedule.json`; `https://nodejs.org/docs/latest-v22.x/api/fs.json` and `latest-v26.x/api/fs.json`; "Evolving the Node.js Release Schedule" (nodejs.org blog, 2026-03-10); `https://nodejs.org/en/about/previous-releases`.
- Claude Code: `https://code.claude.com/docs/en/skills`, `/memory`, `/plugins-reference` and `/plugins/marketplace-reference`; anthropics/claude-code#66352 (2026-06-08, via Perplexity search).
- npm: `https://docs.npmjs.com/trusted-publishers/` (page dated 2026-10-06), `https://docs.npmjs.com/staged-publishing/`, `https://docs.npmjs.com/cli/v11/commands/npm-trust/`; GitHub changelog "npm classic tokens revoked…" (2025-12-09); GitHub changelog "Multiple trusted publishing configurations for npm" (2026-09-03, via Perplexity).
- pnpm and Changesets: `https://pnpm.io/cli/publish`; pnpm/pnpm#11513 (2026-05-07, via search); changesets/changesets#2099 (2026-06-18; closed 2026-07-02); `https://raw.githubusercontent.com/changesets/changesets/main/packages/cli/CHANGELOG.md`.
- MCP Registry: `https://github.com/modelcontextprotocol/registry/blob/main/docs/modelcontextprotocol-io/package-types.mdx` and `authentication.mdx`; live `https://registry.modelcontextprotocol.io/v0/servers`.
- InterSystems: `https://www.intersystems.com/support/minimum-supported-version/`; Docker Hub `https://hub.docker.com/v2/repositories/intersystems/{iris-community,irishealth-community}/tags`.
- VS Code: `https://code.visualstudio.com/updates/v1_101` (2025-06-12); DeepWiki digest of microsoft/vscode-docs publishing-extension.md (2026-10-08); `https://www.fjan.nl/en/posts/azure-devops-global-pat-retirement` (2026-09-29).
- GitHub Actions limits: `https://docs.github.com/en/actions/reference/limits`.
- In-repo: `package.json` (root and every package); `pnpm-lock.yaml`; `extensions/iris-mcp-launcher/package-lock.json`; `.changeset/config.json`; `packages/shared/src/server-base.ts:15-22,543-551`; `packages/iris-dev-mcp/src/tools/load.ts:12,382`; `pnpm audit --json`; `iris_server_info` (the shared dev instance, read-only); `docker image inspect` on the local IRIS images; `../OcuPilot/.github/workflows/ci.yml:88-90`.
