import { create } from 'zustand';
import { createAuthClient } from '../api/client';

export type WalletTransaction = {
  id: string;
  type: string;
  amount: number;
  balanceAfter: number;
  description: string | null;
  reference: string | null;
  createdAt: string;
};

export type WalletState = {
  balance: number;
  currency: string;
  dvaBank: string | null;
  dvaAccountNo: string | null;
  transactions: WalletTransaction[];
  loading: boolean;
  fetchBalance: (token: string) => Promise<void>;
  fetchTransactions: (token: string) => Promise<void>;
  fetchDva: (token: string) => Promise<{ bank: string; account_number: string } | null>;
  reset: () => void;
};

export const useWalletStore = create<WalletState>((set) => ({
  balance: 0,
  currency: 'NGN',
  dvaBank: null,
  dvaAccountNo: null,
  transactions: [],
  loading: false,

  fetchBalance: async (token) => {
    set({ loading: true });
    try {
      const { data } = await createAuthClient(token).get<{ balance: number; currency: string }>(
        '/api/v1/wallet/balance',
      );
      if (data) set({ balance: data.balance, currency: data.currency });
    } finally {
      set({ loading: false });
    }
  },

  fetchTransactions: async (token) => {
    set({ loading: true });
    try {
      const { data } = await createAuthClient(token).get<WalletTransaction[]>(
        '/api/v1/wallet/transactions',
      );
      if (data) set({ transactions: data });
    } finally {
      set({ loading: false });
    }
  },

  fetchDva: async (token) => {
    try {
      const { data } = await createAuthClient(token).get<{ bank: string; account_number: string }>(
        '/api/v1/wallet/dva',
      );
      if (data) {
        set({ dvaBank: data.bank, dvaAccountNo: data.account_number });
        return data;
      }
      return null;
    } catch {
      return null;
    }
  },

  reset: () =>
    set({ balance: 0, currency: 'NGN', transactions: [], dvaBank: null, dvaAccountNo: null, loading: false }),
}));
