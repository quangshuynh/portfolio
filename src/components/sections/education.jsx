import React from 'react';
import ritLogo from '../../assets/logos/rit-logo.png';
import { aboutHref } from './siteNav';
const honors = [
  { name: 'Farash Foundation First in Family Scholar' },
  {
    name: 'Richard T. Cheng Endowed Scholarship',
    href: 'https://www.rit.edu/news/congratulations-our-2024-computer-science-scholarship-award-winners',
  },
  { name: 'Patrick P. Lee Scholarship' },
  { name: 'RIT Presidential Scholar' },
  { name: "Dean's List" },
];

/**
 * renders the about and education section
 * :returns: about and education markup
 */
function Education() {
  return (
    <section className="page-section section-background" id="about" aria-labelledby="about-title">
      <div className="section-inner">
        <div className="section-heading" data-reveal>
          <div><p className="eyebrow">Background</p><h2 id="about-title">About & education</h2></div>
          <p>I enjoy the parts of software engineering where application logic, data, APIs, and real operational problems meet.</p>
        </div>
        <div className="about-grid">
          <div className="about-card" data-reveal>
            <p className="about-card__lead">
              I like building practical software, but there’s more to me than what ends up in a repository.
            </p>
            <p>
              Outside the editor, I spend time around photography, cars, technology, gaming, music,
              and the occasional hike. My About page covers a little more of how I got into software,
              what I value when I build, and what I’m interested in beyond engineering.
            </p>
            <a className="text-link" href={aboutHref}>
              More about me →
            </a>
          </div>
          <article className="education-card" data-reveal style={{ '--reveal-delay': '120ms' }}>
            <div className="education-title">
              <a href="https://www.rit.edu/" target="_blank" rel="noopener noreferrer">
                <img className="institution-logo" src={ritLogo} width="860" height="860" alt="Rochester Institute of Technology" loading="lazy" decoding="async" />
              </a>
              <div><h3>Rochester Institute of Technology</h3><p className="degree">BS/MS Computer Science – Accelerated Program</p></div>
            </div>
            <dl className="education-meta">
              <div><dt>Expected graduation</dt><dd>2028</dd></div>
              <div><dt>GPA</dt><dd>3.42 / 4.00</dd></div>
            </dl>
            <p className="education-honors-title">Honors</p>
            <ul className="honors-list" aria-label="Academic honors">
              {honors.map((honor) => (
                <li key={honor.name}>
                  {honor.href ? (
                    <a href={honor.href} target="_blank" rel="noopener noreferrer">{honor.name}</a>
                  ) : (
                    honor.name
                  )}
                </li>
              ))}
            </ul>
          </article>
        </div>
      </div>
    </section>
  );
}

export default Education;
