/**
 * The human-confirmation helper of the confirmation gates (AD-34, Story 43.3).
 *
 * A gate asks the person through `ToolContext.confirm` right before its first IRIS write. This module holds the
 * parts of that exchange that do not need the MCP SDK: the dialog text and schema, the capability test, the
 * argument hash, the state and nonce bookkeeping, the classification of an answer and the refusal that ends a
 * call the person did not confirm. The framework (`server-base.ts`) owns everything that touches the wire.
 *
 * - **Dialog.** {@link confirmationMessage} renders the form message and {@link CONFIRMATION_SCHEMA} is its form: one
 *   boolean `confirm`. Only an accept with `confirm: true` proceeds.
 * - **Capability.** {@link declaresFormElicitation} is true for `elicitation: {}`, `{form: {}}` and
 *   `{form: {}, url: {}}`, and false for `{url: {}}` alone.
 * - **Binding.** {@link contentHash} is a SHA-256 over key-sorted JSON; a {@link ConfirmationState} carries the tool, the
 *   hash of the call and a nonce that {@link ConfirmationNonces} lets be used once.
 * - **Outcome.** {@link classifyConfirmationResponse} maps an answer to `accepted`, `decline`, `cancel`, `unconfirmed` or
 *   `missing`; {@link confirmationDeclinedResult} is the `CONFIRMATION_DECLINED` refusal for the first three.
 */

import { createHash } from "node:crypto";

import type { AuditConfirmation } from "./audit.js";
import { REFUSAL_CODES, refusalResult } from "./refusals.js";
import type { RefusalResult } from "./refusals.js";
import type { ToolResult } from "./tool-types.js";

/** The key of the one embedded request, and of its answer. */
export const CONFIRMATION_INPUT_KEY = "confirm";

/** Seconds a confirmation state, and the pending ask recorded for it, stay valid. */
export const CONFIRMATION_STATE_TTL_SECONDS = 600;

/** The shape of {@link CONFIRMATION_SCHEMA}: a form with one required boolean. */
export interface ConfirmationSchema {
  [member: string]: unknown;
  type: "object";
  properties: {
    confirm: { type: "boolean"; title: string; description: string; default: boolean };
  };
  required: string[];
}

/** The form the person fills in: one boolean `confirm`, required, unticked by default. */
export const CONFIRMATION_SCHEMA: ConfirmationSchema = {
  type: "object",
  properties: {
    confirm: {
      type: "boolean",
      title: "Confirm",
      description: "Tick to confirm this change.",
      default: false,
    },
  },
  required: ["confirm"],
};

/** The audit error of a call that the client cancelled. */
export const CANCELLED_CALL_TEXT =
  "Cancelled by the client before a result was sent. An IRIS request still in flight was aborted; " +
  "a write IRIS had already received may still have completed.";

/** The audit error of a dialog that nobody answered. */
export const UNANSWERED_CONFIRMATION_TEXT =
  "The confirmation dialog was not answered. Nothing was changed.";

/** The longest target or scope the dialog shows; a longer one is cut here and ends in `...`. */
const MAX_TEXT_CHARACTERS = 600;

/** The words the dialog needs from a gate, resolved: the operation, what it targets and what it covers. */
export interface ConfirmationText {
  operation: string;
  target: string;
  scope: string;
}

/** The server a confirmation names, so the person sees where the change would land. */
export interface ConfirmationServer {
  profile: string;
  host: string;
  port: number | string;
}

/**
 * A value that a call supplied, as one line of dialog text: each run of control characters (a line break included),
 * of invisible format characters (bidirectional overrides and isolates, zero-width characters) and of Unicode line
 * and paragraph separators becomes one space, so the value cannot start a line of its own or reorder or hide the rest
 * of its line, and a value longer than 600 characters is cut there and ends in `...`, so it cannot push the other
 * lines out of view.
 */
function dialogLine(value: string): string {
  const line = value.replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]+/gu, " ");
  return line.length > MAX_TEXT_CHARACTERS ? `${line.slice(0, MAX_TEXT_CHARACTERS)}...` : line;
}

/** The dialog message of a gate. `target` and `scope` are one line each, cut to 600 characters, then `...` is appended. */
export function confirmationMessage(text: ConfirmationText, server: ConfirmationServer): string {
  return [
    `Confirm: ${text.operation}.`,
    `Target: ${dialogLine(text.target)}`,
    `Scope: ${dialogLine(text.scope)}`,
    `Server: ${server.profile} (${server.host}:${server.port})`,
    "Tick Confirm and accept to run it now. Decline or cancel to change nothing.",
  ].join("\n");
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Whether a client's declared capabilities include form elicitation.
 *
 * `elicitation: {}` (a declaration with no mode) counts as form, as it does for the SDK; `{url: {}}` alone does not.
 * Anything that is not an object with such an `elicitation` member is not form elicitation.
 */
export function declaresFormElicitation(capabilities: unknown): boolean {
  if (!isPlainObject(capabilities)) return false;
  const elicitation = capabilities["elicitation"];
  if (!isPlainObject(elicitation)) return false;
  if (elicitation["form"] !== undefined) return true;
  return elicitation["url"] === undefined;
}

/** Recursively sort object keys; arrays keep their order. */
function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeysDeep);
  if (isPlainObject(value)) {
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) {
      sorted[key] = sortKeysDeep(value[key]);
    }
    return sorted;
  }
  return value;
}

