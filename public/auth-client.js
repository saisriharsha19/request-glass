export async function api(path, options = {}) {
  let response;
  try {
    response = await fetch(path, {
      credentials: "same-origin",
      cache: "no-store",
      signal: AbortSignal.timeout(15000),
      ...options,
    });
  } catch {
    throw new Error(
      "Connection lost. Your unsaved changes are still here. Reconnect before saving to your account.",
    );
  }
  if (response.status === 304) return null;
  const body = await response.json();
  if (!response.ok) {
    const error = new Error(body.error || "Could not complete this request.");
    error.status = response.status;
    throw error;
  }
  return body;
}
export const getAuthConfig = () => api("/api/auth/config");
export const getSession = () => api("/api/auth/session");
export const accountRequest = (action, data) =>
  api(`/api/auth/${action}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
