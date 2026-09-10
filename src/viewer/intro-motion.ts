export type IntroPhase = 'waiting' | 'spinning' | 'opening' | 'revealing' | 'complete';
export const INTRO_TIMING = { spin: 1.45, open: .75, reveal: .55 };
export const INTRO_DURATION = Object.values(INTRO_TIMING).reduce((sum, duration) => sum + duration, 0);
const ease = (value: number): number => {
  const t = Math.min(1, Math.max(0, value));
  return t * t * t * (t * (t * 6 - 15) + 10);
};
// Keep zero endpoint velocity without the prolonged near-still tails of quintic easing.
const motionEase = (value: number): number => {
  const t = Math.min(1, Math.max(0, value));
  return t * t * (3 - 2 * t);
};

export function introPose(elapsed: number) {
  const { spin, open } = INTRO_TIMING;
  const rotation = motionEase(elapsed / spin);
  const opening = motionEase((elapsed - spin) / open);
  const phase: IntroPhase = elapsed >= INTRO_DURATION ? 'complete'
    : elapsed >= spin + open ? 'revealing'
    : elapsed >= spin ? 'opening' : 'spinning';
  return {
    phase,
    azimuth: -Math.PI * 4 / 3 * (1 - rotation),
    elevation: .16 * (1 - rotation),
    opacity: ease(elapsed / .8),
    angle: 180 * opening,
    radiusScale: 1 + .12 * (1 - rotation),
  };
}
