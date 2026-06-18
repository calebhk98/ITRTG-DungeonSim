import type { SearchProblem, OptimizeOptions, ScoreTrace, Optimizer } from '../SearchProblem.js';

/**
 * Extension of `SearchProblem` for problems whose candidate space is small
 * enough to be fully enumerated. The `allCandidates()` method must return
 * every candidate in the search space exactly once.
 *
 * Use this when the search space is bounded and finite (e.g. farm-target
 * selection over a known dungeon list). Pair with `EnumerationOptimizer`.
 */
export interface EnumerableSearchProblem<C> extends SearchProblem<C> {
  /** Return an iterable over every candidate in the search space. */
  allCandidates(): Iterable<C>;
}

/** Type guard: does `problem` implement `EnumerableSearchProblem`? */
function isEnumerable<C>(problem: SearchProblem<C>): problem is EnumerableSearchProblem<C> {
  return typeof (problem as Partial<EnumerableSearchProblem<C>>).allCandidates === 'function';
}

/**
 * Brute-force optimizer for small, fully enumerable candidate spaces.
 *
 * Iterates through every candidate returned by `problem.allCandidates()`,
 * evaluates each, and returns the one with the highest score. Guarantees the
 * global optimum within the enumerated set.
 *
 * Stopping criteria:
 *   - All candidates have been evaluated, OR
 *   - `opts.maxIterations` evaluate() calls have been made, OR
 *   - `opts.timeLimitMs` has elapsed (checked after each evaluate()).
 *
 * Throws if `problem` does not implement `EnumerableSearchProblem`.
 */
export class EnumerationOptimizer implements Optimizer {
  run<C>(
    problem: SearchProblem<C>,
    opts: OptimizeOptions,
  ): { best: C; score: number; trace: ScoreTrace } {
    if (!isEnumerable(problem)) {
      throw new Error(
        'EnumerationOptimizer requires the problem to implement EnumerableSearchProblem ' +
          '(i.e. expose an allCandidates(): Iterable<C> method). ' +
          'Use GreedyOptimizer or BeamSearchOptimizer for non-enumerable problems.',
      );
    }

    const verbosity = opts.traceVerbosity ?? 'none';
    const traceInterval = opts.traceInterval ?? 1;
    const deadline = opts.timeLimitMs !== undefined ? Date.now() + opts.timeLimitMs : undefined;

    const trace: Array<{ iteration: number; bestScore: number }> = [];

    let best: C | undefined;
    let bestScore = -Infinity;
    let iteration = 0;

    for (const candidate of problem.allCandidates()) {
      if (iteration >= opts.maxIterations) break;
      if (deadline !== undefined && Date.now() >= deadline) break;

      const score = problem.evaluate(candidate);
      iteration += 1;

      if (score > bestScore) {
        bestScore = score;
        best = candidate;
      }

      if (verbosity === 'interval' && iteration % traceInterval === 0) {
        trace.push({ iteration, bestScore });
      }
    }

    if (best === undefined) {
      throw new Error(
        'EnumerationOptimizer: allCandidates() returned an empty iterable — ' +
          'cannot determine a best candidate.',
      );
    }

    if (verbosity === 'final' || verbosity === 'interval') {
      // Always record the final state (avoid duplicate if already recorded).
      const lastEntry = trace[trace.length - 1];
      if (lastEntry === undefined || lastEntry.iteration !== iteration) {
        trace.push({ iteration, bestScore });
      }
    }

    return { best, score: bestScore, trace };
  }
}
