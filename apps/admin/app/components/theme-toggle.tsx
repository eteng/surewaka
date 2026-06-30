import { useEffect, useState } from 'react';
import { Moon, Sun } from 'lucide-react';
import { Button } from '~/components/ui/button';

const STORAGE_KEY = 'surewaka-admin-theme';

function resolveInitialDark(): boolean {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored) return stored === 'dark';
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

export function ThemeToggle() {
  const [isDark, setIsDark] = useState<boolean>(() => resolveInitialDark());

  useEffect(() => {
    document.documentElement.classList.toggle('dark', isDark);
    localStorage.setItem(STORAGE_KEY, isDark ? 'dark' : 'light');
  }, [isDark]);

  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={() => setIsDark((d) => !d)}
      aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
    >
      {isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
    </Button>
  );
}
