//! Opt-in loopback WebDAV endpoint.
//!
//! The socket lives in Rust because the app needs a stable local HTTP server
//! while the webview is alive. It intentionally contains **no Telegram code**:
//! every request that needs the virtual drive is bridged to the TypeScript
//! catalog via a Tauri event (`teledrive://webdav-request`) and answered with
//! the `webdav_bridge_response` command. Rust keeps a map of pending request
//! ids to one-shot channels, so the TS side never has to hold the socket.
//!
//! Large payloads never cross the IPC boundary: request bodies are streamed
//! into temp files under `<app data>/webdav_tmp`, and GET/HEAD responses are
//! served from a temp file the TS side materialises through the existing
//! pipelined downloader.
//!
//! Security defaults:
//! - binds `127.0.0.1` only (never `0.0.0.0`),
//! - HTTP Basic auth on every request, compared in constant time,
//! - rejects any request carrying an `Origin` header (a browser page cannot
//!   be tricked into driving the mount) and any non-loopback `Host`,
//! - never logs credentials, bodies, or file contents.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs::File;
use std::io::{BufRead, BufReader, Read, Write};
use std::net::{TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, AtomicUsize, Ordering};
use std::sync::{mpsc, Arc, Mutex};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter, Manager, State};

pub const DEFAULT_PORT: u16 = 8747;
pub const DEFAULT_USERNAME: &str = "teledrive";
pub const EVENT_REQUEST: &str = "teledrive://webdav-request";

const SETTINGS_FILE: &str = "webdav_settings.json";
const TEMP_DIR_NAME: &str = "webdav_tmp";
const MAX_HEADER_BYTES: usize = 64 * 1024;
const MAX_SMALL_BODY: usize = 4 * 1024 * 1024;
const MAX_CONNECTIONS: usize = 64;
const BRIDGE_TIMEOUT: Duration = Duration::from_secs(1800);
const HEADER_TIMEOUT: Duration = Duration::from_secs(30);
const BODY_TIMEOUT: Duration = Duration::from_secs(1800);

const ALLOW_METHODS: &str =
    "OPTIONS, GET, HEAD, PUT, DELETE, MKCOL, MOVE, COPY, PROPFIND, PROPPATCH, LOCK, UNLOCK";

/// Diagnostics go to stderr only. Never pass credentials, client-controlled
/// paths, or file contents to this helper.
fn webdav_log(message: &str) {
    eprintln!("[teledrive-webdav] {message}");
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct WebdavSettings {
    pub enabled: bool,
    pub port: u16,
    pub username: String,
    pub password: String,
}

impl Default for WebdavSettings {
    fn default() -> Self {
        Self {
            enabled: false,
            port: DEFAULT_PORT,
            username: DEFAULT_USERNAME.to_string(),
            password: String::new(),
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WebdavStatus {
    pub enabled: bool,
    pub running: bool,
    pub port: u16,
    pub username: String,
    pub password: String,
    pub url: String,
    pub error: Option<String>,
}

fn settings_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to resolve app data dir: {e}"))?;
    Ok(dir.join(SETTINGS_FILE))
}

pub(crate) fn load_settings_from_path(path: &Path) -> WebdavSettings {
    let Ok(contents) = std::fs::read_to_string(path) else {
        return WebdavSettings::default();
    };
    match serde_json::from_str::<WebdavSettings>(&contents) {
        Ok(settings) => normalize_settings(settings),
        Err(_) => WebdavSettings::default(),
    }
}

pub(crate) fn save_settings_to_path(path: &Path, settings: &WebdavSettings) -> Result<(), String> {
    let payload = serde_json::to_vec_pretty(settings)
        .map_err(|e| format!("Failed to serialize WebDAV settings: {e}"))?;
    crate::atomic_write_with_perms(path, &payload, true)
}

fn normalize_settings(mut settings: WebdavSettings) -> WebdavSettings {
    if settings.port == 0 {
        settings.port = DEFAULT_PORT;
    }
    settings.username = settings.username.trim().to_string();
    if settings.username.is_empty() {
        settings.username = DEFAULT_USERNAME.to_string();
    }
    settings
}

fn generate_password() -> String {
    // 24 characters from an unambiguous alphabet (~143 bits of entropy).
    const ALPHABET: &[u8] = b"ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
    let mut bytes = [0u8; 24];
    if getrandom::getrandom(&mut bytes).is_err() {
        // getrandom failing is catastrophic for security; never fall back to
        // a predictable password. Callers surface the empty password and the
        // UI asks the user to set one.
        return String::new();
    }
    bytes
        .iter()
        .map(|b| ALPHABET[(*b as usize) % ALPHABET.len()] as char)
        .collect()
}

// ---------------------------------------------------------------------------
// Bridge contract (Rust <-> TypeScript)
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BridgeRequest {
    pub method: String,
    /// Percent-decoded, normalized virtual path starting with `/`.
    pub path: String,
    pub depth: Option<String>,
    pub destination: Option<String>,
    pub overwrite: Option<String>,
    pub lock_token: Option<String>,
    pub if_header: Option<String>,
    pub timeout: Option<String>,
    pub range: Option<String>,
    pub content_type: Option<String>,
    pub content_length: Option<u64>,
    /// Temp file containing the request body (PUT only).
    pub body_path: Option<String>,
    /// Temp path the bridge must write the response bytes to (GET only).
    pub output_path: Option<String>,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BridgeResponse {
    #[serde(default)]
    pub status: u16,
    #[serde(default)]
    pub headers: HashMap<String, String>,
    #[serde(default)]
    pub body: Option<String>,
    #[serde(default)]
    pub body_path: Option<String>,
}

pub trait WebdavBridge: Send + Sync + 'static {
    fn handle(&self, request: &BridgeRequest) -> BridgeResponse;
}

impl<F> WebdavBridge for F
where
    F: Fn(&BridgeRequest) -> BridgeResponse + Send + Sync + 'static,
{
    fn handle(&self, request: &BridgeRequest) -> BridgeResponse {
        self(request)
    }
}

#[derive(Clone, Serialize)]
struct BridgeEvent<'a> {
    id: u64,
    #[serde(flatten)]
    request: &'a BridgeRequest,
}

struct EventBridge {
    app: AppHandle,
    pending: Arc<Mutex<HashMap<u64, mpsc::Sender<BridgeResponse>>>>,
    next_id: Arc<AtomicU64>,
}

impl WebdavBridge for EventBridge {
    fn handle(&self, request: &BridgeRequest) -> BridgeResponse {
        let id = self.next_id.fetch_add(1, Ordering::Relaxed);
        let (tx, rx) = mpsc::channel();
        if let Ok(mut pending) = self.pending.lock() {
            pending.insert(id, tx);
        } else {
            return failure(500);
        }

        let payload = BridgeEvent { id, request };
        if let Err(err) = self.app.emit(EVENT_REQUEST, payload) {
            if let Ok(mut pending) = self.pending.lock() {
                pending.remove(&id);
            }
            webdav_log(&format!("event emit failed: {err}"));
            return failure(503);
        }

        match rx.recv_timeout(BRIDGE_TIMEOUT) {
            Ok(response) => response,
            Err(_) => {
                if let Ok(mut pending) = self.pending.lock() {
                    pending.remove(&id);
                }
                webdav_log("bridge response timed out");
                failure(504)
            }
        }
    }
}

fn failure(status: u16) -> BridgeResponse {
    BridgeResponse {
        status,
        ..BridgeResponse::default()
    }
}

// ---------------------------------------------------------------------------
// Managed state + Tauri commands
// ---------------------------------------------------------------------------

pub struct RunningServer {
    pub port: u16,
    stop: Arc<AtomicBool>,
    done: Option<mpsc::Receiver<()>>,
}

impl RunningServer {
    fn stop(mut self) {
        self.stop.store(true, Ordering::SeqCst);
        // Wake the blocking accept() so the listener thread can drop the
        // socket promptly. A failed connect is fine: the thread is already out.
        let _ = TcpStream::connect(("127.0.0.1", self.port));
        if let Some(done) = self.done.take() {
            let _ = done.recv_timeout(Duration::from_secs(3));
        }
    }
}

#[derive(Default)]
struct WebdavInner {
    settings: WebdavSettings,
    running: Option<RunningServer>,
    error: Option<String>,
    /// Set once the webview registered its request listener. Starting the
    /// socket earlier would emit events into the void and hang the first
    /// client until the bridge timeout.
    bridge_ready: bool,
}

pub struct WebdavState {
    inner: Mutex<WebdavInner>,
    pending: Arc<Mutex<HashMap<u64, mpsc::Sender<BridgeResponse>>>>,
    next_id: Arc<AtomicU64>,
}

impl Default for WebdavState {
    fn default() -> Self {
        Self {
            inner: Mutex::new(WebdavInner::default()),
            pending: Arc::new(Mutex::new(HashMap::new())),
            next_id: Arc::new(AtomicU64::new(1)),
        }
    }
}

fn snapshot(state: &WebdavState) -> WebdavStatus {
    let inner = match state.inner.lock() {
        Ok(guard) => guard,
        Err(poisoned) => poisoned.into_inner(),
    };
    let running = inner.running.as_ref().map(|s| s.port);
    WebdavStatus {
        enabled: inner.settings.enabled,
        running: running.is_some(),
        port: inner.settings.port,
        username: inner.settings.username.clone(),
        password: inner.settings.password.clone(),
        url: running
            .map(|port| format!("http://127.0.0.1:{port}/"))
            .unwrap_or_default(),
        error: inner.error.clone(),
    }
}

fn webdav_temp_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to resolve app data dir: {e}"))?
        .join(TEMP_DIR_NAME);
    std::fs::create_dir_all(&dir)
        .map_err(|e| format!("Failed to create WebDAV temp dir: {e}"))?;
    Ok(dir)
}

fn clear_temp_dir(dir: &Path) {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        if entry.file_type().map(|t| t.is_file()).unwrap_or(false) {
            let _ = std::fs::remove_file(entry.path());
        }
    }
}

