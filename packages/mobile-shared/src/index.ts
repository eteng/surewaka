// @surewaka/mobile-shared
// Shared components, hooks, and utilities for SureWaka mobile apps

export { colors, darkColors, spacing, typography, gradients } from './theme';
export { ThemeProvider, useTheme, lightTheme, darkTheme } from './theme';
export type { Theme, ThemeColors, ThemeSpacing, ThemeTypography, ThemeGradients } from './theme';
export { supabase } from './supabase';
export { useAuth } from './hooks/use-auth';
export { useLocation } from './hooks/use-location';
export { apiClient, createAuthClient } from './api/client';
export type { ApiResponse } from './api/client';
export { searchAddress, reverseGeocode } from './maps/locationiq';
export type { LocationSuggestion } from './maps/locationiq';
export { useAuthStore } from './store/auth-store';
export { useBookingStore } from './store/booking-store';
