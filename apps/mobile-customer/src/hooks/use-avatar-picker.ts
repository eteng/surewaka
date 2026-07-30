import { useState, useCallback } from 'react';
import { Linking } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { toast } from 'sonner-native';

type UseAvatarPickerReturn = {
  pickFromLibrary: () => Promise<string | null>;
  pickFromCamera: () => Promise<string | null>;
  isSheetOpen: boolean;
  openSheet: () => void;
  closeSheet: () => void;
};

export function useAvatarPicker(): UseAvatarPickerReturn {
  const [isSheetOpen, setIsSheetOpen] = useState(false);

  const openSheet = useCallback(() => setIsSheetOpen(true), []);
  const closeSheet = useCallback(() => setIsSheetOpen(false), []);

  const pickFromLibrary = useCallback(async (): Promise<string | null> => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();

    if (status !== 'granted') {
      toast.error('Photo library access is required. Please enable it in your device Settings.', {
        action: {
          label: 'Open Settings',
          onClick: () => Linking.openSettings(),
        },
      });
      return null;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.8,
    });

    if (result.canceled || result.assets.length === 0) {
      return null;
    }

    return result.assets[0].uri;
  }, []);

  const pickFromCamera = useCallback(async (): Promise<string | null> => {
    const { status } = await ImagePicker.requestCameraPermissionsAsync();

    if (status !== 'granted') {
      toast.error('Camera access is required. Please enable it in your device Settings.', {
        action: {
          label: 'Open Settings',
          onClick: () => Linking.openSettings(),
        },
      });
      return null;
    }

    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.8,
    });

    if (result.canceled || result.assets.length === 0) {
      return null;
    }

    return result.assets[0].uri;
  }, []);

  return { pickFromLibrary, pickFromCamera, isSheetOpen, openSheet, closeSheet };
}
