import { create } from "zustand";
import type { RemoteVaultMetadata } from "../types";
import { deleteSecret, getSecret, saveSecret } from "./vault";

export const E2EE_MAGIC = [0x54, 0x44, 0x45, 0x31] as const; // "TDE1"
export const E2EE_HEADER_BYTES = 32;
export const E2EE_BLOCK_SIZE = 512 * 1024; // 512 KiB plaintext block
export const E2EE_FRAME_OVERHEAD = 4 + 16; // 4-byte plainLen + 16-byte GCM auth tag
const PBKDF2_ITERATIONS = 150_000;
const CANARY_PLAINTEXT = "TELEDRIVE_E2EE_V1_OK";

const VAULT_KEY_E2EE_CONFIG = "teledrive_e2ee_config";
const VAULT_KEY_E2EE_RAW_KEY = "teledrive_e2ee_raw_key";
const VAULT_KEY_E2EE_LEGACY_MIGRATED = "teledrive_e2ee_legacy_migrated";

export function e2eeConfigKey(channelId: string): string {
  return `${VAULT_KEY_E2EE_CONFIG}_${channelId.trim()}`;
}

export function e2eeRawKey(channelId: string): string {
  return `${VAULT_KEY_E2EE_RAW_KEY}_${channelId.trim()}`;
}

export class EncryptionError extends Error {
  constructor(
    public readonly code:
      | "not_configured"
      | "locked"
      | "invalid_passphrase"
      | "corrupt_stream"
      | "truncated_stream",
    message: string
  ) {
    super(message);
    this.name = "EncryptionError";
  }
}

export interface StoredEncryptionConfig {
  v: 1 | 2;
  vaultId?: string;
  saltB64: string;
  canaryIvB64: string;
  canaryCtB64: string;
  mode?: "auto" | "passphrase";
  encryptNewUploads: boolean;
  rememberKey: boolean;
  updatedAt?: number;
}

function getSubtle(): SubtleCrypto {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) {
    throw new Error("WebCrypto SubtleCrypto is unavailable in this environment.");
  }
  return subtle;
}

/**
 * Copies/narrows any Uint8Array into a strict `ArrayBuffer`-backed view to
 * satisfy TypeScript's `BufferSource` (`typescript ~7`) cleanly.
 */
function toStrictBytes(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(new ArrayBuffer(bytes.byteLength));
  out.set(bytes);
  return out;
}

export function bytesToBase64(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) {
    bin += String.fromCharCode(bytes[i]);
  }
  return btoa(bin);
}

export function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) {
    out[i] = bin.charCodeAt(i);
  }
  return out;
}

function randomBytes(length: number): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(new ArrayBuffer(length));
  globalThis.crypto.getRandomValues(out);
  return out;
}

/**
 * Exact encrypted byte length produced by `TDE1` framing for a plaintext size.
 */
export function encryptedSizeForPlainSize(
  plainSize: number,
  blockSize: number = E2EE_BLOCK_SIZE
): number {
  if (plainSize <= 0) return E2EE_HEADER_BYTES;
  const blocks = Math.ceil(plainSize / blockSize);
  return E2EE_HEADER_BYTES + blocks * E2EE_FRAME_OVERHEAD + plainSize;
}

/**
 * Derives an exportable 256-bit AES-GCM master key via PBKDF2-SHA256.
 */
export async function deriveMasterKeyFromPassphrase(
  passphrase: string,
  salt: Uint8Array
): Promise<CryptoKey> {
  if (!passphrase) {
    throw new EncryptionError("invalid_passphrase", "Passphrase cannot be empty.");
  }
  const subtle = getSubtle();
  const keyMaterial = await subtle.importKey(
    "raw",
    toStrictBytes(new TextEncoder().encode(passphrase)),
    "PBKDF2",
    false,
    ["deriveKey"]
  );
  return subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: toStrictBytes(salt),
      iterations: PBKDF2_ITERATIONS,
      hash: "SHA-256",
    },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    true,
    ["encrypt", "decrypt"]
  );
}

async function encryptCanary(key: CryptoKey): Promise<{ ivB64: string; ctB64: string }> {
  const subtle = getSubtle();
  const iv = randomBytes(12);
  const pt = toStrictBytes(new TextEncoder().encode(CANARY_PLAINTEXT));
  const ct = await subtle.encrypt({ name: "AES-GCM", iv }, key, pt);
  return {
    ivB64: bytesToBase64(iv),
    ctB64: bytesToBase64(new Uint8Array(ct)),
  };
}

async function verifyCanary(
  key: CryptoKey,
  ivB64: string,
  ctB64: string
): Promise<boolean> {
  try {
    const subtle = getSubtle();
    const iv = toStrictBytes(base64ToBytes(ivB64));
    const ct = toStrictBytes(base64ToBytes(ctB64));
    const pt = await subtle.decrypt({ name: "AES-GCM", iv }, key, ct);
    return new TextDecoder().decode(pt) === CANARY_PLAINTEXT;
  } catch {
    return false;
  }
}

