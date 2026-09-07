import { useState, useEffect, useCallback, useRef } from 'react';
import {
  View,
  Animated,
  Text,
  TextInput,
  Pressable,
  FlatList,
  ActivityIndicator,
  Alert,
  ScrollView,
  Keyboard,
  Platform,
  StyleSheet,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Location from 'expo-location';
import Mapbox from '@rnmapbox/maps';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '@clerk/expo';
import * as Sentry from '@sentry/react-native';
import {
  useBookingStore,
  searchAddress,
  reverseGeocode,
  createAddressesClient,
  useSavedAddresses,
} from '@surewaka/mobile-shared';
import type { LocationSuggestion } from '@surewaka/mobile-shared';
import type { SavedAddress, RecentLocation } from '@surewaka/shared';

Mapbox.setAccessToken(process.env.EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN ?? '');

const LAGOS_CENTER: [number, number] = [3.3792, 6.5244];
const SAVE_LABELS = ['Home', 'Office', 'Work', 'Other'];
const ADDRESS_CAP = 25;

export default function PickupScreen() {
  const router = useRouter();
  const { getToken } = useAuth();
  const pickup = useBookingStore((s) => s.pickup);
  const setPickup = useBookingStore((s) => s.setPickup);
  const setStep = useBookingStore((s) => s.setStep);
  const [token, setToken] = useState('');
  const client = createAddressesClient(token);

  // Stabilize getToken — @clerk/expo v4 returns a new reference each render
  const getTokenRef = useRef(getToken);
  getTokenRef.current = getToken;

  const [query, setQuery] = useState('');
  const [suggestions, setSuggestions] = useState<LocationSuggestion[]>([]);
  const [searching, setSearching] = useState(false);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [location, setLocation] = useState<[number, number]>(LAGOS_CENTER);
  const [loading, setLoading] = useState(true);
  const [selectedAddress, setSelectedAddress] = useState<string | null>(pickup?.address ?? null);
  const [selectedCoords, setSelectedCoords] = useState<[number, number] | null>(
    pickup?.lat && pickup?.lng ? [pickup.lng, pickup.lat] : null,
  );
  const [selectedCity, setSelectedCity] = useState(pickup?.city ?? '');
  const [selectedState, setSelectedState] = useState(pickup?.state ?? '');

  const {
    savedAddresses,
    recentLocations,
    state: addrLoadState,
    reload,
    addSaved,
  } = useSavedAddresses(token, 'booking/pickup');
  const [savedLabel, setSavedLabel] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  const insets = useSafeAreaInsets();
  const searchTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const panelBottom = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const show = Keyboard.addListener(showEvent, (e) => {
      Animated.timing(panelBottom, {
        toValue: e.endCoordinates.height,
        duration: Platform.OS === 'ios' ? e.duration : 150,
        useNativeDriver: false,
      }).start();
    });
    const hide = Keyboard.addListener(hideEvent, (e) => {
      Animated.timing(panelBottom, {
        toValue: 0,
        duration: Platform.OS === 'ios' ? e.duration : 150,
        useNativeDriver: false,
      }).start();
    });
    return () => { show.remove(); hide.remove(); };
  }, [panelBottom]);

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
          if (address) {
            setSelectedAddress(address.display_name);
            setSelectedCity(address.address?.city ?? address.address?.town ?? address.address?.suburb ?? address.address?.county ?? '');
            setSelectedState(address.address?.state ?? '');
          }
        }
      }
      setLoading(false);
    })();
  }, []);

  useEffect(() => {
    getTokenRef.current().then((t) => { if (t) setToken(t); });
  }, []);

  const handleSearch = useCallback(
    (text: string) => {
      setQuery(text);
      if (searchTimeout.current) clearTimeout(searchTimeout.current);

      if (text.length < 3) {
        setSuggestions([]);
        setShowSuggestions(true);
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

  const selectSuggestion = useCallback((suggestion: LocationSuggestion) => {
    const lat = parseFloat(suggestion.lat);
    const lon = parseFloat(suggestion.lon);
    setSelectedCoords([lon, lat]);
    setSelectedAddress(suggestion.display_name);
    setSelectedCity(suggestion.address?.city ?? suggestion.address?.town ?? suggestion.address?.suburb ?? suggestion.address?.county ?? '');
    setSelectedState(suggestion.address?.state ?? '');
    setSavedLabel(null);
    setSaveError(null);
    setQuery('');
    setShowSuggestions(false);
    setSuggestions([]);
  }, []);

  const selectSavedAddress = useCallback((address: SavedAddress) => {
    setSelectedCoords([address.lng, address.lat]);
    setSelectedAddress(address.address_text);
    setSelectedCity(address.city);
    setSelectedState(address.state);
    setSavedLabel(null);
    setSaveError(null);
    setShowSuggestions(false);
  }, []);

  const selectRecentLocation = useCallback((recent: RecentLocation) => {
    setSelectedCoords([recent.lng, recent.lat]);
    setSelectedAddress(recent.address_text);
    setSelectedCity(recent.city);
    setSelectedState(recent.state);
    setSavedLabel(null);
    setSaveError(null);
    setShowSuggestions(false);
  }, []);

  const handleMapPress = useCallback(
    async (feature: Parameters<NonNullable<React.ComponentProps<typeof Mapbox.MapView>['onPress']>>[0]) => {
      const coords = feature.geometry.coordinates as [number, number];
      setSelectedCoords(coords);
      setSavedLabel(null);
      setSaveError(null);

      const address = await reverseGeocode(coords[1], coords[0]);
      if (address) {
        setSelectedAddress(address.display_name);
        setSelectedCity(address.address?.city ?? address.address?.town ?? address.address?.suburb ?? address.address?.county ?? '');
        setSelectedState(address.address?.state ?? '');
      }
    },
    [],
  );

  const handleSaveNudge = useCallback(
    async (nudgeLabel: string) => {
      if (!selectedAddress || !selectedCoords) return;
      try {
        const result = await client.create({
          label:        nudgeLabel,
          address_text: selectedAddress,
          city:         selectedCity,
          state:        selectedState,
          lat:          selectedCoords[1],
          lng:          selectedCoords[0],
        });
        if (!result.error) {
          setSavedLabel(nudgeLabel);
          setSaveError(null);
          addSaved(result.data!);
        } else {
          setSaveError("Couldn't save — try again");
          Sentry.captureException(
            result.error instanceof Error
              ? result.error
              : new Error(JSON.stringify(result.error)),
            {
              tags:  { app: 'mobile-customer', screen: 'booking/pickup' },
              extra: { op: 'create' },
            },
          );
        }
      } catch (e) {
        setSaveError("Couldn't save — try again");
        Sentry.captureException(e, {
          tags:  { app: 'mobile-customer', screen: 'booking/pickup' },
          extra: { op: 'create' },
        });
      }
    },
    [selectedAddress, selectedCoords, selectedCity, selectedState, token, client, addSaved],
  );

  const handleConfirm = () => {
    if (!selectedCoords || !selectedAddress) {
      Alert.alert('Select Location', 'Please select a pickup location on the map');
      return;
    }

    setPickup({
      address: selectedAddress,
      city:    selectedCity,
      state:   selectedState,
      lat:     selectedCoords[1],
      lng:     selectedCoords[0],
    });
    setStep(1);

    client
      .upsertRecent({
        address_text: selectedAddress,
        city:         selectedCity,
        state:        selectedState,
        lat:          selectedCoords[1],
        lng:          selectedCoords[0],
      })
      .catch((e) =>
        Sentry.captureException(e, {
          tags:  { app: 'mobile-customer', screen: 'booking/pickup' },
          extra: { op: 'upsertRecent' },
        }),
      );

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

  const showEmptySearch = showSuggestions && query.length < 3;
  const showAutoComplete = showSuggestions && query.length >= 3 && suggestions.length > 0;

  return (
    <View className="flex-1 bg-white">
      <Mapbox.MapView
        styleURL={Mapbox.StyleURL.Street}
        style={StyleSheet.absoluteFill}
        onPress={handleMapPress}
      >
          <Mapbox.Camera
            zoomLevel={14}
            centerCoordinate={selectedCoords ?? location}
            animationMode="flyTo"
            animationDuration={1000}
          />
          {selectedCoords && (
            <Mapbox.PointAnnotation id="pickup" coordinate={selectedCoords}>
              <View className="w-10 h-10 bg-primary/20 rounded-full items-center justify-center">
                <View className="w-4 h-4 bg-primary rounded-full border-2 border-white" />
              </View>
            </Mapbox.PointAnnotation>
          )}
        </Mapbox.MapView>

      <View className="absolute top-12 left-4 right-4 z-10">
        {addrLoadState === 'loading' && !showSuggestions && (
          <View
            testID="saved-addresses-loading"
            className="flex-row mb-2"
            style={{ paddingHorizontal: 4, gap: 8 }}
          >
            {[0, 1, 2].map((i) => (
              <View
                key={i}
                className="bg-gray-200 rounded-full h-8 w-20 animate-pulse"
              />
            ))}
          </View>
        )}

        {addrLoadState === 'error' && !showSuggestions && (
          <View className="flex-row items-center bg-white rounded-full px-3 py-1.5 mb-2 shadow-sm self-start">
            <Ionicons name="alert-circle-outline" size={16} color="#dc2626" />
            <Text className="text-xs text-gray-700 ml-1.5">Couldn't load your addresses</Text>
            <Pressable onPress={() => reload()} hitSlop={8} className="ml-2">
              <Text className="text-xs font-semibold text-primary">Retry</Text>
            </Pressable>
          </View>
        )}

        {addrLoadState === 'ready' && savedAddresses.length > 0 && !showSuggestions && (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            className="mb-2"
            contentContainerStyle={{ paddingHorizontal: 4, gap: 8 }}
          >
            {savedAddresses.map((addr) => (
              <Pressable
                key={addr.id}
                onPress={() => selectSavedAddress(addr)}
                className="bg-white border border-gray-200 rounded-full px-3 py-1.5 shadow-sm"
              >
                <Text className="text-sm font-medium text-gray-700">{addr.label}</Text>
              </Pressable>
            ))}
          </ScrollView>
        )}

        <View className="bg-white rounded-xl shadow-lg overflow-hidden">
          <View className="flex-row items-center px-4 py-3 border-b border-gray-100">
            <View className="w-3 h-3 rounded-full bg-primary mr-3" />
            <TextInput
              value={query}
              onChangeText={handleSearch}
              placeholder="Search pickup address"
              className="flex-1 text-base"
              placeholderClassName="text-gray-400"
              onFocus={() => setShowSuggestions(true)}
              onBlur={() => !query && setShowSuggestions(false)}
            />
            {searching && <ActivityIndicator size="small" color="#16a34a" />}
          </View>

          {showEmptySearch && addrLoadState === 'loading' && (
            <View className="px-4 py-3">
              <Text className="pt-1 pb-2 text-xs font-semibold text-gray-400 uppercase">
                Recent
              </Text>
              {[0, 1, 2].map((i) => (
                <View
                  key={i}
                  className="h-4 bg-gray-200 rounded animate-pulse mb-3"
                  style={{ width: i % 2 === 0 ? '75%' : '55%' }}
                />
              ))}
            </View>
          )}

          {showEmptySearch && addrLoadState === 'error' && (
            <View className="flex-row items-center px-4 py-3">
              <Ionicons name="alert-circle-outline" size={16} color="#dc2626" />
              <Text className="text-xs text-gray-700 ml-1.5">Couldn't load your addresses</Text>
              <Pressable onPress={() => reload()} hitSlop={8} className="ml-2">
                <Text className="text-xs font-semibold text-primary">Retry</Text>
              </Pressable>
            </View>
          )}

          {showEmptySearch && addrLoadState === 'ready' && (recentLocations.length > 0 || savedAddresses.length > 0) && (
            <ScrollView style={{ maxHeight: 260 }} keyboardShouldPersistTaps="always">
              {recentLocations.length > 0 && (
                <>
                  <Text className="px-4 pt-3 pb-1 text-xs font-semibold text-gray-400 uppercase">
                    Recent
                  </Text>
                  {recentLocations.map((r) => (
                    <Pressable
                      key={r.id}
                      onPress={() => selectRecentLocation(r)}
                      className="px-4 py-3 border-b border-gray-50"
                    >
                      <Text className="text-sm text-gray-900" numberOfLines={1}>
                        {r.address_text}
                      </Text>
                    </Pressable>
                  ))}
                </>
              )}
              {savedAddresses.length > 0 && (
                <>
                  <Text className="px-4 pt-3 pb-1 text-xs font-semibold text-gray-400 uppercase">
                    Saved
                  </Text>
                  {savedAddresses.map((a) => (
                    <Pressable
                      key={a.id}
                      onPress={() => selectSavedAddress(a)}
                      className="px-4 py-3 border-b border-gray-50"
                    >
                      <Text className="text-sm font-medium text-gray-900">{a.label}</Text>
                      <Text className="text-xs text-gray-500" numberOfLines={1}>
                        {a.address_text}
                      </Text>
                    </Pressable>
                  ))}
                </>
              )}
            </ScrollView>
          )}

          {showAutoComplete && (
            <FlatList
              data={suggestions}
              keyExtractor={(item, index) => `${item.place_id}-${index}`}
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

      <Animated.View style={{ position: 'absolute', bottom: panelBottom, left: 0, right: 0 }}>
        {selectedAddress && !showSuggestions && (
          <View className="px-4 pb-2">
            <View className="bg-white rounded-xl shadow-lg p-4">
              <Text className="text-xs text-gray-500 uppercase mb-1">Pickup Location</Text>
              <Text className="text-sm text-gray-900 mb-3" numberOfLines={2}>
                {selectedAddress}
              </Text>

              {savedAddresses.length < ADDRESS_CAP && (
                <View>
                  {savedLabel ? (
                    <View className="flex-row items-center gap-1">
                      <Ionicons name="checkmark-circle" size={14} color="#16a34a" />
                      <Text className="text-xs text-green-600 font-medium">
                        Saved as {savedLabel}
                      </Text>
                    </View>
                  ) : (
                    <ScrollView
                      horizontal
                      showsHorizontalScrollIndicator={false}
                      contentContainerStyle={{ gap: 8 }}
                    >
                      {SAVE_LABELS.map((l) => (
                        <Pressable
                          key={l}
                          onPress={() => handleSaveNudge(l)}
                          className="border border-gray-300 rounded-full px-3 py-1"
                        >
                          <Text className="text-xs text-gray-600">{l}</Text>
                        </Pressable>
                      ))}
                    </ScrollView>
                  )}
                  {saveError && (
                    <View className="flex-row items-center gap-1 mt-2">
                      <Ionicons name="alert-circle-outline" size={14} color="#dc2626" />
                      <Text className="text-xs text-red-600 font-medium">{saveError}</Text>
                    </View>
                  )}
                </View>
              )}
            </View>
          </View>
        )}
        <View className="px-4 pt-2 bg-white" style={{ paddingBottom: insets.bottom + 8 }}>
          <Pressable
            onPress={handleConfirm}
            className="bg-primary py-4 rounded-xl items-center"
          >
            <Text className="text-white text-lg font-semibold">Confirm Pickup</Text>
          </Pressable>
        </View>
      </Animated.View>
    </View>
  );
}
