import { describe, it, expect } from 'vitest';
import { newSim } from './helpers';
import { totalMoneySupply } from '../core/GameState';
import { worldDemandMult, worldSpendingMult } from '../data/worldEvents';
import { FESTIVAL_COST, FUND_HOME_COST, MAX_CITIZENS } from '../data/constants';

describe('Civic actions', () => {
  it('sponsoring a festival starts the event and boosts demand', () => {
    const sim = newSim(1);
    const state = sim.getState();
    const player = state.firms[state.playerFirmId]!;
    const cashBefore = player.cash;
    const supply0 = totalMoneySupply(state);

    sim.dispatch({ type: 'CIVIC_ACTION', firmId: player.id, action: 'festival' });
    expect(player.cash).toBe(cashBefore - FESTIVAL_COST);
    expect(state.worldEvents.some((ev) => ev.defId === 'festival')).toBe(true);
    expect(worldDemandMult(state, 'bread')).toBeCloseTo(1.25);
    expect(worldSpendingMult(state)).toBeCloseTo(1.05);
    expect(totalMoneySupply(state)).toBe(supply0);

    // No double-sponsoring.
    sim.dispatch({ type: 'CIVIC_ACTION', firmId: player.id, action: 'festival' });
    expect(state.worldEvents.filter((ev) => ev.defId === 'festival').length).toBe(1);
    expect(player.cash).toBe(cashBefore - FESTIVAL_COST);
  });

  it('funding a home adds housing and two funded citizens, conserved', () => {
    const sim = newSim(1);
    const state = sim.getState();
    const player = state.firms[state.playerFirmId]!;
    const homesBefore = Object.values(state.facilities).filter((f) => f.type === 'home').length;
    const citsBefore = Object.keys(state.citizens).length;
    const supply0 = totalMoneySupply(state);
    const cashBefore = player.cash;

    sim.dispatch({ type: 'CIVIC_ACTION', firmId: player.id, action: 'fund_home' });

    const homes = Object.values(state.facilities).filter((f) => f.type === 'home');
    expect(homes.length).toBe(homesBefore + 1);
    expect(Object.keys(state.citizens).length).toBe(citsBefore + 2);
    expect(player.cash).toBe(cashBefore - FUND_HOME_COST);
    expect(totalMoneySupply(state)).toBe(supply0);
    // New arrivals have needs, a home, and starting cash.
    const newHome = homes[homes.length - 1]!;
    expect(newHome.residentIds.length).toBe(2);
    for (const cid of newHome.residentIds) {
      expect(state.citizens[cid]!.cash).toBeGreaterThan(0);
    }
  });

  it('respects the town population cap', () => {
    const sim = newSim(1);
    const state = sim.getState();
    const player = state.firms[state.playerFirmId]!;
    player.cash = 10_000_000_00;
    for (let i = 0; i < 40; i++) {
      sim.dispatch({ type: 'CIVIC_ACTION', firmId: player.id, action: 'fund_home' });
    }
    expect(Object.keys(state.citizens).length).toBeLessThanOrEqual(MAX_CITIZENS);
  });
});
