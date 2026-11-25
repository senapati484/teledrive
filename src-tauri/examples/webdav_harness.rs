//! Standalone WebDAV harness for end-to-end client testing.
//!
//! Runs the real Rust HTTP server (`teledrive_lib::webdav`) with an injected
//! in-memory catalog instead of the Telegram bridge, so stock clients such as
//! rclone and curl can exercise the wire protocol without an account:
//!
//! ```text
//! cargo run --example webdav_harness
//! rclone lsd :webdav: --webdav-url http://127.0.0.1:18747/ --webdav-user harness --webdav-pass harness-pass
//! ```
//!
//! This example is not part of the shipped app.

use std::collections::{HashMap, HashSet};
use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use teledrive_lib::webdav::{
    start_server, BridgeRequest, BridgeResponse, ServerConfig, WebdavBridge,
};

struct Catalog {
    files: HashMap<String, Vec<u8>>,
    folders: HashSet<String>,
    response_counter: u64,
}

struct Harness {
    temp_dir: std::path::PathBuf,
    catalog: Mutex<Catalog>,
}

fn parent_of(path: &str) -> String {
    if path == "/" || !path.contains('/') {
        return "/".to_string();
    }
    let trimmed = path.trim_end_matches('/');
    match trimmed.rfind('/') {
        Some(0) | None => "/".to_string(),
        Some(index) => trimmed[..index].to_string(),
    }
}

fn name_of(path: &str) -> String {
    let trimmed = path.trim_end_matches('/');
    match trimmed.rfind('/') {
        Some(index) => trimmed[index + 1..].to_string(),
        None => trimmed.to_string(),
    }
}

fn escape(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
}

fn http_date(seconds: u64) -> String {
    // Fixed date is sufficient for client compatibility tests.
    let _ = seconds;
    "Wed, 01 Jan 2025 00:00:00 GMT".to_string()
}

fn href(path: &str, is_folder: bool) -> String {
    let encoded = path
        .split('/')
        .map(|segment| {
            segment
                .bytes()
                .map(|byte| {
                    if byte.is_ascii_alphanumeric() || b"-._~".contains(&byte) {
                        (byte as char).to_string()
                    } else {
                        format!("%{byte:02X}")
                    }
                })
                .collect::<String>()
        })
        .collect::<Vec<_>>()
        .join("/");
    if is_folder && !encoded.ends_with('/') {
        format!("{encoded}/")
    } else {
        encoded
    }
}

impl Catalog {
    fn exists(&self, path: &str) -> bool {
        path == "/" || self.files.contains_key(path) || self.folders.contains(path)
    }

    fn is_folder(&self, path: &str) -> bool {
        path == "/" || self.folders.contains(path)
    }

    fn children(&self, path: &str) -> Vec<(String, bool)> {
        let prefix = if path == "/" {
            "/".to_string()
        } else {
            format!("{path}/")
        };
        let mut out: Vec<(String, bool)> = Vec::new();
        for folder in &self.folders {
            if let Some(rest) = folder.strip_prefix(&prefix) {
                if !rest.is_empty() && !rest.contains('/') {
                    out.push((format!("{prefix}{rest}"), true));
                }
            }
        }
        for file in self.files.keys() {
            if let Some(rest) = file.strip_prefix(&prefix) {
                if !rest.is_empty() && !rest.contains('/') {
                    out.push((format!("{prefix}{rest}"), false));
                }
            }
        }
        out.sort();
        out.dedup();
        out
    }

    fn remove_subtree(&mut self, path: &str) {
        let prefix = format!("{path}/");
        self.files.retain(|key, _| key != path && !key.starts_with(&prefix));
        self.folders
            .retain(|key| key != path && !key.starts_with(&prefix));
    }
}

