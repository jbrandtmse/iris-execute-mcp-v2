/**
 * Rule #14/#16 (verify third-party API shapes live, don't trust a snapshot
 * forever): `constants.ts` hardcodes two identifiers owned by the
 * InterSystems Server Manager extension so `dist/*.js` has zero npm runtime
 * dependency (see that file's doc comment for why). This test imports the
 * REAL `@intersystems-community/intersystems-servermanager` package (a
 * devDependency here — types + this one regression check) and pins our
 * hardcoded values against its actual exports, so a future version bump that
 * changes either string is caught mechanically instead of silently drifting.
 */
import { describe, expect, it } from "vitest";
import * as serverManager from "@intersystems-community/intersystems-servermanager";
import { AUTHENTICATION_PROVIDER, SERVER_MANAGER_EXTENSION_ID } from "../constants.js";

describe("hardcoded Server Manager constants stay in sync with the real package", () => {
  it("SERVER_MANAGER_EXTENSION_ID matches the real package's EXTENSION_ID", () => {
    expect(SERVER_MANAGER_EXTENSION_ID).toBe(serverManager.EXTENSION_ID);
  });

  it("AUTHENTICATION_PROVIDER matches the real package's AUTHENTICATION_PROVIDER", () => {
    expect(AUTHENTICATION_PROVIDER).toBe(serverManager.AUTHENTICATION_PROVIDER);
  });
});
