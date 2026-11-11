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
  computeE2eeSeekPlan,
  deriveMasterKeyFromPassphrase,
  E2EE_BLOCK_SIZE,
  e2eeConfigKey,
  e2eeRawKey,
  E2EE_HEADER_BYTES,
  encryptedSizeForPlainSize,
  EncryptionError,
  requireEncryptionKey,
  StreamDecryptor,
  StreamEncryptor,
  useEncryptionStore,
} from "../e2ee";

beforeEach(async () => {
  vaultMap.clear();
  if (typeof localStorage !== "undefined") {
    localStorage.clear();
  }
  useEncryptionStore.getState().resetSessionOnLogout();
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

  it("supports random-access block range seeking without decrypting earlier blocks", async () => {
    const salt = new Uint8Array(16).fill(0x55);
    const key = await deriveMasterKeyFromPassphrase("seek-pass", salt);
    // 1.3 MiB across 3 blocks (512K, 512K, ~280K)
    const plain = new Uint8Array(1350 * 1024);
    for (let i = 0; i < plain.length; i++) plain[i] = (i * 19) & 0xff;

    const enc = new StreamEncryptor(key, E2EE_BLOCK_SIZE);
    const parts: Uint8Array[] = [enc.header];
    for (let off = 0; off < plain.length; off += E2EE_BLOCK_SIZE) {
      parts.push(await enc.encryptBlock(plain.subarray(off, Math.min(off + E2EE_BLOCK_SIZE, plain.length))));
    }
    const wire = Buffer.concat(parts);

    // Seek from middle of block 1 into block 2
    const rangeStart = E2EE_BLOCK_SIZE + 12_345;
    const rangeEnd = E2EE_BLOCK_SIZE * 2 + 50_000;
    const header = wire.subarray(0, E2EE_HEADER_BYTES);
    const plan = computeE2eeSeekPlan(header, plain.length, rangeStart, rangeEnd);

    expect(plan.startBlock).toBe(1);
    expect(plan.endBlock).toBe(2);

    const slicedWire = wire.subarray(plan.wireStartOffset, plan.wireEndOffset + 1);
    const dec = new StreamDecryptor(key);
    dec.initSeekState(plan.fileSalt, plan.blockSize, plan.startBlock);
    const decOut = await dec.pushChunk(new Uint8Array(slicedWire));
    dec.finish();

    const exactSlice = decOut.subarray(
      plan.firstBlockSkipBytes,
      plan.firstBlockSkipBytes + (rangeEnd - rangeStart + 1)
    );
    expect(exactSlice).toEqual(plain.subarray(rangeStart, rangeEnd + 1));
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

describe("multi-device account vault sync & isolation", () => {
  it("auto-generates a random key once per account, caches it in scoped vault, and syncs seamlessly to a second device", async () => {
    // Device A: first login to channel "-1001" with empty metadata
    const device1 = await useEncryptionStore
      .getState()
      .syncFromRemoteMetadata("-1001", null);

    expect(device1.needsPublish).toBe(true);
    expect(device1.vaultMetadata.mode).toBe("auto");
    expect(device1.vaultMetadata.encryptNewUploads).toBe(false);
    expect(device1.vaultMetadata.accountKeyB64).toBeTruthy();
    expect(vaultMap.get(e2eeConfigKey("-1001"))).toBeTruthy();
    expect(vaultMap.get(e2eeRawKey("-1001"))).toBe(
      device1.vaultMetadata.accountKeyB64
    );

    const encKey1 = await requireEncryptionKey(device1.vaultMetadata.saltB64);
    const enc = new StreamEncryptor(encKey1, E2EE_BLOCK_SIZE);
    const secretPayload = new TextEncoder().encode("cross-device-payload");
    const encryptedBlock = await enc.encryptBlock(secretPayload);
    const wire = new Uint8Array(enc.header.length + encryptedBlock.length);
    wire.set(enc.header, 0);
    wire.set(encryptedBlock, enc.header.length);

    // Simulate logging into a completely fresh Device B (empty local vault)
    vaultMap.clear();
    if (typeof localStorage !== "undefined") localStorage.clear();
    useEncryptionStore.getState().resetSessionOnLogout();

    const device2 = await useEncryptionStore
      .getState()
      .syncFromRemoteMetadata("-1001", device1.vaultMetadata);

    expect(device2.needsPublish).toBe(false);
    expect(useEncryptionStore.getState().unlocked).toBe(true);
    expect(useEncryptionStore.getState().unlockPromptOpen).toBe(false);
    expect(vaultMap.get(e2eeRawKey("-1001"))).toBe(
      device1.vaultMetadata.accountKeyB64
    );

    // Decrypting with Device B's synced key must work with zero prompts
    const encKey2 = await requireEncryptionKey(device1.vaultMetadata.saltB64);
    const dec = new StreamDecryptor(encKey2);
    const out = await dec.pushChunk(wire);
    dec.finish();
    expect(out).toEqual(secretPayload);
  });

  it("isolates persisted vaults across accounts on logout and requires explicit unlock for mismatched legacy salts", async () => {
    const chanA = await useEncryptionStore
      .getState()
      .syncFromRemoteMetadata("-100A", null);
    const keyA = chanA.vaultMetadata.accountKeyB64!;

    // Switch accounts cleanly via resetSessionOnLogout()
    useEncryptionStore.getState().resetSessionOnLogout();
    expect(useEncryptionStore.getState().masterKey).toBeNull();
    expect(vaultMap.get(e2eeRawKey("-100A"))).toBe(keyA);

    const chanB = await useEncryptionStore
      .getState()
      .syncFromRemoteMetadata("-100B", null);
    expect(chanB.vaultMetadata.accountKeyB64).not.toBe(keyA);
    expect(vaultMap.get(e2eeRawKey("-100A"))).toBe(keyA);

    // Asking for an unrecognized historical salt must NEVER silently return channel B's key
    const waitPrompt = requireEncryptionKey("legacy-unknown-salt-b64");
    await Promise.resolve();
    expect(useEncryptionStore.getState().unlockPromptOpen).toBe(true);
    useEncryptionStore.getState().cancelUnlockPrompt();
    await expect(waitPrompt).rejects.toThrow(EncryptionError);
  });

  it("migrates a legacy local passphrase vault to non-secret channel metadata without uploading the key", async () => {
    await useEncryptionStore.getState().setupPassphrase("legacy-secret-99", {
      encryptNewUploads: true,
      rememberKey: true,
    });
    const legacySalt = useEncryptionStore.getState().config!.saltB64;
    useEncryptionStore.getState().resetSessionOnLogout();

    const migrated = await useEncryptionStore
      .getState()
      .syncFromRemoteMetadata("-100LEGACY", null);

    expect(migrated.needsPublish).toBe(true);
    expect(migrated.vaultMetadata.mode).toBe("passphrase");
    expect(migrated.vaultMetadata.saltB64).toBe(legacySalt);
    expect(migrated.vaultMetadata.accountKeyB64).toBeUndefined();
    expect(migrated.vaultMetadata.encryptNewUploads).toBe(false);
    expect(vaultMap.get(e2eeRawKey("-100LEGACY"))).toBeTruthy();

    // Subsequent unrelated channel login must NOT inherit the migrated legacy passphrase
    useEncryptionStore.getState().resetSessionOnLogout();
    const other = await useEncryptionStore
      .getState()
      .syncFromRemoteMetadata("-100OTHER", null);
    expect(other.vaultMetadata.mode).toBe("auto");
    expect(other.vaultMetadata.saltB64).not.toBe(legacySalt);
  });
});

