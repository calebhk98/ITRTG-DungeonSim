/**
 * Real ITRTG Pet-Export importer.
 *
 * Parses the semicolon-delimited text produced by the game's built-in export
 * button (the "Pet Export" section). The first line is a fixed header:
 *
 *   Name;Element;Growth;Dungeon Level;Class;Class Level;HP;Attack;Defense;Speed;
 *   Water;Fire;Wind;Earth;Dark;Light;Weapon;Armor;Accessory;Action;Unlocked;
 *   Improvement;Other;Partner
 *
 * Each subsequent non-blank line is one pet row.
 *
 * ## Key design decisions
 *
 * ### Observed stats
 * The export columns HP/Attack/Defense/Speed and Water/Fire/Wind/Earth contain
 * the game's already-computed values — DL, growth, gear, Dojo, and Strategy
 * Room are all baked in. We store these in `pet.observed` so the simulator can
 * use them directly without re-deriving, giving accurate simulation of the
 * current roster. The formula path is still available via `forceDerive: true`.
 *
 * ### growthRequiredForEvolution
 * Not present in the export. We default to 50,000 (base tier per research §5.5)
 * and emit a one-time warning. This field only affects the class-bonus formula
 * in the derive path; since observed stats capture the actual totals it has no
 * practical effect when observed stats are used.
 *
 * ### Training stats (trainingPhysical/Mystic/Battle)
 * Not present in the export. Defaulted to 0 with a one-time warning. These
 * affect God-stat contributions and minor per-pet HP/def/atk bonuses; they are
 * not embedded in the observed HP/atk/def/spd columns.
 *
 * ### Gear parsing
 * Weapon/Armor/Accessory columns use freeform strings such as:
 *   "Godly Hammer + 20, SSS, Earth gem lv 15"
 *   "Mythril Armor + 20, SSS (20), Water gem lv 12"
 *   "none"
 * We extract: item name (before " +"), upgrade level (+N), quality tier
 * token (SSS/SS/S/A/B/C), and optional gem element+level.
 *
 * statMultiplierBonus is set to 0 with a note: the real per-piece contribution
 * is not exported; `observed.stats` already captures the combined total.
 *
 * Tier heuristic (documented, best-effort):
 *   - "SSS" quality with a known Tier-4 name keyword → tier 4
 *   - "SSS" or "SS" quality otherwise               → tier 3
 *   - "S" quality                                   → tier 2
 *   - Anything else / unrecognised                  → tier 1
 * This is approximate; exact tier is not exported by the game.
 */

import type { PetImporter, ImportResult } from '../PetImporter.js';
import { ImporterError } from '../PetImporter.js';
import { defaultRegistry } from '../registry.js';
import type { Pet } from '../../domain/pet.js';
import type { Element } from '../../domain/element.js';
import type { PetClassName } from '../../domain/class.js';
import type { GearPiece, GearSlot, GearQuality, ElementLevels } from '../../domain/gear.js';
import { GEAR_QUALITY_BASE, GEAR_UPGRADE_STEP, computeGearMultiplier } from '../../domain/gear.js';
import { asPetId } from '../../domain/ids.js';

// ── Constants ──────────────────────────────────────────────────────────────────

const IMPORTER_ID = 'itrtg-pet-export' as const;
const IMPORTER_VERSION = 1 as const;

/**
 * Exact first-line header expected from the game export.
 * Used in detect() to confirm format with high confidence.
 */
const EXPECTED_HEADER_PREFIX = 'Name;Element;Growth;Dungeon Level;';

/**
 * Default growthRequiredForEvolution when not present in the export.
 * 50,000 = base tier per research §5.5.
 */
const DEFAULT_GROWTH_REQUIRED = 50_000;

// ── Element validation ─────────────────────────────────────────────────────────

const VALID_ELEMENTS = new Set<string>([
  'Fire', 'Water', 'Wind', 'Earth', 'Neutral',
]);

