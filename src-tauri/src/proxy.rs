use aes::Aes256;
use ctr::cipher::{KeyIvInit, StreamCipher};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::net::IpAddr;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use tauri::async_runtime::JoinHandle;
use tauri::ipc::{Channel, InvokeBody, InvokeResponseBody, Request};
use tauri::{AppHandle, Manager};
use tokio::io::{AsyncReadExt, AsyncWriteExt, ReadHalf, WriteHalf};
use tokio::net::TcpStream;
use tokio::sync::Mutex as AsyncMutex;
use tokio::time::timeout;

type Aes256Ctr = ctr::Ctr128BE<Aes256>;

const PROXY_SETTINGS_FILE: &str = "proxy_settings.json";
const CONNECT_TIMEOUT: Duration = Duration::from_secs(10);
const HANDSHAKE_TIMEOUT: Duration = Duration::from_secs(10);
const MAX_HTTP_HEADER_BYTES: usize = 16 * 1024;
const MAX_TLS_RECORD_BYTES: usize = 16 * 1024;
const READ_BUFFER_BYTES: usize = 32 * 1024;
/// Canonical Telegram DC4 IPv4 address used by the active connectivity test probe.
const TELEGRAM_TEST_DC_IP: &str = "149.154.167.91";
const TELEGRAM_TEST_DC_PORT: u16 = 443;
const TELEGRAM_TEST_DC_ID: i16 = 4;

/// Supported transport proxy protocols.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ProxyType {
    #[default]
    Mtproxy,
    Socks5,
    Http,
}

/// Persisted user proxy configuration stored privately (`0600`) in `app_data_dir`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct ProxySettings {
    pub enabled: bool,
    pub proxy_type: ProxyType,
    pub host: String,
    pub port: u16,
    pub secret: String,
    pub username: String,
    pub password: String,
}

impl Default for ProxySettings {
    fn default() -> Self {
        Self {
            enabled: false,
            proxy_type: ProxyType::Mtproxy,
            host: String::new(),
            port: 443,
            secret: String::new(),
            username: String::new(),
            password: String::new(),
        }
    }
}

/// Result returned by `test_proxy_connection`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TestProxyResult {
    pub ok: bool,
    pub latency_ms: u64,
    pub message: String,
}

/// Out-of-band socket lifecycle notifications sent on the status channel.
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum SocketStatusEvent {
    Closed,
    Error { message: String },
}

/// Decoded MTProxy secret components supporting standard (`16B`), padded (`dd...`),
/// and Fake-TLS (`ee...` + domain) secrets in either hex or base64/base64url encoding.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct ParsedMtproxySecret {
    pub secret_16: [u8; 16],
    pub padded: bool,
    pub fake_tls_domain: Option<String>,
}

/// Managed pool of native proxy-backed TCP sockets keyed by numeric handle ID.
pub struct ProxySocketState {
    next_id: AtomicU64,
    sockets: Mutex<HashMap<u64, Arc<SocketEntry>>>,
}

impl Default for ProxySocketState {
    fn default() -> Self {
        Self {
            next_id: AtomicU64::new(1),
            sockets: Mutex::new(HashMap::new()),
        }
    }
}

struct SocketEntry {
    writer: Arc<AsyncMutex<Option<ProxyWriteStream>>>,
    reader_handle: JoinHandle<()>,
}

enum ProxyReadStream {
    Plain {
        reader: ReadHalf<TcpStream>,
        buffered: Vec<u8>,
    },
    FakeTls {
        reader: ReadHalf<TcpStream>,
        buffered: Vec<u8>,
    },
}

enum ProxyWriteStream {
    Plain {
        writer: WriteHalf<TcpStream>,
    },
    FakeTls {
        writer: WriteHalf<TcpStream>,
        sent_ccs: bool,
    },
}

impl ProxyReadStream {
    async fn read_chunk(&mut self, out: &mut [u8]) -> Result<usize, String> {
        match self {
            ProxyReadStream::Plain { reader, buffered } => {
                if !buffered.is_empty() {
                    let take = buffered.len().min(out.len());
                    out[..take].copy_from_slice(&buffered[..take]);
                    buffered.drain(..take);
                    return Ok(take);
                }
                reader
                    .read(out)
                    .await
                    .map_err(|e| classify_io_error("Socket read failed", &e))
            }
            ProxyReadStream::FakeTls { reader, buffered } => {
                loop {
                    if !buffered.is_empty() {
                        let take = buffered.len().min(out.len());
                        out[..take].copy_from_slice(&buffered[..take]);
                        buffered.drain(..take);
                        return Ok(take);
                    }
                    let mut hdr = [0u8; 5];
                    match read_exact_or_eof(reader, &mut hdr).await {
                        Ok(false) => return Ok(0),
                        Ok(true) => {}
                        Err(e) => return Err(classify_io_error("Fake-TLS read failed", &e)),
                    }
                    let rec_type = hdr[0];
                    let rec_len = u16::from_be_bytes([hdr[3], hdr[4]]) as usize;
                    if rec_len > MAX_TLS_RECORD_BYTES + 2048 {
                        return Err(format!(
                            "Fake-TLS framing error: oversized TLS record ({rec_len} bytes)"
                        ));
                    }
                    let mut payload = vec![0u8; rec_len];
                    reader
                        .read_exact(&mut payload)
                        .await
                        .map_err(|e| classify_io_error("Fake-TLS payload read failed", &e))?;

                    match rec_type {
                        // Application Data -> decapsulated MTProto bytes
                        0x17 => {
                            if !payload.is_empty() {
                                *buffered = payload;
                            }
                        }
                        // ChangeCipherSpec -> harmless mid-stream middlebox compat record
                        0x14 => continue,
                        // TLS Alert -> peer closed or rejected Fake-TLS
                        0x15 => {
                            let desc = payload.get(1).copied().unwrap_or(0);
                            return Err(format!(
                                "Fake-TLS proxy sent TLS alert (code {desc}); check secret or server"
                            ));
                        }
                        other => {
                            return Err(format!(
                                "Fake-TLS framing error: unexpected TLS record type 0x{other:02x}"
                            ));
                        }
                    }
                }
            }
        }
    }

    async fn read_exact(&mut self, buf: &mut [u8]) -> Result<(), String> {
        let mut offset = 0;
        while offset < buf.len() {
            let n = self.read_chunk(&mut buf[offset..]).await?;
            if n == 0 {
                return Err("Connection closed by remote peer".to_string());
            }
            offset += n;
        }
        Ok(())
    }
}

