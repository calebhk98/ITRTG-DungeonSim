/**
 * WP-J: FARM-TARGET optimization adapter (dimension 1).
 *
 * Provides a `SearchProblem<FarmTargetCandidate>` that, given a fixed team,
 * searches over (depth, difficulty, run-length) triples to maximise a chosen
 * `Objective`. The candidate space is small enough for full enumeration via
 * `allCandidates()`, which makes it a natural fit for `EnumerationOptimizer`,
 * but also exposes `neighbors()` and `randomCandidate()` for hill-climbing and
 * population-based algorithms.
 *
 * ## Evaluation pipeline
 *
 *   FarmTargetCandidate
 *     → RunConfig   (assembled from fixed inputs + candidate fields)
 *     → simulateRun (deterministic EV or Monte Carlo per evaluationMode)
 *     → RunResult
 *     → ObjectiveContext
 *     → Objective.score()
 *
 * If `Objective.feasible()` returns false, `evaluate()` returns `-Infinity`
 * so that all optimizers (enumeration, hill-climb, genetic) automatically
 * reject the candidate.
 *
 * Research plan §"Optimizer", §"Work-package breakdown" (WP-J).
 */

import type { GameConstants } from '../../constants/types.js';
import type { Depth, Difficulty } from '../../domain/dungeon.js';
import type { Dungeon } from '../../domain/dungeon.js';
import type { PetId } from '../../domain/ids.js';
import type { Pet } from '../../domain/pet.js';
import type { EvaluationMode } from '../../domain/run.js';
import type { Team } from '../../domain/team.js';
import type { GlobalModifiers } from '../../sim/stats.js';
import type { Rng } from '../../sim/rng.js';
import { simulateRun } from '../../sim/run.js';
import type { Objective, ObjectiveContext } from '../../objectives/Objective.js';
import type { SearchProblem } from '../SearchProblem.js';

// ── Candidate ────────────────────────────────────────────────────────────────

/**
 * One candidate in the farm-target search space.
 * Fully describes the run configuration that varies during optimisation
 * (the team is fixed and lives in `FarmTargetInputs`).
 */
export interface FarmTargetCandidate {
  /** Dungeon depth tier (1–4). */
  readonly depth: Depth;
  /** Within-depth difficulty slider (0–10). */
  readonly difficulty: Difficulty;
  /** Number of rooms to run. Must be one of the configured `roomChoices`. */
  readonly rooms: number;
}

// ── Inputs ───────────────────────────────────────────────────────────────────

/**
 * All fixed inputs that do not vary across candidates. Passed once to
 * `makeFarmTargetProblem()` and reused for every `evaluate()` call.
 */
export interface FarmTargetInputs {
  /** The team whose performance we are optimising over. Fixed throughout. */
  readonly team: Team;
  /** The dungeon definition (enemy tables, boss archetypes, element). */
  readonly dungeon: Dungeon;
  /** Full pet roster. Every pet referenced by `team.slots` must be present. */
  readonly roster: ReadonlyMap<PetId, Pet>;
  /** The objective to maximise (e.g. resourceYieldPerHour, maxClearableDepth). */
  readonly objective: Objective;
  /** Authoritative game constants. Pass `DEFAULT_CONSTANTS` in production. */
  readonly constants: GameConstants;
  /**
   * Optional roster-level modifiers (Dojo, Strategy Room, PGC, etc.).
   * Omit or pass `{}` for a baseline "no modifiers" simulation.
   */
  readonly globals?: GlobalModifiers | undefined;
  /**
   * NRDC completions the player has. Reduces time per room via
   * `15 × (1 − 0.01 × nrdcCompletions)` minutes (research §6.3a).
   * Default: 0.
   */
  readonly nrdcCompletions?: number | undefined;
  /**
   * Candidate run-lengths to enumerate.
   * Default: [6, 16, 30, 48] — meaningful milestones (D1 boss / D2 boss /
   * D3 boss / maximum pre-NRDC rooms).
   */
  readonly roomChoices?: readonly number[] | undefined;
  /**
   * Depth choices to enumerate.
   * Default: [1, 2, 3, 4].
   */
  readonly depthChoices?: readonly Depth[] | undefined;
  /**
   * Difficulty choices to enumerate.
   * Default: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10] (full slider range).
   */
  readonly difficultyChoices?: readonly Difficulty[] | undefined;
  /**
   * Whether to use deterministic expected-value mode (fast, optimizer inner loop)
   * or stochastic Monte Carlo sampling (accurate, re-rank finalists).
   * Default: 'expected'.
   */
  readonly evaluationMode?: EvaluationMode | undefined;
}