function parseElement(raw: string, petName: string, warnings: string[]): Element {
  const trimmed = raw.trim();
  if (VALID_ELEMENTS.has(trimmed)) return trimmed as Element;
  warnings.push(
    `Pet "${petName}": unknown element "${trimmed}"; defaulting to "Neutral".`,
  );
  return 'Neutral';
}

// ── Class validation ───────────────────────────────────────────────────────────

const VALID_CLASSES = new Set<string>([
  'Adventurer', 'Mage', 'Assassin', 'Rogue',
  'Defender', 'Supporter', 'Blacksmith', 'Alchemist',
]);

function parseClass(
  raw: string,
  petName: string,
  warnings: string[],
): PetClassName | null {
  const trimmed = raw.trim();
  if (trimmed === 'None') return null;
  if (VALID_CLASSES.has(trimmed)) return trimmed as PetClassName;
  warnings.push(
    `Pet "${petName}": unknown class "${trimmed}"; treating as not evolved (null).`,
  );
  return null;
}

// ── Number parsing ─────────────────────────────────────────────────────────────

/** Parse an integer that may contain commas and/or be negative (e.g. "289,900" or "-10,800"). */
function parseCommaInt(raw: string): number {
  return parseInt(raw.replace(/,/g, ''), 10);
}

// ── Gear parsing ───────────────────────────────────────────────────────────────

/** Quality tokens valid in the export — used to validate before casting. */

/**
 * Tier-4 gear name keywords (best-effort subset from known end-game items).
 * If the item name contains one of these substrings AND quality is SSS, we
 * assign tier 4. This is a documented heuristic; exact tier is not in the export.
 */
const TIER4_NAME_KEYWORDS: ReadonlyArray<string> = [
  'Godly', 'Mythril', 'Exploding', 'Gram', 'Ocean', 'Sky', 'Sun',
  'Inferno', 'Titanium', 'Forest', 'Jungle', 'Hurricane', 'Bursting',
  'Mana', 'Wonder', 'Soul', 'Creators', 'Magic Egg', 'Haposti',
  'Shroud', 'Cerebeak', 'Rune Patch', 'Candy Cane', 'Merry', 'Christmas',
  'Growing Love', 'Spectrometers', 'Master Gloves',
];

function gearTierHeuristic(name: string, quality: string): 1 | 2 | 3 | 4 {
  if (quality === 'SSS') {
    const nameLower = name.toLowerCase();
    for (const kw of TIER4_NAME_KEYWORDS) {
      if (nameLower.includes(kw.toLowerCase())) return 4;
    }
    return 3;
  }
  if (quality === 'SS') return 3;
  if (quality === 'S') return 2;
  return 1;
}

/**
 * Maps gem element strings from the export to ElementLevels keys.
 * The export uses "Water gem lv 15", "Fire gem lv 10", etc.
 */
const GEM_ELEMENT_MAP: Readonly<Record<string, keyof ElementLevels>> = {
  Water: 'Water',
  Fire: 'Fire',
  Wind: 'Wind',
  Earth: 'Earth',
};

/**
 * Parse a single gear slot string.
 * Examples:
 *   "Godly Hammer + 20, SSS, Earth gem lv 15"
 *   "Mythril Armor + 20, SSS (20), Water gem lv 12"
 *   "Legendary Stick + 10, S (20)"
 *   "Ear Muffs + 20, SSS"
 *   "none"
 *   ""
 *
 * Returns null for "none"/empty strings (slot absent).
 */