impl ProxyWriteStream {
    async fn write_all_and_flush(&mut self, data: &[u8]) -> Result<(), String> {
        match self {
            ProxyWriteStream::Plain { writer } => {
                writer
                    .write_all(data)
                    .await
                    .map_err(|e| classify_io_error("Socket write failed", &e))?;
                writer
                    .flush()
                    .await
                    .map_err(|e| classify_io_error("Socket flush failed", &e))?;
                Ok(())
            }
            ProxyWriteStream::FakeTls { writer, sent_ccs } => {
                if !*sent_ccs {
                    // Emit standard TLS 1.3 ChangeCipherSpec compatibility record once
                    writer
                        .write_all(&[0x14, 0x03, 0x03, 0x00, 0x01, 0x01])
                        .await
                        .map_err(|e| classify_io_error("Fake-TLS CCS write failed", &e))?;
                    *sent_ccs = true;
                }
                for chunk in data.chunks(MAX_TLS_RECORD_BYTES) {
                    let len = (chunk.len() as u16).to_be_bytes();
                    let header = [0x17, 0x03, 0x03, len[0], len[1]];
                    writer
                        .write_all(&header)
                        .await
                        .map_err(|e| classify_io_error("Fake-TLS header write failed", &e))?;
                    writer
                        .write_all(chunk)
                        .await
                        .map_err(|e| classify_io_error("Fake-TLS body write failed", &e))?;
                }
                writer
                    .flush()
                    .await
                    .map_err(|e| classify_io_error("Fake-TLS flush failed", &e))?;
                Ok(())
            }
        }
    }

    async fn shutdown(&mut self) {
        match self {
            ProxyWriteStream::Plain { writer } | ProxyWriteStream::FakeTls { writer, .. } => {
                let _ = writer.shutdown().await;
            }
        }
    }
}

async fn read_exact_or_eof<R: AsyncReadExt + Unpin>(
    reader: &mut R,
    buf: &mut [u8],
) -> std::io::Result<bool> {
    let mut offset = 0;
    while offset < buf.len() {
        let n = reader.read(&mut buf[offset..]).await?;
        if n == 0 {
            if offset == 0 {
                return Ok(false);
            }
            return Err(std::io::Error::new(
                std::io::ErrorKind::UnexpectedEof,
                "Unexpected EOF reading TLS record header",
            ));
        }
        offset += n;
    }
    Ok(true)
}

fn settings_path(app: &AppHandle) -> Result<PathBuf, String> {
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to resolve app data dir: {e}"))?;
    Ok(data_dir.join(PROXY_SETTINGS_FILE))
}

pub(crate) fn load_from_path(path: &Path) -> ProxySettings {
    let Ok(contents) = std::fs::read_to_string(path) else {
        return ProxySettings::default();
    };
    serde_json::from_str::<ProxySettings>(&contents).unwrap_or_default()
}

pub(crate) fn save_to_path(path: &Path, settings: &ProxySettings) -> Result<(), String> {
    let payload = serde_json::to_vec_pretty(settings)
        .map_err(|e| format!("Failed to serialize proxy settings: {e}"))?;
    super::atomic_write_with_perms(path, &payload, true)
}

fn sanitize_settings(settings: &ProxySettings) -> ProxySettings {
    ProxySettings {
        enabled: settings.enabled,
        proxy_type: settings.proxy_type,
        host: settings.host.trim().to_string(),
        port: settings.port,
        secret: settings.secret.trim().to_string(),
        username: settings.username.trim().to_string(),
        password: settings.password.clone(),
    }
}

/// Validates user-supplied proxy configuration before dialing or saving an active config.
pub(crate) fn validate_proxy_settings(settings: &ProxySettings) -> Result<(), String> {
    let host = settings.host.trim();
    if host.is_empty() {
        return Err("Proxy host is required.".to_string());
    }
    if host.chars().any(|c| c.is_whitespace() || c.is_control()) {
        return Err("Proxy host cannot contain spaces or control characters.".to_string());
    }
    if settings.port == 0 {
        return Err("Proxy port must be between 1 and 65535.".to_string());
    }
    if settings.proxy_type == ProxyType::Mtproxy {
        parse_mtproxy_secret(&settings.secret)?;
    }
    Ok(())
}

/// Decodes an MTProxy secret in hex or base64/base64url into raw secret + Fake-TLS SNI metadata.
pub(crate) fn parse_mtproxy_secret(raw: &str) -> Result<ParsedMtproxySecret, String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err("MTProxy secret is required.".to_string());
    }

    let bytes = if trimmed.len() >= 32
        && trimmed.len() % 2 == 0
        && trimmed.bytes().all(|b| b.is_ascii_hexdigit())
    {
        decode_hex(trimmed)?
    } else {
        decode_base64_flexible(trimmed).ok_or_else(|| {
            "Invalid MTProxy secret: expected 32 hex chars (standard), 34 chars starting with dd, or ee + secret + domain (Fake-TLS)."
                .to_string()
        })?
    };

    if bytes.len() == 16 {
        let mut secret_16 = [0u8; 16];
        secret_16.copy_from_slice(&bytes);
        return Ok(ParsedMtproxySecret {
            secret_16,
            padded: false,
            fake_tls_domain: None,
        });
    }

    if bytes.len() == 17 && bytes[0] == 0xdd {
        let mut secret_16 = [0u8; 16];
        secret_16.copy_from_slice(&bytes[1..17]);
        return Ok(ParsedMtproxySecret {
            secret_16,
            padded: true,
            fake_tls_domain: None,
        });
    }

    if bytes.len() >= 18 && bytes[0] == 0xee {
        let mut secret_16 = [0u8; 16];
        secret_16.copy_from_slice(&bytes[1..17]);
        let domain = std::str::from_utf8(&bytes[17..])
            .map_err(|_| "Invalid MTProxy Fake-TLS secret: SNI domain is not valid UTF-8.".to_string())?
            .trim_end_matches('\0')
            .to_string();
        if domain.is_empty()
            || domain.len() > 253
            || domain.chars().any(|c| c.is_whitespace() || c.is_control())
        {
            return Err("Invalid MTProxy Fake-TLS secret: domain is empty or malformed.".to_string());
        }
        return Ok(ParsedMtproxySecret {
            secret_16,
            padded: true,
            fake_tls_domain: Some(domain),
        });
    }

    Err(
        "Invalid MTProxy secret: expected 32 hex chars (standard), 34 chars starting with dd, or ee + secret + domain (Fake-TLS)."
            .to_string(),
    )
}

fn decode_hex(s: &str) -> Result<Vec<u8>, String> {
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len() / 2);
    for pair in bytes.chunks_exact(2) {
        let hi = hex_nibble(pair[0])?;
        let lo = hex_nibble(pair[1])?;
        out.push((hi << 4) | lo);
    }
    Ok(out)
}

fn hex_nibble(b: u8) -> Result<u8, String> {
    match b {
        b'0'..=b'9' => Ok(b - b'0'),
        b'a'..=b'f' => Ok(b - b'a' + 10),
        b'A'..=b'F' => Ok(b - b'A' + 10),
        _ => Err("Invalid hex character in MTProxy secret.".to_string()),
    }
}

fn decode_base64_flexible(input: &str) -> Option<Vec<u8>> {
    let cleaned = input.trim_end_matches('=');
    if cleaned.is_empty() {
        return None;
    }
    let mut val: u32 = 0;
    let mut bits: i32 = -8;
    let mut out = Vec::with_capacity((cleaned.len() * 3) / 4);
    for b in cleaned.bytes() {
        let d: u32 = match b {
            b'A'..=b'Z' => (b - b'A') as u32,
            b'a'..=b'z' => (b - b'a' + 26) as u32,
            b'0'..=b'9' => (b - b'0' + 52) as u32,
            b'+' | b'-' => 62,
            b'/' | b'_' => 63,
            _ => return None,
        };
        val = (val << 6) | d;
        bits += 6;
        if bits >= 0 {
            out.push(((val >> bits) & 0xff) as u8);
            bits -= 8;
        }
    }
    Some(out)
}

