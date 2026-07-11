import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// ─── Mocks ───────────────────────────────────────────────────────────────────

const mockGetToken = vi.fn().mockResolvedValue('mock-token');

vi.mock('@clerk/react', () => ({
  useAuth: () => ({ getToken: mockGetToken }),
}));

vi.mock('react-router', () => ({
  useRouteError: () => new Error('Test error'),
}));

// Mock the +types import (React Router generated types)
vi.mock('../+types/zones', () => ({}));

// ─── Helpers ─────────────────────────────────────────────────────────────────

const MOCK_ZONES = [
  {
    id: '1',
    name: 'Lekki',
    city: 'Lagos',
    country: 'Nigeria',
    keywords: ['lekki', 'ajah', 'chevron'],
    swLat: 6.4,
    swLng: 3.4,
    neLat: 6.6,
    neLng: 3.7,
    isActive: true,
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
  },
  {
    id: '2',
    name: 'Ikeja',
    city: 'Lagos',
    country: 'Nigeria',
    keywords: ['ikeja', 'maryland', 'alausa'],
    swLat: null,
    swLng: null,
    neLat: null,
    neLng: null,
    isActive: false,
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
  },
  {
    id: '3',
    name: 'Wuse',
    city: 'Abuja',
    country: 'Nigeria',
    keywords: ['wuse', 'zone 5'],
    swLat: null,
    swLng: null,
    neLat: null,
    neLng: null,
    isActive: true,
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
  },
];

function createFetchMock(
  data = MOCK_ZONES,
  meta = { page: 1, pageSize: 20, total: 3, totalPages: 1 },
) {
  return vi.fn().mockResolvedValue({
    ok: true,
    json: () => Promise.resolve({ data, meta }),
  });
}

function createErrorFetchMock(status = 500, message = 'Internal Server Error') {
  return vi.fn().mockResolvedValue({
    ok: false,
    status,
    json: () => Promise.resolve({ error: { message } }),
  });
}

// ─── Import and render helper ────────────────────────────────────────────────

// Import component at top level (mocks are hoisted)
import CoverageZonesPage from '../zones';

