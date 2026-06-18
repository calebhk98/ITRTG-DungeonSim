/**
 * WP-JOINT: Joint multi-dimension optimizer (coordinate descent).
 *
 * Optimizes farm-target, team composition, and gear allocation jointly via
 * coordinate descent: each round fixes two dimensions and optimizes the third
 * in turn (farm → team → gear), repeating until convergence or maxRounds.
 * The final solution is re-ranked under Monte Carlo for a stochastic score.
 *
 * ## Dimension order per round
 *   1. farm  — EnumerationOptimizer over (depth × difficulty × rooms)
 *   2. team  — GreedyOptimizer over pet selection / class / row
 *   3. gear  — GreedyOptimizer over gear placements (skipped if gearPool empty)
 *
 * ## Stopping rule
 * After each complete round the combined EV score is compared to the previous
 * round's score. If the improvement is < CONVERGENCE_EPSILON the loop stops
 * early. The loop always runs at least one complete round.
 *
 * ## applyGear helper
 * `applyGear(roster, team, assignment, gearPool)` clones the roster with each
 * team pet's equipment replaced by the pieces in `assignment` (full-replace
 * semantics: slots not covered by the assignment are left empty on team pets).
 * The `gearPool` is required to resolve gearId references to GearPiece objects;
 * this mirrors the semantics of gearAllocation.ts `buildClonedRoster` exactly.
 *
 * ## Gear limitation (important)
 * With pets imported from the real ITRTG export (which carry `Pet.observed`),
 * `deriveCombatContext` uses the observed (already gear-inclusive) stats and
 * IGNORES `pet.equipment` — so the **gear dimension is effectively a no-op for
 * observed-stat rosters** (gear only changes outcomes in the derive/what-if path
 * where `observed` is absent). The farm-target and team dimensions still benefit
 * from optimization. Note this clearly when interpreting results; the gear step
 * is fully meaningful for synthetic/derived rosters (pets without `observed`).
 */

import type { GameConstants } from '../constants/types.js';
import type { Depth, Difficulty, Dungeon } from '../domain/dungeon.js';
import type { Pet } from '../domain/pet.js';
import type { PetId } from '../domain/ids.js';
import type { Team, TeamSlot } from '../domain/team.js';
import type { GearInventory, GearPiece, GearSlot, EquipmentLoadout } from '../domain/gear.js';
import type { Objective, ObjectiveContext } from '../objectives/Objective.js';
import type { GlobalModifiers } from '../sim/stats.js';
import { simulateRun } from '../sim/run.js';
import { mulberry32 } from '../sim/rng.js';
import { makeFarmTargetProblem } from './problems/farmTarget.js';
import type { FarmTargetCandidate } from './problems/farmTarget.js';
import { makeTeamCompositionProblem } from './problems/teamComposition.js';
import { makeGearAllocationProblem } from './problems/gearAllocation.js';
import type { GearAssignment } from './problems/gearAllocation.js';
import { EnumerationOptimizer } from './algorithms/enumeration.js';
import { GreedyOptimizer } from './algorithms/greedy.js';

// ── Constants ─────────────────────────────────────────────────────────────────

/** Default RNG seed used when none is supplied. */
const DEFAULT_RNG_SEED = 0xc0ffee42;

/** Convergence tolerance: stop when score improvement per round is below this. */
const CONVERGENCE_EPSILON = 1e-9;

/** Default max team size (matches TeamCompositionProblem). */
const DEFAULT_MAX_TEAM_SIZE = 6;

/** Default coordinate-descent rounds. */
const DEFAULT_MAX_ROUNDS = 5;

/** Default per-sub-optimizer iteration budget. */
const DEFAULT_INNER_MAX_ITERATIONS = 200;

/** Default Monte Carlo trials for final re-rank. */
const DEFAULT_MC_TRIALS = 100;

// ── Public types ──────────────────────────────────────────────────────────────

/**
 * All inputs for the joint multi-dimension optimizer.
 */
