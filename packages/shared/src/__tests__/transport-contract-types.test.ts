import { describe, it, expect } from "vitest";
import type { McpServerBase } from "../server-base.js";
import type { resolveTransport } from "../transport.js";

/**
 * Story 38.1 (AD-23), AC 38.1.2 -- the type contract of the transport surface:
 * `McpServerBase.start()` accepts only `"stdio"`, and `resolveTransport()` is
 * typed to return exactly that. `resolveTransport()` is the single producer of
 * the value, and no runtime branch handles any other, so the compiler is the
 * only guard that a second transport value cannot be passed.
 *
 * This file pins the contract at compile time: `tsc` (`pnpm --filter
 * @iris-mcp/shared type-check`, and the package build, which compiles
 * `src/__tests__`) fails on an unused `@ts-expect-error` if `start()` is
 * widened, and on the `forwarded` return if `resolveTransport()` is widened.
 * `vitest run` strips types, so the runtime assertions below only confirm the
 * file ran.
 */

/** The parameter type of `McpServerBase.start()`. */
type StartTransport = NonNullable<Parameters<McpServerBase["start"]>[0]>;

describe("transport type contract (compile-time, checked by tsc)", () => {
  it('start() accepts only "stdio", and resolveTransport() returns a type start() accepts', () => {
    const supported: StartTransport = "stdio";
    // @ts-expect-error -- "http" must not be assignable to start()'s parameter type.
    const unsupported: StartTransport = "http";
    // A resolveTransport() return type wider than start()'s parameter fails to compile here.
    const forwarded = (transport: ReturnType<typeof resolveTransport>): StartTransport => transport;

    expect(forwarded(supported)).toBe("stdio");
    expect(typeof unsupported).toBe("string");
  });
});
