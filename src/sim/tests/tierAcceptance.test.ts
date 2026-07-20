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
 * The full A3 target — worker 50-70 / comfortable 25-40 / affluent 5-15 — is a
 * 300-day figure (the crowd is still gentrifying at 150; comfortable climbs from
 * ~16-23% here to ~33-36% by day 300). The suite can't afford 300 days × 3
 * seeds, so this asserts the WIDER 150-day forming band and leaves the tight
 * 300-day acceptance to the probe/report. What it guards against is the failure
 * the calibration cured: the savings route promoting the whole crowd once its
 * pool drifts past the cast savings bar (measured comfortable 53-70% at day 300
 * before the fix). See CohortSocialSystem's FLOAT_RESERVE_CENTS + proportional
 * savings legs.
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
      expect(s.comfortable).toBeGreaterThan(0.05);

      // Widened-but-honest 150-day forming bands. These guard SHAPE (a ladder
      // that neither freezes nor collapses), not the tight 300-day acceptance
      // band — that enters the suite with the joint calibration pass (see the
      // design doc's "Combined re-measure" section: the worker catch-up raises
      // crowd prosperity, so the combined economy promotes slightly faster
      // than the calibration-alone measurements these bands were first pinned
      // against; seed 11 sits at W 0.5197 at day 150).
      expect(s.worker).toBeGreaterThanOrEqual(0.5);
      expect(s.worker).toBeLessThanOrEqual(0.90);
      expect(s.comfortable).toBeGreaterThanOrEqual(0.08);
      expect(s.comfortable).toBeLessThanOrEqual(0.45);
      // Affluent stays a thin top tier — never a runaway share (city luxury
      // supply is labor-bound, so it cannot sustain a large luxury-buying class;
      // see the soak note on affluent under-supply).
      expect(s.affluent).toBeLessThanOrEqual(0.20);

      // Cohort tier moves and migration carry real money — conserved to the cent.
      expect(totalMoneySupply(state)).toBe(supply0);
    });
  }

  it('seed 11: 300-day joint acceptance — comfortable holds the 40% ceiling and the worker cast/cohort gap stays <= 8', () => {
    // The load-bearing joint-calibration guard (docs/design/cohorts-and-districts.md,
    // "Combined re-measure" + the joint numbers that replaced its re-opens note).
    // Both shipped mechanisms are live here — RetailDemandSystem's worker catch-up
    // AND CohortSocialSystem's float-savings gates — so this asserts the COMBINED
    // economy, not either in isolation. Two outcomes, measured as a 15-day trailing
    // mean (the gates are a chaotic curator<->demotion oscillation; a single day's
    // comfortable share swings ~6 points and the worker gap spikes to ~9, so the
    // band is a multi-week mean):
    //   1. comfortable <= 40% — the ceiling the calibration cured. This FAILS on
    //      pre-calibration code (comfortable ran 54% at day 300 before the 2x
    //      demotion + savings-cap + employment-weighted gates landed).
    //   2. worker cast-vs-cohort satisfaction gap <= 8 — the worker-catch-up
    //      outcome must not regress under the joint calibration.
    // Seed 11 only, so one 300-day city run (~3s) carries the guard; the other two
    // seeds and the full band table live in the tier-joint probe / design doc.
    const state = createInitialState(11, { ...DEFAULT_CONFIG, sizePreset: 'city' });
    const sim = new Simulation(state);
    sim.dispatch({ type: 'RESUME' });
    const supply0 = totalMoneySupply(state);
    const tpd = ticksPerDay(state.config);

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
      if (crowd > 0) comfortableShares.push(pop.comfortable / crowd);

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
    const comfortable = mean(comfortableShares);
    const workerGap = mean(workerGaps);

    // 1. Comfortable band ceiling — the calibration target (measured ~0.33 here,
    //    ~0.54 before the joint pass). This is the assertion that FAILS on
    //    pre-calibration code.
    expect(comfortable).toBeLessThanOrEqual(0.40);
    // ...and it did not over-demote comfortable out of existence (a real class
    // remains — the failure mode 2x demotion could have overshot into).
    expect(comfortable).toBeGreaterThanOrEqual(0.25);

    // 2. Worker cast-vs-cohort satisfaction gap — the worker-catch-up outcome,
    //    not regressed (measured ~4 here; the joint target is <= 8).
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
