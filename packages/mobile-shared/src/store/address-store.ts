import { create } from 'zustand';
import { supabase } from '../supabase';
import type { SavedAddress } from '@surewaka/shared';

type AddressState = {
  addresses: SavedAddress[];
  fetched: boolean;
  fetch: () => Promise<{ error: unknown }>;
  add: (address: SavedAddress) => void;
  update: (id: string, patch: Partial<SavedAddress>) => void;
  remove: (id: string) => void;
};

export const useAddressStore = create<AddressState>((set) => ({
  addresses: [],
  fetched: false,

  fetch: async () => {
    const { data, error } = await supabase
      .from('user_saved_addresses')
      .select('id, label, address_text, city, state, lat, lng, created_at')
      .order('created_at', { ascending: true });
    if (!error) set({ addresses: (data ?? []) as SavedAddress[], fetched: true });
    return { error };
  },

  add: (address) =>
    set((s) => ({ addresses: [...s.addresses, address] })),

  update: (id, patch) =>
    set((s) => ({
      addresses: s.addresses.map((a) => (a.id === id ? { ...a, ...patch } : a)),
    })),

  remove: (id) =>
    set((s) => ({ addresses: s.addresses.filter((a) => a.id !== id) })),
}));
