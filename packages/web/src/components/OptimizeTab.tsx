import React, { useState } from 'react';
import type {
  Pet,
  PetId,
  DungeonId,
  Depth,
  Difficulty,
  JointResult,
  ScoreTrace,
} from '@itrtg-sim/core';
import {
  DUNGEON_REGISTRY,
  getDungeon,
  objectiveRegistry,
  DEFAULT_CONSTANTS,
  makeFarmTargetProblem,
  makeTeamCompositionProblem,
  makeMultiTeamProblem,
  summarizeMultiTeamPlan,
  EnumerationOptimizer,
  GreedyOptimizer,
  BeamSearchOptimizer,
  optimizeJoint,
  mulberry32,
} from '@itrtg-sim/core';
import type { FarmTargetCandidate } from '@itrtg-sim/core';
import type { Team, MultiTeamPlan, TeamPlanSummary } from '@itrtg-sim/core';

type Dimension = 'farm' | 'team' | 'multiteam' | 'joint';
type Algorithm = 'enumerate' | 'greedy' | 'beam';

interface OptimizeTabProps {
  roster: ReadonlyMap<PetId, Pet>;
}

const DUNGEON_IDS = Array.from(DUNGEON_REGISTRY.keys()) as DungeonId[];
const OBJECTIVE_IDS = Array.from(objectiveRegistry.keys());

interface FarmResult {
  kind: 'farm';
  best: FarmTargetCandidate;
  score: number;
  trace: ScoreTrace;
}

interface TeamResult {
  kind: 'team';
  best: Team;
  score: number;
  trace: ScoreTrace;
  roster: ReadonlyMap<PetId, Pet>;
}

interface JointResultWrapped {
  kind: 'joint';
  result: JointResult;
}

interface MultiTeamResultWrapped {
  kind: 'multiteam';
  score: number;
  summaries: TeamPlanSummary[];
  trace: ScoreTrace;
  roster: ReadonlyMap<PetId, Pet>;
}

type OptResult = FarmResult | TeamResult | MultiTeamResultWrapped | JointResultWrapped;

