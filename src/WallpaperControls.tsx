import { useEffect, useRef, useState, type RefObject } from 'react';
import type { ScreenName, ViewerController } from './viewer/types';
import { prepareWallpaper } from './viewer/wallpaper-image';
import { readWallpaper, writeWallpaper } from './viewer/wallpaper-store';

const screens: { key: ScreenName; label: string; hint: string }[] = [
  { key: 'outer', label: '外屏', hint: '合上时显示' },
  { key: 'inner', label: '内屏', hint: '展开时显示' },
];
type Entry = { url: string; busy: boolean; message: string };
const emptyEntry = (): Entry => ({ url: '', busy: false, message: '' });

export function WallpaperControls({ controllerRef, ready }: { controllerRef: RefObject<ViewerController | null>; ready: boolean }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const inputRefs = useRef<Partial<Record<ScreenName, HTMLInputElement | null>>>({});
  const previewUrls = useRef<Record<ScreenName, string>>({ inner: '', outer: '' });
  const alive = useRef(false);
  const [initializing, setInitializing] = useState(true);
  const [entries, setEntries] = useState<Record<ScreenName, Entry>>({ inner: emptyEntry(), outer: emptyEntry() });

  function update(screen: ScreenName, patch: Partial<Entry>) {
    if (alive.current) setEntries((current) => ({ ...current, [screen]: { ...current[screen], ...patch } }));
  }
  function replacePreview(screen: ScreenName, blob: Blob | null) {
    URL.revokeObjectURL(previewUrls.current[screen]);
    const url = blob ? URL.createObjectURL(blob) : '';
    previewUrls.current[screen] = url;
    update(screen, { url });
  }

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      for (const url of Object.values(previewUrls.current)) URL.revokeObjectURL(url);
    };
  }, []);

  useEffect(() => {
    if (!ready || !controllerRef.current) return;
    let canceled = false;
    const controller = controllerRef.current;
    void Promise.all(screens.map(async ({ key }) => {
      try {
        const saved = await readWallpaper(key);
        if (!saved || canceled) return;
        const prepared = await prepareWallpaper(saved, key);
        if (canceled) return;
        controller.setWallpaper(key, prepared.canvas);
        replacePreview(key, prepared.blob);
      } catch {
        if (!canceled) update(key, { message: '未能读取已保存的壁纸，可重新选择图片。' });
      }
    })).then(() => {
      if (!canceled) {
        setInitializing(false);
        controller.startIntro();
      }
    });
    return () => { canceled = true; };
  }, [ready, controllerRef]);

  async function changeWallpaper(screen: ScreenName, file: File | null) {
    const controller = controllerRef.current;
    if (!controller || initializing || entries[screen].busy) return;
    update(screen, { busy: true, message: '' });
    try {
      const prepared = file ? await prepareWallpaper(file, screen) : null;
      if (!alive.current || controller !== controllerRef.current) return;
      controller.setWallpaper(screen, prepared?.canvas ?? null);
      replacePreview(screen, prepared?.blob ?? null);
      try {
        await writeWallpaper(screen, prepared?.blob ?? null);
        update(screen, { message: file ? '已应用并保存在此浏览器。' : '已恢复默认壁纸。' });
      } catch {
        update(screen, { message: '已应用，但本地保存失败；刷新后可能还原。请检查浏览器存储空间。' });
      }
    } catch (error) {
      update(screen, { message: error instanceof Error ? error.message : '更换失败，请重试。' });
    } finally { update(screen, { busy: false }); }
  }

  return <>
    <button className="wallpaper-trigger" onClick={() => dialogRef.current?.showModal()} aria-haspopup="dialog">更换壁纸</button>
    <dialog ref={dialogRef} className="wallpaper-dialog" aria-labelledby="wallpaper-title">
      <div className="wallpaper-dialog-heading">
        <h2 id="wallpaper-title">屏幕壁纸</h2>
        <button className="wallpaper-close" onClick={() => dialogRef.current?.close()} aria-label="关闭壁纸设置">×</button>
      </div>
      <p className="wallpaper-description">分别设置内外屏，图片会居中裁剪铺满屏幕。</p>
      <div className="wallpaper-screens">
        {screens.map(({ key, label, hint }) => <section className="wallpaper-screen" key={key} aria-label={`${label}壁纸`}>
          <div className={`wallpaper-preview ${key}`}>
            {entries[key].url ? <img src={entries[key].url} alt={`${label}自定义壁纸预览`} /> : <span>默认壁纸</span>}
          </div>
          <h3>{label}<span>{hint}</span></h3>
          <input type="file" hidden accept="image/jpeg,image/png,image/webp" aria-label={`选择${label}图片`}
            ref={(element) => { inputRefs.current[key] = element; }}
            onChange={(event) => {
              const file = event.currentTarget.files?.[0];
              event.currentTarget.value = '';
              if (file) void changeWallpaper(key, file);
            }} />
          <button className="wallpaper-upload" disabled={!ready || initializing || entries[key].busy}
            onClick={() => inputRefs.current[key]?.click()}>{entries[key].busy ? '正在处理…' : `上传${label}图片`}</button>
          <button className="wallpaper-reset" disabled={!ready || initializing || entries[key].busy || !entries[key].url}
            onClick={() => void changeWallpaper(key, null)} aria-label={`恢复${label}默认壁纸`}>恢复默认</button>
          <p className="wallpaper-message" role="status">{entries[key].message}</p>
        </section>)}
      </div>
      <p className="wallpaper-note">JPG、PNG 或 WebP，每张不超过 20 MB。图片仅保存在当前浏览器，不会上传到服务器。</p>
      {initializing && <p className="wallpaper-note" role="status">{ready ? '正在读取已保存的壁纸…' : '模型加载后即可更换壁纸。'}</p>}
    </dialog>
  </>;
}
