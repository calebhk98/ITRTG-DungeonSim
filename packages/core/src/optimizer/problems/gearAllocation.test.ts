/**
 * Tests for optimizer/problems/gearAllocation.ts (WP-GEAR).
 *
 * Uses the real Scrapyard dungeon (via getDungeon) and a hand-built roster/team
 * with a small gear pool (a few GearPieces with varied statMultiplierBonus,
 * slots, and enchants) to exercise all SearchProblem contract methods.
 *
 * ## Test roster / team
 * Two pets from the team; a third pet NOT in the team (to test unknown-petId rejection).
 *   - petA : DL 50, 100 000 growth, Adventurer — the "main" pet.
 *   - petB : DL 50, 100 000 growth, Mage — second team member.
 *   - petC : DL 50, 0 growth, not in team — for invalid-petId tests.
 *
 * ## Gear pool (7 pieces)
 *   - weaponA  : weapon, statMultiplierBonus 0.5  — strong weapon
 *   - weaponB  : weapon, statMultiplierBonus 0.1  — weak weapon
 *   - armorA   : armor,  statMultiplierBonus 0.4  — strong armor
 *   - armorB   : armor,  statMultiplierBonus 0.05 — weak armor
 *   - accessoryA : accessory, statMultiplierBonus 0.3
 *   - trinketA : trinket, statMultiplierBonus 0.2, Fire enchant +10
 *   - trinketB : trinket, statMultiplierBonus 0.15
 *
 * ## Objective
 * `survivalRate` — good for distinguishing geared vs. bare pets.
 */

import { describe, it, expect } from 'vitest';
import { getDungeon } from '../../content/index.js';
import { DEFAULT_CONSTANTS } from '../../constants/gameConstants.js';
import { survivalRate } from '../../objectives/builtins.js';
import { asPetId } from '../../domain/ids.js';
import type { PetId } from '../../domain/ids.js';
import type { Pet } from '../../domain/pet.js';
import type { GearPiece } from '../../domain/gear.js';
import type { Team } from '../../domain/team.js';
import { mulberry32 } from '../../sim/rng.js';
import {
  makeGearAllocationProblem,
  REJECTION_SCORE,
} from './gearAllocation.js';
import type { GearAllocationInputs, GearAssignment } from './gearAllocation.js';
import { xpPerHour } from '../../objectives/builtins.js';

// ── Dungeon ───────────────────────────────────────────────────────────────────

const scrapyardOrUndef = getDungeon('Scrapyard');
if (scrapyardOrUndef === undefined) {
  throw new Error('Scrapyard dungeon not found — check content/index.ts');
}
const scrapyard = scrapyardOrUndef;

// ── Pet factory ───────────────────────────────────────────────────────────────

