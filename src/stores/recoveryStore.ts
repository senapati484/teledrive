import { create } from "zustand";

interface RecoveryState {
  open: boolean;
  channelId: string | null;
  count: number;
  /** Offer a recovery found by the background scan (does not restore). */
  offer: (channelId: string, count: number) => void;
  /** Manual open from Settings (channel may already be known). */
  openFor: (channelId: string) => void;
  close: () => void;
}

export const useRecoveryStore = create<RecoveryState>((set) => ({
  open: false,
  channelId: null,
  count: 0,
  offer: (channelId, count) => set({ open: true, channelId, count }),
  openFor: (channelId) => set({ open: true, channelId }),
  close: () => set({ open: false }),
}));
