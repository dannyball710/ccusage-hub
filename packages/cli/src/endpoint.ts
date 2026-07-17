// Endpoint validation and request-URL construction.
//
// https is required so the bearer token never travels in cleartext; http is
// allowed only for local development hosts. Userinfo and "?"/"#" (even with
// nothing after them) are rejected so a crafted endpoint cannot steer
// /api/... requests to a different host than the one the user sees.

const LOCAL_HOSTS = ["localhost", "127.0.0.1", "[::1]"];

export function endpointError(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return "endpoint is not a valid URL";
  }
  if (url.protocol !== "https:") {
    const localHttp = url.protocol === "http:" && LOCAL_HOSTS.includes(url.hostname);
    if (!localHttp) return "endpoint must use https:// (http:// is allowed only for localhost)";
  }
  if (url.username !== "" || url.password !== "") {
    return "endpoint must not contain credentials";
  }
  if (raw.includes("?") || raw.includes("#")) {
    return "endpoint must not contain a query or fragment";
  }
  return null;
}

// Appends /api/... to the endpoint via the URL parser (preserving any base
// path) so the request host can never diverge from the validated endpoint.
export function apiUrl(endpoint: string, path: string): string {
  const url = new URL(endpoint);
  url.username = "";
  url.password = "";
  url.search = "";
  url.hash = "";
  url.pathname = `${url.pathname.replace(/\/$/, "")}${path}`;
  return url.toString();
}
