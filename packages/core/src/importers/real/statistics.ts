/**
 * ITRTG Statistics-Export parser.
 *
 * Parses the freeform text file produced by the game's "Statistics" export
 * (Idling to Rule the Gods — statistic.txt). This is NOT a PetImporter; it
 * produces a `WorldState` capturing global player-state fields relevant to
 * dungeon simulation.
 *
 * ## Parsing strategy
 * The file has no rigid schema — it is a human-readable report with labelled
 * lines. We use regex/line-lookup patterns, so missing or renamed lines
 * gracefully produce `undefined` or `0` with a note logged to `warnings`.
 *
 * ## toGlobalModifiers note
 * The mapping from WorldState → GlobalModifiers is approximate:
 * - Dojo contributes per-stat percentage buffs (Pet attack 99%, Pet health 99%,
 *   etc.), but `GlobalModifiers.statMultiplier` is a single scalar. We average
 *   the main combat stats (attack + health + speed) as a rough proxy.
 *   DOCUMENT: This is an approximation; use observed stats for accurate sims.
 * - Strategy Room element % levels are averaged across all four elements for
 *   `elementLevelMultiplier`. Again an approximation; real sim uses observed
 *   element levels.
 */

import type { GlobalModifiers } from '../../sim/stats.js';

// ── WorldState interface ───────────────────────────────────────────────────────

/** Dojo building bonuses (percentage additive buffs to pet stats). */
export interface DojoState {
  /** "Dungeon exp: N%" */
  dungeonExpPct: number;
  /** "Other exp: N%" */
  otherExpPct: number;
  /** "Pet attack: N%" */
  attackPct: number;
  /** "Pet health: N%" */
  healthPct: number;
  /** "Pet speed: N%" */
  speedPct: number;
  /** "Pet speed damage: N%" */
  speedDamagePct: number;
  /** "Pet water/fire/wind/earth: N%" */
  elementPct: {
    water: number;
    fire: number;
    wind: number;
    earth: number;
  };
  /** "Pet physical: N%" */
  physicalPct: number;
  /** "Pet mystic: N%" */
  mysticPct: number;
  /** "Pet battle: N%" */
  battlePct: number;
}

/** Strategy Room building state. */
export interface StrategyRoomState {
  /** "Health: N" — Strategy Room health points. */
  health: number;
  /** "Attack: N" */
  attack: number;
  /** "Defense: N" */
  defense: number;
  /** "Speed: N" */
  speed: number;
  /** Element percentage multipliers from the Strategy Room slots. */
  elementPct: {
    water: number;
    fire: number;
    wind: number;
    earth: number;
  };
  /**
   * "4th lowest growth pet: Name (N)" — the growth of the 4th-lowest pet,
   * used in the Strategy Room stat-bonus formula.
   */
  fourthLowestGrowth: number;
  /** "Strategy Books: N" — total books fed to the Strategy Room. */
  strategyBooks: number;
}

/** Challenge-points spendable bonuses. */
export interface ChallengePoints {
  /** "Chp Dungeon Drop boost: N%" */
  dungeonDropBoostPct: number;
  /** "Chp Dungeon Exp boost: N%" */
  dungeonExpBoostPct: number;
  /** "Chp Dungeon Overtime: N%" */
  dungeonOvertimePct: number;
  /** "Chp D4 boss room: N" — boss-room dungeon-4 cooldown (seconds). */
  d4BossRoom: number;
  /** "Chp Pet Stone Drop boost: N%" */
  petStoneDropBoostPct: number;
}

/** Pet Equipment bonuses (account-wide gear set). */
export interface PetEquipBonus {
  /** "Pet equip hp bonus: N%" */
  hpPct: number;
  /** "Pet equip attack bonus: N%" */
  attackPct: number;
  /** "Pet equip mystic bonus: N%" */
  mysticPct: number;
  /** "Pet equip regen bonus: N%" */
  regenPct: number;
  /** "Pet equip building speed bonus: N%" */
  buildingSpeedPct: number;
  /** "Pet equip creating speed bonus: N%" */
  creatingSpeedPct: number;
}

/** Aggregate pet-roster totals. */
export interface PetTotals {
  /** "Unlocked Pets: N" */
  unlockedPets: number;
  /** "Evolved Pets: N" */
  evolvedPets: number;
  /** "Total Pet Dungeon Levels: N" */
  totalDungeonLevels: number;
  /** "Total Pet growth: N" (may be expressed as "N E+6", etc.) */
  totalPetGrowth: number;
  /** "Pet Stones: N" */
  petStones: number;
}

/**
 * Parsed representation of the ITRTG statistics export, containing all
 * dungeon-relevant global player-state fields.
 */
