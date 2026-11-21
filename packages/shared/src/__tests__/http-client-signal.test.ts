/**
 * Story 43.3 (DW-642) - a request carries the abort signal of the call that made it: an already aborted signal sends nothing, an abort
 * in flight aborts the request, both reject with `IrisConnectionError` code `CANCELLED`, and a timeout is still `TIMEOUT`. `bindSignal`
 * gives a call a view of a shared client whose requests carry the call's signal.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { IrisConnectionConfig } from "../config.js";
import { IrisConnectionError } from "../errors.js";
import { IrisHttpClient, bindSignal } from "../http-client.js";

function makeConfig(): IrisConnectionConfig {
  return {
    host: "localhost",
    port: 52773,
    username: "testuser",
    password: "testpass",
    namespace: "HSCUSTOM",
    https: false,
    baseUrl: "http://localhost:52773",
    timeout: 60_000,
  };
}

const ENVELOPE = { status: { errors: [], summary: "" }, console: [], result: { ok: true } };

function jsonResponse(status = 200): Response {
  return new Response(JSON.stringify(ENVELOPE), { status });
}

/** A fetch that never answers and rejects the way fetch does when the signal it was given aborts. */
function hangingFetch(): (url: unknown, init: { signal: AbortSignal }) => Promise<Response> {
  return (_url, init) =>
    new Promise<Response>((_resolve, reject) => {
      if (init.signal.aborted) reject(new DOMException("This operation was aborted", "AbortError"));
      init.signal.addEventListener("abort", () => reject(new DOMException("This operation was aborted", "AbortError")), { once: true });
    });
}

async function rejection(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error: unknown) {
    return error;
  }
  throw new Error("expected the request to reject");
}

