/**
 * Downsizes a cover image Blob to a compact thumbnail (max 200x300) WebP/JPEG.
 * Keeps memory usage and storage minimal in the library view.
 */
export async function createCoverThumbnail(imageBlob: Blob): Promise<Blob> {
  // If in environment without DOM/Canvas (e.g. pure worker without OffscreenCanvas), return original if small
  if (typeof OffscreenCanvas === 'undefined' && typeof document === 'undefined') {
    return imageBlob;
  }

  try {
    const MAX_WIDTH = 200;
    const MAX_HEIGHT = 300;

    let bitmap: ImageBitmap | HTMLImageElement;
    let width = 0;
    let height = 0;

    if (typeof createImageBitmap === 'function') {
      bitmap = await createImageBitmap(imageBlob);
      width = bitmap.width;
      height = bitmap.height;
    } else if (typeof Image !== 'undefined') {
      const url = URL.createObjectURL(imageBlob);
      bitmap = await new Promise<HTMLImageElement>((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = reject;
        img.src = url;
      });
      URL.revokeObjectURL(bitmap.src);
      width = bitmap.naturalWidth || bitmap.width;
      height = bitmap.naturalHeight || bitmap.height;
    } else {
      return imageBlob;
    }

    if (width === 0 || height === 0) return imageBlob;

    // Calculate aspect ratio scale
    const scale = Math.min(1, Math.min(MAX_WIDTH / width, MAX_HEIGHT / height));
    const targetW = Math.round(width * scale);
    const targetH = Math.round(height * scale);

    if (typeof OffscreenCanvas !== 'undefined') {
      const canvas = new OffscreenCanvas(targetW, targetH);
      const ctx = canvas.getContext('2d');
      if (!ctx) return imageBlob;
      ctx.drawImage(bitmap, 0, 0, targetW, targetH);
      if ('close' in bitmap && typeof (bitmap as ImageBitmap).close === 'function') {
        (bitmap as ImageBitmap).close();
      }
      return await canvas.convertToBlob({ type: 'image/webp', quality: 0.85 })
        .catch(() => canvas.convertToBlob({ type: 'image/jpeg', quality: 0.85 }));
    } else if (typeof document !== 'undefined') {
      const canvas = document.createElement('canvas');
      canvas.width = targetW;
      canvas.height = targetH;
      const ctx = canvas.getContext('2d');
      if (!ctx) return imageBlob;
      ctx.drawImage(bitmap, 0, 0, targetW, targetH);
      if ('close' in bitmap && typeof (bitmap as ImageBitmap).close === 'function') {
        (bitmap as ImageBitmap).close();
      }
      return await new Promise<Blob>((resolve) => {
        canvas.toBlob((b) => resolve(b || imageBlob), 'image/webp', 0.85);
      });
    }

    return imageBlob;
  } catch (err) {
    console.warn('[CoverThumbnail] Failed to downsize cover image, using original:', err);
    return imageBlob;
  }
}
