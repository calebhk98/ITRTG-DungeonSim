/**
 * Tests for sim/strategies.ts — DeterministicExpectedStrategy and MonteCarloStrategy.
 *
 * Golden EV table (research §6.3):
 *   speed 0    → 1.0 (no chance of extra actions)
 *   speed 250  → 1.5 (50% chance of 2nd action)
 *   speed 500  → 2.0 (100% chance of 2nd action, 0% of 3rd)
 *   speed 1000 → 2.5 (100% 2nd, 50% 3rd)
 *   speed 1500 → 3.0 (100% 2nd, 100% 3rd — hard cap)
 *   speed 5000 → 3.0 (capped at maxActionsPerRound)
 *
 * EV formula: E[actions] = 1 + clamp(spd/500, 0, 1) + clamp((spd−500)/1000, 0, 1)
 */

import { describe, it, expect } from 'vitest';
import { DeterministicExpectedStrategy, MonteCarloStrategy } from './strategies.js';
import { mulberry32 } from './rng.js';
import { DEFAULT_CONSTANTS } from '../constants/gameConstants.js';

// ── EV golden table ───────────────────────────────────────────────────────────

describe('DeterministicExpectedStrategy.actionsForSpeed — golden EV table', () => {
  const ev = new DeterministicExpectedStrategy();
  const c = DEFAULT_CONSTANTS;

  const cases: Array<[number, number]> = [
    [0,    1.0],
    [250,  1.5],
    [500,  2.0],
    [1000, 2.5],
    [1500, 3.0],
    [5000, 3.0],
  ];

  for (const [speed, expected] of cases) {
    it(`speed ${speed} → ${expected}`, () => {
      expect(ev.actionsForSpeed(speed, c)).toBeCloseTo(expected, 10);
    });
  }
});

// ── EV roll returns probability ────────────────────────────────────────────────

describe('DeterministicExpectedStrategy.roll', () => {
  const ev = new DeterministicExpectedStrategy();

  it('returns probability directly for 0', () => expect(ev.roll(0)).toBe(0));
  it('returns probability directly for 1', () => expect(ev.roll(1)).toBe(1));
  it('returns probability directly for 0.5', () => expect(ev.roll(0.5)).toBe(0.5));
  it('returns probability directly for 0.05', () => expect(ev.roll(0.05)).toBe(0.05));
  it('never exceeds 1.0 for p=1', () => expect(ev.roll(1)).toBeLessThanOrEqual(1));
});

// ── MC actions converge to EV mean ────────────────────────────────────────────

describe('MonteCarloStrategy.actionsForSpeed — mean ≈ EV', () => {
  const c = DEFAULT_CONSTANTS;
  const SAMPLES = 50_000;
  const TOLERANCE = 0.05; // within 5% of EV

  function mcMean(speed: number): number {
    const rng = mulberry32(0xdeadbeef);
    const mc = new MonteCarloStrategy(rng);
    let total = 0;
    for (let i = 0; i < SAMPLES; i++) {
      total += mc.actionsForSpeed(speed, c);
    }
    return total / SAMPLES;
  }

  const cases: Array<[number, number]> = [
    [0,    1.0],
    [250,  1.5],
    [500,  2.0],
    [1000, 2.5],
    [1500, 3.0],
    [5000, 3.0],
  ];

  for (const [speed, expected] of cases) {
    it(`speed ${speed}: MC mean ≈ ${expected} (±${TOLERANCE})`, () => {
      const mean = mcMean(speed);
      expect(mean).toBeGreaterThanOrEqual(expected - TOLERANCE);
      expect(mean).toBeLessThanOrEqual(expected + TOLERANCE);
    });
  }
});

// ── MC is deterministic per fixed seed ────────────────────────────────────────

describe('MonteCarloStrategy — determinism', () => {
  const c = DEFAULT_CONSTANTS;
  const SPEED = 600; // should produce 2 or 3 actions with some variance

  it('same seed produces identical action sequence', () => {
    const run = (seed: number): number[] => {
      const rng = mulberry32(seed);
      const mc = new MonteCarloStrategy(rng);
      return Array.from({ length: 20 }, () => mc.actionsForSpeed(SPEED, c));
    };

    const seq1 = run(12345);
    const seq2 = run(12345);
    expect(seq1).toEqual(seq2);
  });

  it('different seeds produce (very likely) different sequences', () => {
    const run = (seed: number): number[] => {
      const rng = mulberry32(seed);
      const mc = new MonteCarloStrategy(rng);
      return Array.from({ length: 100 }, () => mc.actionsForSpeed(SPEED, c));
    };

    // With 100 samples and two different seeds, they should differ somewhere.
    expect(run(1)).not.toEqual(run(2));
  });
});

// ── MC roll returns boolean ───────────────────────────────────────────────────

describe('MonteCarloStrategy.roll', () => {
  it('returns true for p=1 always', () => {
    const rng = mulberry32(0);
    const mc = new MonteCarloStrategy(rng);
    for (let i = 0; i < 10; i++) {
      expect(mc.roll(1)).toBe(true);
    }
  });

  it('returns false for p=0 always', () => {
    const rng = mulberry32(0);
    const mc = new MonteCarloStrategy(rng);
    for (let i = 0; i < 10; i++) {
      expect(mc.roll(0)).toBe(false);
    }
  });

  it('MC roll is boolean', () => {
    const rng = mulberry32(42);
    const mc = new MonteCarloStrategy(rng);
    const result = mc.roll(0.5);
    expect(typeof result).toBe('boolean');
  });
});

// ── MC actions are integers 1–3 ────────────────────────────────────────────────

describe('MonteCarloStrategy — output range', () => {
  it('actionsForSpeed always returns 1, 2, or 3', () => {
    const rng = mulberry32(99999);
    const mc = new MonteCarloStrategy(rng);
    const c = DEFAULT_CONSTANTS;
    const speeds = [0, 100, 500, 750, 1000, 1499, 1500, 5000];
    for (const spd of speeds) {
      for (let i = 0; i < 200; i++) {
        const a = mc.actionsForSpeed(spd, c);
        expect(a).toBeGreaterThanOrEqual(1);
        expect(a).toBeLessThanOrEqual(3);
        expect(Number.isInteger(a)).toBe(true);
      }
    }
  });
});