/// (Re)starts the server for `settings`. Returns the start error, if any.
fn apply_settings(
    app: &AppHandle,
    state: &WebdavState,
    settings: WebdavSettings,
) -> Result<Option<String>, String> {
    let mut inner = state
        .inner
        .lock()
        .map_err(|_| "WebDAV state lock poisoned".to_string())?;

    if let Some(server) = inner.running.take() {
        server.stop();
    }

    inner.settings = settings.clone();
    inner.error = None;

    if settings.enabled && !inner.bridge_ready {
        // Settings are persisted; the listener is started once the webview
        // announces it is ready to answer bridge requests.
        return Ok(None);
    }

    if settings.enabled {
        let temp_dir = webdav_temp_dir(app)?;
        clear_temp_dir(&temp_dir);
        let bridge = Arc::new(EventBridge {
            app: app.clone(),
            pending: state.pending.clone(),
            next_id: state.next_id.clone(),
        });
        match start_server(
            ServerConfig {
                port: settings.port,
                username: settings.username.clone(),
                password: settings.password.clone(),
            },
            temp_dir,
            bridge,
        ) {
            Ok(server) => inner.running = Some(server),
            Err(err) => inner.error = Some(err),
        }
    }

    Ok(inner.error.clone())
}

/// Loads persisted settings during Tauri `.setup()`. The socket is only
/// started after the webview calls `webdav_bridge_ready`, because events
/// emitted before a listener exists are dropped.
pub fn initialize(app: &AppHandle) {
    let state = app.state::<WebdavState>();
    let mut settings = match settings_path(app) {
        Ok(path) => load_settings_from_path(&path),
        Err(_) => WebdavSettings::default(),
    };
    // A hand-edited or legacy file must never expose an empty Basic-auth
    // password; mint one before the socket can start.
    if settings.enabled && settings.password.is_empty() {
        settings.password = generate_password();
        if let (Ok(path), false) = (settings_path(app), settings.password.is_empty()) {
            let _ = save_settings_to_path(&path, &settings);
        }
    }
    if let Ok(mut inner) = state.inner.lock() {
        inner.settings = settings;
    };
}

/// Starts the configured server once the frontend bridge is listening.
pub fn mark_bridge_ready(app: &AppHandle, state: &WebdavState) -> Result<Option<String>, String> {
    let mut inner = state
        .inner
        .lock()
        .map_err(|_| "WebDAV state lock poisoned".to_string())?;
    inner.bridge_ready = true;
    let settings = inner.settings.clone();
    drop(inner);
    apply_settings(app, state, settings)
}

/// Stops the listener on app exit.
pub fn shutdown(app: &AppHandle) {
    let state = app.state::<WebdavState>();
    let mut inner = match state.inner.lock() {
        Ok(guard) => guard,
        Err(poisoned) => poisoned.into_inner(),
    };
    if let Some(server) = inner.running.take() {
        server.stop();
    }
}

#[tauri::command]
pub async fn webdav_bridge_ready(
    app: AppHandle,
    state: State<'_, WebdavState>,
) -> Result<WebdavStatus, String> {
    mark_bridge_ready(&app, &state)?;
    Ok(snapshot(&state))
}

#[tauri::command]
pub async fn get_webdav_settings(state: State<'_, WebdavState>) -> Result<WebdavStatus, String> {
    Ok(snapshot(&state))
}

#[tauri::command]
pub async fn set_webdav_settings(
    app: AppHandle,
    state: State<'_, WebdavState>,
    enabled: bool,
    port: u16,
    username: String,
    password: String,
) -> Result<WebdavStatus, String> {
    if port == 0 {
        return Err("WebDAV port must be between 1 and 65535".to_string());
    }

    let mut settings = WebdavSettings {
        enabled,
        port,
        username,
        password,
    };
    settings = normalize_settings(settings);
    if settings.enabled && settings.password.is_empty() {
        settings.password = generate_password();
        if settings.password.is_empty() {
            return Err("Failed to generate a secure WebDAV password".to_string());
        }
    }

    if let Ok(path) = settings_path(&app) {
        save_settings_to_path(&path, &settings)?;
    }
    let error = apply_settings(&app, &state, settings)?;
    if let Some(err) = error {
        webdav_log(&format!("start failed: {err}"));
    }
    Ok(snapshot(&state))
}

