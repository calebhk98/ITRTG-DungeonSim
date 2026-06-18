/**
 * Tests for the multi-team roster-partition optimizer dimension (multiTeam.ts).
 *
 * Uses a small SYNTHETIC dungeon + roster (no content/ dependency), mirroring
 * sim/run.test.ts conventions.
 */

import { describe, it, expect } from 'vitest';
import type { Dungeon } from '../../domain/dungeon.js';
import type { EnemyArchetype } from '../../domain/enemy.js';
import type { Pet } from '../../domain/pet.js';
import type { PetId } from '../../domain/ids.js';
import { asPetId } from '../../domain/ids.js';
import { DEFAULT_CONSTANTS } from '../../constants/gameConstants.js';
import { xpPerHour } from '../../objectives/builtins.js';
import { mulberry32 } from '../../sim/rng.js';
import { GreedyOptimizer } from '../algorithms/greedy.js';
import {
  makeMultiTeamProblem,
  summarizeMultiTeamPlan,
  REJECTION_SCORE,
} from './multiTeam.js';
import type { MultiTeamInputs, MultiTeamPlan } from './multiTeam.js';

// ── Synthetic content ──────────────────────────────────────────────────────────

const goblin: EnemyArchetype = {
  id: 'goblin',
  baseStats: { hp: 10, atk: 1, def: 0, spd: 10 },
  element: 'Neutral',
  scaling: { kind: 'linear', perDiff: {} },
  isBoss: false,
  xpValue: 5,
};

const dungeon: Dungeon = {
  id: 'Scrapyard',
  element: 'Neutral',
  enemyTable: {
    1: { drawsPerRoom: 1, entries: [{ enemyId: 'goblin', weight: 1, minCount: 1, maxCount: 1 }] },
  },
  bossArchetypeId: {},
  archetypes: { goblin },
};

/** A second dungeon (different element/id) for multi-dungeon tests. */
const forestDungeon: Dungeon = {
  id: 'Forest',
  element: 'Earth',
  enemyTable: {
    1: { drawsPerRoom: 1, entries: [{ enemyId: 'goblin', weight: 1, minCount: 1, maxCount: 1 }] },
  },
  bossArchetypeId: {},
  archetypes: { goblin },
};

function makePet(id: string): Pet {
  return {
    id: asPetId(id),
    displayName: id,
    primaryElement: 'Neutral',
    dungeonLevel: 50,
    classLevel: 0,
    evolvedClass: null,
    totalGrowth: 100_000,
    growthRequiredForEvolution: 50_000,
    trainingPhysical: 0,
    trainingMystic: 0,
    trainingBattle: 0,
    equipment: {},
    abilities: [],
    source: { importerId: 'test', importerVersion: 1 },
  };
}

const roster: ReadonlyMap<PetId, Pet> = new Map(
  Array.from({ length: 12 }, (_, i) => makePet(`pet-${i}`)).map(p => [p.id, p]),
);

// Two distinct dungeons so a teamCount of 2 can field 2 teams (one per dungeon).
const baseInputs: MultiTeamInputs = {
  roster,
  dungeons: [dungeon, forestDungeon],
  objective: xpPerHour,
  constants: DEFAULT_CONSTANTS,
  teamCount: 2,
  maxTeamSize: 6,
  depthChoices: [1],
  difficultyChoices: [0],
  roomChoices: [3], // < room 6, so no boss room to resolve
};

// ── Tests ───────────────────────────────────────────────────────────────────

describe('makeMultiTeamProblem — partitioning', () => {
  it('initial() spreads all pets across teams disjointly, using more than 6', () => {
    const problem = makeMultiTeamProblem(baseInputs);
    const plan = problem.initial();

    const seen = new Set<PetId>();
    let totalSlots = 0;
    for (const tp of plan.teams) {
      expect(tp.team.slots.length).toBeLessThanOrEqual(6);
      const front = tp.team.slots.filter(s => s.row === 'front').length;
      const back = tp.team.slots.filter(s => s.row === 'back').length;
      expect(front).toBeLessThanOrEqual(3);
      expect(back).toBeLessThanOrEqual(3);
      for (const s of tp.team.slots) {
        expect(seen.has(s.petId)).toBe(false); // disjoint
        seen.add(s.petId);
        totalSlots++;
      }
    }
    // 2 teams × 6 = 12 pets — more than a single 6-pet team could ever use.
    expect(totalSlots).toBe(12);
    // One team per dungeon: the two teams run different dungeons.
    const dungeonsUsed = new Set(plan.teams.map(t => t.dungeonId));
    expect(dungeonsUsed.size).toBe(plan.teams.length);
  });

  it('rejects a plan where a pet appears on two teams', () => {
    const problem = makeMultiTeamProblem(baseInputs);
    const dup = asPetId('pet-0');
    // Different dungeons (so the rejection is specifically the duplicate pet).
    const bad: MultiTeamPlan = {
      teams: [
        { team: { slots: [{ petId: dup, row: 'front', assignedClass: 'Adventurer' }] }, dungeonId: 'Scrapyard', depth: 1, difficulty: 0, rooms: 3 },
        { team: { slots: [{ petId: dup, row: 'front', assignedClass: 'Adventurer' }] }, dungeonId: 'Forest', depth: 1, difficulty: 0, rooms: 3 },
      ],
    };
    expect(problem.evaluate(bad)).toBe(REJECTION_SCORE);
  });

  it('rejects two non-empty teams in the same dungeon (one team per dungeon)', () => {
    const problem = makeMultiTeamProblem(baseInputs);
    const bad: MultiTeamPlan = {
      teams: [
        { team: { slots: [{ petId: asPetId('pet-0'), row: 'front', assignedClass: 'Adventurer' }] }, dungeonId: 'Scrapyard', depth: 1, difficulty: 0, rooms: 3 },
        { team: { slots: [{ petId: asPetId('pet-1'), row: 'front', assignedClass: 'Adventurer' }] }, dungeonId: 'Scrapyard', depth: 1, difficulty: 0, rooms: 3 },
      ],
    };
    expect(problem.evaluate(bad)).toBe(REJECTION_SCORE);
  });
});

