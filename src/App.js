import { useEffect, useState } from 'react';
import './App.css';
import { FaMoon, FaSun } from 'react-icons/fa';
import Header from './components/header';
import Experience from './components/experience';
import FeaturedProjects from './components/featuredProjects';
import TechStack from './components/techstack';
import MoreProjects from './components/moreProjects';
import Education from './components/education';
import Footer from './components/footer';

function App() {
  const [theme, setTheme] = useState(() => localStorage.getItem('portfolio-theme') || 'dark');

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem('portfolio-theme', theme);
    const themeColor = document.querySelector('meta[name="theme-color"]');
    themeColor?.setAttribute('content', theme === 'dark' ? '#0e1512' : '#f6f4ee');
  }, [theme]);

  const toggleTheme = () => setTheme((current) => current === 'dark' ? 'light' : 'dark');

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">Skip to main content</a>
      <Header />
      <main id="main-content">
        <Experience />
        <FeaturedProjects />
        <TechStack />
        <MoreProjects />
        <Education />
      </main>
      <Footer />
      <button
        className="theme-toggle"
        type="button"
        onClick={toggleTheme}
        aria-pressed={theme === 'light'}
        aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
      >
        {theme === 'dark' ? <FaSun aria-hidden="true" /> : <FaMoon aria-hidden="true" />}
        <span>{theme === 'dark' ? 'Light mode' : 'Dark mode'}</span>
      </button>
    </div>
  );
}

export default App;
