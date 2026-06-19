import React, { useState } from 'react';
import type {
  Pet,
  PetId,
  DungeonId,
  Difficulty,
  GearSlot,
  ElementLevels,
} from '@itrtg-sim/core';
import {
  parseDungeonTeams,
  resolveDungeonTeams,
  getDungeon,
  simulateRun,
  DEFAULT_CONSTANTS,
} from '@itrtg-sim/core';

// ── Action column parsing ─────────────────────────────────────────────────────

const ACTION_TO_DUNGEON: Record<string, DungeonId> = {
  NewbieGround:   'NewbieGround',
  Scrapyard:      'Scrapyard',
  'Water Temple': 'WaterTemple',
  Volcano:        'Volcano',
  Mountain:       'Mountain',
  Forest:         'Forest',
};
const PET_HEADER_PREFIX = 'Name;Element;Growth;Dungeon Level;';
const COL_ACTION = 19;
const COL_NAME   = 0;

function parseActionColumn(text: string): Map<string, string> {
  const result = new Map<string, string>();
  for (const line of text.split('\n')) {
    const trimmed = line.trimEnd();
    if (!trimmed || trimmed.startsWith(PET_HEADER_PREFIX)) continue;
    const cols = trimmed.split(';');
    const name   = cols[COL_NAME]?.trim()   ?? '';
    const action = cols[COL_ACTION]?.trim() ?? '';
    if (name && action) result.set(name, action);
  }
  return result;
}

// ── Types ─────────────────────────────────────────────────────────────────────

type SlotOverride = { bonus: number; enchantEl: string; enchantVal: number } | null;
type GearOverrides = Record<string, Partial<Record<GearSlot, SlotOverride>>>;

interface DiffResult {
  difficulty: Difficulty;
  cleared: boolean;
  roomsCleared: number;
  xpTotal: number;
}

interface TeamSweep {
  teamIndex: number;
  dungeonId: DungeonId;
  petNames: string[];
  petIds: PetId[];
  sweep: DiffResult[];
  highestClear: number;
}

const GEAR_SLOTS: GearSlot[] = ['weapon', 'armor', 'accessory', 'trinket'];
const ELEMENTS: (keyof ElementLevels)[] = ['Fire', 'Water', 'Wind', 'Earth'];

// ── Gear override helpers ─────────────────────────────────────────────────────

function applyOverrides(
  roster: ReadonlyMap<PetId, Pet>,
  overrides: GearOverrides,
): Map<PetId, Pet> {
  const result = new Map<PetId, Pet>(roster);
  for (const pet of roster.values()) {
    const petOvr = overrides[pet.displayName];
    if (petOvr === undefined) continue;
    const newEquipment = { ...pet.equipment };
    for (const [slot, ovr] of Object.entries(petOvr) as [GearSlot, SlotOverride][]) {
      if (ovr === null) {
        delete newEquipment[slot];
      } else {
        newEquipment[slot] = {
          id:   `override-${slot}`,
          name: `Override ${slot}`,
          slot,
          tier: 4 as const,
          statMultiplierBonus: ovr.bonus / 100,
          ...(ovr.enchantEl !== ''
            ? { elementEnchant: { [ovr.enchantEl]: ovr.enchantVal } as Partial<ElementLevels> }
            : {}),
        };
      }
    }
    result.set(pet.id, { ...pet, equipment: newEquipment });
  }
  return result;
}

// ── Sweep runner ──────────────────────────────────────────────────────────────

function runSweeps(
  activeTeams: { teamIndex: number; team: import('@itrtg-sim/core').Team; dungeonId: DungeonId; petNames: string[]; petIds: PetId[] }[],
  roster: ReadonlyMap<PetId, Pet>,
  depth: 1 | 2 | 3 | 4,
  rooms: number,
  nrdcCompletions: number,
  forceDerive: boolean,
): TeamSweep[] {
  return activeTeams.map(at => {
    const dungeon = getDungeon(at.dungeonId);
    if (dungeon === undefined) {
      return { ...at, sweep: [], highestClear: -1 };
    }
    const sweep: DiffResult[] = [];
    let highestClear = -1;
    for (let d = 0; d <= 10; d++) {
      const result = simulateRun(
        {
          team: at.team,
          dungeonId: at.dungeonId,
          depth,
          difficulty: d as Difficulty,
          rooms,
          nrdcCompletions,
          evaluationMode: 'expected',
        },
        { dungeon, roster, constants: DEFAULT_CONSTANTS, forceDerive },
      );
      if (result.cleared) highestClear = d;
      sweep.push({
        difficulty: d as Difficulty,
        cleared: result.cleared,
        roomsCleared: result.roomsCleared,
        xpTotal: result.rewards.xpTotal,
      });
    }
    return { teamIndex: at.teamIndex, dungeonId: at.dungeonId, petNames: at.petNames, petIds: at.petIds, sweep, highestClear };
  });
}

