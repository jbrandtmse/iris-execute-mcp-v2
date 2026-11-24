/**
 * The deprecated 1.x names stay exported from the package's public entry point and keep their contract: `ensureInputs`,
 * `presentInputIds`, `VscodeInput` and `VSCODE_PASSWORD_INPUT_ID` (plus the `EnsureInputsResult` type of `ensureInputs`).
 *
 * The refusal text for a non-`vscode` adapter is the one the pre-story `ensureInputs` returned (baseline 9f7797c5,
 * `engine.ts` `ensureInputs`), and the pre-story `clients-cli.test.ts` "refuses for a non-vscode client" pinned
 * "VS Code concept". Since no adapter uses the `vscode` expansion, that refusal is now the answer for every client.
 * Self-contained: an in-memory filesystem, no real HOME.
 */

import { describe, expect, it } from "vitest";

import * as api from "../index.js";
import {
  CLIENT_ADAPTERS,
  ensureInputs,
  presentInputIds,
  VSCODE_PASSWORD_INPUT_ID,
  type EnsureInputsResult,
  type VscodeInput,
} from "../index.js";

import { MemFs } from "./helpers.js";

const HOME = "/home/tester";
const DESCRIPTOR: VscodeInput = { id: VSCODE_PASSWORD_INPUT_ID, type: "promptString", description: "IRIS password", password: true };

describe("deprecated public exports (semver: a patch release keeps every 1.x name)", () => {
  it("the package entry point still exports the four names", () => {
    expect(typeof api.ensureInputs).toBe("function");
    expect(typeof api.presentInputIds).toBe("function");
    expect(api.VSCODE_PASSWORD_INPUT_ID).toBe("iris-password");
    // VscodeInput and EnsureInputsResult are types: this file fails type-check if either is no longer exported.
    const input: VscodeInput = DESCRIPTOR;
    expect(input.id).toBe("iris-password");
  });

  it("presentInputIds keeps its contract", () => {
    expect(presentInputIds("")).toEqual({ ok: true, ids: [] });
    expect(presentInputIds(`{\n  // a comment\n  "inputs": [{"id": "a"}, {"id": "b"}, 3,],\n}`)).toEqual({ ok: true, ids: ["a", "b"] });
    expect(presentInputIds(`{"servers": {}}`)).toEqual({ ok: true, ids: [] });
    expect(presentInputIds(`{"inputs": {}}`)).toEqual({ ok: false, error: `the top-level "inputs" key is not an array` });
    expect(presentInputIds(`[]`)).toEqual({ ok: false, error: "top-level JSON value is not an object" });
    expect(presentInputIds(`{"inputs": [`).ok).toBe(false);
  });

  it("no adapter uses the vscode env expansion, so ensureInputs refuses for every client and writes nothing", () => {
    const fs = new MemFs();
    for (const [id, adapter] of Object.entries(CLIENT_ADAPTERS)) {
      expect(adapter.envExpansion, id).not.toBe("vscode");
      for (const scope of ["user", "project"] as const) {
        const result: EnsureInputsResult = ensureInputs({ platform: "linux", env: {}, homeDir: HOME, projectDir: "/work/p" }, id, scope, [DESCRIPTOR], { fs });
        expect(result, `${id}/${scope}`).toEqual({
          ok: false,
          client: id,
          scope,
          path: null,
          changed: false,
          added: [],
          reason: `native inputs are a VS Code concept; ${id} (${adapter.envExpansion} expansion) does not use them`,
        });
      }
    }
    expect(fs.files.size).toBe(0);
  });

  it("ensureInputs names the known clients for an unknown one", () => {
    const result = ensureInputs({ platform: "linux", env: {}, homeDir: HOME }, "no-such-client", "user", [DESCRIPTOR]);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe(`unknown client "no-such-client" (known clients: ${Object.keys(CLIENT_ADAPTERS).join(", ")})`);
  });
});
