import type { Rng } from '../sim/rng.js';

/**
 * A generic search problem interface that decouples optimizer algorithms from
 * the ITRTG simulation domain.
 *
 * Each dimension (team composition, gear allocation, farm-target selection,
 * progression planning) provides its own `SearchProblem<Candidate>` adapter.
 * Optimizer algorithms (enumeration, greedy+hill-climb, beam/genetic) each
 * implement `Optimizer<C>` and are unaware of what a "Candidate" actually is.
 *
 * Plan §"Optimizer" and §"Work-package breakdown" (WP-I, WP-J).
 *
 * @template Candidate - The representation of one possible solution (e.g.
 *   `Team` for team-composition, `EquipmentLoadout[]` for gear allocation).
 */
export interface SearchProblem<Candidate> {
  /**
   * Return the default starting candidate (e.g. current team, empty loadout).
   * Used as the starting point for hill-climbers and greedy searches.
   */
  initial(): Candidate;
  /**
   * Enumerate the neighbours of `c`: candidates reachable by a single small
   * change (e.g. swapping one pet, changing one gear slot).
   * May return an empty iterable if `c` is locally optimal.
   */
  neighbors(c: Candidate): Iterable<Candidate>;
  /**
   * Generate a uniformly random candidate using `rng`.
   * Used by population-based algorithms (genetic, beam initialisation).
   */
  randomCandidate(rng: Rng): Candidate;
  /**
   * Evaluate the quality of candidate `c`. Returns a scalar where HIGHER is
   * BETTER (consistent with `Objective.score`). This method runs the simulator
   * internally and applies the chosen objective.
   *
   * Computationally the most expensive call — the optimizer must minimise how
   * often it calls this.
   */
  evaluate(c: Candidate): number;
}

/**
 * Options for controlling an optimizer run.
 * Conservative defaults should be provided by the `Optimizer` implementation.
 */
export interface OptimizeOptions {
  /** Maximum number of `evaluate()` calls before stopping. */
  maxIterations: number;
  /**
   * Wall-clock time limit in milliseconds. The optimizer stops after the
   * NEXT iteration that finishes past this deadline (so it always returns a
   * valid result). Undefined = no time limit.
   */
  timeLimitMs?: number;
  /**
   * For population-based algorithms (beam/genetic): how many candidates to
   * keep in the working set at once. Larger = more thorough, slower.
   */
  populationSize?: number;
  /**
   * Trace verbosity:
   *   - 'none'     = no trace (default, fastest).
   *   - 'final'    = only the best score at the end.
   *   - 'interval' = score after every N iterations (N = traceInterval).
   */
  traceVerbosity?: 'none' | 'final' | 'interval';
  /** Interval (in iteration count) between trace entries when `traceVerbosity === 'interval'`. */
  traceInterval?: number;
}

/**
 * A record of how the optimizer's best score evolved over iterations.
 * Useful for plotting convergence and diagnosing premature termination.
 */
export type ScoreTrace = ReadonlyArray<{ iteration: number; bestScore: number }>;

/**
 * A generic optimizer algorithm. Implementations (WP-I) will cover:
 *   - Enumeration (brute-force for small spaces like farm-target selection).
 *   - Greedy + hill-climb (for gear allocation).
 *   - Beam search / genetic (for team composition).
 *   - Coordinate descent (joint 4-D optimizer, later phase).
 *
 * All implementations are stateless and re-entrant (no shared mutable state
 * between `run()` calls).
 */
export interface Optimizer {
  /**
   * Run the optimization. Returns the best candidate found, its score, and
   * the score trace (may be empty if `traceVerbosity === 'none'`).
   *
   * The optimizer may call `problem.evaluate()` up to `opts.maxIterations`
   * times; it MUST return before `opts.timeLimitMs` elapses if set.
   */
  run<C>(
    problem: SearchProblem<C>,
    opts: OptimizeOptions,
  ): { best: C; score: number; trace: ScoreTrace };
}