fn propfind(catalog: &Catalog, path: &str, depth: &str) -> BridgeResponse {
    if !catalog.exists(path) {
        return BridgeResponse {
            status: 404,
            ..BridgeResponse::default()
        };
    }
    let mut nodes: Vec<(String, bool)> = vec![(path.to_string(), catalog.is_folder(path))];
    if depth != "0" && catalog.is_folder(path) {
        for (child, is_folder) in catalog.children(path) {
            nodes.push((child.clone(), is_folder));
            if depth == "infinity" && is_folder {
                for (grandchild, grand_folder) in catalog.children(&child) {
                    nodes.push((grandchild, grand_folder));
                }
            }
        }
    }

    let mut xml = String::from(
        "<?xml version=\"1.0\" encoding=\"utf-8\"?><D:multistatus xmlns:D=\"DAV:\">",
    );
    for (node, is_folder) in nodes {
        let display = if node == "/" {
            "Harness".to_string()
        } else {
            name_of(&node)
        };
        let size = if is_folder {
            0
        } else {
            catalog.files.get(&node).map(|bytes| bytes.len()).unwrap_or(0)
        };
        xml.push_str("<D:response>");
        xml.push_str(&format!("<D:href>{}</D:href>", escape(&href(&node, is_folder))));
        xml.push_str("<D:propstat><D:prop>");
        xml.push_str(&format!(
            "<D:displayname>{}</D:displayname>",
            escape(&display)
        ));
        xml.push_str(if is_folder {
            "<D:resourcetype><D:collection/></D:resourcetype>"
        } else {
            "<D:resourcetype/>"
        });
        xml.push_str(&format!(
            "<D:getlastmodified>{}</D:getlastmodified>",
            http_date(0)
        ));
        xml.push_str(&format!(
            "<D:getetag>\"h-{}-{}\"</D:getetag>",
            node.replace('/', "_"),
            size
        ));
        if !is_folder {
            xml.push_str(&format!("<D:getcontentlength>{size}</D:getcontentlength>"));
            xml.push_str("<D:getcontenttype>application/octet-stream</D:getcontenttype>");
        }
        xml.push_str(
            "<D:supportedlock><D:lockentry><D:lockscope><D:exclusive/></D:lockscope><D:locktype><D:write/></D:locktype></D:lockentry></D:supportedlock>",
        );
        xml.push_str(
            "</D:prop><D:status>HTTP/1.1 200 OK</D:status></D:propstat></D:response>",
        );
    }
    xml.push_str("</D:multistatus>");

    let mut headers = HashMap::new();
    headers.insert(
        "Content-Type".to_string(),
        "application/xml; charset=utf-8".to_string(),
    );
    BridgeResponse {
        status: 207,
        headers,
        body: Some(xml),
        body_path: None,
    }
}

