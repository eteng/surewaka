import { Text, View, StyleSheet } from 'react-native';

export default function EarningsScreen() {
  return (
    <View style={styles.container}>
      <Text style={styles.heading}>Earnings</Text>
      <View style={styles.card}>
        <Text style={styles.cardLabel}>This week</Text>
        <Text style={styles.cardValue}>₦0.00</Text>
      </View>
      <Text style={styles.hint}>Complete deliveries to start earning</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 24,
    backgroundColor: '#fff',
  },
  heading: {
    fontSize: 20,
    fontWeight: '600',
    marginBottom: 16,
  },
  card: {
    backgroundColor: '#f0fdf4',
    padding: 20,
    borderRadius: 12,
    marginBottom: 16,
  },
  cardLabel: {
    fontSize: 14,
    color: '#6b7280',
    marginBottom: 4,
  },
  cardValue: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#16a34a',
  },
  hint: {
    fontSize: 14,
    color: '#9ca3af',
  },
});
