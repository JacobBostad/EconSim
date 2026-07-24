/**
 * regionPartnerMarket.test.ts — the LIVE partner's quote from its REAL book
 * (region.md step 4, slice 5: retire the pool table, the gradient's end). Pins:
 *
 *  - RETIREMENT: a live `port_rosa` carries NO pool row (its quote reads its real
 *    shelf/demand); `ironvale` (stub) and a flag-off `port_rosa` KEEP their pool.
 *  - REAL-STATE QUOTE: the partner's export cover is `realShelf / realDemand`,
 *    mapped through the same clamped cover curve — sane (in-band), not pegged.
 *  - THE PAYOFF: a partner-side shock (drain its larder) makes cover FALL and its
 *    export quote RISE; with freight, home's next export settles at that shocked
 *    (higher) price. The arc's stated endgame — "export prices respond to a real
 *    (tiny) economy."
 *  - THE SANITY BAR (the design's NO-SHIP line): over a 300-day flag-on soak the
 *    live quote stays BOUNDED within the cover band's intent, the partner economy
 *    stays SOLVENT, and region money is conserved to the cent.
 *  - GATING: flag-off `port_rosa` is a stub on the pool path (pinned baselines
 *    byte-identical — covered in regionScheduler/regionFreight; asserted here as
 *    the pool-row presence).
 */

import { describe, it, expect } from 'vitest';
import { Simulation } from '../core/Simulation';
import { createInitialState } from '../data/startingScenario';
import { DEFAULT_CONFIG } from '../core/SimulationConfig';
import type { SimulationConfig } from '../core/SimulationConfig';
import { ticksPerDay } from '../core/Tick';
import { totalMoneySupply } from '../core/GameState';
import { PARTNER_TOWN_ID } from '../data/seedTown';
import {
  cityPrice,
  performExport,
  exportFreightFee,
} from '../core/Trade';
import {
  partnerLarderStock,
  partnerLarderStore,
  partnerCoverDays,
} from '../core/PartnerMarket';
import { addStock, getQuantity, removeStock } from '../entities/Inventory';
import { getProduct } from '../data/products';
import {
  TRADE_POOL_MULT_MIN,
  TRADE_POOL_MULT_MAX,
  FREIGHT_LEAD_DAYS,
} from '../data/constants';

function cityConfig(): SimulationConfig {
  return {
    ...DEFAULT_CONFIG,
    sizePreset: 'city',
    servicesEnabled: true,
    realEstateEnabled: true,
    investorsEnabled: true,
    tradeDemandPoolsEnabled: true,
  };
}
function regionConfig(): SimulationConfig {
  return { ...cityConfig(), regionEnabled: true };
}
function regionSim(seed = 11): Simulation {
  const sim = new Simulation(createInitialState(seed, regionConfig()));
  sim.dispatch({ type: 'RESUME' });
  return sim;
}

describe('Region slice 5 — the pool is RETIRED for the live partner', () => {
  it('a live port_rosa carries no pool row; ironvale keeps its pool', () => {
    const on = createInitialState(11, regionConfig());
    expect(on.tradeCities[PARTNER_TOWN_ID]?.pool).toBeUndefined(); // retired
    expect(on.tradeCities['ironvale']?.pool).toBeDefined(); // stub keeps it
    // The partner IS a real town whose shelf backs the quote.
    expect(partnerLarderStock(on, PARTNER_TOWN_ID, 'bread')).toBeGreaterThan(0);
  });

  it('a flag-off port_rosa is a STUB and KEEPS its pool row', () => {
    const off = createInitialState(11, cityConfig());
    expect(off.tradeCities[PARTNER_TOWN_ID]?.pool).toBeDefined(); // stub, pool stays
    expect(off.towns[PARTNER_TOWN_ID]).toBeUndefined(); // not a live town
  });
});

describe('Region slice 5 — the quote reads the partner real book (sane, in-band)', () => {
  it('after warm-up, staple cover sits in the mult band (not pegged at a rail)', () => {
    const sim = regionSim(11);
    const state = sim.getState();
    sim.run(ticksPerDay(state.config) * 40); // past the seed ramp
    // Bread: the partner's real shelf ÷ real demand lands cover in a sane range,
    // so the cover mult sits WITHIN [MIN, MAX], not pinned at either clamp.
    const cover = partnerCoverDays(state, PARTNER_TOWN_ID, 'bread');
    expect(cover).toBeGreaterThan(2);
    expect(cover).toBeLessThan(12);
    const q = cityPrice(state, PARTNER_TOWN_ID, 'bread');
    const base = getProduct('bread').basePrice;
    // The quote is a real number within the walk's own band (the cover layers in).
    expect(q).toBeGreaterThan(base * TRADE_POOL_MULT_MIN * 0.6);
    expect(q).toBeLessThan(base * TRADE_POOL_MULT_MAX * 1.9);
  });
});

