import { create } from 'zustand';

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

const API_URL = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:4000';

async function apiFetch<T>(path: string, token: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...options?.headers,
    },
  });
  if (!res.ok) throw new Error(`API error ${res.status}`);
  const json = (await res.json()) as { data: T };
  return json.data;
}

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
      const data = await apiFetch<{ balance: number; currency: string }>(
        '/api/v1/wallet/balance',
        token,
      );
      set({ balance: data.balance, currency: data.currency });
    } finally {
      set({ loading: false });
    }
  },

  fetchTransactions: async (token) => {
    const data = await apiFetch<WalletTransaction[]>('/api/v1/wallet/transactions', token);
    set({ transactions: data });
  },

  fetchDva: async (token) => {
    try {
      const data = await apiFetch<{ bank: string; account_number: string }>(
        '/api/v1/wallet/dva',
        token,
      );
      set({ dvaBank: data.bank, dvaAccountNo: data.account_number });
      return data;
    } catch {
      return null;
    }
  },

  reset: () => set({ balance: 0, transactions: [], dvaBank: null, dvaAccountNo: null }),
}));
