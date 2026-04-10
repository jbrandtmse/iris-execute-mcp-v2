/**
 * Cross-server tool-naming regression guard.
 *
 * This test iterates every tool registered across all 5 IRIS MCP server
 * packages and asserts that every `tool.name` conforms to the flat
 * underscore naming convention required by the Anthropic Messages API
 * (`^[a-zA-Z0-9_-]+$`, which rejects dots).
 *
 * Story 9.1 renamed the 85 tool identifiers from dotted notation (e.g.,
 * `iris.doc.get`) to flat underscore notation (e.g., `iris_doc_get`).
 * This test exists so that any future regression — a hand-edit, a copy-
 * paste from an old document, a partial rename during a new feature —
 * will fail CI before it reaches published npm packages or Claude Desktop.
 *
 * **Placement rationale:** `@iris-mcp/shared` is the foundational package
 * that the 5 server packages depend on, so a test in `shared` cannot
 * import them without creating a dependency cycle. The server packages'
 * entry points (`src/index.ts`) have runtime side effects (they construct
 * an {@link McpServerBase} and call `server.start(transport)` at module
 * load), so we cannot import the published `main` entry. Instead, we
 * reach directly into each peer package's `src/tools/index.ts` via a
 * relative path — that file is a pure re-export with no side effects.
 *
 * This file lives in `packages/iris-dev-mcp/tests/` (outside `src/`) so
 * that the relative `../../ *&#47;src/tools/index.js` imports don't
 * violate the `rootDir` constraint in the main tsconfig build. The
 * sibling vitest.config.ts has been updated to include this directory.
 */

import { describe, it, expect } from "vitest";

import { tools as devTools } from "../src/tools/index.js";
import { tools as adminTools } from "../../iris-admin-mcp/src/tools/index.js";
import { tools as interopTools } from "../../iris-interop-mcp/src/tools/index.js";
import { tools as opsTools } from "../../iris-ops-mcp/src/tools/index.js";
import { tools as dataTools } from "../../iris-data-mcp/src/tools/index.js";

/** Map of package name to its registered tools for clearer failure messages. */
const serverTools = {
  "@iris-mcp/dev": devTools,
  "@iris-mcp/admin": adminTools,
  "@iris-mcp/interop": interopTools,
  "@iris-mcp/ops": opsTools,
  "@iris-mcp/data": dataTools,
} as const;

/** Flat list of every tool across every server, with source package tagged. */
const allTools: Array<{ pkg: string; name: string }> = Object.entries(
  serverTools
).flatMap(([pkg, tools]) => tools.map((t) => ({ pkg, name: t.name })));

/**
 * Anthropic Messages API `tools[].name` constraint:
 *   - Must match `^[a-zA-Z0-9_-]+$`
 *   - Must be 1-64 characters
 *
 * We use the stricter form `^[a-z0-9_]{1,64}$` (lowercase + underscore only,
 * no hyphens) to match the project's naming convention. This is a
 * deliberately stricter rule than Anthropic requires, because the project
 * standard is "all lowercase, underscore-separated".
 */
const TOOL_NAME_REGEX = /^[a-z0-9_]{1,64}$/;

describe("cross-server tool-naming regression guard (Story 9.2)", () => {
  it("registers tools from all 5 server packages", () => {
    // Sanity check that the imports actually loaded tools from every package.
    for (const [pkg, tools] of Object.entries(serverTools)) {
      expect(tools.length, `${pkg} should register at least one tool`).toBeGreaterThan(0);
    }
    // As of Epic 9 the suite totals 85 tools; we assert at-least-80 to leave
    // room for additions without forcing this guard to be updated on every
    // new tool.
    expect(allTools.length).toBeGreaterThanOrEqual(80);
  });

  it("every tool name matches /^[a-z0-9_]{1,64}$/", () => {
    const offenders = allTools.filter((t) => !TOOL_NAME_REGEX.test(t.name));
    expect(
      offenders,
      `The following tool names violate the flat-underscore naming convention required by the Anthropic Messages API:\n${offenders
        .map((t) => `  - ${t.pkg}: ${t.name}`)
        .join("\n")}`
    ).toEqual([]);
  });

  it("every tool name starts with the 'iris_' prefix", () => {
    const offenders = allTools.filter((t) => !t.name.startsWith("iris_"));
    expect(
      offenders,
      `The following tool names are missing the 'iris_' prefix:\n${offenders
        .map((t) => `  - ${t.pkg}: ${t.name}`)
        .join("\n")}`
    ).toEqual([]);
  });

  it("tool names are unique across the entire suite (no collisions)", () => {
    const seen = new Map<string, string>();
    const duplicates: Array<{ name: string; firstPkg: string; secondPkg: string }> = [];
    for (const { pkg, name } of allTools) {
      const firstPkg = seen.get(name);
      if (firstPkg !== undefined) {
        duplicates.push({ name, firstPkg, secondPkg: pkg });
      } else {
        seen.set(name, pkg);
      }
    }
    expect(
      duplicates,
      `The following tool names collide across server packages:\n${duplicates
        .map((d) => `  - "${d.name}" registered by both ${d.firstPkg} and ${d.secondPkg}`)
        .join("\n")}`
    ).toEqual([]);
  });
});
