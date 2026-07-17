import { describe, it, expect } from 'vitest';
import { newSim } from './helpers';
import { ticksPerDay } from '../core/Tick';
import { deserialize, serialize } from '../persistence/saveLoad';

describe('Trend history', () => {
  it('records bounded per-day market history with prices and shares', () => {
    const sim = newSim(2);
    const tpd = ticksPerDay(sim.getState().config);
    sim.run(tpd * 5 + 1);

    const state = sim.getState();
    const stat = state.marketStats['bread']!;
    expect(stat.history.length).toBe(5);
    expect(stat.history[0]!.day).toBe(0);
    expect(stat.history[4]!.day).toBe(4);
    // The AI bread chain sells from day 0, so prices/shares are recorded.
    const anySales = stat.history.some((h) => h.unitsSold > 0 && h.averagePrice > 0);
    expect(anySales).toBe(true);
    const anyShares = stat.history.some((h) => Object.keys(h.sharesByFirm).length > 0);
    expect(anyShares).toBe(true);
  });

  it('caps market history at maxDailyHistory', () => {
    const sim = newSim(2);
    const state = sim.getState();
    state.config.maxDailyHistory = 3;
    const tpd = ticksPerDay(state.config);
    sim.run(tpd * 6 + 1);
    expect(sim.getState().marketStats['bread']!.history.length).toBe(3);
  });

  it('records end-of-day valuation in firm daily snapshots', () => {
    const sim = newSim(2);
    const tpd = ticksPerDay(sim.getState().config);
    sim.run(tpd * 2 + 1);
    const state = sim.getState();
    for (const fid of [state.playerFirmId]) {
      const hist = state.firms[fid]!.accounting.dailyHistory;
      expect(hist.length).toBeGreaterThan(0);
      expect(typeof hist[0]!.valuation).toBe('number');
      expect(hist[0]!.valuation).toBeGreaterThan(0);
    }
  });

  it('old saves without history fields load with defaults', () => {
    const sim = newSim(2);
    const tpd = ticksPerDay(sim.getState().config);
    sim.run(tpd * 2 + 1);
    const raw = JSON.parse(serialize(sim.getState()));
    for (const pid in raw.marketStats) delete raw.marketStats[pid].history;
    for (const fid in raw.firms) {
      for (const d of raw.firms[fid].accounting.dailyHistory) delete d.valuation;
    }
    const loaded = deserialize(JSON.stringify(raw));
    expect(loaded.marketStats['bread']!.history).toEqual([]);
    const hist = loaded.firms[loaded.playerFirmId]!.accounting.dailyHistory;
    expect(typeof hist[0]!.valuation).toBe('number');
  });
});
