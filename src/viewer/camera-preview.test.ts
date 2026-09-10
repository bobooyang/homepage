import { expect, test, vi } from 'vitest';
import { CameraPreview } from './camera-preview';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
function media() {
  const track = { stop: vi.fn(), onended: null as (() => void) | null };
  const stream = { getTracks: () => [track], getVideoTracks: () => [track] } as unknown as MediaStream;
  return { track, stream };
}
function setup(acquire: () => Promise<MediaStream>) {
  const video = { play: vi.fn(async () => {}), pause: vi.fn(), srcObject: null } as unknown as HTMLVideoElement;
  const changed = vi.fn();
  return { video, changed, preview: new CameraPreview(video, acquire, changed) };
}

test('starts muted video and releases the stream on closing', async () => {
  const { stream, track } = media();
  const { preview, video } = setup(async () => stream);
  await preview.start();
  expect(preview.status).toBe('active');
  expect(video.srcObject).toBe(stream);
  expect(video.muted && video.playsInline).toBe(true);
  preview.stop();
  expect(track.stop).toHaveBeenCalledOnce();
  expect(video.srcObject).toBeNull();
  expect(preview.status).toBe('off');
});

test('late permission cannot replace a newer session', async () => {
  const first = deferred<MediaStream>();
  const old = media();
  const current = media();
  const acquire = vi.fn().mockReturnValueOnce(first.promise).mockResolvedValueOnce(current.stream);
  const { preview, video } = setup(acquire);
  const pending = preview.start();
  await preview.start();
  expect(acquire).toHaveBeenCalledOnce();
  preview.stop();
  await preview.start();
  first.resolve(old.stream);
  await pending;
  expect(old.track.stop).toHaveBeenCalledOnce();
  expect(current.track.stop).not.toHaveBeenCalled();
  expect(video.srcObject).toBe(current.stream);
  expect(preview.status).toBe('active');
});

test('disposing during permission releases a late stream without publishing', async () => {
  const request = deferred<MediaStream>();
  const { stream, track } = media();
  const { preview, changed } = setup(() => request.promise);
  const pending = preview.start();
  preview.dispose();
  changed.mockClear();
  request.resolve(stream);
  await pending;
  expect(track.stop).toHaveBeenCalledOnce();
  expect(changed).not.toHaveBeenCalled();
});

test('permission failure permits retry and device disconnection releases resources', async () => {
  const { stream, track } = media();
  const acquire = vi.fn().mockRejectedValueOnce(new DOMException('denied', 'NotAllowedError')).mockResolvedValueOnce(stream);
  const { preview, changed, video } = setup(acquire);
  await preview.start();
  expect(preview.status).toBe('off');
  expect(changed).toHaveBeenLastCalledWith('off', expect.stringContaining('权限被拒绝'));
  await preview.start();
  track.onended?.();
  expect(preview.status).toBe('off');
  expect(video.srcObject).toBeNull();
  expect(track.stop).toHaveBeenCalledOnce();
});

test('playback failure or cancellation during playback releases the acquired stream', async () => {
  const { stream, track } = media();
  const { preview, video } = setup(async () => stream);
  vi.mocked(video.play).mockRejectedValueOnce(new Error('play failed'));
  await preview.start();
  expect(preview.status).toBe('off');
  expect(track.stop).toHaveBeenCalledOnce();
  const playback = deferred<void>();
  vi.mocked(video.play).mockReturnValueOnce(playback.promise);
  const pending = preview.start();
  await Promise.resolve();
  preview.stop();
  playback.resolve();
  await pending;
  expect(preview.status).toBe('off');
  expect(video.srcObject).toBeNull();
});
