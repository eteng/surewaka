import { Text, View, StyleSheet } from 'react-native';

export default function ActiveDeliveryScreen() {
  return (
    <View style={styles.container}>
      <Text style={styles.empty}>No active delivery</Text>
      <Text style={styles.hint}>Accept a job to start delivering</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
    backgroundColor: '#fff',
  },
  empty: {
    fontSize: 18,
    fontWeight: '600',
    marginBottom: 8,
  },
  hint: {
    fontSize: 14,
    color: '#6b7280',
  },
});
