import { Text, View, StyleSheet, Pressable } from 'react-native';
import { useLocalSearchParams } from 'expo-router';

export default function DeliveryDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();

  return (
    <View style={styles.container}>
      <Text style={styles.heading}>Delivery #{id}</Text>

      <View style={styles.section}>
        <Text style={styles.label}>Pickup</Text>
        <Text style={styles.value}>—</Text>
      </View>

      <View style={styles.section}>
        <Text style={styles.label}>Drop-off</Text>
        <Text style={styles.value}>—</Text>
      </View>

      <View style={styles.actions}>
        <Pressable style={styles.navigateButton}>
          <Text style={styles.navigateButtonText}>Navigate</Text>
        </Pressable>
        <Pressable style={styles.confirmButton}>
          <Text style={styles.confirmButtonText}>Confirm Pickup</Text>
        </Pressable>
      </View>
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
    marginBottom: 24,
  },
  section: {
    marginBottom: 16,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#f3f4f6',
  },
  label: {
    fontSize: 12,
    color: '#6b7280',
    textTransform: 'uppercase',
    marginBottom: 4,
  },
  value: {
    fontSize: 16,
  },
  actions: {
    marginTop: 'auto',
    gap: 12,
  },
  navigateButton: {
    backgroundColor: '#2563eb',
    padding: 16,
    borderRadius: 12,
    alignItems: 'center',
  },
  navigateButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  confirmButton: {
    backgroundColor: '#16a34a',
    padding: 16,
    borderRadius: 12,
    alignItems: 'center',
  },
  confirmButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
});
