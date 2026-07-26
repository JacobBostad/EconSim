import { describe, it, expect } from 'vitest';
import { newSim, findFirmByName } from './helpers';
import { ticksPerDay } from '../core/Tick';
import { deserialize, serialize } from '../persistence/saveLoad';

describe('Apparel chain', () => {
  it('the AI apparel firm exists with a full cotton -> clothes chain', () => {
    const sim = newSim(1);
    const state = sim.getState();
    const firm = findFirmByName(state, 'Loom & Thread');
    expect(firm.ownerType).toBe('ai');
    const types = firm.facilities.map((id) => state.facilities[id]!.type).sort();
    expect(types).toEqual(['factory', 'farm', 'retail']);
  });

  it('citizens need and buy clothes; the market moves', () => {
    const sim = newSim(1);
    const state = sim.getState();
    for (const cid in state.citizens) {
      expect(state.citizens[cid]!.needs.some((n) => n.productId === 'clothes')).toBe(true);
    }
    sim.run(ticksPerDay(state.config) * 6 + 1);
    const hist = sim.getState().marketStats['clothes']!.history;
    const totalSold = hist.reduce((s, h) => s + h.unitsSold, 0);
    expect(totalSold).toBeGreaterThan(0);
    const firm = findFirmByName(sim.getState(), 'Loom & Thread');
    expect(firm.accounting.lifetime.revenue).toBeGreaterThan(0);
  });

  it('old saves without clothes normalize: needs + market stats appear', () => {
    const sim = newSim(1);
    const raw = JSON.parse(serialize(sim.getState()));
    // The six families live under towns.home now (SAVE_VERSION 3).
    const home = raw.towns.home;
    delete home.marketStats.clothes;
    for (const cid in home.citizens) {
      home.citizens[cid].needs = home.citizens[cid].needs.filter(
        (n: { productId: string }) => n.productId !== 'clothes',
      );
      delete home.citizens[cid].preferences.clothes;
    }
    const loaded = deserialize(JSON.stringify(raw));
    expect(loaded.marketStats['clothes']).toBeTruthy();
    for (const cid in loaded.citizens) {
      const c = loaded.citizens[cid]!;
      expect(c.needs.some((n) => n.productId === 'clothes')).toBe(true);
      expect(c.preferences['clothes']).toBe(1);
    }
  });
});