#[tauri::command]
pub async fn regenerate_webdav_password(
    app: AppHandle,
    state: State<'_, WebdavState>,
) -> Result<WebdavStatus, String> {
    let (enabled, port, username) = {
        let inner = state
            .inner
            .lock()
            .map_err(|_| "WebDAV state lock poisoned".to_string())?;
        (
            inner.settings.enabled,
            inner.settings.port,
            inner.settings.username.clone(),
        )
    };
    let password = generate_password();
    if password.is_empty() {
        return Err("Failed to generate a secure WebDAV password".to_string());
    }
    let settings = WebdavSettings {
        enabled,
        port,
        username,
        password,
    };
    if let Ok(path) = settings_path(&app) {
        save_settings_to_path(&path, &settings)?;
    }
    apply_settings(&app, &state, settings)?;
    Ok(snapshot(&state))
}

#[tauri::command]
pub fn webdav_bridge_response(
    state: State<'_, WebdavState>,
    id: u64,
    response: serde_json::Value,
) -> Result<(), String> {
    let parsed: BridgeResponse = serde_json::from_value(response)
        .map_err(|e| format!("Invalid WebDAV bridge response: {e}"))?;
    let sender = {
        let mut pending = state
            .pending
            .lock()
            .map_err(|_| "WebDAV pending map poisoned".to_string())?;
        pending.remove(&id)
    };
    match sender {
        Some(tx) => tx
            .send(parsed)
            .map_err(|_| "WebDAV request already finished".to_string()),
        None => Err(format!("Unknown WebDAV request id {id}")),
    }
}

// ---------------------------------------------------------------------------
// HTTP server
// ---------------------------------------------------------------------------

#[derive(Clone, Debug)]
pub struct ServerConfig {
    pub port: u16,
    pub username: String,
    pub password: String,
}

pub fn start_server(
    config: ServerConfig,
    temp_dir: PathBuf,
    bridge: Arc<dyn WebdavBridge>,
) -> Result<RunningServer, String> {
    let listener = TcpListener::bind(("127.0.0.1", config.port))
        .map_err(|e| format!("Failed to bind 127.0.0.1:{}: {e}", config.port))?;
    let port = listener
        .local_addr()
        .map_err(|e| format!("Failed to read WebDAV listener address: {e}"))?
        .port();

    let stop = Arc::new(AtomicBool::new(false));
    let (done_tx, done_rx) = mpsc::channel();
    let accept_stop = stop.clone();
    let active = Arc::new(AtomicUsize::new(0));
    let config = Arc::new(config);
    let bridge: Arc<dyn WebdavBridge> = bridge;
    let temp_dir = Arc::new(temp_dir);

    std::thread::Builder::new()
        .name("teledrive-webdav".to_string())
        .spawn(move || {
            for incoming in listener.incoming() {
                if accept_stop.load(Ordering::SeqCst) {
                    break;
                }
                let stream = match incoming {
                    Ok(stream) => stream,
                    Err(_) => break,
                };
                if active.load(Ordering::SeqCst) >= MAX_CONNECTIONS {
                    let mut stream = stream;
                    let _ = write_simple_response(
                        &mut stream,
                        503,
                        "Service Unavailable",
                        &[("Retry-After".to_string(), "1".to_string())],
                        b"",
                        false,
                    );
                    continue;
                }
                active.fetch_add(1, Ordering::SeqCst);
                let active = active.clone();
                let config = config.clone();
                let bridge = bridge.clone();
                let temp_dir = temp_dir.clone();
                let stop = accept_stop.clone();
                let _ = std::thread::Builder::new()
                    .name("teledrive-webdav-conn".to_string())
                    .spawn(move || {
                        let mut stream = stream;
                        handle_connection(&mut stream, &config, bridge.as_ref(), &temp_dir, &stop);
                        active.fetch_sub(1, Ordering::SeqCst);
                    });
            }
            drop(listener);
            let _ = done_tx.send(());
        })
        .map_err(|e| format!("Failed to start WebDAV thread: {e}"))?;

    Ok(RunningServer {
        port,
        stop,
        done: Some(done_rx),
    })
}