function parseGearString(
  raw: string,
  slot: GearSlot,
  petName: string,
  warnings: string[],
): GearPiece | null {
  const trimmed = raw.trim();
  if (trimmed === '' || trimmed.toLowerCase() === 'none') return null;

  // Extract item name (everything before " + N")
  const plusMatch = /^(.+?)\s*\+\s*(\d+)/.exec(trimmed);
  if (plusMatch === null) {
    warnings.push(
      `Pet "${petName}", slot "${slot}": could not parse gear string "${trimmed}"; skipping.`,
    );
    return null;
  }
  const itemName = plusMatch[1]!.trim();
  const upgradeLevel = parseInt(plusMatch[2]!, 10);

  // Extract quality token (SSS / SS / S / A / B / C / …) — first all-caps word after the comma
  const qualityMatch = /,\s*(SSS|SS|S|A|B|C|D)(\s*\(\d+\))?/.exec(trimmed);
  const qualityStr = qualityMatch !== null ? qualityMatch[1]! : '';
  const quality = (qualityStr in GEAR_QUALITY_BASE) ? (qualityStr as GearQuality) : undefined;

  // Extract gem: "Water gem lv 12", "Earth gem lv 15", etc.
  const gemMatch = /(\w+)\s+gem\s+lv\s+(\d+)/i.exec(trimmed);
  let elementEnchant: Partial<ElementLevels> | undefined;
  if (gemMatch !== null) {
    const gemEl = gemMatch[1]!;
    const gemLv = parseInt(gemMatch[2]!, 10);
    const mappedEl = GEM_ELEMENT_MAP[gemEl];
    if (mappedEl !== undefined && !isNaN(gemLv)) {
      elementEnchant = { [mappedEl]: gemLv };
    } else if (gemEl.toLowerCase() !== 'neutral') {
      warnings.push(
        `Pet "${petName}", slot "${slot}": unrecognised gem element "${gemEl}" in "${trimmed}"; gem skipped.`,
      );
    }
    // "Neutral gem" is valid in the export but contributes no element level bonus — skip silently.
  }

  const tier = gearTierHeuristic(itemName, qualityStr);

  // Compute statMultiplierBonus from quality+upgrade (community-estimated formula).
  // Observed stats already include all gear; this value is used only in the forceDerive
  // (gear what-if) path. Relative comparisons between gear options are reliable even
  // if absolute accuracy is ±20%.
  const statMultiplierBonus = quality !== undefined
    ? computeGearMultiplier(quality, isNaN(upgradeLevel) ? 0 : upgradeLevel)
    : 0;

  const piece: GearPiece = {
    id: `${petName}-${slot}`,
    name: itemName,
    slot,
    statMultiplierBonus,
    tier,
    ...(elementEnchant !== undefined ? { elementEnchant } : {}),
    ...(!isNaN(upgradeLevel) ? { upgradeLevel } : {}),
    ...(quality !== undefined ? { quality } : {}),
  };

  return piece;
}

// ── Header constant ────────────────────────────────────────────────────────────

const EXPECTED_HEADER =
  'Name;Element;Growth;Dungeon Level;Class;Class Level;HP;Attack;Defense;Speed;' +
  'Water;Fire;Wind;Earth;Dark;Light;Weapon;Armor;Accessory;Action;Unlocked;' +
  'Improvement;Other;Partner';

// ── Pet row parser ─────────────────────────────────────────────────────────────

/**
 * Column indices (0-based) matching the fixed header.
 */
const COL = {
  Name:         0,
  Element:      1,
  Growth:       2,
  DungeonLevel: 3,
  Class:        4,
  ClassLevel:   5,
  HP:           6,
  Attack:       7,
  Defense:      8,
  Speed:        9,
  Water:        10,
  Fire:         11,
  Wind:         12,
  Earth:        13,
  // Dark: 14, Light: 15 — not used by the sim
  Weapon:       16,
  Armor:        17,
  Accessory:    18,
  // Action: 19, Unlocked: 20, Improvement: 21, Other: 22, Partner: 23
  Unlocked:     20,
} as const;

/**
 * Parse one data row into a `Pet`. Returns null on unrecoverable error (caller
 * should push a warning and skip this row rather than aborting the whole import).
 */
