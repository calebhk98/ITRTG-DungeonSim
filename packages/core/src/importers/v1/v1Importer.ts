/**
 * WP-C — v1 PetImporter implementation.
 *
 * Parses the SYNTHETIC v1 export format (see v1.types.ts for the full shape and
 * assumption log).  Self-registers into `defaultRegistry` on module load.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │  FUTURE AGENT: to swap in the real v1 parser                            │
 * │  1. Update v1.types.ts to match the real shape.                         │
 * │  2. Update mapElement(), mapClassName(), mapAbility() look-up tables    │
 * │     in this file if the field values changed.                            │
 * │  3. Replace v1.fixture.json with a real export sample.                  │
 * │  4. Update v1.test.ts expected values to match the real sample.         │
 * │  Everything else (registry, barrel, Pet schema) stays untouched.        │
 * └──────────────────────────────────────────────────────────────────────────┘
 */

import type { PetImporter, ImportResult } from '../PetImporter.js';
import { ImporterError } from '../PetImporter.js';
import { defaultRegistry } from '../registry.js';
import type { Pet, AbilityFlag } from '../../domain/pet.js';
import type { Element } from '../../domain/element.js';
import type { PetClassName } from '../../domain/class.js';
import type { GearPiece, GearSlot, ElementLevels } from '../../domain/gear.js';
import { asPetId } from '../../domain/ids.js';
import type { V1Export, V1Pet, V1GearPiece } from './v1.types.js';

// ── Constants ──────────────────────────────────────────────────────────────────

const IMPORTER_ID = 'official-export' as const;
const IMPORTER_VERSION = 1 as const;

/**
 * Default growthRequiredForEvolution assumed when the v1 format does not
 * include this field. 50000 is the base tier per research §5.5.
 * A warning is always emitted for each pet where this default is applied.
 */
const DEFAULT_GROWTH_REQUIRED = 50_000;

// ── Element mapping ────────────────────────────────────────────────────────────
// ASSUMPTION A2: element stored as short code.  Update this table if the real
// format uses different codes.

const ELEMENT_MAP: Readonly<Record<string, Element>> = {
  F: 'Fire',
  W: 'Water',
  Wi: 'Wind',
  E: 'Earth',
  N: 'Neutral',
};

function mapElement(code: string, petId: string, warnings: string[]): Element {
  const el = ELEMENT_MAP[code];
  if (el !== undefined) return el;
  warnings.push(
    `Pet "${petId}": unknown element code "${code}"; defaulting to "Neutral".`,
  );
  return 'Neutral';
}

// ── Class name mapping ─────────────────────────────────────────────────────────
// ASSUMPTION A3: class stored as lowercase.  Update if the real format differs.

const CLASS_MAP: Readonly<Record<string, PetClassName>> = {
  adventurer: 'Adventurer',
  mage: 'Mage',
  assassin: 'Assassin',
  rogue: 'Rogue',
  defender: 'Defender',
  supporter: 'Supporter',
  blacksmith: 'Blacksmith',
  alchemist: 'Alchemist',
};

function mapClassName(
  raw: string | null,
  petId: string,
  warnings: string[],
): PetClassName | null {
  if (raw === null) return null;
  const cls = CLASS_MAP[raw.toLowerCase()];
  if (cls !== undefined) return cls;
  warnings.push(
    `Pet "${petId}": unknown class name "${raw}"; treating as not evolved.`,
  );
  return null;
}

// ── Ability mapping ────────────────────────────────────────────────────────────
// ASSUMPTION A5: abilities as short strings.  Update if the real format differs.

const ABILITY_MAP: Readonly<Record<string, AbilityFlag>> = {
  'sup-dmg-red': 'supporterDmgReduction',
  'suc-heal': 'succubusHeal',
  'lucky-coin': 'luckyCoin',
  'clam-gp': 'clamGpDouble',
  chameleon: 'chameleonElement',
  vesuvius: 'vesuviusGrowth',
};