fn handle_connection(
    stream: &mut TcpStream,
    config: &ServerConfig,
    bridge: &dyn WebdavBridge,
    temp_dir: &Path,
    stop: &AtomicBool,
) {
    let _ = stream.set_read_timeout(Some(HEADER_TIMEOUT));
    let _ = stream.set_write_timeout(Some(BODY_TIMEOUT));
    let _ = stream.set_nodelay(true);

    let reader_stream = match stream.try_clone() {
        Ok(clone) => clone,
        Err(_) => return,
    };
    let mut reader = BufReader::new(reader_stream);

    let head = match read_head(&mut reader) {
        Ok(head) => head,
        Err(status) => {
            let _ = write_simple_response(
                stream,
                status,
                status_text(status),
                &[],
                status_message(status).as_bytes(),
                false,
            );
            return;
        }
    };

    let request_line = match head.first() {
        Some(line) => line.as_str(),
        None => {
            let _ = write_simple_response(stream, 400, "Bad Request", &[], b"", false);
            return;
        }
    };
    let mut parts = request_line.split_whitespace();
    let method = match parts.next() {
        Some(m) => m.to_ascii_uppercase(),
        None => {
            let _ = write_simple_response(stream, 400, "Bad Request", &[], b"", false);
            return;
        }
    };
    let target = match parts.next() {
        Some(t) => t.to_string(),
        None => {
            let _ = write_simple_response(stream, 400, "Bad Request", &[], b"", false);
            return;
        }
    };

    let mut headers: HashMap<String, String> = HashMap::new();
    for line in head.iter().skip(1) {
        if line.is_empty() {
            continue;
        }
        if let Some((name, value)) = line.split_once(':') {
            let key = name.trim().to_ascii_lowercase();
            let value = value.trim();
            headers
                .entry(key)
                .and_modify(|existing| {
                    existing.push_str(", ");
                    existing.push_str(value);
                })
                .or_insert_with(|| value.to_string());
        }
    }

    if headers.contains_key("origin") {
        let _ = write_simple_response(
            stream,
            403,
            "Forbidden",
            &[],
            b"Browser-originated requests are not allowed",
            false,
        );
        return;
    }

    if let Some(host) = headers.get("host") {
        if !is_loopback_host(host) {
            let _ = write_simple_response(
                stream,
                403,
                "Forbidden",
                &[],
                b"WebDAV only accepts loopback Host headers",
                false,
            );
            return;
        }
    }

    if !authorized(&headers, config) {
        let _ = write_simple_response(
            stream,
            401,
            "Unauthorized",
            &[(
                "WWW-Authenticate".to_string(),
                "Basic realm=\"TeleDrive WebDAV\", charset=\"UTF-8\"".to_string(),
            )],
            b"",
            false,
        );
        return;
    }

    if stop.load(Ordering::SeqCst) {
        let _ = write_simple_response(
            stream,
            503,
            "Service Unavailable",
            &[],
            b"WebDAV is stopping",
            false,
        );
        return;
    }

    let path = match decode_virtual_path(&target) {
        Ok(path) => path,
        Err(()) => {
            let _ = write_simple_response(
                stream,
                400,
                "Bad Request",
                &[],
                b"Invalid WebDAV path",
                false,
            );
            return;
        }
    };

    let destination = headers
        .get("destination")
        .and_then(|value| decode_virtual_path(value).ok());

    let is_put = method == "PUT";
    if is_put {
        // Uploads are allowed to be slow; the 30 s header timeout must not
        // abort a large PUT that pauses between chunks.
        let _ = stream.set_read_timeout(Some(BODY_TIMEOUT));
    }
    let content_length = headers
        .get("content-length")
        .and_then(|v| v.trim().parse::<u64>().ok());
    let has_chunked = headers
        .get("transfer-encoding")
        .map(|v| v.to_ascii_lowercase().contains("chunked"))
        .unwrap_or(false);

    if is_put {
        if headers
            .get("expect")
            .map(|v| v.trim().eq_ignore_ascii_case("100-continue"))
            .unwrap_or(false)
        {
            let _ = stream.write_all(b"HTTP/1.1 100 Continue\r\n\r\n");
            let _ = stream.flush();
        }
    } else if content_length.unwrap_or(0) > MAX_SMALL_BODY as u64 {
        let _ = write_simple_response(
            stream,
            413,
            "Payload Too Large",
            &[],
            b"Request body too large",
            false,
        );
        return;
    }

    let mut body_path: Option<PathBuf> = None;
    let mut small_body: Vec<u8> = Vec::new();
    let mut received: u64 = 0;

    let read_result = if is_put {
        match create_temp_file(temp_dir) {
            Ok((path, mut file)) => {
                let result = if has_chunked {
                    copy_chunked_body(&mut reader, &mut file, &mut received)
                } else {
                    match content_length {
                        Some(0) => Ok(()),
                        Some(len) => copy_exact_body(&mut reader, &mut file, len, &mut received),
                        None => Ok(()),
                    }
                };
                drop(file);
                if result.is_err() {
                    let _ = std::fs::remove_file(&path);
                } else {
                    body_path = Some(path);
                }
                result
            }
            Err(_) => Err(500),
        }
    } else if has_chunked {
        read_chunked_body(&mut reader, &mut small_body, &mut received)
    } else {
        match content_length {
            Some(0) | None => Ok(()),
            Some(len) => read_exact_body(&mut reader, len, &mut small_body, &mut received),
        }
    };

    if let Err(status) = read_result {
        if let Some(path) = &body_path {
            let _ = std::fs::remove_file(path);
        }
        let _ = write_simple_response(
            stream,
            status,
            status_text(status),
            &[],
            status_message(status).as_bytes(),
            false,
        );
        return;
    }

    let mut output_path_for_cleanup: Option<PathBuf> = None;

    let response = if method == "OPTIONS" {
        HttpResponse::empty(200).with_headers(vec![
            ("DAV".to_string(), "1, 2".to_string()),
            ("Allow".to_string(), ALLOW_METHODS.to_string()),
            ("MS-Author-Via".to_string(), "DAV".to_string()),
        ])
    } else {
        let output_path = if method == "GET" {
            match create_temp_file(temp_dir) {
                Ok((path, file)) => {
                    drop(file);
                    match std::fs::remove_file(&path) {
                        Ok(()) => {
                            output_path_for_cleanup = Some(path.clone());
                            Some(path)
                        }
                        Err(_) => None,
                    }
                }
                Err(_) => None,
            }
        } else {
            None
        };

        let request = BridgeRequest {
            method: method.clone(),
            path,
            depth: headers.get("depth").cloned(),
            destination,
            overwrite: headers.get("overwrite").cloned(),
            lock_token: headers.get("lock-token").cloned(),
            if_header: headers.get("if").cloned(),
            timeout: headers.get("timeout").cloned(),
            range: headers.get("range").cloned(),
            content_type: headers.get("content-type").cloned(),
            content_length: if is_put {
                Some(received)
            } else {
                content_length
            },
            body_path: body_path
                .as_ref()
                .map(|p| p.to_string_lossy().to_string()),
            output_path: output_path.as_ref().map(|p| p.to_string_lossy().to_string()),
        };

        let bridge_response = bridge.handle(&request);
        HttpResponse::from_bridge(bridge_response, temp_dir, &method)
    };

    let is_head = method == "HEAD";
    let _ = write_response(stream, response, is_head);

    if let Some(path) = &body_path {
        let _ = std::fs::remove_file(path);
    }
    if let Some(path) = &output_path_for_cleanup {
        // Served GET/HEAD temp files are single-use; never let them pile up
        // in the app data directory across requests.
        let _ = std::fs::remove_file(path);
    }
}

// ---------------------------------------------------------------------------
// HTTP parsing helpers
// ---------------------------------------------------------------------------

fn read_head(reader: &mut BufReader<TcpStream>) -> Result<Vec<String>, u16> {
    let mut lines: Vec<String> = Vec::new();
    let mut total = 0usize;
    loop {
        let mut raw = Vec::new();
        let read = reader.read_until(b'\n', &mut raw).map_err(|_| 400u16)?;
        if read == 0 {
            return Err(400);
        }
        total += read;
        if total > MAX_HEADER_BYTES {
            return Err(431);
        }
        let mut line = String::from_utf8_lossy(&raw).to_string();
        while line.ends_with('\n') || line.ends_with('\r') {
            line.pop();
        }
        if lines.is_empty() && line.is_empty() {
            continue;
        }
        if line.is_empty() {
            return Ok(lines);
        }
        if lines.is_empty() && line.split_whitespace().count() < 2 {
            return Err(400);
        }
        lines.push(line);
    }
}

fn copy_exact_body(
    reader: &mut BufReader<TcpStream>,
    file: &mut File,
    len: u64,
    received: &mut u64,
) -> Result<(), u16> {
    let mut remaining = len;
    let mut buffer = vec![0u8; 64 * 1024];
    while remaining > 0 {
        let want = remaining.min(buffer.len() as u64) as usize;
        let read = reader.read(&mut buffer[..want]).map_err(|_| 400u16)?;
        if read == 0 {
            return Err(400);
        }
        file.write_all(&buffer[..read]).map_err(|_| 500u16)?;
        *received += read as u64;
        remaining -= read as u64;
    }
    Ok(())
}

fn read_chunked_body(
    reader: &mut BufReader<TcpStream>,
    out: &mut Vec<u8>,
    received: &mut u64,
) -> Result<(), u16> {
    loop {
        let size = read_chunk_size(reader)?;
        if size == 0 {
            consume_trailers(reader)?;
            return Ok(());
        }
        if out.len() as u64 + size > MAX_SMALL_BODY as u64 {
            return Err(413);
        }
        let mut remaining = size;
        let mut buffer = vec![0u8; 64 * 1024];
        while remaining > 0 {
            let want = remaining.min(buffer.len() as u64) as usize;
            let read = reader.read(&mut buffer[..want]).map_err(|_| 400u16)?;
            if read == 0 {
                return Err(400);
            }
            out.extend_from_slice(&buffer[..read]);
            *received += read as u64;
            remaining -= read as u64;
        }
        consume_crlf(reader)?;
    }
}

fn copy_chunked_body(
    reader: &mut BufReader<TcpStream>,
    file: &mut File,
    received: &mut u64,
) -> Result<(), u16> {
    loop {
        let size = read_chunk_size(reader)?;
        if size == 0 {
            consume_trailers(reader)?;
            return Ok(());
        }
        let mut remaining = size;
        let mut buffer = vec![0u8; 64 * 1024];
        while remaining > 0 {
            let want = remaining.min(buffer.len() as u64) as usize;
            let read = reader.read(&mut buffer[..want]).map_err(|_| 400u16)?;
            if read == 0 {
                return Err(400);
            }
            file.write_all(&buffer[..read]).map_err(|_| 500u16)?;
            *received += read as u64;
            remaining -= read as u64;
        }
        consume_crlf(reader)?;
    }
}

