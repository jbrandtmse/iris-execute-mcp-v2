# iris-execute-mcp-v2

## Local IRIS system-class source (`irislib/`, `irissys/`)

These folders hold read-only copies of IRIS system source. Use them to check that a system class, method, query or macro exists, and what it takes, without calling the server (rule #16 in `.claude/rules/project-rules.md`).

| Folder | Contents | Exported from |
|---|---|---|
| `irislib/` | All of HSCUSTOM, including the `%` system classes: `%Library`, `%CSP`, `%Dictionary`, `HS.*`, `Ens.*`, `EnsLib.*`, and the `%occ*`/`%sy*` `.inc` macro files | HSCUSTOM, `system:"true"` |
| `irissys/` | The non-`%` parts of %SYS: `Security.*`, `Config.*`, `SYS.*`, `OAuth2.*`, `Backup.*`, and the system routines (`.int`/`.inc`/`.mac`) | %SYS, `system:"false"` |

- **Layout:** dots in a name become directories, e.g. `irislib/%Library/Device.cls` and `irissys/Security/Roles.cls`.
- **Version:** IRIS 2026.2 Build 221U, exported 2026-10-16. The manifests are `irislib/manifest.json`, `irissys/manifest-cls.json` and `irissys/manifest-rtn.json`.
- **Search them by path.** Git ignores both folders, so a repo-wide Grep/rg skips them. Pass `irislib/` or `irissys/` as the search path.
- **Read-only.** Never edit them, and never `iris_doc_load` from them.
- **`ExecuteMCPv2.*` is not in them.** This project's classes live in `src/`.
- **The live instance wins.** If a file here disagrees with `iris_doc_get` (for example after an IRIS upgrade), trust the live instance and refresh the snapshot.
- **Not included:** the `%` classes in %SYS (the same files already in `irislib/`), the %SYS CSP web assets, and 5 `Ens*.mac` routines that IRIS lists but has no source for.

### Refreshing after an IRIS upgrade

1. Delete `irislib/` and `irissys/`, so classes removed by the upgrade don't linger.
2. `iris_doc_export` with namespace `HSCUSTOM`, `system:"true"`, `destinationDir` = absolute path to `irislib/`.
3. `iris_doc_export` with namespace `%SYS`, `system:"false"`, `category:"CLS"`, `destinationDir` = absolute path to `irissys/`. Rename `irissys/manifest.json` to `manifest-cls.json`.
4. Repeat step 3 with `category:"RTN"`, and rename the manifest to `manifest-rtn.json`.
5. Delete `irislib/ExecuteMCPv2/` and `irissys/ExecuteMCPv2/`.
6. Update the version and date in this file and in rule #16 of `.claude/rules/project-rules.md`.
