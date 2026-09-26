import React from 'react';
import koreLogo from '../../assets/logos/kore-logo.png';

const work = [
  {
    area: 'Applications',
    detail: 'Developed C#/.NET WPF features for internal business applications using XAML and MVVM, including a configurable XML-generation workflow for Excel imports and a partial-match search interface for maintenance tooling.',
  },
  {
    area: 'Data & automation',
    detail: 'Built and modified SQL Server queries and stored procedures for order automation, validation, reporting, and data-quality workflows, including logic that automatically updated shipping methods, order comments, and processing status based on business rules.',
  },
  {
    area: 'Integrations',
    detail: 'Improved Boomi/NetSuite integration reliability and supportability by extending centralized error tracking and manual resolution workflows, building reusable transaction test harnesses, and reproducing production integration failures in QA.',
  },
];

/**
 * renders professional software engineering experience
 * :returns: experience section markup
 */
function Experience() {
  return (
    <section className="page-section section-experience" id="experience" aria-labelledby="experience-title">
      <div className="section-inner">
        <div className="section-heading" data-reveal>
          <div>
            <p className="eyebrow"><span className="section-index">01</span> Professional work</p>
            <h2 id="experience-title">Experience</h2>
          </div>
          <p>
            Production software engineering across .NET desktop applications,
            SQL Server workflows, and Boomi/NetSuite enterprise integrations.
          </p>
        </div>

        <article className="experience-card log-entry">
          <div className="experience-company" data-reveal>
            <p className="log-entry__period mono">
              <time dateTime="2025-01">Jan 2025</time>
              <span aria-hidden="true"> — </span>
              <time dateTime="2025-05">May 2025</time>
            </p>
            <a className="company-logo-link" href="https://www.korewireless.com/about-us" target="_blank" rel="noopener noreferrer">
              <img className="company-logo" src={koreLogo} width="3000" height="2000" alt="KORE Wireless" loading="lazy" decoding="async" />
            </a>
            <h3>KORE Wireless</h3>
            <p className="experience-role">IoT Software Engineering Co-op</p>
            <p className="experience-location mono">Rochester, NY</p>
            <ul className="experience-tech" aria-label="Technologies used">
              <li>C#</li>
              <li>.NET / WPF</li>
              <li>SQL Server</li>
              <li>Boomi</li>
              <li>NetSuite</li>
            </ul>
          </div>

          <div className="experience-details">
            <ol className="detail-list">
              {work.map(({ area, detail }, index) => (
                <li key={area} data-reveal style={{ '--reveal-delay': `${index * 90}ms` }}>
                  <span className="detail-list__area mono"><span aria-hidden="true">{String(index + 1).padStart(2, '0')} / </span>{area}</span>
                  <p>{detail}</p>
                </li>
              ))}
            </ol>

            <blockquote className="employer-feedback" data-reveal>
              <p>“He was able to work with greater independence than is expected of co-ops.”</p>
              <footer>
                <cite>Matt Telesky, Director of Software Engineering</cite>
              </footer>
            </blockquote>
          </div>
        </article>
      </div>
    </section>
  );
}

export default Experience;
