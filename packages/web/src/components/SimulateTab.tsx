import React, { useState } from 'react';
import type {
  Pet,
  PetId,
  RunConfig,
  RunResult,
  Depth,
  Difficulty,
  DungeonId,
  EvaluationMode,
} from '@itrtg-sim/core';
import {
  DUNGEON_REGISTRY,
  getDungeon,
  simulateRun,
  DEFAULT_CONSTANTS,
} from '@itrtg-sim/core';

type RowType = 'front' | 'back';

interface SlotConfig {
  petId: PetId;
  row: RowType;
  assignedClass: string | null;
}

interface SimulateTabProps {
  roster: ReadonlyMap<PetId, Pet>;
}

const DUNGEON_IDS = Array.from(DUNGEON_REGISTRY.keys()) as DungeonId[];

export default function SimulateTab({ roster }: SimulateTabProps): React.ReactElement {
  const [dungeonId, setDungeonId] = useState<DungeonId>(DUNGEON_IDS[0] ?? 'Scrapyard');
  const [depth, setDepth] = useState<Depth>(1);
  const [difficulty, setDifficulty] = useState<Difficulty>(0);
  const [rooms, setRooms] = useState(16);
  const [mode, setMode] = useState<EvaluationMode>('expected');
  const [seed, setSeed] = useState(12345);
  const [slots, setSlots] = useState<SlotConfig[]>([]);
  const [result, setResult] = useState<RunResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);

  const rosterPets = Array.from(roster.values());

  // Auto-select first 6 pets if no slots configured
  function getEffectiveSlots(): SlotConfig[] {
    if (slots.length > 0) return slots;
    return rosterPets.slice(0, 6).map((pet, i) => ({
      petId: pet.id,
      row: (i < 3 ? 'front' : 'back') as RowType,
      assignedClass: pet.evolvedClass,
    }));
  }

  function addSlot(petId: PetId) {
    const effective = getEffectiveSlots();
    if (effective.some(s => s.petId === petId)) return;
    if (effective.length >= 6) return;
    const frontCount = effective.filter(s => s.row === 'front').length;
    const newRow: RowType = frontCount < 3 ? 'front' : 'back';
    const pet = roster.get(petId);
    setSlots([...effective, { petId, row: newRow, assignedClass: pet?.evolvedClass ?? null }]);
  }

  function removeSlot(petId: PetId) {
    const effective = getEffectiveSlots();
    setSlots(effective.filter(s => s.petId !== petId));
  }

  function toggleRow(petId: PetId) {
    const effective = getEffectiveSlots();
    setSlots(effective.map(s => {
      if (s.petId !== petId) return s;
      const otherRow = s.row === 'front' ? 'back' : 'front';
      const otherCount = effective.filter(x => x.row === otherRow).length;
      if (otherCount >= 3) return s; // can't move
      return { ...s, row: otherRow };
    }));
  }

  function handleRun() {
    setError(null);
    setResult(null);

    if (roster.size === 0) {
      setError('No roster loaded. Please import pets first.');
      return;
    }

    const effectiveSlots = getEffectiveSlots();
    if (effectiveSlots.length === 0) {
      setError('No pets selected.');
      return;
    }

    setRunning(true);
    try {
      const dungeon = getDungeon(dungeonId);
      if (dungeon === undefined) {
        throw new Error(`Unknown dungeon: ${dungeonId}`);
      }

      const team = {
        slots: effectiveSlots.map(s => ({
          petId: s.petId,
          row: s.row,
          assignedClass: (s.assignedClass ?? null) as import('@itrtg-sim/core').PetClassName | null,
        })),
      };

      const config: RunConfig = {
        team,
        dungeonId,
        depth,
        difficulty,
        rooms,
        nrdcCompletions: 0,
        evaluationMode: mode,
        ...(mode === 'monteCarlo' ? { rngSeed: seed, monteCarloTrials: 50 } : {}),
      };

      const runResult = simulateRun(config, {
        dungeon,
        roster,
        constants: DEFAULT_CONSTANTS,
      });

      setResult(runResult);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRunning(false);
    }
  }

  const effectiveSlots = getEffectiveSlots();
  const usedIds = new Set(effectiveSlots.map(s => s.petId));

  return (
    <div>
      <div className="card">
        <h2>Simulation Config</h2>

        {roster.size === 0 && (
          <div className="warning">No roster loaded — go to the Import tab first.</div>
        )}

        <div className="grid-2" style={{ marginBottom: 12 }}>
          <div className="field">
            <label>Dungeon</label>
            <select value={dungeonId} onChange={e => setDungeonId(e.target.value as DungeonId)}>
              {DUNGEON_IDS.map(id => <option key={id} value={id}>{id}</option>)}
            </select>
          </div>
          <div className="field">
            <label>Mode</label>
            <select value={mode} onChange={e => setMode(e.target.value as EvaluationMode)}>
              <option value="expected">Expected Value</option>
              <option value="monteCarlo">Monte Carlo</option>
            </select>
          </div>
          <div className="field">
            <label>Depth (1–4)</label>
            <select value={depth} onChange={e => setDepth(Number(e.target.value) as Depth)}>
              {([1, 2, 3, 4] as Depth[]).map(d => <option key={d} value={d}>{d}</option>)}
            </select>
          </div>
          <div className="field">
            <label>Difficulty (0–10)</label>
            <select value={difficulty} onChange={e => setDifficulty(Number(e.target.value) as Difficulty)}>
              {([0,1,2,3,4,5,6,7,8,9,10] as Difficulty[]).map(d => <option key={d} value={d}>{d}</option>)}
            </select>
          </div>
          <div className="field">
            <label>Rooms</label>
            <input type="number" min={1} max={60} value={rooms} onChange={e => setRooms(Number(e.target.value))} style={{ width: 80 }} />
          </div>
          {mode === 'monteCarlo' && (
            <div className="field">
              <label>RNG Seed</label>
              <input type="number" value={seed} onChange={e => setSeed(Number(e.target.value))} style={{ width: 120 }} />
            </div>
          )}
        </div>

        <h3>Team ({effectiveSlots.length}/6)</h3>
        <table>
          <thead>
            <tr>
              <th>Pet</th>
              <th>Row</th>
              <th>Class</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {effectiveSlots.map(s => {
              const pet = roster.get(s.petId);
              return (
                <tr key={s.petId}>
                  <td>{pet?.displayName ?? s.petId}</td>
                  <td>
                    <button onClick={() => toggleRow(s.petId)} style={{ fontSize: 11 }}>
                      {s.row}
                    </button>
                  </td>
                  <td>{s.assignedClass ?? '—'}</td>
                  <td>
                    <button onClick={() => removeSlot(s.petId)} style={{ fontSize: 11 }}>Remove</button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        {effectiveSlots.length < 6 && rosterPets.length > 0 && (
          <div style={{ marginTop: 8 }}>
            <label>Add pet:</label>
            <select onChange={e => { if (e.target.value) addSlot(e.target.value as PetId); e.target.value = ''; }} defaultValue="">
              <option value="">— select —</option>
              {rosterPets.filter(p => !usedIds.has(p.id)).map(p => (
                <option key={p.id} value={p.id}>{p.displayName}</option>
              ))}
            </select>
          </div>
        )}

        <div style={{ marginTop: 12 }}>
          <button className="primary" onClick={handleRun} disabled={running || roster.size === 0}>
            {running ? 'Running…' : 'Run Simulation'}
          </button>
        </div>
      </div>

      {error !== null && <div className="error"><strong>Error:</strong> {error}</div>}

      {result !== null && (
        <div className="card">
          <h2>Result</h2>
          <div className="grid-2" style={{ marginBottom: 12 }}>
            <div><strong>Cleared:</strong> {result.cleared ? '✓ Yes' : '✗ No'}</div>
            <div><strong>Rooms Cleared:</strong> {result.roomsCleared}</div>
            <div><strong>Elapsed:</strong> {result.elapsedMinutes.toFixed(1)} min</div>
            <div><strong>Pet Deaths:</strong> {result.petDeaths.length === 0 ? 'None' : result.petDeaths.join(', ')}</div>
          </div>

          <h3>Rewards</h3>
          <table>
            <tbody>
              <tr><td>God Power</td><td>{result.rewards.godPower.toFixed(2)}</td></tr>
              <tr><td>Lucky Draws</td><td>{result.rewards.luckyDraws.toFixed(2)}</td></tr>
              <tr><td>Pet Stones</td><td>{result.rewards.petStones.toFixed(2)}</td></tr>
              <tr><td>Growth Awarded</td><td>{result.rewards.growthAwarded.toFixed(0)}</td></tr>
              <tr><td>XP Total</td><td>{result.rewards.xpTotal.toFixed(0)}</td></tr>
              <tr><td>Equipment Drops</td><td>{result.rewards.equipmentDrops}</td></tr>
              <tr><td>Key Materials</td><td>{result.rewards.keyMaterials}</td></tr>
              <tr><td>Runes</td><td>{result.rewards.runes}</td></tr>
            </tbody>
          </table>

          <h3 style={{ marginTop: 12 }}>Per-Pet Stats</h3>
          <table>
            <thead>
              <tr><th>Pet</th><th>Dealt</th><th>Taken</th><th>XP Gained</th></tr>
            </thead>
            <tbody>
              {Array.from(result.perPet.entries()).map(([petId, stats]) => {
                const pet = roster.get(petId);
                return (
                  <tr key={petId}>
                    <td>{pet?.displayName ?? petId}</td>
                    <td>{stats.dealt.toFixed(0)}</td>
                    <td>{stats.taken.toFixed(0)}</td>
                    <td>{stats.xpGained.toFixed(0)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          {result.distribution !== undefined && (
            <>
              <h3 style={{ marginTop: 12 }}>Monte Carlo Distribution</h3>
              <table>
                <tbody>
                  <tr><td>Clear Rate</td><td>{(result.distribution.clearRate * 100).toFixed(1)}%</td></tr>
                  <tr><td>Time P50</td><td>{result.distribution.timeP50.toFixed(1)} min</td></tr>
                  <tr><td>Time P95</td><td>{result.distribution.timeP95.toFixed(1)} min</td></tr>
                  <tr><td>Mean GP</td><td>{result.distribution.meanRewards.godPower.toFixed(2)}</td></tr>
                </tbody>
              </table>
            </>
          )}
        </div>
      )}
    </div>
  );
}
