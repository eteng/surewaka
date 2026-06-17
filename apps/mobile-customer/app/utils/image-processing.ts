import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';

const AVATAR_SIZE = 256;
const JPEG_QUALITY = 0.8;

/**
 * Processes an image for use as an avatar.
 * Resizes to 256×256 (center crop) and compresses to JPEG at 80% quality.
 *
 * @param uri - Local file URI of the source image
 * @returns An ArrayBuffer containing the processed JPEG image
 */
export async function processAvatarImage(uri: string): Promise<{
  blob: ArrayBuffer;
  mimeType: 'image/jpeg';
}> {
  const context = ImageManipulator.manipulate(uri);

  // First render to get original dimensions for center-crop calculation
  const original = await context.renderAsync();
  const { width, height } = original;

  // Reset context to start fresh with the crop + resize pipeline
  context.reset();

  // Center-crop to a square based on the shorter dimension
  const cropSize = Math.min(width, height);
  const originX = Math.round((width - cropSize) / 2);
  const originY = Math.round((height - cropSize) / 2);

  context.crop({
    originX,
    originY,
    width: cropSize,
    height: cropSize,
  });

  // Resize the square crop to target dimensions
  context.resize({ width: AVATAR_SIZE, height: AVATAR_SIZE });

  // Render the final image
  const image = await context.renderAsync();

  // Save as JPEG with 80% quality
  const result = await image.saveAsync({
    format: SaveFormat.JPEG,
    compress: JPEG_QUALITY,
  });

  // Release native resources
  context.release();
  original.release();
  image.release();

  // Fetch the processed image file and convert to ArrayBuffer
  // (Supabase Storage on React Native doesn't handle Blob correctly)
  const response = await fetch(result.uri);
  const arrayBuffer = await response.arrayBuffer();

  return {
    blob: arrayBuffer,
    mimeType: 'image/jpeg',
  };
}
