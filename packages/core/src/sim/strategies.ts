/**
 * WP-F: CombatStrategy implementations.
 *
 * Provides two concrete strategies that implement the `CombatStrategy` interface
 * (sim/strategy.ts):
 *
 *   - `DeterministicExpectedStrategy`: computes expected (fractional) actions and
 *     returns probabilities directly for EV-mode optimizer inner loops.
 *   - `MonteCarloStrategy`: samples from the speed→action probability table using
 *     a seeded RNG for accurate distribution estimation.
 *
 * Research §6.3 (speed → actions) and plan §"Sim strategy".
 */

import type { CombatStrategy } from './strategy.js';
import type { GameConstants } from '../constants/types.js';
import type { Rng } from './rng.js';
import { resolve } from '../constants/types.js';

// ── Shared helper ─────────────────────────────────────────────────────────────

/**
 * Derive the per-threshold probabilities from a speed value and constants.
 *
 * Returns `{ p2nd, p3rd }` where:
 *   p2nd = clamp(speed / threshold2ndAction, 0, 1)   — P(≥ 2 actions)
 *   p3rd = clamp((speed − threshold2ndAction) / threshold3rdAction, 0, 1)  — P(3 actions | ≥2 actions)
 *
 * Research §6.3:
 *   0–500 speed   → P(2nd) = speed/500           (100% at 500)
 *   501–1500 speed → P(3rd) = (speed−500)/1000   (100% at 1500)
 *   >1500         → hard cap: both probabilities are 1.0
 */
function speedProbabilities(
  speed: number,
  constants: GameConstants,
): { p2nd: number; p3rd: number } {
  const t2 = resolve(constants.speedThresholds.threshold2ndAction); // 500
  const t3 = resolve(constants.speedThresholds.threshold3rdAction); // 1000

  const p2nd = Math.min(1, Math.max(0, speed / t2));
  const p3rd = Math.min(1, Math.max(0, (speed - t2) / t3));

  return { p2nd, p3rd };
}

// ── DeterministicExpectedStrategy ─────────────────────────────────────────────

/**
 * Expected-value strategy for the optimizer inner loop.
 *
 * `actionsForSpeed` returns the EXPECTED (fractional) number of actions:
 *   E[actions] = 1 + p2nd + p3rd
 * where p2nd and p3rd are the per-threshold probabilities derived from speed
 * (research §6.3). The result is capped at `maxActionsPerRound` (3).
 *
 * `roll(p)` returns `p` directly (the probability), so damage weighted by
 * hit chance stays fractional rather than binary.
 *
 * Usage: pass to `resolveRound` for fast, noise-free optimization passes.
 */
export class DeterministicExpectedStrategy implements CombatStrategy {
  actionsForSpeed(speed: number, constants: GameConstants): number {
    const max = resolve(constants.speedThresholds.maxActionsPerRound); // 3
    const { p2nd, p3rd } = speedProbabilities(speed, constants);
    return Math.min(max, 1 + p2nd + p3rd);
  }

  roll(probability: number): number {
    return probability;
  }
}

// ── MonteCarloStrategy ────────────────────────────────────────────────────────

/**
 * Stochastic Monte Carlo strategy backed by a seeded RNG.
 *
 * `actionsForSpeed` samples the integer number of actions (1, 2, or 3) using the
 * per-threshold probabilities:
 *   - Always 1 action minimum.
 *   - Roll against p2nd: success → 2nd action.
 *   - If 2nd action, roll against p3rd: success → 3rd action.
 *
 * `roll(p)` returns `true` (1) if `rng.next() < p`, else `false` (0), making
 * each hit an independent Bernoulli trial.
 *
 * @param rng - Seeded RNG (use `mulberry32(seed)` for reproducible results).
 *
 * Usage: pass to `resolveRound` for accurate distribution estimation and when
 * you need per-run variance rather than expected values.
 */
export class MonteCarloStrategy implements CombatStrategy {
  private readonly rng: Rng;

  constructor(rng: Rng) {
    this.rng = rng;
  }

  actionsForSpeed(speed: number, constants: GameConstants): number {
    const { p2nd, p3rd } = speedProbabilities(speed, constants);

    let actions = 1;
    if (this.rng.next() < p2nd) {
      actions = 2;
      if (this.rng.next() < p3rd) {
        actions = 3;
      }
    }
    return actions;
  }

  roll(probability: number): boolean {
    return this.rng.next() < probability;
  }
}