fn encode_base64_standard(input: &[u8]) -> String {
    const TABLE: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity(input.len().div_ceil(3) * 4);
    for chunk in input.chunks(3) {
        let b0 = chunk[0] as usize;
        let b1 = chunk.get(1).copied().unwrap_or(0) as usize;
        let b2 = chunk.get(2).copied().unwrap_or(0) as usize;
        out.push(TABLE[b0 >> 2] as char);
        out.push(TABLE[((b0 & 0x03) << 4) | (b1 >> 4)] as char);
        if chunk.len() > 1 {
            out.push(TABLE[((b1 & 0x0f) << 2) | (b2 >> 6)] as char);
        } else {
            out.push('=');
        }
        if chunk.len() > 2 {
            out.push(TABLE[b2 & 0x3f] as char);
        } else {
            out.push('=');
        }
    }
    out
}

pub(crate) fn hmac_sha256(key: &[u8], data: &[u8]) -> [u8; 32] {
    const BLOCK_SIZE: usize = 64;
    let mut padded_key = [0u8; BLOCK_SIZE];
    if key.len() > BLOCK_SIZE {
        let hashed = Sha256::digest(key);
        padded_key[..32].copy_from_slice(&hashed);
    } else {
        padded_key[..key.len()].copy_from_slice(key);
    }

    let mut ipad = [0x36u8; BLOCK_SIZE];
    let mut opad = [0x5cu8; BLOCK_SIZE];
    for i in 0..BLOCK_SIZE {
        ipad[i] ^= padded_key[i];
        opad[i] ^= padded_key[i];
    }

    let mut inner = Sha256::new();
    inner.update(ipad);
    inner.update(data);
    let inner_hash = inner.finalize();

    let mut outer = Sha256::new();
    outer.update(opad);
    outer.update(inner_hash);
    outer.finalize().into()
}

fn fill_random(buf: &mut [u8]) -> Result<(), String> {
    getrandom::getrandom(buf).map_err(|e| format!("CSPRNG failure: {e}"))
}

fn current_unix_secs() -> u32 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as u32)
        .unwrap_or(0)
}

fn push_u16_len_prefixed(dst: &mut Vec<u8>, data: &[u8]) {
    dst.extend_from_slice(&(data.len() as u16).to_be_bytes());
    dst.extend_from_slice(data);
}

fn push_tls_extension(ext: &mut Vec<u8>, ext_type: u16, body: &[u8]) {
    ext.extend_from_slice(&ext_type.to_be_bytes());
    push_u16_len_prefixed(ext, body);
}

/// Constructs an MTProxy Fake-TLS `ClientHello` packet stamped with HMAC-SHA256 + timestamp.
pub(crate) fn build_fake_tls_client_hello(
    secret_16: &[u8; 16],
    domain: &str,
    now_unix: u32,
) -> Result<(Vec<u8>, [u8; 32]), String> {
    let mut session_id = [0u8; 32];
    let mut key_share_pub = [0u8; 32];
    fill_random(&mut session_id)?;
    fill_random(&mut key_share_pub)?;

    let mut extensions = Vec::with_capacity(420);

    // 0x0000: SNI server_name
    let domain_bytes = domain.as_bytes();
    let mut sni_entry = Vec::with_capacity(domain_bytes.len() + 5);
    let list_len = (domain_bytes.len() + 3) as u16;
    sni_entry.extend_from_slice(&list_len.to_be_bytes());
    sni_entry.push(0x00); // host_name
    push_u16_len_prefixed(&mut sni_entry, domain_bytes);
    push_tls_extension(&mut extensions, 0x0000, &sni_entry);

    // 0x0017: extended_master_secret
    push_tls_extension(&mut extensions, 0x0017, &[]);

    // 0xff01: renegotiation_info
    push_tls_extension(&mut extensions, 0xff01, &[0x00]);

    // 0x000a: supported_groups (X25519, secp256r1, secp384r1)
    push_tls_extension(
        &mut extensions,
        0x000a,
        &[0x00, 0x06, 0x00, 0x1d, 0x00, 0x17, 0x00, 0x18],
    );

    // 0x000b: ec_point_formats (uncompressed)
    push_tls_extension(&mut extensions, 0x000b, &[0x01, 0x00]);

    // 0x0023: session_ticket
    push_tls_extension(&mut extensions, 0x0023, &[]);

    // 0x0010: ALPN (h2, http/1.1)
    push_tls_extension(
        &mut extensions,
        0x0010,
        &[
            0x00, 0x0c, 0x02, b'h', b'2', 0x08, b'h', b't', b't', b'p', b'/', b'1', b'.', b'1',
        ],
    );

    // 0x000d: signature_algorithms
    push_tls_extension(
        &mut extensions,
        0x000d,
        &[
            0x00, 0x0c, 0x04, 0x03, 0x08, 0x04, 0x04, 0x01, 0x05, 0x03, 0x08, 0x05, 0x05, 0x01,
        ],
    );

    // 0x002b: supported_versions (TLS 1.3, TLS 1.2)
    push_tls_extension(&mut extensions, 0x002b, &[0x04, 0x03, 0x04, 0x03, 0x03]);

    // 0x002d: psk_key_exchange_modes (psk_dhe_ke)
    push_tls_extension(&mut extensions, 0x002d, &[0x01, 0x01]);

    // 0x0033: key_share (X25519, 32 bytes)
    let mut key_share = Vec::with_capacity(38);
    key_share.extend_from_slice(&36u16.to_be_bytes());
    key_share.extend_from_slice(&0x001du16.to_be_bytes());
    push_u16_len_prefixed(&mut key_share, &key_share_pub);
    push_tls_extension(&mut extensions, 0x0033, &key_share);

    // Assemble ClientHello body before extensions length to measure padding to 512 bytes payload
    let cipher_suites: &[u8] = &[
        0x13, 0x01, 0x13, 0x02, 0x13, 0x03, // TLS 1.3
        0xc0, 0x2b, 0xc0, 0x2f, 0xc0, 0x2c, 0xc0, 0x30, // ECDHE
        0xcc, 0xa9, 0xcc, 0xa8,
    ];
    let base_record_payload_len =
        4 + 2 + 32 + 1 + 32 + 2 + cipher_suites.len() + 2 + 2 + extensions.len();
    if base_record_payload_len + 4 < 512 {
        let pad_len = 512 - (base_record_payload_len + 4);
        let pad_zeros = vec![0u8; pad_len];
        push_tls_extension(&mut extensions, 0x0015, &pad_zeros);
    }

    let hs_body_len = 2 + 32 + 1 + 32 + 2 + cipher_suites.len() + 2 + 2 + extensions.len();
    let record_len = 4 + hs_body_len;

    let mut packet = Vec::with_capacity(5 + record_len);
    // TLS record header: Handshake (0x16), TLS 1.0 (0x03, 0x01)
    packet.extend_from_slice(&[0x16, 0x03, 0x01]);
    packet.extend_from_slice(&(record_len as u16).to_be_bytes());

    // Handshake ClientHello header: 0x01 + uint24 len
    packet.push(0x01);
    packet.push(((hs_body_len >> 16) & 0xff) as u8);
    packet.push(((hs_body_len >> 8) & 0xff) as u8);
    packet.push((hs_body_len & 0xff) as u8);

    // ClientVersion: TLS 1.2 (0x03, 0x03)
    packet.extend_from_slice(&[0x03, 0x03]);

    // Random offset = 11..43 (zeroed for HMAC calculation)
    let random_offset = packet.len();
    packet.extend_from_slice(&[0u8; 32]);

    // Session ID (32 bytes)
    packet.push(32);
    packet.extend_from_slice(&session_id);

    // Cipher suites
    push_u16_len_prefixed(&mut packet, cipher_suites);

    // Compression methods (null)
    packet.extend_from_slice(&[0x01, 0x00]);

    // Extensions
    push_u16_len_prefixed(&mut packet, &extensions);

    // Compute Fake-TLS ClientHello random = HMAC-SHA256(secret, packet_with_zero_random)
    // with final 4 bytes XORed with little-endian Unix timestamp
    let mac = hmac_sha256(secret_16, &packet);
    let mut client_random = mac;
    let ts_le = now_unix.to_le_bytes();
    for i in 0..4 {
        client_random[28 + i] ^= ts_le[i];
    }
    packet[random_offset..random_offset + 32].copy_from_slice(&client_random);

    Ok((packet, client_random))
}

