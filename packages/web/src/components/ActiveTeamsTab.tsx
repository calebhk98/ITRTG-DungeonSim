import React, { useState } from 'react';
import type {
  Pet,
  PetId,
  DungeonId,
  Difficulty,
  GearSlot,
  GearQuality,
  GemType,
  ElementLevels,
} from '@itrtg-sim/core';
import {
  parseDungeonTeams,
  resolveDungeonTeams,
  getDungeon,
  simulateRun,
  DEFAULT_CONSTANTS,
  computeGearMultiplier,
  computeGemStatBonus,
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

type GearQualityOption = GearQuality;
type GemTypeOption = GemType | 'none';

interface SlotSpec {
  name: string;
  tier: 1 | 2 | 3 | 4;
  upgradeLevel: number;
  quality: GearQualityOption;
  gemType: GemTypeOption;
  gemLevel: number;
}

type GearOverrides = Record<string, Partial<Record<GearSlot, SlotSpec | null>>>;

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
const QUALITIES: GearQualityOption[] = ['D', 'C', 'B', 'A', 'S', 'SS', 'SSS'];
const GEM_TYPES: { value: GemTypeOption; label: string }[] = [
  { value: 'none',    label: '— no gem —' },
  { value: 'Fire',    label: 'Fire (ATK)' },
  { value: 'Water',   label: 'Water (HP)' },
  { value: 'Earth',   label: 'Earth (DEF)' },
  { value: 'Wind',    label: 'Wind (SPD)' },
  { value: 'Neutral', label: 'Neutral (element lvls)' },
];

function emptySlotSpec(
  name = '',
  tier: 1 | 2 | 3 | 4 = 4,
  upgradeLevel = 0,
  quality: GearQuality = 'SSS',
  gemType: GemTypeOption = 'none',
  gemLevel = 0,
): SlotSpec {
  return { name, tier, upgradeLevel, quality, gemType, gemLevel };
}

// ── Gear override application ─────────────────────────────────────────────────

function applyOverrides(
  roster: ReadonlyMap<PetId, Pet>,
  overrides: GearOverrides,
): Map<PetId, Pet> {
  const result = new Map<PetId, Pet>(roster);
  for (const pet of roster.values()) {
    const petOvr = overrides[pet.displayName];
    if (petOvr === undefined) continue;
    const newEquipment = { ...pet.equipment };
    for (const [slot, spec] of Object.entries(petOvr) as [GearSlot, SlotSpec | null | undefined][]) {
      if (spec === null) {
        delete newEquipment[slot];
      } else if (spec !== undefined && spec.name.trim() !== '') {
        const { tier, gemType, gemLevel } = spec;
        const gemBonus = gemType !== 'none' ? computeGemStatBonus(gemType, gemLevel, tier) : 0;
        const elemBonus = gemType === 'Neutral' ? gemLevel * tier : 0;
        newEquipment[slot] = {
          id:   `override-${slot}`,
          name: spec.name.trim(),
          slot,
          tier,
          statMultiplierBonus: computeGearMultiplier(spec.quality, spec.upgradeLevel),
          ...(gemType === 'Water'   ? { gemHpBonus:  gemBonus } : {}),
          ...(gemType === 'Fire'    ? { gemAtkBonus: gemBonus } : {}),
          ...(gemType === 'Earth'   ? { gemDefBonus: gemBonus } : {}),
          ...(gemType === 'Wind'    ? { gemSpdBonus: gemBonus } : {}),
          ...(gemType === 'Neutral' ? { elementEnchant: { Fire: elemBonus, Water: elemBonus, Wind: elemBonus, Earth: elemBonus } as Partial<ElementLevels> } : {}),
          upgradeLevel: spec.upgradeLevel,
          quality: spec.quality,
          ...(gemType !== 'none' ? { gemType, gemLevel } : {}),
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
  if (cleared && !overrideCleared) return '#fca5a5';
  if (!cleared && overrideCleared) return '#bbf7d0';
  return cleared ? '#dcfce7' : '#fee2e2';
}

function cellLabel(cleared: boolean, overrideCleared?: boolean): string {
  if (overrideCleared === undefined) return cleared ? '✓' : '✗';
  if (cleared && !overrideCleared) return '↓✗';
  if (!cleared && overrideCleared) return '↑✓';
  return cleared ? '✓' : '✗';
}

// ── Gear slot display ──────────────────────────────────────────────────────────

function gearLabel(piece: { name: string; upgradeLevel?: number; quality?: string; gemType?: string; gemLevel?: number } | undefined): string {
  if (piece === undefined) return '—';
  let label = piece.name;
  if (piece.upgradeLevel !== undefined) label += ` +${piece.upgradeLevel}`;
  if (piece.quality !== undefined) label += ` ${piece.quality}`;
  if (piece.gemType !== undefined && piece.gemLevel !== undefined) {
    label += ` (${piece.gemType} gem lv${piece.gemLevel})`;
  }
  return label;
}

// ── Component ─────────────────────────────────────────────────────────────────

interface Props {
  roster: ReadonlyMap<PetId, Pet>;
  petExportText: string;
}

export default function ActiveTeamsTab({ roster, petExportText }: Props): React.ReactElement {
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

  type ActiveTeamInfo = { teamIndex: number; team: import('@itrtg-sim/core').Team; dungeonId: DungeonId; petNames: string[]; petIds: PetId[] };
  const [activeTeams, setActiveTeams] = useState<ActiveTeamInfo[]>([]);

  function resolveTeams(): { teams: ActiveTeamInfo[]; warns: string[] } | null {
    const warns: string[] = [];

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
      let dungeonId: DungeonId | null = null;
      for (const slot of team.slots) {
        const name   = slot.petId as string;
        const action = actionMap.get(name) ?? '';
        const id     = ACTION_TO_DUNGEON[action] ?? null;
        if (id !== null) { dungeonId = id; break; }
      }
      if (dungeonId === null) {
        if (petExportText.trim() === '') {
          warns.push(`Team ${teamIndex}: pet export not imported yet; cannot detect dungeon. Using Scrapyard as fallback.`);
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

      // Init gear overrides: pre-fill from current roster equipment
      const initOverrides: GearOverrides = {};
      const seen = new Set<string>();
      for (const at of resolved.teams) {
        for (const name of at.petNames) {
          if (seen.has(name)) continue;
          seen.add(name);
          const pet = roster.get(name as PetId) ?? [...roster.values()].find(p => p.displayName === name);
          const slotSpecs: Partial<Record<GearSlot, SlotSpec | null>> = {};
          for (const slot of GEAR_SLOTS) {
            const piece = pet?.equipment[slot];
            if (piece !== undefined) {
              slotSpecs[slot] = emptySlotSpec(
                piece.name,
                piece.tier,
                piece.upgradeLevel ?? 0,
                (piece.quality as GearQuality | undefined) ?? 'SSS',
                (piece.gemType as GemTypeOption | undefined) ?? 'none',
                piece.gemLevel ?? 0,
              );
            } else {
              slotSpecs[slot] = null;
            }
          }
          initOverrides[name] = slotSpecs;
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

  function setSlotSpec(petName: string, slot: GearSlot, field: keyof SlotSpec, value: string | number) {
    setGearOverrides(prev => {
      const petOvr  = prev[petName] ?? {};
      const cur     = petOvr[slot] ?? emptySlotSpec();
      const updated = cur === null ? emptySlotSpec() : { ...cur, [field]: value };
      return { ...prev, [petName]: { ...petOvr, [slot]: updated } };
    });
  }

  function toggleSlot(petName: string, slot: GearSlot, equip: boolean) {
    setGearOverrides(prev => {
      const petOvr = prev[petName] ?? {};
      if (equip) {
        const pet = roster.get(petName as PetId) ?? [...roster.values()].find(p => p.displayName === petName);
        const piece = pet?.equipment[slot];
        return {
          ...prev,
          [petName]: {
            ...petOvr,
            [slot]: emptySlotSpec(
              piece?.name ?? '',
              piece?.tier ?? 4,
              piece?.upgradeLevel ?? 0,
              (piece?.quality as GearQuality | undefined) ?? 'SSS',
              (piece?.gemType as GemTypeOption | undefined) ?? 'none',
              piece?.gemLevel ?? 0,
            ),
          },
        };
      } else {
        return { ...prev, [petName]: { ...petOvr, [slot]: null } };
      }
    });
  }

  const uniquePets = Array.from(
    new Map(
      activeTeams.flatMap(at =>
        at.petIds.map((id, i) => [at.petNames[i]!, { id, name: at.petNames[i]! }])
      )
    ).values()
  );

  const petExportProvided = petExportText.trim() !== '';

  return (
    <div>
      {/* ── Inputs ─────────────────────────────────────────────────────────── */}
      <div className="card">
        <h2>Active Teams — Detect &amp; Sweep</h2>
        <p style={{ color: '#71717a', fontSize: 12, margin: '0 0 12px' }}>
          Import your pets on the <strong>Import</strong> tab, then paste your dungeon-teams export
          below. The pet export you already imported is used automatically to detect which dungeon
          each team is running — no need to paste it again.
        </p>

        {!petExportProvided && (
          <div className="warning" style={{ marginBottom: 12 }}>
            Pet export not yet imported. Go to the <strong>Import</strong> tab first. Dungeon
            auto-detection will fall back to Scrapyard until the export is available.
          </div>
        )}

        <div className="field" style={{ marginBottom: 10 }}>
          <label>Dungeon Teams Export <span style={{ color: '#71717a', fontWeight: 400 }}>(---DungeonTeamsStart---)</span></label>
          <textarea
            rows={5}
            value={dungeonTeamText}
            onChange={e => setDungeonTeamText(e.target.value)}
            placeholder="Paste dungeon teams export here…"
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
                Swap gear on any pet and see how it affects dungeon clears. Stats are re-derived
                from DL + growth + the gear below (formula path; observed stats are not used).
                Current gear is pre-filled from your import — change any field to model a swap.
                Leave a slot name blank to keep it as-is; uncheck the checkbox to unequip.
              </p>
              <p style={{ fontSize: 11, color: '#a1a1aa', margin: '-8px 0 12px' }}>
                Stat bonus = qualityBase + upgrade × 5%  (SSS=80%, SS=70%, S=60%, A=50%, B=40%, C=30%, D=20%)
              </p>

              {uniquePets.map(({ name }) => {
                const pet = roster.get(name as PetId) ?? [...roster.values()].find(p => p.displayName === name);
                const obs = pet?.observed?.stats;
                const petOvr = gearOverrides[name] ?? {};
                return (
                  <div key={name} style={{ marginBottom: 20, paddingBottom: 16, borderBottom: '1px solid #e4e4e7' }}>
                    <div style={{ fontWeight: 600, marginBottom: 8 }}>
                      {name}
                      {obs !== undefined && (
                        <span style={{ fontWeight: 400, fontSize: 12, color: '#71717a', marginLeft: 8 }}>
                          HP {obs.hp.toLocaleString()} / ATK {obs.atk.toLocaleString()} / DEF {obs.def.toLocaleString()} / SPD {obs.spd.toLocaleString()}
                        </span>
                      )}
                    </div>

                    {GEAR_SLOTS.map(slot => {
                      const currentPiece = pet?.equipment[slot];
                      const spec = petOvr[slot];
                      const equipped = spec !== null && spec !== undefined;
                      const slotData: SlotSpec = equipped
                        ? (spec as SlotSpec)
                        : emptySlotSpec(currentPiece?.name ?? '', currentPiece?.tier ?? 4, currentPiece?.upgradeLevel ?? 0, (currentPiece?.quality as GearQuality | undefined) ?? 'SSS');

                      return (
                        <div key={slot} style={{ display: 'grid', gridTemplateColumns: '90px 1fr', gap: 8, marginBottom: 8, alignItems: 'start' }}>
                          <div style={{ fontWeight: 500, fontSize: 13, textTransform: 'capitalize', paddingTop: 4 }}>
                            <label style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
                              <input
                                type="checkbox"
                                checked={equipped}
                                onChange={e => toggleSlot(name, slot, e.target.checked)}
                              />
                              {slot}
                            </label>
                            {currentPiece !== undefined && (
                              <div style={{ fontSize: 10, color: '#a1a1aa', marginTop: 2, paddingLeft: 18 }}>
                                {gearLabel(currentPiece)}
                              </div>
                            )}
                          </div>

                          {equipped && (
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, fontSize: 12 }}>
                              <input
                                type="text"
                                placeholder="Item name"
                                value={slotData.name}
                                onChange={e => setSlotSpec(name, slot, 'name', e.target.value)}
                                style={{ width: 160, fontSize: 12 }}
                              />
                              <label style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                                <span style={{ color: '#71717a' }}>+</span>
                                <input
                                  type="number" min={0} max={50}
                                  value={slotData.upgradeLevel}
                                  onChange={e => setSlotSpec(name, slot, 'upgradeLevel', Math.max(0, Number(e.target.value)))}
                                  style={{ width: 52, fontSize: 12 }}
                                />
                              </label>
                              <select
                                value={slotData.quality}
                                onChange={e => setSlotSpec(name, slot, 'quality', e.target.value as GearQuality)}
                                style={{ fontSize: 12 }}
                              >
                                {QUALITIES.map(q => <option key={q} value={q}>{q}</option>)}
                              </select>
                              <select
                                value={slotData.gemType}
                                onChange={e => setSlotSpec(name, slot, 'gemType', e.target.value as GemTypeOption)}
                                style={{ fontSize: 12 }}
                              >
                                {GEM_TYPES.map(g => <option key={g.value} value={g.value}>{g.label}</option>)}
                              </select>
                              {slotData.gemType !== 'none' && (
                                <label style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                                  <span style={{ color: '#71717a' }}>lv</span>
                                  <input
                                    type="number" min={0} max={30}
                                    value={slotData.gemLevel}
                                    onChange={e => setSlotSpec(name, slot, 'gemLevel', Math.max(0, Number(e.target.value)))}
                                    style={{ width: 52, fontSize: 12 }}
                                  />
                                </label>
                              )}
                              <label style={{ display: 'flex', alignItems: 'center', gap: 3, fontSize: 12 }}>
                                <span style={{ color: '#71717a' }}>T</span>
                                <select
                                  value={slotData.tier}
                                  onChange={e => setSlotSpec(name, slot, 'tier', Number(e.target.value) as 1|2|3|4)}
                                  style={{ fontSize: 12, width: 52 }}
                                >
                                  {([1,2,3,4] as const).map(t => <option key={t} value={t}>{t}</option>)}
                                </select>
                              </label>
                              <span style={{ color: '#71717a', fontSize: 11, alignSelf: 'center' }}>
                                ≈{(computeGearMultiplier(slotData.quality, slotData.upgradeLevel) * 100).toFixed(0)}%
                                {slotData.gemType !== 'none' && slotData.gemType !== 'Neutral' && (
                                  <> +{(computeGemStatBonus(slotData.gemType, slotData.gemLevel, slotData.tier) * 100).toFixed(0)}% {slotData.gemType === 'Water' ? 'HP' : slotData.gemType === 'Fire' ? 'ATK' : slotData.gemType === 'Earth' ? 'DEF' : 'SPD'}</>
                                )}
                                {slotData.gemType === 'Neutral' && (
                                  <> +{slotData.gemLevel * slotData.tier} elem lvls</>
                                )}
                              </span>
                            </div>
                          )}
                        </div>
                      );
                    })}
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
