import { expect, test } from 'vitest';
import {
  createInteractionState,
  pressDeviceButton,
  requestFold,
  setAngle,
  stepFold,
} from './interaction-state';

test('mid-flight reversals continue from the current angle', () => {
  const state = createInteractionState();
  requestFold(state, 180);
  stepFold(state, 0.4);
  const angle = state.angle;
  const velocity = state.foldVelocity;
  expect(angle).toBeGreaterThan(0);
  expect(angle).toBeLessThan(180);

  requestFold(state, 0);
  expect(state.angle).toBe(angle);
  expect(state.foldVelocity).toBe(velocity);
  stepFold(state, 0.1);
  expect(state.angle).toBeLessThan(angle);

  requestFold(state, 180);
  stepFold(state, 0.2);
  expect(state.angle).toBeGreaterThan(0);
  expect(state.angle).toBeLessThan(180);
  stepFold(state, 10);
  expect(state.angle).toBe(180);
  expect(state.moving).toBe(false);
});

test('scrubbing pauses playback, clamps angles, and allows playback to resume', () => {
  const state = createInteractionState();
  requestFold(state, 180);
  stepFold(state, 0.2);
  setAngle(state, 92);
  stepFold(state, 0.5);
  expect(state.angle).toBe(92);
  expect(state.moving).toBe(false);
  expect(state.target).toBe(180);

  requestFold(state, 180);
  stepFold(state, 0.1);
  expect(state.angle).toBeGreaterThan(92);
  expect(state.angle).toBeLessThan(180);
  setAngle(state, -100);
  expect(state.angle).toBe(0);
  setAngle(state, 300);
  expect(state.angle).toBe(180);
});

test('screen handoff retains the previous screen between the 20 and 30 degree thresholds', () => {
  const state = createInteractionState();
  setAngle(state, 29.9);
  expect(state.screen).toBe('outer');
  setAngle(state, 30);
  expect(state.screen).toBe('inner');
  for (const angle of [29, 25, 20.1]) {
    setAngle(state, angle);
    expect(state.screen).toBe('inner');
  }
  setAngle(state, 20);
  expect(state.screen).toBe('outer');
});

test('power and volume persist through folding; camera only records feedback', () => {
  const state = createInteractionState();
  pressDeviceButton(state, 'Power');
  for (let i = 0; i < 50; i++) pressDeviceButton(state, 'VolumeUp');
  expect(state.volume).toBe(100);
  requestFold(state, 180);
  stepFold(state, 1);
  expect(state.powered).toBe(false);
  expect(state.volume).toBe(100);
  expect(state.screen).toBe('inner');

  const before = { ...state };
  pressDeviceButton(state, 'Camera');
  expect(state).toEqual({ ...before, lastButton: 'Camera' });
  for (let i = 0; i < 50; i++) pressDeviceButton(state, 'VolumeDown');
  expect(state.volume).toBe(0);
  pressDeviceButton(state, 'Power');
  expect(state.powered).toBe(true);
});

test('invalid numeric inputs leave playback intact and valid updates can continue', () => {
  const state = createInteractionState();
  requestFold(state, 180);
  stepFold(state, 0.25);
  const before = { ...state };

  for (const value of [NaN, Infinity, -Infinity]) {
    setAngle(state, value);
    expect(state).toEqual(before);
    requestFold(state, value);
    expect(state).toEqual(before);
    stepFold(state, value);
    expect(state).toEqual(before);
  }
  stepFold(state, 0);
  stepFold(state, -1);
  expect(state).toEqual(before);
  stepFold(state, 0.25);
  expect(state.angle).toBeGreaterThan(before.angle);
  expect(state.angle).toBeLessThan(180);
  expect(state.moving).toBe(true);
});

test('slider targets animate from the rendered angle, converge quickly and preserve the screen hysteresis', () => {
  const state = createInteractionState();
  requestFold(state, 95);
  expect(state.angle).toBe(0);
  stepFold(state, .1, 48);
  expect(state.angle).toBeGreaterThan(90);
  expect(state.angle).toBeLessThan(95);
  expect(state.screen).toBe('inner');
  const before = state.angle;
  requestFold(state, 15);
  expect(state.angle).toBe(before);
  stepFold(state, 1, 48);
  expect(state).toMatchObject({ angle: 15, target: 15, moving: false, screen: 'outer', foldVelocity: 0 });
});

test('repeated reversals remain within physical hinge limits and settle on the latest target', () => {
  const state = createInteractionState();
  for (let i = 0; i < 100; i++) {
    requestFold(state, i % 2 ? 0 : 180);
    stepFold(state, 1 / 60);
    expect(state.angle).toBeGreaterThanOrEqual(0);
    expect(state.angle).toBeLessThanOrEqual(180);
  }
  requestFold(state, 63);
  stepFold(state, 2);
  expect(state).toMatchObject({ angle: 63, target: 63, moving: false });
});

test('rapid target changes stop playback when the latest target is the current endpoint', () => {
  const state = createInteractionState();
  for (const target of [180, 0, 180, 0]) requestFold(state, target);
  stepFold(state, 0.5);
  expect(state).toMatchObject({ angle: 0, target: 0, moving: false });

  requestFold(state, 180);
  stepFold(state, 1);
  for (const target of [0, 180, 0, 180]) requestFold(state, target);
  stepFold(state, 0.5);
  expect(state).toMatchObject({ angle: 180, target: 180, moving: false });
});
