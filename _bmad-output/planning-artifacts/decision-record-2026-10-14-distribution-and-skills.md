---
title: 'Decision record: competitive response, companion skills pack, and install strategy'
date: '2026-10-14'
decided_by: 'Project Lead'
status: 'decided — input to the next Correct Course'
inputs:
  - '_bmad-output/planning-artifacts/research/competitive-iris-agentic-dev-mcp-tools-gap-analysis-2026-10-14/research.md'
  - '_bmad-output/implementation-artifacts/deferred-work.md (DW entries cited below)'
  - '../OcuPilot/.github/workflows/ci.yml (CI reference design)'
---

# Decision record: competitive response, companion skills pack, and install strategy

This record captures what the Project Lead decided on 2026-10-14 after the iris-agentic-dev teardown, so the next Correct Course can turn it into epics and stories. It has three parts, which become three groups of epics, in this order:

1. **Competitive gaps:** close the P1 gaps from the research report.
2. **Companion skills and rules pack:** ship our own equivalent of the competitor's skill kit.
3. **Install and distribution:** replace "clone and build" with a published install. This comes last because the Claude Code plugin it ships carries the skills pack.

---

## Part 1 — Competitive gaps

The research report has the evidence: [research.md](research/competitive-iris-agentic-dev-mcp-tools-gap-analysis-2026-10-14/research.md). It recommends five pieces of work, and its gap register lists the full P1/P2/P3 priorities:

| Work | Gaps | Kind |
|---|---|---|
| Agent code editing, ergonomics, and safety | G1, G2, G5 | Epic |
| Interop message forensics (start with G32, which is nearly free) | G32, G33, G34, G35 + G50 | Epic |
| SQL write safety | G21, G22 | Story set |
| Test depth: code coverage | G23, then G24 | Epic |
| Fix the HTTP transport: implement it, or reject `--transport http` cleanly | G48 | Fix |

Five gaps are declined, with reasons in the register: G8, G17, G41, G45, G47.

---

## Part 2 — Companion skills and rules pack

### Decisions

- **Build our own equivalent** of the competitor's skills and rules kit. Don't copy it word for word.
- **Content sources:**
  - Write the core from our own `.claude/rules/` and our epic retros.
  - Adapt competitor content only where it is clearly the better starting point, for example the list and SQL pattern skills.
- **Licensing:** the competitor's kit is MIT, © 2025 InterSystems Corporation. Adapting it is allowed on one condition: ship their notice. Concretely:
  - Add a `THIRD_PARTY_NOTICES.md` holding their full MIT text and a provenance table. The table maps each of our derived files to its source file at competitor commit `b6205bb`.
  - Ship that notice wherever the skills ship: the npm `files` list, the plugin folder, and whatever the installer writes.
  - Give each derived `SKILL.md` a one-line header: "Adapted from intersystems-community/iris-agentic-dev (MIT, © 2025 InterSystems Corporation); see THIRD_PARTY_NOTICES".
  - Credit the named authors (Tim Leavitt, Tom Dyar) as a courtesy.
  - Don't derive from `kb/ipm-module-authoring.md` or `iris-objectscript-eval`. Their frontmatter cites an internal InterSystems GitLab as the source.
  - Don't present the pack as InterSystems' or imply endorsement. Using "IRIS" and "ObjectScript" descriptively is fine.
- **No benchmarking in this repo.** The Project Lead benchmarks in a separate project. Our in-repo checks are the existing tool-name validator for generated skills, plus live probes of factual claims under Rule #16.

### Content

1. **One always-on rule:** a short ObjectScript pre-write checklist.
   - For Claude Code: a `.claude/rules` file whose `paths:` frontmatter scopes it to `**/*.cls`, `**/*.mac` and `**/*.inc`.
   - For other agents: an `AGENTS.md` version.
2. **About 6–10 knowledge skills:**
   - ObjectScript gotchas;
   - `%Status` and error handling;
   - `%UnitTest`;
   - embedded SQL;
   - IRIS system-class discipline;
   - interoperability patterns.
3. **The 11 existing workflow skills.** Keep generating them from the MCP prompts, and add new ones as the P1 tools ship.

### Distribution

- **A Claude Code plugin**, with `.claude-plugin/plugin.json` and a `marketplace.json` in our repo. One install brings all 5 MCP servers plus the skills. An optional compile-on-save hook is a candidate.
- **The `packages/client-config` installer** installs skills and rules into each client's native location:
  - Claude Code: `.claude/skills` and `.claude/rules`;
  - Copilot: `.github/instructions`;
  - Cursor: `.cursor/rules`;
  - other agents: `.agents/skills` and `AGENTS.md`.

### Constraints confirmed from the Claude Code docs (2026-10-14)

