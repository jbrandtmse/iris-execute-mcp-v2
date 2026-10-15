# Digest ours-r1-1 — IRIS MCP Server Suite inventory (granted named document: our source @ fb676dc)

Accessed: 2026-10-14 | Evidence: `packages/**` TS source + `src/ExecuteMCPv2/REST/Dispatch.cls` route map only (read-only, no builds/runs).

## Counts (mechanical, with commands)

| Server | Tools in package array | Tool+action rows (governance keys) | + framework tool | Advertised tools (preset `full`) |
|---|---|---|---|---|
| iris-dev-mcp | 29 | 37 | +1 (`iris_server_profiles`) | 30 |
| iris-admin-mcp | 26 | 66 | +1 | 27 |
| iris-interop-mcp | 22 | 46 | +1 | 23 |
| iris-ops-mcp | 21 | 36 | +1 | 22 |
| iris-data-mcp | 7 | 18 | +1 | 8 |
| **Total** | **105** package tools; **106 distinct tool names** (incl. framework tool) | **203** package rows; **204** incl. `iris_server_profiles` | | |

Commands:
- Tools per server: `awk '/export const tools: ToolDefinition\[\] = \[/{f=1;next} f&&/^\];/{f=0} f&&/Tool,/{c++} END{print c}' <pkg>/src/tools/index.ts` → 29/26/22/21/7.
- Rows: `perl -0777` split each `iris-*/src/tools/*.ts` on `name: "(iris_[a-z0-9_]+)"`, emit `tool:action` per string in `action: z.enum([...])`, else `tool` (mirrors `deriveKeysForTool`, shared/src/governance-baseline-derivation.ts:66-118) → 203 lines, 105 distinct tools; per server 37/66/46/36/18.
- Baseline cross-check: `comm` of derived keys vs the keys in shared/src/baseline-classifications.ts → 141 frozen-baseline keys all live (0 vanished) + **62 post-foundation keys** (141+62=203). Post-foundation `mutates` entries: `grep -hE '^\s+[a-zA-Z]+: "(read|write)",' iris-*/src/tools/*.ts` → 26 read, 36 write (=62). Exactly one post-foundation write ships enabled (`iris_production_control:clean`, `defaultEnabled`), so **35 keys are default-disabled** under empty config; the other 168 package keys + `iris_server_profiles` are default-enabled.
- Server-side: 17 `src/ExecuteMCPv2/REST/*.cls`; 95 `<Route>` entries in Dispatch.cls.

## Legend
- **ATL** = Atelier REST `/api/atelier/v{n}/{ns}/…` via `atelierPath()` (shared/src/atelier.ts:156-170).
- **EXE** = the suite's own REST app `/api/executemcp/v2` (`BASE_URL` const in each tool file), routed by `src/ExecuteMCPv2/REST/Dispatch.cls` UrlMap → `Class:Method` (class prefix `ExecuteMCPv2.REST.` omitted below).
- **MGMNT** = IRIS `/api/mgmnt/v2/{ns}/`; **DOCDB** = IRIS `/api/docdb/v1/{ns}/…`; **LOCAL** = no IRIS call. No tool uses `/api/monitor` (grep of tool files: zero hits).
- **mutates**: `BAC` = class from the frozen-baseline map shared/src/baseline-classifications.ts:47-189 (tool carries no `mutates`); otherwise the tool's own `mutates` field. **Default enabled** per `defaultSeed` (shared/src/governance.ts:703-713): baseline membership ⇒ Y (even when BAC=write); post-foundation read ⇒ Y; post-foundation write ⇒ N unless `defaultEnabled`.
- **Ann** = tool-level MCP annotation: RO = readOnlyHint:true; D = destructiveHint:true; – = neither. Scope (NS/SYS/BOTH/NONE) noted where not NS.
- Every tool also accepts the framework-injected `server` param (profile selector; shared/src/server-base.ts:110-122); omitted from Key params.
- 〃 = same as row above.

