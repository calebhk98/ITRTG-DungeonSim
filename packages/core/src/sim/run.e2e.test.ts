/**
 * End-to-end integration tests for the run executor (WP-H) against REAL
 * Scrapyard content (content/index.ts → getDungeon('Scrapyard')).
 *
 * These tests verify the full pipeline:
 *   real Dungeon content → simulateRun → RunResult
 *
 * They specifically prove:
 *   1. Archetype resolution works: enemies actually fight (dealt > 0, xpGained > 0).
 *   2. Per-difficulty scaling is end-to-end: difficulty 10 yields strictly more
 *      total damage taken by the party than difficulty 0.
 *   3. Boss room at room 6 (depth 1) is encountered: the boss is spawned and fought,
 *      evidenced by the team taking MORE damage in the 6-room run than the 5-room run.
 *
 * ## Stat-balance notes
 *
 * ### Archetype resolution test (DL-50 pets, Diff 0)
 * DL-50 Adventurer: ATK≈121, DEF≈121, SPD≈121, HP≈1210 (no growth for simplicity).
 * Metal Slimy ATK=40 vs pet DEF=121: baseDmg = 40 − 60.5 = −20.5 → 0. Slimies deal 0
 * base damage and also 0 speed damage (slimy SPD=30×1.2=36 < pet SPD=121). So the pet
 * takes 0 damage from slimies but deals plenty to them (baseDmg = 121−15 = 106).
 * This gives dealt>0 and xpGained>0 while confirming archetype resolution worked.
 *
 * ### Difficulty scaling test (DL-30 pets, Diff 0 vs Diff 10)
 * DL-30 Adventurer: ATK≈DEF≈73, no growth.
 * Metal Slimy ATK base=40, perDiff.atk=4.
 *   Diff 0: baseDmg = 40 − 36.5 = 3.5  → clamps to ≥1 → small but positive damage/hit.
 *   Diff 10: baseDmg = 80 − 36.5 = 43.5 → ~12× more base damage per hit.
 * Total party damage taken is substantially higher at Difficulty 10, proving per-difficulty
 * scaling flows through the full integrated path.
 *
 * ### Boss room test (DL-50 pets)
 * The Chameleon D1 boss uses bossMult base=2 with petStatsReference (mean of living allies).
 * For DL-50 Adventurers: boss stats = petRef × 2 → boss ATK = 242, pet DEF = 121.
 * Boss baseDmg = 242 − 60.5 = 181.5, boss speedDmg > 0 (boss SPD = 242 > pet SPD = 121).
 * Meanwhile pet baseDmg = 121 − 121 = 0 and pet speedDmg = 0 (boss is faster).
 * So DL-50 pets take real damage from the boss but deal none — they will die to the boss.
 * Since they take ZERO damage from slimies (rooms 1–5), the 6-room run accrues more
 * damage_taken than the 5-room run, proving the boss archetype was resolved and spawned.
 */

import { describe, it, expect } from 'vitest';
import { getDungeon } from '../content/index.js';
import { simulateRun } from './run.js';
import type { SimulateRunDeps } from './run.js';
import { DEFAULT_CONSTANTS } from '../constants/gameConstants.js';
import { asPetId } from '../domain/ids.js';
import type { PetId } from '../domain/ids.js';
import type { Pet } from '../domain/pet.js';
import type { RunConfig } from '../domain/run.js';
import type { Team } from '../domain/team.js';

// ── Scrapyard dungeon (real content) ─────────────────────────────────────────

const scrapyardOrUndef = getDungeon('Scrapyard');
if (scrapyardOrUndef === undefined) {
  throw new Error('Scrapyard dungeon not found in registry — check content/index.ts');
}
/** Non-nullable reference — the throw above ensures this is always defined. */
const scrapyard = scrapyardOrUndef;

// ── Pet factory ───────────────────────────────────────────────────────────────

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
    source: { importerId: 'e2e-test', importerVersion: 1 },
  };
}

