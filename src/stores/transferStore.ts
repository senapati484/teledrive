import { create } from "zustand";

export type DownloadStatus =
  | "downloading"
  | "paused"
  | "saving"
  | "done"
  | "error"
  | "cancelled";

export interface DownloadItem {
  id: string;
  name: string;
  size: number;
  /** 0–100. */
  progress: number;
  receivedBytes: number;
  /** Live transfer speed in bytes/second (undefined when paused/idle). */
  speed?: number;
  /** Estimated seconds remaining (undefined when unknown). */
  eta?: number;
  status: DownloadStatus;
  error?: string;
  channelId: string;
  messageId: number;
}

interface TransferState {
  downloads: DownloadItem[];
  addDownload: (item: DownloadItem) => void;
  updateDownload: (id: string, patch: Partial<DownloadItem>) => void;
  removeDownload: (id: string) => void;
  /** Drop completed/failed/cancelled entries so the panel can be dismissed. */
  clearFinishedDownloads: () => void;
}

export const useTransferStore = create<TransferState>((set) => ({
  downloads: [],
  addDownload: (item) =>
    set((state) => ({ downloads: [...state.downloads, item] })),
  updateDownload: (id, patch) =>
    set((state) => ({
      downloads: state.downloads.map((item) =>
        item.id === id ? { ...item, ...patch } : item
      ),
    })),
  removeDownload: (id) =>
    set((state) => ({
      downloads: state.downloads.filter((item) => item.id !== id),
    })),
  clearFinishedDownloads: () =>
    set((state) => ({
      downloads: state.downloads.filter(
        (item) =>
          item.status === "downloading" ||
          item.status === "paused" ||
          item.status === "saving"
      ),
    })),
}));