// ── Defaults ─────────────────────────────────────────────────────────────────

const DEFAULT_ROOM_CHOICES: readonly number[] = [6, 16, 30, 48];

const DEFAULT_DEPTH_CHOICES: readonly Depth[] = [1, 2, 3, 4];

const DEFAULT_DIFFICULTY_CHOICES: readonly Difficulty[] = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

// ── Problem type ─────────────────────────────────────────────────────────────

/**
 * The type returned by `makeFarmTargetProblem`. Extends the base `SearchProblem`
 * with a local `allCandidates()` so enumeration optimizers (and tests) can
 * iterate the full cartesian product without depending on the
 * `EnumerableSearchProblem` interface from `optimizer/algorithms/`.
 */
export type FarmTargetProblem = SearchProblem<FarmTargetCandidate> & {
  /**
   * Returns every candidate in the search space as a cartesian product of
   * depthChoices × difficultyChoices × roomChoices.
   *
   * The space is small (default: 4 × 11 × 4 = 176 candidates) so full
   * enumeration is fast in both expected and Monte Carlo modes.
   */
  allCandidates(): Iterable<FarmTargetCandidate>;
};

// ── Factory ──────────────────────────────────────────────────────────────────

/**
 * Build a `SearchProblem` for farm-target selection.
 *
 * The returned problem object is stateless and safe to call concurrently;
 * every `evaluate()` call creates a fresh `RunConfig` and runs the simulator
 * without mutating any shared state.
 *
 * @param inputs - Fixed inputs (team, dungeon, objective, …) that define the
 *   search context. The candidate space is derived from the choice arrays.
 * @returns A `FarmTargetProblem` ready to be handed to any optimizer.
 */
