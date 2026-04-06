/**
 * HTTP client for communicating with IRIS.
 *
 * Uses the native Node.js `fetch` API (18+) with automatic session
 * management, CSRF token handling, and structured error mapping.
 */

import { IrisConnectionConfig } from "./config.js";
import { IrisApiError, IrisConnectionError } from "./errors.js";
import { logger } from "./logger.js";

/** Response shape from HEAD requests — status code and response headers. */
export interface HeadResponse {
  status: number;
  headers: Headers;
}

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
   * Send a HEAD request. Returns status and headers on success; throws on failure.
   *
   * HEAD requests have no response body, so no JSON parsing is performed.
   * Cookies and auth are handled identically to other methods. CSRF tokens
   * are not sent since HEAD is idempotent.
   *
   * @returns An object containing the HTTP status code and response headers.
   */
  async head(path: string, options?: RequestOptions): Promise<HeadResponse> {
    return this.headRequest(path, options);
  }

  // ── CSRF pre-flight ───────────────────────────────────────────────

  /**
   * Ensure a CSRF token is available before sending a mutating request.
   *
   * If no CSRF token has been obtained yet, performs a lightweight
   * HEAD request to `/api/atelier/` which establishes the session
   * (cookie + auth) and extracts the CSRF token as a side effect.
   */
  private async ensureCsrfToken(): Promise<void> {
    if (this.csrfToken) return;
    await this.headRequest("/api/atelier/");
    if (!this.csrfToken) {
      logger.warn(
        "CSRF preflight completed but no X-CSRF-Token header was returned. Mutating requests may be rejected by IRIS.",
      );
    }
  }

  // ── Shared fetch engine ───────────────────────────────────────────

  /**
   * Execute a fetch request with shared session/auth/error handling.
   *
   * Encapsulates: URL construction, AbortController/timeout, auth header
   * injection, cookie header injection, fetch call, cookie extraction,
   * CSRF extraction, session establishment, 401 retry, and error handling
   * (timeout, network, unexpected).
   *
   * Returns the raw {@link Response} so callers can handle body/headers
   * as needed.
   *
   * @param method  - HTTP method (GET, POST, PUT, DELETE, HEAD).
   * @param path    - URL path appended to the configured base URL.
   * @param init    - Additional fetch init options (body, extra headers).
   * @param options - Per-request timeout and header overrides.
   * @param isRetry - Whether this is a 401 retry attempt.
   */
  private async executeFetch(
    method: string,
    path: string,
    init: { body?: BodyInit | null; extraHeaders?: Record<string, string> },
    options?: RequestOptions,
    isRetry = false,
  ): Promise<Response> {
    const url = `${this.config.baseUrl}${path}`;
    const timeout = options?.timeout ?? this.defaultTimeout;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);

    const headers: Record<string, string> = {
      ...init.extraHeaders,
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

    const start = Date.now();

    try {
      const response = await fetch(url, {
        method,
        headers,
        body: init.body ?? null,
        signal: controller.signal,
        keepalive: true,
      });

      clearTimeout(timer);
      const duration = Date.now() - start;

      // Extract session cookie and CSRF token from response
      this.extractCookies(response);
      this.extractCsrfToken(response);

      // Mark session as established on successful auth
      if (response.ok) {
        this.sessionEstablished = true;
      }

      // Auto re-auth on 401 (single retry)
      if (response.status === 401 && !isRetry) {
        logger.warn(`Session expired for ${method} ${path}, re-authenticating`);
        this.sessionEstablished = false;
        return this.executeFetch(method, path, init, options, true);
      }

      logger.info(`${method} ${path} completed in ${duration}ms`);
      return response;
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

  // ── Core request engine ───────────────────────────────────────────

  private async request<T>(
    method: string,
    path: string,
    body: unknown | undefined,
    options?: RequestOptions,
    isRetry = false,
  ): Promise<AtelierEnvelope<T>> {
    // Ensure CSRF token is available for mutating methods
    if (["POST", "PUT", "DELETE"].includes(method) && !this.csrfToken && !isRetry) {
      await this.ensureCsrfToken();
    }

    const extraHeaders: Record<string, string> = {
      Accept: "application/json",
    };

    // CSRF token for mutating methods
    if (
      this.csrfToken &&
      ["POST", "PUT", "DELETE"].includes(method)
    ) {
      extraHeaders["X-CSRF-Token"] = this.csrfToken;
    }

    if (body !== undefined) {
      extraHeaders["Content-Type"] = "application/json";
    }

    const fetchBody: BodyInit | null =
      body !== undefined ? JSON.stringify(body) : null;

    const response = await this.executeFetch(
      method,
      path,
      { body: fetchBody, extraHeaders },
      options,
      isRetry,
    );

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

    // Check for HTTP errors.
    // The Atelier API returns HTTP 400 on certain endpoints (e.g. action/search,
    // action/getmacrodefinition) even when the request is valid but yields no
    // results. When the envelope contains no Atelier-level errors we treat this
    // as a successful (empty) response rather than throwing.
    if (!response.ok) {
      const errors = envelope?.status?.errors ?? [];
      const isEmptyResult400 =
        response.status === 400 && errors.length === 0;
      if (!isEmptyResult400) {
        throw new IrisApiError(
          response.status,
          errors,
          path,
          `IRIS returned HTTP ${response.status} for ${method} ${path}. Check the request parameters and try again.`,
        );
      }
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

    return envelope;
  }

  // ── HEAD request engine ───────────────────────────────────────────

  /**
   * Internal HEAD request handler — no response body parsing.
   *
   * Delegates to {@link executeFetch} for shared session/auth/error
   * handling, then checks the response status. CSRF tokens are not
   * sent since HEAD is idempotent.
   *
   * @returns An object containing the HTTP status code and response headers.
   */
  private async headRequest(
    path: string,
    options?: RequestOptions,
    isRetry = false,
  ): Promise<HeadResponse> {
    const response = await this.executeFetch(
      "HEAD",
      path,
      { extraHeaders: {} },
      options,
      isRetry,
    );

    if (!response.ok) {
      throw new IrisApiError(
        response.status,
        [],
        path,
        `IRIS returned HTTP ${response.status} for HEAD ${path}. Check the request parameters and try again.`,
      );
    }

    return { status: response.status, headers: response.headers };
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
