/**
 * Optimizer dimension: MULTI-TEAM roster partition.
 *
 * Splits a full pet roster across SEVERAL disjoint teams (e.g. 5 teams of 6 =
 * 30 pets) and maximises the AGGREGATE of a chosen objective summed over every
 * team. This is the dimension that lets the optimizer use the whole roster
 * instead of a single team of ≤6 — addressing the "only uses ~10 pets" and
 * "splits the pets up to handle multiple teams" requests.
 *
 * The aggregate is objective-agnostic: it sums `objective.score` across teams,
 * so per-hour objectives (xpPerHour, materialYield, resourceYieldPerHour) yield
 * the TOTAL rate across all teams, which is exactly the quantity a player who
 * runs N teams in parallel cares about.
 *
 * ## Candidate representation (`MultiTeamPlan`)
 *   - `teams`: an array of `TeamPlan`s, one per team slot in use. Each `TeamPlan`
 *     carries its own `Team` (pets/rows/classes) AND its own farm target
 *     (`depth` / `difficulty` / `rooms`) so a strong team can push D4 while a
 *     weak team farms D1 in the same dungeon.
 *
 * ## Validity (violations → REJECTION_SCORE)
 *   1. `teams.length <= teamCount`.
 *   2. Each team obeys the team-composition rules (≤ maxTeamSize slots, ≤ 3 per
 *      row, classes allowed for the pet, petIds resolve in the roster).
 *   3. No pet appears in more than one team (global disjointness).
 *
 * ## Scoring
 *   For each non-empty team: build a `RunConfig`, `simulateRun`, then add
 *   `objective.score`. An empty team contributes 0. A team that fails
 *   `objective.feasible` contributes `REJECTION_PER_TEAM` (so the optimizer is
 *   pushed toward all-feasible partitions without discarding the whole plan).
 *
 * ## Neighbour moves (bounded)
 *   - ADD_PET     : place a benched pet into a team that has room.
 *   - REMOVE_PET  : bench one assigned pet.
 *   - MOVE_PET    : move an assigned pet to another team that has room.
 *   - CHANGE_CLASS: change one slot's assigned class.
 *   - FLIP_ROW    : move one slot front↔back within its team.
 *   - CHANGE_TARGET: nudge a team's depth/difficulty by ±1, or pick another
 *                    room choice.
 *
 * Single-dungeon for now (every team runs `inputs.dungeon`); per-team dungeon
 * selection is the separate "multiple dungeons" dimension. Mirrors the shape of
 * `teamComposition.ts` / `farmTarget.ts`.
 */

import type { SearchProblem } from '../SearchProblem.js';
import type { Rng } from '../../sim/rng.js';
import type { Team, TeamSlot, Row } from '../../domain/team.js';
import type { Pet } from '../../domain/pet.js';
import type { PetId } from '../../domain/ids.js';
import type { PetClassName } from '../../domain/class.js';
import type { Dungeon, Depth, Difficulty } from '../../domain/dungeon.js';
import type { RunConfig, EvaluationMode, RunResult } from '../../domain/run.js';
import type { GameConstants } from '../../constants/types.js';
import type { Objective, ObjectiveContext } from '../../objectives/Objective.js';
import { simulateRun } from '../../sim/run.js';
import type { SimulateRunDeps } from '../../sim/run.js';
import type { GlobalModifiers } from '../../sim/stats.js';

// ── Constants ─────────────────────────────────────────────────────────────────

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

/** Score for an entirely invalid plan (bad structure). */
const REJECTION_SCORE = -1e9;
/** Per-team penalty for a structurally-valid team that fails feasibility. */
const REJECTION_PER_TEAM = -1e9;
/** Maximum slots per row (front or back). Research §3. */
const MAX_PER_ROW = 3;
/**
 * Default number of team slots. The game caps dungeon team slots in this range
 * (research §2: start with 1, up to ~6 additional). Configurable via teamCount.
 */
const DEFAULT_TEAM_COUNT = 6;
const DEFAULT_MAX_TEAM_SIZE = 6;

const DEFAULT_DEPTH_CHOICES: readonly Depth[] = [1, 2, 3, 4];
const DEFAULT_DIFFICULTY_CHOICES: readonly Difficulty[] = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
const DEFAULT_ROOM_CHOICES: readonly number[] = [16];

// ── Public types ──────────────────────────────────────────────────────────────

