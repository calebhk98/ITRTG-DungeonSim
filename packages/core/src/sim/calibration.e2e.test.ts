/**
 * Calibration / sanity tests: verify the assembled sim produces sensible
 * "what depth can this team clear" outcomes on REAL Scrapyard content.
 *
 * These are intentionally directional (weak team is shallow, strong team is
 * deep) rather than pinned to exact numbers, so they validate the model without
 * being brittle to constant tweaks. Growth values are chosen as representative
 * of the stated DL/CL milestones and documented inline.
 *
 * `*.e2e`-style: exercises content + stats + scaling + combat + run together.
 */

import { describe, it, expect } from 'vitest';
import { getDungeon } from '../content/index.js';
import { simulateRun } from './run.js';
import type { SimulateRunDeps } from './run.js';
import { DEFAULT_CONSTANTS } from '../constants/gameConstants.js';
import { asPetId } from '../domain/ids.js';
import type { PetId } from '../domain/ids.js';
import type { Pet } from '../domain/pet.js';
import type { Depth, Difficulty } from '../domain/dungeon.js';
import type { Team } from '../domain/team.js';

const scrapyard = getDungeon('Scrapyard');
if (scrapyard === undefined) throw new Error('Scrapyard content missing');
const dungeon = scrapyard;

/** Room number where each depth's boss appears (so the boss is included). */
const BOSS_ROOM: Record<Depth, number> = { 1: 6, 2: 16, 3: 30, 4: 60 };

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
    source: { importerId: 'calibration', importerVersion: 1 },
  };
}

/** Build a 6-pet team (3 front / 3 back) of identical pets + its roster. */
function squad(prefix: string, dl: number, cl: number, growth: number): {
  team: Team;
  roster: ReadonlyMap<PetId, Pet>;
} {
  const pets = Array.from({ length: 6 }, (_, i) => makePet(`${prefix}-${i}`, dl, cl, growth));
  const roster = new Map<PetId, Pet>(pets.map(p => [p.id, p]));
  const team: Team = {
    slots: pets.map((p, i) => ({
      petId: p.id,
      row: (i < 3 ? 'front' : 'back') as 'front' | 'back',
      assignedClass: 'Adventurer',
    })),
  };
  return { team, roster };
}

function clears(
  s: { team: Team; roster: ReadonlyMap<PetId, Pet> },
  depth: Depth,
  difficulty: Difficulty,
): boolean {
  const deps: SimulateRunDeps = { dungeon, roster: s.roster, constants: DEFAULT_CONSTANTS };
  const result = simulateRun(
    {
      team: s.team,
      dungeonId: 'Scrapyard',
      depth,
      difficulty,
      rooms: BOSS_ROOM[depth],
      nrdcCompletions: 0,
      evaluationMode: 'expected',
    },
    deps,
  );
  return result.cleared;
}

/** Deepest depth (at difficulty 0) a squad can clear, 0 if none. */
function maxDepth(s: { team: Team; roster: ReadonlyMap<PetId, Pet> }): number {
  let best = 0;
  for (const d of [1, 2, 3, 4] as Depth[]) {
    if (clears(s, d, 0)) best = d;
  }
  return best;
}

// Representative squads at the milestones the player described.
const weak = squad('weak', 30, 15, 100_000); // CL15 / DL30
const mid = squad('mid', 200, 60, 1_000_000); // CL60 / DL200
const strong = squad('strong', 600, 100, 10_000_000); // CL100 / DL600

describe('Sim calibration — clearable depth scales with pet strength', () => {
  it('a CL15/DL30 squad clears D1 but CANNOT do D4', () => {
    expect(clears(weak, 1, 0)).toBe(true);
    expect(clears(weak, 4, 0)).toBe(false);
    expect(clears(weak, 4, 10)).toBe(false);
  });

  it('a CL15/DL30 squad tops out around D1 (cannot reach D3)', () => {
    expect(maxDepth(weak)).toBeLessThanOrEqual(2);
    expect(maxDepth(weak)).toBeGreaterThanOrEqual(1);
  });

  it('a CL60/DL200 squad clears D1–D3 but not D4', () => {
    expect(clears(mid, 1, 0)).toBe(true);
    expect(clears(mid, 3, 0)).toBe(true);
    expect(clears(mid, 4, 0)).toBe(false);
  });

  it('a CL100/DL600 squad can clear D4, even at difficulty 10', () => {
    expect(clears(strong, 4, 0)).toBe(true);
    expect(clears(strong, 4, 10)).toBe(true);
  });

  it('deeper clear capability is monotonic in pet strength', () => {
    expect(maxDepth(weak)).toBeLessThanOrEqual(maxDepth(mid));
    expect(maxDepth(mid)).toBeLessThanOrEqual(maxDepth(strong));
    expect(maxDepth(strong)).toBe(4);
  });

  it('difficulty matters: weak squad clears D1-0 but fails high D1 difficulty', () => {
    expect(clears(weak, 1, 0)).toBe(true);
    expect(clears(weak, 1, 10)).toBe(false);
  });

  it('a strong squad still clears where a weak squad wipes (same depth)', () => {
    expect(clears(weak, 2, 0)).toBe(false);
    expect(clears(strong, 2, 0)).toBe(true);
  });
});

describe('Sim calibration — difficulty thresholds (a team has a difficulty ceiling)', () => {
  // Same DL/CL, different growth → different difficulty ceilings at D2.
  const diffLow = squad('difflow', 100, 40, 90_000);
  const diffMid = squad('diffmid', 100, 40, 150_000);

  it('a squad can clear D2-3 but not D2-5', () => {
    expect(clears(diffLow, 2, 3)).toBe(true);
    expect(clears(diffLow, 2, 5)).toBe(false);
  });

  it('a stronger squad clears D2-5 but not D2-8', () => {
    expect(clears(diffMid, 2, 5)).toBe(true);
    expect(clears(diffMid, 2, 8)).toBe(false);
  });

  it('clear ability within a depth is monotonic in difficulty', () => {
    // If it clears a difficulty, it clears every lower one too.
    for (const squadUnderTest of [diffLow, diffMid]) {
      let lastClearable = -1;
      for (let d = 0; d <= 10; d++) {
        if (clears(squadUnderTest, 2, d as Difficulty)) lastClearable = d;
      }
      for (let d = 0; d <= lastClearable; d++) {
        expect(clears(squadUnderTest, 2, d as Difficulty)).toBe(true);
      }
    }
  });
});
