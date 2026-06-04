import { useEffect, useState } from 'react';
import { View, Text, Pressable, FlatList, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';
import { useWalletStore, useAuthStore } from '@surewaka/mobile-shared';
import type { WalletTransaction } from '@surewaka/mobile-shared';

type Filter = 'all' | 'fund' | 'escrow_hold' | 'refund';

const FILTERS: { label: string; value: Filter }[] = [
  { label: 'All', value: 'all' },
  { label: 'Top-ups', value: 'fund' },
  { label: 'Bookings', value: 'escrow_hold' },
  { label: 'Refunds', value: 'refund' },
];

function formatNaira(kobo: number) {
  return `₦${(Math.abs(kobo) / 100).toLocaleString('en-NG', { minimumFractionDigits: 2 })}`;
}

export default function TransactionsScreen() {
  const router = useRouter();
  const session = useAuthStore((s) => s.session);
  const { transactions, loading, fetchTransactions } = useWalletStore();
  const [filter, setFilter] = useState<Filter>('all');

  useEffect(() => {
    if (session?.access_token) fetchTransactions(session.access_token);
  }, [session?.access_token]);

  const filtered = filter === 'all'
    ? transactions
    : transactions.filter((t) => t.type === filter);

  function renderItem({ item }: { item: WalletTransaction }) {
    return (
      <View className="flex-row items-center justify-between py-3 border-b border-gray-100">
        <View className="flex-1">
          <Text className="text-sm font-medium text-gray-900">
            {item.description ?? item.type}
          </Text>
          <Text className="text-xs text-gray-400">
            {new Date(item.createdAt).toLocaleDateString('en-NG')}
          </Text>
        </View>
        <Text className={`text-sm font-bold ml-4 ${item.amount > 0 ? 'text-green-600' : 'text-red-500'}`}>
          {item.amount > 0 ? '+' : '-'}{formatNaira(item.amount)}
        </Text>
      </View>
    );
  }

  return (
    <View className="flex-1 bg-white">
      <View className="px-6 pt-6 pb-4">
        <View className="flex-row items-center mb-4">
          <Pressable onPress={() => router.back()} className="mr-4">
            <Text className="text-primary text-lg">←</Text>
          </Pressable>
          <Text className="text-2xl font-bold text-gray-900">Transactions</Text>
        </View>
        <View className="flex-row gap-2">
          {FILTERS.map((f) => (
            <Pressable
              key={f.value}
              onPress={() => setFilter(f.value)}
              className={`px-3 py-1.5 rounded-full border ${
                filter === f.value ? 'bg-primary border-primary' : 'border-gray-200'
              }`}
            >
              <Text className={`text-xs font-medium ${filter === f.value ? 'text-white' : 'text-gray-600'}`}>
                {f.label}
              </Text>
            </Pressable>
          ))}
        </View>
      </View>

      {loading ? (
        <ActivityIndicator className="mt-8" />
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          contentContainerStyle={{ paddingHorizontal: 24 }}
          ListEmptyComponent={
            <Text className="text-sm text-gray-400 text-center py-12">No transactions found</Text>
          }
        />
      )}
    </View>
  );
}
