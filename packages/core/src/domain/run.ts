import type { PetId } from './ids.js';
import type { Element } from './element.js';
import type { Team } from './team.js';
import type { DungeonId, Depth, Difficulty } from './dungeon.js';

/**
 * Whether the simulation uses deterministic expected-value strategy (fast, optimizer
 * inner loop) or stochastic Monte Carlo sampling (accurate, re-rank finalists).
 * Research §10; plan §"Sim strategy".
 */
export type EvaluationMode = 'expected' | 'monteCarlo';

/**
 * A structured bundle of all rewards that a run can yield.
 * Research §8.1–§8.5: God Power, Lucky Draws, Pet Stones, growth, XP, crafting
 * materials (T1–T4, element-specific), runes, keys, and Lucky Draw draws.
 *
 * Material quantities are modelled as a sparse map (element → tier → amount)
 * to avoid enumerating every element×tier combination as a flat field.
 */
export interface RewardBundle {
  /** God Power earned (research §8.1). */
  godPower: number;
  /**
   * Lucky Draw tickets earned.
   * Scales with top-50 total DL per research §8.5: `1 + (top50DL / 1000)`.
   */
  luckyDraws: number;
  /** Pet Stones earned (research §8.1). */
  petStones: number;
  /**
   * Growth awarded to pets via in-run events (research §3, §7.3).
   * This is the total pool; distribution across pets is tracked in `RunResult.perPet`.
   */
  growthAwarded: number;
  /**
   * Dungeon XP earned (aggregate across all pets, all kills).
   * Per-pet XP is in `RunResult.perPet`; see research §6.4 and XP-NOTE.
   */
  xpTotal: number;
  /**
   * Crafting materials by element then tier.
   * e.g. `materials['Fire'][3]` = T3 Fire materials earned.
   * Research §8.4: T1 from D1, T2 from D1 bosses/crafting, T3 D2–D3, T4 D4/Tower.
   */
  materials: Partial<Record<Element, Partial<Record<1 | 2 | 3 | 4, number>>>>;
  /**
   * Number of pet equipment drops received.
   * Actual pieces are out of scope for RunResult (equipment identity is complex);
   * the count is enough for the optimizer.
   */
  equipmentDrops: number;
  /**
   * D4 key material fragments earned (Infinity Tower / Depth-4 only).
   * Research §8.2: `(floor#/4)%` per enemy for tower.
   */
  keyMaterials: number;
  /**
   * Runes earned (if any — exact rune mechanic not fully documented in research doc).
   * Confidence: 'estimated'.
   */
  runes: number;
}

/**
 * Configuration for a single simulation run.
 * Passed into `runSimulator(config, constants)` (WP-H) to produce a `RunResult`.
 */
export interface RunConfig {
  /** The team to send into the dungeon. */
  readonly team: Team;
  /** Target dungeon. */
  readonly dungeonId: DungeonId;
  /** Depth tier (1–4). Depth 4 requires all NRDCs (research §3). */
  readonly depth: Depth;
  /** Within-depth difficulty slider (0–10). */
  readonly difficulty: Difficulty;
  /**
   * Number of rooms to run, 1–60. Research §3:
   * - 1–48 rooms without NRDC completions (15 min each).
   * - Up to 60 rooms once all NRDCs are done.
   * - Runs < 6 rooms get no events (research §3).
   */
  readonly rooms: number;
  /**
   * Number of No-Rebirth Dungeon Challenge completions the player has.
   * Reduces time per room: `15 × (1 − 0.01 × nrdcCompletions)` minutes.
   * Research §6.3a: 20 completions → 12 min/room.
   */
  readonly nrdcCompletions: number;
  /** Which simulation strategy to use. */
  readonly evaluationMode: EvaluationMode;
  /**
   * Optional RNG seed for deterministic Monte Carlo runs.
   * If absent in 'monteCarlo' mode, a random seed is chosen.
   */
  readonly rngSeed?: number;
  /**
   * Number of independent MC trials to average when `evaluationMode === 'monteCarlo'`.
   * Higher = more accurate distribution; lower = faster.
   */
  readonly monteCarloTrials?: number;
}

/**
 * Per-pet statistics recorded during a run simulation.
 */
export interface PerPetStats {
  /** Total damage dealt by this pet across all rooms. */
  dealt: number;
  /** Total damage received by this pet across all rooms. */
  taken: number;
  /** Total XP this pet gained from enemy kills during the run. */
  xpGained: number;
}

/**
 * Distribution summary produced by Monte Carlo evaluation over many trials.
 * Gives the optimizer a sense of variance, not just expected value.
 */
export interface RunResultDistribution {
  /** Fraction of trials where the team cleared all rooms without a full wipe. */
  clearRate: number;
  /** Median elapsed minutes across trials. */
  timeP50: number;
  /** 95th-percentile elapsed minutes (worst-tail runs). */
  timeP95: number;
  /** Mean rewards bundle averaged across all trials. */
  meanRewards: RewardBundle;
}

/**
 * The output of a single simulated dungeon run.
 *
 * For `evaluationMode === 'expected'`: `distribution` is absent; `rewards` and
 * timing fields represent the deterministic expected-value outcome.
 * For `evaluationMode === 'monteCarlo'`: `distribution` holds the full summary;
 * `rewards` and `cleared` reflect the median / most-likely trial.
 */
export interface RunResult {
  /** Whether the team cleared all requested rooms without a full wipe. */
  readonly cleared: boolean;
  /** How many rooms were actually completed (≤ `RunConfig.rooms`). */
  readonly roomsCleared: number;
  /** Ids of pets that died during the run (not revived). */
  readonly petDeaths: ReadonlyArray<PetId>;
  /** Total elapsed wall-clock minutes for the run. Research §6.3a. */
  readonly elapsedMinutes: number;
  /** All rewards accumulated during this run. */
  readonly rewards: RewardBundle;
  /** Per-pet breakdown of damage dealt/taken and XP earned. */
  readonly perPet: ReadonlyMap<PetId, PerPetStats>;
  /**
   * Monte Carlo distribution summary. Only present when
   * `RunConfig.evaluationMode === 'monteCarlo'`.
   */
  readonly distribution?: RunResultDistribution;
}