fn read_chunk_size(reader: &mut BufReader<TcpStream>) -> Result<u64, u16> {
    let mut line = Vec::new();
    let read = reader.read_until(b'\n', &mut line).map_err(|_| 400u16)?;
    if read == 0 {
        return Err(400);
    }
    let text = String::from_utf8_lossy(&line);
    let value = text.trim();
    let size_part = value.split(';').next().unwrap_or("").trim();
    u64::from_str_radix(size_part, 16).map_err(|_| 400u16)
}

fn consume_crlf(reader: &mut BufReader<TcpStream>) -> Result<(), u16> {
    let mut pair = [0u8; 2];
    reader.read_exact(&mut pair).map_err(|_| 400u16)?;
    if pair != *b"\r\n" {
        return Err(400);
    }
    Ok(())
}

fn consume_trailers(reader: &mut BufReader<TcpStream>) -> Result<(), u16> {
    loop {
        let mut line = Vec::new();
        let read = reader.read_until(b'\n', &mut line).map_err(|_| 400u16)?;
        if read == 0 {
            return Err(400);
        }
        if line == b"\r\n" || line == b"\n" {
            return Ok(());
        }
    }
}

fn read_exact_body(
    reader: &mut BufReader<TcpStream>,
    len: u64,
    out: &mut Vec<u8>,
    received: &mut u64,
) -> Result<(), u16> {
    if len > MAX_SMALL_BODY as u64 {
        return Err(413);
    }
    out.resize(len as usize, 0);
    reader.read_exact(out.as_mut_slice()).map_err(|_| 400u16)?;
    *received = len;
    Ok(())
}

fn is_loopback_host(host: &str) -> bool {
    let value = host.trim();
    let without_port = if let Some(rest) = value.strip_prefix('[') {
        match rest.split_once(']') {
            Some((inner, _)) => return inner.eq_ignore_ascii_case("::1"),
            None => return false,
        }
    } else if let Some((name, port)) = value.rsplit_once(':') {
        if port.chars().all(|c| c.is_ascii_digit()) {
            name
        } else {
            value
        }
    } else {
        value
    };
    without_port.eq_ignore_ascii_case("localhost")
        || without_port == "127.0.0.1"
        || without_port == "::1"
}

fn authorized(headers: &HashMap<String, String>, config: &ServerConfig) -> bool {
    let Some(value) = headers.get("authorization") else {
        return false;
    };
    let Some(encoded) = value.trim().strip_prefix("Basic ").or_else(|| {
        value
            .trim()
            .strip_prefix("basic ")
    }) else {
        return false;
    };
    let Some(raw) = base64_decode(encoded.trim()) else {
        return false;
    };
    let Ok(text) = String::from_utf8(raw) else {
        return false;
    };
    let Some((user, pass)) = text.split_once(':') else {
        return false;
    };
    constant_time_eq(user.as_bytes(), config.username.as_bytes())
        && constant_time_eq(pass.as_bytes(), config.password.as_bytes())
}

fn constant_time_eq(a: &[u8], b: &[u8]) -> bool {
    if a.len() != b.len() {
        return false;
    }
    let mut diff = 0u8;
    for (x, y) in a.iter().zip(b.iter()) {
        diff |= x ^ y;
    }
    diff == 0
}

fn base64_decode(input: &str) -> Option<Vec<u8>> {
    fn value(byte: u8) -> Option<u8> {
        match byte {
            b'A'..=b'Z' => Some(byte - b'A'),
            b'a'..=b'z' => Some(byte - b'a' + 26),
            b'0'..=b'9' => Some(byte - b'0' + 52),
            b'+' => Some(62),
            b'/' => Some(63),
            _ => None,
        }
    }

    let bytes: Vec<u8> = input.bytes().filter(|b| !b.is_ascii_whitespace()).collect();
    if bytes.is_empty() || bytes.len() % 4 != 0 {
        return None;
    }
    let mut out = Vec::with_capacity(bytes.len() / 4 * 3);
    for (index, chunk) in bytes.chunks(4).enumerate() {
        let last = index == bytes.len() / 4 - 1;
        let pad = chunk.iter().filter(|b| **b == b'=').count();
        if pad > 2 {
            return None;
        }
        if pad > 0 && !last {
            return None;
        }
        let mut accum: u32 = 0;
        for (position, byte) in chunk.iter().enumerate() {
            if *byte == b'=' {
                if position < 2 {
                    return None;
                }
                accum <<= 6;
            } else {
                accum = (accum << 6) | u32::from(value(*byte)?);
            }
        }
        let triple = [
            ((accum >> 16) & 0xFF) as u8,
            ((accum >> 8) & 0xFF) as u8,
            (accum & 0xFF) as u8,
        ];
        let keep = 3 - pad;
        out.extend_from_slice(&triple[..keep]);
    }
    Some(out)
}

/// Decodes an absolute or origin-form request target into a normalized virtual
/// path. Rejects malformed percent escapes, control characters, NULs and any
/// attempt to escape the virtual root with `..`.
pub fn decode_virtual_path(target: &str) -> Result<String, ()> {
    let raw = target.trim();
    if raw.is_empty() {
        return Err(());
    }
    let mut path_part = raw;
    if let Some(rest) = raw
        .strip_prefix("http://")
        .or_else(|| raw.strip_prefix("https://"))
    {
        match rest.find('/') {
            Some(index) => path_part = &rest[index..],
            None => path_part = "/",
        }
    }
    if let Some(hash) = path_part.find('#') {
        path_part = &path_part[..hash];
    }
    if let Some(query) = path_part.find('?') {
        path_part = &path_part[..query];
    }

    let decoded = percent_decode(path_part)?;
    if decoded.contains('\0') {
        return Err(());
    }
    if decoded.chars().any(|c| c.is_control()) {
        return Err(());
    }

    let mut segments: Vec<&str> = Vec::new();
    for segment in decoded.split('/') {
        if segment.is_empty() || segment == "." {
            continue;
        }
        if segment == ".." {
            return Err(());
        }
        segments.push(segment);
    }
    if segments.is_empty() {
        Ok("/".to_string())
    } else {
        Ok(format!("/{}", segments.join("/")))
    }
}

fn percent_decode(input: &str) -> Result<String, ()> {
    let bytes = input.as_bytes();
    let mut out: Vec<u8> = Vec::with_capacity(bytes.len());
    let mut index = 0usize;
    while index < bytes.len() {
        if bytes[index] == b'%' {
            if index + 2 >= bytes.len() {
                return Err(());
            }
            let high = hex_value(bytes[index + 1]).ok_or(())?;
            let low = hex_value(bytes[index + 2]).ok_or(())?;
            out.push((high << 4) | low);
            index += 3;
        } else {
            out.push(bytes[index]);
            index += 1;
        }
    }
    String::from_utf8(out).map_err(|_| ())
}

fn hex_value(byte: u8) -> Option<u8> {
    match byte {
        b'0'..=b'9' => Some(byte - b'0'),
        b'a'..=b'f' => Some(byte - b'a' + 10),
        b'A'..=b'F' => Some(byte - b'A' + 10),
        _ => None,
    }
}

