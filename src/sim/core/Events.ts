/**
 * Events.ts — Game event log types.
 *
 * Events are human-readable notices surfaced in the UI event log and alerts.
 * They are bounded (trimmed by EventLogSystem). Severity drives styling and
 * filtering. Events are informational only — they never carry economic state.
 */

import type { EventId, EntityId } from './Id';

export type EventSeverity = 'info' | 'success' | 'warning' | 'danger';

export type EventCategory =
  | 'economy'
  | 'production'
  | 'retail'
  | 'payroll'
  | 'logistics'
  | 'finance'
  | 'player'
  | 'ai'
  | 'system';

export interface GameEvent {
  id: EventId;
  tick: number;
  day: number;
  severity: EventSeverity;
  category: EventCategory;
  message: string;
  /** Optional entity this event relates to (click-through in the UI). */
  entityId: EntityId | null;
}
