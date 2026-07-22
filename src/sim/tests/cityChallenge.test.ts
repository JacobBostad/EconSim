import { describe, it, expect } from 'vitest';
import { Simulation } from '../core/Simulation';
import { createInitialState } from '../data/startingScenario';
import { worldScaleConfig } from '../core/SimulationConfig';
import { challengeScore, CHALLENGE_END_DAY } from '../selectors/reportSelectors';
import { serialize, deserialize } from '../persistence/saveLoad';
import { ticksPerDay, computeTime } from '../core/Tick';
import { totalMoneySupply } from '../core/GameState';
import {
  loadChallengeRuns,
  recordChallengeRun,
  type ChallengeRun,
} from '../../ui/records';

/**
 * Challenge mode at City scale. The Village challenge (config flow, scoring,
 * share text) is pinned in challenge.test.ts; these tests cover the City-scale
 * additions: the challenge flag composes with the whole worldScaleConfig 'city'
 * stack, the day-200 finish fires and scores at City, the score reads the crowd
 * economy honestly (valuation carries rent/seats/dividends/pool exports through
 * net worth; town satisfaction is weighted over the cast AND the crowd), and the
 * leaderboard is keyed SEPARATELY per world so a Village board and a City board
 * never mix — with legacy Village scores surviving untouched.
 */
describe('Challenge mode at City scale', () => {
  it('the challenge flag composes with the City stack and survives save/load', () => {
    const cfg = worldScaleConfig('brutal', true, 'cozy', 'city');
    expect(cfg.challengeMode).toBe(true);
    // Every City channel is on alongside the challenge flag.
    expect(cfg.sizePreset).toBe('city');
    expect(cfg.servicesEnabled).toBe(true);
    expect(cfg.realEstateEnabled).toBe(true);
    expect(cfg.investorsEnabled).toBe(true);
    expect(cfg.tradeDemandPoolsEnabled).toBe(true);

    const state = createInitialState(11, cfg, 'grand_junction');
    expect(state.config.challengeMode).toBe(true);
    expect(state.config.sizePreset).toBe('city');
    const reloaded = deserialize(serialize(state));
    expect(reloaded.config.challengeMode).toBe(true);
    expect(reloaded.config.sizePreset).toBe('city');
  });

  it('the day-200 finish fires and scores at City, conserved and in range', () => {
    const sim = new Simulation(
      createInitialState(11, worldScaleConfig('standard', true, 'cozy', 'city'), 'grand_junction'),
    );
    const state = sim.getState();
    const supply0 = totalMoneySupply(state);
    sim.run(ticksPerDay(state.config) * CHALLENGE_END_DAY);

    // The finish-line condition the FinalScoreModal reads.
    const day = computeTime(state.tick, state.config).day;
    expect(state.config.challengeMode && day >= CHALLENGE_END_DAY).toBe(true);

    const s = challengeScore(state);
    expect(s.total).toBeGreaterThanOrEqual(0);
    expect(s.total).toBeLessThanOrEqual(1000);
    // The crowd is present, so the score's satisfaction leg reads a real town.
    expect(Object.keys(state.cohorts).length).toBeGreaterThan(0);
    // City money supply is conserved through the whole era stack.
    expect(totalMoneySupply(state)).toBe(supply0);
    // Deterministic: same finished state, same score.
    expect(challengeScore(state).total).toBe(s.total);
  });

  it('town satisfaction is population-weighted over the cast AND the crowd', () => {
    const state = createInitialState(11, worldScaleConfig('standard', true, 'cozy', 'city'), 'grand_junction');
    const cohortIds = Object.keys(state.cohorts);
    expect(cohortIds.length).toBeGreaterThan(0);

    // Force a wide gap: the cast is unhappy (40), the crowd is delighted (85).
    for (const cid in state.citizens) state.citizens[cid]!.satisfaction = 40;
    for (const id of cohortIds) state.cohorts[id]!.avgSatisfaction = 85;

    // Independent population-weighted mean over cast + crowd.
    const castCount = Object.keys(state.citizens).length;
    let mass = 40 * castCount;
    let heads = castCount;
    for (const id of cohortIds) {
      const co = state.cohorts[id]!;
      if (co.population <= 0) continue;
      mass += 85 * co.population;
      heads += co.population;
    }
    const expected = mass / heads;

    const s = challengeScore(state);
    expect(s.satisfaction).toBeCloseTo(expected, 6);
    // The crowd dominates the town, so the weighted mean sits well above the
    // cast-only 40 a Village-style read would have returned.
    expect(s.satisfaction).toBeGreaterThan(60);
  });

  it('a Village score still reads the cast mean exactly (bit-identity)', () => {
    const state = createInitialState(1, worldScaleConfig('standard', true, 'cozy', 'village'));
    expect(Object.keys(state.cohorts).length).toBe(0);
    for (const cid in state.citizens) state.citizens[cid]!.satisfaction = 72;
    // Cast-only mean, the exact figure the Village challenge has always scored.
    const cits = Object.values(state.citizens);
    const castMean = cits.reduce((a, c) => a + c.satisfaction, 0) / cits.length;
    expect(challengeScore(state).satisfaction).toBe(castMean);
    expect(challengeScore(state).satisfaction).toBe(72);
  });
});

