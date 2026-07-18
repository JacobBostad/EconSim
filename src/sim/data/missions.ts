/**
 * missions.ts — Guided mission chain (data-driven tutorial with rewards).
 *
 * Missions form an ordered chain: only the first incomplete mission is active,
 * and completing it pays a cash reward from the world account (money stays
 * conserved). Checks are pure predicates over GameState, evaluated hourly by
 * MissionSystem. Completions are stored in `state.missions` as {id, day}.
 *
 * The chain teaches the full gameplay loop: build → hire → produce → sell →
 * wire supply → profit → win market share → grow valuation.
 */

import type { GameState } from '../core/GameState';
import { companyValuation } from '../selectors/companySelectors';
import { dollars } from './constants';

export interface MissionDef {
  id: string;
  name: string;
  icon: string;
  /** What to do, phrased as an instruction. */
  description: string;
  /** Reward in cents, paid on completion. */
  reward: number;
  check: (state: GameState) => boolean;
}

function player(state: GameState) {
  return state.firms[state.playerFirmId];
}

export const MISSION_DEFS: MissionDef[] = [
  {
    id: 'build_first',
    name: 'Break Ground',
    icon: '🏗️',
    description: 'Build your first facility — pick one in the Build panel, then click an empty spot on the map.',
    reward: dollars(500),
    check: (s) => (player(s)?.facilities.length ?? 0) >= 1,
  },
  {
    id: 'hire_two',
    name: 'Staff Up',
    icon: '🤝',
    description: 'Hire 2 workers. Click a facility you own, then use Hire in the inspector.',
    reward: dollars(500),
    check: (s) => (player(s)?.employees.length ?? 0) >= 2,
  },
  {
    id: 'produce',
    name: 'Production Line',
    icon: '⚙️',
    description: 'Produce goods: select a recipe at a farm, mine, or factory and let your workers finish a batch today.',
    reward: dollars(750),
    check: (s) => {
      const p = player(s);
      if (!p) return false;
      return p.facilities.some((fid) => (s.facilities[fid]?.dailyStats.unitsProduced ?? 0) > 0);
    },
  },
  {
    id: 'open_shop',
    name: 'Open a Shop',
    icon: '🏪',
    description: 'Open a staffed retail store and choose which product it sells.',
    reward: dollars(750),
    check: (s) => {
      const p = player(s);
      if (!p) return false;
      return p.facilities.some((fid) => {
        const f = s.facilities[fid];
        return f?.type === 'retail' && f.retailProductIds.length > 0 && f.employees.length >= 1;
      });
    },
  },
  {
    id: 'wire_supply',
    name: 'Wire the Supply Line',
    icon: '🚚',
    description: 'Create a supply contract feeding a store you own (from your factory or the importer).',
    reward: dollars(1000),
    check: (s) => {
      const p = player(s);
      if (!p) return false;
      const mine = new Set(p.facilities);
      return Object.values(s.contracts).some(
        (c) => c.active && mine.has(c.destinationFacilityId),
      );
    },
  },
  {
    id: 'first_hundred',
    name: 'Ring the Register',
    icon: '💵',
    description: 'Earn $100 of lifetime revenue from customers.',
    reward: dollars(1000),
    check: (s) => (player(s)?.accounting.lifetime.revenue ?? 0) >= dollars(100),
  },
  {
    id: 'profitable_day',
    name: 'A Day in the Black',
    icon: '📗',
    description: 'Close a full day with positive net profit (watch wages, maintenance, and interest).',
    reward: dollars(1500),
    check: (s) => {
      const hist = player(s)?.accounting.dailyHistory;
      return !!hist && hist.length > 0 && hist[hist.length - 1]!.netProfit > 0;
    },
  },
  {
    id: 'share_ten',
    name: 'Carve a Niche',
    icon: '📈',
    description: 'Win 10% market share in any product (undercut, out-advertise, or out-quality the AI).',
    reward: dollars(2000),
    check: (s) => {
      const p = player(s);
      if (!p) return false;
      return Object.values(p.marketShareByProduct).some((v) => v >= 0.1);
    },
  },
  {
    id: 'share_thirty',
    name: 'Serious Competitor',
    icon: '🥊',
    description: 'Win 30% market share in any product.',
    reward: dollars(3000),
    check: (s) => {
      const p = player(s);
      if (!p) return false;
      return Object.values(p.marketShareByProduct).some((v) => v >= 0.3);
    },
  },
  {
    id: 'first_export',
    name: 'Open the Trade Route',
    icon: '🚢',
    description: 'Export goods: build a warehouse, stage goods there via a contract, and hit Export in its inspector — it ships to the best-paying port.',
    reward: dollars(2500),
    check: (s) => (player(s)?.exportRevenue ?? 0) > 0,
  },
  {
    id: 'best_port_broker',
    name: 'Best-Port Broker',
    icon: '🚂',
    description: 'Earn $500 of export revenue from Ironvale, the industrial hub — it pays a premium for tools, minerals and finery (see the Gazette\'s Trade Desk for today\'s spreads).',
    reward: dollars(2000),
    check: (s) => ((player(s)?.exportRevenueByCity ?? {})['ironvale'] ?? 0) >= dollars(500),
  },
  {
    id: 'wage_leader',
    name: 'Wage Leader',
    icon: '🤝',
    description: 'Pay the town\'s best wage — set your base wage above every rival\'s (Wages card in your firm inspector) while employing at least one worker.',
    reward: dollars(1500),
    check: (s) => {
      const p = player(s);
      if (!p || p.employees.length === 0) return false;
      for (const fid in s.firms) {
        const f = s.firms[fid]!;
        if (f.id === p.id || (f.ownerType !== 'ai' && f.ownerType !== 'player')) continue;
        if (f.wagePolicy.baseWage >= p.wagePolicy.baseWage) return false;
      }
      return true;
    },
  },
  {
    id: 'morning_rush',
    name: 'Morning Rush',
    icon: '☕',
    description: 'Serve the town coffee: carry it in one of your stores and make a sale (roast it yourself or buy from the importer).',
    reward: dollars(1500),
    check: (s) => {
      const p = player(s);
      if (!p) return false;
      const carries = p.facilities.some((fid) => s.facilities[fid]?.retailProductIds.includes('coffee'));
      return carries && (s.marketStats['coffee']?.unitsSoldByFirm[p.id] ?? 0) > 0;
    },
  },
  {
    id: 'landlord',
    name: 'Landlord',
    icon: '🏢',
    description: 'Build an Apartment and house a resident — rent collects daily, and new arrivals need somewhere to live.',
    reward: dollars(2000),
    check: (s) => {
      const p = player(s);
      if (!p) return false;
      return p.facilities.some((fid) => {
        const f = s.facilities[fid];
        return f?.defId === 'apartment' && f.residentIds.length >= 1;
      });
    },
  },
  {
    id: 'valuation_30k',
    name: 'On the Map',
    icon: '🏢',
    description: 'Grow your company valuation to $30,000 — the objective is in sight.',
    reward: dollars(5000),
    check: (s) => companyValuation(s, s.playerFirmId).valuation >= dollars(30000),
  },
];

const DEF_BY_ID: Record<string, MissionDef> = Object.fromEntries(
  MISSION_DEFS.map((d) => [d.id, d]),
);

export function getMissionDef(id: string): MissionDef | undefined {
  return DEF_BY_ID[id];
}

/** The first incomplete mission in the chain, or null when all are done. */
export function activeMission(state: GameState): MissionDef | null {
  const done = new Set(state.missions.map((m) => m.id));
  for (const def of MISSION_DEFS) {
    if (!done.has(def.id)) return def;
  }
  return null;
}
