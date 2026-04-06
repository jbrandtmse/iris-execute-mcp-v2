/**
 * HTTP client for communicating with IRIS.
 *
 * Uses the native Node.js `fetch` API (18+) with automatic session
 * management, CSRF token handling, and structured error mapping.
 */

import { IrisConnectionConfig } from "./config.js";
import { IrisApiError, IrisConnectionError } from "./errors.js";
import { logger } from "./logger.js";

/** Options that callers may pass to individual requests. */
export interface RequestOptions {
  /** Additional headers to merge into the request. */
  headers?: Record<string, string>;
  /** Per-request timeout in milliseconds (overrides client default). */
  timeout?: number;
}

/** Shape of the Atelier-style JSON response envelope. */
export interface AtelierEnvelope<T = unknown> {
  status: { errors: unknown[]; summary?: string };
  console: string[];
  result: T;
}

/**
 * Shared HTTP client for all IRIS MCP servers.
 *
 * Lifecycle:
 * 1. First request authenticates with HTTP Basic and stores the session cookie.
 * 2. Subsequent requests use the session cookie only.
 * 3. On 401, the client retries once with Basic Auth to re-establish the session.
 */
export class IrisHttpClient {
  private readonly config: IrisConnectionConfig;
  private readonly defaultTimeout: number;

  /** Simple cookie jar — IRIS uses a single session cookie. */
  private cookies: Map<string, string> = new Map();
  /** CSRF token extracted from IRIS response headers. */
  private csrfToken: string | undefined;
  /** Whether a session has been established. */
  private sessionEstablished = false;

  constructor(config: IrisConnectionConfig, defaultTimeout = 30_000) {
    this.config = config;
    this.defaultTimeout = defaultTimeout;
  }

  // ── Public typed methods ──────────────────────────────────────────

  async get<T = unknown>(
    path: string,
    options?: RequestOptions,
  ): Promise<AtelierEnvelope<T>> {
    return this.request<T>("GET", path, undefined, options);
  }

  async post<T = unknown>(
    path: string,
    body: unknown,
    options?: RequestOptions,
  ): Promise<AtelierEnvelope<T>> {
    return this.request<T>("POST", path, body, options);
  }

  async put<T = unknown>(
    path: string,
    body: unknown,
    options?: RequestOptions,
  ): Promise<AtelierEnvelope<T>> {
    return this.request<T>("PUT", path, body, options);
  }

  async delete<T = unknown>(
    path: string,
    options?: RequestOptions,
  ): Promise<AtelierEnvelope<T>> {
    return this.request<T>("DELETE", path, undefined, options);
  }

  /**
   * Send a HEAD request. Returns nothing on success; throws on failure.
   *
   * HEAD requests have no response body, so no JSON parsing is performed.
   * Cookies and auth are handled identically to other methods. CSRF tokens
   * are not sent since HEAD is idempotent.
   */
  async head(path: string, options?: RequestOptions): Promise<void> {
    return this.headRequest(path, options);
  }

  // ── Core request engine ───────────────────────────────────────────

  private async request<T>(
    method: string,
    path: string,
    body: unknown | undefined,
    options?: RequestOptions,
    isRetry = false,
  ): Promise<AtelierEnvelope<T>> {
    const url = `${this.config.baseUrl}${path}`;
    const timeout = options?.timeout ?? this.defaultTimeout;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);

    const headers: Record<string, string> = {
      Accept: "application/json",
      ...options?.headers,
    };

    // Auth: use Basic when no session yet, or when retrying after 401
    if (!this.sessionEstablished || isRetry) {
      headers["Authorization"] = this.basicAuthHeader();
    }

    // Session cookie
    const cookieStr = this.buildCookieHeader();
    if (cookieStr) {
      headers["Cookie"] = cookieStr;
    }

    // CSRF token for mutating methods
    if (
      this.csrfToken &&
      ["POST", "PUT", "DELETE"].includes(method)
    ) {
      headers["X-CSRF-Token"] = this.csrfToken;
    }

    if (body !== undefined) {
      headers["Content-Type"] = "application/json";
    }

    const start = Date.now();

