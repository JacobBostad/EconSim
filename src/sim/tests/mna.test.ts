import { describe, it, expect } from 'vitest';
import { newSim, findFirmByName } from './helpers';
import { totalMoneySupply } from '../core/GameState';
import { companyValuation } from '../selectors/companySelectors';
import { ACQUISITION_PREMIUM_HEALTHY } from '../data/constants';
import { deserialize, serialize } from '../persistence/saveLoad';

describe('M&A full takeovers', () => {
  it('acquiring an AI firm absorbs everything and conserves money', () => {
    const sim = newSim(1);
    const state = sim.getState();
    const player = state.firms[state.playerFirmId]!;
    const target = findFirmByName(state, 'Sunrise Foods');
    const targetId = target.id;
    const targetFacilities = [...target.facilities];
    const targetEmployees = [...target.employees];
    const targetCash = target.cash;
    const targetDebt = target.debt;
    const supplyBefore = totalMoneySupply(state);

    const val = companyValuation(state, targetId).valuation;
    const cost = Math.max(1, Math.round(val * ACQUISITION_PREMIUM_HEALTHY));
    player.cash = cost + 1000; // just enough
    const supplyAfterFunding = totalMoneySupply(state);
    expect(supplyAfterFunding).toBe(supplyBefore + cost + 1000 - 15000 * 100);

    sim.dispatch({ type: 'ACQUIRE_FIRM', firmId: player.id, targetFirmId: targetId });

    expect(state.firms[targetId]).toBeUndefined();
    expect(player.acquiredNames).toEqual(['Sunrise Foods']);
    for (const facId of targetFacilities) {
      expect(state.facilities[facId]!.ownerFirmId).toBe(player.id);
      expect(player.facilities).toContain(facId);
    }
    for (const cid of targetEmployees) {
      expect(state.citizens[cid]!.employerFirmId).toBe(player.id);
      expect(player.employees).toContain(cid);
    }
    // Paid the premium, gained the target's cash, absorbed its debt.
    expect(player.cash).toBe(1000 + targetCash);
    expect(player.debt).toBe(targetDebt);
    expect(totalMoneySupply(state)).toBe(supplyAfterFunding);
    // Contracts re-owned; none reference the dead firm.
    for (const cid in state.contracts) {
      expect(state.contracts[cid]!.ownerFirmId).not.toBe(targetId);
    }
  });

  it('held shares discount the buyout price', () => {
    const a = newSim(4);
    const b = newSim(4);
    for (const sim of [a, b]) {
      sim.getState().firms[sim.getState().playerFirmId]!.cash = 100_000_00;
    }
    const bState = b.getState();
    const bTarget = findFirmByName(bState, 'Granite Industries');
    bState.firms[bState.playerFirmId]!.sharesHeld[bTarget.id] = 40;

    const aState = a.getState();
    const aTarget = findFirmByName(aState, 'Granite Industries');
    a.dispatch({ type: 'ACQUIRE_FIRM', firmId: aState.playerFirmId, targetFirmId: aTarget.id });
    b.dispatch({ type: 'ACQUIRE_FIRM', firmId: bState.playerFirmId, targetFirmId: bTarget.id });

    // Same seed, same target — the 40% holder pays ~60% of the full price.
    expect(bState.firms[bState.playerFirmId]!.cash)
      .toBeGreaterThan(aState.firms[aState.playerFirmId]!.cash);
  });

  it('cannot acquire without cash; nothing changes', () => {
    const sim = newSim(1);
    const state = sim.getState();
    const player = state.firms[state.playerFirmId]!;
    const target = findFirmByName(state, 'Loom & Thread');
    player.cash = 100; // far too little
    sim.dispatch({ type: 'ACQUIRE_FIRM', firmId: player.id, targetFirmId: target.id });
    expect(state.firms[target.id]).toBeTruthy();
    expect(player.cash).toBe(100);
    expect(player.acquiredNames).toEqual([]);
  });

  it('the world keeps running after an acquisition (and unlocks The Shark)', () => {
    const sim = newSim(2);
    const state = sim.getState();
    const player = state.firms[state.playerFirmId]!;
    player.cash = 200_000_00;
    const target = findFirmByName(state, 'Sunrise Foods');
    sim.dispatch({ type: 'ACQUIRE_FIRM', firmId: player.id, targetFirmId: target.id });
    sim.run(48 * 3 + 1); // three days
    expect(sim.getState().achievements.map((x) => x.id)).toContain('shark');
    // The absorbed bread chain still sells under the player's flag.
    expect(player.accounting.lifetime.revenue).toBeGreaterThan(0);
    // Save/load still round-trips with the firm gone.
    const loaded = deserialize(serialize(sim.getState()));
    expect(Object.values(loaded.firms).some((f) => f.name === 'Sunrise Foods')).toBe(false);
  });
});
