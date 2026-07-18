import { describe, it, expect } from 'vitest';
import { newSim } from './helpers';
import { satisfactionAnatomy } from '../selectors/satisfactionSelectors';

describe('satisfactionAnatomy', () => {
  it('decomposition terms sum to the equilibrium (unclamped case)', () => {
    const sim = newSim(3);
    const state = sim.getState();
    // Craft a clean state: no urgent needs, mixed employment.
    for (const cid in state.citizens) {
      state.citizens[cid]!.needs.forEach((n) => (n.urgency = 0));
    }
    const a = satisfactionAnatomy(state);
    expect(a.provisioningTerm).toBeCloseTo(15, 5);
    expect(a.productDrag).toEqual([]);
    expect(a.equilibrium).toBeCloseTo(a.base + a.employmentTerm + a.housingTerm + a.provisioningTerm, 5);
  });

  it('ranks product drag by weighted unmet pressure', () => {
    const sim = newSim(3);
    const state = sim.getState();
    for (const cid in state.citizens) {
      for (const n of state.citizens[cid]!.needs) {
        n.urgency = n.productId === 'bread' ? 3 : n.productId === 'tools' ? 2 : 0;
      }
    }
    const a = satisfactionAnatomy(state);
    expect(a.productDrag[0]!.productId).toBe('bread'); // heavier weight + higher urgency
    expect(a.productDrag.some((d) => d.productId === 'tools')).toBe(true);
    expect(a.productDrag[0]!.points).toBeGreaterThan(a.productDrag[1]!.points);
    expect(a.provisioningTerm).toBeLessThan(15);
  });
});