/// Verifies ServerHello HMAC for a Fake-TLS MTProxy greeting (`ServerHello` [+ `CCS` + `AppData`]).
pub(crate) fn verify_fake_tls_greeting_hmac(
    secret_16: &[u8; 16],
    client_random: &[u8; 32],
    full_greeting: &[u8],
    server_hello_only_len: usize,
) -> Result<(), String> {
    if full_greeting.len() < 43 || full_greeting[0] != 0x16 || full_greeting[5] != 0x02 {
        return Err(
            "Fake-TLS handshake failed: proxy did not respond with a valid TLS ServerHello."
                .to_string(),
        );
    }

    let mut server_random = [0u8; 32];
    server_random.copy_from_slice(&full_greeting[11..43]);

    let matches_with = |slice: &[u8]| -> bool {
        let mut msg = Vec::with_capacity(32 + slice.len());
        msg.extend_from_slice(client_random);
        msg.extend_from_slice(slice);
        msg[32 + 11..32 + 43].fill(0);
        let expected = hmac_sha256(secret_16, &msg);
        constant_time_eq(&expected, &server_random)
    };

    if matches_with(full_greeting) || matches_with(&full_greeting[..server_hello_only_len]) {
        Ok(())
    } else {
        Err(
            "Fake-TLS handshake failed: wrong MTProxy secret or remote server is not an MTProxy."
                .to_string(),
        )
    }
}

fn constant_time_eq(a: &[u8; 32], b: &[u8; 32]) -> bool {
    let mut diff = 0u8;
    for i in 0..32 {
        diff |= a[i] ^ b[i];
    }
    diff == 0
}

fn format_host_port(host: &str, port: u16) -> String {
    if host.contains(':') && !host.starts_with('[') {
        format!("[{host}]:{port}")
    } else {
        format!("{host}:{port}")
    }
}

fn classify_io_error(context: &str, err: &std::io::Error) -> String {
    use std::io::ErrorKind;
    let detail = match err.kind() {
        ErrorKind::ConnectionRefused => "Connection refused by proxy server",
        ErrorKind::TimedOut => "Connection timed out",
        ErrorKind::HostUnreachable => "Proxy host unreachable",
        ErrorKind::NetworkUnreachable => "Network unreachable",
        ErrorKind::ConnectionReset | ErrorKind::ConnectionAborted => "Connection reset by peer",
        ErrorKind::UnexpectedEof => "Remote peer closed the connection unexpectedly",
        _ => {
            let msg = err.to_string();
            let lower = msg.to_lowercase();
            if lower.contains("failed to lookup address")
                || lower.contains("nodename nor servname")
                || lower.contains("no such host")
                || lower.contains("dns")
            {
                return format!("{context}: Host unreachable (DNS lookup failed)");
            }
            return format!("{context}: {msg}");
        }
    };
    format!("{context}: {detail}")
}

async fn connect_tcp(host: &str, port: u16) -> Result<TcpStream, String> {
    let addr = format_host_port(host, port);
    let stream = timeout(CONNECT_TIMEOUT, TcpStream::connect(&addr))
        .await
        .map_err(|_| format!("Connection timed out connecting to {addr}"))?
        .map_err(|e| classify_io_error(&format!("Failed to connect to {addr}"), &e))?;
    let _ = stream.set_nodelay(true);
    Ok(stream)
}

async fn read_tls_record(stream: &mut TcpStream) -> Result<(u8, Vec<u8>), String> {
    let mut hdr = [0u8; 5];
    stream
        .read_exact(&mut hdr)
        .await
        .map_err(|e| classify_io_error("Fake-TLS handshake read failed", &e))?;
    let rec_len = u16::from_be_bytes([hdr[3], hdr[4]]) as usize;
    if rec_len > MAX_TLS_RECORD_BYTES + 2048 {
        return Err(format!(
            "Fake-TLS handshake failed: oversized TLS record ({rec_len} bytes)"
        ));
    }
    let mut full = Vec::with_capacity(5 + rec_len);
    full.extend_from_slice(&hdr);
    full.resize(5 + rec_len, 0);
    stream
        .read_exact(&mut full[5..])
        .await
        .map_err(|e| classify_io_error("Fake-TLS handshake body read failed", &e))?;
    Ok((hdr[0], full))
}

async fn perform_fake_tls_handshake(
    stream: &mut TcpStream,
    secret_16: &[u8; 16],
    domain: &str,
) -> Result<(), String> {
    let (client_hello, client_random) =
        build_fake_tls_client_hello(secret_16, domain, current_unix_secs())?;
    stream
        .write_all(&client_hello)
        .await
        .map_err(|e| classify_io_error("Fake-TLS ClientHello write failed", &e))?;
    stream
        .flush()
        .await
        .map_err(|e| classify_io_error("Fake-TLS ClientHello flush failed", &e))?;

    let (t1, rec1) = read_tls_record(stream).await?;
    if t1 == 0x15 {
        return Err("Fake-TLS handshake rejected with TLS alert (check SNI domain or secret).".to_string());
    }
    if t1 != 0x16 || rec1.len() < 43 || rec1[5] != 0x02 {
        return Err("Fake-TLS handshake failed: proxy did not return a TLS ServerHello.".to_string());
    }

    let rec1_len = rec1.len();
    let mut full_greeting = rec1;

    // MTProxy Fake-TLS proxies send ChangeCipherSpec (0x14) + dummy AppData (0x17) right after ServerHello
    let (t2, rec2) = read_tls_record(stream).await?;
    full_greeting.extend_from_slice(&rec2);
    if t2 == 0x14 {
        let (t3, rec3) = read_tls_record(stream).await?;
        if t3 != 0x17 {
            return Err("Fake-TLS handshake failed: unexpected TLS record after ChangeCipherSpec.".to_string());
        }
        full_greeting.extend_from_slice(&rec3);
    } else if t2 != 0x17 {
        return Err("Fake-TLS handshake failed: unexpected server handshake sequence.".to_string());
    }

    verify_fake_tls_greeting_hmac(secret_16, &client_random, &full_greeting, rec1_len)
}

