'use client';

import { Moon, Sun } from 'lucide-react';
import { useTheme } from './ThemeProvider';

export function ThemeToggle() {
  const { theme, toggleTheme } = useTheme();
  return <button type="button" className="ui-theme-toggle" onClick={toggleTheme} aria-label="Dark mode" aria-pressed={theme === 'dark'} title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}><Sun className="ui-theme-sun" size={16} aria-hidden="true" /><Moon className="ui-theme-moon" size={16} aria-hidden="true" /></button>;
}
