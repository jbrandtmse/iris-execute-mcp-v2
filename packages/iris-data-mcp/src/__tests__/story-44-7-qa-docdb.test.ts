/**
 * Story 44.7 QA (DW-723, DW-724, DW-725; Rules #8, #13, #19, #54, #59) - the gaps the build's tests leave in
 * `iris_docdb_property`.
 *
 * Pinned here, beyond `docdb.test.ts` and the AC 44.1.7 request lists:
 *  - the `path` input: its schema (optional, at least one character), the default `$.<property>`, an explicit path, and the exact
 *    encoding of each, next to the unchanged `type` query parameter;
 *  - `create` and `drop` keep their whole result (text and structured member for member): no `indexed` or `created` member leaks
 *    into them, `drop` sends one DELETE with no query and ignores a `path`;
 *  - `index` of a property that exists: the exact result text and key order; of one that is missing: the namespace override reaches
 *    both requests; a failing POST after the read keeps today's catch path (the 822 translation included);
 *  - "missing" is decided by the numeric code 25541 alone (Rules #8/#13): text that says 25541 without the code is NOT missing,
 *    and the code in any entry of `errors` is;
 *  - the description claims of DW-724/DW-725 that the sanctioned goldens do not name word for word.
 *
 * The fakes are the shapes captured live on 2026-11-23 (irishealth-community 2026.2): the 400 for a GET of a missing property
 * carries `{"error":"ERROR #25541: ...","code":25541,"domain":"%ObjectErrors","id":"DocumentDatabasePropertyDoesNotExist"}`.
 * Mocked HTTP only, no IRIS.
 */

import { describe, it, expect, beforeEach } from "vitest";
import type { ToolContext } from "@iris-mcp/shared";
import { IrisApiError } from "@iris-mcp/shared";
import { docdbManageTool, docdbPropertyTool } from "../tools/docdb.js";
import { createMockHttp, createMockCtx, envelope } from "@iris-mcp/shared/test-helpers";

const DEFINITION = { content: { Name: "age", Type: "%Library.String" } };
const PROP_URL = "/api/docdb/v1/USER/prop/TestDB/age";

const missingEntry = {
  error: "ERROR #25541: DocDB Property 'age' does not exist in 'ISC.DM.TestDB'",
  code: 25541,
  domain: "%ObjectErrors",
  id: "DocumentDatabasePropertyDoesNotExist",
};
const rejection = (errors: unknown[], status = 400): IrisApiError =>
  new IrisApiError(status, errors, PROP_URL, `IRIS returned HTTP ${status} for GET ${PROP_URL}.`);

describe("iris_docdb_property: the path input (Story 44.7 QA)", () => {
  it("is optional, and a path must have at least one character", () => {
    const schema = docdbPropertyTool.inputSchema;
    const base = { action: "create", database: "TestDB", property: "p", type: "%String" };

    expect(schema.safeParse(base).success).toBe(true);
    expect(schema.safeParse({ ...base, path: "$.a.b" }).success).toBe(true);
    expect(schema.safeParse({ ...base, path: "" }).success).toBe(false);
    expect(schema.safeParse({ ...base, path: 7 }).success).toBe(false);
  });
});