/// Builds a SOCKS5 RFC 1928 CONNECT request frame for either an IP literal or domain name.
pub(crate) fn build_socks5_connect_request(
    target_host: &str,
    target_port: u16,
) -> Result<Vec<u8>, String> {
    let mut req = Vec::with_capacity(target_host.len() + 8);
    req.extend_from_slice(&[0x05, 0x01, 0x00]);
    if let Ok(ip) = target_host.parse::<IpAddr>() {
        match ip {
            IpAddr::V4(v4) => {
                req.push(0x01);
                req.extend_from_slice(&v4.octets());
            }
            IpAddr::V6(v6) => {
                req.push(0x04);
                req.extend_from_slice(&v6.octets());
            }
        }
    } else {
        let host_bytes = target_host.as_bytes();
        if host_bytes.is_empty() || host_bytes.len() > 255 {
            return Err("Invalid target host for SOCKS5 CONNECT.".to_string());
        }
        req.push(0x03);
        req.push(host_bytes.len() as u8);
        req.extend_from_slice(host_bytes);
    }
    req.extend_from_slice(&target_port.to_be_bytes());
    Ok(req)
}

fn socks5_reply_error(code: u8) -> String {
    let reason = match code {
        0x01 => "general SOCKS server failure",
        0x02 => "connection not allowed by proxy ruleset",
        0x03 => "network unreachable",
        0x04 => "host unreachable",
        0x05 => "connection refused by target server",
        0x06 => "TTL expired",
        0x07 => "command not supported by proxy",
        0x08 => "address type not supported by proxy",
        _ => "unknown SOCKS5 error",
    };
    format!("SOCKS5 proxy error (0x{code:02x}): {reason}")
}

async fn perform_socks5_handshake(
    stream: &mut TcpStream,
    username: &str,
    password: &str,
    target_host: &str,
    target_port: u16,
) -> Result<(), String> {
    let has_creds = !username.is_empty() || !password.is_empty();
    let methods: &[u8] = if has_creds { &[0x05, 0x02, 0x00, 0x02] } else { &[0x05, 0x01, 0x00] };

    stream
        .write_all(methods)
        .await
        .map_err(|e| classify_io_error("SOCKS5 greeting write failed", &e))?;

    let mut method_sel = [0u8; 2];
    stream
        .read_exact(&mut method_sel)
        .await
        .map_err(|e| classify_io_error("SOCKS5 greeting read failed", &e))?;
    if method_sel[0] != 0x05 {
        return Err("Proxy is not a valid SOCKS5 server.".to_string());
    }

    match method_sel[1] {
        0x00 => {}
        0x02 => {
            if !has_creds {
                return Err("SOCKS5 proxy requires username and password.".to_string());
            }
            let u_bytes = username.as_bytes();
            let p_bytes = password.as_bytes();
            if u_bytes.len() > 255 || p_bytes.len() > 255 {
                return Err("SOCKS5 username or password exceeds 255 bytes.".to_string());
            }
            let mut auth = Vec::with_capacity(3 + u_bytes.len() + p_bytes.len());
            auth.push(0x01);
            auth.push(u_bytes.len() as u8);
            auth.extend_from_slice(u_bytes);
            auth.push(p_bytes.len() as u8);
            auth.extend_from_slice(p_bytes);
            stream
                .write_all(&auth)
                .await
                .map_err(|e| classify_io_error("SOCKS5 auth write failed", &e))?;

            let mut auth_resp = [0u8; 2];
            stream
                .read_exact(&mut auth_resp)
                .await
                .map_err(|e| classify_io_error("SOCKS5 auth read failed", &e))?;
            if auth_resp[1] != 0x00 {
                return Err("SOCKS5 authentication failed (invalid username or password).".to_string());
            }
        }
        0xff => {
            return Err("SOCKS5 proxy rejected authentication methods.".to_string());
        }
        other => {
            return Err(format!(
                "SOCKS5 proxy requested unsupported authentication method (0x{other:02x})."
            ));
        }
    }

    let req = build_socks5_connect_request(target_host, target_port)?;
    stream
        .write_all(&req)
        .await
        .map_err(|e| classify_io_error("SOCKS5 CONNECT write failed", &e))?;
    stream
        .flush()
        .await
        .map_err(|e| classify_io_error("SOCKS5 CONNECT flush failed", &e))?;

    let mut hdr = [0u8; 4];
    stream
        .read_exact(&mut hdr)
        .await
        .map_err(|e| classify_io_error("SOCKS5 CONNECT reply failed", &e))?;
    if hdr[0] != 0x05 {
        return Err("Invalid SOCKS5 CONNECT response version.".to_string());
    }
    if hdr[1] != 0x00 {
        return Err(socks5_reply_error(hdr[1]));
    }

    // Consume bound address + port based on ATYP
    match hdr[3] {
        0x01 => {
            let mut skip = [0u8; 6];
            stream
                .read_exact(&mut skip)
                .await
                .map_err(|e| classify_io_error("SOCKS5 bound addr read failed", &e))?;
        }
        0x04 => {
            let mut skip = [0u8; 18];
            stream
                .read_exact(&mut skip)
                .await
                .map_err(|e| classify_io_error("SOCKS5 bound IPv6 read failed", &e))?;
        }
        0x03 => {
            let mut len_buf = [0u8; 1];
            stream
                .read_exact(&mut len_buf)
                .await
                .map_err(|e| classify_io_error("SOCKS5 bound domain len read failed", &e))?;
            let mut skip = vec![0u8; (len_buf[0] as usize) + 2];
            stream
                .read_exact(&mut skip)
                .await
                .map_err(|e| classify_io_error("SOCKS5 bound domain read failed", &e))?;
        }
        other => {
            return Err(format!("Invalid SOCKS5 ATYP byte 0x{other:02x}"));
        }
    }

    Ok(())
}

/// Parses an HTTP CONNECT response header block, returning leftover trailing bytes on `2xx`.
pub(crate) fn parse_http_connect_response(buf: &[u8]) -> Result<Vec<u8>, String> {
    let header_end = buf
        .windows(4)
        .position(|w| w == b"\r\n\r\n")
        .ok_or_else(|| "Incomplete HTTP CONNECT response headers.".to_string())?;
    let header_text = std::str::from_utf8(&buf[..header_end])
        .map_err(|_| "HTTP proxy returned non-UTF-8 response headers.".to_string())?;
    let status_line = header_text
        .lines()
        .next()
        .ok_or_else(|| "HTTP proxy returned empty response.".to_string())?;

    let mut parts = status_line.splitn(3, ' ');
    let version = parts.next().unwrap_or("");
    let code_str = parts.next().unwrap_or("");
    let reason = parts.next().unwrap_or("").trim();

    if !version.starts_with("HTTP/") {
        return Err(format!("Unexpected HTTP proxy response: {status_line}"));
    }
    let code: u16 = code_str
        .parse()
        .map_err(|_| format!("Invalid HTTP proxy status code: {status_line}"))?;

    if (200..300).contains(&code) {
        return Ok(buf[header_end + 4..].to_vec());
    }
    if code == 407 {
        return Err("HTTP proxy requires authentication (407 Proxy Authentication Required).".to_string());
    }
    Err(format!("HTTP proxy rejected CONNECT ({code} {reason})."))
}

