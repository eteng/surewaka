import { create } from 'zustand';
import { apiClient } from '../api/client';
import type { SavedRecipient } from '@surewaka/shared';

type RecipientState = {
  recipients: SavedRecipient[];
  fetched: boolean;
  fetch: (token: string) => Promise<{ error: unknown }>;
  add: (recipient: SavedRecipient) => void;
  update: (id: string, patch: Partial<SavedRecipient>) => void;
  remove: (id: string) => void;
};

export const useRecipientStore = create<RecipientState>((set) => ({
  recipients: [],
  fetched: false,

  fetch: async (token: string) => {
    const response = await apiClient.get<SavedRecipient[]>('/api/v1/recipients', token);
    if (!response.error) {
      set({ recipients: response.data ?? [], fetched: true });
    }
    return { error: response.error };
  },

  add: (recipient) => set((s) => ({ recipients: [...s.recipients, recipient] })),

  update: (id, patch) =>
    set((s) => ({
      recipients: s.recipients.map((r) => (r.id === id ? { ...r, ...patch } : r)),
    })),

  remove: (id) => set((s) => ({ recipients: s.recipients.filter((r) => r.id !== id) })),
}));
