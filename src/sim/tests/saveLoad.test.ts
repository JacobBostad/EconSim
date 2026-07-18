import { describe, it, expect } from 'vitest';
import { newSim, normalizedSerialize } from './helpers';
import { serialize, deserialize, cloneState, saveGame, loadGame, hasSave, BACKUP_SLOT } from '../persistence/saveLoad';
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

describe('Save slots (backup)', () => {
  it('keeps the backup slot independent of the default slot', () => {
    // Node has no localStorage — stub a Map-backed one for this test.
    const store = new Map<string, string>();
    (globalThis as Record<string, unknown>).localStorage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
      key: (i: number) => [...store.keys()][i] ?? null,
      get length() { return store.size; },
    };
    try {
      const simA = newSim(1);
      simA.run(50);
      const simB = newSim(2);
      expect(saveGame(simA.getState(), BACKUP_SLOT)).toBe(true);
      expect(saveGame(simB.getState())).toBe(true);
      expect(hasSave(BACKUP_SLOT)).toBe(true);

      const backup = loadGame(BACKUP_SLOT)!;
      const main = loadGame()!;
      expect(normalizedSerialize(backup)).toBe(normalizedSerialize(simA.getState()));
      expect(normalizedSerialize(main)).toBe(normalizedSerialize(simB.getState()));
    } finally {
      delete (globalThis as Record<string, unknown>).localStorage;
    }
  });
});
