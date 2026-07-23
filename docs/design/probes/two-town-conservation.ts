/**
 * two-town-conservation — the follow-up de-risking probe for region.md step 4,
 * required "once TownScheduler can TICK the partner" (region.md § 6, the DE-
 * RISKING PROBE PLAN). Where second-town-isolation.ts attached an INERT partner
 * (slice 1) to prove the seam isolates home and to quantify the money debt, this
 * probe drives a LIVE partner (slice 3's scheduler + ticking economy) and
 * asserts the three properties the plan named for the live-partner slice:
 *
 *  (a) CONSERVATION with the region-wide money primitive — region money is
 *      invariant to the cent across a full flag-on run (the two towns move money
 *      only through recordTransaction; the partner shares the world account, so
 *      stipends/wages/variable-costs/rent all net out region-wide). Δ = 0 daily.
 *
 *  (b) HOME BIT-IDENTITY still holds with the partner now LIVE-but-flag-off —
 *      the gate is the FLAG, not merely an unticked record. A flag-off City is
 *      byte-identical to the pre-region baseline (pinned rngState/money), even
 *      though the scheduler code path that would tick a partner now exists.
 *
 *  (c) HOME ISOLATION with the flag ON — the harder property, testable only with
 *      a live partner: home's rngState and its whole `towns.home` record are
 *      byte-identical whether the partner is live or absent. The partner draws
 *      ZERO shared rng and writes only its own records, so a partner shock
 *      (drain its larder) changes only the partner + the shared world ledger,
 *      never home's cohorts/firms/rng. Leakage-on = any home-state delta.
 *
 * Reads/simulates only — no sim-code changes.
 * Runnable: `npx tsx docs/design/probes/two-town-conservation.ts`
 */
import { Simulation } from '../../../src/sim/core/Simulation';
import { createInitialState } from '../../../src/sim/data/startingScenario';
import { DEFAULT_CONFIG } from '../../../src/sim/core/SimulationConfig';
import { ticksPerDay } from '../../../src/sim/core/Tick';
import { totalMoneySupply } from '../../../src/sim/core/GameState';
import type { GameState } from '../../../src/sim/core/GameState';
import type { SimulationConfig } from '../../../src/sim/core/SimulationConfig';
import { HOME_TOWN_ID } from '../../../src/sim/core/Town';
import { PARTNER_TOWN_ID } from '../../../src/sim/data/seedTown';

function cityConfig(): SimulationConfig {
  return {
    ...DEFAULT_CONFIG,
    sizePreset: 'city',
    servicesEnabled: true,
    realEstateEnabled: true,
    investorsEnabled: true,
    tradeDemandPoolsEnabled: true,
  };
}
function regionConfig(): SimulationConfig {
  return { ...cityConfig(), regionEnabled: true };
}

function run(state: GameState, days: number): Simulation {
  const sim = new Simulation(state);
  sim.dispatch({ type: 'RESUME' });
  sim.run(ticksPerDay(state.config) * days);
  return sim;
}

let failures = 0;
function check(label: string, ok: boolean, detail = ''): void {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? '  — ' + detail : ''}`);
  if (!ok) failures += 1;
}

const DAYS = 60;

// --- (a) CONSERVATION, day by day, flag on ---------------------------------
{
  const on = createInitialState(11, regionConfig());
  const money0 = totalMoneySupply(on);
  const sim = new Simulation(on);
  sim.dispatch({ type: 'RESUME' });
  let conserved = true;
  let breakDay = -1;
  for (let d = 0; d < DAYS; d++) {
    sim.run(ticksPerDay(on.config));
    if (totalMoneySupply(on) !== money0) {
      conserved = false;
      breakDay = d + 1;
      break;
    }
  }
  check(
    '(a) region money conserved to the cent every day (flag on, 60d)',
    conserved,
    conserved ? `money=${money0}` : `broke on day ${breakDay}`,
  );
}

// --- (b) flag-off bit-identity (the flag is the gate) ----------------------
{
  const plain = createInitialState(11, { ...DEFAULT_CONFIG, sizePreset: 'city' });
  run(plain, 300);
  check(
    '(b) flag-off City seed 11 reproduces pinned rngState 2546912297',
    plain.rngState === 2546912297,
    `rngState=${plain.rngState}`,
  );
  check(
    '(b) flag-off City seed 11 reproduces pinned money 316900000',
    totalMoneySupply(plain) === 316900000,
    `money=${totalMoneySupply(plain)}`,
  );
  check('(b) flag-off is a ONE-town region', Object.keys(plain.towns).length === 1);
}

// --- (c) home isolation with the flag ON (live partner) --------------------
{
  const off = createInitialState(11, cityConfig());
  const on = createInitialState(11, regionConfig());
  run(off, DAYS);
  run(on, DAYS);
  const homeOn = JSON.stringify(on.towns[HOME_TOWN_ID]);
  const homeOff = JSON.stringify(off.towns[HOME_TOWN_ID]);
  check('(c) home rngState identical with the partner live', on.rngState === off.rngState, `${on.rngState}`);
  check('(c) home towns.home byte-identical with the partner live', homeOn === homeOff);

  // The partner IS live (not inert): its records changed over the run.
  const onFresh = createInitialState(11, regionConfig());
  const partnerBefore = JSON.stringify(onFresh.towns[PARTNER_TOWN_ID]);
  const partnerAfter = JSON.stringify(on.towns[PARTNER_TOWN_ID]);
  check('(c) the partner is LIVE (its records changed under the scheduler)', partnerBefore !== partnerAfter);

  // A partner shock changes ONLY the partner + shared world ledger, never home.
  const shocked = createInitialState(11, regionConfig());
  const shockCohort = Object.values(shocked.towns[PARTNER_TOWN_ID]!.cohorts)[0]!;
  shockCohort.cashPool = 0; // drain the partner crowd's larder before ticking
  run(shocked, DAYS);
  check(
    '(c) a partner shock leaves home byte-identical (no home leakage on)',
    JSON.stringify(shocked.towns[HOME_TOWN_ID]) === homeOff && shocked.rngState === off.rngState,
  );
}

// --- DETERMINISM: two flag-on runs agree -----------------------------------
{
  const a = createInitialState(11, regionConfig());
  const b = createInitialState(11, regionConfig());
  run(a, DAYS);
  run(b, DAYS);
  check(
    'determinism: two flag-on runs agree (partner + rngState)',
    a.rngState === b.rngState &&
      JSON.stringify(a.towns[PARTNER_TOWN_ID]) === JSON.stringify(b.towns[PARTNER_TOWN_ID]),
  );
}

console.log(failures === 0 ? '\nALL CHECKS PASS' : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
