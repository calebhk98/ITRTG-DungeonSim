/**
 * WP-D — v2 PetImporter implementation.
 *
 * Parses the SYNTHETIC v2 export format (see v2.types.ts for the full shape and
 * assumption log).  Self-registers into `defaultRegistry` on module load.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │  FUTURE AGENT: to swap in the real v2 parser                            │
 * │  1. Update v2.types.ts to match the real shape.                         │
 * │  2. Update mapElement(), mapClassName(), mapAbility() below if the      │
 * │     field values changed.                                                │
 * │  3. Replace v2.fixture.json with a real export sample.                  │
 * │  4. Update v2.test.ts expected values to match the real sample.         │
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
import type { V2Export, V2Pet, V2GearPiece } from './v2.types.js';

// ── Constants ──────────────────────────────────────────────────────────────────

const IMPORTER_ID = 'official-export' as const;
const IMPORTER_VERSION = 2 as const;

// ── Element mapping ────────────────────────────────────────────────────────────
// ASSUMPTION B2: element stored as full PascalCase, directly matching domain.

const VALID_ELEMENTS = new Set<string>(['Fire', 'Water', 'Wind', 'Earth', 'Neutral']);

function mapElement(raw: string, uid: string, warnings: string[]): Element {
  if (VALID_ELEMENTS.has(raw)) return raw as Element;
  warnings.push(
    `Pet "${uid}": unknown element "${raw}"; defaulting to "Neutral".`,
  );
  return 'Neutral';
}

// ── Class name mapping ─────────────────────────────────────────────────────────
// ASSUMPTION B3: class stored as PascalCase, directly matching domain.

const VALID_CLASSES = new Set<string>([
  'Adventurer', 'Mage', 'Assassin', 'Rogue',
  'Defender', 'Supporter', 'Blacksmith', 'Alchemist',
]);

function mapClassName(
  raw: string | undefined,
  uid: string,
  warnings: string[],
): PetClassName | null {
  if (raw === undefined) return null;
  if (VALID_CLASSES.has(raw)) return raw as PetClassName;
  warnings.push(
    `Pet "${uid}": unknown class "${raw}"; treating as not evolved.`,
  );
  return null;
}

// ── Ability mapping ────────────────────────────────────────────────────────────
// ASSUMPTION B5: abilities stored as domain AbilityFlag strings directly.

const KNOWN_ABILITIES = new Set<string>([
  'supporterDmgReduction',
  'succubusHeal',
  'luckyCoin',
  'clamGpDouble',
  'chameleonElement',
  'vesuviusGrowth',
]);

function mapAbility(raw: string, uid: string, warnings: string[]): AbilityFlag {
  if (KNOWN_ABILITIES.has(raw)) return raw as AbilityFlag;
  warnings.push(
    `Pet "${uid}": unknown ability flag "${raw}"; preserving as raw string.`,
  );
  return raw as AbilityFlag;
}

// ── Gear tier validation ───────────────────────────────────────────────────────

function mapGearTier(
  tier: number,
  gearId: string,
  uid: string,
  warnings: string[],
): 1 | 2 | 3 | 4 {
  if (tier === 1 || tier === 2 || tier === 3 || tier === 4) return tier;
  warnings.push(
    `Pet "${uid}", gear "${gearId}": invalid tier ${tier}; clamping to 1.`,
  );
  return 1;
}

// ── Enchant mapping ────────────────────────────────────────────────────────────
// ASSUMPTION B4 (enchant): keys are full PascalCase element names.

function mapEnchant(
  raw: Readonly<Partial<Record<string, number>>> | undefined,
  gearId: string,
  uid: string,
  warnings: string[],
): Partial<ElementLevels> | undefined {
  if (raw === undefined) return undefined;
  const result: Partial<ElementLevels> = {};
  let hasAny = false;
  const validEnchantElements: ReadonlySet<string> = new Set(['Fire', 'Water', 'Wind', 'Earth']);
  for (const [el, val] of Object.entries(raw)) {
    if (val === undefined || val === 0) continue;
    if (!validEnchantElements.has(el)) {
      warnings.push(
        `Pet "${uid}", gear "${gearId}": unknown enchant element "${el}"; skipped.`,
      );
      continue;
    }
    result[el as Exclude<Element, 'Neutral'>] = val;
    hasAny = true;
  }
  return hasAny ? result : undefined;
}

// ── Gear piece mapper ──────────────────────────────────────────────────────────

function mapGearPiece(
  slot: GearSlot,
  raw: V2GearPiece,
  uid: string,
  warnings: string[],
): GearPiece {
  const tier = mapGearTier(raw.tier, raw.id, uid, warnings);
  const enchant = mapEnchant(raw.enchantLevels, raw.id, uid, warnings);

  const piece: GearPiece = {
    id: raw.id,
    name: raw.name,
    slot,
    statMultiplierBonus: raw.statBonus,
    tier,
    ...(enchant !== undefined ? { elementEnchant: enchant } : {}),
  };
  return piece;
}

// ── Pet mapper ────────────────────────────────────────────────────────────────

function mapPet(raw: V2Pet, warnings: string[]): Pet {
  const primaryElement = mapElement(raw.element, raw.uid, warnings);
  const evolvedClass = mapClassName(raw.evolvedClass, raw.uid, warnings);
  const abilities = raw.abilityFlags.map((a) => mapAbility(a, raw.uid, warnings));

  // ASSUMPTION B7: v2 explicitly carries evolutionDifficulty → no warning needed.
  const growthRequiredForEvolution = raw.evolutionDifficulty;

  // Build equipment loadout from nested loadout object.
  // ASSUMPTION B4: each slot key is optional; slot name matches GearSlot directly.
  const equipmentLoadout: Pet['equipment'] = {
    ...(raw.loadout.weapon !== undefined
      ? { weapon: mapGearPiece('weapon', raw.loadout.weapon, raw.uid, warnings) }
      : {}),
    ...(raw.loadout.armor !== undefined
      ? { armor: mapGearPiece('armor', raw.loadout.armor, raw.uid, warnings) }
      : {}),
    ...(raw.loadout.accessory !== undefined
      ? { accessory: mapGearPiece('accessory', raw.loadout.accessory, raw.uid, warnings) }
      : {}),
    ...(raw.loadout.trinket !== undefined
      ? { trinket: mapGearPiece('trinket', raw.loadout.trinket, raw.uid, warnings) }
      : {}),
  };

  return {
    id: asPetId(raw.uid),
    displayName: raw.displayName,
    primaryElement,
    dungeonLevel: raw.dungeonLevel,
    classLevel: raw.classLevel,
    evolvedClass,
    totalGrowth: raw.totalGrowth,
    growthRequiredForEvolution,
    trainingPhysical: raw.training.physical,
    trainingMystic: raw.training.mystic,
    trainingBattle: raw.training.battle,
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
 * Returns true if `raw` has the top-level shape of a V2Export.
 *
 * PRIMARY DETECT SIGNAL: `_formatVersion === 2` + `roster` array.
 * This is unambiguous — v1 never has `_formatVersion`.
 */
function isV2Export(raw: unknown): raw is V2Export {
  if (typeof raw !== 'object' || raw === null) return false;
  const obj = raw as Record<string, unknown>;
  if (obj['_formatVersion'] !== 2) return false;
  if (!Array.isArray(obj['roster'])) return false;
  return true;
}

// ── Importer implementation ────────────────────────────────────────────────────

const v2Importer: PetImporter = {
  id: IMPORTER_ID,
  version: IMPORTER_VERSION,

  detect(raw: unknown): number {
    // Unambiguous: _formatVersion === 2 is the explicit contract marker.
    return isV2Export(raw) ? 1.0 : 0;
  },

  import(raw: unknown): ImportResult {
    if (!isV2Export(raw)) {
      throw new ImporterError(
        'Input is not a valid v2 export: expected { _formatVersion: 2, roster: [...] }.',
        IMPORTER_ID,
        IMPORTER_VERSION,
      );
    }

    const warnings: string[] = [];
    const pets: Pet[] = [];

    for (const rawPet of raw.roster) {
      pets.push(mapPet(rawPet, warnings));
    }

    return { pets, warnings };
  },
};

// Self-register into the shared registry on module load.
defaultRegistry.register(v2Importer);

export { v2Importer };
