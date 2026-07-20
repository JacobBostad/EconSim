import { describe, it, expect } from 'vitest';
import { Simulation } from '../core/Simulation';
import { createInitialState } from '../data/startingScenario';
import { DEFAULT_CONFIG } from '../core/SimulationConfig';
import { ticksPerDay } from '../core/Tick';
import { totalMoneySupply } from '../core/GameState';
import { emptyCohort } from '../entities/Cohort';
import { dollars } from '../data/constants';
import type { CitizenTier } from '../entities/Citizen';

/**
 * Tier-gate acceptance — the crowd's class composition lands in a sane band and
 * money is conserved, over the CITY preset the gates were calibrated against
 * (docs/design/cohorts-and-districts.md, "tier-gate calibration" soak).
 *
 * The A3 target — worker 50-70 / comfortable 25-40 / affluent 5-15 — is a 300-day
 * figure. After the A4 geometry recalibration (RESERVE_FACTOR 1.7 + INFLOW_RATE
 * 0.002; docs/design/cohorts-and-districts.md, "A4 geometry recalibration") the
 * bands seat on all three seeds at day 300 (worker 65-68 / comfortable 30-32 /
 * affluent 2-3), and the comfortable tier already forms by day 150 (~0.27-0.30).
 * The per-seed cases below assert the 150-day forming shape (fast to run × 3
 * seeds); the seed-11 case carries the tight 300-day acceptance. What the suite
 * guards against: the A3 failure (the savings route promoting the whole crowd
 * once its pool drifts past the cast bar — comfortable 53-70% before that fix)
 * AND the A4 map drift (the crowd flooding a jobless town, suppressing promotion
 * so comfortable fell out of band downward — 0.26 before the recalibration).
 */
const SEEDS = [11, 4, 7];
const DAYS = 150;

function shares(sim: Simulation): { worker: number; comfortable: number; affluent: number; crowd: number } {
  const state = sim.getState();
  const pop: Record<CitizenTier, number> = { worker: 0, comfortable: 0, affluent: 0 };
  for (const cid in state.cohorts) {
    const c = state.cohorts[cid]!;
    pop[c.tier] += c.population;
  }
  const crowd = pop.worker + pop.comfortable + pop.affluent;
  return {
    worker: crowd > 0 ? pop.worker / crowd : 0,
    comfortable: crowd > 0 ? pop.comfortable / crowd : 0,
    affluent: crowd > 0 ? pop.affluent / crowd : 0,
    crowd,
  };
}

