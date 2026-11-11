export interface TeleFileSegment {
  messageId: number;
  size: number;
}

export interface TeleFileEncryption {
  /** Envelope version: 1 = TDE1 chunked AES-256-GCM */
  v: 1;
  /** Base64 key verification salt/fingerprint */
  s: string;
  /** Original plaintext size before framing overhead */
  plainSize?: number;
}

export interface RemoteVaultMetadata {
  /** Vault metadata schema version: 1 = legacy passphrase vault, 2 = auto-generated synced account key */
  v: 1 | 2;
  /** Unique identifier for this channel vault lineage */
  vaultId: string;
  /** Base64 key salt / epoch identifier */
  saltB64: string;
  /** Base64 AES-GCM IV for canary verification */
  canaryIvB64: string;
  /** Base64 AES-GCM ciphertext for canary verification */
  canaryCtB64: string;
  /** Provisioning mode: "auto" generates once per account and syncs via metadata + device vault */
  mode: "auto" | "passphrase";
  /** Base64 auto-generated 256-bit key (present only when mode === "auto" for multi-device sync) */
  accountKeyB64?: string;
  /** Whether new uploads should be encrypted automatically (false by default) */
  encryptNewUploads?: boolean;
  /** Epoch timestamp (ms) when this vault metadata was created or updated */
  updatedAt: number;
}

export interface TeleFile {
  id: string;
  name: string;
  size: number;
  mime: string;
  folderPath: string; // virtual folder path (e.g. "/" or "/Documents")
  messageId: number;
  channelId: string;
  uploadedAt: number;
  /** SHA-256 of the file contents when the uploader computed one. */
  hash?: string;
  /** Ordered Telegram segment messages when split past single-file limits (>2/4 GB). */
  segments?: TeleFileSegment[];
  /** Client-side encryption metadata when stored in zero-knowledge E2EE mode. */
  enc?: TeleFileEncryption;
  starred?: boolean;
  trashed?: boolean;
  archived?: boolean;
  lastOpenedAt?: number;
  thumbnailUrl?: string;
  offline?: boolean;
}

export interface SelectedFile {
  name: string;
  size: number;
  path: string;
  data?: Uint8Array;
  type: string;
}

export interface UploadItem {
  id: string;
  name: string;
  size: number;
  progress: number;
  status: 'pending' | 'uploading' | 'done' | 'error';
  file?: SelectedFile | File;
  folderPath?: string;
  error?: string;
  /** Live transfer speed in bytes/second — updated during upload */
  speed?: number;
  /** Estimated seconds remaining — updated during upload */
  eta?: number;
  /** Bytes uploaded so far — updated during upload */
  uploadedBytes?: number;
}
