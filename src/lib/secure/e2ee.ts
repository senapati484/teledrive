import { create } from "zustand";
import { deleteSecret, getSecret, saveSecret } from "./vault";

export const E2EE_MAGIC = [0x54, 0x44, 0x45, 0x31] as const; // "TDE1"
export const E2EE_HEADER_BYTES = 32;
export const E2EE_BLOCK_SIZE = 512 * 1024; // 512 KiB plaintext block
export const E2EE_FRAME_OVERHEAD = 4 + 16; // 4-byte plainLen + 16-byte GCM auth tag
const PBKDF2_ITERATIONS = 150_000;
const CANARY_PLAINTEXT = "TELEDRIVE_E2EE_V1_OK";

const VAULT_KEY_E2EE_CONFIG = "teledrive_e2ee_config";
const VAULT_KEY_E2EE_RAW_KEY = "teledrive_e2ee_raw_key";

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
  v: 1;
  saltB64: string;
  canaryIvB64: string;
  canaryCtB64: string;
  encryptNewUploads: boolean;
  rememberKey: boolean;
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

function configStorageKey(config: StoredEncryptionConfig): string {
  return JSON.stringify(config);
}

async function loadStoredConfig(): Promise<StoredEncryptionConfig | null> {
  let raw = await getSecret(VAULT_KEY_E2EE_CONFIG).catch(() => null);
  if (!raw && typeof localStorage !== "undefined") {
    raw = localStorage.getItem(VAULT_KEY_E2EE_CONFIG);
  }
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (parsed && parsed.v === 1 && typeof parsed.saltB64 === "string") {
      return parsed as StoredEncryptionConfig;
    }
  } catch {
    // ignore malformed config
  }
  return null;
}

