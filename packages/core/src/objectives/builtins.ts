/**
 * Built-in objective functions for the ITRTG dungeon optimizer (WP-E).
 *
 * Each objective implements the `Objective` interface and is registered into
 * `objectiveRegistry` under its stable `id`.
 *
 * All objectives are PURE and TOTAL:
 *  - No side effects, no mutable captures.
 *  - No throws on missing optional fields — missing values default to 0 or safe
 *    sentinel values.
 *
 * Strict TS flags enforced: noUncheckedIndexedAccess, exactOptionalPropertyTypes.
 */

import type { Element } from '../domain/element.js';
import type { RewardBundle } from '../domain/run.js';
import { objectiveRegistry } from './Objective.js';
import type { Objective, ObjectiveContext } from './Objective.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Safely convert elapsedMinutes to hours, returning a safe fallback when the
 * run time is zero (avoids division by zero).
 */
function toHours(elapsedMinutes: number): number {
  return elapsedMinutes > 0 ? elapsedMinutes / 60 : 1e-9;
}

/**
 * Compute total material count across all elements and tiers.
 * Used internally by composite/default objectives.
 */
function totalMaterials(materials: RewardBundle['materials']): number {
  let total = 0;
  for (const tierMap of Object.values(materials)) {
    if (tierMap == null) continue;
    for (const amount of Object.values(tierMap)) {
      if (typeof amount === 'number') total += amount;
    }
  }
  return total;
}

// ---------------------------------------------------------------------------
// 1. resourceYieldPerHour
// ---------------------------------------------------------------------------

/**
 * Weights for the `resourceYieldPerHour` objective.
 * Each key corresponds to a scalar field of `RewardBundle` (not `materials`,
 * which is handled via a flat `materialsTotal` weight applied to the sum of
 * all material tiers/elements).
 */
export interface ResourceYieldWeights {
  godPower?: number | undefined;
  luckyDraws?: number | undefined;
  petStones?: number | undefined;
  growthAwarded?: number | undefined;
  xpTotal?: number | undefined;
  /** Applied to the sum of all materials across all elements and tiers. */
  materialsTotal?: number | undefined;
  equipmentDrops?: number | undefined;
  keyMaterials?: number | undefined;
  runes?: number | undefined;
}

/**
 * Configurable factory for a weighted-sum resource-yield-per-hour objective.
 *
 * score = Σ(weight_i × reward_i) / elapsedHours
 *
 * `feasible` requires the run to have cleared (all rooms completed).
 * elapsedMinutes=0 is handled safely via a near-zero denominator.
 */
export function makeResourceYieldPerHour(
  weights: ResourceYieldWeights,
  id = 'resourceYieldPerHour',
): Objective {
  return {
    id,

    score(ctx: ObjectiveContext): number {
      const r = ctx.result.rewards;
      const hours = toHours(ctx.result.elapsedMinutes);

      const weightedSum =
        (weights.godPower ?? 0) * r.godPower +
        (weights.luckyDraws ?? 0) * r.luckyDraws +
        (weights.petStones ?? 0) * r.petStones +
        (weights.growthAwarded ?? 0) * r.growthAwarded +
        (weights.xpTotal ?? 0) * r.xpTotal +
        (weights.materialsTotal ?? 0) * totalMaterials(r.materials) +
        (weights.equipmentDrops ?? 0) * r.equipmentDrops +
        (weights.keyMaterials ?? 0) * r.keyMaterials +
        (weights.runes ?? 0) * r.runes;

      return weightedSum / hours;
    },

    feasible(ctx: ObjectiveContext): boolean {
      return ctx.result.cleared;
    },
  };
}

/**
 * Default instance of `resourceYieldPerHour` with sensible weights reflecting
 * the relative value of each resource in mid-game play:
 *
 * - God Power is the primary upgrade currency → weight 1.0
 * - Lucky Draws are scarce and valuable → weight 50.0 (each draw ≈ 50 GP-equivalent)
 * - Pet Stones are plentiful but broadly useful → weight 5.0
 * - Materials are the main farm objective → weight 10.0 per unit across all tiers
 * - Growth is valuable for evolution/unlocks → weight 2.0
 * - XP is nearly free and abundant → weight 0.1 (de-emphasised)
 * - Equipment drops are rare and impactful → weight 20.0
 * - Key materials unlock D4 → weight 15.0
 * - Runes are a bonus → weight 3.0
 */
export const resourceYieldPerHour: Objective = makeResourceYieldPerHour(
  {
    godPower: 1.0,
    luckyDraws: 50.0,
    petStones: 5.0,
    growthAwarded: 2.0,
    xpTotal: 0.1,
    materialsTotal: 10.0,
    equipmentDrops: 20.0,
    keyMaterials: 15.0,
    runes: 3.0,
  },
  'resourceYieldPerHour',
);

// ---------------------------------------------------------------------------
// 2. maxClearableDepth
// ---------------------------------------------------------------------------

