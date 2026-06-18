import type { Rng } from '../../sim/rng.js';
import type { SearchProblem, OptimizeOptions, ScoreTrace, Optimizer } from '../SearchProblem.js';

/**
 * Extended options for `GreedyOptimizer`. All extra fields are optional;
 * when absent, sensible defaults are used and the optimizer falls back to
 * standard `OptimizeOptions` behaviour.
 */
export interface GreedyOptions extends OptimizeOptions {
  /**
   * Number of random-restart attempts. Each restart begins from a fresh
   * `problem.randomCandidate(rng)` start point. The first run always starts
   * from `problem.initial()`. Total evaluate() budget is shared across all
   * restarts.
   *
   * Default: 1 (no restarts — single run from initial()).
   */
  restarts?: number;
}

/**
 * Greedy hill-climber (steepest-ascent local search) with optional random
 * restarts.
 *
 * Algorithm per run:
 *   1. Start from `problem.initial()` (first run) or `problem.randomCandidate(rng)`
 *      (subsequent restarts).
 *   2. Evaluate all neighbors of the current candidate.
 *   3. Move to the best-scoring neighbor if it strictly improves the score.
 *   4. Repeat until no neighbor improves or the iteration budget is exhausted.
 *
 * Stopping criteria (shared budget across all restarts):
 *   - No neighbor improves the current candidate (local optimum), OR
 *   - `opts.maxIterations` total evaluate() calls have been made, OR
 *   - `opts.timeLimitMs` has elapsed (checked after each evaluate()).
 *
 * Returns the globally best candidate found across all restarts.
 *
 * Requires an `Rng` instance when `restarts > 1`.
 */
export class GreedyOptimizer implements Optimizer {
  private readonly rng: Rng;

  constructor(rng: Rng) {
    this.rng = rng;
  }

  run<C>(
    problem: SearchProblem<C>,
    opts: GreedyOptions,
  ): { best: C; score: number; trace: ScoreTrace } {
    const restarts = opts.restarts ?? 1;
    const verbosity = opts.traceVerbosity ?? 'none';
    const traceInterval = opts.traceInterval ?? 1;
    const deadline = opts.timeLimitMs !== undefined ? Date.now() + opts.timeLimitMs : undefined;

    const trace: Array<{ iteration: number; bestScore: number }> = [];

    let globalBest: C = problem.initial();
    let globalBestScore = problem.evaluate(globalBest);
    let totalIterations = 1; // counted the evaluate() above

    const maybeTrace = (iter: number, score: number): void => {
      if (verbosity === 'interval' && iter % traceInterval === 0) {
        trace.push({ iteration: iter, bestScore: score });
      }
    };

    maybeTrace(totalIterations, globalBestScore);

    for (let restart = 0; restart < restarts; restart++) {
      if (totalIterations >= opts.maxIterations) break;
      if (deadline !== undefined && Date.now() >= deadline) break;

      // First restart uses initial(); subsequent ones use randomCandidate.
      let current: C;
      let currentScore: number;

      if (restart === 0) {
        current = globalBest;
        currentScore = globalBestScore;
      } else {
        current = problem.randomCandidate(this.rng);
        if (totalIterations >= opts.maxIterations) break;
        currentScore = problem.evaluate(current);
        totalIterations += 1;
        maybeTrace(totalIterations, Math.max(currentScore, globalBestScore));

        if (currentScore > globalBestScore) {
          globalBest = current;
          globalBestScore = currentScore;
        }
      }

      // Hill-climb from current.
      let improved = true;
      while (improved) {
        if (totalIterations >= opts.maxIterations) break;
        if (deadline !== undefined && Date.now() >= deadline) break;

        improved = false;
        let bestNeighbor: C = current;
        let bestNeighborScore = currentScore;

        for (const neighbor of problem.neighbors(current)) {
          if (totalIterations >= opts.maxIterations) break;
          if (deadline !== undefined && Date.now() >= deadline) break;

          const neighborScore = problem.evaluate(neighbor);
          totalIterations += 1;

          if (neighborScore > bestNeighborScore) {
            bestNeighborScore = neighborScore;
            bestNeighbor = neighbor;
          }

          maybeTrace(totalIterations, Math.max(bestNeighborScore, globalBestScore));
        }

        if (bestNeighborScore > currentScore) {
          current = bestNeighbor;
          currentScore = bestNeighborScore;
          improved = true;

          if (currentScore > globalBestScore) {
            globalBest = current;
            globalBestScore = currentScore;
          }
        }
      }

      if (currentScore > globalBestScore) {
        globalBest = current;
        globalBestScore = currentScore;
      }
    }

    if (verbosity === 'final' || verbosity === 'interval') {
      const lastEntry = trace[trace.length - 1];
      if (lastEntry === undefined || lastEntry.iteration !== totalIterations) {
        trace.push({ iteration: totalIterations, bestScore: globalBestScore });
      }
    }

    return { best: globalBest, score: globalBestScore, trace };
  }
}
