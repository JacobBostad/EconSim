/**
 * ManagerSystem — hired delegation (docs/design/managers.md).
 *
 * A Store Manager is the per-facility generalization of the auto-price
 * toggle: a named, salaried professional who runs one retail store's
 * pricing (all skill levels), shelf-sizing (skill ≥ 1.05), and marketing
 * (skill ≥ 1.15), reusing the same subroutines the AI and the player's
 * autoPriceByProduct path already exercise. Product prices are firm-wide,
 * so a manager pricing their store's products prices them chain-wide —
 * identical semantics to the existing auto-price toggle.
 *
 * Candidates are a pure function of (seed, week) via the same stream-safe
 * hash rush orders use: no ctx.rng draws, no stored candidate state, so
 * this system's insertion re-deals nothing until a manager is actually
 * hired (a player action, which always re-deals downstream).
 *
 * Salary books daily as wages (firm → world) so money stays conserved and
 * delegation shows up on the P&L. A firm that can't cover payday loses
 * the manager immediately — managers aren't loyal to sinking ships.
 */

import type { SimContext, GameState } from '../core/GameState';
import { emitEvent, recordTransaction } from '../core/GameState';
import { firmAccount, WORLD_ACCOUNT } from '../core/Transactions';
import { isDayBoundary } from '../core/Tick';
import type { Manager } from '../entities/Firm';
import { adjustPrices, maybeWidenShelves } from './AIStrategySystem';
import { FIRST_NAMES, LAST_NAMES } from '../data/names';

export const SHELF_DUTY_SKILL = 1.05;
export const MARKETING_DUTY_SKILL = 1.15;
/** Marketing duty: ceiling for the manager's per-product ad budget. */
export const MANAGER_AD_CAP = 25_00;
export const MANAGER_AD_STEP = 3_00;
export const MANAGER_AD_FLOOR = 8_00;

export interface ManagerCandidate {
  name: string;
  skill: number;
  salaryPerDay: number;
  /** Human label for the band ("junior" | "seasoned" | "veteran"). */
  band: string;
}

/** Independent deterministic stream per (seed, week, salt) — rush-order style. */
function mgrRoll(seed: number, week: number, salt: number): number {
  let t = (seed ^ Math.imul(week + 7, 0x9e3779b9) ^ Math.imul(salt + 13, 0x85ebca6b)) >>> 0;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/**
 * The week's hiring market: one candidate per band, derived on demand.
 * Same seed + same week → same candidates, forever.
 */
export function managerCandidates(state: GameState, day: number): ManagerCandidate[] {
  const week = Math.floor(day / 7);
  const bands = [
    { band: 'junior', skillLo: 0.92, skillHi: 1.02, salLo: 16_00, salHi: 20_00 },
    { band: 'seasoned', skillLo: 1.05, skillHi: 1.12, salLo: 24_00, salHi: 30_00 },
    { band: 'veteran', skillLo: 1.15, skillHi: 1.28, salLo: 34_00, salHi: 42_00 },
  ];
  return bands.map((b, i) => {
    const first = FIRST_NAMES[Math.floor(mgrRoll(state.seed, week, i * 3) * FIRST_NAMES.length)]!;
    const last = LAST_NAMES[Math.floor(mgrRoll(state.seed, week, i * 3 + 1) * LAST_NAMES.length)]!;
    const u = mgrRoll(state.seed, week, i * 3 + 2);
    return {
      name: `${first} ${last}`,
      skill: Math.round((b.skillLo + (b.skillHi - b.skillLo) * u) * 100) / 100,
      salaryPerDay: Math.round((b.salLo + (b.salHi - b.salLo) * u) / 100) * 100,
      band: b.band,
    };
  });
}

/** The duties a manager of this skill covers (for UI and the daily run). */
export function managerDuties(skill: number): string[] {
  const d = ['pricing'];
  if (skill >= SHELF_DUTY_SKILL) d.push('shelf-sizing');
  if (skill >= MARKETING_DUTY_SKILL) d.push('marketing');
  return d;
}

function runMarketingDuty(ctx: SimContext, firmId: string, mgr: Manager): void {
  const { state } = ctx;
  const firm = state.firms[firmId]!;
  const fac = state.facilities[mgr.facilityId];
  if (!fac) return;
  for (const pid of fac.retailProductIds) {
    const budget = firm.adBudgetByProduct[pid] ?? 0;
    if (fac.pnlEma.net < 0) {
      if (budget > MANAGER_AD_FLOOR) {
        firm.adBudgetByProduct[pid] = Math.max(MANAGER_AD_FLOOR, budget - MANAGER_AD_STEP);
      }
    } else {
      const share = firm.marketShareByProduct[pid] ?? 0;
      if (share < 0.5 && firm.cash > 5000_00 && budget < MANAGER_AD_CAP) {
        firm.adBudgetByProduct[pid] = Math.min(MANAGER_AD_CAP, budget + MANAGER_AD_STEP);
      }
    }
  }
}

export function runManagerSystem(ctx: SimContext): void {
  const { state } = ctx;
  if (!isDayBoundary(state.tick, ctx.config)) return;

  for (const fid in state.firms) {
    const firm = state.firms[fid]!;
    if (firm.managers.length === 0) continue;

    for (const mgr of [...firm.managers]) {
      const fac = state.facilities[mgr.facilityId];
      // The store was sold or demolished: the job is gone.
      if (!fac || fac.ownerFirmId !== fid) {
        firm.managers = firm.managers.filter((m) => m.id !== mgr.id);
        emitEvent(state, 'info', 'payroll',
          `${mgr.name} moved on — the store they managed is no longer ${firm.name}'s.`, fid);
        continue;
      }
      // Payday first. A firm that can't pay loses the manager on the spot.
      if (firm.cash < mgr.salaryPerDay) {
        firm.managers = firm.managers.filter((m) => m.id !== mgr.id);
        emitEvent(state, 'warning', 'payroll',
          `${mgr.name} resigned as manager of ${fac.name} — ${firm.name} couldn't cover their salary.`, fid);
        continue;
      }
      recordTransaction(state, {
        from: firmAccount(fid), to: WORLD_ACCOUNT, amount: mgr.salaryPerDay,
        firmId: fid, category: 'wages', note: `Manager salary — ${mgr.name}`,
      });

      // Duties, cheapest-first: pricing for everyone, then by skill.
      adjustPrices(ctx, fid, false, mgr.facilityId);
      if (mgr.skill >= SHELF_DUTY_SKILL) maybeWidenShelves(ctx, fid, false, mgr.facilityId);
      if (mgr.skill >= MARKETING_DUTY_SKILL) runMarketingDuty(ctx, fid, mgr);
    }
  }
}
