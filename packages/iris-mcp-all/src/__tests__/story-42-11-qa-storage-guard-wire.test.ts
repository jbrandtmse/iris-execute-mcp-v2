/**
 * Story 42.11 QA (AC 42.11.1, 42.11.2, AD-15, AD-34, Rules #3, #46, #59) - the Storage guard on `iris_doc_load`, the `iris_doc_xml_export`
 * import and `iris_env_promote` execute, on the REAL wire: the BUILT iris-dev-mcp server over stdio, the hand driver of
 * `story-43-2-qa-hand-wire.ts` on the 2025-11-25 handshake and on revision 2026-07-28, and real HTTP to local listeners (127.0.0.1; no
 * IRIS instance is reached, so the file runs in the default suite).
 *
 * The unit suites call the handlers with arguments that no client's argument parsing has touched, and the live gate
 * (`storage-guard-write-paths-live-gate.test.ts`) skips unless it is armed. This file is what the default suite holds of the three paths as
 * a client reaches them: the MCP argument parsing, the governance gate, the HTTP client, the guard, the confirmation dialog and back.
 *
 * The persistent class `Demo.Stored.cls` of the fake listener has `Storage Default`. A small proxy stands in front of the `default` profile's
 * listener: it forwards every request, answers `Demo.Stored.cls` with a text that has no Storage when a test says the SOURCE copy of the class
 * lacks it (a promotion's source), and answers the `xml/load` POST that the fake has no route for. The proxy's own log, and the log of the
 * second listener (the profile `other`, a promotion's target), are the evidence of what reached IRIS.
 *
 * Per path and era: the default refusal (`isError`, the code, the dropped names, the exact text of the Design Notes, no write reached IRIS,
 * and on promote no dialog was put to the person); the override (the write that IRIS received, `storageDrops` in the result, and on promote
 * the dialog's scope that names the drop and the PUT body that is the source text); a decline after the override's dialog (the reads were
 * made, nothing was written). The expected texts and requests are written from the story's Design Notes (Rule #36), never taken from the
 * code under test. The file fails, never skips, on a stale dist.
 */

import http from "node:http";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { resultOf, type Json } from "./story-43-2-qa-hand-wire.js";
import { PROMOTE_DIFF, promoteArgs } from "./story-43-3-qa-gates.js";
import {
  DECLINED,
  ELICITING,
  ERAS,
  TICKED,
  connect,
  declinedText,
  dialogMessage,
  openRig,
  requireFreshDists,
  stopAllRigs,
  type Era,
} from "./story-43-3-qa-wire.js";

requireFreshDists("iris-dev-mcp");
afterEach(stopAllRigs);

const TIMEOUT = 60_000;
const NAMESPACE = "HSCUSTOM";
const DOC_PATH = `/api/atelier/v8/${NAMESPACE}/doc/Demo.Stored.cls`;
const XML_LOAD_PATH = `/api/atelier/v8/${NAMESPACE}/action/xml/load`;
const COMPILE_REQUEST = `POST /api/atelier/v8/${NAMESPACE}/action/compile?flags=cuk ["Demo.Stored.cls"]`;

/** The class `Demo.Stored` as a copy that has no Storage definition: what a source that was never compiled holds. */
const NO_STORAGE_LINES = ["Class Demo.Stored Extends %Persistent", "{", "", "Property A As %String;", "", "Property B As %String;", "", "}"];

const WHY = "and IRIS would generate new storage at the next compile, which can change how existing rows are read.";
const LOAD_REMEDY =
  "Keep the Storage definitions in the file (read the class with iris_doc_get first), " +
  "or pass allowStorageRegeneration: true to let IRIS regenerate the storage.";
const IMPORT_REMEDY =
  "Keep each class's Storage elements in the XML (export the classes with iris_doc_xml_export first), " +
  "or pass allowStorageRegeneration: true to let IRIS regenerate the storage.";
const PROMOTE_REMEDY =
  "Promote source copies that keep those Storage definitions, or pass allowStorageRegeneration: true to let IRIS regenerate the storage on the target.";
const DROP = { name: "Demo.Stored.cls", droppedStorage: ["Default"] };
const DROP_NOTE =
  "Storage definitions dropped (allowStorageRegeneration; IRIS generates new storage at the next compile): Demo.Stored.cls ('Default').";

// -- the proxy in front of the `default` profile's listener ------------------------------------------------------------------

