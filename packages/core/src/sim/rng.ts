/**
 * Minimal RNG abstraction for the simulation engine.
 * Two implementations are provided here because they are tiny and needed by
 * every other sim module (combat resolver, run executor, optimizer inner loop).
 *
 * See plan §"Sim strategy": the EV strategy uses `ExpectedValueRng` for the fast
 * optimizer inner loop; Monte Carlo uses `mulberry32` (seeded) for accuracy.
 */

/**
 * The RNG interface consumed by the combat resolver and run executor.
 * Injected rather than ambient so callers can swap between deterministic EV
 * mode and seeded Monte Carlo mode without touching the sim logic.
 */
export interface Rng {
  /**
   * Returns a uniformly-distributed float in [0, 1).
   * Used for probability checks in the combat/damage pipeline.
   */
  next(): number;
  /**
   * Returns a uniformly-distributed integer in [0, maxExclusive).
   * Used for random choice draws (e.g. which enemy type, which target).
   */
  int(maxExclusive: number): number;
}

/**
 * A fast, deterministic, seedable pseudo-random number generator.
 * Algorithm: Mulberry32 (public domain, good statistical properties for simulation).
 *
 * @param seed - 32-bit unsigned integer seed. Same seed → identical sequence.
 */
export function mulberry32(seed: number): Rng {
  let s = seed >>> 0; // coerce to uint32
  return {
    next(): number {
      s += 0x6d2b79f5;
      let t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 0x100000000;
    },
    int(maxExclusive: number): number {
      return Math.floor(this.next() * maxExclusive);
    },
  };
}

/**
 * A deterministic "expected value" RNG used in the optimizer's inner loop.
 * Every probability check returns 0.5 and every integer draw returns the
 * midpoint, approximating the expected value of a random variable without
 * variance. This makes the optimizer fast and noise-free.
 *
 * Matches `EvaluationMode === 'expected'` in `RunConfig`.
 *
 * Research plan §"Sim strategy":
 *   `DeterministicExpectedStrategy`: fractional actions, `roll(p)=p`.
 */
export const ExpectedValueRng: Rng = {
  next(): number {
    return 0.5;
  },
  int(maxExclusive: number): number {
    return Math.floor(maxExclusive / 2);
  },
};
