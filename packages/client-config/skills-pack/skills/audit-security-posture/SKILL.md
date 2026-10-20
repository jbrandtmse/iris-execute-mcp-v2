---
# DO NOT EDIT: generated from the MCP prompt of the same name.
name: audit-security-posture
description: "A read-only audit of an IRIS instance's security: users whose password settings look stale or that may use a well-known default credential, every user and role that holds %All, services that are enabled without authentication or not needed, SSL/TLS configurations with a minimum TLS version below 1.2 or missing certificate paths, and whether auditing is on, ending in a report of recommended fixes; it changes nothing. Use when the user asks to audit, review or harden IRIS security, asks who holds %All, or asks whether services, SSL/TLS or auditing are set up safely."
metadata:
  iris-tools-preset: full
---

# Audit Security Posture

No server profile specified — omit `server` (or pass "<server>") to use the default server on every tool call below.

This is a READ-ONLY audit — every call below is a read action. Do not modify any user, role, service, or SSL configuration as part of this workflow.

1. Call `iris_user_get` with no `name` (lists all users). For each enabled user, check: does `changePasswordOnNextLogin`/expiration look stale or absent, and — for any account you suspect uses a well-known default credential (e.g. `_SYSTEM`, `Admin`, `SuperUser`) — flag it for the user to verify manually (never attempt to test a password via this workflow).
2. Call `iris_role_list` to enumerate all roles and their granted resources. Identify every role holding `%All` (or a resource with unrestricted `RWU`-style permission) — these are super-user-equivalent roles.
3. Cross-reference: for each user from step 1, check its `roles` field for `%All` (directly, or via a role from step 2 that grants it). Flag every account holding `%All` — this is the most security-sensitive finding.
4. Call `iris_service_manage` action 'list' to enumerate all IRIS services (e.g. %Service_Telnet, %Service_CallIn, %Service_SQL) and their enabled/authentication settings. Flag any service that is enabled but unauthenticated, or that is enabled and not needed (e.g. %Service_Telnet enabled on a production instance).
5. Call `iris_ssl_list` to enumerate SSL/TLS configurations. Flag any enabled config with a weak `tlsMinVersion` (below TLS1.2, bit 16) or missing certificate paths.
6. Call `iris_audit_manage` action 'status' to check whether instance auditing is enabled overall and per-event-type.
7. Produce a summary report with three sections: **Default/weak credentials** (accounts to verify manually), **%All holders** (users and roles), and **Insecure services/configs** (enabled-but-risky services, weak SSL configs, and whether auditing is on). Recommend fixes but do NOT apply them without the user's explicit approval.
