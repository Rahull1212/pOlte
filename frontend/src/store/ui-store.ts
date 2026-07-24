import { create } from "zustand";

interface UiState {
  sidebarCollapsed: boolean;
  toggleSidebar: () => void;
  campaignFilter: { status?: string; priority?: string };
  setCampaignFilter: (filter: UiState["campaignFilter"]) => void;
}

export const useUiStore = create<UiState>((set) => ({
  sidebarCollapsed: false,
  toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
  campaignFilter: {},
  setCampaignFilter: (campaignFilter) => set({ campaignFilter }),
}));