function mapAbility(raw: string, petId: string, warnings: string[]): AbilityFlag {
  const ability = ABILITY_MAP[raw];
  if (ability !== undefined) return ability;
  // Unknown abilities are preserved as raw strings (open union) with a warning.
  warnings.push(
    `Pet "${petId}": unknown ability short-code "${raw}"; preserving as raw string.`,
  );
  return raw as AbilityFlag;
}

// ── Gear slot validation ───────────────────────────────────────────────────────

const VALID_SLOTS = new Set<string>(['weapon', 'armor', 'accessory', 'trinket']);

function mapGearSlot(type: string, gearId: string, petId: string, warnings: string[]): GearSlot | null {
  if (VALID_SLOTS.has(type)) return type as GearSlot;
  warnings.push(
    `Pet "${petId}", gear "${gearId}": unknown slot type "${type}"; gear piece skipped.`,
  );
  return null;
}

// ── Enchant mapping ────────────────────────────────────────────────────────────
// ASSUMPTION A2 (enchant): enchant keys use same short codes as element field.

function mapEnchant(
  raw: Readonly<Partial<Record<string, number>>> | undefined,
  gearId: string,
  petId: string,
  warnings: string[],
): Partial<ElementLevels> | undefined {
  if (raw === undefined) return undefined;
  const result: Partial<ElementLevels> = {};
  let hasAny = false;
  for (const [code, val] of Object.entries(raw)) {
    if (val === undefined || val === 0) continue;
    const el = ELEMENT_MAP[code];
    if (el === undefined || el === 'Neutral') {
      warnings.push(
        `Pet "${petId}", gear "${gearId}": unknown enchant element code "${code}"; skipped.`,
      );
      continue;
    }
    // ElementLevels has Fire/Water/Wind/Earth (not Neutral).
    result[el as Exclude<Element, 'Neutral'>] = val;
    hasAny = true;
  }
  return hasAny ? result : undefined;
}

// ── Gear tier validation ───────────────────────────────────────────────────────

function mapGearTier(
  tier: number,
  gearId: string,
  petId: string,
  warnings: string[],
): 1 | 2 | 3 | 4 {
  if (tier === 1 || tier === 2 || tier === 3 || tier === 4) return tier;
  warnings.push(
    `Pet "${petId}", gear "${gearId}": invalid tier ${tier}; clamping to 1.`,
  );
  return 1;
}

// ── Gear piece mapper ──────────────────────────────────────────────────────────

function mapGearPiece(
  raw: V1GearPiece,
  petId: string,
  warnings: string[],
): GearPiece | null {
  const slot = mapGearSlot(raw.type, raw.gearId, petId, warnings);
  if (slot === null) return null;

  const tier = mapGearTier(raw.tier, raw.gearId, petId, warnings);
  const enchant = mapEnchant(raw.enchant, raw.gearId, petId, warnings);

  const piece: GearPiece = {
    id: raw.gearId,
    name: raw.label,
    slot,
    statMultiplierBonus: raw.bonus,
    tier,
    ...(enchant !== undefined ? { elementEnchant: enchant } : {}),
  };
  return piece;
}

// ── Pet mapper ────────────────────────────────────────────────────────────────

