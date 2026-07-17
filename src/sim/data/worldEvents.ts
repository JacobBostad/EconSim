/**
 * worldEvents.ts — Data-driven world events (booms, droughts, fads, ...).
 *
 * A world event is a temporary, town-wide modifier with a headline. Events are
 * rolled once per day by WorldEventSystem (deterministically, from the seeded
 * rng) and stored in `state.worldEvents` as {defId, startDay, endDay}. All
 * economic effects flow through the small pure helpers at the bottom of this
 * file, which the hot-path systems call:
 *
 *   worldProductionMult   ProductionSystem   (per facility type, e.g. drought)
 *   worldDemandMult       RetailDemandSystem (per product, e.g. a bread craze)
 *   worldSpendingMult     RetailDemandSystem (booms/recessions move budgets)
 *   worldTransportMult    LogisticsSystem    (fuel spikes / cheap shipping)
 *   worldImportMult       LogisticsSystem + importer purchases (tariffs)
 *
 * To add an event: append a def here. Nothing else needs to change.
 */

import type { GameState } from '../core/GameState';
import type { EventSeverity } from '../core/Events';
import type { ProductId } from '../core/Id';
import type { Facility } from '../entities/Facility';
import { ticksPerDay } from '../core/Tick';

export interface WorldEventEffects {
  /** Production efficiency multiplier by facility type (farm, mine, factory). */
  production?: Partial<Record<Facility['type'], number>>;
  /** Demand (preferred purchase quantity) multiplier by product. */
  demand?: Partial<Record<ProductId, number>>;
  /** Multiplier on what citizens are willing to pay (booms/recessions). */
  spending?: number;
  /** Multiplier on shipment transport costs. */
  transport?: number;
  /** Multiplier on the importer's price markup. */
  importMarkup?: number;
}

export interface WorldEventDef {
  id: string;
  name: string;
  /** Emoji shown in the news ticker and event log. */
  icon: string;
  /** One-line news headline shown when the event starts. */
  headline: string;
  /** Longer explanation (tooltip): what it does and how to respond. */
  description: string;
  severity: EventSeverity;
  /** Duration is rolled uniformly in [minDays, maxDays]. */
  minDays: number;
  maxDays: number;
  /** Relative likelihood among candidates when an event fires. */
  weight: number;
  /** Events in the same group never overlap (e.g. boom vs recession). */
  exclusiveGroup: string;
  /** Grace period: never fires before this in-game day. */
  earliestDay: number;
  effects: WorldEventEffects;
}

export const WORLD_EVENT_DEFS: WorldEventDef[] = [
  {
    id: 'boom',
    name: 'Economic Boom',
    icon: '📈',
    headline: 'Regional economy booms — shoppers are spending freely!',
    description:
      'Citizens will pay up to 25% more before balking at a price. A great window to raise prices or push premium goods.',
    severity: 'success',
    minDays: 5,
    maxDays: 10,
    weight: 10,
    exclusiveGroup: 'macro',
    earliestDay: 4,
    effects: { spending: 1.25 },
  },
  {
    id: 'recession',
    name: 'Recession',
    icon: '📉',
    headline: 'Recession bites — households tighten their belts.',
    description:
      'Citizens will pay about 25% less before walking away. Cut prices to keep volume, and watch your margins.',
    severity: 'warning',
    minDays: 5,
    maxDays: 10,
    weight: 10,
    exclusiveGroup: 'macro',
    earliestDay: 6,
    effects: { spending: 0.75 },
  },
  {
    id: 'drought',
    name: 'Drought',
    icon: '🌵',
    headline: 'Drought scorches the fields — farm output cut in half.',
    description:
      'Farms run at 50% efficiency. Grain gets scarce; importing grain or stockpiling ahead keeps bakeries running.',
    severity: 'warning',
    minDays: 4,
    maxDays: 8,
    weight: 8,
    exclusiveGroup: 'farm',
    earliestDay: 5,
    effects: { production: { farm: 0.5 } },
  },
  {
    id: 'bumper_harvest',
    name: 'Bumper Harvest',
    icon: '🌾',
    headline: 'Perfect weather — a bumper harvest floods the silos!',
    description:
      'Farms run at 160% efficiency. Cheap, plentiful grain — a good time to bake aggressively and undercut on bread.',
    severity: 'success',
    minDays: 4,
    maxDays: 8,
    weight: 8,
    exclusiveGroup: 'farm',
    earliestDay: 5,
    effects: { production: { farm: 1.6 } },
  },
  {
    id: 'mine_collapse',
    name: 'Mine Collapse',
    icon: '⛏️',
    headline: 'Tunnel collapse — mineral extraction badly disrupted.',
    description:
      'Mines run at 45% efficiency while crews dig out. Mineral supply tightens; tool makers may need imports.',
    severity: 'danger',
    minDays: 3,
    maxDays: 6,
    weight: 6,
    exclusiveGroup: 'mine',
    earliestDay: 7,
    effects: { production: { mine: 0.45 } },
  },
  {
    id: 'rich_vein',
    name: 'Rich Vein Struck',
    icon: '💎',
    headline: 'Miners strike a rich vein — extraction surges!',
    description:
      'Mines run at 160% efficiency. Minerals get cheap and plentiful — tool production can scale up.',
    severity: 'success',
    minDays: 4,
    maxDays: 8,
    weight: 6,
    exclusiveGroup: 'mine',
    earliestDay: 7,
    effects: { production: { mine: 1.6 } },
  },
  {
    id: 'bread_craze',
    name: 'Artisan Bread Craze',
    icon: '🥖',
    headline: 'An artisan bread craze sweeps the town!',
    description:
      'Citizens buy about 60% more bread per trip while it lasts. Stock your shelves deep and keep the ovens hot.',
    severity: 'info',
    minDays: 3,
    maxDays: 7,
    weight: 8,
    exclusiveGroup: 'fad',
    earliestDay: 4,
    effects: { demand: { bread: 1.6 } },
  },
  {
    id: 'diy_craze',
    name: 'DIY Renovation Craze',
    icon: '🔨',
    headline: 'Everyone is renovating — tool demand jumps!',
    description:
      'Citizens buy about 60% more tools per trip while it lasts. Keep hardware shelves stocked.',
    severity: 'info',
    minDays: 3,
    maxDays: 7,
    weight: 8,
    exclusiveGroup: 'fad',
    earliestDay: 4,
    effects: { demand: { tools: 1.6 } },
  },
  {
    id: 'fashion_week',
    name: 'Fashion Week',
    icon: '👗',
    headline: 'Fashion week fever — everyone wants a new outfit!',
    description:
      'Citizens buy about 60% more clothes per trip while it lasts. Stock the boutiques.',
    severity: 'info',
    minDays: 3,
    maxDays: 6,
    weight: 8,
    exclusiveGroup: 'fad',
    earliestDay: 4,
    effects: { demand: { clothes: 1.6 } },
  },
  {
    id: 'fuel_spike',
    name: 'Fuel Price Spike',
    icon: '⛽',
    headline: 'Fuel prices spike — shipping costs double.',
    description:
      'Every shipment costs about 2.2× normal transport. Short supply lines win; consider sourcing closer to home.',
    severity: 'warning',
    minDays: 4,
    maxDays: 8,
    weight: 7,
    exclusiveGroup: 'logistics',
    earliestDay: 6,
    effects: { transport: 2.2 },
  },
  {
    id: 'tariffs',
    name: 'Import Tariffs',
    icon: '🚢',
    headline: 'New tariffs slapped on imports — foreign goods cost more.',
    description:
      'Importer prices rise about 50%. Local sourcing becomes far more attractive while tariffs last.',
    severity: 'warning',
    minDays: 5,
    maxDays: 10,
    weight: 7,
    exclusiveGroup: 'trade',
    earliestDay: 8,
    effects: { importMarkup: 1.5 },
  },
];

