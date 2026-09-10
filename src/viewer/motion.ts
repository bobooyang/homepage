/** Exact critically damped spring; velocity survives target changes. */
export function stepSpring(value: number, velocity: number, target: number, seconds: number, frequency = 14): { value: number; velocity: number } {
  if (!Number.isFinite(seconds) || seconds <= 0) return { value, velocity };
  const offset = value - target;
  const decay = Math.exp(-frequency * seconds);
  const impulse = velocity + frequency * offset;
  return {
    value: target + (offset + impulse * seconds) * decay,
    velocity: (velocity - frequency * impulse * seconds) * decay,
  };
}

export function nearestAngle(current: number, target: number): number {
  return current + Math.atan2(Math.sin(target - current), Math.cos(target - current));
}
