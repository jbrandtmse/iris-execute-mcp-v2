/**
 * Shared test helpers for IRIS MCP tool unit tests.
 *
 * Consolidates `createMockHttp()`, `createMockCtx()`, and `envelope()`
 * so that all server packages (iris-dev-mcp, iris-admin-mcp, etc.)
 * can import them from a single location.
 */

import { vi } from "vitest";
import type { IrisHttpClient, ToolContext, IrisConnectionConfig, AtelierEnvelope, PaginateResult } from "../index.js";

/**
 * Create a fully mocked {@link IrisHttpClient} with vi.fn() stubs
 * for every HTTP method (get, put, delete, post, head).
 *
 * @param namespace - Value returned by the mock's `namespace` accessor
 *   (mirrors {@link IrisHttpClient}'s real read-only `namespace` getter,
 *   Story 27.0 cycle 2). Defaults to `"USER"` for consistency with
 *   {@link createMockCtx}'s default `config.namespace`. Callers that need
 *   two mocks to represent DIFFERENT profiles (e.g. cross-profile diff
 *   tools) should pass distinct values.
 */
export function createMockHttp(namespace = "USER") {
  return {
    get: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
    post: vi.fn(),
    head: vi.fn(),
    namespace,
  } as unknown as IrisHttpClient & {
    get: ReturnType<typeof vi.fn>;
    put: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
    post: ReturnType<typeof vi.fn>;
    head: ReturnType<typeof vi.fn>;
  };
}

/**
 * Create a mock {@link ToolContext} with namespace resolution,
 * the provided HTTP client, and a configurable Atelier version.
 *
 * @param http - Mock HTTP client (defaults to a fresh `createMockHttp()`).
 * @param atelierVersion - Negotiated Atelier API version (default: 7).
 */
export function createMockCtx(
  http?: IrisHttpClient,
  atelierVersion = 7,
): ToolContext {
  const mockHttp = http ?? createMockHttp();
  return {
    resolveNamespace: (override?: string) => override ?? "USER",
    http: mockHttp,
    atelierVersion,
    config: {
      host: "localhost",
      port: 52773,
      username: "_SYSTEM",
      password: "SYS",
      namespace: "USER",
      https: false,
      baseUrl: "http://localhost:52773",
      timeout: 60_000,
    } as IrisConnectionConfig,
    paginate<T>(items: T[], _cursor?: string, _pageSize?: number): PaginateResult<T> {
      return { page: items, nextCursor: undefined };
    },
    // Story 27.0: a working default so any test that never overrides it just
    // gets the SAME mock http client back regardless of profile name (most
    // tools never call this). A test that needs per-profile differentiation
    // (e.g. env-diff.test.ts) overrides `ctx.resolveProfileClient` directly
    // with its own `vi.fn()`.
    resolveProfileClient: vi.fn(async (_profileName: string) => mockHttp),
  };
}

/**
 * Wrap a result value in the standard Atelier envelope shape.
 *
 * @param result - The result payload.
 * @param console - Optional console output lines (default: `[]`).
 */
export function envelope<T>(result: T, console: string[] = []): AtelierEnvelope<T> {
  return {
    status: { errors: [] },
    console,
    result,
  };
}
