import { Platform } from 'react-native';
import { Capacitor } from '@capacitor/core';

/** Resize on-device before any base64 conversion or network upload. */
export async function pickPhoto(kind: 'avatar' | 'post' = 'post'): Promise<string | null> {
  const maxEdge = kind === 'avatar' ? 384 : 1280;
  const limit = kind === 'avatar' ? 110_000 : 650_000;
  let uri: string;
  try {
    if (Capacitor.isNativePlatform()) {
      const { Camera, CameraResultType, CameraSource } = await import('@capacitor/camera');
      const photo = await Camera.getPhoto({ source: CameraSource.Prompt, resultType: CameraResultType.Uri,
        quality: 80, width: maxEdge, height: maxEdge, correctOrientation: true, saveToGallery: false,
        promptLabelHeader: 'Add photo', promptLabelPhoto: 'Choose from library', promptLabelPicture: 'Take photo' });
      if (!photo.webPath) return null;
      uri = photo.webPath;
    } else {
      const picker = await import('expo-image-picker');
      const result = await picker.launchImageLibraryAsync({ mediaTypes: picker.MediaTypeOptions.Images, quality: 0.8 });
      if (result.canceled || !result.assets[0]) return null;
      uri = result.assets[0].uri;
    }
    if (Platform.OS === 'web') return await compressWebPhoto(uri, maxEdge, limit);
    const { manipulateAsync, SaveFormat } = await import('expo-image-manipulator');
    for (const scale of [1, 0.75, 0.5]) {
      const image = await manipulateAsync(uri, [{ resize: { width: Math.round(maxEdge * scale) } }], { compress: 0.65, format: SaveFormat.JPEG, base64: true });
      if (image.base64 && image.base64.length < limit) return `data:image/jpeg;base64,${image.base64}`;
    }
    throw new Error('This photo could not be prepared. Try a different photo.');
  } catch (error: any) {
    if (/cancel|dismiss|no image selected/i.test(error?.message ?? '')) return null;
    if (/permission|denied/i.test(error?.message ?? '')) throw new Error('Allow camera or photo access for ASTA in your phone Settings, then try again.');
    throw error;
  }
}

export async function compressWebPhoto(uri: string, maxEdge: number, limit: number): Promise<string> {
  const image = new Image();
  await new Promise<void>((resolve, reject) => { image.onload = () => resolve(); image.onerror = () => reject(new Error('Could not read this photo. Try a JPEG or PNG image.')); image.src = uri; });
  const canvas = document.createElement('canvas');
  try {
    for (const reduction of [1, 0.8, 0.6, 0.4]) {
      const scale = Math.min(1, maxEdge * reduction / Math.max(image.naturalWidth, image.naturalHeight));
      canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Photo processing is unavailable.');
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
      for (const quality of [0.8, 0.65, 0.5]) {
        const result = canvas.toDataURL('image/jpeg', quality);
        if (result.length <= limit) return result;
      }
    }
    throw new Error('This photo could not be prepared. Try another photo.');
  } finally { canvas.width = 0; canvas.height = 0; image.src = ''; }
}
