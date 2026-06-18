/**
 * End-to-end optimizer integration test.
 *
 * Exercises the FULL assembled stack on real game content:
 *   content (getDungeon) → SearchProblem adapter (farm-target / team-composition)
 *   → Optimizer algorithm (enumeration / greedy / beam) → simulateRun → Objective.
 *
 * The per-piece unit tests use synthetic fixtures; this test proves the real
 * wiring works together and that optimization actually improves on a baseline.
 */

import { describe, it, expect } from 'vitest';
import { getDungeon } from '../content/index.js';
import { asPetId } from '../domain/ids.js';
import type { PetId } from '../domain/ids.js';
import type { Pet } from '../domain/pet.js';
import type { Team } from '../domain/team.js';
import { DEFAULT_CONSTANTS } from '../constants/gameConstants.js';
import { mulberry32 } from '../sim/rng.js';
import { maxClearableDepth, survivalRate } from '../objectives/builtins.js';
import { makeFarmTargetProblem } from './problems/farmTarget.js';
import { makeTeamCompositionProblem } from './problems/teamComposition.js';
import { EnumerationOptimizer } from './algorithms/enumeration.js';
import { GreedyOptimizer } from './algorithms/greedy.js';
import { BeamSearchOptimizer } from './algorithms/beam.js';

const scrapyard = getDungeon('Scrapyard');
if (scrapyard === undefined) throw new Error('Scrapyard not in registry');

function makePet(id: PetId, dl: number, growth: number): Pet {
  return {
    id,
    displayName: id,
    primaryElement: 'Neutral',
    dungeonLevel: dl,
    classLevel: 0,
    evolvedClass: null,
    totalGrowth: growth,
    growthRequiredForEvolution: 50_000,
    trainingPhysical: 0,
    trainingMystic: 0,
    trainingBattle: 0,
    equipment: {},
    abilities: [],
    source: { importerId: 'opt-e2e', importerVersion: 1 },
  };
}

// A roster mixing strong and weak pets so selection matters.
const strongA = asPetId('strong-a');
const strongB = asPetId('strong-b');
const weakA = asPetId('weak-a');
const weakB = asPetId('weak-b');
const roster: ReadonlyMap<PetId, Pet> = new Map([
  [strongA, makePet(strongA, 80, 200_000)],
  [strongB, makePet(strongB, 80, 200_000)],
  [weakA, makePet(weakA, 1, 0)],
  [weakB, makePet(weakB, 1, 0)],
]);

describe('E2E optimize: farm-target enumeration on real Scrapyard', () => {
  it('enumeration finds the best (depth,difficulty,rooms) and beats the baseline', () => {
    const team: Team = {
      slots: [
        { petId: strongA, row: 'front', assignedClass: 'Adventurer' },
        { petId: strongB, row: 'front', assignedClass: 'Adventurer' },
      ],
    };
    const problem = makeFarmTargetProblem({
      team,
      dungeon: scrapyard,
      roster,
      objective: maxClearableDepth,
      constants: DEFAULT_CONSTANTS,
      depthChoices: [1, 2],
      difficultyChoices: [0, 2, 5],
      roomChoices: [6, 16],
    });

    const opt = new EnumerationOptimizer();
    const { best, score } = opt.run(problem, { maxIterations: 1000 });

    expect(Number.isFinite(score)).toBe(true);
    expect(best.depth).toBeGreaterThanOrEqual(1);
    // Enumeration is exhaustive: no candidate may score higher than the winner.
    let max = -Infinity;
    for (const c of problem.allCandidates()) max = Math.max(max, problem.evaluate(c));
    expect(score).toBeCloseTo(max, 6);
    // And the winner is at least as good as the default starting point.
    expect(score).toBeGreaterThanOrEqual(problem.evaluate(problem.initial()));
  });
});

describe('E2E optimize: team-composition search on real Scrapyard', () => {
  it('greedy picks a team at least as good as its starting team', () => {
    const problem = makeTeamCompositionProblem({
      roster,
      dungeon: scrapyard,
      depth: 1,
      difficulty: 0,
      rooms: 6,
      objective: survivalRate,
      constants: DEFAULT_CONSTANTS,
      evaluationMode: 'monteCarlo',
    });

    const startScore = problem.evaluate(problem.initial());
    const greedy = new GreedyOptimizer(mulberry32(1));
    const { best, score } = greedy.run(problem, { maxIterations: 200, restarts: 3 });

    expect(best.slots.length).toBeGreaterThan(0);
    expect(score).toBeGreaterThanOrEqual(startScore);
    // The chosen team should be valid (no duplicate pets, ≤3 per row).
    const ids = best.slots.map((s) => s.petId);
    expect(new Set(ids).size).toBe(ids.length);
    expect(best.slots.filter((s) => s.row === 'front').length).toBeLessThanOrEqual(3);
    expect(best.slots.filter((s) => s.row === 'back').length).toBeLessThanOrEqual(3);
  });

  it('beam search is deterministic for a fixed seed', () => {
    const make = () =>
      makeTeamCompositionProblem({
        roster,
        dungeon: scrapyard,
        depth: 1,
        difficulty: 0,
        rooms: 6,
        objective: maxClearableDepth,
        constants: DEFAULT_CONSTANTS,
      });
    const a = new BeamSearchOptimizer(mulberry32(7)).run(make(), {
      maxIterations: 30,
      beamWidth: 4,
    });
    const b = new BeamSearchOptimizer(mulberry32(7)).run(make(), {
      maxIterations: 30,
      beamWidth: 4,
    });
    expect(a.score).toBe(b.score);
  });
});
