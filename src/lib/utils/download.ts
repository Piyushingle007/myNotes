import { registerPlugin, Capacitor } from '@capacitor/core';

interface FileSaverPluginApi {
  saveFile(options: { fileName: string; base64Data: string; mimeType: string }): Promise<{ success: boolean; savedToDownloads: boolean; fileName: string }>;
}

const FileSaver = registerPlugin<FileSaverPluginApi>('FileSaver');

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const dataUrl = reader.result as string;
      const base64 = dataUrl.includes(',') ? dataUrl.split(',')[1] : dataUrl;
      resolve(base64);
    };
    reader.onerror = (err) => reject(err);
    reader.readAsDataURL(blob);
  });
}

export async function saveOrShareBlob(blob: Blob, filename: string, mime: string): Promise<boolean> {
  // If running on native Android via Capacitor, use native FileSaver plugin
  if (Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android') {
    try {
      console.log(`[FileSaver] Saving ${filename} via native FileSaver plugin...`);
      const base64 = await blobToBase64(blob);
      const res = await FileSaver.saveFile({
        fileName: filename,
        base64Data: base64,
        mimeType: mime,
      });
      console.log('[FileSaver] Native save response:', res);
      return res.success;
    } catch (err) {
      console.warn('[FileSaver] Native FileSaver failed, trying web fallback', err);
    }
  }

  // Web Share API fallback
  if (
    typeof navigator !== 'undefined' &&
    navigator.share &&
    navigator.canShare &&
    navigator.canShare({
      files: [new File([blob], filename, { type: mime })]
    })
  ) {
    try {
      const file = new File([blob], filename, { type: mime });
      await navigator.share({
        files: [file],
        title: filename,
        text: `Exported from myNotes: ${filename}`
      });
      return true;
    } catch (shareErr) {
      console.warn('Share failed, falling back to anchor download', shareErr);
    }
  }

  // Fallback to Anchor download on desktop web browsers
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  return false;
}
