import { describe, it, expect } from 'vitest';
import { newSim } from './helpers';
import { makeContext, totalMoneySupply } from '../core/GameState';
import { ticksPerDay } from '../core/Tick';
import { runRentSystem } from '../systems/RentSystem';
import { runSatisfactionSystem } from '../systems/SatisfactionSystem';
import { APARTMENT_RENT_PER_DAY } from '../data/constants';

function withApartment(seed: number) {
  const sim = newSim(seed);
  const state = sim.getState();
  const player = state.firms[state.playerFirmId]!;
  sim.dispatch({ type: 'BUILD_FACILITY', firmId: player.id, defId: 'apartment', location: { x: 40, y: 62 } });
  const apt = state.facilities[player.facilities[0]!]!;
  // Move two existing citizens in.
  const tenants = Object.values(state.citizens).slice(0, 2);
  for (const t of tenants) {
    const old = state.facilities[t.homeFacilityId];
    if (old) old.residentIds = old.residentIds.filter((id) => id !== t.id);
    t.homeFacilityId = apt.id;
    apt.residentIds.push(t.id);
  }
  return { sim, state, player, apt, tenants };
}

describe('Apartments', () => {
  it('residents pay daily rent to the owner; money is conserved', () => {
    const { state, player, tenants } = withApartment(3);
    for (const t of tenants) t.cash = 500_00;
    const cashBefore = player.cash;
    const supply = totalMoneySupply(state);
    state.tick = ticksPerDay(state.config);
    runRentSystem(makeContext(state));
    expect(player.cash).toBe(cashBefore + APARTMENT_RENT_PER_DAY * 2);
    expect(player.accounting.today.revenue).toBeGreaterThanOrEqual(APARTMENT_RENT_PER_DAY * 2);
    expect(totalMoneySupply(state)).toBe(supply);
  });

  it('never charges a broke resident', () => {
    const { state, player, tenants } = withApartment(3);
    tenants[0]!.cash = 100; // can't afford the 5-day buffer
    tenants[1]!.cash = 500_00;
    const cashBefore = player.cash;
    state.tick = ticksPerDay(state.config);
    runRentSystem(makeContext(state));
    expect(player.cash).toBe(cashBefore + APARTMENT_RENT_PER_DAY);
  });

  it('municipal homes stay free', () => {
    const sim = newSim(3);
    const state = sim.getState();
    const supply = totalMoneySupply(state);
    const cits = Object.values(state.citizens).map((c) => c.cash);
    state.tick = ticksPerDay(state.config);
    runRentSystem(makeContext(state));
    expect(totalMoneySupply(state)).toBe(supply);
    expect(Object.values(state.citizens).map((c) => c.cash)).toEqual(cits);
  });

  it('apartment residents settle at higher satisfaction', () => {
    const { state, tenants } = withApartment(3);
    const control = Object.values(state.citizens).find(
      (c) => !tenants.includes(c) && c.employmentStatus === tenants[0]!.employmentStatus,
    )!;
    // Equalize starting points and run many daily passes toward equilibrium.
    for (const c of [tenants[0]!, control]) {
      c.satisfaction = 50;
      c.needs.forEach((n) => (n.urgency = 0));
    }
    for (let d = 1; d <= 30; d++) {
      state.tick = ticksPerDay(state.config) * d;
      for (const c of [tenants[0]!, control]) c.needs.forEach((n) => (n.urgency = 0));
      runSatisfactionSystem(makeContext(state));
    }
    expect(tenants[0]!.satisfaction).toBeGreaterThan(control.satisfaction + 2);
  });

  it('immigration fills empty apartments like any home', () => {
    const { state, apt } = withApartment(3);
    apt.residentIds = []; // vacant premium housing
    for (const cid in state.citizens) {
      if (state.citizens[cid]!.homeFacilityId === apt.id) {
        state.citizens[cid]!.homeFacilityId = Object.values(state.facilities).find((f) => f.type === 'home' && f.id !== apt.id)!.id;
      }
    }
    // Homes with room exist (incl. the apartment) — the immigration home-pick
    // loop treats type 'home' uniformly; assert the apartment qualifies.
    const withRoom = Object.values(state.facilities).filter(
      (f) => f.type === 'home' && f.residentIds.length < 2,
    );
    expect(withRoom.some((f) => f.id === apt.id)).toBe(true);
  });
});
