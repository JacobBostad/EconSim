/**
 * assetLiquidity.test.ts — Arc B3 / stock-market Phase 5.
 *
 * The balance sheet made real: upgrade capex accrues to book value, apartments
 * carry value and sell, forwards close at mark, facility sales salvage their
 * stock, and a distressed AI sheds a facility before closing one. Every path
 * conserves money to the cent; the Village-gated pieces are asserted inert on
 * the Village preset (the 300-day bit-identity contract).
 */
import { describe, it, expect } from 'vitest';
import { Simulation } from '../core/Simulation';
import { createInitialState } from '../data/startingScenario';
import { DEFAULT_CONFIG } from '../core/SimulationConfig';
import { ticksPerDay } from '../core/Tick';
import { makeContext, totalMoneySupply } from '../core/GameState';
import { createFacility } from '../entities/factories';
import { addStock } from '../entities/Inventory';
import { nextId } from '../core/Id';
import { upgradeCost } from '../core/Upgrades';
import { SALVAGE_RATE, sellRefund } from '../core/Demolition';
import { forwardMark, closeForward, FORWARD_CLOSE_FEE } from '../systems/ForwardSystem';
import { runBankruptcySystem } from '../systems/BankruptcySystem';
import { exportFreightFee, cityPrice } from '../core/Trade';
import { getProduct } from '../data/products';
import { companyValuation } from '../selectors/companySelectors';
import { newSim } from './helpers';

function citySim(seed: number): Simulation {
  const sim = new Simulation(createInitialState(seed, { ...DEFAULT_CONFIG, sizePreset: 'city' }));
  sim.dispatch({ type: 'RESUME' });
  return sim;
}

describe('Phase 5 — upgrade capex accrues to book value', () => {
  it('accrues the upgrade spend into the parallel book value at city scale', () => {
    const sim = citySim(5);
    const state = sim.getState();
    const player = state.firms[state.playerFirmId]!;
    player.cash = 1_000_000_00;
    const fac = createFacility(state, 'factory', player.id, { x: 50, y: 50 });
    const base = fac.buildCost;
    expect(base).toBeGreaterThan(0);

    const cost = upgradeCost(state, fac.id);
    expect(cost).toBeGreaterThan(0);
    sim.dispatch({ type: 'UPGRADE_FACILITY', firmId: player.id, facilityId: fac.id });

    // Level rose and the invested capital now sits in the parallel book value.
    expect(fac.level).toBe(2);
    // buildCost — the AI-pricing tier's base — is untouched; the capex lands in
    // the separate field, so operatingValuationOf/marketCap don't move.
    expect(fac.buildCost).toBe(base);
    expect(fac.upgradeCapex).toBe(cost);
    // The enriched book value reaches the SELL refund (half of base + capex),
    // an L2 facility no longer refunding at its L1 cost.
    expect(sellRefund(state, player.id, fac.id)).toBe(Math.floor((base + cost) * 0.5));
    // The next upgrade still prices off the definition, not the book value.
    expect(upgradeCost(state, fac.id)).toBeGreaterThan(cost);
  });

  it('leaves Village facility book value untouched by an upgrade (bit-identity gate)', () => {
    const sim = newSim(5); // Village preset
    const state = sim.getState();
    const player = state.firms[state.playerFirmId]!;
    player.cash = 1_000_000_00;
    const fac = createFacility(state, 'factory', player.id, { x: 50, y: 50 });
    const base = fac.buildCost;
    const supply0 = totalMoneySupply(state);

    sim.dispatch({ type: 'UPGRADE_FACILITY', firmId: player.id, facilityId: fac.id });

    expect(fac.level).toBe(2);
    // Village keeps today's booking: the capex left as cash, buildCost is
    // unchanged, and the upgradeCapex field is never even set — so the
    // serialized facility is byte-identical to the pre-Phase-5 baseline.
    expect(fac.buildCost).toBe(base);
    expect(fac.upgradeCapex).toBeUndefined();
    expect(sellRefund(state, player.id, fac.id)).toBe(Math.floor(base * 0.5));
    expect(totalMoneySupply(state)).toBe(supply0); // upgrade spend still conserved
  });
});

