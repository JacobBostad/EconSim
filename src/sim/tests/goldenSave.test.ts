import { describe, it, expect } from 'vitest';
import fixtureJson from './fixtures/golden-save-v1.json';
import fixture2Json from './fixtures/golden-save-v2.json';
import fixture3Json from './fixtures/golden-save-v3.json';
import fixture4Json from './fixtures/golden-save-v4.json';
import fixture5Json from './fixtures/golden-save-v5.json';
import { Simulation } from '../core/Simulation';
import { deserialize, serialize } from '../persistence/saveLoad';
import { totalMoneySupply } from '../core/GameState';
import { ticksPerDay } from '../core/Tick';

/**
 * Golden-save compatibility guard: a REAL save produced by an earlier build
 * (day 40, seed 777 — chains, multi-product store, export orders, shares,
 * festival, upgrade, achievements, missions, trade prices, world events all
 * populated). Every future change must keep this artifact loadable and
 * runnable. If a migration is needed, add it to migrations.ts — do NOT
 * regenerate this fixture to paper over a break.
 */
describe('Golden save fixture', () => {
  const raw = JSON.stringify(fixtureJson);

  it('loads through the migration chain intact', () => {
    const state = deserialize(raw);
    expect(state.playerFirmId).toBeTruthy();
    const player = state.firms[state.playerFirmId]!;
    expect(player.facilities.length).toBeGreaterThanOrEqual(4);
    const store = player.facilities.map((i) => state.facilities[i]!).find((f) => f.type === 'retail')!;
    expect(store.retailProductIds.length).toBeGreaterThanOrEqual(2);
    const wh = player.facilities.map((i) => state.facilities[i]!).find((f) => f.type === 'warehouse')!;
    expect(wh.exportOrders['grain']).toBeTruthy();
    expect(Object.keys(player.sharesHeld).length).toBe(1);
    expect(state.achievements.length).toBeGreaterThan(0);
    expect(state.missions.length).toBeGreaterThan(0);
    expect(Object.keys(state.tradeCities['port_rosa']!.pricesByProduct).length).toBeGreaterThanOrEqual(8);
    // Round-trip stability: loading a re-serialized load changes nothing.
    const again = deserialize(serialize(state));
    expect(serialize(again)).toBe(serialize(state));
  });

  it('the loaded world keeps running with money conserved', () => {
    const state = deserialize(raw);
    const supply0 = totalMoneySupply(state);
    const sim = new Simulation(state);
    sim.run(ticksPerDay(state.config) * 5 + 1);
    expect(totalMoneySupply(sim.getState())).toBe(supply0);
    expect(Object.keys(sim.getState().citizens).length).toBeGreaterThan(0);
  });
});

/**
 * Golden save v2 — a modern-feature artifact (day 80, seed 777): coffee
 * chain, apartment with tenants, AI personalities/CEOs, town history,
 * wage-market state, doubled production lines possibly in flight. Same
 * contract as v1: never regenerate to paper over a break.
 */
describe('Golden save fixture v2 (modern features)', () => {
  const raw2 = JSON.stringify(fixture2Json);

  it('loads intact with every modern field populated', () => {
    const state = deserialize(raw2);
    const player = state.firms[state.playerFirmId]!;
    expect(player.facilities.some((i) => state.facilities[i]?.defId === 'apartment')).toBe(true);
    expect(
      player.facilities.some((i) => state.facilities[i]?.retailProductIds.includes('coffee')),
    ).toBe(true);
    expect(state.townHistory.length).toBeGreaterThan(50);
    expect(state.scenarioId).toBe('meadowbrook');
    for (const f of Object.values(state.firms)) {
      if (f.ownerType === 'ai') {
        expect(f.personalityId).toBeTruthy();
        expect(f.ceoName).toBeTruthy();
      }
    }
    const again = deserialize(serialize(state));
    expect(serialize(again)).toBe(serialize(state));
  });

  it('keeps running deterministically with money conserved', () => {
    const state = deserialize(raw2);
    const supply0 = totalMoneySupply(state);
    const sim = new Simulation(state);
    expect(() => sim.run(ticksPerDay(state.config) * 10)).not.toThrow();
    expect(totalMoneySupply(sim.getState())).toBe(supply0);
  });
});

/**
 * Golden save v3 — the wholesale era (day 100, seed 888): player farms with
 * AI wholesale customers, a store buying bread wholesale from an AI factory,
 * Ironvale exports, both trade-city books walked, facility P&L EMAs
 * populated. Same contract as v1/v2: never regenerate to paper over a break.
 */
