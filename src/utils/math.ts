/** Small math helpers used across sim and UI. */

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Round to a fixed number of decimal places. */
export function round(value: number, decimals = 0): number {
  const f = Math.pow(10, decimals);
  return Math.round(value * f) / f;
}

/** Safe division returning `fallback` when the denominator is ~0. */
export function safeDiv(num: number, den: number, fallback = 0): number {
  return Math.abs(den) < 1e-9 ? fallback : num / den;
}

export function sum(values: readonly number[]): number {
  let s = 0;
  for (const v of values) s += v;
  return s;
}

export function average(values: readonly number[]): number {
  return values.length === 0 ? 0 : sum(values) / values.length;
}
