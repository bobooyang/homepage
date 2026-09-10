export type Finish = 'star-white' | 'night-sky';
export type ViewName = 'front' | 'back' | 'left' | 'right' | 'perspective';
export type DeviceButtonName = 'Power' | 'Camera' | 'VolumeUp' | 'VolumeDown';
export type ScreenName = 'inner' | 'outer';

export interface InteractionState {
  angle: number;
  target: number;
  foldVelocity: number;
  moving: boolean;
  powered: boolean;
  screen: ScreenName;
  volume: number;
  lastButton: DeviceButtonName | '';
}

export interface ButtonTargetSnapshot {
  name: DeviceButtonName;
  x: number;
  y: number;
  visible: boolean;
  pressed: boolean;
}

export interface ViewerSnapshot extends InteractionState {
  cameraStatus: import('./camera-preview').CameraStatus;
  introPhase: import('./intro-motion').IntroPhase;
  introSkipped: boolean;
  finish: Finish | null;
  loading: boolean;
  loadMessage: string;
  error: string | null;
  view: ViewName | null;
  hud: { label: string; volume: number | null } | null;
  buttonTargets: ButtonTargetSnapshot[];
}

export interface ViewerController {
  startIntro: () => void;
  skipIntro: () => void;
  setWallpaper: (screen: ScreenName, image: HTMLCanvasElement | null) => void;
  setFinish: (finish: Finish) => void;
  setView: (view: ViewName) => void;
  setAngle: (angle: number) => void;
  foldTo: (target: 0 | 180) => void;
  pauseFold: () => void;
  retry: () => void;
  dispose: () => void;
}
