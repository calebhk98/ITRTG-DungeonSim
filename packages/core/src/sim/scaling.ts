/**
 * WP-G: Enemy scaling resolver.
 *
 * Converts an `EnemyArchetype` (base stats + a `ScalingSpec`) plus a
 * difficulty/floor into concrete `CombatStats`, and optionally a full
 * `CombatContext` suitable for the combat resolver.
 *
 * Research §7 shows that different enemies use fundamentally different
 * scaling curves — this module implements all five discriminated kinds.
 */

import { resolve } from '../constants/types.js';
import type { GameConstants } from '../constants/types.js';
import type { CombatStats, CombatContext } from '../domain/combat.js';
import type { EnemyArchetype } from '../domain/enemy.js';
import type { Difficulty, Depth } from '../domain/dungeon.js';
import type { ElementLevels } from '../domain/gear.js';

// ── Public option bags ────────────────────────────────────────────────────────

/**
 * Options for `scaleEnemyStats`.
 *
 * - `difficulty`        – 0–10 within-depth slider (research §4).
 * - `floor`            – Infinity Tower floor (only relevant for `towerFloor`).
 * - `depth`            – Dungeon depth 1–4; used to look up boss multiplier
 *                        when `bossMult` spec has no explicit `base` OR to pick
 *                        the right `depthMultipliers` entry.
 * - `petStatsReference`– Team aggregate stats used by `bossMult` scaling.
 *                        If absent, falls back to archetype.baseStats × mult.
 */
export interface ScaleEnemyOpts {
  difficulty: Difficulty;
  floor?: number;
  depth?: Depth;
  petStatsReference?: CombatStats;
}

// ── Core scaling function ─────────────────────────────────────────────────────

/**
 * Resolve an `EnemyArchetype`'s raw base stats into fully-scaled `CombatStats`
 * for the given difficulty/floor, following ITRTG's non-uniform scaling rules
 * (research §7).
 *
 * Switching on `archetype.scaling.kind`:
 *
 * **linear** (Cosmic Gnome §7.2):
 *   `stat = base[stat] + perDiff[stat] × difficulty`
 *   Per-stat additive; only stats present in `perDiff` are modified.
 *
 * **expDiff** (Ancient Mimic §7.2):
 *   `stat = base[stat] × factor^difficulty`
 *   The `factor` field on the spec (e.g. 1.4).
 *
 * **expSqrtDiff** (Scrapyard Railgun §7.2):
 *   `stat = base[stat] × (√2)^difficulty = base[stat] × 2^(difficulty / 2)`
 *   Equivalent to multiplying by Math.SQRT2 per difficulty level.
 *
 * **towerFloor** (Infinity Tower §7.4):
 *   Piecewise cumulative additive with per-50-floor doubling of the increment.
 *
 *   Accumulation formula — compute `totalIncrement(stat, floor)`:
 *   Let `band = Math.floor(floor / D)` where `D = doublingEveryFloors (50)`.
 *   For bands 0..band-1 (each full band of D floors):
 *     increment for that band = baseIncrement × 2^b
 *     contribution = D × baseIncrement × 2^b
 *   For the partial final band (floors 0..rem-1, rem = floor mod D):
 *     contribution = rem × baseIncrement × 2^band
 *   Sum all contributions to get totalIncrement.
 *   Then: `stat = base × (1 + totalIncrement)`
 *
 *   HP / Def / Spd share the `floorIncrement.hp` (0.40); Atk uses `floorIncrement.atk` (0.50).
 *   The increment doubles every `doublingEveryFloors` (50) floors:
 *     floors 0–49:   +40%/+50%  per floor
 *     floors 50–99:  +80%/+100% per floor
 *     floors 100–149: +160%/+200% per floor …
 *
 * **bossMult** (research §7.1):
 *   `effectiveMult = baseMult × (1 + perDiffAdditive × difficulty)`
 *   `stat = petStatsReference[stat] × effectiveMult`
 *   If `petStatsReference` is absent, falls back to:
 *   `stat = archetype.baseStats[stat] × effectiveMult`
 *   `baseMult` is taken from `ScalingSpec.base` when present; otherwise from
 *   `constants.bosses.depthMultipliers[depth]` (requires `opts.depth`).
 */