async function deriveBlockNonce(
  fileSalt: Uint8Array,
  blockIndex: number
): Promise<Uint8Array<ArrayBuffer>> {
  const input = new Uint8Array(new ArrayBuffer(fileSalt.length + 4));
  input.set(fileSalt, 0);
  const view = new DataView(input.buffer);
  view.setUint32(fileSalt.length, blockIndex, false);
  const digest = await getSubtle().digest("SHA-256", input);
  return new Uint8Array(digest.slice(0, 12));
}

function buildBlockAad(
  blockIndex: number,
  plainLen: number
): Uint8Array<ArrayBuffer> {
  const aad = new Uint8Array(new ArrayBuffer(12));
  aad.set(E2EE_MAGIC, 0);
  const view = new DataView(aad.buffer);
  view.setUint32(4, blockIndex, false);
  view.setUint32(8, plainLen, false);
  return aad;
}

export class StreamEncryptor {
  public readonly header: Uint8Array;
  public readonly fileSaltB64: string;
  private readonly fileSalt: Uint8Array;
  private readonly key: CryptoKey;
  private readonly blockSize: number;
  private blockIndex = 0;

  constructor(
    key: CryptoKey,
    blockSize: number = E2EE_BLOCK_SIZE,
    presetFileSalt?: Uint8Array
  ) {
    this.key = key;
    this.blockSize = blockSize;
    this.fileSalt = presetFileSalt
      ? toStrictBytes(presetFileSalt)
      : randomBytes(16);
    this.fileSaltB64 = bytesToBase64(this.fileSalt);

    const header = new Uint8Array(E2EE_HEADER_BYTES);
    header.set(E2EE_MAGIC, 0);
    header.set(this.fileSalt, 4);
    new DataView(header.buffer).setUint32(20, blockSize, false);
    this.header = header;
  }

  /** Allows resume flows to skip re-encrypting already-uploaded blocks. */
  advanceBlockIndex(count: number): void {
    this.blockIndex += count;
  }

  /** Resets the block counter explicitly when retrying a failed segment. */
  setBlockIndex(index: number): void {
    this.blockIndex = index;
  }

  /**
   * Encrypts a single plaintext slice (`<= blockSize`) into `[plainLenBE][ct+tag]`.
   */
  async encryptBlock(plainChunk: Uint8Array): Promise<Uint8Array> {
    if (plainChunk.length <= 0 || plainChunk.length > this.blockSize) {
      throw new Error(
        `Invalid E2EE plaintext block size ${plainChunk.length} (expected 1..${this.blockSize})`
      );
    }
    const idx = this.blockIndex++;
    const nonce = await deriveBlockNonce(this.fileSalt, idx);
    const aad = buildBlockAad(idx, plainChunk.length);
    const ctBuf = await getSubtle().encrypt(
      { name: "AES-GCM", iv: nonce, additionalData: aad },
      this.key,
      toStrictBytes(plainChunk)
    );
    const ct = new Uint8Array(ctBuf);
    const frame = new Uint8Array(4 + ct.length);
    new DataView(frame.buffer).setUint32(0, plainChunk.length, false);
    frame.set(ct, 4);
    return frame;
  }
}

export interface E2eeSeekPlan {
  fileSalt: Uint8Array;
  blockSize: number;
  startBlock: number;
  endBlock: number;
  wireStartOffset: number;
  wireEndOffset: number;
  firstBlockSkipBytes: number;
  plainLengthNeeded: number;
}

export function parseE2eeHeader(headerBytes: Uint8Array): {
  fileSalt: Uint8Array;
  blockSize: number;
} {
  if (headerBytes.length < E2EE_HEADER_BYTES) {
    throw new EncryptionError(
      "truncated_stream",
      "Encrypted file header is truncated."
    );
  }
  for (let i = 0; i < E2EE_MAGIC.length; i++) {
    if (headerBytes[i] !== E2EE_MAGIC[i]) {
      throw new EncryptionError(
        "corrupt_stream",
        "Encrypted file header magic mismatch."
      );
    }
  }
  const fileSalt = headerBytes.slice(4, 20);
  const blockSize = new DataView(
    headerBytes.buffer,
    headerBytes.byteOffset + 20,
    4
  ).getUint32(0, false);
  if (blockSize <= 0 || blockSize > 8 * 1024 * 1024) {
    throw new EncryptionError("corrupt_stream", "Invalid E2EE block size.");
  }
  return { fileSalt, blockSize };
}

