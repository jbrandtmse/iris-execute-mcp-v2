/**
 * Story 42.7 code review (Rule #59): a real-CLI test file whose build is missing skips off CI and fails on CI, where the
 * `launcher` job builds every package first. The env is passed in, so these rows do not depend on where the suite runs.
 */
import { describe, expect, it } from "vitest";
import { onCi, skipUnbuilt } from "./builtDist.js";

function fakeCtx(): { skip: () => void; skipped: number } {
  const ctx = { skipped: 0, skip: () => void (ctx.skipped += 1) };
  return ctx;
}

describe("skipUnbuilt: a missing build skips off CI and fails on CI", () => {
  it("with no reason it neither skips nor throws, on CI or off it", () => {
    for (const env of [{}, { CI: "true" }]) {
      const ctx = fakeCtx();
      expect(skipUnbuilt(ctx, "row", undefined, env)).toBe(false);
      expect(ctx.skipped).toBe(0);
    }
  });

  it("off CI a reason skips the test (a fresh clone that has not been built)", () => {
    for (const env of [{}, { CI: "false" }, { CI: "1" }]) {
      const ctx = fakeCtx();
      expect(skipUnbuilt(ctx, "row", "packages/x/dist is not built", env)).toBe(true);
      expect(ctx.skipped).toBe(1);
    }
  });

  it("on CI (GitHub Actions sets CI=true) a reason fails the test, naming the label and the reason, and never skips", () => {
    const ctx = fakeCtx();
    expect(() => skipUnbuilt(ctx, "governance engine real-CLI e2e (universe render)", "packages/iris-ops-mcp/dist/tools/index.js is not built", { CI: "true" })).toThrow(
      "governance engine real-CLI e2e (universe render) may not skip on CI, where the launcher job builds every package first: packages/iris-ops-mcp/dist/tools/index.js is not built",
    );
    expect(ctx.skipped).toBe(0);
  });

  it("onCi is exactly CI=true", () => {
    expect(onCi({ CI: "true" })).toBe(true);
    expect(onCi({})).toBe(false);
    expect(onCi({ CI: "false" })).toBe(false);
  });
});
