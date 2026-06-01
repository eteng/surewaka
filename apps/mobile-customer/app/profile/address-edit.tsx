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
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import Mapbox from '@rnmapbox/maps';
import {
  searchAddress,
  reverseGeocode,
  supabase,
  useAuthStore,
  useAddressStore,
} from '@surewaka/mobile-shared';
import type { LocationSuggestion } from '@surewaka/mobile-shared';
import type { SavedAddress } from '@surewaka/shared';

Mapbox.setAccessToken(process.env.EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN ?? '');

const LAGOS_CENTER: [number, number] = [3.3792, 6.5244];
const PRESET_LABELS = ['Home', 'Office', 'Work', 'Other'];

export default function AddressEditScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const userId = useAuthStore((s) => s.user?.id ?? '');
  const addAddress = useAddressStore((s) => s.add);
  const updateAddress = useAddressStore((s) => s.update);

  const [label, setLabel] = useState('');
  const [customLabel, setCustomLabel] = useState('');
  const [selectedCoords, setSelectedCoords] = useState<[number, number] | null>(null);
  const [selectedAddress, setSelectedAddress] = useState<string | null>(null);
  const [city, setCity] = useState('');
  const [state, setState] = useState('');
  const [query, setQuery] = useState('');
  const [suggestions, setSuggestions] = useState<LocationSuggestion[]>([]);
  const [searching, setSearching] = useState(false);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loadingExisting, setLoadingExisting] = useState(!!id);

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
    if (!id) return;
    (async () => {
      const { data } = await supabase
        .from('user_saved_addresses')
        .select('id, label, address_text, city, state, lat, lng, created_at')
        .eq('id', id)
        .single();
      if (data) {
        setLabel(PRESET_LABELS.includes(data.label) ? data.label : 'Other');
        setCustomLabel(PRESET_LABELS.includes(data.label) ? '' : data.label);
        setSelectedAddress(data.address_text);
        setCity(data.city);
        setState(data.state);
        setSelectedCoords([data.lng, data.lat]);
      }
      setLoadingExisting(false);
    })();
  }, [id]);

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

  const selectSuggestion = useCallback((suggestion: LocationSuggestion) => {
    const lat = parseFloat(suggestion.lat);
    const lon = parseFloat(suggestion.lon);
    setSelectedCoords([lon, lat]);
    setSelectedAddress(suggestion.display_name);
    setCity(suggestion.address?.city ?? suggestion.address?.town ?? suggestion.address?.suburb ?? suggestion.address?.county ?? '');
    setState(suggestion.address?.state ?? '');
    setQuery('');
    setShowSuggestions(false);
    setSuggestions([]);
  }, []);

  const handleMapPress = useCallback(
    async (feature: Parameters<NonNullable<React.ComponentProps<typeof Mapbox.MapView>['onPress']>>[0]) => {
      const coords = feature.geometry.coordinates as [number, number];
      setSelectedCoords(coords);

      const result = await reverseGeocode(coords[1], coords[0]);
      if (result) {
        setSelectedAddress(result.display_name);
        setCity(result.address?.city ?? result.address?.town ?? result.address?.suburb ?? result.address?.county ?? '');
        setState(result.address?.state ?? '');
      }
    },
    [],
  );

  const handleSave = async () => {
    const effectiveLabel = label === 'Other' ? customLabel.trim() : label;
    if (!effectiveLabel) {
      Alert.alert('Label required', 'Please enter a label for this address.');
      return;
    }
    if (!selectedAddress || !selectedCoords) {
      Alert.alert('Address required', 'Please search or drop a pin for this address.');
      return;
    }

    setSaving(true);

    const body = {
      label:        effectiveLabel,
      address_text: selectedAddress,
      city,
      state,
      lat:          selectedCoords[1],
      lng:          selectedCoords[0],
    };

    if (id) {
      const { error } = await supabase
        .from('user_saved_addresses')
        .update(body)
        .eq('id', id);
      setSaving(false);
      if (error) {
        Alert.alert('Error', error.message ?? 'Could not save address. Please try again.');
      } else {
        updateAddress(id, body);
        router.back();
      }
    } else {
      const { data, error } = await supabase
        .from('user_saved_addresses')
        .insert({ ...body, user_id: userId })
        .select('id, label, address_text, city, state, lat, lng, created_at')
        .single();
      setSaving(false);
      if (error) {
        Alert.alert('Error', error.message ?? 'Could not save address. Please try again.');
      } else {
        addAddress(data as SavedAddress);
        router.back();
      }
    }
  };

  if (loadingExisting) {
    return (
      <View className="flex-1 bg-white items-center justify-center">
        <ActivityIndicator size="large" color="#16a34a" />
      </View>
    );
  }

  return (
    <View className="flex-1 bg-white">
      <Mapbox.MapView
        styleURL={Mapbox.StyleURL.Street}
        style={StyleSheet.absoluteFillObject}
        onPress={handleMapPress}
      >
        <Mapbox.Camera
          zoomLevel={14}
          centerCoordinate={selectedCoords ?? LAGOS_CENTER}
          animationMode="flyTo"
          animationDuration={1000}
        />
        {selectedCoords && (
          <Mapbox.PointAnnotation id="address-pin" coordinate={selectedCoords}>
            <View className="w-10 h-10 bg-primary/20 rounded-full items-center justify-center">
              <View className="w-4 h-4 bg-primary rounded-full border-2 border-white" />
            </View>
          </Mapbox.PointAnnotation>
        )}
      </Mapbox.MapView>

      <View className="absolute top-12 left-4 right-4 z-10">
        <View className="bg-white rounded-xl shadow-lg overflow-hidden">
          <View className="flex-row items-center px-4 py-3 border-b border-gray-100">
            <Pressable onPress={() => router.back()} className="mr-3">
              <Text className="text-primary text-lg">←</Text>
            </Pressable>
            <TextInput
              value={query}
              onChangeText={handleSearch}
              placeholder="Search address"
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

      <Animated.View style={{ position: 'absolute', bottom: panelBottom, left: 0, right: 0 }}>
      <View
        className="bg-white border-t border-gray-100 px-4 pt-4"
        style={{ paddingBottom: insets.bottom + 16 }}
      >
            {selectedAddress && (
              <Text className="text-sm text-gray-600 mb-3" numberOfLines={2}>
                {selectedAddress}
              </Text>
            )}

            <Text className="text-xs text-gray-500 uppercase mb-2">Label</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} className="mb-2">
              <View className="flex-row gap-2">
                {PRESET_LABELS.map((l) => (
                  <Pressable
                    key={l}
                    onPress={() => setLabel(l)}
                    className={`px-4 py-2 rounded-full border ${
                      label === l ? 'bg-primary border-primary' : 'bg-white border-gray-300'
                    }`}
                  >
                    <Text className={`text-sm font-medium ${label === l ? 'text-white' : 'text-gray-700'}`}>
                      {l}
                    </Text>
                  </Pressable>
                ))}
              </View>
            </ScrollView>

            {label === 'Other' && (
              <TextInput
                value={customLabel}
                onChangeText={setCustomLabel}
                placeholder="Custom label"
                maxLength={50}
                className="border border-gray-300 rounded-xl px-4 py-3 mb-4 text-base"
              />
            )}

            <Pressable
              onPress={handleSave}
              disabled={saving}
              className={`py-4 rounded-xl items-center ${saving ? 'bg-gray-300' : 'bg-primary'}`}
            >
              {saving ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text className="text-white text-lg font-semibold">
                  {id ? 'Update Address' : 'Save Address'}
                </Text>
              )}
            </Pressable>
      </View>
      </Animated.View>
    </View>
  );
}
