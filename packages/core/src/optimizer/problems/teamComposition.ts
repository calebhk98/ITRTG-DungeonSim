/**
 * WP-J, Dimension 2: TEAM-COMPOSITION SearchProblem adapter.
 *
 * Picks which pets (and their assigned class + row) form a team of up to
 * `maxTeamSize` slots from a fixed roster, to maximise a chosen objective
 * evaluated against a fixed farm target (dungeon / depth / difficulty / rooms).
 *
 * ## Candidate representation
 * The candidate is a `Team` — a readonly array of `TeamSlot`s, each carrying:
 *   - `petId`         — which pet occupies the slot (each pet appears at most once)
 *   - `row`           — 'front' or 'back' (max 3 slots per row)
 *   - `assignedClass` — any `PetClassName` (or null for no class)
 *
 * ## Validity rules (enforced by helpers; violations yield REJECTION_SCORE)
 *   1. `slots.length <= maxTeamSize` (default 6).
 *   2. At most 3 slots with `row === 'front'`, at most 3 with `row === 'back'`.
 *   3. Each petId appears at most once.
 *   4. Every petId must resolve in `inputs.roster`.
 *   5. `assignedClass` must be in `allowedClassesForPet(pet)`.
 *
 * ## Neighbour moves (bounded set; each yields a new Team)
 *   - SWAP_PET      : replace one slot's pet with an unused roster pet.
 *   - CHANGE_CLASS  : change one slot's assignedClass to another allowed class.
 *   - FLIP_ROW      : move one slot from 'front' ↔ 'back' (if target row has room).
 *   - ADD_SLOT      : add a new slot (unused pet, random class, fitting row)
 *                     when `slots.length < maxTeamSize` and a row has < 3.
 *   - REMOVE_SLOT   : drop one slot when `slots.length > 1`.
 *
 * ## evaluate() wiring
 *   1. Validate the Team; return REJECTION_SCORE immediately on any violation.
 *   2. Build `RunConfig` (team + fixed farm target fields).
 *   3. Call `simulateRun(config, deps)` → `RunResult`.
 *   4. Build `ObjectiveContext` and call `objective.score(ctx)`.
 *   5. If `objective.feasible` is present and returns false, return REJECTION_SCORE.
 *
 * Research §3, §5.5, §6.1; Plan §"Work-package breakdown" WP-J.
 */

import type { SearchProblem } from '../SearchProblem.js';
import type { Rng } from '../../sim/rng.js';
import type { Team, TeamSlot, Row } from '../../domain/team.js';
import type { Pet } from '../../domain/pet.js';
import type { PetId } from '../../domain/ids.js';
import type { PetClassName } from '../../domain/class.js';
import type { Dungeon, Depth, Difficulty } from '../../domain/dungeon.js';
import type { RunConfig, EvaluationMode } from '../../domain/run.js';
import type { GameConstants } from '../../constants/types.js';
import type { Objective, ObjectiveContext } from '../../objectives/Objective.js';
import { simulateRun } from '../../sim/run.js';
import type { SimulateRunDeps } from '../../sim/run.js';
import type { GlobalModifiers } from '../../sim/stats.js';

// ── Constants ─────────────────────────────────────────────────────────────────

/** All available class names in the game (from domain/class.ts). */
const ALL_CLASS_NAMES: readonly PetClassName[] = [
  'Adventurer',
  'Mage',
  'Assassin',
  'Rogue',
  'Defender',
  'Supporter',
  'Blacksmith',
  'Alchemist',
] as const;

/**
 * Score returned for infeasible or invalid candidates.
 * Large negative so optimisers consistently prefer any valid team.
 */
const REJECTION_SCORE = -1e9;

/** Maximum slots per row (front or back). Research §3. */
const MAX_PER_ROW = 3;

// ── Public types ──────────────────────────────────────────────────────────────

/**
 * All inputs required to construct a TeamComposition SearchProblem.
 * Fixed fields (dungeon target, objective, constants) are captured at
 * construction time and held constant across all evaluate() calls.
 */
