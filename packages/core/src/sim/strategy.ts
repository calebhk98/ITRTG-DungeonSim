import type { GameConstants } from '../constants/types.js';

/**
 * Pluggable combat strategy abstraction.
 *
 * Two concrete implementations will be provided in WP-F:
 *   - `DeterministicExpectedStrategy`: fractional actions, `roll(p) → p`
 *     (for the fast optimizer inner loop).
 *   - `MonteCarloStrategy(rng)`: samples actions, `roll(p) → rng.next() < p`
 *     (for accurate distribution estimation).
 *
 * The combat resolver (WP-F) takes a `CombatStrategy` and never calls
 * `Math.random()` directly, ensuring full determinism when needed.
 *
 * Research plan §"Sim strategy"; research §6.3 (speed → actions mechanic).
 */
export interface CombatStrategy {
  /**
   * Given a pet's Speed stat and the game constants, return the number of
   * actions that pet takes this round.
   *
   * For EV strategy: returns the EXPECTED number of actions (a float, e.g. 1.5).
   * For MC strategy: returns 1, 2, or 3 sampled from the probability table.
   *
   * Research §6.3 speed thresholds:
   *   speed ≤ 0      → 1 action
   *   1–500          → `(speed/5)%` chance of 2nd action
   *   501–1500       → `((speed-500)/10)%` chance of 3rd action
   *   > 1500         → capped at 3
   */
  actionsForSpeed(speed: number, constants: GameConstants): number;
  /**
   * Evaluate a probability outcome.
   *
   * For EV strategy: returns the probability itself (a float in [0, 1]).
   * For MC strategy: returns 1 if `rng.next() < probability`, else 0.
   *
   * Used for hit-chance rolls, ability triggers, and drop-rate checks.
   *
   * @param probability - The probability of a "success" outcome in [0, 1].
   * @returns A boolean-ish value: `true`/`1` = success, `false`/`0` = miss,
   *          or a fractional float in EV mode.
   */
  roll(probability: number): boolean | number;
}
