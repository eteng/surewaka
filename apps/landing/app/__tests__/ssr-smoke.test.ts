// Feature: surewaka-landing-page
// Integration Test: SSR smoke test
// Validates: Requirements 9.3, 1.1
// Verifies that the home page renders above-the-fold content without JavaScript

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
  data: (value: any) => value,
}));

import HomePage from '../routes/home';

describe('SSR Smoke Test — Home Page', () => {
  it('renders the hero headline in the SSR HTML output', () => {
    const html = renderToString(createElement(HomePage));

    expect(html).toContain(
      'Connect with verified logistics providers across Nigeria',
    );
  });

  it('renders the waitlist form section with id="waitlist"', () => {
    const html = renderToString(createElement(HomePage));

    expect(html).toContain('id="waitlist"');
  });

  it('renders the "Join the Waitlist" CTA button', () => {
    const html = renderToString(createElement(HomePage));

    expect(html).toContain('Join the Waitlist');
  });

  it('renders all above-the-fold content without requiring client JS', () => {
    const html = renderToString(createElement(HomePage));

    // Hero subheadline is present
    expect(html).toContain(
      'Compare rates from trusted carriers or get matched with on-demand drivers',
    );

    // Primary CTA links to waitlist section
    expect(html).toContain('href="#waitlist"');

    // Waitlist form fields are present in the HTML
    expect(html).toContain('name="fullName"');
    expect(html).toContain('name="email"');
    expect(html).toContain('name="userType"');
  });
});
