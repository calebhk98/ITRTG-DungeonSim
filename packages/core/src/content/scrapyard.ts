/**
 * Scrapyard dungeon content module.
 *
 * Provides the concrete `Dungeon` definition and all `EnemyArchetype` instances
 * for the Scrapyard (the Neutral-element dungeon in ITRTG).
 *
 * Data sources:
 *   - data/dungeons/scrapyard.json       (dungeon-level mechanics, traps, events)
 *   - data/dungeons/scrapyard-enemies.json (enemy roster, Nothing boss stats)
 *   - docs/itrtg-pet-dungeons-research.md §7 (scaling mechanics)
 *
 * STAT CONFIDENCE NOTES
 * ─────────────────────
 * Only one enemy has published stats: the Nothing hidden boss (HP 25000 / ATK 1500
 * / DEF 500 / SPD 500, confidence "high" in source JSON).  All other per-enemy
 * stats are marked `// PLACEHOLDER (estimated)` — they are plausible values
 * calibrated to give coherent gameplay feel, not numbers sourced from the wiki.
 * XP values are similarly undocumented: every `xpValue` is a placeholder unless
 * stated otherwise.
 *
 * Boss scaling
 * ────────────
 * Bosses use `bossMult` with the depth-level base multiplier from research §7.1:
 *   Depth 1 → base ≈ 2
 *   Depth 2 → base ≈ 12   (Chameleon D2, and the hidden Nothing boss)
 *   Depth 3 → base ≈ 70
 * Each +1 difficulty adds +10 % additive to the effective multiplier.
 *
 * Railgun (Depth 4 trap)
 * ──────────────────────
 * The Railgun is NOT a normal combatant.  It is modelled as an `EnemySpecial`
 * (`kind: 'railgun'`, baseDamage 20 000) attached to `railgunTrap`.  The
 * archetype itself carries placeholder combat stats (HP=1, ATK=0, DEF=0, SPD=0)
 * so the type is satisfied, but the executor should treat it as a hazard, not a
 * target.  Scaling kind `expSqrtDiff` reflects the documented ×√2 per difficulty.
 */

import type { Dungeon } from '../domain/dungeon.js';
import type { EnemyArchetype } from '../domain/enemy.js';

// ── Depth 1: Slimy variants ───────────────────────────────────────────────────

/** Metal Slimy — D1 regular enemy.  PLACEHOLDER stats (estimated). */
export const metalSlimy: EnemyArchetype = {
  id: 'metal-slimy',
  element: 'Neutral',
  isBoss: false,
  // PLACEHOLDER (estimated): small early D1 enemy; slightly tanky for its depth.
  baseStats: { hp: 600, atk: 40, def: 30, spd: 30 },
  scaling: { kind: 'linear', perDiff: { hp: 60, atk: 4, def: 3, spd: 3 } },
  // PLACEHOLDER (estimated): per-enemy XP is undocumented; rough early-D1 value.
  xpValue: 10,
};

/** Angel Slimy — D1 regular enemy.  PLACEHOLDER stats (estimated). */
export const angelSlimy: EnemyArchetype = {
  id: 'angel-slimy',
  element: 'Neutral',
  isBoss: false,
  // PLACEHOLDER (estimated): slightly harder than Metal Slimy; higher SPD.
  baseStats: { hp: 650, atk: 45, def: 25, spd: 50 },
  scaling: { kind: 'linear', perDiff: { hp: 65, atk: 5, def: 2, spd: 5 } },
  // PLACEHOLDER (estimated)
  xpValue: 10,
};

/** Ninja Slimy — D1 regular enemy.  PLACEHOLDER stats (estimated). */
export const ninjaSlimy: EnemyArchetype = {
  id: 'ninja-slimy',
  element: 'Neutral',
  isBoss: false,
  // PLACEHOLDER (estimated): fast attacker, lower HP.
  baseStats: { hp: 500, atk: 55, def: 20, spd: 70 },
  scaling: { kind: 'linear', perDiff: { hp: 50, atk: 6, def: 2, spd: 7 } },
  // PLACEHOLDER (estimated)
  xpValue: 10,
};

