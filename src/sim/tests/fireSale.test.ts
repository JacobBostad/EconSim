import { describe, it, expect } from 'vitest';
import { newSim } from './helpers';
import { ticksPerDay, computeTime } from '../core/Tick';
import { totalMoneySupply } from '../core/GameState';
import { deserialize, serialize } from '../persistence/saveLoad';
import { FIRE_SALE_LOSS_FLOOR } from '../systems/FireSaleSystem';
import { FIRE_SALE_RATE } from '../core/FireSale';

/**
 * Force an AI facility into a sustained-loser shape — and its owner into a
 * firm-level loss — so an offer can roll (profitable firms never fire-sale;
 * the trigger requires the seller to be struggling).
 */
function bleedWorstAIFacility(sim: ReturnType<typeof newSim>) {
  const state = sim.getState();
  const fac = Object.values(state.facilities).find(
    (f) => state.firms[f.ownerFirmId]?.ownerType === 'ai' && f.type === 'factory',
  )!;
  fac.pnlEma.revenue = 0;
  fac.pnlEma.cost = 50_00;
  fac.pnlEma.net = -50_00;
  const firm = state.firms[fac.ownerFirmId]!;
  const last = firm.accounting.dailyHistory[firm.accounting.dailyHistory.length - 1];
  if (last) {
    for (const d of firm.accounting.dailyHistory.slice(-7)) d.netProfit = -30_00;
  } else {
    firm.bankruptcyStatus = 'distressed';
  }
  return fac;
}

describe('Fire-sale offers', () => {
  it('an offer eventually rolls for a bleeding AI facility, and lapses unaccepted', () => {
    const sim = newSim(2);
    const state = sim.getState();
    const tpd = ticksPerDay(state.config);
    let sawOffer = false;
    let sawLapse = false;
    for (let day = 0; day < 80; day++) {
      bleedWorstAIFacility(sim); // EMA re-decays each day; keep it bleeding
      sim.run(tpd);
      if (state.facilityOffer) {
        sawOffer = true;
        expect(computeTime(state.tick, state.config).day).toBeGreaterThanOrEqual(20);
        expect(state.facilityOffer.askCents).toBeGreaterThan(0);
      } else if (sawOffer) {
        sawLapse = true;
      }
    }
    expect(sawOffer).toBe(true);
    expect(sawLapse).toBe(true);
    expect(state.fireSalesBought).toBe(0);
  });

  it('accepting transfers the building, crew, and supply lines, conserved', () => {
    const sim = newSim(2);
    const state = sim.getState();
    const player = state.firms[state.playerFirmId]!;
    player.cash = 50000_00;
    const fac = bleedWorstAIFacility(sim);
    const seller = state.firms[fac.ownerFirmId]!;
    const crew = [...fac.employees];
    const ask = Math.round(fac.buildCost * FIRE_SALE_RATE);
    state.facilityOffer = {
      facilityId: fac.id,
      sellerFirmId: seller.id,
      askCents: ask,
      startDay: 0,
      deadlineDay: 99,
    };
    const feeding = Object.values(state.contracts).find(
      (c) => c.ownerFirmId === seller.id && c.destinationFacilityId === fac.id,
    );
    const supply0 = totalMoneySupply(state);
    const playerCash0 = player.cash;
    const sellerCash0 = seller.cash;

    sim.dispatch({ type: 'ACCEPT_FACILITY_OFFER' });

    expect(fac.ownerFirmId).toBe(player.id);
    expect(player.facilities).toContain(fac.id);
    expect(seller.facilities).not.toContain(fac.id);
    expect(player.cash).toBe(playerCash0 - ask);
    expect(seller.cash).toBe(sellerCash0 + ask);
    expect(totalMoneySupply(state)).toBe(supply0);
    for (const cid of crew) {
      expect(state.citizens[cid]!.employerFirmId).toBe(player.id);
      expect(player.employees).toContain(cid);
      expect(seller.employees).not.toContain(cid);
    }
    if (feeding) expect(feeding.ownerFirmId).toBe(player.id);
    expect(state.facilityOffer).toBeNull();
    expect(state.fireSalesBought).toBe(1);

    // Achievement lands on the next hourly scan.
    sim.run(ticksPerDay(state.config));
    expect(state.achievements.some((a) => a.id === 'bargain_hunter')).toBe(true);
  });

  it('cannot accept without cash, and a stale offer self-clears', () => {
    const sim = newSim(2);
    const state = sim.getState();
    const player = state.firms[state.playerFirmId]!;
    const fac = bleedWorstAIFacility(sim);
    const seller = state.firms[fac.ownerFirmId]!;
    player.cash = 0;
    state.facilityOffer = {
      facilityId: fac.id, sellerFirmId: seller.id,
      askCents: 1000_00, startDay: 0, deadlineDay: 99,
    };
    sim.dispatch({ type: 'ACCEPT_FACILITY_OFFER' });
    expect(fac.ownerFirmId).toBe(seller.id);
    expect(state.facilityOffer).not.toBeNull();

    // Seller no longer owns it (e.g. absorbed elsewhere) — offer clears.
    state.facilityOffer!.sellerFirmId = state.playerFirmId;
    sim.dispatch({ type: 'ACCEPT_FACILITY_OFFER' });
    expect(state.facilityOffer).toBeNull();
    expect(state.fireSalesBought).toBe(0);
  });

  it('the loss floor gates offers and state survives save/load with defaults', () => {
    expect(FIRE_SALE_LOSS_FLOOR).toBeLessThan(0);
    const sim = newSim(3);
    const state = sim.getState();
    const fac = bleedWorstAIFacility(sim);
    state.facilityOffer = {
      facilityId: fac.id, sellerFirmId: fac.ownerFirmId,
      askCents: 5000_00, startDay: 1, deadlineDay: 5,
    };
    const loaded = deserialize(serialize(state));
    expect(loaded.facilityOffer).toEqual(state.facilityOffer);

    const raw = JSON.parse(serialize(state)) as Record<string, unknown>;
    delete raw.facilityOffer;
    delete raw.fireSalesBought;
    const migrated = deserialize(JSON.stringify(raw));
    expect(migrated.facilityOffer).toBeNull();
    expect(migrated.fireSalesBought).toBe(0);
  });
});
