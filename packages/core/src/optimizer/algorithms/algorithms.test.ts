/**
 * Unit tests for the optimizer algorithms: Enumeration, Greedy, BeamSearch.
 *
 * All search problems are synthetic (no dependency on the sim or problem
 * adapters). The candidate type is a plain number or [number, number] tuple.
 */
import { describe, it, expect } from 'vitest';
import { mulberry32 } from '../../sim/rng.js';
import type { SearchProblem } from '../SearchProblem.js';
import type { EnumerableSearchProblem } from './enumeration.js';
import { EnumerationOptimizer } from './enumeration.js';
import { GreedyOptimizer } from './greedy.js';
import { BeamSearchOptimizer } from './beam.js';

// ─────────────────────────────────────────────────────────────────────────────
// Synthetic problems
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 1-D quadratic problem over integer domain [0, domainSize).
 * Score = -(x - peak)^2  → maximum is 0 at x === peak.
 */
function makeQuadraticProblem(
  domainSize: number,
  peak: number,
  startX = 0,
): EnumerableSearchProblem<number> {
  const sq = (n: number): number => n * n;
  return {
    initial: () => startX,
    neighbors: (x: number) => {
      const ns: number[] = [];
      if (x > 0) ns.push(x - 1);
      if (x < domainSize - 1) ns.push(x + 1);
      return ns;
    },
    randomCandidate: (rng) => rng.int(domainSize),
    evaluate: (x: number) => -sq(x - peak),
    allCandidates: function* () {
      for (let x = 0; x < domainSize; x++) yield x;
    },
  };
}

/**
 * 2-D "bumpy" problem: two local maxima with different heights.
 *
 *   score(x, y) = max(localA(x,y), localB(x,y))
 *
 * Layout (domain [0, 19] x [0, 19]):
 *   Local max A  at (2,  2)  score ~ 80   <- where initial() starts (trapped)
 *   Global max B at (15, 15) score ~ 100
 *
 * Single-start greedy from (0,0) climbs to A and gets stuck.
 * Beam / greedy-with-restarts finds B.
 */
type XY = readonly [number, number];

function makeBumpyProblem(): SearchProblem<XY> {
  const SIZE = 20;
  const sq = (n: number): number => n * n;

  const scoreAt = (x: number, y: number): number => {
    // Gaussian-like bumps.
    const distA = sq(x - 2) + sq(y - 2);
    const distB = sq(x - 15) + sq(y - 15);
    const a = 80 * Math.exp(-distA / 4);
    const b = 100 * Math.exp(-distB / 4);
    return Math.max(a, b);
  };

  return {
    initial: (): XY => [0, 0],
    neighbors: ([x, y]: XY): XY[] => {
      const ns: XY[] = [];
      if (x > 0) ns.push([x - 1, y]);
      if (x < SIZE - 1) ns.push([x + 1, y]);
      if (y > 0) ns.push([x, y - 1]);
      if (y < SIZE - 1) ns.push([x, y + 1]);
      return ns;
    },
    randomCandidate: (rng): XY => [rng.int(SIZE), rng.int(SIZE)],
    evaluate: ([x, y]: XY) => scoreAt(x, y),
  };
}

