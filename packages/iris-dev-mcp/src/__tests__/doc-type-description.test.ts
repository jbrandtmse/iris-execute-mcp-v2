/**
 * The `type` parameter description of `iris_doc_list`, `iris_package_list` and `iris_doc_export`
 * (Story 39.0, DW-567, AC-8), as a connected MCP client reads it.
 *
 * The old text offered `'cls'` as the type for category CLS, which Atelier answers with HTTP 400, so an
 * agent that followed the description failed. The three tools now share one text,
 * `DOC_TYPE_DESCRIPTION`. A real SDK `Client` is connected to a constructed dev server over
 * `InMemoryTransport.createLinkedPair()`, so the descriptions are read from `tools/list` as the wire
 * serializes them, not from the Zod schemas (Rule #46).
 *
 * Probe, 2026-10-16: read-only `GET /api/atelier/v8/HSCUSTOM/docnames/<category>/<type>` on IRIS 2026.2
 * build 221U (Atelier v8; source `irislib/%Api/Atelier/v1.cls` `GetDocNames`):
 *   - HTTP 200: category RTN with type mac, int, inc, bas, mvi, mvb and mac,inc; category * with type cls;
 *     category CLS with type *.
 *   - HTTP 400 with an empty error list: category CLS with type cls, and category RTN with type cls.
 * Every example the description offers must be one of the 200 rows; the expected text below is the
 * Story 39.0 spec's, copied by hand, so this test cannot agree with the constant by construction.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServerBase } from "@iris-mcp/shared";
import { makeEnvHarness } from "@iris-mcp/shared/test-helpers";
import { tools } from "../tools/index.js";
import { toolPresets } from "../tools/presets.js";
import { DOC_TYPE_DESCRIPTION } from "../tools/doc.js";

const EXPECTED_TEXT =
  "Document type filter within the category: the file extension without the dot. " +
  "RTN takes 'mac', 'int', 'inc', 'bas', 'mvi' or 'mvb', or a comma list such as 'mac,inc'. " +
  "CLS takes no type filter (leave it unset). " +
  "With category '*', 'cls' lists only classes. " +
  "Default: all types within the chosen category.";

/** The `type` values that returned HTTP 200 in the probe (the `*` category row is the `'cls'` one). */
const PROBED_200_TYPES = new Set(["mac", "int", "inc", "bas", "mvi", "mvb", "mac,inc", "cls"]);

const TOOLS_WITH_TYPE = ["iris_doc_list", "iris_package_list", "iris_doc_export"] as const;

describe("the type description of the document-listing tools, as tools/list advertises it (Story 39.0, DW-567, AC-8)", () => {
  const env = makeEnvHarness({ mockFetch: false });
  beforeEach(env.setup);
  afterEach(env.teardown);

  async function advertisedTypeDescriptions(): Promise<Map<string, string | undefined>> {
    const server = new McpServerBase({ name: "@iris-mcp/dev", version: "0.0.0", tools, toolPresets, needsCustomRest: false });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "doc-type-description", version: "0.0.0" });
    await Promise.all([server.server.connect(serverTransport), client.connect(clientTransport)]);
    try {
      const listed = await client.listTools();
      const found = new Map<string, string | undefined>();
      for (const tool of listed.tools) {
        const properties = (tool.inputSchema as { properties?: Record<string, { description?: string }> }).properties;
        found.set(tool.name, properties?.["type"]?.description);
      }
      return found;
    } finally {
      await client.close().catch(() => {});
      await server.server.close().catch(() => {});
    }
  }

  it("all three tools advertise the one shared text, which is the text the spec fixes", async () => {
    const found = await advertisedTypeDescriptions();
    for (const name of TOOLS_WITH_TYPE) {
      expect(found.get(name), `${name} advertises a type description`).toBeDefined();
      expect(found.get(name), `${name} equals the shared constant`).toBe(DOC_TYPE_DESCRIPTION);
      expect(found.get(name), `${name} equals the spec's text`).toBe(EXPECTED_TEXT);
    }
    expect(DOC_TYPE_DESCRIPTION).toBe(EXPECTED_TEXT);
  });

  it("does not offer 'cls' for category CLS, says CLS takes no type filter, and offers only probed examples", async () => {
    const found = await advertisedTypeDescriptions();
    for (const name of TOOLS_WITH_TYPE) {
      const description = found.get(name) as string;
      expect(description, name).not.toContain("'cls' for CLS");
      expect(description, name).not.toContain("e.g., 'cls'");
      expect(description, name).toContain("CLS takes no type filter");
      const examples = [...description.matchAll(/'([^']+)'/g)].map((match) => match[1] as string);
      expect(examples.length, `${name} offers examples`).toBeGreaterThan(0);
      for (const example of examples) {
        // `'*'` is the category the `'cls'` example is paired with, not a type.
        if (example === "*") continue;
        expect(PROBED_200_TYPES.has(example), `${name} offers '${example}', which Atelier must accept (HTTP 200 in the probe)`).toBe(true);
      }
    }
  });
});