/** One team plus its own farm target. */
export interface TeamPlan {
  readonly team: Team;
  readonly depth: Depth;
  readonly difficulty: Difficulty;
  readonly rooms: number;
}

/** A full multi-team roster partition (the optimizer candidate). */
export interface MultiTeamPlan {
  readonly teams: ReadonlyArray<TeamPlan>;
}

/** Inputs for {@link makeMultiTeamProblem}. */
export interface MultiTeamInputs {
  /** Available pets to partition. Keys are PetId. */
  readonly roster: ReadonlyMap<PetId, Pet>;
  /** Dungeon every team runs (single-dungeon for this dimension). */
  readonly dungeon: Dungeon;
  /** Objective to maximise (summed across teams). */
  readonly objective: Objective;
  /** Game constants. Pass DEFAULT_CONSTANTS for production. */
  readonly constants: GameConstants;
  /** Optional roster-level modifiers (Dojo, Strategy Room, etc.). */
  readonly globals?: GlobalModifiers | undefined;
  /** NRDC completions (reduces time per room). Default: 0. */
  readonly nrdcCompletions?: number | undefined;
  /** Number of team slots to fill. Default: {@link DEFAULT_TEAM_COUNT}. */
  readonly teamCount?: number | undefined;
  /** Maximum pets per team. Default: 6. */
  readonly maxTeamSize?: number | undefined;
  /** Candidate depths a team may target. Default: [1,2,3,4]. */
  readonly depthChoices?: readonly Depth[] | undefined;
  /** Candidate difficulties a team may target. Default: [0..10]. */
  readonly difficultyChoices?: readonly Difficulty[] | undefined;
  /** Candidate room counts a team may target. Default: [16]. */
  readonly roomChoices?: readonly number[] | undefined;
  /** Override allowed classes per pet (see teamComposition). */
  readonly allowedClassesPerPet?: ((pet: Pet) => PetClassName[]) | undefined;
  /** Simulation strategy. Default: 'expected'. */
  readonly evaluationMode?: EvaluationMode | undefined;
  /** Phoenix Feathers available to EACH team's run. Default: 0. */
  readonly phoenixFeathers?: number | undefined;
}

/** Per-team breakdown produced by {@link summarizeMultiTeamPlan}. */
export interface TeamPlanSummary {
  readonly plan: TeamPlan;
  readonly result: RunResult;
  readonly score: number;
  readonly feasible: boolean;
}

// ── Factory ───────────────────────────────────────────────────────────────────