function renderPage() {
  return render(<CoverageZonesPage />);
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('CoverageZonesPage', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', createFetchMock());
    mockGetToken.mockResolvedValue('mock-token');
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  // ─── Sub-task 1: Table renders with correct columns ─────────────────────────

  describe('table renders with correct columns', () => {
    it('renders a table with Name, City, Country, Active, and Keywords column headers', async () => {
      renderPage();

      await waitFor(() => {
        expect(screen.getByRole('columnheader', { name: /name/i })).toBeInTheDocument();
      });

      expect(screen.getByRole('columnheader', { name: /city/i })).toBeInTheDocument();
      expect(screen.getByRole('columnheader', { name: /country/i })).toBeInTheDocument();
      expect(screen.getByRole('columnheader', { name: /active/i })).toBeInTheDocument();
      expect(screen.getByRole('columnheader', { name: /keywords/i })).toBeInTheDocument();
    });

    it('renders zone data in table rows', async () => {
      renderPage();

      await waitFor(() => {
        expect(screen.getAllByRole('row').length).toBeGreaterThan(1); // header + data rows
      });

      // Check zone names appear in cells (use getAllByText since filter options may duplicate)
      const lekkiCells = screen.getAllByText('Lekki');
      expect(lekkiCells.length).toBeGreaterThanOrEqual(1);

      const ikejaCells = screen.getAllByText('Ikeja');
      expect(ikejaCells.length).toBeGreaterThanOrEqual(1);

      const wuseCells = screen.getAllByText('Wuse');
      expect(wuseCells.length).toBeGreaterThanOrEqual(1);

      // Verify we have exactly 4 rows total (1 header + 3 data)
      expect(screen.getAllByRole('row')).toHaveLength(4);
    });
  });

  // ─── Sub-task 2: Add zone form requires at least 1 keyword ──────────────────

  describe('add zone form requires at least 1 keyword', () => {
    it('shows validation error when keywords field is empty on submit', async () => {
      const user = userEvent.setup();
      renderPage();

      // Wait for data to load
      await waitFor(() => {
        expect(screen.getAllByRole('row').length).toBeGreaterThan(1);
      });

      // Open the Add Zone modal
      const addButtons = screen.getAllByRole('button', { name: /add zone/i });
      await user.click(addButtons[0]);

      // Wait for modal to appear
      await waitFor(() => {
        expect(screen.getByRole('dialog')).toBeInTheDocument();
      });

      // Fill out required fields but leave keywords empty
      const nameInput = screen.getByLabelText(/^name$/i);
      const cityInput = screen.getByLabelText(/city/i);
      const countryInput = screen.getByLabelText(/country/i);

      await user.type(nameInput, 'Test Zone');
      await user.type(cityInput, 'Lagos');
      await user.type(countryInput, 'Nigeria');

      // Submit with empty keywords
      const createButton = screen.getByRole('button', { name: /create zone/i });
      await user.click(createButton);

      // Should show validation error (keywords min 1 required)
      await waitFor(() => {
        // The Zod error or the form validation error should appear
        const errorEl = document.querySelector('[class*="destructive"]');
        expect(errorEl).toBeInTheDocument();
        expect(errorEl?.textContent).toBeTruthy();
      });
    });
  });

  // ─── Sub-task 3: Active toggle sends PATCH and updates row ──────────────────

  describe('active toggle sends PATCH and updates row', () => {
    it('sends PATCH request with toggled isActive value when toggle is clicked', async () => {
      const fetchMock = createFetchMock();
      vi.stubGlobal('fetch', fetchMock);

      renderPage();

      // Wait for table to render
      await waitFor(() => {
        expect(screen.getAllByRole('row').length).toBeGreaterThan(1);
      });

      // Find the toggle switch for the first zone (Lekki, isActive=true)
      const toggles = screen.getAllByRole('switch');
      expect(toggles.length).toBe(3); // One per zone row

      // Click the first toggle (Lekki - currently active)
      fireEvent.click(toggles[0]);

      // The PATCH call should be made
      await waitFor(() => {
        const patchCalls = fetchMock.mock.calls.filter(
          (call: [string, RequestInit?]) => call[1]?.method === 'PATCH',
        );
        expect(patchCalls.length).toBe(1);
        const [url, options] = patchCalls[0];
        expect(url).toContain('/api/v1/admin/zones/1');
        expect(JSON.parse(options.body as string)).toEqual({ isActive: false });
      });
    });

    it('triggers refetch after successful PATCH', async () => {
      const fetchMock = createFetchMock();
      vi.stubGlobal('fetch', fetchMock);

      renderPage();

      await waitFor(() => {
        expect(screen.getAllByRole('row').length).toBeGreaterThan(1);
      });

      const initialCallCount = fetchMock.mock.calls.length;

      // Click toggle
      const toggles = screen.getAllByRole('switch');
      fireEvent.click(toggles[0]);

      // After PATCH succeeds, refetch is triggered (additional GET)
      await waitFor(() => {
        expect(fetchMock.mock.calls.length).toBeGreaterThan(initialCallCount + 1);
      });
    });
  });

  // ─── Sub-task 4: Filter by city/country works ───────────────────────────────

  describe('filter by city/country works', () => {
    it('re-fetches with city param when city filter is selected', async () => {
      const fetchMock = createFetchMock();
      vi.stubGlobal('fetch', fetchMock);

      renderPage();

      // Wait for initial load
      await waitFor(() => {
        expect(screen.getAllByRole('row').length).toBeGreaterThan(1);
      });

      // Find the city combobox and click it
      const comboboxes = screen.getAllByRole('combobox');
      fireEvent.click(comboboxes[0]);

      // Wait for options to appear and select Lagos
      await waitFor(() => {
        const lagosOption = screen.getByRole('option', { name: 'Lagos' });
        fireEvent.click(lagosOption);
      });

      // After selecting, fetch should be called with city=Lagos in the URL
      await waitFor(() => {
        const getCalls = fetchMock.mock.calls.filter(
          (call: [string, RequestInit?]) =>
            typeof call[0] === 'string' && call[0].includes('/api/v1/zones'),
        );
        const lastCall = getCalls[getCalls.length - 1];
        expect(lastCall[0]).toContain('city=Lagos');
      });
    });

    it('re-fetches with country param when country filter is selected', async () => {
      const fetchMock = createFetchMock();
      vi.stubGlobal('fetch', fetchMock);

      renderPage();

      await waitFor(() => {
        expect(screen.getAllByRole('row').length).toBeGreaterThan(1);
      });

      // Click the second combobox (country filter)
      const comboboxes = screen.getAllByRole('combobox');
      fireEvent.click(comboboxes[1]);

      // Select Nigeria
      await waitFor(() => {
        const nigeriaOption = screen.getByRole('option', { name: 'Nigeria' });
        fireEvent.click(nigeriaOption);
      });

      // After selecting, fetch should be called with country=Nigeria in the URL
      await waitFor(() => {
        const getCalls = fetchMock.mock.calls.filter(
          (call: [string, RequestInit?]) =>
            typeof call[0] === 'string' && call[0].includes('/api/v1/zones'),
        );
        const lastCall = getCalls[getCalls.length - 1];
        expect(lastCall[0]).toContain('country=Nigeria');
      });
    });
  });

  // ─── Sub-task 5: Error and loading states render correctly ──────────────────

  describe('error and loading states render correctly', () => {
    it('renders loading skeletons while data is being fetched', async () => {
      // Use a fetch that never resolves to keep loading state
      vi.stubGlobal(
        'fetch',
        vi.fn().mockReturnValue(new Promise(() => {})),
      );

      renderPage();

      // The Skeleton component from shadcn/ui renders with specific classes
      await waitFor(() => {
        const skeletons = document.querySelectorAll('[data-slot="skeleton"]');
        if (skeletons.length === 0) {
          // Fallback: check for animate-pulse which is what Skeleton uses
          const pulseElements = document.querySelectorAll('[class*="animate-pulse"]');
          expect(pulseElements.length).toBeGreaterThan(0);
        } else {
          expect(skeletons.length).toBeGreaterThan(0);
        }
      });
    });

    it('renders error state with retry button on fetch failure', async () => {
      vi.stubGlobal('fetch', createErrorFetchMock(500, 'Server is down'));

      renderPage();

      await waitFor(() => {
        expect(screen.getByText(/server is down/i)).toBeInTheDocument();
      });

      expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument();
    });

    it('retry button triggers refetch and shows data on success', async () => {
      vi.stubGlobal('fetch', createErrorFetchMock(500, 'Server error'));

      renderPage();

      await waitFor(() => {
        expect(screen.getByText(/server error/i)).toBeInTheDocument();
      });

      // Now replace with successful fetch
      vi.stubGlobal('fetch', createFetchMock());

      // Click retry
      const retryButton = screen.getByRole('button', { name: /retry/i });
      fireEvent.click(retryButton);

      // Should show data after retry succeeds
      await waitFor(() => {
        expect(screen.getAllByRole('row').length).toBeGreaterThan(1);
      });
    });

    it('renders error state on network failure', async () => {
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Network error')));

      renderPage();

      await waitFor(() => {
        // The component catches errors and shows a user-friendly message
        const errorEl = screen.queryByText(/network error/i) ||
          screen.queryByText(/unexpected error/i);
        expect(errorEl).toBeInTheDocument();
      });

      expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument();
    });
  });
});
