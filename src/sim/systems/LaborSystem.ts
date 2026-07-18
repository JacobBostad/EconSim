/**
 * LaborSystem — computes how many workers are actually present and working at
 * each facility this tick. ProductionSystem reads `facility.presentWorkers` to
 * scale output. Workers count as present when their activity is 'working' (i.e.
 * they commuted in during work hours). Retail selling capacity is handled
 * separately (assigned staff + open hours) in RetailDemandSystem.
 *
 * Hiring/firing themselves are command-driven (see Simulation), keeping the
 * door open for a richer labor market later.
 */

import type { GameState, SimContext } from '../core/GameState';
import { formatMoney } from '../../utils/formatMoney';
import { canAfford, emitEvent, recordTransaction } from '../core/GameState';
import { firmAccount, WORLD_ACCOUNT } from '../core/Transactions';
import { isDayBoundary } from '../core/Tick';
import type { FacilityId, CitizenId } from '../core/Id';
import { clamp } from '../../utils/clamp';

/** Daily skill drift: practice on the job, rust off it. */
const SKILL_GAIN_PER_WORKDAY = 0.012;
const SKILL_DECAY_PER_IDLE_DAY = 0.004;
const SKILL_MAX = 1.3;
const SKILL_MIN = 0.7;

/** Job switching: minimum pay rise that tempts a worker, and daily chance. */
const POACH_WAGE_PREMIUM = 1.15;
const POACH_DAILY_CHANCE = 0.08;

/**
 * Training workshop: an immediate skill jump you pay for, against waiting
 * out on-the-job gains (0.012/workday) or poaching a veteran at a
 * permanent wage premium. +0.15 is ~12 workdays of practice per session;
 * reaching the cap from green costs 4 sessions ($480/worker) — a real
 * investment, not a cheat code, and useless once the crew is at 1.3.
 */
export const TRAINING_COST_PER_WORKER = 120_00;
export const TRAINING_SKILL_GAIN = 0.15;
export { SKILL_MAX };

/**
 * Send a facility's crew to a training workshop: every worker below the
 * skill cap jumps +TRAINING_SKILL_GAIN, paid per trainee (workers already
 * at cap aren't billed). Books as R&D — it's an investment in capability,
 * not payroll. Returns true when anyone was trained.
 */
export function trainCrew(
  state: GameState,
  firmId: import('../core/Id').FirmId,
  facilityId: FacilityId,
): boolean {
  const firm = state.firms[firmId];
  const fac = state.facilities[facilityId];
  if (!firm || !fac || fac.ownerFirmId !== firmId) return false;
  const trainees = fac.employees
    .map((cid) => state.citizens[cid])
    .filter((c): c is NonNullable<typeof c> => !!c && c.skill < SKILL_MAX - 1e-9);
  if (trainees.length === 0) {
    emitEvent(state, 'info', 'player', `${fac.name}'s crew is already at peak skill — nothing to train.`, facilityId);
    return false;
  }
  const cost = trainees.length * TRAINING_COST_PER_WORKER;
  if (!canAfford(state, firmAccount(firmId), cost)) {
    emitEvent(state, 'danger', 'player',
      `Training ${trainees.length} worker${trainees.length === 1 ? '' : 's'} costs ${formatMoney(cost)}.`, facilityId);
    return false;
  }
  recordTransaction(state, {
    from: firmAccount(firmId),
    to: WORLD_ACCOUNT,
    amount: cost,
    firmId,
    category: 'rnd',
    note: `Training workshop for ${fac.name} (${trainees.length} trainee${trainees.length === 1 ? '' : 's'})`,
  });
  for (const cit of trainees) {
    cit.skill = Math.min(SKILL_MAX, cit.skill + TRAINING_SKILL_GAIN);
  }
  emitEvent(state, 'success', 'player',
    `🎓 ${fac.name}'s crew trained up — ${trainees.length} worker${trainees.length === 1 ? '' : 's'} sharper for ${formatMoney(cost)}.`, facilityId);
  return true;
}

/**
 * Hire an unemployed citizen into a facility at the firm's base wage.
 * Returns true on success. Shared by the HIRE_WORKER command and the AI.
 */
export function hireCitizen(
  state: GameState,
  facilityId: FacilityId,
  citizenId: CitizenId,
): boolean {
  const fac = state.facilities[facilityId];
  if (!fac) return false;
  const firm = state.firms[fac.ownerFirmId];
  if (!firm) return false;
  const cit = state.citizens[citizenId];
  if (!cit || cit.employmentStatus === 'employed') return false;
  if (fac.employees.length >= fac.workerCapacity) return false;

  cit.employerFirmId = firm.id;
  cit.workplaceFacilityId = fac.id;
  cit.role = `${fac.type} worker`;
  cit.wage = firm.wagePolicy.baseWage;
  cit.employmentStatus = 'employed';
  cit.missedPaydays = 0;
  fac.employees.push(citizenId);
  firm.employees.push(citizenId);
  return true;
}

