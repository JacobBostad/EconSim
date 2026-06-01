import { describe, it, expect } from 'vitest';
import { newSim, normalizedSerialize } from './helpers';
import { serialize, deserialize, cloneState } from '../persistence/saveLoad';
import { Simulation } from '../core/Simulation';

describe('Save / Load', () => {
  it('restores an identical simulation from a serialized save', () => {
    const sim = newSim(321);
    sim.run(300);
    const saved = serialize(sim.getState());

    const loaded = deserialize(saved);
    const sim2 = new Simulation(loaded);

    expect(normalizedSerialize(sim2.getState())).toBe(
      normalizedSerialize(sim.getState()),
    );
  });

  it('continues deterministically after load (save == keep-running)', () => {
    const sim = newSim(321);
    sim.run(300);

    // Branch A: keep running the original.
    const kept = new Simulation(cloneState(sim.getState()));
    kept.run(200);

    // Branch B: save, load, then run.
    const reloaded = new Simulation(deserialize(serialize(sim.getState())));
    reloaded.run(200);

    expect(normalizedSerialize(reloaded.getState())).toBe(
      normalizedSerialize(kept.getState()),
    );
  });
});
