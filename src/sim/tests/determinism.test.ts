import { describe, it, expect } from 'vitest';
import { newSim, normalizedSerialize } from './helpers';
import type { Command } from '../core/Commands';

const SCRIPT: Command[] = [
  { type: 'SET_PRICE', firmId: 'firm_2', productId: 'bread', price: 380 },
  { type: 'HIRE_WORKER', facilityId: 'fac_1', citizenId: null },
];

function runScripted(seed: number, ticks: number): string {
  const sim = newSim(seed);
  for (let i = 0; i < ticks; i++) {
    if (i === 100) for (const c of SCRIPT) sim.dispatch(c);
    sim.tick();
  }
  return normalizedSerialize(sim.getState());
}

describe('Determinism', () => {
  it('produces identical state for the same seed and command sequence', () => {
    const a = runScripted(1234, 800);
    const b = runScripted(1234, 800);
    expect(a).toBe(b);
  });

  it('produces different state for different seeds', () => {
    const a = runScripted(1, 500);
    const b = runScripted(2, 500);
    expect(a).not.toBe(b);
  });

  it('rng state advances deterministically', () => {
    const s1 = newSim(99);
    const s2 = newSim(99);
    s1.run(250);
    s2.run(250);
    expect(s1.getState().rngState).toBe(s2.getState().rngState);
  });
});
