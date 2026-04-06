---
title: "Product Brief: IRIS MCP v2"
status: "complete"
created: "2026-04-05"
updated: "2026-04-05"
inputs:
  - "_bmad-output/planning-artifacts/research/technical-iris-mcp-v2-tools-research-2026-04-05.md"
  - "_bmad-output/planning-artifacts/research/technical-mcp-server-best-practices-research-2026-04-05.md"
  - "_bmad-output/planning-artifacts/research/mcp-specification-reference-2025-11-25.md"
  - "_bmad-output/planning-artifacts/research/iris-mcp-v2-server-suites-2026-04-05.md"
  - "sources/iris-execute-mcp/ (v1 reference)"
  - "sources/mcp-server-iris/ (reference)"
  - "sources/vscode-objectscript/ (reference)"
  - "sources/language-server/ (reference)"
  - "sources/intersystems-servermanager/ (reference)"
  - "irislib/%Api/ (Atelier API source)"
  - "irislib/Security/, Config/, %SYS/ (admin API source)"
  - "irislib/Ens/, EnsLib/ (interoperability source)"
---

# Product Brief: IRIS MCP v2

## Executive Summary

IRIS MCP v2 is an open-source suite of five Model Context Protocol (MCP) servers that give AI assistants — Claude, Copilot, Cursor, and any MCP-compatible client — full programmatic control over InterSystems IRIS. It replaces the existing v1 servers (`iris-execute-mcp` and `mcp-server-iris`) with a unified, web-port-only architecture that eliminates the native driver dependency, expands from 18 tools to 86 consolidated tools across development, administration, interoperability, operations, and data domains, and follows MCP best practices for tool count, annotations, and naming.

The vision is simple: **make IRIS fully AI-controllable.** Every operation available in the System Management Portal, VS Code extensions, and Atelier API should be invocable by an AI agent — from writing and compiling ObjectScript to provisioning namespaces, configuring OAuth, managing interoperability productions, and monitoring system health.

## The Problem

Today, AI-assisted IRIS development is constrained by two fragmented MCP servers with limited scope:

- **iris-execute-mcp** provides 8 tools (execute commands, compile, test, globals) but requires the SuperServer native driver (port 1972) and the `intersystems-irispython` package — a friction point for installation and a blocker in containerized/remote environments.
- **mcp-server-iris** provides 10 tools (SQL, production management) via the same native driver with the same limitations.

Neither server covers system administration (users, databases, namespaces, SSL, OAuth), web application management, full interoperability lifecycle, monitoring, task scheduling, or the rich code intelligence features available in the Atelier REST API. Developers constantly context-switch between AI assistance and the System Management Portal for anything beyond basic code editing.

The result: AI agents can write ObjectScript but cannot deploy it end-to-end. They can query data but cannot provision the database. They can start a production but cannot configure the credentials, SSL, or web applications it depends on.

## The Solution

IRIS MCP v2 is a suite of five focused MCP servers, each containing 9-22 tools optimized for a specific domain:

| Server | Tools | What It Does |
|--------|-------|--------------|
| **iris-dev-mcp** | 20 | Code lifecycle: read/write/compile documents, search, SQL, globals, execute ObjectScript, run unit tests. Covers everything in v1 plus Atelier API code intelligence. |
| **iris-admin-mcp** | 22 | Server infrastructure: namespaces, databases, users, roles, web applications, SSL/TLS, OAuth2, global/routine/package mappings. |
| **iris-interop-mcp** | 19 | Interoperability: production lifecycle (start/stop/configure), credentials, lookup tables, business rules, data transforms, message tracing. |
| **iris-ops-mcp** | 16 | Operations: system metrics, jobs, locks, journals, mirrors, audit events, scheduled tasks, system configuration. |
| **iris-data-mcp** | 9 | Data & analytics: DocDB document databases, DeepSee/BI, debugging, REST API management. |

All communication flows through the **IRIS web port** (HTTP/REST on port 52773) using the Atelier REST API for development operations and a custom REST service (`ExecuteMCPv2.REST.Dispatch`) for administration operations. No SuperServer. No native driver. No `intersystems-irispython`.

