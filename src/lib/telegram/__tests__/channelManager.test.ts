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
import {
  ensureStorageChannel,
  matchesStorageChannelTitle,
  parseChannelInput,
  listEligibleStorageChannels,
  setCustomStorageChannel,
  ChannelCreationRestrictedError,
} from "../channelManager";

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

  it("throws ChannelCreationRestrictedError when Telegram returns USER_RESTRICTED", async () => {
    clientMock.getDialogs.mockResolvedValue([]);
    const rpcErr = new Error("403: USER_RESTRICTED (caused by channels.CreateChannel)");
    (rpcErr as any).errorMessage = "USER_RESTRICTED";
    clientMock.invoke.mockRejectedValue(rpcErr);

    await expect(ensureStorageChannel("+15550001")).rejects.toThrow(
      ChannelCreationRestrictedError
    );
  });
});

describe("matchesStorageChannelTitle", () => {
  it("matches TeleDrive Storage case-insensitively and with trimmed whitespace", () => {
    expect(matchesStorageChannelTitle("TeleDrive Storage")).toBe(true);
    expect(matchesStorageChannelTitle("teledrive storage")).toBe(true);
    expect(matchesStorageChannelTitle("  TeleDrive Storage  ")).toBe(true);
    expect(matchesStorageChannelTitle("teledrive-storage")).toBe(true);
    expect(matchesStorageChannelTitle("teledrive_storage")).toBe(true);
    expect(matchesStorageChannelTitle("TeleDrive")).toBe(true);
    expect(matchesStorageChannelTitle("teledrive")).toBe(true);
    expect(matchesStorageChannelTitle("Personal Files")).toBe(false);
    expect(matchesStorageChannelTitle("")).toBe(false);
    expect(matchesStorageChannelTitle(undefined)).toBe(false);
  });
});

describe("parseChannelInput", () => {
  it("parses different Telegram channel link and ID formats", () => {
    expect(parseChannelInput("https://t.me/c/1234567890/12")).toBe("-1001234567890");
    expect(parseChannelInput("t.me/c/9876543210")).toBe("-1009876543210");
    expect(parseChannelInput("https://t.me/my_backup_drive")).toBe("my_backup_drive");
    expect(parseChannelInput("@my_backup_drive")).toBe("my_backup_drive");
    expect(parseChannelInput("-1001234567890")).toBe("-1001234567890");
    expect(parseChannelInput("1234567890")).toBe("-1001234567890");
  });
});

describe("listEligibleStorageChannels", () => {
  it("lists channels where user is creator or has posting rights", async () => {
    clientMock.getDialogs.mockImplementation(async ({ folder }: any) =>
      folder === 0
        ? [
            {
              id: -100111,
              title: "My Channel",
              isChannel: true,
              entity: { creator: true, className: "Channel" },
            },
            {
              id: -100222,
              title: "Read Only Channel",
              isChannel: true,
              entity: { creator: false, adminRights: null, className: "Channel" },
            },
          ]
        : []
    );

    const eligible = await listEligibleStorageChannels();
    expect(eligible).toHaveLength(1);
    expect(eligible[0].id).toBe("-100111");
    expect(eligible[0].title).toBe("My Channel");
    expect(eligible[0].isCreator).toBe(true);
  });
});

describe("setCustomStorageChannel", () => {
  it("resolves and saves custom channel in vault", async () => {
    clientMock.getEntity.mockResolvedValue({
      id: 999,
      className: "Channel",
    });

    const channelId = await setCustomStorageChannel("+15550001", "@my_custom_drive");
    expect(channelId).toBe("-100999");
    expect(mockSaveSecret).toHaveBeenCalledWith(
      "telegram_channel_id_+15550001",
      "-100999"
    );
  });
});
