# Security Policy

This policy covers the IRIS MCP Server Suite: the npm packages, the IRIS-side classes, the VS Code extension and the IPM package.

## Supported versions

The latest `1.x` release receives security fixes. An older release is fixed by upgrading to the latest `1.x`: within a major, the
packages, the REST routes and the tool surface only grow, so an upgrade needs no change on your side.

## Reporting a vulnerability

Report a vulnerability through GitHub private vulnerability reporting: open the repository's **Security** tab and choose **Report a
vulnerability**. The report stays private between you and the maintainer until an advisory is published. No email address is published
for security reports, so please do not look for one, and please do not open a public issue or pull request for a vulnerability.

A report is most useful with the package and version, what you did, what you expected and what happened, and, if you can, a minimal
way to reproduce it. Do not include real credentials, message bodies or other protected data; use synthetic values.

## Scope

In scope:

- the npm packages `@iris-mcp/*` (the five MCP servers, `@iris-mcp/shared`, `@iris-mcp/client-config` and `@iris-mcp/all`);
- the IRIS-side classes and REST service of the `ExecuteMCPv2` package (`/api/executemcp/v2`), however they were installed;
- the VS Code extension (IRIS MCP Launcher);
- the IPM package `iris-execute-mcp-v2`.

The authorization model is IRIS's own: the servers act as the IRIS user they connect with, and what that user may do is decided by
IRIS.

The servers' safety settings (governance and the presets, the confirmation dialogs, the audit log, the data policy, the SQL safety
settings and the document write guards) guard the agent that uses the servers, not the IRIS account. Anyone who holds the account can call IRIS directly, and none of those settings applies to
that call. [What the safety settings protect](README.md#what-the-safety-settings-protect) says what each one covers and which account
to connect with.

Also in scope: a way to get past one of those controls through the servers' own tools, for example a tool call that runs an action
governance turned off, or that returns data the data policy should withhold.

Out of scope:

- using the IRIS account directly (the REST service, the Atelier API or a terminal), which IRIS privileges govern;
- a finding that depends on giving the account more privileges than it needs;
- a residual that [What the safety settings protect](README.md#what-the-safety-settings-protect) already documents.

## How a vulnerability is handled

1. **Fix forward.** The fix is a new patch release of the latest `1.x`, published through the same release workflow as every other
   release (a tagged, CI-green commit, approved in the protected `release` environment, with npm provenance).
2. **Advisory.** Once the fix is released, a GitHub security advisory describes the vulnerability, the affected versions and the fixed
   version, and credits the reporter if they wish.
3. **Deprecation.** Each affected npm version is marked with `npm deprecate`, with a message that names the fixed version. A release is
   never removed with `npm unpublish`: that would break installs that depend on it.

For the extension and the IPM package there is no rollback either: the fix is published as a new version.
