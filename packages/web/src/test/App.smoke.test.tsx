import React from 'react';
import { render, screen } from '@testing-library/react';
import App from '../App.js';

describe('App smoke test', () => {
  it('renders without crashing and shows the tab navigation', () => {
    render(<App />);
    // The three tab buttons should be visible in the nav
    const tabs = screen.getAllByRole('button', { name: /^(Import|Simulate|Optimize)$/ });
    expect(tabs.length).toBeGreaterThanOrEqual(3);
    // The heading should be visible
    expect(screen.getByRole('heading', { name: /ITRTG Dungeon Sim/i })).toBeInTheDocument();
    // The Import tab panel is shown by default
    expect(screen.getByPlaceholderText(/paste pet export here/i)).toBeInTheDocument();
  });
});
