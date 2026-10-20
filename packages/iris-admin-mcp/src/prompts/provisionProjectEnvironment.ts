/**
 * `provision-project-environment` prompt (Epic 25, Story 25.1 — spec
 * `03-skills-prompts-pack.md` §3).
 *
 * Walks `iris_database_manage` (x2) → `iris_namespace_manage` →
 * `iris_user_manage` → `iris_webapp_manage`, verifying each step before
 * moving to the next, with rollback notes. Server: iris-admin-mcp.
 */

import type { PromptDefinition } from "@iris-mcp/shared";
import { argOrPlaceholder as arg } from "@iris-mcp/shared";

export const provisionProjectEnvironmentPrompt: PromptDefinition = {
  name: "provision-project-environment",
  title: "Provision Project Environment",
  description:
    "Provision a new IRIS project environment: two databases, a namespace, a user, and a " +
    "web application — verifying each step before the next, with rollback notes.",
  skill: {
    description:
      "Provisions a new IRIS project environment in order: a DATA and a CODE database, a namespace over " +
      "them, a user whose default namespace it is, and a web application, checking each step before the " +
      "next, rolling back the completed steps when one fails, and naming the manual follow-up a new web " +
      "application needs. Use when the user wants to set up or create a new IRIS project, namespace or " +
      "application environment.",
    preset: "core",
  },
  arguments: [
    {
      name: "projectName",
      description: "Short project name used to derive database, namespace, and web-app names (e.g. 'MyApp').",
      required: true,
    },
  ],
  build: (args) => {
    const project = arg(args.projectName, "<projectName>");
    const dataDb = `${project}DATA`;
    const codeDb = `${project}CODE`;

    return `# Provision Project Environment

Project: \`${project}\`

Verify EACH step succeeded (inspect the tool result) before proceeding to the next. If any step fails partway through, roll back the steps already completed (see the rollback note after each step) rather than leaving a half-provisioned environment.

1. Call \`iris_database_manage\` action 'create' with \`name: "${dataDb}"\` and a \`directory\` for the DATA database. *Rollback: \`iris_database_manage\` action 'delete' with \`name: "${dataDb}"\`.*
2. Call \`iris_database_manage\` action 'create' with \`name: "${codeDb}"\` and a \`directory\` for the CODE database. *Rollback: \`iris_database_manage\` action 'delete' with \`name: "${codeDb}"\`.*
3. Call \`iris_namespace_manage\` action 'create' with \`name: "${project}"\`, \`dataDatabase: "${dataDb}"\`, \`codeDatabase: "${codeDb}"\`. *Rollback: \`iris_namespace_manage\` action 'delete' with \`name: "${project}"\`, then undo steps 1-2.*
4. Call \`iris_user_manage\` action 'create' with a \`name\` and \`password\` for the project's service/developer account, and \`namespace: "${project}"\` as its default namespace. *Rollback: \`iris_user_manage\` action 'delete' with the same \`name\`.*
5. Call \`iris_webapp_manage\` action 'create' with a \`name\` starting with '/' (e.g. '/api/${project.toLowerCase()}'), \`namespace: "${project}"\`, and (if applicable) a \`dispatchClass\`. Note: creating a web app does NOT notify the CSP gateway — it requires saving through the Management Portal or a gateway restart to become active. *Rollback: \`iris_webapp_manage\` action 'delete' with the same \`name\`.*
6. Summarize what was created (database names, namespace, user, web app path) and any manual follow-up needed (CSP gateway activation for the new web app).`;
  },
};
