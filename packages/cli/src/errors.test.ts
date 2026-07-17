import { describe, expect, it } from "vitest";
import { errnoCode, errorMessage } from "./errors.js";

describe("errorMessage", () => {
  it("returns the message of Error instances", () => {
    expect(errorMessage(new Error("boom"))).toBe("boom");
  });

  it("stringifies non-Error throws", () => {
    expect(errorMessage("plain string")).toBe("plain string");
    expect(errorMessage(42)).toBe("42");
  });
});

describe("errnoCode", () => {
  it("returns the code of Node errno-style errors", () => {
    expect(errnoCode(Object.assign(new Error("x"), { code: "ENOENT" }))).toBe("ENOENT");
  });

  it("returns undefined for anything else", () => {
    expect(errnoCode(undefined)).toBeUndefined();
    expect(errnoCode("ENOENT")).toBeUndefined();
    expect(errnoCode(new Error("no code"))).toBeUndefined();
    expect(errnoCode(Object.assign(new Error("x"), { code: 5 }))).toBeUndefined();
  });
});
