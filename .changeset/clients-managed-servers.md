---
"@iris-mcp/client-config": patch
---

Remove `iris-mcp-all` from the managed server set and drop the "Other clients considered" UI section (Project Lead decisions 2026-07-28, epics.md ACs 33.3.1/33.3.2 amended).

`iris-mcp-all` is a real aggregate stdio server, but as a peer row in the status matrix / apply pickers it invited applying all 5 servers AND the aggregate, double-registering every tool in a client. `CANONICAL_SERVERS` is now the 5 leaf servers; entries named `iris-mcp-all` are surfaced read-only (foreign) and never modified — users hand-write the aggregate. `PKG_BY_SERVER` drops its `@iris-mcp/all` row and `certify.mjs` probes default to `iris-dev-mcp` (the 2026-07-28 certification evidence used the aggregate, valid at capture time; re-runs use a leaf server). The extension "MCP Clients" view no longer renders the Pi / roadmap disposition rows — supported and dispositioned clients are documented in this README's adapter table. The CLI's `detect` envelope keeps `dispositions` (a read surface; unchanged).
