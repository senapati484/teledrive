import { create } from "zustand";
import { clearCachedFilesSnapshot } from "../lib/storage/localIndexCache";

interface AuthState {
  isAuthenticated: boolean;
  phoneNumber: string | null;
  sessionString: string | null;
  apiId: number | null;
  apiHash: string | null;
  setCredentials: (apiId: number, apiHash: string) => void;
  setSession: (sessionString: string, phoneNumber: string) => void;
  logout: (options?: { preserveCache?: boolean }) => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  isAuthenticated: false,
  phoneNumber: null,
  sessionString: null,
  apiId: null,
  apiHash: null,
  setCredentials: (apiId, apiHash) => set({ apiId, apiHash }),
  setSession: (sessionString, phoneNumber) =>
    set({ sessionString, phoneNumber, isAuthenticated: true }),
  logout: (options) => {
    if (!options?.preserveCache) {
      void clearCachedFilesSnapshot();
    }
    set({
      sessionString: null,
      phoneNumber: null,
      isAuthenticated: false,
      apiId: null,
      apiHash: null,
    });
  },
}));
