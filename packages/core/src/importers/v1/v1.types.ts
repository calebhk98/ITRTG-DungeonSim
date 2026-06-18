/**
 * Raw shape for the SYNTHETIC v1 export format ("WP-C").
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │  ASSUMPTION LOG — future agent replacing this: edit ONLY this block      │
 * │  and the mapping in v1Importer.ts.  Do NOT touch anything else.          │
 * │                                                                           │
 * │  A1. Format has no version field; detect() sniffs by the top-level       │
 * │      "exportedPets" array key and the presence of "dungeonLvl".          │
 * │  A2. Element is stored as a short code: "F"/"W"/"Wi"/"E"/"N".            │
 * │  A3. Class name uses camelCase ("adventurer", "mage", etc.) not          │
 * │      PascalCase. Null → not evolved.                                     │
 * │  A4. Equipment is a flat array of up to 4 objects; the slot is inferred  │
 * │      from the "type" field ("weapon"/"armor"/"accessory"/"trinket").     │
 * │  A5. Abilities are stored as an array of raw short strings               │
 * │      ("sup-dmg-red", "suc-heal", "lucky-coin", "clam-gp",               │
 * │       "chameleon", "vesuvius").                                           │
 * │  A6. Training stats use abbreviated keys: "phys", "myst", "btl".        │
 * │  A7. There is no explicit "growthRequiredForEvolution" field; the         │
 * │      importer defaults to 50000 and emits a warning.                     │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * When the real format arrives, replace these type definitions and update the
 * mapping in v1Importer.ts → mapPet().  Nothing else needs to change.
 */

/** A single gear piece as it appears in a v1 export. */
export interface V1GearPiece {
  /** Unique gear id (e.g. "sword-001"). */
  readonly gearId: string;
  /** Display name. */
  readonly label: string;
  /** Slot: "weapon" | "armor" | "accessory" | "trinket". */
  readonly type: string;
  /** Additive stat multiplier bonus (e.g. 0.10 = +10%). */
  readonly bonus: number;
  /** Gear tier 1–4. */
  readonly tier: number;
  /**
   * Optional elemental enchantment levels by short code.
   * e.g. { F: 2, W: 0, Wi: 1, E: 0 }
   */
  readonly enchant?: Readonly<Partial<Record<string, number>>>;
}

/** A single pet as it appears in a v1 export. */
export interface V1Pet {
  /** Unique pet id string. */
  readonly petId: string;
  /** Player-given display name. */
  readonly name: string;
  /** Primary element short code: "F" | "W" | "Wi" | "E" | "N". */
  readonly element: string;
  /** Dungeon Level. */
  readonly dungeonLvl: number;
  /** Class Level (0 if not evolved). */
  readonly classLvl: number;
  /**
   * Class name in lowercase, or null if not evolved.
   * e.g. "adventurer" | "mage" | "assassin" | etc.
   */
  readonly className: string | null;
  /** Total accumulated growth. */
  readonly totalGrowth: number;
  /** Training stat block (abbreviated keys). */
  readonly training: {
    readonly phys: number;
    readonly myst: number;
    readonly btl: number;
  };
  /** Equipped gear pieces (0–4). */
  readonly gear: ReadonlyArray<V1GearPiece>;
  /** Ability short-string array. */
  readonly abilities: ReadonlyArray<string>;
}

/**
 * Top-level shape of a v1 export file.
 * The presence of "exportedPets" + absence of "_formatVersion" is the detect signal.
 */
export interface V1Export {
  /** Array of exported pets. */
  readonly exportedPets: ReadonlyArray<V1Pet>;
}