function parseRow(
  line: string,
  rowNumber: number,
  warnings: string[],
  trainingWarnedOnce: { value: boolean },
  growthWarnedOnce: { value: boolean },
): Pet | null {
  const cols = line.split(';');

  const petName = cols[COL.Name]?.trim() ?? '';
  if (petName === '') {
    warnings.push(`Row ${rowNumber}: empty Name field; skipping row.`);
    return null;
  }

  // Validate minimum column count
  if (cols.length < 21) {
    warnings.push(
      `Pet "${petName}" (row ${rowNumber}): only ${cols.length} columns (expected ≥21); skipping.`,
    );
    return null;
  }

  // Growth — may be negative (Dorgegebelle: -10,800) or zero (Baphomate: 0)
  const growthRaw = cols[COL.Growth] ?? '';
  const totalGrowth = parseCommaInt(growthRaw);
  if (isNaN(totalGrowth)) {
    warnings.push(`Pet "${petName}": could not parse Growth "${growthRaw}"; skipping row.`);
    return null;
  }

  const dungeonLevel = parseInt(cols[COL.DungeonLevel] ?? '', 10);
  if (isNaN(dungeonLevel)) {
    warnings.push(`Pet "${petName}": could not parse Dungeon Level; skipping row.`);
    return null;
  }

  const classLevel = parseInt(cols[COL.ClassLevel] ?? '', 10);
  if (isNaN(classLevel)) {
    warnings.push(`Pet "${petName}": could not parse Class Level; skipping row.`);
    return null;
  }

  const primaryElement = parseElement(cols[COL.Element] ?? '', petName, warnings);
  const evolvedClass = parseClass(cols[COL.Class] ?? '', petName, warnings);

  // Observed stats — parse HP/Attack/Defense/Speed
  const hp  = parseCommaInt(cols[COL.HP]      ?? '');
  const atk = parseCommaInt(cols[COL.Attack]  ?? '');
  const def = parseCommaInt(cols[COL.Defense] ?? '');
  const spd = parseCommaInt(cols[COL.Speed]   ?? '');

  if (isNaN(hp) || isNaN(atk) || isNaN(def) || isNaN(spd)) {
    warnings.push(
      `Pet "${petName}": could not parse one or more stat columns (HP/Atk/Def/Spd); skipping row.`,
    );
    return null;
  }

  // Observed element levels — Water/Fire/Wind/Earth (Dark/Light ignored)
  const waterLvl = parseCommaInt(cols[COL.Water] ?? '');
  const fireLvl  = parseCommaInt(cols[COL.Fire]  ?? '');
  const windLvl  = parseCommaInt(cols[COL.Wind]  ?? '');
  const earthLvl = parseCommaInt(cols[COL.Earth] ?? '');

  if (isNaN(waterLvl) || isNaN(fireLvl) || isNaN(windLvl) || isNaN(earthLvl)) {
    warnings.push(
      `Pet "${petName}": could not parse one or more element level columns; skipping row.`,
    );
    return null;
  }

  // Unlocked flag
  const unlocked = (cols[COL.Unlocked] ?? '').trim() === 'Yes';
  if (!unlocked) {
    warnings.push(`Pet "${petName}": Unlocked !== 'Yes'; pet is included but may not be in the active roster.`);
  }

  // Equipment
  const weaponStr    = cols[COL.Weapon]    ?? '';
  const armorStr     = cols[COL.Armor]     ?? '';
  const accessoryStr = cols[COL.Accessory] ?? '';

  const weaponPiece    = parseGearString(weaponStr,    'weapon',    petName, warnings);
  const armorPiece     = parseGearString(armorStr,     'armor',     petName, warnings);
  const accessoryPiece = parseGearString(accessoryStr, 'accessory', petName, warnings);

  const equipment: Pet['equipment'] = {
    ...(weaponPiece    !== null ? { weapon:    weaponPiece    } : {}),
    ...(armorPiece     !== null ? { armor:     armorPiece     } : {}),
    ...(accessoryPiece !== null ? { accessory: accessoryPiece } : {}),
  };

  // One-time warnings for fields not in the export
  if (!trainingWarnedOnce.value) {
    trainingWarnedOnce.value = true;
    warnings.push(
      'Training stats (trainingPhysical/Mystic/Battle) are not included in the pet export; ' +
      'defaulting all to 0. These affect God-stat contributions and minor per-pet bonuses.',
    );
  }
  if (!growthWarnedOnce.value) {
    growthWarnedOnce.value = true;
    warnings.push(
      `growthRequiredForEvolution is not included in the pet export; defaulting to ${DEFAULT_GROWTH_REQUIRED} ` +
      '(base tier per research §5.5). This only affects the class-bonus formula in the derive path; ' +
      'it has no effect when observed stats are used.',
    );
  }

  return {
    id: asPetId(petName),
    displayName: petName,
    primaryElement,
    dungeonLevel,
    classLevel,
    evolvedClass,
    totalGrowth,
    growthRequiredForEvolution: DEFAULT_GROWTH_REQUIRED,
    trainingPhysical: 0,
    trainingMystic: 0,
    trainingBattle: 0,
    equipment,
    abilities: [],
    source: {
      importerId: IMPORTER_ID,
      importerVersion: IMPORTER_VERSION,
    },
    observed: {
      stats: { hp, atk, def, spd },
      elementLevels: {
        Fire:  fireLvl,
        Water: waterLvl,
        Wind:  windLvl,
        Earth: earthLvl,
      },
    },
  };
}