function mapPet(raw: V1Pet, warnings: string[]): Pet {
  const primaryElement = mapElement(raw.element, raw.petId, warnings);
  const evolvedClass = mapClassName(raw.className, raw.petId, warnings);
  const abilities = raw.abilities.map((a) => mapAbility(a, raw.petId, warnings));

  // ASSUMPTION A7: v1 format omits growthRequiredForEvolution; default to 50000.
  warnings.push(
    `Pet "${raw.petId}": growthRequiredForEvolution not present in v1 format; ` +
    `defaulting to ${DEFAULT_GROWTH_REQUIRED} (base tier per research §5.5). ` +
    `Update when real export includes this field.`,
  );

  // Build equipment loadout from gear array.
  const equipment: Record<GearSlot, GearPiece | undefined> = {
    weapon: undefined,
    armor: undefined,
    accessory: undefined,
    trinket: undefined,
  };
  for (const g of raw.gear) {
    const piece = mapGearPiece(g, raw.petId, warnings);
    if (piece === null) continue;
    if (equipment[piece.slot] !== undefined) {
      warnings.push(
        `Pet "${raw.petId}": duplicate gear in slot "${piece.slot}"; keeping first occurrence.`,
      );
      continue;
    }
    equipment[piece.slot] = piece;
  }

  // Build the clean EquipmentLoadout (only include defined slots to satisfy
  // exactOptionalPropertyTypes — we spread only those keys that are set).
  const equipmentLoadout: Pet['equipment'] = {
    ...(equipment.weapon !== undefined ? { weapon: equipment.weapon } : {}),
    ...(equipment.armor !== undefined ? { armor: equipment.armor } : {}),
    ...(equipment.accessory !== undefined ? { accessory: equipment.accessory } : {}),
    ...(equipment.trinket !== undefined ? { trinket: equipment.trinket } : {}),
  };

  return {
    id: asPetId(raw.petId),
    displayName: raw.name,
    primaryElement,
    dungeonLevel: raw.dungeonLvl,
    classLevel: raw.classLvl,
    evolvedClass,
    totalGrowth: raw.totalGrowth,
    growthRequiredForEvolution: DEFAULT_GROWTH_REQUIRED,
    trainingPhysical: raw.training.phys,
    trainingMystic: raw.training.myst,
    trainingBattle: raw.training.btl,
    equipment: equipmentLoadout,
    abilities,
    source: {
      importerId: IMPORTER_ID,
      importerVersion: IMPORTER_VERSION,
    },
  };
}

// ── Type guards ───────────────────────────────────────────────────────────────

/**
 * Returns true if `raw` has the top-level shape of a V1Export.
 * DETECT SIGNAL: presence of "exportedPets" array AND absence of "_formatVersion".
 * (v2 always includes "_formatVersion"; v1 never does.)
 */
function isV1Export(raw: unknown): raw is V1Export {
  if (typeof raw !== 'object' || raw === null) return false;
  if (!('exportedPets' in raw)) return false;
  if (!Array.isArray((raw as Record<string, unknown>)['exportedPets'])) return false;
  // If _formatVersion is present this is a v2 export.
  if ('_formatVersion' in raw) return false;
  return true;
}

/**
 * Returns a partial confidence boost if the first pet in the array has the
 * v1-specific "dungeonLvl" field (not "dungeonLevel" used by v2).
 */
function hasDungeonLvlField(raw: V1Export): boolean {
  const first = raw.exportedPets[0];
  if (first === undefined) return false;
  return 'dungeonLvl' in (first as object);
}

// ── Importer implementation ────────────────────────────────────────────────────

const v1Importer: PetImporter = {
  id: IMPORTER_ID,
  version: IMPORTER_VERSION,

  detect(raw: unknown): number {
    // Fast-fail: must be a V1Export (has "exportedPets", no "_formatVersion").
    if (!isV1Export(raw)) return 0;
    // Boost confidence if we see the v1-specific "dungeonLvl" key.
    return hasDungeonLvlField(raw) ? 0.95 : 0.5;
  },

  import(raw: unknown): ImportResult {
    if (!isV1Export(raw)) {
      throw new ImporterError(
        'Input is not a valid v1 export: expected { exportedPets: [...] } with no _formatVersion.',
        IMPORTER_ID,
        IMPORTER_VERSION,
      );
    }

    const warnings: string[] = [];
    const pets: Pet[] = [];

    for (const rawPet of raw.exportedPets) {
      pets.push(mapPet(rawPet, warnings));
    }

    return { pets, warnings };
  },
};

// Self-register into the shared registry on module load.
defaultRegistry.register(v1Importer);

export { v1Importer };
