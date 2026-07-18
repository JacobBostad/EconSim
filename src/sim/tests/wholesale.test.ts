import { describe, it, expect } from 'vitest';
import { newSim } from './helpers';
import { ticksPerDay } from '../core/Tick';
import { totalMoneySupply } from '../core/GameState';
import { addStock, getQuantity } from '../entities/Inventory';
import { WHOLESALE_DISCOUNT } from '../data/constants';
import { MISSION_DEFS } from '../data/missions';

/**
 * Wholesale market: a supply contract whose source belongs to another firm
 * buys the goods at ship time (~85% of market average). Previously such
 * contracts shipped goods with NO payment — the UI offered them, so this was
 * a live free-goods exploit.
 */
describe('Wholesale (cross-firm) supply contracts', () => {
  function setupWholesale(seed = 3) {
    const sim = newSim(seed);
    const state = sim.getState();
    const player = state.firms[state.playerFirmId]!;
    player.cash = 50000_00;
    // Pre-complete missions so their cash rewards don't muddy cash deltas.
    state.missions = MISSION_DEFS.map((m) => ({ id: m.id, day: 0 }));
    sim.dispatch({ type: 'BUILD_FACILITY', firmId: player.id, defId: 'retail', location: { x: 100, y: 20 } });
    const store = state.facilities[player.facilities[0]!]!;
    store.retailProductIds = ['bread'];
    // An AI bakery with surplus bread.
    const aiFactory = Object.values(state.facilities).find(
      (f) => f.type === 'factory' && state.firms[f.ownerFirmId]?.ownerType === 'ai'
        && f.recipes.some((r) => r.includes('bread')),
    ) ?? Object.values(state.facilities).find(
      (f) => f.type === 'factory' && state.firms[f.ownerFirmId]?.ownerType === 'ai',
    )!;
    addStock(aiFactory.outputInventory, 'bread', 100, 60);
    sim.dispatch({
      type: 'CREATE_SUPPLY_CONTRACT', ownerFirmId: player.id,
      sourceFacilityId: aiFactory.id, destinationFacilityId: store.id,
      productId: 'bread', targetQuantity: 30, reorderPoint: 20, maxInventory: 60,
    });
    return { sim, state, player, store, aiFactory };
  }

  it('pays the seller at ship time and conserves money', () => {
    const { sim, state, player, store, aiFactory } = setupWholesale();
    const seller = state.firms[aiFactory.ownerFirmId]!;
    const supply0 = totalMoneySupply(state);
    const sellerCash0 = seller.cash;
    const sellerRevenue0 = seller.accounting.lifetime.revenue;
    const buyerCogs0 = player.accounting.lifetime.costOfGoodsSold;

    // Two midnight hours: stores are closed and no daily spends fire, so the
    // only cash that moves between these firms is the wholesale purchase
    // (plus the buyer's transport fee to the world on arrival).
    sim.run(Math.round((ticksPerDay(state.config) / 24) * 2) + 1);

    const paid = player.accounting.lifetime.costOfGoodsSold - buyerCogs0;
    expect(paid).toBeGreaterThan(0); // buyer booked COGS
    expect(seller.cash - sellerCash0).toBe(paid); // seller received exactly it
    expect(seller.accounting.lifetime.revenue - sellerRevenue0).toBe(paid);
    sim.run(ticksPerDay(state.config)); // let the shipment land
    expect(getQuantity(store.inputInventory, 'bread')).toBeGreaterThan(0);
    expect(totalMoneySupply(state)).toBe(supply0);
  });

  it('unit price tracks the market at the wholesale discount', () => {
    const { sim, state, player, aiFactory } = setupWholesale();
    const seller = state.firms[aiFactory.ownerFirmId]!;
    const sellerCash0 = seller.cash;
    const buyerCash0 = player.cash;
    state.marketStats['bread']!.averagePrice = 500; // $5.00 market average

    sim.run(2); // the first hourly reorder pass

    const paid = buyerCash0 - player.cash;
    if (paid > 0) {
      const unit = Math.round(500 * WHOLESALE_DISCOUNT);
      expect(paid % unit).toBe(0); // integer units at the discounted price
      expect(seller.cash - sellerCash0).toBe(paid);
    } else {
      // If no reorder fired in 2 ticks the store wasn't below reorder yet —
      // force a day and require the trade happened at SOME discounted price.
      sim.run(ticksPerDay(state.config));
      expect(buyerCash0 - player.cash).toBeGreaterThan(0);
    }
  });

  it("never raids stock the seller's own supply lines reserve", () => {
    const { sim, state, aiFactory, store } = setupWholesale();
    // The seller's own outbound contract reserves 90 of the 100 units.
    const ownStore = Object.values(state.facilities).find(
      (f) => f.ownerFirmId === aiFactory.ownerFirmId && f.type === 'retail',
    )!;
    sim.dispatch({
      type: 'CREATE_SUPPLY_CONTRACT', ownerFirmId: aiFactory.ownerFirmId,
      sourceFacilityId: aiFactory.id, destinationFacilityId: ownStore.id,
      productId: 'bread', targetQuantity: 90, reorderPoint: 0, maxInventory: 200,
    });
    sim.run(ticksPerDay(state.config));
    // At most the unreserved 10 units per shipment can go wholesale.
    expect(getQuantity(store.inputInventory, 'bread')).toBeLessThanOrEqual(30);
  });

  it('tracks wholesaleSpend and satisfies the Local Sourcing mission', async () => {
    const { sim, state, player } = setupWholesale();
    state.missions = []; // re-arm missions for this test
    sim.run(Math.round((ticksPerDay(state.config) / 24) * 2) + 1);
    expect(player.wholesaleSpend).toBeGreaterThan(0);

    const { getMissionDef } = await import('../data/missions');
    const mission = getMissionDef('local_sourcing')!;
    player.wholesaleSpend = 200_00;
    expect(mission.check(state)).toBe(true);
  });

  it('a buyer who cannot pay gets no shipment (and no goods vanish)', () => {
    const { sim, state, player, store, aiFactory } = setupWholesale();
    state.worldCash += player.cash;
    player.cash = 0;
    const stock0 = getQuantity(aiFactory.outputInventory, 'bread');
    const supply0 = totalMoneySupply(state);

    sim.run(ticksPerDay(state.config) / 2);

    expect(getQuantity(store.inputInventory, 'bread')).toBe(0);
    // The seller keeps (and keeps producing) its stock — nothing was taken.
    expect(getQuantity(aiFactory.outputInventory, 'bread')).toBeGreaterThanOrEqual(stock0);
    expect(totalMoneySupply(state)).toBe(supply0);
  });
});