- **Skill locations:** Claude Code loads skills from `.claude/skills/`, `~/.claude/skills/`, plugin `skills/` folders, and nested `.claude/skills/` directories. It does **not** read `.agents/skills/`.
- **`AGENTS.md`:** read natively only when no `CLAUDE.md` exists. Otherwise it's imported with `@AGENTS.md`.
- **`.claude/rules/*.md`:** loaded automatically. A `paths:` glob scopes a rule to matching files. Plugins can't carry rules, so the always-on rule needs the installer route.
- **MCP prompts vs. skills:** MCP prompts are slash commands only the user can invoke. Skills are invoked by the model from their description. This is why the pack should ship as skills.

---

## Part 3 — Install and distribution strategy

### Background

- **The original plan:**
  - npm as the primary channel: seven `@iris-mcp/*` packages, all on one version through Changesets;
  - IPM as the secondary channel, for the IRIS-side classes;
  - listings on the MCP Registry and Open Exchange.

  Sources: `prd.md:202-211`, `prd.md:81`, `prd.md:424`, `architecture.md:77`, `architecture.md:337-341`.
- **The deferrals:** publishing was deferred twice. The latest recorded order was a beta first (git clone + build), then npm publish. The beta ran by 2026-09-11 (`epic-36-retro-2026-09-11.md:62-63`), but publishing was never revisited.
- **The code is already built for `npx`.** `client-config` writes `npx -y @iris-mcp/<pkg>` (`synthesize.ts:126`), and the VS Code extension spawns the same. Nothing is published, though: the registry returns 404 for `@iris-mcp/dev` and `@iris-mcp/shared`. So every `npx` path fails today.

### Decisions

| # | Decision | Choice | What it means |
|---|---|---|---|
| D1 | Package names | Create the free `iris-mcp` organization on npm | No renames. The Project Lead creates the organization after enabling two-factor authentication. If the name is taken, fall back to a personal scope. |
| D2 | First version | Publish `1.0.0` directly, with no beta tag | All packages move to `1.0.0` together. Because there is no public beta, the release story must include a local tarball smoke test (`npm pack`, then launch through `npx` in a real client; DW-47) before publishing. |
| D3 | Version pinning | Major pin | `client-config` and the extension write `npx -y @iris-mcp/<pkg>@1`. Users get 1.x fixes automatically and never jump to 2.0. This settles DW-260. |
| D4 | Minimum Node.js | Node 22+ | Node 18 reached end of life on 2025-04-30 and Node 20 on 2026-04-30. `iris-dev-mcp` already needs Node 22 (`fs.globSync`, `load.ts:12`), and the root `engines` currently claims `>=18`. Declare `engines.node >=22` in every package and fix the README. |
| D5 | VS Code extension | A project-name publisher (for example `iris-mcp`) on the VS Code Marketplace and Open VSX | Publish after npm 1.0.0, because the extension launches the servers through npm. Keep "intersystems" out of the publisher name. This settles DW-389. |
| D6 | IPM | Revive and publish | Generate `ipm/module.xml` from the bootstrap's class manifest; today it lists 18 resources at version 0.1.0, against 29 embedded classes. Add a drift test, keep its version in step with npm releases, prove it with an offline install test, then publish to the IPM registry and Open Exchange. This reopens the dropped DW-34. |
| D7 | Automated releases | Build CI before the first release | GitHub Actions with npm provenance, and the publish checks run against a throwaway IRIS. This settles DW-443 and DW-387. |

### Fixes required before the first publish

| Fix | Evidence | Ledger |
|---|---|---|
| Declare `engines.node >=22` everywhere, and correct the README | root `package.json:37-39`; `load.ts:12` | — |
| `@iris-mcp/all` has `"files": []` and no `bin`. Add a launcher, or correct the README's `npm i -g @iris-mcp/all` claim | `packages/iris-mcp-all/package.json:6` | — |
| `@iris-mcp/shared` exports `./test-helpers` pointing at `src/`, which isn't shipped | `packages/shared/package.json:17-19` | DW-506 |
| Move every package to `1.0.0` together. `client-config` is at 0.0.1, the rest at 0.0.2 | package.json files | DW-394 |
| Add license, repository, author and keywords to each package | package.json files | DW-31 (reopen) |
| Make `client-config` and the extension write `@1` pins | `synthesize.ts:126`; extension `serverDefinitionProvider.ts` | DW-260 (reopen) |
| Correct the documented `npx … @iris-mcp/client-config iris-mcp-clients` command | `packages/client-config/README.md:17` | — |
| The bootstrap must refuse to downgrade newer classes on a shared IRIS. Publishing widens the version spread | bootstrap | DW-508 (HIGH) |
| Revive IPM, or remove the broken `zpm "install …"` fallback message (D6 chose revive) | `bootstrap.ts:95-96`; `ipm/module.xml` | DW-34 |

### CI reference design: OcuPilot

