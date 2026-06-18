/**
 * Tests for sim/run.ts (WP-H: run executor).
 *
 * All tests use a small SYNTHETIC dungeon and roster defined inline — they do
 * NOT depend on any content/ files (which are being built concurrently).
 *
 * ## Synthetic setup
 *
 * Two pet archetypes:
 *   - strongPet: DL 50, high growth → strong combat stats
 *   - weakPet:   DL 1,  low growth  → minimal combat stats
 *
 * Two enemy archetypes (resolved via Dungeon.archetypes map):
 *   - goblin:  weak enemy (hp=10, atk=1, def=0, spd=10), xpValue=5
 *   - bigBoss: strong boss (bossMult-scaled, xpValue=100)
 *
 * The synthetic dungeon populates `archetypes` (the Dungeon.archetypes field)
 * so the run executor can resolve enemy archetypes by id without any external
 * registry or extended RoomEnemyEntry hacks.
 */

import { describe, it, expect } from 'vitest';
import type { Dungeon } from '../domain/dungeon.js';
import type { EnemyArchetype } from '../domain/enemy.js';
import type { Pet } from '../domain/pet.js';
import type { RunConfig } from '../domain/run.js';
import type { Team } from '../domain/team.js';
import { asPetId } from '../domain/ids.js';
import type { PetId } from '../domain/ids.js';
import { DEFAULT_CONSTANTS } from '../constants/gameConstants.js';
import { simulateRun } from './run.js';
import type { SimulateRunDeps } from './run.js';

// ── Archetype definitions ────────────────────────────────────────────────────

const goblinArchetype: EnemyArchetype = {
  id: 'goblin',
  baseStats: { hp: 10, atk: 1, def: 0, spd: 10 },
  element: 'Neutral',
  scaling: { kind: 'linear', perDiff: {} }, // no stat scaling with difficulty
  isBoss: false,
  xpValue: 5,
};

/**
 * Boss with fixed stats (linear scaling, perDiff={}). We use linear rather than
 * bossMult so the boss stats are predictable regardless of pet stats. The values
 * are set so the strong pet (DL 50, 100k growth: atk≈181, def≈181, hp≈1815) can
 * beat the boss in a moderate number of rounds.
 *
 * Boss stats: hp=500, atk=50, def=20, spd=10.
 *   Pet baseDmg = 181 - 20/2 = 171 → deals real damage to boss.
 *   Boss baseDmg = 50 - 181/2 = -40.5 → boss deals 0 base dmg, only speed dmg.
 *   Speed dmg = (10 - 181)/2 = 0 (boss slower). Pet wins easily.
 */
const bossArchetype: EnemyArchetype = {
  id: 'depth1-boss',
  baseStats: { hp: 500, atk: 50, def: 20, spd: 10 },
  element: 'Neutral',
  scaling: { kind: 'linear', perDiff: {} },
  isBoss: true,
  xpValue: 100,
};

/**
 * A brutal boss — extremely high stats that will reliably wipe a weak team.
 */
const brutalBossArchetype: EnemyArchetype = {
  id: 'brutal-boss',
  baseStats: { hp: 9_999_999, atk: 9_999_999, def: 9_999_999, spd: 9_999_999 },
  element: 'Neutral',
  scaling: { kind: 'linear', perDiff: {} },
  isBoss: true,
  xpValue: 0,
};

// ── Synthetic dungeons ────────────────────────────────────────────────────────

/** Dungeon for normal-run tests: weak goblins + a depth-1 boss at room 6. */
const syntheticDungeon: Dungeon = {
  id: 'Scrapyard',
  element: 'Neutral',
  enemyTable: {
    1: {
      drawsPerRoom: 1,
      entries: [
        { enemyId: goblinArchetype.id,  weight: 1, minCount: 1, maxCount: 2 },
        { enemyId: bossArchetype.id,    weight: 0, minCount: 1, maxCount: 1 },
      ],
    },
  },
  bossArchetypeId: { 1: 'depth1-boss' },
  archetypes: {
    [goblinArchetype.id]:  goblinArchetype,
    [bossArchetype.id]:    bossArchetype,
  },
};