/**
 * A stable content hash: the SHA-256 hex digest of the key-sorted JSON of `value`. The same for any key order, and
 * different for any value change.
 */
export function contentHash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(sortKeysDeep(value))).digest("hex");
}

/** The payload of a confirmation `requestState`: which call it was minted for, and its single-use nonce. */
export interface ConfirmationState {
  v: 1;
  tool: string;
  hash: string;
  nonce: string;
}

/** Whether `value` has the shape of a {@link ConfirmationState}. */
export function isConfirmationState(value: unknown): value is ConfirmationState {
  return (
    isPlainObject(value) &&
    value["v"] === 1 &&
    typeof value["tool"] === "string" &&
    typeof value["hash"] === "string" &&
    typeof value["nonce"] === "string" &&
    value["nonce"] !== ""
  );
}

/**
 * The nonces of confirmation states that were used. A nonce is used on the round that decides the call, so the same
 * state is never honored twice; an entry is dropped once the state it belongs to has expired.
 */
export class ConfirmationNonces {
  private readonly used = new Map<string, number>();

  /**
   * @param ttlMs - How long a used nonce is remembered.
   * @param now - The clock, in milliseconds.
   */
  constructor(
    private readonly ttlMs: number = CONFIRMATION_STATE_TTL_SECONDS * 1000,
    private readonly now: () => number = () => Date.now(),
  ) {}

  /** Whether `nonce` has been used and is still remembered. */
  isUsed(nonce: string): boolean {
    this.prune();
    return this.used.has(nonce);
  }

  /** Remember `nonce` as used. */
  markUsed(nonce: string): void {
    this.prune();
    this.used.set(nonce, this.now() + this.ttlMs);
  }

  /** The number of nonces remembered. */
  get size(): number {
    this.prune();
    return this.used.size;
  }

  private prune(): void {
    const now = this.now();
    for (const [nonce, expiry] of this.used) {
      if (expiry <= now) this.used.delete(nonce);
    }
  }
}

/** The answer a retry carried for the confirmation, as `inputResponse()` of the SDK views it. */
export interface ConfirmationResponseView {
  kind: string;
  action?: string;
  content?: unknown;
}

/** How the person answered: `missing` is no usable answer at all. */
export type ConfirmationResponse = "accepted" | "decline" | "cancel" | "unconfirmed" | "missing";

/**
 * Classify an answer. Only an accept whose content has `confirm: true` is `accepted`; an accept without it is
 * `unconfirmed`; a view that is not an elicitation answer, or has an action the protocol does not define, is `missing`.
 */
export function classifyConfirmationResponse(view: ConfirmationResponseView): ConfirmationResponse {
  if (view.kind !== "elicit") return "missing";
  if (view.action === "accept") {
    return isPlainObject(view.content) && view.content[CONFIRMATION_INPUT_KEY] === true ? "accepted" : "unconfirmed";
  }
  if (view.action === "decline") return "decline";
  if (view.action === "cancel") return "cancel";
  return "missing";
}

/** The three answers that end a call without confirming it. */
export type ConfirmationRefusal = "decline" | "cancel" | "unconfirmed";

/** The audit `confirmation` value of an answer that decides a call. */
export function auditConfirmationOf(response: "accepted" | ConfirmationRefusal): AuditConfirmation {
  switch (response) {
    case "accepted":
      return "accepted";
    case "decline":
      return "declined";
    case "cancel":
      return "cancelled";
    case "unconfirmed":
      return "unconfirmed";
  }
}

const REFUSAL_REASONS: Record<ConfirmationRefusal, string> = {
  decline: "The person declined the confirmation for",
  cancel: "The person dismissed the confirmation dialog for",
  unconfirmed: "The person accepted the confirmation dialog for",
};

/**
 * The refusal that ends a call the person did not confirm: `CONFIRMATION_DECLINED`, `isError`, nothing changed.
 *
 * @param actionKey - The call's action (for example `purge`).
 * @param operation - The gate's operation text, as in the dialog.
 * @param response - How the person answered.
 */
export function confirmationDeclinedResult(
  actionKey: string,
  operation: string,
  response: ConfirmationRefusal,
): RefusalResult {
  const suffix = response === "unconfirmed" ? " without ticking Confirm" : "";
  return refusalResult(
    REFUSAL_CODES.CONFIRMATION_DECLINED,
    `${REFUSAL_REASONS[response]}: ${operation}${suffix}. Nothing was changed. ` +
      "Do not repeat this call unless the person asks for it again.",
    { action: actionKey, response },
  );
}

/**
 * What a handler gets back from `ctx.confirm` when the framework has put a question to the client. The framework
 * swaps it for the real input-required result; a handler returns it unchanged, like any refusal.
 */
export const CONFIRMATION_PENDING: ToolResult = Object.freeze({
  content: [{ type: "text" as const, text: "Waiting for the person to confirm. Nothing was changed." }],
}) as ToolResult;
