import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { createDuoViewer } from './viewer/createDuoViewer';
import { createInteractionState } from './viewer/interaction-state';
import { WallpaperControls } from './WallpaperControls';
import type { Finish, ViewName, ViewerController, ViewerSnapshot } from './viewer/types';

const finishes: { value: Finish; label: string; swatch: string }[] = [
  { value: 'star-white', label: '星白色', swatch: 'white' },
  { value: 'night-sky', label: '夜空色', swatch: 'navy' },
];
const views: { value: ViewName; label: string }[] = [
  { value: 'front', label: '正面' },
  { value: 'back', label: '背面' },
  { value: 'left', label: '左侧' },
  { value: 'right', label: '右侧' },
  { value: 'perspective', label: '立体' },
];

function initialSnapshot(): ViewerSnapshot {
  return {
    introPhase: 'waiting',
    cameraStatus: 'off',
    introSkipped: false,
    ...createInteractionState(),
    finish: null,
    loading: true,
    loadMessage: '正在加载交互模型…',
    error: null,
    view: 'perspective',
    hud: null,
    buttonTargets: [],
  };
}

export default function App() {
  const stageRef = useRef<HTMLDivElement>(null);
  const controllerRef = useRef<ViewerController | null>(null);
  const [snapshot, setSnapshot] = useState<ViewerSnapshot>(initialSnapshot);

  useEffect(() => {
    if (!stageRef.current) return;
    try {
      const controller = createDuoViewer(stageRef.current, setSnapshot);
      controllerRef.current = controller;
      return () => {
        controllerRef.current = null;
        controller.dispose();
      };
    } catch (error) {
      console.error('无法启动三维样机', error);
      setSnapshot((current) => ({
        ...current,
        loading: false,
        error: '无法启动三维样机，请使用支持 WebGL 2 的浏览器。',
      }));
    }
  }, []);

  const ready = snapshot.finish !== null;
  const chromeVisible = snapshot.introPhase === 'revealing' || snapshot.introPhase === 'complete';
  const interactive = snapshot.introPhase === 'complete';
  const screenLabel = snapshot.powered
    ? `${snapshot.screen === 'inner' ? '内' : '外'}屏亮`
    : '屏幕关闭';

  return (
    <main className="viewer" data-intro={snapshot.introPhase} data-intro-skipped={snapshot.introSkipped}>
      <header className="heading" inert={!interactive} aria-hidden={!chromeVisible}>
        <div>
          <p className="eyebrow">交互模型 / 3D 体验</p>
          <h1>iPhone Duo</h1>
          <div
            id="device-state"
            className="device-state"
            data-angle={snapshot.angle.toFixed(2)}
            data-target={snapshot.target}
            data-moving={snapshot.moving}
            data-power={snapshot.powered ? 'on' : 'off'}
            data-camera={snapshot.cameraStatus}
            data-screen={snapshot.powered ? snapshot.screen : 'off'}
            data-selected-screen={snapshot.screen}
            data-volume={snapshot.volume}
            data-last-button={snapshot.lastButton}
            data-finish={snapshot.finish ?? ''}
          >
            <span>{screenLabel}</span>
            <span>音量 {snapshot.volume}%</span>
            {snapshot.cameraStatus !== 'off' && <span>{snapshot.cameraStatus === 'starting' ? '相机启动中' : '相机预览中'}</span>}
          </div>
        </div>
        <div className="heading-actions"><p className="hint">
          拖动旋转 · 滚轮缩放 · 双指平移<br />
          点击机身按键，体验屏幕与音量控制
        </p><WallpaperControls controllerRef={controllerRef} ready={ready} /></div>
      </header>

      <div className="stage" aria-label="iPhone Duo 三维模型">
        <div ref={stageRef} className="canvas-host" />
        <div
          id="status"
          className={`status${snapshot.error ? ' error' : ''}${ready ? ' has-model' : ''}`}
          role="status"
          hidden={!snapshot.loading && !snapshot.error}
        >
          {snapshot.loading && <span className="spinner" />}
          <span>{snapshot.error ?? snapshot.loadMessage}</span>
          {snapshot.error && controllerRef.current && (
            <button className="text-button" onClick={() => controllerRef.current?.retry()}>
              重新加载
            </button>
          )}
        </div>
        {snapshot.hud && (
          <div className="device-hud" role="status">
            <span>{snapshot.hud.label}</span>
            {snapshot.hud.volume !== null && (
              <div className="hud-meter"><i style={{ width: `${snapshot.hud.volume}%` }} /></div>
            )}
          </div>
        )}
        <div id="button-targets" hidden>
          {snapshot.buttonTargets.map((target) => (
            <span
              key={target.name}
              data-device-button={target.name}
              data-x={target.x.toFixed(1)}
              data-y={target.y.toFixed(1)}
              data-visible={target.visible}
              data-pressed={target.pressed}
            />
          ))}
        </div>
      </div>

      {ready && !interactive && <button className="intro-skip" onClick={() => controllerRef.current?.skipIntro()}>跳过动画</button>}
      {ready && snapshot.introPhase === 'waiting' && <div className="intro-preparing" role="status">正在准备展示…</div>}

      <footer className="controls" inert={!interactive} aria-hidden={!chromeVisible}>
        <div className="finishes" aria-label="机身配色">
          {finishes.map((finish) => (
            <button
              key={finish.value}
              className={`finish${snapshot.finish === finish.value ? ' active' : ''}`}
              aria-pressed={snapshot.finish === finish.value}
              disabled={snapshot.loading}
              onClick={() => controllerRef.current?.setFinish(finish.value)}
            >
              <span className={`swatch ${finish.swatch}`} /><span>{finish.label}</span>
            </button>
          ))}
        </div>
        <div
          className="views"
          aria-label="观察视角"
          data-selected={snapshot.view !== null}
          style={{
            '--view-index': Math.max(0, views.findIndex((view) => view.value === snapshot.view)),
            '--view-count': views.length,
          } as CSSProperties}
        >
          {views.map((view) => (
            <button
              key={view.value}
              className={snapshot.view === view.value ? 'active' : ''}
              aria-pressed={snapshot.view === view.value}
              onClick={() => controllerRef.current?.setView(view.value)}
            >
              {view.label}
            </button>
          ))}
        </div>
        <div className="fold-control">
          <div className="fold-actions" aria-label="折叠机身">
            {([0, 180] as const).map((target) => {
              const active = snapshot.moving ? snapshot.target === target : snapshot.angle === target;
              return (
                <button
                  key={target}
                  className={active ? 'active' : ''}
                  aria-pressed={active}
                  disabled={!ready}
                  onClick={() => controllerRef.current?.foldTo(target)}
                >
                  {target === 0 ? '合上' : '展开'}
                </button>
              );
            })}
            <output id="angle-value" htmlFor="fold-angle">{Math.round(snapshot.angle)}°</output>
          </div>
          <input
            id="fold-angle"
            type="range"
            min={0}
            max={180}
            step={1}
            value={snapshot.moving ? snapshot.target : snapshot.angle}
            aria-label="机身展开角度"
            disabled={!ready}
            onChange={(event) => controllerRef.current?.setAngle(Number(event.target.value))}
          />
        </div>
      </footer>
    </main>
  );
}