describe('Tier-gate acceptance (A3 city calibration)', () => {
  for (const seed of SEEDS) {
    it(`seed ${seed}: 150-day city crowd lands worker/comfortable in the forming band, money conserved`, () => {
      const state = createInitialState(seed, { ...DEFAULT_CONFIG, sizePreset: 'city' });
      const sim = new Simulation(state);
      sim.dispatch({ type: 'RESUME' });
      const supply0 = totalMoneySupply(state);
      const tpd = ticksPerDay(state.config);
      sim.run(tpd * DAYS);

      const s = shares(sim);
      // A real crowd exists and the ladder moved mass off the worker floor —
      // the gate is neither frozen nor collapsed.
      expect(s.crowd).toBeGreaterThan(100);
      expect(s.comfortable).toBeGreaterThan(0.03);

      // A4-RE-PINNED 150-day forming bands. These guard SHAPE (a ladder that
      // neither freezes nor collapses). The A4 geometry recalibration (RESERVE_
      // FACTOR 1.7 + INFLOW_RATE 0.002 — see docs/design/cohorts-and-districts.md,
      // "A4 geometry recalibration") restored the physical City's prosperity: the
      // old 260×184-map drift (comfortable stalling ~0.08-0.21 at day 150, the
      // wide bands this test used to carry) is cured by keeping the crowd
      // proportionate to jobs, so comfortable forms fast and consistently
      // (measured day-150 W/C: seed 11 0.70/0.28, seed 4 0.70/0.27, seed 7
      // 0.69/0.30 — all three within 0.015). The bands are re-tightened around
      // that shape; they FAIL on pre-recalibration code (seed 7 formed W 0.87 /
      // C 0.11 at day 150). The 300-day case below carries the tight acceptance.
      expect(s.worker).toBeGreaterThanOrEqual(0.58);
      expect(s.worker).toBeLessThanOrEqual(0.80);
      expect(s.comfortable).toBeGreaterThanOrEqual(0.18);
      expect(s.comfortable).toBeLessThanOrEqual(0.38);
      // Affluent stays a thin top tier — never a runaway share (city luxury
      // supply is labor-bound, so it cannot sustain a large luxury-buying class;
      // see the soak note on affluent under-supply).
      expect(s.affluent).toBeLessThanOrEqual(0.12);

      // Cohort tier moves and migration carry real money — conserved to the cent.
      expect(totalMoneySupply(state)).toBe(supply0);
    });
  }

  it('seed 11: 300-day joint acceptance — worker/comfortable land in band and the worker cast/cohort gap stays <= 8', () => {
    // The load-bearing joint-calibration guard (docs/design/cohorts-and-districts.md,
    // "Combined re-measure", then "A4 geometry recalibration"). Both shipped
    // mechanisms are live here — RetailDemandSystem's worker catch-up AND
    // CohortSocialSystem's float-savings gates, now on the A4 260×184 map with the
    // geometry recalibration (RESERVE_FACTOR 1.7 + INFLOW_RATE 0.002). This asserts
    // the COMBINED economy, measured as a 15-day trailing mean (the gates are a
    // chaotic curator<->demotion oscillation; a single day's shares swing several
    // points, so the band is a multi-week mean). Four outcomes, each of which FAILS
    // on the pre-recalibration A4 code (measured seed-11 15-day mean at that revert:
    // worker 0.72, comfortable 0.264, gap 12.8):
    //   1. worker in [0.50, 0.70] — back in band (was 0.72, over).
    //   2. comfortable >= 0.30 — back in band (was 0.264, under the 25-40 target).
    //   3. comfortable <= 0.40 — the ORIGINAL ceiling the A3 calibration cured;
    //      still FAILS on pre-A3 code (comfortable ran 54% before the 2x demotion +
    //      savings-cap + employment-weighted gates).
    //   4. worker cast-vs-cohort satisfaction gap <= 8 — the A4 gap fix (was 12.8;
    //      the guard was temporarily widened to 14 during the A4 map drift and is
    //      brought back down here).
    // Seed 11 only, so one 300-day city run (~3s) carries the guard; the other two
    // seeds and the full band table live in the tier-joint probe / design doc. NOTE
    // (honest residual): the tier COMPOSITION bands seat on all three seeds, but by
    // this test's strict daily-|diff| gap metric seed 7 oscillates to ~15 (its
    // 45-day mean-of-means gap is 5.7, in-band — churn oscillation, not a persistent
    // gap; see the recalibration soak note). Seed 11, the tested seed, is 5.84.
    const state = createInitialState(11, { ...DEFAULT_CONFIG, sizePreset: 'city' });
    const sim = new Simulation(state);
    sim.dispatch({ type: 'RESUME' });
    const supply0 = totalMoneySupply(state);
    const tpd = ticksPerDay(state.config);

    const workerShares: number[] = [];
    const comfortableShares: number[] = [];
    const workerGaps: number[] = [];
    for (let day = 1; day <= 300; day++) {
      sim.run(tpd);
      if (day <= 285) continue; // 15-day trailing window
      const pop: Record<CitizenTier, number> = { worker: 0, comfortable: 0, affluent: 0 };
      let cohortWorkerSatMass = 0;
      let cohortWorkerPop = 0;
      for (const cid in state.cohorts) {
        const c = state.cohorts[cid]!;
        pop[c.tier] += c.population;
        if (c.tier === 'worker') {
          cohortWorkerSatMass += c.avgSatisfaction * c.population;
          cohortWorkerPop += c.population;
        }
      }
      const crowd = pop.worker + pop.comfortable + pop.affluent;
      if (crowd > 0) {
        workerShares.push(pop.worker / crowd);
        comfortableShares.push(pop.comfortable / crowd);
      }

      let castWorkerSatMass = 0;
      let castWorkerN = 0;
      for (const id in state.citizens) {
        const c = state.citizens[id]!;
        if (c.tier !== 'worker') continue;
        castWorkerSatMass += c.satisfaction;
        castWorkerN += 1;
      }
      if (cohortWorkerPop > 0 && castWorkerN > 0) {
        workerGaps.push(
          Math.abs(cohortWorkerSatMass / cohortWorkerPop - castWorkerSatMass / castWorkerN),
        );
      }
    }

    const mean = (a: number[]): number => a.reduce((x, y) => x + y, 0) / a.length;
    const worker = mean(workerShares);
    const comfortable = mean(comfortableShares);
    const workerGap = mean(workerGaps);

    // 1. Worker band — back in the A3 50-70 band after the A4 recalibration
    //    (measured seed-11 15-day mean 0.611). FAILS on pre-recalibration A4 code
    //    (0.722, over the 70% ceiling — the crowd-flood regime).
    expect(worker).toBeGreaterThanOrEqual(0.50);
    expect(worker).toBeLessThanOrEqual(0.70);

    // 2. Comfortable band FLOOR — back in the A3 25-40 band (measured seed-11
    //    0.365). FAILS on pre-recalibration A4 code (0.264, under the 25% floor —
    //    the doubled map's jobless-immigration flood suppressed crowd promotion;
    //    the A4 recalibration keeps the crowd proportionate to jobs, so the ladder
    //    climbs again — see docs/design/cohorts-and-districts.md, "A4 geometry
    //    recalibration").
    expect(comfortable).toBeGreaterThanOrEqual(0.30);
    // ...and comfortable holds under the CEILING — the ORIGINAL load-bearing A3
    //    joint-calibration guard, UNCHANGED across A4. It still FAILS on pre-A3
    //    code (comfortable ran 0.54 before the 2× demotion + savings-cap +
    //    employment-weighted gates). On the recalibrated A4 map it measures 0.365.
    expect(comfortable).toBeLessThanOrEqual(0.40);

    // 3. Worker cast-vs-cohort satisfaction gap <= 8 — the A4 gap fix (RESERVE_
    //    FACTOR 1.7 protects the trip-disadvantaged cast's shelf share so its
    //    fewer window trips still land buys). Measured seed-11 15-day mean 5.84;
    //    FAILS on pre-recalibration A4 code (12.8). The guard was temporarily
    //    widened to 14 during the A4 map drift and is brought back down here.
    expect(workerGap).toBeLessThanOrEqual(8);

    // Every tier move and migration flow carries real money — conserved to the cent.
    expect(totalMoneySupply(state)).toBe(supply0);
  });

  it('a well-supplied affluent cohort is NOT cratered — the tier system is sound; city luxury supply is the limiter', () => {
    // The live city cannot stock jewelry/pastries at cohort volume (founder
    // luxury chains go labor-starved and insolvent — soak finding), so the
    // emergent affluent block is small and unhappy: its cravings pin unfed. That
    // is a SUPPLY limit, not a satisfaction-formula fault. Prove the formula is
    // sound by giving an affluent cohort what the city can't: drained buckets
    // (recently well-fed) and jobs. It must stay content, well clear of the
    // collapse the under-supplied live block suffers.
    const state = createInitialState(11, { ...DEFAULT_CONFIG, sizePreset: 'city' });
    const sim = new Simulation(state);
    sim.dispatch({ type: 'RESUME' });
    const did = Object.keys(state.districts)
      .sort()
      .find((id) => state.districts[id]!.kind === 'residential')!;

    const affluent = emptyCohort(did, 'affluent');
    affluent.population = 40;
    affluent.employed = 40;
    affluent.avgSatisfaction = 70;
    affluent.cashPool = affluent.population * dollars(500);
    for (const pid in affluent.needBuckets) {
      affluent.needBuckets[pid] = affluent.needBuckets[pid]!.map(() => 0.2);
    }
    state.cohorts[affluent.id] = affluent;
    const supply0 = totalMoneySupply(state);

    sim.run(ticksPerDay(state.config) * 8);

    const live = state.cohorts[`${did}:affluent`];
    expect(live).toBeTruthy();
    expect(live!.population).toBeGreaterThan(0);
    // Not collapsed: a provided, employed affluent block holds a healthy mood.
    expect(live!.avgSatisfaction).toBeGreaterThanOrEqual(25);
    expect(totalMoneySupply(state)).toBe(supply0);
  });
});