/** Robo Slimy — D1 regular enemy.  PLACEHOLDER stats (estimated). */
export const roboSlimy: EnemyArchetype = {
  id: 'robo-slimy',
  element: 'Neutral',
  isBoss: false,
  // PLACEHOLDER (estimated): balanced all-rounder.
  baseStats: { hp: 700, atk: 50, def: 35, spd: 40 },
  scaling: { kind: 'linear', perDiff: { hp: 70, atk: 5, def: 3, spd: 4 } },
  // PLACEHOLDER (estimated)
  xpValue: 12,
};

/** Cyborg Slimy — D1 regular enemy.  PLACEHOLDER stats (estimated). */
export const cyborgSlimy: EnemyArchetype = {
  id: 'cyborg-slimy',
  element: 'Neutral',
  isBoss: false,
  // PLACEHOLDER (estimated): slightly more durable variant.
  baseStats: { hp: 750, atk: 48, def: 40, spd: 35 },
  scaling: { kind: 'linear', perDiff: { hp: 75, atk: 5, def: 4, spd: 3 } },
  // PLACEHOLDER (estimated)
  xpValue: 12,
};

/** Ghost Slimy — D1 regular enemy.  PLACEHOLDER stats (estimated). */
export const ghostSlimy: EnemyArchetype = {
  id: 'ghost-slimy',
  element: 'Neutral',
  isBoss: false,
  // PLACEHOLDER (estimated): evasive, low DEF.
  baseStats: { hp: 550, atk: 50, def: 15, spd: 80 },
  scaling: { kind: 'linear', perDiff: { hp: 55, atk: 5, def: 1, spd: 8 } },
  // PLACEHOLDER (estimated)
  xpValue: 11,
};

/** Unstable Slimy — D1 regular enemy.  PLACEHOLDER stats (estimated). */
export const unstableSlimy: EnemyArchetype = {
  id: 'unstable-slimy',
  element: 'Neutral',
  isBoss: false,
  // PLACEHOLDER (estimated): burst attacker, lower SPD/DEF.
  baseStats: { hp: 600, atk: 70, def: 10, spd: 30 },
  scaling: { kind: 'linear', perDiff: { hp: 60, atk: 8, def: 1, spd: 3 } },
  // PLACEHOLDER (estimated)
  xpValue: 13,
};

/**
 * Chameleon (Depth 1 boss).
 *
 * The Chameleon appears as the boss across all Scrapyard depths.  This instance
 * represents the D1 variant.
 *
 * Documented: element Neutral with all-element resistance 120 (unique).
 * Stats: PLACEHOLDER (estimated) — no wiki base stats for Chameleon.
 * Scaling: bossMult base=2 (research §7.1, D1 multiplier).
 */
export const chameleonD1: EnemyArchetype = {
  id: 'chameleon-d1',
  element: 'Neutral',
  isBoss: true,
  // PLACEHOLDER (estimated): D1 boss — relatively modest for the level.
  baseStats: { hp: 3000, atk: 200, def: 100, spd: 80 },
  // base=2: documented D1 boss multiplier (research §7.1, scrapyard-enemies.json §_notes).
  scaling: { kind: 'bossMult', base: 2 },
  // Documented: Chameleon has 120 resistance to ALL elements (scrapyard.json §specialFeatures).
  specials: [
    {
      kind: 'elementalArmor',
      description: 'Resists all elements at 120 — unique mechanic among Scrapyard bosses.',
      allElementResistance: 120,
    },
  ],
  // PLACEHOLDER (estimated)
  xpValue: 100,
};

// ── Depth 2: Regular enemies ──────────────────────────────────────────────────

/** Scrap Worm — D2 regular enemy.  PLACEHOLDER stats (estimated). */
export const scrapWorm: EnemyArchetype = {
  id: 'scrap-worm',
  element: 'Neutral',
  isBoss: false,
  // PLACEHOLDER (estimated): medium D2 enemy, beefy HP.
  baseStats: { hp: 3500, atk: 220, def: 150, spd: 100 },
  scaling: { kind: 'linear', perDiff: { hp: 350, atk: 22, def: 15, spd: 10 } },
  // PLACEHOLDER (estimated)
  xpValue: 30,
};

/** Sentry — D2 regular enemy.  PLACEHOLDER stats (estimated). */
export const sentry: EnemyArchetype = {
  id: 'sentry',
  element: 'Neutral',
  isBoss: false,
  // PLACEHOLDER (estimated): defensive tank archetype.
  baseStats: { hp: 4000, atk: 180, def: 250, spd: 80 },
  scaling: { kind: 'linear', perDiff: { hp: 400, atk: 18, def: 25, spd: 8 } },
  // PLACEHOLDER (estimated)
  xpValue: 32,
};

