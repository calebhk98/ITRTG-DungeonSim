import React, { useState } from 'react';
import type { Pet, PetId } from '@itrtg-sim/core';
import ImportTab from './components/ImportTab.js';
import SimulateTab from './components/SimulateTab.js';
import OptimizeTab from './components/OptimizeTab.js';
import ActiveTeamsTab from './components/ActiveTeamsTab.js';

type Tab = 'import' | 'simulate' | 'optimize' | 'active-teams';

export default function App(): React.ReactElement {
  const [activeTab, setActiveTab] = useState<Tab>('import');
  const [roster, setRoster] = useState<ReadonlyMap<PetId, Pet>>(new Map());
  const [rawPetExport, setRawPetExport] = useState('');

  return (
    <div>
      <h1>ITRTG Dungeon Sim</h1>
      <div className="tabs">
        <button
          className={`tab${activeTab === 'import' ? ' active' : ''}`}
          onClick={() => setActiveTab('import')}
        >
          Import
        </button>
        <button
          className={`tab${activeTab === 'simulate' ? ' active' : ''}`}
          onClick={() => setActiveTab('simulate')}
        >
          Simulate
        </button>
        <button
          className={`tab${activeTab === 'optimize' ? ' active' : ''}`}
          onClick={() => setActiveTab('optimize')}
        >
          Optimize
        </button>
        <button
          className={`tab${activeTab === 'active-teams' ? ' active' : ''}`}
          onClick={() => setActiveTab('active-teams')}
        >
          Active Teams
        </button>
      </div>

      {activeTab === 'import' && (
        <ImportTab roster={roster} setRoster={setRoster} setRawPetExport={setRawPetExport} />
      )}
      {activeTab === 'simulate' && (
        <SimulateTab roster={roster} />
      )}
      {activeTab === 'optimize' && (
        <OptimizeTab roster={roster} />
      )}
      {activeTab === 'active-teams' && (
        <ActiveTeamsTab roster={roster} petExportText={rawPetExport} />
      )}
    </div>
  );
}
