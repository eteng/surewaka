import { useState } from 'react';
import { View, Text, Pressable, ActivityIndicator } from 'react-native';
import { Image } from 'expo-image';

export type AvatarPickerProps = {
  avatarUrl: string | null;
  isUploading: boolean;
  onPickImage: () => void;
  size?: number;
};

export function AvatarPicker({ avatarUrl, isUploading, onPickImage, size = 96 }: AvatarPickerProps) {
  const [hasLoadError, setHasLoadError] = useState(false);

  // Reset error state when URL changes
  const showImage = avatarUrl && !hasLoadError;

  // Compute Tailwind-like inline styles for dynamic size
  const containerStyle = {
    width: size,
    height: size,
    borderRadius: size / 2,
  };

  // Scale emoji based on container size
  const emojiSize = size >= 80 ? 'text-4xl' : size >= 48 ? 'text-2xl' : 'text-xl';

  return (
    <Pressable
      onPress={onPickImage}
      accessibilityRole="button"
      accessibilityLabel="Change profile photo"
    >
      <View
        style={containerStyle}
        className="overflow-hidden items-center justify-center bg-green-100"
      >
        {showImage ? (
          <Image
            source={{ uri: avatarUrl }}
            style={{ width: size, height: size }}
            cachePolicy="disk"
            contentFit="cover"
            onError={() => setHasLoadError(true)}
          />
        ) : (
          <Text className={emojiSize}>👤</Text>
        )}

        {/* Loading overlay */}
        {isUploading && (
          <View
            style={containerStyle}
            className="absolute inset-0 items-center justify-center bg-black/40"
          >
            <ActivityIndicator color="#ffffff" size="small" />
          </View>
        )}
      </View>
    </Pressable>
  );
}
