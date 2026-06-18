/**
 * Raw shape for the SYNTHETIC v2 export format ("WP-D").
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │  ASSUMPTION LOG — future agent replacing this: edit ONLY this block      │
 * │  and the mapping in v2Importer.ts.  Do NOT touch anything else.          │
 * │                                                                           │
 * │  B1. Format includes a top-level "_formatVersion": 2 marker.             │
 * │      This is the primary detect() signal; detect() returns 1.0 when it  │
 * │      sees { _formatVersion: 2, roster: [...] }.                          │
 * │  B2. Element is stored as full PascalCase string: "Fire"/"Water"/etc.   │
 * │      Directly matches the domain Element union — no translation needed.  │
 * │  B3. Evolved class uses PascalCase matching PetClassName exactly.        │
 * │      Null encoded as absent key (exactOptionalPropertyTypes).            │
 * │  B4. Equipment is nested under "loadout" with slot as object key.        │
 * │      e.g. { weapon: {...}, armor: {...} }                                │
 * │  B5. Abilities stored as full domain AbilityFlag strings directly.       │
 * │      No translation needed; unknown strings still emit warnings.         │
 * │  B6. Training stats use full names: "physical", "mystic", "battle".     │
 * │  B7. v2 DOES include growthRequiredForEvolution as "evolutionDifficulty".│
 * │  B8. v2 pets are stored under "roster" (not "exportedPets").            │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * When the real format arrives, replace these type definitions and update the
 * mapping in v2Importer.ts → mapPet().  Nothing else needs to change.
 */

/** A single gear piece as it appears in a v2 export. */
export interface V2GearPiece {
  /** Unique gear id. */
  readonly id: string;
  /** Display name. */
  readonly name: string;
  /** Gear tier 1–4. */
  readonly tier: number;
  /**
   * Additive stat multiplier bonus (e.g. 0.10 = +10%).
   * Field name is "statBonus" in v2 (vs. "bonus" in v1).
   */
  readonly statBonus: number;
  /**
   * Optional elemental enchantment levels.
   * Keys are full PascalCase element names: Fire/Water/Wind/Earth.
   * e.g. { Fire: 3, Water: 1 }
   */
  readonly enchantLevels?: Readonly<Partial<Record<string, number>>>;
}

/** The equipment loadout object as it appears in a v2 export. */
export interface V2Loadout {
  readonly weapon?: V2GearPiece;
  readonly armor?: V2GearPiece;
  readonly accessory?: V2GearPiece;
  readonly trinket?: V2GearPiece;
}

/** A single pet as it appears in a v2 export. */
export interface V2Pet {
  /** Unique pet id string. */
  readonly uid: string;
  /** Player-given display name. */
  readonly displayName: string;
  /**
   * Primary element as full PascalCase string.
   * "Fire" | "Water" | "Wind" | "Earth" | "Neutral"
   */
  readonly element: string;
  /** Dungeon Level. */
  readonly dungeonLevel: number;
  /** Class Level (0 if not evolved). */
  readonly classLevel: number;
  /**
   * Evolved class as PascalCase, or absent if not evolved.
   * ASSUMPTION B3: absent key (not null) when not evolved.
   */
  readonly evolvedClass?: string;
  /** Total accumulated growth. */
  readonly totalGrowth: number;
  /**
   * Growth required for evolution (evolution difficulty tier).
   * ASSUMPTION B7: v2 includes this field explicitly.
   */
  readonly evolutionDifficulty: number;
  /** Training stat block (full names). */
  readonly training: {
    readonly physical: number;
    readonly mystic: number;
    readonly battle: number;
  };
  /** Equipment loadout keyed by slot. */
  readonly loadout: V2Loadout;
  /** Ability flags as domain strings. */
  readonly abilityFlags: ReadonlyArray<string>;
}

/**
 * Top-level shape of a v2 export file.
 *
 * DETECT SIGNAL: presence of `_formatVersion === 2` AND "roster" array.
 * This makes detection unambiguous — v1 never has _formatVersion.
 */
export interface V2Export {
  /** Explicit format version marker — the primary detect signal. */
  readonly _formatVersion: 2;
  /** The exported pet roster. */
  readonly roster: ReadonlyArray<V2Pet>;
}
