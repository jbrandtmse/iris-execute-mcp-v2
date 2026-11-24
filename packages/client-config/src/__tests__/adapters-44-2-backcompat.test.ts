/**
 * Story 44.2, AC 44.2.8 - the other 14 adapters and the dispositions are byte-for-byte what they were before the story.
 *
 * Rule #36 oracle: `fixtures/adapters-pre-44-2.json` was captured from the dist built from the PRE-EDIT tree (baseline commit
 * 9f7797c5), before any source edit of this story, with
 *   node capture-oracle.mjs <repo-root> <out-dir>
 * which writes `JSON.stringify` of `CLIENT_ADAPTERS` minus `vscode`, plus `CLIENT_DISPOSITIONS`. Only the `vscode` record
 * and `ADAPTER_DATA_VERSION` are allowed to move (the latter is pinned in `adapters.test.ts`).
 */

import { describe, expect, it } from "vitest";

import { CLIENT_ADAPTERS, CLIENT_DISPOSITIONS } from "../adapters.js";

import { readFixture } from "./helpers.js";

interface PreStoryCapture {
  captureCommand: string;
  adapters: Record<string, unknown>;
  dispositions: unknown[];
}

const PRE: PreStoryCapture = JSON.parse(readFixture("adapters-pre-44-2.json")) as PreStoryCapture;

describe("AC 44.2.8 - the adapters this story does not touch", () => {
  it("the oracle holds 14 adapters and no vscode record", () => {
    expect(Object.keys(PRE.adapters)).toHaveLength(14);
    expect(PRE.adapters.vscode).toBeUndefined();
  });

  it("the roster still has 15 adapters: the 14 captured ones plus vscode", () => {
    expect(Object.keys(CLIENT_ADAPTERS).sort()).toEqual([...Object.keys(PRE.adapters), "vscode"].sort());
    expect(Object.keys(CLIENT_ADAPTERS)).toHaveLength(15);
  });

  it("every other adapter record is toEqual its pre-story capture", () => {
    for (const [id, before] of Object.entries(PRE.adapters)) {
      expect(JSON.parse(JSON.stringify(CLIENT_ADAPTERS[id])), id).toEqual(before);
    }
  });

  it("CLIENT_DISPOSITIONS is toEqual its pre-story capture", () => {
    expect(JSON.parse(JSON.stringify(CLIENT_DISPOSITIONS))).toEqual(PRE.dispositions);
  });
});