impl WebdavBridge for Harness {
    fn handle(&self, request: &BridgeRequest) -> BridgeResponse {
        let mut catalog = self.catalog.lock().unwrap();
        let path = request.path.clone();
        match request.method.as_str() {
            "PROPFIND" => {
                let depth = request.depth.clone().unwrap_or_else(|| "1".to_string());
                propfind(&catalog, &path, &depth)
            }
            "PROPPATCH" => BridgeResponse {
                status: 207,
                body: Some(
                    "<?xml version=\"1.0\" encoding=\"utf-8\"?><D:multistatus xmlns:D=\"DAV:\"><D:response><D:href>/</D:href><D:propstat><D:prop/><D:status>HTTP/1.1 403 Forbidden</D:status></D:propstat></D:response></D:multistatus>".to_string(),
                ),
                ..BridgeResponse::default()
            },
            "GET" | "HEAD" => {
                let Some(bytes) = catalog.files.get(&path).cloned() else {
                    return BridgeResponse {
                        status: if catalog.is_folder(&path) { 405 } else { 404 },
                        ..BridgeResponse::default()
                    };
                };
                if bytes.is_empty() {
                    return BridgeResponse {
                        status: 200,
                        ..BridgeResponse::default()
                    };
                }
                let total = bytes.len();
                let (start, end, status) = match request.range.as_deref() {
                    Some(raw) if raw.starts_with("bytes=") => {
                        let spec = raw.trim_start_matches("bytes=");
                        let parts: Vec<&str> = spec.splitn(2, '-').collect();
                        let start = parts.first().and_then(|v| v.parse::<usize>().ok()).unwrap_or(0);
                        let end = parts
                            .get(1)
                            .and_then(|v| v.parse::<usize>().ok())
                            .map(|v| v.min(total - 1))
                            .unwrap_or(total - 1);
                        if start >= total || start > end {
                            return BridgeResponse {
                                status: 416,
                                headers: HashMap::from([(
                                    "Content-Range".to_string(),
                                    format!("bytes */{total}"),
                                )]),
                                ..BridgeResponse::default()
                            };
                        }
                        (start, end, 206)
                    }
                    _ => (0, total - 1, 200),
                };
                let slice = &bytes[start..=end];
                let mut headers = HashMap::new();
                headers.insert(
                    "Content-Type".to_string(),
                    "application/octet-stream".to_string(),
                );
                headers.insert("ETag".to_string(), format!("\"h-{total}\""));
                headers.insert("Last-Modified".to_string(), http_date(0));
                headers.insert("Accept-Ranges".to_string(), "bytes".to_string());
                if status == 206 {
                    headers.insert(
                        "Content-Range".to_string(),
                        format!("bytes {start}-{end}/{total}"),
                    );
                }
                if request.method == "HEAD" {
                    headers.insert("Content-Length".to_string(), slice.len().to_string());
                    return BridgeResponse {
                        status,
                        headers,
                        ..BridgeResponse::default()
                    };
                }
                catalog.response_counter += 1;
                let out = self
                    .temp_dir
                    .join(format!("response-{}.bin", catalog.response_counter));
                if std::fs::write(&out, slice).is_err() {
                    return BridgeResponse {
                        status: 500,
                        ..BridgeResponse::default()
                    };
                }
                BridgeResponse {
                    status,
                    headers,
                    body_path: Some(out.to_string_lossy().to_string()),
                    ..BridgeResponse::default()
                }
            }
            "PUT" => {
                let parent = parent_of(&path);
                if !catalog.is_folder(&parent) {
                    return BridgeResponse {
                        status: 409,
                        ..BridgeResponse::default()
                    };
                }
                let existed = catalog.files.contains_key(&path);
                let Some(body_path) = request.body_path.as_deref() else {
                    return BridgeResponse {
                        status: 400,
                        ..BridgeResponse::default()
                    };
                };
                let bytes = match std::fs::read(body_path) {
                    Ok(bytes) => bytes,
                    Err(_) => {
                        return BridgeResponse {
                            status: 500,
                            ..BridgeResponse::default()
                        }
                    }
                };
                catalog.files.insert(path, bytes);
                BridgeResponse {
                    status: if existed { 204 } else { 201 },
                    ..BridgeResponse::default()
                }
            }
            "MKCOL" => {
                if catalog.exists(&path) {
                    return BridgeResponse {
                        status: 405,
                        ..BridgeResponse::default()
                    };
                }
                if !catalog.is_folder(&parent_of(&path)) {
                    return BridgeResponse {
                        status: 409,
                        ..BridgeResponse::default()
                    };
                }
                catalog.folders.insert(path);
                BridgeResponse {
                    status: 201,
                    ..BridgeResponse::default()
                }
            }
            "DELETE" => {
                if !catalog.exists(&path) || path == "/" {
                    return BridgeResponse {
                        status: 404,
                        ..BridgeResponse::default()
                    };
                }
                catalog.remove_subtree(&path);
                BridgeResponse {
                    status: 204,
                    ..BridgeResponse::default()
                }
            }
            "MOVE" => {
                let Some(destination) = request.destination.clone() else {
                    return BridgeResponse {
                        status: 400,
                        ..BridgeResponse::default()
                    };
                };
                if !catalog.exists(&path) {
                    return BridgeResponse {
                        status: 404,
                        ..BridgeResponse::default()
                    };
                }
                if !catalog.is_folder(&parent_of(&destination)) {
                    return BridgeResponse {
                        status: 409,
                        ..BridgeResponse::default()
                    };
                }
                let existed = catalog.exists(&destination);
                let prefix = format!("{path}/");
                let moved_files: Vec<(String, Vec<u8>)> = catalog
                    .files
                    .iter()
                    .filter(|(key, _)| key.as_str() == path || key.starts_with(&prefix))
                    .map(|(key, value)| (key.clone(), value.clone()))
                    .collect();
                let moved_folders: Vec<String> = catalog
                    .folders
                    .iter()
                    .filter(|key| key.as_str() == path || key.starts_with(&prefix))
                    .cloned()
                    .collect();
                catalog.remove_subtree(&path);
                catalog.remove_subtree(&destination);
                for (key, value) in moved_files {
                    let suffix = key.strip_prefix(&path).unwrap_or("");
                    catalog.files.insert(format!("{destination}{suffix}"), value);
                }
                for key in moved_folders {
                    let suffix = key.strip_prefix(&path).unwrap_or("");
                    catalog.folders.insert(format!("{destination}{suffix}"));
                }
                BridgeResponse {
                    status: if existed { 204 } else { 201 },
                    ..BridgeResponse::default()
                }
            }
            "COPY" => BridgeResponse {
                status: 501,
                ..BridgeResponse::default()
            },
            "LOCK" => {
                let token = "opaquelocktoken:harness-lock";
                let xml = format!(
                    "<?xml version=\"1.0\" encoding=\"utf-8\"?><D:prop xmlns:D=\"DAV:\"><D:lockdiscovery><D:activelock><D:locktype><D:write/></D:locktype><D:lockscope><D:exclusive/></D:lockscope><D:depth>infinity</D:depth><D:timeout>Second-600</D:timeout><D:locktoken><D:href>{token}</D:href></D:locktoken><D:lockroot><D:href>{}</D:href></D:lockroot></D:activelock></D:lockdiscovery></D:prop>",
                    escape(&path)
                );
                BridgeResponse {
                    status: 200,
                    headers: HashMap::from([
                        ("Lock-Token".to_string(), format!("<{token}>")),
                        ("Timeout".to_string(), "Second-600".to_string()),
                    ]),
                    body: Some(xml),
                    body_path: None,
                }
            }
            "UNLOCK" => BridgeResponse {
                status: 204,
                ..BridgeResponse::default()
            },
            _ => BridgeResponse {
                status: 405,
                ..BridgeResponse::default()
            },
        }
    }
}