/** Scavenger — D2 regular enemy.  PLACEHOLDER stats (estimated). */
export const scavenger: EnemyArchetype = {
  id: 'scavenger',
  element: 'Neutral',
  isBoss: false,
  // PLACEHOLDER (estimated): fast, low DEF.
  baseStats: { hp: 3000, atk: 280, def: 100, spd: 150 },
  scaling: { kind: 'linear', perDiff: { hp: 300, atk: 28, def: 10, spd: 15 } },
  // PLACEHOLDER (estimated)
  xpValue: 28,
};

/** Robo Hound — D2 regular enemy.  PLACEHOLDER stats (estimated). */
export const roboHound: EnemyArchetype = {
  id: 'robo-hound',
  element: 'Neutral',
  isBoss: false,
  // PLACEHOLDER (estimated): balanced mechanical dog.
  baseStats: { hp: 3800, atk: 260, def: 130, spd: 130 },
  scaling: { kind: 'linear', perDiff: { hp: 380, atk: 26, def: 13, spd: 13 } },
  // PLACEHOLDER (estimated)
  xpValue: 30,
};

/** Microbots — D2 regular enemy.  PLACEHOLDER stats (estimated). */
export const microbots: EnemyArchetype = {
  id: 'microbots',
  element: 'Neutral',
  isBoss: false,
  // PLACEHOLDER (estimated): swarm type — high count but low individual stats.
  baseStats: { hp: 2000, atk: 200, def: 80, spd: 120 },
  scaling: { kind: 'linear', perDiff: { hp: 200, atk: 20, def: 8, spd: 12 } },
  // PLACEHOLDER (estimated)
  xpValue: 25,
};

/** Bulwark Golem — D2 regular enemy.  PLACEHOLDER stats (estimated). */
export const bulwarkGolem: EnemyArchetype = {
  id: 'bulwark-golem',
  element: 'Neutral',
  isBoss: false,
  // PLACEHOLDER (estimated): very high DEF, slow.
  baseStats: { hp: 5000, atk: 150, def: 400, spd: 60 },
  scaling: { kind: 'linear', perDiff: { hp: 500, atk: 15, def: 40, spd: 6 } },
  // PLACEHOLDER (estimated)
  xpValue: 35,
};

/** Displacer — D2 regular enemy (Wind element).  PLACEHOLDER stats (estimated). */
export const displacer: EnemyArchetype = {
  id: 'displacer',
  // Source data lists this as 'wind'; note the Element type uses 'Wind' (capitalised).
  element: 'Wind',
  isBoss: false,
  // PLACEHOLDER (estimated): off-element threat; fast with moderate ATK.
  baseStats: { hp: 3200, atk: 300, def: 90, spd: 180 },
  scaling: { kind: 'linear', perDiff: { hp: 320, atk: 30, def: 9, spd: 18 } },
  // PLACEHOLDER (estimated)
  xpValue: 30,
};

/** Sword Soldier — D2 regular enemy.  PLACEHOLDER stats (estimated). */
export const swordSoldier: EnemyArchetype = {
  id: 'sword-soldier',
  element: 'Neutral',
  isBoss: false,
  // PLACEHOLDER (estimated): melee bruiser.
  baseStats: { hp: 4200, atk: 320, def: 160, spd: 100 },
  scaling: { kind: 'linear', perDiff: { hp: 420, atk: 32, def: 16, spd: 10 } },
  // PLACEHOLDER (estimated)
  xpValue: 33,
};

/**
 * Chameleon (Depth 2 boss).
 *
 * Stats: PLACEHOLDER (estimated).
 * Scaling: bossMult base=12 (research §7.1, D2 multiplier).
 */
export const chameleonD2: EnemyArchetype = {
  id: 'chameleon-d2',
  element: 'Neutral',
  isBoss: true,
  // PLACEHOLDER (estimated): stronger D2 variant of the Chameleon.
  baseStats: { hp: 8000, atk: 500, def: 300, spd: 200 },
  // base=12: documented D2 boss multiplier (research §7.1).
  scaling: { kind: 'bossMult', base: 12 },
  specials: [
    {
      kind: 'elementalArmor',
      description: 'Resists all elements at 120.',
      allElementResistance: 120,
    },
  ],
  // PLACEHOLDER (estimated)
  xpValue: 500,
};

