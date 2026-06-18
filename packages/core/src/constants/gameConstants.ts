import type { GameConstants } from './types.js';

/**
 * The authoritative runtime values for all formula constants.
 * Every entry cites the research-doc section and carries a confidence rating.
 *
 * Sourcing policy:
 *   - 'confirmed' = unambiguous in-game UI or dev source.
 *   - 'community' = wiki / player-compiled; generally reliable but not dev-confirmed.
 *   - 'estimated' = reverse-engineered, inferred, or flagged as uncertain in the doc.
 *   - 'unknown'   = placeholder; any code path that would consume an 'unknown'
 *                   constant MUST be guarded with an explicit TODO.
 *
 * See research doc §5–§8 for context.
 */
export const DEFAULT_CONSTANTS: GameConstants = {
  // ── §5.4 Growth ─────────────────────────────────────────────────────────────
  growthDivisor: {
    value: 200_000,
    source: 'research §5.4',
    confidence: 'community',
    note: 'Formula is community-documented from wiki mechanics page.',
  },

  // ── §6.1 Stat bases ─────────────────────────────────────────────────────────
  statBases: {
    hpBase: {
      value: 10,
      source: 'research §6.1',
      confidence: 'community',
    },
    hpPerDL: {
      value: 24,
      source: 'research §6.1',
      confidence: 'community',
    },
    adsBase: {
      value: 1,
      source: 'research §6.1',
      confidence: 'community',
    },
    adsPerDL: {
      value: 2.4,
      source: 'research §6.1',
      confidence: 'community',
    },
  },

  // ── §6.2 Damage pipeline ────────────────────────────────────────────────────
  damage: {
    defenseSoftCapK: {
      value: 200,
      source: 'research §6.2',
      confidence: 'community',
      note:
        'Soft-cap K=200 yields 50% mitigation at 200 Def and 80% at 800 Def; verified via the Cosmic Gnome example (99,999 Def ≈ 100% mitigation).',
    },
    backRowPenalty: {
      value: 0.8,
      source: 'research §6.2 Step 5',
      confidence: 'community',
    },
    frontRowSpeedBonus: {
      value: 0.2,
      source: 'research §6.2 (note below Step 4)',
      confidence: 'community',
    },
    hitChanceFloor: {
      value: 0.05,
      source: 'research §6.2',
      confidence: 'community',
    },
    speedDamageDivisor: {
      value: 2,
      source: 'research §6.2 Step 4',
      confidence: 'community',
    },
  },

  // ── §6.3 Speed thresholds ───────────────────────────────────────────────────
  speedThresholds: {
    threshold2ndAction: {
      value: 500,
      source: 'research §6.3',
      confidence: 'community',
      note: 'P(2nd action) = speed/5 % → 100% at speed 500 → divisor = 500.',
    },
    threshold3rdAction: {
      value: 1000,
      source: 'research §6.3',
      confidence: 'community',
      note:
        'P(3rd action) = (speed-500)/10 % → 100% at speed 1500 → range width = 1000.',
    },
    maxActionsPerRound: {
      value: 3,
      source: 'research §6.3',
      confidence: 'community',
    },
  },

  // ── §6.6 Combat resolution ──────────────────────────────────────────────────
  combat: {
    maxTurnsPerFight: {
      value: 50,
      source: 'research §6.6.2, itrtg.wiki.gg/wiki/Dungeons',
      confidence: 'community',
      note:
        'Fights are hard-capped at 50 turns; if the team has not wiped the enemies ' +
        'by then it loses automatically. Wiki-confirmed mechanic; exact tie-breaking ' +
        'at turn 50 (does damage on turn 50 count?) is assumed inclusive of turn 50.',
    },
  },

  // ── §6.6.4 Consumable items ──────────────────────────────────────────────────
  items: {
    phoenixFeatherHpRestore: {
      value: 0.2,
      source: 'research §6.6.4, itrtg.wiki.gg/wiki/Items/Materials',
      confidence: 'community',
      note:
        'Wiki: "Revives one party member and heals 20% HP. Is used at the beginning ' +
        'of a turn after a party member died."',
    },
  },

  // ── §5.5 Class modifiers ────────────────────────────────────────────────────
  classMods: {
    value: {
      Adventurer: { hp: 1.0, atk: 1.0, def: 1.0, spd: 1.0, ignoresBackRowPenalty: false },
      Mage:       { hp: 0.4, atk: 1.5, def: 0.4, spd: 1.2, ignoresBackRowPenalty: true  },
      Assassin:   { hp: 0.7, atk: 1.3, def: 0.7, spd: 1.4, ignoresBackRowPenalty: false },
      Rogue:      { hp: 0.8, atk: 1.2, def: 0.6, spd: 1.6, ignoresBackRowPenalty: false },
      Defender:   { hp: 1.2, atk: 0.4, def: 1.2, spd: 0.4, ignoresBackRowPenalty: false },
      Supporter:  { hp: 0.8, atk: 0.7, def: 1.0, spd: 1.3, ignoresBackRowPenalty: false },
      Blacksmith: { hp: 1.2, atk: 1.1, def: 1.2, spd: 0.4, ignoresBackRowPenalty: false },
      Alchemist:  { hp: 0.8, atk: 1.0, def: 0.8, spd: 1.1, ignoresBackRowPenalty: false },
    },
    source: 'research §5.5',
    confidence: 'community',
    note:
      'Defender Defense modifier is listed as 120% in the table (research §5.5). A separate community ' +
      'source cites 150% — this conflicts with the table. Using 1.2 (table value) as the primary; ' +
      'flag for in-game verification. See also: defenderHpScale for CL>25 HP bonus.',
  },

  // ── §6.2b Defender HP scaling ───────────────────────────────────────────────
  defenderHpScale: {
    breakpointCL: {
      value: 25,
      source: 'research §6.2b',
      confidence: 'community',
    },
    perCLAbove: {
      value: 0.01,
      source: 'research §6.2b',
      confidence: 'community',
      note: 'ClassMod_HP = 1.20 + max(0, (CL-25)/100). At CL 55 → 1.50.',
    },
  },

  // ── §6.2a Strategy Room ─────────────────────────────────────────────────────
  strategyRoom: {
    base: {
      value: 0.1,
      source: 'research §6.2a',
      confidence: 'community',
    },
    growthDivisor: {
      value: 5_000,
      source: 'research §6.2a',
      confidence: 'community',
    },
    booksDivisor: {
      value: 0.48,
      source: 'research §6.2a',
      confidence: 'community',
      note:
        'The research doc writes "Books / 0.4800" — treating 0.48 as the literal divisor ' +
        '(i.e. multiply the term by 1/0.48 ≈ 2.083). Verify in-game if Books bonus looks too large.',
    },
  },

  // ── §7.1 Boss multipliers ───────────────────────────────────────────────────
  bosses: {
    depthMultipliers: {
      value: { 1: 2, 2: 12, 3: 70 },
      source: 'research §7.1',
      confidence: 'community',
      note: 'Depth 4 boss multiplier not listed in the research doc; omitted until confirmed.',
    },
    perDiffAdditive: {
      value: 0.1,
      source: 'research §7.1',
      confidence: 'community',
      note:
        'Each +1 difficulty adds 10% additive to the base multiplier. ' +
        'E.g. D1 Diff 5 = 2 × (1 + 0.10×5) = 3×.',
    },
  },

  // ── §7.4 Infinity Tower ─────────────────────────────────────────────────────
  tower: {
    floorIncrement: {
      value: { hp: 0.4, atk: 0.5 },
      source: 'research §7.4',
      confidence: 'community',
      note:
        'HP/Def/Spd scale at +40%/floor; Atk at +50%/floor (floors 0–49). ' +
        'Increment doubles every 50 floors. Defense and Speed share the HP increment (0.40).',
    },
    doublingEveryFloors: {
      value: 50,
      source: 'research §7.4',
      confidence: 'community',
    },
    xpCapFloor: {
      value: 200,
      source: 'research §7.4',
      confidence: 'community',
    },
  },

  // ── §6.3a Timing ────────────────────────────────────────────────────────────
  timing: {
    minutesPerRoom: {
      value: 15,
      source: 'research §3, §6.3a',
      confidence: 'confirmed',
    },
    nrdcReductionPerCompletion: {
      value: 0.01,
      source: 'research §6.3a',
      confidence: 'community',
      note: 'With 20 NRDCs: 15 × (1 - 0.01×20) = 12 min/room.',
    },
    wipeRestMinutes: {
      value: 60,
      source: 'research §11.2',
      confidence: 'estimated',
      note:
        'Player-reported ~1 hour rest after a team wipe before the run restarts. ' +
        'Not wiki-confirmed (web was unreachable during research); treat as tunable. ' +
        'Applied as added elapsed time on a non-cleared run.',
    },
  },

  // ── §6.4 XP curves ──────────────────────────────────────────────────────────
  xp: {
    dlXpCurve: {
      value: { base: 10, exponentLow: 2, exponentHigh: 2.25, threshold: 10 },
      source: 'research §6.4',
      confidence: 'community',
      note:
        'DL n < 10: 10×(n-1)²; DL n ≥ 10: 10×(n-1)^2.25. ' +
        'XP is per-enemy-killed (xpIsPerEnemyKilled), so total room XP depends on enemy count.',
    },
    clXpCurve: {
      value: { firstLevelCost: 3_000, base: 1_000, perLevelBase: 2_000, exponent: 2 },
      source: 'research §6.4',
      confidence: 'community',
      note: 'CL1→2 = 3000; else 1000 + 2000×(n-1)². CL exponent is 2 (quadratic).',
    },
    xpIsPerEnemyKilled: {
      value: true,
      source: 'research §6.4 (XP-NOTE), itrtg.wiki.gg/wiki/Dungeons',
      confidence: 'community',
      note:
        'DL XP accrues per-enemy-killed rather than as a flat per-room value. ' +
        'The exact number of enemies per room is partially random (see RoomEnemyTable). ' +
        'Confidence "community": wiki references this mechanic but exact counts are undocumented.',
    },
  },

  // ── §8 Rewards ───────────────────────────────────────────────────────────────
  rewards: {
    luckyDrawDlDivisor: {
      value: 1_000,
      source: 'research §8.5 (patch 4.26)',
      confidence: 'community',
      note: 'Material multiplier = 1 + (top-50 total DL / 1000).',
    },
    overtimeMaxBonus: {
      value: 0.85,
      source: 'research §8.2 (patch 4.26)',
      confidence: 'community',
      note: 'Up to +85% bonus (185% total) at 2× completion time.',
    },
    d4Event2GrowthBase: {
      value: 15,
      source: 'research §7.3',
      confidence: 'community',
      note: 'Depth-4 Event 2 grants (15 + 1.5 × difficulty) growth per pet.',
    },
    d4Event2GrowthPerDiff: {
      value: 1.5,
      source: 'research §7.3',
      confidence: 'community',
    },
  },
};
