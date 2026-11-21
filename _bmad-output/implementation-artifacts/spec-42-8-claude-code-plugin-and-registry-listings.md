---
title: 'Story 42.8: Claude Code Plugin and Registry Listings'
type: 'feature'
created: '2026-11-21'
status: 'ready-for-dev'
review_loop_iteration: 0
followup_review_recommended: false
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
    - `MCP_PUBLISHER` `{version:'v1.8.10', asset:'mcp-publisher_linux_amd64.tar.gz', sha256:'32d287ed6fb7dc04eddd2621097784c06a355b2348b35ccc630a1643aa75ff4a'}`, with the URL `https://github.com/modelcontextprotocol/registry/releases/download/v1.8.10/<asset>`;
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

## Spec Change Log

## Review Triage Log

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
  - IPM is enabled without condition, so a missing packaging repository blocks the release until owner step O-IPM1. This is intended.
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
   - **IPM:** enabled unconditionally. A missing packaging repository makes `rehearse` not ready, which blocks `v1.1.0`, npm included, until owner step O-IPM1. This is intended: O-IPM1 is cheap and precedes the tag, as O1 does for the stores, and a 1.1.0 without IPM would break "the module version equals the npm version".
   - **MCP Registry:** it has no owner prerequisite (OIDC from `repository_owner`), and an unreadable registry fails closed like every store.
   - Alternative: ship IPM enabled only once O-IPM1 is done (a one-line flip in a later commit).
9. **Orchestrator decision needed: a rerun of the IPM channel when the registry already lists the version — recommended: go on to the tag/tree check (identical → `already published`; otherwise `failed`), and the dry step reads `ready (would be already published)`,** because 42.5's row made any rerun after the Open Exchange press fail (42.5 review, deferred to this story).
10. **Orchestrator decision needed: `mcp-publisher` — recommended: v1.8.10, the linux_amd64 tarball, sha256 `32d287ed…75ff4a` pinned in `release-core.mjs`, downloaded and verified by `release.mjs`,** because the release pins every tool (Story 42.5), and old binaries fail OIDC with "invalid audience" (registry troubleshooting).
    - v1.8.10 was published 2026-11-20. The docs' example pins v1.8.1.
    - cosign verification (the docs' route) adds an action. A sha256 pin read from the release's asset digest is the same integrity check, with no new action.
11. **Orchestrator decision needed: the MCP Registry scope — recommended: the five server packages, not `@iris-mcp/all`,** because `all` has no bin and no `mcpName`, and the registry lists runnable servers.

**What the owner must provide, and when (the lead tells the Planner; nothing blocks the implement or QA stages):**
- **O-IPM1, before the `v1.1.0` tag (and before lead A2's "ready" line):**
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
- `(once)` The pinned publisher digest: `gh api repos/modelcontextprotocol/registry/releases/tags/v1.8.10 --jq '.assets[]|select(.name=="mcp-publisher_linux_amd64.tar.gz").digest'` (GET) -- expected: `sha256:32d287ed6fb7dc04eddd2621097784c06a355b2348b35ccc630a1643aa75ff4a`.
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

**Lead checklist (after code review; the lead records each result):**
- A1: CI on the story commit is green, including `ipm`'s registry-shaped leg on both editions.
- A1b: a throwaway branch with the module.xml-in-subdirectory mutation is red at that leg; the branch is deleted.
- A2: the release dry run (`release-dry-run/**`) shows the matrix's IPM and registry readiness lines.
- B1: after npm 1.0.0 is live, the `--plugin-dir` session with five servers connected.
- C1–C3: after `v1.1.0` (C3 also after O-OEX), per the ACs above.

## Auto Run Result

Status: ready-for-dev
Blocking condition: none