**Self-bootstrapping installation:** When a server requiring the custom REST service connects to IRIS for the first time, it checks for the service's presence. If missing, it automatically deploys the ObjectScript classes via the Atelier API (`PUT /doc` + `POST /action/compile`), then attempts to execute a configuration class method to register the `/api/executemcp` web application. If the connected user has sufficient privileges, the entire setup is fully automatic. If any step fails due to insufficient permissions (e.g., web application registration requires %Admin_Manage), the server completes as much as possible and provides explicit, actionable instructions for the remaining manual steps — including the exact commands or SMP navigation to finish the setup. As an alternative, if IPM (InterSystems Package Manager) is available, the user can run `zpm "install iris-execute-mcp-v2"` to handle the full IRIS-side installation in one command.

## What Makes This Different

- **Web-port only:** Single HTTP connection, no native driver dependency. Works through firewalls, reverse proxies, and containers without special port configuration.
- **Atelier API first:** 70% of the dev server tools use the existing, battle-tested Atelier REST API — the same API that powers the VS Code ObjectScript extension. Custom code only where Atelier doesn't reach.
- **Self-bootstrapping:** Servers that require the custom IRIS-side REST service automatically detect its absence and install as much as possible via the Atelier API — deploying classes, compiling, and configuring the web application. If any step requires higher privileges than available, the server provides explicit instructions for completing the remaining setup manually.
- **Full coverage:** 86 tools spanning every major IRIS management surface — not just development, but the entire administrative and operational lifecycle.
- **MCP best practices:** Suite architecture keeps each server in the 9-22 tool range (industry sweet spot), with proper tool annotations (`readOnlyHint`, `destructiveHint`), dot-namespaced tool names (`iris.doc.compile`), and structured output schemas.
- **Open source:** Community-driven, no license barriers to adoption.

## Who This Serves

**Primary: IRIS developers using AI coding assistants.** They want to write, compile, test, and deploy ObjectScript without leaving their AI workflow. `iris-dev-mcp` is their daily driver.

**Secondary: System administrators automating IRIS infrastructure.** They want to script namespace creation, user provisioning, SSL configuration, and production deployment through AI agents or automation pipelines. `iris-admin-mcp` and `iris-interop-mcp` are their tools.

**Tertiary: Operations teams monitoring IRIS health.** They want AI-assisted diagnostics — system metrics, job monitoring, journal status, mirror health. `iris-ops-mcp` gives them eyes on the system.

## Success Criteria

- All 18 v1 tools (both servers) are functionally replicated in v2 with zero SuperServer dependency
- `iris-dev-mcp` achieves feature parity with VS Code ObjectScript extension's Atelier API usage
- An AI agent can perform a complete end-to-end workflow: create a namespace, create a database, create a user with roles, deploy a web application, write and compile a class, run unit tests, and start an interoperability production — all via MCP tools
- Installation requires only `npm install` and IRIS web port connectivity — no native drivers

## Scope

**In scope for v2:**
- Five MCP server packages in a TypeScript monorepo with shared connection infrastructure
- IRIS-side custom REST service (`ExecuteMCPv2.REST.Dispatch`) for operations not covered by the Atelier API
- Auto-bootstrap: automatic detection, deployment, compilation, and web application configuration of the IRIS-side REST service via the Atelier API on first connection — including a setup/configuration class method that registers the web application
- MCP specification v2025-11-25 compliance (pagination, tool annotations, `listChanged`, structured output)
- stdio and Streamable HTTP transports
- Basic Auth and cookie-based session management

**Out of scope for v2:**
- OAuth2 authentication for the MCP servers themselves (future)
- WebSocket-based debugging and terminal tools (deferred to iris-data-mcp v2.1)
- FHIR/HealthShare-specific tools
- Embedded Python execution tools
- GUI/dashboard for tool management

## Vision

If IRIS MCP v2 succeeds, it becomes the **standard interface for AI-driven IRIS management** — the way AI agents interact with IRIS, period. The five-server suite expands to cover every corner of the platform: FHIR resources, HealthShare clinical data, mirror failover automation, CI/CD pipeline integration, and multi-instance orchestration. The custom REST service evolves into an officially supported IRIS management API. And the open-source community builds domain-specific servers on top of the shared infrastructure — healthcare, finance, supply chain — each bringing IRIS capabilities to AI workflows that don't exist today.