export function computeE2eeSeekPlan(
  headerBytes: Uint8Array,
  plainTotalSize: number,
  rangeStart: number,
  rangeEnd: number
): E2eeSeekPlan {
  const { fileSalt, blockSize } = parseE2eeHeader(headerBytes);
  if (plainTotalSize <= 0) {
    throw new RangeError("Plaintext size must be positive for E2EE seek.");
  }
  const start = Math.max(0, Math.min(plainTotalSize - 1, rangeStart));
  const end = Math.max(start, Math.min(plainTotalSize - 1, rangeEnd));
  const frameStride = blockSize + E2EE_FRAME_OVERHEAD;
  const startBlock = Math.floor(start / blockSize);
  const endBlock = Math.floor(end / blockSize);
  const endBlockPlainStart = endBlock * blockSize;
  const endBlockPlainLen = Math.min(blockSize, plainTotalSize - endBlockPlainStart);

  return {
    fileSalt,
    blockSize,
    startBlock,
    endBlock,
    wireStartOffset: E2EE_HEADER_BYTES + startBlock * frameStride,
    wireEndOffset:
      E2EE_HEADER_BYTES +
      endBlock * frameStride +
      E2EE_FRAME_OVERHEAD +
      endBlockPlainLen -
      1,
    firstBlockSkipBytes: start - startBlock * blockSize,
    plainLengthNeeded: end - start + 1,
  };
}

export class StreamDecryptor {
  private readonly key: CryptoKey;
  private buffer: Uint8Array = new Uint8Array(0);
  private headerParsed = false;
  private fileSalt: Uint8Array = new Uint8Array(0);
  private blockSize = E2EE_BLOCK_SIZE;
  private blockIndex = 0;

  constructor(key: CryptoKey) {
    this.key = key;
  }

  /** Configures header parameters directly for random-access block seeking. */
  initSeekState(
    fileSalt: Uint8Array,
    blockSize: number,
    startBlockIndex: number
  ): void {
    this.fileSalt = toStrictBytes(fileSalt);
    this.blockSize = blockSize;
    this.blockIndex = startBlockIndex;
    this.headerParsed = true;
    this.buffer = new Uint8Array(0);
  }

  private append(chunk: Uint8Array): void {
    if (chunk.length === 0) return;
    if (this.buffer.length === 0) {
      this.buffer = chunk;
      return;
    }
    const merged = new Uint8Array(this.buffer.length + chunk.length);
    merged.set(this.buffer, 0);
    merged.set(chunk, this.buffer.length);
    this.buffer = merged;
  }

  async pushChunk(cipherChunk: Uint8Array): Promise<Uint8Array> {
    this.append(cipherChunk);
    const outputs: Uint8Array[] = [];
    let totalOut = 0;

    if (!this.headerParsed) {
      if (this.buffer.length < E2EE_HEADER_BYTES) {
        return new Uint8Array(0);
      }
      const parsed = parseE2eeHeader(this.buffer);
      this.fileSalt = toStrictBytes(parsed.fileSalt);
      this.blockSize = parsed.blockSize;
      this.buffer = this.buffer.slice(E2EE_HEADER_BYTES);
      this.headerParsed = true;
    }

    while (this.buffer.length >= 4) {
      const plainLen = new DataView(
        this.buffer.buffer,
        this.buffer.byteOffset,
        4
      ).getUint32(0, false);
      if (plainLen <= 0 || plainLen > this.blockSize) {
        throw new EncryptionError("corrupt_stream", "Invalid E2EE block length.");
      }
      const frameLen = 4 + plainLen + 16;
      if (this.buffer.length < frameLen) {
        break;
      }

      const cipherFrame = this.buffer.slice(4, frameLen);
      this.buffer = this.buffer.slice(frameLen);

      const idx = this.blockIndex++;
      const nonce = await deriveBlockNonce(this.fileSalt, idx);
      const aad = buildBlockAad(idx, plainLen);

      let plainBuf: ArrayBuffer;
      try {
        plainBuf = await getSubtle().decrypt(
          { name: "AES-GCM", iv: nonce, additionalData: aad },
          this.key,
          toStrictBytes(cipherFrame)
        );
      } catch {
        throw new EncryptionError(
          "invalid_passphrase",
          "Unable to decrypt file: incorrect passphrase or corrupted data."
        );
      }

      const plainBytes = new Uint8Array(plainBuf);
      outputs.push(plainBytes);
      totalOut += plainBytes.length;
    }

    if (outputs.length === 0) return new Uint8Array(0);
    if (outputs.length === 1) return outputs[0];
    const joined = new Uint8Array(totalOut);
    let offset = 0;
    for (const part of outputs) {
      joined.set(part, offset);
      offset += part.length;
    }
    return joined;
  }