describe('Phase 5 — apartments valued and sellable', () => {
  it('sells a player apartment, conserving money and refunding half its book', () => {
    const sim = citySim(6);
    const state = sim.getState();
    const player = state.firms[state.playerFirmId]!;
    const apt = createFacility(state, 'apartment', player.id, { x: 40, y: 60 });
    apt.buildCost = 4500_00;
    const aptId = apt.id;

    const cashBefore = player.cash;
    const supply0 = totalMoneySupply(state);
    sim.dispatch({ type: 'SELL_FACILITY', firmId: player.id, facilityId: aptId });

    expect(state.facilities[aptId]).toBeUndefined();
    expect(player.facilities).not.toContain(aptId);
    expect(player.cash).toBe(cashBefore + Math.floor(4500_00 * 0.5));
    expect(totalMoneySupply(state)).toBe(supply0);
  });

  it('counts an apartment in city valuation but not in Village valuation', () => {
    const delta = (sim: Simulation): number => {
      const state = sim.getState();
      const player = state.firms[state.playerFirmId]!;
      const before = companyValuation(state, player.id).valuation;
      const apt = createFacility(state, 'apartment', player.id, { x: 40, y: 60 });
      apt.buildCost = 4500_00;
      return companyValuation(state, player.id).valuation - before;
    };
    // City books the $4,500 apartment into valuation; Village does not (gated
    // so the Village AI's stake-target marketCap stays bit-identical).
    expect(delta(citySim(6))).toBe(4500_00);
    expect(delta(newSim(6))).toBe(0);
  });
});

describe('Phase 5 — forward close at mark', () => {
  function stageForward(sim: Simulation, opts: { locked: number; spot: number; qty: number }) {
    const state = sim.getState();
    const player = state.firms[state.playerFirmId]!;
    const cityId = 'port_rosa';
    const productId = 'grain';
    const book = state.tradeCities[cityId]!;
    book.pricesByProduct[productId] = opts.spot;
    const fwd = {
      id: nextId(state.idCounters, 'fwd'),
      productId, quantity: opts.qty, cityId, lockedPrice: opts.locked, deliveryDay: 999,
    };
    player.forwards.push(fwd);
    return { state, player, cityId, productId, fwd };
  }

  it('marks a forward at settlement-minus-spot (close + sell spot == deliver)', () => {
    const sim = citySim(7);
    // Grain's price band is ~[$0.90, $2.70]; a spike locked at $2.50 vs a $1.20
    // spot is a realistic in-the-money short.
    const { state, cityId, productId, fwd } = stageForward(sim, { locked: 2_50, spot: 1_20, qty: 50 });
    const freight = exportFreightFee(state, cityId);
    const qty = fwd.quantity;

    const mark = forwardMark(state, fwd);
    // Riding to settlement nets the locked price; selling the same goods spot
    // today nets the spot price — the forward's edge over spot is exactly the
    // mark, so closing (and keeping the goods to sell) equals delivering.
    const settleRevenue = Math.round(fwd.lockedPrice * (1 - freight)) * qty;
    const spotGoodsValue = Math.round(qty * cityPrice(state, cityId, productId) * (1 - freight));
    expect(Math.abs(mark + spotGoodsValue - settleRevenue)).toBeLessThanOrEqual(qty + 1);
    // Locked above spot -> the short is in the money.
    expect(mark).toBeGreaterThan(0);
  });

  it('closes a winning forward: cash rises by mark-minus-fee, money conserved, forward gone', () => {
    const sim = citySim(8);
    const { state, player, fwd } = stageForward(sim, { locked: 2_60, spot: 1_00, qty: 40 });
    const cashBefore = player.cash;
    const supply0 = totalMoneySupply(state);
    const fee = Math.round(fwd.lockedPrice * fwd.quantity * FORWARD_CLOSE_FEE);

    const ok = closeForward(state, player.id, fwd.id);
    expect(ok).toBe(true);
    expect(player.forwards.find((f) => f.id === fwd.id)).toBeUndefined();
    // A clear winner: cash rose net of the fee, and not a cent was minted.
    expect(player.cash).toBeGreaterThan(cashBefore);
    expect(totalMoneySupply(state)).toBe(supply0);
    // The fee reached the world exactly once.
    const feeTx = state.transactions.filter((t) => t.note?.startsWith('Forward close fee'));
    expect(feeTx).toHaveLength(1);
    expect(feeTx[0]!.amount).toBe(fee);
  });

  it('closes a losing forward: cash falls, money conserved', () => {
    const sim = citySim(9);
    const { state, player, fwd } = stageForward(sim, { locked: 1_00, spot: 2_40, qty: 30 });
    const cashBefore = player.cash;
    const supply0 = totalMoneySupply(state);

    expect(closeForward(state, player.id, fwd.id)).toBe(true);
    expect(player.cash).toBeLessThan(cashBefore); // underwater short pays to close
    expect(totalMoneySupply(state)).toBe(supply0);
  });
});

