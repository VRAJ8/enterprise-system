import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type Theme = 'light' | 'dark' | 'system'

function applyTheme(theme: Theme) {
  const dark = theme === 'dark' || (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)
  document.documentElement.classList.toggle('dark', dark)
  try {
    localStorage.setItem('ph-theme', theme)
  } catch {
    /* ignore */
  }
}

export interface CreateTaskDefaults {
  projectId?: string
  statusId?: string
  parentId?: string
  assigneeId?: string | null
  dueDate?: string | null
  milestoneId?: string | null
}

interface UIState {
  theme: Theme
  setTheme: (t: Theme) => void
  sidebarCollapsed: boolean
  toggleSidebar: () => void
  mobileNavOpen: boolean
  setMobileNavOpen: (open: boolean) => void
  commandOpen: boolean
  setCommandOpen: (open: boolean) => void
  /** Global "new task" dialog (C shortcut, buttons across the app). null = closed. */
  createTask: CreateTaskDefaults | null
  openCreateTask: (defaults?: CreateTaskDefaults) => void
  closeCreateTask: () => void
  shortcutsOpen: boolean
  setShortcutsOpen: (open: boolean) => void
}

export const useUI = create<UIState>()(
  persist(
    (set) => ({
      theme: 'system',
      setTheme: (theme) => {
        applyTheme(theme)
        set({ theme })
      },
      sidebarCollapsed: false,
      toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
      mobileNavOpen: false,
      setMobileNavOpen: (mobileNavOpen) => set({ mobileNavOpen }),
      commandOpen: false,
      setCommandOpen: (commandOpen) => set({ commandOpen }),
      createTask: null,
      openCreateTask: (defaults = {}) => set({ createTask: defaults }),
      closeCreateTask: () => set({ createTask: null }),
      shortcutsOpen: false,
      setShortcutsOpen: (shortcutsOpen) => set({ shortcutsOpen }),
    }),
    {
      name: 'ph-ui',
      partialize: (s) => ({ theme: s.theme, sidebarCollapsed: s.sidebarCollapsed }),
      onRehydrateStorage: () => (state) => state && applyTheme(state.theme),
    },
  ),
)

// Follow OS theme changes when in "system" mode
if (typeof window !== 'undefined') {
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (useUI.getState().theme === 'system') applyTheme('system')
  })
}
