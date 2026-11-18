import { create } from "zustand";
import { persist } from "zustand/middleware";

/** Multi-device sync poll interval in milliseconds (0 = Manual only). */
export type SyncIntervalMs = 0 | 15000 | 30000 | 60000 | 300000;

interface UIState {
  viewMode: "grid" | "list";
  theme: "light" | "dark" | "system";
  sidebarOpen: boolean;
  sortBy: string;
  filterType: string;
  syncIntervalMs: SyncIntervalMs;
  setViewMode: (viewMode: "grid" | "list") => void;
  setTheme: (theme: "light" | "dark" | "system") => void;
  toggleSidebar: () => void;
  setSidebarOpen: (open: boolean) => void;
  setSortBy: (sortBy: string) => void;
  setFilterType: (filterType: string) => void;
  setSyncIntervalMs: (syncIntervalMs: SyncIntervalMs) => void;
}

export const useUIStore = create<UIState>()(
  persist(
    (set) => ({
      viewMode: "grid",
      theme: "system",
      sidebarOpen: false,
      sortBy: "name_asc",
      filterType: "All",
      syncIntervalMs: 30000,
      setViewMode: (viewMode) => set({ viewMode }),
      setTheme: (theme) => set({ theme }),
      toggleSidebar: () => set((state) => ({ sidebarOpen: !state.sidebarOpen })),
      setSidebarOpen: (sidebarOpen) => set({ sidebarOpen }),
      setSortBy: (sortBy) => set({ sortBy }),
      setFilterType: (filterType) => set({ filterType }),
      setSyncIntervalMs: (syncIntervalMs) => set({ syncIntervalMs }),
    }),
    {
      name: "teledrive-ui-storage",
    }
  )
);
