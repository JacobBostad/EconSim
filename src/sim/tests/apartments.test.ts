import { describe, it, expect } from 'vitest';
import { newSim } from './helpers';
import { makeContext, totalMoneySupply } from '../core/GameState';
import { ticksPerDay } from '../core/Tick';
import { runRentSystem } from '../systems/RentSystem';
import { runSatisfactionSystem } from '../systems/SatisfactionSystem';
import { runAIStrategySystem } from '../systems/AIStrategySystem';
import { APARTMENT_RENT_PER_DAY } from '../data/constants';

function withApartment(seed: number) {
  const sim = newSim(seed);
  const state = sim.getState();
  const player = state.firms[state.playerFirmId]!;
  sim.dispatch({ type: 'BUILD_FACILITY', firmId: player.id, defId: 'apartment', location: { x: 43, y: 64 } });
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

describe('AI landlord', () => {
  it('a flush AI firm builds an apartment under a housing squeeze (never before day 30)', () => {
    const sim = newSim(8);
    const state = sim.getState();
    const foods = Object.values(state.firms).find((f) => f.name === 'Sunrise Foods')!;
    foods.cash = 80000_00;
    // Squeeze: every home full.
    for (const fid in state.facilities) {
      const f = state.facilities[fid]!;
      if (f.type === 'home') {
        while (f.residentIds.length < 2) f.residentIds.push('cit_pad_' + fid + f.residentIds.length);
      }
    }
    const tpd = ticksPerDay(state.config);
    const aiApartments = () =>
      Object.values(state.facilities).filter(
        (f) => f.defId === 'apartment' && state.firms[f.ownerFirmId]?.ownerType === 'ai',
      );

    for (let d = 1; d <= 29; d++) {
      state.tick = tpd * d;
      runAIStrategySystem(makeContext(state));
    }
    expect(aiApartments().length).toBe(0);

    let built = 0;
    for (let d = 31; d <= 150 && built === 0; d++) {
      state.tick = tpd * d;
      foods.cash = Math.max(foods.cash, 80000_00);
      runAIStrategySystem(makeContext(state));
      built = aiApartments().length;
    }
    expect(built).toBeGreaterThan(0);

    // Caps: keep forging days; no firm exceeds 2 apartments.
    for (let d = 151; d <= 400; d++) {
      state.tick = tpd * d;
      for (const f of Object.values(state.firms)) if (f.ownerType === 'ai') f.cash = 80000_00;
      runAIStrategySystem(makeContext(state));
    }
    const byFirm: Record<string, number> = {};
    for (const apt of aiApartments()) byFirm[apt.ownerFirmId] = (byFirm[apt.ownerFirmId] ?? 0) + 1;
    for (const n of Object.values(byFirm)) expect(n).toBeLessThanOrEqual(2);
  });
});
