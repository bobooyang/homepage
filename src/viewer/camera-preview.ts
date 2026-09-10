export type CameraStatus = 'off' | 'starting' | 'active';

export function cameraErrorMessage(error: unknown): string {
  const name = error instanceof Error ? error.name : '';
  if (name === 'NotAllowedError' || name === 'SecurityError') return '摄像头权限被拒绝，请在浏览器中允许后再次点击相机按钮。';
  if (name === 'NotFoundError') return '未找到摄像头，请连接摄像头后重试。';
  if (name === 'NotReadableError') return '摄像头无法使用，可能正被其他应用占用，请重试。';
  return '无法打开摄像头，请检查设备和浏览器权限后重试。';
}

// A cancelled permission request can still resolve; only the latest request owns its stream.
export class CameraPreview {
  status: CameraStatus = 'off';
  private generation = 0;
  private stream: MediaStream | null = null;
  private disposed = false;

  constructor(
    readonly video: HTMLVideoElement,
    private readonly acquire: () => Promise<MediaStream>,
    private readonly changed: (status: CameraStatus, message?: string) => void,
  ) {
    video.muted = true;
    video.autoplay = true;
    video.playsInline = true;
  }

  stop(): void {
    this.generation++;
    this.stream?.getTracks().forEach((track) => { track.onended = null; track.stop(); });
    this.stream = null;
    this.video.pause();
    this.video.srcObject = null;
    this.status = 'off';
    if (!this.disposed) this.changed('off');
  }

  async start(): Promise<void> {
    if (this.disposed || this.status !== 'off') return;
    const generation = ++this.generation;
    const stale = () => this.disposed || generation !== this.generation;
    this.status = 'starting';
    this.changed('starting', '正在打开摄像头，请允许浏览器使用摄像头…');
    try {
      const stream = await this.acquire();
      if (stale()) { stream.getTracks().forEach((track) => track.stop()); return; }
      this.stream = stream;
      for (const track of stream.getVideoTracks()) track.onended = () => {
        if (stale()) return;
        this.stop();
        this.changed('off', '摄像头已断开，请再次点击相机按钮重试。');
      };
      this.video.srcObject = stream;
      await this.video.play();
      if (stale()) return;
      this.status = 'active';
      this.changed('active', '相机已打开 · 再按一次关闭');
    } catch (error) {
      if (stale()) return;
      this.stop();
      this.changed('off', cameraErrorMessage(error));
    }
  }

  dispose(): void {
    this.disposed = true;
    this.stop();
  }
}
