import { describe, it, expect } from 'vitest';
import { newSim } from './helpers';
import { ticksPerDay } from '../core/Tick';
import { deserialize, serialize } from '../persistence/saveLoad';
import { getQuantity } from '../entities/Inventory';

describe('Luxury tier', () => {
  it('luxury recipes are gated behind quality 75', () => {
    const sim = newSim(1);
    const state = sim.getState();
    const player = state.firms[state.playerFirmId]!;
    player.cash = 100000_00;
    sim.dispatch({ type: 'BUILD_FACILITY', firmId: player.id, defId: 'factory', location: { x: 100, y: 20 } });
    const fac = state.facilities[player.facilities[0]!]!;
    sim.dispatch({ type: 'SELECT_RECIPE', facilityId: fac.id, recipeId: 'bake_pastries' });
    for (let i = 0; i < 2; i++) sim.dispatch({ type: 'HIRE_WORKER', facilityId: fac.id, citizenId: null });
    sim.dispatch({ type: 'BUY_FROM_IMPORTER', firmId: player.id, destinationFacilityId: fac.id, productId: 'grain', quantity: 40 });

    sim.run(20);
    expect(fac.status).toBe('idle');
    expect(fac.bottleneckReason).toContain('quality');
    expect(getQuantity(fac.outputInventory, 'pastries')).toBe(0);

    // Master the craft, then production flows.
    player.qualityByProduct['pastries'] = 80;
    sim.run(ticksPerDay(state.config));
    expect(getQuantity(fac.outputInventory, 'pastries') + fac.dailyStats.unitsProduced).toBeGreaterThan(0);
  });

  it('luxury cravings only grow for satisfied, well-off citizens', () => {
    const sim = newSim(1);
    const state = sim.getState();
    const cits = Object.values(state.citizens);
    const rich = cits[0]!;
    const poor = cits[1]!;
    rich.satisfaction = 90; rich.cash = 2000_00;
    poor.satisfaction = 30; poor.cash = 100_00;
    const richNeed = rich.needs.find((n) => n.productId === 'pastries')!;
    const poorNeed = poor.needs.find((n) => n.productId === 'pastries')!;
    richNeed.urgency = 0; poorNeed.urgency = 0.5;

    // Drive several daily satisfaction passes while keeping conditions pinned.
    for (let d = 1; d <= 3; d++) {
      rich.satisfaction = 90; rich.cash = 2000_00;
      poor.satisfaction = 30; poor.cash = 100_00;
      sim.run(ticksPerDay(state.config));
    }
    expect(richNeed.urgency).toBeGreaterThan(0.2);
    expect(poorNeed.urgency).toBeLessThan(0.5);
  });

  it('old saves gain luxury needs and market stats', () => {
    const sim = newSim(1);
    const raw = JSON.parse(serialize(sim.getState()));
    delete raw.marketStats.pastries;
    delete raw.marketStats.jewelry;
    for (const cid in raw.citizens) {
      raw.citizens[cid].needs = raw.citizens[cid].needs.filter(
        (n: { productId: string }) => n.productId !== 'pastries' && n.productId !== 'jewelry',
      );
    }
    const loaded = deserialize(JSON.stringify(raw));
    expect(loaded.marketStats['pastries']).toBeTruthy();
    expect(loaded.tradeCity.pricesByProduct['jewelry']).toBeGreaterThan(0);
    for (const cid in loaded.citizens) {
      expect(loaded.citizens[cid]!.needs.some((n) => n.productId === 'jewelry')).toBe(true);
    }
  });
});
