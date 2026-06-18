/**
 * Tests for the FARM-TARGET optimization adapter (WP-J).
 *
 * Uses the real Scrapyard dungeon + hand-built roster + real objectives so that
 * the full pipeline (candidate → RunConfig → simulateRun → ObjectiveContext →
 * Objective.score) is exercised end-to-end with no mocking.
 */

import { describe, it, expect } from 'vitest';
import { getDungeon } from '../../content/index.js';
import { DEFAULT_CONSTANTS } from '../../constants/gameConstants.js';
import { asPetId } from '../../domain/ids.js';
import type { PetId } from '../../domain/ids.js';
import type { Pet } from '../../domain/pet.js';
import type { Team } from '../../domain/team.js';
import type { Depth, Difficulty } from '../../domain/dungeon.js';
import { maxClearableDepth, makeResourceYieldPerHour } from '../../objectives/builtins.js';
import { mulberry32 } from '../../sim/rng.js';
import { makeFarmTargetProblem } from './farmTarget.js';
import type { FarmTargetCandidate, FarmTargetInputs } from './farmTarget.js';

// ── Dungeon fixture ───────────────────────────────────────────────────────────

const scrapyardOrUndef = getDungeon('Scrapyard');
if (scrapyardOrUndef === undefined) {
  throw new Error('Scrapyard dungeon not found — check content/index.ts');
}
const SCRAPYARD = scrapyardOrUndef;

// ── Pet / roster factory ──────────────────────────────────────────────────────

function makePet(id: PetId, dungeonLevel: number): Pet {
  return {
    id,
    displayName: id,
    primaryElement: 'Neutral',
    dungeonLevel,
    classLevel: 0,
    evolvedClass: null,
    totalGrowth: 0,
    growthRequiredForEvolution: 50_000,
    trainingPhysical: 0,
    trainingMystic: 0,
    trainingBattle: 0,
    equipment: {},
    abilities: [],
    source: { importerId: 'farmTarget-test', importerVersion: 1 },
  };
}

// A moderately strong single-pet team (DL 30 can handle D1/D2 at low difficulty).
const STRONG_PET_ID = asPetId('farm-strong');
const STRONG_ROSTER: ReadonlyMap<PetId, Pet> = new Map([
  [STRONG_PET_ID, makePet(STRONG_PET_ID, 30)],
]);
const STRONG_TEAM: Team = {
  slots: [{ petId: STRONG_PET_ID, row: 'front', assignedClass: 'Adventurer' }],
};

// A very weak team that will wipe in higher-difficulty content.
const WEAK_PET_ID = asPetId('farm-weak');
const WEAK_ROSTER: ReadonlyMap<PetId, Pet> = new Map([
  [WEAK_PET_ID, makePet(WEAK_PET_ID, 1)],
]);
const WEAK_TEAM: Team = {
  slots: [{ petId: WEAK_PET_ID, row: 'front', assignedClass: 'Adventurer' }],
};

// ── Shared choice sets ────────────────────────────────────────────────────────

const DEPTH_CHOICES: readonly Depth[] = [1, 2, 3, 4];
const DIFFICULTY_CHOICES: readonly Difficulty[] = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
const ROOM_CHOICES: readonly number[] = [6, 16, 30, 48];

// ── 1. allCandidates() count ──────────────────────────────────────────────────

describe('allCandidates()', () => {
  it('yields depthChoices × difficultyChoices × roomChoices candidates with defaults', () => {
    const problem = makeFarmTargetProblem({
      team: STRONG_TEAM,
      dungeon: SCRAPYARD,
      roster: STRONG_ROSTER,
      objective: maxClearableDepth,
      constants: DEFAULT_CONSTANTS,
    });

    const count = [...problem.allCandidates()].length;
    // Defaults: 4 depths × 11 difficulties × 4 rooms = 176
    expect(count).toBe(4 * 11 * 4);
  });

  it('yields exactly depthChoices × difficultyChoices × roomChoices with custom choices', () => {
    const depthChoices: readonly Depth[] = [1, 2];
    const difficultyChoices: readonly Difficulty[] = [0, 5, 10];
    const roomChoices: readonly number[] = [6, 16];

    const problem = makeFarmTargetProblem({
      team: STRONG_TEAM,
      dungeon: SCRAPYARD,
      roster: STRONG_ROSTER,
      objective: maxClearableDepth,
      constants: DEFAULT_CONSTANTS,
      depthChoices,
      difficultyChoices,
      roomChoices,
    });

    const count = [...problem.allCandidates()].length;
    expect(count).toBe(2 * 3 * 2);
  });

  it('every candidate is within the configured choice sets', () => {
    const problem = makeFarmTargetProblem({
      team: STRONG_TEAM,
      dungeon: SCRAPYARD,
      roster: STRONG_ROSTER,
      objective: maxClearableDepth,
      constants: DEFAULT_CONSTANTS,
      depthChoices: DEPTH_CHOICES,
      difficultyChoices: DIFFICULTY_CHOICES,
      roomChoices: ROOM_CHOICES,
    });

    for (const c of problem.allCandidates()) {
      expect(DEPTH_CHOICES).toContain(c.depth);
      expect(DIFFICULTY_CHOICES).toContain(c.difficulty);
      expect(ROOM_CHOICES).toContain(c.rooms);
    }
  });
});