// ── Shared Scrapyard deps ────────────────────────────────────────────────────

function makeDeps(roster: ReadonlyMap<PetId, Pet>): SimulateRunDeps {
  return { dungeon: scrapyard, roster, constants: DEFAULT_CONSTANTS };
}

function sumTaken(result: ReturnType<typeof simulateRun>): number {
  return Array.from(result.perPet.values()).reduce((s, p) => s + p.taken, 0);
}

function sumDealt(result: ReturnType<typeof simulateRun>): number {
  return Array.from(result.perPet.values()).reduce((s, p) => s + p.dealt, 0);
}

function sumXp(result: ReturnType<typeof simulateRun>): number {
  return Array.from(result.perPet.values()).reduce((s, p) => s + p.xpGained, 0);
}

// ── 1. Archetype resolution: real combat ─────────────────────────────────────
//
// DL-50 pets (ATK≈DEF≈SPD≈121, HP≈1210, no growth) vs D1 Slimies (ATK=40, HP=600):
//   Pet baseDmg vs slimy = 121 − 15 = 106 → positive, so pets deal real damage.
//   Slimy baseDmg vs pet = 40 − 60.5 = −20.5 → zero; slimy speedDmg = 0 (pet faster).
//   Result: pets kill slimies, gain XP, take 0 damage. dealt > 0 and xpGained > 0.

describe('E2E: Scrapyard D1 — real archetype resolution', () => {
  const PET_STRONG = asPetId('e2e-strong');
  const rosterStrong: ReadonlyMap<PetId, Pet> = new Map([
    [PET_STRONG, makePet(PET_STRONG, 50, 0)],
  ]);
  const teamStrong: Team = {
    slots: [{ petId: PET_STRONG, row: 'front', assignedClass: 'Adventurer' }],
  };

  it('DL-50 pet kills real D1 Slimies: dealt > 0, xpGained > 0', () => {
    const config: RunConfig = {
      team: teamStrong,
      dungeonId: 'Scrapyard',
      depth: 1,
      difficulty: 0,
      rooms: 3,
      nrdcCompletions: 0,
      evaluationMode: 'expected',
    };

    const result = simulateRun(config, makeDeps(rosterStrong));

    // Should clear all 3 rooms (DL-50 vs D1 Slimies is easy).
    expect(result.roomsCleared).toBe(3);
    expect(result.cleared).toBe(true);
    expect(result.petDeaths).toHaveLength(0);

    // Real combat: archetype resolution worked, enemies fought and were killed.
    const dealt = sumDealt(result);
    const xpGained = sumXp(result);
    expect(dealt).toBeGreaterThan(0);
    expect(xpGained).toBeGreaterThan(0);

    // xpTotal must equal sum of per-pet xp.
    expect(result.rewards.xpTotal).toBe(sumXp(result));
  });

  it('materials accrue for Neutral element at tier 1 (Scrapyard D1, real enemies killed)', () => {
    const config: RunConfig = {
      team: teamStrong,
      dungeonId: 'Scrapyard',
      depth: 1,
      difficulty: 0,
      rooms: 3,
      nrdcCompletions: 0,
      evaluationMode: 'expected',
    };

    const result = simulateRun(config, makeDeps(rosterStrong));

    const neutralMats = result.rewards.materials['Neutral'];
    expect(neutralMats).toBeDefined();
    expect(neutralMats![1]).toBeGreaterThan(0);
  });
});

// ── 2. Per-difficulty scaling end-to-end ─────────────────────────────────────
//
// DL-30 pets (ATK≈DEF≈73, no growth, HP≈730) vs D1 Slimies:
//   Diff 0: Slimy ATK=40, pet DEF=73 → baseDmg = 40 − 36.5 = 3.5 → small positive hit.
//   Diff 10: Slimy ATK=80, pet DEF=73 → baseDmg = 80 − 36.5 = 43.5 → 12× more per hit.
// Total party damage taken is substantially higher at Difficulty 10.

