# Publishing Checklist: npm/npx and IPM

**Created:** 2026-04-07
**Purpose:** Step-by-step guide for publishing the IRIS MCP v2 suite to npm (for AI assistant users) and IPM (for IRIS-native users). Designed to be followed by an agent assisting the developer in a dedicated publishing session.

---

## Table of Contents

1. [Project Inventory](#1-project-inventory)
2. [Part A: npm Publishing](#part-a-npm-publishing)
   - [A1: npm Account & Organization Setup](#a1-npm-account--organization-setup)
   - [A2: Package.json Publish-Readiness Audit](#a2-packagejson-publish-readiness-audit)
   - [A3: Bootstrap Drift Check](#a3-bootstrap-drift-check)
   - [A4: Build & Test Verification](#a4-build--test-verification)
   - [A5: Dry-Run Publish](#a5-dry-run-publish)
   - [A6: First Publish](#a6-first-publish)
   - [A7: Post-Publish Verification](#a7-post-publish-verification)
   - [A8: Subsequent Releases (Changesets Workflow)](#a8-subsequent-releases-changesets-workflow)
   - [A9: Optional — GitHub Actions CI/CD](#a9-optional--github-actions-cicd)
3. [Part B: IPM Publishing](#part-b-ipm-publishing)
   - [B1: IPM Registry Account](#b1-ipm-registry-account)
   - [B2: module.xml Audit](#b2-modulexml-audit)
   - [B3: Local IPM Test](#b3-local-ipm-test)
   - [B4: Publish to IPM Registry](#b4-publish-to-ipm-registry)
   - [B5: Post-Publish Verification](#b5-post-publish-verification)
4. [Quick Reference Card](#quick-reference-card)

---

## 1. Project Inventory

### Packages to Publish (npm)

| Package Name | Directory | Type | bin Entry | Tools |
|---|---|---|---|---|
| `@iris-mcp/shared` | `packages/shared` | Library (internal dep) | None | N/A |
| `@iris-mcp/dev` | `packages/iris-dev-mcp` | MCP Server | `iris-dev-mcp` | 21 |
| `@iris-mcp/admin` | `packages/iris-admin-mcp` | MCP Server | `iris-admin-mcp` | 22 |
| `@iris-mcp/interop` | `packages/iris-interop-mcp` | MCP Server | `iris-interop-mcp` | 19 |
| `@iris-mcp/ops` | `packages/iris-ops-mcp` | MCP Server | `iris-ops-mcp` | 16 |
| `@iris-mcp/data` | `packages/iris-data-mcp` | MCP Server | `iris-data-mcp` | 7 |
| `@iris-mcp/all` | `packages/iris-mcp-all` | Meta-package | None | N/A |

**Total: 7 packages** (6 publishable + 1 meta-package)

### Package to Publish (IPM)

| Module Name | Directory | Type |
|---|---|---|
| `iris-execute-mcp-v2` | `ipm/module.xml` + `src/ExecuteMCPv2/` | ObjectScript REST service (13 classes) |

### Repository Details

| Field | Value |
|---|---|
| GitHub URL | `https://github.com/jbrandtmse/iris-execute-mcp-v2` |
| GitHub User | `jbrandtmse` |
| License | MIT (root `LICENSE` file exists) |
| Package Manager | pnpm 9.15.0 |
| Node.js Minimum | 18.0.0 |
| Changesets Config | `.changeset/config.json` — `"fixed": [["@iris-mcp/*"]]`, `"access": "public"` |
| Monorepo Tool | Turborepo |

### Current State of bin/shebang

All 5 server packages already have:
- `"bin"` field in package.json pointing to `./dist/index.js`
- `#!/usr/bin/env node` shebang as first line of `src/index.ts` (compiled to `dist/index.js`)
- This means `npx -y @iris-mcp/dev` will work correctly after publishing

### Current State of Changesets

- `.changeset/config.json` exists and is configured
- `"fixed": [["@iris-mcp/*"]]` — all packages version together
- `"access": "public"` — scoped packages publish as public
- `"baseBranch": "main"` — versions are cut from main
- Root `package.json` has `"changeset": "changeset"` script

---

## Part A: npm Publishing

### A1: npm Account & Organization Setup

**Checklist:**

- [ ] **Create npm account** (if you don't have one)
  - Go to: https://www.npmjs.com/signup
  - Choose a username, provide email, set password
  - Verify email address

- [ ] **Enable Two-Factor Authentication (2FA)**
  - Go to: https://www.npmjs.com/settings/YOUR_USERNAME/tfa
  - Enable 2FA for **authorization and publishing** (recommended)
  - **Important (2025+ changes):** New accounts use WebAuthn/passkeys by default; TOTP (authenticator apps) is being phased out for new users but existing setups still work temporarily
  - Use an authenticator app (Google Authenticator, Authy, 1Password) or WebAuthn passkey
  - Save recovery codes securely
  - Source: https://docs.npmjs.com/requiring-2fa-for-package-publishing-and-settings-modification/

- [ ] **Understand npm Token Types (2025+ changes)**
  - As of late 2025, **classic tokens are being revoked** — only **granular access tokens** are supported
  - For interactive publishing: your npm login session + 2FA prompt is sufficient
  - For CI/CD automation: create a granular access token with:
    - **Read-write** access, scoped to `@iris-mcp` org packages
    - **Bypass 2FA** enabled (required for non-interactive CI publishes)
    - **Max lifetime: 90 days** for write tokens (must be rotated)
  - Generate at: https://www.npmjs.com/settings/YOUR_USERNAME/tokens > "Generate new granular token"
  - Limit: up to 1000 tokens per account
  - Source: https://docs.npmjs.com/about-access-tokens/, https://github.blog/changelog/2025-09-29-strengthening-npm-security-important-changes-to-authentication-and-token-management/

- [ ] **Create the @iris-mcp organization**
  - Go to: https://www.npmjs.com/org/create (or: profile picture > "Add an Organization")
  - Organization name: `iris-mcp` (this becomes the `@iris-mcp` scope)
  - Plan: **Free** (unlimited public packages)
  - This reserves the `@iris-mcp` scope on npm — you CANNOT publish to `@iris-mcp/*` without owning this org
  - **Check availability first:** Visit https://www.npmjs.com/org/iris-mcp — if taken, you'll need a different scope
  - After creation, you are automatically the **owner** of the org
  - Source: https://docs.npmjs.com/creating-an-organization/, https://docs.npmjs.com/about-organization-scopes-and-packages/

- [ ] **Login to npm CLI**
  ```bash
  npm login
  # Enter username, password, email, and 2FA code
  # Verify with:
  npm whoami
  ```

- [ ] **Verify org membership**
  ```bash
  npm org ls iris-mcp
  # Should show your username as owner
  ```

### A2: Package.json Publish-Readiness Audit

Every publishable package needs these fields. The agent should add them to all 7 packages.

**Fields to add to ALL packages** (`packages/*/package.json`):

```json
{
  "license": "MIT",
  "author": "jbrandtmse",
  "repository": {
    "type": "git",
    "url": "https://github.com/jbrandtmse/iris-execute-mcp-v2.git",
    "directory": "packages/PACKAGE_DIR_NAME"
  },
  "homepage": "https://github.com/jbrandtmse/iris-execute-mcp-v2#readme",
  "bugs": {
    "url": "https://github.com/jbrandtmse/iris-execute-mcp-v2/issues"
  },
  "keywords": ["intersystems", "iris", "mcp", "model-context-protocol", "objectscript"],
  "engines": {
    "node": ">=18.0.0"
  },
  "publishConfig": {
    "access": "public"
  }
}
```

**Per-package keyword additions:**

| Package | Additional Keywords |
|---|---|
| `@iris-mcp/dev` | `"development"`, `"atelier"`, `"sql"`, `"globals"` |
| `@iris-mcp/admin` | `"administration"`, `"security"`, `"namespace"`, `"database"` |
| `@iris-mcp/interop` | `"interoperability"`, `"ensemble"`, `"production"`, `"hl7"` |
| `@iris-mcp/ops` | `"operations"`, `"monitoring"`, `"metrics"`, `"tasks"` |
| `@iris-mcp/data` | `"analytics"`, `"docdb"`, `"deepsee"`, `"mdx"` |
| `@iris-mcp/shared` | `"sdk"`, `"http-client"` |
| `@iris-mcp/all` | `"suite"`, `"bundle"` |

**Package-specific `repository.directory` values:**

| Package | `repository.directory` |
|---|---|
| `@iris-mcp/shared` | `packages/shared` |
| `@iris-mcp/dev` | `packages/iris-dev-mcp` |
| `@iris-mcp/admin` | `packages/iris-admin-mcp` |
| `@iris-mcp/interop` | `packages/iris-interop-mcp` |
| `@iris-mcp/ops` | `packages/iris-ops-mcp` |
| `@iris-mcp/data` | `packages/iris-data-mcp` |
| `@iris-mcp/all` | `packages/iris-mcp-all` |

**Shared package test-helpers exports cleanup:**

The `@iris-mcp/shared` package has `exports` entries pointing to raw `.ts` source files for test helpers. These MUST NOT be published (they're not in the `"files": ["dist"]` list). This is fine — the test-helper exports are development-only and won't be in the published package. BUT verify that no published server package imports from `@iris-mcp/shared/test-helpers` in production code (only in test files which aren't published).

**Version number:**

All packages are currently at `0.0.0`. Before first publish, use Changesets to bump to `1.0.0`:
```bash
pnpm changeset
# Select all packages
# Choose "major" bump
# Description: "Initial public release — IRIS MCP v2 suite"
pnpm changeset version
# This updates all package.json versions to 1.0.0
pnpm install
# Updates lockfile
git add . && git commit -m "chore: version 1.0.0"
```

### A3: Bootstrap Drift Check

**CRITICAL — Do this every time before publishing.**

```bash
# Regenerate bootstrap from on-disk .cls files
npm run gen:bootstrap

# Check for drift
git diff packages/shared/src/bootstrap-classes.ts

# If there are changes, the bootstrap was stale!
# Stage and commit the regenerated file:
git add packages/shared/src/bootstrap-classes.ts
git commit -m "chore: regenerate bootstrap-classes.ts"
```

**Why this matters:** `bootstrap-classes.ts` contains the ObjectScript classes that get deployed to user IRIS instances. If stale, users get outdated code.

### A4: Build & Test Verification

```bash
# Clean build
pnpm turbo run build --force

# Run all tests
pnpm turbo run test

# Type check
pnpm turbo run type-check

# Lint
pnpm turbo run lint
```

**Expected results:**
- Build: 6/6 packages green (iris-mcp-all has no build step)
- Test: All server packages pass
- Type-check: Clean
- Lint: Clean

### A5: Dry-Run Publish

Before actually publishing, do a dry run to see what would be published.

**Step 1: Pack each package to inspect contents**

```bash
# From repo root — creates .tgz files without publishing
pnpm -r exec pnpm pack --pack-destination ../../dry-run

# Or inspect one package at a time:
cd packages/iris-dev-mcp
pnpm pack --dry-run
# Lists all files that would be included
```

**Step 2: Verify each .tgz contains only expected files**

Each server package should contain:
- `package.json`
- `dist/index.js` (+ source map if configured)
- `dist/**/*.js` (compiled TypeScript)
- `dist/**/*.d.ts` (type declarations)
- `README.md`
- NO `src/` directory
- NO `node_modules/`
- NO test files
- NO `.env` or credentials

The meta-package (`@iris-mcp/all`) should contain only:
- `package.json`
- `README.md`

**Step 3: Verify workspace:* resolution**

When pnpm publishes, `workspace:*` dependencies are automatically replaced with the actual version number. Verify this by inspecting the packed `package.json`:

```bash
cd packages/iris-dev-mcp
pnpm pack
tar -xzf iris-mcp-dev-1.0.0.tgz
cat package/package.json | grep shared
# Should show "@iris-mcp/shared": "1.0.0" (NOT "workspace:*")
rm -rf package iris-mcp-dev-1.0.0.tgz
```

### A6: First Publish

**Publish order matters!** Dependencies must publish before dependents.

```bash
# Option 1: Let pnpm handle ordering (recommended)
pnpm publish -r --access public

# Option 2: Manual order (if Option 1 has issues)
# 1. shared first (dependency of all servers)
cd packages/shared && pnpm publish --access public && cd ../..

# 2. All 5 server packages (depend on shared, independent of each other)
cd packages/iris-dev-mcp && pnpm publish --access public && cd ../..
cd packages/iris-admin-mcp && pnpm publish --access public && cd ../..
cd packages/iris-interop-mcp && pnpm publish --access public && cd ../..
cd packages/iris-ops-mcp && pnpm publish --access public && cd ../..
cd packages/iris-data-mcp && pnpm publish --access public && cd ../..

# 3. Meta-package last (depends on all servers)
cd packages/iris-mcp-all && pnpm publish --access public && cd ../..
```

**During publish, npm will prompt for 2FA code.** Enter it from your authenticator app.

**If a publish fails midway:** Re-running `pnpm publish -r` will skip already-published versions (npm rejects duplicate version+name).

### A7: Post-Publish Verification

**Step 1: Verify packages exist on npm**

```bash
npm view @iris-mcp/shared
npm view @iris-mcp/dev
npm view @iris-mcp/admin
npm view @iris-mcp/interop
npm view @iris-mcp/ops
npm view @iris-mcp/data
npm view @iris-mcp/all
```

**Step 2: Test npx installation (the real user experience)**

```bash
# Test that npx can download and run each server
# (Will fail to connect to IRIS but should start without errors)
npx -y @iris-mcp/dev --help 2>&1 || echo "Server started (expected — no IRIS to connect to)"

# Full test with IRIS connection:
IRIS_HOST=localhost IRIS_PORT=52773 IRIS_USERNAME=_SYSTEM IRIS_PASSWORD=SYS npx -y @iris-mcp/dev
# Should connect, bootstrap classes, and wait for MCP protocol input
# Ctrl+C to stop
```

**Step 3: Test in an MCP client**

Create a test `.mcp.json` in a fresh directory:
```json
{
  "mcpServers": {
    "iris-dev-mcp": {
      "command": "npx",
      "args": ["-y", "@iris-mcp/dev"],
      "env": {
        "IRIS_HOST": "localhost",
        "IRIS_PORT": "52773",
        "IRIS_USERNAME": "_SYSTEM",
        "IRIS_PASSWORD": "SYS",
        "IRIS_NAMESPACE": "HSCUSTOM",
        "IRIS_HTTPS": "false"
      }
    }
  }
}
```

Verify:
- [ ] Server starts without errors
- [ ] Bootstrap deploys classes to IRIS (check `ExecuteMCPv2.REST.Dispatch` exists)
- [ ] `tools/list` returns 21 tools
- [ ] A sample tool call works (e.g., `iris.server.info`)

**Step 4: Git tag the release**

```bash
git tag v1.0.0
git push origin v1.0.0
```

### A8: Subsequent Releases (Changesets Workflow)

For future releases after the initial publish:

```bash
# 1. Make code changes and commit them

# 2. Create a changeset describing the changes
pnpm changeset
# Select affected packages, bump type (patch/minor/major), description

# 3. Commit the changeset file
git add .changeset/ && git commit -m "chore: add changeset"

# 4. When ready to release, apply version bumps
pnpm changeset version
# Updates package.json versions, generates CHANGELOG.md entries

# 5. Update lockfile
pnpm install

# 6. Commit version bump
git add . && git commit -m "chore: release v1.0.1"

# 7. Build and test
pnpm turbo run build test

# 8. CRITICAL: Bootstrap drift check
npm run gen:bootstrap
git diff packages/shared/src/bootstrap-classes.ts

# 9. Publish
pnpm publish -r --access public

# 10. Tag
git tag v1.0.1
git push && git push --tags
```

**Note on fixed versioning:** The `.changeset/config.json` has `"fixed": [["@iris-mcp/*"]]`. This means ALL packages bump together — if you patch `@iris-mcp/dev`, all packages get the same version bump. This is intentional for suite consistency.

### A8.1: Common Pitfalls and Troubleshooting

**Pitfall 1: `workspace:*` not resolved in published package**
- Symptom: Published package.json contains `"@iris-mcp/shared": "workspace:*"` (invalid on npm)
- Cause: Used `changeset publish` directly instead of `pnpm publish -r`
- Fix: **Always use `pnpm publish -r`** — pnpm's recursive publish resolves `workspace:*` to actual versions via topological sorting. The Changesets `publish` command alone may not resolve workspace protocol ranges.
- Source: https://github.com/changesets/changesets/issues/432, https://pnpm.io/workspaces

**Pitfall 2: Scoped package publishes as private**
- Symptom: `npm ERR! 402 Payment Required` or package not visible
- Cause: Scoped packages (`@org/name`) default to **private** on npm
- Fix: Use `--access public` flag OR ensure `publishConfig.access: "public"` in every package.json
- Our setup: `.changeset/config.json` has `"access": "public"` and each package should have `publishConfig`

**Pitfall 3: Missing `bin` shebang on Windows**
- Symptom: `npx @iris-mcp/dev` fails with "not recognized" error
- Cause: Missing `#!/usr/bin/env node` shebang in entry file
- Our status: All 5 server packages already have the shebang. npm creates `.cmd` wrappers on Windows automatically.
- Source: https://docs.npmjs.com/cli/v10/configuring-npm/package-json

**Pitfall 4: `files` field excludes needed files**
- Symptom: Published package missing README, dist files, etc.
- Cause: `"files": ["dist"]` only includes `dist/` directory. `package.json` and `README.md` are always included automatically by npm.
- Our status: Correct — `"files": ["dist"]` is set, and npm auto-includes `package.json`, `README.md`, `LICENSE` (from root)

**Pitfall 5: 2FA token expired during publish**
- Symptom: Partial publish — some packages published, others failed with 401
- Fix: Re-run `pnpm publish -r --access public` — npm skips already-published version+name combos. Enter fresh 2FA code.

**Pitfall 6: Test-helper exports in shared package**
- Symptom: Published `@iris-mcp/shared` missing test-helper modules
- Cause: `"files": ["dist"]` excludes `src/` files, but exports map points to `.ts` source
- Our status: This is correct behavior — test helpers are dev-only. Verify no server package's production code imports from `@iris-mcp/shared/test-helpers`.
- Verification command:
  ```bash
  # Should return NO results (only test files should import test-helpers)
  grep -r "test-helpers" packages/iris-*/src/ --include="*.ts" -l | grep -v __tests__ | grep -v test
  ```

### A9: Optional — GitHub Actions CI/CD

For automated publishing on merge to main:

**File: `.github/workflows/release.yml`**

```yaml
name: Release
on:
  push:
    branches: [main]

concurrency: ${{ github.workflow }}-${{ github.ref }}

jobs:
  release:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with:
          version: 9
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: 'pnpm'
          registry-url: 'https://registry.npmjs.org'
      - run: pnpm install --frozen-lockfile
      - run: pnpm turbo run build test type-check
      - name: Bootstrap drift check
        run: |
          npm run gen:bootstrap
          git diff --exit-code packages/shared/src/bootstrap-classes.ts || \
            (echo "ERROR: bootstrap-classes.ts is stale! Run npm run gen:bootstrap locally." && exit 1)
      - name: Create Release Pull Request or Publish
        uses: changesets/action@v1
        with:
          publish: pnpm publish -r --access public
          title: 'chore: version packages'
          commit: 'chore: version packages'
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          NPM_TOKEN: ${{ secrets.NPM_TOKEN }}
```

**Setup required:**
- [ ] Add `NPM_TOKEN` to GitHub repo secrets (Settings > Secrets > Actions)
  - Generate at: https://www.npmjs.com/settings/YOUR_USERNAME/tokens
  - Type: Automation (bypasses 2FA for CI)
- [ ] Ensure `GITHUB_TOKEN` has write permissions for PRs

---

## Part B: IPM Publishing

### B1: IPM Registry Account

- [ ] **Ensure IPM client is installed on your IRIS instance**
  ```objectscript
  ; Check if IPM is installed
  zpm "version"
  
  ; If not installed, install IPM:
  ; Download from https://openexchange.intersystems.com/package/InterSystems-Package-Manager-1
  ; Or use the one-liner installer:
  Set sc = ##class(%Net.URLParser).Parse("https://pm.community.intersystems.com/packages/zpm/latest/installer", .Components)
  Set hs = ##class(%Net.HttpRequest).%New()
  Set hs.Server = Components("host")
  Set hs.SSLConfiguration = "ISC.FeatureTracker.":Components("host")
  Do hs.Get(Components("path"))
  Do $system.OBJ.LoadStream(hs.HttpResponse.Data, "c")
  ```

- [ ] **Verify community registry is configured**
  ```objectscript
  zpm "repo -list"
  ; Should show: registry https://pm.community.intersystems.com/
  
  ; If not configured:
  zpm "repo -n registry -r -url https://pm.community.intersystems.com/"
  ```

- [ ] **Create an InterSystems community account** (if you don't have one)
  - Go to: https://community.intersystems.com/
  - Sign up / log in
  - This account is used for Open Exchange submissions

- [ ] **Register on Open Exchange** (for public packages)
  - Go to: https://openexchange.intersystems.com/
  - Log in with your community account
  - You'll submit the package here after IPM publish

### B2: module.xml Audit

**Current file: `ipm/module.xml`**

The existing module.xml looks correct. Verify these items:

- [ ] **Module name matches**: `iris-execute-mcp-v2`
- [ ] **Version**: Update from `0.1.0` to `1.0.0` to match npm release
- [ ] **SourcesRoot**: `src` — this tells IPM where to find classes relative to the module.xml
- [ ] **All 13 production classes listed** (NOT including Tests/ in production):

  | Class | In module.xml? |
  |---|---|
  | ExecuteMCPv2.Utils.CLS | Yes |
  | ExecuteMCPv2.Setup.CLS | Yes |
  | ExecuteMCPv2.REST.Dispatch.CLS | Yes |
  | ExecuteMCPv2.REST.Command.CLS | Yes |
  | ExecuteMCPv2.REST.Global.CLS | Yes |
  | ExecuteMCPv2.REST.UnitTest.CLS | Yes |
  | ExecuteMCPv2.REST.Config.CLS | Yes |
  | ExecuteMCPv2.REST.Security.CLS | Yes |
  | ExecuteMCPv2.REST.Interop.CLS | Yes |
  | ExecuteMCPv2.REST.Monitor.CLS | Yes |
  | ExecuteMCPv2.REST.Task.CLS | Yes |
  | ExecuteMCPv2.REST.SystemConfig.CLS | Yes |
  | ExecuteMCPv2.REST.Analytics.CLS | Yes |

- [ ] **Test classes listed** (5 test classes included for optional test installation)
- [ ] **Invoke lines present** for post-install setup:
  - `<Invoke Class="ExecuteMCPv2.Setup" Method="Configure"/>` — creates `/executemcpv2` web app
  - `<Invoke Class="ExecuteMCPv2.Setup" Method="ConfigureMapping"/>` — maps package to %ALL

**Potential module.xml improvements for publish:**

The current module.xml uses `<Invoke>` elements to call Setup.Configure() and Setup.ConfigureMapping() after install. An alternative IPM approach is to use the `<CSPApplication>` element to declaratively create web apps. However, our Setup.cls does more than just create the web app (it also configures namespace mappings), so the `<Invoke>` approach is correct for our case.

Source on Invoke elements: https://community.intersystems.com/post/using-invoke-element-call-class-methods-objectscript-packages
Source on CSPApplication: https://community.intersystems.com/post/describing-module-xml-objectscript-package-manager

**Recommended updated module.xml:**

```xml
<?xml version="1.0" encoding="UTF-8"?>
<Export generator="IRIS" version="26">
  <Document name="iris-execute-mcp-v2.ZPM">
    <Module>
      <Name>iris-execute-mcp-v2</Name>
      <Version>1.0.0</Version>
      <Description>Custom REST service providing 85 MCP tool endpoints for InterSystems IRIS — global operations, ObjectScript execution, SQL, security, interoperability, monitoring, analytics, and more.</Description>
      <Packaging>module</Packaging>
      <SourcesRoot>src</SourcesRoot>
      <Keywords>mcp,rest,objectscript,development,administration,interoperability,monitoring,analytics</Keywords>

      <!-- Core classes (13) — loaded and compiled in dependency order -->
      <Resource Name="ExecuteMCPv2.Utils.CLS"/>
      <Resource Name="ExecuteMCPv2.Setup.CLS"/>
      <Resource Name="ExecuteMCPv2.REST.Dispatch.CLS"/>
      <Resource Name="ExecuteMCPv2.REST.Command.CLS"/>
      <Resource Name="ExecuteMCPv2.REST.Global.CLS"/>
      <Resource Name="ExecuteMCPv2.REST.UnitTest.CLS"/>
      <Resource Name="ExecuteMCPv2.REST.Config.CLS"/>
      <Resource Name="ExecuteMCPv2.REST.Security.CLS"/>
      <Resource Name="ExecuteMCPv2.REST.Interop.CLS"/>
      <Resource Name="ExecuteMCPv2.REST.Monitor.CLS"/>
      <Resource Name="ExecuteMCPv2.REST.Task.CLS"/>
      <Resource Name="ExecuteMCPv2.REST.SystemConfig.CLS"/>
      <Resource Name="ExecuteMCPv2.REST.Analytics.CLS"/>

      <!-- Test classes (5) — loaded for optional test execution -->
      <Resource Name="ExecuteMCPv2.Tests.UtilsTest.CLS"/>
      <Resource Name="ExecuteMCPv2.Tests.GlobalTest.CLS"/>
      <Resource Name="ExecuteMCPv2.Tests.CommandTest.CLS"/>
      <Resource Name="ExecuteMCPv2.Tests.UnitTestTest.CLS"/>
      <Resource Name="ExecuteMCPv2.Tests.SetupTest.CLS"/>

      <!-- Post-install: create /executemcpv2 web application and %ALL namespace mappings -->
      <!-- Setup.Configure() creates the CSP/REST web app with DispatchClass=ExecuteMCPv2.REST.Dispatch -->
      <!-- Setup.ConfigureMapping() maps the ExecuteMCPv2 package to %ALL so it's available in all namespaces -->
      <Invoke Class="ExecuteMCPv2.Setup" Method="Configure"/>
      <Invoke Class="ExecuteMCPv2.Setup" Method="ConfigureMapping"/>
    </Module>
  </Document>
</Export>
```

**Important notes about SourcesRoot:**
- `<SourcesRoot>src</SourcesRoot>` means IPM looks for classes relative to the module.xml location
- The module.xml is in `ipm/`, and SourcesRoot is `src`, so IPM looks in `ipm/src/` — but our classes are in `src/ExecuteMCPv2/` at the repo root
- **This needs verification during local testing (B3)** — if the path is wrong, classes won't be found
- You may need to change SourcesRoot to `../src` or move module.xml to the repo root
- Source: https://community.intersystems.com/post/simplified-objectscript-source-folder-structure-package-manager

### B3: Local IPM Test

**Test the package locally before publishing to the registry.**

```objectscript
; Open IRIS terminal in the target namespace (e.g., HSCUSTOM)

; Load from the repo's ipm directory
zpm "load C:\git\iris-execute-mcp-v2\ipm"

; This should:
; 1. Import all 13 classes + 5 test classes
; 2. Compile them
; 3. Run Setup.Configure() to create /executemcpv2 web app
; 4. Run Setup.ConfigureMapping() to map to %ALL

; Verify installation
zpm "list installed"
; Should show: iris-execute-mcp-v2  1.0.0

; Verify the web application exists
; (Use MCP tool or IRIS Management Portal)
Do ##class(Security.Applications).Exists("/executemcpv2", .exists)
Write exists
; Should output: 1

; Verify classes compiled
Do $system.OBJ.IsValidClassname("ExecuteMCPv2.REST.Dispatch")
; Should return 1

; Test a REST endpoint via curl
; curl http://localhost:52773/executemcpv2/command -X POST -u _SYSTEM:SYS -H "Content-Type: application/json" -d '{"command":"WRITE $ZV"}'
```

**If local load fails:**
- Check that `SourcesRoot` in module.xml points to the correct directory relative to where module.xml is located
- Verify class names in `<Resource>` tags match the actual `.cls` filenames
- Check IRIS terminal for compilation errors

### B4: Publish to IPM Registry

There are **two paths** to getting a package on the community IPM registry. Open Exchange is the recommended path for public packages.

**Path 1: Open Exchange (Recommended for public packages)**

Open Exchange (https://openexchange.intersystems.com/) is the **only way to publish to the public IPM registry** (pm.community.intersystems.com). The workflow is:

1. Your code is on a **public GitHub repository** with `module.xml` in the repo
2. You register the application on Open Exchange
3. Open Exchange picks it up and makes it available via `zpm "install ..."`

Source: https://docs.openexchange.intersystems.com/apps/ipm/

Steps:
- [ ] Go to https://openexchange.intersystems.com/
- [ ] Log in with your InterSystems community account
- [ ] Click **"Add Application"** (or "Submit" depending on UI version)
- [ ] Fill in:
  - **Name:** IRIS Execute MCP v2
  - **Repository URL:** `https://github.com/jbrandtmse/iris-execute-mcp-v2`
  - **Description:** Custom REST service providing 85 MCP tool endpoints for InterSystems IRIS
  - **Technology:** InterSystems IRIS
  - **Category:** Development, Tool
  - **Check the "Publish in Package Manager" checkbox** — this is what makes it available via `zpm "install"`
- [ ] Add keywords, screenshots (of the README or tools/list output), documentation links
- [ ] Submit for review
- [ ] The Open Exchange team reviews and approves (may take a few days)
- [ ] Once approved, users can install via: `zpm "install iris-execute-mcp-v2"`

**Path 2: Test Registry (for pre-release testing)**

Before submitting to Open Exchange, test with the IPM test registry:

```objectscript
; Configure test registry
zpm "repo -n test -r -url https://test.pm.community.intersystems.com/registry/"

; Publish to test registry
zpm "publish iris-execute-mcp-v2 -r test"

; Verify on test registry
zpm "search iris-execute-mcp-v2 -r test"

; Install from test registry to verify
zpm "install iris-execute-mcp-v2 -r test"
```

Source: https://community.intersystems.com/post/automatic-generation-module-xml-zpm

**Path 3: Direct Registry Publish (may require special access)**

```objectscript
; Open IRIS terminal

; Verify registry configuration
zpm "repo -list"

; Publish the module (may require credentials)
zpm "publish iris-execute-mcp-v2"

; This uploads directly to pm.community.intersystems.com
```

**If publish fails with "unauthorized":** Direct publishing to the community registry may require special credentials. Use the Open Exchange path instead (Path 1).

### B5: Post-Publish Verification

```objectscript
; Search for the package
zpm "search iris-execute-mcp-v2"

; Test installation from registry (in a clean namespace)
zpm "install iris-execute-mcp-v2"
```

**Open Exchange verification:**
- [ ] Package appears at https://openexchange.intersystems.com/ after approval
- [ ] Package appears in IPM search: `zpm "search iris-execute-mcp-v2"`
- [ ] Fresh install works: `zpm "install iris-execute-mcp-v2"` in a clean namespace
- [ ] Web application `/executemcpv2` exists after install
- [ ] All 13 classes compiled successfully
- [ ] Namespace mapping to %ALL working (classes visible in other namespaces)

### B6: IPM Common Pitfalls

**Pitfall 1: SourcesRoot path mismatch**
- Symptom: `zpm "load"` finds module.xml but can't find classes
- Cause: `<SourcesRoot>src</SourcesRoot>` is relative to module.xml location, not repo root
- Our case: module.xml is in `ipm/`, classes are in `src/ExecuteMCPv2/`
- Fix: Verify the path resolves correctly. May need `<SourcesRoot>../src</SourcesRoot>` or move module.xml to repo root

**Pitfall 2: Version tag mismatch**
- Symptom: IPM shows old version or refuses to update
- Cause: module.xml `<Version>` doesn't match what's expected
- Fix: Follow semantic versioning. Keep IPM version in sync with npm version (both 1.0.0)

**Pitfall 3: Invoke methods fail during install**
- Symptom: Package installs but `/executemcpv2` web app not created
- Cause: Setup.Configure() requires %SYS namespace access; installer may not have permission
- Fix: Ensure the IRIS user running IPM install has `%Admin_Secure:Use` and `%Admin_Manage:Use` roles
- Our Setup.cls handles namespace switching internally but needs sufficient privileges

**Pitfall 4: Package not appearing after Open Exchange submission**
- Symptom: Submitted to Open Exchange but `zpm "search"` returns nothing
- Cause: Open Exchange review queue — packages are reviewed before community availability
- Fix: Wait for approval (can take a few days). Check the Open Exchange page for status.
- Source: https://community.intersystems.com/post/open-exchange-and-zpm-package-manager-united

**Pitfall 5: Classes in wrong namespace after install**
- Symptom: Classes installed in USER namespace but needed in HSCUSTOM
- Cause: IPM installs to the current namespace by default
- Fix: Switch to target namespace before running `zpm "install"`: `Set $NAMESPACE = "HSCUSTOM"`
- Our Setup.ConfigureMapping() maps to %ALL, so classes should be visible everywhere after install

---

## Quick Reference Card

### Pre-Publish Checklist (Every Release)

```
[ ] npm run gen:bootstrap && git diff  (bootstrap drift check)
[ ] pnpm turbo run build --force       (clean build)
[ ] pnpm turbo run test                (all tests pass)
[ ] pnpm turbo run type-check          (no type errors)
[ ] pnpm changeset version             (version bumps applied)
[ ] pnpm install                       (lockfile updated)
[ ] git add . && git commit            (everything committed)
```

### Publish Commands

```bash
# npm (all packages, dependency order)
pnpm publish -r --access public

# IPM (from IRIS terminal)
zpm "publish iris-execute-mcp-v2"
```

### Verify Commands

```bash
# npm
npm view @iris-mcp/dev
npx -y @iris-mcp/dev --help

# IPM (from IRIS terminal)
zpm "search iris-execute-mcp-v2"
zpm "install iris-execute-mcp-v2"
```

### Key URLs

| Resource | URL |
|---|---|
| npm signup | https://www.npmjs.com/signup |
| npm org create | https://www.npmjs.com/org/create |
| npm tokens | https://www.npmjs.com/settings/YOUR_USERNAME/tokens |
| IPM registry | https://pm.community.intersystems.com/ |
| Open Exchange | https://openexchange.intersystems.com/ |
| InterSystems Community | https://community.intersystems.com/ |
| GitHub repo | https://github.com/jbrandtmse/iris-execute-mcp-v2 |

### Dependency Order (npm publish)

```
1. @iris-mcp/shared       (no deps)
2. @iris-mcp/dev          (depends on shared)
   @iris-mcp/admin        (depends on shared)
   @iris-mcp/interop      (depends on shared)
   @iris-mcp/ops          (depends on shared)
   @iris-mcp/data         (depends on shared)
3. @iris-mcp/all          (depends on all 5 servers)
```

`pnpm publish -r` handles this ordering automatically.

---

## Sources and References

### npm Publishing
- npm Scoped Packages: https://docs.npmjs.com/creating-and-publishing-scoped-public-packages/
- npm Organizations: https://docs.npmjs.com/creating-an-organization/
- npm Org Scopes: https://docs.npmjs.com/about-organization-scopes-and-packages/
- npm package.json bin field: https://docs.npmjs.com/cli/v10/configuring-npm/package-json
- npm 2FA Requirements: https://docs.npmjs.com/requiring-2fa-for-package-publishing-and-settings-modification/
- npm Access Tokens: https://docs.npmjs.com/about-access-tokens/
- npm 2025 Token Changes: https://github.blog/changelog/2025-09-29-strengthening-npm-security-important-changes-to-authentication-and-token-management/
- pnpm Workspaces: https://pnpm.io/workspaces
- pnpm + Changesets: https://pnpm.io/using-changesets
- pnpm publish CLI: https://pnpm.io/cli/publish
- Changesets workspace:* issue: https://github.com/changesets/changesets/issues/432
- Complete Monorepo Guide 2025: https://peerlist.io/saxenashikhil/articles/complete-monorepo-guide--pnpm--workspaces--changesets-2025
- npx bin/shebang guide: https://www.sandromaglione.com/articles/build-and-publish-an-npx-command-to-npm-with-typescript

### IPM Publishing
- IPM Official Docs: https://docs.intersystems.com/irislatest/csp/docbook/DocBook.UI.Page.cls?KEY=AIPM
- Open Exchange IPM docs: https://docs.openexchange.intersystems.com/apps/ipm/
- module.xml Anatomy: https://community.intersystems.com/post/anatomy-zpm-module-packaging-your-intersystems-solution
- module.xml Description: https://community.intersystems.com/post/describing-module-xml-objectscript-package-manager
- Invoke Element Usage: https://community.intersystems.com/post/using-invoke-element-call-class-methods-objectscript-packages
- Simplified Source Folders: https://community.intersystems.com/post/simplified-objectscript-source-folder-structure-package-manager
- Open Exchange + ZPM United: https://community.intersystems.com/post/open-exchange-and-zpm-package-manager-united
- IPM Package Manager: https://openexchange.intersystems.com/package/InterSystems-Package-Manager-1