// ── 2. evaluate() — feasible candidate returns a finite score ─────────────────

describe('evaluate() — feasible candidates', () => {
  it('returns a finite score for a clearly feasible candidate (strong team, low diff)', () => {
    const problem = makeFarmTargetProblem({
      team: STRONG_TEAM,
      dungeon: SCRAPYARD,
      roster: STRONG_ROSTER,
      objective: maxClearableDepth,
      constants: DEFAULT_CONSTANTS,
    });

    const candidate: FarmTargetCandidate = { depth: 1, difficulty: 0, rooms: 6 };
    const score = problem.evaluate(candidate);
    expect(isFinite(score)).toBe(true);
    expect(score).toBeGreaterThan(0);
  });

  it('returns a finite score under resourceYieldPerHour for a cleared run', () => {
    // resourceYieldPerHour.feasible requires cleared === true.
    // A DL-30 pet vs D1 diff-0 short run should clear.
    const resourceObj = makeResourceYieldPerHour({ materialsTotal: 10 });
    const problem = makeFarmTargetProblem({
      team: STRONG_TEAM,
      dungeon: SCRAPYARD,
      roster: STRONG_ROSTER,
      objective: resourceObj,
      constants: DEFAULT_CONSTANTS,
    });

    const candidate: FarmTargetCandidate = { depth: 1, difficulty: 0, rooms: 6 };
    const score = problem.evaluate(candidate);
    expect(isFinite(score)).toBe(true);
  });
});

// ── 3. evaluate() — infeasible candidate returns rejection score ───────────────

describe('evaluate() — infeasible candidates', () => {
  it('returns -Infinity when a feasibility-checking objective rejects a wiped run', () => {
    // resourceYieldPerHour requires cleared === true.
    // A DL-1 pet vs D1 diff-10 6-room run: the pet will almost certainly wipe.
    const resourceObj = makeResourceYieldPerHour({ materialsTotal: 10 });
    const problem = makeFarmTargetProblem({
      team: WEAK_TEAM,
      dungeon: SCRAPYARD,
      roster: WEAK_ROSTER,
      objective: resourceObj,
      constants: DEFAULT_CONSTANTS,
    });

    // DL-1 pet vs difficulty-10: enemies are massively scaled up.
    // The pet will wipe → cleared === false → feasible() returns false → -Infinity.
    const candidate: FarmTargetCandidate = { depth: 1, difficulty: 10, rooms: 30 };
    const score = problem.evaluate(candidate);
    expect(score).toBe(-Infinity);
  });
});

// ── 4. Sanity: higher-clearing candidate scores higher under maxClearableDepth ─

