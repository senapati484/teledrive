import { beforeEach, describe, expect, it, vi } from "vitest";

const connectAttempts: Array<{ useWSS: boolean; hasSocket: boolean; hasProxy: boolean }> = [];
let failWss = false;
let failDirectTcp = false;
let discoveredRoute: any = null;
let savedProxy: any = {
  enabled: false,
  proxyType: "mtproxy",
  host: "",
  port: 443,
  secret: "",
  username: "",
  password: "",
};

vi.mock("@tauri-apps/api/core", () => ({
  Channel: class MockChannel<T> {
    onmessage?: (msg: T) => void;
  },
  invoke: vi.fn(async (cmd: string) => {
    if (cmd === "get_proxy_settings") return savedProxy;
    if (cmd === "discover_telegram_route") return discoveredRoute;
    return undefined;
  }),
}));

vi.mock("@/lib/runtime/bridge", () => ({
  isTauriRuntime: () => true,
}));

vi.mock("telegram", () => {
  class MockTelegramClient {
    connected = false;
    private params: Record<string, any>;
    session: any;

    constructor(session: any, _apiId: number, _apiHash: string, params: Record<string, any>) {
      this.session = session;
      this.params = params;
    }

    setLogLevel() {}

    async connect() {
      const useWSS = Boolean(this.params.useWSS);
      const hasSocket = Boolean(this.params.networkSocket);
      const hasProxy = Boolean(this.params.proxy);
      connectAttempts.push({ useWSS, hasSocket, hasProxy });

      if (useWSS && failWss) {
        throw new Error("WebSocket connect failed (blocked)");
      }
      if (!useWSS && hasSocket && !hasProxy && failDirectTcp) {
        throw new Error("Direct TCP connect failed");
      }
      this.connected = true;
    }

    async disconnect() {
      this.connected = false;
    }
  }

  return {
    Api: { help: { GetConfig: class {} } },
    TelegramClient: MockTelegramClient,
  };
});

import { initClient, isClientConnected, resetClient } from "../client";

describe("initClient silent automatic route fallback", () => {
  beforeEach(() => {
    resetClient();
    connectAttempts.length = 0;
    failWss = false;
    failDirectTcp = false;
    discoveredRoute = null;
    savedProxy = {
      enabled: false,
      proxyType: "mtproxy",
      host: "",
      port: 443,
      secret: "",
      username: "",
      password: "",
    };
  });

  it("uses standard direct WSS when unrestricted without extra probing", async () => {
    await initClient(12345, "hash", "");
    expect(isClientConnected()).toBe(true);
    expect(connectAttempts).toEqual([{ useWSS: true, hasSocket: false, hasProxy: false }]);
  });

  it("falls back automatically to Direct Native TCP when WSS is blocked", async () => {
    failWss = true;
    discoveredRoute = {
      enabled: true,
      proxyType: "direct",
      host: "",
      port: 443,
      secret: "",
      username: "",
      password: "",
    };

    await initClient(12345, "hash", "");
    expect(isClientConnected()).toBe(true);
    expect(connectAttempts).toEqual([
      { useWSS: true, hasSocket: false, hasProxy: false },
      { useWSS: false, hasSocket: true, hasProxy: false },
    ]);

    // Subsequent init reuses cached working route immediately instead of re-failing WSS
    await initClient(12345, "hash", "", true);
    expect(connectAttempts[2]).toEqual({ useWSS: false, hasSocket: true, hasProxy: false });
  });

  it("falls back automatically to OS-discovered SOCKS5 when direct transports fail", async () => {
    failWss = true;
    discoveredRoute = {
      enabled: true,
      proxyType: "socks5",
      host: "127.0.0.1",
      port: 7891,
      secret: "",
      username: "",
      password: "",
    };

    await initClient(12345, "hash", "");
    expect(isClientConnected()).toBe(true);
    expect(connectAttempts).toHaveLength(2);
    expect(connectAttempts[1]).toEqual({ useWSS: false, hasSocket: true, hasProxy: false });
  });

  it("falls back to direct WSS if a previously saved proxy stops working", async () => {
    savedProxy = {
      enabled: true,
      proxyType: "socks5",
      host: "127.0.0.1",
      port: 9999,
      secret: "",
      username: "",
      password: "",
    };
    failDirectTcp = true; // simulate dead saved proxy socket failure
    discoveredRoute = null;

    await initClient(12345, "hash", "");
    expect(isClientConnected()).toBe(true);
    expect(connectAttempts).toEqual([
      { useWSS: false, hasSocket: true, hasProxy: false },
      { useWSS: true, hasSocket: false, hasProxy: false },
    ]);
  });
});
