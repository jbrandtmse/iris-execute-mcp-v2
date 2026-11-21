/**
 * Story 43.3 QA - a hand-wire rig for the confirmation gates, on both eras, with no MCP SDK client anywhere.
 *
 * `openRig` starts a BUILT server (`pkg`) against two fake IRIS listeners (`default` reaches A, the profile `other` reaches B; 127.0.0.1
 * only, no IRIS instance) with auditing on, and keeps every request each listener received, body included. `connect` opens one connection
 * on an era with the capabilities the "client" declares, and writes the JSON-RPC lines of that era by hand:
 *  - 2026-07-28: `server/discover`, then `tools/call` with the request metadata envelope; a dialog is an `input_required` result, and the
 *    answer is a retry carrying `inputResponses` and the echoed `requestState`.
 *  - 2025-11-25: `initialize` declaring the capabilities, then `tools/call`; a dialog is a server `elicitation/create` request, and the
 *    answer is a JSON-RPC response to it.
 * The dialog text a test expects is written from the revision of the spec, never taken from the code under test (`dialogMessage`).
 */

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { startFakeIris } from "../../../../scripts/lib/fake-iris-listener.mjs";
import { normalizeAuditEntry, readBootstrapVersion, settledAuditEntries } from "../../../../scripts/lib/sdk-handler-golden-core.mjs";
import { packageVersion } from "../../../../scripts/lib/sdk-wire-golden-core.mjs";
import { REPO_ROOT } from "./pack-fixture";
import { distEntry, staleDistReason } from "./process-gate-helpers.js";
import {
  CLIENT_CAPABILITIES_KEY,
  CLIENT_INFO_KEY,
  LEGACY_VERSION,
  MODERN_VERSION,
  PROTOCOL_VERSION_KEY,
  handEnv,
  resultOf,
  startHandWire,
  tempDirectory,
  type HandWire,
  type Json,
  type WireLine,
} from "./story-43-2-qa-hand-wire";

export type Era = "legacy" | "modern";
export const ERAS: Era[] = ["legacy", "modern"];

/** What a client that can show a form declares. */
export const ELICITING: Json = { elicitation: { form: {} } };

/** The answers a person gives. */
export const TICKED: Json = { action: "accept", content: { confirm: true } };
export const UNTICKED: Json = { action: "accept", content: { confirm: false } };
export const DECLINED: Json = { action: "decline" };
export const DISMISSED: Json = { action: "cancel" };

/** Throw, naming the packages, when a dist this file drives is missing or older than its source. */
export function requireFreshDists(...packages: string[]): void {
  const stale = ["shared", ...packages].map((pkg) => [pkg, staleDistReason(REPO_ROOT, pkg)] as const).filter(([, reason]) => reason !== undefined);
  if (stale.length > 0) throw new Error(`Build the packages first: ${stale.map(([pkg, reason]) => `${pkg}: ${reason}`).join("; ")}`);
}

/** The five gated writes that are off by default, switched on. */
export const GOVERNANCE_ALL: string = JSON.stringify({
  global: {
    "iris_audit_manage:purge": true,
    "iris_message_resend:resend": true,
    "iris_message_resend:resendFiltered": true,
    "iris_doc_edit:regenerateStorage": true,
    "iris_env_promote:execute": true,
  },
});

/** The name and version a built server reports about itself. */
export function serverIdentity(pkg: string): { name: string; version: string } {
  const names: Record<string, string> = { "iris-admin-mcp": "@iris-mcp/admin", "iris-interop-mcp": "@iris-mcp/interop", "iris-dev-mcp": "@iris-mcp/dev" };
  return { name: names[pkg] ?? pkg, version: packageVersion(REPO_ROOT, pkg) };
}

// -- the rig ---------------------------------------------------------------------------------------------------------------------------

export interface RigOptions {
  pkg: string;
  /** The `IRIS_GOVERNANCE` text; `null` leaves it unset (the defaults: the gated writes are off). Default {@link GOVERNANCE_ALL}. */
  governance?: string | null;
  /** Log argument values into the audit file (`IRIS_AUDIT_LOG_PARAMS`). Default false, the documented default. */
  params?: boolean;
  env?: Record<string, string | undefined>;
  /** Put something between the server and listener A: it receives A's port and returns the port the server's `default` profile uses. */
  interpose?: (upstreamPort: number) => Promise<{ port: number; close: () => Promise<void> }>;
}

