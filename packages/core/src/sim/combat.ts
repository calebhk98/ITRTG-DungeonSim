/**
 * WP-F: Combat round resolver.
 *
 * `resolveRound` applies ITRTG's damage pipeline (research §6.2) for all
 * living combatants, mutates `currentHp` on the working copies, and returns
 * a `RoundOutcome` summarising damage dealt and deaths.
 *
 * ── Damage pipeline (§6.2) ──────────────────────────────────────────────────
 *
 *   Step 1  BaseDmg       = attacker.stats.atk − defender.stats.def / 2
 *   Step 2  ElementalFactor
 *           • A  = attacker's element level in the chosen element
 *           • D  = defender's element level in that same element
 *           • If D < 0: A += |D|, D = 0
 *           • Neutral attacker: pick element that maximises (A − D)
 *           • Factor = (1 + A/100) / (1 + D/100)
 *   Step 3  DefenseFactor = 1 − D_def / (D_def + K)   where K = defenseSoftCapK (200)
 *   Step 4  SpeedDamage   = max(0, (attackerSpd − defenderSpd) / divisor)
 *           Front-row attacker speed gets +frontRowSpeedBonus before this step.
 *           SpeedDamage bypasses defense (added after DefenseFactor).
 *   Step 5  BackRowMod    = backRowPenalty (0.80) unless class ignoresBackRowPenalty
 *
 *   PerHit  = max(0, (BaseDmg × ElementalFactor × DefenseFactor + SpeedDamage) × backRowMod)
 *   Minimum of 1 when BaseDmg > 0.
 *
 *   Hit chance = min(1, max(hitChanceFloor, attackerSpd / (defenderSpd × 1.2)))
 *   In EV mode:  effectiveDamage = perHit × hitChance × actions
 *   In MC mode:  loop `actions` times; each hit is gated by strategy.roll(hitChance)
 *
 * ── Targeting ───────────────────────────────────────────────────────────────
 *   Each attacker prefers front-row defenders first (lower index among those
 *   alive). If all front-row defenders are dead, it attacks back-row defenders
 *   in index order. This mirrors the game's stated rule ("front row is attacked
 *   more"). Enemies use the same targeting rule against allies.
 *
 * ── Ability registry ────────────────────────────────────────────────────────
 *   Ability modifiers are registered in ABILITY_REGISTRY (bottom of file).
 *   Each entry is { flag, apply } where `apply` is called once per hit event.
 *   Adding a new ability = adding one registry entry, not editing the core loop.
 *
 * Research §5.6, §6.2, §6.3.
 */

import { resolve } from '../constants/types.js';
import type { GameConstants } from '../constants/types.js';
import type { CombatContext } from '../domain/combat.js';
import type { AbilityFlag } from '../domain/pet.js';
import type { CombatStrategy } from './strategy.js';
import type { Rng } from './rng.js';
import type { ElementLevels } from '../domain/gear.js';
import type { Element } from '../domain/element.js';

// ── RoundOutcome ──────────────────────────────────────────────────────────────

/**
 * The result of one combat round.
 *
 * Combatant keys are `petId` for ally pets and `enemyId` for enemy combatants
 * (whichever is defined on the `CombatContext`). Callers must ensure every
 * context has at least one of `petId` or `enemyId` defined.
 */
export interface RoundOutcome {
  /**
   * Total damage each attacker dealt this round, keyed by combatant key
   * (petId ?? enemyId).
   */
  readonly damageByAttacker: ReadonlyMap<string, number>;

  /**
   * Combatant keys of those whose `currentHp` dropped to ≤ 0 this round.
   * Ordered by time of death (first killed = first in array).
   */
  readonly deaths: ReadonlyArray<string>;

  /**
   * HP snapshot for each ally after the round, keyed by combatant key.
   * Includes the mutations applied to `currentHp` during the round.
   */
  readonly allyHpAfter: ReadonlyMap<string, number>;

  /**
   * HP snapshot for each enemy after the round, keyed by combatant key.
   */
  readonly enemyHpAfter: ReadonlyMap<string, number>;
}

// ── Internal helpers ──────────────────────────────────────────────────────────

