import { expect, test } from 'vitest';
import { Vector3 } from 'three';
import { ViewMotion } from './view-motion';
import { nearestAngle, stepSpring } from './motion';

const directions = [new Vector3(0, 0, 5), new Vector3(0, 0, -5), new Vector3(-5, 0, 0), new Vector3(5, 0, 0), new Vector3(.62, .55, 1).normalize().multiplyScalar(5)];

test('all preset pairs orbit outside the model and reach their exact destination', () => {
  for (const start of directions) for (const end of directions) {
    const position = start.clone();
    const focus = new Vector3();
    const motion = new ViewMotion(position, focus, end);
    expect(position.equals(start)).toBe(true);
    for (let frame = 0; frame < 60; frame++) {
      const previous = position.clone();
      motion.step(1 / 60, position, focus);
      expect(position.length()).toBeCloseTo(5, 6);
      expect(position.distanceTo(previous)).toBeLessThan(2);
    }
    expect(position.distanceTo(end)).toBeLessThan(.00001);
  }
});

test('retargeting preserves pose and velocity, and the last target wins', () => {
  const position = directions[0]!.clone();
  const focus = new Vector3();
  const motion = new ViewMotion(position, focus, directions[1]!);
  motion.step(.1, position, focus);
  const before = position.clone();
  motion.retarget(directions[2]!);
  expect(position.equals(before)).toBe(true);
  motion.step(.00001, position, focus);
  expect(position.distanceTo(before)).toBeLessThan(.001);
  motion.retarget(directions[4]!);
  motion.step(2, position, focus);
  expect(position.distanceTo(directions[4]!)).toBeLessThan(.00001);
});

test('a panned and zoomed camera returns smoothly; immediate completion supports reduced motion', () => {
  const focus = new Vector3(1, 2, 0);
  const position = new Vector3(1, 2, 10);
  const motion = new ViewMotion(position, focus, directions[1]!);
  motion.step(.05, position, focus);
  expect(focus.y).toBeGreaterThan(0);
  expect(focus.y).toBeLessThan(2);
  expect(position.distanceTo(focus)).toBeGreaterThan(5);
  expect(motion.step(0, position, focus, true)).toBe(true);
  expect(focus.length()).toBe(0);
  expect(position.distanceTo(directions[1]!)).toBeLessThan(.00001);
});

test('angular wrap chooses the short route across the back of the model', () => {
  expect(nearestAngle(Math.PI - .1, -Math.PI + .1)).toBeCloseTo(Math.PI + .1);
});

test('spring motion is independent of frame rate and preserves velocity on reversal', () => {
  const oneStep = stepSpring(0, 0, 180, .5);
  let split = { value: 0, velocity: 0 };
  for (let i = 0; i < 30; i++) split = stepSpring(split.value, split.velocity, 180, 1 / 60);
  expect(split.value).toBeCloseTo(oneStep.value, 9);
  expect(split.velocity).toBeCloseTo(oneStep.velocity, 9);
  const before = stepSpring(0, 0, 180, .05);
  const after = stepSpring(before.value, before.velocity, 0, .000001);
  expect(Math.abs(after.velocity - before.velocity)).toBeLessThan(.1);
});