export function makeMultiTeamProblem(
  inputs: MultiTeamInputs,
): SearchProblem<MultiTeamPlan> {
  const teamCount = inputs.teamCount ?? DEFAULT_TEAM_COUNT;
  const maxTeamSize = inputs.maxTeamSize ?? DEFAULT_MAX_TEAM_SIZE;
  const evaluationMode = inputs.evaluationMode ?? 'expected';
  const nrdcCompletions = inputs.nrdcCompletions ?? 0;
  const phoenixFeathers = inputs.phoenixFeathers ?? 0;
  const depthChoices = inputs.depthChoices ?? DEFAULT_DEPTH_CHOICES;
  const difficultyChoices = inputs.difficultyChoices ?? DEFAULT_DIFFICULTY_CHOICES;
  const roomChoices = inputs.roomChoices ?? DEFAULT_ROOM_CHOICES;

  const rosterPets: readonly Pet[] = Array.from(inputs.roster.values());

  const defaultTarget = (): { depth: Depth; difficulty: Difficulty; rooms: number } => ({
    depth: depthChoices[0] ?? 1,
    difficulty: difficultyChoices[0] ?? 0,
    rooms: roomChoices[0] ?? 16,
  });

  function allowedClasses(pet: Pet): PetClassName[] {
    if (inputs.allowedClassesPerPet !== undefined) {
      return inputs.allowedClassesPerPet(pet);
    }
    if (pet.evolvedClass !== null) {
      return [pet.evolvedClass];
    }
    return ALL_CLASS_NAMES.slice();
  }

  function pickDefaultClass(pet: Pet): PetClassName {
    return allowedClasses(pet)[0] ?? 'Adventurer';
  }

  function pickRandomClass(pet: Pet, rng: Rng): PetClassName {
    const cls = allowedClasses(pet);
    if (cls.length === 0) return 'Adventurer';
    return cls[rng.int(cls.length)] ?? 'Adventurer';
  }

  // ── Validation ────────────────────────────────────────────────────────────

  /** Validate one team's structure (rows, classes, dup pets within team). */
  function validateTeam(team: Team): boolean {
    if (team.slots.length > maxTeamSize) return false;
    let front = 0;
    let back = 0;
    const seen = new Set<PetId>();
    for (const slot of team.slots) {
      if (seen.has(slot.petId)) return false;
      seen.add(slot.petId);
      const pet = inputs.roster.get(slot.petId);
      if (pet === undefined) return false;
      if (slot.assignedClass !== null && !allowedClasses(pet).includes(slot.assignedClass)) {
        return false;
      }
      if (slot.row === 'front') {
        if (++front > MAX_PER_ROW) return false;
      } else if (++back > MAX_PER_ROW) {
        return false;
      }
    }
    return true;
  }

  /** Validate the whole plan, including global pet disjointness. */
  function validatePlan(plan: MultiTeamPlan): boolean {
    if (plan.teams.length > teamCount) return false;
    const globalSeen = new Set<PetId>();
    for (const tp of plan.teams) {
      if (tp.rooms < 1) return false;
      if (!validateTeam(tp.team)) return false;
      for (const slot of tp.team.slots) {
        if (globalSeen.has(slot.petId)) return false; // pet on two teams
        globalSeen.add(slot.petId);
      }
    }
    return true;
  }

  // ── SimulateRunDeps (constant across all evaluations) ───────────────────────

  const deps: SimulateRunDeps = {
    dungeon: inputs.dungeon,
    roster: inputs.roster,
    constants: inputs.constants,
    ...(inputs.globals !== undefined ? { globals: inputs.globals } : {}),
  };

  function runConfigFor(tp: TeamPlan): RunConfig {
    return {
      team: tp.team,
      dungeonId: inputs.dungeon.id,
      depth: tp.depth,
      difficulty: tp.difficulty,
      rooms: tp.rooms,
      nrdcCompletions,
      evaluationMode,
      ...(phoenixFeathers > 0 ? { phoenixFeathers } : {}),
    };
  }

  /** Score a single team (0 for empty; REJECTION_PER_TEAM if infeasible). */
  function scoreTeam(tp: TeamPlan): number {
    if (tp.team.slots.length === 0) return 0;
    let result: RunResult;
    try {
      result = simulateRun(runConfigFor(tp), deps);
    } catch {
      return REJECTION_PER_TEAM;
    }
    const config = runConfigFor(tp);
    const ctx: ObjectiveContext = { config, result, constants: inputs.constants };
    if (inputs.objective.feasible !== undefined && !inputs.objective.feasible(ctx)) {
      return REJECTION_PER_TEAM;
    }
    return inputs.objective.score(ctx);
  }

  function evaluate(plan: MultiTeamPlan): number {
    if (!validatePlan(plan)) return REJECTION_SCORE;
    let total = 0;
    for (const tp of plan.teams) total += scoreTeam(tp);
    return total;
  }

  // ── initial(): round-robin fill across teamCount teams ──────────────────────

  function initial(): MultiTeamPlan {
    const t = defaultTarget();
    const slotLists: TeamSlot[][] = Array.from({ length: teamCount }, () => []);
    const rowCounts = Array.from({ length: teamCount }, () => ({ front: 0, back: 0 }));

    let teamIdx = 0;
    for (const pet of rosterPets) {
      // Find the next team (round-robin) that still has room.
      let placed = false;
      for (let attempt = 0; attempt < teamCount; attempt++) {
        const idx = (teamIdx + attempt) % teamCount;
        const list = slotLists[idx]!;
        const counts = rowCounts[idx]!;
        if (list.length >= maxTeamSize) continue;
        let row: Row | undefined;
        if (counts.front < MAX_PER_ROW) {
          row = 'front';
          counts.front++;
        } else if (counts.back < MAX_PER_ROW) {
          row = 'back';
          counts.back++;
        }
        if (row === undefined) continue;
        list.push({ petId: pet.id, row, assignedClass: pickDefaultClass(pet) });
        teamIdx = (idx + 1) % teamCount;
        placed = true;
        break;
      }
      if (!placed) break; // all teams full
    }

    const teams: TeamPlan[] = slotLists.map(slots => ({
      team: { slots },
      depth: t.depth,
      difficulty: t.difficulty,
      rooms: t.rooms,
    }));
    return { teams };
  }

  // ── randomCandidate(): random valid partition ───────────────────────────────

  function randomCandidate(rng: Rng): MultiTeamPlan {
    const t = defaultTarget();
    const slotLists: TeamSlot[][] = Array.from({ length: teamCount }, () => []);
    const rowCounts = Array.from({ length: teamCount }, () => ({ front: 0, back: 0 }));

    // Shuffle pet order.
    const idxs = Array.from({ length: rosterPets.length }, (_, i) => i);
    for (let i = idxs.length - 1; i > 0; i--) {
      const j = rng.int(i + 1);
      const a = idxs[i]!;
      idxs[i] = idxs[j]!;
      idxs[j] = a;
    }

    for (const idx of idxs) {
      const pet = rosterPets[idx];
      if (pet === undefined) continue;
      // ~25% chance to bench a pet, else assign to a random team with room.
      if (rng.int(4) === 0) continue;
      const start = rng.int(teamCount);
      for (let attempt = 0; attempt < teamCount; attempt++) {
        const ti = (start + attempt) % teamCount;
        const list = slotLists[ti]!;
        const counts = rowCounts[ti]!;
        if (list.length >= maxTeamSize) continue;
        let row: Row | undefined;
        if (counts.front < MAX_PER_ROW && counts.back < MAX_PER_ROW) {
          row = rng.int(2) === 0 ? 'front' : 'back';
        } else if (counts.front < MAX_PER_ROW) {
          row = 'front';
        } else if (counts.back < MAX_PER_ROW) {
          row = 'back';
        }
        if (row === undefined) continue;
        if (row === 'front') counts.front++;
        else counts.back++;
        list.push({ petId: pet.id, row, assignedClass: pickRandomClass(pet, rng) });
        break;
      }
    }

    const teams: TeamPlan[] = slotLists.map(slots => {
      const depth = depthChoices[rng.int(depthChoices.length)] ?? t.depth;
      const difficulty =
        difficultyChoices[rng.int(difficultyChoices.length)] ?? t.difficulty;
      const rooms = roomChoices[rng.int(roomChoices.length)] ?? t.rooms;
      return { team: { slots }, depth, difficulty, rooms };
    });
    return { teams };
  }

  // ── neighbors() ─────────────────────────────────────────────────────────────

  /** Replace team `ti` with `newTeam`, keeping its target. */
  function withTeam(plan: MultiTeamPlan, ti: number, newTeam: Team): MultiTeamPlan {
    const teams = plan.teams.slice();
    teams[ti] = { ...plan.teams[ti]!, team: newTeam };
    return { teams };
  }

  /** Replace team `ti`'s target fields. */
  function withTarget(
    plan: MultiTeamPlan,
    ti: number,
    patch: Partial<Pick<TeamPlan, 'depth' | 'difficulty' | 'rooms'>>,
  ): MultiTeamPlan {
    const teams = plan.teams.slice();
    teams[ti] = { ...plan.teams[ti]!, ...patch };
    return { teams };
  }

  function* neighbors(plan: MultiTeamPlan): Iterable<MultiTeamPlan> {
    const assigned = new Set<PetId>();
    for (const tp of plan.teams) {
      for (const s of tp.team.slots) assigned.add(s.petId);
    }
    const benched = rosterPets.filter(p => !assigned.has(p.id));

    for (let ti = 0; ti < plan.teams.length; ti++) {
      const tp = plan.teams[ti]!;
      const slots = tp.team.slots;
      const front = slots.filter(s => s.row === 'front').length;
      const back = slots.filter(s => s.row === 'back').length;

      // ── ADD_PET (benched → this team) ──────────────────────────────────────
      if (slots.length < maxTeamSize) {
        let row: Row | undefined;
        if (front < MAX_PER_ROW) row = 'front';
        else if (back < MAX_PER_ROW) row = 'back';
        if (row !== undefined) {
          for (const pet of benched) {
            yield withTeam(plan, ti, {
              slots: [...slots, { petId: pet.id, row, assignedClass: pickDefaultClass(pet) }],
            });
          }
        }
      }

      for (let i = 0; i < slots.length; i++) {
        const slot = slots[i]!;

        // ── REMOVE_PET (bench it) ────────────────────────────────────────────
        yield withTeam(plan, ti, { slots: slots.filter((_, j) => j !== i) });

        // ── CHANGE_CLASS ─────────────────────────────────────────────────────
        const pet = inputs.roster.get(slot.petId);
        if (pet !== undefined) {
          for (const cls of allowedClasses(pet)) {
            if (cls === slot.assignedClass) continue;
            const ns = slots.slice();
            ns[i] = { ...slot, assignedClass: cls };
            yield withTeam(plan, ti, { slots: ns });
          }
        }

        // ── FLIP_ROW ─────────────────────────────────────────────────────────
        if (slot.row === 'front' && back < MAX_PER_ROW) {
          const ns = slots.slice();
          ns[i] = { ...slot, row: 'back' };
          yield withTeam(plan, ti, { slots: ns });
        } else if (slot.row === 'back' && front < MAX_PER_ROW) {
          const ns = slots.slice();
          ns[i] = { ...slot, row: 'front' };
          yield withTeam(plan, ti, { slots: ns });
        }

        // ── MOVE_PET (to another team with room) ─────────────────────────────
        for (let tj = 0; tj < plan.teams.length; tj++) {
          if (tj === ti) continue;
          const dst = plan.teams[tj]!;
          if (dst.team.slots.length >= maxTeamSize) continue;
          const dFront = dst.team.slots.filter(s => s.row === 'front').length;
          const dBack = dst.team.slots.filter(s => s.row === 'back').length;
          let row: Row | undefined;
          if (dFront < MAX_PER_ROW) row = 'front';
          else if (dBack < MAX_PER_ROW) row = 'back';
          if (row === undefined) continue;

          const teams = plan.teams.slice();
          teams[ti] = { ...tp, team: { slots: slots.filter((_, j) => j !== i) } };
          teams[tj] = {
            ...dst,
            team: { slots: [...dst.team.slots, { petId: slot.petId, row, assignedClass: slot.assignedClass }] },
          };
          yield { teams };
        }
      }

      // ── CHANGE_TARGET (±1 depth, ±1 difficulty, each room choice) ───────────
      const di = depthChoices.indexOf(tp.depth);
      for (const ndi of [di - 1, di + 1]) {
        const d = depthChoices[ndi];
        if (d !== undefined) yield withTarget(plan, ti, { depth: d });
      }
      const fi = difficultyChoices.indexOf(tp.difficulty);
      for (const nfi of [fi - 1, fi + 1]) {
        const f = difficultyChoices[nfi];
        if (f !== undefined) yield withTarget(plan, ti, { difficulty: f });
      }
      for (const r of roomChoices) {
        if (r !== tp.rooms) yield withTarget(plan, ti, { rooms: r });
      }
    }
  }

  return { evaluate, initial, neighbors, randomCandidate };
}

