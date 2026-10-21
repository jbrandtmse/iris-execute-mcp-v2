/**
 * Story 43.4 QA (AC 43.4.3 docs; project rules #30, #43, #59) - the claims of the new client docs, checked against the BUILT servers.
 *
 * `story-43-4-doc-claims.test.ts` pins what the documents say; it cannot tell whether the claim is true. This file takes three facts
 * the docs state and drives the built servers for each:
 *  - the `Elicitation` hook output of `README.md` and `docs/client-config/claude-code.md`, parsed out of the documents themselves, is
 *    accepted by the live server as an answer to its dialog (the accept runs the purge once, the decline changes nothing), on the
 *    2025-11-25 handshake and on `auto` (2026-07-28), and the `content` key the hook prints is a field of the form the server sends;
 *  - the revisions: one stdio process answers `initialize` with 2025-11-25 (also when the client asks for 2026-07-28) and
 *    `server/discover` with 2026-07-28, on every server;
 *  - the log: at the default log level the server writes one `[INFO]` era line to stderr each time it builds an instance for a connection,
 *    naming the era of the message that connection opened with (a `server/discover` followed by `initialize` on one connection builds two).
 * Servers run against a fake IRIS listener or a closed port (127.0.0.1); no IRIS instance is reached. A stale dist fails the file.
 */

import { afterEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { REPO_ROOT } from "./pack-fixture";
import {
  CLOSED_PORT_ENV,
  GOLDEN_PACKAGES,
  discoverHandshake,
  handshake,
  inheritedGoldenEnv,
  modernEnvelope,
  openRawWire,
  withEnvelope,
} from "../../../../scripts/lib/sdk-wire-golden-core.mjs";
import { distEntry } from "./process-gate-helpers.js";
import type { SdkVersionNegotiation } from "./process-gate-helpers.js";
import { closeSdkRigs, openSdkRig } from "./sdk-confirmation-rig.js";
import { LEGACY_ERA_LINE, MODERN_ERA_LINE } from "./story-43-2-qa-hand-wire.js";
import { requireFreshDists } from "./story-43-3-qa-wire.js";

const read = (relative: string): string => readFileSync(path.join(REPO_ROOT, relative), "utf8");
const rootReadme = read("README.md");
const claudeCodeDoc = read("docs/client-config/claude-code.md");

const countOf = (text: string, needle: string): number => text.split(needle).length - 1;

interface HookOutput {
  hookSpecificOutput: { hookEventName: string; action: string; content?: Record<string, unknown> };
}

/** The accept output that `document` prints for the hook: the JSON between backticks that starts at `{"hookSpecificOutput"`. */
function hookAcceptOf(document: string): { text: string; parsed: HookOutput } {
  const match = /`(\{"hookSpecificOutput":\{"hookEventName":"Elicitation","action":"accept"[^`]*\})`/.exec(document);
  expect(match, "the document prints the accept output of the hook").not.toBeNull();
  const text = match![1] as string;
  return { text, parsed: JSON.parse(text) as HookOutput };
}

describe("the Elicitation hook output of the docs, answered to a live dialog", () => {
  afterEach(closeSdkRigs);

  it("the root README and the Claude Code page print the same hook output, with the event name, an accept action and the form's field", () => {
    const fromReadme = hookAcceptOf(rootReadme);
    const fromPage = hookAcceptOf(claudeCodeDoc);
    expect(fromPage.text).toBe(fromReadme.text);
    expect(fromPage.parsed.hookSpecificOutput).toEqual({ hookEventName: "Elicitation", action: "accept", content: { confirm: true } });
    expect(claudeCodeDoc).toContain('"action":"decline"');
  });

  it.each([
    ["the 2025-11-25 handshake", { mode: "legacy" } as SdkVersionNegotiation],
    ["auto (2026-07-28)", { mode: "auto" } as SdkVersionNegotiation],
  ])("on %s: the documented accept runs the purge once, and the documented decline changes nothing", async (_name, negotiation) => {
    requireFreshDists("iris-admin-mcp");
    const accept = hookAcceptOf(claudeCodeDoc).parsed.hookSpecificOutput;
    const decline = (JSON.parse(hookAcceptOf(claudeCodeDoc).text.replace('"action":"accept"', '"action":"decline"')) as HookOutput).hookSpecificOutput;
    const purge = { action: "purge", end: "2026-01-01 00:00:00", confirm: true };
    const rig = await openSdkRig("iris-admin-mcp", negotiation, {
      capabilities: { elicitation: { form: {} } },
      governance: '{"global":{"iris_audit_manage:purge":true}}',
      clientName: "story-43-4-docs",
    });

    rig.answer({ action: accept.action as "accept", content: accept.content as Record<string, unknown> });
    const accepted = await rig.call("iris_audit_manage", purge);
    expect(accepted.asks, "the purge asks once").toHaveLength(1);
    const fields = Object.keys(((accepted.asks[0] as { requestedSchema: { properties: Record<string, unknown> } }).requestedSchema).properties);
    expect(fields, "the key the hook prints is a field of the form").toEqual(Object.keys(accept.content as Record<string, unknown>));
    expect(accepted.result.isError ?? false).toBe(false);
    expect(accepted.writes, "one purge request reached IRIS").toHaveLength(1);
    expect(accepted.writes[0]).toContain('"action":"purge"');

    rig.answer({ action: decline.action as "decline", ...(decline.content === undefined ? {} : { content: decline.content }) });
    const declined = await rig.call("iris_audit_manage", purge);
    expect(declined.asks, "the declined purge asks once").toHaveLength(1);
    expect(declined.result.isError).toBe(true);
    expect((declined.result as { structuredContent?: Record<string, unknown> }).structuredContent).toEqual({ code: "CONFIRMATION_DECLINED", action: "purge", response: "decline" });
    expect(declined.writes, "nothing was sent to IRIS").toEqual([]);
  }, 60_000);
});

describe("the protocol revisions the docs name, on every built server", () => {
  const env = (): Record<string, string> => ({ ...inheritedGoldenEnv(process.env), ...CLOSED_PORT_ENV });

  it.each(GOLDEN_PACKAGES as string[])("%s: initialize selects 2025-11-25 even when 2026-07-28 is asked for, and server/discover selects 2026-07-28", async (pkg) => {
    requireFreshDists(pkg);
    for (const asked of ["2025-11-25", "2026-07-28"]) {
      const wire = openRawWire({ entry: distEntry(REPO_ROOT, pkg), env: env() });
      try {
        const initialized = await handshake(wire, asked, "story-43-4-docs");
        expect((initialized.message.result as { protocolVersion: string }).protocolVersion, `initialize asking for ${asked}`).toBe("2025-11-25");
      } finally {
        await wire.close();
      }
    }
    const modern = openRawWire({ entry: distEntry(REPO_ROOT, pkg), env: env() });
    try {
      const discovered = await discoverHandshake(modern, "story-43-4-docs");
      expect((discovered.message.result as { supportedVersions: string[] }).supportedVersions).toContain("2026-07-28");
      const listed = await modern.request("tools/list", withEnvelope({}, modernEnvelope("story-43-4-docs")));
      expect((listed.message.result as { tools: unknown[] }).tools.length, "the modern connection serves the catalogue").toBeGreaterThan(5);
    } finally {
      await modern.close();
    }
  }, 60_000);
});

describe("the era line the docs name, at the default log level", () => {
  /** Run `body` against a server whose environment has no LOG_LEVEL, then return everything it wrote to stderr. */
  async function stderrOf(body: (wire: ReturnType<typeof openRawWire>) => Promise<void>): Promise<string> {
    requireFreshDists("iris-admin-mcp");
    const base = env();
    const wire = openRawWire({ entry: distEntry(REPO_ROOT, "iris-admin-mcp"), env: base });
    try {
      await body(wire);
    } finally {
      await wire.close();
    }
    return wire.closedStderr();
  }
  const env = (): Record<string, string> => {
    const merged: Record<string, string> = { ...inheritedGoldenEnv(process.env), ...CLOSED_PORT_ENV };
    delete merged["LOG_LEVEL"];
    return merged;
  };

  it("a connection that opens with initialize gets one 2025-era line, and one that opens with server/discover gets one 2026-07-28 line", async () => {
    const legacy = await stderrOf(async (wire) => {
      await handshake(wire, "2025-11-25", "story-43-4-docs");
      await wire.request("tools/list", {});
    });
    expect(countOf(legacy, LEGACY_ERA_LINE)).toBe(1);
    expect(countOf(legacy, MODERN_ERA_LINE)).toBe(0);
    const modern = await stderrOf(async (wire) => {
      await discoverHandshake(wire, "story-43-4-docs");
      await wire.request("tools/list", withEnvelope({}, modernEnvelope("story-43-4-docs")));
    });
    expect(countOf(modern, MODERN_ERA_LINE)).toBe(1);
    expect(countOf(modern, LEGACY_ERA_LINE)).toBe(0);
  }, 60_000);

  it("a server/discover probe followed by initialize on one connection (the Claude Code path) builds two instances: one line each, the probe's first", async () => {
    const both = await stderrOf(async (wire) => {
      await discoverHandshake(wire, "story-43-4-docs");
      await handshake(wire, "2025-11-25", "story-43-4-docs");
      await wire.request("tools/list", {});
    });
    expect(countOf(both, MODERN_ERA_LINE)).toBe(1);
    expect(countOf(both, LEGACY_ERA_LINE)).toBe(1);
    expect(both.indexOf(MODERN_ERA_LINE)).toBeLessThan(both.indexOf(LEGACY_ERA_LINE));
  }, 60_000);
});
