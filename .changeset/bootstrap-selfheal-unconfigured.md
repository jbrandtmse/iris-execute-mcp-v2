---
"@iris-mcp/shared": patch
---

fix(bootstrap): self-heal when classes are current but the web app is missing

The auto-bootstrap now verifies the actual `/api/executemcp/v2` web-application registration (via `ExecuteMCPv2.Setup_IsConfigured()`), not just the deployed class version. Previously, an instance with current classes but no registered web app — e.g. after a container migration or `%SYS` restore/reset where the code database persisted, or a first install whose privileged `Configure` step failed — was treated as fully installed and never repaired, so every custom-dispatch tool (across all five servers) returned HTTP 404 indefinitely with no self-healing.

Bootstrap now detects this `unconfigured` state and self-heals: it re-registers the web application and package mapping, and **recompiles** the classes. The recompile is required because a code database migrated across IRIS versions keeps the source (so the version hash matches) while carrying stale or version-incompatible compiled objects, which otherwise dispatch as `<NULL VALUE>` HTTP 500 errors. The version-mismatch (`stale`) upgrade path now also verifies registration and self-heals if the web app is absent, so a divergent instance recovers in a single restart. When the connecting user lacks `%Admin_Manage`, the result reports `configured: false` with manual instructions and a later privileged launch self-heals.
