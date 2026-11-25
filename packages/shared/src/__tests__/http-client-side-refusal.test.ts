/**
 * Story 45.2: the gateway's refusal of the custom REST service (AD-1).
 *
 * A client armed with a refusal throws `IrisSideNotInstalledError` for a path that starts with
 * `/api/executemcp/` (case-insensitive) before any I/O (no CSRF `HEAD` either), touches no other path,
 * and a per-call recorder keeps the first refusal and refuses every later request of the call.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { IrisHttpClient, recordSideRefusal } from "../http-client.js";
import type { SideRefusalRecorder } from "../http-client.js";
import { IrisSideNotInstalledError } from "../errors.js";
import type { IrisSideRefusal } from "../errors.js";
import type { IrisConnectionConfig } from "../config.js";

const CONFIG: IrisConnectionConfig = {
  host: "localhost",
  port: 52773,
  username: "u",
  password: "p",
  namespace: "USER",
  https: false,
  baseUrl: "http://localhost:52773",
  timeout: 60_000,
};

const REFUSAL: IrisSideRefusal = { text: "not installed", fields: { profile: "default", found: "missing" } };

function ok(): Response {
  return new Response(JSON.stringify({ status: { errors: [] }, console: [], result: {} }), {
    status: 200,
    headers: { "X-CSRF-Token": "t" },
  });
}

let fetchMock: ReturnType<typeof vi.fn>;
let original: typeof globalThis.fetch;
beforeEach(() => {
  original = globalThis.fetch;
  fetchMock = vi.fn(async () => ok());
  globalThis.fetch = fetchMock as unknown as typeof fetch;
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  globalThis.fetch = original;
  vi.restoreAllMocks();
});

describe("IrisHttpClient.refuseCustomRest", () => {
  it("an unarmed client sends custom REST requests as today", async () => {
    const client = new IrisHttpClient(CONFIG);
    await client.get("/api/executemcp/v2/health");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each(["get", "post", "put", "delete", "head"] as const)(
    "%s to the custom REST prefix throws the refusal before any I/O (not even the CSRF HEAD)",
    async (method) => {
      const client = new IrisHttpClient(CONFIG);
      client.refuseCustomRest(REFUSAL);
      const send =
        method === "head" || method === "get" || method === "delete"
          ? client[method]("/api/executemcp/v2/global")
          : client[method]("/api/executemcp/v2/global", { a: 1 });
      await expect(send).rejects.toBeInstanceOf(IrisSideNotInstalledError);
      expect(fetchMock, "nothing was sent").not.toHaveBeenCalled();
    },
  );

  it("carries the text as its message and the fields", async () => {
    const client = new IrisHttpClient(CONFIG);
    client.refuseCustomRest(REFUSAL);
    const error = await client.post("/api/executemcp/v2/x", {}).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(IrisSideNotInstalledError);
    expect((error as IrisSideNotInstalledError).message).toBe("not installed");
    expect((error as IrisSideNotInstalledError).fields).toEqual({ profile: "default", found: "missing" });
  });

  it("matches the prefix case-insensitively", async () => {
    const client = new IrisHttpClient(CONFIG);
    client.refuseCustomRest(REFUSAL);
    for (const path of ["/API/ExecuteMCP/v2/health", "/api/EXECUTEMCP/v2", "/Api/executemcp/"]) {
      await expect(client.get(path), path).rejects.toBeInstanceOf(IrisSideNotInstalledError);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses the prefix only: the Atelier API and look-alike paths still go out", async () => {
    const client = new IrisHttpClient(CONFIG);
    client.refuseCustomRest(REFUSAL);
    await client.get("/api/atelier/v8/USER/doc/X.cls");
    await client.head("/api/atelier/");
    await client.get("/api/executemcpx/v2");
    await client.get("/api/executemcp");
    await client.get("/other/api/executemcp/v2");
    expect(fetchMock).toHaveBeenCalledTimes(5);
  });

  it("a POST to Atelier still sends its CSRF HEAD on an armed client", async () => {
    const client = new IrisHttpClient(CONFIG);
    client.refuseCustomRest(REFUSAL);
    await client.post("/api/atelier/v8/USER/action/query", { query: "SELECT 1" });
    expect(fetchMock.mock.calls.map((c: unknown[]) => (c[1] as { method: string }).method)).toEqual(["HEAD", "POST"]);
  });
});

describe("recordSideRefusal: the per-call recorder", () => {
  it("records the first refusal, and refuses every later request of the call, whatever its path", async () => {
    const client = new IrisHttpClient(CONFIG);
    client.refuseCustomRest(REFUSAL);
    const recorder: SideRefusalRecorder = {};
    const view = recordSideRefusal(client, recorder);

    await expect(view.post("/api/executemcp/v2/global", {})).rejects.toBeInstanceOf(IrisSideNotInstalledError);
    expect(recorder.refusal).toBeInstanceOf(IrisSideNotInstalledError);

    // A handler that swallowed the error and goes on to Atelier sends nothing.
    await expect(view.get("/api/atelier/v8/USER/doc/X.cls")).rejects.toBe(recorder.refusal);
    await expect(view.post("/api/atelier/v8/USER/action/query", {})).rejects.toBe(recorder.refusal);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("a call whose requests are all allowed records nothing and sends everything", async () => {
    const client = new IrisHttpClient(CONFIG);
    client.refuseCustomRest(REFUSAL);
    const recorder: SideRefusalRecorder = {};
    const view = recordSideRefusal(client, recorder);
    await view.get("/api/atelier/v8/USER/doc/X.cls");
    expect(recorder.refusal).toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("is per call: a second recorder over the same client starts clean", async () => {
    const client = new IrisHttpClient(CONFIG);
    client.refuseCustomRest(REFUSAL);
    const first: SideRefusalRecorder = {};
    await recordSideRefusal(client, first).get("/api/executemcp/v2/x").catch(() => undefined);
    expect(first.refusal).toBeDefined();
    const second: SideRefusalRecorder = {};
    await recordSideRefusal(client, second).get("/api/atelier/v8/USER/doc/X.cls");
    expect(second.refusal).toBeUndefined();
  });

  it("keeps the client's other members (the namespace) and an unrelated error is not recorded", async () => {
    const client = new IrisHttpClient(CONFIG);
    const recorder: SideRefusalRecorder = {};
    const view = recordSideRefusal(client, recorder);
    expect(view.namespace).toBe("USER");
    fetchMock.mockResolvedValueOnce(new Response("{}", { status: 500 }));
    await expect(view.get("/api/executemcp/v2/x")).rejects.toThrow();
    expect(recorder.refusal).toBeUndefined();
  });
});