export interface JointOptimizeInputs {
  /** Full pet roster available for team-building. */
  readonly roster: ReadonlyMap<PetId, Pet>;
  /** The dungeon definition (enemy tables, boss archetypes, element). */
  readonly dungeon: Dungeon;
  /** Objective to maximise across all dimensions. */
  readonly objective: Objective;
  /** Authoritative game constants. */
  readonly constants: GameConstants;
  /** Optional roster-level global modifiers (Dojo, Strategy Room, PGC, etc.). */
  readonly globals?: GlobalModifiers | undefined;
  /**
   * Pool of gear pieces available for the gear dimension.
   * If omitted or empty, the gear dimension is skipped entirely.
   */
  readonly gearPool?: GearInventory | undefined;
  // ── Farm-target search-space knobs ──────────────────────────────────────────
  /** Depth choices to enumerate. Default: [1, 2, 3, 4]. */
  readonly depthChoices?: Depth[] | undefined;
  /** Difficulty choices to enumerate. Default: [0..10]. */
  readonly difficultyChoices?: Difficulty[] | undefined;
  /** Room-count choices to enumerate. Default: [6, 16, 30, 48]. */
  readonly roomChoices?: number[] | undefined;
  /** NRDC completions (reduces time per room). Default: 0. */
  readonly nrdcCompletions?: number | undefined;
  // ── Algorithm knobs ─────────────────────────────────────────────────────────
  /** Maximum team size. Default: 6. */
  readonly maxTeamSize?: number | undefined;
  /** Maximum coordinate-descent rounds. Default: 5. */
  readonly maxRounds?: number | undefined;
  /** Per-sub-optimizer evaluate() budget. Default: 200. */
  readonly innerMaxIterations?: number | undefined;
  /** Monte Carlo trials for final re-ranking. Default: 100. */
  readonly monteCarloTrials?: number | undefined;
  /** RNG seed for determinism. Default: 0xc0ffee42. */
  readonly rngSeed?: number | undefined;
}

/**
 * The output of `optimizeJoint`.
 */
export interface JointResult {
  /** Best team found by coordinate descent. */
  readonly team: Team;
  /**
   * Best gear assignment found. Empty array when gear dimension was skipped
   * (gearPool absent or empty).
   */
  readonly gearAssignment: GearAssignment;
  /** Best farm target found. */
  readonly farmTarget: {
    readonly depth: Depth;
    readonly difficulty: Difficulty;
    readonly rooms: number;
  };
  /** Expected-value score of the final solution (EV mode, deterministic). */
  readonly scoreEV: number;
  /** Monte Carlo re-rank score of the final solution (stochastic). */
  readonly scoreMC: number;
  /** Number of coordinate-descent rounds actually executed. */
  readonly rounds: number;
  /** Per-phase score trace, ordered chronologically. */
  readonly trace: ReadonlyArray<{
    readonly round: number;
    readonly phase: 'farm' | 'team' | 'gear';
    readonly score: number;
  }>;
}

// ── Helper: applyGear ─────────────────────────────────────────────────────────

/**
 * Build a cloned roster in which each team pet's `equipment` is replaced by the
 * gear pieces specified in `assignment` (full-replace semantics).
 *
 * Application semantics (mirrors gearAllocation.ts `buildClonedRoster` with
 * `allowReplacingEquipped: true`):
 *   - Each team pet starts with an empty loadout.
 *   - Only pieces explicitly in `assignment` are placed.
 *   - Slots not covered by the assignment remain empty.
 *   - Non-team pets are passed through unchanged.
 *
 * The `gearPool` parameter is required to resolve `gearId` references (from
 * GearPlacement) to full `GearPiece` objects needed for `Pet.equipment`.
 *
 * @param roster     - Full roster (read-only).
 * @param team       - Current team (determines which pets are "team pets").
 * @param assignment - Gear placements to apply.
 * @param gearPool   - Pool from which GearPiece objects are resolved.
 * @returns A new Map with cloned team pets bearing the new equipment.
 */
export function applyGear(
  roster: ReadonlyMap<PetId, Pet>,
  team: Team,
  assignment: GearAssignment,
  gearPool: GearInventory,
): ReadonlyMap<PetId, Pet> {
  // Build gearId → GearPiece index from the pool for O(1) resolution.
  const poolById = new Map<string, GearPiece>();
  for (const piece of gearPool) {
    poolById.set(piece.id, piece);
  }

  // Build petId → slot → GearPiece index from the assignment.
  const placementByPet = new Map<PetId, Map<GearSlot, GearPiece>>();
  for (const placement of assignment) {
    const piece = poolById.get(placement.gearId);
    if (piece === undefined) continue; // defensive: validated upstream
    let bySlot = placementByPet.get(placement.petId);
    if (bySlot === undefined) {
      bySlot = new Map();
      placementByPet.set(placement.petId, bySlot);
    }
    bySlot.set(placement.slot, piece);
  }

  const teamPetIds = new Set<PetId>(team.slots.map(s => s.petId));

  const cloned = new Map<PetId, Pet>();
  for (const [petId, pet] of roster) {
    if (!teamPetIds.has(petId)) {
      // Not a team pet — include unchanged.
      cloned.set(petId, pet);
      continue;
    }

    // Full-replace semantics: start from empty loadout, place only assigned pieces.
    const eq: Partial<Record<GearSlot, GearPiece>> = {};
    const assignedSlots = placementByPet.get(petId);
    if (assignedSlots !== undefined) {
      for (const [slot, piece] of assignedSlots) {
        eq[slot] = piece;
      }
    }

    const clonedPet: Pet = { ...pet, equipment: eq as EquipmentLoadout };
    cloned.set(petId, clonedPet);
  }

  return cloned;
}