describe('Challenge leaderboard — keyed per world', () => {
  function withStorage(body: (store: Map<string, string>) => void): void {
    const store = new Map<string, string>();
    (globalThis as Record<string, unknown>).localStorage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
      key: (i: number) => [...store.keys()][i] ?? null,
      get length() { return store.size; },
    };
    try {
      body(store);
    } finally {
      delete (globalThis as Record<string, unknown>).localStorage;
    }
  }

  const run = (over: Partial<ChallengeRun>): ChallengeRun => ({
    score: 500, valuation: 5_000_000, scenarioId: 'meadowbrook',
    difficulty: 'standard', seed: 42, world: 'village', at: '2026-07-22', ...over,
  });

  it('Village and City runs land on separate boards and never mix', () => {
    withStorage(() => {
      recordChallengeRun(run({ world: 'village', score: 300 }));
      recordChallengeRun(run({ world: 'city', score: 700, scenarioId: 'grand_junction' }));
      recordChallengeRun(run({ world: 'metropolis', score: 900 }));

      const village = loadChallengeRuns('village');
      const city = loadChallengeRuns('city');
      const metro = loadChallengeRuns('metropolis');
      expect(village.map((r) => r.score)).toEqual([300]);
      expect(city.map((r) => r.score)).toEqual([700]);
      expect(metro.map((r) => r.score)).toEqual([900]);
      expect(village.every((r) => r.world === 'village')).toBe(true);
      expect(city.every((r) => r.world === 'city')).toBe(true);
    });
  });

  it('the Village board keeps the original storage key (no migration needed)', () => {
    withStorage((store) => {
      recordChallengeRun(run({ world: 'village', score: 300 }));
      recordChallengeRun(run({ world: 'city', score: 700 }));
      // Village stays on the pre-world-scale key; City gets its own suffix.
      expect(store.has('econsim.challenges')).toBe(true);
      expect(store.has('econsim.challenges.city')).toBe(true);
    });
  });

  it('legacy Village scores (no world field) survive and read as Village', () => {
    withStorage((store) => {
      // A pre-world-scale entry, written straight to the original key with no
      // `world` field — exactly what an existing player's browser holds.
      store.set('econsim.challenges', JSON.stringify([
        { score: 640, valuation: 4_200_000, scenarioId: 'port_haven', difficulty: 'brutal', seed: 7, at: '2026-01-02' },
      ]));

      const village = loadChallengeRuns('village');
      expect(village).toHaveLength(1);
      expect(village[0]!.score).toBe(640);
      expect(village[0]!.world).toBe('village'); // stamped on read

      // Recording a City run afterwards leaves the legacy Village entry intact.
      recordChallengeRun(run({ world: 'city', score: 700 }));
      expect(loadChallengeRuns('village').map((r) => r.score)).toEqual([640]);
      expect(loadChallengeRuns('city').map((r) => r.score)).toEqual([700]);
    });
  });
});
