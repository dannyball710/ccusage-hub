import { describe, expect, it } from "vitest";
import { apiUrl, endpointError } from "./endpoint.js";

describe("endpointError", () => {
  it("accepts https endpoints", () => {
    expect(endpointError("https://w.example")).toBeNull();
    expect(endpointError("https://w.example/")).toBeNull();
    expect(endpointError("https://w.example/base/path")).toBeNull();
  });

  // The bearer token must never travel in cleartext to a remote host.
  it("rejects http for non-local hosts", () => {
    expect(endpointError("http://evil.example")).toContain("https");
    expect(endpointError("http://w.example.com/")).toContain("https");
  });

  it("allows http for local development hosts", () => {
    expect(endpointError("http://localhost:8787")).toBeNull();
    expect(endpointError("http://127.0.0.1:9")).toBeNull();
    expect(endpointError("http://[::1]:8787")).toBeNull();
  });

  // Userinfo would let the request go to a host other than the one displayed:
  // https://good.example.com@evil.example.com actually targets evil.example.com.
  it("rejects userinfo", () => {
    expect(endpointError("https://good.example.com@evil.example.com")).toContain("credentials");
    expect(endpointError("https://user:pass@w.example")).toContain("credentials");
  });

  // With string concatenation, a trailing "#" or "?" turned the /api/... path
  // into a fragment/query, sending the token to the endpoint's root.
  it("rejects query and fragment, even empty ones", () => {
    expect(endpointError("https://evil.example.com#")).toContain("query or fragment");
    expect(endpointError("https://evil.example.com?")).toContain("query or fragment");
    expect(endpointError("https://w.example/#frag")).toContain("query or fragment");
    expect(endpointError("https://w.example/?q=1")).toContain("query or fragment");
  });

  it("rejects strings that are not URLs", () => {
    expect(endpointError("")).toContain("not a valid URL");
    expect(endpointError("w.example")).toContain("not a valid URL");
    expect(endpointError("ftp://w.example")).toContain("https");
  });
});

describe("apiUrl", () => {
  it("appends the api path with and without a trailing slash", () => {
    expect(apiUrl("https://w.example", "/api/usage")).toBe("https://w.example/api/usage");
    expect(apiUrl("https://w.example/", "/api/usage")).toBe("https://w.example/api/usage");
  });

  it("preserves a base path on the endpoint", () => {
    expect(apiUrl("https://w.example/hub", "/api/health")).toBe("https://w.example/hub/api/health");
    expect(apiUrl("https://w.example/hub/", "/api/health")).toBe(
      "https://w.example/hub/api/health",
    );
  });

  it("keeps the port for local endpoints", () => {
    expect(apiUrl("http://localhost:8787", "/api/health")).toBe(
      "http://localhost:8787/api/health",
    );
  });
});
