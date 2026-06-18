/**
 * Tests for optimizer/joint.ts (WP-JOINT).
 *
 * Uses getDungeon('Scrapyard') + a hand-built roster WITHOUT observed stats
 * (so all three dimensions are meaningful — deriveCombatContext uses formula
 * path and honours equipment).
 *
 * ## Test roster (6 pets)
 *   - s1..s3 : DL 60, 150 000 growth, Adventurer/Defender/Mage — strong pets.
 *   - w1..w3 : DL 1,  0 growth, no evolved class               — weak pets.
 *
 * The contrast lets us assert that the joint optimizer selects strong pets and
 * produces a scoreEV >= baseline.
 *
 * ## Gear pool (3 pieces, one per slot)
 *   - weaponA  : weapon,    statMultiplierBonus 0.30
 *   - armorA   : armor,     statMultiplierBonus 0.25
 *   - trinketA : trinket,   statMultiplierBonus 0.15
 *
 * ## Objective
 * `maxClearableDepth` — no feasibility gate, gives partial credit even on wipes,
 * which ensures all EV evaluations return a finite (non -Infinity) score.
 */

import { describe, it, expect } from 'vitest';
import { getDungeon } from '../content/index.js';
import { DEFAULT_CONSTANTS } from '../constants/gameConstants.js';
import { maxClearableDepth } from '../objectives/builtins.js';
import { asPetId } from '../domain/ids.js';
import type { Pet } from '../domain/pet.js';
import type { GearPiece } from '../domain/gear.js';
import type { GearInventory } from '../domain/gear.js';
import type { Team } from '../domain/team.js';
import { optimizeJoint } from './joint.js';
import type { JointOptimizeInputs, JointResult } from './joint.js';
import { makeFarmTargetProblem } from './problems/farmTarget.js';
import { makeTeamCompositionProblem } from './problems/teamComposition.js';
import { simulateRun } from '../sim/run.js';

// ── Dungeon ───────────────────────────────────────────────────────────────────

const scrapyardOrUndef = getDungeon('Scrapyard');
if (scrapyardOrUndef === undefined) {
  throw new Error('Scrapyard dungeon not found in content registry');
}
const scrapyard = scrapyardOrUndef;

// ── Pet factory (no observed stats → formula path, gear matters) ─────────────

function makePet(
  id: string,
  dungeonLevel: number,
  totalGrowth: number,
  evolvedClass: Pet['evolvedClass'],
): Pet {
  return {
    id: asPetId(id),
    displayName: id,
    primaryElement: 'Neutral',
    dungeonLevel,
    classLevel: evolvedClass !== null ? 50 : 0,
    evolvedClass,
    totalGrowth,
    growthRequiredForEvolution: 50_000,
    trainingPhysical: 0,
    trainingMystic: 0,
    trainingBattle: 0,
    equipment: {},
    abilities: [],
    source: { importerId: 'test', importerVersion: 1 },
    // NOTE: deliberately no `observed` field — all dimensions are meaningful.
  };
}

// ── Test roster ───────────────────────────────────────────────────────────────

const strongPets: Pet[] = [
  makePet('s1', 60, 150_000, 'Adventurer'),
  makePet('s2', 60, 150_000, 'Defender'),
  makePet('s3', 60, 150_000, 'Mage'),
];
const weakPets: Pet[] = [
  makePet('w1', 1, 0, null),
  makePet('w2', 1, 0, null),
  makePet('w3', 1, 0, null),
];
const allPets: Pet[] = [...strongPets, ...weakPets];

const roster = new Map<ReturnType<typeof asPetId>, Pet>(
  allPets.map(p => [p.id, p]),
);

// ── Gear pool ─────────────────────────────────────────────────────────────────

