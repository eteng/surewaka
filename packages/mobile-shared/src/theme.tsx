import React, { createContext, useContext, useState, type ReactNode } from 'react';

export const colors = {
  primary: '#16a34a',
  primaryLight: '#f0fdf4',
  primaryDark: '#15803d',
  background: '#ffffff',
  surface: '#f9fafb',
  text: '#111827',
  textSecondary: '#6b7280',
  textMuted: '#9ca3af',
  border: '#e5e7eb',
  error: '#dc2626',
  warning: '#f59e0b',
  success: '#16a34a',
} as const;

export const darkColors = {
  primary: '#16a34a',
  primaryLight: '#14532d',
  primaryDark: '#22c55e',
  background: '#0f172a',
  surface: '#1e293b',
  text: '#f9fafb',
  textSecondary: '#9ca3af',
  textMuted: '#6b7280',
  border: '#334155',
  error: '#f87171',
  warning: '#fbbf24',
  success: '#22c55e',
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 48,
} as const;

export const typography = {
  heading: {
    fontSize: 24,
    fontWeight: 'bold' as const,
  },
  subheading: {
    fontSize: 18,
    fontWeight: '600' as const,
  },
  body: {
    fontSize: 16,
  },
  caption: {
    fontSize: 14,
    color: colors.textSecondary,
  },
  small: {
    fontSize: 12,
    color: colors.textMuted,
  },
} as const;

export const gradients = {
  primary: ['#16a34a', '#15803d'] as const,
  primaryDark: ['#15803d', '#14532d'] as const,
} as const;

export type ThemeColors = typeof colors | typeof darkColors;
export type ThemeSpacing = typeof spacing;
export type ThemeTypography = typeof typography;
export type ThemeGradients = typeof gradients;

export type Theme = {
  colors: ThemeColors;
  spacing: ThemeSpacing;
  typography: ThemeTypography;
  gradients: ThemeGradients;
  isDark: boolean;
};

export const lightTheme: Theme = {
  colors,
  spacing,
  typography,
  gradients,
  isDark: false,
};

export const darkTheme: Theme = {
  colors: darkColors,
  spacing,
  typography,
  gradients,
  isDark: true,
};

type ThemeContextValue = {
  theme: Theme;
  toggleTheme: () => void;
  setThemeMode: (mode: 'light' | 'dark') => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [isDark, setIsDark] = useState(false);

  const theme = isDark ? darkTheme : lightTheme;

  const toggleTheme = () => setIsDark((prev) => !prev);
  const setThemeMode = (mode: 'light' | 'dark') => setIsDark(mode === 'dark');

  return (
    <ThemeContext.Provider value={{ theme, toggleTheme, setThemeMode }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
}