describe('Region slice 5 — THE PAYOFF: a partner shock moves home’s quote', () => {
  it('draining the partner larder RAISES its export quote (cover falls)', () => {
    const sim = regionSim(11);
    const state = sim.getState();
    sim.run(ticksPerDay(state.config) * 40); // steady state
    const pid = 'bread';
    const qBefore = cityPrice(state, PARTNER_TOWN_ID, pid);
    const coverBefore = partnerCoverDays(state, PARTNER_TOWN_ID, pid);
    const store = partnerLarderStore(state, PARTNER_TOWN_ID, pid)!;
    const shelf = partnerLarderStock(state, PARTNER_TOWN_ID, pid)!;
    // SHOCK: drain the larder to ~15% (a starved port).
    removeStock(store.inputInventory, pid, Math.round(shelf * 0.85));
    const qAfter = cityPrice(state, PARTNER_TOWN_ID, pid);
    const coverAfter = partnerCoverDays(state, PARTNER_TOWN_ID, pid);
    expect(coverAfter).toBeLessThan(coverBefore);
    expect(qAfter).toBeGreaterThan(qBefore); // the quote RISES on a real shortage
  });

  it('with freight, home’s export settles HIGHER when the partner is shocked', () => {
    // Two arms, identical but for the partner-side shock: the shocked partner's
    // thin larder lifts its quote, so the SAME 300-bread export locks — and later
    // settles — at a strictly higher price. Home's export price responds to the
    // partner's real state (the arc's endgame), and money is conserved throughout.
    function dispatchAndSettle(shock: boolean): { locked: number; net: number; conserved: boolean } {
      const sim = regionSim(11);
      const state = sim.getState();
      sim.run(ticksPerDay(state.config) * 40);
      if (shock) {
        const store = partnerLarderStore(state, PARTNER_TOWN_ID, 'bread')!;
        const shelf = getQuantity(store.inputInventory, 'bread');
        removeStock(store.inputInventory, 'bread', Math.round(shelf * 0.85));
      }
      const player = state.firms[state.playerFirmId]!;
      player.cash = 500000_00;
      sim.dispatch({ type: 'BUILD_FACILITY', firmId: player.id, defId: 'warehouse', location: { x: 100, y: 20 } });
      const wh = state.facilities[player.facilities[player.facilities.length - 1]!]!;
      addStock(wh.inputInventory, 'bread', 300, 60);
      const money0 = totalMoneySupply(state);
      performExport(state, player.id, wh.id, 'bread', 300, 'Exported', PARTNER_TOWN_ID);
      const ship = { ...state.freight[0]! };
      let conserved = true;
      for (let d = 0; d < FREIGHT_LEAD_DAYS + 1; d++) {
        sim.run(ticksPerDay(state.config));
        if (totalMoneySupply(state) !== money0) conserved = false;
      }
      const net = Math.round(ship.priceLocked * (1 - exportFreightFee(state, PARTNER_TOWN_ID)));
      const paid = state.transactions.filter(
        (t) => t.note.startsWith('Freight delivered to') && t.amount === net * 300,
      );
      expect(paid.length).toBe(1); // settled once at the locked price
      return { locked: ship.priceLocked, net, conserved };
    }
    const calm = dispatchAndSettle(false);
    const shocked = dispatchAndSettle(true);
    expect(shocked.locked).toBeGreaterThan(calm.locked); // the shocked quote is dearer
    expect(shocked.net).toBeGreaterThan(calm.net); // ...and home is paid more on delivery
    expect(calm.conserved && shocked.conserved).toBe(true); // conserved across the window
  });
});

describe('Region slice 5 — THE SANITY BAR (300-day flag-on soak; the NO-SHIP line)', () => {
  it('the live quote stays bounded, the partner stays solvent, money conserved', () => {
    const sim = regionSim(11);
    const state = sim.getState();
    const money0 = totalMoneySupply(state);
    const partner = state.towns[PARTNER_TOWN_ID]!;
    const staples = ['bread', 'coffee', 'tools', 'clothes'];
    const base: Record<string, number> = {};
    for (const p of staples) base[p] = getProduct(p).basePrice;
    let conserved = true;
    // The walk itself is bounded to [0.6, 1.8]× base; the cover mult layers within
    // it, so a SANE live quote never leaves the walk band. Soak 300 days and assert
    // every daily quote stays inside a hair of that band (no runaway spiral).
    for (let d = 0; d < 300; d++) {
      sim.run(ticksPerDay(state.config));
      if (totalMoneySupply(state) !== money0) conserved = false;
      for (const p of staples) {
        const q = cityPrice(state, PARTNER_TOWN_ID, p);
        expect(q).toBeGreaterThan(base[p]! * 0.55);
        expect(q).toBeLessThan(base[p]! * 1.85);
      }
    }
    expect(conserved).toBe(true); // conserved to the cent every day
    // The partner economy is SOLVENT at the end of the soak.
    let firmCash = 0;
    for (const fid in partner.firms) firmCash += partner.firms[fid]!.cash;
    let cohortCash = 0;
    for (const cid in partner.cohorts) cohortCash += partner.cohorts[cid]!.cashPool;
    expect(firmCash).toBeGreaterThan(0);
    expect(cohortCash).toBeGreaterThan(0);
    // The shelf held near its cover buffer (not drained to zero, not exploded).
    const breadShelf = partnerLarderStock(state, PARTNER_TOWN_ID, 'bread')!;
    expect(breadShelf).toBeGreaterThan(100);
    expect(breadShelf).toBeLessThan(50000);
  });
});
