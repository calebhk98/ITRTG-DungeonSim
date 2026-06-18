import type { Rng } from '../../sim/rng.js';
import type { SearchProblem, OptimizeOptions, ScoreTrace, Optimizer } from '../SearchProblem.js';

/**
 * Extended options for `BeamSearchOptimizer`. All extra fields are optional;
 * sensible defaults are applied when absent.
 */
export interface BeamOptions extends OptimizeOptions {
  /**
   * Number of candidates to keep in the beam (working set) at each iteration.
   * Falls back to `opts.populationSize` if this field is absent.
   * Default: 5.
   */
  beamWidth?: number;
}

/**
 * Beam search optimizer.
 *
 * Maintains a fixed-width "beam" (priority queue) of the best-scoring
 * candidates seen so far. Each iteration:
 *   1. Expand every candidate in the beam via `problem.neighbors()`.
 *   2. Evaluate all new neighbors.
 *   3. Merge neighbors with the current beam candidates.
 *   4. Keep only the top-K (beam width) by score.
 *
 * The beam is seeded with `problem.initial()` plus additional
 * `problem.randomCandidate(rng)` draws if `beamWidth > 1`.
 *
 * Stopping criteria:
 *   - No beam member improves between iterations (convergence), OR
 *   - `opts.maxIterations` total evaluate() calls have been made, OR
 *   - `opts.timeLimitMs` has elapsed (checked after each evaluate()).
 *
 * Returns the candidate with the highest score ever seen across all iterations.
 */
export class BeamSearchOptimizer implements Optimizer {
  private readonly rng: Rng;

  constructor(rng: Rng) {
    this.rng = rng;
  }

  run<C>(
    problem: SearchProblem<C>,
    opts: BeamOptions,
  ): { best: C; score: number; trace: ScoreTrace } {
    const beamWidth = opts.beamWidth ?? opts.populationSize ?? 5;
    const verbosity = opts.traceVerbosity ?? 'none';
    const traceInterval = opts.traceInterval ?? 1;
    const deadline = opts.timeLimitMs !== undefined ? Date.now() + opts.timeLimitMs : undefined;

    const trace: Array<{ iteration: number; bestScore: number }> = [];
    let totalIterations = 0;

    /** Scored entry in the beam. */
    type ScoredCandidate = { candidate: C; score: number };

    const evaluate = (candidate: C): ScoredCandidate => {
      const score = problem.evaluate(candidate);
      totalIterations += 1;
      return { candidate, score };
    };

    const maybeTrace = (score: number): void => {
      if (verbosity === 'interval' && totalIterations % traceInterval === 0) {
        trace.push({ iteration: totalIterations, bestScore: score });
      }
    };

    // ── Initialise beam ──────────────────────────────────────────────────────
    const beam: ScoredCandidate[] = [];

    // Always start with initial().
    if (totalIterations < opts.maxIterations) {
      const scored = evaluate(problem.initial());
      beam.push(scored);
      maybeTrace(scored.score);
    }

    // Fill remaining beam slots with random candidates.
    for (let i = 1; i < beamWidth; i++) {
      if (totalIterations >= opts.maxIterations) break;
      if (deadline !== undefined && Date.now() >= deadline) break;

      const scored = evaluate(problem.randomCandidate(this.rng));
      beam.push(scored);
      maybeTrace(beam[0]?.score ?? scored.score);
    }

    // Sort beam descending by score.
    beam.sort((a, b) => b.score - a.score);

    let globalBest: ScoredCandidate = beam[0] ?? { candidate: problem.initial(), score: -Infinity };

    // ── Main loop ─────────────────────────────────────────────────────────────
    let converged = false;
    let iterationCount = 0;

    while (!converged) {
      if (totalIterations >= opts.maxIterations) break;
      if (deadline !== undefined && Date.now() >= deadline) break;

      iterationCount += 1;
      const prevBestScore = globalBest.score;

      // Expand all beam members.
      const candidates: ScoredCandidate[] = [...beam];

      for (const { candidate } of beam) {
        for (const neighbor of problem.neighbors(candidate)) {
          if (totalIterations >= opts.maxIterations) break;
          if (deadline !== undefined && Date.now() >= deadline) break;

          const scored = evaluate(neighbor);
          candidates.push(scored);

          if (scored.score > globalBest.score) {
            globalBest = scored;
          }

          maybeTrace(globalBest.score);
        }

        if (totalIterations >= opts.maxIterations) break;
        if (deadline !== undefined && Date.now() >= deadline) break;
      }

      // Keep top-K.
      candidates.sort((a, b) => b.score - a.score);
      beam.length = 0;
      for (let i = 0; i < beamWidth && i < candidates.length; i++) {
        const entry = candidates[i];
        if (entry !== undefined) beam.push(entry);
      }

      // Update global best from beam top (already tracked above, but ensure sync).
      const beamTop = beam[0];
      if (beamTop !== undefined && beamTop.score > globalBest.score) {
        globalBest = beamTop;
      }

      // Convergence: no improvement this iteration.
      if (globalBest.score <= prevBestScore) {
        converged = true;
      }

      void iterationCount; // suppress unused warning
    }

    if (verbosity === 'final' || verbosity === 'interval') {
      const lastEntry = trace[trace.length - 1];
      if (lastEntry === undefined || lastEntry.iteration !== totalIterations) {
        trace.push({ iteration: totalIterations, bestScore: globalBest.score });
      }
    }

    return {
      best: globalBest.candidate,
      score: globalBest.score,
      trace,
    };
  }
}