// ── Helper: filterAssignmentToTeam ───────────────────────────────────────────

/**
 * Filter a GearAssignment to remove any placement whose petId is no longer
 * present in the given team. Called after a team update to keep the gear state
 * consistent with the new team membership.
 *
 * This is necessary because coordinate descent may replace team pets, invalidating
 * gear placements that referenced the removed pets.
 */
export function filterAssignmentToTeam(
  assignment: GearAssignment,
  team: Team,
): GearAssignment {
  const teamPetIds = new Set<PetId>(team.slots.map(s => s.petId));
  return assignment.filter(p => teamPetIds.has(p.petId));
}

// ── Internal: score helpers ───────────────────────────────────────────────────

/**
 * Evaluate the combined EV score for a given (team, farmTarget, gearedRoster)
 * using simulateRun in 'expected' mode. Returns -Infinity on error or infeasibility.
 */
function computeScoreEV(
  team: Team,
  farmTarget: FarmTargetCandidate,
  gearedRoster: ReadonlyMap<PetId, Pet>,
  dungeon: Dungeon,
  objective: Objective,
  constants: GameConstants,
  globals: GlobalModifiers | undefined,
  nrdcCompletions: number,
): number {
  const config = {
    team,
    dungeonId: dungeon.id,
    depth: farmTarget.depth,
    difficulty: farmTarget.difficulty,
    rooms: farmTarget.rooms,
    nrdcCompletions,
    evaluationMode: 'expected' as const,
  };

  let result;
  try {
    result = simulateRun(config, {
      dungeon,
      roster: gearedRoster,
      constants,
      ...(globals !== undefined ? { globals } : {}),
    });
  } catch {
    return -Infinity;
  }

  const ctx: ObjectiveContext = { config, result, constants };

  if (objective.feasible !== undefined && !objective.feasible(ctx)) {
    return -Infinity;
  }

  return objective.score(ctx);
}

/**
 * Evaluate the combined Monte Carlo score for the final solution.
 * Returns -Infinity on error or infeasibility.
 */
function computeScoreMC(
  team: Team,
  farmTarget: FarmTargetCandidate,
  gearedRoster: ReadonlyMap<PetId, Pet>,
  dungeon: Dungeon,
  objective: Objective,
  constants: GameConstants,
  globals: GlobalModifiers | undefined,
  nrdcCompletions: number,
  monteCarloTrials: number,
  rngSeed: number,
): number {
  const config = {
    team,
    dungeonId: dungeon.id,
    depth: farmTarget.depth,
    difficulty: farmTarget.difficulty,
    rooms: farmTarget.rooms,
    nrdcCompletions,
    evaluationMode: 'monteCarlo' as const,
    monteCarloTrials,
    rngSeed,
  };

  let result;
  try {
    result = simulateRun(config, {
      dungeon,
      roster: gearedRoster,
      constants,
      ...(globals !== undefined ? { globals } : {}),
    });
  } catch {
    return -Infinity;
  }

  const ctx: ObjectiveContext = { config, result, constants };

  if (objective.feasible !== undefined && !objective.feasible(ctx)) {
    return -Infinity;
  }

  return objective.score(ctx);
}

// ── Main export ───────────────────────────────────────────────────────────────

/**
 * Joint multi-dimension optimizer using coordinate descent.
 *
 * Alternates between optimizing three dimensions, each fixing the other two:
 *   1. Farm target  (EnumerationOptimizer — exhaustive over the small candidate space)
 *   2. Team         (GreedyOptimizer with steepest-ascent hill-climbing)
 *   3. Gear         (GreedyOptimizer with hill-climbing; skipped if gearPool empty)
 *
 * Invariant maintenance after team changes:
 *   - Any gear placements referencing pets no longer on the team are dropped via
 *     `filterAssignmentToTeam` before the gear phase of the same round.
 *   - `gearedRoster` is recomputed after both team and gear updates.
 *
 * Stopping rule:
 *   - After each complete round, the combined EV score is compared to the previous
 *     round's score. If improvement < CONVERGENCE_EPSILON the loop exits early.
 *   - The loop always executes at least one complete round.
 *
 * All sub-optimizers use EV mode for speed. Monte Carlo is reserved for the
 * final re-ranking step only.
 *
 * @param inputs - Configuration for all three optimization dimensions.
 * @returns A `JointResult` with the best solution found.
 */
