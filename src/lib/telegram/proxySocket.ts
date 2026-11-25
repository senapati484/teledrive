import { Channel, invoke } from "@tauri-apps/api/core";
import type { ProxySettings } from "./proxy";

interface SocketStatusEvent {
  kind: "closed" | "error";
  message?: string;
}

interface PendingReader {
  needed: number;
  resolve: (buf: Buffer) => void;
  reject: (err: Error) => void;
}

/**
 * Factory returning a GramJS-compatible `networkSocket` class backed by TeleDrive's
 * Rust TCP/proxy IPC tunnel (`Channel<ArrayBuffer>` + raw binary `proxy_socket_write`).
 */
export function createTauriProxySocketClass(settings: ProxySettings) {
  return class TauriProxySocket {
    private socketId: number | null = null;
    private closed = false;
    private terminalError: Error | null = null;
    private chunks: Uint8Array[] = [];
    private totalBuffered = 0;
    private pendingReaders: PendingReader[] = [];
    private pendingReadAll: { resolve: (buf: Buffer) => void; reject: (err: Error) => void } | null = null;
    private writeQueue: Promise<void> = Promise.resolve();

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    constructor(_proxy?: unknown) {}

    async connect(port: number, ip: string): Promise<this> {
      if (this.closed) {
        throw new Error("Socket closed before connect.");
      }

      const onData = new Channel<ArrayBuffer>();
      onData.onmessage = (buffer: ArrayBuffer) => {
        if (this.closed) return;
        const view = new Uint8Array(buffer);
        if (view.byteLength === 0) return;
        this.chunks.push(view);
        this.totalBuffered += view.byteLength;
        this.flushPendingReaders();
      };

      const onStatus = new Channel<SocketStatusEvent>();
      onStatus.onmessage = (event: SocketStatusEvent) => {
        if (event.kind === "error") {
          this.handleRemoteClose(new Error(event.message || "Proxy socket connection error."));
        } else {
          this.handleRemoteClose(null);
        }
      };

      const socketId = await invoke<number>("proxy_socket_connect", {
        settings,
        targetHost: ip,
        targetPort: port,
        onData,
        onStatus,
      });

      if (this.closed) {
        void invoke("proxy_socket_close", { socketId }).catch(() => {});
        throw new Error("Socket closed while connecting.");
      }

      this.socketId = socketId;
      return this;
    }

    /**
     * Enqueues binary writes strictly in FIFO order before invoking native Tauri IPC.
     * GramJS calls `socket.write(...)` synchronously without awaiting.
     */
    write(data: Uint8Array | Buffer): void {
      if (this.closed || this.terminalError) {
        return;
      }
      // Copy caller buffer synchronously so subsequent mutations cannot alter in-flight packets.
      const payload = new Uint8Array(data.byteLength);
      payload.set(data);

      this.writeQueue = this.writeQueue
        .then(async () => {
          if (this.closed || this.socketId === null) return;
          await invoke("proxy_socket_write", payload, {
            headers: { "x-socket-id": String(this.socketId) },
          });
        })
        .catch((err) => {
          const error = err instanceof Error ? err : new Error(String(err));
          this.handleRemoteClose(error);
        });
    }

    async read(number: number): Promise<Buffer> {
      return this.readExactly(number);
    }

    readExactly(number: number): Promise<Buffer> {
      if (number <= 0) {
        return Promise.resolve(Buffer.alloc(0));
      }
      if (this.totalBuffered >= number) {
        return Promise.resolve(this.consumeBytes(number));
      }
      if (this.terminalError) {
        return Promise.reject(this.terminalError);
      }
      if (this.closed) {
        return Promise.reject(new Error("Connection closed."));
      }

      return new Promise<Buffer>((resolve, reject) => {
        this.pendingReaders.push({ needed: number, resolve, reject });
      });
    }

    readAll(): Promise<Buffer> {
      if (this.closed) {
        if (this.terminalError) {
          return Promise.reject(this.terminalError);
        }
        return Promise.resolve(this.consumeBytes(this.totalBuffered));
      }
      return new Promise<Buffer>((resolve, reject) => {
        this.pendingReadAll = { resolve, reject };
      });
    }

    async close(): Promise<void> {
      if (this.closed) return;
      this.closed = true;
      const socketId = this.socketId;
      this.socketId = null;

      const closeErr = this.terminalError ?? new Error("Connection closed.");
      this.rejectPendingReaders(closeErr);
      if (this.pendingReadAll) {
        const { resolve, reject } = this.pendingReadAll;
        this.pendingReadAll = null;
        if (this.terminalError) reject(this.terminalError);
        else resolve(this.consumeBytes(this.totalBuffered));
      }

      if (socketId !== null) {
        await invoke("proxy_socket_close", { socketId }).catch(() => {});
      }
    }

    private handleRemoteClose(error: Error | null): void {
      if (this.closed) return;
      this.closed = true;
      if (error && !this.terminalError) {
        this.terminalError = error;
      }

      if (this.pendingReadAll) {
        const { resolve, reject } = this.pendingReadAll;
        this.pendingReadAll = null;
        if (this.terminalError) reject(this.terminalError);
        else resolve(this.consumeBytes(this.totalBuffered));
      }

      this.rejectPendingReaders(this.terminalError ?? new Error("Connection closed by remote peer."));
    }

    private rejectPendingReaders(err: Error): void {
      while (this.pendingReaders.length > 0) {
        const reader = this.pendingReaders.shift();
        reader?.reject(err);
      }
    }

    private flushPendingReaders(): void {
      while (this.pendingReaders.length > 0) {
        const next = this.pendingReaders[0];
        if (this.totalBuffered < next.needed) {
          break;
        }
        this.pendingReaders.shift();
        next.resolve(this.consumeBytes(next.needed));
      }
    }

    private consumeBytes(count: number): Buffer {
      if (count <= 0) {
        return Buffer.alloc(0);
      }
      const out = Buffer.allocUnsafe(count);
      let written = 0;
      while (written < count && this.chunks.length > 0) {
        const head = this.chunks[0];
        const need = count - written;
        if (head.byteLength <= need) {
          out.set(head, written);
          written += head.byteLength;
          this.chunks.shift();
        } else {
          out.set(head.subarray(0, need), written);
          this.chunks[0] = head.subarray(need);
          written += need;
        }
      }
      this.totalBuffered -= written;
      return out;
    }
  };
}