describe("IrisHttpClient request signal", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    fetchMock = vi.fn();
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe("a signal that is already aborted", () => {
    it("sends no request and rejects with CANCELLED", async () => {
      const client = new IrisHttpClient(makeConfig());
      const controller = new AbortController();
      controller.abort();

      const error = await rejection(client.get("/api/atelier/v8/HSCUSTOM/doc/A.cls", { signal: controller.signal }));

      expect(fetchMock).not.toHaveBeenCalled();
      expect(error).toBeInstanceOf(IrisConnectionError);
      expect((error as IrisConnectionError).code).toBe("CANCELLED");
      expect((error as IrisConnectionError).message).toBe(
        "Request GET /api/atelier/v8/HSCUSTOM/doc/A.cls was cancelled by the client. No answer is expected for a cancelled call.",
      );
    });

    it.each([
      ["post", (client: IrisHttpClient, signal: AbortSignal) => client.post("/api/x", { a: 1 }, { signal })],
      ["put", (client: IrisHttpClient, signal: AbortSignal) => client.put("/api/x", { a: 1 }, { signal })],
      ["delete", (client: IrisHttpClient, signal: AbortSignal) => client.delete("/api/x", { signal })],
      ["head", (client: IrisHttpClient, signal: AbortSignal) => client.head("/api/x", { signal })],
    ])("sends no request for %s, not even the CSRF preflight", async (_verb, call) => {
      const client = new IrisHttpClient(makeConfig());
      const controller = new AbortController();
      controller.abort();

      const error = await rejection(call(client, controller.signal));

      expect(fetchMock).not.toHaveBeenCalled();
      expect((error as IrisConnectionError).code).toBe("CANCELLED");
    });
  });

  describe("a signal that aborts in flight", () => {
    it("aborts the fetch, rejects with CANCELLED and removes its listener", async () => {
      fetchMock.mockImplementation(hangingFetch());
      const client = new IrisHttpClient(makeConfig());
      const controller = new AbortController();
      const add = vi.spyOn(controller.signal, "addEventListener");
      const remove = vi.spyOn(controller.signal, "removeEventListener");

      const pending = rejection(client.get("/api/x", { signal: controller.signal }));
      await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
      const fetchSignal = (fetchMock.mock.calls[0]?.[1] as { signal: AbortSignal }).signal;
      expect(fetchSignal.aborted).toBe(false);

      controller.abort();
      const error = await pending;

      expect(fetchSignal.aborted).toBe(true);
      expect((error as IrisConnectionError).code).toBe("CANCELLED");
      expect((error as IrisConnectionError).message).toBe(
        "Request GET /api/x was cancelled by the client. No answer is expected for a cancelled call.",
      );
      const added = add.mock.calls.filter(([type]) => type === "abort");
      const removed = remove.mock.calls.filter(([type]) => type === "abort");
      expect(added).toHaveLength(1);
      expect(removed).toHaveLength(1);
      expect(removed[0]?.[1]).toBe(added[0]?.[1]);
    });

    it("removes its listener once the response headers have arrived", async () => {
      fetchMock.mockResolvedValue(jsonResponse());
      const client = new IrisHttpClient(makeConfig());
      const controller = new AbortController();
      const add = vi.spyOn(controller.signal, "addEventListener");
      const remove = vi.spyOn(controller.signal, "removeEventListener");

      await client.get("/api/x", { signal: controller.signal });

      const added = add.mock.calls.filter(([type]) => type === "abort");
      const removed = remove.mock.calls.filter(([type]) => type === "abort");
      expect(added).toHaveLength(1);
      expect(removed).toHaveLength(1);
      expect(removed[0]?.[1]).toBe(added[0]?.[1]);
    });

    it("does not retry a 401 after the signal aborted", async () => {
      const controller = new AbortController();
      fetchMock.mockImplementation(async () => {
        controller.abort();
        return jsonResponse(401);
      });
      const client = new IrisHttpClient(makeConfig());

      const error = await rejection(client.get("/api/x", { signal: controller.signal }));

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect((error as IrisConnectionError).code).toBe("CANCELLED");
    });

    it("carries the signal to the CSRF preflight of a mutating request, and none of the call's headers", async () => {
      fetchMock.mockImplementation(hangingFetch());
      const client = new IrisHttpClient(makeConfig());
      const controller = new AbortController();

      const pending = rejection(
        client.put("/api/atelier/v8/HSCUSTOM/doc/A.cls", { enc: false }, { signal: controller.signal, headers: { "If-None-Match": "2026-01-01" } }),
      );
      await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
      const [url, init] = fetchMock.mock.calls[0] as [string, { method: string; headers: Record<string, string>; signal: AbortSignal }];
      expect(url).toBe("http://localhost:52773/api/atelier/");
      expect(init.method).toBe("HEAD");
      expect(init.headers["If-None-Match"]).toBeUndefined();

      controller.abort();
      const error = await pending;

      expect(init.signal.aborted).toBe(true);
      expect((error as IrisConnectionError).code).toBe("CANCELLED");
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
  });

  describe("a timeout", () => {
    it("is still TIMEOUT when a signal is given and has not aborted", async () => {
      vi.useFakeTimers();
      fetchMock.mockImplementation(hangingFetch());
      const client = new IrisHttpClient(makeConfig());
      const controller = new AbortController();

      const pending = rejection(client.get("/api/x", { signal: controller.signal, timeout: 250 }));
      await vi.advanceTimersByTimeAsync(250);
      const error = await pending;

      expect(controller.signal.aborted).toBe(false);
      expect(error).toBeInstanceOf(IrisConnectionError);
      expect((error as IrisConnectionError).code).toBe("TIMEOUT");
      expect((error as IrisConnectionError).message).toContain("timed out after 250ms");
    });

    it("is still TIMEOUT when no signal is given", async () => {
      vi.useFakeTimers();
      fetchMock.mockImplementation(hangingFetch());
      const client = new IrisHttpClient(makeConfig());

      const pending = rejection(client.get("/api/x", { timeout: 100 }));
      await vi.advanceTimersByTimeAsync(100);

      expect(((await pending) as IrisConnectionError).code).toBe("TIMEOUT");
    });
  });
});

describe("bindSignal", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    fetchMock = vi.fn();
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("merges the signal into the options of get, keeping the caller's headers and timeout", async () => {
    fetchMock.mockImplementation(hangingFetch());
    const client = new IrisHttpClient(makeConfig());
    const controller = new AbortController();
    const bound = bindSignal(client, controller.signal);

    const pending = rejection(bound.get("/api/x", { headers: { "X-Test": "1" }, timeout: 5000 }));
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const init = fetchMock.mock.calls[0]?.[1] as { headers: Record<string, string>; signal: AbortSignal };
    expect(init.headers["X-Test"]).toBe("1");

    controller.abort();
    expect(((await pending) as IrisConnectionError).code).toBe("CANCELLED");
    expect(init.signal.aborted).toBe(true);
  });

  it.each([
    ["get", (client: IrisHttpClient) => client.get("/api/x")],
    ["post", (client: IrisHttpClient) => client.post("/api/x", { a: 1 })],
    ["put", (client: IrisHttpClient) => client.put("/api/x", { a: 1 })],
    ["delete", (client: IrisHttpClient) => client.delete("/api/x")],
    ["head", (client: IrisHttpClient) => client.head("/api/x")],
  ])("sends nothing for %s once the call's signal has aborted", async (_verb, call) => {
    const client = new IrisHttpClient(makeConfig());
    const controller = new AbortController();
    controller.abort();

    const error = await rejection(call(bindSignal(client, controller.signal)));

    expect(fetchMock).not.toHaveBeenCalled();
    expect((error as IrisConnectionError).code).toBe("CANCELLED");
  });

  it("passes the options of post and put through with the signal added", async () => {
    fetchMock.mockImplementation(async () => jsonResponse());
    const client = new IrisHttpClient(makeConfig());
    const bound = bindSignal(client, new AbortController().signal);

    await bound.put("/api/x", { a: 1 }, { headers: { "If-None-Match": "ts" } });

    const calls = fetchMock.mock.calls as Array<[string, { method: string; headers: Record<string, string>; body: string | null }]>;
    const put = calls.find(([, init]) => init.method === "PUT");
    expect(put?.[1].headers["If-None-Match"]).toBe("ts");
    expect(put?.[1].body).toBe('{"a":1}');
  });

  it("keeps the namespace, the class and the other members of the client", () => {
    const client = new IrisHttpClient(makeConfig());
    const bound = bindSignal(client, new AbortController().signal);

    expect(bound.namespace).toBe("HSCUSTOM");
    expect(bound).toBeInstanceOf(IrisHttpClient);
    expect(() => bound.destroy()).not.toThrow();
  });

  it("leaves the shared client as it was: a request on it carries no signal", async () => {
    fetchMock.mockImplementation(async () => jsonResponse());
    const client = new IrisHttpClient(makeConfig());
    const controller = new AbortController();
    bindSignal(client, controller.signal);
    controller.abort();

    await expect(client.get("/api/x")).resolves.toBeDefined();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