async fn perform_http_connect_handshake(
    stream: &mut TcpStream,
    username: &str,
    password: &str,
    target_host: &str,
    target_port: u16,
) -> Result<Vec<u8>, String> {
    let authority = format_host_port(target_host, target_port);
    let mut req = format!(
        "CONNECT {authority} HTTP/1.1\r\nHost: {authority}\r\nProxy-Connection: Keep-Alive\r\n"
    );
    if !username.is_empty() || !password.is_empty() {
        let creds = format!("{username}:{password}");
        let encoded = encode_base64_standard(creds.as_bytes());
        req.push_str(&format!("Proxy-Authorization: Basic {encoded}\r\n"));
    }
    req.push_str("\r\n");

    stream
        .write_all(req.as_bytes())
        .await
        .map_err(|e| classify_io_error("HTTP CONNECT write failed", &e))?;
    stream
        .flush()
        .await
        .map_err(|e| classify_io_error("HTTP CONNECT flush failed", &e))?;

    let mut buf = Vec::with_capacity(512);
    let mut chunk = [0u8; 512];
    loop {
        let n = stream
            .read(&mut chunk)
            .await
            .map_err(|e| classify_io_error("HTTP CONNECT response read failed", &e))?;
        if n == 0 {
            return Err("HTTP proxy closed connection during CONNECT handshake.".to_string());
        }
        buf.extend_from_slice(&chunk[..n]);
        if buf.windows(4).any(|w| w == b"\r\n\r\n") {
            return parse_http_connect_response(&buf);
        }
        if buf.len() >= MAX_HTTP_HEADER_BYTES {
            return Err("HTTP proxy response headers exceeded 16 KiB limit.".to_string());
        }
    }
}

async fn connect_through_proxy(
    settings: &ProxySettings,
    target_host: &str,
    target_port: u16,
) -> Result<(ProxyReadStream, ProxyWriteStream, Option<[u8; 16]>), String> {
    validate_proxy_settings(settings)?;
    let mut tcp = connect_tcp(&settings.host, settings.port).await?;

    match settings.proxy_type {
        ProxyType::Mtproxy => {
            let parsed = parse_mtproxy_secret(&settings.secret)?;
            if let Some(domain) = parsed.fake_tls_domain.as_deref() {
                timeout(
                    HANDSHAKE_TIMEOUT,
                    perform_fake_tls_handshake(&mut tcp, &parsed.secret_16, domain),
                )
                .await
                .map_err(|_| "Fake-TLS handshake timed out.".to_string())??;

                let (reader, writer) = tokio::io::split(tcp);
                Ok((
                    ProxyReadStream::FakeTls {
                        reader,
                        buffered: Vec::new(),
                    },
                    ProxyWriteStream::FakeTls {
                        writer,
                        sent_ccs: false,
                    },
                    Some(parsed.secret_16),
                ))
            } else {
                let (reader, writer) = tokio::io::split(tcp);
                Ok((
                    ProxyReadStream::Plain {
                        reader,
                        buffered: Vec::new(),
                    },
                    ProxyWriteStream::Plain { writer },
                    Some(parsed.secret_16),
                ))
            }
        }
        ProxyType::Socks5 => {
            timeout(
                HANDSHAKE_TIMEOUT,
                perform_socks5_handshake(
                    &mut tcp,
                    &settings.username,
                    &settings.password,
                    target_host,
                    target_port,
                ),
            )
            .await
            .map_err(|_| "SOCKS5 handshake timed out.".to_string())??;

            let (reader, writer) = tokio::io::split(tcp);
            Ok((
                ProxyReadStream::Plain {
                    reader,
                    buffered: Vec::new(),
                },
                ProxyWriteStream::Plain { writer },
                None,
            ))
        }
        ProxyType::Http => {
            let leftover = timeout(
                HANDSHAKE_TIMEOUT,
                perform_http_connect_handshake(
                    &mut tcp,
                    &settings.username,
                    &settings.password,
                    target_host,
                    target_port,
                ),
            )
            .await
            .map_err(|_| "HTTP CONNECT handshake timed out.".to_string())??;

            let (reader, writer) = tokio::io::split(tcp);
            Ok((
                ProxyReadStream::Plain {
                    reader,
                    buffered: leftover,
                },
                ProxyWriteStream::Plain { writer },
                None,
            ))
        }
    }
}