describe('makeMultiTeamProblem — aggregate scoring', () => {
  it('evaluate sums the objective across teams (two teams ≈ 2× one team)', () => {
    const problem = makeMultiTeamProblem(baseInputs);

    const teamA = {
      team: {
        slots: [
          { petId: asPetId('pet-0'), row: 'front' as const, assignedClass: 'Adventurer' as const },
          { petId: asPetId('pet-1'), row: 'front' as const, assignedClass: 'Adventurer' as const },
        ],
      },
      dungeonId: 'Scrapyard' as const,
      depth: 1 as const,
      difficulty: 0 as const,
      rooms: 3,
    };
    const teamB = {
      team: {
        slots: [
          { petId: asPetId('pet-2'), row: 'front' as const, assignedClass: 'Adventurer' as const },
          { petId: asPetId('pet-3'), row: 'front' as const, assignedClass: 'Adventurer' as const },
        ],
      },
      dungeonId: 'Forest' as const, // distinct dungeon (one team per dungeon)
      depth: 1 as const,
      difficulty: 0 as const,
      rooms: 3,
    };

    const one = problem.evaluate({ teams: [teamA] });
    const two = problem.evaluate({ teams: [teamA, teamB] });

    expect(one).toBeGreaterThan(0);
    expect(two).toBeCloseTo(one * 2, 5);
  });

  it('an empty team contributes 0 (does not penalise the plan)', () => {
    const problem = makeMultiTeamProblem(baseInputs);
    const teamA = {
      team: { slots: [{ petId: asPetId('pet-0'), row: 'front' as const, assignedClass: 'Adventurer' as const }] },
      dungeonId: 'Scrapyard' as const,
      depth: 1 as const,
      difficulty: 0 as const,
      rooms: 3,
    };
    const empty = { team: { slots: [] }, dungeonId: 'Scrapyard' as const, depth: 1 as const, difficulty: 0 as const, rooms: 3 };

    const withEmpty = problem.evaluate({ teams: [teamA, empty] });
    const without = problem.evaluate({ teams: [teamA] });
    expect(withEmpty).toBeCloseTo(without, 5);
  });
});

describe('makeMultiTeamProblem — multiple dungeons', () => {
  const multiInputs: MultiTeamInputs = {
    roster,
    dungeons: [dungeon, forestDungeon],
    objective: xpPerHour,
    constants: DEFAULT_CONSTANTS,
    teamCount: 2,
    maxTeamSize: 6,
    depthChoices: [1],
    difficultyChoices: [0],
    roomChoices: [3],
  };

  it('initial() assigns teams across the candidate dungeons', () => {
    const problem = makeMultiTeamProblem(multiInputs);
    const plan = problem.initial();
    const used = new Set(plan.teams.map(t => t.dungeonId));
    // Round-robin over two dungeons → both appear.
    expect(used.has('Scrapyard')).toBe(true);
    expect(used.has('Forest')).toBe(true);
  });

  it('summarizeMultiTeamPlan reports each team under its own dungeon', () => {
    const problem = makeMultiTeamProblem(multiInputs);
    const plan = problem.initial();
    const summary = summarizeMultiTeamPlan(plan, multiInputs);
    for (const s of summary) {
      expect(['Scrapyard', 'Forest']).toContain(s.plan.dungeonId);
    }
  });

  it('rejects a team assigned to a dungeon outside the candidate set', () => {
    const problem = makeMultiTeamProblem(multiInputs);
    const bad: MultiTeamPlan = {
      teams: [
        {
          team: { slots: [{ petId: asPetId('pet-0'), row: 'front', assignedClass: 'Adventurer' }] },
          dungeonId: 'Volcano', // not in candidates
          depth: 1,
          difficulty: 0,
          rooms: 3,
        },
      ],
    };
    expect(problem.evaluate(bad)).toBe(REJECTION_SCORE);
  });

  it('greedy search over two dungeons stays valid and ≥ initial', () => {
    const problem = makeMultiTeamProblem(multiInputs);
    const initialScore = problem.evaluate(problem.initial());
    const res = new GreedyOptimizer(mulberry32(7)).run(problem, { maxIterations: 300 });
    expect(res.score).toBeGreaterThanOrEqual(initialScore);
    expect(res.score).toBeGreaterThan(REJECTION_SCORE);
  });
});

describe('makeMultiTeamProblem — greedy search', () => {
  it('greedy finds a partition at least as good as the initial one', () => {
    const problem = makeMultiTeamProblem(baseInputs);
    const initialScore = problem.evaluate(problem.initial());

    const res = new GreedyOptimizer(mulberry32(1)).run(problem, { maxIterations: 300 });
    expect(res.score).toBeGreaterThanOrEqual(initialScore);

    // The best plan stays valid (not a rejection).
    expect(res.score).toBeGreaterThan(REJECTION_SCORE);
  });

  it('summarizeMultiTeamPlan reports one entry per non-empty team', () => {
    const problem = makeMultiTeamProblem(baseInputs);
    const plan = problem.initial();
    const summary = summarizeMultiTeamPlan(plan, baseInputs);
    const nonEmpty = plan.teams.filter(t => t.team.slots.length > 0).length;
    expect(summary).toHaveLength(nonEmpty);
    for (const s of summary) {
      expect(s.result.roomsCleared).toBeGreaterThanOrEqual(0);
    }
  });
});