export interface GateRig {
  wire: HandWire;
  ports: { a: number; b: number };
  /** Every request a listener received, as `METHOD url` and, when it has a body, ` body`. */
  requests: (which?: "a" | "b") => string[];
  /** The write requests (POST, PUT or DELETE, apart from the startup query) a listener received. */
  writes: (which?: "a" | "b") => string[];
  auditFile: string;
  /** The tool entries of the audit file once it holds `minimum` of them and has stopped growing, without `ts`, `session` and `durationMs`. */
  entries: (minimum: number) => Promise<Json[]>;
  auditText: () => string;
  stop: () => Promise<void>;
}

interface FakeRequest {
  method: string;
  url: string;
  body: string;
}

const isWrite = (request: FakeRequest): boolean => ["POST", "PUT", "DELETE"].includes(request.method) && !request.url.endsWith("/action/query");
const describeRequest = (request: FakeRequest): string => `${request.method} ${request.url}${request.body === "" ? "" : ` ${request.body}`}`;

const liveRigs: GateRig[] = [];

/** Stop every rig this file opened; call it from `afterEach`. */
export async function stopAllRigs(): Promise<void> {
  while (liveRigs.length > 0) await liveRigs.pop()!.stop();
}

export async function openRig(options: RigOptions): Promise<GateRig> {
  const bootstrapVersion = readBootstrapVersion(REPO_ROOT);
  const a = await startFakeIris({ bootstrapVersion });
  const b = await startFakeIris({ bootstrapVersion });
  const front = options.interpose === undefined ? undefined : await options.interpose(a.port);
  const scratch = tempDirectory("story-43-3-qa-");
  const auditFile = path.join(scratch.dir, "audit.jsonl");
  const governance = options.governance === undefined ? GOVERNANCE_ALL : options.governance;
  const wire = startHandWire(
    distEntry(REPO_ROOT, options.pkg),
    handEnv({
      IRIS_PORT: String(front?.port ?? a.port),
      IRIS_PROFILES: JSON.stringify({ other: { host: "127.0.0.1", port: b.port, username: "qa", password: "qa", namespace: "HSCUSTOM" } }),
      IRIS_AUDIT_LOG: auditFile,
      ...(options.params === true ? { IRIS_AUDIT_LOG_PARAMS: "true" } : {}),
      ...(governance === null ? {} : { IRIS_GOVERNANCE: governance }),
      LOG_LEVEL: "INFO",
      ...options.env,
    }),
  );
  const of = (which: "a" | "b"): FakeRequest[] => (which === "a" ? a : b).requests as FakeRequest[];
  const rig: GateRig = {
    wire,
    ports: { a: a.port, b: b.port },
    requests: (which = "a") => of(which).map(describeRequest),
    writes: (which = "a") => of(which).filter(isWrite).map(describeRequest),
    auditFile,
    entries: async (minimum) => {
      const all = (await settledAuditEntries(auditFile, minimum + 1)) as Json[];
      return all.filter((entry) => typeof entry.tool === "string").map((entry) => normalizeAuditEntry(entry) as Json);
    },
    auditText: () => (existsSync(auditFile) ? readFileSync(auditFile, "utf8") : ""),
    stop: async () => {
      await wire.close();
      await front?.close();
      await a.close();
      await b.close();
      scratch.remove();
    },
  };
  liveRigs.push(rig);
  return rig;
}

// -- the connection ---------------------------------------------------------------------------------------------------------------------

/** What the server put to the person: the form request, and a way to answer it. */
export interface Ask {
  /** The line that carried the question: the server's `elicitation/create` request, or the `input_required` response. */
  line: WireLine;
  /** The params of the form request: `message`, `requestedSchema`, `mode` (and `_meta` on the 2025 era). */
  params: Json;
  message: string;
  /** The `requestState` of an `input_required` result; `undefined` on the 2025 era, where no state leaves the server. */
  state: string | undefined;
  /** Answer it; resolves with the line that follows: the end of the call, or (2026-07-28) the response to the retry. */
  answer: (answer: Json, timeoutMs?: number) => Promise<WireLine>;
  /** Answer it without waiting: the id of the request that is now in flight (the call itself on 2025, the retry on 2026-07-28) and its response. */
  send: (answer: Json, timeoutMs?: number) => { id: number; response: Promise<WireLine> };
}