export interface TeamCompositionInputs {
  /** Available pets to choose from. Keys are PetId. */
  readonly roster: ReadonlyMap<PetId, Pet>;
  /** Dungeon definition (passed straight to simulateRun). */
  readonly dungeon: Dungeon;
  /** Fixed depth tier for every evaluation. */
  readonly depth: Depth;
  /** Fixed within-depth difficulty slider for every evaluation. */
  readonly difficulty: Difficulty;
  /** Fixed room count for every evaluation. */
  readonly rooms: number;
  /** Objective to maximise. */
  readonly objective: Objective;
  /** Game constants. Pass DEFAULT_CONSTANTS for production. */
  readonly constants: GameConstants;
  /** Optional roster-level modifiers (Dojo, Strategy Room, etc.). */
  readonly globals?: GlobalModifiers | undefined;
  /** NRDC completions (reduces time per room). Default: 0. */
  readonly nrdcCompletions?: number | undefined;
  /** Maximum team size (number of slots). Default: 6. */
  readonly maxTeamSize?: number | undefined;
  /**
   * Override the set of allowed classes for a given pet.
   * Default: if `pet.evolvedClass` is non-null → [pet.evolvedClass];
   *           else all 8 class names (pre-evolution pet can be assigned any class).
   *
   * Note: the sim treats a null assignedClass as 'Adventurer' for stat derivation,
   * so the optimizer always assigns an explicit class.
   */
  readonly allowedClassesPerPet?: ((pet: Pet) => PetClassName[]) | undefined;
  /** Simulation strategy. Default: 'expected' (fast, deterministic EV). */
  readonly evaluationMode?: EvaluationMode | undefined;
}

// ── Factory ───────────────────────────────────────────────────────────────────

/**
 * Construct a `SearchProblem<Team>` for the team-composition dimension.
 *
 * The returned problem's `evaluate()` is the hot inner loop of any optimiser —
 * it calls `simulateRun` once per invocation. Use `evaluationMode: 'expected'`
 * for the inner loop and 'monteCarlo' only for re-ranking finalists.
 */