/** Get the canonical string key for a combatant. */
function combatantKey(ctx: CombatContext): string {
  const key = ctx.petId ?? ctx.enemyId;
  if (key === undefined) {
    throw new Error('CombatContext must have petId or enemyId defined');
  }
  return key;
}

/**
 * Pick the element and levels to use for an attack.
 *
 * For Neutral attackers: choose the element from Fire/Water/Wind/Earth that
 * maximises (A − D_elem) — gives the best net elemental advantage.
 * For non-Neutral attackers: use their own element directly.
 *
 * Research §6.2 Step 2.
 */
function pickElementalLevels(
  attackerElement: Element,
  attackerLevels: ElementLevels,
  defenderLevels: ElementLevels,
): { A: number; D: number } {
  if (attackerElement !== 'Neutral') {
    // Non-neutral: use own element
    const A = attackerLevels[attackerElement as keyof ElementLevels];
    const D = defenderLevels[attackerElement as keyof ElementLevels];
    return { A, D };
  }

  // Neutral: pick element maximising (A − D_elem)
  const elements: ReadonlyArray<keyof ElementLevels> = ['Fire', 'Water', 'Wind', 'Earth'];
  let bestA = attackerLevels.Fire;
  let bestD = defenderLevels.Fire;
  let bestDiff = bestA - bestD;

  for (let i = 1; i < elements.length; i++) {
    const el = elements[i]!;
    const a = attackerLevels[el];
    const d = defenderLevels[el];
    const diff = a - d;
    if (diff > bestDiff) {
      bestDiff = diff;
      bestA = a;
      bestD = d;
    }
  }

  return { A: bestA, D: bestD };
}

/**
 * Compute the elemental factor.
 *
 * Research §6.2 Step 2:
 *   If D < 0: A += |D|, D = 0
 *   Factor = (1 + A/100) / (1 + D/100)
 */
function elementalFactor(rawA: number, rawD: number): number {
  let A = rawA;
  let D = rawD;
  if (D < 0) {
    A += Math.abs(D);
    D = 0;
  }
  return (1 + A / 100) / (1 + D / 100);
}

/**
 * Pick the primary target for one attacker from a candidate list.
 *
 * Targeting rule: prefer front-row defenders first (in encounter order within
 * that row); fall back to back-row defenders in encounter order.
 * Returns undefined if no living target exists.
 *
 * Research §3 / §10: "front row is attacked more; back row deals reduced damage".
 */
function pickTarget(
  candidates: ReadonlyArray<CombatContext>,
): CombatContext | undefined {
  // Front row first
  const frontRow = candidates.filter(c => c.row === 'front' && c.currentHp > 0);
  if (frontRow.length > 0) return frontRow[0];

  // Fall back to back row
  const backRow = candidates.filter(c => c.row === 'back' && c.currentHp > 0);
  return backRow[0];
}

// ── Ability registry ──────────────────────────────────────────────────────────

/**
 * Context passed to each ability modifier hook.
 *
 * Hooks are called once per hit event (after base damage is computed but
 * before it is applied). They may mutate `ctx` to adjust `rawDamage` or
 * apply side-effects (e.g., healing the attacker).
 */
export interface AbilityHookContext {
  /** The attacker executing the hit. */
  attacker: CombatContext;
  /** The defender receiving the hit. */
  defender: CombatContext;
  /** The computed raw damage for this hit (before the hook). The hook may reduce this. */
  rawDamage: number;
  /** Strategy used (for rolls). */
  strategy: CombatStrategy;
  /** RNG (for MC abilities that need integer draws, etc.). */
  rng: Rng;
  /** All allies in the current round. */
  allies: ReadonlyArray<CombatContext>;
  /** All enemies in the current round. */
  enemies: ReadonlyArray<CombatContext>;
}

/**
 * An ability modifier: a flag + apply hook pair.
 *
 * The hook runs once per hit event and returns any extra damage to be
 * **added** to rawDamage (for Lucky Coin bursts, etc.); OR may modify
 * `ctx.rawDamage` directly and return 0. Returning a negative value is
 * allowed to reduce damage (though clamping to ≥0 happens in the core loop).
 *
 * To add a new ability:
 *   1. Add its `AbilityFlag` string to `domain/pet.ts` (or use the open-union fallthrough).
 *   2. Push a new `AbilityModifier` entry into `ABILITY_REGISTRY` below.
 *   No other file needs to change.
 */
