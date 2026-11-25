import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ProxySettings } from "../proxy";

const channels: Record<string, { onmessage?: (msg: unknown) => void }> = {};
const invokeCalls: Array<{ cmd: string; args: unknown; options?: unknown }> = [];

vi.mock("@tauri-apps/api/core", () => {
  class MockChannel<T> {
    onmessage?: (msg: T) => void;
    constructor() {
      // Captured in mock invoke handler below
    }
  }
  return {
    Channel: MockChannel,
    invoke: vi.fn(),
  };
});

import { invoke } from "@tauri-apps/api/core";
import { createTauriProxySocketClass } from "../proxySocket";

const sampleSettings: ProxySettings = {
  enabled: true,
  proxyType: "socks5",
  host: "127.0.0.1",
  port: 1080,
  secret: "",
  username: "",
  password: "",
};

function defaultInvokeImpl(cmd: string, args?: unknown, options?: unknown) {
  invokeCalls.push({ cmd, args, options });
  if (cmd === "proxy_socket_connect") {
    const params = args as {
      onData: { onmessage?: (msg: ArrayBuffer) => void };
      onStatus: { onmessage?: (msg: { kind: "closed" | "error"; message?: string }) => void };
    };
    channels.onData = params.onData as { onmessage?: (msg: unknown) => void };
    channels.onStatus = params.onStatus as { onmessage?: (msg: unknown) => void };
    return Promise.resolve(42);
  }
  return Promise.resolve(undefined);
}

describe("TauriProxySocket", () => {
  beforeEach(() => {
    invokeCalls.length = 0;
    delete channels.onData;
    delete channels.onStatus;
    (invoke as any).mockReset();
    (invoke as any).mockImplementation(defaultInvokeImpl);
  });

  it("reassembles arbitrary incoming chunks across readExactly calls", async () => {
    const SocketClass = createTauriProxySocketClass(sampleSettings);
    const sock = new SocketClass();
    await sock.connect(443, "149.154.167.91");

    const p1 = sock.readExactly(5);
    channels.onData.onmessage?.(new Uint8Array([1, 2]).buffer);
    channels.onData.onmessage?.(new Uint8Array([3, 4, 5, 6, 7]).buffer);

    const first = await p1;
    expect(Array.from(first)).toEqual([1, 2, 3, 4, 5]);

    const second = await sock.read(2);
    expect(Array.from(second)).toEqual([6, 7]);
  });

  it("serializes synchronous writes in strict FIFO order and copies caller buffers", async () => {
    const SocketClass = createTauriProxySocketClass(sampleSettings);
    const sock = new SocketClass();
    await sock.connect(443, "149.154.167.91");

    let releaseFirst!: () => void;
    let firstWriteEntered!: () => void;
    const firstEnteredPromise = new Promise<void>((r) => {
      firstWriteEntered = r;
    });
    const writtenSeq: number[][] = [];
    const { invoke } = await import("@tauri-apps/api/core");
    (invoke as any).mockImplementation(async (cmd: string, args: Uint8Array) => {
      if (cmd === "proxy_socket_write") {
        const copy = Array.from(args);
        if (writtenSeq.length === 0) {
          firstWriteEntered();
          await new Promise<void>((res) => {
            releaseFirst = res;
          });
        }
        writtenSeq.push(copy);
      }
      return 42;
    });

    const reusable = new Uint8Array([10, 20]);
    sock.write(reusable);
    reusable[0] = 99;
    sock.write(reusable);

    await firstEnteredPromise;
    releaseFirst();
    await new Promise((r) => setTimeout(r, 10));

    expect(writtenSeq).toEqual([
      [10, 20],
      [99, 20],
    ]);
  });

  it("rejects pending reads cleanly when remote reports an error", async () => {
    const SocketClass = createTauriProxySocketClass(sampleSettings);
    const sock = new SocketClass();
    await sock.connect(443, "149.154.167.91");

    const pending = sock.readExactly(4);
    channels.onStatus.onmessage?.({ kind: "error", message: "SOCKS5 host unreachable" });

    await expect(pending).rejects.toThrow("SOCKS5 host unreachable");
  });
});
