import { create } from "zustand";

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
      try {
        localStorage.removeItem("teledrive_cached_files");
      } catch (err) {
        console.warn("[authStore] Failed to clear cached files on logout:", err);
      }
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
