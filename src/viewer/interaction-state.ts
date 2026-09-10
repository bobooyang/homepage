import type { DeviceButtonName, InteractionState } from './types';
import { stepSpring } from './motion';

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

export function createInteractionState(): InteractionState {
  return {
    angle: 0,
    target: 180,
    foldVelocity: 0,
    moving: false,
    powered: true,
    screen: 'outer',
    volume: 50,
    lastButton: '',
  };
}

export function setAngle(
  state: InteractionState,
  angle: number,
  pause = true,
): void {
  if (!Number.isFinite(angle)) return;
  state.angle = clamp(angle, 0, 180);
  if (pause) { state.moving = false; state.foldVelocity = 0; }
  if (state.angle <= 20) state.screen = 'outer';
  else if (state.angle >= 30) state.screen = 'inner';
}

export function requestFold(state: InteractionState, target: number): void {
  if (!Number.isFinite(target)) return;
  state.target = clamp(target, 0, 180);
  state.moving = state.angle !== state.target || Math.abs(state.foldVelocity) > .01;
}

export function stepFold(state: InteractionState, seconds: number, frequency = 18): void {
  if (!state.moving || !Number.isFinite(seconds) || seconds <= 0) return;
  const next = stepSpring(state.angle, state.foldVelocity, state.target, seconds, frequency);
  state.foldVelocity = next.velocity;
  setAngle(state, next.value, false);
  if ((state.angle === 0 && state.foldVelocity < 0) || (state.angle === 180 && state.foldVelocity > 0)) state.foldVelocity = 0;
  if (Math.abs(state.angle - state.target) < .01 && Math.abs(state.foldVelocity) < .1) {
    setAngle(state, state.target);
  }
}

export function pressDeviceButton(
  state: InteractionState,
  button: DeviceButtonName,
): void {
  if (!['Power', 'Camera', 'VolumeUp', 'VolumeDown'].includes(button)) return;
  state.lastButton = button;
  if (button === 'Power') state.powered = !state.powered;
  if (button === 'VolumeUp') state.volume = clamp(state.volume + 5, 0, 100);
  if (button === 'VolumeDown') state.volume = clamp(state.volume - 5, 0, 100);
}