// ---------------------------------------------------------------------------
// Response writing
// ---------------------------------------------------------------------------

struct HttpResponse {
    status: u16,
    headers: Vec<(String, String)>,
    body: Body,
}

enum Body {
    Empty,
    Bytes(Vec<u8>),
    File(PathBuf),
}

impl HttpResponse {
    fn empty(status: u16) -> Self {
        Self {
            status,
            headers: Vec::new(),
            body: Body::Empty,
        }
    }

    fn with_headers(mut self, extra: Vec<(String, String)>) -> Self {
        self.headers.extend(extra);
        self
    }

    fn from_bridge(mut bridge: BridgeResponse, temp_dir: &Path, method: &str) -> Self {
        let status = if (100..=599).contains(&bridge.status) {
            bridge.status
        } else {
            500
        };

        let mut headers: Vec<(String, String)> = Vec::new();
        for (name, value) in bridge.headers.drain() {
            if valid_header(&name, &value) {
                headers.push((name, value));
            }
        }

        let body = if let Some(path) = bridge.body_path {
            let candidate = PathBuf::from(path);
            if is_within(temp_dir, &candidate) && candidate.is_file() {
                Body::File(candidate)
            } else {
                return HttpResponse::empty(500);
            }
        } else if let Some(text) = bridge.body {
            Body::Bytes(text.into_bytes())
        } else {
            Body::Empty
        };

        if !headers
            .iter()
            .any(|(name, _)| name.eq_ignore_ascii_case("content-type"))
        {
            let default_type = match &body {
                Body::Bytes(_) => "application/xml; charset=utf-8",
                _ => "application/octet-stream",
            };
            headers.push(("Content-Type".to_string(), default_type.to_string()));
        }

        // A HEAD response must not download a body; the bridge reports the
        // entity length through Content-Length instead.
        let _ = method;
        HttpResponse {
            status,
            headers,
            body,
        }
    }
}

fn valid_header(name: &str, value: &str) -> bool {
    if name.is_empty() || value.contains('\r') || value.contains('\n') {
        return false;
    }
    name.bytes()
        .all(|b| b.is_ascii_alphanumeric() || b"!#$%&'*+-.^_`|~".contains(&b))
}

fn is_within(root: &Path, candidate: &Path) -> bool {
    let root = root.canonicalize().unwrap_or_else(|_| root.to_path_buf());
    let candidate = match candidate.canonicalize() {
        Ok(path) => path,
        Err(_) => return false,
    };
    candidate.starts_with(&root)
}

fn create_temp_file(temp_dir: &Path) -> Result<(PathBuf, File), ()> {
    static COUNTER: AtomicU64 = AtomicU64::new(1);
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let name = format!(
        "{}-{}-{}.tmp",
        std::process::id(),
        nanos,
        COUNTER.fetch_add(1, Ordering::Relaxed)
    );
    let path = temp_dir.join(name);
    let file = std::fs::OpenOptions::new()
        .create_new(true)
        .write(true)
        .read(true)
        .open(&path)
        .map_err(|_| ())?;
    Ok((path, file))
}

fn write_simple_response(
    stream: &mut TcpStream,
    status: u16,
    reason: &str,
    extra: &[(String, String)],
    body: &[u8],
    is_head: bool,
) -> std::io::Result<()> {
    let mut headers: Vec<(String, String)> = extra.to_vec();
    headers.push(("Server".to_string(), "TeleDrive-WebDAV".to_string()));
    headers.push(("Date".to_string(), http_date(SystemTime::now())));
    headers.push(("Connection".to_string(), "close".to_string()));
    headers.push(("Content-Length".to_string(), body.len().to_string()));
    write_raw(stream, status, reason, &headers, body, is_head)
}

fn write_response(
    stream: &mut TcpStream,
    response: HttpResponse,
    is_head: bool,
) -> std::io::Result<()> {
    let mut headers = response.headers;
    headers.push(("Server".to_string(), "TeleDrive-WebDAV".to_string()));
    headers.push(("Date".to_string(), http_date(SystemTime::now())));
    headers.push(("Connection".to_string(), "close".to_string()));

    match &response.body {
        Body::Empty => {
            if !headers.iter().any(|(n, _)| n.eq_ignore_ascii_case("content-length")) {
                headers.push(("Content-Length".to_string(), "0".to_string()));
            }
            write_raw(
                stream,
                response.status,
                status_text(response.status),
                &headers,
                b"",
                is_head,
            )
        }
        Body::Bytes(bytes) => {
            headers.retain(|(n, _)| !n.eq_ignore_ascii_case("content-length"));
            headers.push(("Content-Length".to_string(), bytes.len().to_string()));
            write_raw(
                stream,
                response.status,
                status_text(response.status),
                &headers,
                bytes,
                is_head,
            )
        }
        Body::File(path) => {
            let file = match File::open(path) {
                Ok(file) => file,
                Err(_) => {
                    return write_simple_response(
                        stream,
                        500,
                        "Internal Server Error",
                        &[],
                        b"",
                        is_head,
                    )
                }
            };
            let len = file.metadata().map(|m| m.len()).unwrap_or(0);
            // For HEAD the bridge may report the full entity length even when
            // no file is materialised; never override it with 0.
            if !is_head || !headers.iter().any(|(n, _)| n.eq_ignore_ascii_case("content-length")) {
                headers.retain(|(n, _)| !n.eq_ignore_ascii_case("content-length"));
                headers.push(("Content-Length".to_string(), len.to_string()));
            }
            write_raw(
                stream,
                response.status,
                status_text(response.status),
                &headers,
                b"",
                true,
            )?;
            if !is_head {
                let mut file = file;
                let mut buffer = vec![0u8; 64 * 1024];
                loop {
                    let read = file.read(&mut buffer)?;
                    if read == 0 {
                        break;
                    }
                    stream.write_all(&buffer[..read])?;
                }
                stream.flush()?;
            }
            Ok(())
        }
    }
}

fn write_raw(
    stream: &mut TcpStream,
    status: u16,
    reason: &str,
    headers: &[(String, String)],
    body: &[u8],
    is_head: bool,
) -> std::io::Result<()> {
    let mut head = format!("HTTP/1.1 {status} {reason}\r\n");
    for (name, value) in headers {
        if valid_header(name, value) {
            head.push_str(name);
            head.push_str(": ");
            head.push_str(value);
            head.push_str("\r\n");
        }
    }
    head.push_str("\r\n");
    stream.write_all(head.as_bytes())?;
    if !is_head {
        stream.write_all(body)?;
    }
    stream.flush()
}

fn status_text(status: u16) -> &'static str {
    match status {
        100 => "Continue",
        200 => "OK",
        201 => "Created",
        204 => "No Content",
        206 => "Partial Content",
        207 => "Multi-Status",
        301 => "Moved Permanently",
        304 => "Not Modified",
        400 => "Bad Request",
        401 => "Unauthorized",
        403 => "Forbidden",
        404 => "Not Found",
        405 => "Method Not Allowed",
        409 => "Conflict",
        412 => "Precondition Failed",
        413 => "Payload Too Large",
        415 => "Unsupported Media Type",
        423 => "Locked",
        424 => "Failed Dependency",
        431 => "Request Header Fields Too Large",
        500 => "Internal Server Error",
        501 => "Not Implemented",
        502 => "Bad Gateway",
        503 => "Service Unavailable",
        504 => "Gateway Timeout",
        507 => "Insufficient Storage",
        _ => "Unknown",
    }
}