describe("iris_docdb_property: create and drop, byte for byte (Story 44.7 QA)", () => {
  let mockHttp: ReturnType<typeof createMockHttp>;
  let ctx: ToolContext;

  beforeEach(() => {
    mockHttp = createMockHttp();
    ctx = createMockCtx(mockHttp);
  });

  it("create sends one POST and nothing else, with the type first and the default path second", async () => {
    mockHttp.post.mockResolvedValue(DEFINITION);

    await docdbPropertyTool.handler(
      { action: "create", database: "TestDB", property: "age", type: "%Library.Integer" },
      ctx,
    );

    expect(mockHttp.post.mock.calls).toEqual([[`${PROP_URL}?type=%Library.Integer&path=%24.age`, {}]]);
    expect(mockHttp.get).not.toHaveBeenCalled();
    expect(mockHttp.put).not.toHaveBeenCalled();
    expect(mockHttp.delete).not.toHaveBeenCalled();
  });

  it("create encodes a property with a space in the default path, and an explicit path as given", async () => {
    mockHttp.post.mockResolvedValue(DEFINITION);

    await docdbPropertyTool.handler({ action: "create", database: "TestDB", property: "my prop", type: "%String" }, ctx);
    await docdbPropertyTool.handler(
      { action: "create", database: "TestDB", property: "item", type: "%String", path: "$.items[0].name" },
      ctx,
    );

    expect(mockHttp.post.mock.calls).toEqual([
      ["/api/docdb/v1/USER/prop/TestDB/my%20prop?type=%String&path=%24.my%20prop", {}],
      [`/api/docdb/v1/USER/prop/TestDB/item?type=%String&path=${encodeURIComponent("$.items[0].name")}`, {}],
    ]);
  });

  it("create returns the IRIS reply untouched: no indexed or created member, text and structured content identical", async () => {
    const reply = { content: { Name: "age", Type: "%Library.String" } };
    mockHttp.post.mockResolvedValue(reply);

    const result = await docdbPropertyTool.handler(
      { action: "create", database: "TestDB", property: "age", type: "%String" },
      ctx,
    );

    expect(result).toEqual({
      content: [{ type: "text", text: JSON.stringify(reply, null, 2) }],
      structuredContent: reply,
    });
    expect(result.structuredContent).not.toHaveProperty("indexed");
    expect(result.structuredContent).not.toHaveProperty("created");
  });

  it("create without a type is still refused before any request, even with a path", async () => {
    const result = await docdbPropertyTool.handler(
      { action: "create", database: "TestDB", property: "age", path: "$.age" },
      ctx,
    );

    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toBe("Error: 'type' is required for 'create' action");
    expect(mockHttp.post).not.toHaveBeenCalled();
  });

  it("drop sends one DELETE with no query, ignores a path, and returns the reply untouched", async () => {
    const reply = { content: { Name: "age" } };
    mockHttp.delete.mockResolvedValue(reply);

    const result = await docdbPropertyTool.handler(
      { action: "drop", database: "TestDB", property: "age", path: "$.elsewhere" },
      ctx,
    );

    expect(mockHttp.delete.mock.calls).toEqual([[PROP_URL]]);
    expect(mockHttp.get).not.toHaveBeenCalled();
    expect(mockHttp.post).not.toHaveBeenCalled();
    expect(result).toEqual({
      content: [{ type: "text", text: JSON.stringify(reply, null, 2) }],
      structuredContent: reply,
    });
  });
});