/**
 * Rewards reaching high depth+difficulty combinations.
 *
 * score = depth*100 + difficulty  (cleared run)
 * score = roomsCleared            (partial / failed run — partial credit)
 *
 * Depth and difficulty are pulled from `ctx.config`.
 */
export const maxClearableDepth: Objective = {
  id: 'maxClearableDepth',

  score(ctx: ObjectiveContext): number {
    if (ctx.result.cleared) {
      return ctx.config.depth * 100 + ctx.config.difficulty;
    }
    // Partial credit: how many rooms the team survived.
    return ctx.result.roomsCleared;
  },
};

// ---------------------------------------------------------------------------
// 3. survivalRate
// ---------------------------------------------------------------------------

/**
 * Measures how reliably the team survives the dungeon.
 *
 * MC-aware:
 *   - If `ctx.result.distribution` is present → score = distribution.clearRate
 *     (already [0,1], directly comparable across configs).
 *   - Otherwise → score = cleared ? 1 : roomsCleared / config.rooms  (EV proxy)
 *
 * A penalty of 0.05 per pet death is subtracted to discourage runs that clear
 * but lose pets (which hurts future runs).  Score is clamped to [0, 1].
 */
export const survivalRate: Objective = {
  id: 'survivalRate',

  score(ctx: ObjectiveContext): number {
    const dist = ctx.result.distribution;
    let base: number;

    if (dist !== undefined) {
      base = dist.clearRate;
    } else if (ctx.result.cleared) {
      base = 1;
    } else {
      const rooms = ctx.config.rooms > 0 ? ctx.config.rooms : 1;
      base = ctx.result.roomsCleared / rooms;
    }

    const deathPenalty = ctx.result.petDeaths.length * 0.05;
    return Math.max(0, base - deathPenalty);
  },
};

// ---------------------------------------------------------------------------
// 4. xpPerHour
// ---------------------------------------------------------------------------

/**
 * Maximises total dungeon XP earned per hour of real time.
 *
 * score = rewards.xpTotal / elapsedHours
 *
 * elapsedMinutes=0 is handled safely.
 */
export const xpPerHour: Objective = {
  id: 'xpPerHour',

  score(ctx: ObjectiveContext): number {
    const hours = toHours(ctx.result.elapsedMinutes);
    return ctx.result.rewards.xpTotal / hours;
  },
};

// ---------------------------------------------------------------------------
// 5. makeMaterialTargetYield
// ---------------------------------------------------------------------------

/**
 * Factory that returns an objective maximising a specific elemental material
 * (identified by element + tier) per hour.
 *
 * score = materials[element]?.[tier] / elapsedHours
 *
 * Returns 0 if that material was not obtained (sparse map miss — safe).
 *
 * `id` is auto-generated as `materialYield:${element}:T${tier}`.
 */
export function makeMaterialTargetYield(
  element: Element,
  tier: 1 | 2 | 3 | 4,
): Objective {
  const id = `materialYield:${element}:T${tier}` as const;
  return {
    id,

    score(ctx: ObjectiveContext): number {
      const hours = toHours(ctx.result.elapsedMinutes);
      // noUncheckedIndexedAccess-safe: both lookups may be undefined.
      const tierMap = ctx.result.rewards.materials[element];
      const amount = tierMap?.[tier] ?? 0;
      return amount / hours;
    },
  };
}

// ---------------------------------------------------------------------------
// 6. makeWeightedComposite
// ---------------------------------------------------------------------------

/**
 * A part entry for `makeWeightedComposite`.
 */
export interface CompositePart {
  readonly objective: Objective;
  readonly weight: number;
}

/**
 * Factory that combines multiple objectives into a linear weighted composite.
 *
 * score = Σ(part.weight × part.objective.score(ctx))
 *
 * feasible = all constituent objectives' feasible() checks pass (if present).
 *
 * Useful for blended goals such as "GP/hr + material yield".
 * The caller supplies the id (no implicit id because weights are caller-specific).
 */
export function makeWeightedComposite(
  parts: ReadonlyArray<CompositePart>,
  id: string,
): Objective {
  return {
    id,

    score(ctx: ObjectiveContext): number {
      let total = 0;
      for (const part of parts) {
        total += part.weight * part.objective.score(ctx);
      }
      return total;
    },

    feasible(ctx: ObjectiveContext): boolean {
      for (const part of parts) {
        if (part.objective.feasible !== undefined && !part.objective.feasible(ctx)) {
          return false;
        }
      }
      return true;
    },
  };
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

/**
 * Register all built-in objectives into the global registry.
 * Factories (makeResourceYieldPerHour, makeMaterialTargetYield,
 * makeWeightedComposite) produce named instances that callers register
 * themselves; only the pre-built singletons are registered here.
 */
objectiveRegistry.set(resourceYieldPerHour.id, resourceYieldPerHour);
objectiveRegistry.set(maxClearableDepth.id, maxClearableDepth);
objectiveRegistry.set(survivalRate.id, survivalRate);
objectiveRegistry.set(xpPerHour.id, xpPerHour);