export interface WorldState {
  /** Dojo building stat buffs. */
  dojo: DojoState;
  /** Strategy Room building state. */
  strategyRoom: StrategyRoomState;
  /**
   * Number of completed No-Rebirth Dungeon Challenge runs.
   * Parsed from "No Rebirth Dungeon Challenges: X / Y" → X.
   */
  nrdcCompletions: number;
  /** Dungeon-relevant Challenge-Points bonuses. */
  challengePoints: ChallengePoints;
  /** Pet equipment account-wide bonuses. */
  petEquipBonus: PetEquipBonus;
  /** Aggregate pet-roster totals. */
  totals: PetTotals;
}

// ── Parsing helpers ────────────────────────────────────────────────────────────

/** Extract a plain integer from "Label: N,NNN" style lines. Returns 0 if not found. */
function extractInt(text: string, label: string): number {
  const re = new RegExp(`^${label}:\\s*([\\d,]+)`, 'm');
  const m = re.exec(text);
  if (m === null) return 0;
  return parseInt((m[1] ?? '0').replace(/,/g, ''), 10);
}

/**
 * Extract a number from lines that may use "N.NNN E+6" scientific notation
 * or "N,NNN" plain integer format. Returns 0 if not found.
 */
function extractNumber(text: string, label: string): number {
  const re = new RegExp(`^${label}:\\s*([\\d,.]+(?:\\s*E[+-]?\\d+)?)`, 'mi');
  const m = re.exec(text);
  if (m === null) return 0;
  const raw = (m[1] ?? '0').replace(/,/g, '').trim();
  // Handle "N.NNN E+6" notation
  const sciMatch = /^([\d.]+)\s*E([+-]?\d+)$/.exec(raw);
  if (sciMatch !== null) {
    return parseFloat(sciMatch[1]!) * Math.pow(10, parseInt(sciMatch[2]!, 10));
  }
  return parseFloat(raw);
}

/**
 * Extract a percentage number from "Label: N%" style lines.
 * Handles comma-separated thousands (e.g. "3,268.52%") and plain integers.
 * Returns 0 if not found.
 */
function extractPct(text: string, label: string): number {
  const re = new RegExp(`^${label}:\\s*([\\d,]+(?:\\.\\d+)?)%`, 'm');
  const m = re.exec(text);
  if (m === null) return 0;
  return parseFloat((m[1] ?? '0').replace(/,/g, ''));
}

// ── Main parser ───────────────────────────────────────────────────────────────

/**
 * Parse an ITRTG statistics export text into a `WorldState`.
 *
 * Parsing is defensive: missing fields default to 0 (or undefined for optional
 * sub-fields). No exception is thrown for missing data — callers should treat
 * all fields as potentially approximate.
 */
