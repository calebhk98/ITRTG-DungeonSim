/**
 * WP-GEAR: GEAR-ALLOCATION SearchProblem adapter (dimension 3).
 *
 * Searches over assignments of gear pieces from a shared pool to pets in a
 * fixed team, to maximise a chosen `Objective`. The pool is a `GearInventory`
 * (ReadonlyArray<GearPiece>); each piece may be assigned to at most one
 * (petId, slot) pair, and that slot must match `GearPiece.slot`.
 *
 * ## Candidate representation
 *
 * `GearAssignment` is a `ReadonlyArray<GearPlacement>` where each element is:
 *   ```ts
 *   { gearId: string; petId: PetId; slot: GearSlot }
 *   ```
 * An array is used rather than a Map so the candidate is fully JSON-serializable
 * and trivially cloneable (spread). Each `gearId` must appear at most once; each
 * `(petId, slot)` pair must appear at most once; the slot must equal the
 * `GearPiece.slot` from the pool; and the petId must be one of the team's pets.
 *
 * The empty array is the valid initial candidate (no gear placed).
 *
 * ## evaluate() wiring
 *   1. Validate the assignment (see `validateAssignment`); return REJECTION_SCORE on error.
 *   2. Build a CLONED roster where each team pet's `equipment` is replaced by the
 *      assignment (honoring `allowReplacingEquipped`).
 *   3. Call `simulateRun(config, { dungeon, roster: clonedRoster, constants, globals })`.
 *   4. Wrap into ObjectiveContext; apply `objective.feasible` rejection.
 *   5. Return `objective.score(ctx)`.
 *
 * ## Neighbor moves (bounded set)
 *   - PLACE   : place an unused pool piece into a free matching (petId, slot).
 *   - REMOVE  : remove a placed piece from the assignment.
 *   - MOVE    : move a placed piece to a different valid (petId, slot) that is free.
 *   - SWAP    : swap two placed pieces' (petId, slot) placements (both must fit the other's slot).
 *
 * ## Limitation
 *
 * Because `deriveCombatContext` currently uses a scalar `statMultiplierBonus`
 * (per-stat gear is a TODO — see stats.ts Step 1), gear is differentiated only by
 * total bonus + element enchant + tier. The optimizer therefore favors higher-bonus
 * pieces and element enchants that fix elemental weaknesses, not per-stat targeting.
 * Once per-stat enchant fields are added to `GearPiece`, this problem will
 * automatically benefit without any changes needed here.
 *
 * Research plan §"Optimizer", §"Work-package breakdown" (WP-GEAR).
 */

import type { SearchProblem } from '../SearchProblem.js';
import type { Rng } from '../../sim/rng.js';
import type { GearInventory, GearPiece, GearSlot, EquipmentLoadout } from '../../domain/gear.js';
import type { Pet } from '../../domain/pet.js';
import type { PetId } from '../../domain/ids.js';
import type { Team } from '../../domain/team.js';
import type { Dungeon, Depth, Difficulty } from '../../domain/dungeon.js';
import type { EvaluationMode } from '../../domain/run.js';
import type { GameConstants } from '../../constants/types.js';
import type { Objective, ObjectiveContext } from '../../objectives/Objective.js';
import type { GlobalModifiers } from '../../sim/stats.js';
import { simulateRun } from '../../sim/run.js';
import type { SimulateRunDeps } from '../../sim/run.js';

// ── Constants ─────────────────────────────────────────────────────────────────

/**
 * Score returned for infeasible or invalid candidates.
 * Large negative so optimisers consistently prefer any valid assignment.
 */
export const REJECTION_SCORE = -1e9;

/** All valid gear slots. */
const ALL_GEAR_SLOTS: readonly GearSlot[] = ['weapon', 'armor', 'accessory', 'trinket'] as const;

// ── Candidate type ────────────────────────────────────────────────────────────

/**
 * A single placement record: one gear piece assigned to one pet's slot.
 *
 * Invariants (enforced by `validateAssignment`):
 *   - `gearId` references a piece that exists in `gearPool`.
 *   - `slot` matches `gearPool[gearId].slot`.
 *   - `petId` is one of the team's pets.
 *   - No two placements share the same `gearId`.
 *   - No two placements share the same `(petId, slot)` pair.
 */
