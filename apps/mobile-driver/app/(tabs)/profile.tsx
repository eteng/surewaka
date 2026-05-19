import { Text, View, StyleSheet } from 'react-native';

export default function DriverProfileScreen() {
  return (
    <View style={styles.container}>
      <Text style={styles.heading}>Driver Profile</Text>
      <Text style={styles.hint}>Sign in to manage your driver account</Text>
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
  heading: {
    fontSize: 20,
    fontWeight: '600',
    marginBottom: 8,
  },
  hint: {
    fontSize: 14,
    color: '#6b7280',
  },
});