fn main() {
    let port: u16 = std::env::var("WEBDAV_PORT")
        .ok()
        .and_then(|value| value.parse().ok())
        .unwrap_or(18747);
    let username = std::env::var("WEBDAV_USER").unwrap_or_else(|_| "harness".to_string());
    let password = std::env::var("WEBDAV_PASS").unwrap_or_else(|_| "harness-pass".to_string());

    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    let temp_dir = std::env::temp_dir().join(format!("teledrive-webdav-harness-{nanos}"));
    std::fs::create_dir_all(&temp_dir).unwrap();

    let catalog = Catalog {
        files: HashMap::from([
            ("/hello.txt".to_string(), b"hello webdav".to_vec()),
            ("/Docs/inner.txt".to_string(), b"inner payload".to_vec()),
        ]),
        folders: HashSet::from(["/Docs".to_string()]),
        response_counter: 0,
    };

    let harness = Arc::new(Harness {
        temp_dir: temp_dir.clone(),
        catalog: Mutex::new(catalog),
    });

    let server = start_server(
        ServerConfig {
            port,
            username,
            password,
        },
        temp_dir.clone(),
        harness,
    )
    .expect("failed to start WebDAV harness");

    println!("LISTENING {}", server.port);
    use std::io::Write as _;
    let _ = std::io::stdout().flush();
    loop {
        std::thread::sleep(Duration::from_secs(60));
    }
}