const DEF_BY_ID: Record<string, WorldEventDef> = Object.fromEntries(
  WORLD_EVENT_DEFS.map((d) => [d.id, d]),
);

export function getWorldEventDef(id: string): WorldEventDef | undefined {
  return DEF_BY_ID[id];
}

/** Chance per day that a new world event starts (when below the cap). */
export const WORLD_EVENT_DAILY_CHANCE = 0.2;
/** At most this many events are active at once. */
export const MAX_ACTIVE_WORLD_EVENTS = 2;

// ---------------------------------------------------------------------------
// Modifier helpers (pure, hot-path safe; active list is almost always 0-2)
// ---------------------------------------------------------------------------

export interface ActiveWorldEventView {
  def: WorldEventDef;
  startDay: number;
  endDay: number;
  daysRemaining: number;
}

/** Resolve the active events with their defs (unknown ids are skipped). */
export function activeWorldEvents(state: GameState): ActiveWorldEventView[] {
  const day = Math.floor(state.tick / ticksPerDay(state.config));
  const out: ActiveWorldEventView[] = [];
  for (const ev of state.worldEvents) {
    const def = DEF_BY_ID[ev.defId];
    if (!def || day >= ev.endDay) continue;
    out.push({ def, startDay: ev.startDay, endDay: ev.endDay, daysRemaining: ev.endDay - day });
  }
  return out;
}

export function worldProductionMult(state: GameState, facilityType: Facility['type']): number {
  let m = 1;
  for (const ev of state.worldEvents) {
    const f = DEF_BY_ID[ev.defId]?.effects.production?.[facilityType];
    if (f !== undefined) m *= f;
  }
  return m;
}

export function worldDemandMult(state: GameState, productId: ProductId): number {
  let m = 1;
  for (const ev of state.worldEvents) {
    const f = DEF_BY_ID[ev.defId]?.effects.demand?.[productId];
    if (f !== undefined) m *= f;
  }
  return m;
}

export function worldSpendingMult(state: GameState): number {
  let m = 1;
  for (const ev of state.worldEvents) {
    const f = DEF_BY_ID[ev.defId]?.effects.spending;
    if (f !== undefined) m *= f;
  }
  return m;
}

export function worldTransportMult(state: GameState): number {
  let m = 1;
  for (const ev of state.worldEvents) {
    const f = DEF_BY_ID[ev.defId]?.effects.transport;
    if (f !== undefined) m *= f;
  }
  return m;
}

export function worldImportMult(state: GameState): number {
  let m = 1;
  for (const ev of state.worldEvents) {
    const f = DEF_BY_ID[ev.defId]?.effects.importMarkup;
    if (f !== undefined) m *= f;
  }
  return m;
}
