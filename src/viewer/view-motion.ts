import { Spherical, Vector3 } from 'three';
import { nearestAngle, stepSpring } from './motion';

/** Orbit in spherical coordinates so opposite views never cross the model. */
export class ViewMotion {
  private values: number[];
  private velocities = [0, 0, 0, 0, 0, 0];
  private targets: number[];

  constructor(position: Vector3, focus: Vector3, destination: Vector3) {
    const orbit = new Spherical().setFromVector3(position.clone().sub(focus));
    this.values = [orbit.theta, orbit.phi, orbit.radius, focus.x, focus.y, focus.z];
    this.targets = [...this.values];
    this.retarget(destination);
  }

  retarget(destination: Vector3): void {
    const orbit = new Spherical().setFromVector3(destination);
    this.targets = [nearestAngle(this.values[0]!, orbit.theta), orbit.phi, orbit.radius, 0, 0, 0];
  }

  step(seconds: number, position: Vector3, focus: Vector3, immediate = false): boolean {
    let finished = true;
    for (let i = 0; i < this.values.length; i++) {
      const next = stepSpring(this.values[i]!, this.velocities[i]!, this.targets[i]!, seconds, 18);
      this.values[i] = next.value;
      this.velocities[i] = next.velocity;
      if (Math.abs(next.value - this.targets[i]!) > .0001 || Math.abs(next.velocity) > .001) finished = false;
    }
    if (finished || immediate) {
      this.values = [...this.targets];
      this.velocities.fill(0);
      finished = true;
    }
    focus.set(this.values[3]!, this.values[4]!, this.values[5]!);
    const orbit = new Spherical(Math.max(.001, this.values[2]!), this.values[1]!, this.values[0]!).makeSafe();
    position.setFromSpherical(orbit).add(focus);
    return finished;
  }
}