    try {
      const fetchBody: BodyInit | null =
        body !== undefined ? JSON.stringify(body) : null;

      const response = await fetch(url, {
        method,
        headers,
        body: fetchBody,
        signal: controller.signal,
        keepalive: true,
      });

      clearTimeout(timer);
      const duration = Date.now() - start;

      // Extract session cookie from response
      this.extractCookies(response);
      // Extract CSRF token
      this.extractCsrfToken(response);

      // Mark session as established on successful auth
      if (response.ok) {
        this.sessionEstablished = true;
      }

      // Auto re-auth on 401 (single retry)
      if (response.status === 401 && !isRetry) {
        logger.warn(`Session expired for ${method} ${path}, re-authenticating`);
        this.sessionEstablished = false;
        return this.request<T>(method, path, body, options, true);
      }

      // Parse response body
      let envelope: AtelierEnvelope<T>;
      try {
        envelope = (await response.json()) as AtelierEnvelope<T>;
      } catch {
        // IRIS may return non-JSON responses (e.g., HTML error pages)
        if (!response.ok) {
          throw new IrisApiError(
            response.status,
            [],
            path,
            `IRIS returned HTTP ${response.status} for ${method} ${path} with a non-JSON response. Check the IRIS web server configuration.`,
          );
        }
        throw new IrisApiError(
          response.status,
          [],
          path,
          `IRIS returned a non-JSON response for ${method} ${path}. Expected an Atelier envelope but could not parse the body.`,
        );
      }

      // Check for HTTP errors
      if (!response.ok) {
        const errors = envelope?.status?.errors ?? [];
        throw new IrisApiError(
          response.status,
          errors,
          path,
          `IRIS returned HTTP ${response.status} for ${method} ${path}. Check the request parameters and try again.`,
        );
      }

      // Check for Atelier-level errors
      if (
        envelope?.status?.errors &&
        envelope.status.errors.length > 0
      ) {
        throw new IrisApiError(
          response.status,
          envelope.status.errors,
          path,
          `IRIS reported errors for ${method} ${path}. Review the error details and correct the request.`,
        );
      }

      logger.info(
        `${method} ${path} completed in ${duration}ms`,
      );

      return envelope;
    } catch (error: unknown) {
      clearTimeout(timer);

      // Re-throw our own error types
      if (error instanceof IrisApiError) throw error;
      if (error instanceof IrisConnectionError) throw error;

      // Timeout
      if (
        error instanceof DOMException ||
        (error instanceof Error && error.name === "AbortError")
      ) {
        throw new IrisConnectionError(
          "TIMEOUT",
          `Connection to IRIS timed out after ${timeout}ms`,
          `Check that the IRIS web port is accessible at ${this.config.host}:${this.config.port}`,
        );
      }

      // Network / DNS errors
      if (error instanceof TypeError) {
        throw new IrisConnectionError(
          "NETWORK_ERROR",
          `Failed to connect to IRIS at ${this.config.host}:${this.config.port}`,
          `Verify the host and port are correct, and that IRIS is running`,
        );
      }

      // Unexpected
      throw new IrisConnectionError(
        "UNKNOWN",
        `Unexpected error during ${method} ${path}`,
        `Check network connectivity and IRIS availability`,
      );
    }
  }

  // ── HEAD request engine ────────────────────────────────────────────

  /**
   * Internal HEAD request handler — no response body parsing.
   *
   * Handles cookies, auth, and 401 retry identically to the main
   * request engine, but does not attempt to read or parse the
   * response body. CSRF tokens are not sent (HEAD is idempotent).
   */
  private async headRequest(
    path: string,
    options?: RequestOptions,
    isRetry = false,
  ): Promise<void> {
    const url = `${this.config.baseUrl}${path}`;
    const timeout = options?.timeout ?? this.defaultTimeout;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);

    const headers: Record<string, string> = {
      ...options?.headers,
    };

    if (!this.sessionEstablished || isRetry) {
      headers["Authorization"] = this.basicAuthHeader();
    }

    const cookieStr = this.buildCookieHeader();
    if (cookieStr) {
      headers["Cookie"] = cookieStr;
    }

    const start = Date.now();

    try {
      const response = await fetch(url, {
        method: "HEAD",
        headers,
        signal: controller.signal,
        keepalive: true,
      });

      clearTimeout(timer);
      const duration = Date.now() - start;

      this.extractCookies(response);
      this.extractCsrfToken(response);

      if (response.ok) {
        this.sessionEstablished = true;
      }

      // Auto re-auth on 401 (single retry)
      if (response.status === 401 && !isRetry) {
        logger.warn(`Session expired for HEAD ${path}, re-authenticating`);
        this.sessionEstablished = false;
        return this.headRequest(path, options, true);
      }

      if (!response.ok) {
        throw new IrisApiError(
          response.status,
          [],
          path,
          `IRIS returned HTTP ${response.status} for HEAD ${path}. Check the request parameters and try again.`,
        );
      }

      logger.info(`HEAD ${path} completed in ${duration}ms`);
    } catch (error: unknown) {
      clearTimeout(timer);

      if (error instanceof IrisApiError) throw error;
      if (error instanceof IrisConnectionError) throw error;

      if (
        error instanceof DOMException ||
        (error instanceof Error && error.name === "AbortError")
      ) {
        throw new IrisConnectionError(
          "TIMEOUT",
          `Connection to IRIS timed out after ${timeout}ms`,
          `Check that the IRIS web port is accessible at ${this.config.host}:${this.config.port}`,
        );
      }

      if (error instanceof TypeError) {
        throw new IrisConnectionError(
          "NETWORK_ERROR",
          `Failed to connect to IRIS at ${this.config.host}:${this.config.port}`,
          `Verify the host and port are correct, and that IRIS is running`,
        );
      }

      throw new IrisConnectionError(
        "UNKNOWN",
        `Unexpected error during HEAD ${path}`,
        `Check network connectivity and IRIS availability`,
      );
    }
  }

  // ── Helpers ───────────────────────────────────────────────────────

  private basicAuthHeader(): string {
    const encoded = Buffer.from(
      `${this.config.username}:${this.config.password}`,
    ).toString("base64");
    return `Basic ${encoded}`;
  }

  private buildCookieHeader(): string {
    if (this.cookies.size === 0) return "";
    return [...this.cookies.entries()]
      .map(([k, v]) => `${k}=${v}`)
      .join("; ");
  }

  private extractCookies(response: Response): void {
    const setCookie = response.headers.getSetCookie?.();
    if (!setCookie) return;

    for (const cookie of setCookie) {
      const nameValue = cookie.split(";")[0];
      if (!nameValue) continue;
      const eqIdx = nameValue.indexOf("=");
      if (eqIdx === -1) continue;
      const name = nameValue.substring(0, eqIdx).trim();
      const value = nameValue.substring(eqIdx + 1).trim();
      this.cookies.set(name, value);
    }
  }

  private extractCsrfToken(response: Response): void {
    const token = response.headers.get("X-CSRF-Token");
    if (token) {
      this.csrfToken = token;
    }
  }

  /** Clear session state (cookies, CSRF token, session flag). */
  destroy(): void {
    this.cookies.clear();
    this.csrfToken = undefined;
    this.sessionEstablished = false;
  }
}
