/**
 * The helpers the gates that read rendered prompts share: a render's numbered steps, the `iris_*` tool names it mentions, the
 * text of a `prompts/get` answer, and the rejection of a `prompts/get`. They read what a server returned; they never render a
 * prompt themselves. No IRIS.
 */

import { expect } from "vitest";
import type { WireSession } from "./process-gate-helpers.js";

/** The numbered steps of a rendered prompt, by number: the text from `N. ` up to the next step. */
export function stepsOf(text: string): Map<number, string> {
  const steps = new Map<number, string>();
  for (const chunk of text.split(/\n(?=\d+\. )/)) {
    const match = /^(\d+)\. /.exec(chunk);
    if (match) steps.set(Number(match[1]), chunk);
  }
  return steps;
}

/** The distinct `iris_*` tool names a rendered prompt mentions, sorted. */
export function toolTokens(text: string): string[] {
  return [...new Set(text.match(/\biris_[a-z][a-z0-9_]*/g) ?? [])].sort();
}

/** The text of the one user message a `prompts/get` answers. */
export function promptText(rendered: { messages: Array<{ role: string; content: { type: string; text?: string } }> }): string {
  expect(rendered.messages).toHaveLength(1);
  const message = rendered.messages[0] as (typeof rendered.messages)[number];
  expect(message.role).toBe("user");
  expect(message.content.type).toBe("text");
  return message.content.text ?? "";
}

/** The rejection of a `prompts/get`, or `undefined` when it rendered. */
export async function promptRejection(
  session: WireSession,
  request: Parameters<WireSession["getPrompt"]>[0],
): Promise<{ code?: number; message?: string } | undefined> {
  return session.getPrompt(request).then(
    () => undefined,
    (error: unknown) => error as { code?: number; message?: string },
  );
}