export function parseStatisticsExport(text: string): WorldState {
  // ── Dojo ─────────────────────────────────────────────────────────────────────
  const dojo: DojoState = {
    dungeonExpPct:  extractPct(text, 'Dungeon exp'),
    otherExpPct:    extractPct(text, 'Other exp'),
    attackPct:      extractPct(text, 'Pet attack'),
    healthPct:      extractPct(text, 'Pet health'),
    speedPct:       extractPct(text, 'Pet speed'),
    speedDamagePct: extractPct(text, 'Pet speed damage'),
    elementPct: {
      water: extractPct(text, 'Pet water'),
      fire:  extractPct(text, 'Pet fire'),
      wind:  extractPct(text, 'Pet wind'),
      earth: extractPct(text, 'Pet earth'),
    },
    physicalPct: extractPct(text, 'Pet physical'),
    mysticPct:   extractPct(text, 'Pet mystic'),
    battlePct:   extractPct(text, 'Pet battle'),
  };

  // ── Strategy Room ─────────────────────────────────────────────────────────────
  // Strategy Room block appears after "Strategy Room" header.
  // We look for "Health:", "Attack:", "Defense:", "Speed:" in that section.
  // These are numeric (not percentages).
  const srSection = (() => {
    const idx = text.indexOf('Strategy Room');
    return idx >= 0 ? text.slice(idx) : '';
  })();

  // 4th lowest growth: "4th lowest growth pet: 鷲（わし） (144,296)"
  const fourthGrowthMatch = /4th lowest growth pet:.*?\(([0-9,]+)\)/.exec(text);
  const fourthLowestGrowth = fourthGrowthMatch !== null
    ? parseInt((fourthGrowthMatch[1] ?? '0').replace(/,/g, ''), 10)
    : 0;

  // Element percentages in Strategy Room use "Water: N.NN%", etc.
  const srWaterMatch  = /^Water:\s*([\d.]+)%/m.exec(srSection);
  const srFireMatch   = /^Fire:\s*([\d.]+)%/m.exec(srSection);
  const srWindMatch   = /^Wind:\s*([\d.]+)%/m.exec(srSection);
  const srEarthMatch  = /^Earth:\s*([\d.]+)%/m.exec(srSection);

  const strategyRoom: StrategyRoomState = {
    health:  extractInt(srSection, 'Health'),
    attack:  extractInt(srSection, 'Attack'),
    defense: extractInt(srSection, 'Defense'),
    speed:   extractInt(srSection, 'Speed'),
    elementPct: {
      water: srWaterMatch !== null ? parseFloat(srWaterMatch[1] ?? '0') : 0,
      fire:  srFireMatch  !== null ? parseFloat(srFireMatch[1]  ?? '0') : 0,
      wind:  srWindMatch  !== null ? parseFloat(srWindMatch[1]  ?? '0') : 0,
      earth: srEarthMatch !== null ? parseFloat(srEarthMatch[1] ?? '0') : 0,
    },
    fourthLowestGrowth,
    strategyBooks: extractInt(text, 'Strategy Books'),
  };

  // ── NRDC completions ─────────────────────────────────────────────────────────
  // "No Rebirth Dungeon Challenges: 21 / 20" → completions = 21
  const nrdcMatch = /No Rebirth Dungeon Challenges:\s*(\d+)\s*\//.exec(text);
  const nrdcCompletions = nrdcMatch !== null ? parseInt(nrdcMatch[1] ?? '0', 10) : 0;

  // ── Challenge Points bonuses ─────────────────────────────────────────────────
  const challengePoints: ChallengePoints = {
    dungeonDropBoostPct:  extractPct(text, 'Chp Dungeon Drop boost'),
    dungeonExpBoostPct:   extractPct(text, 'Chp Dungeon Exp boost'),
    dungeonOvertimePct:   extractPct(text, 'Chp Dungeon Overtime'),
    d4BossRoom:           extractInt(text, 'Chp D4 boss room'),
    petStoneDropBoostPct: extractPct(text, 'Chp Pet Stone Drop boost'),
  };

  // ── Pet equip bonuses ─────────────────────────────────────────────────────────
  const petEquipBonus: PetEquipBonus = {
    hpPct:              extractPct(text, 'Pet equip hp bonus'),
    attackPct:          extractPct(text, 'Pet equip attack bonus'),
    mysticPct:          extractPct(text, 'Pet equip mystic bonus'),
    regenPct:           extractPct(text, 'Pet equip regen bonus'),
    buildingSpeedPct:   extractPct(text, 'Pet equip building speed bonus'),
    creatingSpeedPct:   extractPct(text, 'Pet equip creating speed bonus'),
  };

  // ── Pet totals ────────────────────────────────────────────────────────────────
  const totals: PetTotals = {
    unlockedPets:       extractInt(text, 'Unlocked Pets'),
    evolvedPets:        extractInt(text, 'Evolved Pets'),
    totalDungeonLevels: extractInt(text, 'Total Pet Dungeon Levels'),
    totalPetGrowth:     extractNumber(text, 'Total Pet growth'),
    petStones:          extractInt(text, 'Pet Stones'),
  };

  return {
    dojo,
    strategyRoom,
    nrdcCompletions,
    challengePoints,
    petEquipBonus,
    totals,
  };
}

// ── toGlobalModifiers ─────────────────────────────────────────────────────────

/**
 * Best-effort conversion of a `WorldState` to `GlobalModifiers`.
 *
 * ## Approximations (documented)
 *
 * ### statMultiplier (from Dojo)
 * The Dojo exposes per-stat percentage buffs (attack 99%, health 99%, speed 98%,
 * etc.). `GlobalModifiers.statMultiplier` is a single scalar applied uniformly to
 * all four stats. We use the average of attack + health + speed buffs as a rough
 * proxy: `statMultiplier = 1 + avg(attackPct, healthPct, speedPct) / 100`.
 * This OVERESTIMATES defense (which has no dedicated Dojo slot) and
 * UNDERESTIMATES stats for pets whose primary stat gets a higher Dojo bonus.
 * For accurate simulation, use `pet.observed` stats directly (the default path).
 *
 * ### elementLevelMultiplier (from Strategy Room)
 * Strategy Room element slots each have a per-element % multiplier. We average
 * the four element percentages: `1 + avg(water%, fire%, wind%, earth%) / 100`.
 * Per-element differences are lost. Again, `pet.observed.elementLevels` is more
 * accurate.
 *
 * This function is mainly useful for the formula/what-if derive path.
 */
export function toGlobalModifiers(ws: WorldState): GlobalModifiers {
  // statMultiplier: average of Dojo attack + health + speed buffs
  const dojoAvg = (ws.dojo.attackPct + ws.dojo.healthPct + ws.dojo.speedPct) / 3;
  const statMultiplier = 1 + dojoAvg / 100;

  // elementLevelMultiplier: average of Strategy Room element percentages
  const srElAvg = (
    ws.strategyRoom.elementPct.water +
    ws.strategyRoom.elementPct.fire  +
    ws.strategyRoom.elementPct.wind  +
    ws.strategyRoom.elementPct.earth
  ) / 4;
  const elementLevelMultiplier = 1 + srElAvg / 100;

  return {
    statMultiplier,
    elementLevelMultiplier,
    // statAdditive, growthMultiplier, elementLevelBonus:
    // Not reliably derivable from the statistics export without the full formula;
    // omit them (callers get identity defaults).
  };
}
