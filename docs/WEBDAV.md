# Network Drive (WebDAV)

TeleDrive can expose its virtual drive as a **loopback-only WebDAV endpoint** so
Finder, Windows Explorer-compatible clients (RaiDrive, NetDrive), or `rclone
mount` can use it as a drive letter. The feature is **opt-in** and disabled by
default.

```
┌──────────────────┐   HTTP/1.1 (127.0.0.1)   ┌─────────────────────────────┐
│ RaiDrive / rclone│ ───────────────────────► │ Rust WebDAV socket (webdav) │
└──────────────────┘ ◄─────────────────────── └──────────────┬──────────────┘
                                                             │ Tauri event
                                                             │ + temp files
                                                  ┌──────────▼──────────────┐
                                                  │ TypeScript bridge       │
                                                  │ catalog / IndexQueue    │
                                                  │ uploader / downloader   │
                                                  └──────────┬──────────────┘
                                                             │ MTProto
                                                  ┌──────────▼──────────────┐
                                                  │ Telegram private channel│
                                                  └─────────────────────────┘
```

The Rust side owns the socket, HTTP parsing, Basic auth, locks and temp files.
It never speaks MTProto and never starts a second Telegram client: each request
is emitted to the TypeScript handler, which performs catalog, download, upload
and E2EE work through the same modules the UI uses. Request bodies are streamed
to `<app data>/webdav_tmp`, and `GET`/`Range` bytes are materialised there by the
existing pipelined downloader — no base64 payloads cross the IPC boundary.

## Enable it

1. Open **Settings → Network Drive (WebDAV)**.
2. Flip **Enable local WebDAV server**. The first enable generates a random
   24-character password; the username defaults to `teledrive`.
3. Adjust the port (default **8747**), username or password if needed, then
   press **Apply**. The mount URL is shown and can be copied:

   ```
   http://127.0.0.1:8747/
   ```

The server runs only while the toggle is on **and** TeleDrive is running. Turning
the toggle off, or quitting TeleDrive, closes the listener immediately.

Settings persist in `webdav_settings.json` under the app data directory:

- Windows: `%APPDATA%\com.teledrive.app\webdav_settings.json`
- macOS: `~/Library/Application Support/com.teledrive.app/webdav_settings.json`
- Linux: `~/.local/share/com.teledrive.app/webdav_settings.json`

The file is written atomically and restricted to the current user (mode `0600`
on Unix). The password is stored there so the server can verify Basic auth.

## Mount it

### Windows — RaiDrive / NetDrive

1. Install RaiDrive (free) or NetDrive.
2. Add a new drive → **WebDAV**.
3. Address: `http://127.0.0.1:8747/`
4. Username/password: the values from the TeleDrive settings page.
5. Choose a drive letter and connect. Files appear under the same folder tree as
   My Drive.

> Windows' built-in **Map network drive** dialog cannot use plain `http://`
> WebDAV; use RaiDrive, NetDrive, or `rclone mount` with WinFsp.

### Windows/macOS/Linux — rclone with WinFsp/FUSE

