/**
 * Story 44.7 QA (DW-757; Rules #19, #54, #59) - the gaps the build's tests leave in the TypeScript side of
 * `iris_database_manage` `delete`.
 *
 * The dismount itself is IRIS-side (`ExecuteMCPv2.Tests.DatabaseDeleteTest`, run live). This tool only forwards the request and the
 * reply, so what can break here is the wire: the request body, the reply member for member (text and structured content), the
 * three `dismountNote` texts of `Config.cls` reaching the caller verbatim, a reply from an instance whose embed has no
 * `dismounted` member yet, and the tool's shape (actions and inputs unchanged).
 *
 * The reply shapes are the ones `Config.cls` `DeleteDatabaseEntry` builds (`{"action":"deleted","name":...,"dismounted":bool}` plus
 * `dismountNote` when it did not dismount). Mocked HTTP only, no IRIS.
 */

import { describe, it, expect, beforeEach } from "vitest";
import type { ToolContext } from "@iris-mcp/shared";
import { IrisApiError } from "@iris-mcp/shared";
import { databaseManageTool } from "../tools/database.js";
import { createMockHttp, createMockCtx, envelope } from "@iris-mcp/shared/test-helpers";

const ROUTE = "/api/executemcp/v2/config/database";

describe("iris_database_manage delete: the wire (Story 44.7 QA)", () => {
  let mockHttp: ReturnType<typeof createMockHttp>;
  let ctx: ToolContext;

  beforeEach(() => {
    mockHttp = createMockHttp();
    ctx = createMockCtx(mockHttp);
  });

  it("dismounted:false with a note: the text is the reply as pretty JSON, the structured content is the reply, and isError is absent", async () => {
    const reply = {
      action: "deleted",
      name: "OLDDB",
      dismounted: false,
      dismountNote: "Not dismounted: the configured database 'OTHER' uses the same directory.",
    };
    mockHttp.post.mockResolvedValue(envelope({ ...reply }));

    const result = await databaseManageTool.handler({ action: "delete", name: "OLDDB" }, ctx);

    expect(result).toEqual({
      content: [{ type: "text", text: JSON.stringify(reply, null, 2) }],
      structuredContent: reply,
    });
    expect(Object.keys(result.structuredContent as object)).toEqual(["action", "name", "dismounted", "dismountNote"]);
  });

  it("each dismountNote Config.cls can build reaches the caller verbatim", async () => {
    const notes = [
      "Not dismounted: the configured databases could not be listed to check whether the directory is shared.",
      "Not dismounted: the directory of the database could not be read.",
      "The configuration entry was removed, but the database could not be dismounted: Database is in use",
    ];
    for (const dismountNote of notes) {
      mockHttp.post.mockResolvedValueOnce(envelope({ action: "deleted", name: "OLDDB", dismounted: false, dismountNote }));

      const result = await databaseManageTool.handler({ action: "delete", name: "OLDDB" }, ctx);

      expect((result.structuredContent as { dismountNote: string }).dismountNote).toBe(dismountNote);
      expect(result.isError).toBeUndefined();
    }
  });

  it("a reply with no dismounted member (an instance whose embed predates the story) passes through unchanged", async () => {
    mockHttp.post.mockResolvedValue(envelope({ action: "deleted", name: "OLDDB" }));

    const result = await databaseManageTool.handler({ action: "delete", name: "OLDDB" }, ctx);

    expect(result.structuredContent).toEqual({ action: "deleted", name: "OLDDB" });
    expect(result.structuredContent).not.toHaveProperty("dismounted");
  });

  it("the request carries exactly the fields the caller gave, as before: delete adds none and drops none", async () => {
    mockHttp.post.mockResolvedValue(envelope({ action: "deleted", name: "OLDDB", dismounted: true }));

    await databaseManageTool.handler({ action: "delete", name: "OLDDB", directory: "/d/old/", size: 5, readOnly: false }, ctx);

    expect(mockHttp.post.mock.calls).toEqual([
      [ROUTE, { action: "delete", name: "OLDDB", directory: "/d/old/", size: 5, readOnly: false }],
    ]);
    expect(mockHttp.get).not.toHaveBeenCalled();
  });

  it("an IRIS error is reported with today's text and isError, and a transport failure is rethrown", async () => {
    const refusal = new IrisApiError(
      400,
      [{ error: "ERROR #429: Cannot delete database USER, in use by the following namespaces: USER" }],
      ROUTE,
      "IRIS reported errors. Details: Cannot delete database USER, in use by the following namespaces: USER",
    );
    mockHttp.post.mockRejectedValueOnce(refusal);

    const result = await databaseManageTool.handler({ action: "delete", name: "USER" }, ctx);

    expect(result).toEqual({
      content: [{ type: "text", text: `Error managing database 'USER': ${refusal.message}` }],
      isError: true,
    });

    mockHttp.post.mockRejectedValueOnce(new Error("ECONNRESET"));
    await expect(databaseManageTool.handler({ action: "delete", name: "USER" }, ctx)).rejects.toThrow("ECONNRESET");
  });
});

describe("iris_database_manage: the tool's shape is unchanged (Story 44.7 QA)", () => {
  it("the actions and the inputs are the ones it had before the story", () => {
    const shape = (databaseManageTool.inputSchema as unknown as { shape: Record<string, { options?: string[] }> }).shape;

    expect(Object.keys(shape).sort()).toEqual(
      [
        "action",
        "directory",
        "expansionSize",
        "globalJournalState",
        "maxSize",
        "mountAtStartup",
        "mountRequired",
        "name",
        "readOnly",
        "resource",
        "size",
      ].sort(),
    );
    expect([...(shape["action"]?.options ?? [])]).toEqual(["create", "modify", "delete"]);
  });

  it("the description names the two reply members and the shared-directory exception", () => {
    const text = databaseManageTool.description.replace(/\s+/g, " ");

    expect(text).toContain("unless another configured database uses the same directory");
    expect(text).toContain("'dismounted: false'");
    expect(text).toContain("'dismountNote'");
  });
});
