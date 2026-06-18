import type { RunConfig } from '../domain/run.js';
import type { RunResult } from '../domain/run.js';
import type { GameConstants } from '../constants/types.js';

/**
 * The shared context passed to every objective's `score()` and `feasible()` calls.
 * Bundles all information an objective needs without coupling it to the optimizer.
 */
export interface ObjectiveContext {
  /** The configuration that produced this run result. */
  readonly config: RunConfig;
  /** The simulation output to evaluate. */
  readonly result: RunResult;
  /** Game constants (injected so objectives can reference formula thresholds). */
  readonly constants: GameConstants;
}

/**
 * A pluggable objective function for the optimizer.
 * The optimizer maximises `score(ctx)` subject to `feasible(ctx) !== false`.
 *
 * Built-in objectives (resourceYieldPerHour, maxClearableDepth, survivalRate,
 * xpPerHour, materialTargetYield, weightedComposite) are registered in WP-E.
 * Custom objectives can be registered without touching core engine code.
 *
 * Plan §"Objective" section; plan §"Key design contracts".
 */
export interface Objective {
  /**
   * Stable unique identifier for this objective (e.g. 'resourceYieldPerHour').
   * Used as the key in `objectiveRegistry`.
   */
  readonly id: string;
  /**
   * Compute a scalar score for a run result. Higher is always better.
   * Must be a PURE function (no side effects, no mutable captures).
   */
  score(ctx: ObjectiveContext): number;
  /**
   * Optional feasibility check. If present and returns `false`, the candidate
   * is treated as infeasible (score effectively = -Infinity for the optimizer).
   * Typical use: ensure minimum HP floor, required clear rate, etc.
   *
   * Returns `undefined` (absent) = always feasible.
   */
  feasible?(ctx: ObjectiveContext): boolean;
}

/**
 * Global registry of named objectives. Objectives register themselves here so
 * CLI users can reference them by id (e.g. `--objective resourceYieldPerHour`).
 *
 * Built-in objectives are appended in WP-E; custom objectives can call
 * `objectiveRegistry.set(obj.id, obj)` at startup.
 */
export const objectiveRegistry = new Map<string, Objective>();