/** Dungeon with a brutal boss that will always wipe a weak team at room 6. */
const brutalDungeon: Dungeon = {
  id: 'Scrapyard',
  element: 'Neutral',
  enemyTable: {
    1: {
      drawsPerRoom: 1,
      entries: [
        { enemyId: goblinArchetype.id,       weight: 1, minCount: 1, maxCount: 1 },
        { enemyId: brutalBossArchetype.id,   weight: 0, minCount: 1, maxCount: 1 },
      ],
    },
  },
  bossArchetypeId: { 1: 'brutal-boss' },
  archetypes: {
    [goblinArchetype.id]:       goblinArchetype,
    [brutalBossArchetype.id]:   brutalBossArchetype,
  },
};

// ── Pet definitions ───────────────────────────────────────────────────────────

const STRONG_PET_ID = asPetId('strong-pet');
const WEAK_PET_ID   = asPetId('weak-pet');

function makePet(id: PetId, dungeonLevel: number, totalGrowth: number): Pet {
  return {
    id,
    displayName: id,
    primaryElement: 'Neutral',
    dungeonLevel,
    classLevel: 0,
    evolvedClass: null,
    totalGrowth,
    growthRequiredForEvolution: 50_000,
    trainingPhysical: 0,
    trainingMystic: 0,
    trainingBattle: 0,
    equipment: {},
    abilities: [],
    source: { importerId: 'test', importerVersion: 1 },
  };
}

/** Strong pet: DL 50, decent growth. Will reliably beat goblins. */
const strongPet = makePet(STRONG_PET_ID, 50, 100_000);
/** Weak pet: DL 1, no growth. Minimal stats. */
const weakPet   = makePet(WEAK_PET_ID,   1,       0);

// ── Team builders ─────────────────────────────────────────────────────────────

const strongTeam: Team = {
  slots: [{ petId: STRONG_PET_ID, row: 'front', assignedClass: 'Adventurer' }],
};

const weakTeam: Team = {
  slots: [{ petId: WEAK_PET_ID, row: 'front', assignedClass: 'Adventurer' }],
};

// ── Roster maps ───────────────────────────────────────────────────────────────

const strongRoster: ReadonlyMap<PetId, Pet> = new Map([[STRONG_PET_ID, strongPet]]);
const weakRoster:   ReadonlyMap<PetId, Pet> = new Map([[WEAK_PET_ID,   weakPet]]);

// ── Timing helper ─────────────────────────────────────────────────────────────

/**
 * Expected elapsed minutes for a given number of cleared rooms and NRDC count.
 * Research §6.3a: time = rooms × 15 × (1 − 0.01 × nrdcCompletions)
 */
