import { useEffect } from 'react';
import { View, Text, Pressable, ScrollView, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';
import { useWalletStore, useAuthStore } from '@surewaka/mobile-shared';

function formatNaira(kobo: number) {
  return `₦${(kobo / 100).toLocaleString('en-NG', { minimumFractionDigits: 2 })}`;
}

export default function PaymentsScreen() {
  const router = useRouter();
  const session = useAuthStore((s) => s.session);
  const { balance, dvaBank, dvaAccountNo, transactions, loading, fetchBalance, fetchTransactions, fetchDva } = useWalletStore();

  useEffect(() => {
    if (!session?.access_token) return;
    fetchBalance(session.access_token);
    fetchTransactions(session.access_token);
    fetchDva(session.access_token);
  }, [session?.access_token]);

  return (
    <ScrollView className="flex-1 bg-white px-6 pt-6">
      <View className="flex-row items-center mb-6">
        <Pressable onPress={() => router.back()} className="mr-4">
          <Text className="text-primary text-lg">←</Text>
        </Pressable>
        <Text className="text-2xl font-bold text-gray-900">Wallet</Text>
      </View>

      {/* Balance card */}
      <View className="bg-primary rounded-xl p-5 mb-4">
        <Text className="text-white text-sm font-medium mb-1">Wallet Balance</Text>
        {loading ? (
          <ActivityIndicator color="white" />
        ) : (
          <Text className="text-white text-3xl font-bold">{formatNaira(balance)}</Text>
        )}
        <Pressable
          onPress={() => router.push('/wallet/topup')}
          className="bg-white mt-4 rounded-lg py-2 items-center"
        >
          <Text className="text-primary font-semibold text-sm">Top Up Wallet</Text>
        </Pressable>
      </View>

      {/* DVA card */}
      {dvaAccountNo ? (
        <View className="bg-gray-50 border border-gray-200 rounded-xl p-4 mb-6">
          <Text className="text-xs text-gray-500 mb-1 uppercase tracking-wide">Bank Transfer</Text>
          <Text className="text-base font-bold text-gray-900">{dvaAccountNo}</Text>
          <Text className="text-sm text-gray-500">{dvaBank}</Text>
          <Text className="text-xs text-gray-400 mt-2">Transfer any amount to fund your wallet instantly</Text>
        </View>
      ) : null}

      {/* Recent transactions */}
      <View className="flex-row items-center justify-between mb-3">
        <Text className="text-base font-semibold text-gray-900">Recent Transactions</Text>
        <Pressable onPress={() => router.push('/wallet/transactions')}>
          <Text className="text-sm text-primary">View all</Text>
        </Pressable>
      </View>

      {transactions.slice(0, 5).map((txn) => (
        <View key={txn.id} className="flex-row items-center justify-between py-3 border-b border-gray-100">
          <View className="flex-1">
            <Text className="text-sm font-medium text-gray-900">{txn.description ?? txn.type}</Text>
            <Text className="text-xs text-gray-400">{new Date(txn.createdAt).toLocaleDateString('en-NG')}</Text>
          </View>
          <Text className={`text-sm font-bold ${txn.amount > 0 ? 'text-green-600' : 'text-red-500'}`}>
            {txn.amount > 0 ? '+' : ''}{formatNaira(Math.abs(txn.amount))}
          </Text>
        </View>
      ))}

      {transactions.length === 0 && !loading && (
        <Text className="text-sm text-gray-400 text-center py-6">No transactions yet</Text>
      )}
    </ScrollView>
  );
}
