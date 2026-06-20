import React, { useRef, useState } from 'react';
import type { Pet, PetId } from '@itrtg-sim/core';
import { defaultRegistry } from '@itrtg-sim/core';
// Import the raw fixture text — Vite handles ?raw for text assets
// We use a static import via fetch-at-runtime to avoid typing issues
import sampleExportUrl from '../fixtures/petExport.txt?url';

interface ImportTabProps {
  roster: ReadonlyMap<PetId, Pet>;
  setRoster: (r: ReadonlyMap<PetId, Pet>) => void;
  setRawPetExport: (text: string) => void;
}

export default function ImportTab({ roster, setRoster, setRawPetExport }: ImportTabProps): React.ReactElement {
  const [text, setText] = useState('');
  const [warnings, setWarnings] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  function handleImport() {
    setError(null);
    setWarnings([]);
    try {
      // Pass the raw text directly — the real importer detects the semicolon-delimited format
      const result = defaultRegistry.importAuto(text);
      const map = new Map<PetId, Pet>();
      for (const pet of result.pets) {
        map.set(pet.id, pet);
      }
      setRoster(map);
      setRawPetExport(text);
      setWarnings(Array.from(result.warnings));
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function handleLoadSample() {
    try {
      const resp = await fetch(sampleExportUrl);
      const txt = await resp.text();
      setText(txt);
    } catch (err: unknown) {
      setError('Failed to load sample: ' + (err instanceof Error ? err.message : String(err)));
    }
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file === undefined) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const content = ev.target?.result;
      if (typeof content === 'string') setText(content);
    };
    reader.readAsText(file);
  }

  return (
    <div>
      <div className="card">
        <h2>Import Pet Export</h2>
        <p style={{ color: '#71717a', fontSize: 12, margin: '0 0 10px' }}>
          Paste your ITRTG pet export (semicolon-delimited) or upload a file.
        </p>
        <div className="row" style={{ marginBottom: 8 }}>
          <button onClick={handleLoadSample}>Load Sample</button>
          <span style={{ color: '#a1a1aa', fontSize: 12 }}>or</span>
          <input
            ref={fileInputRef}
            type="file"
            accept=".txt,.csv"
            onChange={handleFileChange}
            style={{ fontSize: 12 }}
          />
        </div>
        <textarea
          rows={8}
          value={text}
          onChange={e => setText(e.target.value)}
          placeholder="Paste pet export here…"
        />
        <div style={{ marginTop: 10 }}>
          <button className="primary" onClick={handleImport} disabled={text.trim() === ''}>
            Import
          </button>
        </div>
      </div>

      {error !== null && (
        <div className="error">
          <strong>Import error:</strong> {error}
        </div>
      )}

      {warnings.length > 0 && (
        <div className="warning">
          <strong>Warnings ({warnings.length}):</strong>
          <ul style={{ margin: '4px 0 0', paddingLeft: 16 }}>
            {warnings.map((w, i) => <li key={i}>{w}</li>)}
          </ul>
        </div>
      )}

      {roster.size > 0 && (
        <div className="card">
          <h2>Roster ({roster.size} pets)</h2>
          <div style={{ overflowX: 'auto' }}>
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Element</th>
                  <th>DL</th>
                  <th>CL</th>
                  <th>Class</th>
                  <th>Growth</th>
                  <th>HP (obs)</th>
                  <th>Atk (obs)</th>
                  <th>Def (obs)</th>
                  <th>Spd (obs)</th>
                </tr>
              </thead>
              <tbody>
                {Array.from(roster.values()).map(pet => (
                  <tr key={pet.id}>
                    <td>{pet.displayName}</td>
                    <td>{pet.primaryElement}</td>
                    <td>{pet.dungeonLevel}</td>
                    <td>{pet.classLevel}</td>
                    <td>{pet.evolvedClass ?? '—'}</td>
                    <td>{pet.totalGrowth.toLocaleString()}</td>
                    <td>{pet.observed !== undefined ? pet.observed.stats.hp.toLocaleString() : '—'}</td>
                    <td>{pet.observed !== undefined ? pet.observed.stats.atk.toLocaleString() : '—'}</td>
                    <td>{pet.observed !== undefined ? pet.observed.stats.def.toLocaleString() : '—'}</td>
                    <td>{pet.observed !== undefined ? pet.observed.stats.spd.toLocaleString() : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {roster.size === 0 && error === null && (
        <div style={{ color: '#71717a', textAlign: 'center', padding: 32 }}>
          No roster loaded. Import a pet export to get started.
        </div>
      )}
    </div>
  );
}