/// Runs an end-to-end MTProto Obfuscated2 Abridged `req_pq_multi` -> `resPQ` reachability test.
async fn probe_telegram_mtproto(
    reader: &mut ProxyReadStream,
    writer: &mut ProxyWriteStream,
    mtproxy_secret: Option<[u8; 16]>,
) -> Result<(), String> {
    let mut header = [0u8; 64];
    loop {
        fill_random(&mut header)?;
        let first = header[0];
        let head4 = &header[0..4];
        if first != 0xef
            && header[4..8] != [0, 0, 0, 0]
            && head4 != b"PVrG"
            && head4 != b"GET "
            && head4 != b"POST"
            && head4 != [0xee, 0xee, 0xee, 0xee]
        {
            break;
        }
    }

    let mut reversed = header[8..56].to_vec();
    reversed.reverse();

    let (enc_key, dec_key) = if let Some(secret) = mtproxy_secret {
        let mut enc_in = Vec::with_capacity(48);
        enc_in.extend_from_slice(&header[8..40]);
        enc_in.extend_from_slice(&secret);
        let ek: [u8; 32] = Sha256::digest(&enc_in).into();

        let mut dec_in = Vec::with_capacity(48);
        dec_in.extend_from_slice(&reversed[0..32]);
        dec_in.extend_from_slice(&secret);
        let dk: [u8; 32] = Sha256::digest(&dec_in).into();
        (ek, dk)
    } else {
        let mut ek = [0u8; 32];
        ek.copy_from_slice(&header[8..40]);
        let mut dk = [0u8; 32];
        dk.copy_from_slice(&reversed[0..32]);
        (ek, dk)
    };

    let mut enc_iv = [0u8; 16];
    enc_iv.copy_from_slice(&header[40..56]);
    let mut dec_iv = [0u8; 16];
    dec_iv.copy_from_slice(&reversed[32..48]);

    let mut encryptor = Aes256Ctr::new(&enc_key.into(), &enc_iv.into());
    let mut decryptor = Aes256Ctr::new(&dec_key.into(), &dec_iv.into());

    // Abridged obfuscateTag = 0xefefefef, optional DC ID in bytes 60..62
    header[56..60].copy_from_slice(&[0xef, 0xef, 0xef, 0xef]);
    if mtproxy_secret.is_some() {
        header[60..62].copy_from_slice(&TELEGRAM_TEST_DC_ID.to_le_bytes());
    }

    let mut enc_header = header;
    encryptor.apply_keystream(&mut enc_header);
    header[56..64].copy_from_slice(&enc_header[56..64]);

    // Construct unencrypted MTProto req_pq_multi#be7e8ef1 wrapped in Abridged frame
    let mut nonce = [0u8; 16];
    fill_random(&mut nonce)?;
    let msg_id = ((current_unix_secs() as u64) << 32) | 0x0000_0004;

    let mut mtproto_msg = Vec::with_capacity(40);
    mtproto_msg.extend_from_slice(&0u64.to_le_bytes()); // auth_key_id = 0
    mtproto_msg.extend_from_slice(&msg_id.to_le_bytes());
    mtproto_msg.extend_from_slice(&20u32.to_le_bytes()); // payload len
    mtproto_msg.extend_from_slice(&0xbe7e_8ef1u32.to_le_bytes()); // req_pq_multi
    mtproto_msg.extend_from_slice(&nonce);

    let mut abridged = Vec::with_capacity(41);
    abridged.push((mtproto_msg.len() >> 2) as u8);
    abridged.extend_from_slice(&mtproto_msg);
    encryptor.apply_keystream(&mut abridged);

    let mut wire = Vec::with_capacity(header.len() + abridged.len());
    wire.extend_from_slice(&header);
    wire.extend_from_slice(&abridged);
    writer.write_all_and_flush(&wire).await?;

    // Read and decrypt Abridged response length
    let mut len_byte = [0u8; 1];
    reader.read_exact(&mut len_byte).await?;
    decryptor.apply_keystream(&mut len_byte);

    let word_len: usize = if len_byte[0] < 0x7f {
        len_byte[0] as usize
    } else {
        let mut ext = [0u8; 3];
        reader.read_exact(&mut ext).await?;
        decryptor.apply_keystream(&mut ext);
        u32::from_le_bytes([ext[0], ext[1], ext[2], 0]) as usize
    };
    let byte_len = word_len * 4;
    if byte_len < 40 || byte_len > 4096 {
        return Err("Unexpected MTProto handshake response length from Telegram DC.".to_string());
    }

    let mut resp = vec![0u8; byte_len];
    reader.read_exact(&mut resp).await?;
    decryptor.apply_keystream(&mut resp);

    // resPQ#05162463 starts at offset 20 (after auth_key_id[8] + msg_id[8] + len[4])
    // followed by our exact 16-byte nonce at offset 24..40
    if &resp[20..24] != &0x0516_2463u32.to_le_bytes() || &resp[24..40] != &nonce {
        return Err("Telegram MTProto handshake verification failed (unexpected resPQ nonce).".to_string());
    }

    Ok(())
}

/// Returns the saved proxy configuration from disk (or disabled defaults if unset).
#[tauri::command]
pub fn get_proxy_settings(app: AppHandle) -> Result<ProxySettings, String> {
    let path = settings_path(&app)?;
    Ok(load_from_path(&path))
}

/// Validates (when enabled) and persists proxy settings atomically with `0600` permissions.
#[tauri::command]
pub fn save_proxy_settings(app: AppHandle, settings: ProxySettings) -> Result<ProxySettings, String> {
    let cleaned = sanitize_settings(&settings);
    if cleaned.enabled {
        validate_proxy_settings(&cleaned)?;
    }
    let path = settings_path(&app)?;
    save_to_path(&path, &cleaned)?;
    Ok(cleaned)
}

/// Actively tests proxy connectivity and Telegram MTProto reachability (`req_pq_multi`).
#[tauri::command]
pub async fn test_proxy_connection(settings: ProxySettings) -> TestProxyResult {
    let cleaned = sanitize_settings(&settings);
    let started = Instant::now();

    let (mut reader, mut writer, mtproxy_secret) =
        match connect_through_proxy(&cleaned, TELEGRAM_TEST_DC_IP, TELEGRAM_TEST_DC_PORT).await {
            Ok(parts) => parts,
            Err(message) => {
                return TestProxyResult {
                    ok: false,
                    latency_ms: started.elapsed().as_millis() as u64,
                    message,
                };
            }
        };

    let probe_res = timeout(
        HANDSHAKE_TIMEOUT,
        probe_telegram_mtproto(&mut reader, &mut writer, mtproxy_secret),
    )
    .await;
    writer.shutdown().await;

    let latency_ms = started.elapsed().as_millis() as u64;
    match probe_res {
        Ok(Ok(())) => TestProxyResult {
            ok: true,
            latency_ms,
            message: format!("Connected to Telegram via proxy ({latency_ms} ms)"),
        },
        Ok(Err(message)) => TestProxyResult {
            ok: false,
            latency_ms,
            message,
        },
        Err(_) => TestProxyResult {
            ok: false,
            latency_ms,
            message: "MTProto handshake timed out waiting for Telegram response.".to_string(),
        },
    }
}

/// Opens a managed TCP/proxy tunnel for GramJS and streams incoming bytes over a raw Tauri Channel.
#[tauri::command]
pub async fn proxy_socket_connect(
    state: tauri::State<'_, ProxySocketState>,
    settings: ProxySettings,
    target_host: String,
    target_port: u16,
    on_data: Channel<InvokeResponseBody>,
    on_status: Channel<SocketStatusEvent>,
) -> Result<u64, String> {
    let cleaned = sanitize_settings(&settings);
    let (mut reader, writer, _) =
        connect_through_proxy(&cleaned, target_host.trim(), target_port).await?;

    let socket_id = state.next_id.fetch_add(1, Ordering::Relaxed);
    let writer_arc = Arc::new(AsyncMutex::new(Some(writer)));
    let sockets_ref = &state.sockets;

    let reader_handle = tauri::async_runtime::spawn(async move {
        let mut buf = vec![0u8; READ_BUFFER_BYTES];
        loop {
            match reader.read_chunk(&mut buf).await {
                Ok(0) => {
                    let _ = on_status.send(SocketStatusEvent::Closed);
                    break;
                }
                Ok(n) => {
                    if on_data.send(InvokeResponseBody::Raw(buf[..n].to_vec())).is_err() {
                        break;
                    }
                }
                Err(message) => {
                    let _ = on_status.send(SocketStatusEvent::Error { message });
                    break;
                }
            }
        }
    });

    let entry = Arc::new(SocketEntry {
        writer: writer_arc,
        reader_handle,
    });
    if let Ok(mut map) = sockets_ref.lock() {
        map.insert(socket_id, entry);
    }

    Ok(socket_id)
}

