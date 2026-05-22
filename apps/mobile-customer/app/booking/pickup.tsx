import { useState, useEffect, useCallback, useRef } from 'react';
import {
  View,
  Text,
  TextInput,
  Pressable,
  FlatList,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { useRouter } from 'expo-router';
import * as Location from 'expo-location';
import Mapbox from '@rnmapbox/maps';
import { useBookingStore, searchAddress, reverseGeocode } from '@surewaka/mobile-shared';
import type { LocationSuggestion } from '@surewaka/mobile-shared';

Mapbox.setAccessToken(process.env.EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN ?? '');

const LAGOS_CENTER: [number, number] = [3.3792, 6.5244];

export default function PickupScreen() {
  const router = useRouter();
  const pickup = useBookingStore((s) => s.pickup);
  const setPickup = useBookingStore((s) => s.setPickup);
  const setStep = useBookingStore((s) => s.setStep);

  const [query, setQuery] = useState('');
  const [suggestions, setSuggestions] = useState<LocationSuggestion[]>([]);
  const [searching, setSearching] = useState(false);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [location, setLocation] = useState<[number, number]>(LAGOS_CENTER);
  const [loading, setLoading] = useState(true);
  const [selectedAddress, setSelectedAddress] = useState<string | null>(
    pickup?.address ?? null,
  );
  const [selectedCoords, setSelectedCoords] = useState<[number, number] | null>(
    pickup?.lat && pickup?.lng ? [pickup.lng, pickup.lat] : null,
  );

  const searchTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status === 'granted') {
        const loc = await Location.getCurrentPositionAsync({});
        const coords: [number, number] = [loc.coords.longitude, loc.coords.latitude];
        setLocation(coords);
        if (!selectedCoords) {
          setSelectedCoords(coords);
          const address = await reverseGeocode(loc.coords.latitude, loc.coords.longitude);
          if (address) setSelectedAddress(address);
        }
      }
      setLoading(false);
    })();
  }, []);

  const handleSearch = useCallback(
    (text: string) => {
      setQuery(text);
      if (searchTimeout.current) clearTimeout(searchTimeout.current);

      if (text.length < 3) {
        setSuggestions([]);
        setShowSuggestions(false);
        return;
      }

      setShowSuggestions(true);
      setSearching(true);

      searchTimeout.current = setTimeout(async () => {
        try {
          const results = await searchAddress(text);
          setSuggestions(results);
        } catch {
          setSuggestions([]);
        } finally {
          setSearching(false);
        }
      }, 400);
    },
    [],
  );

  const selectSuggestion = useCallback(
    (suggestion: LocationSuggestion) => {
      const lat = parseFloat(suggestion.lat);
      const lon = parseFloat(suggestion.lon);
      setSelectedCoords([lon, lat]);
      setSelectedAddress(suggestion.display_name);
      setQuery('');
      setShowSuggestions(false);
      setSuggestions([]);
    },
    [],
  );

  const handleMapPress = useCallback(
    async (feature: Parameters<NonNullable<React.ComponentProps<typeof Mapbox.MapView>['onPress']>>[0]) => {
      const coords = feature.geometry.coordinates as [number, number];
      setSelectedCoords(coords);

      const address = await reverseGeocode(coords[1], coords[0]);
      if (address) setSelectedAddress(address);
    },
    [],
  );

  const handleConfirm = () => {
    if (!selectedCoords || !selectedAddress) {
      Alert.alert('Select Location', 'Please select a pickup location on the map');
      return;
    }

    const addressParts = selectedAddress.split(',');
    const city = addressParts.length > 1 ? addressParts[addressParts.length - 3]?.trim() ?? '' : '';

    setPickup({
      address: selectedAddress,
      city,
      state: '',
      lat: selectedCoords[1],
      lng: selectedCoords[0],
    });
    setStep(1);
    router.push('/booking/dropoff');
  };

  if (loading) {
    return (
      <View className="flex-1 bg-white items-center justify-center">
        <ActivityIndicator size="large" color="#16a34a" />
        <Text className="text-gray-500 mt-4">Getting your location...</Text>
      </View>
    );
  }

  return (
    <View className="flex-1 bg-white">
      <View className="flex-1">
        <Mapbox.MapView
          styleURL={Mapbox.StyleURL.Street}
          style={{ flex: 1 }}
          onPress={handleMapPress}
        >
          <Mapbox.Camera
            zoomLevel={14}
            centerCoordinate={selectedCoords ?? location}
            animationMode="flyTo"
            animationDuration={1000}
          />
          {selectedCoords && (
            <Mapbox.PointAnnotation
              id="pickup"
              coordinate={selectedCoords}
            >
              <View className="w-10 h-10 bg-primary/20 rounded-full items-center justify-center">
                <View className="w-4 h-4 bg-primary rounded-full border-2 border-white" />
              </View>
            </Mapbox.PointAnnotation>
          )}
        </Mapbox.MapView>
      </View>

      <View className="absolute top-12 left-4 right-4 z-10">
        <View className="bg-white rounded-xl shadow-lg overflow-hidden">
          <View className="flex-row items-center px-4 py-3 border-b border-gray-100">
            <View className="w-3 h-3 rounded-full bg-primary mr-3" />
            <TextInput
              value={query}
              onChangeText={handleSearch}
              placeholder="Search pickup address"
              className="flex-1 text-base"
              placeholderClassName="text-gray-400"
              onFocus={() => suggestions.length > 0 && setShowSuggestions(true)}
            />
            {searching && <ActivityIndicator size="small" color="#16a34a" />}
          </View>

          {showSuggestions && suggestions.length > 0 && (
            <FlatList
              data={suggestions}
              keyExtractor={(item) => item.place_id}
              keyboardShouldPersistTaps="always"
              style={{ maxHeight: 200 }}
              renderItem={({ item }) => (
                <Pressable
                  onPress={() => selectSuggestion(item)}
                  className="px-4 py-3 border-b border-gray-50"
                >
                  <Text className="text-sm text-gray-900" numberOfLines={2}>
                    {item.display_name}
                  </Text>
                </Pressable>
              )}
            />
          )}
        </View>
      </View>

      {selectedAddress && !showSuggestions && (
        <View className="absolute bottom-24 left-4 right-4 z-10">
          <View className="bg-white rounded-xl shadow-lg p-4">
            <Text className="text-xs text-gray-500 uppercase mb-1">Pickup Location</Text>
            <Text className="text-sm text-gray-900" numberOfLines={2}>
              {selectedAddress}
            </Text>
          </View>
        </View>
      )}

      <View className="px-4 pb-6 pt-2 bg-white">
        <Pressable
          onPress={handleConfirm}
          className="bg-primary py-4 rounded-xl items-center"
        >
          <Text className="text-white text-lg font-semibold">
            Confirm Pickup
          </Text>
        </Pressable>
      </View>
    </View>
  );
}