describe('Golden save fixture v3 (wholesale era)', () => {
  const raw3 = JSON.stringify(fixture3Json);

  it('loads intact with every wholesale-era field populated', () => {
    const state = deserialize(raw3);
    const player = state.firms[state.playerFirmId]!;
    expect(player.wholesaleEarned).toBeGreaterThan(0);
    expect(player.wholesaleSpend).toBeGreaterThan(0);
    expect(player.exportRevenueByCity['ironvale'] ?? 0).toBeGreaterThan(0);
    expect(Object.keys(state.tradeCities)).toContain('ironvale');
    expect(Object.keys(state.tradeCities)).toContain('port_rosa');
    // Live AI customer contracts sourcing from the player's facilities.
    const aiCustomers = Object.values(state.contracts).filter((c) => {
      const src = state.facilities[c.sourceFacilityId];
      return c.active && src && player.facilities.includes(src.id)
        && state.firms[c.ownerFirmId]?.ownerType === 'ai';
    });
    expect(aiCustomers.length).toBeGreaterThanOrEqual(1);
    // Facility P&L EMAs carry real numbers.
    expect(Object.values(state.facilities).some((f) => f.pnlEma.net !== 0)).toBe(true);
    const again = deserialize(serialize(state));
    expect(serialize(again)).toBe(serialize(state));
  });

  it('keeps running with money conserved', () => {
    const state = deserialize(raw3);
    const supply0 = totalMoneySupply(state);
    const sim = new Simulation(state);
    expect(() => sim.run(ticksPerDay(state.config) * 10)).not.toThrow();
    expect(totalMoneySupply(sim.getState())).toBe(supply0);
  });
});

describe('Golden save fixture v4 (rush-order / fire-sale era)', () => {
  const raw4 = JSON.stringify(fixture4Json);

  it('loads intact with every rush/fire-sale field populated', () => {
    const state = deserialize(raw4);
    // Earned counters came through the real engine paths.
    expect(state.rushOrdersCompleted).toBe(1);
    expect(state.fireSalesBought).toBe(1);
    // Live offers mid-flight.
    expect(state.rushOrder).not.toBeNull();
    expect(state.rushOrder!.filled).toBeGreaterThan(0);
    expect(state.rushOrder!.bonusCents).toBeGreaterThan(0);
    expect(state.facilityOffer).not.toBeNull();
    expect(state.facilities[state.facilityOffer!.facilityId]).toBeDefined();
    expect(state.lastLapsedFireSale).not.toBeNull();
    // The fire-sale purchase actually moved a building to the player.
    const player = state.firms[state.playerFirmId]!;
    const boughtFactory = player.facilities
      .map((id) => state.facilities[id]!)
      .filter((f) => f.type === 'factory');
    expect(boughtFactory.length).toBeGreaterThanOrEqual(2); // chain's own + fire-sale buy
    const again = deserialize(serialize(state));
    expect(serialize(again)).toBe(serialize(state));
  });

  it('keeps running with money conserved, offers expiring naturally', () => {
    const state = deserialize(raw4);
    const supply0 = totalMoneySupply(state);
    const sim = new Simulation(state);
    expect(() => sim.run(ticksPerDay(state.config) * 10)).not.toThrow();
    expect(totalMoneySupply(sim.getState())).toBe(supply0);
    // Both live offers resolve one way or another within ten days.
    const end = sim.getState();
    expect(end.rushOrder === null || end.rushOrder.startDay > 33).toBe(true);
  });
});

/**
 * Golden save v5 — the four-pillar era (day 82, seed 999): prosperity tiers
 * derived with real spread, a premium-positioned store run by a hired
 * manager, a logistics manager on the executive team, a commodity-desk
 * position staged, an open forward contract, and tier counts flowing into
 * townHistory. Same contract as ever: never regenerate to paper over a break.
 */
describe('Golden save fixture v5 (four-pillar era)', () => {
  const raw5 = JSON.stringify(fixture5Json);

  it('loads intact with every pillar field populated', () => {
    const state = deserialize(raw5);
    const player = state.firms[state.playerFirmId]!;
    // Managers on payroll, one per kind.
    expect(player.managers.some((m) => m.role === 'store' && m.facilityId)).toBe(true);
    expect(player.managers.some((m) => m.role === 'logistics' && m.facilityId === null)).toBe(true);
    // A positioned store and an open forward.
    expect(
      player.facilities.some((i) => state.facilities[i]?.positioning === 'premium'),
    ).toBe(true);
    expect(player.forwards.length).toBe(1);
    expect(player.forwards[0]!.lockedPrice).toBeGreaterThan(0);
    // Tiers derived with real spread, recorded in town history.
    const tiers = new Set(Object.values(state.citizens).map((c) => c.tier));
    expect(tiers.size).toBeGreaterThanOrEqual(2);
    const last = state.townHistory[state.townHistory.length - 1]!;
    expect(last.workers + last.comfortable + last.affluent).toBe(last.population);
    const again = deserialize(serialize(state));
    expect(serialize(again)).toBe(serialize(state));
  });

  it('keeps running with money conserved, the forward settling naturally', () => {
    const state = deserialize(raw5);
    const supply0 = totalMoneySupply(state);
    const sim = new Simulation(state);
    expect(() => sim.run(ticksPerDay(state.config) * 12)).not.toThrow();
    expect(totalMoneySupply(sim.getState())).toBe(supply0);
    // The open forward settled (delivered or defaulted) once its day passed.
    expect(sim.getState().firms[state.playerFirmId]!.forwards.length).toBe(0);
  });
});