/// Writes binary bytes to an open managed proxy socket without JSON base64 overhead.
#[tauri::command]
pub async fn proxy_socket_write(
    state: tauri::State<'_, ProxySocketState>,
    request: Request<'_>,
) -> Result<(), String> {
    let socket_id: u64 = request
        .headers()
        .get("x-socket-id")
        .and_then(|v| v.to_str().ok())
        .and_then(|s| s.parse().ok())
        .ok_or_else(|| "Missing or invalid x-socket-id header.".to_string())?;

    let bytes: Vec<u8> = match request.body() {
        InvokeBody::Raw(raw) => raw.clone(),
        InvokeBody::Json(_) => return Err("Expected raw binary payload for proxy_socket_write.".to_string()),
    };

    if bytes.is_empty() {
        return Ok(());
    }

    let entry = {
        let map = state
            .sockets
            .lock()
            .map_err(|_| "Proxy socket state lock poisoned.".to_string())?;
        map.get(&socket_id).cloned()
    }
    .ok_or_else(|| format!("Proxy socket {socket_id} is closed."))?;

    let mut guard = entry.writer.lock().await;
    let Some(writer) = guard.as_mut() else {
        return Err(format!("Proxy socket {socket_id} has been closed."));
    };
    writer.write_all_and_flush(&bytes).await
}

/// Closes and cleans up a managed proxy socket.
#[tauri::command]
pub async fn proxy_socket_close(
    state: tauri::State<'_, ProxySocketState>,
    socket_id: u64,
) -> Result<(), String> {
    let entry = {
        let Ok(mut map) = state.sockets.lock() else {
            return Ok(());
        };
        map.remove(&socket_id)
    };
    if let Some(entry) = entry {
        let mut guard = entry.writer.lock().await;
        if let Some(mut writer) = guard.take() {
            writer.shutdown().await;
        }
        entry.reader_handle.abort();
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_proxy_settings_are_disabled() {
        let defaults = ProxySettings::default();
        assert!(!defaults.enabled);
        assert_eq!(defaults.proxy_type, ProxyType::Mtproxy);
        assert_eq!(defaults.port, 443);
        assert!(defaults.host.is_empty());
        assert!(defaults.secret.is_empty());
    }

    #[test]
    fn corrupt_or_missing_config_falls_back_to_defaults() {
        let tmp = std::env::temp_dir().join("teledrive_proxy_corrupt_test.json");
        let _ = std::fs::remove_file(&tmp);
        assert_eq!(load_from_path(&tmp), ProxySettings::default());

        std::fs::write(&tmp, "{not valid json").expect("write corrupt file");
        assert_eq!(load_from_path(&tmp), ProxySettings::default());
        let _ = std::fs::remove_file(&tmp);
    }

    #[test]
    fn settings_roundtrip_persistence() {
        let tmp = std::env::temp_dir().join("teledrive_proxy_roundtrip_test.json");
        let _ = std::fs::remove_file(&tmp);

        let expected = ProxySettings {
            enabled: true,
            proxy_type: ProxyType::Socks5,
            host: "127.0.0.1".to_string(),
            port: 1080,
            secret: String::new(),
            username: "alice".to_string(),
            password: "s3cr3t".to_string(),
        };
        save_to_path(&tmp, &expected).expect("save succeeds");
        let loaded = load_from_path(&tmp);
        assert_eq!(loaded, expected);
        let _ = std::fs::remove_file(&tmp);
    }

    #[test]
    fn parses_mtproxy_standard_dd_and_fake_tls_secrets() {
        let std_hex = "0123456789abcdef0123456789abcdef";
        let std_parsed = parse_mtproxy_secret(std_hex).expect("standard 16B hex");
        assert!(!std_parsed.padded);
        assert_eq!(std_parsed.fake_tls_domain, None);
        assert_eq!(std_parsed.secret_16[0], 0x01);

        let dd_hex = "dd0123456789abcdef0123456789abcdef";
        let dd_parsed = parse_mtproxy_secret(dd_hex).expect("dd 17B hex");
        assert!(dd_parsed.padded);
        assert_eq!(dd_parsed.fake_tls_domain, None);

        // ee + 16B secret + "cloudflare.com" (636c6f7564666c6172652e636f6d)
        let ee_hex = "ee0123456789abcdef0123456789abcdef636c6f7564666c6172652e636f6d";
        let ee_parsed = parse_mtproxy_secret(ee_hex).expect("ee Fake-TLS hex");
        assert!(ee_parsed.padded);
        assert_eq!(ee_parsed.fake_tls_domain.as_deref(), Some("cloudflare.com"));

        // Base64url encoding of the same Fake-TLS secret
        let raw_ee = decode_hex(ee_hex).unwrap();
        let b64 = encode_base64_standard(&raw_ee)
            .replace('+', "-")
            .replace('/', "_")
            .trim_end_matches('=')
            .to_string();
        let b64_parsed = parse_mtproxy_secret(&b64).expect("ee Fake-TLS base64url");
        assert_eq!(b64_parsed, ee_parsed);

        assert!(parse_mtproxy_secret("short").is_err());
        assert!(parse_mtproxy_secret("ee0123456789abcdef0123456789abcdef").is_err());
    }

    #[test]
    fn hmac_sha256_matches_rfc4231_vector_1() {
        let key = [0x0bu8; 20];
        let data = b"Hi There";
        let got = hmac_sha256(&key, data);
        let expected = decode_hex(
            "b0344c61d8db38535ca8afceaf0bf12b881dc200c9833da726e9376c2e32cff7",
        )
        .unwrap();
        assert_eq!(got.as_slice(), expected.as_slice());
    }

    #[test]
    fn fake_tls_client_hello_contains_valid_hmac_timestamp() {
        let secret = [0x42u8; 16];
        let ts = 1_700_000_123u32;
        let (pkt, random) = build_fake_tls_client_hello(&secret, "google.com", ts).unwrap();
        assert_eq!(pkt[0], 0x16);
        assert_eq!(pkt.len(), 517);

        let mut zeroed = pkt.clone();
        zeroed[11..43].fill(0);
        let expected_mac = hmac_sha256(&secret, &zeroed);
        assert_eq!(&random[0..28], &expected_mac[0..28]);
        let recovered_ts = u32::from_le_bytes([
            random[28] ^ expected_mac[28],
            random[29] ^ expected_mac[29],
            random[30] ^ expected_mac[30],
            random[31] ^ expected_mac[31],
        ]);
        assert_eq!(recovered_ts, ts);
    }

    #[test]
    fn http_connect_parser_handles_success_auth_and_trailing_bytes() {
        let ok_resp = b"HTTP/1.1 200 Connection Established\r\nProxy-Agent: test\r\n\r\nextra";
        let leftover = parse_http_connect_response(ok_resp).expect("200 ok");
        assert_eq!(leftover, b"extra");

        let auth_resp = b"HTTP/1.1 407 Proxy Authentication Required\r\n\r\n";
        let err = parse_http_connect_response(auth_resp).unwrap_err();
        assert!(err.contains("407"));
    }

    #[test]
    fn socks5_request_builder_handles_ipv4_ipv6_and_domain() {
        let v4 = build_socks5_connect_request("149.154.167.91", 443).unwrap();
        assert_eq!(v4, vec![0x05, 0x01, 0x00, 0x01, 149, 154, 167, 91, 0x01, 0xbb]);

        let dom = build_socks5_connect_request("proxy.example.com", 8443).unwrap();
        assert_eq!(dom[3], 0x03);
        assert_eq!(dom[4] as usize, "proxy.example.com".len());
    }
}