## iris-dev-mcp
| Tool | Action/mode | What it does (verified) | Key params | Mechanism | mutates | Default enabled | Source (file:line) |
|---|---|---|---|---|---|---|---|
| iris_doc_get | — | Fetch a document's source by name; metadataOnly = HEAD existence + timestamp | name, format(udl/xml), metadataOnly, namespace | ATL GET/HEAD doc/{name} | read BAC; RO | Y | iris-dev-mcp/src/tools/doc.ts:51,106-140 |
| iris_doc_put | — | Write document content directly (scratch/debug use) | name, content, ignoreConflict, namespace | ATL PUT doc/{name} | write BAC; – | Y | doc.ts:167,221 |
| iris_doc_delete | — | Delete one or many documents | name (string or array), namespace | ATL DELETE doc/{name} per doc | write BAC; D | Y | doc.ts:238,290-291 |
| iris_doc_list | — | List documents; category/type/filter; modifiedSince delta | category(CLS/RTN/CSP/OTH/*), type, filter, generated, modifiedSince, cursor, namespace | ATL GET docnames/{cat}/{type} or modified/{ts} | read BAC; RO | Y | doc.ts:330,410-439 |
| iris_doc_compile | — | Compile one/many docs; errors with line/char positions | doc (string/array), flags, async, namespace | ATL POST action/compile | write BAC; – | Y | compile.ts:42,49-66,102-108 |
| iris_doc_index | — | Class structure: methods, properties, params, superclasses | name, namespace | ATL POST action/index | read BAC; RO | Y | intelligence.ts:23,51-54 |
| iris_doc_search | — | Text/regex search across documents | query, regex, word, case, wild, files, sys, gen, max, namespace | ATL GET action/search | read BAC; RO | Y | intelligence.ts:69,79-105,169 |
| iris_macro_info | — | Macro definition/expansion + source location | name, document, includes, namespace | ATL POST action/getmacrodefinition + action/getmacrolocation | read BAC; RO | Y | intelligence.ts:188,234-241 |
| iris_doc_convert | — | Return a doc in UDL or XML | name, targetFormat(udl/xml), namespace | ATL GET doc/{name}?format | read BAC; RO | Y | format.ts:47,84-87 |
| iris_doc_xml_export | export | Export docs to legacy XML | docs, namespace | ATL POST action/xml/export | read BAC; D(tool) | Y | format.ts:101,113-114,186 |
| iris_doc_xml_export | import | Load definitions from XML (no compile unless compile:true) | content, compile, flags | ATL POST action/xml/load | write BAC | Y | format.ts:218-226 |
| iris_doc_xml_export | list | List docs inside XML without importing | content | ATL POST action/xml/list | read BAC | Y | format.ts:287-290 |
| iris_sql_execute | — | Run SQL, return columns+rows; parameterized | query, parameters, maxRows (ceiling IRIS_SQL_MAX_ROWS; IRIS_SQL_TIMEOUT), namespace | ATL POST action/query | write BAC; – | Y | sql.ts:26,71-87 |
| iris_sql_analyze | explain | Query plan via `EXPLAIN` | query | ATL POST action/query | read; RO | Y | sqlAnalyze.ts:432,455-456,512-518 |
| iris_sql_analyze | stats | Cumulative per-statement stats (INFORMATION_SCHEMA.STATEMENTS) | filter, maxRows | ATL POST action/query | read | Y | 〃 |
| iris_sql_analyze | indexUsage | Maps/indexes a query reads, from EXPLAIN plan | query | ATL POST action/query | read | Y | 〃 |
| iris_sql_analyze | running | Currently executing statements (INFORMATION_SCHEMA.CURRENT_STATEMENTS) | filter, maxRows | ATL POST action/query | read | Y | 〃 |
| iris_sql_analyze | advise | SQL Performance Advisor: full-scan/missing-index/stale-stats/unused-index/plan-anomaly findings for a query or recent workload; never applies changes | query xor workload, topN(≤20) | EXE POST /dev/sql/advise-data → SqlAdvisor:AdviseData + ATL action/query | read | Y | sqlAnalyze.ts:148,240,309 |
| iris_server_info | — | Version, platform, instance name | (none) | ATL GET /api/atelier/ | read BAC; RO; NONE | Y | server.ts:17,32 |
| iris_server_namespace | — | Namespace details (databases, features) | namespace | ATL GET /api/atelier/v{n}/{ns} | read BAC; RO | Y | server.ts:47,69-71 |
| iris_global_get | — | Read a global node value + defined flag | global, subscripts, namespace | EXE GET /global → Global:GetGlobal | read BAC; RO | Y | global.ts:24,63 |
| iris_global_set | — | Set a node; verified after write | global, value, subscripts, namespace | EXE PUT /global → Global:SetGlobal | write BAC; – | Y | global.ts:94,139 |
| iris_global_kill | — | Kill a node or subtree | global, subscripts, namespace | EXE DELETE /global → Global:KillGlobal | write BAC; D | Y | global.ts:170,209 |
| iris_global_list | — | List globals; client-side substring filter | filter, caseSensitive, cursor, namespace | EXE GET /global/list → Global:ListGlobals | read BAC; RO | Y | global.ts:240,305 |
| iris_execute_command | — | Run an ObjectScript command with captured I/O (32768-char cap) | command, namespace | EXE POST /command → Command:Execute | write BAC; – | Y | execute.ts:49,100-103 |
| iris_execute_classmethod | — | Invoke a class method, ≤20 args, byRef/Output markers | className, methodName, args, namespace | EXE POST /classmethod → Command:ClassMethod | write BAC; – | Y | execute.ts:1346,1473-1476 |
| iris_execute_tests | — | Run %UnitTest at package/class/method level; structured results | target, level(package/class/method), timeout (IRIS_TEST_TIMEOUT; cap 3600s), namespace | ATL POST work + poll GET work/{id}; ATL action/query; EXE GET /global | write BAC; RO (annotation diverges from BAC) | Y | execute.ts:1209,1241-1274,971-1016 |
| iris_doc_load | — | Upload local files matching a glob into IRIS; optional compile | path(glob), baseDir, compile, flags, ignoreConflict, namespace | ATL PUT doc/{name} per file + POST action/compile | write BAC; – | Y | load.ts:297,311-341,448-494 |
| iris_doc_export | — | Bulk-download matching docs to a local dir + manifest.json | destinationDir, prefix, category, type, generated(true/false/both), system(true/false/only), modifiedSince, includeManifest, ignoreErrors, useShortPaths, overwrite(never/ifDifferent/always), continueDownloadOnTimeout | ATL GET docnames/modified + doc/{name}; local FS write | write BAC; – | Y | export.ts:219,240-325,399-579 |
| iris_package_list | — | Package rollup to dotted depth with doc counts | depth, prefix, category, type, generated, system(tri-state), modifiedSince | ATL GET docnames/modified | read BAC; RO | Y | packages.ts:89,99-157,197-220 |
| iris_routine_intermediate | — | Macro-expanded `.1.int`/`.int` for a class name | name, format(udl/xml) | ATL GET doc/{candidate} | read BAC; RO | Y | routine.ts:37,95-98 |
| iris_loc_count | — | Lines of code per CLS/MAC/INT/INC: blank/code/comment/test buckets, densities, top-N | spec, includeGenerated, topN, format(summary/csv) | EXE GET /dev/loc → Loc:LocCount | read; RO | Y | loc.ts:126,149-200,233 |
| iris_env_diff | — | Drift report between two profiles over domains documents (SHA-256 hash)/mappings/defaultSettings (credential-redacted)/webapps/config; per-domain error isolation | source, target (profiles), domains[] (default 4; documents opt-in), spec, allowWide, namespace, ignoreTimestamps | EXE POST /dev/doc/hashes (EnvSync:DocHashes), GET /config/mapping/{type}, GET /interop/defaultsettings, GET /security/webapp, POST /system/config — on both profiles | read; RO; NONE | Y | env-diff.ts:964-1065,386-797 |
| iris_env_promote | plan | Pure transform of an env_diff result into ordered steps + planHash; never emits deletes | diff | LOCAL | read; –; NONE | Y | env-promote.ts:1320,1376-1377,1444-1447 |
| iris_env_promote | execute | Run allowlisted steps on target behind 4 gates (confirm, valid indices, plan-hash freshness, target governance); halt on first failure | diff, plan, steps, confirm, source, target, namespace | ATL GET/PUT doc + action/compile; EXE POST /config/mapping/{type}, /interop/defaultsettings, /security/webapp, /system/config | write | N | env-promote.ts:619-893 |
| iris_test_status | poll | Re-attach to a test run by jobId/runIndex | jobId, runIndex, namespace | ATL GET work/{id}; ATL action/query | read; D(tool) | Y | test-status.ts:693,725-746,777-780,476 |
| iris_test_status | cancel | Cancel a running test job | jobId | ATL DELETE work/{id} | write | N | test-status.ts:591 |

## iris-admin-mcp
All tools scope SYS (handlers run in %SYS) except iris_webapp_list (BOTH).

| Tool | Action/mode | What it does (verified) | Key params | Mechanism | mutates | Default enabled | Source (file:line) |
|---|---|---|---|---|---|---|---|
| iris_namespace_manage | create | Create namespace | name, codeDatabase, dataDatabase, library, tempGlobals | EXE POST /config/namespace → Config:NamespaceManage | write BAC; D | Y | iris-admin-mcp/src/tools/namespace.ts:21,27-28,74 |
| iris_namespace_manage | modify | Update provided fields | 〃 | 〃 | write BAC | Y | 〃 |
| iris_namespace_manage | delete | Delete namespace | name | 〃 | write BAC | Y | 〃 |
| iris_namespace_list | — | Namespaces with code/data/library/temp DBs | cursor | EXE GET /config/namespace → Config:NamespaceList | read BAC; RO | Y | namespace.ts:105,126 |
| iris_database_manage | create | Create DB config (directory required) | name, directory, size, maxSize, expansionSize, globalJournalState, mountRequired, mountAtStartup, readOnly, resource | EXE POST /config/database → Config:DatabaseManage | write BAC; D | Y | database.ts:21,31-32,120 |
| iris_database_manage | modify | Update provided fields | 〃 | 〃 | write BAC | Y | 〃 |
| iris_database_manage | delete | Remove DB from config | name | 〃 | write BAC | Y | 〃 |
| iris_database_list | — | DBs with size/free/mount status | cursor | EXE GET /config/database → Config:DatabaseList | read BAC; RO | Y | database.ts:151,172 |
| iris_mapping_manage | create | Global/routine/package mapping incl. subscript-level | type(global/routine/package), namespace, name, database, collation, lockDatabase, subscript | EXE POST /config/mapping/{type} → Config:MappingManage | write BAC; D | Y | mapping.ts:22,35-70,115 |
| iris_mapping_manage | delete | Delete mapping | type, namespace, name, force | 〃 | write BAC | Y | 〃 |
| iris_mapping_list | — | Mappings of one type for a namespace | namespace, type, cursor | EXE GET /config/mapping/{type} → Config:MappingList | read BAC; RO | Y | mapping.ts:146,177 |
| iris_user_manage | create | Create user | name, password, fullName, roles, enabled, namespace, routine, comment, expirationDate, changePasswordOnNextLogin | EXE POST /security/user → Security:UserManage | write BAC; D | Y | user.ts:25,32-33,121 |
| iris_user_manage | modify | Update provided fields | 〃 | 〃 | write BAC | Y | 〃 |
| iris_user_manage | delete | Delete user | name | 〃 | write BAC | Y | 〃 |
| iris_user_get | — | One user by name, or list all users when omitted | name, cursor | EXE GET /security/user/:name → Security:UserGet; GET /security/user → UserList | read BAC; RO | Y | user.ts:152,181-192 |
| iris_user_roles | add | Add role to user | username, role | EXE POST /security/user/roles → Security:UserRoles | write BAC; D | Y | user.ts:231,237-238,262 |
| iris_user_roles | remove | Remove role from user | username, role | 〃 | write BAC | Y | 〃 |
| iris_user_password | change | Change password (opt. force change on next login) | username, password, changePasswordOnNextLogin | EXE POST /security/user/password → Security:UserPassword | write BAC; D | Y | user.ts:293,304-305,343 |
| iris_user_password | validate | Validate candidate vs password policy | password | 〃 | read BAC | Y | 〃 |
| iris_role_manage | create | Create role (resources as res:perm pairs) | name, description, resources, grantedRoles | EXE POST /security/role → Security:RoleManage | write BAC; D | Y | role.ts:21,28-29,72 |
| iris_role_manage | modify | Update provided fields | 〃 | 〃 | write BAC | Y | 〃 |
| iris_role_manage | delete | Delete role | name | 〃 | write BAC | Y | 〃 |
| iris_role_list | — | Roles with resources + granted roles | cursor | EXE GET /security/role → Security:RoleList | read BAC; RO | Y | role.ts:103,125 |
| iris_resource_manage | create | Create security resource | name, description, publicPermission | EXE POST /security/resource → Security:ResourceManage | write BAC; D | Y | resource.ts:88,122-131,347 |
| iris_resource_manage | modify | Update resource | 〃 | 〃 | write BAC | Y | 〃 |
| iris_resource_manage | delete | Delete resource | name | 〃 | write BAC | Y | 〃 |
| iris_resource_manage | grant | Grant SQL privilege at schema/table/column level | target, privilege, grantee, namespace | EXE POST /security/sqlprivilege → Security:SqlPrivilegeManage | write | N | resource.ts:210-213,242 |
| iris_resource_manage | revoke | Revoke SQL privilege | 〃 | 〃 | write | N | 〃 |
| iris_resource_manage | listPrivileges | List SQL grants of a user/role | grantee, namespace, maxRows, cursor | EXE GET /security/sqlprivilege → Security:SqlPrivilegeList | read | Y | resource.ts:280 |
| iris_resource_list | — | Resources with description/public perm/type | cursor | EXE GET /security/resource → Security:ResourceList | read BAC; RO | Y | resource.ts:378,400 |
| iris_permission_check | — | Does user/role (auto-detected) hold a permission on a resource | target, resource, permission | EXE POST /security/permission → Security:PermissionCheck | read BAC; RO | Y | permission.ts:21,57 |
| iris_webapp_manage | create | Create CSP/REST web app | name, namespace, dispatchClass, description, enabled, authEnabled, isNameSpaceDefault, cspZenEnabled, recurse, matchRoles, resource, cookiePath | EXE POST /security/webapp → Security:WebAppManage | write BAC; D | Y | webapp.ts:26,35-36,139 |
| iris_webapp_manage | modify | Update provided fields | 〃 | 〃 | write BAC | Y | 〃 |
| iris_webapp_manage | delete | Delete web app | name | 〃 | write BAC | Y | 〃 |
| iris_webapp_get | — | Exact-name web app lookup | name | EXE POST /security/webapp/get → Security:WebAppGetByPost | read BAC; RO | Y | webapp.ts:170,210 |
| iris_webapp_list | — | All web apps, optional namespace filter | namespace, cursor | EXE GET /security/webapp → Security:WebAppList | read BAC; RO; BOTH | Y | webapp.ts:241,263,270 |
| iris_ssl_manage | create | Create SSL/TLS config | name, description, certFile, keyFile, caFile, caPath, cipherList, tlsMinVersion, tlsMaxVersion, verifyPeer, verifyDepth, type, enabled | EXE POST /security/ssl → Security:SSLManage | write BAC; D | Y | ssl.ts:21,28-29,142 |
| iris_ssl_manage | modify | Update provided fields | 〃 | 〃 | write BAC | Y | 〃 |
| iris_ssl_manage | delete | Delete config | name | 〃 | write BAC | Y | 〃 |
| iris_ssl_list | — | SSL/TLS configs incl. TLS min/max bits | cursor | EXE GET /security/ssl → Security:SSLList | read BAC; RO | Y | ssl.ts:173,196 |
| iris_oauth_manage | create | Create OAuth2 server definition or client registration | entity(server/client), name, serverName, issuerURL, clientName, redirectURIs, grantTypes, clientType, description, supportedScopes, token/code/refresh intervals, signingAlgorithm, customizationNamespace, customizationRoles | EXE POST /security/oauth → Security:OAuthManage | write BAC; D | Y | oauth.ts:24,40-125,225 |
| iris_oauth_manage | delete | Delete server def / client | entity, name | 〃 | write BAC | Y | 〃 |
| iris_oauth_manage | discover | OpenID Connect discovery from issuer URL | issuerURL, sslConfiguration | 〃 | write BAC | Y | 〃 |
| iris_oauth_list | — | OAuth2 server defs + clients (no secrets) | cursor | EXE GET /security/oauth → Security:OAuthList | read BAC; RO | Y | oauth.ts:256,277 |
| iris_service_manage | list | All services | cursor | EXE GET /security/service → Security:ServiceList | read; – | Y | service.ts:27,42-43,97-103,117 |
| iris_service_manage | get | One service's properties | name | EXE /security/service | read | Y | 〃 |
| iris_service_manage | enable | Enable service | name | EXE POST /security/service → Security:ServiceManage | write | N | 〃 |
| iris_service_manage | disable | Disable service | name | 〃 | write | N | 〃 |
| iris_service_manage | set | Update auth settings | name, settings | 〃 | write | N | 〃 |
| iris_ldap_manage | list | All LDAP configs | cursor | EXE GET /security/ldap → Security:LdapList | read; – | Y | ldap.ts:41,62-63,156-163,172 |
| iris_ldap_manage | get | One LDAP config | name | EXE /security/ldap | read | Y | 〃 |
| iris_ldap_manage | test | Non-mutating validity check (exists, required fields, host syntax) | name | EXE POST /security/ldap → Security:LdapManage | read | Y | 〃 |
| iris_ldap_manage | create | Create LDAP config | name, settings | 〃 | write | N | 〃 |
| iris_ldap_manage | modify | Modify LDAP config | name, settings | 〃 | write | N | 〃 |
| iris_ldap_manage | delete | Delete LDAP config | name | 〃 | write | N | 〃 |
| iris_x509_manage | list | X.509 credentials' public metadata | cursor | EXE GET /security/x509 → Security:X509List | read; – | Y | x509.ts:50,70-71,125-130,142 |
| iris_x509_manage | get | One credential's public metadata | alias | EXE /security/x509 | read | Y | 〃 |
| iris_x509_manage | import | Create credential from base64 cert (+ optional key) | alias, certificate, privateKey, privateKeyPassword | EXE POST /security/x509 → Security:X509Manage | write | N | 〃 |
| iris_x509_manage | delete | Delete credential | alias | 〃 | write | N | 〃 |
| iris_audit_manage | status | Instance auditing on/off + per-event-type summary | — | EXE GET /security/audit → Security:AuditStatus | read; D(tool) | Y | audit.ts:50,70-81,177-185,224 |
| iris_audit_manage | view | Audit-log records with filters | begin, end, user, event, source, type, maxRows, cursor | EXE /security/audit | read | Y | 〃 |
| iris_audit_manage | enable | Turn instance auditing on | — | EXE POST /security/audit → Security:AuditManage | write | N | 〃 |
| iris_audit_manage | disable | Turn instance auditing off | — | 〃 | write | N | 〃 |
| iris_audit_manage | configureEvent | Enable/disable one audit event | source, type, name, enabled | 〃 | write | N | 〃 |
| iris_audit_manage | purge | Delete bounded range of audit records | confirm, begin/end bound | 〃 | write | N | 〃 |
| iris_audit_manage | export | Write matching records to server-side file | fileName | 〃 | write | N | 〃 |

## iris-interop-mcp
All tools scope NS except iris_production_summary (NONE).

| Tool | Action/mode | What it does (verified) | Key params | Mechanism | mutates | Default enabled | Source (file:line) |
|---|---|---|---|---|---|---|---|
| iris_production_manage | create | Create empty production class | name, namespace | EXE POST /interop/production → Interop:ProductionManage | write BAC; D | Y | iris-interop-mcp/src/tools/production.ts:23,30-31 |
| iris_production_manage | delete | Delete (stopped) production | name | 〃 | write BAC | Y | 〃 |
| iris_production_control | start | Start production | name, timeout | EXE POST /interop/production/control → Interop:ProductionControl | write BAC; D | Y | production.ts:89,109-148 |
| iris_production_control | stop | Stop current production | timeout, force | 〃 | write BAC | Y | 〃 |
| iris_production_control | restart | Restart production | name, timeout | 〃 | write BAC | Y | 〃 |
| iris_production_control | update | Apply config changes to running production | timeout, force | 〃 | write BAC | Y | 〃 |
| iris_production_control | recover | Recover troubled production | — | 〃 | write BAC | Y | 〃 |
| iris_production_control | clean | Clear a STOPPED production's stale runtime state; optional killAppData | confirm, killAppData | 〃 | write (`defaultEnabled`) | Y | production.ts:176-179 |
| iris_production_status | — | Production name/state; item-level detail optional | detail, namespace | EXE GET /interop/production/status → Interop:ProductionStatus | read BAC; RO | Y | production.ts:230 |
| iris_production_summary | — | Productions + state across ALL namespaces | cursor | EXE GET /interop/production/summary → Interop:ProductionSummary | read BAC; RO; NONE | Y | production.ts:296,314 |
| iris_production_item | add | Add config item | itemName, className, production, settings | EXE POST /interop/production/item → Interop:ItemManage | write; – | N | item.ts:21,54-55,95-98 |
| iris_production_item | remove | Remove config item | itemName, production | 〃 | write | N | 〃 |
| iris_production_item | enable | Enable item | itemName | 〃 | write BAC | Y | 〃 |
| iris_production_item | disable | Disable item | itemName | 〃 | write BAC | Y | 〃 |
| iris_production_item | get | Host + adapter settings | itemName | 〃 | read BAC | Y | 〃 |
| iris_production_item | set | Update item properties / host+adapter settings | itemName, settings | 〃 | write BAC | Y | 〃 |
| iris_production_autostart | get | Current auto-start production | namespace | EXE POST /interop/production/autostart → Interop:AutoStart | read BAC; – | Y | item.ts:146,153-154 |
| iris_production_autostart | set | Set/disable auto-start | productionName | 〃 | write BAC | Y | 〃 |
| iris_production_logs | — | Ens_Util.Log event entries | type(Info/Warning/Error/Trace/Assert/Alert), itemName, count | EXE GET /interop/production/logs → Interop:EventLog | read BAC; RO | Y | monitor.ts:23,31-43 |
| iris_production_queues | — | Queue counts per config item | namespace | EXE GET /interop/production/queues → Interop:QueueStatus | read BAC; RO | Y | monitor.ts:101 |
| iris_production_messages | — | Message trace by session or header | sessionId, headerId, count | EXE GET /interop/production/messages → Interop:MessageTrace | read BAC; RO | Y | monitor.ts:157 |
| iris_production_adapters | — | Non-abstract inbound/outbound adapter classes | category(inbound/outbound) | EXE GET /interop/production/adapters → Interop:AdapterList | read BAC; RO | Y | monitor.ts:249 |
| iris_credential_manage | create | Store Ensemble credential | id, username, password | EXE POST /interop/credential → Interop:CredentialManage | write BAC; D | Y | credential.ts:21,29-30 |
| iris_credential_manage | update | Update username/password | id, username, password | 〃 | write BAC | Y | 〃 |
| iris_credential_manage | delete | Delete credential | id | 〃 | write BAC | Y | 〃 |
| iris_credential_list | — | Credentials (IDs, usernames; no passwords) | namespace | EXE GET /interop/credential → Interop:CredentialList | read BAC; RO | Y | credential.ts:100 |
| iris_lookup_manage | get | Value for key | tableName, key | EXE POST /interop/lookup → Interop:LookupManage | read BAC; D(tool) | Y | lookup.ts:21,29-30 |
| iris_lookup_manage | set | Create/update key-value | tableName, key, value | 〃 | write BAC | Y | 〃 |
| iris_lookup_manage | delete | Remove key | tableName, key | 〃 | write BAC | Y | 〃 |
| iris_lookup_transfer | export | Whole table as XML | tableName | EXE POST /interop/lookup/transfer → Interop:LookupTransfer | read BAC; D(tool) | Y | lookup.ts:98,105-106 |
| iris_lookup_transfer | import | Load entries from XML | tableName, xml | 〃 | write BAC | Y | 〃 |
| iris_rule_list | — | Business rule classes (Ens.Rule.Definition) | prefix, filter, cursor, pageSize | EXE GET /interop/rule → Interop:RuleList | read BAC; RO | Y | rule.ts:25 |
| iris_rule_get | — | Rule class UDL incl. rule XData | name | EXE GET /interop/rule/get → Interop:RuleGet | read BAC; RO | Y | rule.ts:139 |
| iris_transform_list | — | DTL / DataTransform classes | prefix, filter, cursor, pageSize | EXE GET /interop/transform → Interop:TransformList | read BAC; RO | Y | transform.ts:25 |
| iris_transform_test | — | Execute a transform on sample source JSON, return output | className, sourceClass, sourceData | EXE POST /interop/transform/test → Interop:TransformTest | write BAC; – | Y | transform.ts:140 |
| iris_interop_rest | create | Generate REST app from OpenAPI spec | name, spec | EXE POST /interop/rest → Interop:RestManage | write BAC; D | Y | rest.ts:19,29-30 |
| iris_interop_rest | delete | Remove registration (spec+dispatch; .impl kept) | name | 〃 | write BAC | Y | 〃 |
| iris_interop_rest | get | REST app details | name | 〃 | read BAC | Y | 〃 |
| iris_default_settings_manage | list | System Default Settings rows, filterable by 4-tuple | production, item, hostClass, setting | EXE GET /interop/defaultsettings → Interop:DefaultSettingsList | read; D(tool) | Y | defaultSettings.ts:41,58-59,121-125 |
| iris_default_settings_manage | get | One setting row | 〃 | EXE /interop/defaultsettings | read | Y | 〃 |
| iris_default_settings_manage | set | Create/update row | + value, description, deployable | EXE POST /interop/defaultsettings → Interop:DefaultSettingsManage | write | N | 〃 |
| iris_default_settings_manage | delete | Delete row | 4-tuple | 〃 | write | N | 〃 |
| iris_message_diagram | — | Mermaid sequenceDiagram per session (Visual Trace equivalent) | sessionIds, labelMode(full/short), maxRows, dedup | EXE GET /interop/production/messages/diagram → Interop:MessageDiagram | read; RO | Y | diagram.ts:56-112 |
| iris_message_resend | preview | Per header: status, body summary, resendability verdict | headerIds (1-100) | EXE POST /interop/message/resend/preview → MessageResend:MessageResendPreview | read; D(tool) | Y | message-resend.ts:245,276-277,358-361 |
| iris_message_resend | resend | Resend listed headers (Ens.MessageHeader:ResendDuplicatedMessage) | headerIds, headOfQueue, confirm, dryRun | EXE POST /interop/message/resend → MessageResend:MessageResend | write | N | 〃 |
| iris_message_resend | resendFiltered | Resend by filter | item, status, from, to, maxMessages, dryRun, confirm | 〃 | write | N | 〃 |

## iris-ops-mcp
All tools scope NONE.

| Tool | Action/mode | What it does (verified) | Key params | Mechanism | mutates | Default enabled | Source (file:line) |
|---|---|---|---|---|---|---|---|
| iris_metrics_system | — | System metrics in Prometheus text format | (none) | EXE GET /monitor/system → Monitor:SystemMetrics | read BAC; RO | Y | iris-ops-mcp/src/tools/metrics.ts:51 |
| iris_metrics_alerts | — | Active system alerts + system state | (none) | EXE GET /monitor/alerts → Monitor:SystemAlerts | read BAC; RO | Y | metrics.ts:126 |
| iris_metrics_interop | — | Interop throughput/queues/errors, all or one namespace | namespace | EXE GET /monitor/interop → Monitor:InteropMetrics | read BAC; RO | Y | metrics.ts:201 |
| iris_alerts_manage | reset | `$SYSTEM.Monitor.Clear()` alert reset (alerts.log kept) | — | EXE POST /monitor/alerts/manage → Monitor:AlertsManage | write BAC; D | Y | alerts.ts:21,33-34 |
| iris_jobs_list | — | All running jobs/processes | (none) | EXE GET /monitor/jobs → Monitor:JobsList | read BAC; RO | Y | jobs.ts:21 |
| iris_locks_list | — | All current locks | (none) | EXE GET /monitor/locks → Monitor:LocksList | read BAC; RO | Y | jobs.ts:103 |
| iris_process_manage | get | One process detail + canBeTerminated/Suspended | pid | EXE GET /monitor/process → Monitor:ProcessGet | read; D(tool) | Y | process.ts:36,55-56,85-90 |
| iris_process_manage | terminate | Terminate process | pid | EXE POST /monitor/process/manage → Monitor:ProcessManage | write | N | 〃 |
| iris_process_manage | suspend | Suspend process | pid | 〃 | write | N | 〃 |
| iris_process_manage | resume | Resume process | pid | 〃 | write | N | 〃 |
| iris_journal_info | — | Journal file/dirs/space/state | (none) | EXE GET /monitor/journal → Monitor:JournalInfo | read BAC; RO | Y | system.ts:22 |
| iris_mirror_status | — | Mirror config/membership/sync | (none) | EXE GET /monitor/mirror → Monitor:MirrorStatus | read BAC; RO | Y | system.ts:87 |
| iris_audit_events | — | Audit-log events with filters | beginDate, endDate, username, eventType, maxRows | EXE GET /monitor/audit → Monitor:AuditEvents | read BAC; RO | Y | system.ts:156 |
| iris_database_check | — | DB mount/RO/encryption/journal/size status (not integrity scan) | name | EXE GET /monitor/database → Monitor:DatabaseCheck | read BAC; RO | Y | infrastructure.ts:22 |
| iris_database_action | mount | Mount DB by directory (SYS.Database) | directory, readonly | EXE POST /monitor/database/action → Monitor:DatabaseAction | write; D | N | database.ts:40,71-78,136-143 |
| iris_database_action | dismount | Dismount DB | directory | 〃 | write | N | 〃 |
| iris_database_action | compact | Compact DB | directory, percentFull | 〃 | write | N | 〃 |
| iris_database_action | defragment | Defragment DB | directory | 〃 | write | N | 〃 |
| iris_database_action | truncate | Return free space | directory, targetSize | 〃 | write | N | 〃 |
| iris_database_action | expandVolume | Add volume | directory, newVolDir, initialSize | 〃 | write | N | 〃 |
| iris_backup_manage | run | Run backup task (Backup.General) | taskName, backupType(full/incremental/cumulative), jobbackup, device, logFile, description, username, password | EXE POST /monitor/backup/manage → Monitor:BackupManage | write; D | N | backup.ts:43,72-125,148-153 |
| iris_backup_manage | freeze | Freeze writes (external backup) | — | 〃 | write | N | 〃 |
| iris_backup_manage | thaw | Thaw writes | — | 〃 | write | N | 〃 |
| iris_backup_manage | listHistory | Recent backup history | — | 〃 | read | Y | 〃 |
| iris_license_info | — | License capacity/expiry/limits/usage | (none) | EXE GET /monitor/license → Monitor:LicenseInfo | read BAC; RO | Y | infrastructure.ts:116 |
| iris_ecp_status | — | ECP config + connection health | (none) | EXE GET /monitor/ecp → Monitor:ECPStatus | read BAC; RO | Y | infrastructure.ts:184 |
| iris_task_manage | create | Create scheduled task | name, taskClass, namespace, description, suspended | EXE POST /task/manage → Task:TaskManage | write BAC; D | Y | task.ts:23,31-32 |
| iris_task_manage | modify | Update provided fields | id + fields | 〃 | write BAC | Y | 〃 |
| iris_task_manage | delete | Delete task | id | 〃 | write BAC | Y | 〃 |
| iris_task_list | — | All tasks with schedule/status | (none) | EXE GET /task/list → Task:TaskList | read BAC; RO | Y | task.ts:124 |
| iris_task_run | — | Trigger task now (async) | id | EXE POST /task/run → Task:TaskRun | write BAC; – | Y | task.ts:221 |
| iris_task_history | — | Task execution history | taskId, maxRows | EXE GET /task/history → Task:TaskHistory | read BAC; RO | Y | task.ts:282 |
| iris_config_manage | get | CPF config for a section | section(config/startup/locale) | EXE POST /system/config → SystemConfig:ConfigManage | read BAC; D(tool) | Y | config.ts:21,29-38 |
| iris_config_manage | set | Modify config-section properties | section=config, properties | 〃 | write BAC | Y | 〃 |
| iris_config_manage | export | Combined system info + config | — | 〃 | read BAC | Y | 〃 |
| iris_health_check | — | Composite verdict (healthy/warning/critical) across up to 9 areas in one call | areas[] (system, databases, journal, mirror, locks, license, ecp, alerts, interop), thresholds | EXE GET/POST /monitor/health → Health:HealthCheck | read; RO | Y | health.ts:28-40,767-830 |

## iris-data-mcp
All tools scope NS.

| Tool | Action/mode | What it does (verified) | Key params | Mechanism | mutates | Default enabled | Source (file:line) |
|---|---|---|---|---|---|---|---|
| iris_docdb_manage | list | DocDB databases in namespace | namespace | DOCDB GET /api/docdb/v1/{ns}; EXE GET /security/service?name=%Service_DocDB for disabled-service diagnosis | read BAC; D(tool) | Y | iris-data-mcp/src/tools/docdb.ts:261,272-273,225 |
| iris_docdb_manage | create | Create document DB (optional properties) | database | DOCDB …/db/{database} | write BAC | Y | 〃 |
| iris_docdb_manage | drop | Drop DB and data | database | DOCDB …/db/{database} | write BAC | Y | 〃 |
| iris_docdb_document | insert | Insert doc, return ID | database, document | DOCDB …/doc/{database} | write BAC; D | Y | docdb.ts:373,385-398 |
| iris_docdb_document | get | Get doc by ID | database, id | 〃 | read BAC | Y | 〃 |
| iris_docdb_document | update | Replace doc by ID | database, id, document | 〃 | write BAC | Y | 〃 |
| iris_docdb_document | delete | Delete doc by ID | database, id | 〃 | write BAC | Y | 〃 |
| iris_docdb_find | — | Filter query ($eq/$lt/$gt/$ne/$lte/$gte) | database, filter | DOCDB …/find/{database} | read BAC; RO | Y | docdb.ts:528 |
| iris_docdb_property | create | Define typed property | database, property, type | DOCDB …/prop/{database}/{property} | write BAC; D | Y | docdb.ts:611,622-631 |
| iris_docdb_property | drop | Remove property | database, property | 〃 | write BAC | Y | 〃 |
| iris_docdb_property | index | Index a property | database, property | 〃 | write BAC | Y | 〃 |
| iris_analytics_mdx | — | Run MDX against DeepSee, structured pivot | query, namespace | EXE POST /analytics/mdx → Analytics:ExecuteMDX | read BAC; RO | Y | analytics.ts:23 |
| iris_analytics_cubes | list | Cubes with fact count + build time (ISO + $H raw) | namespace | EXE GET /analytics/cubes → Analytics:CubeList | read BAC; – | Y | analytics.ts:157,166-167 |
| iris_analytics_cubes | build | Full synchronous rebuild | cube | EXE POST /analytics/cubes → Analytics:CubeAction | write BAC | Y | 〃 |
| iris_analytics_cubes | sync | Incremental synchronize | cube | 〃 | write BAC | Y | 〃 |
| iris_rest_manage | list | REST apps by scope: spec-first (Mgmnt), legacy (%CSP.REST via webapp list), all | scope(spec-first/legacy/all), namespace | MGMNT GET /api/mgmnt/v2/{ns}/; EXE GET /security/webapp | read BAC; D | Y | rest.ts:134-198 |
| iris_rest_manage | get | App details (dispatch, URL map, swagger; legacy fallback) | application, fullSpec | MGMNT GET …/{ns}/{app}; EXE fallback | read BAC | Y | 〃 |
| iris_rest_manage | delete | Delete spec-first app only | application | MGMNT DELETE …/{ns}/{app} | write BAC | Y | 〃 |

## Framework (Part B) — bullets, each cited
- **Framework tool on all 5 servers:** `iris_server_profiles` (in no package array; reserved name). Returns profile roster (name/host/port/username/namespace/https/baseUrl/timeout/source/sourceFile; never password) + effective governance policy for one profile or all (`profile`, `allProfiles`). LOCAL (in-memory), `mutates:"read"`, RO, idempotentHint, scope NONE, default-enabled; always visible regardless of tool presets. shared/src/server-discovery.ts:45,350-420; registered shared/src/server-base.ts:644-658; visibility exemption server-base.ts:582-616.
- **Server instructions:** `SERVER_DISCOVERY_INSTRUCTIONS` ("call iris_server_profiles first"; prefer `iris_production_control:recover` before `clean`) sent in `initialize` by every server. server-discovery.ts:54; server-base.ts:551.
- **Multi-instance / profiles:** every tool gets an optional `server` param selecting a named profile (server-base.ts:110-122); tool context exposes `resolveProfileClient` for cross-profile tools like env_diff/env_promote (shared/src/tool-types.ts ToolContext). Default profile from `IRIS_HOST/IRIS_PORT/IRIS_USERNAME/IRIS_PASSWORD/IRIS_NAMESPACE/IRIS_HTTPS/IRIS_TIMEOUT` (shared/src/config.ts:9,98); extra profiles from `IRIS_PROFILES` (shared/src/profiles.ts:42-62,412); profile `source` = "env" or "server-manager" (profiles.ts:52). Server-manager source reads the InterSystems Server Manager VS Code `intersystems.servers` settings from disk (`IRIS_SERVER_MANAGER`, `IRIS_SM_SERVERS`, `IRIS_SM_WORKSPACE`, `IRIS_SM_SETTINGS_PATHS`). shared/src/server-manager-source.ts:1-20.
- **Credentials:** chain env → OS keychain (`@napi-rs/keyring`, service `iris-mcp`) → `IRIS_CREDENTIAL_HELPER` subprocess (10 s timeout). shared/src/credential-chain.ts:17-34,74-80. A credentials CLI offers set/delete/list/test (shared/src/cli/credentials.ts:1026-1032).
- **Auth / transport to IRIS:** HTTP Basic on the first request, then the session cookie; one retry with Basic on 401; CSRF token + session set up via HEAD `/api/atelier/`. shared/src/http-client.ts:37-46,124-133. `IRIS_ACCEPT_LANGUAGE` header (config.ts:71).
- **Scope resolution:** NS/BOTH = caller `namespace` or the profile default; SYS = forced `%SYS`; NONE = no namespace. server-base.ts:263-282. Cursor pagination via `ctx.paginate` (same function).
- **Governance (per-action enable/disable):** keys are `tool` or `tool:action`, derived from the `action` enum (governance-baseline-derivation.ts:66-118). Resolution order: per-profile `IRIS_GOVERNANCE` → global `IRIS_GOVERNANCE` → per-profile `IRIS_GOVERNANCE_FILE` (JSON `{global, profiles}`) → global file → `IRIS_GOVERNANCE_PRESET` (`read-only` | `full`) → default seed (governance.ts:63,703-713,755-791,827-855). Defaults: the 141 frozen-baseline keys are enabled whatever their class; post-foundation reads are enabled; post-foundation writes are disabled unless the tool lists them in `defaultEnabled` (only `iris_production_control:clean`). `read-only` preset: only read-classified keys are enabled (BAC first, then `mutates`). Every post-foundation key must be classified, or registration throws (governance.ts:650). A denied call returns `structuredContent` with a code and `presetApplied` and never runs the handler (server-base.ts:1422-1463). `iris_env_promote:execute` also checks the TARGET profile's own policy (env-promote.ts description, 1320-1376). A governance CLI offers validate/get/set/unset (shared/src/cli/governance.ts:1533-1539).
- **MCP resources:** static `iris-governance://default` plus template `iris-governance://{profile}`, each the effective policy as JSON (advisory). Capability `resources: {listChanged:true}`. server-base.ts:100-104,543-545,899-960. No other resources.
- **Visibility presets:** `IRIS_TOOLS_PRESET` = `full` | `core` | `developer`, plus `IRIS_TOOLS_DISABLE` / `IRIS_TOOLS_ENABLE` (shared/src/tool-visibility.ts:48,150). Hidden tools are never registered (server-base.ts:628-637). `TOOL_PAIRS` = [iris_env_diff, iris_env_promote] (tool-visibility.ts:313-315). Per-package rosters are in `<pkg>/src/tools/presets.ts`. Include counts (awk over presets.ts), core/developer: dev 12/29, admin 12/10, interop 9/22, ops 9/9, data 7/7. `full` = all tools.
  - core: dev = doc_get, doc_put, doc_list, doc_compile, sql_execute, global_get/set/kill, execute_command, execute_classmethod, execute_tests, doc_load. admin = namespace_manage/list, database_manage/list, user_manage/get/roles/password, role_list, permission_check, webapp_manage/list. interop = production_control/status/summary/item/logs/queues/messages, message_diagram, message_resend. ops = metrics_system, metrics_alerts, jobs_list, locks_list, process_manage, license_info, task_list, task_run, health_check. data = all 7.
  - developer: dev = all 29. admin = namespace_*, database_*, mapping_*, permission_check, webapp_*. interop = all 22. ops = metrics_system, metrics_interop, jobs_list, locks_list, process_manage, task_list, task_run, task_history, health_check. data = all 7.
- **MCP prompts (11):** dev = deploy-and-test-class, diagnose-slow-query, objectscript-review, promote-environment-change. admin = audit-security-posture, provision-project-environment. interop = recover-stuck-production, resend-failed-messages, trace-message-flow. ops = check-system-health, run-external-backup. data = none (no prompts dir). Files: `<pkg>/src/prompts/*.ts`; registered only when supplied (server-base.ts:692-701,993-1095).
- **Elicitation:** none. `grep -rl elicit --include='*.ts'` over packages (excluding node_modules/dist/tests) returns zero.
- **Output schemas / structuredContent:** `ToolDefinition.outputSchema` exists and is passed through (tool-types.ts; server-base.ts:1138-1148), but no package tool defines one (`grep -l 'outputSchema:'` hits only server-base.ts). `structuredContent` is returned by every tool source file except test-status.ts (`grep -L structuredContent`).
- **Transports:** stdio only works. `resolveTransport` accepts `--transport http` / `MCP_TRANSPORT=http` (shared/src/transport.ts), but `start()` throws "HTTP transport not yet implemented" (server-base.ts:2155-2165).
- **Bootstrap / auto-install of server-side classes:** `bootstrap()` probes the custom REST app (current / unconfigured / stale). It deploys embedded classes via ATL PUT doc and compiles via action/compile. Privileged steps then register the `/api/executemcp/v2` web app, configure the package mapping and ensure the UnitTest root. Without privileges it falls back to `MANUAL_INSTRUCTIONS`. shared/src/bootstrap.ts:79,140-446; embedded sources in the generated shared/src/bootstrap-classes.ts. Server side: 17 `src/ExecuteMCPv2/REST/*.cls`, 95 routes in Dispatch.cls. Route `POST /tests → UnitTest:RunTests` exists, but no TS tool calls it (grep `/tests` in iris-dev tools: none).
- **Session audit log:** opt-in `IRIS_AUDIT_LOG` JSONL of tool calls, secrets redacted, outcome ok/error/denied, size rotation `IRIS_AUDIT_LOG_MAX_MB`, `IRIS_AUDIT_LOG_PARAMS`; flushed on `stop()`. shared/src/audit.ts:1-20,49,131; server-base.ts:2009-2034.
- **Operator limits:** `IRIS_SQL_MAX_ROWS`, `IRIS_SQL_TIMEOUT`, `IRIS_TEST_TIMEOUT` (env names grep of shared/src).
- **Companion packages:** `packages/client-config` writes MCP-client configs, with 16 adapters (claude-code, claude-desktop, cursor, vscode, cline, roo-code, windsurf, codex, gemini, zed, goose, kimi, kimi-code, pi, jetbrains-junie, kilo-code; client-config/src/adapters.ts:36-595). `packages/iris-mcp-all` is the meta package.

## Not yet established
- Per-action required/optional parameter matrix: params are listed per tool from the zod schema and descriptions, not split exactly by action.
- Server-side ObjectScript handler bodies were not read. Semantics come from TS descriptions/handlers plus Dispatch.cls route→method mapping, so IRIS-side edge behaviour is unverified.
- `iris_doc_compile` `async` mechanism (whether it uses the ATL work queue) not confirmed.
- Exact output field shapes per tool and prompt argument lists (beyond names) not inventoried.
- Not checked: whether `iris_test_status` returns any structured output despite lacking `structuredContent`.