/**
 * Nothing (hidden D2 boss).
 *
 * Stats are DOCUMENTED (confidence "high" per scrapyard-enemies.json):
 *   HP 25 000 / ATK 1 500 / DEF 500 / SPD 500.
 *
 * Trigger: place "Nothing (item)" + "Hot Stone" in item column at Room 16.
 * Reward: unlocks the Nothing pet on defeat.
 *
 * Scaling: bossMult base=12 (same depth as D2 Chameleon, research §7.1).
 * Specials sourced from research JSON: Confusion Attack and Self-Healing.
 */
export const nothingBoss: EnemyArchetype = {
  id: 'nothing',
  element: 'Neutral',
  isBoss: true,
  // DOCUMENTED (confidence: high — scrapyard-enemies.json §nothing).
  baseStats: { hp: 25_000, atk: 1_500, def: 500, spd: 500 },
  // base=12: D2 depth multiplier.  Nothing is a hidden boss at Room 16 (D2).
  scaling: { kind: 'bossMult', base: 12 },
  specials: [
    {
      kind: 'confusionAttack',
      description:
        'Normal attacks can inflict Confusion. Formula: [((attacker elements/2) / defender elements)-0.3]×100%.',
    },
    {
      kind: 'selfHealing',
      description: 'Uses recovery skills to heal itself; exact formula unknown.',
    },
  ],
  // PLACEHOLDER (estimated): XP for the Nothing boss is undocumented.
  xpValue: 800,
};

// ── Depth 3: Regular enemies ──────────────────────────────────────────────────

/** Constructor — D3 regular enemy.  PLACEHOLDER stats (estimated). */
export const constructor_: EnemyArchetype = {
  id: 'constructor',
  element: 'Neutral',
  isBoss: false,
  // PLACEHOLDER (estimated): mid-tier mechanical builder.
  baseStats: { hp: 20_000, atk: 1_200, def: 800, spd: 400 },
  scaling: { kind: 'expDiff', factor: 1.15 },
  // PLACEHOLDER (estimated)
  xpValue: 120,
};

/** Compactor — D3 regular enemy.  PLACEHOLDER stats (estimated). */
export const compactor: EnemyArchetype = {
  id: 'compactor',
  element: 'Neutral',
  isBoss: false,
  // PLACEHOLDER (estimated): high DEF, slow crusher.
  baseStats: { hp: 25_000, atk: 900, def: 1_500, spd: 250 },
  scaling: { kind: 'expDiff', factor: 1.15 },
  // PLACEHOLDER (estimated)
  xpValue: 125,
};

/** Replacer — D3 regular enemy.  PLACEHOLDER stats (estimated). */
export const replacer: EnemyArchetype = {
  id: 'replacer',
  element: 'Neutral',
  isBoss: false,
  // PLACEHOLDER (estimated): all-round D3 threat.
  baseStats: { hp: 22_000, atk: 1_300, def: 700, spd: 500 },
  scaling: { kind: 'expDiff', factor: 1.15 },
  // PLACEHOLDER (estimated)
  xpValue: 122,
};

/** Slayer — D3 regular enemy.  PLACEHOLDER stats (estimated). */
export const slayer: EnemyArchetype = {
  id: 'slayer',
  element: 'Neutral',
  isBoss: false,
  // PLACEHOLDER (estimated): high ATK, lower DEF.
  baseStats: { hp: 18_000, atk: 1_800, def: 500, spd: 600 },
  scaling: { kind: 'expDiff', factor: 1.15 },
  // PLACEHOLDER (estimated)
  xpValue: 130,
};

/** Arbiter — D3 regular enemy.  PLACEHOLDER stats (estimated). */
export const arbiter: EnemyArchetype = {
  id: 'arbiter',
  element: 'Neutral',
  isBoss: false,
  // PLACEHOLDER (estimated): balanced elite D3 unit.
  baseStats: { hp: 24_000, atk: 1_400, def: 900, spd: 450 },
  scaling: { kind: 'expDiff', factor: 1.15 },
  // PLACEHOLDER (estimated)
  xpValue: 128,
};

