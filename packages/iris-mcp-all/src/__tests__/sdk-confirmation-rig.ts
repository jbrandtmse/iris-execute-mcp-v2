/**
 * The rig that drives a BUILT server through the real SDK client over stdio against a fake IRIS listener, with the client declaring
 * (or not declaring) form elicitation and answering each dialog as the test says. Shared by the Story 43.3 confirmation rows and the
 * Epic 43 capstone (`epic43-capstone-gate.test.ts`).
 *
 * A rig starts one fake listener (`scripts/lib/fake-iris-listener.mjs`, on 127.0.0.1 inside this process; no IRIS instance is reached),
 * a second one when `secondListener` is set (the profile `other`, a promotion's target), one audit file, and one server process
 * that the client connects to in the negotiation mode asked for. It throws "Build the packages first" when the shared dist or the
 * server's dist is missing or older than its source, and never skips.
 *
 * Every rig registers for {@link closeSdkRigs}; a suite calls it after each test so that no server process, listener or temporary
 * directory outlives its test.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { REPO_ROOT } from "./pack-fixture";
import { startFakeIris } from "../../../../scripts/lib/fake-iris-listener.mjs";
import { normalizeAuditEntry, readBootstrapVersion } from "../../../../scripts/lib/sdk-handler-golden-core.mjs";
import { connectSdkClient, distEntry, pollAuditEntries, resolveSdkEsmDir, staleDistReason } from "./process-gate-helpers.js";
import type { AuditEntry, ElicitationAnswer, ElicitationRequest, SdkClient, SdkVersionNegotiation, WireToolResult } from "./process-gate-helpers.js";

/** The answer a dialog gets until {@link SdkRig.answer} says otherwise: an accept with Confirm ticked. */
const TICKED_ACCEPT: ElicitationAnswer = { action: "accept", content: { confirm: true } };

/** What one call did, as the client, the listener and the audit file saw it. */
export interface SdkExchange {
  /** The tool result, without the 2026-07-28 server identity in `_meta`. */
  result: WireToolResult;
  /** The write requests that the call caused. */
  writes: string[];
  /** The dialogs the call put to the client. */
  asks: ElicitationRequest[];
}

/** One running server, its listener(s), its audit file and the connected client. */
export interface SdkRig {
  port: number;
  asked: ElicitationRequest[];
  auditFile: string;
  /** Set how the client answers the next dialogs; `"never"` leaves them unanswered. */
  answer: (answer: ElicitationAnswer | "never") => void;
  call: (tool: string, args: Record<string, unknown>) => Promise<SdkExchange>;
  /** The normalized tool entries of the audit file once it holds `count` of them, without `seq`. */
  entries: (count: number) => Promise<Array<Record<string, unknown>>>;
  /** Every request the listener has received, in arrival order, the startup queries included. */
  requests: () => Array<{ method: string; url: string; body: string }>;
  /** All write requests the listener has received. */
  writes: () => string[];
  /** All write requests the second listener (the profile `other`, a promotion's target) has received; empty on a rig without one. */
  otherWrites: () => string[];
  /** Everything the server has written to stderr so far. */
  stderr: () => string;
  close: () => Promise<void>;
  client: SdkClient;
}

/** What {@link openSdkRig} starts. */
export interface SdkRigOptions {
  /** The capabilities the client declares; omitted, the client declares none. */
  capabilities?: Record<string, unknown>;
  /** The value of `IRIS_GOVERNANCE`; omitted, the variable is not set. */
  governance?: string;
  /** Start a second fake listener and give the server the profile `other` that reaches it. */
  secondListener?: boolean;
  /** The client name the SDK reports in the handshake, and the prefix of the temporary directory. */
  clientName: string;
  /** How the client answers dialogs until {@link SdkRig.answer} is called; omitted, an accept with Confirm ticked. */
  firstAnswer?: ElicitationAnswer;
  /** Further environment variables of the server process, applied last. */
  env?: Record<string, string>;
}

const rigs: Array<() => Promise<void>> = [];

/** Close every rig opened since the last call: the client, the listeners and the temporary directory. */
export async function closeSdkRigs(): Promise<void> {
  for (const close of rigs.splice(0)) await close().catch(() => undefined);
}

/** Whether a request to the fake listener is a write: a POST, PUT or DELETE other than the startup bootstrap query. */
export const isWrite = (request: { method: string; url: string }): boolean =>
  ["POST", "PUT", "DELETE"].includes(request.method) && !request.url.endsWith("/action/query");

/** A request as one line: the method, the URL and, when there is one, the body. */
export const writeLine = (request: { method: string; url: string; body: string }): string =>
  `${request.method} ${request.url}${request.body === "" ? "" : ` ${request.body}`}`;

