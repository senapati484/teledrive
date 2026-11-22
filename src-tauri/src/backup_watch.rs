use notify::{Event, RecommendedWatcher, RecursiveMode, Watcher};
use std::{
    collections::BTreeSet,
    path::Path,
    sync::{mpsc, Mutex},
    time::{Duration, Instant},
};
use tauri::{AppHandle, Emitter, Manager};

/// Events are coalesced for this long before one batch is sent to the UI, so
/// copying thousands of files produces a handful of IPC messages, not one per
/// file.
const BATCH_WINDOW: Duration = Duration::from_millis(500);
/// A continuous stream of events (a long copy) still flushes this often.
const MAX_BATCH_AGE: Duration = Duration::from_secs(5);

enum Signal {
    Paths(Vec<String>),
    Rescan,
}

static WATCH: Mutex<Option<(String, RecommendedWatcher)>> = Mutex::new(None);

/// Starts monitoring `paths`. Returns the paths that could not be monitored;
/// fails only when none of them could.
pub(super) fn start(app: AppHandle, id: String, paths: Vec<String>) -> Result<Vec<String>, String> {
    let mut active = WATCH.lock().map_err(|err| err.to_string())?;
    let event_name = format!("teledrive://backup-change/{id}");
    let app_data = app.path().app_data_dir().ok();
    let (tx, rx) = mpsc::channel::<Signal>();

    let mut watcher = notify::recommended_watcher(move |result: notify::Result<Event>| {
        let event = match result {
            Ok(event) if !event.need_rescan() && event.kind.is_access() => return,
            Ok(event) if !event.need_rescan() => event,
            _ => {
                let _ = tx.send(Signal::Rescan);
                return;
            }
        };
        let paths: Vec<_> = event
            .paths
            .into_iter()
            .filter(|path| !app_data.as_ref().is_some_and(|dir| path.starts_with(dir)))
            .map(|path| path.to_string_lossy().into_owned())
            .collect();
        if !paths.is_empty() {
            let _ = tx.send(Signal::Paths(paths));
        }
    })
    .map_err(|err| err.to_string())?;

    let mut failed = Vec::new();
    let mut watched = 0;
    for path in paths {
        if watcher
            .watch(Path::new(&path), RecursiveMode::Recursive)
            .is_ok()
        {
            watched += 1;
        } else {
            failed.push(path);
        }
    }
    if watched == 0 {
        return Err("No backup folder could be monitored".into());
    }

    // The batching thread ends on its own once the watcher (which owns the
    // sender) is dropped by `stop` or replaced by a newer `start`.
    std::thread::spawn(move || {
        while let Ok(first) = rx.recv() {
            let mut batch = BTreeSet::new();
            let mut rescan = false;
            let mut push = |signal: Signal| match signal {
                Signal::Paths(paths) => batch.extend(paths),
                Signal::Rescan => rescan = true,
            };
            push(first);
            let opened = Instant::now();
            while opened.elapsed() < MAX_BATCH_AGE {
                match rx.recv_timeout(BATCH_WINDOW) {
                    Ok(next) => push(next),
                    Err(_) => break,
                }
            }
            let payload: Vec<String> = if rescan {
                Vec::new()
            } else {
                batch.into_iter().collect()
            };
            let _ = app.emit(&event_name, payload);
        }
    });

    *active = Some((id, watcher));
    Ok(failed)
}

pub(super) fn stop(id: &str) {
    if let Ok(mut active) = WATCH.lock() {
        if active
            .as_ref()
            .is_some_and(|(active_id, _)| active_id == id)
        {
            active.take();
        }
    }
}
