import type { PetId } from './ids.js';
import type { Element } from './element.js';
import type { PetClassName } from './class.js';
import type { EquipmentLoadout } from './gear.js';

// Re-export ElementLevels so consumers can import it from domain/pet or domain/gear
export type { ElementLevels } from './gear.js';

/**
 * Ability flags present on a pet. These are open-ended: the known flags below
 * are listed for type-safety/autocomplete, but the `string` fallthrough keeps
 * the model extensible for future wiki-documented abilities without a type change.
 *
 * Research §5.6 lists: supporter-dmg-reduction, self-heal, lucky-coin, clam-gp,
 * chameleon-element, vesuvius-growth, and others.
 */
export type AbilityFlag =
  | 'supporterDmgReduction'   // Supporter CL50: ~50% team-wide damage reduction
  | 'succubusHeal'            // Succubus CL100: self-heal up to 1/3 max HP per hit
  | 'luckyCoin'               // Lucky Coin: 7/77/777/7777 random damage per attack
  | 'clamGpDouble'            // Clam: doubles GP from events it survives
  | 'chameleonElement'        // Chameleon: freely change element
  | 'vesuviusGrowth'          // Vesuvius: generates extra dungeon growth
  | (string & Record<never, never>); // open union — any future ability flag string

/**
 * A single pet in the roster, as stored in the stable internal schema.
 *
 * Design notes:
 * - NO rarity field: all pets are token-obtained; only `growthRequiredForEvolution`
 *   drives class-bonus magnitude (research §5.5, plan §"Key design contracts").
 * - `evolvedClass` is null until the pet has evolved; a non-null value means
 *   the pet has unlocked that class (though `TeamSlot.assignedClass` may differ).
 * - Training stats (trainingPhysical/Mystic/Battle) translate to HP/Def/Atk bonuses
 *   for the God and also affect the pet directly (research §5.1).
 * - `source` records which importer version produced this record so callers can
 *   trace data provenance and re-import if the schema is updated.
 */
export interface Pet {
  /** Stable branded identifier (unique across the roster). */
  readonly id: PetId;
  /** Display name (player-editable in-game). */
  readonly displayName: string;
  /**
   * The pet's native element (Fire/Water/Wind/Earth/Neutral).
   * Determines base elemental levels per research §5.3.
   */
  readonly primaryElement: Element;

  // ── Progression ────────────────────────────────────────────────────────────

  /** Dungeon Level. Primary progression stat; persists through rebirth. */
  readonly dungeonLevel: number;
  /**
   * Class Level (1–100). Only non-zero after evolution.
   * Many abilities scale with CL (research §5.6).
   */
  readonly classLevel: number;
  /**
   * Which class the pet evolved into, or null if not yet evolved.
   * Determines which `ClassModifiers` apply to base stats.
   */
  readonly evolvedClass: PetClassName | null;

  // ── Growth ─────────────────────────────────────────────────────────────────

  /**
   * Total accumulated growth. Permanent, survives rebirth.
   * Feeds the `(1 + TotalGrowth/200000)` multiplier in the stat formula (research §6.1).
   * Every +2,000 growth ≈ +1% to all dungeon stats.
   */
  readonly totalGrowth: number;
  /**
   * The growth threshold this pet required to evolve (= Evolution Difficulty tier).
   * Used to compute class bonus magnitude: `((growthRequiredForEvolution / 50000) + 1) × 0.5`.
   * Research §5.5. NOT a rarity — just a per-species evolution difficulty.
   */
  readonly growthRequiredForEvolution: number;

  // ── Training stats ─────────────────────────────────────────────────────────

  /**
   * Physical training points. Adds +10 HP/pt to the pet; also boosts God Physical
   * by +1% per 100 pts (research §5.1).
   */
  readonly trainingPhysical: number;
  /**
   * Mystic training points. Adds +0.5 Defense/pt and +0.05 HP regen/s to the pet;
   * also boosts God Mystic by +1% per 100 pts (research §5.1).
   */
  readonly trainingMystic: number;
  /**
   * Battle training points. Adds +1.0 Attack/pt to the pet; also boosts God Battle
   * by +1% per 100 pts (research §5.1).
   */
  readonly trainingBattle: number;

  // ── Equipment & Abilities ──────────────────────────────────────────────────

  /** What gear this pet is currently wearing (may be partially empty). */
  readonly equipment: EquipmentLoadout;
  /**
   * Set of ability flags active on this pet. Open union so future abilities can
   * be round-tripped through the importer without a schema break (research §5.6).
   */
  readonly abilities: ReadonlyArray<AbilityFlag>;

  // ── Provenance ─────────────────────────────────────────────────────────────

  /**
   * Records which importer produced this Pet record, enabling re-import
   * detection and migration if the internal schema changes.
   */
  readonly source: {
    /** `PetImporter.id` of the importer that created this record. */
    readonly importerId: string;
    /** `PetImporter.version` of the importer that created this record. */
    readonly importerVersion: number;
  };

  // ── Observed stats (real-export fast path) ─────────────────────────────────

  /**
   * The game's already-computed combat stats and element levels, read directly
   * from the in-game pet export. When present, `deriveCombatContext` uses these
   * values instead of the formula (unless `forceDerive: true` is passed).
   *
   * **Why optional?** Synthetic/test pets built from formulas omit this field.
   * Only pets imported from the real ITRTG pet export carry it.
   *
   * **What's baked in?** HP/Attack/Defense/Speed already include DL, growth,
   * gear (statMultiplierBonus), Dojo, and Strategy Room contributions. Element
   * levels include gem enchants, Dojo element buffs, and Strategy Room element
   * slots. This is the correct simulation starting point for the current roster.
   *
   * **What-if / optimization path:** set `forceDerive: true` in the
   * `StatDerivationInput` to bypass `observed` and re-derive stats via the
   * formula. Useful for gear-swap optimizations where the formula's per-piece
   * breakdown is needed.
   *
   * @see {@link StatDerivationInput.forceDerive}
   */
  readonly observed?: {
    /**
     * Game-reported combat stats (HP/Attack/Defense/Speed).
     * Intentionally inlined rather than importing `CombatStats` from
     * `domain/combat.ts` to avoid a circular dependency (combat.ts → pet.ts).
     */
    readonly stats: {
      readonly hp: number;
      readonly atk: number;
      readonly def: number;
      readonly spd: number;
    };
    /**
     * Game-reported elemental levels.
     * Note: Dark and Light columns from the export are ignored — the dungeon
     * simulation does not model those dimensions.
     */
    readonly elementLevels: {
      readonly Fire: number;
      readonly Water: number;
      readonly Wind: number;
      readonly Earth: number;
    };
  };
}