/** A tool result without the 2026-07-28 server identity in `_meta`. */
export function withoutMeta(result: WireToolResult): WireToolResult {
  const { _meta: _identity, ...rest } = result as WireToolResult & { _meta?: unknown };
  return rest;
}

/**
 * Start `pkg`'s built server against a fake listener and connect a client that negotiates as `negotiation` and declares
 * `options.capabilities`.
 */
export async function openSdkRig(pkg: string, negotiation: SdkVersionNegotiation, options: SdkRigOptions): Promise<SdkRig> {
  const stale = ["shared", pkg].map((name) => [name, staleDistReason(REPO_ROOT, name)] as const).filter(([, reason]) => reason !== undefined);
  if (stale.length > 0) throw new Error(`Build the packages first: ${stale.map(([name, reason]) => `${name}: ${reason}`).join("; ")}`);
  const sdkEsmDir = resolveSdkEsmDir(REPO_ROOT);
  if (sdkEsmDir === undefined) throw new Error("The MCP SDK client is not installed.");

  const fake = await startFakeIris({ bootstrapVersion: readBootstrapVersion(REPO_ROOT) });
  const otherFake = options.secondListener === true ? await startFakeIris({ bootstrapVersion: readBootstrapVersion(REPO_ROOT) }) : undefined;
  const directory = mkdtempSync(path.join(tmpdir(), `${options.clientName}-`));
  const auditFile = path.join(directory, "audit.jsonl");
  const asked: ElicitationRequest[] = [];
  let stderr = "";
  let next: ElicitationAnswer | "never" = options.firstAnswer ?? TICKED_ACCEPT;
  let client: SdkClient;
  try {
    client = await connectSdkClient(
      {
        sdkEsmDir,
        entry: distEntry(REPO_ROOT, pkg),
        target: { host: "127.0.0.1", port: String(fake.port), username: "qa", password: "qa", namespace: "HSCUSTOM" },
        clientName: options.clientName,
        versionNegotiation: negotiation,
        onStderr: (chunk) => {
          stderr += chunk;
        },
        ...(options.capabilities !== undefined ? { clientCapabilities: options.capabilities } : {}),
        onElicitation: (request) => {
          asked.push(request);
          return next === "never" ? new Promise<ElicitationAnswer>(() => undefined) : next;
        },
      },
      {
        IRIS_AUDIT_LOG: auditFile,
        IRIS_AUDIT_LOG_PARAMS: "true",
        ...(options.governance !== undefined ? { IRIS_GOVERNANCE: options.governance } : {}),
        ...(otherFake !== undefined
          ? { IRIS_PROFILES: JSON.stringify({ other: { host: "127.0.0.1", port: otherFake.port, username: "qa", password: "qa", namespace: "HSCUSTOM" } }) }
          : {}),
        ...options.env,
      },
    );
  } catch (error) {
    await fake.close();
    await otherFake?.close();
    rmSync(directory, { recursive: true, force: true });
    throw error;
  }
  let closed = false;
  const close = async (): Promise<void> => {
    if (closed) return;
    closed = true;
    await client.close().catch(() => undefined);
    await fake.close();
    await otherFake?.close();
    rmSync(directory, { recursive: true, force: true });
  };
  rigs.push(close);

  return {
    port: fake.port,
    asked,
    auditFile,
    client,
    answer: (answer) => {
      next = answer;
    },
    call: async (tool, args) => {
      const before = fake.requests.length;
      const askedBefore = asked.length;
      const result = await client.callTool({ name: tool, arguments: args });
      return {
        result: withoutMeta(result),
        writes: fake.requests.slice(before).filter(isWrite).map(writeLine),
        asks: asked.slice(askedBefore),
      };
    },
    entries: async (count) => {
      const read = async (): Promise<Array<Record<string, unknown>>> =>
        (
          await pollAuditEntries(auditFile, {
            count,
            isWanted: (entry: AuditEntry) => typeof entry["tool"] === "string",
            returnAll: true,
            intervalMs: 25,
            timeoutMs: 10_000,
            excerpt: 600,
          })
        )
          .filter((entry) => typeof entry["tool"] === "string")
          .map((entry) => {
            const { seq: _seq, ...rest } = normalizeAuditEntry(entry) as Record<string, unknown>;
            return rest;
          });
      // The entries are written after the reply: read again after a pause, so an entry written late is seen too.
      await read();
      await new Promise((resolve) => setTimeout(resolve, 200));
      return read();
    },
    requests: () => fake.requests.map(({ method, url, body }) => ({ method, url, body })),
    writes: () => fake.requests.filter(isWrite).map(writeLine),
    otherWrites: () => (otherFake?.requests ?? []).filter(isWrite).map(writeLine),
    stderr: () => stderr,
    close,
  };
}