// ── Reporting helper ────────────────────────────────────────────────────────

/**
 * Run every team in a plan and return a per-team breakdown (run result, score,
 * feasibility). Pure convenience for CLI/web display — mirrors `evaluate`'s
 * scoring but exposes the intermediate `RunResult`s. Empty teams are omitted.
 */
export function summarizeMultiTeamPlan(
  plan: MultiTeamPlan,
  inputs: MultiTeamInputs,
): TeamPlanSummary[] {
  const evaluationMode = inputs.evaluationMode ?? 'expected';
  const nrdcCompletions = inputs.nrdcCompletions ?? 0;
  const phoenixFeathers = inputs.phoenixFeathers ?? 0;
  const deps: SimulateRunDeps = {
    dungeon: inputs.dungeon,
    roster: inputs.roster,
    constants: inputs.constants,
    ...(inputs.globals !== undefined ? { globals: inputs.globals } : {}),
  };

  const out: TeamPlanSummary[] = [];
  for (const tp of plan.teams) {
    if (tp.team.slots.length === 0) continue;
    const config: RunConfig = {
      team: tp.team,
      dungeonId: inputs.dungeon.id,
      depth: tp.depth,
      difficulty: tp.difficulty,
      rooms: tp.rooms,
      nrdcCompletions,
      evaluationMode,
      ...(phoenixFeathers > 0 ? { phoenixFeathers } : {}),
    };
    const result = simulateRun(config, deps);
    const ctx: ObjectiveContext = { config, result, constants: inputs.constants };
    const feasible =
      inputs.objective.feasible === undefined || inputs.objective.feasible(ctx);
    out.push({ plan: tp, result, score: feasible ? inputs.objective.score(ctx) : 0, feasible });
  }
  return out;
}

export { REJECTION_SCORE, REJECTION_PER_TEAM };
