import { describe, expect, it } from "vitest";
import { b64ToBytes, bytesToB64, generateToken, pbkdf2B64, sha256Hex, timingSafeEqual } from "../src/crypto";

describe("sha256Hex", () => {
  it("matches the known SHA-256 test vector for 'abc'", async () => {
    expect(await sha256Hex("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
    );
  });
});

describe("generateToken", () => {
  it("produces the prefix followed by 64 hex chars", () => {
    expect(generateToken("ccu_")).toMatch(/^ccu_[0-9a-f]{64}$/);
    expect(generateToken("ses_")).toMatch(/^ses_[0-9a-f]{64}$/);
  });

  it("produces unique tokens", () => {
    expect(generateToken("ccu_")).not.toBe(generateToken("ccu_"));
  });
});

describe("bytesToB64 / b64ToBytes", () => {
  it("round-trips arbitrary bytes", () => {
    const bytes = Uint8Array.from([0, 1, 2, 127, 128, 255]);
    expect(b64ToBytes(bytesToB64(bytes))).toEqual(bytes);
  });
});

describe("pbkdf2B64", () => {
  // Login verifies passwords by re-deriving with the stored salt/iterations
  // and comparing, so derivation must be deterministic.
  it("re-derives the same hash for the same password, salt and iterations", async () => {
    const salt = Uint8Array.from({ length: 16 }, (_, i) => i);
    const stored = await pbkdf2B64("correct horse battery", salt, 1000);
    const candidate = await pbkdf2B64("correct horse battery", salt, 1000);
    expect(candidate).toBe(stored);
  });

  it("derives a different hash for a different password", async () => {
    const salt = Uint8Array.from({ length: 16 }, (_, i) => i);
    const stored = await pbkdf2B64("correct horse battery", salt, 1000);
    const candidate = await pbkdf2B64("wrong horse battery", salt, 1000);
    expect(candidate).not.toBe(stored);
  });
});

describe("timingSafeEqual", () => {
  it("returns true for equal strings", () => {
    expect(timingSafeEqual("abcdef", "abcdef")).toBe(true);
  });

  it("returns false for same-length different strings", () => {
    expect(timingSafeEqual("abcdef", "abcdeg")).toBe(false);
  });

  it("returns false for different lengths", () => {
    expect(timingSafeEqual("abc", "abcd")).toBe(false);
  });
});
