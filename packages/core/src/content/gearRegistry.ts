/**
 * Gear item registry — maps item names to their per-stat base bonuses at
 * quality A, upgrade +0.
 *
 * Source: itrtg.wiki.gg/wiki/Equip (high confidence).
 * See `data/gear-items.json` for the raw data.
 */

import type { GearSlot } from '../domain/gear.js';
import GEAR_ITEMS_DATA from './data/gear-items.json' with { type: 'json' };

// ── Public types ──────────────────────────────────────────────────────────────

/** Base-stat specification for one gear item at quality A, upgrade +0. */
export interface GearItemSpec {
  readonly name: string;
  readonly slot: GearSlot;
  readonly tier: 1 | 2 | 3 | 4 | 5;
  /** HP bonus fraction at A/+0 (e.g. 0.15 = +15%). May be negative. */
  readonly baseHpBonus: number;
  /** ATK bonus fraction at A/+0. May be negative. */
  readonly baseAtkBonus: number;
  /** DEF bonus fraction at A/+0. May be negative. */
  readonly baseDefBonus: number;
  /** SPD bonus fraction at A/+0. May be negative. */
  readonly baseSpdBonus: number;
}

// ── Slot-based fallback base stats for unknown items ─────────────────────────
// Used when an item name is not in the registry (e.g. event items, future content).

const SLOT_FALLBACK: Readonly<Record<GearSlot, Omit<GearItemSpec, 'name' | 'slot' | 'tier'>>> = {
  weapon:    { baseHpBonus: 0.00, baseAtkBonus: 0.15, baseDefBonus: 0.00, baseSpdBonus: 0.00 },
  armor:     { baseHpBonus: 0.15, baseAtkBonus: 0.00, baseDefBonus: 0.10, baseSpdBonus: 0.00 },
  accessory: { baseHpBonus: 0.05, baseAtkBonus: 0.05, baseDefBonus: 0.05, baseSpdBonus: 0.05 },
  trinket:   { baseHpBonus: 0.05, baseAtkBonus: 0.05, baseDefBonus: 0.05, baseSpdBonus: 0.05 },
};

// ── Build the registry ────────────────────────────────────────────────────────

const _registry = new Map<string, GearItemSpec>();

for (const item of GEAR_ITEMS_DATA.items) {
  const spec: GearItemSpec = {
    name:         item.name,
    slot:         item.slot as GearSlot,
    tier:         item.tier as 1 | 2 | 3 | 4 | 5,
    baseHpBonus:  item.baseHpBonus,
    baseAtkBonus: item.baseAtkBonus,
    baseDefBonus: item.baseDefBonus,
    baseSpdBonus: item.baseSpdBonus,
  };
  _registry.set(item.name.toLowerCase(), spec);
}

/** Immutable map of lowercase item name → GearItemSpec. */
export const GEAR_ITEM_REGISTRY: ReadonlyMap<string, GearItemSpec> = _registry;

// ── Public helpers ────────────────────────────────────────────────────────────

/**
 * Look up a gear item by name (case-insensitive).
 * Returns `undefined` if the item is not in the registry.
 */
export function lookupGearItem(name: string): GearItemSpec | undefined {
  return _registry.get(name.toLowerCase());
}

/**
 * Get the slot-based fallback base stats for items not in the registry.
 * The fallback provides reasonable defaults so forceDerive still works
 * for unknown items — stats will be off but not zero.
 */
export function getGearItemFallback(slot: GearSlot): Omit<GearItemSpec, 'name' | 'slot' | 'tier'> {
  return SLOT_FALLBACK[slot];
}