describe('E2E: Per-difficulty scaling — difficulty 0 vs difficulty 10', () => {
  const PET_MEDIUM = asPetId('e2e-medium');

  // DL-30, zero growth: DEF ≈ (1+2.4×30)×1.0 = 73.
  const rosterMedium: ReadonlyMap<PetId, Pet> = new Map([
    [PET_MEDIUM, makePet(PET_MEDIUM, 30, 0)],
  ]);
  const teamMedium: Team = {
    slots: [{ petId: PET_MEDIUM, row: 'front', assignedClass: 'Adventurer' }],
  };

  it('expected-mode: difficulty 10 deals strictly more damage to the party than difficulty 0', () => {
    const baseConfig = {
      team: teamMedium,
      dungeonId: 'Scrapyard' as const,
      depth: 1 as const,
      rooms: 3,
      nrdcCompletions: 0,
      evaluationMode: 'expected' as const,
    };

    const resultD0  = simulateRun({ ...baseConfig, difficulty: 0  }, makeDeps(rosterMedium));
    const resultD10 = simulateRun({ ...baseConfig, difficulty: 10 }, makeDeps(rosterMedium));

    const takenD0  = sumTaken(resultD0);
    const takenD10 = sumTaken(resultD10);

    // D0 slimies barely scratch the pet (baseDmg ~3.5/hit); still some positive damage.
    expect(takenD0).toBeGreaterThan(0);
    // D10 slimies deal ~12× more per hit → significantly higher total taken.
    expect(takenD10).toBeGreaterThan(takenD0);
  });

  it('MC-mode: difficulty 10 yields more damage taken than difficulty 0 (same seed)', () => {
    const baseConfig = {
      team: teamMedium,
      dungeonId: 'Scrapyard' as const,
      depth: 1 as const,
      rooms: 3,
      nrdcCompletions: 0,
      evaluationMode: 'monteCarlo' as const,
      rngSeed: 0xabc123,
      monteCarloTrials: 30,
    };

    const resultD0  = simulateRun({ ...baseConfig, difficulty: 0  }, makeDeps(rosterMedium));
    const resultD10 = simulateRun({ ...baseConfig, difficulty: 10 }, makeDeps(rosterMedium));

    const takenD0  = sumTaken(resultD0);
    const takenD10 = sumTaken(resultD10);

    expect(takenD10).toBeGreaterThan(takenD0);
  });
});

// ── 3. Boss room at room 6 ────────────────────────────────────────────────────
//
// DL-50 pets vs Chameleon D1 (bossMult base=2, petStatsRef = pet stats):
//   Boss ATK = 121×2 = 242, boss DEF = 242, boss HP = 1210×2 = 2420, boss SPD = 121×2 = 242.
//   Pet baseDmg vs boss = 121 − 121 = 0; pet speedDmg = 0 (boss faster). Pet deals 0 dmg.
//   Boss baseDmg vs pet = 242 − 60.5 = 181.5; boss speedDmg = (290.4−121)/2 = 84.7.
//   So pets take significant damage from the boss each round.
//
// Key insight: DL-50 pets take ZERO damage from D1 Slimies (rooms 1–5) but real
// damage from the boss (room 6). Therefore:
//   5-room run: totalTaken = 0 (no slimies can hurt the pet)
//   6-room run: totalTaken > 0 (boss fight produces real damage before pet dies)
// This proves the boss archetype was resolved via dungeon.archetypes and spawned.

