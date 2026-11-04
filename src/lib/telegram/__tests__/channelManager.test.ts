import { beforeEach, describe, expect, it, vi } from "vitest";
import { Api } from "telegram";

const { clientMock } = vi.hoisted(() => ({
  clientMock: {
    getEntity: vi.fn(),
    getDialogs: vi.fn(),
    invoke: vi.fn(),
  },
}));

vi.mock("../client", () => ({ getClient: () => clientMock }));

vi.mock("../../secure/vault", () => ({
  getSecret: vi.fn(),
  saveSecret: vi.fn(),
  VAULT_KEY_CHANNEL_ID: "telegram_channel_id",
  channelIdKey: (phone: string) => `telegram_channel_id_${phone}`,
}));

import { getSecret, saveSecret } from "../../secure/vault";
import { ensureStorageChannel } from "../channelManager";

const mockGetSecret = vi.mocked(getSecret);
const mockSaveSecret = vi.mocked(saveSecret);

const STORAGE_TITLE = "TeleDrive Storage";

function channelDialog(id: number) {
  return { id, title: STORAGE_TITLE, isChannel: true };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetSecret.mockResolvedValue(undefined as any);
});

describe("ensureStorageChannel", () => {
  it("reuses the phone-keyed channel when it resolves", async () => {
    mockGetSecret.mockResolvedValue("-1001");
    clientMock.getEntity.mockResolvedValue({});

    await expect(ensureStorageChannel("+15550001")).resolves.toBe("-1001");
    expect(clientMock.getDialogs).not.toHaveBeenCalled();
    expect(clientMock.invoke).not.toHaveBeenCalled();
  });

  it("finds a channel that lives in the archive", async () => {
    clientMock.getDialogs.mockImplementation(async ({ folder }: any) =>
      folder === 1 ? [channelDialog(-1002)] : []
    );

    await expect(ensureStorageChannel("+15550001")).resolves.toBe("-1002");
    expect(clientMock.invoke).not.toHaveBeenCalled();
    expect(mockSaveSecret).toHaveBeenCalledWith(
      "telegram_channel_id_+15550001",
      "-1002"
    );
  });

  it("does not create a duplicate when the dialog scan fails", async () => {
    clientMock.getDialogs.mockRejectedValue(new Error("TIMEOUT"));

    await expect(ensureStorageChannel("+15550001")).rejects.toThrow(
      /Unable to search Telegram chats/
    );
    expect(clientMock.invoke).not.toHaveBeenCalled();
  });

  it("creates a channel only after a complete scan finds nothing", async () => {
    clientMock.getDialogs.mockResolvedValue([]);
    clientMock.invoke.mockResolvedValue({
      chats: [new Api.Channel({ id: 123, title: STORAGE_TITLE } as any)],
    });

    const id = await ensureStorageChannel("+15550001");

    expect(id).toMatch(/^-100/);
    expect(mockSaveSecret).toHaveBeenCalledWith("telegram_channel_id_+15550001", id);
  });
});