/** Reclaimer — D3 regular enemy (Earth element).  PLACEHOLDER stats (estimated). */
export const reclaimer: EnemyArchetype = {
  id: 'reclaimer',
  element: 'Earth',
  isBoss: false,
  // PLACEHOLDER (estimated): off-element Earth threat; durable.
  baseStats: { hp: 26_000, atk: 1_100, def: 1_200, spd: 300 },
  scaling: { kind: 'expDiff', factor: 1.15 },
  // PLACEHOLDER (estimated)
  xpValue: 132,
};

/** Repurposer — D3 regular enemy (Fire element).  PLACEHOLDER stats (estimated). */
export const repurposer: EnemyArchetype = {
  id: 'repurposer',
  element: 'Fire',
  isBoss: false,
  // PLACEHOLDER (estimated): fire-based D3 attacker.
  baseStats: { hp: 19_000, atk: 1_600, def: 600, spd: 550 },
  scaling: { kind: 'expDiff', factor: 1.15 },
  // PLACEHOLDER (estimated)
  xpValue: 128,
};

/** Sanitizer — D3 regular enemy (Water element).  PLACEHOLDER stats (estimated). */
export const sanitizer: EnemyArchetype = {
  id: 'sanitizer',
  element: 'Water',
  isBoss: false,
  // PLACEHOLDER (estimated): water-type support/attacker.
  baseStats: { hp: 21_000, atk: 1_250, def: 800, spd: 500 },
  scaling: { kind: 'expDiff', factor: 1.15 },
  // PLACEHOLDER (estimated)
  xpValue: 125,
};

/**
 * Chameleon (Depth 3 boss).
 *
 * Stats: PLACEHOLDER (estimated).
 * Scaling: bossMult base=70 (research §7.1, D3 multiplier).
 */
export const chameleonD3: EnemyArchetype = {
  id: 'chameleon-d3',
  element: 'Neutral',
  isBoss: true,
  // PLACEHOLDER (estimated): significantly more powerful D3 variant.
  baseStats: { hp: 50_000, atk: 3_000, def: 1_500, spd: 800 },
  // base=70: documented D3 boss multiplier (research §7.1).
  scaling: { kind: 'bossMult', base: 70 },
  specials: [
    {
      kind: 'elementalArmor',
      description: 'Resists all elements at 120.',
      allElementResistance: 120,
    },
  ],
  // PLACEHOLDER (estimated)
  xpValue: 2_000,
};

// ── Depth 4: Regular enemies ──────────────────────────────────────────────────

/** Nanobot — D4 regular enemy.  PLACEHOLDER stats (estimated). */
export const nanobot: EnemyArchetype = {
  id: 'nanobot',
  element: 'Neutral',
  isBoss: false,
  // PLACEHOLDER (estimated): tiny but replicating; individual stats low.
  baseStats: { hp: 80_000, atk: 5_000, def: 2_000, spd: 1_200 },
  scaling: { kind: 'expDiff', factor: 1.2 },
  // Documented: can self-replicate unless countered by Nanotraps.
  specials: [
    {
      kind: 'selfReplication',
      description:
        'Can replicate itself each turn unless Nanotraps are equipped by the team. Exact formula unknown.',
    },
  ],
  // PLACEHOLDER (estimated)
  xpValue: 400,
};

/** Alien Drone — D4 regular enemy.  PLACEHOLDER stats (estimated). */
export const alienDrone: EnemyArchetype = {
  id: 'alien-drone',
  element: 'Neutral',
  isBoss: false,
  // PLACEHOLDER (estimated): fast aerial attacker.
  baseStats: { hp: 70_000, atk: 6_000, def: 1_500, spd: 2_000 },
  scaling: { kind: 'expDiff', factor: 1.2 },
  // PLACEHOLDER (estimated)
  xpValue: 380,
};

/** Restoration Bot — D4 regular enemy (Water element).  PLACEHOLDER stats (estimated). */
export const restorationBot: EnemyArchetype = {
  id: 'restoration-bot',
  element: 'Water',
  isBoss: false,
  // PLACEHOLDER (estimated): support enemy; heals allies.
  baseStats: { hp: 90_000, atk: 3_500, def: 3_000, spd: 800 },
  scaling: { kind: 'expDiff', factor: 1.2 },
  // Documented: heals itself or allies.
  specials: [
    {
      kind: 'healing',
      description: 'Can heal itself or allies during combat. Exact formula unknown.',
    },
  ],
  // PLACEHOLDER (estimated)
  xpValue: 420,
};

