import type { ScreenName } from './types';

// Screen geometry ratios, not the dimensions of the GLB's source images.
export const SCREEN_ASPECT: Record<ScreenName, number> = { outer: .688, inner: 1.423 };
export const MAX_WALLPAPER_BYTES = 20 * 1024 * 1024;

export function coverCrop(width: number, height: number, aspect: number) {
  if (![width, height, aspect].every((n) => Number.isFinite(n) && n > 0)) throw new Error('图片尺寸无效');
  const cropWidth = Math.min(width, height * aspect);
  const cropHeight = Math.min(height, cropWidth / aspect);
  return { x: (width - cropWidth) / 2, y: (height - cropHeight) / 2, width: cropWidth, height: cropHeight };
}

export async function prepareWallpaper(blob: Blob, screen: ScreenName): Promise<{ canvas: HTMLCanvasElement; blob: Blob }> {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(blob.type)) throw new Error('请选择 JPG、PNG 或 WebP 图片。');
  if (blob.size > MAX_WALLPAPER_BYTES) throw new Error('图片不能超过 20 MB，请换一张较小的图片。');
  const url = URL.createObjectURL(blob);
  const image = new Image();
  try {
    image.src = url;
    try { await image.decode(); } catch { throw new Error('无法读取这张图片，请选择其他图片。'); }
    const crop = coverCrop(image.naturalWidth, image.naturalHeight, SCREEN_ASPECT[screen]);
    const scale = Math.min(1, 1536 / Math.max(crop.width, crop.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(crop.width * scale));
    canvas.height = Math.max(1, Math.round(crop.height * scale));
    const context = canvas.getContext('2d');
    if (!context) throw new Error('无法处理图片，请重试。');
    context.fillStyle = '#000';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, crop.x, crop.y, crop.width, crop.height, 0, 0, canvas.width, canvas.height);
    const prepared = await new Promise<Blob>((resolve, reject) => canvas.toBlob((result) => result ? resolve(result) : reject(new Error('无法处理图片，请重试。')), 'image/png'));
    return { canvas, blob: prepared };
  } finally {
    URL.revokeObjectURL(url);
  }
}