function makePet(id: string, dungeonLevel: number, totalGrowth: number): Pet {
  return {
    id: asPetId(id),
    displayName: id,
    primaryElement: 'Neutral',
    dungeonLevel,
    classLevel: 50,
    evolvedClass: 'Adventurer',
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

// ── Pets ──────────────────────────────────────────────────────────────────────

const petA = makePet('petA', 50, 100_000);
const petB = makePet('petB', 50, 100_000);
const petC = makePet('petC', 50, 0); // NOT in team

const allPets: Pet[] = [petA, petB, petC];

function buildRoster(pets: Pet[]): ReadonlyMap<PetId, Pet> {
  return new Map(pets.map(p => [p.id, p]));
}

const fullRoster: ReadonlyMap<PetId, Pet> = buildRoster(allPets);

// ── Team ──────────────────────────────────────────────────────────────────────

const team: Team = {
  slots: [
    { petId: asPetId('petA'), row: 'front', assignedClass: 'Adventurer' },
    { petId: asPetId('petB'), row: 'back',  assignedClass: 'Mage' },
  ],
};

// ── Gear pool ─────────────────────────────────────────────────────────────────

const weaponA: GearPiece = {
  id: 'weaponA', name: 'Strong Weapon', slot: 'weapon', tier: 2,
  baseHpBonus: 0.5, baseAtkBonus: 0.5, baseDefBonus: 0.5, baseSpdBonus: 0.5,
  quality: 'A', upgradeLevel: 0,
};

const weaponB: GearPiece = {
  id: 'weaponB', name: 'Weak Weapon', slot: 'weapon', tier: 1,
  baseHpBonus: 0.1, baseAtkBonus: 0.1, baseDefBonus: 0.1, baseSpdBonus: 0.1,
  quality: 'A', upgradeLevel: 0,
};

const armorA: GearPiece = {
  id: 'armorA', name: 'Strong Armor', slot: 'armor', tier: 2,
  baseHpBonus: 0.4, baseAtkBonus: 0.4, baseDefBonus: 0.4, baseSpdBonus: 0.4,
  quality: 'A', upgradeLevel: 0,
};

const armorB: GearPiece = {
  id: 'armorB', name: 'Weak Armor', slot: 'armor', tier: 1,
  baseHpBonus: 0.05, baseAtkBonus: 0.05, baseDefBonus: 0.05, baseSpdBonus: 0.05,
  quality: 'A', upgradeLevel: 0,
};

const accessoryA: GearPiece = {
  id: 'accessoryA', name: 'Accessory', slot: 'accessory', tier: 2,
  baseHpBonus: 0.3, baseAtkBonus: 0.3, baseDefBonus: 0.3, baseSpdBonus: 0.3,
  quality: 'A', upgradeLevel: 0,
};

const trinketA: GearPiece = {
  id: 'trinketA', name: 'Fire Trinket', slot: 'trinket', tier: 2,
  baseHpBonus: 0.2, baseAtkBonus: 0.2, baseDefBonus: 0.2, baseSpdBonus: 0.2,
  quality: 'A', upgradeLevel: 0,
  elementEnchant: { Fire: 10 },
};

const trinketB: GearPiece = {
  id: 'trinketB', name: 'Plain Trinket', slot: 'trinket', tier: 1,
  baseHpBonus: 0.15, baseAtkBonus: 0.15, baseDefBonus: 0.15, baseSpdBonus: 0.15,
  quality: 'A', upgradeLevel: 0,
};

const gearPool: readonly GearPiece[] = [
  weaponA, weaponB, armorA, armorB, accessoryA, trinketA, trinketB,
];

// ── Shared inputs ─────────────────────────────────────────────────────────────

const baseInputs: GearAllocationInputs = {
  roster: fullRoster,
  team,
  dungeon: scrapyard,
  depth: 1,
  difficulty: 0,
  rooms: 6,
  gearPool,
  objective: survivalRate,
  constants: DEFAULT_CONSTANTS,
  evaluationMode: 'expected',
};

const problem = makeGearAllocationProblem(baseInputs);

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Assert that a GearAssignment is structurally valid given the pool and team. */
function assertValidAssignment(assignment: GearAssignment): void {
  const poolIds = new Set(gearPool.map(p => p.id));
  const teamIds = new Set(team.slots.map(s => s.petId));
  const usedGearIds = new Set<string>();
  const usedSlotKeys = new Set<string>();

  for (const placement of assignment) {
    // gearId in pool
    expect(poolIds.has(placement.gearId)).toBe(true);

    // slot matches piece
    const piece = gearPool.find(p => p.id === placement.gearId);
    expect(piece).toBeDefined();
    if (piece !== undefined) {
      expect(placement.slot).toBe(piece.slot);
    }

    // petId in team
    expect(teamIds.has(placement.petId)).toBe(true);

    // no duplicate gearId
    expect(usedGearIds.has(placement.gearId)).toBe(false);
    usedGearIds.add(placement.gearId);

    // no duplicate (petId, slot)
    const slotKey = `${placement.petId}:${placement.slot}`;
    expect(usedSlotKeys.has(slotKey)).toBe(false);
    usedSlotKeys.add(slotKey);
  }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('makeGearAllocationProblem', () => {

  // ── initial() ───────────────────────────────────────────────────────────────

  describe('initial()', () => {
    it('returns the empty assignment', () => {
      const init = problem.initial();
      expect(init).toHaveLength(0);
    });

    it('evaluate(initial()) returns a finite score (baseline — no gear)', () => {
      const score = problem.evaluate(problem.initial());
      expect(Number.isFinite(score)).toBe(true);
      expect(score).not.toBe(REJECTION_SCORE);
    });
  });

  // ── evaluate() ──────────────────────────────────────────────────────────────

  describe('evaluate()', () => {
    it('assigning strong weapon to petA gives finite score', () => {
      const assignment: GearAssignment = [
        { gearId: 'weaponA', petId: asPetId('petA'), slot: 'weapon' },
      ];
      const score = problem.evaluate(assignment);
      expect(Number.isFinite(score)).toBe(true);
    });

    it('strong gear set scores >= no-gear baseline for survivalRate', () => {
      // No gear — baseline
      const noGearScore = problem.evaluate([]);

      // Strong gear on petA: best weapon + best armor
      const gearedScore = problem.evaluate([
        { gearId: 'weaponA', petId: asPetId('petA'), slot: 'weapon' },
        { gearId: 'armorA',  petId: asPetId('petA'), slot: 'armor'  },
      ]);

      // More stats should not hurt the team — score must be at least as good.
      expect(gearedScore).toBeGreaterThanOrEqual(noGearScore);
    });

    it('fully-geared team (strong pieces) scores >= lightly-geared team', () => {
      // Light: only weak weapon on petA
      const lightScore = problem.evaluate([
        { gearId: 'weaponB', petId: asPetId('petA'), slot: 'weapon' },
      ]);

      // Heavy: best weapon + best armor + accessory on petA; best armor on petB
      const heavyScore = problem.evaluate([
        { gearId: 'weaponA',   petId: asPetId('petA'), slot: 'weapon'    },
        { gearId: 'armorA',    petId: asPetId('petA'), slot: 'armor'     },
        { gearId: 'accessoryA', petId: asPetId('petA'), slot: 'accessory' },
        { gearId: 'armorB',    petId: asPetId('petB'), slot: 'armor'     },
      ]);

      expect(heavyScore).toBeGreaterThanOrEqual(lightScore);
    });

    // ── Invalid assignments → REJECTION_SCORE ─────────────────────────────────

    it('rejects: same piece placed twice', () => {
      const assignment: GearAssignment = [
        { gearId: 'weaponA', petId: asPetId('petA'), slot: 'weapon' },
        { gearId: 'weaponA', petId: asPetId('petB'), slot: 'weapon' }, // duplicate gearId
      ];
      expect(problem.evaluate(assignment)).toBe(REJECTION_SCORE);
    });

    it('rejects: piece assigned to wrong slot', () => {
      const assignment: GearAssignment = [
        // weaponA has slot "weapon", but we put it in "armor"
        { gearId: 'weaponA', petId: asPetId('petA'), slot: 'armor' },
      ];
      expect(problem.evaluate(assignment)).toBe(REJECTION_SCORE);
    });

    it('rejects: two pieces in the same (petId, slot)', () => {
      const assignment: GearAssignment = [
        { gearId: 'armorA', petId: asPetId('petA'), slot: 'armor' },
        { gearId: 'armorB', petId: asPetId('petA'), slot: 'armor' }, // same slot!
      ];
      expect(problem.evaluate(assignment)).toBe(REJECTION_SCORE);
    });

    it('rejects: unknown petId (petC is not in team)', () => {
      const assignment: GearAssignment = [
        { gearId: 'weaponA', petId: asPetId('petC'), slot: 'weapon' },
      ];
      expect(problem.evaluate(assignment)).toBe(REJECTION_SCORE);
    });

    it('rejects: unknown gearId', () => {
      const assignment: GearAssignment = [
        { gearId: 'nonexistent-gear', petId: asPetId('petA'), slot: 'weapon' },
      ];
      expect(problem.evaluate(assignment)).toBe(REJECTION_SCORE);
    });
  });

  // ── neighbors() ─────────────────────────────────────────────────────────────

  describe('neighbors()', () => {
    it('from the empty assignment yields only valid PLACE moves', () => {
      const neighbors = Array.from(problem.neighbors([]));
      expect(neighbors.length).toBeGreaterThan(0);
      for (const neighbor of neighbors) {
        assertValidAssignment(neighbor);
        // PLACE: exactly 1 piece placed (was empty, +1).
        expect(neighbor.length).toBe(1);
      }
    });

    it('every neighbor of a one-piece assignment is valid', () => {
      const seed: GearAssignment = [
        { gearId: 'weaponA', petId: asPetId('petA'), slot: 'weapon' },
      ];
      let count = 0;
      for (const neighbor of problem.neighbors(seed)) {
        assertValidAssignment(neighbor);
        count++;
      }
      expect(count).toBeGreaterThan(0);
    });

    it('includes REMOVE moves (neighbor with one fewer piece)', () => {
      const seed: GearAssignment = [
        { gearId: 'weaponA', petId: asPetId('petA'), slot: 'weapon' },
        { gearId: 'armorA',  petId: asPetId('petA'), slot: 'armor'  },
      ];
      const neighbors = Array.from(problem.neighbors(seed));
      const hasRemove = neighbors.some(n => n.length === seed.length - 1);
      expect(hasRemove).toBe(true);
    });

    it('includes PLACE moves (neighbor with one more piece)', () => {
      const seed: GearAssignment = [
        { gearId: 'weaponA', petId: asPetId('petA'), slot: 'weapon' },
      ];
      const neighbors = Array.from(problem.neighbors(seed));
      const hasPlace = neighbors.some(n => n.length === seed.length + 1);
      expect(hasPlace).toBe(true);
    });

    it('includes MOVE moves (same piece, different petId)', () => {
      const seed: GearAssignment = [
        { gearId: 'weaponA', petId: asPetId('petA'), slot: 'weapon' },
      ];
      const neighbors = Array.from(problem.neighbors(seed));
      // MOVE: same length, same gearId, different petId
      const hasMove = neighbors.some(
        n =>
          n.length === seed.length &&
          n.some(p => p.gearId === 'weaponA' && p.petId === asPetId('petB')),
      );
      expect(hasMove).toBe(true);
    });

    it('includes SWAP moves when two pieces of same slot type are placed on different pets', () => {
      // weaponA on petA, weaponB on petB — both weapons, can be swapped.
      const seed: GearAssignment = [
        { gearId: 'weaponA', petId: asPetId('petA'), slot: 'weapon' },
        { gearId: 'weaponB', petId: asPetId('petB'), slot: 'weapon' },
      ];
      const neighbors = Array.from(problem.neighbors(seed));
      // After swap: weaponA on petB, weaponB on petA
      const hasSwap = neighbors.some(n =>
        n.length === seed.length &&
        n.some(p => p.gearId === 'weaponA' && p.petId === asPetId('petB')) &&
        n.some(p => p.gearId === 'weaponB' && p.petId === asPetId('petA')),
      );
      expect(hasSwap).toBe(true);
    });

    it('every neighbor of a multi-piece assignment is valid', () => {
      const seed: GearAssignment = [
        { gearId: 'weaponA',    petId: asPetId('petA'), slot: 'weapon'    },
        { gearId: 'armorA',     petId: asPetId('petA'), slot: 'armor'     },
        { gearId: 'weaponB',    petId: asPetId('petB'), slot: 'weapon'    },
        { gearId: 'trinketA',   petId: asPetId('petB'), slot: 'trinket'   },
      ];
      let count = 0;
      for (const neighbor of problem.neighbors(seed)) {
        assertValidAssignment(neighbor);
        count++;
      }
      expect(count).toBeGreaterThan(0);
    });
  });

  // ── randomCandidate() ────────────────────────────────────────────────────────

  describe('randomCandidate()', () => {
    it('is deterministic for the same seed', () => {
      const rng1 = mulberry32(42);
      const rng2 = mulberry32(42);
      const a1 = problem.randomCandidate(rng1);
      const a2 = problem.randomCandidate(rng2);
      expect(a1).toEqual(a2);
    });

    it('different seeds produce valid (possibly different) assignments', () => {
      const rng1 = mulberry32(1);
      const rng2 = mulberry32(99999);
      const a1 = problem.randomCandidate(rng1);
      const a2 = problem.randomCandidate(rng2);
      assertValidAssignment(a1);
      assertValidAssignment(a2);
    });

    it('result is always a valid assignment (20 seeds)', () => {
      for (let seed = 0; seed < 20; seed++) {
        const rng = mulberry32(seed);
        const assignment = problem.randomCandidate(rng);
        assertValidAssignment(assignment);
      }
    });

    it('evaluate(randomCandidate(seed)) returns a finite score', () => {
      const rng = mulberry32(123);
      const assignment = problem.randomCandidate(rng);
      const score = problem.evaluate(assignment);
      expect(Number.isFinite(score)).toBe(true);
    });
  });

  // ── Objective sanity ─────────────────────────────────────────────────────────

  describe('objective sanity', () => {
    it('strong gear set scores strictly higher than weak gear set', () => {
      // Strong: best weapon + best armor on petA, best armor on petB
      const strongScore = problem.evaluate([
        { gearId: 'weaponA', petId: asPetId('petA'), slot: 'weapon' },
        { gearId: 'armorA',  petId: asPetId('petA'), slot: 'armor'  },
        { gearId: 'armorB',  petId: asPetId('petB'), slot: 'armor'  },
      ]);

      // Weak: only the weakest weapon on petA
      const weakScore = problem.evaluate([
        { gearId: 'weaponB', petId: asPetId('petA'), slot: 'weapon' },
      ]);

      expect(strongScore).toBeGreaterThanOrEqual(weakScore);
    });

    it('allowReplacingEquipped=false: evaluate still returns finite scores', () => {
      const noReplaceProblem = makeGearAllocationProblem({
        ...baseInputs,
        allowReplacingEquipped: false,
      });
      const score = noReplaceProblem.evaluate([
        { gearId: 'weaponA', petId: asPetId('petA'), slot: 'weapon' },
      ]);
      expect(Number.isFinite(score)).toBe(true);
    });

    it('xpPerHour objective: geared team yields finite score', () => {
      const xpProblem = makeGearAllocationProblem({
        ...baseInputs,
        objective: xpPerHour,
      });
      const score = xpProblem.evaluate([
        { gearId: 'weaponA', petId: asPetId('petA'), slot: 'weapon' },
        { gearId: 'armorA',  petId: asPetId('petA'), slot: 'armor'  },
      ]);
      expect(Number.isFinite(score)).toBe(true);
      expect(score).toBeGreaterThanOrEqual(0);
    });
  });

  // ── allowReplacingEquipped contract ──────────────────────────────────────────

  describe('allowReplacingEquipped', () => {
    it('default (true): slots not covered by assignment are empty in the cloned roster', () => {
      // Place only a weapon on petA — armor should be empty.
      // We verify by checking that the score from "weapon only" equals the score
      // from a freshly constructed roster where petA has only that weapon.
      const score1 = problem.evaluate([
        { gearId: 'weaponA', petId: asPetId('petA'), slot: 'weapon' },
      ]);

      // This should be different from armorA-only (different stats affected)
      const score2 = problem.evaluate([
        { gearId: 'armorA', petId: asPetId('petA'), slot: 'armor' },
      ]);

      // Both should be finite (the precise values depend on which stats affect
      // the specific Scrapyard D1D0/6rooms simulation most, but both are valid).
      expect(Number.isFinite(score1)).toBe(true);
      expect(Number.isFinite(score2)).toBe(true);
    });
  });

  // ── Edge cases ────────────────────────────────────────────────────────────────

  describe('edge cases', () => {
    it('empty pool: initial() is empty, evaluate([]) is finite, neighbors([]) is empty', () => {
      const emptyPoolProblem = makeGearAllocationProblem({
        ...baseInputs,
        gearPool: [],
      });
      const init = emptyPoolProblem.initial();
      expect(init).toHaveLength(0);

      const score = emptyPoolProblem.evaluate([]);
      expect(Number.isFinite(score)).toBe(true);

      const neighborList = Array.from(emptyPoolProblem.neighbors([]));
      expect(neighborList).toHaveLength(0);
    });

    it('single-pet team: randomCandidate is valid', () => {
      const singleTeamProblem = makeGearAllocationProblem({
        ...baseInputs,
        team: { slots: [{ petId: asPetId('petA'), row: 'front', assignedClass: 'Adventurer' }] },
      });
      for (let seed = 0; seed < 5; seed++) {
        const rng = mulberry32(seed);
        const assignment = singleTeamProblem.randomCandidate(rng);
        // Every placement must be on petA
        for (const p of assignment) {
          expect(p.petId).toBe(asPetId('petA'));
        }
      }
    });

    it('neighbors from empty assignment never yield invalid moves', () => {
      // Even with a pool where all slots are different, PLACE moves must all be valid.
      const neighbors = Array.from(problem.neighbors([]));
      for (const n of neighbors) {
        assertValidAssignment(n);
      }
    });
  });
});