export interface AbilityModifier {
  /** The flag that activates this modifier (checked on attacker or defender as noted). */
  readonly flag: AbilityFlag;
  /**
   * Called once per hit event.
   * @param ctx - Mutable hook context; modify ctx.rawDamage to adjust damage.
   * @returns Extra damage to add on top of ctx.rawDamage (0 if none).
   */
  apply(ctx: AbilityHookContext): number;
}

/**
 * The ordered registry of ability modifiers.
 *
 * Checked in order for each hit. Multiple entries for the same flag are all
 * applied. Attacker abilities fire in this list's order; the same registry
 * serves both attacker-side and defender-side abilities (see each entry's
 * documentation for which side it applies to).
 */
const ABILITY_REGISTRY: ReadonlyArray<AbilityModifier> = [
  // ── supporterDmgReduction ────────────────────────────────────────────────────
  // Research §5.6: "Supporter (CL 50): ~50% team-wide damage reduction".
  // Applied when any DEFENDER-SIDE ally has this flag.
  // The hook reduces rawDamage by 50%, capped at 50% reduction.
  // We check the defender's team (allies of the defender) — in practice,
  // the core loop invokes this hook when the attacker's target is an ally
  // that has a Supporter teammate. We implement it as a defender-side check:
  // if ANY member of the defending group (allies or enemies) with this flag
  // is alive, incoming damage is halved (cap 50%).
  {
    flag: 'supporterDmgReduction',
    apply(ctx: AbilityHookContext): number {
      // The hook is invoked once per hit. To apply team-wide reduction,
      // the core loop must pass it when ANY defending-side combatant carries the flag.
      // This entry modifies rawDamage in-place and returns 0.
      const MAX_REDUCTION = 0.5; // 50% cap (research §5.6 / §9)
      ctx.rawDamage *= 1 - MAX_REDUCTION;
      return 0;
    },
  },

  // ── succubusHeal ─────────────────────────────────────────────────────────────
  // Research §5.6: "Succubus: self-heals up to 1/3 max HP per single-target attack (CL 100)".
  // Applied when the ATTACKER has this flag.
  // Heals the attacker by min(rawDamage, stats.hp / 3).
  {
    flag: 'succubusHeal',
    apply(ctx: AbilityHookContext): number {
      const healAmt = Math.min(ctx.rawDamage, ctx.attacker.stats.hp / 3);
      ctx.attacker.currentHp = Math.min(
        ctx.attacker.stats.hp,
        ctx.attacker.currentHp + healAmt,
      );
      return 0;
    },
  },

  // ── luckyCoin ────────────────────────────────────────────────────────────────
  // Research §5.6: "Lucky Coin: each attack deals 7 / 77 / 777 / 7777 random damage".
  // Applied when the ATTACKER has this flag.
  // Uses strategy.roll to gate each tier (EV mode returns expected value of the distribution).
  {
    flag: 'luckyCoin',
    apply(ctx: AbilityHookContext): number {
      // Probability tiers: the game picks one outcome per hit.
      // Approximate distribution (community-estimated, no exact table published):
      //   7    → ~70% of the time  (p ≈ 0.70)
      //   77   → ~20%              (p ≈ 0.20)
      //   777  → ~9%               (p ≈ 0.09)
      //   7777 → ~1%               (p ≈ 0.01)
      // In EV mode: expected extra = 7×0.70 + 77×0.20 + 777×0.09 + 7777×0.01
      //           = 4.9 + 15.4 + 69.93 + 77.77 = 168.0 (approx)
      // In MC mode: draw a random value to pick the tier.
      //
      // Implementation: roll nested Bernoulli checks using strategy.roll.
      const roll = (p: number): boolean | number => ctx.strategy.roll(p);

      // Use a cascading check: first decide if we roll 777 or higher (10%).
      const highRoll = roll(0.10); // probability of 777+
      if (highRoll) {
        // Among high rolls, 1/10 chance → 7777
        const ultraRoll = roll(0.10);
        if (ultraRoll) {
          return 7777;
        }
        return 777;
      }
      // Among normal rolls, ~22% chance → 77, else 7
      const midRoll = roll(0.22);
      if (midRoll) {
        return 77;
      }
      return 7;
    },
  },
];