describe('evaluate() — sanity ordering', () => {
  it('a candidate the strong team clears scores higher than one it cannot clear', () => {
    // maxClearableDepth: score = depth*100 + difficulty if cleared, else roomsCleared.
    // Strong team clears D1 diff-0 easily (score ≥ 100).
    // Weak team at D1 diff-10 wipes early (score << 100).
    const problem = makeFarmTargetProblem({
      team: STRONG_TEAM,
      dungeon: SCRAPYARD,
      roster: STRONG_ROSTER,
      objective: maxClearableDepth,
      constants: DEFAULT_CONSTANTS,
    });

    const weakProblem = makeFarmTargetProblem({
      team: WEAK_TEAM,
      dungeon: SCRAPYARD,
      roster: WEAK_ROSTER,
      objective: maxClearableDepth,
      constants: DEFAULT_CONSTANTS,
    });

    const clearsScore = problem.evaluate({ depth: 1, difficulty: 0, rooms: 6 });
    const wipesScore = weakProblem.evaluate({ depth: 1, difficulty: 10, rooms: 30 });

    // maxClearableDepth: cleared at D1 → score = 100 + diff. Wipe gives roomsCleared (< rooms).
    expect(clearsScore).toBeGreaterThan(wipesScore);
  });

  it('higher difficulty gives higher maxClearableDepth score for a team that can clear both', () => {
    // maxClearableDepth = depth*100 + difficulty when cleared.
    // So diff-5 clears → score 105; diff-10 clears → score 110 (if team is strong enough).
    const problem = makeFarmTargetProblem({
      team: STRONG_TEAM,
      dungeon: SCRAPYARD,
      roster: STRONG_ROSTER,
      objective: maxClearableDepth,
      constants: DEFAULT_CONSTANTS,
    });

    const score5 = problem.evaluate({ depth: 1, difficulty: 5, rooms: 6 });
    const score10 = problem.evaluate({ depth: 1, difficulty: 10, rooms: 6 });

    // Only valid if both runs cleared; if DL-30 clears both (boss hits ~0 damage at diff 10),
    // the higher difficulty should yield a higher maxClearableDepth score.
    // We verify the cleared case: score = depth*100 + diff.
    if (isFinite(score5) && isFinite(score10) && score5 >= 100 && score10 >= 100) {
      expect(score10).toBeGreaterThan(score5);
    } else {
      // At least the one that can clear scores higher.
      expect(Math.max(score5, score10)).toBeGreaterThan(Math.min(score5, score10));
    }
  });
});

// ── 5. neighbors() stays within bounds ────────────────────────────────────────

describe('neighbors()', () => {
  it('all neighbors are within configured choice bounds', () => {
    const problem = makeFarmTargetProblem({
      team: STRONG_TEAM,
      dungeon: SCRAPYARD,
      roster: STRONG_ROSTER,
      objective: maxClearableDepth,
      constants: DEFAULT_CONSTANTS,
      depthChoices: DEPTH_CHOICES,
      difficultyChoices: DIFFICULTY_CHOICES,
      roomChoices: ROOM_CHOICES,
    });

    for (const c of problem.allCandidates()) {
      for (const n of problem.neighbors(c)) {
        expect(DEPTH_CHOICES).toContain(n.depth);
        expect(DIFFICULTY_CHOICES).toContain(n.difficulty);
        expect(ROOM_CHOICES).toContain(n.rooms);
        // Explicit bound assertions: no out-of-range values.
        expect(n.depth).toBeGreaterThanOrEqual(1);
        expect(n.depth).toBeLessThanOrEqual(4);
        expect(n.difficulty).toBeGreaterThanOrEqual(0);
        expect(n.difficulty).toBeLessThanOrEqual(10);
      }
    }
  });

  it('corner candidate {depth:1, difficulty:0, rooms:6} has only "up" neighbors', () => {
    const problem = makeFarmTargetProblem({
      team: STRONG_TEAM,
      dungeon: SCRAPYARD,
      roster: STRONG_ROSTER,
      objective: maxClearableDepth,
      constants: DEFAULT_CONSTANTS,
      depthChoices: DEPTH_CHOICES,
      difficultyChoices: DIFFICULTY_CHOICES,
      roomChoices: ROOM_CHOICES,
    });

    const corner: FarmTargetCandidate = { depth: 1, difficulty: 0, rooms: 6 };
    const ns = Array.from(problem.neighbors(corner));

    // From depth=1: can go to depth=2 only (not depth=0).
    // From difficulty=0: can go to difficulty=1 only (not difficulty=-1).
    // From rooms=6: can go to rooms=16 only (not rooms<6).
    for (const n of ns) {
      expect(n.depth).toBeGreaterThanOrEqual(1);
      expect(n.difficulty).toBeGreaterThanOrEqual(0);
      expect(n.rooms).toBeGreaterThanOrEqual(6);
    }

    // Should have exactly 3 neighbors (one per dimension, only the "up" direction).
    expect(ns).toHaveLength(3);
  });

  it('interior candidate has up to 6 neighbors (2 per dimension)', () => {
    const problem = makeFarmTargetProblem({
      team: STRONG_TEAM,
      dungeon: SCRAPYARD,
      roster: STRONG_ROSTER,
      objective: maxClearableDepth,
      constants: DEFAULT_CONSTANTS,
      depthChoices: DEPTH_CHOICES,
      difficultyChoices: DIFFICULTY_CHOICES,
      roomChoices: ROOM_CHOICES,
    });

    // Interior: depth=2, difficulty=5, rooms=16 — all three dimensions have neighbors on both sides.
    const interior: FarmTargetCandidate = { depth: 2, difficulty: 5, rooms: 16 };
    const ns = Array.from(problem.neighbors(interior));
    expect(ns).toHaveLength(6);
  });
});

