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
import type { Manager, ManagerRole } from '../entities/Firm';
import { adjustPrices, maybeWidenShelves, manageSourcing } from './AIStrategySystem';
import { performExport } from '../core/Trade';
import { getQuantity } from '../entities/Inventory';
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

/** Salary bands per role: firm-wide roles command more than a corner shop. */
const SALARY_BANDS: Record<ManagerRole, Array<{ band: string; lo: number; hi: number }>> = {
  store: [
    { band: 'junior', lo: 16_00, hi: 20_00 },
    { band: 'seasoned', lo: 24_00, hi: 30_00 },
    { band: 'veteran', lo: 34_00, hi: 42_00 },
  ],
  logistics: [
    { band: 'junior', lo: 28_00, hi: 34_00 },
    { band: 'seasoned', lo: 36_00, hi: 44_00 },
    { band: 'veteran', lo: 46_00, hi: 52_00 },
  ],
  sales: [
    { band: 'junior', lo: 28_00, hi: 34_00 },
    { band: 'seasoned', lo: 36_00, hi: 44_00 },
    { band: 'veteran', lo: 46_00, hi: 52_00 },
  ],
};

const SKILL_BANDS = [
  { lo: 0.92, hi: 1.02 },
  { lo: 1.05, hi: 1.12 },
  { lo: 1.15, hi: 1.28 },
];

/** Distinct candidate pools per role (names must differ between roles). */
const ROLE_SALT: Record<ManagerRole, number> = { store: 0, logistics: 100, sales: 200 };

/**
 * The week's hiring market for a role: one candidate per band, derived on
 * demand. Same seed + same week + same role → same candidates, forever.
 */
export function managerCandidates(
  state: GameState,
  day: number,
  role: ManagerRole = 'store',
): ManagerCandidate[] {
  const week = Math.floor(day / 7);
  const salt = ROLE_SALT[role];
  return SALARY_BANDS[role].map((b, i) => {
    const first =
      FIRST_NAMES[Math.floor(mgrRoll(state.seed, week, salt + i * 3) * FIRST_NAMES.length)]!;
    const last =
      LAST_NAMES[Math.floor(mgrRoll(state.seed, week, salt + i * 3 + 1) * LAST_NAMES.length)]!;
    const u = mgrRoll(state.seed, week, salt + i * 3 + 2);
    const sk = SKILL_BANDS[i]!;
    return {
      name: `${first} ${last}`,
      skill: Math.round((sk.lo + (sk.hi - sk.lo) * u) * 100) / 100,
      salaryPerDay: Math.round((b.lo + (b.hi - b.lo) * u) / 100) * 100,
      band: b.band,
    };
  });
}

/** The duties a manager of this skill covers (for UI and the daily run). */
export function managerDuties(skill: number, role: ManagerRole = 'store'): string[] {
  if (role === 'logistics') {
    const d = ['shelf-contract sizing'];
    if (skill >= SHELF_DUTY_SKILL) d.push('wholesale sourcing');
    if (skill >= MARKETING_DUTY_SKILL) d.push('double pace');
    return d;
  }
  if (role === 'sales') {
    const d = ['rush-order fulfillment'];
    if (skill >= SHELF_DUTY_SKILL) d.push('standing exports');
    if (skill >= MARKETING_DUTY_SKILL) d.push('sharper price floors');
    return d;
  }
  const d = ['pricing'];
  if (skill >= SHELF_DUTY_SKILL) d.push('shelf-sizing');
  if (skill >= MARKETING_DUTY_SKILL) d.push('marketing');
  return d;
}

/** Sales duty: ship staged goods toward the active rush order, and (with
 * experience) keep standing export orders on every stocked warehouse. */
