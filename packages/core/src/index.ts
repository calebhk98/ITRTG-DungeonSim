/**
 * Public surface of @itrtg-sim/core.
 *
 * APPEND-ONLY: add new re-exports as new modules are implemented. Do NOT
 * remove or reorder existing exports — downstream agents and the CLI compile
 * against this barrel.
 */

// ── Domain types ──────────────────────────────────────────────────────────────
export * from './domain/index.js';

// ── Constants ─────────────────────────────────────────────────────────────────
export type {
  Confidence,
  Const,
  GameConstants,
  StatBases,
  DamageConstants,
  SpeedThresholds,
  DefenderHpScaling,
  StrategyRoomConstants,
  BossConstants,
  TowerConstants,
  TimingConstants,
  XpConstants,
  RewardConstants,
} from './constants/types.js';
export { resolve } from './constants/types.js';
export { DEFAULT_CONSTANTS } from './constants/gameConstants.js';

// ── Importers ─────────────────────────────────────────────────────────────────
export {
  defaultRegistry,
  ImporterRegistry,
  ImporterError,
} from './importers/index.js';
export type { ImportResult, PetImporter } from './importers/index.js';

// ── Sim — RNG ─────────────────────────────────────────────────────────────────
export type { Rng } from './sim/rng.js';
export { mulberry32, ExpectedValueRng } from './sim/rng.js';

// ── Sim — Strategy (type only; implementations in WP-F) ─────────────────────
export type { CombatStrategy } from './sim/strategy.js';

// ── Sim — Stat pipeline (WP-B) ───────────────────────────────────────────────
export { deriveCombatContext } from './sim/stats.js';
export type { StatDerivationInput } from './sim/stats.js';

// ── Sim — Combat strategies (WP-F) ───────────────────────────────────────────
export { DeterministicExpectedStrategy, MonteCarloStrategy } from './sim/strategies.js';

// ── Sim — Combat resolver (WP-F) ─────────────────────────────────────────────
export { resolveRound } from './sim/combat.js';
export type { RoundOutcome, AbilityHookContext, AbilityModifier } from './sim/combat.js';

// ── Sim — Enemy scaling (WP-G) ───────────────────────────────────────────────
export { scaleEnemyStats, scaleEnemyToContext } from './sim/scaling.js';
export type { ScaleEnemyOpts, ScaleEnemyToContextOpts } from './sim/scaling.js';

// ── Objectives (interface + built-ins WP-E) ──────────────────────────────────
export type { Objective, ObjectiveContext } from './objectives/Objective.js';
export { objectiveRegistry } from './objectives/Objective.js';
export * from './objectives/builtins.js';

// ── Optimizer (implementations in WP-I) ──────────────────────────────────────
export type {
  SearchProblem,
  OptimizeOptions,
  ScoreTrace,
  Optimizer,
} from './optimizer/SearchProblem.js';
