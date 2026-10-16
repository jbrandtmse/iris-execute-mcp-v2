/** Probe A of the serial-suite guard (see `serial-probe.ts`): inert unless the guard's child run arms it. */

import { describe, it, expect } from "vitest";
import { holdAndWatch } from "./serial-probe.js";

describe("serial-suite probe A (inert unless armed by epic38-gate-guards)", () => {
  it("holds its marker only when the guard names a marker directory", async () => {
    await expect(holdAndWatch("a", "b")).resolves.toBeUndefined();
  });
});