/** Pre-built lookup: flag → list of modifier entries (for O(1) check per hit). */
const ABILITY_REGISTRY_BY_FLAG: ReadonlyMap<string, ReadonlyArray<AbilityModifier>> = (() => {
  const map = new Map<string, AbilityModifier[]>();
  for (const mod of ABILITY_REGISTRY) {
    const existing = map.get(mod.flag);
    if (existing !== undefined) {
      existing.push(mod);
    } else {
      map.set(mod.flag, [mod]);
    }
  }
  return map;
})();

// ── Core combat resolver ──────────────────────────────────────────────────────

/**
 * Compute the effective attacker Speed, applying the front-row bonus (§6.2).
 *
 * Research §6.2: "Front-row pets get +20% Speed (feeds SpeedDamage)."
 * The bonus is on the raw speed stat BEFORE SpeedDamage is computed.
 */
function effectiveAttackerSpeed(attacker: CombatContext, constants: GameConstants): number {
  const frontBonus = resolve(constants.damage.frontRowSpeedBonus); // 0.20
  return attacker.row === 'front'
    ? attacker.stats.spd * (1 + frontBonus)
    : attacker.stats.spd;
}

/**
 * Fisher–Yates shuffle in place, driven by the injected RNG.
 *
 * Used to randomize the within-turn action order (research §6.6.1). In MC mode
 * this produces a fresh random order each turn; in EV mode `ExpectedValueRng`
 * makes it deterministic — but EV resolution sorts by speed instead (see
 * `resolveRound`), so this is only exercised in MC mode.
 */
function shuffleInPlace<T>(arr: T[], rng: Rng): void {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = rng.int(i + 1);
    const tmp = arr[i]!;
    arr[i] = arr[j]!;
    arr[j] = tmp;
  }
}

/** One combatant tagged with the side it fights for (for interleaved ordering). */
interface OrderedCombatant {
  readonly ctx: CombatContext;
  readonly isAlly: boolean;
}

/**
 * Resolve one TURN of combat (research §6.6.1).
 *
 * ── Execution order ──────────────────────────────────────────────────────────
 *
 *   All living combatants — allies AND enemies — act in a single interleaved
 *   order, not allies-then-enemies. This matches the game's randomized per-turn
 *   action order ("faster pets/enemies are more likely to act first"):
 *     - MC mode: the combined list is shuffled with the seeded RNG each turn.
 *     - EV mode: the list is sorted by effective speed (descending) as a
 *       deterministic proxy for "faster acts first" (no variance in EV).
 *
 *   For each combatant in that order (skipping any already dead this turn):
 *     1. Pick a target from the opposing living side (front-row first).
 *     2. Compute the damage pipeline (Steps 1–5, §6.2).
 *     3. Apply attacker abilities (luckyCoin, succubusHeal) and defender-side
 *        supporterDmgReduction.
 *     4. Apply damage to target.currentHp; record death if ≤ 0. A combatant that
 *        dies mid-turn no longer acts and can no longer be targeted.
 *
 * Modifies: `currentHp` on all passed `CombatContext` objects (they are
 * intended to be mutable working copies for the duration of the room fight).
 *
 * @param allies   - Ally combatants (pets). `currentHp` is mutated.
 * @param enemies  - Enemy combatants. `currentHp` is mutated.
 * @param constants - Game constants (DEFAULT_CONSTANTS in production).
 * @param strategy  - EV or MC strategy; drives `actionsForSpeed` and `roll`.
 * @param rng       - RNG used for action order (MC) and ability hooks.
 * @returns A `RoundOutcome` with damage totals, deaths, and HP snapshots.
 */
