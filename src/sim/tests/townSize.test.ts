import { describe, it, expect } from 'vitest';
import { newSim } from './helpers';
import { createInitialState } from '../data/startingScenario';
import { DEFAULT_CONFIG } from '../core/SimulationConfig';
import { homeSlotFor } from '../systems/ImmigrationSystem';
import { serialize, deserialize } from '../persistence/saveLoad';

describe('Town size', () => {
  it('old saves get the classic caps', () => {
    const sim = newSim(1);
    const raw = JSON.parse(serialize(sim.getState()));
    delete raw.config.maxHomes;
    delete raw.config.maxCitizens;
    const reloaded = deserialize(JSON.stringify(raw));
    expect(reloaded.config.maxHomes).toBe(40);
    expect(reloaded.config.maxCitizens).toBe(80);
  });

  it('home slots are unique and in-bounds for a bustling map', () => {
    const mapHeight = 124;
    const seen = new Set<string>();
    for (let i = 0; i < 60; i++) { // homes 21..80
      const slot = homeSlotFor(i, mapHeight)!;
      expect(slot).toBeTruthy();
      expect(slot.y).toBeLessThanOrEqual(mapHeight - 4);
      expect(slot.x).toBeGreaterThanOrEqual(8);
      expect(slot.x).toBeLessThanOrEqual(130 - 8);
      const key = `${slot.x},${slot.y}`;
      expect(seen.has(key)).toBe(false);
      seen.add(key);
    }
    // The classic map runs out after the eastern block.
    expect(homeSlotFor(0, 92)).toBeTruthy();
    expect(homeSlotFor(20, 92)).toBeNull();
  });

  it('a bustling config carries its caps through save/load', () => {
    const state = createInitialState(1, { ...DEFAULT_CONFIG, maxHomes: 80, maxCitizens: 160, mapHeight: 124 });
    const reloaded = deserialize(serialize(state));
    expect(reloaded.config.maxHomes).toBe(80);
    expect(reloaded.config.maxCitizens).toBe(160);
    expect(reloaded.config.mapHeight).toBe(124);
  });
});
