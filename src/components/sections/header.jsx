import React, { useEffect, useState } from 'react';
import { FaArrowRight, FaArrowsAltH, FaFilePdf } from 'react-icons/fa';
import quangPhoto from '../../assets/quang.jpg';
import { aboutHref } from './siteNav';
import PersonalityButton from '../ui/personalityButton';
import HeroVisual from '../hero/HeroVisual';
import { Ridgeline, TopoField } from '../ui/terrain';

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
            {/* The original horizontal Meet Quang card, restored. */}
            <a className="meet-quang-card" href={aboutHref} style={{ '--i': 5 }}>
              <img className="meet-quang-card__photo" src={quangPhoto} alt="" />
              <span className="meet-quang-card__copy">
                <strong>Meet Quang</strong>
                <span>A little more about me</span>
              </span>
              <FaArrowRight className="meet-quang-card__arrow" aria-hidden="true" />
            </a>
          </div>

          <div className="hero-bench" style={{ '--i': 3 }}>
            <div className="hero-bench__frame viewfinder">
              <HeroVisual />
              <p className="hero-bench__hint" aria-hidden="true"><FaArrowsAltH /> Drag to orbit</p>
            </div>
          </div>
        </div>
        <Ridgeline className="hero-ridge" />
      </section>
    </header>
  );
}

export default Header;
