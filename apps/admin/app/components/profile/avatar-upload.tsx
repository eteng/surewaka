import { useRef, useState } from 'react';
import { Camera, Loader2, Trash2, Upload, User, X } from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '~/components/ui/avatar';
import { Button } from '~/components/ui/button';

const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_SIZE_BYTES = 2 * 1024 * 1024; // 2 MB

type AvatarUploadProps = {
  avatarUrl: string | null;
  onUpload: (file: File) => Promise<void>;
  onRemove: () => Promise<void>;
  isUpdating: boolean;
};

export function AvatarUpload({ avatarUrl, onUpload, onRemove, isUpdating }: AvatarUploadProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);

  function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    setError(null);

    if (!ALLOWED_TYPES.includes(file.type)) {
      setError('Only JPEG, PNG, and WebP images are allowed.');
      resetInput();
      return;
    }

    if (file.size > MAX_SIZE_BYTES) {
      setError('File must be 2 MB or smaller.');
      resetInput();
      return;
    }

    setSelectedFile(file);
    const objectUrl = URL.createObjectURL(file);
    setPreview(objectUrl);
  }

  function resetInput() {
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  }

  function handleCancelPreview() {
    if (preview) {
      URL.revokeObjectURL(preview);
    }
    setPreview(null);
    setSelectedFile(null);
    setError(null);
    resetInput();
  }

  async function handleUpload() {
    if (!selectedFile) return;

    await onUpload(selectedFile);

    if (preview) {
      URL.revokeObjectURL(preview);
    }
    setPreview(null);
    setSelectedFile(null);
    resetInput();
  }

  async function handleRemove() {
    setError(null);
    await onRemove();
  }

  function triggerFileInput() {
    fileInputRef.current?.click();
  }

  const displayUrl = preview ?? avatarUrl;

  return (
    <div className="flex flex-col items-center gap-4">
      <div className="relative">
        <Avatar className="h-24 w-24">
          {displayUrl ? (
            <AvatarImage src={displayUrl} alt="Profile avatar" />
          ) : null}
          <AvatarFallback className="text-2xl">
            <User className="h-10 w-10 text-muted-foreground" />
          </AvatarFallback>
        </Avatar>

        {!preview && !isUpdating && (
          <button
            type="button"
            onClick={triggerFileInput}
            className="absolute bottom-0 right-0 flex h-8 w-8 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-sm hover:bg-primary/90 transition-colors"
            aria-label="Change avatar"
          >
            <Camera className="h-4 w-4" />
          </button>
        )}
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        onChange={handleFileSelect}
        className="hidden"
        aria-label="Select avatar image"
      />

      {error && <p className="text-sm text-destructive">{error}</p>}

      {preview && selectedFile && (
        <div className="flex gap-2">
          <Button
            size="sm"
            onClick={handleUpload}
            disabled={isUpdating}
          >
            {isUpdating ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Upload className="h-4 w-4" />
            )}
            Upload
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={handleCancelPreview}
            disabled={isUpdating}
          >
            <X className="h-4 w-4" />
            Cancel
          </Button>
        </div>
      )}

      {!preview && (
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={triggerFileInput}
            disabled={isUpdating}
          >
            {isUpdating ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Camera className="h-4 w-4" />
            )}
            Change photo
          </Button>

          {avatarUrl && (
            <Button
              size="sm"
              variant="destructive"
              onClick={handleRemove}
              disabled={isUpdating}
            >
              {isUpdating ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Trash2 className="h-4 w-4" />
              )}
              Remove
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