export interface GearPlacement {
  /** Id of the GearPiece being placed (from GearPiece.id). */
  readonly gearId: string;
  /** Which pet receives this piece. */
  readonly petId: PetId;
  /** Which slot on that pet this piece occupies. Must equal the piece's GearPiece.slot. */
  readonly slot: GearSlot;
}

/**
 * A gear assignment candidate: an array of placements.
 *
 * Representation choice: a plain readonly array of `GearPlacement` objects.
 * Arrays are JSON-serializable and can be cloned with spread/slice without
 * allocating a Map. The small size (at most `4 × teamSize` entries, default ≤24)
 * makes linear scans acceptable in all hot paths.
 *
 * The empty array `[]` is the valid initial candidate (no gear placed).
 */
export type GearAssignment = ReadonlyArray<GearPlacement>;

// ── Inputs ────────────────────────────────────────────────────────────────────

/**
 * All fixed inputs for the gear-allocation search problem.
 * The team and dungeon target are fixed; only gear placement varies.
 */
export interface GearAllocationInputs {
  /** Full pet roster. Every pet referenced by `team.slots` must be present. */
  readonly roster: ReadonlyMap<PetId, Pet>;
  /** Fixed team whose pets receive gear. Not modified during search. */
  readonly team: Team;
  /** The dungeon definition (enemy table, boss archetypes, element). */
  readonly dungeon: Dungeon;
  /** Fixed depth tier for every evaluation. */
  readonly depth: Depth;
  /** Fixed within-depth difficulty slider for every evaluation. */
  readonly difficulty: Difficulty;
  /** Fixed room count for every evaluation. */
  readonly rooms: number;
  /**
   * Pool of gear pieces available to assign. Each piece may be assigned to
   * at most one (petId, slot) per candidate. Pieces not placed are simply
   * not equipped (the pet's existing equipment for that slot applies if
   * `allowReplacingEquipped` is false, or the slot is empty if true).
   */
  readonly gearPool: GearInventory;
  /** Objective to maximise. */
  readonly objective: Objective;
  /** Game constants. Pass DEFAULT_CONSTANTS for production. */
  readonly constants: GameConstants;
  /** Optional roster-level modifiers (Dojo, Strategy Room, etc.). */
  readonly globals?: GlobalModifiers | undefined;
  /** NRDC completions (reduces time per room). Default: 0. */
  readonly nrdcCompletions?: number | undefined;
  /** Simulation strategy. Default: 'expected' (fast, deterministic EV). */
  readonly evaluationMode?: EvaluationMode | undefined;
  /**
   * If true (default), the candidate FULLY defines each team pet's equipment
   * from the pool — any slot not covered by the assignment is left empty.
   * If false, only fill empty slots: existing equipment on the pet is preserved
   * in slots not covered by the assignment.
   */
  readonly allowReplacingEquipped?: boolean | undefined;
}

// ── Factory ───────────────────────────────────────────────────────────────────

/**
 * Build a `SearchProblem<GearAssignment>` for gear-allocation optimisation.
 *
 * The returned problem is stateless and safe to call concurrently.
 * Every `evaluate()` call builds a fresh cloned roster and calls `simulateRun`
 * without mutating any shared state.
 *
 * @param inputs - Fixed inputs defining the search context.
 * @returns A `SearchProblem<GearAssignment>` ready for any optimizer.
 */
