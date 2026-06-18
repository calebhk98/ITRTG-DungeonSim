import type { PetClassName } from '../domain/class.js';
import type { ClassModifiers } from '../domain/class.js';

/**
 * How confident we are in a particular constant's accuracy.
 *   - 'confirmed'  — verified directly from dev source or unambiguous in-game UI.
 *   - 'community'  — sourced from wiki / player testing; generally reliable.
 *   - 'estimated'  — reverse-engineered or inferred; may drift between patches.
 *   - 'unknown'    — placeholder; must NOT be used in a formula path without an
 *                    explicit TODO comment. See plan §"Constants guard".
 */
export type Confidence = 'confirmed' | 'community' | 'estimated' | 'unknown';

/**
 * A single game constant with provenance metadata.
 * Every formula number in `GameConstants` is wrapped in this type so callers
 * know where the value came from and how much to trust it.
 */
export interface Const<T> {
  /** The actual numeric (or other) value. */
  readonly value: T;
  /**
   * Citation: which research-doc section or external source this comes from.
   * E.g. 'research §6.1', 'research §7.1', 'itrtg.wiki.gg/wiki/Pets'.
   */
  readonly source: string;
  /** Confidence level in this value's accuracy. */
  readonly confidence: Confidence;
  /**
   * Human-readable note about uncertainty, conflicting sources, or caveats.
   * Required when `confidence` is 'estimated' or 'unknown'.
   */
  readonly note?: string;
}

/**
 * Unwrap a `Const<T>` to its raw value.
 * Callers should always go through this helper so grep / static analysis can
 * locate every place a constant is consumed.
 */
export function resolve<T>(c: Const<T>): T {
  return c.value;
}

// ── Sub-interfaces used in GameConstants ──────────────────────────────────────

/** Base stat values before DL scaling (research §6.1). */
export interface StatBases {
  /** HP base addend: `10 + 24 × DL`. This is the `10` part. */
  hpBase: Const<number>;
  /** HP per DL: the `24` in `10 + 24 × DL`. */
  hpPerDL: Const<number>;
  /** Attack/Defense/Speed base addend: `1 + 2.4 × DL`. This is the `1` part. */
  adsBase: Const<number>;
  /** Attack/Defense/Speed per DL: the `2.4` in `1 + 2.4 × DL`. */
  adsPerDL: Const<number>;
}

/** Damage-formula constants (research §6.2). */
export interface DamageConstants {
  /**
   * Soft-cap constant K in Defense factor: `1 - D/(D + K)`.
   * At K=200: 200 Def = 50% mitigation, 800 Def = 80%.
   */
  defenseSoftCapK: Const<number>;
  /** Back-row damage multiplier (research §6.2 Step 5). */
  backRowPenalty: Const<number>;
  /** Front-row Speed bonus (research §6.2 note). */
  frontRowSpeedBonus: Const<number>;
  /** Hit-chance floor (research §6.2): minimum hit probability. */
  hitChanceFloor: Const<number>;
  /**
   * Divisor for SpeedDamage bypass (research §6.2 Step 4):
   * `SpeedDamage = (AttackerSpeed - DefenderSpeed) / divisor`.
   */
  speedDamageDivisor: Const<number>;
}

/** Speed → actions-per-round thresholds (research §6.3). */
export interface SpeedThresholds {
  /**
   * Speed divisor for 2nd-action probability in the 1–500 range.
   * `P(2nd action) = speed / threshold2nd` when speed ≤ 500.
   */
  threshold2ndAction: Const<number>;
  /**
   * Speed divisor for 3rd-action probability in the 501–1500 range.
   * `P(3rd action) = (speed - 500) / threshold3rdAction` when 500 < speed ≤ 1500.
   */
  threshold3rdAction: Const<number>;
  /** Hard cap: maximum actions per round (research §6.3: cap at 3). */
  maxActionsPerRound: Const<number>;
}

/** Defender-specific HP scaling past CL 25 (research §6.2b). */
export interface DefenderHpScaling {
  /** CL at which Defender's HP ClassMod starts growing beyond 1.20. */
  breakpointCL: Const<number>;
  /** Additional HP ClassMod per CL above the breakpoint (research §6.2b: 0.01). */
  perCLAbove: Const<number>;
}

/** Strategy Room modifier constants (research §6.2a). */
export interface StrategyRoomConstants {
  /**
   * Base addend in the SR modifier: `SRMod = (base + Growth4th/growthDivisor) × (1 + Books/booksDivisor)`.
   * Research §6.2a: base = 0.1.
   */
  base: Const<number>;
  /** Divisor for the 4th-lowest pet growth term (research §6.2a: 5000). */
  growthDivisor: Const<number>;
  /**
   * Divisor for strategy books (research §6.2a: 0.4800).
   * Note: listed as "0.4800" in the doc — may be the literal divisor or a fraction.
   */
  booksDivisor: Const<number>;
}

/** Boss multiplier constants (research §7.1). */
export interface BossConstants {
  /** Base multipliers at Difficulty 0 by depth. */
  depthMultipliers: Const<Record<1 | 2 | 3, number>>;
  /**
   * Additive multiplier increase per difficulty level (research §7.1: +10%).
   * `effectiveMult = depthBase × (1 + perDiffAdditive × difficulty)`.
   */
  perDiffAdditive: Const<number>;
}