/** A reply in the Atelier envelope: no errors, no console, and `result`. */
const atelierReply = (result: unknown): string => JSON.stringify({ status: { errors: [], summary: "" }, console: [], result });

/** The class `Demo.Stored` as the fake listener holds it: one `Storage Default` definition. */
const STORED_LINES = [
  "Class Demo.Stored Extends %Persistent",
  "{",
  "Property A As %String;",
  "Storage Default",
  "{",
  "<DataLocation>^Demo.StoredD</DataLocation>",
  "<Type>%Storage.Persistent</Type>",
  "}",
  "}",
];

/** The nine-key document of `Demo.Stored.cls`, as Atelier answers a GET and as it carries in a 409. */
const storedDocument = (lines: string[]): Record<string, unknown> => ({
  name: "Demo.Stored.cls",
  db: NAMESPACE,
  ts: "2026-01-01 00:00:00.000",
  upd: false,
  cat: "CLS",
  status: "",
  enc: false,
  flags: 0,
  content: lines,
});

/** What the proxy answers itself; every other request is forwarded to the listener. */
interface ProxyOptions {
  /** Answer a GET of `Demo.Stored.cls` with a document whose text is these lines (the fake listener's own answer has `Storage Default`). */
  storedLines?: string[];
  /** Answer the `xml/load` POST (the fake listener has no route for it) with a clean load of `Demo.Stored.cls`. */
  answerXmlLoad?: boolean;
  /**
   * Answer a PUT of `Demo.Stored.cls` that carries no version token and no `ignoreConflict` query the way Atelier answers a PUT to an
   * existing document: HTTP 409, whose result is the current document with these lines, and nothing stored.
   */
  conflictLines?: string[];
}

interface StorageProxy {
  interpose: (upstreamPort: number) => Promise<{ port: number; close: () => Promise<void> }>;
  /** The port the server's `default` profile reaches: the proxy's own. */
  port: () => number;
  /** Every request the proxy received, as `METHOD url body`, without the startup bootstrap queries. */
  requests: () => string[];
}

function storageProxy(options: ProxyOptions): StorageProxy {
  const seen: string[] = [];
  let listening = 0;
  return {
    port: () => listening,
    requests: () => seen,
    interpose: async (upstreamPort) => {
      const server = http.createServer((req, res) => {
        const chunks: Buffer[] = [];
        req.on("data", (chunk: Buffer) => chunks.push(chunk));
        req.on("end", () => {
          const body = Buffer.concat(chunks);
          const method = req.method ?? "";
          const url = req.url ?? "";
          if (!url.endsWith("/action/query")) seen.push(`${method} ${url}${body.length === 0 ? "" : ` ${body.toString()}`}`);
          if (method === "GET" && url === DOC_PATH && options.storedLines !== undefined) {
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(atelierReply(storedDocument(options.storedLines)));
            return;
          }
          if (method === "PUT" && url === DOC_PATH && options.conflictLines !== undefined && req.headers["if-none-match"] === undefined) {
            res.writeHead(409, { "Content-Type": "application/json" });
            res.end(atelierReply(storedDocument(options.conflictLines)));
            return;
          }
          if (method === "POST" && url.startsWith(XML_LOAD_PATH) && options.answerXmlLoad === true) {
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(atelierReply({ content: [{ file: "import.xml", imported: ["Demo.Stored.cls"], status: "" }] }));
            return;
          }
          const upstream = http.request({ host: "127.0.0.1", port: upstreamPort, method, path: url, headers: req.headers }, (reply) => {
            res.writeHead(reply.statusCode ?? 502, reply.headers);
            reply.pipe(res);
          });
          upstream.on("error", () => {
            res.writeHead(502);
            res.end();
          });
          upstream.end(body);
        });
      });
      await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
      listening = (server.address() as { port: number }).port;
      return {
        port: listening,
        close: () =>
          new Promise<void>((resolve) => {
            server.closeAllConnections();
            server.close(() => resolve());
          }),
      };
    },
  };
}

// -- helpers ------------------------------------------------------------------------------------------------------------------

/** The requests of `log` that write: a POST, PUT or DELETE (the startup queries are not in the proxy's log). */
const writesIn = (log: string[]): string[] => log.filter((line) => /^(POST|PUT|DELETE) /.test(line));
const docGetsIn = (log: string[]): string[] => log.filter((line) => line.startsWith("GET ") && line.includes("/doc/"));

