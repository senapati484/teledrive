//! Deletes local files after they were backed up ("delete from disk after
//! backup"). Every file is re-checked here, right before deletion:
//!
//! - it must sit strictly inside one of the configured backup folders (after
//!   resolving `..` and links in its parent path),
//! - it must be a regular file, not a symlink or directory,
//! - its size and modification time must still equal what was backed up, so
//!   a file edited after its upload is never deleted.
//!
//! Folders left empty are removed up to, but never including, the backup
//! folder itself.

use serde::{Deserialize, Serialize};
use std::{
    path::{Path, PathBuf},
    time::SystemTime,
};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CleanupFile {
    pub path: String,
    pub size: u64,
    pub mtime_ms: u64,
}

#[derive(Serialize, Default, Debug)]
#[serde(rename_all = "camelCase")]
pub struct CleanupSkip {
    pub path: String,
    pub reason: String,
}

#[derive(Serialize, Default, Debug)]
#[serde(rename_all = "camelCase")]
pub struct CleanupResult {
    pub deleted: Vec<String>,
    pub skipped: Vec<CleanupSkip>,
}

fn unix_ms(t: SystemTime) -> u64 {
    t.duration_since(SystemTime::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// Canonical path of `path` without following a link at the last component.
fn resolve_keeping_name(path: &Path) -> Result<PathBuf, String> {
    let name = path.file_name().ok_or("path has no file name")?;
    let parent = path.parent().ok_or("path has no parent")?;
    let parent = std::fs::canonicalize(parent).map_err(|e| format!("parent not found: {e}"))?;
    Ok(parent.join(name))
}

fn owning_root<'a>(path: &Path, roots: &'a [PathBuf]) -> Option<&'a PathBuf> {
    roots
        .iter()
        .filter(|root| path != root.as_path() && path.starts_with(root))
        .max_by_key(|root| root.components().count())
}

fn check(file: &CleanupFile, roots: &[PathBuf]) -> Result<(PathBuf, PathBuf), String> {
    let path = resolve_keeping_name(Path::new(&file.path))?;
    let root = owning_root(&path, roots)
        .ok_or("outside the backup folders")?
        .clone();
    let meta = std::fs::symlink_metadata(&path).map_err(|e| format!("not found: {e}"))?;
    if !meta.file_type().is_file() {
        return Err("not a regular file".into());
    }
    if meta.len() != file.size {
        return Err("size changed since the backup".into());
    }
    let mtime = unix_ms(meta.modified().unwrap_or(SystemTime::UNIX_EPOCH));
    if mtime != file.mtime_ms {
        return Err("modified since the backup".into());
    }
    Ok((path, root))
}

fn remove_empty_parents(path: &Path, root: &Path) {
    let mut dir = path.parent();
    while let Some(current) = dir {
        if current == root || !current.starts_with(root) {
            break;
        }
        // Fails (and stops) as soon as a folder still has content.
        if std::fs::remove_dir(current).is_err() {
            break;
        }
        dir = current.parent();
    }
}

pub fn delete_files(roots: Vec<String>, files: Vec<CleanupFile>) -> CleanupResult {
    let roots: Vec<PathBuf> = roots
        .iter()
        .filter_map(|root| std::fs::canonicalize(root).ok())
        .collect();
    let mut result = CleanupResult::default();
    for file in files {
        match check(&file, &roots) {
            Ok((path, root)) => match std::fs::remove_file(&path) {
                Ok(()) => {
                    remove_empty_parents(&path, &root);
                    result.deleted.push(file.path);
                }
                Err(err) => result.skipped.push(CleanupSkip {
                    path: file.path,
                    reason: format!("delete failed: {err}"),
                }),
            },
            Err(reason) => result.skipped.push(CleanupSkip {
                path: file.path,
                reason,
            }),
        }
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "teledrive-cleanup-{name}-{}-{}",
            std::process::id(),
            unix_ms(SystemTime::now())
        ));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn entry(path: &Path) -> CleanupFile {
        let meta = std::fs::metadata(path).unwrap();
        CleanupFile {
            path: path.to_string_lossy().into_owned(),
            size: meta.len(),
            mtime_ms: unix_ms(meta.modified().unwrap()),
        }
    }

    #[test]
    fn deletes_unchanged_file_and_empty_folders_but_keeps_root() {
        let root = temp_dir("ok");
        let nested = root.join("a").join("b");
        std::fs::create_dir_all(&nested).unwrap();
        let file = nested.join("f.txt");
        std::fs::write(&file, b"data").unwrap();

        let result = delete_files(vec![root.to_string_lossy().into()], vec![entry(&file)]);

        assert_eq!(result.deleted.len(), 1, "{:?}", result.skipped);
        assert!(!file.exists());
        assert!(!root.join("a").exists());
        assert!(root.exists());
        std::fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn keeps_file_changed_after_backup() {
        let root = temp_dir("changed");
        let file = root.join("f.txt");
        std::fs::write(&file, b"data").unwrap();
        let mut stale = entry(&file);
        stale.size += 1;

        let result = delete_files(vec![root.to_string_lossy().into()], vec![stale]);

        assert!(result.deleted.is_empty());
        assert!(file.exists());
        std::fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn refuses_files_outside_backup_folders() {
        let root = temp_dir("root");
        let other = temp_dir("other");
        let outside = other.join("f.txt");
        std::fs::write(&outside, b"data").unwrap();
        let escaping = CleanupFile {
            path: root
                .join("..")
                .join(other.file_name().unwrap())
                .join("f.txt")
                .to_string_lossy()
                .into_owned(),
            ..entry(&outside)
        };

        let result = delete_files(
            vec![root.to_string_lossy().into()],
            vec![entry(&outside), escaping],
        );

        assert!(result.deleted.is_empty());
        assert!(outside.exists());
        std::fs::remove_dir_all(&root).unwrap();
        std::fs::remove_dir_all(&other).unwrap();
    }
}