export function makeFarmTargetProblem(inputs: FarmTargetInputs): FarmTargetProblem {
  // Resolve choices once with defaults.
  const depthChoices: readonly Depth[] = inputs.depthChoices ?? DEFAULT_DEPTH_CHOICES;
  const difficultyChoices: readonly Difficulty[] =
    inputs.difficultyChoices ?? DEFAULT_DIFFICULTY_CHOICES;
  const roomChoices: readonly number[] = inputs.roomChoices ?? DEFAULT_ROOM_CHOICES;
  const evaluationMode: EvaluationMode = inputs.evaluationMode ?? 'expected';
  const nrdcCompletions: number = inputs.nrdcCompletions ?? 0;

  // Validate that the choice arrays are non-empty (guard against misconfiguration).
  if (depthChoices.length === 0) {
    throw new Error('FarmTargetProblem: depthChoices must not be empty');
  }
  if (difficultyChoices.length === 0) {
    throw new Error('FarmTargetProblem: difficultyChoices must not be empty');
  }
  if (roomChoices.length === 0) {
    throw new Error('FarmTargetProblem: roomChoices must not be empty');
  }

  // ── Helpers ─────────────────────────────────────────────────────────────────

  /** Return the index of `value` in `arr`, or -1. */
  function indexOf<T>(arr: readonly T[], value: T): number {
    for (let i = 0; i < arr.length; i++) {
      if (arr[i] === value) return i;
    }
    return -1;
  }

  /**
   * Core evaluation: assemble a RunConfig, call simulateRun, wrap into an
   * ObjectiveContext, and return `objective.score()` — or `-Infinity` if the
   * candidate is infeasible.
   */
  function evaluate(candidate: FarmTargetCandidate): number {
    const config = {
      team: inputs.team,
      dungeonId: inputs.dungeon.id,
      depth: candidate.depth,
      difficulty: candidate.difficulty,
      rooms: candidate.rooms,
      nrdcCompletions,
      evaluationMode,
    } as const;

    const result = simulateRun(config, {
      dungeon: inputs.dungeon,
      roster: inputs.roster,
      constants: inputs.constants,
      ...(inputs.globals !== undefined ? { globals: inputs.globals } : {}),
    });

    const ctx: ObjectiveContext = {
      config,
      result,
      constants: inputs.constants,
    };

    // Feasibility gate: if the objective defines a feasibility check and the
    // candidate fails it, return a strongly negative score so all optimizers
    // automatically reject this candidate.
    if (inputs.objective.feasible !== undefined && !inputs.objective.feasible(ctx)) {
      return -Infinity;
    }

    return inputs.objective.score(ctx);
  }

  // ── SearchProblem methods ────────────────────────────────────────────────────

  /**
   * Default starting candidate: lowest depth, lowest difficulty, shortest run.
   * Provides a safe, always-feasible starting point for hill-climbers.
   */
  function initial(): FarmTargetCandidate {
    // Non-null assertion is guarded by the non-empty check above.
    const depth = depthChoices[0]!;
    const difficulty = difficultyChoices[0]!;
    const rooms = roomChoices[0]!;
    return { depth, difficulty, rooms };
  }

  /**
   * Adjacent candidates reachable by a single small change:
   *   - depth ±1 within depthChoices bounds
   *   - difficulty ±1 within difficultyChoices bounds
   *   - rooms: the immediately adjacent roomChoices entries (prev / next)
   *
   * Never produces a candidate outside the configured choice lists.
   */
  function* neighbors(c: FarmTargetCandidate): Iterable<FarmTargetCandidate> {
    const di = indexOf(depthChoices, c.depth);
    const fi = indexOf(difficultyChoices, c.difficulty);
    const ri = indexOf(roomChoices, c.rooms);

    // Depth neighbours.
    if (di > 0) {
      yield { depth: depthChoices[di - 1]!, difficulty: c.difficulty, rooms: c.rooms };
    }
    if (di < depthChoices.length - 1) {
      yield { depth: depthChoices[di + 1]!, difficulty: c.difficulty, rooms: c.rooms };
    }

    // Difficulty neighbours.
    if (fi > 0) {
      yield { depth: c.depth, difficulty: difficultyChoices[fi - 1]!, rooms: c.rooms };
    }
    if (fi < difficultyChoices.length - 1) {
      yield { depth: c.depth, difficulty: difficultyChoices[fi + 1]!, rooms: c.rooms };
    }

    // Room-length neighbours.
    if (ri > 0) {
      yield { depth: c.depth, difficulty: c.difficulty, rooms: roomChoices[ri - 1]! };
    }
    if (ri < roomChoices.length - 1) {
      yield { depth: c.depth, difficulty: c.difficulty, rooms: roomChoices[ri + 1]! };
    }
  }

  /**
   * Uniformly random candidate from the choice lists.
   * Used by population-based algorithms (genetic, beam initialisation).
   */
  function randomCandidate(rng: Rng): FarmTargetCandidate {
    const depth = depthChoices[rng.int(depthChoices.length)]!;
    const difficulty = difficultyChoices[rng.int(difficultyChoices.length)]!;
    const rooms = roomChoices[rng.int(roomChoices.length)]!;
    return { depth, difficulty, rooms };
  }

  /**
   * Cartesian product of depthChoices × difficultyChoices × roomChoices.
   * Yields every candidate exactly once. Order: depth → difficulty → rooms
   * (depth is the outermost loop).
   */
  function* allCandidates(): Iterable<FarmTargetCandidate> {
    for (const depth of depthChoices) {
      for (const difficulty of difficultyChoices) {
        for (const rooms of roomChoices) {
          yield { depth, difficulty, rooms };
        }
      }
    }
  }

  return {
    initial,
    neighbors,
    randomCandidate,
    evaluate,
    allCandidates,
  };
}
