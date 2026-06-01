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
import { getFacilityDef } from '../data/facilityDefinitions';
import type { FacilityId, CitizenId } from '../core/Id';

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
  const def = getFacilityDef(fac.defId);
  if (fac.employees.length >= def.workerCapacity) return false;

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
  for (const fid in state.facilities) {
    state.facilities[fid]!.presentWorkers = 0;
  }
  for (const cid in state.citizens) {
    const cit = state.citizens[cid]!;
    if (cit.activity !== 'working' || cit.movementState !== 'idle') continue;
    if (!cit.workplaceFacilityId) continue;
    const fac = state.facilities[cit.workplaceFacilityId];
    if (fac) fac.presentWorkers += 1;
  }
}