fn status_message(status: u16) -> String {
    status_text(status).to_string()
}

/// RFC 7231 IMF-fixdate, e.g. `Sun, 06 Nov 1994 08:49:37 GMT`.
pub fn http_date(time: SystemTime) -> String {
    let seconds = time
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);
    let days = seconds.div_euclid(86_400);
    let secs_of_day = seconds.rem_euclid(86_400);
    let weekday = ((days + 4) % 7) as usize;
    let (year, month, day) = civil_from_days(days);
    let hour = secs_of_day / 3600;
    let minute = (secs_of_day % 3600) / 60;
    let second = secs_of_day % 60;
    const WEEKDAYS: [&str; 7] = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    const MONTHS: [&str; 12] = [
        "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
    ];
    format!(
        "{}, {:02} {} {:04} {:02}:{:02}:{:02} GMT",
        WEEKDAYS[weekday],
        day,
        MONTHS[(month - 1) as usize],
        year,
        hour,
        minute,
        second
    )
}

/// Howard Hinnant's days-to-civil algorithm (UTC, proleptic Gregorian).
fn civil_from_days(days: i64) -> (i64, u32, u32) {
    let z = days + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    (if m <= 2 { y + 1 } else { y }, m as u32, d as u32)
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use std::net::TcpStream as StdTcpStream;

    fn temp_dir(tag: &str) -> PathBuf {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let dir = std::env::temp_dir().join(format!(
            "teledrive-webdav-{tag}-{}-{nanos}",
            std::process::id()
        ));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn decodes_utf8_and_reserved_characters() {
        assert_eq!(
            decode_virtual_path("/My%20Files/%E6%97%A5%E6%9C%AC%E8%AA%9E/%23tag%3Fq.txt"),
            Ok("/My Files/日本語/#tag?q.txt".to_string())
        );
        assert_eq!(decode_virtual_path("/"), Ok("/".to_string()));
        assert_eq!(decode_virtual_path("/a//b/./c/"), Ok("/a/b/c".to_string()));
        assert_eq!(
            decode_virtual_path("http://127.0.0.1:8747/x%20y?query=1#frag"),
            Ok("/x y".to_string())
        );
    }

    #[test]
    fn rejects_traversal_and_malformed_escapes() {
        assert_eq!(decode_virtual_path("/.."), Err(()));
        assert_eq!(decode_virtual_path("/a/../b"), Err(()));
        assert_eq!(decode_virtual_path("/%2e%2e/secret"), Err(()));
        assert_eq!(decode_virtual_path("/bad%2"), Err(()));
        assert_eq!(decode_virtual_path("/bad%zz"), Err(()));
        assert_eq!(decode_virtual_path("/nul%00byte"), Err(()));
        assert_eq!(decode_virtual_path(""), Err(()));
    }

    #[test]
    fn parses_basic_authorization() {
        let config = ServerConfig {
            port: 0,
            username: "teledrive".to_string(),
            password: "secret".to_string(),
        };
        let mut headers = HashMap::new();
        headers.insert(
            "authorization".to_string(),
            "Basic dGVsZWRyaXZlOnNlY3JldA==".to_string(),
        );
        assert!(authorized(&headers, &config));
        headers.insert(
            "authorization".to_string(),
            "Basic dGVsZWRyaXZlOndyb25n".to_string(),
        );
        assert!(!authorized(&headers, &config));
        headers.insert("authorization".to_string(), "Bearer token".to_string());
        assert!(!authorized(&headers, &config));
    }

    #[test]
    fn base64_decoder_matches_rfc4648_vectors() {
        assert_eq!(base64_decode("").is_none(), true);
        assert_eq!(base64_decode("Zg==").unwrap(), b"f");
        assert_eq!(base64_decode("Zm8=").unwrap(), b"fo");
        assert_eq!(base64_decode("Zm9v").unwrap(), b"foo");
        assert_eq!(base64_decode("Zm9vYmFy").unwrap(), b"foobar");
        assert!(base64_decode("Zm9vY").is_none());
    }

    #[test]
    fn host_allowlist_only_accepts_loopback() {
        assert!(is_loopback_host("127.0.0.1:8747"));
        assert!(is_loopback_host("localhost"));
        assert!(is_loopback_host("[::1]:8747"));
        assert!(!is_loopback_host("192.168.1.10:8747"));
        assert!(!is_loopback_host("evil.example:8747"));
    }

    #[test]
    fn formats_http_dates() {
        assert_eq!(
            http_date(UNIX_EPOCH + Duration::from_secs(784_111_777)),
            "Sun, 06 Nov 1994 08:49:37 GMT"
        );
    }

    #[test]
    fn settings_round_trip_preserves_credentials() {
        let dir = temp_dir("settings");
        let path = dir.join("webdav_settings.json");
        let settings = WebdavSettings {
            enabled: true,
            port: 9911,
            username: "u".to_string(),
            password: "p".to_string(),
        };
        save_settings_to_path(&path, &settings).unwrap();
        assert_eq!(load_settings_from_path(&path), settings);
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn malformed_settings_fall_back_to_defaults() {
        let dir = temp_dir("settings-bad");
        let path = dir.join("webdav_settings.json");
        std::fs::write(&path, b"{not json").unwrap();
        assert_eq!(load_settings_from_path(&path), WebdavSettings::default());
        std::fs::remove_dir_all(&dir).unwrap();
    }

    fn start_test_server(
        bridge: Arc<dyn WebdavBridge>,
        dir: PathBuf,
    ) -> RunningServer {
        start_server(
            ServerConfig {
                port: 0,
                username: "user".to_string(),
                password: "pass".to_string(),
            },
            dir,
            bridge,
        )
        .unwrap()
    }

    fn request(
        port: u16,
        method: &str,
        target: &str,
        headers: &[(&str, &str)],
        body: &[u8],
    ) -> (u16, String, Vec<u8>) {
        let mut stream = StdTcpStream::connect(("127.0.0.1", port)).unwrap();
        stream
            .set_read_timeout(Some(Duration::from_secs(5)))
            .unwrap();
        let mut head = format!("{method} {target} HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\n");
        for (name, value) in headers {
            head.push_str(name);
            head.push_str(": ");
            head.push_str(value);
            head.push_str("\r\n");
        }
        if !body.is_empty() || method == "PUT" {
            head.push_str(&format!("Content-Length: {}\r\n", body.len()));
        }
        head.push_str("\r\n");
        stream.write_all(head.as_bytes()).unwrap();
        stream.write_all(body).unwrap();
        stream.flush().unwrap();

        let mut raw = Vec::new();
        stream.read_to_end(&mut raw).unwrap();
        let split = raw
            .windows(4)
            .position(|w| w == b"\r\n\r\n")
            .expect("response head");
        let head_text = String::from_utf8_lossy(&raw[..split]).to_string();
        let status_line = head_text.lines().next().unwrap_or_default();
        let status: u16 = status_line
            .split_whitespace()
            .nth(1)
            .unwrap_or("0")
            .parse()
            .unwrap();
        (status, head_text, raw[split + 4..].to_vec())
    }

    fn auth_header() -> String {
        // user:pass
        "Basic dXNlcjpwYXNz".to_string()
    }

    #[test]
    fn server_requires_basic_auth_and_rejects_origin() {
        let bridge: Arc<dyn WebdavBridge> = Arc::new(|_req: &BridgeRequest| BridgeResponse {
            status: 200,
            ..BridgeResponse::default()
        });
        let dir = temp_dir("server");
        let server = start_test_server(bridge, dir.clone());
        let port = server.port;

        let (status, _, _) = request(port, "OPTIONS", "/", &[], b"");
        assert_eq!(status, 401);

        let auth = auth_header();
        let (status, head, _) = request(
            port,
            "OPTIONS",
            "/",
            &[("Authorization", auth.as_str())],
            b"",
        );
        assert_eq!(status, 200);
        assert!(head.to_ascii_lowercase().contains("dav: 1, 2"));
        assert!(head.contains("Allow: OPTIONS, GET, HEAD, PUT"));

        let (status, _, body) = request(
            port,
            "OPTIONS",
            "/",
            &[("Authorization", auth.as_str()), ("Origin", "https://evil.test")],
            b"",
        );
        assert_eq!(status, 403);
        assert!(String::from_utf8_lossy(&body).contains("Browser-originated"));

        server.stop();
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn server_streams_put_body_into_temp_file_and_serves_get_from_file() {
        let dir = temp_dir("payload");
        let server_dir = temp_dir("server");
        let payload_path = server_dir.join("payload.bin");
        std::fs::write(&payload_path, b"hello webdav").unwrap();
        let payload_for_get = payload_path.clone();
        let observed_body: Arc<Mutex<Option<(u64, String)>>> = Arc::new(Mutex::new(None));
        let observed = observed_body.clone();

        let bridge: Arc<dyn WebdavBridge> = Arc::new(
            move |req: &BridgeRequest| {
                if req.method == "PUT" {
                    let path = req.body_path.clone().unwrap_or_default();
                    let len = std::fs::metadata(&path).map(|m| m.len()).unwrap_or(0);
                    *observed.lock().unwrap() = Some((len, path));
                    BridgeResponse {
                        status: 201,
                        ..BridgeResponse::default()
                    }
                } else if req.method == "GET" || req.method == "HEAD" {
                    BridgeResponse {
                        status: 206,
                        headers: HashMap::from([
                            ("Content-Range".to_string(), "bytes 0-4/12".to_string()),
                            ("Content-Type".to_string(), "text/plain".to_string()),
                        ]),
                        body_path: Some(payload_for_get.to_string_lossy().to_string()),
                        ..BridgeResponse::default()
                    }
                } else {
                    BridgeResponse::default()
                }
            },
        );

        let server = start_test_server(bridge, server_dir.clone());
        let port = server.port;
        let auth = auth_header();

        // PUT body lands in a temp file (not inline IPC) and is observed by the bridge.
        let (status, _, _) = request(
            port,
            "PUT",
            "/notes.txt",
            &[("Authorization", auth.as_str()), ("Content-Type", "text/plain")],
            b"document body",
        );
        assert_eq!(status, 201);
        let (len, body_path) = observed_body.lock().unwrap().clone().unwrap();
        assert_eq!(len, 13);
        assert!(body_path.contains("webdav_tmp") || body_path.contains("teledrive-webdav"));
        assert!(!Path::new(&body_path).exists(), "temp body must be cleaned up");

        // GET is served from the temp file the bridge returned.
        let (status, head, body) = request(port, "GET", "/notes.txt", &[("Authorization", auth.as_str())], b"");
        assert_eq!(status, 206);
        assert!(head.contains("Content-Range: bytes 0-4/12"));
        assert_eq!(body, b"hello webdav");

        // HEAD returns the entity length without a body.
        let (status, head, body) = request(port, "HEAD", "/notes.txt", &[("Authorization", auth.as_str())], b"");
        assert_eq!(status, 206);
        assert!(head.contains("Content-Length: 12"));
        assert!(body.is_empty());

        // GET/HEAD temp files are single-use and must not accumulate.
        let leftover = std::fs::read_dir(&server_dir)
            .unwrap()
            .filter_map(|entry| entry.ok())
            .filter(|entry| entry.file_name().to_string_lossy().ends_with(".tmp"))
            .count();
        assert_eq!(leftover, 0);

        server.stop();
        let _ = std::fs::remove_dir_all(server_dir);
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn server_decodes_chunked_put_bodies() {
        let observed: Arc<Mutex<Vec<u8>>> = Arc::new(Mutex::new(Vec::new()));
        let captured = observed.clone();
        let bridge: Arc<dyn WebdavBridge> = Arc::new(move |req: &BridgeRequest| {
            if let Some(path) = &req.body_path {
                *captured.lock().unwrap() = std::fs::read(path).unwrap_or_default();
            }
            BridgeResponse {
                status: 201,
                ..BridgeResponse::default()
            }
        });
        let dir = temp_dir("server");
        let server = start_test_server(bridge, dir.clone());
        let port = server.port;
        let auth = auth_header();
        let mut stream = StdTcpStream::connect(("127.0.0.1", port)).unwrap();
        stream
            .set_read_timeout(Some(Duration::from_secs(5)))
            .unwrap();
        let head = format!(
            "PUT /chunked.txt HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nAuthorization: {auth}\r\nTransfer-Encoding: chunked\r\n\r\n"
        );
        stream.write_all(head.as_bytes()).unwrap();
        stream.write_all(b"5\r\nhello\r\n1\r\n \r\n5\r\nworld\r\n0\r\n\r\n").unwrap();
        stream.flush().unwrap();
        let mut raw = Vec::new();
        stream.read_to_end(&mut raw).unwrap();
        assert!(String::from_utf8_lossy(&raw).starts_with("HTTP/1.1 201"));
        assert_eq!(&*observed.lock().unwrap(), b"hello world");

        server.stop();
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn server_rejects_non_loopback_host() {
        let bridge: Arc<dyn WebdavBridge> = Arc::new(|_req: &BridgeRequest| BridgeResponse {
            status: 200,
            ..BridgeResponse::default()
        });
        let dir = temp_dir("server");
        let server = start_test_server(bridge, dir.clone());
        let port = server.port;
        let auth = auth_header();
        let mut stream = StdTcpStream::connect(("127.0.0.1", port)).unwrap();
        stream
            .set_read_timeout(Some(Duration::from_secs(5)))
            .unwrap();
        let head = format!(
            "OPTIONS / HTTP/1.1\r\nHost: evil.example\r\nAuthorization: {auth}\r\n\r\n"
        );
        stream.write_all(head.as_bytes()).unwrap();
        let mut raw = Vec::new();
        stream.read_to_end(&mut raw).unwrap();
        assert!(String::from_utf8_lossy(&raw).starts_with("HTTP/1.1 403"));
        server.stop();
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn bridge_rejects_body_paths_outside_temp_dir() {
        let dir = temp_dir("outside");
        let outside = dir.join("outside.txt");
        std::fs::write(&outside, b"nope").unwrap();
        let bridge = BridgeResponse {
            status: 200,
            body_path: Some(outside.to_string_lossy().to_string()),
            ..BridgeResponse::default()
        };
        let response = HttpResponse::from_bridge(bridge, &dir.join("root"), "GET");
        assert_eq!(response.status, 500);
        let _ = std::fs::remove_dir_all(dir);
    }
}