Install [rclone](https://rclone.org/downloads/) and
[WinFsp](https://winfsp.dev/rel/) (Windows) or FUSE (macOS/Linux), then create a
remote:

```ini
# rclone.conf
[teledrive]
type = webdav
url = http://127.0.0.1:8747/
vendor = other
user = teledrive
pass = <output of: rclone obscure 'the-password-from-settings'>
```

Mount a drive letter (Windows):

```powershell
rclone mount teledrive: T: --network-mode --vfs-cache-mode writes
```

Mount a folder (macOS/Linux):

```bash
rclone mount teledrive: ~/TeleDrive --vfs-cache-mode writes
```

Without WinFsp/FUSE you can still script against the remote:

```bash
rclone lsd teledrive:
rclone lsf teledrive:
rclone copy ./local.bin teledrive:/
rclone copy teledrive:/remote.bin ./downloads/
rclone deletefile teledrive:/remote.bin
```

### macOS Finder

**Go → Connect to Server…** → `http://127.0.0.1:8747/` → Connect as a registered
user with the TeleDrive WebDAV credentials. Finder mounts it under
`/Volumes/teledrive`.

### Linux (GVFS / davfs2)

```bash
gio mount http://teledrive@127.0.0.1:8747/
# or, with davfs2:
sudo mount -t davfs http://127.0.0.1:8747/ /mnt/teledrive
```

## Security model

- **Loopback only.** The listener binds `127.0.0.1`; it is never exposed on
  `0.0.0.0` or a LAN interface. Do not forward the port or proxy it.
- **HTTP Basic auth on every request.** Credentials are compared in constant
  time. The realm is `TeleDrive WebDAV`.
- **Browser isolation.** Any request carrying an `Origin` header is rejected
  with `403`, and requests whose `Host` header is not loopback
  (`127.0.0.1`, `localhost`, `[::1]`) are rejected too. A malicious web page
  cannot drive the mount through DNS rebinding or CSRF.
- **No secret logging.** The server logs only lifecycle/error summaries to
  stderr; Authorization headers, passwords and file contents are never logged.
- **App lifecycle.** The socket is created only after the frontend bridge
  announces it is listening (so the first request can never be dropped), and it
  is torn down on disable and on app exit.
- Traffic between the mount client and TeleDrive is plain HTTP **over the
  loopback interface only**. There is no TLS; that is acceptable for a local
  endpoint but is why the server must stay loopback-only.

## Behavior details

- **Reads** decrypt existing `TDE1` files transparently. If the encryption vault
  is configured but locked, reads/writes that need the key fail with `403`
  instead of opening an unlock prompt from a background request.
- **Writes** go through the same uploader and catalog path as in-app uploads.
  WebDAV honors the persisted `encryptNewUploads` policy: if it is enabled,
  `PUT` uploads are encrypted with `TDE1`; otherwise they are stored as plain
  Telegram documents. Plaintext is never written when encryption is configured
  for new uploads, and a locked vault rejects writes with `403`.
- **Catalog consistency.** Every mutation is applied to the local store and
  persisted through the existing `IndexQueue`. A failed `PUT` deletes any
  partially uploaded segment messages, and a failed catalog commit deletes the
  just-uploaded messages, so failed writes do not leave orphans.
- **Concurrent devices.** Each index write verifies the live chunk ids/texts
  immediately before writing and again after the write lands. If another
  device committed first, the writer reloads the authoritative snapshot,
  re-applies only its own catalog change, and retries once (two attempts
  total). A stale `PUT` is rejected with `409` before bytes are uploaded when
  the pre-write check cannot refresh safely, or `503` + `Retry-After` when the
  revision could not be read. Same-file content conflicts remain
  last-writer-wins; no conflicted-copy merge is performed.
- **Bounded uploads.** At most **2 concurrent WebDAV `PUT`s** are accepted
  (`DEFAULT_MAX_CONCURRENT_PUTS` in `src-tauri/src/webdav.rs`); further PUTs
  wait up to 10 s and then receive `429 Too Many Requests` with
  `Retry-After: 2`. Each upload pipelines three MTProto parts, so this keeps at
  most six large part RPCs in flight for the mount. A shared six-permit
  semaphore in the uploader also bounds fan-out across in-app and WebDAV
  uploads. The limiter also caps temp-disk use to two in-flight `PUT` bodies.
  A Telegram `FLOOD_WAIT` longer than 10 s aborts the PUT with
  `503 + Retry-After: <flood seconds>` instead of holding the request for the
  full cooldown; shorter waits are still absorbed by the uploader.
- **Bounded metadata.** Mutations fail fast with `503 + Retry-After` while the
  index queue is in a Telegram backoff instead of waiting for the 60 s stuck
  retry. The backoff deadline is honoured, then the queue retries and requests
  succeed again (a `FLOOD_WAIT` may legitimately last minutes).
- **Coalesced catalog writes.** MKCOL/DELETE/MOVE/COPY mutations arriving
  within a **250 ms window** are applied in order, merged into one catalog
  state, and persisted with a single `EditMessage`; every caller waits for that
  shared commit, so success is never reported before persistence.
- **Edit rate limit.** WebDAV index writes take a token bucket of **1 edit per
  2 s with a burst of 1** (`DEFAULT_METADATA_EDIT_INTERVAL_MS` /
  `DEFAULT_METADATA_EDIT_BURST`). Mutations arriving while no token is available
  stay queued and coalesce into the next edit. A batch/PUT that cannot get a
  token before its **12 s** deadline returns `503 + Retry-After` with the actual
  remaining limiter wait, instead of letting RaiDrive surface `EACCES` after
  ~20 s. PUT keeps its own commit so overwrite/conflict failures remain
  visible. Metadata cleanup (deleted messages, tombstones, cloned COPY
  messages) follows the eventual queue outcome.
- **Methods.** `OPTIONS`, `PROPFIND` (Depth 0/1/infinity), `GET`, `HEAD`
  (with `Range` → `206`/`416`), `PUT`, `MKCOL`, `DELETE` (recursive),
  `MOVE`, `COPY`, `LOCK`, `UNLOCK`; `PROPPATCH` responds `207` with a `403`
  propstat. `DAV: 1, 2` is advertised.
- **Locks** are in-memory, exclusive, `Depth: 0|infinity`, and expire after the
  requested `Timeout` (capped at one hour). Locks vanish when the server stops.
- **Errors** use standard statuses: `404`, `409` (missing parent / collection
  conflicts), `412` (Overwrite: F), `423` (locked), `507` (Telegram limits,
  empty files, oversized PROPFIND/COPY), `503` (index still loading / rate
  limit), `502`/`500` for unexpected backend failures.

## Limitations

- TeleDrive must be open, signed in, and have finished loading the drive index;
  otherwise requests return `503`. The listener starts only after the UI's
  request bridge is ready on each launch.
- Only the signed-in account's storage channel is exposed.
- Duplicate names in the same folder (which the UI permits) collapse to the most
  recent entry in WebDAV listings, because WebDAV URLs must be unique. `PUT` to
  an existing file URL replaces all catalog entries for that path.
- The device-backup namespace (`/TeleDrive Backups`) is hidden, matching
  My Drive.
- `COPY` is implemented as server-side Telegram message cloning and is capped at
  500 files per request.
- `GET` waits until the requested bytes are fully materialised in the temp
  directory before sending the response, so seek/latency on very large files is
  not as low as a native streaming server. The temp directory needs free space
  equal to the largest in-flight `GET` plus the largest `PUT`. A single
  request must finish within 30 minutes (the IPC bridge timeout).
- Range requests on a legacy multi-segment `TDE1` file whose segment boundaries
  cannot be inferred fall back to decrypting from the start of the file. Plain
  and single-segment encrypted files fetch only the requested wire range.
- No quotas, versions, property storage, or multi-user accounts.
- HTTP is plain on loopback; never bind or forward the port.

## Troubleshooting

| Symptom | Cause / fix |
| --- | --- |
| `401 Unauthorized` | Wrong username/password; copy them again from Settings. Enabling with an empty password generates a new one. |
| `403 Forbidden` | Request came from a browser (`Origin` header) or a non-loopback `Host`. Use a native WebDAV client pointed at `127.0.0.1`. |
| `409 Conflict` | Parent folder does not exist (`MKCOL` it first) or trying to `PUT` over a folder. |
| `423 Locked` | Another client holds a lock. Wait for the timeout, `UNLOCK` with the token, or restart the server from Settings. |
| `507 Insufficient Storage` | Telegram cannot store empty files, or the request exceeded a Telegram/WebDAV limit (file size, COPY count, PROPFIND size). |
| `503 Service Unavailable` | TeleDrive is signed out, the index is still loading, Telegram is rate-limiting, or the drive revision could not be verified (retry after the `Retry-After` delay). |
| `429 Too Many Requests` | More than two WebDAV uploads are running. Respect `Retry-After`; RaiDrive/rclone retry automatically. |
| Port already in use | Change the port in Settings and press Apply; the UI shows the bind error. |
| Mount shows nothing | Sign in and wait for the drive index; run `rclone lsd teledrive:` to see the raw error. |

## Timing diagnostics

Send `X-TeleDrive-Timing: 1` on a request (curl/rclone) to receive a standard
`Server-Timing` response header. PUT reports `prepare`, `upload`,
`upload_wait` (retry/FLOOD_WAIT time), `commit` and `total`; other methods
report `total`. The header is opt-in and informational only.

```bash
curl -u user:pass -X PUT --data-binary @file.bin \
  -H "X-TeleDrive-Timing: 1" -D - http://127.0.0.1:8747/file.bin
```

## Protocol harness (maintainers)

`src-tauri/examples/webdav_harness.rs` runs the real Rust server with an
in-memory catalog, so the wire protocol can be tested without Telegram:

```bash
cd src-tauri
cargo run --example webdav_harness   # listens on 127.0.0.1:18747
```

Then point stock clients at `http://127.0.0.1:18747/` with
`harness` / `harness-pass`:

```bash
curl -u harness:harness-pass -X PROPFIND -H "Depth: 1" http://127.0.0.1:18747/
curl -u harness:harness-pass -r 0-4 http://127.0.0.1:18747/hello.txt
```

The parallel smoke test issues 8 concurrent PUTs + 8 MKCOLs, retries
`429`/`503` according to `Retry-After`, and verifies every object appears
exactly once before deleting the probes:

```bash
node scripts/webdav_parallel_check.mjs
```

Set `WEBDAV_HARNESS_PUT_DELAY_MS=3000` on the harness and
`PUT_COUNT=12` for the script to force limiter rejections and exercise the
retry path.
