import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { TeleFile } from "@/lib/types";
import { useFileStore } from "@/stores/fileStore";

const DIRECTORY_MIMES = new Set(["inode/directory", "application/x-directory"]);
const DND_PAYLOAD_MIME = "application/x-teledrive-item-ids";

let activeDragIds: string[] = [];

export type DragPreviewVariant = "folder-grid" | "file-grid" | "list-row";

export interface InternalDragState {
  ids: string[];
  sourceId: string;
  previewFile: TeleFile;
  previewVariant: DragPreviewVariant;
  x: number;
  y: number;
  offsetX: number;
  offsetY: number;
  width: number;
  height: number;
}

interface UseFileBrowserDragAndDropOptions {
  files: TeleFile[];
  folderPath: string;
  isMobile: boolean;
  selectedIds: string[];
  selectedIdsSet: Set<string>;
  clearSelection: () => void;
  moveMultipleFilesOrFolders: (fileIds: string[], targetFolderPath: string) => Promise<unknown>;
}

const INTERNAL_NAV_TARGET_PREFIX = "nav:";

function isDirectory(file: TeleFile): boolean {
  return DIRECTORY_MIMES.has(file.mime);
}

export function useFileBrowserDragAndDrop({
  files,
  folderPath,
  isMobile,
  selectedIds,
  selectedIdsSet,
  clearSelection,
  moveMultipleFilesOrFolders,
}: UseFileBrowserDragAndDropOptions) {
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [internalDrag, setInternalDrag] = useState<InternalDragState | null>(null);

  const dragOverIdRef = useRef<string | null>(null);
  const dragCandidateRef = useRef<{
    file: TeleFile;
    previewVariant: DragPreviewVariant;
    startX: number;
    startY: number;
    offsetX: number;
    offsetY: number;
    width: number;
    height: number;
  } | null>(null);
  const suppressClickRef = useRef(false);

  const draggedItemIds = useFileStore((state) => state.draggedItemIds);
  const isDraggingActive = draggedId !== null || draggedItemIds.length > 0;

  const resetDragState = useCallback(() => {
    activeDragIds = [];
    dragOverIdRef.current = null;
    dragCandidateRef.current = null;
    useFileStore.getState().clearDraggedItemIds();
    setDragOverId(null);
    setDraggedId(null);
    setInternalDrag(null);
  }, []);

  const resolveDraggedIds = useCallback((e?: React.DragEvent): string[] => {
    if (activeDragIds.length > 0) {
      return [...activeDragIds];
    }

    const rawPayloads: string[] = [];
    if (e) {
      try {
        rawPayloads.push(e.dataTransfer.getData(DND_PAYLOAD_MIME));
      } catch {
        // ignore
      }
      try {
        rawPayloads.push(e.dataTransfer.getData("text/plain"));
      } catch {
        // ignore
      }
    }

    for (const raw of rawPayloads) {
      if (!raw) continue;
      try {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed) && parsed.every((id) => typeof id === "string")) {
          return parsed;
        }
      } catch {
        // ignore
      }
    }

    const fallbackIds = useFileStore.getState().draggedItemIds;
    return Array.isArray(fallbackIds) ? [...fallbackIds] : [];
  }, []);

  const resolveTargetFolderPath = useCallback((targetFolderId: string): string | null => {
    if (!targetFolderId) return null;
    if (targetFolderId.startsWith("/")) return targetFolderId;

    const targetFolder = files.find((file) => file.id === targetFolderId);
    if (!targetFolder || !isDirectory(targetFolder)) return null;

    return targetFolder.folderPath === "/"
      ? `/${targetFolder.name}`
      : `${targetFolder.folderPath}/${targetFolder.name}`;
  }, [files]);

  const resolveDropTargetFromElement = useCallback((element: Element | null): string | null => {
    if (!(element instanceof Element)) return null;

    const genericTarget = element.closest("[data-drop-target]");
    const genericDropTarget = genericTarget?.getAttribute("data-drop-target");
    if (genericDropTarget) return genericDropTarget;

    const pathTarget = element.closest("[data-drop-path]");
    const dropPath = pathTarget?.getAttribute("data-drop-path");
    if (dropPath) return dropPath;

    const folderTarget = element.closest("[data-folder-id]");
    return folderTarget?.getAttribute("data-folder-id") ?? null;
  }, []);

  const resolveDropTargetFromEvent = useCallback((e: React.DragEvent): string | null => {
    const target = e.target;
    return target instanceof Element ? resolveDropTargetFromElement(target) : null;
  }, [resolveDropTargetFromElement]);

  const resolveDropTargetFromPoint = useCallback((x: number, y: number): string | null => {
    return resolveDropTargetFromElement(document.elementFromPoint(x, y));
  }, [resolveDropTargetFromElement]);

  const moveDraggedItems = useCallback(async (fileIds: string[], targetFolderId: string | null) => {
    if (fileIds.length === 0 || !targetFolderId) return;
    if (targetFolderId.startsWith(INTERNAL_NAV_TARGET_PREFIX)) {
      window.dispatchEvent(new CustomEvent("teledrive-sidebar-drop-action", {
        detail: {
          target: targetFolderId.slice(INTERNAL_NAV_TARGET_PREFIX.length),
          fileIds,
        },
      }));
      return;
    }
    const targetFolderPath = resolveTargetFolderPath(targetFolderId);
    if (!targetFolderPath) return;

    try {
      await moveMultipleFilesOrFolders(fileIds, targetFolderPath);
      clearSelection();
    } catch (err) {
      console.error("[DnD] moveDraggedItems failed:", err);
    }
  }, [clearSelection, moveMultipleFilesOrFolders, resolveTargetFolderPath]);

  const startInternalDrag = useCallback((
    file: TeleFile,
    previewVariant: DragPreviewVariant,
    clientX: number,
    clientY: number,
    offsetX: number,
    offsetY: number,
    width: number,
    height: number,
  ) => {
    const dragIds = selectedIdsSet.has(file.id) ? [...selectedIds] : [file.id];
    activeDragIds = dragIds;
    useFileStore.getState().setDraggedItemIds(dragIds);
    setDraggedId(file.id);
    setInternalDrag({
      ids: dragIds,
      sourceId: file.id,
      previewFile: file,
      previewVariant,
      x: clientX,
      y: clientY,
      offsetX,
      offsetY,
      width,
      height,
    });
  }, [selectedIds, selectedIdsSet]);

  const handlePointerDown = useCallback((
    e: React.MouseEvent,
    file: TeleFile,
    previewVariant: DragPreviewVariant,
  ) => {
    if (isMobile || e.button !== 0) return;
    const target = e.target;
    if (target instanceof Element && target.closest("[data-no-drag]")) return;

    const currentTarget = e.currentTarget;
    if (!(currentTarget instanceof Element)) return;
    const rect = currentTarget.getBoundingClientRect();

    dragCandidateRef.current = {
      file,
      previewVariant,
      startX: e.clientX,
      startY: e.clientY,
      offsetX: e.clientX - rect.left,
      offsetY: e.clientY - rect.top,
      width: rect.width,
      height: rect.height,
    };
    suppressClickRef.current = false;
  }, [isMobile]);

  // Mirror the values the mousemove/mouseup handler reads into refs so the
  // window listeners can be bound EXACTLY ONCE per mount. Previously this
  // effect included `internalDrag` in its dep array, which changed on every
  // mousemove tick (line ~261 calls setInternalDrag), causing the window
  // listeners to be torn down and re-attached on EVERY drag pixel — easily
  // 60+ listener re-binds per second of dragging.
  const internalDragRef = useRef<InternalDragState | null>(null);
  const moveDraggedItemsRef = useRef(moveDraggedItems);
  const resetDragStateRef = useRef(resetDragState);
  const startInternalDragRef = useRef(startInternalDrag);
  const resolveDropTargetFromPointRef = useRef(resolveDropTargetFromPoint);
  const selectedIdsRef = useRef(selectedIds);
  const selectedIdsSetRef = useRef(selectedIdsSet);

  // Sync refs on every render. Cheap — just one ref assignment each.
  internalDragRef.current = internalDrag;
  moveDraggedItemsRef.current = moveDraggedItems;
  resetDragStateRef.current = resetDragState;
  startInternalDragRef.current = startInternalDrag;
  resolveDropTargetFromPointRef.current = resolveDropTargetFromPoint;
  selectedIdsRef.current = selectedIds;
  selectedIdsSetRef.current = selectedIdsSet;

  useEffect(() => {
    const handleWindowMouseMove = (e: MouseEvent) => {
      const candidate = dragCandidateRef.current;
      const liveDrag = internalDragRef.current;
      if (candidate && !liveDrag) {
        const dx = e.clientX - candidate.startX;
        const dy = e.clientY - candidate.startY;
        if (Math.hypot(dx, dy) < 6) return;

        suppressClickRef.current = true;
        startInternalDragRef.current(
          candidate.file,
          candidate.previewVariant,
          e.clientX,
          e.clientY,
          candidate.offsetX,
          candidate.offsetY,
          candidate.width,
          candidate.height,
        );
      }

      if (!liveDrag && !candidate) return;

      const activeDrag = liveDrag ?? (candidate ? {
        ids: selectedIdsSetRef.current.has(candidate.file.id)
          ? [...selectedIdsRef.current]
          : [candidate.file.id],
        sourceId: candidate.file.id,
      } : null);

      if (!activeDrag || !liveDrag) return;

      const dropTarget = resolveDropTargetFromPointRef.current(e.clientX, e.clientY);
      const validHoverId = dropTarget && !activeDrag.ids.includes(dropTarget) ? dropTarget : null;
      dragOverIdRef.current = validHoverId;
      setDragOverId(validHoverId);
      setInternalDrag((prev) => prev ? { ...prev, x: e.clientX, y: e.clientY } : prev);
    };

    const handleWindowMouseUp = () => {
      dragCandidateRef.current = null;
      const liveDrag = internalDragRef.current;
      if (!liveDrag) return;

      const draggedIds = [...liveDrag.ids];
      const targetFolderId = dragOverIdRef.current;
      resetDragStateRef.current();
      void moveDraggedItemsRef.current(draggedIds, targetFolderId);

      window.setTimeout(() => {
        suppressClickRef.current = false;
      }, 0);
    };

    window.addEventListener("mousemove", handleWindowMouseMove);
    window.addEventListener("mouseup", handleWindowMouseUp);
    return () => {
      window.removeEventListener("mousemove", handleWindowMouseMove);
      window.removeEventListener("mouseup", handleWindowMouseUp);
    };
  }, []);

  const handleDragOverCard = useCallback((e: React.DragEvent, targetId: string) => {
    const internalIds = resolveDraggedIds(e);
    if (internalIds.length === 0) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    if (dragOverIdRef.current !== targetId) {
      dragOverIdRef.current = targetId;
      setDragOverId(targetId);
    }
  }, [resolveDraggedIds]);

  const handleDrop = useCallback(async (e: React.DragEvent, targetFolderId: string) => {
    const fileIds = resolveDraggedIds(e);
    if (fileIds.length === 0) {
      resetDragState();
      return;
    }

    e.preventDefault();
    e.stopPropagation();
    resetDragState();

    if (!targetFolderId) return;
    const targetFolderPath = resolveTargetFolderPath(targetFolderId);
    if (!targetFolderPath) return;

    try {
      await moveMultipleFilesOrFolders(fileIds, targetFolderPath);
      clearSelection();
    } catch (err) {
      console.error("[DnD] handleDrop failed:", err);
    }
  }, [clearSelection, moveMultipleFilesOrFolders, resetDragState, resolveDraggedIds, resolveTargetFolderPath]);

  const handleGlobalDragOver = useCallback((e: React.DragEvent) => {
    const internalDragIds = resolveDraggedIds(e);
    if (internalDragIds.length === 0) return;

    e.preventDefault();
    e.dataTransfer.dropEffect = "move";

    const targetFolderId = resolveDropTargetFromEvent(e);
    if (targetFolderId) {
      if (dragOverIdRef.current !== targetFolderId) {
        dragOverIdRef.current = targetFolderId;
        setDragOverId(targetFolderId);
      }
      return;
    }

    if (dragOverIdRef.current !== null) {
      dragOverIdRef.current = null;
      setDragOverId(null);
    }
  }, [resolveDraggedIds, resolveDropTargetFromEvent]);

  const handleGlobalDrop = useCallback(async (e: React.DragEvent) => {
    const fileIds = resolveDraggedIds(e);
    if (fileIds.length === 0) {
      resetDragState();
      return;
    }

    e.preventDefault();
    e.stopPropagation();

    const folderTargetId = resolveDropTargetFromEvent(e);
    const targetFolderPath = folderTargetId
      ? resolveTargetFolderPath(folderTargetId)
      : folderPath;

    resetDragState();

    if (!targetFolderPath) return;

    try {
      await moveMultipleFilesOrFolders(fileIds, targetFolderPath);
      clearSelection();
    } catch (err) {
      console.error("[DnD] handleGlobalDrop failed:", err);
    }
  }, [clearSelection, folderPath, moveMultipleFilesOrFolders, resetDragState, resolveDraggedIds, resolveDropTargetFromEvent, resolveTargetFolderPath]);

  return useMemo(() => ({
    dragOverId,
    draggedId,
    internalDrag,
    isDraggingActive,
    suppressClickRef,
    handlePointerDown,
    handleDragOverCard,
    handleDrop,
    handleGlobalDragOver,
    handleGlobalDrop,
  }), [
    dragOverId,
    draggedId,
    internalDrag,
    isDraggingActive,
    suppressClickRef,
    handlePointerDown,
    handleDragOverCard,
    handleDrop,
    handleGlobalDragOver,
    handleGlobalDrop,
  ]);
}