export interface Call {
  id: number;
  tool: string;
  args: Json;
  /** Wait for the dialog of this call; on the 2025 era, `match` picks the dialog by its message when several calls are in flight. */
  ask: (match?: (message: string) => boolean) => Promise<Ask>;
  /** The response to the request (on 2026-07-28 that is the `input_required` result when the call asks). */
  end: (timeoutMs?: number) => Promise<WireLine>;
}

export interface Conn {
  era: Era;
  rig: GateRig;
  wire: HandWire;
  capabilities: Json;
  call: (tool: string, args: Json) => Call;
  /** Send a `tools/call` with extra params members (for example `inputResponses` and `requestState`), and resolve with its response. */
  callWith: (tool: string, args: Json, extra: Json, capabilities?: Json) => Promise<WireLine>;
  /** Write several lines in ONE write to the server's stdin, so the server reads them in the same chunk. */
  sendBurst: (frames: Json[]) => void;
  /** The next request id, for lines a test builds itself. */
  nextId: () => number;
  /** The tools/call line of a call, for a burst. */
  frameOf: (id: number, tool: string, args: Json, extra?: Json, capabilities?: Json) => Json;
  /** The envelope a 2026-07-28 request carries for these capabilities (also usable on a 2025 request, where it must be ignored). */
  envelope: (capabilities?: Json) => Json;
  /** How many dialogs the server has put so far. */
  dialogs: () => number;
}

export const isDialogLine = (line: WireLine): boolean => line.message?.method === "elicitation/create";
const isInputRequired = (line: WireLine): boolean => line.message?.result?.resultType === "input_required";

export function envelopeOf(capabilities: Json): Json {
  return {
    [PROTOCOL_VERSION_KEY]: MODERN_VERSION,
    [CLIENT_INFO_KEY]: { name: "story-43-3-qa", version: "0.0.0" },
    [CLIENT_CAPABILITIES_KEY]: capabilities,
  };
}