// ── 6. Determinism: evaluate() in 'expected' mode ─────────────────────────────

describe('evaluate() — determinism', () => {
  it('returns the same score on repeated calls in expected mode', () => {
    const problem = makeFarmTargetProblem({
      team: STRONG_TEAM,
      dungeon: SCRAPYARD,
      roster: STRONG_ROSTER,
      objective: maxClearableDepth,
      constants: DEFAULT_CONSTANTS,
      evaluationMode: 'expected',
    });

    const candidate: FarmTargetCandidate = { depth: 1, difficulty: 3, rooms: 6 };
    const score1 = problem.evaluate(candidate);
    const score2 = problem.evaluate(candidate);
    const score3 = problem.evaluate(candidate);
    expect(score1).toBe(score2);
    expect(score2).toBe(score3);
  });
});

// ── 7. randomCandidate() stays within bounds ──────────────────────────────────

describe('randomCandidate()', () => {
  it('always returns a candidate within the configured choice sets', () => {
    const problem = makeFarmTargetProblem({
      team: STRONG_TEAM,
      dungeon: SCRAPYARD,
      roster: STRONG_ROSTER,
      objective: maxClearableDepth,
      constants: DEFAULT_CONSTANTS,
      depthChoices: DEPTH_CHOICES,
      difficultyChoices: DIFFICULTY_CHOICES,
      roomChoices: ROOM_CHOICES,
    });

    const rng = mulberry32(0xdeadbeef);
    for (let i = 0; i < 200; i++) {
      const c = problem.randomCandidate(rng);
      expect(DEPTH_CHOICES).toContain(c.depth);
      expect(DIFFICULTY_CHOICES).toContain(c.difficulty);
      expect(ROOM_CHOICES).toContain(c.rooms);
    }
  });
});

// ── 8. initial() returns a valid candidate ────────────────────────────────────

describe('initial()', () => {
  it('returns the first entry of each choice list', () => {
    const depthChoices: readonly Depth[] = [2, 3] as const;
    const difficultyChoices: readonly Difficulty[] = [5, 10] as const;
    const roomChoices: readonly number[] = [16, 30] as const;

    const problem = makeFarmTargetProblem({
      team: STRONG_TEAM,
      dungeon: SCRAPYARD,
      roster: STRONG_ROSTER,
      objective: maxClearableDepth,
      constants: DEFAULT_CONSTANTS,
      depthChoices,
      difficultyChoices,
      roomChoices,
    });

    const init = problem.initial();
    expect(init.depth).toBe(2);
    expect(init.difficulty).toBe(5);
    expect(init.rooms).toBe(16);
  });

  it('evaluate(initial()) returns a finite number (initial candidate is evaluable)', () => {
    const problem = makeFarmTargetProblem({
      team: STRONG_TEAM,
      dungeon: SCRAPYARD,
      roster: STRONG_ROSTER,
      objective: maxClearableDepth,
      constants: DEFAULT_CONSTANTS,
    });

    const score = problem.evaluate(problem.initial());
    expect(typeof score).toBe('number');
    // maxClearableDepth has no feasibility gate, so we always get a finite score.
    expect(isFinite(score)).toBe(true);
  });
});

// ── 9. Inputs validation ───────────────────────────────────────────────────────

describe('makeFarmTargetProblem() validation', () => {
  it('throws if depthChoices is empty', () => {
    const inputs: FarmTargetInputs = {
      team: STRONG_TEAM,
      dungeon: SCRAPYARD,
      roster: STRONG_ROSTER,
      objective: maxClearableDepth,
      constants: DEFAULT_CONSTANTS,
      depthChoices: [],
    };
    expect(() => makeFarmTargetProblem(inputs)).toThrow(/depthChoices must not be empty/);
  });

  it('throws if difficultyChoices is empty', () => {
    const inputs: FarmTargetInputs = {
      team: STRONG_TEAM,
      dungeon: SCRAPYARD,
      roster: STRONG_ROSTER,
      objective: maxClearableDepth,
      constants: DEFAULT_CONSTANTS,
      difficultyChoices: [],
    };
    expect(() => makeFarmTargetProblem(inputs)).toThrow(/difficultyChoices must not be empty/);
  });

  it('throws if roomChoices is empty', () => {
    const inputs: FarmTargetInputs = {
      team: STRONG_TEAM,
      dungeon: SCRAPYARD,
      roster: STRONG_ROSTER,
      objective: maxClearableDepth,
      constants: DEFAULT_CONSTANTS,
      roomChoices: [],
    };
    expect(() => makeFarmTargetProblem(inputs)).toThrow(/roomChoices must not be empty/);
  });
});