export function scaleEnemyStats(
  archetype: EnemyArchetype,
  opts: ScaleEnemyOpts,
  constants: GameConstants,
): CombatStats {
  const base = archetype.baseStats;
  const { difficulty } = opts;
  const spec = archetype.scaling;

  switch (spec.kind) {
    case 'linear': {
      const pd = spec.perDiff;
      return {
        hp:  base.hp  + (pd.hp  ?? 0) * difficulty,
        atk: base.atk + (pd.atk ?? 0) * difficulty,
        def: base.def + (pd.def ?? 0) * difficulty,
        spd: base.spd + (pd.spd ?? 0) * difficulty,
      };
    }

    case 'expDiff': {
      const f = Math.pow(spec.factor, difficulty);
      return {
        hp:  base.hp  * f,
        atk: base.atk * f,
        def: base.def * f,
        spd: base.spd * f,
      };
    }

    case 'expSqrtDiff': {
      // (√2)^d = 2^(d/2)
      const f = Math.pow(2, difficulty / 2);
      return {
        hp:  base.hp  * f,
        atk: base.atk * f,
        def: base.def * f,
        spd: base.spd * f,
      };
    }

    case 'towerFloor': {
      const floor = opts.floor ?? 0;
      const D = resolve(constants.tower.doublingEveryFloors); // 50
      const inc = resolve(constants.tower.floorIncrement);    // { hp: 0.40, atk: 0.50 }

      /**
       * Compute the total cumulative increment for one stat kind over `floor` floors.
       *
       * We walk full bands of `D` floors, each band doubling the per-floor increment,
       * then add the partial trailing band.
       *
       *   totalInc = Σ_{b=0}^{band-1} D × baseInc × 2^b
       *            + rem × baseInc × 2^band
       *
       * where band = ⌊floor / D⌋ and rem = floor mod D.
       */
      const cumulativeIncrement = (baseInc: number): number => {
        if (floor === 0) return 0;
        const band = Math.floor(floor / D);
        const rem  = floor % D;
        let total = 0;
        // full bands
        for (let b = 0; b < band; b++) {
          total += D * baseInc * Math.pow(2, b);
        }
        // partial trailing band
        total += rem * baseInc * Math.pow(2, band);
        return total;
      };

      const hpInc  = cumulativeIncrement(inc.hp);   // 0.40 base
      const atkInc = cumulativeIncrement(inc.atk);   // 0.50 base

      return {
        hp:  base.hp  * (1 + hpInc),
        atk: base.atk * (1 + atkInc),
        def: base.def * (1 + hpInc),  // Def shares the HP increment (research §7.4)
        spd: base.spd * (1 + hpInc),  // Spd shares the HP increment (research §7.4)
      };
    }

    case 'bossMult': {
      // Determine the base multiplier: prefer ScalingSpec.base; fall back to
      // constants.bosses.depthMultipliers[depth] if depth was provided.
      let baseMult: number = spec.base;
      if (baseMult === undefined || baseMult === null) {
        const depth = opts.depth;
        if (depth !== undefined && depth !== 4) {
          baseMult = resolve(constants.bosses.depthMultipliers)[depth as 1 | 2 | 3];
        } else {
          // Unknown depth or D4 not in table — fall through with base stats × 1
          baseMult = 1;
        }
      }

      const perDiffAdd = resolve(constants.bosses.perDiffAdditive); // 0.10
      const effectiveMult = baseMult * (1 + perDiffAdd * difficulty);

      const ref: CombatStats = opts.petStatsReference ?? base;
      return {
        hp:  ref.hp  * effectiveMult,
        atk: ref.atk * effectiveMult,
        def: ref.def * effectiveMult,
        spd: ref.spd * effectiveMult,
      };
    }
  }
}

// ── Convenience: full CombatContext ──────────────────────────────────────────

/**
 * Options for `scaleEnemyToContext` — everything `scaleEnemyStats` needs,
 * plus an optional effective level used for enemy element levels.
 *
 * **Element levels assumption:**
 * Enemies don't have a `dungeonLevel` equivalent documented in the research.
 * We approximate by treating `effectiveLevel` (default 1) analogously to DL:
 *   - Neutral enemies: each element level = `0.75 × effectiveLevel` (research §5.3).
 *   - Non-neutral: primary = `50 + 3 × effectiveLevel`; weakness = `-50`; others = 0.
 * This is the same formula used for pets. The caller may pass a more accurate
 * level if they have one (e.g. derived from the dungeon difficulty or floor).
 */
export interface ScaleEnemyToContextOpts extends ScaleEnemyOpts {
  /**
   * Effective level used to compute enemy element levels (see assumption above).
   * Defaults to 1 when not provided.
   */
  effectiveLevel?: number;
}

/**
 * Resolve an `EnemyArchetype` into a fully-populated `CombatContext` for the
 * combat resolver (WP-F). Calls `scaleEnemyStats` internally, then fills in
 * element levels, row, class, and ability flags.
 *
 * Enemies always occupy `row: 'front'` (they don't use the back-row system),
 * have `assignedClass: null`, and carry no ability flags (specials are exposed
 * separately via the `EnemyArchetype.specials` field).
 */
export function scaleEnemyToContext(
  archetype: EnemyArchetype,
  opts: ScaleEnemyToContextOpts,
  constants: GameConstants,
): CombatContext {
  const stats = scaleEnemyStats(archetype, opts, constants);
  const effectiveLevel = opts.effectiveLevel ?? 1;

  // Compute element levels.
  //
  // If the archetype carries real element levels (populated by the data-driven
  // builder from the enemy spreadsheet), use them directly — they are the source
  // of truth for enemies whose levels are known.
  //
  // Otherwise fall back to the formula-estimated values (research §5.3 pet analogy):
  //   Neutral: each element = 0.75 × effectiveLevel
  //   Non-neutral: primary = 50 + 3 × effectiveLevel; weakness = -50; others = 0
  let elementLevels: ElementLevels;
  if (archetype.elementLevels !== undefined) {
    // Use the real element levels from the data.
    elementLevels = archetype.elementLevels;
  } else if (archetype.element === 'Neutral') {
    const lvl = 0.75 * effectiveLevel;
    elementLevels = { Fire: lvl, Water: lvl, Wind: lvl, Earth: lvl };
  } else {
    // Non-neutral: primary high, weakness negative, others zero
    const primary = 50 + 3 * effectiveLevel;
    const weaknessMap: Record<string, keyof ElementLevels> = {
      Fire:  'Water',
      Water: 'Wind',
      Wind:  'Earth',
      Earth: 'Fire',
    };
    const weakEl = weaknessMap[archetype.element] as keyof ElementLevels | undefined;
    // Build a mutable record first to avoid the index-signature cast issue
    const levels: Record<keyof ElementLevels, number> = { Fire: 0, Water: 0, Wind: 0, Earth: 0 };
    const primaryEl = archetype.element as keyof ElementLevels;
    levels[primaryEl] = primary;
    if (weakEl !== undefined) {
      levels[weakEl] = -50;
    }
    elementLevels = levels;
  }

  return {
    enemyId: archetype.id,
    stats,
    elementLevels,
    element: archetype.element,
    assignedClass: null,
    row: 'front',
    abilities: [],
    currentHp: stats.hp,
  };
}