export function makeGearAllocationProblem(inputs: GearAllocationInputs): SearchProblem<GearAssignment> {
  const evaluationMode: EvaluationMode = inputs.evaluationMode ?? 'expected';
  const nrdcCompletions: number = inputs.nrdcCompletions ?? 0;
  const allowReplacingEquipped: boolean = inputs.allowReplacingEquipped ?? true;

  // Build a lookup map from gearId → GearPiece for O(1) access.
  const poolById = new Map<string, GearPiece>();
  for (const piece of inputs.gearPool) {
    poolById.set(piece.id, piece);
  }

  // Extract the set of petIds in the team (for fast lookup and enumeration).
  const teamPetIds: readonly PetId[] = inputs.team.slots.map(s => s.petId);
  const teamPetIdSet = new Set<PetId>(teamPetIds);

  // ── Validation ─────────────────────────────────────────────────────────────

  /**
   * Validate a `GearAssignment`. Returns null on success; a violation string on failure.
   *
   * Validity rules:
   *   1. Every `gearId` must exist in the pool.
   *   2. `slot` must equal `GearPiece.slot` for the referenced piece.
   *   3. `petId` must be one of the team's pets.
   *   4. No two placements share the same `gearId` (each piece used at most once).
   *   5. No two placements share the same `(petId, slot)` pair.
   */
  function validateAssignment(assignment: GearAssignment): string | null {
    const usedGearIds = new Set<string>();
    const usedSlotKeys = new Set<string>(); // `${petId}:${slot}`

    for (const placement of assignment) {
      // Rule 1: gearId must be in pool.
      const piece = poolById.get(placement.gearId);
      if (piece === undefined) {
        return `gearId "${placement.gearId}" not found in pool`;
      }

      // Rule 2: slot must match piece.slot.
      if (placement.slot !== piece.slot) {
        return `piece "${placement.gearId}" has slot "${piece.slot}" but placement specifies "${placement.slot}"`;
      }

      // Rule 3: petId must be a team member.
      if (!teamPetIdSet.has(placement.petId)) {
        return `petId "${placement.petId}" is not in the team`;
      }

      // Rule 4: no duplicate gearId.
      if (usedGearIds.has(placement.gearId)) {
        return `gearId "${placement.gearId}" used more than once`;
      }
      usedGearIds.add(placement.gearId);

      // Rule 5: no duplicate (petId, slot).
      const slotKey = `${placement.petId}:${placement.slot}`;
      if (usedSlotKeys.has(slotKey)) {
        return `(petId "${placement.petId}", slot "${placement.slot}") occupied by more than one piece`;
      }
      usedSlotKeys.add(slotKey);
    }

    return null; // valid
  }

  // ── Roster cloning ─────────────────────────────────────────────────────────

  /**
   * Build a cloned roster with the assignment applied.
   *
   * For each team pet:
   *   - If `allowReplacingEquipped === true`: start with an empty loadout and
   *     apply only the pieces in the assignment. Slots not covered are empty.
   *   - If `allowReplacingEquipped === false`: start with the pet's existing
   *     equipment and fill in only the slots covered by the assignment.
   *
   * Non-team pets are passed through unchanged.
   */
  function buildClonedRoster(assignment: GearAssignment): ReadonlyMap<PetId, Pet> {
    // Build placement index: petId → { slot → GearPiece }.
    const placementByPet = new Map<PetId, Map<GearSlot, GearPiece>>();
    for (const placement of assignment) {
      const piece = poolById.get(placement.gearId);
      if (piece === undefined) continue; // validated above; guard for safety
      let bySlot = placementByPet.get(placement.petId);
      if (bySlot === undefined) {
        bySlot = new Map();
        placementByPet.set(placement.petId, bySlot);
      }
      bySlot.set(placement.slot, piece);
    }

    const cloned = new Map<PetId, Pet>();
    for (const [petId, pet] of inputs.roster) {
      if (!teamPetIdSet.has(petId)) {
        // Not a team pet — include unchanged.
        cloned.set(petId, pet);
        continue;
      }

      const assignedSlots = placementByPet.get(petId);

      let equipment: EquipmentLoadout;
      if (allowReplacingEquipped) {
        // Start fresh: only pieces explicitly assigned.
        const eq: Record<string, GearPiece> = {};
        if (assignedSlots !== undefined) {
          for (const [slot, piece] of assignedSlots) {
            eq[slot] = piece;
          }
        }
        equipment = eq as EquipmentLoadout;
      } else {
        // Preserve existing equipment; layer assignment on top.
        // Copy existing slots first.
        const eq: Record<string, GearPiece> = {};
        for (const slot of ALL_GEAR_SLOTS) {
          const existing = pet.equipment[slot];
          if (existing !== undefined) {
            eq[slot] = existing;
          }
        }
        // Overwrite with assigned pieces.
        if (assignedSlots !== undefined) {
          for (const [slot, piece] of assignedSlots) {
            eq[slot] = piece;
          }
        }
        equipment = eq as EquipmentLoadout;
      }

      const clonedPet: Pet = { ...pet, equipment };
      cloned.set(petId, clonedPet);
    }

    return cloned;
  }

  // ── SimulateRunDeps base (roster replaced per evaluate) ────────────────────

  const baseDeps: Omit<SimulateRunDeps, 'roster'> = {
    dungeon: inputs.dungeon,
    constants: inputs.constants,
    ...(inputs.globals !== undefined ? { globals: inputs.globals } : {}),
  };

  // ── SearchProblem implementation ───────────────────────────────────────────

  /**
   * evaluate(): validate assignment → clone roster → simulateRun → score.
   * Returns REJECTION_SCORE for invalid or infeasible assignments.
   */
  function evaluate(assignment: GearAssignment): number {
    const violation = validateAssignment(assignment);
    if (violation !== null) {
      return REJECTION_SCORE;
    }

    const clonedRoster = buildClonedRoster(assignment);

    const config = {
      team: inputs.team,
      dungeonId: inputs.dungeon.id,
      depth: inputs.depth,
      difficulty: inputs.difficulty,
      rooms: inputs.rooms,
      nrdcCompletions,
      evaluationMode,
    } as const;

    let result;
    try {
      result = simulateRun(config, { ...baseDeps, roster: clonedRoster, forceDerive: true });
    } catch {
      // simulateRun throws if a petId is missing from the roster; shouldn't
      // happen after our validation but we guard defensively.
      return REJECTION_SCORE;
    }

    const ctx: ObjectiveContext = {
      config,
      result,
      constants: inputs.constants,
    };

    if (inputs.objective.feasible !== undefined && !inputs.objective.feasible(ctx)) {
      return REJECTION_SCORE;
    }

    return inputs.objective.score(ctx);
  }

  /**
   * initial(): the empty assignment (no gear placed).
   *
   * This is a safe, always-valid baseline: the team fights with whatever
   * equipment was on the pets before optimization (if allowReplacingEquipped
   * is false) or with completely bare stats (if allowReplacingEquipped is true).
   */
  function initial(): GearAssignment {
    return [];
  }

  /**
   * neighbors(assignment): yield a bounded set of assignments reachable by
   * one local move from `assignment`.
   *
   * ## Move types
   *
   * **PLACE**: For each pool piece not yet placed, for each team pet, if the
   * matching slot is free in this assignment, yield the assignment with that
   * piece placed there. O(|pool| × |team|) candidates, bounded.
   *
   * **REMOVE**: For each currently-placed piece, yield the assignment with
   * that piece removed. O(|assignment|) candidates.
   *
   * **MOVE**: For each placed piece, for each other valid (petId, slot) that is
   * free, yield the assignment with the piece moved there. O(|assignment| × |team|)
   * candidates.
   *
   * **SWAP**: For each pair of placed pieces whose slots are mutually compatible
   * (piece A can go in piece B's slot and vice versa — i.e. same GearSlot type),
   * yield the assignment with their (petId, slot) placements swapped.
   * O(|assignment|²) candidates.
   *
   * All yielded assignments are structurally valid. The caller is still expected
   * to call evaluate() which re-validates, but no obviously-invalid candidates
   * are emitted.
   */
  function* neighbors(assignment: GearAssignment): Iterable<GearAssignment> {
    // Build current state for fast lookup.
    const usedGearIds = new Set<string>(assignment.map(p => p.gearId));
    // slotKey → placement index in `assignment`
    const occupiedSlots = new Map<string, number>();
    for (let i = 0; i < assignment.length; i++) {
      const p = assignment[i];
      if (p !== undefined) {
        occupiedSlots.set(`${p.petId}:${p.slot}`, i);
      }
    }

    // ── PLACE ───────────────────────────────────────────────────────────────
    for (const piece of inputs.gearPool) {
      if (usedGearIds.has(piece.id)) continue; // already placed
      for (const petId of teamPetIds) {
        const slotKey = `${petId}:${piece.slot}`;
        if (!occupiedSlots.has(slotKey)) {
          // Free slot that matches the piece — emit placement.
          yield [
            ...assignment,
            { gearId: piece.id, petId, slot: piece.slot },
          ];
        }
      }
    }

    // ── REMOVE ──────────────────────────────────────────────────────────────
    for (let i = 0; i < assignment.length; i++) {
      yield assignment.filter((_, j) => j !== i);
    }

    // ── MOVE ────────────────────────────────────────────────────────────────
    // Move placed piece i to a different valid (petId, slot).
    for (let i = 0; i < assignment.length; i++) {
      const placement = assignment[i];
      if (placement === undefined) continue;
      const piece = poolById.get(placement.gearId);
      if (piece === undefined) continue;

      for (const targetPetId of teamPetIds) {
        const targetSlotKey = `${targetPetId}:${piece.slot}`;
        // Must be different from the current placement and not already occupied.
        if (
          (targetPetId === placement.petId) ||
          occupiedSlots.has(targetSlotKey)
        ) {
          continue;
        }
        // Build new assignment with placement i moved to targetPetId.
        const newAssignment: GearPlacement[] = [];
        for (let j = 0; j < assignment.length; j++) {
          if (j === i) {
            newAssignment.push({ gearId: placement.gearId, petId: targetPetId, slot: piece.slot });
          } else {
            const p = assignment[j];
            if (p !== undefined) newAssignment.push(p);
          }
        }
        yield newAssignment;
      }
    }

    // ── SWAP ────────────────────────────────────────────────────────────────
    // Swap two placed pieces' (petId, slot) assignments when slots are compatible.
    // Two pieces can swap if piece A's slot === piece B's slot (same slot type),
    // so A can go into B's (petId, slot) and vice versa.
    for (let i = 0; i < assignment.length; i++) {
      for (let j = i + 1; j < assignment.length; j++) {
        const pi = assignment[i];
        const pj = assignment[j];
        if (pi === undefined || pj === undefined) continue;

        const pieceI = poolById.get(pi.gearId);
        const pieceJ = poolById.get(pj.gearId);
        if (pieceI === undefined || pieceJ === undefined) continue;

        // Slots must match for a valid swap (each piece can only go in its own slot type).
        if (pieceI.slot !== pieceJ.slot) continue;
        // Must be different placements (otherwise it's a no-op).
        if (pi.petId === pj.petId) continue;

        // Build swapped assignment.
        const newAssignment: GearPlacement[] = [];
        for (let k = 0; k < assignment.length; k++) {
          if (k === i) {
            newAssignment.push({ gearId: pi.gearId, petId: pj.petId, slot: pi.slot });
          } else if (k === j) {
            newAssignment.push({ gearId: pj.gearId, petId: pi.petId, slot: pj.slot });
          } else {
            const p = assignment[k];
            if (p !== undefined) newAssignment.push(p);
          }
        }
        yield newAssignment;
      }
    }
  }

  /**
   * randomCandidate(rng): build a random valid assignment.
   *
   * Shuffles the pool with Fisher-Yates, then greedily assigns each piece to
   * a random free (petId, slot) that matches the piece's slot. Stops when no
   * more placements are possible (all slots full or all pieces placed).
   *
   * Deterministic for a given seed; different seeds produce different assignments.
   */
  function randomCandidate(rng: Rng): GearAssignment {
    // Shuffle pool indices.
    const indices = Array.from({ length: inputs.gearPool.length }, (_, i) => i);
    for (let i = indices.length - 1; i > 0; i--) {
      const j = rng.int(i + 1);
      const tmp = indices[i];
      const jVal = indices[j];
      if (tmp !== undefined && jVal !== undefined) {
        indices[i] = jVal;
        indices[j] = tmp;
      }
    }

    // Track occupied (petId, slot) pairs.
    const occupiedSlotKeys = new Set<string>();
    const result: GearPlacement[] = [];

    for (const idx of indices) {
      const piece = inputs.gearPool[idx];
      if (piece === undefined) continue;

      // Find free slots for this piece among team pets.
      const freeTargets: PetId[] = [];
      for (const petId of teamPetIds) {
        const slotKey = `${petId}:${piece.slot}`;
        if (!occupiedSlotKeys.has(slotKey)) {
          freeTargets.push(petId);
        }
      }

      if (freeTargets.length === 0) continue; // no free slot for this piece

      // Pick a random free target.
      const targetPetId = freeTargets[rng.int(freeTargets.length)];
      if (targetPetId === undefined) continue;

      const slotKey = `${targetPetId}:${piece.slot}`;
      occupiedSlotKeys.add(slotKey);
      result.push({ gearId: piece.id, petId: targetPetId, slot: piece.slot });
    }

    return result;
  }

  return { initial, neighbors, randomCandidate, evaluate };
}
