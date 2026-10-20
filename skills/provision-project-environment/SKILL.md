---
# DO NOT EDIT: generated from the MCP prompt of the same name.
name: provision-project-environment
description: "Provisions a new IRIS project environment in order: a DATA and a CODE database, a namespace over them, a user whose default namespace it is, and a web application, checking each step before the next, rolling back the completed steps when one fails, and naming the manual follow-up a new web application needs. Use when the user wants to set up or create a new IRIS project, namespace or application environment."
metadata:
  iris-tools-preset: core
---

# Provision Project Environment

Project: `<projectName>`

Verify EACH step succeeded (inspect the tool result) before proceeding to the next. If any step fails partway through, roll back the steps already completed (see the rollback note after each step) rather than leaving a half-provisioned environment.

1. Call `iris_database_manage` action 'create' with `name: "<projectName>DATA"` and a `directory` for the DATA database. *Rollback: `iris_database_manage` action 'delete' with `name: "<projectName>DATA"`.*
2. Call `iris_database_manage` action 'create' with `name: "<projectName>CODE"` and a `directory` for the CODE database. *Rollback: `iris_database_manage` action 'delete' with `name: "<projectName>CODE"`.*
3. Call `iris_namespace_manage` action 'create' with `name: "<projectName>"`, `dataDatabase: "<projectName>DATA"`, `codeDatabase: "<projectName>CODE"`. *Rollback: `iris_namespace_manage` action 'delete' with `name: "<projectName>"`, then undo steps 1-2.*
4. Call `iris_user_manage` action 'create' with a `name` and `password` for the project's service/developer account, and `namespace: "<projectName>"` as its default namespace. *Rollback: `iris_user_manage` action 'delete' with the same `name`.*
5. Call `iris_webapp_manage` action 'create' with a `name` starting with '/' (e.g. '/api/<projectname>'), `namespace: "<projectName>"`, and (if applicable) a `dispatchClass`. Note: creating a web app does NOT notify the CSP gateway — it requires saving through the Management Portal or a gateway restart to become active. *Rollback: `iris_webapp_manage` action 'delete' with the same `name`.*
6. Summarize what was created (database names, namespace, user, web app path) and any manual follow-up needed (CSP gateway activation for the new web app).