/** Cyber Bears — D4 regular enemy (Fire element).  PLACEHOLDER stats (estimated). */
export const cyberBears: EnemyArchetype = {
  id: 'cyber-bears',
  element: 'Fire',
  isBoss: false,
  // PLACEHOLDER (estimated): heavy fire-based brute.
  baseStats: { hp: 110_000, atk: 7_000, def: 2_500, spd: 900 },
  scaling: { kind: 'expDiff', factor: 1.2 },
  // PLACEHOLDER (estimated)
  xpValue: 450,
};

/** Terraformer — D4 regular enemy (Earth element).  PLACEHOLDER stats (estimated). */
export const terraformer: EnemyArchetype = {
  id: 'terraformer',
  element: 'Earth',
  isBoss: false,
  // PLACEHOLDER (estimated): ground-based heavy hitter.
  baseStats: { hp: 120_000, atk: 6_500, def: 3_500, spd: 700 },
  scaling: { kind: 'expDiff', factor: 1.2 },
  // PLACEHOLDER (estimated)
  xpValue: 460,
};

/** Shield Generator — D4 regular enemy.  PLACEHOLDER stats (estimated). */
export const shieldGenerator: EnemyArchetype = {
  id: 'shield-generator',
  element: 'Neutral',
  isBoss: false,
  // PLACEHOLDER (estimated): stationary high-DEF support.
  baseStats: { hp: 100_000, atk: 2_000, def: 6_000, spd: 500 },
  scaling: { kind: 'expDiff', factor: 1.2 },
  // PLACEHOLDER (estimated)
  xpValue: 400,
};

/** Land Battleship — D4 regular enemy (Wind element).  PLACEHOLDER stats (estimated). */
export const landBattleship: EnemyArchetype = {
  id: 'land-battleship',
  element: 'Wind',
  isBoss: false,
  // PLACEHOLDER (estimated): massive wind-element war machine.
  baseStats: { hp: 150_000, atk: 8_000, def: 4_000, spd: 600 },
  scaling: { kind: 'expDiff', factor: 1.2 },
  // PLACEHOLDER (estimated)
  xpValue: 500,
};

/** Obliterator — D4 regular enemy.  PLACEHOLDER stats (estimated). */
export const obliterator: EnemyArchetype = {
  id: 'obliterator',
  element: 'Neutral',
  isBoss: false,
  // PLACEHOLDER (estimated): end-game elite attacker.
  baseStats: { hp: 130_000, atk: 9_500, def: 3_000, spd: 1_100 },
  scaling: { kind: 'expDiff', factor: 1.2 },
  // PLACEHOLDER (estimated)
  xpValue: 520,
};

/**
 * Chameleon (Depth 4 boss).
 *
 * Stats: PLACEHOLDER (estimated).
 * The D4 boss identity is flagged as potentially unknown in the data (gaps note
 * says "may be Ancient Mimic or other"); we document it as the Chameleon per
 * the `knownBosses` field in scrapyard.json which lists Chameleon for "All depths".
 *
 * Scaling: expDiff with factor 1.4 (same as Ancient Mimic) — PLACEHOLDER; no
 * documented D4 boss multiplier was found, so we use the well-known 1.4 exponent
 * rather than inventing a baseMult.
 */
export const chameleonD4: EnemyArchetype = {
  id: 'chameleon-d4',
  element: 'Neutral',
  isBoss: true,
  // PLACEHOLDER (estimated): extreme D4 difficulty.
  baseStats: { hp: 500_000, atk: 30_000, def: 15_000, spd: 5_000 },
  // PLACEHOLDER (estimated): factor 1.4 from Ancient Mimic data; D4 formula unknown.
  scaling: { kind: 'expDiff', factor: 1.4 },
  specials: [
    {
      kind: 'elementalArmor',
      description: 'Resists all elements at 120.',
      allElementResistance: 120,
    },
  ],
  // PLACEHOLDER (estimated)
  xpValue: 10_000,
};

/**
 * Railgun (Depth 4 hazard / trap).
 *
 * This is NOT a normal combatant — it is the persistent Depth 4 environmental
 * trap that fires at the start of each turn.  The archetype is present so the
 * executor can read its `specials` array.
 *
 * Documented (scrapyard.json §traps, confidence "high"):
 *   - Shoots one random pet at the start of each turn; damage ignores DEF.
 *   - Pets killed cannot be revived by Phoenix Feathers in the same room.
 *   - Diff 0 damage: 20 000; Diff 10 damage: ~640 310.
 *   - Scaling: ×√2 per difficulty level (expSqrtDiff).
 *
 * The `baseStats` are sentinel values (HP=1 so the scaler satisfies the type;
 * ATK/DEF/SPD=0 because the Railgun does not participate in normal combat).
 * The executor MUST handle this archetype as a hazard, not a target.
 */
