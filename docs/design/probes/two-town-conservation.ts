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
import { computeTime } from '../../../src/sim/core/Tick';
import { addStock } from '../../../src/sim/entities/Inventory';
import { performExport, exportFreightFee } from '../../../src/sim/core/Trade';
import { FREIGHT_LEAD_DAYS } from '../../../src/sim/data/constants';

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

// --- (d) THE FREIGHT LEG (slice 4): a lead-timed inter-town shipment ---------
// A home export to the LIVE partner rides a freight edge: goods leave now, land
// in the partner larder FREIGHT_LEAD_DAYS later, and pay out THEN at the locked
// price. Money is conserved to the cent every day across the in-flight window
// (in-flight goods are inventory, not money), and the arrival's single world->
// firm transfer nets to zero region-wide.
{
  const on = createInitialState(11, regionConfig());
  const sim = new Simulation(on);
  sim.dispatch({ type: 'RESUME' });
  // Stage a player warehouse and dispatch 300 bread toward the partner.
  const player = on.firms[on.playerFirmId]!;
  player.cash = 500000_00;
  sim.dispatch({ type: 'BUILD_FACILITY', firmId: player.id, defId: 'warehouse', location: { x: 100, y: 20 } });
  const wh = on.facilities[player.facilities[player.facilities.length - 1]!]!;
  addStock(wh.inputInventory, 'bread', 300, 60);

  const money0 = totalMoneySupply(on);
  performExport(on, player.id, wh.id, 'bread', 300, 'Exported', PARTNER_TOWN_ID);
  const ship = { ...on.freight[0]! };
  check('(d) a home->partner export is DISPATCHED, not settled (in flight, no money moved)',
    on.freight.length === 1 && totalMoneySupply(on) === money0,
    `arrivalDay=${ship.arrivalDay} (dispatch+${FREIGHT_LEAD_DAYS})`);

  let conserved = true;
  let landedDay = -1;
  const tpd = ticksPerDay(on.config);
  for (let d = 0; d < FREIGHT_LEAD_DAYS + 3; d++) {
    sim.run(tpd);
    if (totalMoneySupply(on) !== money0) conserved = false;
    if (landedDay < 0 && !on.freight.some((s) => s.id === ship.id)) {
      landedDay = computeTime(on.tick, on.config).day;
    }
  }
  check('(d) region money conserved to the cent every day across the in-flight window', conserved, `money=${money0}`);
  check('(d) the shipment lands on its scheduled arrival day', landedDay === ship.arrivalDay, `landed day ${landedDay}, expected ${ship.arrivalDay}`);
  const net = Math.round(ship.priceLocked * (1 - exportFreightFee(on, PARTNER_TOWN_ID)));
  const paid = on.transactions.filter((t) => t.note.startsWith('Freight delivered to') && t.amount === net * 300);
  check('(d) settled at the LOCKED price on arrival (world -> firm, freight netted)', paid.length === 1, `net=${net}/unit x300 = ${net * 300}`);
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
