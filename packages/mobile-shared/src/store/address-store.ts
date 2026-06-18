import { create } from 'zustand';
import { apiClient } from '../api/client';
import type { SavedAddress } from '@surewaka/shared';

type AddressState = {
  addresses: SavedAddress[];
  fetched: boolean;
  fetch: (token: string) => Promise<{ error: unknown }>;
  add: (address: SavedAddress) => void;
  update: (id: string, patch: Partial<SavedAddress>) => void;
  remove: (id: string) => void;
};

export const useAddressStore = create<AddressState>((set) => ({
  addresses: [],
  fetched: false,

  fetch: async (token: string) => {
    const response = await apiClient.get<SavedAddress[]>('/api/v1/addresses', token);
    if (!response.error) {
      set({ addresses: response.data ?? [], fetched: true });
    }
    return { error: response.error };
  },

  add: (address) => set((s) => ({ addresses: [...s.addresses, address] })),

  update: (id, patch) =>
    set((s) => ({
      addresses: s.addresses.map((a) => (a.id === id ? { ...a, ...patch } : a)),
    })),

  remove: (id) => set((s) => ({ addresses: s.addresses.filter((a) => a.id !== id) })),
}));