export default function OptimizeTab({ roster }: OptimizeTabProps): React.ReactElement {
  const [dimension, setDimension] = useState<Dimension>('farm');
  const [objectiveId, setObjectiveId] = useState<string>(OBJECTIVE_IDS[0] ?? 'resourceYieldPerHour');
  const [algorithm, setAlgorithm] = useState<Algorithm>('enumerate');
  const [dungeonId, setDungeonId] = useState<DungeonId>(DUNGEON_IDS[0] ?? 'Scrapyard');
  const [depth, setDepth] = useState<Depth>(1);
  const [difficulty, setDifficulty] = useState<Difficulty>(0);
  const [rooms, setRooms] = useState(16);
  const [teamCount, setTeamCount] = useState(6);
  const [result, setResult] = useState<OptResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);

  function handleRun() {
    setError(null);
    setResult(null);

    if (roster.size === 0) {
      setError('No roster loaded. Please import pets first.');
      return;
    }

    const objective = objectiveRegistry.get(objectiveId);
    if (objective === undefined) {
      setError(`Unknown objective: ${objectiveId}`);
      return;
    }

    const dungeon = getDungeon(dungeonId);
    if (dungeon === undefined) {
      setError(`Unknown dungeon: ${dungeonId}`);
      return;
    }

    setRunning(true);
    try {
      const rng = mulberry32(42);

      if (dimension === 'farm') {
        // Build first-6-pet team for farm target search
        const rosterPets = Array.from(roster.values()).slice(0, 6);
        const teamSlots = rosterPets.map((pet, i) => ({
          petId: pet.id,
          row: (i < 3 ? 'front' : 'back') as 'front' | 'back',
          assignedClass: pet.evolvedClass,
        }));
        const team = { slots: teamSlots };

        const problem = makeFarmTargetProblem({
          team,
          dungeon,
          roster,
          objective,
          constants: DEFAULT_CONSTANTS,
        });

        let res: { best: FarmTargetCandidate; score: number; trace: ScoreTrace };

        if (algorithm === 'enumerate') {
          res = new EnumerationOptimizer().run(problem, { maxIterations: 500 });
        } else if (algorithm === 'greedy') {
          res = new GreedyOptimizer(rng).run(problem, { maxIterations: 200 });
        } else {
          res = new BeamSearchOptimizer(rng).run(problem, { maxIterations: 200 });
        }

        setResult({ kind: 'farm', best: res.best, score: res.score, trace: res.trace });

      } else if (dimension === 'team') {
        const problem = makeTeamCompositionProblem({
          roster,
          dungeon,
          depth,
          difficulty,
          rooms,
          objective,
          constants: DEFAULT_CONSTANTS,
          evaluationMode: 'expected',
        });

        let res: { best: Team; score: number; trace: ScoreTrace };

        if (algorithm === 'greedy' || algorithm === 'enumerate') {
          // Team composition doesn't support enumeration — use greedy
          res = new GreedyOptimizer(rng).run(problem, { maxIterations: 200 });
        } else {
          res = new BeamSearchOptimizer(rng).run(problem, { maxIterations: 200 });
        }

        setResult({ kind: 'team', best: res.best, score: res.score, trace: res.trace, roster });

      } else if (dimension === 'multiteam') {
        const mtInputs = {
          roster,
          dungeon,
          objective,
          constants: DEFAULT_CONSTANTS,
          teamCount,
        };
        const problem = makeMultiTeamProblem(mtInputs);
        const res = new GreedyOptimizer(rng).run(problem, { maxIterations: 400 });
        const summaries = summarizeMultiTeamPlan(res.best as MultiTeamPlan, mtInputs);
        setResult({ kind: 'multiteam', score: res.score, summaries, trace: res.trace, roster });

      } else {
        // Joint optimization
        const jointResult = optimizeJoint({
          roster,
          dungeon,
          objective,
          constants: DEFAULT_CONSTANTS,
          maxRounds: 3,
          innerMaxIterations: 100,
        });

        setResult({ kind: 'joint', result: jointResult });
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRunning(false);
    }
  }

  const maxTraceScore = result !== null
    ? (result.kind !== 'joint'
        ? Math.max(...result.trace.map(t => t.bestScore), 1)
        : 1)
    : 1;

  return (
    <div>
      <div className="card">
        <h2>Optimizer Config</h2>

        {roster.size === 0 && (
          <div className="warning">No roster loaded — go to the Import tab first.</div>
        )}

        <div className="grid-2" style={{ marginBottom: 12 }}>
          <div className="field">
            <label>Dimension</label>
            <select value={dimension} onChange={e => setDimension(e.target.value as Dimension)}>
              <option value="farm">Farm Target (depth/difficulty/rooms)</option>
              <option value="team">Team Composition</option>
              <option value="multiteam">Multi-Team (split roster across teams)</option>
              <option value="joint">Joint (all dimensions)</option>
            </select>
          </div>
          <div className="field">
            <label>Objective</label>
            <select value={objectiveId} onChange={e => setObjectiveId(e.target.value)}>
              {OBJECTIVE_IDS.map(id => <option key={id} value={id}>{id}</option>)}
            </select>
          </div>
          <div className="field">
            <label>Dungeon</label>
            <select value={dungeonId} onChange={e => setDungeonId(e.target.value as DungeonId)}>
              {DUNGEON_IDS.map(id => <option key={id} value={id}>{id}</option>)}
            </select>
          </div>
          {dimension !== 'joint' && dimension !== 'multiteam' && (
            <div className="field">
              <label>Algorithm</label>
              <select value={algorithm} onChange={e => setAlgorithm(e.target.value as Algorithm)}>
                {dimension === 'farm' && <option value="enumerate">Enumeration (exact)</option>}
                <option value="greedy">Greedy (hill-climb)</option>
                <option value="beam">Beam Search</option>
              </select>
            </div>
          )}
          {dimension === 'multiteam' && (
            <div className="field">
              <label>Team slots</label>
              <input type="number" min={1} max={12} value={teamCount} onChange={e => setTeamCount(Math.max(1, Number(e.target.value)))} style={{ width: 80 }} />
            </div>
          )}
          {dimension === 'team' && (
            <>
              <div className="field">
                <label>Depth</label>
                <select value={depth} onChange={e => setDepth(Number(e.target.value) as Depth)}>
                  {([1, 2, 3, 4] as Depth[]).map(d => <option key={d} value={d}>{d}</option>)}
                </select>
              </div>
              <div className="field">
                <label>Difficulty</label>
                <select value={difficulty} onChange={e => setDifficulty(Number(e.target.value) as Difficulty)}>
                  {([0,1,2,3,4,5,6,7,8,9,10] as Difficulty[]).map(d => <option key={d} value={d}>{d}</option>)}
                </select>
              </div>
              <div className="field">
                <label>Rooms</label>
                <input type="number" min={1} max={60} value={rooms} onChange={e => setRooms(Number(e.target.value))} style={{ width: 80 }} />
              </div>
            </>
          )}
        </div>

        <button className="primary" onClick={handleRun} disabled={running || roster.size === 0}>
          {running ? 'Optimizing…' : 'Run Optimizer'}
        </button>
      </div>

      {error !== null && <div className="error"><strong>Error:</strong> {error}</div>}

      {result !== null && result.kind === 'farm' && (
        <div className="card">
          <h2>Farm Target Result</h2>
          <div className="success">Best score: <strong>{result.score.toFixed(4)}</strong></div>
          <table>
            <tbody>
              <tr><td><strong>Depth</strong></td><td>{result.best.depth}</td></tr>
              <tr><td><strong>Difficulty</strong></td><td>{result.best.difficulty}</td></tr>
              <tr><td><strong>Rooms</strong></td><td>{result.best.rooms}</td></tr>
            </tbody>
          </table>
          {result.trace.length > 0 && (
            <>
              <h3 style={{ marginTop: 12 }}>Score Trace</h3>
              {result.trace.map((t, i) => (
                <div key={i} style={{ marginBottom: 4, fontSize: 12 }}>
                  <span className="trace-bar" style={{ width: Math.max(4, (t.bestScore / maxTraceScore) * 200) }} />
                  iter {t.iteration}: {t.bestScore.toFixed(4)}
                </div>
              ))}
            </>
          )}
        </div>
      )}

      {result !== null && result.kind === 'team' && (
        <div className="card">
          <h2>Team Composition Result</h2>
          <div className="success">Best score: <strong>{result.score.toFixed(4)}</strong></div>
          <table>
            <thead><tr><th>Pet</th><th>Row</th><th>Class</th></tr></thead>
            <tbody>
              {result.best.slots.map(slot => {
                const pet = result.roster.get(slot.petId);
                return (
                  <tr key={slot.petId}>
                    <td>{pet?.displayName ?? slot.petId}</td>
                    <td>{slot.row}</td>
                    <td>{slot.assignedClass ?? '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {result.trace.length > 0 && (
            <>
              <h3 style={{ marginTop: 12 }}>Score Trace</h3>
              {result.trace.map((t, i) => (
                <div key={i} style={{ marginBottom: 4, fontSize: 12 }}>
                  <span className="trace-bar" style={{ width: Math.max(4, (t.bestScore / maxTraceScore) * 200) }} />
                  iter {t.iteration}: {t.bestScore.toFixed(4)}
                </div>
              ))}
            </>
          )}
        </div>
      )}

      {result !== null && result.kind === 'multiteam' && (
        <div className="card">
          <h2>Multi-Team Result</h2>
          <div className="success">
            Aggregate score: <strong>{result.score.toFixed(4)}</strong> | Teams used: {result.summaries.length}
          </div>
          {result.summaries.length === 0 && (
            <div className="warning">No pets were assigned to any team.</div>
          )}
          {result.summaries.map((s, i) => (
            <div key={i} style={{ marginTop: 12 }}>
              <h3 style={{ marginBottom: 4 }}>
                Team {i + 1}: D{s.plan.depth}-{s.plan.difficulty}, {s.plan.rooms} rooms{' '}
                — {s.result.cleared ? '✓ cleared' : `partial (${s.result.roomsCleared} rooms)`}
                {s.feasible ? '' : ' — infeasible for objective'}
              </h3>
              <table>
                <thead><tr><th>Pet</th><th>Row</th><th>Class</th></tr></thead>
                <tbody>
                  {s.plan.team.slots.map(slot => {
                    const pet = result.roster.get(slot.petId);
                    return (
                      <tr key={slot.petId}>
                        <td>{pet?.displayName ?? slot.petId}</td>
                        <td>{slot.row}</td>
                        <td>{slot.assignedClass ?? '—'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ))}
        </div>
      )}

      {result !== null && result.kind === 'joint' && (
        <div className="card">
          <h2>Joint Optimization Result</h2>
          <div className="success">
            EV Score: <strong>{result.result.scoreEV.toFixed(4)}</strong> |
            MC Score: <strong>{result.result.scoreMC.toFixed(4)}</strong> |
            Rounds: {result.result.rounds}
          </div>

          <h3>Best Farm Target</h3>
          <table>
            <tbody>
              <tr><td><strong>Depth</strong></td><td>{result.result.farmTarget.depth}</td></tr>
              <tr><td><strong>Difficulty</strong></td><td>{result.result.farmTarget.difficulty}</td></tr>
              <tr><td><strong>Rooms</strong></td><td>{result.result.farmTarget.rooms}</td></tr>
            </tbody>
          </table>

          <h3 style={{ marginTop: 12 }}>Best Team</h3>
          <table>
            <thead><tr><th>Pet</th><th>Row</th><th>Class</th></tr></thead>
            <tbody>
              {result.result.team.slots.map(slot => {
                const pet = roster.get(slot.petId);
                return (
                  <tr key={slot.petId}>
                    <td>{pet?.displayName ?? slot.petId}</td>
                    <td>{slot.row}</td>
                    <td>{slot.assignedClass ?? '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          {result.result.trace.length > 0 && (
            <>
              <h3 style={{ marginTop: 12 }}>Optimization Trace</h3>
              {result.result.trace.map((t, i) => {
                const maxScore = Math.max(...result.result.trace.map(x => x.score), 1);
                return (
                  <div key={i} style={{ marginBottom: 4, fontSize: 12 }}>
                    <span className="trace-bar" style={{ width: Math.max(4, (t.score / maxScore) * 200) }} />
                    Round {t.round} [{t.phase}]: {t.score.toFixed(4)}
                  </div>
                );
              })}
            </>
          )}
        </div>
      )}
    </div>
  );
}