/** Fire a citizen from a facility, returning them to the unemployed pool. */
export function fireCitizen(
  state: GameState,
  facilityId: FacilityId,
  citizenId: CitizenId,
): boolean {
  const fac = state.facilities[facilityId];
  if (!fac) return false;
  const firm = state.firms[fac.ownerFirmId];
  if (!firm) return false;
  const cit = state.citizens[citizenId];
  if (!cit) return false;
  fac.employees = fac.employees.filter((id) => id !== citizenId);
  firm.employees = firm.employees.filter((id) => id !== citizenId);
  cit.employerFirmId = null;
  cit.workplaceFacilityId = null;
  cit.employmentStatus = 'unemployed';
  cit.role = 'unemployed';
  cit.wage = 0;
  return true;
}

/** First unemployed citizen id, or null. Deterministic by insertion order. */
export function findUnemployed(state: GameState): CitizenId | null {
  for (const cid in state.citizens) {
    if (state.citizens[cid]!.employmentStatus === 'unemployed') return cid;
  }
  return null;
}

export function runLaborSystem(ctx: SimContext): void {
  const { state } = ctx;
  if (isDayBoundary(state.tick, ctx.config)) {
    growSkills(state);
    runJobMarket(ctx);
  }
  for (const fid in state.facilities) {
    state.facilities[fid]!.presentWorkers = 0;
    state.facilities[fid]!.presentSkill = 0;
  }
  for (const cid in state.citizens) {
    const cit = state.citizens[cid]!;
    if (cit.activity !== 'working' || cit.movementState !== 'idle') continue;
    if (!cit.workplaceFacilityId) continue;
    const fac = state.facilities[cit.workplaceFacilityId];
    if (fac) {
      fac.presentWorkers += 1;
      fac.presentSkill += cit.skill;
    }
  }
}

/** Employed citizens get better at their jobs; idle skills rust slowly. */
function growSkills(state: GameState): void {
  for (const cid in state.citizens) {
    const cit = state.citizens[cid]!;
    cit.skill =
      cit.employmentStatus === 'employed'
        ? Math.min(SKILL_MAX, cit.skill + SKILL_GAIN_PER_WORKDAY)
        : Math.max(SKILL_MIN, cit.skill - SKILL_DECAY_PER_IDLE_DAY);
  }
}

/**
 * Wage-driven job switching: each day, an employed citizen may jump to a firm
 * paying ≥15% more if it has an open slot (closest such facility wins). This
 * makes wage policy a genuine lever — pay above market to poach experienced
 * (higher-skill) workers, or lose yours to a rival who does.
 */
function runJobMarket(ctx: SimContext): void {
  const { state, rng } = ctx;
  for (const cid in state.citizens) {
    const cit = state.citizens[cid]!;
    if (cit.employmentStatus !== 'employed' || cit.wage <= 0) continue;
    if (!rng.chance(POACH_DAILY_CHANCE)) continue;

    let best: FacilityId | null = null;
    let bestWage = cit.wage * POACH_WAGE_PREMIUM;
    for (const fid in state.facilities) {
      const fac = state.facilities[fid]!;
      if (fac.status === 'closed' || fac.id === cit.workplaceFacilityId) continue;
      const firm = state.firms[fac.ownerFirmId];
      if (!firm || (firm.ownerType !== 'player' && firm.ownerType !== 'ai')) continue;
      if (firm.id === cit.employerFirmId) continue;
      if (fac.workerCapacity <= 0 || fac.employees.length >= fac.workerCapacity) continue;
      if (firm.wagePolicy.baseWage >= bestWage) {
        bestWage = firm.wagePolicy.baseWage;
        best = fac.id;
      }
    }
    if (!best) continue;

    const from = cit.employerFirmId;
    const oldWorkplace = cit.workplaceFacilityId;
    if (oldWorkplace) fireCitizen(state, oldWorkplace, cid);
    hireCitizen(state, best, cid);
    const newFirm = state.firms[state.facilities[best]!.ownerFirmId]!;
    if (from === state.playerFirmId) {
      emitEvent(state, 'warning', 'payroll',
        `${cit.name} left you for ${newFirm.name}'s higher wages (${formatMoney(newFirm.wagePolicy.baseWage)}/day).`, cid);
    } else if (newFirm.id === state.playerFirmId) {
      emitEvent(state, 'success', 'payroll',
        `${cit.name} (skill ${clamp(cit.skill, SKILL_MIN, SKILL_MAX).toFixed(2)}) joined you for better pay.`, cid);
    }
  }
}
