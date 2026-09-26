import React, { useEffect, useState } from 'react';
import { FaMoon, FaSun } from 'react-icons/fa';

const THEME_KEY = 'portfolio-theme';
const themeColors = { dark: '#101913', light: '#f1ede3' };

function readTheme() {
  try {
    return localStorage.getItem(THEME_KEY) || document.documentElement.dataset.theme || 'dark';
  } catch {
    return document.documentElement.dataset.theme || 'dark';
  }
}

/** Theme switch. Uses a circular View Transition from the button when available. */
export default function ThemeToggle({ className = '' }) {
  const [theme, setTheme] = useState(readTheme);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try { localStorage.setItem(THEME_KEY, theme); } catch { /* storage unavailable */ }
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', themeColors[theme]);
  }, [theme]);

  const toggleTheme = (event) => {
    const next = theme === 'dark' ? 'light' : 'dark';
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (typeof document.startViewTransition !== 'function' || reduced) {
      setTheme(next);
      return;
    }
    const rect = event.currentTarget.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    const radius = Math.hypot(Math.max(x, window.innerWidth - x), Math.max(y, window.innerHeight - y));
    const rootStyle = document.documentElement.style;
    rootStyle.setProperty('--theme-x', `${x}px`);
    rootStyle.setProperty('--theme-y', `${y}px`);
    rootStyle.setProperty('--theme-r', `${radius}px`);
    document.startViewTransition(() => {
      // Apply synchronously so the transition snapshot captures the new theme.
      document.documentElement.dataset.theme = next;
      setTheme(next);
    });
  };

  const label = `Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`;
  return (
    <button className={`theme-toggle${className ? ` ${className}` : ''}`} type="button" onClick={toggleTheme} aria-pressed={theme === 'light'} aria-label={label} title={label}>
      <span className="theme-toggle__icon" aria-hidden="true">{theme === 'dark' ? <FaSun /> : <FaMoon />}</span>
      <span className="theme-toggle__text">{theme === 'dark' ? 'Light' : 'Dark'}</span>
    </button>
  );
}
