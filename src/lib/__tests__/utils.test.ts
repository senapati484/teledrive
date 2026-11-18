import { describe, expect, it } from "vitest";
import { getErrorMessage } from "../utils";

describe("getErrorMessage", () => {
  it("extracts message from Error instances", () => {
    expect(getErrorMessage(new Error("disk full"))).toBe("disk full");
  });

  it("extracts non-empty string errors", () => {
    expect(getErrorMessage("network timeout")).toBe("network timeout");
  });

  it("extracts message property from plain objects", () => {
    expect(getErrorMessage({ message: "FLOOD_WAIT_30" })).toBe("FLOOD_WAIT_30");
  });

  it("returns fallback for null, undefined, or empty errors", () => {
    expect(getErrorMessage(null, "fallback")).toBe("fallback");
    expect(getErrorMessage(undefined, "fallback")).toBe("fallback");
    expect(getErrorMessage("", "fallback")).toBe("fallback");
    expect(getErrorMessage({}, "fallback")).toBe("fallback");
  });
});
