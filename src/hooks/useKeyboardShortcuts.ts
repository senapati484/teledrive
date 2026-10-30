import { useEffect, useRef } from "react";
import { useFileStore } from "@/stores/fileStore";
import { useFileActions } from "@/hooks/useFileActions";


interface KeyboardShortcutsProps {
  onToggleHelp: () => void;
}

export function useKeyboardShortcuts({ onToggleHelp }: KeyboardShortcutsProps) {
  // Granular selectors — avoids subscribing the effect to *every* store
  // mutation (uploads, queue state, retry countdowns, etc.). The action
  // callbacks are also pinned to refs so the keydown listener is bound
  // exactly once per mount instead of being torn down + re-attached on
  // every store change (which was costing ~2 listener re-binds per
  // second during a Telegram retry).
  const selectedIds = useFileStore((s) => s.selectedIds);
  const currentFolder = useFileStore((s) => s.currentFolder);
  const setSelectedIds = useFileStore((s) => s.setSelectedIds);
  const clearSelection = useFileStore((s) => s.clearSelection);
  const { moveToTrash } = useFileActions();

  // Keep mutable state in refs so the keydown handler is stable across renders
  // and the window listener is bound exactly once.
  const filesRef = useRef(useFileStore.getState().files);
  const selectedIdsRef = useRef(selectedIds);
  const currentFolderRef = useRef(currentFolder);
  const moveToTrashRef = useRef(moveToTrash);
  const onToggleHelpRef = useRef(onToggleHelp);
  const setSelectedIdsRef = useRef(setSelectedIds);
  const clearSelectionRef = useRef(clearSelection);

  // Mirror latest values into refs on every render. The handler reads from
  // refs at call time so it always sees the freshest snapshot without
  // needing to be in the effect's dep array.
  useEffect(() => {
    filesRef.current = useFileStore.getState().files;
  });
  useEffect(() => {
    selectedIdsRef.current = selectedIds;
  }, [selectedIds]);
  useEffect(() => {
    currentFolderRef.current = currentFolder;
  }, [currentFolder]);
  useEffect(() => {
    moveToTrashRef.current = moveToTrash;
  }, [moveToTrash]);
  useEffect(() => {
    onToggleHelpRef.current = onToggleHelp;
  }, [onToggleHelp]);
  useEffect(() => {
    setSelectedIdsRef.current = setSelectedIds;
  }, [setSelectedIds]);
  useEffect(() => {
    clearSelectionRef.current = clearSelection;
  }, [clearSelection]);

  const lastKeyRef = useRef<{ key: string; time: number }>({ key: "", time: 0 });

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore shortcuts if user is typing in an input, textarea or contenteditable element
      const target = e.target as HTMLElement;
      if (
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.isContentEditable
      ) {
        if (e.key === "Escape") {
          target.blur();
        }
        return;
      }

      // Ignore global drive shortcuts when a modal dialog or preview is open
      if (
        document.getElementById("file-preview-modal") ||
        document.querySelector('[role="dialog"]')
      ) {
        return;
      }

      // Detect Ctrl/Cmd modifier
      const isCmd = e.ctrlKey || e.metaKey;

      // Read latest values from refs.
      const files = filesRef.current;
      const selected = selectedIdsRef.current;
      const folder = currentFolderRef.current;

      // 1. Focus Search: "/" or "Ctrl+F" / "Cmd+F"
      if (e.key === "/" || (isCmd && e.key.toLowerCase() === "f")) {
        e.preventDefault();
        const searchInput = (document.getElementById("main-search-input") ||
          document.querySelector('input[placeholder*="Search"]')) as HTMLInputElement | null;
        if (searchInput) {
          searchInput.focus();
          searchInput.select();
        }
        return;
      }

      // 2. Escape: Clear selection
      if (e.key === "Escape") {
        e.preventDefault();
        clearSelectionRef.current();
        return;
      }

      // 3. Select All: "Ctrl+A" / "Cmd+A"
      if (isCmd && e.key.toLowerCase() === "a") {
        e.preventDefault();
        const path = window.location.pathname;
        let selectableFiles = [...files];

        if (path === "/drive/my-drive" || path.startsWith("/drive/folder/")) {
          selectableFiles = selectableFiles.filter((f) => f.folderPath === folder && !f.trashed);
        } else if (path === "/drive/starred") {
          selectableFiles = selectableFiles.filter((f) => f.starred && !f.trashed);
        } else if (path === "/drive/recent") {
          selectableFiles = selectableFiles.filter((f) => !f.trashed);
        } else if (path === "/drive/trash") {
          selectableFiles = selectableFiles.filter((f) => f.trashed);
        }

        setSelectedIdsRef.current(selectableFiles.map((f) => f.id));
        return;
      }

      // 4. Delete: Move selected to trash (or delete permanently if in trash)
      if (e.key === "Delete" || e.key === "Backspace") {
        if (selected.length > 0) {
          e.preventDefault();
          const path = window.location.pathname;
          if (path === "/drive/trash") {
            const event = new CustomEvent("teledrive-delete-selected");
            window.dispatchEvent(event);
          } else {
            // Move to trash (reversible — no confirmation needed)
            const filesToTrash = files.filter((f) => selected.includes(f.id));
            filesToTrash.forEach((file) => moveToTrashRef.current(file));
            clearSelectionRef.current();
          }
        }
        return;
      }

      // 5. Rename: F2
      if (e.key === "F2") {
        if (selected.length === 1) {
          e.preventDefault();
          const targetFile = files.find((f) => f.id === selected[0]);
          if (targetFile) {
            const event = new CustomEvent("teledrive-rename-file-event", { detail: targetFile });
            window.dispatchEvent(event);
          }
        }
        return;
      }

      // 6. Download: "Ctrl+D" / "Cmd+D"
      if (isCmd && e.key.toLowerCase() === "d") {
        if (selected.length === 1) {
          e.preventDefault();
          const targetFile = files.find((f) => f.id === selected[0]);
          if (targetFile && targetFile.mime !== "inode/directory" && targetFile.mime !== "application/x-directory") {
            const event = new CustomEvent("teledrive-download-file", { detail: targetFile });
            window.dispatchEvent(event);
          }
        }
        return;
      }

      // 7. Toggle Help: "?" or "Shift+Slash"
      if (e.key === "?" || (e.shiftKey && e.code === "Slash")) {
        e.preventDefault();
        onToggleHelpRef.current();
        return;
      }

      // 8. Sequence navigation: "gg" (top) and "gl" (bottom)
      const now = Date.now();
      const prevKey = lastKeyRef.current;
      lastKeyRef.current = { key: e.key.toLowerCase(), time: now };

      if (prevKey.key === "g" && now - prevKey.time < 500) {
        if (e.key.toLowerCase() === "g") {
          e.preventDefault();
          const scrollContainer = document.querySelector(".flex-1.overflow-y-auto");
          if (scrollContainer) {
            scrollContainer.scrollTo({ top: 0, behavior: "smooth" });
          }
        } else if (e.key.toLowerCase() === "l") {
          e.preventDefault();
          const scrollContainer = document.querySelector(".flex-1.overflow-y-auto");
          if (scrollContainer) {
            scrollContainer.scrollTo({ top: scrollContainer.scrollHeight, behavior: "smooth" });
          }
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, []);
}