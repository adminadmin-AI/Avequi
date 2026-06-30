import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface UiState {
  /** mini-sidebar (só ícones) no desktop — persistido (#304) */
  sidebarCollapsed: boolean;
  toggleSidebarCollapsed: () => void;
  setSidebarCollapsed: (v: boolean) => void;

  /** drawer da sidebar no mobile (< lg) */
  mobileNavOpen: boolean;
  setMobileNavOpen: (v: boolean) => void;

  /** command palette (Ctrl+K) (#305) */
  commandOpen: boolean;
  setCommandOpen: (v: boolean) => void;
}

export const useUiStore = create<UiState>()(
  persist(
    (set) => ({
      sidebarCollapsed: false,
      toggleSidebarCollapsed: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
      setSidebarCollapsed: (v) => set({ sidebarCollapsed: v }),

      mobileNavOpen: false,
      setMobileNavOpen: (v) => set({ mobileNavOpen: v }),

      commandOpen: false,
      setCommandOpen: (v) => set({ commandOpen: v }),
    }),
    {
      name: 'avequi:ui',
      // só a preferência de colapso persiste; estados efêmeros não
      partialize: (s) => ({ sidebarCollapsed: s.sidebarCollapsed }),
    },
  ),
);
