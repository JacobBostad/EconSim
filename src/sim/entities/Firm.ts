/**
 * Firm.ts — Firm entity.
 *
 * Firms own facilities, employ citizens, set prices and wages, and keep books.
 * `ownerType` distinguishes the player firm, AI competitors, the external
 * importer, and the special "world" firm that owns homes and acts as the sink
 * for external costs (maintenance, utilities) so total money is conserved.
 */

import type { FirmId, FacilityId, CitizenId, ProductId } from '../core/Id';
import type { Accounting } from './Accounting';

export type FirmOwnerType = 'player' | 'ai' | 'external' | 'world';

export type BankruptcyStatus = 'healthy' | 'distressed' | 'insolvent';

export interface WagePolicy {
  /** Default wage in cents paid per payday, per employee. */
  baseWage: number;
}

/** Lightweight AI strategy memory used by AIStrategySystem. */
export interface FirmStrategy {
  kind: 'none' | 'bread' | 'tools' | 'retail';
  /** Per-product count of consecutive days the firm sold out (drives price up). */
  selloutStreak: Record<ProductId, number>;
  /** Per-product count of consecutive days of excess inventory (drives price down). */
  gluttStreak: Record<ProductId, number>;
  /** Consecutive days of negative operating profit. */
  lossStreak: number;
}

export function emptyStrategy(kind: FirmStrategy['kind']): FirmStrategy {
  return { kind, selloutStreak: {}, gluttStreak: {}, lossStreak: 0 };
}

export interface Firm {
  id: FirmId;
  name: string;
  ownerType: FirmOwnerType;
  cash: number; // cents
  facilities: FacilityId[];
  employees: CitizenId[];
  /** Retail price in cents per product this firm sets. */
  pricesByProduct: Record<ProductId, number>;
  wagePolicy: WagePolicy;
  accounting: Accounting;
  strategy: FirmStrategy;
  bankruptcyStatus: BankruptcyStatus;
  /** Consecutive days cash has been below zero. */
  daysInsolvent: number;
  marketShareByProduct: Record<ProductId, number>;
  createdAtTick: number;
}