export function resolveRound(
  allies: CombatContext[],
  enemies: CombatContext[],
  constants: GameConstants,
  strategy: CombatStrategy,
  rng: Rng,
): RoundOutcome {
  const damageByAttacker = new Map<string, number>();
  // Track deaths in insertion-order (Set for dedup, array for ordering).
  const deathSet = new Set<string>();
  const deathOrder: string[] = [];

  /**
   * Record a death (once per combatant per round).
   */
  function recordDeath(key: string): void {
    if (!deathSet.has(key)) {
      deathSet.add(key);
      deathOrder.push(key);
    }
  }

  // Detect EV vs MC once per turn (not per attacker), since the probe consumes
  // an RNG draw in MC mode. EV: roll returns a number; MC: roll returns boolean.
  const isEvMode = typeof strategy.roll(0.5) === 'number';

  // Pre-compute which side has a living Supporter (team-wide damage reduction).
  const alliesHaveSupporter = allies.some(
    a => a.currentHp > 0 && a.abilities.includes('supporterDmgReduction'),
  );
  const enemiesHaveSupporter = enemies.some(
    e => e.currentHp > 0 && e.abilities.includes('supporterDmgReduction'),
  );

  /**
   * Execute one attacker's full turn against the opposing side.
   */
  function executeAttack(
    attacker: CombatContext,
    ownSide: ReadonlyArray<CombatContext>,
    defenders: ReadonlyArray<CombatContext>,
    defenderSideHasSupporter: boolean,
  ): void {
    const target = pickTarget(defenders);
    if (target === undefined) return; // all defenders dead — nothing to do

    const attackerKey = combatantKey(attacker);
    const targetKey = combatantKey(target);

    // ── Speed → actions ──────────────────────────────────────────────────
    const actions = strategy.actionsForSpeed(attacker.stats.spd, constants);

    // ── Effective attacker speed (front-row bonus, §6.2) ─────────────────
    const effAtkSpd = effectiveAttackerSpeed(attacker, constants);

    // ── Hit chance (§6.2) ────────────────────────────────────────────────
    //   hit% = min(1, max(hitChanceFloor, effAtkSpd / (defenderSpd × 1.2)))
    const hitFloor = resolve(constants.damage.hitChanceFloor); // 0.05
    const hitChance = Math.min(1, Math.max(hitFloor, effAtkSpd / (target.stats.spd * 1.2)));

    // ── Elemental levels (§6.2 Step 2) ──────────────────────────────────
    const { A: rawA, D: rawD } = pickElementalLevels(
      attacker.element,
      attacker.elementLevels,
      target.elementLevels,
    );
    const elemFactor = elementalFactor(rawA, rawD);

    // ── Defense factor (§6.2 Step 3) ─────────────────────────────────────
    const K = resolve(constants.damage.defenseSoftCapK); // 200
    const defFactor = 1 - target.stats.def / (target.stats.def + K);

    // ── Speed damage (§6.2 Step 4) ────────────────────────────────────────
    const divisor = resolve(constants.damage.speedDamageDivisor); // 2
    const speedDmg = Math.max(0, (effAtkSpd - target.stats.spd) / divisor);

    // ── Back-row modifier (§6.2 Step 5) ──────────────────────────────────
    const backPenalty = resolve(constants.damage.backRowPenalty); // 0.80
    const classMods = resolve(constants.classMods);
    const ignoresBackRow =
      attacker.assignedClass !== null &&
      (classMods[attacker.assignedClass]?.ignoresBackRowPenalty ?? false);
    const backRowMod = attacker.row === 'back' && !ignoresBackRow ? backPenalty : 1.0;

    // ── Base damage (§6.2 Step 1) ─────────────────────────────────────────
    const baseDmg = attacker.stats.atk - target.stats.def / 2;

    // ── Per-hit damage ────────────────────────────────────────────────────
    //   (BaseDmg × ElementalFactor × DefenseFactor + SpeedDmg) × backRowMod
    //   Minimum: 1 when BaseDmg > 0; otherwise 0 (can't deal negative).
    const rawPerHit =
      (Math.max(0, baseDmg) * elemFactor * defFactor + speedDmg) * backRowMod;
    const clampedPerHit = baseDmg > 0 ? Math.max(1, rawPerHit) : Math.max(0, rawPerHit);

    // ── Accumulate damage ─────────────────────────────────────────────────
    // Strategy splits here:
    //   EV mode: actions is fractional; damage is multiplied by expected hits
    //            = actions × hitChance (also fractional, from strategy.roll).
    //   MC mode: actions is integer; loop and gate each hit individually.

    let totalDmgThisAttacker = 0;

    // Helper to apply one hit (processes ability hooks, damage reduction, etc.)
    const applyHit = (hitDmg: number): void => {
      let hookContext: AbilityHookContext = {
        attacker,
        defender: target,
        rawDamage: hitDmg,
        strategy,
        rng,
        allies: ownSide,
        enemies: defenders,
      };

      // Attacker-side abilities: iterate attacker's flags.
      for (const flag of attacker.abilities) {
        const mods = ABILITY_REGISTRY_BY_FLAG.get(flag);
        if (mods !== undefined) {
          // Only apply when it's an attacker-side ability (not supporterDmgReduction)
          if (flag !== 'supporterDmgReduction') {
            for (const mod of mods) {
              const extra = mod.apply(hookContext);
              hookContext = { ...hookContext, rawDamage: hookContext.rawDamage + extra };
            }
          }
        }
      }

      // Defender-side: supporterDmgReduction from any alive team member.
      if (defenderSideHasSupporter) {
        const mods = ABILITY_REGISTRY_BY_FLAG.get('supporterDmgReduction');
        if (mods !== undefined) {
          for (const mod of mods) {
            const extra = mod.apply(hookContext);
            hookContext = { ...hookContext, rawDamage: hookContext.rawDamage + extra };
          }
        }
      }

      const finalDmg = Math.max(0, hookContext.rawDamage);
      totalDmgThisAttacker += finalDmg;
      target.currentHp -= finalDmg;
      if (target.currentHp <= 0) {
        recordDeath(targetKey);
      }
    };

    if (isEvMode) {
      // EV mode: one composite hit weighted by hitChance × actions.
      // effectiveDamage = clampedPerHit × hitChance × actions
      applyHit(clampedPerHit * hitChance * actions);
    } else {
      // MC mode: integer loop over actions, each gated by an independent roll.
      const intActions = Math.round(actions);
      for (let i = 0; i < intActions; i++) {
        if (target.currentHp <= 0) break; // target already dead
        if (strategy.roll(hitChance)) {
          applyHit(clampedPerHit);
        }
      }
    }

    // Record total damage by this attacker
    damageByAttacker.set(
      attackerKey,
      (damageByAttacker.get(attackerKey) ?? 0) + totalDmgThisAttacker,
    );
  }

  // ── Build the interleaved action order for this turn (§6.6.1) ────────────────
  const order: OrderedCombatant[] = [];
  for (const a of allies) order.push({ ctx: a, isAlly: true });
  for (const e of enemies) order.push({ ctx: e, isAlly: false });

  if (isEvMode) {
    // Deterministic proxy for "faster acts first": sort by effective speed desc.
    // Stable enough for golden tests; ties keep insertion order (allies first).
    order.sort(
      (x, y) =>
        effectiveAttackerSpeed(y.ctx, constants) - effectiveAttackerSpeed(x.ctx, constants),
    );
  } else {
    shuffleInPlace(order, rng);
  }

  // EV mode approximates the expectation over random action orders as a
  // SIMULTANEOUS turn: every combatant alive at the START of the turn acts, with
  // no first-strike bias (a combatant that drops mid-turn still got its swing).
  // MC mode resolves SEQUENTIALLY in the shuffled order, so a combatant killed
  // earlier this turn (by a faster one) does not get to act — honouring §6.6.1.
  const aliveAtStart = isEvMode
    ? new Set(order.filter(o => o.ctx.currentHp > 0).map(o => o.ctx))
    : null;

  for (const { ctx, isAlly } of order) {
    const canAct = aliveAtStart !== null ? aliveAtStart.has(ctx) : ctx.currentHp > 0;
    if (!canAct) continue;
    const defenders = isAlly ? enemies : allies;
    const ownSide = isAlly ? allies : enemies;
    const defenderSideHasSupporter = isAlly ? enemiesHaveSupporter : alliesHaveSupporter;
    executeAttack(ctx, ownSide, defenders, defenderSideHasSupporter);
  }

  // ── Build HP snapshots ──────────────────────────────────────────────────────
  const allyHpAfter = new Map<string, number>();
  for (const a of allies) {
    allyHpAfter.set(combatantKey(a), a.currentHp);
  }
  const enemyHpAfter = new Map<string, number>();
  for (const e of enemies) {
    enemyHpAfter.set(combatantKey(e), e.currentHp);
  }

  return {
    damageByAttacker,
    deaths: deathOrder,
    allyHpAfter,
    enemyHpAfter,
  };
}