/** Infinity Tower scaling constants (research §7.4). */
export interface TowerConstants {
  /**
   * Per-floor stat increments at floors 0–49 (research §7.4).
   * `HP(f) = base × (1 + hp × f)` etc. Increment doubles every `doublingEveryFloors` floors.
   */
  floorIncrement: Const<{ hp: number; atk: number }>;
  /** Number of floors between doubling of the per-floor increment (research §7.4: 50). */
  doublingEveryFloors: Const<number>;
  /** Floor at which Tower XP is capped (research §7.4: 200). Enemy stats continue uncapped. */
  xpCapFloor: Const<number>;
}

/** Combat resolution constants (research §6.6). */
export interface CombatResolutionConstants {
  /**
   * Hard cap on the number of turns a single fight (room encounter) may run.
   * If neither side is wiped within this many turns, the team LOSES automatically
   * (research §6.6.2). Replaces the old "round safety cap" with a game-accurate rule.
   */
  maxTurnsPerFight: Const<number>;
}

/** Consumable-item constants (research §6.6.4). */
export interface ItemConstants {
  /**
   * Fraction of a pet's max HP restored when a Phoenix Feather revives it.
   * Research §6.6.4: revive at the start of the next turn with 20% max HP.
   */
  phoenixFeatherHpRestore: Const<number>;
}

/** Run timing constants (research §6.3a). */
export interface TimingConstants {
  /** Base minutes per room before NRDC reductions (research §3: 15). */
  minutesPerRoom: Const<number>;
  /**
   * Fractional time reduction per NRDC completion (research §6.3a: 0.01 = 1%).
   * `timePerRoom = 15 × (1 - 0.01 × nrdcCompletions)`.
   */
  nrdcReductionPerCompletion: Const<number>;
}

/** Experience curve constants (research §6.4). */
export interface XpConstants {
  /**
   * DL XP curve constants. Research §6.4:
   *   n < 10  → 10 × (n-1)^2
   *   n ≥ 10  → 10 × (n-1)^2.25
   */
  dlXpCurve: Const<{ base: number; exponentLow: number; exponentHigh: number; threshold: number }>;
  /**
   * CL XP curve constants. Research §6.4:
   *   CL1→2 = 3000
   *   else 1000 + 2000 × (n-1)^2
   */
  clXpCurve: Const<{ firstLevelCost: number; base: number; perLevelBase: number; exponent: number }>;
  /**
   * DL XP is granted per-enemy-killed, not per-room flat.
   * Confidence 'community': wiki references this but exact per-room counts are not published.
   * See XP-NOTE in the build plan.
   */
  xpIsPerEnemyKilled: Const<boolean>;
}

/** Reward-related constants (research §8). */
export interface RewardConstants {
  /**
   * Lucky Draw material scaling with top-50 total DL (patch 4.26, research §8.5).
   * Multiplier = `1 + (top50DL / luckyDrawDlDivisor)`.
   */
  luckyDrawDlDivisor: Const<number>;
  /**
   * Overtime bonus cap (patch 4.26, research §8.2).
   * At 2× completion time the reward bonus is +85% (185% total).
   */
  overtimeMaxBonus: Const<number>;
  /**
   * Growth scaling per pet from D4 Event 2 (research §7.3).
   * `growth = 15 + 1.5 × difficulty`.
   */
  d4Event2GrowthBase: Const<number>;
  d4Event2GrowthPerDiff: Const<number>;
}

/**
 * The complete set of game-formula constants consumed by the simulator.
 * Every field is a `Const<T>` so the sim can be audited, patched, or swept
 * when a patch changes game numbers.
 *
 * Sections correspond to research doc §5–§8.
 */
export interface GameConstants {
  // ── §5.4 Growth ────────────────────────────────────────────────────────────
  /**
   * Divisor in the growth multiplier: `1 + TotalGrowth / growthDivisor`.
   * Research §5.4: "Growth/200,000 factor". Every +2,000 growth ≈ +1%.
   */
  growthDivisor: Const<number>;

  // ── §6.1 Stat formulas ─────────────────────────────────────────────────────
  /** Base stat constants for the HP and ADS formulas. */
  statBases: StatBases;

  // ── §6.2 Damage pipeline ───────────────────────────────────────────────────
  /** Damage-formula constants. */
  damage: DamageConstants;

  // ── §6.3 Speed → actions ───────────────────────────────────────────────────
  /** Speed threshold constants for multi-action mechanic. */
  speedThresholds: SpeedThresholds;

  // ── §6.6 Combat resolution ─────────────────────────────────────────────────
  /** Turn-loop resolution constants (50-turn auto-loss cap). */
  combat: CombatResolutionConstants;

  // ── §6.6.4 Consumable items ────────────────────────────────────────────────
  /** Consumable-item constants (Phoenix Feather revive, etc.). */
  items: ItemConstants;

  // ── §5.5 Class modifiers ───────────────────────────────────────────────────
  /** Stat multipliers for each pet class. */
  classMods: Const<Record<PetClassName, ClassModifiers>>;

  // ── §6.2b Defender HP scaling ──────────────────────────────────────────────
  defenderHpScale: DefenderHpScaling;

  // ── §6.2a Strategy Room ────────────────────────────────────────────────────
  strategyRoom: StrategyRoomConstants;

  // ── §7.1 Boss multipliers ──────────────────────────────────────────────────
  bosses: BossConstants;

  // ── §7.4 Infinity Tower ────────────────────────────────────────────────────
  tower: TowerConstants;

  // ── §6.3a Timing ───────────────────────────────────────────────────────────
  timing: TimingConstants;

  // ── §6.4 XP curves ────────────────────────────────────────────────────────
  xp: XpConstants;

  // ── §8 Rewards ─────────────────────────────────────────────────────────────
  rewards: RewardConstants;
}
