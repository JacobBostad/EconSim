import { describe, it, expect } from 'vitest';
import { newSim } from './helpers';
import { ticksPerDay, computeTime } from '../core/Tick';
import { totalMoneySupply } from '../core/GameState';
import { cityPrice, exportFreightFee } from '../core/Trade';
import { getQuantity } from '../entities/Inventory';
import { getProduct } from '../data/products';
import { TRADE_CITY_IDS } from '../data/tradeCities';
import { companyValuation } from '../selectors/companySelectors';

/**
 * Bot v7 — the pillar-era integration regression. The strategy leans
 * entirely on the new systems: a wizard bread chain whose STORE IS NEVER
 * PRICED BY HAND (a hired manager runs it), a logistics manager on the
 * executive desk, R&D into a premium sign, announcement trading on the
 * commodity desk, and forwards locked on price spikes. Floors sit well
 * under the seed-9 measurements (valuation $21.7k, 8 announcement plays,
 * 8 forwards signed, 6 delivered wins, both managers retained ~180 days,
 * 0.30 ms/tick) so seed-adjacent drift doesn't flake.
 */
describe('Scripted 200-day playtest (bot v7, pillar era)', () => {
  it('delegation, positioning, desk, and forwards all carry a firm together', () => {
    const sim = newSim(9);
    const state = sim.getState();
    const tpd = ticksPerDay(state.config);
    const player = state.firms[state.playerFirmId]!;
    player.cash = 40000_00;
    const supply0 = totalMoneySupply(state);
    let stage = 0;
    let annPlays = 0;
    let annHolding: string | null = null;
    let forwardsSigned = 0;

    const facs = () => player.facilities.map((i) => state.facilities[i]!);
    for (let d = 0; d < 200; d++) {
      const day = computeTime(state.tick, state.config).day;
      if (stage === 0 && player.cash >= 12000_00) {
        sim.dispatch({ type: 'BUILD_CHAIN', firmId: player.id, productId: 'bread' });
        sim.dispatch({ type: 'BUILD_FACILITY', firmId: player.id, defId: 'warehouse', location: { x: 100, y: 20 } });
        const wh = facs().find((f) => f.type === 'warehouse');
        const factory = facs().find((f) => f.type === 'factory');
        const shop = facs().find((f) => f.type === 'retail');
        if (wh && factory && shop) {
          sim.dispatch({ type: 'CREATE_SUPPLY_CONTRACT', ownerFirmId: player.id, sourceFacilityId: factory.id, destinationFacilityId: wh.id, productId: 'bread', targetQuantity: 6, reorderPoint: 500, maxInventory: 999 });
          sim.dispatch({ type: 'HIRE_MANAGER', firmId: player.id, facilityId: shop.id, candidateIndex: 1 });
          sim.dispatch({ type: 'HIRE_MANAGER', firmId: player.id, role: 'logistics', candidateIndex: 0 });
          stage = 1;
        }
      }
      if (stage === 1 && player.cash > 15000_00) {
        sim.dispatch({ type: 'INVEST_RND', firmId: player.id, productId: 'bread', amount: 2000_00 });
        if ((player.qualityByProduct['bread'] ?? 50) >= 62) {
          const shop = facs().find((f) => f.type === 'retail');
          if (shop) sim.dispatch({ type: 'SET_POSITIONING', facilityId: shop.id, positioning: 'premium' });
          stage = 2;
        }
      }
      const wh = facs().find((f) => f.type === 'warehouse');
      const ann = state.tradeAnnouncement;
      if (wh && ann && ann.mult > 1) {
        if (!annHolding && day < ann.effectDay && player.cash > 5000_00) {
          const buyCity = TRADE_CITY_IDS.reduce((a, b) =>
            cityPrice(state, a, ann.productId) * (1 + exportFreightFee(state, a)) <
            cityPrice(state, b, ann.productId) * (1 + exportFreightFee(state, b)) ? a : b);
          sim.dispatch({ type: 'BUY_FROM_CITY', firmId: player.id, facilityId: wh.id, productId: ann.productId, quantity: 50, cityId: buyCity });
          annHolding = ann.productId;
        } else if (annHolding && day >= ann.effectDay + ann.durationDays - 2) {
          sim.dispatch({ type: 'EXPORT_GOODS', firmId: player.id, facilityId: wh.id, productId: annHolding, quantity: 50, cityId: ann.cityId });
          annHolding = null;
          annPlays += 1;
        }
      }
      if (!ann && annHolding && wh) {
        sim.dispatch({ type: 'EXPORT_GOODS', firmId: player.id, facilityId: wh.id, productId: annHolding, quantity: 50 });
        annHolding = null;
        annPlays += 1;
      }
      if (wh && player.forwards.length < 2 && getQuantity(wh.inputInventory, 'bread') + getQuantity(wh.outputInventory, 'bread') >= 30) {
        for (const cid of TRADE_CITY_IDS) {
          if (cityPrice(state, cid, 'bread') >= getProduct('bread').basePrice * 1.3) {
            sim.dispatch({ type: 'SELL_FORWARD', firmId: player.id, productId: 'bread', quantity: 30, cityId: cid, deliveryDay: day + 5 });
            forwardsSigned += 1;
            break;
          }
        }
      }
      for (const fac of facs()) {
        const target = fac.type === 'home' || fac.defId === 'apartment' ? 0 : 2;
        if (fac.employees.length < target) sim.dispatch({ type: 'HIRE_WORKER', facilityId: fac.id, citizenId: null });
      }
      sim.run(tpd);
    }

    expect(totalMoneySupply(state)).toBe(supply0);
    expect(player.bankruptcyStatus).toBe('healthy');
    expect(companyValuation(state, player.id).valuation).toBeGreaterThan(12000_00);
    // Delegation held: both managers survived ~180 days of payroll.
    expect(player.managers.map((m) => m.role).sort()).toEqual(['logistics', 'store']);
    // The premium sign was earned and set.
    expect(facs().find((f) => f.type === 'retail')?.positioning).toBe('premium');
    expect(player.qualityByProduct['bread'] ?? 0).toBeGreaterThanOrEqual(62);
    // The desk and the forwards actually traded (measured 8 / 8 / 6).
    expect(annPlays).toBeGreaterThanOrEqual(3);
    expect(forwardsSigned).toBeGreaterThanOrEqual(3);
    expect(player.forwardWins).toBeGreaterThanOrEqual(2);
    // The busier bot stays inside the perf guard.
    expect(state.perf.avgTickMs).toBeLessThan(2);
  }, 30000);
});