// ── Cell helpers ──────────────────────────────────────────────────────────────

function cellBg(cleared: boolean, overrideCleared?: boolean): string {
  if (overrideCleared === undefined) return cleared ? '#dcfce7' : '#fee2e2';
  if (cleared && !overrideCleared) return '#fca5a5'; // regression
  if (!cleared && overrideCleared) return '#bbf7d0'; // improvement
  return cleared ? '#dcfce7' : '#fee2e2';
}

function cellLabel(cleared: boolean, overrideCleared?: boolean): string {
  if (overrideCleared === undefined) return cleared ? '✓' : '✗';
  if (cleared && !overrideCleared) return '↓✗';
  if (!cleared && overrideCleared) return '↑✓';
  return cleared ? '✓' : '✗';
}

// ── Component ─────────────────────────────────────────────────────────────────

interface Props {
  roster: ReadonlyMap<PetId, Pet>;
}

export default function ActiveTeamsTab({ roster }: Props): React.ReactElement {
  const [petExportText, setPetExportText]     = useState('');
  const [dungeonTeamText, setDungeonTeamText] = useState('');
  const [depth, setDepth]       = useState<1 | 2 | 3 | 4>(4);
  const [rooms, setRooms]       = useState(60);
  const [nrdcCompletions, setNrdcCompletions] = useState(20);

  const [sweeps, setSweeps]         = useState<TeamSweep[] | null>(null);
  const [warnings, setWarnings]     = useState<string[]>([]);
  const [error, setError]           = useState<string | null>(null);
  const [running, setRunning]       = useState(false);

  // Gear what-if
  const [gearOpen, setGearOpen]           = useState(false);
  const [gearOverrides, setGearOverrides] = useState<GearOverrides>({});
  const [overrideSweeps, setOverrideSweeps] = useState<TeamSweep[] | null>(null);
  const [overrideRunning, setOverrideRunning] = useState(false);

  // Collect all active team info (shared by both sweep and gear-override)
  type ActiveTeamInfo = { teamIndex: number; team: import('@itrtg-sim/core').Team; dungeonId: DungeonId; petNames: string[]; petIds: PetId[] };
  const [activeTeams, setActiveTeams] = useState<ActiveTeamInfo[]>([]);

  function resolveTeams(): { teams: ActiveTeamInfo[]; warns: string[] } | null {
    const warns: string[] = [];

    if (!petExportText.trim() && !dungeonTeamText.trim()) {
      setError('Paste your pet export and dungeon teams export first.');
      return null;
    }
    if (!dungeonTeamText.trim()) {
      setError('Dungeon teams export is required (---DungeonTeamsStart---).');
      return null;
    }
    if (roster.size === 0) {
      setError('No roster loaded — go to the Import tab and import your pet export first.');
      return null;
    }

    const actionMap = parseActionColumn(petExportText);
    const nameToId  = new Map(Array.from(roster.values()).map(p => [p.displayName, p.id]));

    const parsed = parseDungeonTeams(dungeonTeamText);
    warns.push(...parsed.warnings);

    const { teams: resolved, warnings: rw } = resolveDungeonTeams(parsed, nameToId);
    warns.push(...rw);

    const teams: ActiveTeamInfo[] = [];
    for (const { teamIndex, team } of resolved) {
      if (team.slots.length === 0) {
        warns.push(`Team ${teamIndex}: no resolved slots; skipping.`);
        continue;
      }
      // Find dungeon via action column — check each pet until one matches
      let dungeonId: DungeonId | null = null;
      for (const slot of team.slots) {
        const name   = slot.petId as string;
        const action = actionMap.get(name) ?? '';
        const id     = ACTION_TO_DUNGEON[action] ?? null;
        if (id !== null) { dungeonId = id; break; }
      }
      if (dungeonId === null) {
        if (petExportText.trim() === '') {
          warns.push(`Team ${teamIndex}: pet export not provided; cannot detect dungeon. Using Scrapyard as fallback.`);
          dungeonId = 'Scrapyard';
        } else {
          warns.push(`Team ${teamIndex}: cannot detect dungeon from Action column; skipping.`);
          continue;
        }
      }
      teams.push({
        teamIndex,
        team,
        dungeonId,
        petNames: team.slots.map(s => s.petId as string),
        petIds:   team.slots.map(s => s.petId),
      });
    }
    return { teams, warns };
  }

  function handleSweep() {
    setError(null);
    setOverrideSweeps(null);
    const resolved = resolveTeams();
    if (resolved === null) return;
    setRunning(true);
    try {
      const results = runSweeps(resolved.teams, roster, depth, rooms, nrdcCompletions, false);
      setSweeps(results);
      setActiveTeams(resolved.teams);
      setWarnings(resolved.warns);
      // Init gear overrides for all unique pets
      const initOverrides: GearOverrides = {};
      const seen = new Set<string>();
      for (const at of resolved.teams) {
        for (const name of at.petNames) {
          if (!seen.has(name)) {
            seen.add(name);
            initOverrides[name] = {};
          }
        }
      }
      setGearOverrides(initOverrides);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRunning(false);
    }
  }

  function handleGearSweep() {
    if (activeTeams.length === 0) return;
    setOverrideRunning(true);
    try {
      const modRoster = applyOverrides(roster, gearOverrides);
      const results   = runSweeps(activeTeams, modRoster, depth, rooms, nrdcCompletions, true);
      setOverrideSweeps(results);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setOverrideRunning(false);
    }
  }

  function setSlotOverride(petName: string, slot: GearSlot, field: keyof Exclude<SlotOverride, null>, value: string | number) {
    setGearOverrides(prev => {
      const petOvr  = prev[petName] ?? {};
      const slotOvr = (petOvr[slot] ?? { bonus: 0, enchantEl: '', enchantVal: 0 }) as Exclude<SlotOverride, null>;
      return {
        ...prev,
        [petName]: { ...petOvr, [slot]: { ...slotOvr, [field]: value } },
      };
    });
  }

  // Unique pets across all active teams
  const uniquePets = Array.from(
    new Map(
      activeTeams.flatMap(at =>
        at.petIds.map((id, i) => [at.petNames[i]!, { id, name: at.petNames[i]! }])
      )
    ).values()
  );

  return (
    <div>
      {/* ── Inputs ─────────────────────────────────────────────────────────── */}
      <div className="card">
        <h2>Active Teams — Detect &amp; Sweep</h2>
        <p style={{ color: '#71717a', fontSize: 12, margin: '0 0 12px' }}>
          Import your pets on the <strong>Import</strong> tab first, then paste your dungeon-teams
          export here. The pet export is optional but needed to auto-detect which dungeon each team
          is running.
        </p>

        <div className="field" style={{ marginBottom: 10 }}>
          <label>Dungeon Teams Export <span style={{ color: '#71717a', fontWeight: 400 }}>(---DungeonTeamsStart---)</span></label>
          <textarea
            rows={5}
            value={dungeonTeamText}
            onChange={e => setDungeonTeamText(e.target.value)}
            placeholder="Paste dungeon teams export here…"
          />
        </div>

        <div className="field" style={{ marginBottom: 10 }}>
          <label>Pet Export <span style={{ color: '#71717a', fontWeight: 400 }}>(for dungeon auto-detection — optional)</span></label>
          <textarea
            rows={4}
            value={petExportText}
            onChange={e => setPetExportText(e.target.value)}
            placeholder="Paste pet export here (used to read Action column)…"
          />
        </div>

        <div className="grid-2" style={{ marginBottom: 12 }}>
          <div className="field">
            <label>Depth</label>
            <select value={depth} onChange={e => setDepth(Number(e.target.value) as 1 | 2 | 3 | 4)}>
              {([1, 2, 3, 4] as const).map(d => <option key={d} value={d}>{d}</option>)}
            </select>
          </div>
          <div className="field">
            <label>Rooms</label>
            <input type="number" min={1} max={60} value={rooms}
              onChange={e => setRooms(Math.max(1, Math.min(60, Number(e.target.value))))}
              style={{ width: 80 }} />
          </div>
          <div className="field">
            <label>NRDC Completions</label>
            <input type="number" min={0} value={nrdcCompletions}
              onChange={e => setNrdcCompletions(Math.max(0, Number(e.target.value)))}
              style={{ width: 80 }} />
          </div>
        </div>

        <button className="primary" onClick={handleSweep} disabled={running || roster.size === 0}>
          {running ? 'Sweeping…' : 'Sweep All Teams'}
        </button>
        {roster.size === 0 && (
          <span style={{ marginLeft: 12, color: '#ef4444', fontSize: 12 }}>
            Import your pets first →
          </span>
        )}
      </div>

      {error !== null && <div className="error"><strong>Error:</strong> {error}</div>}

      {warnings.length > 0 && (
        <div className="warning">
          <strong>Warnings:</strong>
          <ul style={{ margin: '4px 0 0', paddingLeft: 16 }}>
            {warnings.map((w, i) => <li key={i} style={{ fontSize: 12 }}>{w}</li>)}
          </ul>
        </div>
      )}

      {/* ── Sweep results ──────────────────────────────────────────────────── */}
      {sweeps !== null && sweeps.map(ts => {
        const ovr = overrideSweeps?.find(o => o.teamIndex === ts.teamIndex);
        return (
          <div key={ts.teamIndex} className="card">
            <h3 style={{ marginBottom: 4 }}>
              Team {ts.teamIndex} — {ts.dungeonId} D{depth}
              {ts.highestClear >= 0
                ? <span style={{ marginLeft: 8, color: '#16a34a', fontSize: 13 }}>Highest clear: {ts.highestClear}</span>
                : <span style={{ marginLeft: 8, color: '#dc2626', fontSize: 13 }}>Cannot clear any difficulty</span>}
              {ovr !== undefined && ovr.highestClear !== ts.highestClear && (
                <span style={{ marginLeft: 8, fontSize: 13,
                  color: ovr.highestClear > ts.highestClear ? '#15803d' : '#b91c1c' }}>
                  → {ovr.highestClear >= 0 ? ovr.highestClear : 'none'} (override)
                </span>
              )}
            </h3>
            <div style={{ fontSize: 12, color: '#71717a', marginBottom: 8 }}>
              {ts.petNames.join(', ')}
            </div>

            <div style={{ overflowX: 'auto' }}>
              <table>
                <thead>
                  <tr>
                    <th>Diff</th>
                    <th>Base</th>
                    {ovr !== undefined && <th>Override</th>}
                    <th>Rooms</th>
                    <th>XP</th>
                  </tr>
                </thead>
                <tbody>
                  {ts.sweep.map((row, i) => {
                    const ovrRow = ovr?.sweep[i];
                    return (
                      <tr key={row.difficulty}>
                        <td style={{ fontWeight: 600 }}>{row.difficulty}</td>
                        <td style={{ background: cellBg(row.cleared), textAlign: 'center', fontWeight: 600 }}>
                          {row.cleared ? '✓' : '✗'}
                        </td>
                        {ovrRow !== undefined && (
                          <td style={{
                            background: cellBg(row.cleared, ovrRow.cleared),
                            textAlign: 'center', fontWeight: 600,
                          }}>
                            {cellLabel(row.cleared, ovrRow.cleared)}
                          </td>
                        )}
                        <td>{row.cleared ? row.roomsCleared : `${row.roomsCleared}/${rooms}`}</td>
                        <td>{row.xpTotal > 0 ? row.xpTotal.toLocaleString() : '—'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        );
      })}

      {/* ── Gear What-If ───────────────────────────────────────────────────── */}
      {sweeps !== null && (
        <div className="card">
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: gearOpen ? 16 : 0 }}>
            <h3 style={{ margin: 0 }}>Gear What-If</h3>
            <button onClick={() => setGearOpen(o => !o)} style={{ fontSize: 12 }}>
              {gearOpen ? 'Hide' : 'Show'}
            </button>
          </div>

          {gearOpen && (
            <>
              <p style={{ fontSize: 12, color: '#71717a', margin: '0 0 12px' }}>
                Specify hypothetical gear bonuses per pet. Stats are re-derived from DL + growth +
                the gear below (ignoring your imported observed stats). Use this to answer "how much
                would better gear help?"
              </p>

              {uniquePets.map(({ name }) => {
                const pet = roster.get(name as PetId) ?? [...roster.values()].find(p => p.displayName === name);
                const obs = pet?.observed?.stats;
                const petOvr = gearOverrides[name] ?? {};
                return (
                  <div key={name} style={{ marginBottom: 16, paddingBottom: 16, borderBottom: '1px solid #e4e4e7' }}>
                    <div style={{ fontWeight: 600, marginBottom: 6 }}>
                      {name}
                      {obs !== undefined && (
                        <span style={{ fontWeight: 400, fontSize: 12, color: '#71717a', marginLeft: 8 }}>
                          HP {obs.hp.toLocaleString()} / ATK {obs.atk.toLocaleString()} / DEF {obs.def.toLocaleString()} / SPD {obs.spd.toLocaleString()}
                        </span>
                      )}
                    </div>
                    <div style={{ overflowX: 'auto' }}>
                      <table style={{ fontSize: 12 }}>
                        <thead>
                          <tr>
                            <th>Slot</th>
                            <th>Stat Bonus %</th>
                            <th>Enchant Element</th>
                            <th>Enchant Value</th>
                          </tr>
                        </thead>
                        <tbody>
                          {GEAR_SLOTS.map(slot => {
                            const so = petOvr[slot] ?? { bonus: 0, enchantEl: '', enchantVal: 0 };
                            return (
                              <tr key={slot}>
                                <td style={{ textTransform: 'capitalize' }}>{slot}</td>
                                <td>
                                  <input
                                    type="number" min={0} max={100} step={0.5}
                                    value={(so as Exclude<SlotOverride, null>).bonus}
                                    onChange={e => setSlotOverride(name, slot, 'bonus', Number(e.target.value))}
                                    style={{ width: 70 }}
                                  />
                                </td>
                                <td>
                                  <select
                                    value={(so as Exclude<SlotOverride, null>).enchantEl}
                                    onChange={e => setSlotOverride(name, slot, 'enchantEl', e.target.value)}
                                    style={{ fontSize: 12 }}
                                  >
                                    <option value="">— none —</option>
                                    {ELEMENTS.map(el => <option key={el} value={el}>{el}</option>)}
                                  </select>
                                </td>
                                <td>
                                  <input
                                    type="number" min={0} step={1}
                                    value={(so as Exclude<SlotOverride, null>).enchantVal}
                                    onChange={e => setSlotOverride(name, slot, 'enchantVal', Number(e.target.value))}
                                    style={{ width: 70 }}
                                    disabled={(so as Exclude<SlotOverride, null>).enchantEl === ''}
                                  />
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                );
              })}

              <button
                className="primary"
                onClick={handleGearSweep}
                disabled={overrideRunning}
              >
                {overrideRunning ? 'Running…' : 'Re-run with Gear Overrides'}
              </button>

              {overrideSweeps !== null && (
                <div style={{ marginTop: 12, padding: 10, background: '#f0fdf4', borderRadius: 6, fontSize: 12 }}>
                  <strong>Legend:</strong>&nbsp;
                  <span style={{ background: '#bbf7d0', padding: '1px 6px', borderRadius: 4 }}>↑✓</span> fail→clear&ensp;
                  <span style={{ background: '#fca5a5', padding: '1px 6px', borderRadius: 4 }}>↓✗</span> clear→fail&ensp;
                  <span style={{ background: '#dcfce7', padding: '1px 6px', borderRadius: 4 }}>✓</span> clear (unchanged)&ensp;
                  <span style={{ background: '#fee2e2', padding: '1px 6px', borderRadius: 4 }}>✗</span> fail (unchanged)
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