export const railgunTrap: EnemyArchetype = {
  id: 'railgun-trap',
  element: 'Neutral',
  isBoss: false,
  // Sentinel stats — see doc above.  The railgun is a HAZARD, not a combatant.
  baseStats: { hp: 1, atk: 0, def: 0, spd: 0 },
  // DOCUMENTED: expSqrtDiff — ×√2 per difficulty (research §7.2, scrapyard-enemies.json).
  scaling: { kind: 'expSqrtDiff' },
  // DOCUMENTED: baseDamage 20 000 at Difficulty 0 (scrapyard.json §traps).
  specials: [
    { kind: 'railgun', baseDamage: 20_000 },
  ],
  // No XP — traps do not grant kills.
  xpValue: 0,
};

// ── All archetypes ────────────────────────────────────────────────────────────

/**
 * Every EnemyArchetype defined in this module, for convenience iteration
 * (e.g. validation tests, content loaders).
 */
export const ALL_SCRAPYARD_ARCHETYPES: ReadonlyArray<EnemyArchetype> = [
  // D1 regulars
  metalSlimy,
  angelSlimy,
  ninjaSlimy,
  roboSlimy,
  cyborgSlimy,
  ghostSlimy,
  unstableSlimy,
  // D1 boss
  chameleonD1,
  // D2 regulars
  scrapWorm,
  sentry,
  scavenger,
  roboHound,
  microbots,
  bulwarkGolem,
  displacer,
  swordSoldier,
  // D2 bosses
  chameleonD2,
  nothingBoss,
  // D3 regulars
  constructor_,
  compactor,
  replacer,
  slayer,
  arbiter,
  reclaimer,
  repurposer,
  sanitizer,
  // D3 boss
  chameleonD3,
  // D4 regulars
  nanobot,
  alienDrone,
  restorationBot,
  cyberBears,
  terraformer,
  shieldGenerator,
  landBattleship,
  obliterator,
  // D4 boss + trap
  chameleonD4,
  railgunTrap,
];

// ── Archetype lookup map ──────────────────────────────────────────────────────

/**
 * Lookup map from archetype id → EnemyArchetype for all Scrapyard archetypes.
 * Satisfies `Dungeon.archetypes`: every `enemyId` in the enemy tables and every
 * `bossArchetypeId` value resolves through this map.
 */
const SCRAPYARD_ARCHETYPES_MAP: Readonly<Record<string, EnemyArchetype>> =
  Object.fromEntries(ALL_SCRAPYARD_ARCHETYPES.map(a => [a.id, a]));

// ── Dungeon definition ────────────────────────────────────────────────────────

/**
 * The Scrapyard dungeon.
 *
 * Documented properties (confidence "high" in source data):
 *   - element: Neutral
 *   - depths: 1–4
 *   - bossRooms: 6 (D1), 16 (D2), 30 (D3), 60 (D4)
 *   - Depth 4 has an unavoidable Railgun trap.
 *
 * Enemy tables are populated with equal-weight entries by default.  The `weight`
 * values are PLACEHOLDER — actual in-game spawn probabilities are undocumented;
 * adjust them when that data becomes available.
 *
 * The `bossArchetypeId` map lists the PRIMARY boss per depth.  The Nothing hidden
 * boss ('nothing') appears conditionally at D2 Room 16 only when the player holds
 * the required items; the executor decides whether to substitute it for the normal
 * Chameleon based on team inventory.
 *
 * `archetypes` satisfies `Dungeon.archetypes`: every enemyId used in the enemy
 * tables and every bossArchetypeId value resolves within this map.
 */
