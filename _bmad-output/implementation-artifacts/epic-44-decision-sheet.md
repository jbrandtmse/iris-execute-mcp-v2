# Epic 44 close: decision sheet

Prepared 2026-11-23 by the orchestrator at the Epic 44 merge gate, after all seven stories closed with CI green (tip run 45262470194). These are the only items the epic still needs from the owner, apart from the release approval. The recommendations are the orchestrator's; the owner decides. The answers are recorded as `by=merge_gate` trailers in the ledger, and human-owned items become `action_items`.

## Ledger entries (decision-pending)

| Entry | What it is | Recommendation | Alternatives |
|---|---|---|---|
| DW-752 (med) | Under the **Local** harness, the launcher resolver takes the host from the merged `intersystems.servers` view (user + workspace layers) and the password from Server Manager's session for that server name. A workspace `settings.json` that overrides a user server's host could therefore receive that server's password. This dates from Story 31.x, is shared by every Server Manager consumer, and is unverified against Server Manager 3.x auth-provider keying. | **Fix in the next planned epic** with the same user-scope-only rule that DW-749 added for the Copilot path (`isUserScopedServer`). Under that rule, the Local resolver only fills in a password when the server is defined in user (or default) settings alone. The guard already exists, so the fix is small. | (b) Accept until VS Code removes the Local harness (February 2027), since the path disappears with it, and document the risk in the launcher README. (c) Fix now in a hotfix story before the release (this delays the release). |
| DW-719 (low) | The VS Code extension is on neither store, because the Marketplace publisher `iris-mcp` needs a verified domain (owner steps O1, O2, O4). | Keep it as an owner item. Ship the vsix attached to the GitHub Release by hand, as for v1.1.0. | Register the publisher now and enable the channel in a later release. |
| DW-720 (low) | The release does not attach the vsix to the GitHub Release automatically; the maintainer does it by hand. | Keep it as an owner/Planner item for this release (manual attach, sha256 checked against `manifest.json`). | Charter a release-workflow story to add a `github-release` channel. |
| DW-722 (low) | List the iris-mcp Claude Code plugin in Anthropic's plugin directory (an owner submission; needs an icon, a LICENSE in the plugin root, and a README). | Keep it as an owner item. | Charter a small story for the plugin-root LICENSE, README and icon so that the submission is ready. |

## Action items that close at this epic's retrospective (owner confirmation)

Epic 42's retrospective chartered these as Epic 44's original fixes. They were delivered as follows:

- `epic-42-retro-item-4` (scope digest bound into a confirmation): delivered by Story 44.3.
- `epic-42-retro-item-6` (armed suites cannot pass without testing): delivered by Story 44.5.
- `epic-42-retro-item-7` (bootstrap compile result accuracy): delivered by Story 44.4.
- `epic-42-retro-item-8` (DocDB create registers the database): delivered by Story 44.1.
- `epic-42-retro-item-11` (VS Code Copilot targets before February 2027): delivered by Stories 44.2 and 44.6. Live Copilot verification was not run, by owner decision #149.

Recommendation: mark all five `done`, citing those stories.

## Retrospective

Should a retrospective of Epic 44 run? It runs interactively with the owner. Without one, the five action items above close on the owner's confirmation in this sheet.

## Release (owner approval; not decided here)

The epic's one release covers: `@iris-mcp/client-config` (44.2), `@iris-mcp/shared` (44.4, 44.6, 44.7), `@iris-mcp/dev`, `@iris-mcp/data`, `@iris-mcp/admin` (44.1, 44.7), and the launcher vsix (44.6, attached by hand).

`BOOTSTRAP_VERSION` moves from `1.1.0+3.3e97060f5bc4` to `1.1.0+5.6cbac260e73f`. The release's version step regenerates the IPM tree. The CHANGELOGs say that the Copilot paths are verified against VS Code source only.
