/**
 * Typed fetch wrapper around the WikiHub REST API.
 *
 * Every backend failure arrives in the standard envelope, so a single
 * `ApiError` type carries the machine-readable code, the human message and the
 * correlation id — enough for the UI to react and for a user to quote in a bug
 * report. Authentication is layered on in Phase 3.
 */

import { apiBaseUrl } from "./env";

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
    request_id?: string | null;
  };
}

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: Record<string, unknown>;
  readonly requestId: string | null;

  constructor(
    status: number,
    code: string,
    message: string,
    details: Record<string, unknown> = {},
    requestId: string | null = null,
  ) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.details = details;
    this.requestId = requestId;
  }

  /** True when retrying the exact same request could plausibly succeed. */
  get isRetryable(): boolean {
    return this.status >= 500 || this.status === 429;
  }
}

export interface RequestOptions extends Omit<RequestInit, "body"> {
  /** JSON-serialisable request body. Use `rawBody` for FormData/uploads. */
  body?: unknown;
  rawBody?: BodyInit;
  /** Query string parameters; `undefined`/`null` values are dropped. */
  query?: Record<string, string | number | boolean | undefined | null>;
  /** Access token to send as a Bearer credential. */
  token?: string | null;
}

function buildUrl(path: string, query?: RequestOptions["query"]): string {
  const url = new URL(
    path.startsWith("/") ? path : `/${path}`,
    `${apiBaseUrl()}/`,
  );
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== null && value !== "") {
        url.searchParams.set(key, String(value));
      }
    }
  }
  return url.toString();
}

export async function apiFetch<T>(
  path: string,
  { body, rawBody, query, token, headers, ...init }: RequestOptions = {},
): Promise<T> {
  const requestHeaders = new Headers(headers);
  requestHeaders.set("Accept", "application/json");
  if (body !== undefined && !requestHeaders.has("Content-Type")) {
    requestHeaders.set("Content-Type", "application/json");
  }
  if (token) {
    requestHeaders.set("Authorization", `Bearer ${token}`);
  }

  let response: Response;
  try {
    response = await fetch(buildUrl(path, query), {
      ...init,
      headers: requestHeaders,
      body: rawBody ?? (body !== undefined ? JSON.stringify(body) : undefined),
      credentials: init.credentials ?? "include",
    });
  } catch (cause) {
    throw new ApiError(
      0,
      "network_error",
      "Could not reach the WikiHub API.",
      { cause: String(cause) },
      null,
    );
  }

  if (response.status === 204) {
    return undefined as T;
  }

  const isJson = response.headers
    .get("content-type")
    ?.includes("application/json");
  const payload: unknown = isJson
    ? await response.json().catch(() => null)
    : await response.text();

  if (!response.ok) {
    const envelope = (payload as ApiErrorBody | null)?.error;
    throw new ApiError(
      response.status,
      envelope?.code ?? "http_error",
      envelope?.message ?? `Request failed with status ${response.status}.`,
      envelope?.details ?? {},
      envelope?.request_id ?? response.headers.get("X-Request-ID"),
    );
  }

  return payload as T;
}

/**
 * Pulls the first field-level validation message out of an API error, e.g.
 * `"name: Name must start with a letter, not a digit or special character."`,
 * falling back to the error's top-level message and finally to `fallback`.
 */
export function describeApiError(err: unknown, fallback: string): string {
  if (err instanceof ApiError) {
    const fields = err.details?.fields;
    if (Array.isArray(fields) && fields.length > 0) {
      const first = fields[0] as { field?: string; message?: string };
      if (first?.message) {
        return first.field && first.field !== "body"
          ? `${first.field}: ${first.message}`
          : first.message;
      }
    }
    return err.message;
  }
  return fallback;
}

export const api = {
  get: <T>(path: string, options?: RequestOptions) =>
    apiFetch<T>(path, { ...options, method: "GET" }),
  post: <T>(path: string, body?: unknown, options?: RequestOptions) =>
    apiFetch<T>(path, { ...options, method: "POST", body }),
  put: <T>(path: string, body?: unknown, options?: RequestOptions) =>
    apiFetch<T>(path, { ...options, method: "PUT", body }),
  patch: <T>(path: string, body?: unknown, options?: RequestOptions) =>
    apiFetch<T>(path, { ...options, method: "PATCH", body }),
  delete: <T>(path: string, options?: RequestOptions) =>
    apiFetch<T>(path, { ...options, method: "DELETE" }),
};
