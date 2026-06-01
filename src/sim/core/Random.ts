/**
 * Random.ts — Deterministic seeded pseudo-random number generator.
 *
 * Uses a 32-bit mulberry32-style generator. The entire generator state is a
 * single uint32 stored inside GameState (`rngState`). The Rng wrapper reads and
 * writes that field directly, so the generator state is always part of the
 * serialized game state and can never desync from the simulation.
 *
 * NEVER use Math.random() anywhere in the simulation. Use an Rng instance
 * obtained from the simulation context instead.
 */

/** Anything that holds a mutable rng state field. GameState satisfies this. */
export interface RngHost {
  rngState: number;
}

/** Hash a string/number seed into a 32-bit state (splitmix-style avalanche). */
export function seedToState(seed: number): number {
  let h = seed >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b);
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b);
  h = (h ^ (h >>> 16)) >>> 0;
  // Avoid a zero state which can be a weak starting point.
  return h === 0 ? 0x9e3779b9 : h;
}

export class Rng {
  constructor(private readonly host: RngHost) {}

  /** Advance the generator and return a uint32. */
  nextU32(): number {
    let t = (this.host.rngState + 0x6d2b79f5) >>> 0;
    this.host.rngState = t;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return (t ^ (t >>> 14)) >>> 0;
  }

  /** Float in [0, 1). */
  next(): number {
    return this.nextU32() / 4294967296;
  }

  /** Float in [min, max). */
  range(min: number, max: number): number {
    return min + this.next() * (max - min);
  }

  /** Integer in [min, max] inclusive. */
  int(min: number, max: number): number {
    if (max <= min) return min;
    return min + Math.floor(this.next() * (max - min + 1));
  }

  /** True with the given probability p in [0, 1]. */
  chance(p: number): boolean {
    return this.next() < p;
  }

  /** Pick a uniformly random element, or undefined for an empty array. */
  pick<T>(arr: readonly T[]): T | undefined {
    if (arr.length === 0) return undefined;
    return arr[this.int(0, arr.length - 1)];
  }

  /** Small symmetric jitter in [-amount, +amount). */
  jitter(amount: number): number {
    return this.range(-amount, amount);
  }
}