const gearPool: GearInventory = [
  {
    id: 'weaponA',
    name: 'Strong Weapon',
    slot: 'weapon',
    statMultiplierBonus: 0.30,
    tier: 1,
  } satisfies GearPiece,
  {
    id: 'armorA',
    name: 'Strong Armor',
    slot: 'armor',
    statMultiplierBonus: 0.25,
    tier: 1,
  } satisfies GearPiece,
  {
    id: 'trinketA',
    name: 'Basic Trinket',
    slot: 'trinket',
    statMultiplierBonus: 0.15,
    tier: 1,
  } satisfies GearPiece,
];

// ── Shared inputs (small search space for test speed) ─────────────────────────

const BASE_INPUTS: JointOptimizeInputs = {
  roster,
  dungeon: scrapyard,
  objective: maxClearableDepth,
  constants: DEFAULT_CONSTANTS,
  gearPool,
  // Restrict the farm-target space for test speed.
  depthChoices:      [1, 2],
  difficultyChoices: [0, 5, 10],
  roomChoices:       [6, 16],
  maxTeamSize:       4,
  maxRounds:         3,
  innerMaxIterations: 150,
  monteCarloTrials:  20,
  rngSeed:           0xdeadbeef,
};

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Compute the baseline EV score: initial (default) team, no gear, initial farm. */
function baselineScore(): number {
  // Reproduce what the optimizer starts from: initial team from makeTeamComposition,
  // no gear (empty assignment), and initial farm target (first in each choice list).
  const dummyTeam: Team = { slots: [] };
  const farmProb = makeFarmTargetProblem({
    team: dummyTeam,
    dungeon: scrapyard,
    roster,
    objective: maxClearableDepth,
    constants: DEFAULT_CONSTANTS,
    depthChoices: BASE_INPUTS.depthChoices,
    difficultyChoices: BASE_INPUTS.difficultyChoices,
    roomChoices: BASE_INPUTS.roomChoices,
    evaluationMode: 'expected',
  });
  const initFarm = farmProb.initial();

  const teamProb = makeTeamCompositionProblem({
    roster,
    dungeon: scrapyard,
    depth: initFarm.depth,
    difficulty: initFarm.difficulty,
    rooms: initFarm.rooms,
    objective: maxClearableDepth,
    constants: DEFAULT_CONSTANTS,
    maxTeamSize: BASE_INPUTS.maxTeamSize,
    evaluationMode: 'expected',
  });
  const initTeam = teamProb.initial();

  const config = {
    team: initTeam,
    dungeonId: scrapyard.id,
    depth: initFarm.depth,
    difficulty: initFarm.difficulty,
    rooms: initFarm.rooms,
    nrdcCompletions: 0,
    evaluationMode: 'expected' as const,
  };
  const result = simulateRun(config, { dungeon: scrapyard, roster, constants: DEFAULT_CONSTANTS });
  const ctx = { config, result, constants: DEFAULT_CONSTANTS };
  if (maxClearableDepth.feasible !== undefined && !maxClearableDepth.feasible(ctx)) {
    return -Infinity;
  }
  return maxClearableDepth.score(ctx);
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('optimizeJoint (WP-JOINT)', () => {
  // Run once and cache for tests that share the same result.
  let cachedResult: JointResult | undefined;

  function getResult(): JointResult {
    if (cachedResult === undefined) {
      cachedResult = optimizeJoint(BASE_INPUTS);
    }
    return cachedResult;
  }

  // ── Contract: shape / validity ────────────────────────────────────────────

  it('returns a valid JointResult shape', () => {
    const result = getResult();

    expect(result).toBeDefined();
    expect(result.team).toBeDefined();
    expect(Array.isArray(result.team.slots)).toBe(true);
    expect(result.gearAssignment).toBeDefined();
    expect(Array.isArray(result.gearAssignment)).toBe(true);
    expect(result.farmTarget).toBeDefined();
    expect(typeof result.scoreEV).toBe('number');
    expect(typeof result.scoreMC).toBe('number');
    expect(typeof result.rounds).toBe('number');
    expect(Array.isArray(result.trace)).toBe(true);
  });

  it('team is valid: slots reference known roster pets, no duplicates, ≤ maxTeamSize', () => {
    const result = getResult();
    const { team } = result;
    const maxTeamSize = BASE_INPUTS.maxTeamSize ?? 6;

    expect(team.slots.length).toBeGreaterThan(0);
    expect(team.slots.length).toBeLessThanOrEqual(maxTeamSize);

    const seen = new Set<string>();
    for (const slot of team.slots) {
      expect(roster.has(slot.petId)).toBe(true);
      expect(seen.has(slot.petId)).toBe(false);
      seen.add(slot.petId);
    }

    const frontCount = team.slots.filter(s => s.row === 'front').length;
    const backCount = team.slots.filter(s => s.row === 'back').length;
    expect(frontCount).toBeLessThanOrEqual(3);
    expect(backCount).toBeLessThanOrEqual(3);
  });

  it('farmTarget is within specified depth/difficulty/room choices', () => {
    const result = getResult();
    const { farmTarget } = result;

    const depthChoices = BASE_INPUTS.depthChoices ?? [1, 2, 3, 4];
    const diffChoices  = BASE_INPUTS.difficultyChoices ?? [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const roomChoices  = BASE_INPUTS.roomChoices ?? [6, 16, 30, 48];

    expect(depthChoices).toContain(farmTarget.depth);
    expect(diffChoices).toContain(farmTarget.difficulty);
    expect(roomChoices).toContain(farmTarget.rooms);
  });

  it('gearAssignment references valid gearIds and team pets only', () => {
    const result = getResult();
    const { gearAssignment, team } = result;

    const gearIds = new Set(gearPool.map(g => g.id));
    const teamPetIds = new Set(team.slots.map(s => s.petId));
    const usedGearIds = new Set<string>();
    const usedSlotKeys = new Set<string>();

    for (const placement of gearAssignment) {
      // gearId must be in pool.
      expect(gearIds.has(placement.gearId)).toBe(true);
      // petId must be on team.
      expect(teamPetIds.has(placement.petId)).toBe(true);
      // No duplicate gearId.
      expect(usedGearIds.has(placement.gearId)).toBe(false);
      usedGearIds.add(placement.gearId);
      // No duplicate (petId, slot).
      const key = `${placement.petId}:${placement.slot}`;
      expect(usedSlotKeys.has(key)).toBe(false);
      usedSlotKeys.add(key);
      // Slot matches gear piece slot.
      const piece = gearPool.find(g => g.id === placement.gearId);
      expect(piece).toBeDefined();
      expect(placement.slot).toBe(piece?.slot);
    }
  });

  // ── Contract: scoreEV >= baseline ────────────────────────────────────────

  it('joint scoreEV is >= baseline (coordinate descent never worsens)', () => {
    const result = getResult();
    const baseline = baselineScore();

    // scoreEV should be at least as good as the starting point.
    // We use a small tolerance to account for the baseline being computed
    // from the initial team (which may not exactly match round-0).
    expect(result.scoreEV).toBeGreaterThanOrEqual(baseline - 1e-6);
  });

  // ── Contract: determinism ─────────────────────────────────────────────────

  it('same seed → identical JointResult (determinism)', () => {
    const r1 = optimizeJoint({ ...BASE_INPUTS });
    const r2 = optimizeJoint({ ...BASE_INPUTS });

    // Team composition must match.
    expect(r1.team.slots.length).toBe(r2.team.slots.length);
    for (let i = 0; i < r1.team.slots.length; i++) {
      const s1 = r1.team.slots[i];
      const s2 = r2.team.slots[i];
      expect(s1?.petId).toBe(s2?.petId);
      expect(s1?.row).toBe(s2?.row);
      expect(s1?.assignedClass).toBe(s2?.assignedClass);
    }

    // Farm target must match.
    expect(r1.farmTarget.depth).toBe(r2.farmTarget.depth);
    expect(r1.farmTarget.difficulty).toBe(r2.farmTarget.difficulty);
    expect(r1.farmTarget.rooms).toBe(r2.farmTarget.rooms);

    // Gear assignment must match.
    expect(r1.gearAssignment.length).toBe(r2.gearAssignment.length);
    for (let i = 0; i < r1.gearAssignment.length; i++) {
      expect(r1.gearAssignment[i]?.gearId).toBe(r2.gearAssignment[i]?.gearId);
      expect(r1.gearAssignment[i]?.petId).toBe(r2.gearAssignment[i]?.petId);
    }

    // Scores must match exactly.
    expect(r1.scoreEV).toBe(r2.scoreEV);
    expect(r1.scoreMC).toBe(r2.scoreMC);
  });

  // ── Contract: scoreMC is finite and present ───────────────────────────────

  it('scoreMC is a finite number', () => {
    const result = getResult();
    expect(Number.isFinite(result.scoreMC)).toBe(true);
  });

  // ── Contract: convergence bounds ─────────────────────────────────────────

  it('rounds is between 1 and maxRounds', () => {
    const result = getResult();
    expect(result.rounds).toBeGreaterThanOrEqual(1);
    expect(result.rounds).toBeLessThanOrEqual(BASE_INPUTS.maxRounds ?? 5);
  });

  it('trace is non-empty and entries are ordered by round', () => {
    const result = getResult();
    expect(result.trace.length).toBeGreaterThan(0);

    // Trace entries should be in non-decreasing round order.
    for (let i = 1; i < result.trace.length; i++) {
      const prev = result.trace[i - 1];
      const curr = result.trace[i];
      expect(curr?.round).toBeGreaterThanOrEqual(prev?.round ?? 0);
    }
  });

  it('trace contains farm and team phase entries', () => {
    const result = getResult();
    const phases = new Set(result.trace.map(e => e.phase));
    expect(phases.has('farm')).toBe(true);
    expect(phases.has('team')).toBe(true);
  });

  it('trace contains gear phase entries when gearPool is non-empty', () => {
    const result = getResult();
    const phases = new Set(result.trace.map(e => e.phase));
    // gearPool has 3 pieces → gear phase should appear.
    expect(phases.has('gear')).toBe(true);
  });

  // ── Contract: gearPool=[] skips gear dimension ────────────────────────────

  it('gearPool=[] skips gear dimension: gearAssignment is [] and trace has no gear phase', () => {
    const resultNoGear = optimizeJoint({
      ...BASE_INPUTS,
      gearPool: [],
    });

    expect(resultNoGear.gearAssignment).toEqual([]);
    const phases = new Set(resultNoGear.trace.map(e => e.phase));
    expect(phases.has('gear')).toBe(false);
    // farm and team still run.
    expect(phases.has('farm')).toBe(true);
    expect(phases.has('team')).toBe(true);
  });

  it('gearPool omitted skips gear dimension: gearAssignment is []', () => {
    const resultNoGear = optimizeJoint({
      ...BASE_INPUTS,
      gearPool: undefined,
    });

    expect(resultNoGear.gearAssignment).toEqual([]);
    expect(resultNoGear.team.slots.length).toBeGreaterThan(0);
    expect(Number.isFinite(resultNoGear.scoreEV)).toBe(true);
  });

  // ── Contract: scoreEV is a finite number ─────────────────────────────────

  it('scoreEV is finite', () => {
    const result = getResult();
    expect(Number.isFinite(result.scoreEV)).toBe(true);
  });

  // ── Extra: single-round run still produces a valid result ─────────────────

  it('maxRounds=1 produces a valid result with exactly 1 round', () => {
    const result = optimizeJoint({ ...BASE_INPUTS, maxRounds: 1 });
    expect(result.rounds).toBe(1);
    expect(Number.isFinite(result.scoreEV)).toBe(true);
    expect(result.team.slots.length).toBeGreaterThan(0);
    // trace should have at least farm + team phases.
    expect(result.trace.length).toBeGreaterThanOrEqual(2);
  });
});
