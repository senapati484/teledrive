import { beforeEach, describe, expect, it, vi } from "vitest";

const vaultMap = new Map<string, string>();
vi.mock("../vault", () => ({
  saveSecret: vi.fn(async (k: string, v: string) => {
    vaultMap.set(k, v);
  }),
  getSecret: vi.fn(async (k: string) => vaultMap.get(k) ?? null),
  deleteSecret: vi.fn(async (k: string) => {
    vaultMap.delete(k);
  }),
}));

import {
  base64ToBytes,
  deriveMasterKeyFromPassphrase,
  E2EE_BLOCK_SIZE,
  encryptedSizeForPlainSize,
  EncryptionError,
  StreamDecryptor,
  StreamEncryptor,
  useEncryptionStore,
} from "../e2ee";

beforeEach(async () => {
  vaultMap.clear();
  await useEncryptionStore.getState().disableEncryption();
});

describe("StreamEncryptor & StreamDecryptor (TDE1)", () => {
  it("encrypts and decrypts multi-block payloads across uneven network chunk boundaries", async () => {
    const salt = new Uint8Array(16).fill(0x2a);
    const key = await deriveMasterKeyFromPassphrase("correct horse battery staple", salt);

    // 1.3 MiB payload spans 3 blocks (512K + 512K + ~280K)
    const plain = new Uint8Array(1350 * 1024);
    for (let i = 0; i < plain.length; i += 257) {
      plain[i] = (i * 31) & 0xff;
    }

    const enc = new StreamEncryptor(key, E2EE_BLOCK_SIZE);
    const wireParts: Uint8Array[] = [enc.header];
    for (let off = 0; off < plain.length; off += E2EE_BLOCK_SIZE) {
      const slice = plain.subarray(off, Math.min(off + E2EE_BLOCK_SIZE, plain.length));
      wireParts.push(await enc.encryptBlock(slice));
    }

    const totalWire = wireParts.reduce((s, p) => s + p.length, 0);
    expect(totalWire).toBe(encryptedSizeForPlainSize(plain.length));

    const wireBytes = new Uint8Array(totalWire);
    let pos = 0;
    for (const p of wireParts) {
      wireBytes.set(p, pos);
      pos += p.length;
    }

    // Feed into StreamDecryptor using uneven chunks (including tiny 13-byte header split)
    const dec = new StreamDecryptor(key);
    const outChunks: Uint8Array[] = [];
    const splits = [13, 40, 200_000, 400_000, 500_000];
    let cursor = 0;
    let sIdx = 0;
    while (cursor < wireBytes.length) {
      const step = splits[sIdx % splits.length];
      sIdx++;
      const next = Math.min(cursor + step, wireBytes.length);
      const decOut = await dec.pushChunk(wireBytes.subarray(cursor, next));
      if (decOut.length > 0) outChunks.push(decOut);
      cursor = next;
    }
    dec.finish();

    const recovered = new Uint8Array(outChunks.reduce((s, c) => s + c.length, 0));
    let outOff = 0;
    for (const c of outChunks) {
      recovered.set(c, outOff);
      outOff += c.length;
    }
    expect(recovered).toEqual(plain);
  });

  it("rejects tampered ciphertext and truncated streams", async () => {
    const salt = new Uint8Array(16).fill(7);
    const key = await deriveMasterKeyFromPassphrase("my-secret-pass", salt);
    const enc = new StreamEncryptor(key);
    const frame = await enc.encryptBlock(new TextEncoder().encode("sensitive payload"));

    const wire = new Uint8Array(enc.header.length + frame.length);
    wire.set(enc.header, 0);
    wire.set(frame, enc.header.length);

    // Bit flip inside ciphertext
    const tampered = new Uint8Array(wire);
    tampered[tampered.length - 5] ^= 0xff;
    const decTamper = new StreamDecryptor(key);
    await expect(decTamper.pushChunk(tampered)).rejects.toMatchObject({
      code: "invalid_passphrase",
    });

    // Truncated stream fails cleanly on finish()
    const decTrunc = new StreamDecryptor(key);
    await decTrunc.pushChunk(wire.subarray(0, wire.length - 4));
    expect(() => decTrunc.finish()).toThrow(EncryptionError);
  });

  it("produces deterministic blocks on resume with presetFileSalt + advanceBlockIndex", async () => {
    const salt = new Uint8Array(16).fill(9);
    const key = await deriveMasterKeyFromPassphrase("resume-key", salt);

    const b0 = new Uint8Array(512).fill(1);
    const b1 = new Uint8Array(512).fill(2);

    const enc1 = new StreamEncryptor(key);
    await enc1.encryptBlock(b0);
    const expectedB1 = await enc1.encryptBlock(b1);

    const encResume = new StreamEncryptor(key, E2EE_BLOCK_SIZE, base64ToBytes(enc1.fileSaltB64));
    encResume.advanceBlockIndex(1);
    const resumedB1 = await encResume.encryptBlock(b1);

    expect(resumedB1).toEqual(expectedB1);
  });
});

describe("useEncryptionStore lifecycle", () => {
  it("sets up passphrase, locks/unlocks with canary check, and supports cross-device salt unlock", async () => {
    await useEncryptionStore.getState().setupPassphrase("vault-pass-123", {
      encryptNewUploads: true,
      rememberKey: true,
    });
    expect(useEncryptionStore.getState().configured).toBe(true);
    expect(useEncryptionStore.getState().unlocked).toBe(true);
    const kdfSalt = useEncryptionStore.getState().config!.saltB64;

    await useEncryptionStore.getState().lock();
    expect(useEncryptionStore.getState().unlocked).toBe(false);
    expect(useEncryptionStore.getState().masterKey).toBeNull();

    expect(await useEncryptionStore.getState().unlockWithPassphrase("wrong-pass")).toBe(false);
    expect(await useEncryptionStore.getState().unlockWithPassphrase("vault-pass-123", false)).toBe(
      true
    );
    expect(useEncryptionStore.getState().unlocked).toBe(true);

    // Cross-device unlock simulation (no local vault config, salt from TeleFile.enc.s)
    await useEncryptionStore.getState().disableEncryption();
    expect(useEncryptionStore.getState().configured).toBe(false);

    const waitKeyPromise = useEncryptionStore.getState().requestUnlock(kdfSalt);
    expect(useEncryptionStore.getState().unlockPromptOpen).toBe(true);
    await useEncryptionStore.getState().unlockWithPassphrase("vault-pass-123");
    const derived = await waitKeyPromise;
    expect(derived).not.toBeNull();
  });
});