/** A SearchProblem WITHOUT allCandidates (non-enumerable). */
function makeNonEnumerableProblem(): SearchProblem<number> {
  return {
    initial: () => 0,
    neighbors: (x: number) => [x + 1],
    randomCandidate: (rng) => rng.int(100),
    evaluate: (x: number) => x,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// EnumerationOptimizer
// ─────────────────────────────────────────────────────────────────────────────
describe('EnumerationOptimizer', () => {
  it('finds the exact maximum of the 1-D quadratic (peak=7, domain=[0,15))', () => {
    const problem = makeQuadraticProblem(15, 7);
    const opt = new EnumerationOptimizer();
    const { best, score } = opt.run(problem, { maxIterations: 1000 });
    expect(best).toBe(7);
    expect(score).toBeCloseTo(0); // -(7-7)^2 = 0
  });

  it('respects maxIterations budget', () => {
    const problem = makeQuadraticProblem(15, 7);
    const opt = new EnumerationOptimizer();
    // Only allow 3 evaluations -- will only see candidates 0, 1, 2.
    const { best } = opt.run(problem, { maxIterations: 3 });
    // Best of {0,1,2} for -(x-7)^2 is x=2 (score -25), never reaches 7.
    expect([0, 1, 2]).toContain(best);
  });

  it('populates trace when traceVerbosity=interval', () => {
    const problem = makeQuadraticProblem(10, 5);
    const opt = new EnumerationOptimizer();
    const { trace } = opt.run(problem, {
      maxIterations: 100,
      traceVerbosity: 'interval',
      traceInterval: 2,
    });
    expect(trace.length).toBeGreaterThan(0);
    // All trace entries should have non-decreasing bestScore.
    for (let i = 1; i < trace.length; i++) {
      const prev = trace[i - 1];
      const curr = trace[i];
      if (prev !== undefined && curr !== undefined) {
        expect(curr.bestScore).toBeGreaterThanOrEqual(prev.bestScore);
      }
    }
  });

  it('populates trace with final entry when traceVerbosity=final', () => {
    const problem = makeQuadraticProblem(10, 5);
    const opt = new EnumerationOptimizer();
    const { trace, score } = opt.run(problem, {
      maxIterations: 100,
      traceVerbosity: 'final',
    });
    expect(trace.length).toBe(1);
    expect(trace[0]?.bestScore).toBe(score);
  });

  it('throws a clear error for non-enumerable problems', () => {
    const problem = makeNonEnumerableProblem();
    const opt = new EnumerationOptimizer();
    expect(() => opt.run(problem, { maxIterations: 100 })).toThrowError(
      /EnumerationOptimizer requires/,
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GreedyOptimizer
// ─────────────────────────────────────────────────────────────────────────────
describe('GreedyOptimizer', () => {
  it('climbs the 1-D quadratic from a poor start (x=0) to the peak (x=7)', () => {
    const rng = mulberry32(42);
    const problem = makeQuadraticProblem(15, 7, /* startX= */ 0);
    const opt = new GreedyOptimizer(rng);
    const { best, score } = opt.run(problem, { maxIterations: 200 });
    expect(best).toBe(7);
    expect(score).toBeCloseTo(0);
  });

  it('gets stuck at a local maximum in the bumpy 2-D problem (single restart)', () => {
    const rng = mulberry32(1);
    const problem = makeBumpyProblem();
    const opt = new GreedyOptimizer(rng);
    const { score } = opt.run(problem, { maxIterations: 500, restarts: 1 });
    // Single start from (0,0) must climb to local max A (score ~80).
    // It should NOT reach the global max B (score ~100).
    // Greedy with one restart from (0,0) is trapped in region of local max A.
    expect(score).toBeLessThan(100);
  });

  it('escapes local max with random restarts in the bumpy 2-D problem', () => {
    const rng = mulberry32(99);
    const problem = makeBumpyProblem();
    const opt = new GreedyOptimizer(rng);
    const { score } = opt.run(problem, { maxIterations: 2000, restarts: 10 });
    // With 10 restarts we expect to discover the global basin (score ~100).
    expect(score).toBeGreaterThan(90);
  });

  it('is deterministic: same seed -> same result', () => {
    const problem = makeBumpyProblem();

    const run1 = new GreedyOptimizer(mulberry32(7)).run(problem, {
      maxIterations: 500,
      restarts: 5,
    });
    const run2 = new GreedyOptimizer(mulberry32(7)).run(problem, {
      maxIterations: 500,
      restarts: 5,
    });

    expect(run1.score).toBe(run2.score);
    expect(run1.best).toEqual(run2.best);
  });

  it('records trace entries with traceVerbosity=interval', () => {
    const rng = mulberry32(3);
    const problem = makeQuadraticProblem(15, 7, 0);
    const opt = new GreedyOptimizer(rng);
    const { trace } = opt.run(problem, {
      maxIterations: 200,
      traceVerbosity: 'interval',
      traceInterval: 1,
    });
    expect(trace.length).toBeGreaterThan(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// BeamSearchOptimizer
// ─────────────────────────────────────────────────────────────────────────────
describe('BeamSearchOptimizer', () => {
  it('finds the peak of the 1-D quadratic', () => {
    const rng = mulberry32(42);
    const problem = makeQuadraticProblem(15, 7, 0);
    const opt = new BeamSearchOptimizer(rng);
    const { best, score } = opt.run(problem, {
      maxIterations: 500,
      beamWidth: 3,
    });
    expect(best).toBe(7);
    expect(score).toBeCloseTo(0);
  });

  it('finds the global maximum of the bumpy 2-D problem', () => {
    const rng = mulberry32(55);
    const problem = makeBumpyProblem();
    const opt = new BeamSearchOptimizer(rng);
    const { score } = opt.run(problem, {
      maxIterations: 2000,
      beamWidth: 8,
    });
    // Beam should escape the local max and find the global basin (score ~100).
    expect(score).toBeGreaterThan(90);
  });

  it('beam beats single-start greedy on the bumpy 2-D problem', () => {
    // Single-start greedy (no restarts).
    const greedyScore = new GreedyOptimizer(mulberry32(1)).run(makeBumpyProblem(), {
      maxIterations: 500,
      restarts: 1,
    }).score;

    // Beam with width=6.
    const beamScore = new BeamSearchOptimizer(mulberry32(55)).run(makeBumpyProblem(), {
      maxIterations: 500,
      beamWidth: 6,
    }).score;

    expect(beamScore).toBeGreaterThan(greedyScore);
  });

  it('is deterministic: same seed -> same result', () => {
    const problem = makeBumpyProblem();
    const run1 = new BeamSearchOptimizer(mulberry32(13)).run(problem, {
      maxIterations: 300,
      beamWidth: 4,
    });
    const run2 = new BeamSearchOptimizer(mulberry32(13)).run(problem, {
      maxIterations: 300,
      beamWidth: 4,
    });
    expect(run1.score).toBe(run2.score);
    expect(run1.best).toEqual(run2.best);
  });

  it('falls back to populationSize when beamWidth is absent', () => {
    const rng = mulberry32(1);
    const problem = makeQuadraticProblem(15, 7, 0);
    const opt = new BeamSearchOptimizer(rng);
    // Use populationSize instead of beamWidth.
    const { best } = opt.run(problem, { maxIterations: 500, populationSize: 4 });
    expect(best).toBe(7);
  });

  it('records trace when traceVerbosity=final', () => {
    const rng = mulberry32(2);
    const problem = makeQuadraticProblem(10, 5, 0);
    const opt = new BeamSearchOptimizer(rng);
    const { trace, score } = opt.run(problem, {
      maxIterations: 200,
      traceVerbosity: 'final',
      beamWidth: 3,
    });
    expect(trace.length).toBe(1);
    expect(trace[0]?.bestScore).toBe(score);
  });
});
