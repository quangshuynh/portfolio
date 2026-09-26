import React, { useEffect, useState } from 'react';
import { FaArrowRight, FaCamera, FaCar, FaCode, FaFilePdf, FaMountain } from 'react-icons/fa';
import quangPhoto from '../../assets/quang.jpg';
import { aboutHref, photographyPageHref } from './siteNav';
import PersonalityButton from '../ui/personalityButton';
import HeroVisual from '../hero/HeroVisual';
import SpotifyDisc from '../ui/spotifyDisc';
import { Ridgeline, TopoField } from '../ui/terrain';

const interests = [
  { icon: FaCode, label: 'Software', note: 'Backend · tools · native', href: '#projects' },
  { icon: FaCar, label: 'Cars', note: 'Subaru 2.5RS · WRX', href: `${aboutHref}#beyond-software` },
  { icon: FaCamera, label: 'Cameras', note: 'A curated photo log', href: photographyPageHref },
  { icon: FaMountain, label: 'Outdoors', note: 'Trails, falls, overlooks', href: `${aboutHref}#beyond-software` },
];

/**
 * renders the portfolio introduction
 * :returns: header markup
 */
function Header() {
  const [isWaving, setIsWaving] = useState(false);
  const [waveRun, setWaveRun] = useState(0);

  useEffect(() => {
    if (!isWaving) return undefined;
    const stopWaving = window.setTimeout(() => setIsWaving(false), 2100);
    return () => window.clearTimeout(stopWaving);
  }, [isWaving, waveRun]);

  const waveHello = () => {
    setIsWaving(true);
    setWaveRun((run) => run + 1);
  };

  return (
    <header className="home-header">
      <section className="hero" id="top" aria-labelledby="hero-title">
        <TopoField className="hero-topo" />
        <div className="hero-inner section-inner">
          <div className="hero-copy">
            <p className="eyebrow hero-eyebrow" style={{ '--i': 0 }}>Software Engineering · Backend · Developer Tools · Native Apps</p>
            <p className="hero-intro" style={{ '--i': 1 }}>
              Hi, I’m Quang.
              <button
                className={`wave-trigger${isWaving ? ' is-waving' : ''}`}
                type="button"
                aria-label="Wave hello"
                onClick={waveHello}
              >
                <span key={waveRun} className={`wave${isWaving ? ' is-waving' : ''}`} role="img" aria-label="Waving hand">👋🏻</span>
              </button>
            </p>
            <h1 id="hero-title" style={{ '--i': 2 }}>I build reliable backend systems, developer tools, automation, and native applications.</h1>
            <p className="hero-lede" style={{ '--i': 3 }}>
              I’m a software developer with professional experience in .NET applications,
              databases, and enterprise workflows. I build and maintain software across
              production web systems, backend infrastructure, developer tooling, and native applications.
            </p>
            <div className="hero-actions" style={{ '--i': 4 }}>
              <PersonalityButton href="#projects" personality="rally" personalityKey="hero-view-work">View my work <FaArrowRight aria-hidden="true" /></PersonalityButton>
              <a className="button button-secondary" href={`${import.meta.env.BASE_URL}Quang_Huynh_Resume.pdf`} target="_blank" rel="noreferrer">
                View résumé <FaFilePdf aria-hidden="true" />
              </a>
            </div>
            <dl className="hero-log" aria-label="Location and focus" style={{ '--i': 5 }}>
              <div><dt>Base</dt><dd>Rochester, NY, USA <span className="hero-log__coords">43.16° N · 77.61° W</span></dd></div>
              <div><dt>Study</dt><dd>RIT Computer Science · BS/MS</dd></div>
              <div><dt>Work</dt><dd>Software Engineering Co-op Experience</dd></div>
              <div><dt>Status</dt><dd><span className="status-dot" aria-hidden="true" />Open to Opportunities</dd></div>
            </dl>
          </div>

          <figure className="hero-bench" style={{ '--i': 3 }}>
            <div className="hero-bench__frame viewfinder">
              <div className="hero-bench__hud" aria-hidden="true">
                <span>Fig. 01 — The desk</span>
              </div>
              <HeroVisual />
              <div className="hero-bench__hud hero-bench__hud--bottom" aria-hidden="true">
                <span>PC · camera · 22B model</span>
                <span className="hero-bench__rec">Drag to orbit</span>
              </div>
            </div>
            <SpotifyDisc className="hero-bench__disc" href={`${aboutHref}#music`} label="Recently played on Spotify" />
            <a className="meet-quang-card" href={aboutHref} aria-label="Meet Quang">
              <img className="meet-quang-card__photo" src={quangPhoto} alt="" />
              <span className="meet-quang-card__copy">
                <strong>Meet Quang</strong>
                <span>Beyond the résumé</span>
              </span>
              <FaArrowRight className="meet-quang-card__arrow" aria-hidden="true" />
            </a>
          </figure>
        </div>

        <nav className="hero-legend section-inner" aria-label="Interests">
          <p className="hero-legend__title mono" aria-hidden="true">Legend</p>
          <ul>
            {interests.map(({ icon: Icon, label, note, href }, index) => (
              <li key={label} style={{ '--i': 6 + index * 0.5 }}>
                <a href={href}>
                  <span className="hero-legend__index mono">{String(index + 1).padStart(2, '0')}</span>
                  <Icon aria-hidden="true" />
                  <span className="hero-legend__label">{label}</span>
                  <span className="hero-legend__note">{note}</span>
                </a>
              </li>
            ))}
          </ul>
        </nav>
        <Ridgeline className="hero-ridge" />
      </section>
    </header>
  );
}

export default Header;
