import { expect, test } from 'vitest';
import { coverCrop, prepareWallpaper, SCREEN_ASPECT } from './wallpaper-image';

test('cover crop centers both portrait and landscape photos without stretching', () => {
  for (const [width, height] of [[4000, 1000], [1000, 4000], [1000, 1000]]) {
    for (const aspect of Object.values(SCREEN_ASPECT)) {
      const crop = coverCrop(width!, height!, aspect);
      expect(crop.width / crop.height).toBeCloseTo(aspect);
      expect(crop.x + crop.width / 2).toBeCloseTo(width! / 2);
      expect(crop.y + crop.height / 2).toBeCloseTo(height! / 2);
      expect(crop.x).toBeGreaterThanOrEqual(0);
      expect(crop.y).toBeGreaterThanOrEqual(0);
      expect(crop.width).toBeLessThanOrEqual(width!);
      expect(crop.height).toBeLessThanOrEqual(height!);
    }
  }
});

test('invalid dimensions and unsupported files are rejected before decoding', async () => {
  for (const value of [0, -1, Infinity, NaN]) expect(() => coverCrop(value, 100, 1)).toThrow();
  await expect(prepareWallpaper(new Blob(['text'], { type: 'text/plain' }), 'outer')).rejects.toThrow('JPG');
  await expect(prepareWallpaper(new Blob([new Uint8Array(21 * 1024 * 1024)], { type: 'image/png' }), 'inner')).rejects.toThrow('20 MB');
});