  finish(): void {
    if (!this.headerParsed || this.buffer.length > 0) {
      throw new EncryptionError(
        "truncated_stream",
        "Encrypted file ended unexpectedly."
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Vault & Session Store for E2EE Key Lifecycle
// ---------------------------------------------------------------------------

function generateVaultId(): string {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }
  return bytesToBase64(randomBytes(16));
}

function vaultKeysFor(channelId?: string | null): {
  cfgKey: string;
  rawKey: string;
} {
  const normalized = channelId?.trim();
  if (!normalized) {
    return { cfgKey: VAULT_KEY_E2EE_CONFIG, rawKey: VAULT_KEY_E2EE_RAW_KEY };
  }
  return {
    cfgKey: e2eeConfigKey(normalized),
    rawKey: e2eeRawKey(normalized),
  };
}

function parseStoredConfig(raw: string | null): StoredEncryptionConfig | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (
      parsed &&
      (parsed.v === 1 || parsed.v === 2) &&
      typeof parsed.saltB64 === "string" &&
      typeof parsed.canaryIvB64 === "string" &&
      typeof parsed.canaryCtB64 === "string"
    ) {
      return parsed as StoredEncryptionConfig;
    }
  } catch {
    // ignore malformed config
  }
  return null;
}

async function loadStoredConfig(
  channelId?: string | null
): Promise<StoredEncryptionConfig | null> {
  const { cfgKey } = vaultKeysFor(channelId);
  let raw = await getSecret(cfgKey).catch(() => null);
  if (!raw && typeof localStorage !== "undefined") {
    raw = localStorage.getItem(cfgKey);
  }
  return parseStoredConfig(raw);
}

async function persistConfig(
  config: StoredEncryptionConfig | null,
  channelId?: string | null
): Promise<void> {
  const { cfgKey } = vaultKeysFor(channelId);
  if (!config) {
    await deleteSecret(cfgKey).catch(() => {});
    if (typeof localStorage !== "undefined") {
      localStorage.removeItem(cfgKey);
    }
    return;
  }
  const serialized = JSON.stringify(config);
  if (typeof localStorage !== "undefined") {
    localStorage.setItem(cfgKey, serialized);
  }
  await saveSecret(cfgKey, serialized).catch(() => {});
}

async function saveRawKeyToVault(
  rawKeyB64: string,
  channelId?: string | null
): Promise<void> {
  const { rawKey } = vaultKeysFor(channelId);
  await saveSecret(rawKey, rawKeyB64).catch(() => {});
}

async function exportAndSaveKeyToVault(
  key: CryptoKey,
  channelId?: string | null
): Promise<string> {
  const raw = await getSubtle().exportKey("raw", key);
  const rawB64 = bytesToBase64(new Uint8Array(raw));
  await saveRawKeyToVault(rawB64, channelId);
  return rawB64;
}

async function deleteRawKeyFromVault(channelId?: string | null): Promise<void> {
  const { rawKey } = vaultKeysFor(channelId);
  await deleteSecret(rawKey).catch(() => {});
}

async function loadRawKeyFromVault(
  channelId?: string | null
): Promise<string | null> {
  const { rawKey } = vaultKeysFor(channelId);
  return getSecret(rawKey).catch(() => null);
}

async function importAndVerifyRawKey(
  rawKeyB64: string,
  canaryIvB64: string,
  canaryCtB64: string
): Promise<CryptoKey | null> {
  try {
    const rawBytes = base64ToBytes(rawKeyB64);
    if (rawBytes.length !== 32) return null;
    const imported = await getSubtle().importKey(
      "raw",
      toStrictBytes(rawBytes),
      { name: "AES-GCM", length: 256 },
      true,
      ["encrypt", "decrypt"]
    );
    const ok = await verifyCanary(imported, canaryIvB64, canaryCtB64);
    return ok ? imported : null;
  } catch {
    return null;
  }
}

async function migrateLegacyVaultIfNeeded(
  channelId: string
): Promise<{
  cfg: StoredEncryptionConfig | null;
  rawB64: string | null;
}> {
  const scopedCfg = await loadStoredConfig(channelId);
  const scopedRaw = await loadRawKeyFromVault(channelId);
  if (scopedCfg) {
    return { cfg: scopedCfg, rawB64: scopedRaw };
  }

  const alreadyMigrated = await getSecret(VAULT_KEY_E2EE_LEGACY_MIGRATED).catch(
    () => null
  );
  if (alreadyMigrated) {
    return { cfg: null, rawB64: null };
  }

  const legacyCfg = await loadStoredConfig(null);
  const legacyRaw = await loadRawKeyFromVault(null);
  if (!legacyCfg) {
    return { cfg: null, rawB64: null };
  }

  // Record migration before persisting so switching accounts later does not
  // copy the previous account's legacy vault into an unrelated channel.
  await saveSecret(VAULT_KEY_E2EE_LEGACY_MIGRATED, channelId).catch(() => {});

  const migratedCfg: StoredEncryptionConfig = {
    ...legacyCfg,
    vaultId: legacyCfg.vaultId ?? generateVaultId(),
    mode: legacyCfg.mode ?? "passphrase",
    updatedAt: legacyCfg.updatedAt ?? Date.now(),
  };
  await persistConfig(migratedCfg, channelId);
  if (legacyRaw) {
    const verified = await importAndVerifyRawKey(
      legacyRaw,
      migratedCfg.canaryIvB64,
      migratedCfg.canaryCtB64
    );
    if (verified) {
      await saveRawKeyToVault(legacyRaw, channelId);
      return { cfg: migratedCfg, rawB64: legacyRaw };
    }
  }
  return { cfg: migratedCfg, rawB64: null };
}

function buildRemoteFromConfig(
  cfg: StoredEncryptionConfig,
  mode: "auto" | "passphrase",
  accountKeyB64?: string
): RemoteVaultMetadata {
  return {
    v: mode === "auto" ? 2 : cfg.v,
    vaultId: cfg.vaultId || generateVaultId(),
    saltB64: cfg.saltB64,
    canaryIvB64: cfg.canaryIvB64,
    canaryCtB64: cfg.canaryCtB64,
    mode,
    ...(mode === "auto" && accountKeyB64 ? { accountKeyB64 } : {}),
    encryptNewUploads: false,
    updatedAt: cfg.updatedAt ?? Date.now(),
  };
}

interface UnlockPromptState {
  resolve: (key: CryptoKey | null) => void;
}

interface EncryptionState {
  initialized: boolean;
  configured: boolean;
  unlocked: boolean;
  encryptNewUploads: boolean;
  rememberKey: boolean;
  activeChannelId: string | null;
  needsRemotePublish: boolean;
  config: StoredEncryptionConfig | null;
  masterKey: CryptoKey | null;
  keysBySalt: Record<string, CryptoKey>;
  unlockPromptOpen: boolean;
  pendingUnlockSalt: string | null;
  initFromVault: (channelId?: string | null) => Promise<void>;
  syncFromRemoteMetadata: (
    channelId: string,
    remote?: RemoteVaultMetadata | null
  ) => Promise<{ vaultMetadata: RemoteVaultMetadata; needsPublish: boolean }>;
  markRemotePublished: (channelId: string) => void;
  evictDerivedKey: (fileSaltB64?: string) => Promise<void>;
  resetSessionOnLogout: () => void;
  setupPassphrase: (
    passphrase: string,
    opts?: { encryptNewUploads?: boolean; rememberKey?: boolean }
  ) => Promise<void>;
  unlockWithPassphrase: (passphrase: string, rememberKey?: boolean) => Promise<boolean>;
  lock: () => Promise<void>;
  setEncryptNewUploads: (enabled: boolean) => Promise<void>;
  setRememberKey: (remember: boolean) => Promise<void>;
  disableEncryption: () => Promise<void>;
  requestUnlock: (fileSaltB64?: string) => Promise<CryptoKey | null>;
  cancelUnlockPrompt: () => void;
}

let pendingUnlockWaiters: UnlockPromptState[] = [];

export const useEncryptionStore = create<EncryptionState>((set, get) => ({
  initialized: false,
  configured: false,
  unlocked: false,
  encryptNewUploads: false,
  rememberKey: false,
  activeChannelId: null,
  needsRemotePublish: false,
  config: null,
  masterKey: null,
  keysBySalt: {},
  unlockPromptOpen: false,
  pendingUnlockSalt: null,

  initFromVault: async (channelId?: string | null) => {
    const targetChannel = channelId ?? get().activeChannelId;
    const cfg = await loadStoredConfig(targetChannel);
    if (!cfg) {
      set({
        initialized: true,
        configured: false,
        unlocked: false,
        encryptNewUploads: false,
        rememberKey: false,
        activeChannelId: targetChannel ?? null,
        config: null,
        masterKey: null,
      });
      return;
    }

    let restoredKey: CryptoKey | null = null;
    if (cfg.rememberKey) {
      const rawKeyB64 = await loadRawKeyFromVault(targetChannel);
      if (rawKeyB64) {
        restoredKey = await importAndVerifyRawKey(
          rawKeyB64,
          cfg.canaryIvB64,
          cfg.canaryCtB64
        );
      }
    }

    const nextKeysBySalt = { ...get().keysBySalt };
    if (restoredKey) {
      nextKeysBySalt[cfg.saltB64] = restoredKey;
    }

    set({
      initialized: true,
      configured: true,
      unlocked: Boolean(restoredKey),
      encryptNewUploads: cfg.encryptNewUploads,
      rememberKey: cfg.rememberKey,
      activeChannelId: targetChannel ?? null,
      config: cfg,
      masterKey: restoredKey,
      keysBySalt: nextKeysBySalt,
    });
  },

  syncFromRemoteMetadata: async (channelId, remote) => {
    const { cfg: localCfg, rawB64: localRawB64 } =
      await migrateLegacyVaultIfNeeded(channelId);

    const nextKeysBySalt: Record<string, CryptoKey> = {
      ...(get().activeChannelId === channelId ? get().keysBySalt : {}),
    };

    // Preserve any verified local key from an earlier epoch so legacy files
    // uploaded under that salt remain decryptable transparently.
    if (localCfg && localRawB64) {
      const priorKey = await importAndVerifyRawKey(
        localRawB64,
        localCfg.canaryIvB64,
        localCfg.canaryCtB64
      );
      if (priorKey) {
        nextKeysBySalt[localCfg.saltB64] = priorKey;
      }
    }

    if (remote) {
      let restoredKey: CryptoKey | null = null;

      if (remote.mode === "auto" && remote.accountKeyB64) {
        restoredKey = await importAndVerifyRawKey(
          remote.accountKeyB64,
          remote.canaryIvB64,
          remote.canaryCtB64
        );
      }

      if (!restoredKey) {
        restoredKey = nextKeysBySalt[remote.saltB64] ?? null;
      }

      if (!restoredKey && localRawB64) {
        restoredKey = await importAndVerifyRawKey(
          localRawB64,
          remote.canaryIvB64,
          remote.canaryCtB64
        );
      }

      const rememberKey =
        remote.mode === "auto" ? true : (localCfg?.rememberKey ?? true);
      const nextCfg: StoredEncryptionConfig = {
        v: remote.v,
        vaultId: remote.vaultId,
        saltB64: remote.saltB64,
        canaryIvB64: remote.canaryIvB64,
        canaryCtB64: remote.canaryCtB64,
        mode: remote.mode,
        encryptNewUploads: false,
        rememberKey,
        updatedAt: remote.updatedAt,
      };

      const cfgChanged =
        !localCfg ||
        localCfg.vaultId !== nextCfg.vaultId ||
        localCfg.saltB64 !== nextCfg.saltB64 ||
        localCfg.canaryIvB64 !== nextCfg.canaryIvB64 ||
        localCfg.canaryCtB64 !== nextCfg.canaryCtB64 ||
        localCfg.mode !== nextCfg.mode ||
        localCfg.rememberKey !== nextCfg.rememberKey;

      if (cfgChanged) {
        await persistConfig(nextCfg, channelId);
      }
      if (
        remote.mode === "auto" &&
        remote.accountKeyB64 &&
        restoredKey &&
        localRawB64 !== remote.accountKeyB64
      ) {
        await saveRawKeyToVault(remote.accountKeyB64, channelId);
      }

      if (restoredKey) {
        nextKeysBySalt[remote.saltB64] = restoredKey;
      }

      set({
        initialized: true,
        configured: true,
        unlocked: Boolean(restoredKey),
        encryptNewUploads: false,
        rememberKey,
        activeChannelId: channelId,
        needsRemotePublish: false,
        config: nextCfg,
        masterKey: restoredKey,
        keysBySalt: nextKeysBySalt,
      });

      return { vaultMetadata: remote, needsPublish: false };
    }

    // Remote chunk 0 carries no vault header yet.
    if (localCfg && (localCfg.mode ?? "passphrase") === "passphrase") {
      const vaultId = localCfg.vaultId || generateVaultId();
      const updatedAt = localCfg.updatedAt || Date.now();
      const normalizedCfg: StoredEncryptionConfig = {
        ...localCfg,
        vaultId,
        mode: "passphrase",
        encryptNewUploads: false,
        updatedAt,
      };
      if (localCfg.vaultId !== vaultId || localCfg.mode !== "passphrase") {
        await persistConfig(normalizedCfg, channelId);
      }
      const restoredKey =
        normalizedCfg.rememberKey && localRawB64
          ? await importAndVerifyRawKey(
              localRawB64,
              normalizedCfg.canaryIvB64,
              normalizedCfg.canaryCtB64
            )
          : (nextKeysBySalt[normalizedCfg.saltB64] ?? null);
      if (restoredKey) {
        nextKeysBySalt[normalizedCfg.saltB64] = restoredKey;
      }
      const promoted = buildRemoteFromConfig(normalizedCfg, "passphrase");
      set({
        initialized: true,
        configured: true,
        unlocked: Boolean(restoredKey),
        encryptNewUploads: false,
        rememberKey: normalizedCfg.rememberKey,
        activeChannelId: channelId,
        needsRemotePublish: true,
        config: normalizedCfg,
        masterKey: restoredKey,
        keysBySalt: nextKeysBySalt,
      });
      return { vaultMetadata: promoted, needsPublish: true };
    }

    if (localCfg && localCfg.mode === "auto" && localRawB64) {
      const existingAutoKey = await importAndVerifyRawKey(
        localRawB64,
        localCfg.canaryIvB64,
        localCfg.canaryCtB64
      );
      if (existingAutoKey) {
        nextKeysBySalt[localCfg.saltB64] = existingAutoKey;
        const remoteMeta = buildRemoteFromConfig(
          localCfg,
          "auto",
          localRawB64
        );
        set({
          initialized: true,
          configured: true,
          unlocked: true,
          encryptNewUploads: false,
          rememberKey: true,
          activeChannelId: channelId,
          needsRemotePublish: true,
          config: localCfg,
          masterKey: existingAutoKey,
          keysBySalt: nextKeysBySalt,
        });
        return { vaultMetadata: remoteMeta, needsPublish: true };
      }
    }

    // Brand-new account or first login: generate a random 256-bit account key
    // once and store it in both channel metadata and the scoped local vault.
    const rawKeyBytes = randomBytes(32);
    const rawKeyB64 = bytesToBase64(rawKeyBytes);
    const saltB64 = bytesToBase64(randomBytes(16));
    const vaultId = generateVaultId();
    const updatedAt = Date.now();
    const key = await getSubtle().importKey(
      "raw",
      toStrictBytes(rawKeyBytes),
      { name: "AES-GCM", length: 256 },
      true,
      ["encrypt", "decrypt"]
    );
    const canary = await encryptCanary(key);

    const autoCfg: StoredEncryptionConfig = {
      v: 2,
      vaultId,
      saltB64,
      canaryIvB64: canary.ivB64,
      canaryCtB64: canary.ctB64,
      mode: "auto",
      encryptNewUploads: false,
      rememberKey: true,
      updatedAt,
    };

    await persistConfig(autoCfg, channelId);
    await saveRawKeyToVault(rawKeyB64, channelId);

    const remoteMeta = buildRemoteFromConfig(autoCfg, "auto", rawKeyB64);
    nextKeysBySalt[saltB64] = key;

    set({
      initialized: true,
      configured: true,
      unlocked: true,
      encryptNewUploads: false,
      rememberKey: true,
      activeChannelId: channelId,
      needsRemotePublish: true,
      config: autoCfg,
      masterKey: key,
      keysBySalt: nextKeysBySalt,
    });

    return { vaultMetadata: remoteMeta, needsPublish: true };
  },

  markRemotePublished: (channelId) => {
    if (get().activeChannelId === channelId && get().needsRemotePublish) {
      set({ needsRemotePublish: false });
    }
  },

  evictDerivedKey: async (fileSaltB64) => {
    const state = get();
    if (
      fileSaltB64 &&
      state.config?.saltB64 !== fileSaltB64 &&
      fileSaltB64 in state.keysBySalt
    ) {
      const nextKeys = { ...state.keysBySalt };
      delete nextKeys[fileSaltB64];
      set({ keysBySalt: nextKeys });
      return;
    }
    if (!state.configured) {
      await state.lock();
    }
  },

  resetSessionOnLogout: () => {
    const waiters = pendingUnlockWaiters;
    pendingUnlockWaiters = [];
    set({
      initialized: false,
      configured: false,
      unlocked: false,
      encryptNewUploads: false,
      rememberKey: false,
      activeChannelId: null,
      needsRemotePublish: false,
      config: null,
      masterKey: null,
      keysBySalt: {},
      unlockPromptOpen: false,
      pendingUnlockSalt: null,
    });
    for (const w of waiters) w.resolve(null);
  },

  setupPassphrase: async (passphrase, opts) => {
    const channelId = get().activeChannelId;
    const salt = randomBytes(16);
    const key = await deriveMasterKeyFromPassphrase(passphrase, salt);
    const canary = await encryptCanary(key);
    const rememberKey = opts?.rememberKey ?? true;
    const encryptNewUploads = opts?.encryptNewUploads ?? true;

    const config: StoredEncryptionConfig = {
      v: 1,
      vaultId: generateVaultId(),
      saltB64: bytesToBase64(salt),
      canaryIvB64: canary.ivB64,
      canaryCtB64: canary.ctB64,
      mode: "passphrase",
      encryptNewUploads,
      rememberKey,
      updatedAt: Date.now(),
    };

    await persistConfig(config, channelId);
    if (rememberKey) {
      await exportAndSaveKeyToVault(key, channelId).catch(() => {});
    } else {
      await deleteRawKeyFromVault(channelId);
    }

    set({
      initialized: true,
      configured: true,
      unlocked: true,
      encryptNewUploads,
      rememberKey,
      config,
      masterKey: key,
      keysBySalt: { ...get().keysBySalt, [config.saltB64]: key },
    });

    const waiters = pendingUnlockWaiters;
    pendingUnlockWaiters = [];
    for (const w of waiters) w.resolve(key);
  },

  unlockWithPassphrase: async (passphrase, rememberKeyOverride) => {
    const channelId = get().activeChannelId;
    let cfg = get().config ?? (await loadStoredConfig(channelId));
    const fallbackSalt = get().pendingUnlockSalt;

    if (!cfg || (fallbackSalt && fallbackSalt !== cfg.saltB64)) {
      const targetSalt = fallbackSalt;
      if (!targetSalt) {
        throw new EncryptionError("not_configured", "Encryption is not configured.");
      }
      // Cross-device / legacy-epoch unlock: derive using `file.enc.s`
      // without mutating the active account vault configuration.
      const candidate = await deriveMasterKeyFromPassphrase(
        passphrase,
        base64ToBytes(targetSalt)
      );
      set({
        ...(cfg ? {} : { unlocked: true, masterKey: candidate }),
        keysBySalt: { ...get().keysBySalt, [targetSalt]: candidate },
        unlockPromptOpen: false,
        pendingUnlockSalt: null,
      });
      const waiters = pendingUnlockWaiters;
      pendingUnlockWaiters = [];
      for (const w of waiters) w.resolve(candidate);
      return true;
    }

    const activeSalt = cfg.saltB64;
    const candidate = await deriveMasterKeyFromPassphrase(
      passphrase,
      base64ToBytes(activeSalt)
    );
    const valid = await verifyCanary(candidate, cfg.canaryIvB64, cfg.canaryCtB64);
    if (!valid) {
      return false;
    }

    const rememberKey = rememberKeyOverride ?? cfg.rememberKey;
    if (rememberKey !== cfg.rememberKey) {
      cfg = { ...cfg, rememberKey };
      await persistConfig(cfg, channelId);
    }
    if (rememberKey) {
      await exportAndSaveKeyToVault(candidate, channelId).catch(() => {});
    }

    set({
      configured: true,
      unlocked: true,
      config: cfg,
      rememberKey,
      encryptNewUploads: cfg.encryptNewUploads,
      masterKey: candidate,
      keysBySalt: { ...get().keysBySalt, [activeSalt]: candidate },
      unlockPromptOpen: false,
      pendingUnlockSalt: null,
    });

    const waiters = pendingUnlockWaiters;
    pendingUnlockWaiters = [];
    for (const w of waiters) w.resolve(candidate);
    return true;
  },

  lock: async () => {
    const channelId = get().activeChannelId;
    await deleteRawKeyFromVault(channelId);
    const cfg = get().config;
    if (cfg && cfg.rememberKey) {
      const next = { ...cfg, rememberKey: false };
      await persistConfig(next, channelId);
      set({
        config: next,
        rememberKey: false,
        unlocked: false,
        masterKey: null,
        keysBySalt: {},
      });
    } else {
      set({ unlocked: false, masterKey: null, keysBySalt: {} });
    }
  },

  setEncryptNewUploads: async (enabled) => {
    const channelId = get().activeChannelId;
    const cfg = get().config;
    if (!cfg) return;
    const next = { ...cfg, encryptNewUploads: enabled };
    await persistConfig(next, channelId);
    set({ config: next, encryptNewUploads: enabled });
  },

  setRememberKey: async (remember) => {
    const channelId = get().activeChannelId;
    const cfg = get().config;
    const key = get().masterKey;
    if (!cfg) return;
    const next = { ...cfg, rememberKey: remember };
    await persistConfig(next, channelId);
    if (remember && key) {
      await exportAndSaveKeyToVault(key, channelId).catch(() => {});
    } else {
      await deleteRawKeyFromVault(channelId);
    }
    set({ config: next, rememberKey: remember });
  },

  disableEncryption: async () => {
    const channelId = get().activeChannelId;
    await deleteRawKeyFromVault(channelId);
    await persistConfig(null, channelId);
    if (channelId) {
      await deleteRawKeyFromVault(null);
      await persistConfig(null, null);
    }
    set({
      initialized: true,
      configured: false,
      unlocked: false,
      encryptNewUploads: false,
      rememberKey: false,
      activeChannelId: null,
      needsRemotePublish: false,
      config: null,
      masterKey: null,
      keysBySalt: {},
      unlockPromptOpen: false,
      pendingUnlockSalt: null,
    });
    const waiters = pendingUnlockWaiters;
    pendingUnlockWaiters = [];
    for (const w of waiters) w.resolve(null);
  },

  requestUnlock: async (fileSaltB64?: string) => {
    if (!get().initialized) {
      await get().initFromVault(get().activeChannelId);
    }
    const state = get();
    if (fileSaltB64) {
      const matched = state.keysBySalt[fileSaltB64];
      if (matched) return matched;
      if (state.masterKey && state.config?.saltB64 === fileSaltB64) {
        return state.masterKey;
      }
    } else if (state.masterKey) {
      return state.masterKey;
    }

    return new Promise<CryptoKey | null>((resolve) => {
      pendingUnlockWaiters.push({ resolve });
      set((prev) => ({
        unlockPromptOpen: true,
        pendingUnlockSalt: fileSaltB64 ?? prev.pendingUnlockSalt,
      }));
    });
  },

  cancelUnlockPrompt: () => {
    set({ unlockPromptOpen: false, pendingUnlockSalt: null });
    const waiters = pendingUnlockWaiters;
    pendingUnlockWaiters = [];
    for (const w of waiters) w.resolve(null);
  },
}));

/**
 * Ensures an unlocked `CryptoKey` is available before decrypting/encrypting.
 * Prefers exact `fileSaltB64` matches from synced vault state before falling back
 * to the passphrase prompt for historical manually encrypted files.
 */
export async function requireEncryptionKey(fileSaltB64?: string): Promise<CryptoKey> {
  const store = useEncryptionStore.getState();
  if (!store.initialized) {
    await store.initFromVault(store.activeChannelId);
  }
  const current = useEncryptionStore.getState();
  if (fileSaltB64) {
    const exactKey = current.keysBySalt[fileSaltB64];
    if (exactKey) return exactKey;
    if (current.masterKey && current.config?.saltB64 === fileSaltB64) {
      return current.masterKey;
    }
  } else if (current.masterKey) {
    return current.masterKey;
  }

  const unlocked = await useEncryptionStore.getState().requestUnlock(fileSaltB64);
  if (!unlocked) {
    throw new EncryptionError("locked", "Encryption vault is locked.");
  }
  return unlocked;
}
