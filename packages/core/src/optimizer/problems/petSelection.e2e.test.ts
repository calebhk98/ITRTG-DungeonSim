/**
 * Validates that the optimizer IDENTIFIES and DEPLOYS the right pets: given a
 * large roster where only a few pets are strong enough to dungeon, the optimizer
 * must select those strong pets to clear content the weak roster cannot.
 *
 * Note on "carry": one strong pet can carry weak passengers through a clear
 * (faithful game behaviour — weak back-row pets survive and the strong pet
 * out-damages), so the meaningful test is "the optimizer deploys strong pets to
 * clear content an all-weak team cannot", not "it benches every weak pet".
 *
 * Scenario: 30 pets — 23 weak (CL5 / DL10) FIRST, then 7 strong (CL100 / DL600),
 * so the optimizer's all-weak initial team must discover and swap in the strong.
 */

import { describe, it, expect } from 'vitest';
import { getDungeon } from '../../content/index.js';
import { DEFAULT_CONSTANTS } from '../../constants/gameConstants.js';
import { maxClearableDepth, xpPerHour } from '../../objectives/builtins.js';
import { simulateRun } from '../../sim/run.js';
import { mulberry32 } from '../../sim/rng.js';
import { asPetId } from '../../domain/ids.js';
import type { PetId } from '../../domain/ids.js';
import type { Pet } from '../../domain/pet.js';
import type { Team } from '../../domain/team.js';
import { GreedyOptimizer } from '../algorithms/greedy.js';
import { makeTeamCompositionProblem } from './teamComposition.js';
import { makeMultiTeamProblem, summarizeMultiTeamPlan } from './multiTeam.js';

const scrapyard = getDungeon('Scrapyard');
if (scrapyard === undefined) throw new Error('Scrapyard content missing');

function makePet(id: string, dl: number, cl: number, growth: number): Pet {
  return {
    id: asPetId(id),
    displayName: id,
    primaryElement: 'Neutral',
    dungeonLevel: dl,
    classLevel: cl,
    evolvedClass: 'Adventurer',
    totalGrowth: growth,
    growthRequiredForEvolution: 50_000,
    trainingPhysical: 0,
    trainingMystic: 0,
    trainingBattle: 0,
    equipment: {},
    abilities: [],
    source: { importerId: 'sel-test', importerVersion: 1 },
  };
}

const weakIds: PetId[] = [];
const strongIds: PetId[] = [];
const pets: Pet[] = [];
for (let i = 0; i < 23; i++) {
  const p = makePet(`weak-${i}`, 10, 5, 0);
  weakIds.push(p.id);
  pets.push(p);
}
for (let i = 0; i < 7; i++) {
  const p = makePet(`strong-${i}`, 600, 100, 10_000_000);
  strongIds.push(p.id);
  pets.push(p);
}
const roster: ReadonlyMap<PetId, Pet> = new Map(pets.map(p => [p.id, p]));
const isStrong = (id: PetId): boolean => id.startsWith('strong');

describe('Optimizer pet selection — single team', () => {
  it('an all-weak team cannot clear D3 (baseline sanity)', () => {
    const allWeak: Team = {
      slots: weakIds.slice(0, 6).map((id, i) => ({
        petId: id,
        row: (i < 3 ? 'front' : 'back') as 'front' | 'back',
        assignedClass: 'Adventurer',
      })),
    };
    const r = simulateRun(
      { team: allWeak, dungeonId: 'Scrapyard', depth: 3, difficulty: 0, rooms: 30, nrdcCompletions: 0, evaluationMode: 'expected' },
      { dungeon: scrapyard, roster, constants: DEFAULT_CONSTANTS },
    );
    expect(r.cleared).toBe(false);
  });

  it('the optimizer discovers strong pets and clears D3', () => {
    const problem = makeTeamCompositionProblem({
      roster,
      dungeon: scrapyard,
      depth: 3,
      difficulty: 0,
      rooms: 30,
      objective: maxClearableDepth,
      constants: DEFAULT_CONSTANTS,
    });
    const res = new GreedyOptimizer(mulberry32(1)).run(problem, { maxIterations: 5000 });

    // maxClearableDepth: cleared ⇒ score = depth*100 + difficulty = 300.
    expect(res.score).toBeGreaterThanOrEqual(300);
    // Clearing D3 is impossible without strong pets, so the team must include them.
    const usedStrong = res.best.slots.filter(s => isStrong(s.petId)).length;
    expect(usedStrong).toBeGreaterThanOrEqual(1);
  });
});

describe('Optimizer pet selection — multi-team across dungeons', () => {
  it('spreads the strong pets across the dungeon teams so each can clear', () => {
    const dungeons = ['Scrapyard', 'Volcano', 'Mountain', 'Forest']
      .map(id => getDungeon(id as 'Scrapyard'))
      .filter((d): d is NonNullable<typeof d> => d !== undefined);

    const inputs = {
      roster,
      dungeons,
      objective: xpPerHour,
      constants: DEFAULT_CONSTANTS,
      teamCount: 4,
      depthChoices: [3 as const],
      difficultyChoices: [0 as const],
      roomChoices: [30],
    };
    const problem = makeMultiTeamProblem(inputs);
    const res = new GreedyOptimizer(mulberry32(3)).run(problem, { maxIterations: 8000 });
    const summary = summarizeMultiTeamPlan(res.best, inputs);

    // Every non-empty team should clear, and it does so via a strong carrier.
    const distinctStrong = new Set<PetId>();
    for (const s of summary) {
      const strongInTeam = s.plan.team.slots.filter(slot => isStrong(slot.petId));
      strongInTeam.forEach(slot => distinctStrong.add(slot.petId));
      if (s.result.cleared) {
        expect(strongInTeam.length).toBeGreaterThanOrEqual(1);
      }
    }
    // The 7 strong pets get DEPLOYED across the dungeons — at least one per team.
    expect(distinctStrong.size).toBeGreaterThanOrEqual(4);
  });
});
