import { create } from "zustand";
import { QueueItem } from "../../shared/types";

interface QueueState {
  items: QueueItem[];
  isLoading: boolean;
  searchQuery: string;
  setItems: (items: QueueItem[]) => void;
  addItem: (item: QueueItem) => void;
  removeItem: (itemId: string) => void;
  updateItem: (itemId: string, patch: Partial<QueueItem>) => void;
  setSearchQuery: (query: string) => void;
  setLoading: (loading: boolean) => void;
}

export const useQueueStore = create<QueueState>((set) => ({
  items: [],
  isLoading: true,
  searchQuery: "",

  setItems: (items) => set({ items }),

  addItem: (item) =>
    set((state) => ({
      items: [item, ...state.items],
    })),

  removeItem: (itemId) =>
    set((state) => ({
      items: state.items.filter((i) => i.id !== itemId),
    })),

  updateItem: (itemId, patch) =>
    set((state) => ({
      items: state.items.map((i) => (i.id === itemId ? { ...i, ...patch } : i)),
    })),

  setSearchQuery: (searchQuery) => set({ searchQuery }),
  setLoading: (isLoading) => set({ isLoading }),
}));