describe("iris_docdb_property: index (Story 44.7 QA)", () => {
  let mockHttp: ReturnType<typeof createMockHttp>;
  let ctx: ToolContext;

  beforeEach(() => {
    mockHttp = createMockHttp();
    ctx = createMockCtx(mockHttp);
  });

  it("an existing property: the text is the definition, then indexed, then created, in that order", async () => {
    mockHttp.get.mockResolvedValue(DEFINITION);

    const result = await docdbPropertyTool.handler({ action: "index", database: "TestDB", property: "age" }, ctx);

    expect(result.content).toEqual([
      { type: "text", text: JSON.stringify({ content: DEFINITION.content, indexed: true, created: false }, null, 2) },
    ]);
    expect(Object.keys(result.structuredContent as object)).toEqual(["content", "indexed", "created"]);
  });

  it("a definition wrapped in an Atelier-style result member is unwrapped before the outcome is added", async () => {
    mockHttp.get.mockResolvedValue({ result: DEFINITION });

    const result = await docdbPropertyTool.handler({ action: "index", database: "TestDB", property: "age" }, ctx);

    expect(result.structuredContent).toEqual({ ...DEFINITION, indexed: true, created: false });
  });

  it("the namespace override reaches the read and the create", async () => {
    mockHttp.get.mockRejectedValue(rejection([missingEntry]));
    mockHttp.post.mockResolvedValue(DEFINITION);

    await docdbPropertyTool.handler({ action: "index", database: "TestDB", property: "age", namespace: "HSCUSTOM" }, ctx);

    expect(mockHttp.get.mock.calls).toEqual([["/api/docdb/v1/HSCUSTOM/prop/TestDB/age"]]);
    expect(mockHttp.post.mock.calls).toEqual([["/api/docdb/v1/HSCUSTOM/prop/TestDB/age?path=%24.age", { index: true }]]);
  });

  it("a missing property is created with a body of exactly { index: true } and the result says created: true", async () => {
    mockHttp.get.mockRejectedValue(rejection([missingEntry]));
    mockHttp.post.mockResolvedValue(DEFINITION);

    const result = await docdbPropertyTool.handler({ action: "index", database: "TestDB", property: "age" }, ctx);

    expect(mockHttp.post.mock.calls[0]?.[1]).toEqual({ index: true });
    expect(result.content).toEqual([
      { type: "text", text: JSON.stringify({ content: DEFINITION.content, indexed: true, created: true }, null, 2) },
    ]);
  });

  it("'missing' is the numeric code in any entry of errors, whatever the text says", async () => {
    mockHttp.get.mockRejectedValue(
      rejection([{ error: "some other entry", code: 1 }, { error: "texte localisé", code: 25541 }]),
    );
    mockHttp.post.mockResolvedValue(DEFINITION);

    const result = await docdbPropertyTool.handler({ action: "index", database: "TestDB", property: "age" }, ctx);

    expect(mockHttp.post).toHaveBeenCalledTimes(1);
    expect((result.structuredContent as { created: boolean }).created).toBe(true);
  });

  it("text that says #25541 without the numeric code is not 'missing': the error is reported and nothing is created (Rules #8, #13)", async () => {
    const textOnly = rejection([{ error: "ERROR #25541: DocDB Property 'age' does not exist" }, "ERROR #25541: as a string"]);
    mockHttp.get.mockRejectedValue(textOnly);

    const result = await docdbPropertyTool.handler({ action: "index", database: "TestDB", property: "age" }, ctx);

    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toBe(`Error managing property 'age': ${textOnly.message}`);
    expect(mockHttp.post).not.toHaveBeenCalled();
  });

  it("an error entry with a different code is not 'missing', and no write follows", async () => {
    mockHttp.get.mockRejectedValue(rejection([{ error: "ERROR #5805: ID key not unique", code: 5805 }]));

    const result = await docdbPropertyTool.handler({ action: "index", database: "TestDB", property: "age" }, ctx);

    expect(result.isError).toBe(true);
    expect(mockHttp.post).not.toHaveBeenCalled();
  });

  it("a create that fails after the read keeps today's catch path: the IRIS text, isError, and no second POST", async () => {
    mockHttp.get.mockRejectedValue(rejection([missingEntry]));
    const failure = new IrisApiError(400, [{ error: "ERROR #5001: boom", code: 5001 }], PROP_URL, "IRIS returned HTTP 400 for POST.");
    mockHttp.post.mockRejectedValue(failure);

    const result = await docdbPropertyTool.handler({ action: "index", database: "TestDB", property: "age" }, ctx);

    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toBe(`Error managing property 'age': ${failure.message}`);
    expect(mockHttp.get).toHaveBeenCalledTimes(1); // the read only: a non-822 error probes no service state
    expect(mockHttp.post).toHaveBeenCalledTimes(1);
  });

  it("a disabled-service 822 on the create after the read is translated like any other DocDB 822", async () => {
    mockHttp.get.mockImplementation((url: string) =>
      url.includes("/api/executemcp/v2/security/service")
        ? Promise.resolve(
            envelope({ name: "%Service_DocDB", enabled: false, description: "Controls Doc DB applications", autheEnabled: 1024, clientSystems: "" }),
          )
        : Promise.reject(rejection([missingEntry])),
    );
    mockHttp.post.mockRejectedValue(
      new IrisApiError(
        200,
        [{ error: "ERROR #822: Access Denied", code: 822, domain: "%ObjectErrors", id: "AccessDenied" }],
        PROP_URL,
        "IRIS reported errors for POST.",
      ),
    );

    const result = await docdbPropertyTool.handler({ action: "index", database: "TestDB", property: "age" }, ctx);

    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toContain("%Service_DocDB");
    expect(result.content[0]!.text).toContain("currently DISABLED");
  });

  it("a system name is refused before any request, in any form that starts with a percent sign", async () => {
    for (const property of ["%", "%Doc", "%DocumentId", "%x"]) {
      const result = await docdbPropertyTool.handler({ action: "index", database: "TestDB", property }, ctx);
      expect(result.isError).toBe(true);
      expect(result.content[0]!.text).toBe(
        `Error: DocDB REST cannot index a system property ('${property}'). Only a property you created can be indexed.`,
      );
    }
    expect(mockHttp.get).not.toHaveBeenCalled();
    expect(mockHttp.post).not.toHaveBeenCalled();
  });

  it("a name with a percent sign inside is not a system name", async () => {
    mockHttp.get.mockResolvedValue(DEFINITION);

    const result = await docdbPropertyTool.handler({ action: "index", database: "TestDB", property: "a%b" }, ctx);

    expect(result.isError).toBeUndefined();
    expect(mockHttp.get).toHaveBeenCalledWith("/api/docdb/v1/USER/prop/TestDB/a%25b");
  });
});

describe("the DocDB descriptions state what the tools do (Story 44.7 QA)", () => {
  it("iris_docdb_manage no longer claims create takes property definitions, and points at iris_docdb_property", () => {
    expect(docdbManageTool.description).not.toMatch(/property definitions/i);
    expect(docdbManageTool.description).toContain("iris_docdb_property");
  });

  it("iris_docdb_property says where the property is filled from, what an older document needs, and that index does not write", () => {
    const text = docdbPropertyTool.description.replace(/\s+/g, " ");
    expect(text).toContain("'path'");
    expect(text).toContain("$.<property>");
    expect(text).toContain("not filled in until they are saved again");
    expect(text).toContain("indexes every property it creates");
    expect(text).toContain("'index' reports an existing property as indexed without writing anything");
    expect(text).toContain("A system property (a name starting with '%') cannot be indexed");
  });
});