/** The `PUT` request line of a document body with `lines`, as the client sends it. */
const putLine = (lines: string[]): string => `PUT ${DOC_PATH}?ignoreConflict=1 ${JSON.stringify({ enc: false, content: lines })}`;

describe.each(ERAS)("Story 42.11 QA: the Storage guard on the wire (%s era)", (era: Era) => {
  let scratch: string;
  let filePath: string;

  beforeEach(() => {
    scratch = mkdtempSync(path.join(realpathSync(tmpdir()), "qa-story-4211-wire-"));
    mkdirSync(path.join(scratch, "src", "Demo"), { recursive: true });
    filePath = path.join(scratch, "src", "Demo", "Stored.cls");
    writeFileSync(filePath, NO_STORAGE_LINES.join("\n"), "utf8");
  });

  afterEach(() => {
    rmSync(scratch, { recursive: true, force: true });
  });

  describe("iris_doc_load", () => {
    const loadArgs = (): Json => ({ path: `${scratch}/src/**/Stored.cls` });

    it(
      "refuses a file that drops the class's Storage: isError, STORAGE_DROPPED, the Design Notes text, and no PUT reached IRIS",
      async () => {
        const proxy = storageProxy({});
        const rig = await openRig({ pkg: "iris-dev-mcp", interpose: proxy.interpose });
        const conn = await connect(rig, era, {});

        const result = resultOf(await conn.call("iris_doc_load", loadArgs()).end());

        expect(result.isError).toBe(true);
        expect(result.structuredContent).toEqual({
          total: 1,
          uploaded: 0,
          failed: 1,
          failures: [
            {
              file: filePath,
              docName: "Demo.Stored.cls",
              error:
                `Document 'Demo.Stored.cls' was not saved in namespace '${NAMESPACE}': the content drops the Storage definition 'Default' ` +
                `that the class has now, ${WHY} Nothing was stored. ${LOAD_REMEDY}`,
              code: "STORAGE_DROPPED",
              droppedStorage: ["Default"],
            },
          ],
        });
        expect(docGetsIn(proxy.requests())).toEqual([`GET ${DOC_PATH}`]);
        expect(writesIn(proxy.requests())).toEqual([]);
      },
      TIMEOUT,
    );

    it(
      "with allowStorageRegeneration the one ?ignoreConflict=1 PUT reaches IRIS with the file's text, and storageDrops names the drop; the string form is read as the sibling parameters are",
      async () => {
        for (const flag of [true, "true"]) {
          const proxy = storageProxy({});
          const rig = await openRig({ pkg: "iris-dev-mcp", interpose: proxy.interpose });
          const conn = await connect(rig, era, {});

          const result = resultOf(await conn.call("iris_doc_load", { ...loadArgs(), allowStorageRegeneration: flag }).end());

          expect(result.isError, `allowStorageRegeneration ${String(flag)}`).toBeFalsy();
          expect(result.structuredContent).toEqual({ total: 1, uploaded: 1, failed: 0, storageDrops: [DROP] });
          expect(result.content[0].text).toBe(`Loaded 1/1 document(s) into namespace '${NAMESPACE}'. ${DROP_NOTE}`);
          expect(writesIn(proxy.requests())).toEqual([putLine(NO_STORAGE_LINES)]);
          await stopAllRigs();
        }
      },
      TIMEOUT,
    );

    it(
      "ignoreConflict false: the refusal is the same, read from the 409 that IRIS answers the one unversioned PUT with, and no second PUT is sent",
      async () => {
        const proxy = storageProxy({ conflictLines: STORED_LINES });
        const rig = await openRig({ pkg: "iris-dev-mcp", interpose: proxy.interpose });
        const conn = await connect(rig, era, {});

        const result = resultOf(await conn.call("iris_doc_load", { ...loadArgs(), ignoreConflict: false }).end());

        expect(result.isError).toBe(true);
        expect(result.structuredContent.failures).toEqual([
          {
            file: filePath,
            docName: "Demo.Stored.cls",
            error:
              `Document 'Demo.Stored.cls' was not saved in namespace '${NAMESPACE}': the content drops the Storage definition 'Default' ` +
              `that the class has now, ${WHY} Nothing was stored. ${LOAD_REMEDY}`,
            code: "STORAGE_DROPPED",
            droppedStorage: ["Default"],
          },
        ]);
        expect(writesIn(proxy.requests())).toEqual([`PUT ${DOC_PATH} ${JSON.stringify({ enc: false, content: NO_STORAGE_LINES })}`]);
        expect(docGetsIn(proxy.requests())).toEqual([]);
      },
      TIMEOUT,
    );

    it(
      "ignoreConflict false with allowStorageRegeneration: the unversioned PUT, then the one version-checked PUT that IRIS stores, and storageDrops",
      async () => {
        const proxy = storageProxy({ conflictLines: STORED_LINES });
        const rig = await openRig({ pkg: "iris-dev-mcp", interpose: proxy.interpose });
        const conn = await connect(rig, era, {});

        const result = resultOf(await conn.call("iris_doc_load", { ...loadArgs(), ignoreConflict: false, allowStorageRegeneration: true }).end());

        expect(result.isError).toBeFalsy();
        expect(result.structuredContent).toEqual({ total: 1, uploaded: 1, failed: 0, storageDrops: [DROP] });
        const body = JSON.stringify({ enc: false, content: NO_STORAGE_LINES });
        expect(writesIn(proxy.requests())).toEqual([`PUT ${DOC_PATH} ${body}`, `PUT ${DOC_PATH} ${body}`]);
      },
      TIMEOUT,
    );
  });

  describe("the iris_doc_xml_export import", () => {
    const xml = [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<Export generator="IRIS" version="26">',
      '<Class name="Demo.Stored"><Super>%Persistent</Super></Class>',
      "</Export>",
    ].join("\n");

    it(
      "refuses an import whose class lacks the Storage the class has now: isError, the code, the text, storageDrops, and no xml/load POST reached IRIS",
      async () => {
        const proxy = storageProxy({ answerXmlLoad: true });
        const rig = await openRig({ pkg: "iris-dev-mcp", interpose: proxy.interpose });
        const conn = await connect(rig, era, {});

        const result = resultOf(await conn.call("iris_doc_xml_export", { action: "import", content: xml }).end());

        expect(result.isError).toBe(true);
        expect(result.content[0].text).toBe(
          `The XML was not imported into namespace '${NAMESPACE}' and nothing was stored: it drops the Storage definition 'Default' of 'Demo.Stored.cls' ` +
            `that the class has now, ${WHY} ${IMPORT_REMEDY}`,
        );
        expect(result.structuredContent).toEqual({ code: "STORAGE_DROPPED", namespace: NAMESPACE, storageDrops: [DROP] });
        expect(docGetsIn(proxy.requests())).toEqual([`GET ${DOC_PATH}`]);
        expect(writesIn(proxy.requests())).toEqual([]);
      },
      TIMEOUT,
    );

    it(
      "with allowStorageRegeneration the xml/load POST reaches IRIS with the XML, and the result is the API result plus storageDrops and a line that names the drop",
      async () => {
        const proxy = storageProxy({ answerXmlLoad: true });
        const rig = await openRig({ pkg: "iris-dev-mcp", interpose: proxy.interpose });
        const conn = await connect(rig, era, {});

        const result = resultOf(await conn.call("iris_doc_xml_export", { action: "import", content: xml, allowStorageRegeneration: true }).end());

        expect(result.isError).toBeFalsy();
        expect(result.structuredContent).toEqual({
          content: [{ file: "import.xml", imported: ["Demo.Stored.cls"], status: "" }],
          storageDrops: [DROP],
        });
        expect(result.content.at(-1).text).toBe(DROP_NOTE);
        expect(writesIn(proxy.requests())).toEqual([`POST ${XML_LOAD_PATH} ${JSON.stringify([{ file: "import.xml", content: xml.split("\n") }])}`]);
      },
      TIMEOUT,
    );
  });

  describe("iris_env_promote execute", () => {
    const diff: Json = { ...PROMOTE_DIFF, domains: { documents: { onlyInSource: ["Demo.Stored.cls"], onlyInTarget: [], differs: [], identical: 0 } } };
    const SCOPE_WITH_DROP =
      "1 step(s) from server 'default': #1 documents putAndCompile Demo.Stored.cls; drops Storage definitions: Demo.Stored.cls ('Default')";

    it(
      "refuses a source copy that lacks the target's Storage before the dialog and before any write: no dialog was put, and nothing reached either listener",
      async () => {
        const proxy = storageProxy({ storedLines: NO_STORAGE_LINES });
        const rig = await openRig({ pkg: "iris-dev-mcp", interpose: proxy.interpose });
        const conn = await connect(rig, era, ELICITING);
        const args = await promoteArgs(conn, diff);

        const result = resultOf(await conn.call("iris_env_promote", args).end());

        expect(result.isError).toBe(true);
        expect(result.content[0].text).toBe(
          `Promotion to server 'other', namespace '${NAMESPACE}' was not run and no changes were made: it drops the Storage definition 'Default' of 'Demo.Stored.cls' ` +
            `that the class has now, ${WHY} ${PROMOTE_REMEDY}`,
        );
        expect(result.structuredContent).toEqual({
          code: "STORAGE_DROPPED",
          source: { profile: "default", namespace: NAMESPACE },
          target: { profile: "other", namespace: NAMESPACE },
          storageDrops: [DROP],
        });
        expect(conn.dialogs(), "the person was never asked").toBe(0);
        expect(writesIn(proxy.requests()), "the source listener received no write").toEqual([]);
        expect(rig.writes("b"), "the target listener received no write").toEqual([]);
        expect(docGetsIn(rig.requests("b")), "the target class was read").toEqual([`GET ${DOC_PATH}`]);
      },
      TIMEOUT,
    );

    it(
      "with allowStorageRegeneration the dialog names the drop, an accept PUTs the source text the preflight checked and compiles, and the result has storageDrops",
      async () => {
        const proxy = storageProxy({ storedLines: NO_STORAGE_LINES });
        const rig = await openRig({ pkg: "iris-dev-mcp", interpose: proxy.interpose });
        const conn = await connect(rig, era, ELICITING);
        const args = await promoteArgs(conn, diff, { allowStorageRegeneration: true });

        const call = conn.call("iris_env_promote", args);
        const ask = await call.ask();

        expect(ask.message).toBe(dialogMessage("promote changes to another server", `server 'other', namespace ${NAMESPACE}`, SCOPE_WITH_DROP, proxy.port()));
        expect(rig.writes("b"), "nothing is written while the dialog is open").toEqual([]);

        const result = resultOf(await ask.answer(TICKED));

        expect(result.isError).toBeFalsy();
        expect(result.structuredContent.storageDrops).toEqual([DROP]);
        expect(result.structuredContent.summary).toEqual({ completed: 1, failed: 0, skipped: 0 });
        expect(result.content[0].text.split("\n").at(-1)).toBe(DROP_NOTE);
        expect(rig.writes("b")).toEqual([putLine(NO_STORAGE_LINES), COMPILE_REQUEST]);
        expect(writesIn(proxy.requests()), "the source listener received no write").toEqual([]);
      },
      TIMEOUT,
    );

    it(
      "a decline of that dialog changes nothing: the reads were made, no write reached the target, and the answer is CONFIRMATION_DECLINED",
      async () => {
        const proxy = storageProxy({ storedLines: NO_STORAGE_LINES });
        const rig = await openRig({ pkg: "iris-dev-mcp", interpose: proxy.interpose });
        const conn = await connect(rig, era, ELICITING);
        const args = await promoteArgs(conn, diff, { allowStorageRegeneration: true });

        const ask = await conn.call("iris_env_promote", args).ask();
        const result = resultOf(await ask.answer(DECLINED));

        expect(result.isError).toBe(true);
        expect(result.structuredContent.code).toBe("CONFIRMATION_DECLINED");
        expect(result.content[0].text).toBe(declinedText("promote changes to another server", "decline"));
        expect(docGetsIn(rig.requests("b")).length, "the target class was read").toBeGreaterThan(0);
        expect(rig.writes("b")).toEqual([]);
        expect(writesIn(proxy.requests())).toEqual([]);
      },
      TIMEOUT,
    );

    it(
      "a source that keeps the Storage is promoted as before: no refusal, the plain scope, and no storageDrops",
      async () => {
        const proxy = storageProxy({});
        const rig = await openRig({ pkg: "iris-dev-mcp", interpose: proxy.interpose });
        const conn = await connect(rig, era, ELICITING);
        const args = await promoteArgs(conn, diff);

        const ask = await conn.call("iris_env_promote", args).ask();

        expect(ask.message).toBe(
          dialogMessage(
            "promote changes to another server",
            `server 'other', namespace ${NAMESPACE}`,
            "1 step(s) from server 'default': #1 documents putAndCompile Demo.Stored.cls",
            proxy.port(),
          ),
        );
        const result = resultOf(await ask.answer(TICKED));
        expect(result.isError).toBeFalsy();
        expect(result.structuredContent).not.toHaveProperty("storageDrops");
        expect(rig.writes("b")).toHaveLength(2);
      },
      TIMEOUT,
    );
  });
});
