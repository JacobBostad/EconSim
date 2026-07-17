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
import { emitEvent } from '../core/GameState';
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
        `${cit.name} left you for ${newFirm.name}'s higher wages (${newFirm.wagePolicy.baseWage}¢/day).`, cid);
    } else if (newFirm.id === state.playerFirmId) {
      emitEvent(state, 'success', 'payroll',
        `${cit.name} (skill ${clamp(cit.skill, SKILL_MIN, SKILL_MAX).toFixed(2)}) joined you for better pay.`, cid);
    }
  }
}
