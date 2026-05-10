import { createServiceClient } from '@surewaka/supabase';

/**
 * Supabase Storage helpers for file uploads.
 * Used for KYC documents (driver licenses, vehicle photos) and profile images.
 *
 * Buckets:
 * - `kyc-documents` — private, driver verification docs
 * - `profile-images` — public, user avatars
 * - `delivery-photos` — private, proof of delivery
 */

const supabase = createServiceClient();

export async function uploadKYCDocument(
  driverId: string,
  file: File,
  docType: 'license' | 'vehicle' | 'insurance',
) {
  const path = `${driverId}/${docType}-${Date.now()}`;

  const { data, error } = await supabase.storage
    .from('kyc-documents')
    .upload(path, file, { upsert: true });

  if (error) throw new Error(`Upload failed: ${error.message}`);
  return data.path;
}

export async function uploadProfileImage(userId: string, file: File) {
  const path = `${userId}/avatar-${Date.now()}`;

  const { data, error } = await supabase.storage
    .from('profile-images')
    .upload(path, file, { upsert: true });

  if (error) throw new Error(`Upload failed: ${error.message}`);

  const { data: urlData } = supabase.storage
    .from('profile-images')
    .getPublicUrl(data.path);

  return urlData.publicUrl;
}

export async function getSignedUrl(bucket: string, path: string, expiresIn = 3600) {
  const { data, error } = await supabase.storage
    .from(bucket)
    .createSignedUrl(path, expiresIn);

  if (error) throw new Error(`Signed URL failed: ${error.message}`);
  return data.signedUrl;
}
