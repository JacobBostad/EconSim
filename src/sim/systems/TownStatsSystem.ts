/**
 * TownStatsSystem — one bounded daily record of town-level vitals, so the
 * boom-absorb growth waves the economy now exhibits are visible as charts
 * instead of folklore. Runs after SatisfactionSystem so the day's equilibrium
 * step is included.
 */

import type { SimContext } from '../core/GameState';
import { isDayBoundary } from '../core/Tick';

export interface TownDay {
  day: number;
  population: number;
  employed: number;
  avgSatisfaction: number;
  avgCash: number;
}

export function runTownStatsSystem(ctx: SimContext): void {
  const { state } = ctx;
  if (!isDayBoundary(state.tick, ctx.config)) return;

  let population = 0;
  let employed = 0;
  let satisfaction = 0;
  let cash = 0;
  for (const cid in state.citizens) {
    const c = state.citizens[cid]!;
    population += 1;
    satisfaction += c.satisfaction;
    cash += c.cash;
    if (c.employmentStatus === 'employed') employed += 1;
  }
  if (population === 0) return;

  state.townHistory.push({
    day: ctx.time.day - 1,
    population,
    employed,
    avgSatisfaction: satisfaction / population,
    avgCash: Math.round(cash / population),
  });
  if (state.townHistory.length > ctx.config.maxDailyHistory) {
    state.townHistory.splice(0, state.townHistory.length - ctx.config.maxDailyHistory);
  }
}

export type CyclePhase = 'boom' | 'absorbing' | 'steady';

/**
 * Where the town sits in its growth cycle, from the employment-rate trend:
 * arrivals depress the rate until hiring absorbs them.
 */
export function cyclePhase(history: TownDay[]): CyclePhase {
  if (history.length < 15) return 'steady';
  const now = history[history.length - 1]!;
  const then = history[history.length - 15]!;
  const rateNow = now.employed / Math.max(1, now.population);
  const rateThen = then.employed / Math.max(1, then.population);
  if (rateNow - rateThen > 0.03) return 'boom';
  if (rateThen - rateNow > 0.03) return 'absorbing';
  return 'steady';
}
