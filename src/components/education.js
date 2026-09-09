import React from 'react';
import ritLogo from '../assets/logos/rit-logo.png';
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
    <section className="page-section" id="about" aria-labelledby="about-title">
      <div className="section-inner">
        <div className="section-heading">
          <div><p className="eyebrow">Background</p><h2 id="about-title">About & education</h2></div>
          <p>I enjoy the parts of software engineering where application logic, data, APIs, and real operational problems meet.</p>
        </div>
        <div className="about-grid">
          <div className="about-card">
            <p>
              I’m a software developer and computer science student based in Rochester, NY.
            </p>
            <p>
              I gravitate toward practical software: backend systems, developer tools,
              automation, native applications, and production web systems for family-owned
              businesses—especially where reliability and thoughtful engineering matter.
            </p>

            <a className="text-link" href={aboutHref}>
              More about me →
            </a>
          </div>
          <article className="education-card">
            <div className="education-title">
              <a
                href="https://www.rit.edu/"
                target="_blank"
                rel="noopener noreferrer"
              >
                <img
                  className="institution-logo"
                  src={ritLogo}
                  alt="Rochester Institute of Technology"
                  loading="lazy"
                />
              </a>
              <div><h3>Rochester Institute of Technology</h3><p className="degree">BS/MS Computer Science – Accelerated Program</p></div>
            </div>
            <div className="education-meta"><span>Expected graduation: 2028</span><span>GPA: 3.42 / 4.00</span></div>
            <ul className="honors-list" aria-label="Academic honors">
              {honors.map((honor) => (
                <li key={honor.name}>
                  {honor.href ? (
                    <a
                      href={honor.href}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      {honor.name}
                    </a>
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
