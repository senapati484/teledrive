import { beforeEach, describe, expect, it, vi } from "vitest";

const store = new Map<string, string>();

vi.mock("../../secure/vault", () => ({
  getSecret: vi.fn(async (key: string) => store.get(key) || null),
  saveSecret: vi.fn(async (key: string, value: string) => {
    store.set(key, value);
  }),
}));

import {
  saveFutureAuthToken,
  loadLogoutTokens,
  clearFutureAuthTokens,
  VAULT_KEY_FUTURE_AUTH_TOKENS,
} from "../futureAuth";
import { Buffer } from "buffer";

describe("futureAuth", () => {
  beforeEach(async () => {
    store.clear();
  });

  it("saves and loads future auth tokens as Buffers", async () => {
    const raw = Buffer.from("test-token-bytes");
    await saveFutureAuthToken(raw);

    const tokens = await loadLogoutTokens();
    expect(tokens.length).toBe(1);
    expect(tokens[0].toString("utf-8")).toBe("test-token-bytes");
  });

  it("deduplicates identical tokens and caps at 5", async () => {
    for (let i = 0; i < 7; i++) {
      await saveFutureAuthToken(Buffer.from(`token-${i}`));
    }
    // Duplicate token-6
    await saveFutureAuthToken(Buffer.from("token-6"));

    const tokens = await loadLogoutTokens();
    expect(tokens.length).toBe(5);
    // Most recent is first
    expect(tokens[0].toString("utf-8")).toBe("token-6");
  });

  it("handles Uint8Array input", async () => {
    const bytes = new Uint8Array([1, 2, 3, 4, 5]);
    await saveFutureAuthToken(bytes);

    const tokens = await loadLogoutTokens();
    expect(tokens.length).toBe(1);
    expect(Array.from(tokens[0])).toEqual([1, 2, 3, 4, 5]);
  });

  it("clears tokens when requested", async () => {
    await saveFutureAuthToken("YWJj");
    let tokens = await loadLogoutTokens();
    expect(tokens.length).toBe(1);

    await clearFutureAuthTokens();
    tokens = await loadLogoutTokens();
    expect(tokens.length).toBe(0);
    expect(store.get(VAULT_KEY_FUTURE_AUTH_TOKENS)).toBe("[]");
  });
});
