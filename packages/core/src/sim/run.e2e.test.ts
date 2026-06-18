/**
 * End-to-end integration tests for the run executor (WP-H) against REAL
 * dungeon content (content/index.ts → getDungeon(...)).
 *
 * These tests verify the full pipeline:
 *   real Dungeon content → simulateRun → RunResult
 *
 * They prove:
 *   1. Archetype resolution works: enemies actually fight (dealt > 0, xpGained > 0).
 *   2. Per-difficulty scaling is end-to-end: difficulty 10 yields strictly more
 *      total damage taken by the party than difficulty 0.
 *   3. Boss room at room 6 (depth 1) is encountered: the boss is spawned and fought,
 *      evidenced by the 6-room run gaining substantially more XP than the 5-room run
 *      (the OozingInventor (Boss) grants 150 XP per kill, far above regular slimies at 15–22).
 *
 * ## Dungeon choice for difficulty-scaling test
 *
 * The real Scrapyard D1 enemies (AngelSlimy, MetalSlimy, etc.) have:
 *   - base atk: 0–20 (GhostSlimy atk=0, UnstableSlimy atk=999 but that's Explode type)
 *   - Typical: AngelSlimy atk=15, scaling=0.4/0.5 so perDiff.atk=8
 *
 * For baseDmg > 0 at Diff 0, we need pet DEF < 2 × enemy_atk, i.e. DEF < 30 for AngelSlimy.
 * Pet DEF formula: (1 + 2.4 × DL) × 1.0 (Adventurer class, no gear, no growth).
 *   DL=5: DEF = 1 + 12 = 13. AngelSlimy atk=15 vs DEF=13: baseDmg = 15 − 6.5 = 8.5 → positive.
 *   DL=5, Diff 10: AngelSlimy atk=15+8×10=95 vs DEF=13: baseDmg = 95 − 6.5 = 88.5 → ~10× more.
 *
 * We use DL-5 pets (not DL-30 as in the old placeholder-stat test) because the real
 * D1 enemies are the starter-dungeon entries from the original spreadsheet with
 * genuinely low attack values.  The DL-5 pet is just strong enough to kill them but
 * weak enough to take real damage at Diff 0 — and significantly more at Diff 10.
 *
 * ## Boss room test
 *
 * The real D1 boss is OozingInventor (Boss): hp=1000, atk=1, def=40, spd=30.
 * Its attack type is "Summon" (it summons slimies), so its base atk=1 means it
 * deals effectively 0 damage in the combat sim.  The test therefore cannot rely
 * on damage-taken to prove the boss was encountered.
 *
 * Instead we verify XP: OozingInventor grants 150 XP on kill (vs 15–22 for regular slimies).
 * A DL-5 pet can kill both the slimies and the OozingInventor (hp=1000, def=40 — killable).
 * A 6-room run (5 regular + 1 boss room) should gain MORE XP than a 5-room run because
 * the boss kill grants a large XP bonus.  This confirms the boss archetype was resolved
 * and fought — if archetype resolution failed and the room was empty, XP would not increase.
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
// DL-30 pets (ATK≈DEF≈SPD≈73, HP≈730, no growth) vs D1 slimies (base atk 0–20):
//   At Diff 0, slimy ATK (15) vs pet DEF (73): baseDmg = 15 − 36.5 = −21.5 → 0.
//   Pets deal positive damage to slimies (pet ATK 73 >> slimy DEF 8–200).
//   Archetype resolution works if dealt>0 and xpGained>0.

describe('E2E: Scrapyard D1 — real archetype resolution', () => {
  const PET_STRONG = asPetId('e2e-strong');
  const rosterStrong: ReadonlyMap<PetId, Pet> = new Map([
    [PET_STRONG, makePet(PET_STRONG, 30, 0)],
  ]);
  const teamStrong: Team = {
    slots: [{ petId: PET_STRONG, row: 'front', assignedClass: 'Adventurer' }],
  };

  it('DL-30 pet kills real D1 slimies: dealt > 0, xpGained > 0', () => {
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

    expect(result.roomsCleared).toBe(3);
    expect(result.cleared).toBe(true);
    expect(result.petDeaths).toHaveLength(0);

    const dealt = sumDealt(result);
    const xpGained = sumXp(result);
    expect(dealt).toBeGreaterThan(0);
    expect(xpGained).toBeGreaterThan(0);
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
// Scrapyard D1 with DL-5 pets:
//   Pet DEF = (1 + 2.4×5) × 1.0 = 13 (Adventurer, no gear, no growth).
//   AngelSlimy (the first non-boss D1 enemy, scaling 0.4/0.5):
//     Diff 0: atk=15; baseDmg = 15 − 6.5 = 8.5   → real positive damage.
//     Diff 10: atk=15+8×10=95; baseDmg = 95 − 6.5 = 88.5 → ~10× more per hit.
//
// We use DL-5 (not DL-30 as the old placeholder-stat test did) because the real
// enemy spreadsheet values are the true starter-dungeon stats from the original
// game data.  The intent (higher difficulty → more damage taken) is preserved.

describe('E2E: Per-difficulty scaling — Scrapyard D1, DL-5 pets, difficulty 0 vs difficulty 10', () => {
  const PET_SMALL = asPetId('e2e-small');

  // DL-5, zero growth: DEF = (1 + 2.4×5) × 1.0 = 13.
  const rosterSmall: ReadonlyMap<PetId, Pet> = new Map([
    [PET_SMALL, makePet(PET_SMALL, 5, 0)],
  ]);
  const teamSmall: Team = {
    slots: [{ petId: PET_SMALL, row: 'front', assignedClass: 'Adventurer' }],
  };

  it('expected-mode: difficulty 10 deals strictly more damage to the party than difficulty 0', () => {
    const baseConfig = {
      team: teamSmall,
      dungeonId: 'Scrapyard' as const,
      depth: 1 as const,
      rooms: 3,
      nrdcCompletions: 0,
      evaluationMode: 'expected' as const,
    };

    const resultD0  = simulateRun({ ...baseConfig, difficulty: 0  }, makeDeps(rosterSmall));
    const resultD10 = simulateRun({ ...baseConfig, difficulty: 10 }, makeDeps(rosterSmall));

    const takenD0  = sumTaken(resultD0);
    const takenD10 = sumTaken(resultD10);

    // Diff 0: AngelSlimy atk=15 vs pet DEF=13 → baseDmg=8.5 → positive.
    expect(takenD0).toBeGreaterThan(0);
    // Diff 10: AngelSlimy atk=95 vs pet DEF=13 → baseDmg=88.5 → ~10× more per hit.
    expect(takenD10).toBeGreaterThan(takenD0);
  });

  it('MC-mode: difficulty 10 yields more damage taken than difficulty 0 (same seed)', () => {
    const baseConfig = {
      team: teamSmall,
      dungeonId: 'Scrapyard' as const,
      depth: 1 as const,
      rooms: 3,
      nrdcCompletions: 0,
      evaluationMode: 'monteCarlo' as const,
      rngSeed: 0xabc123,
      monteCarloTrials: 30,
    };

    const resultD0  = simulateRun({ ...baseConfig, difficulty: 0  }, makeDeps(rosterSmall));
    const resultD10 = simulateRun({ ...baseConfig, difficulty: 10 }, makeDeps(rosterSmall));

    const takenD0  = sumTaken(resultD0);
    const takenD10 = sumTaken(resultD10);

    expect(takenD10).toBeGreaterThan(takenD0);
  });
});

// ── 3. Boss room at room 6 ────────────────────────────────────────────────────
//
// The real D1 boss is OozingInventor (Boss):
//   hp=1000, atk=1, def=40, spd=30, xpValue=150, scaling=0.4/0.5
//   perDiff.atk = round(1 × 0.5) = 1, so even Diff 10: atk=11 → baseDmg ≈ 0.
//   (The OozingInventor uses "Summon" attack type; its direct atk stat is vestigial.)
//
// A DL-30 pet (ATK≈73) can kill it (hp=1000, def=40 → not immune), gaining 150 XP.
// Regular D1 slimies grant 15–22 XP each.
//
// Strategy: 5-room run vs 6-room run (adding boss room 6).
//   The OozingInventor kill grants +150 XP ON TOP of regular slimy XP.
//   5-room XP: kills from 5 slimy rooms (~5 × 1 slimy × ~15–22 XP = ~75–110 XP).
//   6-room XP: same + OozingInventor kill (+150 XP) → substantially higher.
// This proves the boss archetype ("OozingInventor (Boss)") was resolved and fought.

describe('E2E: Scrapyard D1 boss room at room 6 (OozingInventor (Boss))', () => {
  const PET_BOSS_TEST = asPetId('e2e-boss-test');

  // DL-30 pet: strong enough to kill the OozingInventor (hp=1000, def=40).
  // Pet ATK = (1 + 2.4×30) × 1.0 = 73. Boss DEF=40; baseDmg = 73 − 20 = 53 per hit.
  // With ~3 hits to kill boss (hp=1000, need ~19 hits at 53/hit). Pet will survive
  // since boss atk=1 (at Diff 0) does effectively 0 damage.
  const rosterBoss: ReadonlyMap<PetId, Pet> = new Map([
    [PET_BOSS_TEST, makePet(PET_BOSS_TEST, 30, 0)],
  ]);
  const teamBoss: Team = {
    slots: [{ petId: PET_BOSS_TEST, row: 'front', assignedClass: 'Adventurer' }],
  };

  it('6-room run clears all 6 rooms (DL-30 pet kills slimies AND the OozingInventor)', () => {
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

    // OozingInventor atk=1, def=40. Pet ATK=73 → can kill boss.
    // Boss does ~0 damage to the pet (atk=1, pet def=73 → baseDmg = 1 − 36.5 = negative → 0).
    expect(result.cleared).toBe(true);
    expect(result.roomsCleared).toBe(6);
    expect(result.petDeaths).toHaveLength(0);
    // XP must be positive (enemies killed).
    expect(sumXp(result)).toBeGreaterThan(0);
  });

  it('6-room run earns MORE xp than 5-room run (boss kill grants 150 XP vs ~15–22 per slimy)', () => {
    // This is the key test: the large XP jump proves the boss archetype was resolved
    // and the boss was killed.  If archetype lookup failed (empty room), rooms_cleared
    // would still be 6 but XP would not jump — making this assertion fail.
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

    // 6-room run adds the boss room; the OozingInventor has xpValue=150.
    // Regular slimies grant 15–22 each, so boss kill should produce a significant XP boost.
    const xp5 = sumXp(result5);
    const xp6 = sumXp(result6);
    expect(xp6).toBeGreaterThan(xp5);

    // The jump must be at least the boss XP (150) minus one typical slimy room's XP (~22 max).
    // In expected mode, 1 enemy per room → boss room XP ≥ 150, slimy room ≤ 22.
    // Net delta ≥ 150 − 22 = 128 for any reasonable scenario.
    expect(xp6 - xp5).toBeGreaterThanOrEqual(100);
  });
});
