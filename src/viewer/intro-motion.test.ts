import { expect, test } from 'vitest';
import { introPose, INTRO_DURATION, INTRO_TIMING } from './intro-motion';

test('starts invisible and closed, rotates 240 degrees and stops at the front before opening', () => {
  expect(introPose(0)).toMatchObject({ phase: 'spinning', opacity: 0, angle: 0 });
  expect(introPose(0).azimuth).toBeCloseTo(-Math.PI * 4 / 3);
  const middle = introPose(.7);
  expect(middle.opacity).toBeGreaterThan(0);
  expect(middle.opacity).toBeLessThan(1);
  expect(middle.angle).toBe(0);
  expect(introPose(INTRO_TIMING.spin)).toMatchObject({ phase: 'opening', azimuth: -0, elevation: 0, opacity: 1, angle: 0 });
  // A visible opening within 100 ms prevents the old near-stationary front pause.
  expect(introPose(INTRO_TIMING.spin + .1).angle).toBeGreaterThan(5);
  expect(Math.abs(introPose(INTRO_TIMING.spin - .2).azimuth)).toBeGreaterThan(10 * Math.PI / 180);
});

test('unfolds only while facing front and reveals controls only after fully opening', () => {
  const openStart = INTRO_TIMING.spin;
  const middle = introPose(openStart + INTRO_TIMING.open / 2);
  expect(middle.phase).toBe('opening');
  expect(middle.azimuth).toBe(-0);
  expect(middle.angle).toBeCloseTo(90);
  const reveal = introPose(openStart + INTRO_TIMING.open);
  expect(reveal).toMatchObject({ phase: 'revealing', angle: 180, opacity: 1 });
  expect(introPose(INTRO_DURATION)).toMatchObject({ phase: 'complete', angle: 180, opacity: 1, radiusScale: 1 });
  expect(introPose(INTRO_DURATION + 10)).toEqual(introPose(INTRO_DURATION));
});

test('phase boundaries and animation endpoints remain continuous', () => {
  for (const time of [INTRO_TIMING.spin, INTRO_TIMING.spin + INTRO_TIMING.open]) {
    const before = introPose(time - .00001);
    const after = introPose(time + .00001);
    expect(Math.abs(before.azimuth - after.azimuth)).toBeLessThan(.00001);
    expect(Math.abs(before.angle - after.angle)).toBeLessThan(.00001);
  }
  let previous = introPose(0);
  for (let i = 1; i <= 200; i++) {
    const current = introPose(i * INTRO_DURATION / 200);
    expect(current.angle).toBeGreaterThanOrEqual(previous.angle);
    expect(current.azimuth).toBeGreaterThanOrEqual(previous.azimuth);
    expect(current.opacity).toBeGreaterThanOrEqual(previous.opacity);
    previous = current;
  }
});