async function persistConfig(config: StoredEncryptionConfig | null): Promise<void> {
  if (!config) {
    await deleteSecret(VAULT_KEY_E2EE_CONFIG).catch(() => {});
    if (typeof localStorage !== "undefined") {
      localStorage.removeItem(VAULT_KEY_E2EE_CONFIG);
    }
    return;
  }
  const serialized = configStorageKey(config);
  if (typeof localStorage !== "undefined") {
    localStorage.setItem(VAULT_KEY_E2EE_CONFIG, serialized);
  }
  await saveSecret(VAULT_KEY_E2EE_CONFIG, serialized).catch(() => {});
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
  config: StoredEncryptionConfig | null;
  masterKey: CryptoKey | null;
  unlockPromptOpen: boolean;
  pendingUnlockSalt: string | null;
  initFromVault: () => Promise<void>;
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
  config: null,
  masterKey: null,
  unlockPromptOpen: false,
  pendingUnlockSalt: null,

  initFromVault: async () => {
    const cfg = await loadStoredConfig();
    if (!cfg) {
      set({
        initialized: true,
        configured: false,
        unlocked: false,
        encryptNewUploads: false,
        rememberKey: false,
        config: null,
        masterKey: null,
      });
      return;
    }

    let restoredKey: CryptoKey | null = null;
    if (cfg.rememberKey) {
      try {
        const rawKeyB64 = await getSecret(VAULT_KEY_E2EE_RAW_KEY);
        if (rawKeyB64) {
          const imported = await getSubtle().importKey(
            "raw",
            toStrictBytes(base64ToBytes(rawKeyB64)),
            { name: "AES-GCM", length: 256 },
            true,
            ["encrypt", "decrypt"]
          );
          if (await verifyCanary(imported, cfg.canaryIvB64, cfg.canaryCtB64)) {
            restoredKey = imported;
          }
        }
      } catch {
        restoredKey = null;
      }
    }

    set({
      initialized: true,
      configured: true,
      unlocked: Boolean(restoredKey),
      encryptNewUploads: cfg.encryptNewUploads,
      rememberKey: cfg.rememberKey,
      config: cfg,
      masterKey: restoredKey,
    });
  },

  setupPassphrase: async (passphrase, opts) => {
    const salt = randomBytes(16);
    const key = await deriveMasterKeyFromPassphrase(passphrase, salt);
    const canary = await encryptCanary(key);
    const rememberKey = opts?.rememberKey ?? true;
    const encryptNewUploads = opts?.encryptNewUploads ?? true;

    const config: StoredEncryptionConfig = {
      v: 1,
      saltB64: bytesToBase64(salt),
      canaryIvB64: canary.ivB64,
      canaryCtB64: canary.ctB64,
      encryptNewUploads,
      rememberKey,
    };

    await persistConfig(config);
    if (rememberKey) {
      const raw = await getSubtle().exportKey("raw", key);
      await saveSecret(VAULT_KEY_E2EE_RAW_KEY, bytesToBase64(new Uint8Array(raw))).catch(() => {});
    } else {
      await deleteSecret(VAULT_KEY_E2EE_RAW_KEY).catch(() => {});
    }

    set({
      initialized: true,
      configured: true,
      unlocked: true,
      encryptNewUploads,
      rememberKey,
      config,
      masterKey: key,
    });

    const waiters = pendingUnlockWaiters;
    pendingUnlockWaiters = [];
    for (const w of waiters) w.resolve(key);
  },

  unlockWithPassphrase: async (passphrase, rememberKeyOverride) => {
    let cfg = get().config ?? (await loadStoredConfig());
    const fallbackSalt = get().pendingUnlockSalt;

    if (!cfg) {
      if (!fallbackSalt) {
        throw new EncryptionError("not_configured", "Encryption is not configured.");
      }
      // Cross-device unlock: derive using the KDF salt embedded in `file.enc.s`
      // without storing an unverified canary locally.
      const candidate = await deriveMasterKeyFromPassphrase(
        passphrase,
        base64ToBytes(fallbackSalt)
      );
      set({
        unlocked: true,
        masterKey: candidate,
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
      await persistConfig(cfg);
    }
    if (rememberKey) {
      const raw = await getSubtle().exportKey("raw", candidate);
      await saveSecret(VAULT_KEY_E2EE_RAW_KEY, bytesToBase64(new Uint8Array(raw))).catch(() => {});
    }

    set({
      configured: true,
      unlocked: true,
      config: cfg,
      rememberKey,
      encryptNewUploads: cfg.encryptNewUploads,
      masterKey: candidate,
      unlockPromptOpen: false,
      pendingUnlockSalt: null,
    });

    const waiters = pendingUnlockWaiters;
    pendingUnlockWaiters = [];
    for (const w of waiters) w.resolve(candidate);
    return true;
  },

  lock: async () => {
    await deleteSecret(VAULT_KEY_E2EE_RAW_KEY).catch(() => {});
    const cfg = get().config;
    if (cfg && cfg.rememberKey) {
      const next = { ...cfg, rememberKey: false };
      await persistConfig(next);
      set({
        config: next,
        rememberKey: false,
        unlocked: false,
        masterKey: null,
      });
    } else {
      set({ unlocked: false, masterKey: null });
    }
  },

  setEncryptNewUploads: async (enabled) => {
    const cfg = get().config;
    if (!cfg) return;
    const next = { ...cfg, encryptNewUploads: enabled };
    await persistConfig(next);
    set({ config: next, encryptNewUploads: enabled });
  },

  setRememberKey: async (remember) => {
    const cfg = get().config;
    const key = get().masterKey;
    if (!cfg) return;
    const next = { ...cfg, rememberKey: remember };
    await persistConfig(next);
    if (remember && key) {
      const raw = await getSubtle().exportKey("raw", key);
      await saveSecret(VAULT_KEY_E2EE_RAW_KEY, bytesToBase64(new Uint8Array(raw))).catch(() => {});
    } else {
      await deleteSecret(VAULT_KEY_E2EE_RAW_KEY).catch(() => {});
    }
    set({ config: next, rememberKey: remember });
  },

  disableEncryption: async () => {
    await deleteSecret(VAULT_KEY_E2EE_RAW_KEY).catch(() => {});
    await persistConfig(null);
    set({
      configured: false,
      unlocked: false,
      encryptNewUploads: false,
      rememberKey: false,
      config: null,
      masterKey: null,
      unlockPromptOpen: false,
      pendingUnlockSalt: null,
    });
    const waiters = pendingUnlockWaiters;
    pendingUnlockWaiters = [];
    for (const w of waiters) w.resolve(null);
  },

  requestUnlock: async (fileSaltB64?: string) => {
    if (!get().initialized) {
      await get().initFromVault();
    }
    const existing = get().masterKey;
    if (existing) return existing;

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
 * Passes `fileSaltB64` so a fresh device without local vault config can still
 * derive the decryption key from `file.enc.s`.
 */
export async function requireEncryptionKey(fileSaltB64?: string): Promise<CryptoKey> {
  const store = useEncryptionStore.getState();
  if (!store.initialized) {
    await store.initFromVault();
  }
  const active = useEncryptionStore.getState().masterKey;
  if (active) return active;

  const unlocked = await useEncryptionStore.getState().requestUnlock(fileSaltB64);
  if (!unlocked) {
    throw new EncryptionError("locked", "Encryption vault is locked.");
  }
  return unlocked;
}
