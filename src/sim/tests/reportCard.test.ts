import { describe, it, expect } from 'vitest';
import { newSim } from './helpers';
import { ticksPerDay } from '../core/Tick';
import {
  quarterReport,
  completedQuarters,
  letterGrade,
  QUARTER_DAYS,
} from '../selectors/reportSelectors';

describe('Quarterly report card', () => {
  it('letter grades map score bands', () => {
    expect(letterGrade(95)).toBe('A+');
    expect(letterGrade(82)).toBe('A');
    expect(letterGrade(70)).toBe('B');
    expect(letterGrade(60)).toBe('C');
    expect(letterGrade(45)).toBe('D');
    expect(letterGrade(10)).toBe('F');
  });

  it('builds a coherent report after a completed quarter', () => {
    const sim = newSim(1);
    const state = sim.getState();
    const tpd = ticksPerDay(state.config);
    expect(completedQuarters(state)).toBe(0);
    sim.run(tpd * (QUARTER_DAYS + 1));
    expect(completedQuarters(state)).toBe(1);

    const report = quarterReport(state, 1);
    expect(report.startDay).toBe(0);
    expect(report.endDay).toBe(QUARTER_DAYS - 1);
    expect(report.valuationSeries.length).toBe(QUARTER_DAYS);
    expect(report.valuationEnd).toBeGreaterThan(0);
    // Idle player: no revenue, flat-ish valuation, mid-band grade.
    expect(report.revenueTotal).toBe(0);
    expect(report.shares.length).toBe(5); // three staples + two luxury goods
    expect(['C', 'D', 'B'].includes(report.grade)).toBe(true);
    expect(report.score).toBeGreaterThan(0);
    expect(report.score).toBeLessThan(100);
  });

  it('profitable growth earns a better grade than idling', () => {
    const sim = newSim(1);
    const state = sim.getState();
    sim.run(ticksPerDay(state.config) * (QUARTER_DAYS + 1));
    const idle = quarterReport(state, 1);

    // Forge a great quarter on top of the same history.
    const player = state.firms[state.playerFirmId]!;
    const hist = player.accounting.dailyHistory;
    for (const d of hist) {
      d.netProfit = 500_00;
      d.valuation = 20000_00 + d.day * 1000_00;
    }
    player.marketShareByProduct['bread'] = 0.6;
    const stat = state.marketStats['bread']!;
    for (const h of stat.history) h.sharesByFirm[player.id] = 0.6;

    const great = quarterReport(state, 1);
    expect(great.score).toBeGreaterThan(idle.score);
    expect(great.netProfitTotal).toBeGreaterThan(0);
  });
});