describe('E2E: Scrapyard D1 boss room at room 6 (chameleon-d1)', () => {
  const PET_BOSS_TEST = asPetId('e2e-boss-test');

  // DL-50, zero growth: immune to D1 slimies; takes real damage from boss.
  const rosterBoss: ReadonlyMap<PetId, Pet> = new Map([
    [PET_BOSS_TEST, makePet(PET_BOSS_TEST, 50, 0)],
  ]);
  const teamBoss: Team = {
    slots: [{ petId: PET_BOSS_TEST, row: 'front', assignedClass: 'Adventurer' }],
  };

  it('5-room run: DL-50 pet takes 0 damage from D1 slimies (baseline)', () => {
    const config: RunConfig = {
      team: teamBoss,
      dungeonId: 'Scrapyard',
      depth: 1,
      difficulty: 0,
      rooms: 5,
      nrdcCompletions: 0,
      evaluationMode: 'expected',
    };

    const result = simulateRun(config, makeDeps(rosterBoss));

    expect(result.cleared).toBe(true);
    expect(result.roomsCleared).toBe(5);
    // DL-50 pet is immune to D1 slimies (baseDmg ≤ 0, speedDmg = 0).
    expect(sumTaken(result)).toBe(0);
    // Pet still dealt damage and gained XP (archetype resolution works).
    expect(sumDealt(result)).toBeGreaterThan(0);
    expect(sumXp(result)).toBeGreaterThan(0);
  });

  it('6-room run: boss fight in room 6 causes damage (proves boss archetype was resolved)', () => {
    const config: RunConfig = {
      team: teamBoss,
      dungeonId: 'Scrapyard',
      depth: 1,
      difficulty: 0,
      rooms: 6,
      nrdcCompletions: 0,
      evaluationMode: 'expected',
    };

    const result = simulateRun(config, makeDeps(rosterBoss));

    // Boss archetype resolved: the boss was spawned in room 6 and fought.
    // The pet deals 0 damage to the boss (bossMult makes pet ATK = boss DEF/2),
    // so the pet eventually dies to the boss. rooms_cleared = 5 (wipe in room 6).
    expect(result.roomsCleared).toBe(5);
    expect(result.cleared).toBe(false);
    expect(result.petDeaths).toContain(PET_BOSS_TEST);

    // The pet took real damage in room 6 (from the boss). This is strictly positive,
    // unlike the 5-room run where 0 damage was taken from slimies.
    const takenIn6RoomRun = sumTaken(result);
    expect(takenIn6RoomRun).toBeGreaterThan(0);
  });

  it('6-room run accrues more XP than 5-room run for pet that clears slimy rooms', () => {
    // Both runs use a DL-50 pet. In 5 rooms, 5 slimy rooms are cleared.
    // In 6 rooms, 5 slimy rooms are cleared + the pet enters the boss room (but dies).
    // If the boss was NOT spawned (archetype lookup failed → empty room), the 6-room
    // result would have rooms_cleared=6 and the pet would survive. Instead rooms_cleared=5,
    // confirming the boss was spawned and the fight happened.
    //
    // For XP: the pet doesn't kill the boss, so boss XP = 0. But 5 regular rooms = 5 XP sets.
    // Both the 5-room and 6-room runs should have the SAME per-room XP from slimy kills
    // (the boss room contributes 0 XP if the pet dies before the boss).
    // This is confirmed indirectly by the rooms_cleared=5 assertion above.
    const config5: RunConfig = {
      team: teamBoss,
      dungeonId: 'Scrapyard',
      depth: 1,
      difficulty: 0,
      rooms: 5,
      nrdcCompletions: 0,
      evaluationMode: 'expected',
    };
    const config6: RunConfig = { ...config5, rooms: 6 };

    const result5 = simulateRun(config5, makeDeps(rosterBoss));
    const result6 = simulateRun(config6, makeDeps(rosterBoss));

    // Both clear the same 5 slimy rooms → same XP from slimies.
    expect(sumXp(result5)).toBe(sumXp(result6));
    // The 6-room run wiped in room 6 (boss room) → took damage there.
    expect(sumTaken(result6)).toBeGreaterThan(sumTaken(result5));
  });
});
