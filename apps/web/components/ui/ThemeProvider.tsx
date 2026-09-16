'use client';

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

type Theme = 'light' | 'dark';
const storageKey = 'pr-search-theme';
const ThemeContext = createContext<{ theme: Theme; toggleTheme: () => void }>({ theme: 'light', toggleTheme: () => {} });

export function ThemeProvider({ children }: { readonly children: ReactNode }): ReactNode {
  const [theme, setTheme] = useState<Theme>('light');
  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    let preference: string | null = null;
    try { preference = localStorage.getItem(storageKey); } catch { /* System preference remains available. */ }
    const apply = (value: Theme) => { document.documentElement.dataset.theme = value; document.documentElement.style.colorScheme = value; setTheme(value); };
    const resolve = () => apply(preference === 'light' || preference === 'dark' ? preference : media.matches ? 'dark' : 'light');
    const sync = (event: StorageEvent) => { if (event.key === storageKey || event.key === null) { preference = event.newValue; resolve(); } };
    const local = () => { preference = document.documentElement.dataset.theme ?? null; resolve(); };
    resolve();
    media.addEventListener('change', resolve);
    window.addEventListener('storage', sync);
    window.addEventListener('pr-search-theme-change', local);
    return () => { media.removeEventListener('change', resolve); window.removeEventListener('storage', sync); window.removeEventListener('pr-search-theme-change', local); };
  }, []);
  const toggleTheme = () => {
    const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    document.documentElement.style.colorScheme = next;
    setTheme(next);
    try { localStorage.setItem(storageKey, next); } catch { /* Keep the in-memory choice when storage is unavailable. */ }
    window.dispatchEvent(new Event('pr-search-theme-change'));
  };
  return <ThemeContext.Provider value={{ theme, toggleTheme }}>{children}</ThemeContext.Provider>;
}

export function useTheme() { return useContext(ThemeContext); }