function runSalesDuty(ctx: SimContext, firmId: string, mgr: Manager): void {
  const { state } = ctx;
  const firm = state.firms[firmId]!;
  const order = state.rushOrder;
  if (order && firmId === state.playerFirmId) {
    for (const facId of [...firm.facilities]) {
      const active = state.rushOrder;
      if (!active) break; // filled — the bonus already landed
      const fac = state.facilities[facId];
      if (!fac || fac.type !== 'warehouse') continue;
      const staged =
        getQuantity(fac.inputInventory, active.productId) +
        getQuantity(fac.outputInventory, active.productId);
      if (staged <= 0) continue;
      const need = active.quantity - active.filled;
      performExport(state, firmId, facId, active.productId,
        Math.min(staged, need), 'Rush order (sales manager)', active.cityId);
    }
  }
  if (mgr.skill >= SHELF_DUTY_SKILL) {
    // Veterans set a sharper floor: ship at 1.25x instead of holding for 1.35x.
    const minMult = mgr.skill >= MARKETING_DUTY_SKILL ? 1.25 : 1.35;
    for (const facId of firm.facilities) {
      const fac = state.facilities[facId];
      if (!fac || fac.type !== 'warehouse') continue;
      for (const inv of [fac.inputInventory, fac.outputInventory]) {
        for (const pid in inv) {
          if ((inv[pid]?.quantity ?? 0) >= 30 && !fac.exportOrders[pid]) {
            fac.exportOrders[pid] = { minMult, keep: 10 };
          }
        }
      }
    }
  }
}

/** Logistics duty: firm-wide shelf sizing, then (with experience) swap
 * importer contracts to cheaper local wholesale. Veterans work two
 * contracts a day instead of one. */
function runLogisticsDuty(ctx: SimContext, firmId: string, mgr: Manager): void {
  maybeWidenShelves(ctx, firmId, false);
  if (mgr.skill >= SHELF_DUTY_SKILL) manageSourcing(ctx, firmId);
  if (mgr.skill >= MARKETING_DUTY_SKILL) maybeWidenShelves(ctx, firmId, false);
}

function runMarketingDuty(ctx: SimContext, firmId: string, mgr: Manager): void {
  const { state } = ctx;
  const firm = state.firms[firmId]!;
  const fac = mgr.facilityId ? state.facilities[mgr.facilityId] : null;
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
      const fac = mgr.facilityId ? state.facilities[mgr.facilityId] : null;
      // A store manager's store was sold or demolished: the job is gone.
      if (mgr.role === 'store' && (!fac || fac.ownerFirmId !== fid)) {
        firm.managers = firm.managers.filter((m) => m.id !== mgr.id);
        emitEvent(state, 'info', 'payroll',
          `${mgr.name} moved on — the store they managed is no longer ${firm.name}'s.`, fid);
        continue;
      }
      // Payday first. A firm that can't pay loses the manager on the spot.
      if (firm.cash < mgr.salaryPerDay) {
        firm.managers = firm.managers.filter((m) => m.id !== mgr.id);
        emitEvent(state, 'warning', 'payroll',
          `${mgr.name} resigned as ${firm.name}'s ${mgr.role} manager — the firm couldn't cover their salary.`, fid);
        continue;
      }
      recordTransaction(state, {
        from: firmAccount(fid), to: WORLD_ACCOUNT, amount: mgr.salaryPerDay,
        firmId: fid, category: 'wages', note: `Manager salary — ${mgr.name}`,
      });

      if (mgr.role === 'logistics') {
        runLogisticsDuty(ctx, fid, mgr);
      } else if (mgr.role === 'sales') {
        runSalesDuty(ctx, fid, mgr);
      } else if (mgr.facilityId) {
        // Store duties, cheapest-first: pricing for everyone, then by skill.
        adjustPrices(ctx, fid, false, mgr.facilityId);
        if (mgr.skill >= SHELF_DUTY_SKILL) maybeWidenShelves(ctx, fid, false, mgr.facilityId);
        if (mgr.skill >= MARKETING_DUTY_SKILL) runMarketingDuty(ctx, fid, mgr);
      }
    }
  }
}