// ── Importer implementation ────────────────────────────────────────────────────

const petExportImporter: PetImporter = {
  id: IMPORTER_ID,
  version: IMPORTER_VERSION,

  /**
   * High confidence when the input is a string whose first non-empty line starts
   * with the exact header prefix. The synthetic JSON importers (v1/v2) return 0
   * for string inputs, so there is no conflict.
   */
  detect(raw: unknown): number {
    if (typeof raw !== 'string') return 0;
    const firstLine = raw.split('\n')[0]?.trimEnd() ?? '';
    return firstLine.startsWith(EXPECTED_HEADER_PREFIX) ? 0.99 : 0;
  },

  import(raw: unknown): ImportResult {
    if (typeof raw !== 'string') {
      throw new ImporterError(
        'Input must be a string (semicolon-delimited pet export text).',
        IMPORTER_ID,
        IMPORTER_VERSION,
      );
    }

    const lines = raw.split('\n').map((l) => l.trimEnd());

    // Validate header
    const headerLine = lines[0]?.trim() ?? '';
    if (!headerLine.startsWith(EXPECTED_HEADER_PREFIX)) {
      throw new ImporterError(
        `Input does not start with the expected header. ` +
        `Got: "${headerLine.slice(0, 60)}".`,
        IMPORTER_ID,
        IMPORTER_VERSION,
      );
    }

    // Warn if header has unexpected columns (extra tolerance)
    if (headerLine !== EXPECTED_HEADER && headerLine.startsWith(EXPECTED_HEADER_PREFIX)) {
      // Acceptable: could be a future version with extra columns at the end.
    }

    const warnings: string[] = [];
    const pets: Pet[] = [];

    const trainingWarnedOnce = { value: false };
    const growthWarnedOnce = { value: false };

    for (let i = 1; i < lines.length; i++) {
      const line = lines[i] ?? '';
      if (line.trim() === '') continue; // skip blank lines

      const rowNumber = i + 1; // 1-based for user-facing messages
      const pet = parseRow(line, rowNumber, warnings, trainingWarnedOnce, growthWarnedOnce);
      if (pet !== null) {
        pets.push(pet);
      }
    }

    if (pets.length === 0) {
      throw new ImporterError(
        'No pets could be parsed from the input. Check that the file is a valid ITRTG pet export.',
        IMPORTER_ID,
        IMPORTER_VERSION,
      );
    }

    return { pets, warnings };
  },
};

// Self-register into the shared registry on module load.
defaultRegistry.register(petExportImporter);

export { petExportImporter };
