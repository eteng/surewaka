// Feature: surewaka-landing-page
// Integration Test: Campaign page routing test
// Validates: Requirements 11.1, 11.2
// Verifies that campaign pages render without nav/footer and contain campaign-specific content

import { describe, it, expect, vi } from 'vitest';
import { renderToString } from 'react-dom/server';
import { createElement } from 'react';

// Mock server-side dependencies that aren't needed for rendering
vi.mock('~/lib/supabase.server', () => ({
  getSupabaseAdmin: vi.fn(),
}));

// Mock react-router hooks used by components
vi.mock('react-router', () => ({
  Form: ({ children, ...props }: any) =>
    createElement('form', { ...props, action: '' }, children),
  useActionData: () => undefined,
  useNavigation: () => ({ state: 'idle' }),
  Outlet: () => createElement('div', { 'data-testid': 'outlet' }),
  data: (value: any) => value,
}));

import LagosLaunchPage from '../routes/campaigns/lagos-launch';
import CampaignLayout from '../layouts/campaign-layout';

describe('Campaign Page Routing — Lagos Launch', () => {
  it('renders Lagos-specific campaign content', () => {
    const html = renderToString(createElement(LagosLaunchPage));

    expect(html).toContain('SureWaka is launching in Lagos');
  });

  it('renders the waitlist form with source="campaign-lagos"', () => {
    const html = renderToString(createElement(LagosLaunchPage));

    expect(html).toContain('campaign-lagos');
    expect(html).toContain('name="source"');
  });

  it('does NOT contain navigation links (no "How It Works" nav link)', () => {
    const html = renderToString(createElement(LagosLaunchPage));

    // The navbar contains "How It Works" as a nav link — campaign pages should not have it
    expect(html).not.toContain('How It Works');
  });

  it('does NOT contain footer copyright text', () => {
    const html = renderToString(createElement(LagosLaunchPage));

    // The footer renders "All rights reserved" — campaign pages should not have it
    expect(html).not.toContain('All rights reserved');
  });
});

describe('Campaign Layout — Minimal wrapper', () => {
  it('renders the SureWaka logo', () => {
    const html = renderToString(createElement(CampaignLayout));

    expect(html).toContain('SureWaka');
  });

  it('does NOT render the full navbar (no "How It Works" link)', () => {
    const html = renderToString(createElement(CampaignLayout));

    expect(html).not.toContain('How It Works');
  });

  it('does NOT render the footer (no copyright or social links)', () => {
    const html = renderToString(createElement(CampaignLayout));

    expect(html).not.toContain('All rights reserved');
    expect(html).not.toContain('hello@surewaka.com');
  });

  it('renders the logo as a link to the homepage', () => {
    const html = renderToString(createElement(CampaignLayout));

    expect(html).toContain('href="/"');
    expect(html).toContain('SureWaka home');
  });
});
