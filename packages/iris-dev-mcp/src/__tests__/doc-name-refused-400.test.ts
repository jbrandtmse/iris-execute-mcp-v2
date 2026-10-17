/**
 * Story 39.7 (DW-569) - a document name Atelier refuses keeps its per-document reason in every tool that reads it.
 *
 * Atelier answers a name it refuses (for example a name with no document type) with HTTP 400, an EMPTY
 * `status.errors` and the reason only in the string `result.status` (captured live 2026-10-17, IRIS 2026.2 build 221U,
 * Atelier v8, HSCUSTOM: `GET` and `PUT` of `doc/ExecuteMCPv2.Utils` and `doc/Probe397NoType`). The shared client used to
 * return that answer as an envelope, and these tools read the reason from `result.status`. It now throws
 * `IrisApiError` for every non-2xx answer, so each tool reads the error's `result` through `atelierDocRequest` and its
 * output stays what it was. Every other 4xx still throws, which the last rows pin.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { IrisApiError, type ToolContext } from "@iris-mcp/shared";
import { docEditTool } from "../tools/doc-edit.js";
import { docGetTool, docPutTool } from "../tools/doc.js";
import { createMockHttp, createMockCtx, envelope } from "./test-helpers.js";

const NAME = "ExecuteMCPv2.Utils";
const REASON = `ERROR #16006: Document '${NAME}' name is invalid`;
const PATH = `/api/atelier/v7/USER/doc/${NAME}`;

/** The result IRIS puts in the 400 envelope for a refused name. */
const REFUSED_RESULT = { name: NAME, db: "", ts: "", cat: "OTH", enc: false, content: "", status: REASON };

/** The error the shared client throws for that answer. */
const refused = (method: string): IrisApiError =>
  new IrisApiError(400, [], PATH, `IRIS returned HTTP 400 for ${method} ${PATH}. Check the request parameters and try again.`, REFUSED_RESULT);

describe("a document name IRIS refuses (HTTP 400, empty error list, reason in result.status)", () => {
  let mockHttp: ReturnType<typeof createMockHttp>;
  let ctx: ToolContext;

  beforeEach(() => {
    mockHttp = createMockHttp();
    ctx = createMockCtx(mockHttp);
  });

  it("iris_doc_get reports IRIS's reason as an error, with and without a line range", async () => {
    const expected = {
      content: [
        {
          type: "text",
          text: `Document '${NAME}' could not be read in namespace 'USER': ${REASON}. Check the document name and namespace, then retry.`,
        },
      ],
      isError: true,
    };
    mockHttp.get.mockRejectedValue(refused("GET"));

    expect(await docGetTool.handler({ name: NAME }, ctx)).toStrictEqual(expected);
    expect(await docGetTool.handler({ name: NAME, startLine: 1 }, ctx)).toStrictEqual(expected);
    expect(await docGetTool.handler({ name: NAME, format: "xml" }, ctx)).toStrictEqual(expected);
  });

  it("iris_doc_put reports IRIS's reason as a refusal that stored nothing, on every save path", async () => {
    mockHttp.put.mockRejectedValue(refused("PUT"));
    const expected = {
      content: [
        {
          type: "text",
          text: `Document '${NAME}' was not saved in namespace 'USER': ${REASON}. Nothing was stored; correct the document text and retry.`,
        },
      ],
      structuredContent: REFUSED_RESULT,
      isError: true,
    };

    expect(await docPutTool.handler({ name: NAME, content: "Class X {}" }, ctx)).toStrictEqual(expected);
    expect(await docPutTool.handler({ name: NAME, content: "Class X {}", ignoreConflict: true }, ctx)).toStrictEqual(expected);
    expect(mockHttp.put).toHaveBeenCalledTimes(2);
  });

  it("iris_doc_edit reports IRIS's reason when it cannot read the document", async () => {
    mockHttp.get.mockRejectedValue(refused("GET"));

    const result = await docEditTool.handler(
      { action: "apply", name: NAME, edits: [{ op: "delete", startLine: 1, endLine: 1, expected: "x" }] },
      ctx,
    );

    expect(result).toEqual({
      content: [
        {
          type: "text",
          text: `Document '${NAME}' could not be read in namespace 'USER': ${REASON}. Check the document name and namespace, then retry.`,
        },
      ],
      isError: true,
    });
    expect(mockHttp.put).not.toHaveBeenCalled();
  });

  it("every other failure still throws: a 400 that lists errors, a 400 with no status text, and a 404 on a get", async () => {
    const withErrors = new IrisApiError(400, [{ error: "boom" }], PATH, "m", REFUSED_RESULT);
    const noStatus = new IrisApiError(400, [], PATH, "m", { content: "" });
    mockHttp.get.mockRejectedValueOnce(withErrors).mockRejectedValueOnce(noStatus);

    await expect(docGetTool.handler({ name: NAME }, ctx)).rejects.toBe(withErrors);
    await expect(docGetTool.handler({ name: NAME }, ctx)).rejects.toBe(noStatus);

    mockHttp.put.mockRejectedValueOnce(noStatus);
    await expect(docPutTool.handler({ name: NAME, content: "Class X {}", ignoreConflict: true }, ctx)).rejects.toBe(noStatus);

    mockHttp.get.mockRejectedValueOnce(new IrisApiError(404, [], PATH, "m", REFUSED_RESULT));
    const missing = await docGetTool.handler({ name: NAME }, ctx);
    expect(missing.isError).toBe(true);
    expect(missing.content[0]?.text).toBe(`Document '${NAME}' not found in namespace 'USER'`);
  });

  it("a read that succeeds is untouched", async () => {
    const result = { name: "Test.cls", db: "USER", ts: "2026-10-17 10:00:00.000", cat: "CLS", status: "", enc: false, flags: 0, content: ["Class Test {", "}"] };
    mockHttp.get.mockResolvedValue(envelope(result));

    const read = await docGetTool.handler({ name: "Test.cls" }, ctx);

    expect(read.structuredContent).toEqual(result);
    expect(read.isError).toBeUndefined();
  });
});
