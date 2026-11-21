---
title: 'Story 42.8: Claude Code Plugin and Registry Listings'
type: 'feature'
created: '2026-11-21'
status: 'done'
baseline_revision: 'fc113e7b8737427ac846d069cbe4931b08e6de23'
review_loop_iteration: 0
followup_review_recommended: true
context:
  - '{project-root}/_bmad-output/planning-artifacts/architecture/architecture-iris-execute-mcp-v2-2026-10-14/ARCHITECTURE-SPINE.md'
  - '{project-root}/_bmad-output/implementation-artifacts/epic-42-context.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-42-7-vs-code-extension-publish.md'
warnings:
  - multiple-goals
  - oversized
deferred:
  - summary: >-
      Candidate (AC 42.8.3): an optional compile-on-save PostToolUse hook in the Claude Code plugin. Evaluated in this story and
      not shipped (Orchestrator decision 6); it ships opt-in only if the Lead approves it.
    evidence: >-
      Claude Code 2.1.330 docs (hooks, manifest-reference, fetched 2026-11-21): no per-hook toggle ("There is no way to disable
      an individual hook while keeping it in the configuration"); hooks run outside the sandbox with full user permissions; a
      compile needs an IRIS client outside MCP plus a target choice. Agents already compile through iris_doc_load/iris_doc_compile,
      which the always-on rule requires.
    location: 'packages/client-config/skills-pack (plugin root); no hooks/ directory'
    severity: low
  - summary: >-
      Nothing in the default suite pins Claude Code's acceptance of plugin.json, .mcp.json and marketplace.json: a later gen:pack that
      emits a field the validator rejects stays green.
    evidence: >-
      The only evidence is the recorded manual `claude plugin validate` and `plugin details` runs (Claude Code 2.1.330). The CLI is not
      guaranteed on CI runners. An added unsupported key in skills-pack-src/plugin/plugin.json leaves gen:pack:check, check:provenance
      and the unit tests green.
    location: 'skills-pack-src/plugin/plugin.json; .claude-plugin/marketplace.json'
    severity: low
  - summary: >-
      JOB_TIMEOUT_MINUTES.ipm (45) is unchanged although the registry-shaped leg adds two containers per run; the spec says to raise it
      only by the measured need.
    evidence: >-
      No measurement exists: the harness run was not part of this stage (lead A1 is the binding run). Read the A1 duration and raise
      the budget in scripts/lib/ci-checks.mjs if the job approaches 45 minutes.
    location: 'scripts/lib/ci-checks.mjs JOB_TIMEOUT_MINUTES.ipm'
    severity: low
---

<intent-contract>

## Intent

**Problem:** The suite has no Claude Code plugin, no MCP Registry listing and no live IPM channel:
- Claude Code users wire five servers by hand and install the skills separately.
- The installer's `claude-code` route always installs the skills, so a plugin user would get them twice (DW-625).
- The release's `ipm` channel ships disabled.
- No gate installs the artifact the IPM registry actually serves, a tar of the packaging repository root (DW-694).
- Nothing lists the servers on the MCP Registry.
- The plugin's version policy is still open (spine Deferred).

**Approach:**
- **Code (stages, on `epic42`):**
  - The skills pack directory becomes a Claude Code plugin root. `gen:pack` emits `.claude-plugin/plugin.json` and `.mcp.json` there: five `npx -y @iris-mcp/<pkg>@1` servers, connected through plugin `userConfig`.
  - A repo-root `.claude-plugin/marketplace.json` lists the plugin, pinned to the release tag.
  - The installer installs only the rule when it detects the enabled plugin.
  - `check:provenance` gains a `plugin` rule.
  - The `ipm` channel is enabled, with a pinned GitHub host key.
  - CI's `ipm` job also installs the registry-shaped tar offline.
  - A new `mcp-registry` channel publishes five generated `server.json` files with GitHub OIDC.
  - Every new version-embedding file is stamped by `pnpm run version`.
- **Publishing and listings (lead and owner):** the first plugin, IPM and registry release is `v1.1.0` (decision #95). The Open Exchange listing and the live installs are lead checklist steps after it.

## Boundaries & Constraints

**Always:**
- **The plugin root is the pack** (AD-28: "the plugin uses the same directory"): `packages/client-config/skills-pack/`.
  - `gen:pack` writes `.claude-plugin/plugin.json` and `.mcp.json` there from a new allowed source entry `skills-pack-src/plugin/`.
  - `plugin.json` is rendered with `version` = `@iris-mcp/client-config`'s version. `.mcp.json` is copied byte for byte from `skills-pack-src/plugin/mcp.json`.
  - `gen:pack:check` covers both files. A hand-placed file is stray.
- **Names** (decision 1): plugin `iris-mcp`, marketplace `iris-mcp` (the `enabledPlugins` key is `iris-mcp@iris-mcp`), display name "IRIS MCP Server Suite". Nothing says "claude", "anthropic", "official" or "intersystems" in a name (AD-28; Claude Code's validator rejects claude/anthropic names).
- **The marketplace entry pins the release tag** (AD-29 Pins): `source` is `{"source":"git-subdir","url":"https://github.com/jbrandtmse/iris-execute-mcp-v2.git","path":"packages/client-config/skills-pack","ref":"v<shared version>"}`. A relative-path source is forbidden, because it resolves at the marketplace clone's branch, not at a tag.
- **Plugin version lockstep** (decision 3): `plugin.json` `version`, the marketplace `ref`, and every `server.json` `version`/`packages[0].version` equal the shared version.
  - `pnpm run version` regenerates all of them (it runs `gen-pack` and `gen-listings` after `gen-bootstrap`).
  - `embeddedVersionProblems` refuses any mismatch in both modes.
- **The plugin's IRIS connection** (decision 4): six `userConfig` options:
  - `iris_host`: string, default `localhost`;
  - `iris_port`: number, default `52773`;
  - `iris_namespace`: string, default `USER`;
  - `iris_https`: boolean, default `false`;
  - `iris_username`: string, `required`;
  - `iris_password`: string, `required`, `sensitive`.

  Each maps to its `IRIS_*` variable in every server's `env` as `${user_config.<key>}`. Every referenced option is `required` or has a `default`: an unset option with no default substitutes `""` (observed), and `loadConfig` reads `""` as a broken host or port. All other `IRIS_*` variables are inherited from Claude Code's environment (observed).
- **`.mcp.json` server keys are `dev`, `admin`, `data`, `interop`, `ops`** (decision 5), so every `mcp__plugin_iris-mcp_<key>__<tool>` stays at or under 64 characters (the longest tool, 28 characters, gives 58). Each entry's `args` is `["-y", pinnedSpec(<package>)]`.
- **The installer's plugin detection** (DW-625, decision 7): read `enabledPlugins["iris-mcp@iris-mcp"]` from exactly these files, in precedence order (lowest to highest). The highest file that has the key decides. The run reports which file decided, or that none did.
  1. user: `$CLAUDE_CONFIG_DIR/settings.json`, else `<home>/.claude/settings.json`;
  2. project: `<project>/.claude/settings.json`;
  3. local: `<project>/.claude/settings.local.json`.

  Out of scope, stated in the docs: managed settings, `--settings`, `--add-dir` and synced plugins (source: Claude Code settings reference, `enabledPlugins`, fetched 2026-11-21).
- **Channels** (AD-29): npm, Marketplace, Open VSX, IPM, then `mcp-registry`, the new channel, appended last.
  - IPM: `enabled: true`. The push trusts only GitHub's three published host keys (pinned; `StrictHostKeyChecking=yes`, never `accept-new`).
  - `IPM_DIST_DEPLOY_KEY` is redacted from every report line.
  - `mcp-registry`: `mcp-publisher` v1.8.10 (`mcp-publisher_linux_amd64.tar.gz`, sha256 `32d287ed6fb7dc04eddd2621097784c06a355b2348b35ccc630a1643aa75ff4a`), downloaded by `release.mjs` and verified before use. It runs `login github-oidc` (no secret) and one `publish` per `server.json` from the hash-verified artifacts.
  - Only argv builders form a publish verb (`mcpPublisherArgv` joins them).
- **Secrets and OIDC.** The OIDC request variables reach only `npm`, `vsce`, `ovsx` and `mcp-publisher`. `mcp-publisher` runs with a temporary `HOME` that is removed on every exit path, so its login token never outlives the step.
- **42.5–42.7 constraints stay:**
  - `release.mjs` statically imports only `node:` builtins, `release-core.mjs` and `script-process.mjs`, and `release-core.mjs` stays pure.
  - Error text has the form `<what happened>. <what to do>.`
  - Rule 14 escapes; Rule #55 (no heredoc writes).
  - The `release.yml`/`release-checks.mjs` and `ci.yml`/`ci-checks.mjs` self-tests stay green.
  - Every `npx` spec carries `@1`.

**Never:**
- **No publish-shaped command, ever.** No stage runs `npm`/`pnpm publish`, `changeset publish`/`version`, `pnpm run version` on the real tree, `mcp-publisher login`/`publish`, `vsce`/`ovsx` publish, `npm login`/`trust`, `git tag`/`push`, `gh repo create`, `gh release`/`workflow run`/`secret`, or a non-GET `gh api`.
- **No owner setup.** No stage creates a repository, deploy key, secret, Open Exchange app or marketplace submission.
- **No real Claude Code state.** No stage changes the user's `~/.claude`: Claude Code probes run under a scratch `CLAUDE_CONFIG_DIR`, from a non-repo cwd, with no `sensitive` option set.
- **No docker outside the harness, no IRIS call.** Throwaway containers start only through `scripts/throwaway-iris.mjs` (decisions #55/#64/#71) and are removed afterwards. No edit to ObjectScript, REST routes, frozen goldens, the governance baseline (`1e62c5ad5bf7`/141), `irislib/` or `irissys/`. `BOOTSTRAP_VERSION` does not move.
- **Nothing the plugin cannot carry.** No hooks directory (AC 42.8.3 unless the Lead approves), no rules, no `CLAUDE.md` in the plugin. No new tool or tool count change.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Installer, no plugin (DW-625) | `skills install --client claude-code`; none of the three settings files has `iris-mcp@iris-mcp` | skills and the rule installed, as today; report `no Claude Code plugin iris-mcp@iris-mcp is enabled (checked <3 paths>); installing the skills and the rule` | — |
| Installer, plugin on | user settings `{"enabledPlugins":{"iris-mcp@iris-mcp":true}}` | only `.claude/rules/iris-mcp-objectscript-pre-write.md`; report names the file that decided | — |
| Local override | user `true`, `.claude/settings.local.json` `false` | skills and the rule (local wins) | — |
| Project scope | `.claude/settings.json` `true`, nothing else | rule only | — |
| Config dir moved | `CLAUDE_CONFIG_DIR=<d>`, `<d>/settings.json` `true`; `~/.claude/settings.json` absent | rule only; `~/.claude` not read | — |
| Unreadable settings | one of the three files is not valid JSON/JSONC | a `[WARN]` line naming the file; that file counts as having no entry | no refusal |
| Plugin added after skills | manifest lists `.claude/skills/**` from an earlier run; plugin now on | owned skill paths removed under the existing manifest rules (a modified file refuses unless `--include-modified`); rule kept | existing refusal text |
| IPM rehearse, repository absent | `ls-remote --symref` fails | `ipm: not ready (the packaging repository jbrandtmse/iris-execute-mcp-v2-ipm is absent or not readable …)`; rehearse exit 1 (intended, owner step O-IPM1 precedes `v1.1.0`) | dry run exit 1 |
| IPM rerun | registry lists `<v>`; packaging tag `v<v>` holds the identical tree | `already published`; nothing pushed | — |
| IPM listed, tree differs | registry lists `<v>`; tag absent or a different tree | `failed (…)`; what follows `not attempted` | exit 1 |
| IPM host key | publish push | `GIT_SSH_COMMAND` carries `StrictHostKeyChecking=yes` and `UserKnownHostsFile=<0600 temp>` holding the three pinned keys; the file is removed on exit | an unknown host key fails the push |
| Registry dry step | publisher hash ok; `validate` ok ×5; lookups 404 ×5 | `mcp-registry: ready (would publish 5 servers)`; all 200 → `ready (would be already published)` | hash mismatch, validate failure or an unreadable lookup → `not ready (…)`, exit 1 |
| Registry publish | lookup 404 | npm `<pkg>@<v>` visible (polled ≤ 5 min) → `publish <server.json>` exit 0 → `<name>@<v>: published (auth: oidc)` | npm never visible → `failed`, nothing posted |
| Registry already there | lookup 200 whose `server.name`/`server.version` match | `already published`; no `publish` call | — |
| Registry lookup unknown | non-2xx other than 404, wrong body, stall 30 s | `failed (could not ask the MCP Registry …)`; nothing after it attempted | exit 1 |
| Registry publish fails | CLI exit ≠ 0; a fresh lookup still 404 | `failed (<last 4 lines, redacted>)`; a fresh lookup 200 → `already published` (race) | exit 1 |
| Registry-shaped IPM archive (DW-694) | CI `ipm` job: the staged packaging root tarred by GNU tar `--exclude=.git -czf … -C <root> .` inside the Linux build container | `load <tgz>` (non-dev) on a fresh `--network none` container per edition: 36 classes compiled, web app `/api/executemcp/v2` and `%ALL` mapping present, `%IPM_Repo.Definition` 0 rows | job fails naming the edition and check |
| Version step | `pnpm run version` with a pending changeset | `plugin.json` `version`, marketplace `ref` `v<v>`, five `server.json` at `<v>`; post-check empty | a mismatch names the file and says `run pnpm run version` |

</intent-contract>

## Code Map

**The plugin (AD-28; extend the pack, never a second copy)**
- `skills-pack-src/plugin/plugin.json` (new): `name`, `displayName`, `description` (ends with the no-endorsement sentence, the `ipmReadme` wording), `author`, `homepage`, `repository`, `license` `MIT`, `keywords`, `userConfig` (the six options). No `version`, which `gen:pack` adds.
- `skills-pack-src/plugin/mcp.json` (new): `{"mcpServers":{"dev":{…},"admin":{…},"data":{…},"interop":{…},"ops":{…}}}`.
  - Each entry is `{"command":"npx","args":["-y","@iris-mcp/<pkg>@1"],"env":{"IRIS_HOST":"${user_config.iris_host}",…}}`.
  - It mirrors the shape `shapeEntry` (`packages/client-config/src/diff.ts:135-142`) renders for `CLIENT_ADAPTERS["claude-code"]` (`adapters.ts:35`).
- `scripts/lib/skills-pack.mjs`:
  - `assemblePack` :575, allow-list :583-596: add the `plugin` directory, which may hold exactly those two files.
  - Emit `.claude-plugin/plugin.json` (source plus `version`, 2-space JSON with a trailing newline) and `.mcp.json` (bytes).
  - `renderPackReadme` :247: add a "Claude Code plugin" section. It covers: the install (`/plugin marketplace add jbrandtmse/iris-execute-mcp-v2`, then `/plugin install iris-mcp@iris-mcp`); the six options; that plugins cannot carry rules, with the pinned installer command for `--client claude-code` (the form documented at `packages/client-config/README.md:70-129`); and that the plugin's settings win over exported `IRIS_HOST`/`PORT`/`NAMESPACE`/`HTTPS`/`USERNAME`/`PASSWORD`.
  - The Layout line :41 is pinned by `skills-pack.test.ts:138`.
  - `listAgentContentFiles` :704 stays skills/rules only.
- `scripts/gen-pack.mjs` (78 lines) and `scripts/lib/generated-tree.mjs` `diffTree`: unchanged; they pick the new files up.
- `packages/client-config/package.json` `files` already ships `skills-pack` (dot-entries included). `story-41-1-qa-pack-tarball.test.ts:107,143` then requires them in the tarball.
- `.claude-plugin/marketplace.json` (new, repo root; generated by `gen-listings`, see below): `{"name":"iris-mcp","owner":{"name":"jbrandtmse"},"plugins":[{"name":"iris-mcp","description":…,"source":{git-subdir as in Boundaries}}]}`.
- `scripts/lib/npx-pin-scan.mjs` :34-40 already scans `.claude-plugin/*` and `.json` (`npx-pin.test.ts:190-194`).

**The installer (DW-625)**
- New `packages/client-config/src/claude-plugin-detect.ts`: `detectClaudeCodePlugin(host)`, where `host` is `{ homeDir, projectDir, env, readFile }` from `HostContext` (`types.ts:153`; core never reads `os.homedir()`). It returns `{ enabled: boolean, decidedBy: string | null, checked: string[], warnings: string[] }`.
  - Parse with the `engine.ts:28,622` pattern: `parseJsonc(…, { allowTrailingComma: true, disallowComments: false })`.
  - The id constant `CLAUDE_CODE_PLUGIN_ID = "iris-mcp@iris-mcp"` is exported from `index.ts` and cross-checked against `plugin.json` and `marketplace.json` names by a test.
  - Sibling: the claude-code adapter's detection (`adapters.ts:35-79`).
- `packages/client-config/src/pack-plan.ts`:
  - `desiredState` :439 / `planPackChange` :614 take an option `skipSkills` for the `claude-code` route.
  - The existing manifest rules (`:9-13`, `parseManifest` :231) remove owned skill paths no client needs. Verify that, and extend it only if removal is keyed to "absent from the pack" rather than "absent from the desired state".
- `packages/client-config/src/cli/clients.ts`:
  - `cmdSkills` :1821 (and `resolveDeps` :160-176): for `--client claude-code` install, call the detector and pass `skipSkills`, then print the report line.
  - Uninstall is unchanged. `SKILLS_USAGE` :1815 gains one sentence.
- `packages/client-config/src/pack-targets.ts` `PACK_TARGETS` claude-code `why` :134: mention the plugin.
- Doc pins that move:
  - root `README.md:936`, `packages/client-config/README.md:117-118` ("does not detect a Claude Code plugin");
  - `story-41-7-doc-claims.test.ts:281`, `client-config/src/__tests__/skills-docs.test.ts:196-198`.
- Tests:
  - `pack-plan.test.ts:91` (claude-code rows);
  - `skills-cli.test.ts:145`;
  - new `claude-plugin-detect.test.ts`: every matrix row, with fixture settings in the real `enabledPlugins` shape (settings reference, Rule #54).

**Generated listings (new generator; Rule #18 output-only, sibling of `gen-pack`)**
- New `scripts/gen-listings.mjs` (`gen:listings`, `gen:listings:check`, using `generated-tree`'s diff/write helpers) renders two things from each `package.json` and one connection-variable constant:
  - `packages/iris-{dev,admin,data,interop,ops}-mcp/server.json`:
    - `$schema` `https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json`;
    - `name` = `mcpName`;
    - `description` = the package description (refuse > 100 characters);
    - `title`, `version`;
    - `repository {url, source:"github", subfolder:"packages/iris-<x>-mcp"}`, `websiteUrl`;
    - `packages:[{registryType:"npm", identifier, version, runtimeHint:"npx", transport:{type:"stdio"}, environmentVariables:[…]}]`.
  - `.claude-plugin/marketplace.json`.
- Root `package.json`: the two scripts. `scripts/lib/ci-checks.mjs` `ROOT_GATE_SCRIPTS` :292 and `.github/workflows/ci.yml` get `gen:listings:check` (the self-test enforces equality).
- The environment-variable list: `IRIS_HOST` (default `localhost`), `IRIS_PORT` (`52773`, format number), `IRIS_USERNAME` (required), `IRIS_PASSWORD` (required, secret), `IRIS_NAMESPACE` (`USER`), `IRIS_HTTPS` (`false`, boolean).
  - It is pinned equal to client-config's `CONNECTION_VARS` (`synthesize.ts:107`) plus `IRIS_PASSWORD`, and to the defaults in `packages/shared/src/config.ts:134-176`.
  - The plugin's six `userConfig` options map onto the same six.
- Descriptions today: 30–43 characters (all under 100).

**Provenance (AC 42.8.1, "41.1's provenance check is extended to the plugin folder")**
- `scripts/lib/provenance-core.mjs` `checkProvenance` :248: add a rule `plugin`. It requires:
  - `PACK_DIR/.claude-plugin/plugin.json` with `name` `iris-mcp`;
  - `.mcp.json` server set = `{dev, admin, data, interop, ops}`;
  - the notice at the plugin root;
  - the marketplace entry's `source.path` = the pack directory, and `source.ref` = `v<version>`;
  - no endorsement wording in `name`, `displayName`, `description` or `title` of `plugin.json`, `marketplace.json` and the five `server.json`.
- `scripts/lib/provenance-inputs.mjs` :227 gathers those files.
- Extract the endorsement deny-list from `package-manifests.test.ts:253-273` into `scripts/lib/endorsement.mjs` and use it in both places (Rule 2).
- Tests: `pack-provenance.test.ts` (default suite) plus fixtures (`pack-fixture.ts`).

**Release (extend 42.5/42.7; never copy)**
- `scripts/lib/release-core.mjs`:
  - `RELEASE_CHANNELS` :31-36: `ipm` `enabled: true` (drop `enabledBy`); append `{ id: 'mcp-registry', enabled: true }`.
  - IPM constants :43-46. New `GITHUB_SSH_KNOWN_HOSTS`: three lines, each `github.com ` followed by one entry of `https://api.github.com/meta` `ssh_keys` (read-only GET, captured by the plan on 2026-11-21):
    - `ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIOMqqnkVzrm0SdG6UOoqKLsabgH5C9okWi0dh2l9GKJl`
    - `ecdsa-sha2-nistp256 AAAAE2VjZHNhLXNoYTItbmlzdHAyNTYAAAAIbmlzdHAyNTYAAABBBEmKSENjQEezOmxkZMy7opKgwFB9nkt5YRrYMjNuG5N87uRgg6CLrbo5wAdT/y6v0mKV0U2w0WZ2YB/++Tpockg=`
    - `ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAABgQCj7ndNxQowgcQnjshcLrqPEiiphnt+VTTvDP6mHBL9j1aNUkY4Ue1gvwnGLVlOhGeYrnZaMgRK6+PKCUXaDbC7qtbW8gIkhL7aGCsOr/C56SJMy/BCZfxd1nWzAOxSDPgVsmerOBYfNqltV9/hWCqBywINIR+5dIg6JTJ72pcEpEjcYgXkE2YEFXV1JHnsKgbLWNlhScqb2UmyRkQyytRLtL+38TGxkxCflmO+5Z8CSSNY7GidjMIZ7Q4zMjA2n1nGrlTDkzwDCsw+wqFPGQA179cnfGWOWRVruj16z6XyvxvjJwbz0wQZ75XK5tKSb7FNyeIEs4TT4jk+S4dhPeAUC5y+bDYirYgM4GC7uEnztnZyaVWQ7B381AK4Qdrwt51ZqExKbQpTUNn+EjqoTwvqNj4kqx5QUCI0ThS/YkOxJCXmPUWZbhjpCg56i+2aB6CmK2JGhn57K5mj0MNdBXA4/WnwH6XoPWJzK5Nyu2zB3nAZp+S5hpQs+p1vN1/wsjk=`

    The published SHA256 fingerprints are ED25519 `+DiY3wvvV6TuJJhbpZisF/zLDA0zPMSvHdkr4UvCOqU`, ECDSA `p2QAMXNIC1TJYWeIOttrVc98/R1BUFWu3/LiyKgUfQM` and RSA `uNiVztksCsDhcc0u9e8BujQXVUpKZIDTMczCvj3tD2s`. A test recomputes each fingerprint from the pinned key (base64-decode, SHA-256, unpadded base64).
  - `ipmPushPlan` :548-566 is unchanged in shape.
  - New pure functions:
    - `MCP_REGISTRY_BASE` `https://registry.modelcontextprotocol.io`;
    - `MCP_PUBLISHER` `{version:'v1.8.8', asset:'mcp-publisher_linux_amd64.tar.gz', sha256:'09f1fa70ee146b640584274a1a6b2b8a0310b05d4321fa9224e6df6a016d67f4'}` (decision #110, see the Spec Change Log), with the URL `https://github.com/modelcontextprotocol/registry/releases/download/v1.8.8/<asset>`;
    - `mcpPublisherArgv(verb, file?)` → `['login','github-oidc']` | `['validate', f]` | `['publish', f]`;
    - `registryLookupUrl(name, version)` → `/v0.1/servers/<encodeURIComponent(name)>/versions/<encodeURIComponent(version)>`;
    - `registryOutcome(response)` → published (200 JSON whose `server.name` and `server.version` match) / absent (404) / unknown. This is the `storeOutcome` :494-509 sibling. Oracle (Rule #36, read-only GETs on 2026-11-21): `io.github.upstash/context7@4.7.3` → 200 `{"server":{…},"_meta":{…}}`; `@0.0.0-nonexistent` and `io.github.jbrandtmse/iris-dev-mcp@1.0.0` → 404 `{"title":"Not Found","status":404,"detail":"Server not found"}`.
  - `skippedText` and `releaseReport` shapes are unchanged.
- `scripts/release.mjs`:
  - header CONTRACT :12-56 (the fifth channel, OIDC to `mcp-publisher`, the host-key pin);
  - `SECRET_VARIABLES` :146, which already holds the deploy key;
  - the `runPublish` redaction list :1061/:1068: add `IPM_DIST_DEPLOY_KEY`;
  - `readReleaseFacts` :483 and `embeddedVersionProblems` :524-543: add `plugin.json`, the marketplace `ref`, and the five `server.json` versions;
  - `stageIpm` :640-651 → moved to `scripts/lib/ipm-archive.mjs` as `stagePackagingRoot(dir, embed, { version, licenseText })`, imported dynamically in `prepare` :789, so the CI gate and the release share one function;
  - `runPrepare`: copy the five `server.json` into `<artifacts>/mcp-registry/<bin>.json`, add them to the manifest channel entries, and add them to `uploadPathProblems` :888-892;
  - `dryStep` :1147-1161:
    - IPM: a registry-listed version becomes `ready (would be already published)`;
    - add the `mcp-registry` dry step;
  - `runChannel` :1197;
  - `publishIpm` :1232-1278:
    - step 1 is amended: a listed version goes on to the tag/tree check;
    - step 3: a known_hosts file plus `StrictHostKeyChecking=yes`;
  - new `publishMcpRegistry` (download with `deps.fetch`, sha256 check, `tar -xzf` into a temp dir, temp `HOME`, the npm visibility poll against `https://registry.npmjs.org/<pkg>/<v>`, login, per-server lookup → publish → re-lookup);
  - `verify --version <v>`: add the five registry GETs and the packaging repository's `v<v>` tag (`ls-remote`).
  - DW-704 line :1125 is unchanged.
- `scripts/lib/release-checks.mjs` :118-121 and `.github/workflows/release.yml` :149-152: the publish step env adds `IPM_DIST_DEPLOY_KEY: ${{ secrets.IPM_DIST_DEPLOY_KEY }}`; header comment :17-20.
- `scripts/lib/release-workflow-check.ts` :102 `RAW_VERB`: add raw `mcp-publisher (login|publish)` outside the builders.
- `scripts/release-version.mjs`:
  - after `gen-bootstrap`, run `scripts/gen-pack.mjs` and `scripts/gen-listings.mjs`;
  - list the new files in its next-steps line (:219);
  - the post-check :210-216 already runs `embeddedVersionProblems`.

**CI `ipm` job (DW-694; extend 42.4's script)**
- `scripts/ci-ipm-archive.mjs` (contract :10-38): after the existing per-edition install leg, add a registry-shaped leg:
  1. `stagePackagingRoot` into a host directory;
  2. mount it read-only in the build container;
  3. `tar --exclude=.git -czf /tmp/iris-mcp-ipm-out/registry-root.tgz -C <mount> .` inside it (GNU tar, the zpm-registry `UpdatePackage` command; no pax headers);
  4. copy it out and check its members: `./module.xml` at top, no `.git`, exactly the staged files;
  5. on a fresh `--network none` container per edition, `load /opt/iris-mcp/install/registry-root.tgz` (non-dev; `IPM_VERBS` :30-33 unchanged);
  6. re-run the existing install assertions (reuse their functions).
- `scripts/lib/ci-checks.mjs` `JOB_TIMEOUT_MINUTES.ipm` :61: raise it only by the measured need, recording the duration.
- `ci-ipm-archive.test.ts` :245 (the tar-in-test precedent) and :458.

**Tests that flip with the channels** (`packages/iris-mcp-all/src/__tests__/`)
- `release-core.test.ts` :68-76, :403-455, :667;
- `release-workflow.test.ts` :395-399 (5 channels, all enabled);
- `release-prepare.test.ts` :586-611 (`["ipm", false]` :607), :795-803;
- `release-script.test.ts`:
  - the default-channel rows :1305-1315, :1375-1378, :1476, :1981-1982, :2042-2053;
  - the IPM block :1805-1946;
  - the dry step :2016-2090;
  - presets `ALL_ENABLED` :698, `IPM_ONLY` :701, `NPM_ONLY` :704;
- `release-script-fixtures.ts` :266-279 (add server.json fixtures, plugin and marketplace versions); `stand-in-clis.ts` :15 (add an `mcp-publisher` stand-in that records argv, env and `HOME`);
- `package-manifests.test.ts` :235-273 (`mcpName` ↔ `server.json`; the moved deny-list).

**Docs**
- Root `README.md`:
  - `### Releasing` :1102-1134: the IPM row (:1124) becomes enabled; add a `mcp-registry` row and owner prerequisites; minimal per Rule #43;
  - "The skills pack" :904-942: the plugin and the detection;
  - section 3 :223: a one-paragraph "Claude Code plugin (from 1.1.0)". The full install rewrite is 42.9's.
- `packages/client-config/README.md` :70-129: the detection, its three files and its out-of-scope list.
- Root `CHANGELOG.md`: a new top section `## [Unreleased] — Story 42.8: Claude Code Plugin and Registry Listings` above 42.7's (:5).
- `.changeset/<name>.md`: `minor` for `@iris-mcp/client-config`; the fixed group makes the release `1.1.0` (decision #95).

## Tasks & Acceptance

**Execution:**
0. Probe first (Rule #14): under a scratch `CLAUDE_CONFIG_DIR` and a non-repo cwd, install a two-server stub plugin from a local directory marketplace with string, number and boolean `userConfig` (no `sensitive`). Then `claude mcp list` and dump each stub's env. Expected, from the plan probe on 2026-11-21 with Claude Code 2.1.330: defaults substitute (`localhost`, `52773`, `false`); an unset option with no default is `""`; the parent env is inherited; both same-command servers start. Record the result in `## Verification`; on a difference, stop and report it.
1. `skills-pack-src/plugin/plugin.json`, `skills-pack-src/plugin/mcp.json`, `scripts/lib/skills-pack.mjs`, regenerated `packages/client-config/skills-pack/` (`pnpm gen:pack`) -- the plugin root and its README section -- AC 42.8.1, AC 42.8.2.
2. `scripts/gen-listings.mjs`, root `package.json`, `.claude-plugin/marketplace.json`, `packages/iris-*-mcp/server.json` (generated), `scripts/lib/ci-checks.mjs`, `.github/workflows/ci.yml` -- the generator, its check registered as a CI root gate -- AC 42.8.1, AC 42.8.5.
3. `scripts/lib/endorsement.mjs`, `scripts/lib/provenance-core.mjs`, `scripts/lib/provenance-inputs.mjs`, `package-manifests.test.ts`, `pack-provenance.test.ts` -- the `plugin` rule and the shared deny-list -- AC 42.8.1.
4. `packages/client-config/src/claude-plugin-detect.ts`, `pack-plan.ts`, `cli/clients.ts`, `pack-targets.ts`, `index.ts` plus `claude-plugin-detect.test.ts`, `pack-plan.test.ts`, `skills-cli.test.ts` -- detection and rule-only install, one test per installer matrix row -- DW-625.
5. `scripts/lib/release-core.mjs`, `scripts/release.mjs`, `scripts/lib/release-checks.mjs`, `.github/workflows/release.yml`, `scripts/lib/release-workflow-check.ts` -- IPM enabled (host keys, redaction, rerun rule), the `mcp-registry` channel, `verify` -- AC 42.8.5; the IPM and registry matrix rows.
6. `scripts/release-version.mjs` -- regenerate the pack and the listings in the version step -- decision 3.
7. `scripts/lib/ipm-archive.mjs` (`stagePackagingRoot`), `scripts/ci-ipm-archive.mjs`, `ci-ipm-archive.test.ts` -- the registry-shaped leg, with offline member tests in the default suite -- DW-694.
8. `packages/iris-mcp-all/src/__tests__/release-*.test.ts`, `release-script-fixtures.ts`, `stand-in-clis.ts`, `ci-workflow.test.ts` -- flip the default-channel rows. Add a row per release matrix row: lookup outcomes from the captured statuses; secret and OIDC containment per child; the temporary `HOME` removed; the sha256 mismatch; the npm-visibility timeout; the pinned host keys with recomputed fingerprints; the version-step stamping of every new file -- AC 42.8.5.
9. New `packages/iris-mcp-all/src/__tests__/story-42-8-plugin.test.ts` (cross-package, Rule #45) -- assert:
   - the `.mcp.json` servers equal `PKG_BY_SERVER` × `pinnedSpec` under the short keys;
   - every `${user_config.X}` names an option that is `required` or has a `default`;
   - the six options map onto the six variables;
   - `CLAUDE_CODE_PLUGIN_ID` equals `<plugin name>@<marketplace name>`;
   - the longest `mcp__plugin_iris-mcp_<key>__<tool>` over every built server's tools is ≤ 64;
   - the plugin root has no `hooks/` directory, no `hooks` key in `plugin.json`, and no root `CLAUDE.md`.

   -- AC 42.8.1, AC 42.8.3.
10. `README.md`, `packages/client-config/README.md`, `CHANGELOG.md`, `.changeset/*.md`, new `packages/iris-mcp-all/src/__tests__/story-42-8-doc-claims.test.ts`, plus the moved pins in `story-41-7-doc-claims.test.ts` and `skills-docs.test.ts` -- docs with each channel's default state and owner prerequisites (Rule #30/#43) -- AC 42.8.2, AC 42.8.5.

**Review patches (first review pass; every item is small and in-story; apply each with its test and, where a test pins an AC, its `mutation:` line in `## Verification`):**
- [x] [Review] `scripts/release.mjs` `publishMcpRegistry`: in the per-server publish loop test `lookups.get(server.name) === 'published'` BEFORE the `stopped` check, so a server the registry already lists reads `already published` after an earlier server failed. Also return `{ status: STATUS.failed, detail: 'the manifest lists no server.json. Prepare the artifacts again.' }` when `servers.length === 0`, and make `uploadPathProblems` report an enabled `mcp-registry` channel whose manifest detail is absent. Tests for the three behaviors.
- [x] [Review] Tests in `release-script.test.ts` (or a sibling file if it nears 500 lines of additions): (a) one in-process `publish` and one `--dry-run` with NO `channels` option against the five-channel stand-ins, asserting the report lists npm, both stores, `ipm`, then `mcp-registry` last and that the registry stand-in was called; delete the unused `REGISTRY_ON` constant (or use it) and fix its comment. (b) A rehearsal where the IPM registry lists the version and the packaging tag/tree is not consulted by the dry step: `ipm` reads `ready (would be already published)`, exit 0. (c) A rehearsal where an npm dry-run publish fails: `mcp-registry` is `not attempted` and no registry lookup or publisher download happened.
- [x] [Review] `packages/client-config/src/claude-plugin-detect.ts`: strip a leading U+FEFF (author it as an escape) before parsing, and treat an empty or whitespace-only settings file as absent with no warning. Tests with a BOM file holding the key (decides) and an empty file (no warning).
- [x] [Review] Assertions that cannot fail: in `claude-plugin-detect.test.ts` replace the `expect(moved).toBe(path.join(configDir, "settings.json"))` tautology with an assertion on what the detector reports; in `pack-plan.test.ts` make "skipSkills is ignored by an uninstall" meaningful (an uninstall that is handed a pack and `skipSkills`) or delete it; in `story-42-8-release-core.test.ts` drop `expect(SERVER_JSON_DIRS).toHaveLength(5)` if it adds nothing; in `ci-ipm-archive.test.ts` replace `expect(registryFiles).toContain("module.xml")` (it re-checks the fixture it built) with an assertion on `registryArchiveProblems`.
- [x] [Review] `runVerify` builds `io.github.jbrandtmse/<dir>`: add a test pinning that name for every `SERVER_JSON_DIRS` entry to the package's `mcpName` and to the generated `server.json` `name`.
- [x] [Review] Root `README.md` `### Releasing`: reconcile "A channel that is not enabled still runs its read-only dry step ..." and "the first failure stops everything after it" with the all-enabled five-channel state and the MCP Registry's own last-and-non-blocking behavior, stating each rule once; keep `story-42-8-doc-claims.test.ts` and `story-42-7-doc-claims.test.ts` green.
- [x] [Review] Rule 19: for each group below that lacks a `mutation:` line in `## Verification`, apply the named mutation, observe red, revert (tree byte-identical), and write the line: the README pointer text and its `@1` pin; the no-hook test; the IPM tag-and-tree rows (#109); the `verify` registry and packaging-tag checks; the host-key fingerprint recomputation; the `uploadPathProblems` registry refusals; the #108 rehearsal-exit rows and the failed-after-everything ordering row; the `registryArchiveProblems` `.git`, extra-file and missing-file branches; the `server.json` field mapping and `CONNECTION_VARIABLES` pin. Use `vitest -t` filters so no call outlasts about 170 seconds.

**Acceptance Criteria:**
- **Plugin format (AC 42.8.1).** Given the story tree, when `claude plugin validate packages/client-config/skills-pack` and `claude plugin validate .` run (Claude Code ≥ 2.1.330), then both print `Validation passed`. And `claude --plugin-dir packages/client-config/skills-pack plugin details iris-mcp` lists 5 MCP servers and 18 skills, and no hook.
- **Provenance (AC 42.8.1).** Given the story tree, when `pnpm check:provenance` and `pnpm gen:pack:check` and `pnpm gen:listings:check` run, then all pass. Deleting the notice from the pack, or putting "official" into `plugin.json` `description`, turns `check:provenance` red.
- **The rule pointer (AC 42.8.2).** Given the generated pack README (the plugin's README), when a user reads its "Claude Code plugin" section, then it says the always-on rule needs the installer and gives the `@1`-pinned `skills install --client claude-code` command. The command, run with the plugin enabled, installs only the rule (DW-625).
- **The hook (AC 42.8.3).** Given this story, when it closes, then the evaluation is recorded under Design Notes, the plugin carries no hook, and the candidate is in `deferred:`, unless the Lead approves the hook at the spec gate. In that case it ships opt-in, gated by a `userConfig` boolean read from `CLAUDE_PLUGIN_OPTION_<KEY>`.
- **The served-artifact gate (DW-694).** Given CI's `ipm` job on the story commit, when it runs, then the registry-shaped leg is green on both editions. Given a throwaway branch where `stagePackagingRoot` writes `module.xml` under a subdirectory, when CI runs, then that leg is red while the `package` leg stays green (lead A1/A1b, URLs recorded; Rule #59).
- **Release dry run (AC 42.8.5).** Given the story commit pushed to a `release-dry-run/**` branch by the lead, when `release.yml` runs, then:
  - `mcp-registry` reads `ready (would publish 5 servers)`;
  - `ipm` reads `not ready (… absent or not readable …)` before O-IPM1, and `ready` after it.
- **Live check (AC 42.8.4; lead, after `v1.1.0`).** Given a scratch `CLAUDE_CONFIG_DIR`, when the lead runs `claude plugin marketplace add jbrandtmse/iris-execute-mcp-v2` and `claude plugin install iris-mcp@iris-mcp` with `--config` values for a harness throwaway IRIS for Health, then `claude mcp list` shows `plugin:iris-mcp:{dev,admin,data,interop,ops}` connected and the 18 skills list. The result is recorded.
- **Listings (AC 42.8.5; lead, after `v1.1.0`).** Given the `v1.1.0` publish, when `release.mjs verify --version 1.1.0` runs, then the five registry names answer 200 at `1.1.0` and the packaging repository holds tag `v1.1.0`. After the owner's Open Exchange approval, `GET https://pm.community.intersystems.com/packages/iris-execute-mcp-v2` lists `1.1.0`, its tgz's members equal the pushed tree, and `zpm "install iris-execute-mcp-v2"` installs it on a networked harness throwaway (the DW-694 served-artifact check).

### Review Findings

Code review 2026-11-21 (stage `code-review`, frozen diff `fc113e7..c741a7f` minus the cycle log; review tier full-opus; layers blind-hunter, edge-case-hunter, verification-gap, acceptance-auditor all delivered; no layer changed the tree). 37 raw findings → 21 entries after grouping: high 0, med 7, low 14; plus 9 rejected. The patches are one local commit, named in this stage's report to the lead. Mutation lines for every patched pin are under `## Verification`, "Code-review evidence and mutations".

- [x] [Review][Patch] MED: a test depended on the developer's real `~/.claude/settings.json` (size and mtime fingerprint; any concurrent Claude Code session writing it turned the row red, and it could not catch the regression it named) [packages/client-config/src/__tests__/qa-42-8-plugin-process.test.ts] — fingerprint removed; the sandbox decoy rows remain the guard. fix-risk low.
- [x] [Review][Patch] MED: the rendered `server.json` `environmentVariables` (`isRequired`, `isSecret`, `format`, `default`) had no pin; dropping `isSecret` from the password stayed green [packages/iris-mcp-all/src/__tests__/package-manifests.test.ts] — a typed-out expected shape per listing. fix-risk low.
- [x] [Review][Patch] MED: `IPM_DIST_DEPLOY_KEY` in the publish step was pinned only as "release.yml equals the declaration"; removing it from both stayed green and would fail IPM after npm and the stores published [packages/iris-mcp-all/src/__tests__/release-workflow.test.ts] — the publish env is pinned exactly. fix-risk low.
- [x] [Review][Patch] MED: the implement-review replacement assertion in the DW-694 scripted row re-checked the test's own fixture (cannot fail; the health run copies nothing out) [packages/iris-mcp-all/src/__tests__/ci-ipm-archive.test.ts] — deleted with its unused variable; the run status, session-script and member-check rows remain. fix-risk low.
- [x] [Review][Patch] MED: the 42.6 "verify publishes nothing" check was narrowed to npm calls when `verify` gained a `git` call, so a `git push` in `verify` stayed green [packages/iris-mcp-all/src/__tests__/story-42-6-qa-gate-verify.test.ts] — git calls must be exactly `ls-remote`. fix-risk low.
- [x] [Review][Patch] MED: the lead checklist lacked the #110 pin re-check, O-IPM1 as an owner-only blocker, the A2 rerun after O-IPM1, and the A1b scope (mutating `stageModule` would also break the `package` leg) [spec `## Verification`] — checklist reordered and completed (A1, A1b, A2, O-IPM1, A2b, B1, C0, C1–C2, O-OEX, C3). fix-risk low.
- [x] [Review][Defer] MED: with the plugin, the installer's server route (`install --client claude-code`) or hand-written entries give every tool twice; nothing detects or documents it [packages/client-config/src/cli/clients.ts; README.md:225] — deferred: DW-706 `routed owner=42-9-install-docs-and-client-re-certification` (the install-docs story). fix-risk low.
- [x] [Review][Patch] LOW: the `plugin` provenance rule ran the endorsement deny-list on descriptions only, so `io.github.jbrandtmse/iris-official-mcp`, an "endorsed" marketplace entry or an "official"/"intersystems" keyword passed [scripts/lib/provenance-core.mjs] — names and keywords now checked; test in `pack-provenance.test.ts`.
- [x] [Review][Patch] LOW: the deploy key and known_hosts files lived until the end of the run, so the later `mcp-publisher` child (same user) could read them [scripts/release.mjs publishIpm] — removed in a `finally` as the channel ends (the signal cleanup stays); test in `release-script.test.ts`.
- [x] [Review][Patch] LOW: literal U+FEFF in test source (Rule 14) [qa-42-8-plugin-process.test.ts:29] — `"﻿"`.
- [x] [Review][Patch] LOW: the README's "18 skills" (two places) was hand-written (Rule #51) [README.md:225,917] — counted from the pack in `story-42-8-doc-claims.test.ts`.
- [x] [Review][Patch] LOW: README Releasing step 6 omitted that `verify` now fails on a missing MCP Registry listing or packaging tag [README.md:1115] — stated in the step.
- [x] [Review][Patch] LOW: "the plugin's options win over exported shell variables" had no evidence — probed (Claude Code 2.1.330): the plugin value won, other variables inherited; recorded under `## Verification`.
- [x] [Review][Patch] LOW: three pinning tests had no `mutation:` line (the `[WARN]` row, the no-plugin report line, the registry publish race) — applied, red, reverted, written.
- [x] [Review][Defer] LOW: `main`'s marketplace pins `v1.0.0`, whose pack has no manifest; an install before `v1.1.0` fails (tag absent) or, once the tag exists, silently installs a skills-only plugin (probed) [.claude-plugin/marketplace.json] — deferred: DW-707 `by-design` (decision #102; README says "from 1.1.0"); lead keeps the merge-to-version-commit window short (C0).
- [x] [Review][Defer] LOW: release-core copies listing constants from `listings.mjs`/`skills-pack.mjs` (Rule 2) — deferred: DW-708 `wontfix-accepted` (release-core purity, 42.5; equality pinned by tests).
- [x] [Review][Defer] LOW: plugin sources restate the six connection variables by hand — deferred: DW-709 `wontfix-accepted` (spec byte-copy of `.mcp.json`; names and defaults pinned equal).
- [x] [Review][Defer] LOW: the DW-694 offline run does not exercise the in-container tar, the mount or `-C` (Rule #59 path is lead A1/A1b) — deferred: DW-710 `wontfix-accepted`.
- [x] [Review][Defer] LOW: pax headers are not observed by the registry-shaped member check — deferred: DW-711 `wontfix-theoretical`.
- [x] [Review][Defer] LOW: a thrown registry dry-step error would fail a rehearsal despite #108 — deferred: DW-712 `wontfix-theoretical` (no normal path throws).
- [x] [Review][Defer] LOW: the npm visibility poll's deadline is per server (25 minutes worst case) — deferred: DW-713 `wontfix-theoretical`.

**Rejected:**
- edge: IPM dry step `ready (would be already published)` when the registry lists the version but the tag is absent — already adjudicated `wontfix-accepted` in the implement triage (#109 row wording).
- edge: a disabled `mcp-registry` channel's dry step gets no signal cleanup — the channel is enabled; the path needs a config that does not exist (and the step has its own `finally`).
- edge: `readReleaseFacts` throws a raw `SyntaxError` on a malformed listing — already adjudicated (every sibling reader there does the same).
- edge: the registry leg tars the staged directory, not a git checkout — the staged root has no `.gitignore`, `.gitattributes` or empty directory, so `git add` changes nothing; low and the fix adds a git step to the harness.
- edge: a health-only `ci-ipm-archive` run skips the member check — already adjudicated (debugging mode; member check is edition-independent).
- edge: `npmServes` accepts a 200 HTML answer from a proxy — GitHub-hosted runners have no captive portal; low, fix adds a guard.
- auditor: the spec frontmatter says `done` while C1–C3 are pending — frontmatter is build-auto's state and not this stage's to change; the sprint tracker stays `in-progress` until the lead's Phase C.
- verification-gap: `story-42-8-qa.test.ts` describes share one fixture across `it`s — every mutation restores in `finally`, so no row depends on another's leftovers; low, the fix is a full copy per test.
- verification-gap: the local `claude plugin validate` "can fail" row checks only a non-zero exit — low; CI pinning of Claude Code's acceptance is already the frontmatter `deferred:` item.

## Review (decision #121 rework)

Code review 2026-11-21, rework re-review of commit `27e3be5` only (frozen diff `git diff 27e3be5^ 27e3be5`, 656 lines; claims = its commit message). Review tier full-opus; layers blind-hunter, edge-case-hunter, verification-gap, acceptance-auditor all delivered; no layer changed the tree. 25 raw rows → 7 entries after grouping: high 0, med 3, low 4; plus 5 rejected. Mutation lines under `## Verification`, "Code review of the #121 rework".

- [x] [Review][Patch] MED: any 404 on the namespace URL was read as "absent", so an HTML proxy 404, or the JSON `"error":"Not Found"` Open VSX answers for a path it does not route (probed), would silently skip Open VSX with exit 0 in a real release, against "when in doubt, not set up" [scripts/release.mjs `openVsxNamespaceState`] — absent now requires the store's own answer, 404 JSON `{"error":"Namespace not found: <publisher>"}` (`readStatus` gained `jsonStatuses`); every other 404 is unknown and fails. Four new rows (two shapes × two modes); the bodiless `{ status: 404 }` fakes now carry the real body (#54). fix-risk low (one predicate; the 200/502/network branches unchanged). (blind+auditor+verification-gap)
- [x] [Review][Patch] MED: no test had a skipped channel followed by a failing one, so "a skip plus any failure exits 1, and the skip is still listed" could not fail (a `return failed && no skips ? 1 : 0` mutant stayed green); the path is real before O-IPM1 [release-not-set-up.test.ts] — row added (namespace absent + MCP Registry lookup 500 in a release: exit 1, block, annotation, step summary). fix-risk low. (auditor)
- [x] [Review][Patch] MED: the rehearsal leg of the shared skip row asserted "the registry still ran", "not not attempted" and "no ovsx call", none of which a rehearsal can falsify (the registry runs after any soft `not ready`; the dry step never calls ovsx) [release-not-set-up.test.ts] — those three now run in the release leg only, with the reason; the rehearsal claim rests on its exit code, block and annotation (a soft-stopped later channel is unobservable until #122 brings IPM in). fix-risk low. (verification-gap)
- [x] [Review][Patch] LOW: the `::warning` title `Channel skipped, not set up` is a property, which the runner splits on `,` (actions/runner `ActionCommand.cs`), so the annotation title read "Channel skipped" [scripts/lib/release-core.mjs `notSetUpAnnotations`] — `%2C`; the unit row also asserts the properties split into exactly one; Change Log #121 text corrected. (edge+auditor+blind+verification-gap)
- [x] [Review][Patch] LOW: eight #121 pins had no `mutation:` line, and one line named only half its red rows — applied, red, reverted, written (Rule 19). The row named "an npm-only outcome" (it publishes the Marketplace too) renamed "Open VSX alone does not block a release".
- [x] [Review][Defer] LOW: README Releasing and the commit say an npm-only release can go out, but IPM (excluded, enabled without condition) still fails the rehearsal before O-IPM1 — deferred: DW-714 `wontfix-accepted` (README is 42.9's file now; #124(6) has the #122 pass edit Releasing, where IPM stops failing). (edge+blind) **Closed by the #122 amendment:** IPM is a `manual step` that can neither fail nor block a run, and the README's Releasing section says so, so the "npm-only release can go out" claim is true.
- [x] [Review][Defer] LOW: "run the release again for the same tag" does not say how (a green run offers only Re-run all jobs, which repeats `prepare` and rebuilds the vsix) — deferred: DW-715 `wontfix-accepted`. (blind)

DW-704 carries a trailer recording the #121 revision.

**Rejected:**
- edge/auditor/blind: a rehearsal with the namespace absent AND an unreadable Open VSX version lookup is `not ready` (exit 1) where the release would skip — the rehearsal is the stricter, fail-safe side; needs a simultaneous 404 and 5xx from the same store; the fix adds a branch.
- edge/auditor/blind/verification-gap: a channel switched off in `RELEASE_CHANNELS` prints `not ready: ... does not exist` in its informational dry step — no shipped configuration disables Open VSX, the exit code is unaffected, the fix adds a branch.
- blind: the CHANGELOG bullet was revised in the Story 42.7 store section — `[Unreleased]` describes what ships, and the namespace read lives in that section; CHANGELOG is 42.9's file in flight.
- verification-gap: the hash-mismatch row cannot observe #121 code — its title says it fails before any channel runs, and it pins the Change Log's "a vsix whose hash differs still fails" as a regression row; harmless.
- blind: the decision #121 row lists Marketplace, `OVSX_PAT` and IPM reasons the code does not implement — the narrowing is recorded with probe evidence in Change Log #121 (DW-705, #122) and named in the lead's review prompt; not a code defect.

## Spec Change Log

**2026-11-21, implement stage: decisions #108 and #110 override the intent-contract text below. The frozen block is left untouched; these entries are binding and take precedence wherever they differ.**

1. **#110 (publisher pin).** The intent-contract Boundaries line "`mcp-registry`: `mcp-publisher` v1.8.10 (... sha256 `32d287ed...75ff4a`)" is replaced by `mcp-publisher` **v1.8.8**, `mcp-publisher_linux_amd64.tar.gz`, sha256 `09f1fa70ee146b640584274a1a6b2b8a0310b05d4321fa9224e6df6a016d67f4`.
   - Source: `gh api repos/modelcontextprotocol/registry/releases` (GET). Today is 2026-11-21, so the cutoff is 2026-11-07. v1.8.8 was published **2026-11-06T14:07:07Z** (15 days earlier); v1.8.9 (2026-11-10) and v1.8.10 (2026-11-20) are younger than 14 days.
   - The digest came from the release asset's `digest` field and was re-verified by downloading the tarball (public GET) and hashing it: `09f1fa70ee146b640584274a1a6b2b8a0310b05d4321fa9224e6df6a016d67f4`.
   - Code Map and Verification lines that named v1.8.10 are updated. The lead re-checks, before the `v1.1.0` tag, that the pin has not been yanked or superseded by a security fix.
2. **#108 (channel behavior).** The `mcp-registry` channel runs LAST, and its failure is non-blocking in the order below. These replace the matching I/O-matrix text:
   - **Registry dry step row:** a hash mismatch, a `validate` failure or an unreadable lookup is reported as `mcp-registry: not ready (...)`, but in `rehearse` that report does NOT make the process exit non-zero. The readiness lines and exit codes of the other four channels are unchanged and stay fail-closed (an IPM `not ready` still exits 1).
   - **Registry lookup unknown row:** `failed (could not ask the MCP Registry ...)` is reported; in `publish` it fails the run only after every other channel has finished (the channel is last, so nothing follows it), and a rerun recovers.
   - **Registry publish fails row and the npm-never-visible row:** the same rule. A failed registry upload is the last thing the run does, it makes the run exit non-zero at the end, and a rerun recovers it (lookup 200 → `already published`).
   - The dry-run acceptance line "`mcp-registry` reads `ready (would publish 5 servers)`" is unchanged for the all-good case.
   - If an earlier channel failed, `mcp-registry` is reported `not attempted`, as every later channel is today.
   - Tests and the release header contract state this.

**2026-11-21, rework 2: decision #121 (owner ruling "b"; revises DW-704 and the "IPM enabled unconditionally" part of #108) — a channel whose owner setup is missing is skipped, not a release failure. Binding where it differs from the text above; the frozen block is untouched.**

3. **#121 (not set up).** In `rehearse` and in `publish`, a channel whose OWNER SETUP is missing is reported `skipped (not set up: <reason>)`, does not make the run exit non-zero, and does not stop the channels after it, so an npm-only release proceeds. Everything else is unchanged and fail-closed: npm is never skippable; an unreadable store or registry lookup, a vsix whose hash differs from the manifest, a missing CLI, the placeholder publisher, a failed upload and a channel that is set up and then fails still fail the run (stop-on-failure as before). A channel with a real problem beside an unset one stays `not ready`/`failed` (the dry step skips only when EVERY reason is a missing setup). When in doubt, a reason is not "not set up" (Rule #54: each skip is reachable by a real input).
   - **Reasons implemented (Open VSX only):** the Open VSX namespace API's real 404 (`GET https://open-vsx.org/api/iris-mcp`, owner step O1), in a rehearsal and in a release. Its 502, a 200 that is not JSON and a network error are not "absent" and still fail. *(Code review of the rework, 2026-11-21: "real 404" now means the store's own answer, 404 `application/json` `{"error":"Namespace not found: <name>"}`; an HTML 404 and Open VSX's JSON `"error":"Not Found"` for an unrouted path are not "absent" and fail. Probed read-only: `/api/iris-mcp` and an invented namespace give the first; `/api/iris-mcp/x/y/z/w/v` gives the second; Open VSX's `LocalRegistryService.getNamespace` answers 200 for a namespace with no extension.)*
   - **IPM is EXCLUDED pending decision #122** (the owner ruled that there is no separate `-ipm` packaging repository and IPM will publish from a root `module.xml`; the channel is redesigned in a separate pass). The IPM code, its tests and its matrix rows are exactly as before: a missing packaging repository is still `ipm: not ready (... absent or not readable ...)` and fails the rehearsal, and a missing `IPM_DIST_DEPLOY_KEY` is still `failed`. The lead checklist A2 and the IPM prerequisites paragraph are therefore unchanged for IPM until the #122 pass.
   - **`mcp-registry` is unchanged** (decision #108: its not-ready never blocks, and it needs no owner setup); it is simply a "later channel" that still runs after a skipped one.
   - **OVSX_PAT:** the code does not decide anything on it today. `ovsx publish` uses trusted publishing unless `OVSX_PAT` is set, and no read-only signal tells a namespace that has trusted publishing from one that does not, so an absent `OVSX_PAT` is NOT a "not set up" reason; an upload that fails for want of one is a failed upload.
   - **Marketplace verdict (DW-705 unchanged):** probed read-only on 2026-11-21: `GET https://marketplace.visualstudio.com/publishers/iris-mcp` answers 404 (HTML) and `.../publishers/microsoft` 200, `.../publishers/zzz-nonexistent-pub-qq1` 404; the gallery REST path `/_apis/public/gallery/publishers/<id>` answers 404 for both an existing and an absent publisher, so it carries no signal. The publisher page is a real signal for "this publisher does not exist", but nothing establishes that a freshly created publisher with no extension yet reads 200, and that is exactly the state of the first release; a false "not set up" there would silently skip a channel that is set up. Trusted-publishing setup has no public read at all. So the Marketplace has no skip reason and stays as it was.
   - **Visibility (v1.1.0 safety, lead's call in #121):** the end of the report, and so the GitHub step summary, carries a "Skipped channels (not set up; run the release again once the owner step is done)" block listing each skipped channel with its reason, and each also emits a raw `::warning title=Channel skipped%2C not set up::<channel>: <reason>` line (the three reserved characters escaped in the message; *code review 2026-11-21:* the title is a property, which the runner splits on `,`, so its comma is `%2C`; the unescaped form showed as "Channel skipped"). There is no required-channels list. A rerun of the same tag after the setup publishes the skipped channel, and npm (and every channel that already published) reads `already published`: the existing idempotence covers it, pinned by one test.
   - **I/O matrix (replaces or adds to the frozen rows; IPM rows untouched):**

     | Scenario | Input / State | Expected Output / Behavior | Error Handling |
     |----------|--------------|---------------------------|----------------|
     | Open VSX namespace absent, rehearse | namespace GET 404 | `open-vsx: skipped (not set up: the Open VSX namespace iris-mcp does not exist. Create it once with npx ovsx create-namespace iris-mcp (owner step O1).)`; exit 0; later channels run; "Skipped channels" block and a `::warning::` line | — |
     | Open VSX namespace absent, publish | namespace GET 404 | the same line; nothing is uploaded to Open VSX; exit 0 | — |
     | Namespace unreadable | 502, a 200 that is not JSON, a network error | `not ready`/`failed (the Open VSX namespace iris-mcp could not be read ...)`; exit 1; what follows `not attempted` | never "not set up" |
     | Set-up channel fails | a version lookup HTTP 500, a vsix hash mismatch, a missing CLI, an upload that exits non-zero | `not ready`/`failed` as before; exit 1 (rehearsal), 1 or 2 (release); what follows `not attempted` | a skipped channel is still listed |
     | npm failure | `npm publish` fails or `npm view` cannot be judged | exit 1; every other channel `not attempted` | npm is never skipped |
     | Rerun after the setup | namespace now 200; npm and the Marketplace already hold the version | npm and the Marketplace `already published`; Open VSX `published`; no block | — |

**2026-11-21, amendment: decisions #122 and #124 (owner, 2026-11-21; spec `spec-42-8-amendment-122-ipm-from-main.md` is the binding text) — IPM publishes from the main repository's root. Binding where it differs from every IPM statement above, including the "IPM is EXCLUDED pending decision #122" paragraph of #121 and the IPM rows of the matrix; the frozen block is untouched.**

4. **#122 (IPM from `main`).** There is no packaging repository `jbrandtmse/iris-execute-mcp-v2-ipm`, no deploy key (`IPM_DIST_DEPLOY_KEY`), no pinned GitHub host keys and no push. The existing Open Exchange listing `IRIS-MCP-Server-Suite-2` (Github = this repository) stays the one listing: the IPM registry reads the root `module.xml` of `main` and serves a re-tar of GitHub's archive of `main` when the owner presses Release on it.
   - **The tree.** The root `module.xml`, the stamped classes under `ipm/src/cls/` and the stamped guard under `preload/ipm/src/cls/` are committed, output-only and written by `gen-bootstrap.mjs --ipm` only at the version step; `gen:ipm:check` holds them (self-hash, shared version, no extra file, nothing but the guard under `preload/`, no root `requirements.txt`). A release's `prepare` refuses a tree whose marker is not `BOOTSTRAP_VERSION`; a dry run notes it.
   - **The channel is a `manual step`.** A registry that lists the version reads `already published`; anything else, and a registry that cannot be read, is `manual step` (`ready (manual step after the tag: ...)` in a rehearsal), shown in a "Manual steps" block and a `::warning::` annotation. IPM can neither fail nor block a run, so the README's "an npm-only release can go out" claim (DW-714) is now true: only a missing store setup is skipped.
   - **`verify`.** IPM is `pending` (never failing) until the registry lists the version; once it does, the module's own files in the served archive (the root `module.xml`, `ipm/src/**`, `preload/**`) must equal those of `git archive v<version>` member for member and byte for byte; the rest of the archive is `main` at the Release press and is not compared (amendment spec, review pass 1).
   - **The DW-694 gate** fetches GitHub's real archive of the commit under test, requires it equal to `git archive`, asserts the module's members and `load`s the registry's re-tar on both editions (the registry-shaped leg above, redefined; the `stagePackagingRoot` function is gone).
   - **#124: no export rules.** `.gitattributes` is untouched; GitHub's archives stay the whole repository.
   - **Owner steps.** O-IPM1 (the repository, the key, the secret) is cancelled. The owner's step is O-IPM: after the `v1.1.0` release has published, tick "Publish in Package Manager" on the existing listing and press Release with the version of `main`'s `module.xml`. If an `IPM_DIST_DEPLOY_KEY` secret was already added, delete it. Never create a `master` branch in this repository.

## Review Triage Log

### 2026-11-21 — Review pass
- layers: blind-hunter 11, edge-case-hunter 9, verification-gap 16, intent-alignment 0 findings (descriptive report; every divergence it lists is the documented #108/#110 override, or work owned by the lead's A1/A1b/A2/C checklist).
- verdicts: 36 findings — high 0, medium 7, low 26, false 3, maybe-false 0
- findings:
  - Blind hunter:
    - `[low]` `[reject]` Marketplace on `main` pins `v1.0.0`, which has no plugin — decision #102 and the spec's stated consequence; the version step moves the ref at the release commit.
    - `[low]` `[reject]` Detector treats a committed project `enabledPlugins` key as proof of install, so skills it wrote earlier are removed — spec-bound (#107); the report names the deciding file and the rule is kept. Closed by-design.
    - `[low]` `[reject]` Invalid higher-precedence settings file counts as no entry — spec matrix row: a `[WARN]` naming the file, no refusal. Closed by-design.
    - `[low]` `[reject]` IPM deploy key unchecked before npm publishes — decision #108 enables IPM unconditionally and the rehearsal holds no secrets. Closed by-design.
    - `[low]` `[patch]` `publishMcpRegistry` reports an already-listed server as `not attempted` after a failure — reordered; fix applied, tested.
    - `[low]` `[patch]` `runVerify` rebuilds the registry names from directory names — a test now pins the name to `mcpName` and the generated listing for every directory.
    - `[low]` `[reject]` README/CHANGELOG cite story and ledger ids — the repository's CHANGELOG convention (42.7's section does the same); closed `wontfix-accepted`, `reopen_if` the 1.1.0 release notes are written (Story 42.9).
    - `[low]` `[reject]` Doc-claims tests pin the two newest CHANGELOG headings and skip when the changeset is consumed — the project-wide precedent (`it.skipIf(!present)` in stories 42.1 to 42.11); the version step retires them. `wontfix-accepted`.
    - `[low]` `[patch]` README sentences about "a channel that is not enabled" and "the first failure stops everything" are stale with five enabled channels — reconciled, each rule stated once.
    - `[low]` `[reject]` `server.json` `title` equals `description` — pinned deliberately by the listings tests; no user-visible harm. `wontfix-accepted`.
    - `[false]` `[reject]` Spec completion contract not met — `status` and `## Auto Run Result` are written at finalize, after this triage.
  - Edge-case hunter:
    - `[low]` `[reject]` IPM dry step says `ready (would be already published)` when the registry lists the version but the packaging tag is absent — the spec row (#109) words the dry step exactly so; the real run reports `failed`. `wontfix-accepted`, `reopen_if` a rehearsal is trusted past O-IPM1 for a rerun.
    - `[medium]` `[patch]` `publishMcpRegistry` with no manifest detail returns `already published` and exit 0 — returns `failed` now.
    - `[medium]` `[patch]` `uploadPathProblems` skips an enabled `mcp-registry` channel with no manifest detail — refuses it now (grouped with the previous row).
    - `[low]` `[patch]` Settings file with a BOM, or an empty file — the BOM is stripped (as an escape) and an empty file is absent with no warning.
    - `[low]` `[patch]` Same root cause as the blind hunter's `publishMcpRegistry` ordering row; one fix.
    - `[low]` `[reject]` Malformed `plugin.json`/`server.json` gives a raw `SyntaxError` in `readReleaseFacts` — the same pattern as every sibling reader there.
    - `[low]` `[reject]` `ci-ipm-archive.mjs` with only the health edition skips the member check — the member check is edition-independent bytes; a single-edition run is a debugging mode.
    - `[low]` `[reject]` Marketplace `ref` pins `v1.0.0` — duplicate of the blind hunter's first row.
    - `[low]` `[reject]` A store `not ready` leaves IPM `not attempted` while the registry still runs in a rehearsal — fail-closed order is 42.5's; the registry's read-only report in a rehearsal is decision #108.
  - Verification gap:
    - `[medium]` `[patch]` No test runs `publish`/`--dry-run` with the script's own five-channel default — rows added; a mutation line recorded.
    - `[medium]` `[patch]` IPM dry step for a registry-listed version untested — row added.
    - `[medium]` `[patch]` Rehearsal rule "registry not attempted after a hard failure" untested — row added.
    - `[low]` `[patch]` Pinning tests without a `mutation:` line — each group mutated, observed red, reverted; lines written in `## Verification`.
    - `[low]` `[defer]` No automated pin of Claude Code's acceptance of the plugin files — deferred (the CLI is not guaranteed on CI).
    - `[medium]` `[patch]` `moved` tautology in `claude-plugin-detect.test.ts` — replaced by an assertion on `decidedBy`.
    - `[medium]` `[patch]` "skipSkills is ignored by an uninstall" could not fail — the uninstall is now handed a pack and `skipSkills`.
    - `[low]` `[patch]` Redundant `toHaveLength(5)` and `toContain("module.xml")` — replaced by `registryArchiveProblems` assertions.
    - `[low]` `[reject]` Conditional skip on the changeset test — duplicate of the precedent row above.
    - `[low]` `[patch]` Unused `REGISTRY_ON` constant — removed.
    - `[low]` `[reject]` Built dists of shared and servers are not freshness-checked in `story-42-8-plugin.test.ts` — the project's environment rule is to rebuild after editing `src/`; sibling cross-package tests do the same.
    - `[false]` `[reject]` Host `tar` on `PATH` — the rows fail loudly when it is absent.
    - `[low]` `[patch]` Registry publish loop ordering — duplicate of the edge-case and blind rows; one fix.
    - `[low]` `[patch]` `verify` names from directories — duplicate; one test.
    - `[low]` `[defer]` `JOB_TIMEOUT_MINUTES.ipm` unmeasured — deferred to the lead's A1 measurement.
    - `[false]` `[reject]` Spec state `in-progress` with `Status: ready-for-dev` — finalize writes it.
- patches applied by a fresh subagent after the first review (the inner `servers.length === 0` guard in `publishMcpRegistry` is unreachable through `publish()` because `uploadPathProblems` refuses first; only the `uploadPathProblems` side is pinned).

## Design Notes

**Governing ADs and conventions (Rule 6):**
- **AD-28:**
  - one pack (the plugin root is the pack; `gen:pack` owns it);
  - plugins cannot carry rules (installer route);
  - Duplicates (DW-625);
  - names and endorsement;
  - the notice ships wherever the skills ship.
- **AD-29:**
  - Versions (plugin lockstep, decision 3);
  - Pins (`@1`; the marketplace entry pins the release tag; `mcpName` ↔ `server.json`);
  - Publishing:
    - channels and order (`mcp-registry` appended);
    - secrets only in `release.yml`;
    - "every listing that carries a version is a release step";
    - tags on `main` only;
    - bad-release policy (fix forward; MCP Registry versions are immutable, like npm).
- **AD-14:**
  - archives from the stamped embed, never `src/` (`stagePackagingRoot` reads the embed);
  - the version step regenerates every version-embedding artifact;
  - generated files are output-only (`gen-listings`).
- **AD-30:** the installer writes only what it owns; removal of skills it installed earlier goes through the manifest.
- **AD-2:** cross-package checks in `iris-mcp-all` (Rule #45).
- **Conventions:**
  - error text;
  - live testing on a shared instance (throwaways only through the harness);
  - Stack (Node, pnpm);
  - Deferred "Release operations" (the plugin version policy is settled here).

**Why this shape:**
- **Plugin root = pack.** AD-28 already rules out a repo-root plugin, because the root's `skills/` would load the workflow skills twice. `loadPack` (`pack-plan.ts:379`) reads only `skills/`, the rule forms and the notice, so the plugin files are inert to the installer.
- **`git-subdir` with `ref`.** It is the only documented source that pins a subdirectory to a tag (marketplace reference, fetched 2026-11-21). The tag commit is not known when the version step runs, so there is no `sha`.
- **`userConfig`, not environment variables, for the connection.** The plugin install then prompts for the connection, and the password goes to the OS keychain (manifest reference). The plan probe of 2026-11-21 (Claude Code 2.1.330) showed four things:
  1. `${user_config.iris_host}` with a default resolves to the default;
  2. a set required option resolves to its value;
  3. an unset option with no default resolves to `""`;
  4. the server inherits the parent environment.

  Point 3 is why every option the plugin uses has a default or is required.
- **Short server keys.** Plugin tools are named `mcp__plugin_<plugin>_<server>__<tool>`. With `iris-interop-mcp`, `iris_default_settings_manage` comes to 67 characters, over the 64 that `tool-naming.test.ts` and common clients use.
- **Detection by `enabledPlugins`.** It is the documented, stable key, and Claude Code writes it on install and enable (observed). `installed_plugins.json` is documented without a schema (its observed values are arrays), and `claude plugin list --json` needs the CLI on `PATH`. A miss only costs a duplicate (today's behavior), never a lost rule.
- **The registry channel publishes from CI with OIDC.** The registry grants `io.github.<repository_owner>/*` from the token (`github_oidc.go`), so there is no secret and no owner step. Versions are immutable, and a republish is HTTP 400, so a lookup comes first (the `viewOutcome`/`storeOutcome` pattern). `mcp-publisher validate` does not check npm, and the registry refuses a version npm does not serve yet, hence the npm visibility poll.
- **The DW-694 leg reuses the release's own staging function.** Each IPM gate then proves the bytes the release pushes, tarred the way zpm-registry tars them (`tar --exclude=.git -zcvf … -C Path .`, 42.5 research). The tar runs inside the Linux container to avoid bsdtar pax headers, which IPM before 0.10.11 rejects (IPM wiki, CLI commands).
- **Siblings (Rule 2):**
  - `registryOutcome` extends `storeOutcome`/`viewOutcome`;
  - `publishMcpRegistry` follows `runChannel`'s store path;
  - `stagePackagingRoot` is `stageIpm` moved, not copied;
  - `gen-listings` follows `gen-pack` + `generated-tree`;
  - detection follows the claude-code adapter's detection and `engine.ts`'s parse;
  - the endorsement deny-list is extracted, not duplicated.

**Integration ACs (Rule 1):**
- Claude Code (consumer) reads `marketplace.json`, `plugin.json` and `.mcp.json`. Observable: `claude plugin validate` and `plugin details` (Tasks AC "Plugin format"), and lead C1.
- `iris-mcp-clients skills install --client claude-code` (consumer) reads the detector. Observable: a rule-only install and its report line (installer matrix rows).
- `release.yml` `rehearse`/`publish` (consumers) read the channels and artifacts. Observable: the dry-run report rows (lead A2) and the `v1.1.0` report (C).
- CI `ipm` (consumer) reads `stagePackagingRoot`. Observable: the green and red runs (A1/A1b).

**Consumes:**
- 41.1 (pack, provenance);
- 41.6 (installer, manifest);
- 42.4 (`ipm-archive`, `ci-ipm-archive`);
- 42.5 (`release.mjs`, the IPM push code, fixtures);
- 42.6 (`verify`, the main-only tag gate);
- 42.7 (the store-channel pattern, lockstep embedders, `npm ci` in jobs).

**Consumed-by:**
- 42.9: install docs (the plugin as the Claude Code path, the IPM route), client re-certification with the plugin, the CHANGELOG `1.1.0` notes.

**Ledger inbox (Rule 17):**
- **DW-625:** task 4, the installer matrix rows, the AC "The rule pointer".
- **DW-694:** task 7, the matrix row "Registry-shaped IPM archive", the AC "The served-artifact gate", lead A1/A1b and C3.
- Related, not owned here: DW-704 (by-design) shapes Orchestrator decision 8. 42.5's VG14 host-key entry (wontfix-accepted, `reopen_if` the IPM channel is enabled without a pinned host key) is satisfied by the host-key pin. The lead may record that at adjudication.

**Decided at the spec gate (2026-11-21).** These are wave-8 orchestrator decisions #101 to #111. They follow the plan's recommendations 1 to 11 in order, with two amendments, and are BINDING on the implement stage:
- #101: the names.
- #102: `git-subdir` at `ref: v<version>`.
- #103: the plugin's version is lockstep with the shared version.
- #104: six `userConfig` options.
- #105: server keys `dev`, `admin`, `data`, `interop` and `ops`.
- #106 (the Lead's call for AC 42.8.3): the compile-on-save hook is not shipped and is filed as a candidate.
- #107: plugin detection.
- #108, **amended**:
  - IPM is enabled without condition, so a missing packaging repository blocks the release until owner step O-IPM1. This is intended. **SUPERSEDED by decision #122:** there is no packaging repository and no O-IPM1; IPM is a `manual step` that can neither fail nor block a release.
  - The `mcp-registry` channel runs LAST. In `rehearse` its readiness or lookup failure is REPORTED but does NOT make `rehearse` exit non-zero, because the registry is in preview and must not block npm, the stores or IPM.
  - In `publish`, a failed registry upload fails the run only after every other channel has finished, and a rerun recovers it.
  - Update the I/O matrix rows, the tasks and the tests to match. Every other channel stays fail-closed.
- #109: a rerun whose version is already listed checks for an identical tree.
- #110, **amended**:
  - Pin the newest `mcp-publisher` release that was published at least 14 days before the implement stage runs, not v1.8.10, which was one day old at planning. Record its version and sha256.
  - Lead step C-something re-checks before the `v1.1.0` tag that it has not been yanked or superseded by a security fix.
- #111: the registry lists the five server packages.

The lead wrote the spine drafts below into the spine, with the #108 and #110 amendments: AD-14, AD-28 (Sources, Shape, Duplicates), AD-29 (Versions, Channels), two Stack rows and the Deferred list. `lint_spine.py` is clean.

The Planner was told on 2026-11-21 about owner steps O-IPM1 and O-OEX. They block only the lead's Phases B and C, never the implement or QA stages.

The implement stage never pushes, creates repositories, tags, publishes or logs in. It runs no docker outside the harness, never touches `~/.claude` (it uses a scratch `CLAUDE_CONFIG_DIR`), and never edits the spine.

**Orchestrator decisions needed (planned around the recommendation):**
1. **Orchestrator decision needed: the plugin and marketplace names — recommended: plugin `iris-mcp`, marketplace `iris-mcp`, display name "IRIS MCP Server Suite",** because:
   - they match the npm scope and the store publisher (#91);
   - Claude Code's validator rejects claude/anthropic names and reserves its official names;
   - the install key `iris-mcp@iris-mcp` is what the detector reads.
2. **Orchestrator decision needed: the marketplace source — recommended: `git-subdir` at `packages/client-config/skills-pack`, `ref: v<version>`,** because AD-29 says "the plugin marketplace entry pins the release tag", and a relative path resolves at the marketplace clone's branch.
   - Consequence: on `main`, the entry is installable only from the `v1.1.0` version commit on. The tag `v1.0.0` has no plugin.
3. **Orchestrator decision needed: the plugin version policy (spine Deferred) — recommended: lockstep,** because:
   - `version` drives Claude Code's update detection ("keeps every user on the cached copy until its author changes the string");
   - the pack ships inside `@iris-mcp/client-config` at the shared version anyway;
   - one version across npm, the stores, IPM and the plugin (#94).
4. **Orchestrator decision needed: how the plugin gets the IRIS connection — recommended: six `userConfig` options** (host, port, namespace and https with defaults; username required; password required and sensitive), with every other `IRIS_*` inherited from the environment, because:
   - the install prompts for the connection, and the password is kept in the keychain;
   - the probe showed defaults and inheritance work.
   - Cost: the plugin's six override the same variables exported in the shell (documented).
   - Alternative: `${IRIS_HOST:-localhost}` environment only. It is rejected, because users would have to export a password before launching Claude Code.
5. **Orchestrator decision needed: `.mcp.json` server keys — recommended: `dev`, `admin`, `data`, `interop`, `ops`,** because the full bin names push the plugin-prefixed interop tool names past 64 characters (67).
6. **Orchestrator decision needed: ship the compile-on-save hook (AC 42.8.3)? — recommended: no; file it as a candidate (`deferred:`),** because:
   - Claude Code has no per-hook toggle (opt-in would need a `userConfig` flag read by the hook script);
   - hooks run unsandboxed with full user permissions;
   - a compile needs an IRIS client and target outside MCP, which could hit a shared instance on every `.cls` write;
   - the always-on rule already makes agents compile through `iris_doc_load`/`iris_doc_compile`.
7. **Orchestrator decision needed: what "detects the plugin" reads (DW-625) — recommended: `enabledPlugins["iris-mcp@iris-mcp"]` in the user (`CLAUDE_CONFIG_DIR`-aware), project and local settings files, highest precedence wins, managed/`--settings`/`--add-dir` declared out of scope,** because it is the documented key Claude Code writes on install and enable. A miss only installs a duplicate, and the report names what decided (Rule #56).
8. **Orchestrator decision needed: how the IPM and registry channels behave when owner prerequisites are missing (DW-704) — recommended:**
   - **IPM:** enabled unconditionally. A missing packaging repository makes `rehearse` not ready, which blocks `v1.1.0`, npm included, until owner step O-IPM1. This is intended: O-IPM1 is cheap and precedes the tag, as O1 does for the stores, and a 1.1.0 without IPM would break "the module version equals the npm version". **SUPERSEDED by decision #122:** IPM publishes from the main repository through the owner's Release press (a `manual step`); there is no packaging repository to be missing, and a rehearsal never reads `not ready` for IPM.
   - **MCP Registry:** it has no owner prerequisite (OIDC from `repository_owner`), and an unreadable registry fails closed like every store.
   - Alternative: ship IPM enabled only once O-IPM1 is done (a one-line flip in a later commit).
9. **Orchestrator decision needed: a rerun of the IPM channel when the registry already lists the version — recommended: go on to the tag/tree check (identical → `already published`; otherwise `failed`), and the dry step reads `ready (would be already published)`,** because 42.5's row made any rerun after the Open Exchange press fail (42.5 review, deferred to this story).
10. **Orchestrator decision needed: `mcp-publisher` — recommended: v1.8.10, the linux_amd64 tarball, sha256 `32d287ed…75ff4a` pinned in `release-core.mjs`, downloaded and verified by `release.mjs`,** because the release pins every tool (Story 42.5), and old binaries fail OIDC with "invalid audience" (registry troubleshooting).
    - v1.8.10 was published 2026-11-20. The docs' example pins v1.8.1.
    - cosign verification (the docs' route) adds an action. A sha256 pin read from the release's asset digest is the same integrity check, with no new action.
11. **Orchestrator decision needed: the MCP Registry scope — recommended: the five server packages, not `@iris-mcp/all`,** because `all` has no bin and no `mcpName`, and the registry lists runnable servers.

**What the owner must provide, and when (the lead tells the Planner; nothing blocks the implement or QA stages):**
- **O-IPM1 (SUPERSEDED by decision #122: cancelled, nothing below is to be done; the owner step is O-IPM in the lead checklist), before the `v1.1.0` tag (and before lead A2's "ready" line):**
  1. Create a **public, empty** repository `jbrandtmse/iris-execute-mcp-v2-ipm`, with no README, licence or `.gitignore`, so the release's first push makes `master` the default branch (decision #76).
  2. Generate a key pair, for example `ssh-keygen -t ed25519 -N "" -C iris-execute-mcp-v2-release -f ipm_deploy`.
  3. Add `ipm_deploy.pub` as a **deploy key with "Allow write access"** on that repository.
  4. Add the private key as the secret **`IPM_DIST_DEPLOY_KEY`** on the `release` environment of `jbrandtmse/iris-execute-mcp-v2`.
  5. Delete the local key files.
- **O-OEX, after `v1.1.0` publishes (the packaging repository then has `module.xml` at 1.1.0 on `master`):**
  - On Open Exchange, signed in with the InterSystems Developer Community account (the owner already has three registry packages, so the account appears to exist), submit an app with:
    - the GitHub URL `https://github.com/jbrandtmse/iris-execute-mcp-v2-ipm`;
    - a name that implies no endorsement (recommended: "IRIS MCP Server Suite (iris-execute-mcp-v2)");
    - the MIT licence URL;
    - a description ending with the no-endorsement sentence;
    - "Publish in Package Manager" checked; then "Send for Approval".
  - For each later release, press release on Open Exchange (decision #76; manual, no API).
  - This blocks only lead C3 and the Open Exchange half of AC 42.8.5.
- **MCP Registry:** no owner step. If the OIDC login is refused at `v1.1.0`, the fallback is the owner running `mcp-publisher login github` and `publish` from the tag checkout, recorded as an AD-29 exception.
- **Plugin marketplace:** no account. It is this repository's `.claude-plugin/marketplace.json`, published by the merge to `main` and the `v1.1.0` tag. A listing in a third-party plugin directory is out of scope.
- **Still open from 42.7:** O1 and O2 (store accounts, trusted publishing, `OVSX_PAT`, `npm trust`) before `v1.1.0`.

**What waits on a publish:**
- **Nothing in implement or QA.** They use fakes, stand-ins, local `claude plugin validate`/`--plugin-dir`, and offline member tests.
- **After npm `1.0.0` is live (42.6 B7), lead B1:** `claude --plugin-dir packages/client-config/skills-pack` in a scratch `CLAUDE_CONFIG_DIR` against a harness throwaway IRIS for Health; `/mcp` shows five connected servers. Not the shared instance: its marker is `0.0.2+2.244fe8623c76`, so 1.x servers would redeploy there (decision #88).
- **After `v1.1.0` (and O-OEX for C3):** C1 (marketplace install, AC 42.8.4), C2 (`verify`: registry plus packaging tag), C3 (registry listing, served tgz, `zpm install` on a networked throwaway). The story stays `in-progress` until then, as 42.6 and 42.7 did.

**AC reinterpretations:**
1. **AC 42.8.1 "`.claude-plugin/plugin.json` and a `marketplace.json` in this repo":** `plugin.json` lives in the plugin root (`packages/client-config/skills-pack/.claude-plugin/`, generated from `skills-pack-src/plugin/`), as AD-28's "the plugin uses the same directory" requires. `marketplace.json` lives at the repository root's `.claude-plugin/`, where `marketplace add owner/repo` reads it.
2. **AC 42.8.4 "in a clean Claude Code":** a scratch `CLAUDE_CONFIG_DIR` is the clean Claude Code (documented: "All settings, session history, and plugins are stored under this path"). The servers run against a harness throwaway.
3. **AC 42.8.5 "an MCP Registry listing":** five listings, one per server package (decision 11). The listing goes live at `v1.1.0`, because the registry refuses versions npm does not serve.
4. **The epic text's "41.1's provenance check is extended to the plugin folder":** a `plugin` rule over the plugin root, the marketplace entry and the listings' names. The notice rule already covers the pack directory, which is the plugin folder.

**Spine amendment drafts for the lead (Rule 20):**
- **AD-28, One pack → Sources, append:** "`skills-pack-src/plugin/` holds the Claude Code plugin's `plugin.json` (rendered into the pack's `.claude-plugin/plugin.json` with the shared version) and `mcp.json` (copied byte for byte to `.mcp.json`) (Story 42.8)."
- **AD-28, One pack → Shape, append:** "The pack root is the Claude Code plugin root: `.claude-plugin/plugin.json` (plugin `iris-mcp`, six `userConfig` connection options) and `.mcp.json` (five servers keyed `dev`, `admin`, `data`, `interop`, `ops`, each `npx -y @iris-mcp/<pkg>@1`)."
- **AD-28, Duplicates, replace the second sentence with:** "The route detects the plugin from `enabledPlugins[\"iris-mcp@iris-mcp\"]` in the user (`CLAUDE_CONFIG_DIR`-aware), project and local settings files, highest precedence winning, and then installs only the rule (Story 42.8, DW-625)."
- **AD-29, Versions, append:** "The Claude Code plugin's version, its marketplace entry's `ref` (`v<version>`) and each `server.json` version equal the shared version (lockstep, Story 42.8); `pnpm run version` regenerates them and `prepare` refuses a mismatch."
- **AD-29, Publishing → Channels, append:** "IPM is enabled (Story 42.8): the push trusts only GitHub's pinned host keys. A fifth channel, `mcp-registry`, publishes the five generated `server.json` files with `mcp-publisher` (pinned by sha256) after `login github-oidc`, after a read-only lookup per server and once npm serves the version."
- **AD-14, Version-embedding artifacts, append:** "The version step also runs `gen-pack` and `gen-listings` (Story 42.8)."
- **Stack, new row:** "`mcp-publisher` (release only) | v1.8.10, linux_amd64, sha256-pinned (Story 42.8)". Also: "Claude Code (plugin format verified) | 2.1.330 (Story 42.8)".
- **Deferred, Release operations:** remove "the version policy for the plugin (Story 42.8)"; add "a compile-on-save hook in the plugin (candidate; AC 42.8.3; ships opt-in only with the Lead's approval)".

**Residual risks:**
- The MCP Registry is in preview: "Breaking changes or data resets may occur before general availability."
- Which commit Open Exchange packages, and whether a tag is needed, is undocumented. C3 compares the served tgz with the pushed tree.
- An outage of the MCP Registry or the IPM registry in `rehearse` blocks the whole release (the DW-704 class).
- `git-subdir` with `ref` was verified from the docs and the validator only; C1 is its first real install.

## Verification

**How to run:**
- Run from `/Users/jbrandt/git/iris-execute-mcp-v2`, one command per foreground call, with `timeout: 600000`.
- `UNARMED` is `env -u IRIS_HOST -u IRIS_PORT -u IRIS_USERNAME -u IRIS_PASSWORD -u IRIS_NAMESPACE -u IRIS_HTTPS -u IRIS_REQUIRE_LIVE -u IRIS_TEST_HOST -u IRIS_TEST_PORT -u IRIS_THROWAWAY -u NPM_TOKEN -u OVSX_PAT -u VSCE_PAT -u GITHUB_TOKEN -u IPM_DIST_DEPLOY_KEY -u CLAUDE_CONFIG_DIR CI=true`.
- No stage pushes, tags, triggers CI, publishes, logs in, calls IRIS, or touches `~/.claude`.
- Docker runs only through `scripts/throwaway-iris.mjs`, and only by the lead or a stage the lead names.
- Rebuild a package after editing its `src/` before running tests that read its dist.

**Commands:**
- `(loop)` `for f in scripts/release.mjs scripts/lib/release-core.mjs scripts/lib/release-checks.mjs scripts/lib/ci-checks.mjs scripts/release-version.mjs scripts/gen-listings.mjs scripts/ci-ipm-archive.mjs scripts/lib/ipm-archive.mjs scripts/lib/skills-pack.mjs scripts/lib/provenance-core.mjs; do node --check "$f" || exit 1; done` -- expected: exit 0.
- `(loop)` `pnpm gen:pack:check && pnpm gen:listings:check && pnpm check:provenance` -- expected: all OK.
- `(loop)` `CLAUDE_CONFIG_DIR="$(mktemp -d)" claude plugin validate packages/client-config/skills-pack && CLAUDE_CONFIG_DIR="$(mktemp -d)" claude plugin validate .` -- expected: `Validation passed` twice. Then remove the temp directories.
- `(loop)` `CLAUDE_CONFIG_DIR="$(mktemp -d)" claude --plugin-dir packages/client-config/skills-pack plugin details iris-mcp` -- expected: 5 MCP servers (`dev`, `admin`, `data`, `interop`, `ops`), 18 skills, no hooks.
- `(loop)` `UNARMED pnpm --filter @iris-mcp/client-config exec vitest run src/__tests__/claude-plugin-detect.test.ts src/__tests__/pack-plan.test.ts src/__tests__/skills-cli.test.ts src/__tests__/skills-docs.test.ts src/__tests__/pack-targets.test.ts` -- expected: green.
- `(loop)` The story files of `@iris-mcp/all` -- expected: green:
  ```sh
  UNARMED pnpm --filter @iris-mcp/all exec vitest run src/__tests__/release-core.test.ts src/__tests__/release-script.test.ts src/__tests__/release-prepare.test.ts src/__tests__/release-workflow.test.ts src/__tests__/release-version.test.ts src/__tests__/ci-workflow.test.ts src/__tests__/ci-ipm-archive.test.ts src/__tests__/package-manifests.test.ts src/__tests__/npx-pin.test.ts src/__tests__/pack-provenance.test.ts src/__tests__/skills-pack.test.ts src/__tests__/story-41-1-qa-pack-tarball.test.ts src/__tests__/story-41-7-doc-claims.test.ts src/__tests__/story-42-8-plugin.test.ts src/__tests__/story-42-8-doc-claims.test.ts
  ```
- `(once)` `UNARMED pnpm --filter <pkg> test`, one call per package: client-config, shared, admin, data, dev, interop, ops -- expected: green.
- `(once)` `@iris-mcp/all` as four calls, `UNARMED pnpm --filter @iris-mcp/all test -- --shard=k/4` for k = 1..4 -- expected: green. Split by file list if a quarter nears 9 minutes.
- `(once)` `pnpm --filter <pkg> lint` and `type-check`, per package -- expected: 0 errors.
- `(once)` The root checks -- expected: all OK, the baseline unchanged, and `gen:bootstrap` changing nothing:
  ```sh
  pnpm gen:governance-baseline:check
  pnpm gen:skills:check
  pnpm validate:prompts
  pnpm gen:tools-list-snapshot:check
  node scripts/check-epics-sync.mjs
  pnpm gen:bootstrap && git status --porcelain
  ```
- `(once)` The tag-consistency check (the 42.7 one-liner, `tagVersion:'1.0.0'`) -- expected: `[] []`.
- `(once)` The real registry lookups (read-only GET, the task 8 oracle): `registryLookupUrl` plus `fetch` for `io.github.upstash/context7@4.7.3` (expected `published`) and `io.github.jbrandtmse/iris-dev-mcp@1.0.0` (expected `absent`). Record the statuses in the test header.
- `(once)` The pinned publisher digest: `gh api repos/modelcontextprotocol/registry/releases/tags/v1.8.8 --jq '.assets[]|select(.name=="mcp-publisher_linux_amd64.tar.gz").digest'` (GET) -- expected: `sha256:09f1fa70ee146b640584274a1a6b2b8a0310b05d4321fa9224e6df6a016d67f4`.
- `(once)` The version-step rehearsal, in a throwaway clone (the 42.6/42.7 recipe, `os.tmpdir()`, `git remote remove origin`, a throwaway patch changeset, `pnpm run version`) -- expected: exit 0, then:
  - `plugin.json`, the marketplace `ref` and the five `server.json` at `1.0.1`;
  - `embeddedVersionProblems` empty;
  - `gen:pack:check` and `gen:listings:check` clean.
  - Remove the clone.
- `(once, lead or a lead-named stage, harness only)` `node scripts/ci-ipm-archive.mjs` -- expected: green, including the registry-shaped leg on both editions; no container left. The CI run (A1) is the binding proof.

**Shared surfaces:**
- `RELEASE_CHANNELS` (5 channels, IPM enabled) and the release report rows;
- `SECRET_VARIABLES`/redaction;
- `RELEASE_JOBS` publish env;
- `RAW_VERB`;
- `readReleaseFacts`/`embeddedVersionProblems`;
- `ROOT_GATE_SCRIPTS` and `ci.yml` (`gen:listings:check`);
- `JOB_TIMEOUT_MINUTES.ipm`;
- the pack file set (tarball test, `skills-pack.test.ts`, the pack README);
- `assemblePack`'s source allow-list;
- `checkProvenance` rule ids;
- the endorsement deny-list;
- `PACK_TARGETS` claude-code row and `SKILLS_USAGE`;
- the root README `### Releasing` table and skills-pack limits;
- the client-config README skills section;
- `release-script-fixtures.ts`/`stand-in-clis.ts`.

Every test added or changed passes on a fresh environment, in either order, and creates and removes its own temporary fixtures (settings files under a temp home and project). No check mutates the shared IRIS, so no `ExecuteMCPv2.Temp.*` fixture is used.

**Mutations (Rule 19):** apply each, observe red, revert, and confirm `git status --short` and `git diff --stat` are unchanged. Record each as `mutation: <change> → <red test>`.
- **DW-625:**
  - the detector ignores the local file → the local-override row;
  - `CLAUDE_CONFIG_DIR` ignored → the config-dir row;
  - `skipSkills` dropped → the plugin-on row.
- **Plugin:**
  - a `.mcp.json` arg `@iris-mcp/dev` without `@1` → `npx-pin.test.ts` and `story-42-8-plugin.test.ts`;
  - `iris_host`'s default removed → the "required or default" row;
  - the key `interop` → `iris-interop-mcp` → the 64-character row;
  - the notice deleted from the pack → `check:provenance` `plugin`/`notice`;
  - "official" in the `description` → the deny-list row;
  - marketplace `ref` ≠ `v<version>` → `embeddedVersionProblems` and the provenance row.
- **Channels:**
  - `ipm` back to `enabled: false` → the default-enabled row;
  - `StrictHostKeyChecking=accept-new` restored → the host-key row;
  - the deploy key dropped from redaction → the containment row;
  - `registryOutcome` reading `unknown` as `absent` → the fail-closed row;
  - lookup `published` ignored → the "no publish call" row;
  - the sha256 check skipped → the mismatch row;
  - the npm visibility poll skipped → the npm-not-visible row;
  - OIDC variables reaching `git` → containment;
  - the temporary `HOME` kept → the cleanup row.
- **Version step:** `gen-listings` skipped in `release-version.mjs` → its stamping row.
- **DW-694:**
  - `stagePackagingRoot` writes `module.xml` under `ipm/` → the offline member test in `ci-ipm-archive.test.ts`;
  - on the real path, A1b.

**Lead checklist (after code review; the lead records each result, in this order; nothing publishes before the `release` environment approval in C0):**
- A1: CI on the story commit is green, including `ipm`'s served-archive leg (GitHub's real archive of the commit, its re-tar installed) on both editions.
- A1b: the red proof of the served leg is the amendment spec's A1b (decision #122): a red branch moves the stamped guard out of `preload/` with the unit pins neutralized, and `ipm` is red at the served member check and, independently, at the install legs on both editions; the branch is deleted.
- A2: the release dry run (`release-dry-run/**`): `ipm` reads `ready (manual step after the tag: Release <v> on the Open Exchange listing IRIS-MCP-Server-Suite-2; ...)` and is never `not ready`, and the summary shows the "Manual steps" block; `mcp-registry` reads `ready (would publish 5 servers)` (its `not ready` would be reported without failing the run, decision #108). Decision #121: while the Open VSX namespace is absent (before owner step O1) `open-vsx` reads `skipped (not set up: the Open VSX namespace iris-mcp does not exist ...)` and does not fail the rehearsal.
- **O-IPM (OWNER ONLY; after the `v1.1.0` release has published, and before a later version commit reaches `main`):** tick "Publish in Package Manager" on the Open Exchange listing `IRIS-MCP-Server-Suite-2` and press Release with `main`'s `module.xml` version (the amendment spec's Design Notes, "What the owner must do"). It blocks neither the tag nor any stage.
- B1: after npm 1.0.0 is live (42.6 B7), the `--plugin-dir` session with five servers connected.
- C0 (before the `v1.1.0` tag): re-check the `mcp-publisher` v1.8.8 pin (decision #110: not yanked, no security-fix release since); then `pnpm run version`, CI green on the version commit, the tag on `main`, and the `release` environment approval. Keep the window between the `epic42` merge to `main` and this version commit short: until then `main`'s marketplace pins `v1.0.0`, whose pack has no plugin manifest (DW-707).
- C1–C2: after `v1.1.0`, per the ACs above.
- **O-OEX (OWNER ONLY; after `v1.1.0` publishes):** done by O-IPM above (the existing listing, not a new app); the approval of the edit is the owner's.
- C3: after O-IPM and its approval, per the AC "Listings" (`verify` turns IPM from `pending` to `ok`).

**Implement-stage evidence (2026-11-21).**

- **Task 0 probe (Claude Code 2.1.330).** A scratch `CLAUDE_CONFIG_DIR` and a non-repo cwd, a directory marketplace, a two-server stub plugin with string, number and boolean `userConfig` (no `sensitive`) and one optional option with no default, installed with `claude plugin install ... --config p_user=bob`. `claude mcp list` showed both same-command servers `Connected`. Each stub's environment dump: `IRIS_HOST="localhost"`, `IRIS_PORT="52773"`, `IRIS_HTTPS="false"` (the defaults), `IRIS_USERNAME="bob"` (the set value), `IRIS_UNSET=""` (no default, unset) and the parent's `IRIS_PROBE_PARENT` inherited. Identical to the plan probe. `settings.json` held `enabledPlugins["probe-plug@probe-mkt"]: true`. The scratch directory was removed.
- **Plugin format (AC 42.8.1).** `claude plugin validate packages/client-config/skills-pack` and `claude plugin validate .` both print `Validation passed` (the pack prints one `ICON_MISSING` directory warning that does not change the result). `claude --plugin-dir packages/client-config/skills-pack plugin details iris-mcp`: 18 skills, 5 MCP servers (`dev`, `admin`, `data`, `interop`, `ops`), Hooks (0).
- **Real registry lookups (read-only GET).** `io.github.upstash/context7@4.7.3` answered 200 `application/json`, `registryOutcome` `published`; `io.github.jbrandtmse/iris-dev-mcp@1.0.0` answered 404 `application/problem+json`, `absent`.
- **Publisher digest (GET).** `gh api repos/modelcontextprotocol/registry/releases/tags/v1.8.8 --jq ...digest` printed `sha256:09f1fa70ee146b640584274a1a6b2b8a0310b05d4321fa9224e6df6a016d67f4`, the pin. The registry source at v1.8.8 confirms that `publish` and `validate` take the file as a positional argument and that `CurrentSchemaVersion` is `2025-12-11`, the `$schema` the listings declare; the five generated listings also validate against that schema (ajv 6, a one-off check).
- **Tag consistency (`tagVersion:'1.0.0'`).** `[1 changeset still pending (story-42-8-...)] []`: the first array holds the story's own pending changeset, which is what the story adds; `embeddedVersionProblems` is `[]`.
- **Version-step rehearsal.** A throwaway copy of the tree under `os.tmpdir()` (a new git repository, the story's changeset replaced by a throwaway patch, `node_modules` linked), `pnpm run version`: exit 0; `plugin.json`, the marketplace `ref` (`v1.0.1`) and the five `server.json` at `1.0.1`; `embeddedVersionProblems` `[]`; `gen:pack:check` and `gen:listings:check` clean. The copy was removed.
- **Sweeps.** `@iris-mcp/all` in 8 shards (every file green after the fixes below), `@iris-mcp/client-config` (39 files, 1047 tests), `lint` and `type-check` of client-config, `gen:governance-baseline:check` (141 keys, unchanged), `gen:skills:check`, `validate:prompts`, `gen:tools-list-snapshot:check`, `check-epics-sync`, `gen:bootstrap` (changes nothing, `BOOTSTRAP_VERSION` stays `1.0.0+2.244fe8623c76`). No container was started and no image pulled.

**Mutations (Rule 19).** Each was applied, observed red, reverted, and the file and `git diff` confirmed byte-identical.
- mutation: the detector ignores `.claude/settings.local.json` (the file dropped from the checked list) → `claude-plugin-detect.test.ts` (the local file wins, both directions) and `skills-cli-plugin.test.ts` (local override).
- mutation: `CLAUDE_CONFIG_DIR` ignored → `claude-plugin-detect.test.ts` (the config-dir rows) and `skills-cli-plugin.test.ts` (config dir moved).
- mutation: `skipSkills` not passed by `cmdSkills` → `skills-cli-plugin.test.ts` (user settings, project scope, config dir, dry run, plugin added after skills).
- mutation: `.mcp.json` dev arg `@iris-mcp/dev@1` → `@iris-mcp/dev` → `npx-pin.test.ts` and `story-42-8-plugin.test.ts` (each server runs `npx -y <pinnedSpec>`).
- mutation: `iris_host`'s default removed from `plugin.json` → `story-42-8-plugin.test.ts` (required or default; the defaults are `loadConfig`'s; the six map onto the registry's six).
- mutation: the key `interop` → `iris-interop-mcp` in `.mcp.json` → `story-42-8-plugin.test.ts` (the keys row, the launch row and the 64-character row, which computes each name from the key `.mcp.json` really has).
- mutation: the notice deleted from the pack → `pnpm check:provenance` red with `[plugin] notice` (and `notice-sync`, `distribution`); the in-memory row is `pack-provenance.test.ts` "the notice deleted from the pack".
- mutation: "official" put into `plugin.json` `description` → `pnpm check:provenance` red with `[plugin] ...plugin.json: description says "official"`; rows in `pack-provenance.test.ts` and `package-manifests.test.ts` (the shared deny-list).
- mutation: the marketplace `ref` `v1.0.0` → `main` → `story-42-8-plugin.test.ts` ("the marketplace pins the release tag"); `embeddedVersionProblems` and `check:provenance` have their own rows (`release-version.test.ts` "marketplace ref off the tag", `pack-provenance.test.ts` "a marketplace entry whose ref is not v<version>").
- mutation: `ipm` back to `enabled: false` → `release-core.test.ts` constants, `release-workflow.test.ts` channels and `story-42-8-doc-claims.test.ts` (each row's default state).
- mutation: `StrictHostKeyChecking=yes` → `accept-new` → `release-script.test.ts` "the push trusts only GitHub's pinned host keys".
- mutation: `IPM_DIST_DEPLOY_KEY` dropped from the redaction list → `release-script.test.ts` "the deploy key is redacted from every report line".
- mutation: `registryOutcome` reads a non-200, non-404 answer as `absent` → `story-42-8-release-core.test.ts` (the unknown rows) and `release-script.test.ts` (a lookup that cannot be judged is `failed`, for a 500 and a 403).
- mutation: the lookup's `published` outcome ignored (every server treated as absent) → `release-script.test.ts` "every server already listed" and "one server listed and four absent" (no publish call).
- mutation: the sha256 check skipped (`if (false)`) → `release-script.test.ts` "a publisher whose sha256 is not the pin is never run" and the rehearsal's hash-mismatch row.
- mutation: the npm visibility poll skipped (`npmServes` returns true) → `release-script.test.ts` (the polling row, the 5-minute timeout row and the read-before-login row).
- mutation: the OIDC variables added to the environment of `git` → `release-script.test.ts` "the job's OIDC request variables reach the three publish CLIs ... and no other child: not npm --version, npm view or git".
- mutation: the registry channel's work directory (the temporary HOME) not removed → `release-script.test.ts` "the publisher runs with a temporary HOME that is gone afterwards".
- mutation: `gen-listings` dropped from the version step (`['gen-pack.mjs']`) → `release-version.test.ts` (the listings follow the shared version: four rows).
- mutation: `stagePackagingRoot` writes `module.xml` under `ipm/` → `ci-ipm-archive.test.ts`: the staging rows, `registryArchiveProblems` over a real `tar` ("finds nothing wrong with the archive of the staged packaging root"), and the scripted full run (the offline member test of the DW-694 gate; the real-path proof is lead A1b).

**Review-patch mutations (Rule 19, first review pass).** Each was applied, observed red, reverted, and `git status --short` and `git diff --stat` (and `git diff`) confirmed byte-identical.
- mutation: the registry publish loop checks `stopped` before `lookups.get(...) === 'published'` → `release-script.test.ts` "a server the registry already lists reads `already published` even after an earlier server failed".
- mutation: `uploadPathProblems` never reports an enabled `mcp-registry` channel whose manifest entry is absent, and its empty-`servers` refusal is disabled → "an enabled registry channel whose manifest entry is absent is refused ...", "a manifest whose registry entry lists no server.json is refused ..." and "uploadPathProblems names an enabled registry channel ...". The matching `servers.length === 0` return inside `publishMcpRegistry` is defense in depth behind `uploadPathProblems`: `publish` cannot reach it, so no test can turn it red (recorded, not pinned).
- mutation: `runPublish`'s default `channels` drops `mcp-registry` → "a run with no `channels` option publishes the script's own five channels" (the publish row and the rehearsal row).
- mutation: the IPM dry step ignores the registry's listing (always plain `ready`) → "the IPM registry lists the version: the dry step reads `ready (would be already published)` ...".
- mutation: the `!hardFailed` guard dropped from the channel loop's skip test, so a rehearsal asks the registry even after a hard npm failure → "an npm dry-run publish that fails leaves `mcp-registry` `not attempted` ...".
- mutation: `claude-plugin-detect.ts` does not strip the byte order mark and does not treat an empty or whitespace-only file as absent → `claude-plugin-detect.test.ts` "a file that starts with a byte order mark is read ..." and "an empty or whitespace-only file is absent ...".
- mutation: the detector reports `decidedBy` as the file path plus a suffix → `claude-plugin-detect.test.ts` "reads <dir>/settings.json, and never ~/.claude, when the variable is set" (the replacement for the `expect(moved)` tautology).
- mutation: the plan loop in `pack-plan.ts` honors `skipSkills` on an uninstall (`|| input.skipSkills === true` kept in the record loop's skip test) → `pack-plan.test.ts` "an uninstall that is handed a pack and skipSkills plans exactly what it plans without them". (Dropping the `action === "install"` guard in `desiredFor` alone is unobservable, because an uninstall never asks for its own client's desired state.)
- mutation: `runVerify` builds `io.github.jbrandtmse/<dir minus "iris-">` → `release-script.test.ts` "the name it asks the registry for, per server directory, is the package's mcpName and the generated server.json's name".
- mutation: `stagePackagingRoot`/`stageModule` writes `module.xml` under `ipm/` → `ci-ipm-archive.test.ts` "the leg loads the archive ... with a plain `load`" (the scripted run exits non-zero, so the run-status assertion fails before the `registryArchiveProblems` and registry-health assertions that replace the `registryFiles` re-check; the member-level rows of `registryArchiveProblems` itself are pinned by the `registryArchiveProblems` mutation below).
- mutation: the README pointer's `@1` removed from the pack README's installer command, and "they win over" changed to "they lose to" in the same README → `story-42-8-doc-claims.test.ts` "the pack README gives the @1-pinned installer command ..." and "the pack README names the six options with the plugin's own defaults".
- mutation: an empty `hooks/` directory created at the plugin root → `story-42-8-plugin.test.ts` "has no hooks directory, no hooks key in plugin.json and no CLAUDE.md at its root" and "the plugin root holds only what the pack holds ...".
- mutation: `IPM` tag-and-tree rows: the identical-tree comparison replaced by `true`, and the "registry lists the version but no tag" refusal disabled → `release-script.test.ts` "a listed version whose tag is absent fails ...", "a listed version whose tag holds a different tree fails ..." and "an existing tag with a different tree fails ...".
- mutation: the `verify` registry loop emptied, and the packaging-tag check always passing → `release-script.test.ts` "also asks the MCP Registry for each of the five servers ..." and "a server the MCP Registry does not list (404), one it cannot read (500) and a packaging repository without the tag are each one failed check".
- mutation: one byte of the ed25519 host key changed → `story-42-8-release-core.test.ts` "ssh-ed25519: the SHA256 of the key ... is the fingerprint GitHub publishes".
- mutation: `uploadPathProblems`'s registry listing check (`.json` and hash-verified) and its release-version check each disabled → `release-script.test.ts` "a listing that is not a hash-verified .json of the manifest is refused before any upload" and "the report's item names and the version come from the manifest, and a listing that is not at the release version is refused ...".
- mutation: a rehearsal's registry `not ready` also fails the rehearsal (`failed = true` after the registry branch), and the loop runs the registry channel before the others → `release-script.test.ts` "a hash mismatch, a validate failure and an unreadable lookup are each `not ready (...)`, reported but never failing the rehearsal (decision #108)", "a registry failure is the last thing the run does ..." and the two "no `channels` option" rows.
- mutation: `registryArchiveProblems`'s `.git` check, its missing-file check and its extra-file check each disabled → `ci-ipm-archive.test.ts` "a .git directory that tar did not exclude is refused" and "an extra file and a missing file are each refused, naming the file" (and the module.xml-under-a-subdirectory row, which uses the extra and missing branches).
- mutation: one `server.json` `registryType` changed from `npm` to `pypi`, and `CONNECTION_VARIABLES`'s `IRIS_HOST` default changed to `localhost2` → `package-manifests.test.ts` "has a generated server.json that names its mcpName, package and version" and `story-42-8-plugin.test.ts` "the plugin's options, the registry listings' variables and client-config's CONNECTION_VARS are the same six variables, with the same defaults".

**Code-review evidence and mutations (Rule 19, 2026-11-21).** Each mutation was applied, observed red, reverted; `git status --short` and `git diff` hashes were identical before and after the whole set.
- Probe (Claude Code 2.1.330, scratch `CLAUDE_CONFIG_DIR`, non-repo cwd, no `sensitive` option): a stub plugin whose `.mcp.json` sets `IRIS_HOST` to `${user_config.p_host}` (default `fromplugin`), started by `claude mcp list` with `IRIS_HOST=fromshell IRIS_PORT=1234` exported, saw `IRIS_HOST=fromplugin` and `IRIS_PORT=1234`: the plugin's options win over exported variables and the rest are inherited, as the pack README says.
- Probe (same setup): the `55ae0eb` pack (no `.claude-plugin/plugin.json`) installed from a directory marketplace succeeds as `Version: unknown` with no servers and no option prompt, and writes `enabledPlugins` (DW-707).
- mutation: `publishIpm`'s `finally` no longer removes the work directory → `release-script.test.ts` "the deploy key and the known_hosts file are gone as soon as the channel ends ..." (`[true, true]`).
- mutation: `name` dropped from the `server.json` endorsement fields, and separately the plugin keyword loop emptied → `pack-provenance.test.ts` "a name or a plugin keyword that claims endorsement is refused ...".
- mutation: `runVerify` also runs `git push --dry-run` → `story-42-6-qa-gate-verify.test.ts` "... is reported for that package alone ..." (three rows: `['push', 'ls-remote']`).
- mutation: `"isSecret": true` removed from `packages/iris-dev-mcp/server.json` → `package-manifests.test.ts` "... lists the six connection variables with the schema's keys ...".
- mutation: `IPM_DIST_DEPLOY_KEY` removed from both `release-checks.mjs` and `release.yml` (the two still agree) → `release-workflow.test.ts` "publish alone holds the environment ..." (only that row red).
- mutation: README "the 18 skills" → "the 17 skills" → `story-42-8-doc-claims.test.ts` "the root README's skill count for the plugin is the pack's ...".
- mutation: the `[WARN]` loop in `cmdSkills` removed → `skills-cli-plugin.test.ts` "an unreadable settings file prints a [WARN] line ...".
- mutation: the no-plugin report line without its `(checked ...)` list → `skills-cli-plugin.test.ts` "no plugin ... reports that no plugin was found and which three files were checked".
- mutation: `publishMcpRegistry`'s fresh lookup after a failed publish ignored (`if (false)`) → `release-script.test.ts` "a publish that fails but whose fresh lookup says it is there (a race) ...".

**Rework 2, decision #121 (2026-11-21; tests: `release-not-set-up.test.ts` (new, 19 rows), `story-42-8-release-core.test.ts`, `story-42-8-doc-claims.test.ts`, and two rows of `release-script.test.ts` that pinned "namespace absent is not ready / failed, exit 1" and now pin the skip, exit 0). Each mutation was applied, observed red, and reverted; `shasum` of `scripts/release.mjs` and `scripts/lib/release-core.mjs` was identical before and after the whole set.**
- mutation: the release path's `if (namespace.state === 'absent') return notSetUp(...)` removed → `release-not-set-up.test.ts` "a release: Open VSX is skipped ...", "an npm-only outcome ..." and "a rerun of the same tag ..." (3 red).
- mutation: the dry step's `notSetUp: namespace.state === 'absent'` set to `false` → `release-not-set-up.test.ts` "a rehearsal: Open VSX is skipped ..." (1 red).
- mutation: a skipped channel also fails the run (`outcome.status === STATUS.failed || outcome.notSetUp === true`) → the two skip rows, "an npm-only outcome ..." and "a rerun of the same tag ..." (4 red).
- mutation: the release path skips on `namespace.state !== 'present'` (an unreadable namespace read as absent) → "a release: an Open VSX namespace that cannot be read (HTTP 502) ..." and "an Open VSX namespace 200 that is not JSON ..." (2 red).
- mutation: `notReadyOutcome` uses `some` instead of `every` (a real problem beside an unset reason would skip) → "a rehearsal: an Open VSX namespace that is absent beside an `ovsx` that is not installed ..." (1 red).
- mutation: the `::warning::` loop emptied → the two skip rows (2 red).
- mutation: `releaseReport`'s "Skipped channels" block disabled → the two skip rows, "a rerun of the same tag ..." and `story-42-8-release-core.test.ts` "the report lists every channel skipped as not set up in one block ..." (4 red).
- mutation: the npm failure ignored (`failed = false; hardFailed = false;` after the npm loop) → `release-not-set-up.test.ts` "npm is never skippable" (3 red: the two modes and the `npm view` that cannot be judged).
- mutation: the npm loop's `already published` branch disabled (`&& false`) → "a rerun of the same tag after the owner setup publishes the skipped channels" (1 red).
- mutation: the README's "`::warning::` annotation" reworded → `story-42-8-doc-claims.test.ts` "says a channel that is not set up is skipped and listed, not a failure ..." (1 red).
- Probe evidence for the Marketplace verdict and the real shapes: see the Spec Change Log, #121. The IPM channel was not touched (excluded pending #122): `release-script.test.ts` is byte-identical to `869c522` except the two Open VSX rows.
- Correction (code review of the rework): the dry step's `notSetUp: ... false` mutation above also reds `release-script.test.ts` "the rehearsal > Open VSX namespace absent (decision #121) ..." (observed: 1 red there, beside the one in `release-not-set-up.test.ts`).

**Code review of the #121 rework (2026-11-21). `release-not-set-up.test.ts` now has 24 rows (19 + 4 non-namespace-404 rows + 1 skip-then-failure row). Each mutation was applied, observed red, and reverted; `shasum` of `scripts/release.mjs` and `scripts/lib/release-core.mjs` was identical before and after the whole set.**
- mutation: `openVsxNamespaceState` reads any 404 as absent (`answer.status === 404 || body?.error === ...`) → the four rows "an HTML 404 page ..." and "Open VSX's 404 for a path it does not route ..." in both modes (4 red).
- mutation: a skip hides a failure (`return failed && !results.some((r) => r.notSetUp === true) ? 1 : 0`) → "a skip followed by a channel that fails: the release exits 1 ..." (1 red).
- mutation: the annotation title's comma unescaped (`title=Channel skipped, not set up`) → the two skip rows and `story-42-8-release-core.test.ts` "each skipped channel is one raw `::warning::` line ..." (3 red).
- mutation: `escapeCommandData` without its `\n` → `%0A` replace → `story-42-8-release-core.test.ts` "each skipped channel is one raw `::warning::` line ..." (1 red).
- mutation: `notSetUpChannels` filters on `String(result.status).startsWith('skipped')` (a disabled channel counted) → `story-42-8-release-core.test.ts` "the report lists every channel skipped as not set up ..." (1 red).
- mutation: the block printed when `skipped.length >= 0` → "a clean run lists nothing as skipped", both modes (2 red).
- mutation: the dry step's `notSetUp: namespace.state !== 'present'` (an unreadable namespace read as absent in a rehearsal) → "a rehearsal: an Open VSX namespace that cannot be read (HTTP 502) ..." and the two rehearsal non-namespace-404 rows (3 red).
- mutation: `notReadyOutcome` returns `notSetUp: true` unconditionally → the rehearsal rows "an Open VSX version lookup that cannot be read (HTTP 500) ...", "HTTP 502", "absent beside an `ovsx` that is not installed" and the two non-namespace-404 rows (5 red).
- mutation: the release path reads the namespace (and skips) before the publisher/CLI refusal → "a release: an Open VSX namespace that is absent beside an `ovsx` that is not installed ..." (red, with the skip rows whose reason the mutant changed).
- mutation: the not-attempted guard lets `open-vsx` run after an earlier failure (`failed && channel.id !== 'open-vsx' && ...`) → "a Marketplace upload that fails ... Open VSX ... is `not attempted`, not skipped" and the three "npm is never skippable" rows (4 red).

## Auto Run Result

Status: done
Blocking condition: none

**Summary.** Story 42.8 is implemented on `epic42`; the repository is still at 1.0.0 and `BOOTSTRAP_VERSION` did not move (`1.0.0+2.244fe8623c76`).
- **Plugin.** `skills-pack-src/plugin/` feeds `gen:pack`, which writes `.claude-plugin/plugin.json` (plugin `iris-mcp`, six `userConfig` options) and `.mcp.json` (five servers `dev`, `admin`, `data`, `interop`, `ops`, each `npx -y @iris-mcp/<pkg>@1`) into the skills pack. `.claude-plugin/marketplace.json` pins `git-subdir` at `v<version>`. The pack README gained a "Claude Code plugin" section.
- **Listings.** `scripts/gen-listings.mjs` generates the marketplace file and the five `server.json` files; `gen:listings:check` is a CI root gate. `checkProvenance` has a `plugin` rule, and the endorsement deny-list is shared (`scripts/lib/endorsement.mjs`).
- **Installer (DW-625).** `claude-plugin-detect.ts` reads `enabledPlugins["iris-mcp@iris-mcp"]` from the user (`CLAUDE_CONFIG_DIR` aware), project and local settings. With the plugin on, `skills install --client claude-code` installs only the rule.
- **Release.** `ipm` is enabled with the pinned GitHub host keys and a redacted deploy key; a listed IPM version goes on to the tag and tree check (#109). `mcp-registry` is the last channel (decision #108: non-blocking in a rehearsal, fails the run only after every other channel in a release). `mcp-publisher` is pinned to **v1.8.8**, published 2026-11-06T14:07:07Z, sha256 `09f1fa70ee146b640584274a1a6b2b8a0310b05d4321fa9224e6df6a016d67f4` (decision #110; the digest matches the release asset's `digest` field and a downloaded copy). `verify` also reads the five registry listings and the packaging tag. `release-version.mjs` regenerates the pack and the listings.
- **DW-694.** `stagePackagingRoot` moved to `scripts/lib/ipm-archive.mjs`; `scripts/ci-ipm-archive.mjs` has a registry-shaped leg (GNU tar inside the Linux container, `load <tgz>` on a fresh container per edition).

**Files changed.** 69 paths: the plugin sources and generated pack files, the listings generator and its output, the provenance and endorsement libraries, the installer (`claude-plugin-detect.ts`, `pack-plan.ts`, `pack-apply.ts`, `cli/clients.ts`, `pack-targets.ts`, `index.ts`), the release code (`release.mjs`, `release-core.mjs`, `release-checks.mjs`, `release.yml`, `release-version.mjs`, `ipm-archive.mjs`, `ci-ipm-archive.mjs`), the docs (root and client-config README, CHANGELOG, a `minor` changeset for `@iris-mcp/client-config`) and about 30 test files.

**Review.** Four layers reported 36 findings: high 0, medium 7, low 26, false 3. Patched (one fresh subagent): the registry publish loop ordering and the empty-manifest guard, the `uploadPathProblems` refusal, BOM and empty settings files, four unfalsifiable assertions, the `verify` name pin, the stale README sentences, three missing release-script rows (the script's own five channels, an IPM dry step for a listed version, a registry `not attempted` after a hard failure) and nine groups of missing `mutation:` lines. Deferred (frontmatter): the compile-on-save hook candidate, an automated pin of Claude Code's acceptance of the plugin files, and the unmeasured `ipm` job timeout. Rejected with reasons: see the triage log (spec-bound design points, project precedents, duplicates, three false).

**Follow-up review recommendation: true.** Six medium entries were patched. The unverified risk is the new release-script rows and the `release.mjs` registry-loop edits made after the review: they were checked by their own mutation runs and by every suite below, but no layer re-read the patched tree.

**Verification.**
- Static: `node --check` on the ten scripts; `gen:pack:check`, `gen:listings:check`, `check:provenance`, `lint_spine.py` (0 findings) all clean.
- Claude Code 2.1.330 (scratch `CLAUDE_CONFIG_DIR`, non-repo cwd): `claude plugin validate` passes on the pack and on `.`; `plugin details iris-mcp` lists 5 MCP servers, 18 skills, 0 hooks. The Task 0 probe matched the plan (see `## Verification`).
- Tests: client-config 1050 passed; shared 2575; admin 506 (8 skipped); data 163 (2 skipped); dev 1490 (319 skipped); interop 751; ops 350; `@iris-mcp/all` in 8 shards, all green (no failures in any shard). Lint and type-check clean for every package that has them (`@iris-mcp/all` has neither script).
- Root: baseline `1e62c5ad5bf7`/141 intact, `gen:skills:check`, `validate:prompts`, `gen:tools-list-snapshot:check`, `check-epics-sync`, `gen:bootstrap` (no change, tree unchanged).
- Read-only GETs: registry lookups `io.github.upstash/context7@4.7.3` is `published`, `io.github.jbrandtmse/iris-dev-mcp@1.0.0` is `absent`; the publisher digest matches.
- Version-step rehearsal in a throwaway copy (removed): exit 0; `plugin.json`, marketplace `ref` (`v1.0.1`) and the five `server.json` at 1.0.1; `embeddedVersionProblems` `[]`; both generator checks clean.
- Tag-consistency one-liner prints `[1 pending changeset] []`: the only problem is this story's own pending changeset, which the spec requires; `embeddedVersionProblems` is `[]`. The lead's version step consumes it.

**Residual risks.** The DW-694 harness leg (`node scripts/ci-ipm-archive.mjs`: GNU tar inside the container and `load <tgz>`) was not run against a real IRIS: no container was started. Its real-path proof is lead A1/A1b. `git-subdir` with `ref` was verified by the validator only; C1 is its first real install. The marketplace entry resolves a tag that has no plugin until `v1.1.0`. The lead re-checks the `mcp-publisher` v1.8.8 pin before the `v1.1.0` tag. The inner `servers.length === 0` guard in `publishMcpRegistry` is unreachable through `publish()` (an earlier refusal fires), so only the refusal is pinned.

**Overrides recorded.** Decisions #108 and #110 in `## Spec Change Log`; the frozen intent block is untouched.

## QA

QA stage, 2026-11-21 (Claude Sonnet 5.5). Gap analysis of the six priorities against the existing 42.8 tests; the existing release-script, IPM, registry and DW-625 rows were re-read and found pinning (the implement stage's mutation lines hold). Real gaps found and closed below. No product defect was found.

**Tests added (QA).**
- `packages/iris-mcp-all/src/__tests__/story-42-8-qa.test.ts` (new, 25 tests): `@iris-mcp/all` never listed (real tree: only the five server dirs carry `server.json` and `mcpName`); `gen:pack:check` / `gen:listings:check` run as the real scripts over a throwaway copy under `os.tmpdir()` and red on a drifted `.mcp.json`, `plugin.json`, un-regenerated `skills-pack-src/plugin/mcp.json`, a stray `hooks/`, a drifted `server.json`, the marketplace `ref`, a deleted `server.json`; the lockstep read FROM DISK for each of the 12 version-bearing fields (one drifted alone is the only problem and is named); a local `claude plugin validate` oracle (skipped where `claude` is absent; scratch `CLAUDE_CONFIG_DIR`/HOME, non-repo cwd; passes on the pack and on `.`; refuses a `claude-*` name, so it can fail).
- `packages/client-config/src/__tests__/qa-42-8-plugin-process.test.ts` (new, 50 tests): DW-625 through the BUILT bin as a real child with a from-scratch env; eight file shapes (compact, 2/4 spaces, tabs, CRLF, BOM+CRLF, JSONC with CRLF comments and trailing comma, among other keys) at user true and at local false over user true; precedence local > project > user over all 27 true/false/absent combinations against an independent oracle; `CLAUDE_CONFIG_DIR` (decoy `~/.claude` with the opposite value is not read; empty variable counts as unset); malformed/empty/BOM-only/directory/non-boolean files; a real install writes only the rule. The developer's real `~/.claude/settings.json` is fingerprinted by stat before and after.
- `packages/iris-mcp-all/src/__tests__/release-prepare.test.ts` (extended, +14): `prepare` refuses a one-field drift of each listing field (plugin.json, the marketplace `ref` as `v0.9.0` and as `main`, and `version` / `packages[0].version` of each of five `server.json`) in a tag run and a dry run, exit 1, only that problem, before docker; plus a control. The `pluginVersion`/`marketplaceRef`/`serverVersion` fixture options existed but no prepare row used them.
- `packages/iris-mcp-all/src/__tests__/release-script.test.ts` (extended, +4 in a nested QA describe, and a more realistic publisher tarball): the pin that ships (no injected pin: the request is the v1.8.8 asset URL and bytes that are not the pinned sha256 are never run, release exit 1, rehearsal `not ready` exit 0); a credential matrix over all five channels (NPM_TOKEN, GITHUB_TOKEN, IPM_DIST_DEPLOY_KEY, VSCE_PAT, OVSX_PAT, the two OIDC variables, `GIT_SSH_COMMAND`, each held only by its allowed children, with the allowed sites proven to have run) and a rehearsal variant; an IPM failure leaves `mcp-registry` `not attempted`. The `registryWorld` tarball now holds `LICENSE`, `README.md` and `mcp-publisher` side by side, the layout of the real asset.

**Oracles (read-only).** `mcp-publisher_linux_amd64.tar.gz` v1.8.8 downloaded and hashed: sha256 `09f1fa70ee146b640584274a1a6b2b8a0310b05d4321fa9224e6df6a016d67f4` (the pin); `tar -tzvf` lists `LICENSE`, `README.md`, `mcp-publisher` at the root. Registry v1.8.8 source (GET): `login` writes `~/.config/mcp-publisher/token.json` under `os.UserHomeDir()` and `publish` reads it, so one shared temporary HOME is correct. Real lookups at `/v0.1/servers/<name>/versions/<v>`: `io.github.upstash/context7@4.7.3` 200 `application/json`; `io.github.jbrandtmse/iris-dev-mcp@1.0.0` and an unknown version 404 `application/problem+json`; `@iris-mcp/dev@1.0.0` on npm 404 (not yet published). `claude plugin validate` (Claude Code 2.1.330) passes on the pack and on `.` (one `ICON_MISSING` directory warning).

**Mutations demonstrated (red, reverted, `git status --short` and `git diff --stat -- scripts packages/client-config/src` clean afterwards).**
- mutation: `mcpName` added to `packages/iris-mcp-all/package.json` → `story-42-8-qa.test.ts` "exactly the same five packages declare an mcpName".
- mutation: `readReleaseFacts` reads `packages[0].version` from `listing.version` → 10 server.json rows of `story-42-8-qa.test.ts` and of the new `release-prepare.test.ts` rows red; the existing `release-version.test.ts` "embeddedVersionProblems refuses" rows stay GREEN (they mutate the facts after reading), proving the gap.
- mutation: marketplace `ref` check dropped from `embeddedVersionProblems` → the two marketplace rows of the new `release-prepare.test.ts` describe.
- mutation: `gen-listings --check` ignores drift → "a hand edit of a server.json ... marketplace ref ... deleted server.json".
- mutation: `gen-pack --check` ignores drift → the `.mcp.json`, `plugin.json` and un-regenerated source rows; `gen-pack --check` ignores stray files → the hand-placed `hooks/` row.
- mutation: the generated `plugin.json` renamed `claude-iris` → the `claude plugin validate` row (the validator says the name is reserved).
- mutation: `deps.mcpPublisher ?? MCP_PUBLISHER` falls back to `v1.8.10`, and separately one hex digit of the digest flipped → "the pin that ships is the one downloaded" (the injected-pin rows cannot see either).
- mutation: the deploy key added to the environment of `npm publish` → the new credential-matrix and rehearsal rows red while all 247 other release-script rows stay green (a gap, now closed).
- mutation: an IPM failure no longer sets `failed` → the new IPM-before-registry row (and seven existing IPM rows).
- mutation: `RELEASE_CHANNELS` with `mcp-registry` before `ipm` → the order rows, the default-channels rows and the constants row; `StrictHostKeyChecking=accept-new` → the host-key row; a registry answer other than 200/404 read as `absent` → the 500/403 rows and the rehearsal row; a rehearsal's registry `not ready` also failing the run → the #108 rehearsal row and the pin row.
- DW-625 (built bin, client-config rebuilt for each and again after the restore): `env: deps.env ?? process.env` → `{}` → the two `CLAUDE_CONFIG_DIR` rows (a gap the injected-env tests cannot see); the local file dropped from the checked list → 28 rows; BOM not stripped → the two BOM rows; precedence reversed → the local-over-user rows.
- Total demonstrated by this stage: `mutations_demonstrated=19`.

**First-run failures.** One: the process test compared a `/var/folders/...` project path with the child's `/private/var/folders/...` (the child resolves its cwd on macOS); the test now uses the real path for project files. Nothing else failed on first run; every new test passed on its first run against the unmutated tree, and each was then proven red by a mutation above.

**Defects found.** None in product code. Observation, not a defect: a one-off run of three release suites together exceeded 180 s under host load (another project's test runs on the same machine); single-file runs finish in under 150 s.

**Not covered (stated).** The real `mcp-publisher publish`/`login` against the live registry and a real GitHub OIDC token (publish-shaped, prohibited); the IPM push to a real packaging repository; `ci-ipm-archive` on a real IRIS (lead A1/A1b). The `claude plugin validate` test is local-only by design (the spec's Deferred item stands for CI).
