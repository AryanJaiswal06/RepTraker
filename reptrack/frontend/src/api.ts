let onUnauthorized: (() => void) | null = null;
export function setUnauthorizedHandler(fn: (() => void) | null) {
  onUnauthorized = fn;
}

async function req<T>(url: string, method = "GET", body?: unknown): Promise<T> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), 15000);
  try {
    const res = await fetch(url, {
      method,
      credentials: "same-origin",
      headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
    if (res.status === 401 && !url.startsWith("/api/auth/")) {
      onUnauthorized?.();
    }
    if (!res.ok) {
      const msg = await res.json().then((j) => j.error).catch(() => null);
      throw new Error(msg || `Request failed (${res.status})`);
    }
    return res.status === 204 ? (undefined as T) : res.json();
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") {
      throw new Error("Request timed out. Please try again.");
    }
    if (err instanceof TypeError) {
      throw new Error("Unable to reach the RepTrack server.");
    }
    throw err;
  } finally {
    window.clearTimeout(timer);
  }
}

export const api = {
  get: <T,>(u: string) => req<T>(u),
  post: <T,>(u: string, b?: unknown) => req<T>(u, "POST", b),
  put: <T,>(u: string, b: unknown) => req<T>(u, "PUT", b),
  del: (u: string) => req<void>(u, "DELETE"),
};
