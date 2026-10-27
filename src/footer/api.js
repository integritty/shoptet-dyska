import { API_BASE } from "./api-base.js";
import { FETCH_TIMEOUT_MS, REF_RE, RETRY_MAX_MS } from "./constants.js";

// A non-2xx answer. `retryAfterMs` is the parsed Retry-After header (null when absent or unreadable),
// `reason` the `reason` field of the JSON error body (e.g. "capacity", "rate_limit"; null when there is none).
export class ApiError extends Error {
  constructor(status, retryAfterMs, reason) {
    super(`HTTP ${status}`);
    this.status = status;
    this.retryAfterMs = retryAfterMs;
    this.reason = reason || null;
  }
}

async function readReason(response) {
  try {
    const body = await response.json();
    return body && typeof body.reason === "string" ? body.reason : null;
  } catch {
    return null;
  }
}

// Retry-After is either a number of seconds or an HTTP date.
function parseRetryAfter(response) {
  const headers = response && response.headers;
  const value = headers && typeof headers.get === "function" ? headers.get("Retry-After") : null;
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1000, RETRY_MAX_MS);
  const date = Date.parse(value);
  return Number.isNaN(date) ? null : Math.min(Math.max(date - Date.now(), 0), RETRY_MAX_MS);
}

// Every request has a timeout (it also covers reading the body) and a response.ok check.
// Callers decide how to degrade; nothing is logged.
async function request(path, init, options, readJson) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), (options && options.timeoutMs) || FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(`${(options && options.base) || API_BASE}${path}`, {
      ...init,
      credentials: "omit",
      signal: controller.signal,
    });
    if (!response.ok) throw new ApiError(response.status, parseRetryAfter(response), await readReason(response));
    return readJson ? await response.json() : null;
  } finally {
    clearTimeout(timer);
  }
}

const JSON_HEADERS = { "Content-Type": "application/json" };

export function getPublicConfig(eshopId, options) {
  return request(`/api/v1/public/config?eshopId=${encodeURIComponent(eshopId)}`, { method: "GET" }, options, true);
}

// Returns the ref issued (or kept) by the server. A ref the server does not know is replaced by a new one.
export async function putNotes(eshopId, ref, notes, options) {
  const body = ref ? { eshopId, ref, notes } : { eshopId, notes };
  const data = await request(
    "/api/v1/public/notes",
    { method: "PUT", headers: JSON_HEADERS, body: JSON.stringify(body), keepalive: Boolean(options && options.keepalive) },
    options,
    true,
  );
  if (!data || typeof data.ref !== "string" || !REF_RE.test(data.ref)) throw new Error("Invalid notes response");
  return data.ref;
}

export async function deleteNotes(eshopId, ref, options) {
  await request(
    "/api/v1/public/notes",
    { method: "DELETE", headers: JSON_HEADERS, body: JSON.stringify({ eshopId, ref }), keepalive: Boolean(options && options.keepalive) },
    options,
    false,
  );
}
