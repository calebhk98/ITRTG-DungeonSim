import React, { useState } from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { Pet, PetId } from '@itrtg-sim/core';
import ImportTab from '../components/ImportTab.js';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

// Load the fixture synchronously from the bundled copy in src/fixtures
const __dirname = dirname(fileURLToPath(import.meta.url));
const SAMPLE_EXPORT = readFileSync(
  resolve(__dirname, '../fixtures/petExport.txt'),
  'utf-8',
);

// Wrapper component to capture roster state changes
function TestWrapper() {
  const [roster, setRoster] = useState<ReadonlyMap<PetId, Pet>>(new Map());
  return <ImportTab roster={roster} setRoster={setRoster} />;
}

describe('ImportTab', () => {
  it('imports sample export and renders Mouse with observed HP 111557', async () => {
    render(<TestWrapper />);

    // Set the textarea to the sample export text
    const textarea = screen.getByPlaceholderText('Paste pet export here…');
    fireEvent.change(textarea, { target: { value: SAMPLE_EXPORT } });

    // Click Import
    const importButton = screen.getByRole('button', { name: /import/i });
    fireEvent.click(importButton);

    // Mouse should appear in the roster table
    await waitFor(() => {
      expect(screen.getByText('Mouse')).toBeInTheDocument();
    });

    // Observed HP of Mouse is 111,557
    expect(screen.getByText('111,557')).toBeInTheDocument();
  });
});