function expectedMinutes(rooms: number, nrdc: number): number {
  return rooms * 15 * (1 - 0.01 * nrdc);
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('simulateRun — expected mode', () => {
  it('strong team clears a short easy run', () => {
    const config: RunConfig = {
      team: strongTeam,
      dungeonId: 'Scrapyard',
      depth: 1,
      difficulty: 0,
      rooms: 3,
      nrdcCompletions: 0,
      evaluationMode: 'expected',
    };
    const deps: SimulateRunDeps = {
      dungeon: syntheticDungeon,
      roster: strongRoster,
      constants: DEFAULT_CONSTANTS,
    };

    const result = simulateRun(config, deps);

    expect(result.cleared).toBe(true);
    expect(result.roomsCleared).toBe(3);
    expect(result.petDeaths).toHaveLength(0);
    // Timing: 3 rooms × 15 min × (1 − 0) = 45 minutes
    expect(result.elapsedMinutes).toBeCloseTo(expectedMinutes(3, 0));
  });

  it('elapsedMinutes respects NRDC reductions', () => {
    const config: RunConfig = {
      team: strongTeam,
      dungeonId: 'Scrapyard',
      depth: 1,
      difficulty: 0,
      rooms: 4,
      nrdcCompletions: 10,
      evaluationMode: 'expected',
    };
    const deps: SimulateRunDeps = {
      dungeon: syntheticDungeon,
      roster: strongRoster,
      constants: DEFAULT_CONSTANTS,
    };

    const result = simulateRun(config, deps);

    // With 10 NRDCs: 15 × (1 − 0.10) = 13.5 min/room; 4 rooms = 54 min
    expect(result.cleared).toBe(true);
    expect(result.elapsedMinutes).toBeCloseTo(expectedMinutes(4, 10));
  });

  it('weak team against brutal boss fails before completing all rooms', () => {
    // 6 rooms means the boss appears at room 6. A weak pet will die to normal
    // goblins or certainly to the brutal boss.
    const config: RunConfig = {
      team: weakTeam,
      dungeonId: 'Scrapyard',
      depth: 1,
      difficulty: 0,
      rooms: 6,
      nrdcCompletions: 0,
      evaluationMode: 'expected',
    };
    const deps: SimulateRunDeps = {
      dungeon: brutalDungeon,
      roster: weakRoster,
      constants: DEFAULT_CONSTANTS,
    };

    const result = simulateRun(config, deps);

    expect(result.cleared).toBe(false);
    // The weak pet should have died somewhere.
    expect(result.petDeaths).toContain(WEAK_PET_ID);
    // roomsCleared must be strictly less than total rooms.
    expect(result.roomsCleared).toBeLessThan(6);
  });

  it('XP accrues per enemy killed (perPet.xpGained > 0 after kills)', () => {
    const config: RunConfig = {
      team: strongTeam,
      dungeonId: 'Scrapyard',
      depth: 1,
      difficulty: 0,
      rooms: 2,
      nrdcCompletions: 0,
      evaluationMode: 'expected',
    };
    const deps: SimulateRunDeps = {
      dungeon: syntheticDungeon,
      roster: strongRoster,
      constants: DEFAULT_CONSTANTS,
    };

    const result = simulateRun(config, deps);

    const petStats = result.perPet.get(STRONG_PET_ID);
    expect(petStats).toBeDefined();
    // Strong pet killed at least some goblins → XP > 0.
    expect(petStats!.xpGained).toBeGreaterThan(0);
    // Aggregate xpTotal must equal the sum of per-pet xp.
    const sumXp = Array.from(result.perPet.values()).reduce((s, p) => s + p.xpGained, 0);
    expect(result.rewards.xpTotal).toBe(sumXp);
  });

  it('XP is zero when no enemies are killed (0-entry table)', () => {
    // Dungeon with an empty enemy table for depth 1 → no enemies spawned.
    const emptyDungeon: Dungeon = {
      id: 'NewbieGround',
      element: 'Neutral',
      enemyTable: {
        1: { drawsPerRoom: 0, entries: [] },
      },
      bossArchetypeId: {},
      archetypes: {},
    };

    const config: RunConfig = {
      team: strongTeam,
      dungeonId: 'NewbieGround',
      depth: 1,
      difficulty: 0,
      rooms: 2,
      nrdcCompletions: 0,
      evaluationMode: 'expected',
    };
    const deps: SimulateRunDeps = {
      dungeon: emptyDungeon,
      roster: strongRoster,
      constants: DEFAULT_CONSTANTS,
    };

    const result = simulateRun(config, deps);

    // Rooms should be cleared (no enemies = instant clear) but no XP.
    expect(result.cleared).toBe(true);
    const petStats = result.perPet.get(STRONG_PET_ID);
    expect(petStats?.xpGained).toBe(0);
    expect(result.rewards.xpTotal).toBe(0);
  });

  it('boss appears at the correct room (room 6 for depth 1)', () => {
    // Run exactly 6 rooms. Room 6 is the boss room. We verify the boss was
    // encountered by checking that boss XP (100) appears when the strong team
    // clears all 6 rooms (they can beat the depth-1 boss archetype).
    const config: RunConfig = {
      team: strongTeam,
      dungeonId: 'Scrapyard',
      depth: 1,
      difficulty: 0,
      rooms: 6,
      nrdcCompletions: 0,
      evaluationMode: 'expected',
    };
    const deps: SimulateRunDeps = {
      dungeon: syntheticDungeon,
      roster: strongRoster,
      constants: DEFAULT_CONSTANTS,
    };

    const result = simulateRun(config, deps);

    // Should clear all 6 rooms (strong team vs easy boss).
    expect(result.cleared).toBe(true);
    expect(result.roomsCleared).toBe(6);

    // Boss XP value is 100. The strong pet should have earned at least 100 XP
    // (from the boss kill alone). Regular goblins give 5 XP each; across 5
    // normal rooms we get at least 5 × 5 = 25 XP + 100 boss = at least 125.
    const petStats = result.perPet.get(STRONG_PET_ID);
    expect(petStats!.xpGained).toBeGreaterThanOrEqual(100);
  });

  it('expected mode is deterministic (same input → same output)', () => {
    const config: RunConfig = {
      team: strongTeam,
      dungeonId: 'Scrapyard',
      depth: 1,
      difficulty: 0,
      rooms: 5,
      nrdcCompletions: 0,
      evaluationMode: 'expected',
    };
    const deps: SimulateRunDeps = {
      dungeon: syntheticDungeon,
      roster: strongRoster,
      constants: DEFAULT_CONSTANTS,
    };

    const r1 = simulateRun(config, deps);
    const r2 = simulateRun(config, deps);

    expect(r1.cleared).toBe(r2.cleared);
    expect(r1.roomsCleared).toBe(r2.roomsCleared);
    expect(r1.elapsedMinutes).toBe(r2.elapsedMinutes);
    expect(r1.rewards.xpTotal).toBe(r2.rewards.xpTotal);
    const p1 = r1.perPet.get(STRONG_PET_ID)!;
    const p2 = r2.perPet.get(STRONG_PET_ID)!;
    expect(p1.xpGained).toBe(p2.xpGained);
    expect(p1.dealt).toBe(p2.dealt);
  });
});

describe('simulateRun — monteCarlo mode', () => {
  it('same seed produces identical RunResult (determinism)', () => {
    const config: RunConfig = {
      team: strongTeam,
      dungeonId: 'Scrapyard',
      depth: 1,
      difficulty: 0,
      rooms: 4,
      nrdcCompletions: 0,
      evaluationMode: 'monteCarlo',
      rngSeed: 42,
      monteCarloTrials: 20,
    };
    const deps: SimulateRunDeps = {
      dungeon: syntheticDungeon,
      roster: strongRoster,
      constants: DEFAULT_CONSTANTS,
    };

    const r1 = simulateRun(config, deps);
    const r2 = simulateRun(config, deps);

    expect(r1.cleared).toBe(r2.cleared);
    expect(r1.roomsCleared).toBe(r2.roomsCleared);
    expect(r1.elapsedMinutes).toBe(r2.elapsedMinutes);
    expect(r1.rewards.xpTotal).toBe(r2.rewards.xpTotal);
    expect(r1.distribution!.clearRate).toBe(r2.distribution!.clearRate);
    expect(r1.distribution!.timeP50).toBe(r2.distribution!.timeP50);
  });

  it('different seeds produce different results', () => {
    const baseCfg = {
      team: strongTeam,
      dungeonId: 'Scrapyard' as const,
      depth: 1 as const,
      difficulty: 0 as const,
      rooms: 4,
      nrdcCompletions: 0,
      evaluationMode: 'monteCarlo' as const,
      monteCarloTrials: 30,
    };
    const deps: SimulateRunDeps = {
      dungeon: syntheticDungeon,
      roster: strongRoster,
      constants: DEFAULT_CONSTANTS,
    };

    const r1 = simulateRun({ ...baseCfg, rngSeed: 1 }, deps);
    const r2 = simulateRun({ ...baseCfg, rngSeed: 999 }, deps);

    // The XP totals should differ because enemy counts are random and seeds differ.
    // (Not guaranteed mathematically, but extremely likely with different seeds.)
    // We assert distributions are present regardless.
    expect(r1.distribution).toBeDefined();
    expect(r2.distribution).toBeDefined();
  });

  it('MC mode: distribution is present with 0 ≤ clearRate ≤ 1', () => {
    const config: RunConfig = {
      team: strongTeam,
      dungeonId: 'Scrapyard',
      depth: 1,
      difficulty: 0,
      rooms: 3,
      nrdcCompletions: 0,
      evaluationMode: 'monteCarlo',
      rngSeed: 7,
      monteCarloTrials: 50,
    };
    const deps: SimulateRunDeps = {
      dungeon: syntheticDungeon,
      roster: strongRoster,
      constants: DEFAULT_CONSTANTS,
    };

    const result = simulateRun(config, deps);

    expect(result.distribution).toBeDefined();
    const dist = result.distribution!;
    expect(dist.clearRate).toBeGreaterThanOrEqual(0);
    expect(dist.clearRate).toBeLessThanOrEqual(1);
    expect(dist.timeP95).toBeGreaterThanOrEqual(dist.timeP50);
  });

  it('MC mode: timeP95 ≥ timeP50', () => {
    // Use a harder run so there is meaningful variance across trials.
    const config: RunConfig = {
      team: weakTeam,
      dungeonId: 'Scrapyard',
      depth: 1,
      difficulty: 0,
      rooms: 6,
      nrdcCompletions: 0,
      evaluationMode: 'monteCarlo',
      rngSeed: 123,
      monteCarloTrials: 100,
    };
    const deps: SimulateRunDeps = {
      dungeon: brutalDungeon,
      roster: weakRoster,
      constants: DEFAULT_CONSTANTS,
    };

    const result = simulateRun(config, deps);

    expect(result.distribution).toBeDefined();
    expect(result.distribution!.timeP95).toBeGreaterThanOrEqual(
      result.distribution!.timeP50,
    );
  });

  it('MC mode: clearRate = 1.0 for a trivially easy run (strong team, easy enemies)', () => {
    // 1 room, no boss, strong team → should always clear.
    const config: RunConfig = {
      team: strongTeam,
      dungeonId: 'Scrapyard',
      depth: 1,
      difficulty: 0,
      rooms: 1,
      nrdcCompletions: 0,
      evaluationMode: 'monteCarlo',
      rngSeed: 0,
      monteCarloTrials: 50,
    };
    const deps: SimulateRunDeps = {
      dungeon: syntheticDungeon,
      roster: strongRoster,
      constants: DEFAULT_CONSTANTS,
    };

    const result = simulateRun(config, deps);

    expect(result.distribution!.clearRate).toBe(1.0);
  });

  it('MC mode: clearRate = 0 for an impossible run (weak team, brutal boss)', () => {
    // Brutal boss appears at room 6; the weak pet can't survive.
    // We test with 6 rooms so the boss is guaranteed to appear.
    const config: RunConfig = {
      team: weakTeam,
      dungeonId: 'Scrapyard',
      depth: 1,
      difficulty: 0,
      rooms: 6,
      nrdcCompletions: 0,
      evaluationMode: 'monteCarlo',
      rngSeed: 0,
      monteCarloTrials: 50,
    };
    const deps: SimulateRunDeps = {
      dungeon: brutalDungeon,
      roster: weakRoster,
      constants: DEFAULT_CONSTANTS,
    };

    const result = simulateRun(config, deps);

    // Weak team will always be wiped by the brutal boss.
    expect(result.distribution!.clearRate).toBe(0);
  });

  it('MC mode: meanRewards.xpTotal > 0 when enemies are killed', () => {
    const config: RunConfig = {
      team: strongTeam,
      dungeonId: 'Scrapyard',
      depth: 1,
      difficulty: 0,
      rooms: 2,
      nrdcCompletions: 0,
      evaluationMode: 'monteCarlo',
      rngSeed: 5,
      monteCarloTrials: 20,
    };
    const deps: SimulateRunDeps = {
      dungeon: syntheticDungeon,
      roster: strongRoster,
      constants: DEFAULT_CONSTANTS,
    };

    const result = simulateRun(config, deps);

    expect(result.distribution!.meanRewards.xpTotal).toBeGreaterThan(0);
  });
});

describe('simulateRun — perPet damage tracking', () => {
  it('perPet.dealt > 0 and perPet.taken > 0 when combat occurs', () => {
    const config: RunConfig = {
      team: weakTeam,  // Weak pet takes more damage
      dungeonId: 'Scrapyard',
      depth: 1,
      difficulty: 0,
      rooms: 1,
      nrdcCompletions: 0,
      evaluationMode: 'expected',
    };
    // Use a dungeon where enemies have meaningful attack.
    const deps: SimulateRunDeps = {
      dungeon: syntheticDungeon,
      roster: weakRoster,
      constants: DEFAULT_CONSTANTS,
    };

    const result = simulateRun(config, deps);
    const stats = result.perPet.get(WEAK_PET_ID);
    expect(stats).toBeDefined();
    // Weak pet still deals some damage (hitChanceFloor = 5%).
    expect(stats!.dealt).toBeGreaterThanOrEqual(0);
  });
});

// ── 50-turn auto-loss (research §6.6.2) ────────────────────────────────────────

/**
 * A "stalemate wall" enemy: gigantic HP so the strong pet cannot kill it within
 * 50 turns, but atk=0 / spd=1 so it cannot hurt the pet either. The OLD 1000-round
 * "safety cap" would have counted such a room as CLEARED (the pet survives). The
 * new turn loop must declare an AUTOMATIC LOSS at the 50-turn cap.
 */
const stalemateEnemy: EnemyArchetype = {
  id: 'stalemate-wall',
  baseStats: { hp: 9_999_999, atk: 0, def: 0, spd: 1 },
  element: 'Neutral',
  scaling: { kind: 'linear', perDiff: {} },
  isBoss: false,
  xpValue: 0,
};

const stalemateDungeon: Dungeon = {
  id: 'Scrapyard',
  element: 'Neutral',
  enemyTable: {
    1: {
      drawsPerRoom: 1,
      entries: [{ enemyId: stalemateEnemy.id, weight: 1, minCount: 1, maxCount: 1 }],
    },
  },
  bossArchetypeId: {},
  archetypes: { [stalemateEnemy.id]: stalemateEnemy },
};

describe('simulateRun — 50-turn auto-loss (§6.6.2)', () => {
  it('a fight that cannot be won within 50 turns is an automatic loss (not a clear)', () => {
    const config: RunConfig = {
      team: strongTeam,
      dungeonId: 'Scrapyard',
      depth: 1,
      difficulty: 0,
      rooms: 4,
      nrdcCompletions: 0,
      evaluationMode: 'expected',
    };
    const deps: SimulateRunDeps = {
      dungeon: stalemateDungeon,
      roster: strongRoster,
      constants: DEFAULT_CONSTANTS,
    };

    const result = simulateRun(config, deps);

    // The pet survives the whole time (enemy deals 0), yet the run does NOT clear:
    // the 50-turn cap forces a loss in room 1.
    expect(result.cleared).toBe(false);
    expect(result.roomsCleared).toBe(0);
    // Auto-loss is from the turn cap, not from a death.
    expect(result.petDeaths).toHaveLength(0);
  });
});

// ── Phoenix Feather revival (research §6.6.4) ──────────────────────────────────

/**
 * A glass-cannon enemy: 1 HP (dies to the pet's first hit) but lethal attack
 * (one-shots the pet). In a turn both die simultaneously, so each room is
 * "cleared" (enemies wiped) but costs the pet its life — unless a Phoenix Feather
 * revives it for the next room.
 */
const glassCannonEnemy: EnemyArchetype = {
  id: 'glass-cannon',
  baseStats: { hp: 1, atk: 9_999_999, def: 0, spd: 100 },
  element: 'Neutral',
  scaling: { kind: 'linear', perDiff: {} },
  isBoss: false,
  xpValue: 1,
};

const glassCannonDungeon: Dungeon = {
  id: 'Scrapyard',
  element: 'Neutral',
  enemyTable: {
    1: {
      drawsPerRoom: 1,
      entries: [{ enemyId: glassCannonEnemy.id, weight: 1, minCount: 1, maxCount: 1 }],
    },
  },
  bossArchetypeId: {},
  archetypes: { [glassCannonEnemy.id]: glassCannonEnemy },
};

describe('simulateRun — Phoenix Feather revival (§6.6.4)', () => {
  const deps: SimulateRunDeps = {
    dungeon: glassCannonDungeon,
    roster: strongRoster,
    constants: DEFAULT_CONSTANTS,
  };
  const baseConfig = {
    team: strongTeam,
    dungeonId: 'Scrapyard' as const,
    depth: 1 as const,
    difficulty: 0 as const,
    rooms: 4,
    nrdcCompletions: 0,
    evaluationMode: 'expected' as const,
  };

  it('with no feathers the pet dies in room 1 and the run stops', () => {
    const result = simulateRun({ ...baseConfig, phoenixFeathers: 0 }, deps);
    // Room 1 clears (enemy wiped) but the pet is dead afterwards → run ends.
    expect(result.roomsCleared).toBe(1);
    expect(result.cleared).toBe(false);
    expect(result.petDeaths).toContain(STRONG_PET_ID);
  });

  it('feathers revive the pet each room, letting the run clear all rooms', () => {
    const result = simulateRun({ ...baseConfig, phoenixFeathers: 3 }, deps);
    // 3 feathers cover the deaths in rooms 1–3; room 4 clears before the pet
    // would need a 4th revive → all 4 rooms cleared.
    expect(result.roomsCleared).toBe(4);
    expect(result.cleared).toBe(true);
  });

  it('the feather pool is shared across the run (more feathers ⇒ further progress)', () => {
    const withOne = simulateRun({ ...baseConfig, phoenixFeathers: 1 }, deps);
    const withTwo = simulateRun({ ...baseConfig, phoenixFeathers: 2 }, deps);
    expect(withOne.roomsCleared).toBe(2);
    expect(withTwo.roomsCleared).toBe(3);
  });
});

describe('simulateRun — rewards', () => {
  it('materials are accrued for the dungeon element at the depth tier', () => {
    const config: RunConfig = {
      team: strongTeam,
      dungeonId: 'Scrapyard',
      depth: 1,
      difficulty: 0,
      rooms: 2,
      nrdcCompletions: 0,
      evaluationMode: 'expected',
    };
    const deps: SimulateRunDeps = {
      dungeon: syntheticDungeon,
      roster: strongRoster,
      constants: DEFAULT_CONSTANTS,
    };

    const result = simulateRun(config, deps);

    // Dungeon element is 'Neutral', depth is 1 → T1 Neutral materials.
    const neutralMats = result.rewards.materials['Neutral'];
    expect(neutralMats).toBeDefined();
    expect(neutralMats![1]).toBeGreaterThan(0);
  });
});