export function makeTeamCompositionProblem(
  inputs: TeamCompositionInputs,
): SearchProblem<Team> {
  const maxTeamSize = inputs.maxTeamSize ?? 6;
  const evaluationMode = inputs.evaluationMode ?? 'expected';
  const nrdcCompletions = inputs.nrdcCompletions ?? 0;

  // Freeze the roster as an ordered array once so we have stable indices for
  // all neighbourhood moves that need to pick an "unused" pet.
  const rosterPets: readonly Pet[] = Array.from(inputs.roster.values());

  /** Compute allowed classes for one pet (respects the inputs override). */
  function allowedClasses(pet: Pet): PetClassName[] {
    if (inputs.allowedClassesPerPet !== undefined) {
      return inputs.allowedClassesPerPet(pet);
    }
    if (pet.evolvedClass !== null) {
      return [pet.evolvedClass];
    }
    return ALL_CLASS_NAMES.slice(); // copy — callers may mutate
  }

  /** Pick any valid class for a pet (first allowed, or Adventurer as fallback). */
  function pickDefaultClass(pet: Pet): PetClassName {
    const cls = allowedClasses(pet);
    return cls[0] ?? 'Adventurer';
  }

  /** Pick a random valid class for a pet. */
  function pickRandomClass(pet: Pet, rng: Rng): PetClassName {
    const cls = allowedClasses(pet);
    if (cls.length === 0) return 'Adventurer';
    const idx = rng.int(cls.length);
    return cls[idx] ?? 'Adventurer';
  }

  // ── Validation ───────────────────────────────────────────────────────────────

  /**
   * Check whether `team` is a valid candidate.
   * Returns null on success; a string description of the first violation found.
   *
   * Validity rules (see module JSDoc):
   *   1. slots.length <= maxTeamSize
   *   2. ≤ 3 slots per row
   *   3. No duplicate petId
   *   4. Every petId in roster
   *   5. assignedClass in allowedClasses(pet)
   */
  function validateTeam(team: Team): string | null {
    if (team.slots.length > maxTeamSize) {
      return `team has ${team.slots.length} slots (max ${maxTeamSize})`;
    }

    let frontCount = 0;
    let backCount = 0;
    const seen = new Set<PetId>();

    for (const slot of team.slots) {
      // Rule 3: duplicate pet
      if (seen.has(slot.petId)) {
        return `duplicate petId ${slot.petId}`;
      }
      seen.add(slot.petId);

      // Rule 4: unknown petId
      const pet = inputs.roster.get(slot.petId);
      if (pet === undefined) {
        return `petId ${slot.petId} not in roster`;
      }

      // Rule 5: assignedClass allowed
      if (slot.assignedClass !== null) {
        const allowed = allowedClasses(pet);
        if (!allowed.includes(slot.assignedClass)) {
          return `class ${slot.assignedClass} not allowed for pet ${slot.petId}`;
        }
      }

      // Rule 2: row limits
      if (slot.row === 'front') {
        frontCount++;
        if (frontCount > MAX_PER_ROW) {
          return `more than ${MAX_PER_ROW} pets in front row`;
        }
      } else {
        backCount++;
        if (backCount > MAX_PER_ROW) {
          return `more than ${MAX_PER_ROW} pets in back row`;
        }
      }
    }

    return null; // valid
  }

  // ── SimulateRunDeps (constant across all evaluations) ───────────────────────

  const deps: SimulateRunDeps = {
    dungeon: inputs.dungeon,
    roster: inputs.roster,
    constants: inputs.constants,
    ...(inputs.globals !== undefined ? { globals: inputs.globals } : {}),
  };

  // ── SearchProblem implementation ────────────────────────────────────────────

  /**
   * evaluate(): build RunConfig → simulateRun → ObjectiveContext → score.
   * Returns REJECTION_SCORE for invalid or infeasible teams.
   */
  function evaluate(team: Team): number {
    const violation = validateTeam(team);
    if (violation !== null) {
      return REJECTION_SCORE;
    }

    const config: RunConfig = {
      team,
      dungeonId: inputs.dungeon.id,
      depth: inputs.depth,
      difficulty: inputs.difficulty,
      rooms: inputs.rooms,
      nrdcCompletions,
      evaluationMode,
    };

    let result;
    try {
      result = simulateRun(config, deps);
    } catch {
      // simulateRun can throw if a petId is missing from the roster (belt-and-
      // suspenders: validateTeam already guards this, but be safe).
      return REJECTION_SCORE;
    }

    const ctx: ObjectiveContext = {
      config,
      result,
      constants: inputs.constants,
    };

    // Feasibility check (e.g. resourceYieldPerHour requires cleared===true).
    if (inputs.objective.feasible !== undefined && !inputs.objective.feasible(ctx)) {
      return REJECTION_SCORE;
    }

    return inputs.objective.score(ctx);
  }

  /**
   * initial(): deterministic default team.
   * Picks the first `maxTeamSize` pets from the roster (in insertion order),
   * assigns each its default class, fills front row first then back row.
   */
  function initial(): Team {
    const slots: TeamSlot[] = [];
    let frontCount = 0;
    let backCount = 0;

    for (const pet of rosterPets) {
      if (slots.length >= maxTeamSize) break;

      let row: Row;
      if (frontCount < MAX_PER_ROW) {
        row = 'front';
        frontCount++;
      } else if (backCount < MAX_PER_ROW) {
        row = 'back';
        backCount++;
      } else {
        break; // both rows full
      }

      slots.push({
        petId: pet.id,
        row,
        assignedClass: pickDefaultClass(pet),
      });
    }

    return { slots };
  }

  /**
   * randomCandidate(rng): build a random valid team.
   * Randomly selects a team size in [1, min(maxTeamSize, rosterSize)],
   * shuffles the pet order with Fisher-Yates using `rng`, then fills front
   * then back rows (up to MAX_PER_ROW each), assigning a random allowed class.
   */
  function randomCandidate(rng: Rng): Team {
    const maxSize = Math.min(maxTeamSize, rosterPets.length);
    // Random team size in [1, maxSize].
    const teamSize = 1 + rng.int(maxSize);

    // Fisher-Yates shuffle on a copy of rosterPets indices.
    const indices = Array.from({ length: rosterPets.length }, (_, i) => i);
    for (let i = indices.length - 1; i > 0; i--) {
      const j = rng.int(i + 1);
      // Swap indices[i] and indices[j].
      const tmp = indices[i];
      const jVal = indices[j];
      if (tmp !== undefined && jVal !== undefined) {
        indices[i] = jVal;
        indices[j] = tmp;
      }
    }

    const slots: TeamSlot[] = [];
    let frontCount = 0;
    let backCount = 0;

    for (let k = 0; k < teamSize && k < indices.length; k++) {
      const idx = indices[k];
      if (idx === undefined) continue;
      const pet = rosterPets[idx];
      if (pet === undefined) continue;

      let row: Row;
      if (frontCount < MAX_PER_ROW && backCount < MAX_PER_ROW) {
        // Both rows have room — pick randomly.
        row = rng.int(2) === 0 ? 'front' : 'back';
      } else if (frontCount < MAX_PER_ROW) {
        row = 'front';
      } else if (backCount < MAX_PER_ROW) {
        row = 'back';
      } else {
        break; // both rows full
      }

      if (row === 'front') frontCount++;
      else backCount++;

      slots.push({
        petId: pet.id,
        row,
        assignedClass: pickRandomClass(pet, rng),
      });
    }

    return { slots };
  }

  /**
   * neighbors(team): yield a bounded set of Teams reachable by one local move.
   *
   * Move types (each producing at most O(rosterSize + classCount) candidates):
   *
   *   SWAP_PET     – replace one slot's pet with every unused roster pet
   *                  (keeping the same row + a default class for the new pet).
   *   CHANGE_CLASS – replace one slot's assignedClass with every other
   *                  allowed class for that slot's pet.
   *   FLIP_ROW     – move one slot front↔back, if the target row has < 3 pets.
   *   ADD_SLOT     – if team.slots.length < maxTeamSize and either row has < 3,
   *                  add one slot per unused pet (first valid row).
   *   REMOVE_SLOT  – drop one slot (for each slot index), if slots.length > 1.
   *
   * All yielded teams are guaranteed valid (duplicates filtered, row limits
   * respected, class choices restricted to allowed set).
   */
  function* neighbors(team: Team): Iterable<Team> {
    const slots = team.slots;
    const usedIds = new Set<PetId>(slots.map(s => s.petId));
    const unusedPets = rosterPets.filter(p => !usedIds.has(p.id));

    const frontCount = slots.filter(s => s.row === 'front').length;
    const backCount  = slots.filter(s => s.row === 'back').length;

    for (let i = 0; i < slots.length; i++) {
      const slot = slots[i];
      if (slot === undefined) continue;

      // ── SWAP_PET ────────────────────────────────────────────────────────────
      for (const newPet of unusedPets) {
        const newSlots = slots.slice();
        newSlots[i] = {
          petId: newPet.id,
          row: slot.row,
          assignedClass: pickDefaultClass(newPet),
        };
        yield { slots: newSlots };
      }

      // ── CHANGE_CLASS ────────────────────────────────────────────────────────
      const pet = inputs.roster.get(slot.petId);
      if (pet !== undefined) {
        const allowed = allowedClasses(pet);
        for (const cls of allowed) {
          if (cls === slot.assignedClass) continue;
          const newSlots = slots.slice();
          newSlots[i] = { ...slot, assignedClass: cls };
          yield { slots: newSlots };
        }
      }

      // ── FLIP_ROW ────────────────────────────────────────────────────────────
      if (slot.row === 'front') {
        // Move to back if back has room.
        if (backCount < MAX_PER_ROW) {
          const newSlots = slots.slice();
          newSlots[i] = { ...slot, row: 'back' };
          yield { slots: newSlots };
        }
      } else {
        // Move to front if front has room.
        if (frontCount < MAX_PER_ROW) {
          const newSlots = slots.slice();
          newSlots[i] = { ...slot, row: 'front' };
          yield { slots: newSlots };
        }
      }

      // ── REMOVE_SLOT ─────────────────────────────────────────────────────────
      if (slots.length > 1) {
        const newSlots = slots.filter((_, j) => j !== i);
        yield { slots: newSlots };
      }
    }

    // ── ADD_SLOT ──────────────────────────────────────────────────────────────
    if (slots.length < maxTeamSize) {
      for (const newPet of unusedPets) {
        let row: Row | undefined;
        if (frontCount < MAX_PER_ROW) {
          row = 'front';
        } else if (backCount < MAX_PER_ROW) {
          row = 'back';
        }
        if (row === undefined) break; // both rows full (shouldn't happen if slots.length < max)

        yield {
          slots: [
            ...slots,
            {
              petId: newPet.id,
              row,
              assignedClass: pickDefaultClass(newPet),
            },
          ],
        };
      }
    }
  }

  return { evaluate, initial, neighbors, randomCandidate };
}

// ── Re-export REJECTION_SCORE so tests can assert against it ─────────────────
export { REJECTION_SCORE };