describe('Phase 5 — facility sale salvages inventory', () => {
  it('salvages stored stock at the wholesale haircut, conserving money', () => {
    const sim = citySim(10);
    const state = sim.getState();
    const player = state.firms[state.playerFirmId]!;
    const wh = createFacility(state, 'warehouse', player.id, { x: 55, y: 55 });
    wh.buildCost = 2000_00;
    addStock(wh.inputInventory, 'grain', 100, 50);
    addStock(wh.outputInventory, 'bread', 40, 50);
    const whId = wh.id;

    const grainSalvage = Math.round(getProduct('grain').basePrice * SALVAGE_RATE) * 100;
    const breadSalvage = Math.round(getProduct('bread').basePrice * SALVAGE_RATE) * 40;
    const expected = Math.floor(2000_00 * 0.5) + grainSalvage + breadSalvage;

    const cashBefore = player.cash;
    const supply0 = totalMoneySupply(state);
    sim.dispatch({ type: 'SELL_FACILITY', firmId: player.id, facilityId: whId });

    expect(state.facilities[whId]).toBeUndefined();
    expect(player.cash).toBe(cashBefore + expected);
    expect(totalMoneySupply(state)).toBe(supply0);
  });
});

describe('Phase 5 — distressed AI sells a facility before closing', () => {
  /** Drive an AI firm to the insolvency-close step with the given cash. */
  function distressedAI(sim: Simulation) {
    const state = sim.getState();
    sim.run(ticksPerDay(state.config) * 20); // populate the world
    const firm = Object.values(state.firms).find(
      (f) => f.ownerType === 'ai'
        && f.facilities.filter((id) => state.facilities[id]?.status !== 'closed'
          && state.facilities[id]?.type !== 'home' && state.facilities[id]?.type !== 'importer').length >= 2,
    )!;
    firm.sharesHeld = {}; // no portfolio reprieve — force the facility rung
    firm.shareCostBasis = {};
    firm.daysInsolvent = state.config.insolvencyCloseDays - 1;
    firm.bankruptcyStatus = 'distressed';
    return { state, firm };
  }

  it('sells the least-productive facility (city AI), reprieving the close, money conserved', () => {
    const sim = citySim(11);
    const { state, firm } = distressedAI(sim);
    const open = firm.facilities
      .map((id) => state.facilities[id]!)
      .filter((f) => f.status !== 'closed' && f.type !== 'home' && f.type !== 'importer');
    // Make one facility the clear money pit and give it enough book value that
    // the 50% refund lifts a small deficit back to solvency.
    const pit = open[0]!;
    pit.pnlEma.net = -900_00;
    pit.buildCost = 3000_00;
    for (let i = 1; i < open.length; i++) open[i]!.pnlEma.net = -10_00;
    firm.cash = -50_00; // a small hole the refund easily covers

    const pitId = pit.id;
    const supply0 = totalMoneySupply(state);
    state.tick = ticksPerDay(state.config); // day boundary
    runBankruptcySystem(makeContext(state));

    // The pit was SOLD (deleted), not merely closed — and nothing else closed,
    // because the sale reprieved the firm.
    expect(state.facilities[pitId]).toBeUndefined();
    expect(firm.cash).toBeGreaterThanOrEqual(0);
    const closed = firm.facilities.filter((id) => state.facilities[id]?.status === 'closed');
    expect(closed).toHaveLength(0);
    expect(totalMoneySupply(state)).toBe(supply0);
  });

  it('Village AI closes instead of selling (bit-identity gate)', () => {
    const sim = newSim(11); // Village
    const { state, firm } = distressedAI(sim);
    const open = firm.facilities
      .map((id) => state.facilities[id]!)
      .filter((f) => f.status !== 'closed' && f.type !== 'home' && f.type !== 'importer');
    for (const f of open) f.pnlEma.net = -50_00;
    firm.cash = -50_00;
    const facCountBefore = firm.facilities.length;

    const supply0 = totalMoneySupply(state);
    state.tick = ticksPerDay(state.config);
    runBankruptcySystem(makeContext(state));

    // Village never sells (no facility deleted); the classic path closes one.
    expect(firm.facilities.length).toBe(facCountBefore);
    const closed = firm.facilities.filter((id) => state.facilities[id]?.status === 'closed');
    expect(closed.length).toBe(1);
    expect(totalMoneySupply(state)).toBe(supply0);
  });
});
