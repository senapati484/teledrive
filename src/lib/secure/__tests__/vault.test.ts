import { beforeEach, describe, expect, it, vi } from "vitest";

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));

vi.mock("@tauri-apps/api/core", () => ({ invoke }));

import { deleteSecret, getSecret, saveSecret } from "../vault";

describe("vault write serialisation", () => {
  beforeEach(() => {
    invoke.mockReset();
  });

  it("never runs overlapping vault commands", async () => {
    let active = 0;
    let maxActive = 0;
    const order: string[] = [];

    invoke.mockImplementation(async (command: string, args: any) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      order.push(`${command}:${args.key}`);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active -= 1;
      return command === "load_vault_value" ? "stored" : null;
    });

    const results = await Promise.all([
      saveSecret("a", "1"),
      saveSecret("b", "2"),
      getSecret("a"),
      deleteSecret("b"),
    ]);

    expect(maxActive).toBe(1);
    expect(order).toEqual([
      "save_vault_value:a",
      "save_vault_value:b",
      "load_vault_value:a",
      "delete_vault_value:b",
    ]);
    expect(results[2]).toBe("stored");
  });

  it("keeps the queue usable after a failed write", async () => {
    invoke.mockRejectedValueOnce(new Error("disk full"));

    await expect(saveSecret("a", "1")).rejects.toThrow("disk full");
    invoke.mockResolvedValueOnce(null);

    await expect(saveSecret("b", "2")).resolves.toBeUndefined();
    expect(invoke).toHaveBeenLastCalledWith("save_vault_value", {
      key: "b",
      value: "2",
    });
  });

  it("returns null when a read fails", async () => {
    invoke.mockRejectedValueOnce(new Error("unreadable"));
    await expect(getSecret("a")).resolves.toBeNull();
  });
});