`../OcuPilot/.github/workflows/ci.yml` has been working well. Both repos are public, so Actions minutes are free.

**Port these patterns, kept lean:**

1. **A throwaway IRIS per job.** `scripts/ci-throwaway.sh` brings up a fresh container at a pinned version (`iris-community` / `irishealth-community` 2026.2) from its own scratch compose file. It waits for readiness, captures logs on failure, and always tears down. It refuses the live instance's ports, which matches our rule never to touch the shared IRIS. Our publish checks (`prepublish-gate.mjs`, `verify-iris-reachable.mjs`) run against this throwaway.
2. **Gates at each Node version floor.** The matrix runs one leg at the bottom of each supported major version (22.x, 24.x, 26.x). A self-test keeps the matrix equal to `engines.node`. In OcuPilot this caught a bug that only appeared on Node 22, which is the same class as our `globSync` defect.
3. **Offline install proofs.**
   - IPM: build the archive on one throwaway container and install it on a second one with `--network none`, asserting nothing came from a registry. See `scripts/ci-ipm-archive.sh`.
   - npm: install the `npm pack` tarballs in a clean directory, launch them through `npx`, and smoke-test them.
4. **An edition matrix:** install on both `iris-community` and `irishealth-community`.
5. **Pipeline hygiene:**
   - pin every action to a commit SHA and every tool to an exact version;
   - `permissions: contents: read`, and cancel superseded runs;
   - no `continue-on-error` and no `|| true`;
   - a self-test asserts the pins, and asserts that the checks declared in code equal the workflow's `run:` steps;
   - a `sysctl` port reservation prevents the runner port race.
6. **The CI workflow stays secret-free.** It publishes nothing, as OcuPilot's does.

**Adapt rather than copy.** `ci-throwaway.sh` (about 1,000 lines) and `ci-ipm-archive.sh` (about 530 lines) assume OcuPilot specifics: HSCUSTOM, its readiness endpoint, its storage directories. Both are the Project Lead's own code, so no licensing question applies. OcuPilot's 8 + 5 parallel test shards are not needed yet.

**New, with no OcuPilot precedent: a release workflow.**
- It runs on a version tag, only after CI has passed on that commit.
- It needs approval through a protected GitHub environment.
- It then publishes to npm with provenance, then the extension to both stores, then the package to IPM.
- Secrets live only in this workflow.

### Proposed story order for the install epic

1. Pre-publish fixes (the table above), including the DW-508 downgrade guard.
2. CI workflow: gates with the Node matrix, one throwaway-IRIS job, and a package job covering npm and IPM.
3. IPM revival: generate the manifest, add the drift test, sync versions, and run the offline install proof.
4. Release workflow: tag, approval, then npm with provenance.
5. Local tarball smoke test (DW-47), then publish `1.0.0`.
6. Extension: publish to the VS Code Marketplace and Open VSX.
7. Claude Code plugin marketplace (shared with Part 2), and an MCP Registry listing.
8. README rewrite: installing becomes "install Node 22, run one command." Post-publish re-certification of each client follows (DW-441).

### Accounts only the Project Lead can create

None of these block early stories; each is needed only when its story comes up.

- An npm account with two-factor authentication, plus the `iris-mcp` organization (D1).
- A VS Code Marketplace publisher, through a Microsoft account (D5).
- An Open VSX account and namespace, through an Eclipse account (D5).
- An InterSystems Developer Community account, for Open Exchange (D6).
- GitHub repository settings: an Actions environment with required approval, and npm trusted publishing or a token (D7).

### Ledger entries this record settles

Correct Course should update these in `deferred-work.md` through `_bmad/scripts/ledger.sh`.

| Entry | Current status | Settled by |
|---|---|---|
| DW-300: npm publish after beta | decision-pending | D1, D2, D7: publish 1.0.0 through CI |
| DW-439: beta distribution | decision-pending | D2: no public beta. The git-clone beta is complete |
| DW-394: version boundary / changeset bumps | decision-pending | D2: align everything at 1.0.0 |
| DW-389: extension publisher TBD | routed | D5 |
| DW-260: unpinned `npx` | wontfix-accepted | D3: reopen and fix with `@1` |
| DW-34: IPM via Open Exchange | dropped | D6: reopen |
| DW-443: gates only on `prepublishOnly` | routed | D7: the CI gates |
| DW-387: no multi-package release gate | decision-pending | D7: the release workflow |
| DW-47: pre-publish smoke rerun | decision-pending | D2: required before 1.0.0 |
| DW-31: package metadata | wontfix-accepted | reopen: pre-publish fixes |
| DW-506: `test-helpers` exports | routed | pre-publish fixes |
| DW-508: silent downgrade (HIGH) | routed | pre-publish fixes; must land before publishing |
| DW-441: post-publish re-certification | decision-pending | story 8 |