export function optimizeJoint(inputs: JointOptimizeInputs): JointResult {
  // ── Resolve parameters ───────────────────────────────────────────────────────

  const maxRounds   = inputs.maxRounds           ?? DEFAULT_MAX_ROUNDS;
  const maxIter     = inputs.innerMaxIterations   ?? DEFAULT_INNER_MAX_ITERATIONS;
  const mcTrials    = inputs.monteCarloTrials     ?? DEFAULT_MC_TRIALS;
  const rngSeed     = inputs.rngSeed              ?? DEFAULT_RNG_SEED;
  const nrdcComp    = inputs.nrdcCompletions      ?? 0;
  const maxTeamSize = inputs.maxTeamSize          ?? DEFAULT_MAX_TEAM_SIZE;

  const gearPool: GearInventory = inputs.gearPool ?? [];
  const hasGear = gearPool.length > 0;

  // All sub-optimizers share a single seeded RNG for full determinism.
  const rng = mulberry32(rngSeed);

  const trace: Array<{
    round: number;
    phase: 'farm' | 'team' | 'gear';
    score: number;
  }> = [];

  // ── Step 1: Initialize state ─────────────────────────────────────────────────
  //
  // Initialize team from makeTeamCompositionProblem.initial() with the initial
  // farm target (first element of each choice list).

  const initFarmTarget: FarmTargetCandidate = makeFarmTargetProblem({
    // Team is not known yet; pass a dummy empty team for the initial() call.
    // The farm problem's initial() only reads the choice arrays, not the team.
    team: { slots: [] as unknown as TeamSlot[] },
    dungeon: inputs.dungeon,
    roster: inputs.roster,
    objective: inputs.objective,
    constants: inputs.constants,
    ...(inputs.globals !== undefined ? { globals: inputs.globals } : {}),
    nrdcCompletions: nrdcComp,
    ...(inputs.depthChoices !== undefined ? { depthChoices: inputs.depthChoices } : {}),
    ...(inputs.difficultyChoices !== undefined
      ? { difficultyChoices: inputs.difficultyChoices }
      : {}),
    ...(inputs.roomChoices !== undefined ? { roomChoices: inputs.roomChoices } : {}),
  }).initial();

  const initTeamProblem = makeTeamCompositionProblem({
    roster: inputs.roster,
    dungeon: inputs.dungeon,
    depth: initFarmTarget.depth,
    difficulty: initFarmTarget.difficulty,
    rooms: initFarmTarget.rooms,
    objective: inputs.objective,
    constants: inputs.constants,
    ...(inputs.globals !== undefined ? { globals: inputs.globals } : {}),
    nrdcCompletions: nrdcComp,
    maxTeamSize,
    evaluationMode: 'expected',
  });

  let currentTeam: Team = initTeamProblem.initial();
  let currentGearAssignment: GearAssignment = [];
  let currentFarmTarget: FarmTargetCandidate = initFarmTarget;

  // Compute initial gearedRoster.
  let gearedRoster: ReadonlyMap<PetId, Pet> = hasGear
    ? applyGear(inputs.roster, currentTeam, currentGearAssignment, gearPool)
    : inputs.roster;

  // EV score at end of the previous round (used for convergence check).
  let prevRoundScore = -Infinity;

  // ── Step 2: Coordinate descent ───────────────────────────────────────────────

  let roundsRun = 0;

  for (let round = 1; round <= maxRounds; round++) {
    roundsRun = round;

    // ── Phase (a): Farm-target optimization ──────────────────────────────────
    //
    // Fix current team + gearedRoster; enumerate all (depth × difficulty × rooms).

    const farmProblem = makeFarmTargetProblem({
      team: currentTeam,
      dungeon: inputs.dungeon,
      roster: gearedRoster,
      objective: inputs.objective,
      constants: inputs.constants,
      ...(inputs.globals !== undefined ? { globals: inputs.globals } : {}),
      nrdcCompletions: nrdcComp,
      ...(inputs.depthChoices !== undefined ? { depthChoices: inputs.depthChoices } : {}),
      ...(inputs.difficultyChoices !== undefined
        ? { difficultyChoices: inputs.difficultyChoices }
        : {}),
      ...(inputs.roomChoices !== undefined ? { roomChoices: inputs.roomChoices } : {}),
      evaluationMode: 'expected',
    });

    const farmResult = new EnumerationOptimizer().run(farmProblem, {
      maxIterations: maxIter,
    });

    currentFarmTarget = farmResult.best;
    trace.push({ round, phase: 'farm', score: farmResult.score });

    // ── Phase (b): Team optimization ─────────────────────────────────────────
    //
    // Fix current farmTarget + gearedRoster; hill-climb over team.

    const teamProblem = makeTeamCompositionProblem({
      roster: gearedRoster,
      dungeon: inputs.dungeon,
      depth: currentFarmTarget.depth,
      difficulty: currentFarmTarget.difficulty,
      rooms: currentFarmTarget.rooms,
      objective: inputs.objective,
      constants: inputs.constants,
      ...(inputs.globals !== undefined ? { globals: inputs.globals } : {}),
      nrdcCompletions: nrdcComp,
      maxTeamSize,
      evaluationMode: 'expected',
    });

    const teamResult = new GreedyOptimizer(rng).run(teamProblem, {
      maxIterations: maxIter,
    });

    currentTeam = teamResult.best;
    trace.push({ round, phase: 'team', score: teamResult.score });

    // After team update: drop any gear placements that reference pets no longer
    // on the team (e.g. if a pet was swapped out during the team phase).
    currentGearAssignment = filterAssignmentToTeam(currentGearAssignment, currentTeam);

    // Recompute gearedRoster after team update.
    gearedRoster = hasGear
      ? applyGear(inputs.roster, currentTeam, currentGearAssignment, gearPool)
      : inputs.roster;

    // ── Phase (c): Gear optimization (skipped when gearPool is empty) ─────────
    //
    // Fix current farmTarget + team; hill-climb over gear placements.

    if (hasGear) {
      const gearProblem = makeGearAllocationProblem({
        roster: inputs.roster,
        team: currentTeam,
        dungeon: inputs.dungeon,
        depth: currentFarmTarget.depth,
        difficulty: currentFarmTarget.difficulty,
        rooms: currentFarmTarget.rooms,
        gearPool,
        objective: inputs.objective,
        constants: inputs.constants,
        ...(inputs.globals !== undefined ? { globals: inputs.globals } : {}),
        nrdcCompletions: nrdcComp,
        evaluationMode: 'expected',
        allowReplacingEquipped: true,
      });

      const gearResult = new GreedyOptimizer(rng).run(gearProblem, {
        maxIterations: maxIter,
      });

      currentGearAssignment = gearResult.best;
      trace.push({ round, phase: 'gear', score: gearResult.score });

      // Recompute gearedRoster with updated gear assignment.
      gearedRoster = applyGear(inputs.roster, currentTeam, currentGearAssignment, gearPool);
    }

    // ── Convergence check ────────────────────────────────────────────────────
    //
    // Compute the combined EV score for the current state. If it did not improve
    // over the previous round (within epsilon), stop early.

    const roundScore = computeScoreEV(
      currentTeam,
      currentFarmTarget,
      gearedRoster,
      inputs.dungeon,
      inputs.objective,
      inputs.constants,
      inputs.globals,
      nrdcComp,
    );

    if (round > 1 && roundScore - prevRoundScore < CONVERGENCE_EPSILON) {
      break;
    }

    prevRoundScore = roundScore;
  }

  // ── Step 3: Final EV score ───────────────────────────────────────────────────

  const finalScoreEV = computeScoreEV(
    currentTeam,
    currentFarmTarget,
    gearedRoster,
    inputs.dungeon,
    inputs.objective,
    inputs.constants,
    inputs.globals,
    nrdcComp,
  );

  // ── Step 4: Monte Carlo re-rank ──────────────────────────────────────────────

  const finalScoreMC = computeScoreMC(
    currentTeam,
    currentFarmTarget,
    gearedRoster,
    inputs.dungeon,
    inputs.objective,
    inputs.constants,
    inputs.globals,
    nrdcComp,
    mcTrials,
    rngSeed,
  );

  return {
    team: currentTeam,
    gearAssignment: currentGearAssignment,
    farmTarget: {
      depth: currentFarmTarget.depth,
      difficulty: currentFarmTarget.difficulty,
      rooms: currentFarmTarget.rooms,
    },
    scoreEV: finalScoreEV,
    scoreMC: finalScoreMC,
    rounds: roundsRun,
    trace,
  };
}

// ── Re-exports ────────────────────────────────────────────────────────────────

export type { GearAssignment };
