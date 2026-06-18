/**
 * ITRTG Pet-Equipment-IDs export parser.
 *
 * Parses the block produced by the game's built-in export:
 *
 *   ---PetEquipStart---
 *   Owl=1945,2241,2611;Meteor=3867,1595,1355;...---PetEquipEnd---
 *
 * Each entry has the form `PetName=weaponId,armorId,accessoryId;`.
 * A value of 0 means the slot is empty.
 *
 * ## Design notes
 *
 * This is NOT a PetImporter — it produces a `ParsedPetEquip` mapping pet
 * display names to their numeric item IDs. Translating those IDs to item names
 * or gear stats requires a separate item catalogue not yet included here.
 *
 * The three IDs correspond to weapon / armor / accessory slots in that order.
 * The game does not export a trinket/4th slot in this block.
 *
 * ## Adding new export parsers
 *
 * See the comment at the top of `dungeonTeams.ts` for the general pattern.
 */

// ── Types ──────────────────────────────────────────────────────────────────────

/** The three equipment item IDs for one pet (0 = empty slot). */
export interface PetEquipmentIds {
  /** Weapon slot item ID (0 = empty). */
  readonly weaponId: number;
  /** Armor slot item ID (0 = empty). */
  readonly armorId: number;
  /** Accessory slot item ID (0 = empty). */
  readonly accessoryId: number;
}

/** Result of parsing a PetEquipStart block. */
export interface ParsedPetEquip {
  /**
   * Map from pet display name → equipment item IDs.
   * Iteration order matches the export order.
   */
  readonly equipment: ReadonlyMap<string, PetEquipmentIds>;
  /** Non-fatal parse warnings. */
  readonly warnings: ReadonlyArray<string>;
}

// ── Constants ──────────────────────────────────────────────────────────────────

const START_MARKER = '---PetEquipStart---';
const END_MARKER   = '---PetEquipEnd---';

// ── detect ─────────────────────────────────────────────────────────────────────

/**
 * Return a confidence in [0, 1] that `raw` is a PetEquip export block.
 * Safe to call on any unknown input.
 */
export function detectPetEquip(raw: unknown): number {
  if (typeof raw !== 'string') return 0;
  return raw.includes(START_MARKER) ? 0.99 : 0;
}

// ── parse ──────────────────────────────────────────────────────────────────────

/**
 * Parse a PetEquip export block.
 *
 * Accepts the full multi-section export text or just the block itself.
 * Missing or empty slots (id = 0) are preserved as-is; callers can check
 * `weaponId === 0` etc. to determine whether a slot is filled.
 */
export function parsePetEquip(text: string): ParsedPetEquip {
  const warnings: string[] = [];

  const startIdx = text.indexOf(START_MARKER);
  if (startIdx === -1) {
    return { equipment: new Map(), warnings: ['PetEquipStart marker not found in input'] };
  }

  const afterStart = text.slice(startIdx + START_MARKER.length);
  const endIdx = afterStart.indexOf(END_MARKER);
  const block = endIdx >= 0 ? afterStart.slice(0, endIdx) : afterStart;

  const entries = block
    .split(';')
    .map(s => s.trim())
    .filter(s => s.length > 0 && !s.startsWith('---'));

  const equipment = new Map<string, PetEquipmentIds>();

  for (const entry of entries) {
    const eqIdx = entry.indexOf('=');
    if (eqIdx === -1) {
      warnings.push(`Skipping malformed entry (no '='): "${entry}"`);
      continue;
    }

    const petName = entry.slice(0, eqIdx).trim();
    if (petName.length === 0) {
      warnings.push(`Skipping entry with empty pet name: "${entry}"`);
      continue;
    }

    const parts = entry
      .slice(eqIdx + 1)
      .trim()
      .split(',')
      .map(s => s.trim());

    if (parts.length < 3) {
      warnings.push(`Pet "${petName}": expected 3 item IDs, got ${parts.length}; skipping`);
      continue;
    }

    const weaponId    = parseInt(parts[0] ?? '', 10);
    const armorId     = parseInt(parts[1] ?? '', 10);
    const accessoryId = parseInt(parts[2] ?? '', 10);

    if (isNaN(weaponId) || isNaN(armorId) || isNaN(accessoryId)) {
      warnings.push(`Pet "${petName}": non-numeric item ID in "${entry.slice(eqIdx + 1)}"; skipping`);
      continue;
    }

    equipment.set(petName, { weaponId, armorId, accessoryId });
  }

  return { equipment, warnings };
}