/** Open a connection on `era` that declares `capabilities` (at `initialize` on 2025, in every request's envelope on 2026-07-28). */
export async function connect(rig: GateRig, era: Era, capabilities: Json = {}): Promise<Conn> {
  const { wire } = rig;
  let id = 1;
  if (era === "modern") {
    const discovered = await wire.request(id, "server/discover", { _meta: envelopeOf(capabilities) });
    if (!resultOf(discovered).supportedVersions.includes(MODERN_VERSION)) throw new Error(`the server does not serve ${MODERN_VERSION}`);
  } else {
    const initialized = await wire.request(id, "initialize", {
      protocolVersion: LEGACY_VERSION,
      capabilities,
      clientInfo: { name: "story-43-3-qa", version: "0.0.0" },
    });
    if (resultOf(initialized).protocolVersion !== LEGACY_VERSION) throw new Error("the server did not answer with 2025-11-25");
    wire.send({ jsonrpc: "2.0", method: "notifications/initialized" });
  }
  const consumed = new Set<WireLine>();
  const nextId = (): number => ++id;
  const frame = (callId: number, tool: string, args: Json, extra: Json, caps: Json): Json => ({
    jsonrpc: "2.0",
    id: callId,
    method: "tools/call",
    params: { name: tool, arguments: args, ...extra, ...(era === "modern" ? { _meta: envelopeOf(caps) } : {}) },
  });

  const call = (tool: string, args: Json): Call => {
    const callId = nextId();
    wire.send(frame(callId, tool, args, {}, capabilities));
    return {
      id: callId,
      tool,
      args,
      end: (timeoutMs) => wire.response(callId, timeoutMs),
      ask: async (match) => {
        if (era === "legacy") {
          const line = await wire.untilLine(
            (candidate) => isDialogLine(candidate) && !consumed.has(candidate) && (match === undefined || match(candidate.message.params.message)),
          );
          consumed.add(line);
          return {
            line,
            params: line.message.params,
            message: line.message.params.message,
            state: undefined,
            answer: (answer, timeoutMs) => {
              wire.sendRaw(JSON.stringify({ result: answer, jsonrpc: "2.0", id: line.message.id }));
              return wire.response(callId, timeoutMs);
            },
            send: (answer, timeoutMs) => {
              wire.sendRaw(JSON.stringify({ result: answer, jsonrpc: "2.0", id: line.message.id }));
              return { id: callId, response: wire.response(callId, timeoutMs) };
            },
          };
        }
        const line = await wire.response(callId);
        if (!isInputRequired(line)) throw new Error(`the call was not asked; the response is: ${line.raw.slice(0, 400)}`);
        const result = resultOf(line);
        const state: string = result.requestState;
        return {
          line,
          params: result.inputRequests.confirm.params,
          message: result.inputRequests.confirm.params.message,
          state,
          answer: (answer, timeoutMs) => {
            const retry = nextId();
            wire.send(frame(retry, tool, args, { inputResponses: { confirm: answer }, requestState: state }, capabilities));
            return wire.response(retry, timeoutMs);
          },
          send: (answer, timeoutMs) => {
            const retry = nextId();
            wire.send(frame(retry, tool, args, { inputResponses: { confirm: answer }, requestState: state }, capabilities));
            return { id: retry, response: wire.response(retry, timeoutMs) };
          },
        };
      },
    };
  };

  return {
    era,
    rig,
    wire,
    capabilities,
    call,
    callWith: (tool, args, extra, caps = capabilities) => {
      const callId = nextId();
      wire.send(frame(callId, tool, args, extra, caps));
      return wire.response(callId);
    },
    sendBurst: (frames) => {
      wire.sendRaw(frames.map((entry) => JSON.stringify(entry)).join("\n"));
    },
    nextId,
    frameOf: (callId, tool, args, extra = {}, caps = capabilities) => frame(callId, tool, args, extra, caps),
    envelope: (caps = capabilities) => envelopeOf(caps),
    dialogs: () => wire.stdout().filter((line) => isDialogLine(line) || isInputRequired(line)).length,
  };
}

// -- what a dialog says, written from the spec ----------------------------------------------------------------------------------------

/** The dialog message of a gate: the template of decision 13, filled in by hand. */
export function dialogMessage(operation: string, target: string, scope: string, port: number): string {
  return [
    `Confirm: ${operation}.`,
    `Target: ${target}`,
    `Scope: ${scope}`,
    `Server: default (127.0.0.1:${port})`,
    "Tick Confirm and accept to run it now. Decline or cancel to change nothing.",
  ].join("\n");
}

/** The form every gate sends. */
export const FORM_SCHEMA: Json = {
  type: "object",
  properties: { confirm: { type: "boolean", title: "Confirm", description: "Tick to confirm this change.", default: false } },
  required: ["confirm"],
};

const NOT_AGAIN = "Nothing was changed. Do not repeat this call unless the person asks for it again.";

/** The text of `CONFIRMATION_DECLINED` for an answer. */
export function declinedText(operation: string, response: "decline" | "cancel" | "unconfirmed"): string {
  const lead = {
    decline: `The person declined the confirmation for: ${operation}.`,
    cancel: `The person dismissed the confirmation dialog for: ${operation}.`,
    unconfirmed: `The person accepted the confirmation dialog for: ${operation} without ticking Confirm.`,
  }[response];
  return `${lead} ${NOT_AGAIN}`;
}

/** The audit text of a dialog that nobody answered. */
export const UNANSWERED_TEXT = "The confirmation dialog was not answered. Nothing was changed.";

/** The audit text of a call the client cancelled. */
export const CANCELLED_TEXT =
  "Cancelled by the client before a result was sent. An IRIS request still in flight was aborted; a write IRIS had already received may still have completed.";

/** A tool result without the 2026-07-28 additions (`resultType`, the server identity in `_meta`). */
export function plainResult(result: Json): Json {
  const copy = { ...(result ?? {}) };
  delete copy.resultType;
  delete copy._meta;
  return copy;
}