export const scrapyardDungeon: Dungeon = {
  id: 'Scrapyard',
  element: 'Neutral',

  // Boss archetype per depth (room 6 / 16 / 30 / 60).
  // Primary boss is always Chameleon.  Executor may swap D2 to 'nothing' based on items.
  bossArchetypeId: {
    1: 'chameleon-d1',
    2: 'chameleon-d2',
    3: 'chameleon-d3',
    4: 'chameleon-d4',
  },

  enemyTable: {
    // ── Depth 1 ──────────────────────────────────────────────────────────────
    1: {
      drawsPerRoom: 1,
      entries: [
        // PLACEHOLDER weights (estimated): equal probability among D1 slimies.
        { enemyId: 'metal-slimy',    weight: 1, minCount: 1, maxCount: 2 },
        { enemyId: 'angel-slimy',    weight: 1, minCount: 1, maxCount: 2 },
        { enemyId: 'ninja-slimy',    weight: 1, minCount: 1, maxCount: 2 },
        { enemyId: 'robo-slimy',     weight: 1, minCount: 1, maxCount: 2 },
        { enemyId: 'cyborg-slimy',   weight: 1, minCount: 1, maxCount: 2 },
        { enemyId: 'ghost-slimy',    weight: 1, minCount: 1, maxCount: 2 },
        { enemyId: 'unstable-slimy', weight: 1, minCount: 1, maxCount: 2 },
      ],
    },

    // ── Depth 2 ──────────────────────────────────────────────────────────────
    2: {
      drawsPerRoom: 1,
      entries: [
        // PLACEHOLDER weights (estimated): equal probability among D2 regulars.
        { enemyId: 'scrap-worm',    weight: 1, minCount: 1, maxCount: 2 },
        { enemyId: 'sentry',        weight: 1, minCount: 1, maxCount: 2 },
        { enemyId: 'scavenger',     weight: 1, minCount: 1, maxCount: 2 },
        { enemyId: 'robo-hound',    weight: 1, minCount: 1, maxCount: 2 },
        { enemyId: 'microbots',     weight: 1, minCount: 1, maxCount: 3 },
        { enemyId: 'bulwark-golem', weight: 1, minCount: 1, maxCount: 1 },
        { enemyId: 'displacer',     weight: 1, minCount: 1, maxCount: 2 },
        { enemyId: 'sword-soldier', weight: 1, minCount: 1, maxCount: 2 },
      ],
    },

    // ── Depth 3 ──────────────────────────────────────────────────────────────
    3: {
      drawsPerRoom: 1,
      entries: [
        // PLACEHOLDER weights (estimated): equal probability among D3 regulars.
        { enemyId: 'constructor', weight: 1, minCount: 1, maxCount: 2 },
        { enemyId: 'compactor',   weight: 1, minCount: 1, maxCount: 1 },
        { enemyId: 'replacer',    weight: 1, minCount: 1, maxCount: 2 },
        { enemyId: 'slayer',      weight: 1, minCount: 1, maxCount: 2 },
        { enemyId: 'arbiter',     weight: 1, minCount: 1, maxCount: 2 },
        { enemyId: 'reclaimer',   weight: 1, minCount: 1, maxCount: 2 },
        { enemyId: 'repurposer',  weight: 1, minCount: 1, maxCount: 2 },
        { enemyId: 'sanitizer',   weight: 1, minCount: 1, maxCount: 2 },
      ],
    },

    // ── Depth 4 ──────────────────────────────────────────────────────────────
    4: {
      drawsPerRoom: 1,
      entries: [
        // PLACEHOLDER weights (estimated): equal probability among D4 regulars.
        // The railgun-trap is NOT listed here — it is a room-level hazard, not
        // a drawn enemy.  The executor should apply it unconditionally at D4.
        { enemyId: 'nanobot',          weight: 1, minCount: 1, maxCount: 3 },
        { enemyId: 'alien-drone',      weight: 1, minCount: 1, maxCount: 2 },
        { enemyId: 'restoration-bot',  weight: 1, minCount: 1, maxCount: 2 },
        { enemyId: 'cyber-bears',      weight: 1, minCount: 1, maxCount: 2 },
        { enemyId: 'terraformer',      weight: 1, minCount: 1, maxCount: 1 },
        { enemyId: 'shield-generator', weight: 1, minCount: 1, maxCount: 1 },
        { enemyId: 'land-battleship',  weight: 1, minCount: 1, maxCount: 1 },
        { enemyId: 'obliterator',      weight: 1, minCount: 1, maxCount: 2 },
      ],
    },
  },

  // Self-contained archetype lookup: every enemyId in the tables above and every
  // bossArchetypeId value resolves within this map (including the Nothing hidden boss
  // and the Railgun trap even though neither appears in the normal enemy tables).
  archetypes: SCRAPYARD_ARCHETYPES_MAP,
};
